import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  type Object3D,
  PlaneGeometry,
  Points,
  RepeatWrapping,
  SRGBColorSpace,
  type ShaderMaterial,
  Texture,
  Vector3,
  MeshBasicMaterial,
  DoubleSide,
} from '@iwsdk/core';
import { SphereGeometry } from '@iwsdk/core';
import { type DoorRect, type WallFrame, dimensionLabel, fromPlane2 } from '@thyra/room';
import type { PanoMode } from '@thyra/pano';
import { BRAND } from './brand.js';
import { CanvasPanel } from './canvas-panel.js';
import { blockerMaterial, glowMaterial, inkMaterial, lineMaterial, maskMaterial, particleMaterial, worldMaterial } from './shaders.js';

const v3 = (a: [number, number, number]) => new Vector3(a[0], a[1], a[2]);
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export type PortalPhase = 'drawing' | 'framed' | 'planning' | 'painting' | 'open' | 'error';

/** Everything you see of one door: mask, world, trim, dimensions, light and particles. */
export class PortalView {
  readonly tag: string;
  readonly stencilRef: number;
  readonly frame: WallFrame;
  rect: DoorRect = { u0: 0, u1: 0, v0: 0, v1: 0 };
  phase: PortalPhase = 'drawing';

  /** Door-local space: x = U, y = V, z = N (toward the viewer). */
  readonly local = new Group();
  readonly worldRoot = new Group();
  /** Mask, trim and dimensions: hidden by real objects in front of the wall (depth occlusion). */
  readonly occludable = new Group();
  private readonly mask: Mesh;
  /** After Step-in: a door behind you (depth-only, so passthrough shows) with a lime frame: the way back. */
  private readonly backDoor = new Group();
  private readonly blocker: Mesh;
  private readonly ink: Mesh;
  private readonly trim: Mesh[] = [];
  private readonly dims: Mesh[] = [];
  private readonly dimLabel: CanvasPanel;
  private readonly halo: Mesh;
  private spill: Mesh | null = null;
  private readonly motes: Points;
  private readonly escape: Points;
  private windowed: Mesh | null = null;
  private flood: Mesh | null = null;
  private extras: Object3D[] = [];
  private texture: Texture | null = null;

  private openT = 0; // tear-open animation 0..1
  private revealT = 0; // world reveal 0..1
  private worldReady = false;
  private spillColor = new Color(BRAND.lime);
  private trimColor = new Color(BRAND.lime);
  private spillIntensity = 0.55;
  floodT = 0;
  inside = false;
  private time = 0;

  constructor(index: number, frame: WallFrame, floorY: number | null) {
    this.tag = `P-${String(index).padStart(2, '0')}`;
    this.stencilRef = ((index - 1) % 7) + 1;
    this.frame = frame;
    const basis = new Matrix4().makeBasis(v3(frame.u), v3(frame.v), v3(frame.n));
    basis.setPosition(v3(frame.origin));
    this.local.matrixAutoUpdate = false;
    this.local.matrix.copy(basis);
    this.local.name = `Thyra ${this.tag}`;

    this.mask = new Mesh(new PlaneGeometry(1, 1), maskMaterial(this.stencilRef));
    this.mask.name = `${this.tag} mask`;
    this.mask.renderOrder = 10;
    this.mask.visible = false;
    this.blocker = new Mesh(new PlaneGeometry(1, 1), blockerMaterial());
    this.blocker.renderOrder = 4;
    this.backDoor.add(this.blocker);
    const backTrim = lineMaterial(BRAND.lime, 0.95);
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(new PlaneGeometry(1, 1), backTrim);
      m.renderOrder = 150;
      this.backDoor.add(m);
    }
    this.backDoor.visible = false;
    this.backDoor.name = `${this.tag} way back`;
    this.ink = new Mesh(new PlaneGeometry(1, 1), inkMaterial(this.stencilRef));
    this.ink.renderOrder = 11;
    this.ink.visible = false;
    this.occludable.name = `${this.tag} occludable`;
    this.local.add(this.occludable, this.ink);
    this.occludable.add(this.mask);

    const lime = lineMaterial(BRAND.lime, 0.95);
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(new PlaneGeometry(1, 1), lime);
      m.renderOrder = 150;
      this.trim.push(m);
      this.occludable.add(m);
    }
    const dimMat = lineMaterial(BRAND.plaster, 0.75);
    for (let i = 0; i < 5; i++) {
      const m = new Mesh(new PlaneGeometry(1, 1), dimMat);
      m.renderOrder = 150;
      this.dims.push(m);
      this.occludable.add(m);
    }
    this.dimLabel = new CanvasPanel(`${this.tag} dimensions`, 512, 64, 0.4);
    this.dimLabel.mesh.renderOrder = 151;
    this.occludable.add(this.dimLabel.mesh);

    this.halo = new Mesh(new PlaneGeometry(1, 1), glowMaterial(0));
    this.halo.renderOrder = 140;
    this.local.add(this.halo);

    if (floorY !== null) {
      this.spill = new Mesh(new PlaneGeometry(1, 1), glowMaterial(1));
      this.spill.renderOrder = 140;
      this.worldRoot.add(this.spill);
      this.floorY = floorY;
    }

    this.motes = makePoints(260, particleMaterial(this.stencilRef));
    this.motes.renderOrder = 13;
    this.motes.visible = false;
    this.escape = makePoints(180, particleMaterial(null));
    this.escape.renderOrder = 160;
    this.escape.visible = false;
    this.worldRoot.add(this.motes, this.escape, this.backDoor);
    this.worldRoot.name = `Thyra ${this.tag} world`;
  }

  private floorY: number | null = null;

  get width(): number {
    return this.rect.u1 - this.rect.u0;
  }
  get height(): number {
    return this.rect.v1 - this.rect.v0;
  }

  addTo(scene: Object3D): void {
    scene.add(this.local, this.worldRoot);
    this.local.updateMatrixWorld(true);
  }

  /** World positions of the 4 door corners (on the wall plane). */
  corners(): Vector3[] {
    const r = this.rect;
    return [
      [r.u0, r.v0],
      [r.u1, r.v0],
      [r.u1, r.v1],
      [r.u0, r.v1],
    ].map(([u, v]) => v3(fromPlane2(this.frame, u, v)));
  }

  /** Live rectangle while the pinch is held (and after release). */
  setRect(rect: DoorRect, valid: boolean): void {
    this.rect = rect;
    const w = Math.max(0.001, this.width);
    const h = Math.max(0.001, this.height);
    const cu = (rect.u0 + rect.u1) / 2;
    const cv = (rect.v0 + rect.v1) / 2;
    const t = 0.012; // trim width (m)
    // Trim and dimensions sit 6 cm proud of the wall, like a door casing, level with the mask,
    // so depth noise at the wall surface never eats them.
    const z = 0.062;
    const [top, bottom, left, right] = this.trim;
    top.position.set(cu, rect.v1 + t / 2, z);
    top.scale.set(w + 2 * t, t, 1);
    bottom.position.set(cu, rect.v0 - t / 2, z);
    bottom.scale.set(w + 2 * t, t, 1);
    left.position.set(rect.u0 - t / 2, cv, z);
    left.scale.set(t, h, 1);
    right.position.set(rect.u1 + t / 2, cv, z);
    right.scale.set(t, h, 1);
    const col = valid ? this.trimColor : new Color(BRAND.setup);
    for (const m of this.trim) (m.material as MeshBasicMaterial).color.copy(col);

    // Dimension line above the door: main line, two end ticks, two extension lines.
    const dy = rect.v1 + 0.11;
    const lw = 0.004;
    const [line, tickL, tickR, extL, extR] = this.dims;
    line.position.set(cu, dy, z);
    line.scale.set(w, lw, 1);
    tickL.position.set(rect.u0, dy, z);
    tickL.scale.set(lw, 0.05, 1);
    tickL.rotation.z = Math.PI / 4;
    tickR.position.set(rect.u1, dy, z);
    tickR.scale.set(lw, 0.05, 1);
    tickR.rotation.z = Math.PI / 4;
    extL.position.set(rect.u0, rect.v1 + 0.065, z);
    extL.scale.set(lw, 0.11, 1);
    extR.position.set(rect.u1, rect.v1 + 0.065, z);
    extR.scale.set(lw, 0.11, 1);
    const p = this.dimLabel;
    p.ctx.clearRect(0, 0, 512, 64);
    p.ctx.fillStyle = 'rgba(23,22,20,0.82)';
    p.ctx.fillRect(0, 6, 512, 52);
    p.text(this.tag, 18, 44, 30, { mono: true, color: BRAND.lime, weight: 500 });
    p.text(dimensionLabel(w, h), 494, 44, 30, { mono: true, color: BRAND.plaster, align: 'right' });
    p.commit();
    p.mesh.position.set(cu, dy + 0.05, z + 0.002);

    this.halo.position.set(cu, cv, 0.006);
    this.halo.scale.set(w + 1.4, h + 1.4, 1);
    const hm = this.halo.material as ShaderMaterial;
    hm.uniforms.doorHalf.value.set(w / 2 / (w + 1.4), h / 2 / (h + 1.4), 0);

    // 6 cm proud of the wall: things flush on it (frames, wall art, depth noise) don't cut holes.
    this.mask.position.set(cu, cv, 0.06);
    this.mask.scale.set(w, h, 1);
    this.ink.position.set(cu, cv, 0.0);
    this.ink.scale.set(w, h, 1);
    (this.ink.material as ShaderMaterial).uniforms.aspect.value = w / h;

    if (this.spill && this.floorY !== null) {
      const f = this.frame;
      const bottom = fromPlane2(f, cu, rect.v0);
      const depth = 2.4;
      const width = w + 1.8;
      const basis = new Matrix4().makeBasis(v3(f.u), v3(f.n), v3(f.v).negate());
      this.spill.matrixAutoUpdate = false;
      basis.setPosition(new Vector3(bottom[0], this.floorY + 0.004, bottom[2]).addScaledVector(v3(f.n), depth / 2));
      this.spill.matrix.copy(basis).multiply(new Matrix4().makeScale(width, depth, 1));
      (this.spill.material as ShaderMaterial).uniforms.doorHalf.value.set(w / 2 / width, 0, 0);
      // Only light the floor when the door reaches it.
      this.spill.visible = Math.abs(fromPlane2(f, cu, rect.v0)[1] - this.floorY) < 0.25;
    }
    for (const pts of [this.motes, this.escape]) {
      const u = (pts.material as ShaderMaterial).uniforms;
      u.origin.value.copy(v3(fromPlane2(this.frame, cu, cv)));
      u.axisU.value.copy(v3(this.frame.u));
      u.axisV.value.copy(v3(this.frame.v));
      u.axisN.value.copy(v3(this.frame.n));
      u.halfSize.value.set(w / 2, h / 2, 0);
    }
    this.local.updateMatrixWorld(true);
  }

  /** Pinch released on a valid rectangle: tear the wall open. */
  finalize(): void {
    this.phase = 'framed';
    this.openT = 0.0001;
    this.mask.visible = true;
    this.ink.visible = true;
    this.escape.visible = true;
  }

  /** The panorama arrives: build the world behind the wall. */
  setWorld(texture: Texture, mode: PanoMode, eye: Vector3, eyeHeight: number, analysisColor: string | null): void {
    this.disposeWorld();
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    this.texture = texture;
    const doorCentre = v3(fromPlane2(this.frame, (this.rect.u0 + this.rect.u1) / 2, (this.rect.v0 + this.rect.v1) / 2));
    const toDoor = doorCentre.clone().sub(eye);
    toDoor.y = 0;
    toDoor.normalize();
    // u = 0.5 of the panorama faces the door (the plan's subject is centred).
    const yaw = Math.atan2(-toDoor.z, toDoor.x);
    const make = (ref: number | null) => {
      const mat = worldMaterial(texture, ref);
      let mesh: Mesh;
      if (mode === 'cylinder') {
        const R = 30;
        const aspect = texture.image ? (texture.image as { width: number }).width / (texture.image as { height: number }).height : 2;
        const H = (2 * Math.PI * R) / aspect;
        const geo = new CylinderGeometry(R, R, H, 128, 1, true);
        geo.scale(-1, 1, 1);
        mesh = new Mesh(geo, mat);
        mesh.rotation.y = yaw + Math.PI;
      } else {
        mesh = new Mesh(groundedSphere(12, Math.max(0.5, eyeHeight)), mat);
        mesh.rotation.y = yaw;
      }
      mesh.position.copy(eye);
      mesh.frustumCulled = false;
      return mesh;
    };
    this.windowed = make(this.stencilRef);
    this.windowed.renderOrder = 12;
    this.windowed.name = `${this.tag} world (windowed)`;
    this.flood = make(null);
    this.flood.renderOrder = 5;
    this.flood.visible = false;
    this.flood.name = `${this.tag} world (step-in)`;
    this.worldRoot.add(this.windowed, this.flood);
    if (mode === 'cylinder') {
      // sky dome and ground disc in the image's own top and bottom colours
      const img = texture.image as CanvasImageSource & { width: number; height: number };
      const [top, bottom] = edgeColours(img);
      for (const [color, y, rx] of [
        [top, 14, Math.PI / 2],
        [bottom, -eyeHeight, -Math.PI / 2],
      ] as const) {
        const disc = new Mesh(new CircleGeometry(30, 64), new MeshBasicMaterial({ color, side: DoubleSide, transparent: true, depthWrite: false }));
        const m = disc.material as MeshBasicMaterial;
        m.stencilWrite = true;
        m.stencilRef = this.stencilRef;
        m.stencilFunc = (this.windowed.material as ShaderMaterial).stencilFunc;
        disc.rotation.x = rx;
        disc.position.set(eye.x, eye.y + y, eye.z);
        disc.renderOrder = 11;
        this.extras.push(disc);
        this.worldRoot.add(disc);
      }
    }
    for (const m of [this.windowed, this.flood]) {
      const u = (m.material as ShaderMaterial).uniforms;
      u.doorDir.value.copy(toDoor);
      if (this.floorY !== null) u.floorY.value = this.floorY;
      u.rim.value.copy(this.trimColor);
    }
    if (analysisColor && !this.planned) this.setColours(analysisColor, BRAND.lime, 0.5);
    this.worldReady = true;
    this.revealT = 0;
    this.motes.visible = true;
    this.phase = 'open';
  }

  private planned = false;

  /** Colours from Spark's plan (or from the image when there is no plan). */
  setColours(spillHex: string, trimHex: string, intensity: number, fromPlan = false): void {
    if (fromPlan) this.planned = true;
    this.spillColor.set(spillHex);
    this.trimColor.set(trimHex);
    this.spillIntensity = Math.min(1, Math.max(0.15, intensity));
    for (const m of this.trim) (m.material as MeshBasicMaterial).color.copy(this.trimColor);
    for (const g of [this.halo, this.spill]) if (g) (g.material as ShaderMaterial).uniforms.color.value.copy(this.spillColor);
    const mc = (this.motes.material as ShaderMaterial).uniforms.color.value as Color;
    mc.copy(this.spillColor).lerp(new Color('#ffffff'), 0.5);
    ((this.escape.material as ShaderMaterial).uniforms.color.value as Color).copy(mc);
  }

  setPhase(p: PortalPhase): void {
    this.phase = p;
  }

  /**
   * Called when Step-in starts at `entry` (the head): the way back is a door the size of
   * this one, 0.7 m behind you toward the room, facing you once you turn around.
   */
  placeBackDoor(entry: Vector3, floorY: number | null): void {
    const n = v3(this.frame.n);
    const u = v3(this.frame.u);
    const w = this.width;
    const h = this.height;
    const bottom = floorY ?? entry.y - 1.6;
    const c = new Vector3(entry.x, bottom + h / 2, entry.z).addScaledVector(n, 0.7);
    // local axes: x = -U (mirrored), y = up, z = -N (faces the wall side, where you stand)
    const basis = new Matrix4().makeBasis(u.clone().negate(), new Vector3(0, 1, 0), n.clone().negate()).setPosition(c);
    this.backDoor.matrixAutoUpdate = false;
    this.backDoor.matrix.copy(basis);
    const [, top, bottomT, left, right] = this.backDoor.children as Mesh[];
    this.blocker.scale.set(w, h, 1);
    const t = 0.014;
    top.position.set(0, h / 2 + t / 2, 0.002);
    top.scale.set(w + 2 * t, t, 1);
    bottomT.position.set(0, -h / 2 - t / 2, 0.002);
    bottomT.scale.set(w + 2 * t, t, 1);
    left.position.set(-w / 2 - t / 2, 0, 0.002);
    left.scale.set(t, h, 1);
    right.position.set(w / 2 + t / 2, 0, 0.002);
    right.scale.set(t, h, 1);
    this.backDoor.updateMatrixWorld(true);
  }

  update(dt: number, eye: Vector3, floorY: number | null): void {
    this.time += dt;
    if (this.openT > 0 && this.openT < 1) this.openT = Math.min(1, this.openT + dt / 0.9);
    const open = easeOutExpo(this.openT);
    if (this.mask.visible) {
      // tear open from a vertical slit at the centre
      this.mask.scale.x = Math.max(0.002, this.width * open);
      this.ink.scale.x = this.mask.scale.x;
    }
    (this.ink.material as ShaderMaterial).uniforms.time.value = this.time;
    if (this.worldReady && this.revealT < 1) this.revealT = Math.min(1, this.revealT + dt / 1.6);
    const reveal = easeInOut(this.revealT);
    (this.ink.material as ShaderMaterial).uniforms.opacity.value = 1 - reveal;
    this.ink.visible = this.mask.visible && reveal < 1;
    for (const m of [this.windowed, this.flood]) {
      if (!m) continue;
      const u = (m.material as ShaderMaterial).uniforms;
      u.reveal.value = reveal;
      u.time.value = this.time;
      u.eye.value.copy(eye);
      if (floorY !== null) u.floorY.value = floorY;
    }
    // Step-in: the windowed copy stays until the flood is complete; then the door shows the room.
    if (this.flood) {
      this.flood.visible = this.floodT > 0.001;
      (this.flood.material as ShaderMaterial).uniforms.flood.value = easeInOut(this.floodT);
      this.backDoor.visible = this.inside;
      if (this.windowed) this.windowed.visible = !this.inside;
    }
    const glow = this.phase === 'drawing' ? 0.25 : (0.35 + 0.65 * reveal) * this.spillIntensity * open;
    const pulse = 0.9 + 0.1 * Math.sin(this.time * 1.7);
    (this.halo.material as ShaderMaterial).uniforms.intensity.value = glow * pulse * (this.inside ? 0 : 1);
    (this.halo.material as ShaderMaterial).uniforms.time.value = this.time;
    if (this.spill) {
      const su = (this.spill.material as ShaderMaterial).uniforms;
      su.intensity.value = glow * 1.2 * pulse * (this.inside ? 0 : 1);
      su.time.value = this.time;
    }
    for (const pts of [this.motes, this.escape]) {
      const u = (pts.material as ShaderMaterial).uniforms;
      u.time.value = this.time;
      u.opacity.value = pts === this.escape ? Math.min(1, open * (0.5 + reveal)) : reveal;
      u.size.value = pts === this.escape ? 0.016 : 0.03;
    }
  }

  /** Door-local hit test for "a hand went through" (index tip behind the wall inside the door). */
  get dims2(): { w: number; h: number } {
    return { w: this.width, h: this.height };
  }

  private disposeWorld(): void {
    for (const m of [this.windowed, this.flood, ...this.extras]) {
      if (!m) continue;
      m.removeFromParent();
      if (m instanceof Mesh) {
        m.geometry.dispose();
        (m.material as ShaderMaterial).dispose();
      }
    }
    this.extras = [];
    this.windowed = this.flood = null;
    this.texture?.dispose();
    this.texture = null;
  }

  dispose(): void {
    this.disposeWorld();
    for (const root of [this.local, this.worldRoot]) {
      root.removeFromParent();
      root.traverse((o) => {
        if (o instanceof Mesh || o instanceof Points) {
          o.geometry.dispose();
          const mat = o.material as { dispose(): void; map?: Texture | null };
          mat.map?.dispose();
          mat.dispose();
        }
      });
    }
  }
}

/**
 * An inside-out sphere of radius R whose lower part is pressed onto a ground
 * plane `height` below its centre, but only where that ground is nearer than
 * the sphere: steep-down directions get real floor parallax, while the band
 * just below the horizon stays spherical (so distant trunks and walls don't
 * bend over, as they do with a fully ground-projected skybox).
 */
function groundedSphere(R: number, height: number): SphereGeometry {
  const geo = new SphereGeometry(R, 128, 64);
  geo.scale(1, 1, -1);
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y >= 0) continue;
    const dy = -v.y / R; // sine of the angle below the horizon
    const t = height / dy; // distance along the ray to the ground
    if (t < R) {
      v.multiplyScalar(t / R);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}

function makePoints(n: number, mat: ShaderMaterial): Points {
  const geo = new BufferGeometry();
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    seed[i * 4] = Math.random() * 2 - 1;
    seed[i * 4 + 1] = Math.random() * 2 - 1;
    seed[i * 4 + 2] = Math.random();
    seed[i * 4 + 3] = Math.random();
  }
  geo.setAttribute('seed', new BufferAttribute(seed, 4));
  geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
  const p = new Points(geo, mat);
  p.frustumCulled = false;
  return p;
}

function edgeColours(img: CanvasImageSource & { width: number; height: number }): [Color, Color] {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, 64, 32);
  const row = (y: number) => {
    const d = ctx.getImageData(0, y, 64, 1).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < 64; i++) {
      r += d[i * 4];
      g += d[i * 4 + 1];
      b += d[i * 4 + 2];
    }
    return new Color(r / 64 / 255, g / 64 / 255, b / 64 / 255).convertSRGBToLinear();
  };
  return [row(0), row(31)];
}

export { Texture };
