import {
  AddEquation,
  CustomBlending,
  OneFactor,
  ZeroFactor,
  AlwaysStencilFunc,
  Color,
  DoubleSide,
  EqualStencilFunc,
  KeepStencilOp,
  MeshBasicMaterial,
  NormalBlending,
  ReplaceStencilOp,
  ShaderMaterial,
  type Texture,
  Vector3,
} from '@iwsdk/core';

/**
 * Light added on top of passthrough: rgb is added, destination alpha is kept,
 * so the real room still shows through (premultiplied compositing).
 */
const LIGHT = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendSrcAlpha: ZeroFactor,
  blendDstAlpha: OneFactor,
} as const;

const NOISE = /* glsl */ `
float thyraHash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float thyraNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(thyraHash(i), thyraHash(i+vec2(1,0)), u.x), mix(thyraHash(i+vec2(0,1)), thyraHash(i+vec2(1,1)), u.x), u.y); }
float thyraFbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*thyraNoise(p); p*=2.03; a*=0.5; } return s; }
`;

/** Stencil writer: the door opening. Invisible; marks pixels where world `ref` may draw. */
export function maskMaterial(ref: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    transparent: true,
    stencilWrite: true,
    stencilRef: ref,
    stencilFunc: AlwaysStencilFunc,
    stencilZPass: ReplaceStencilOp,
    stencilFail: KeepStencilOp,
    stencilZFail: KeepStencilOp,
  });
}

/** Depth-only blocker: after Step-in, the door becomes a window back to passthrough. */
export function blockerMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: DoubleSide });
}

function stencilled(m: ShaderMaterial, ref: number | null) {
  if (ref === null) return m;
  m.stencilWrite = true;
  m.stencilRef = ref;
  m.stencilFunc = EqualStencilFunc;
  m.stencilFail = KeepStencilOp;
  m.stencilZFail = KeepStencilOp;
  m.stencilZPass = KeepStencilOp;
  return m;
}

/**
 * The destination panorama. `ref` set → drawn only inside its door (stencil).
 * `ref` null → the Step-in copy that floods outward from the door direction,
 * keeping a band of real floor visible around your feet.
 */
export function worldMaterial(map: Texture | null, ref: number | null): ShaderMaterial {
  const m = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: ref === null,
    side: DoubleSide,
    uniforms: {
      map: { value: map },
      reveal: { value: 0 },
      flood: { value: 0 },
      floodOn: { value: ref === null ? 1 : 0 },
      eye: { value: new Vector3() },
      doorDir: { value: new Vector3(0, 0, -1) },
      floorY: { value: 0 },
      bandRadius: { value: 1.6 },
      rim: { value: new Color('#c8f03c') },
      tint: { value: new Color(1, 1, 1) },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float reveal, flood, floodOn, floorY, bandRadius, time;
      uniform vec3 eye, doorDir, rim, tint;
      varying vec2 vUv; varying vec3 vWorld;
      ${NOISE}
      void main(){
        vec3 c = texture2D(map, vUv).rgb * tint;
        // painterly reveal: noise-thresholded dissolve with a lime ink edge
        float n = thyraFbm(vUv*vec2(18.0, 9.0));
        float r = reveal*1.25 - 0.1;
        float a = smoothstep(n-0.06, n, r);
        float edge = smoothstep(n-0.12, n-0.06, r) * (1.0 - a);
        vec3 col = c + rim*edge*1.6;
        float alpha = max(a, edge*0.9);
        if (floodOn > 0.5) {
          vec3 d = normalize(vWorld - eye);
          float ang = acos(clamp(dot(d, doorDir), -1.0, 1.0));
          float front = flood * 3.4;
          float inF = 1.0 - smoothstep(front-0.28, front, ang);
          float ring = smoothstep(front-0.42, front-0.2, ang) * (1.0 - smoothstep(front-0.12, front, ang));
          alpha = inF;
          col = c + rim * ring * 1.4;
          if (d.y < -0.02) {
            float dist = (eye.y - floorY) / (-d.y) * length(d.xz);
            alpha *= smoothstep(bandRadius, bandRadius + 0.5, dist);
          }
        }
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
  return stencilled(m, ref);
}

/** Sumi ink in the opening while the world is being made: a rising lime line, never a percentage. */
export function inkMaterial(ref: number): ShaderMaterial {
  const m = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: { time: { value: 0 }, opacity: { value: 1 }, lime: { value: new Color('#c8f03c') }, sumi: { value: new Color('#171614') }, aspect: { value: 0.5 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float time, opacity, aspect; uniform vec3 lime, sumi; varying vec2 vUv;
      ${NOISE}
      void main(){
        float grain = thyraFbm(vUv*vec2(40.0*aspect, 40.0) + time*0.05);
        vec3 col = sumi * (0.75 + 0.5*grain);
        float y = fract(time*0.22);
        float line = exp(-abs(vUv.y - y)*90.0) * (0.7 + 0.3*thyraNoise(vec2(vUv.x*30.0, time*2.0)));
        float trail = smoothstep(y-0.35, y, vUv.y) * step(vUv.y, y) * 0.18;
        col += lime * (line*1.2 + trail);
        gl_FragColor = vec4(col, opacity);
        #include <colorspace_fragment>
      }`,
  });
  return stencilled(m, ref);
}

/** Additive glow: on the wall around the door (`mode` 0) or on the floor in front of it (`mode` 1). */
export function glowMaterial(mode: 0 | 1): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    ...LIGHT,
    uniforms: {
      color: { value: new Color('#c8f03c') },
      intensity: { value: 0 },
      // door half size inside the quad (in quad uv units, 0..0.5)
      doorHalf: { value: new Vector3(0.3, 0.35, 0) },
      time: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color, doorHalf; uniform float intensity, time; varying vec2 vUv;
      ${NOISE}
      void main(){
        float g;
        ${
          mode === 0
            ? `vec2 p = abs(vUv - 0.5) - doorHalf.xy; float outside = length(max(p, 0.0)); float inside = step(max(p.x,p.y), 0.0);
               g = exp(-outside*9.0) * (1.0 - inside) * 0.55;`
            : `float x = (vUv.x - 0.5); float z = vUv.y; // z: 0 at the wall → 1 into the room
               float w = doorHalf.x + z*0.35; float side = 1.0 - smoothstep(w*0.7, w, abs(x));
               g = side * pow(1.0 - z, 1.6) * 0.5;`
        }
        g *= 0.85 + 0.15*thyraNoise(vUv*6.0 + time*0.3);
        gl_FragColor = vec4(color * g * intensity, 1.0);
      }`,
  });
}

/**
 * Particles. `escape` = drifting out of the door into the room (no stencil);
 * otherwise motes inside the world (stencilled, parallax depth cues).
 */
export function particleMaterial(ref: number | null): ShaderMaterial {
  const m = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: ref === null,
    ...LIGHT,
    uniforms: {
      time: { value: 0 },
      color: { value: new Color('#ffffff') },
      size: { value: 0.02 },
      opacity: { value: 0 },
      origin: { value: new Vector3() },
      axisU: { value: new Vector3(1, 0, 0) },
      axisV: { value: new Vector3(0, 1, 0) },
      axisN: { value: new Vector3(0, 0, 1) },
      halfSize: { value: new Vector3(0.6, 1, 0) },
      escape: { value: ref === null ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 seed; // x,y: position in door (-1..1), z: depth/phase, w: random
      uniform float time, size, escape; uniform vec3 origin, axisU, axisV, axisN, halfSize;
      varying float vA;
      void main(){
        float life = mix(7.0, 11.0, seed.w);
        float t = mod(time + seed.z*life, life) / life; // 0..1
        vec3 p;
        if (escape > 0.5) {
          // born just behind the door plane, carried out into the room, curling and rising
          float out_ = t * mix(1.2, 2.6, seed.w);
          vec2 d = seed.xy * halfSize.xy * mix(0.95, 0.4, t);
          float swirl = sin(t*6.2831*0.7 + seed.w*20.0) * 0.18 * t;
          p = origin + axisU*(d.x + swirl) + axisV*(d.y + t*t*0.35*(seed.w-0.3)) + axisN*(out_ - 0.05);
          vA = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.55, 1.0, t));
        } else {
          // motes hanging 0.3..9 m behind the wall, inside a frustum seen through the door
          float depth = mix(0.3, 9.0, seed.z*seed.z);
          vec2 d = seed.xy * halfSize.xy * (1.0 + depth*0.9);
          d.y += sin(time*0.4 + seed.w*30.0)*0.05 + t*0.4;
          d.x += cos(time*0.3 + seed.w*17.0)*0.05;
          p = origin + axisU*d.x + axisV*d.y - axisN*depth;
          vA = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.8, 1.0, t));
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * projectionMatrix[1][1] * 700.0 / -mv.z * mix(0.6, 1.4, seed.w), 1.0, 48.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float opacity; varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float r = length(c);
        float a = smoothstep(0.5, 0.0, r); a *= a;
        gl_FragColor = vec4(color * a * vA * opacity, 1.0);
      }`,
  });
  return stencilled(m, ref);
}

/** Flat-colour trim / dimension lines. */
export function lineMaterial(hex: string, opacity = 1): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: new Color(hex), transparent: true, opacity, depthWrite: false, blending: NormalBlending, side: DoubleSide });
}
