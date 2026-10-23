import { cli, evalPage, P, sleep, snapshot, type Snapshot, type Vec3 } from './iwsdk.ts';

export const HAND = 'hand-right';

export async function enterSession(): Promise<void> {
  const st = cli<{ sessionActive: boolean }>('xr', 'status');
  if (!st.sessionActive) {
    cli('browser', 'reload', {});
    await sleep(2500);
    for (let i = 0; i < 20; i++) {
      cli('xr', 'enter', {});
      await sleep(1200);
      if (cli<{ sessionActive: boolean }>('xr', 'status').sessionActive) break;
    }
  }
  cli('xr', 'set-input-mode', { mode: 'hand' });
  cli('xr', 'set-device-state', {}); // reset poses: head at (0, 1.6, 0) facing -Z
  cli('xr', 'set-input-mode', { mode: 'hand' });
}

export async function waitFor(pred: (s: Snapshot) => boolean, timeoutMs = 20_000, what = 'condition'): Promise<Snapshot> {
  const t0 = Date.now();
  for (;;) {
    const s = snapshot();
    if (pred(s)) return s;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(s).slice(0, 600)}`);
    await sleep(400);
  }
}

export const aim = (t: Vec3, device = HAND) => cli('xr', 'look-at', { device, target: P(t) });

/** World point on a wall at plane coords (u, v). */
export function wallPoint(s: Snapshot, planeId: string, u: number, v: number): Vec3 {
  const w = s.walls.find((x) => x.id === planeId)!;
  const up: Vec3 = [0, 1, 0];
  const n = w.n;
  const uAxis: Vec3 = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  return [w.origin[0] + uAxis[0] * u + up[0] * v, w.origin[1] + uAxis[1] * u + up[1] * v, w.origin[2] + uAxis[2] * u + up[2] * v];
}

/** Pinch on `from`, drag through `steps` points to `to`, release. Returns the time of release. */
export async function pinchDrag(from: Vec3, to: Vec3, steps = 6, device = HAND): Promise<number> {
  aim(from, device);
  await sleep(250);
  cli('xr', 'set-select-value', { device, value: 1 });
  await sleep(250);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    aim([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t], device);
    await sleep(120);
  }
  cli('xr', 'set-select-value', { device, value: 0 });
  return Date.now();
}

/** Aim the hand ray at a door-card button and pinch. */
export async function pressCard(id: string, device = HAND): Promise<void> {
  const target = evalPage<Vec3 | null>(`window.__thyra.cardTarget(${JSON.stringify(id)})`);
  if (!target) throw new Error(`card button ${id} not visible`);
  aim(target, device);
  await sleep(300);
  cli('xr', 'select', { device, duration: 0.2 });
  await sleep(300);
}
