import type { World } from '@iwsdk/core';

/**
 * Frame-time probe: CPU ms from the start of the ECS update to the end of the
 * renderer's submit, plus draw calls and triangles. Headless Chromium uses a
 * software or desktop GPU, so these are emulator numbers, never device numbers.
 */
export function installPerfProbe(world: World): void {
  const r = world.renderer;
  let target = 0;
  let t0 = 0;
  let inFrame = false;
  const cpu: number[] = [];
  const calls: number[] = [];
  const tris: number[] = [];
  let xrFrames = 0;
  const origUpdate = world.update.bind(world);
  world.update = ((d: number, t: number) => {
    if (cpu.length < target) {
      t0 = performance.now();
      inFrame = true;
    }
    origUpdate(d, t);
  }) as typeof world.update;
  const origRender = r.render.bind(r);
  r.render = ((scene, camera) => {
    origRender(scene, camera);
    if (inFrame) {
      inFrame = false;
      cpu.push(performance.now() - t0);
      calls.push(r.info.render.calls);
      tris.push(r.info.render.triangles);
      if (r.xr.isPresenting) xrFrames++;
    }
  }) as typeof r.render;
  const pct = (a: number[], p: number) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] : NaN;
  };
  (window as unknown as { __thyraPerf: unknown }).__thyraPerf = {
    start(frames: number) {
      cpu.length = calls.length = tris.length = 0;
      xrFrames = 0;
      target = frames;
      return true;
    },
    progress: () => ({ done: cpu.length, target }),
    result: () => ({
      frames: cpu.length,
      xrFrames,
      cpuMs: { p50: pct(cpu, 50), p95: pct(cpu, 95), max: Math.max(...cpu) },
      drawCalls: { p50: pct(calls, 50), max: Math.max(...calls) },
      triangles: { p50: pct(tris, 50), max: Math.max(...tris) },
      gl: (() => {
        const gl = r.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      })(),
    }),
  };
}
