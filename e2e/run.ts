/**
 * Thyra emulator e2e (IWSDK agent mode: headless Chromium + IWER + SEM rooms).
 * Hands-only: every interaction is an emulated hand ray + pinch. Writes
 * deployments/e2e/<stamp>.json and exits non-zero on any failure.
 *
 * Needs: `npx iwsdk dev up --ai-mode agent --headless --allow-browser-automation`
 * running in packages/xr (see TESTING.md). Starts its own key-less gateway.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cli, evalPage, sleep, snapshot, XR_DIR, type Snapshot, type Vec3 } from './iwsdk.ts';
import { patchMean, pngSize, rgbDist } from './pixels.ts';
import { aim, enterSession, HAND, pinchDrag, pressCard, waitFor, wallPoint } from './scenario.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
type Check = { name: string; ok: boolean; detail?: unknown };
const checks: Check[] = [];
const metrics: Record<string, unknown> = {};
function check(name: string, ok: boolean, detail?: unknown) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 220)}` : ''}`);
}
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
const shot = (name: string) => {
  cli('browser', 'screenshot', {}, ['--output-file', `artifacts/e2e/${name}.png`]);
  return `${XR_DIR}artifacts/e2e/${name}.png`;
};

interface RoomCase {
  id: string;
  /** pick the wall to draw on */
  wall: (s: Snapshot) => Snapshot['walls'][number];
  door: { u0: number; u1: number; top: number };
  truth?: { wallW?: number; ceiling?: number; floorArea?: number };
}

const facing = (n: Vec3) => (s: Snapshot) => s.walls.reduce((a, b) => (b.n[0] * n[0] + b.n[2] * n[2] > a.n[0] * n[0] + a.n[2] * n[2] ? b : a));
const ROOMS: RoomCase[] = [
  { id: 'sunlit_living_room', wall: facing([0, 0, 1]), door: { u0: -0.6, u1: 0.6, top: 2.05 }, truth: { wallW: 5.0, ceiling: 2.7, floorArea: 29.0 } },
  { id: 'thyra_studio', wall: facing([0, 0, 1]), door: { u0: -0.55, u1: 0.55, top: 2.0 }, truth: { wallW: 3.6, ceiling: 2.4, floorArea: 15.12 } },
  { id: 'thyra_hall', wall: facing([-1, 0, 0]), door: { u0: -0.5, u1: 0.5, top: 1.95 }, truth: { wallW: 6.0, ceiling: 2.1, floorArea: 9.0 } },
  { id: 'bedroom', wall: facing([-1, 0, 0]), door: { u0: -0.45, u1: 0.45, top: 1.9 } },
];

let currentRoom = 'sunlit_living_room'; // the configured emulator room at page load
async function loadRoom(id: string): Promise<Snapshot> {
  if (id === currentRoom) {
    cli('xr', 'set-device-state', {});
    cli('xr', 'set-input-mode', { mode: 'hand' });
    return waitFor((s) => s.walls.length >= 3 && s.floorY !== null, 15000, `room ${id}`);
  }
  currentRoom = id;
  const before = JSON.stringify(snapshot().walls.map((w) => w.bounds));
  const ok = evalPage<boolean>(`window.__thyra.loadRoom(${JSON.stringify(id)})`, 90_000);
  if (!ok) throw new Error('IWER SEM not available');
  cli('xr', 'set-device-state', {});
  cli('xr', 'set-input-mode', { mode: 'hand' });
  if (id === 'none') return waitFor((s) => s.walls.length === 0, 15000, 'walls cleared');
  return waitFor((s) => s.walls.length >= 3 && s.floorY !== null && JSON.stringify(s.walls.map((w) => w.bounds)) !== before, 30000, `room ${id}`);
}

async function drawDoor(s: Snapshot, wallId: string, u0: number, u1: number, top: number) {
  const w = s.walls.find((x) => x.id === wallId)!;
  const floorV = (s.floorY ?? 0) - w.origin[1];
  const start = wallPoint(s, wallId, u0, floorV + top);
  const end = wallPoint(s, wallId, u1, floorV + 0.03);
  await pinchDrag(start, end, 6);
  return { start, end, floorV };
}

function doorPixelCheck(name: string, base: string, after: string, s: Snapshot) {
  const p = s.portals[0];
  const c = p.corners;
  const centre: Vec3 = [(c[0][0] + c[2][0]) / 2, c[0][1] + (c[2][1] - c[0][1]) * 0.72, (c[0][2] + c[2][2]) / 2];
  const px = evalPage<[number, number] | null>(`window.__thyra.project(${JSON.stringify(centre)})`);
  const cw = evalPage<[number, number]>(`[document.querySelector('canvas').clientWidth, document.querySelector('canvas').clientHeight]`);
  const [iw] = pngSize(after);
  const k = iw / cw[0];
  if (!px) return check(`${name}: door centre projects on screen`, false);
  const inBase = patchMean(base, px[0] * k, px[1] * k);
  const inAfter = patchMean(after, px[0] * k, px[1] * k);
  // a patch on the wall well outside the door: 0.45 m beyond its left edge, same height
  const len = Math.hypot(c[1][0] - c[0][0], c[1][2] - c[0][2]);
  const U: Vec3 = [(c[1][0] - c[0][0]) / len, 0, (c[1][2] - c[0][2]) / len];
  const wallPt: Vec3 = [c[0][0] - U[0] * 0.45, centre[1], c[0][2] - U[2] * 0.45];
  const out = evalPage<[number, number] | null>(`window.__thyra.project(${JSON.stringify(wallPt)})`);
  const outBase = out ? patchMean(base, out[0] * k, out[1] * k) : [0, 0, 0];
  const outAfter = out ? patchMean(after, out[0] * k, out[1] * k) : [0, 0, 0];
  const dIn = rgbDist(inBase, inAfter);
  const dOut = rgbDist(outBase, outAfter);
  check(`${name}: the world shows inside the door (ΔRGB in ${dIn.toFixed(1)} vs outside ${dOut.toFixed(1)})`, dIn > 25 && dIn > 3 * dOut, { dIn, dOut });
}

async function roomCase(rc: RoomCase) {
  const s0 = await loadRoom(rc.id);
  const wall = rc.wall(s0);
  const t = rc.truth;
  if (t?.wallW) check(`${rc.id}: wall width ${(wall.bounds.u1 - wall.bounds.u0).toFixed(3)} m vs truth ${t.wallW}`, near(wall.bounds.u1 - wall.bounds.u0, t.wallW, 0.02));
  if (t?.ceiling) check(`${rc.id}: ceiling ${((s0.ceilingY ?? NaN) - (s0.floorY ?? 0)).toFixed(3)} m vs truth ${t.ceiling}`, near((s0.ceilingY ?? NaN) - (s0.floorY ?? 0), t.ceiling, 0.02));
  if (t?.floorArea) check(`${rc.id}: floor area ${(s0.floorArea ?? NaN).toFixed(2)} m² vs truth ${t.floorArea}`, near(s0.floorArea ?? NaN, t.floorArea, 0.15));
  // face the wall, take a baseline
  const wc = wallPoint(s0, wall.id, (rc.door.u0 + rc.door.u1) / 2, 0);
  cli('xr', 'look-at', { device: 'headset', target: { x: wc[0], y: 1.3, z: wc[2] } });
  await sleep(500);
  const base = shot(`${rc.id}-0-base`);
  const t0 = Date.now();
  const { start, end, floorV } = await drawDoor(s0, wall.id, rc.door.u0, rc.door.u1, rc.door.top);
  const s1 = await waitFor((s) => s.portals.length === 1 && s.card?.view === 'choose', 6000, 'door card');
  const p = s1.portals[0];
  const offPlane = Math.max(...p.corners.map((c) => Math.abs((c[0] - wall.origin[0]) * wall.n[0] + (c[1] - wall.origin[1]) * wall.n[1] + (c[2] - wall.origin[2]) * wall.n[2])));
  const tl = p.corners[3];
  const pinchErr = Math.hypot(tl[0] - start[0], tl[1] - start[1], tl[2] - start[2]);
  const brErr = Math.abs(p.rect.u1 - rc.door.u1);
  check(`${rc.id}: door is on wall ${wall.id}, ${p.width.toFixed(2)} × ${p.height.toFixed(2)} m`, p.planeId === wall.id && near(p.width, rc.door.u1 - rc.door.u0, 0.01) && near(p.rect.v0, floorV, 0.005));
  check(`${rc.id}: corners within 5 mm of the wall plane (max ${(offPlane * 1000).toFixed(2)} mm)`, offPlane <= 0.005);
  check(`${rc.id}: corner within 1 cm of the pinch (top-left ${(pinchErr * 1000).toFixed(1)} mm, right edge ${(brErr * 1000).toFixed(1)} mm)`, pinchErr <= 0.01 && brErr <= 0.01);
  metrics[`${rc.id}.registration_mm`] = { off_plane_max: +(offPlane * 1000).toFixed(2), top_left_to_pinch: +(pinchErr * 1000).toFixed(2), right_edge: +(brErr * 1000).toFixed(2) };
  void end;
  await pressCard('dest-misty_pines');
  const s2 = await waitFor((s) => s.portals[0]?.phase === 'open', 25000, 'world open');
  const rec = s2.portals[0].record as Record<string, unknown>;
  const summary = s2.portals[0].summary as { portal: { w_m: number; h_m: number; bottom_m: number; wall: { w_m: number } }; room: { ceiling_m: number | null; floor_area_m2: number | null } };
  check(`${rc.id}: opened with the CC0 sample, stamped "${String(rec.stamp)}"`, rec.source === 'cc0-sample' && rec.stamp === 'Sample, not generated');
  check(`${rc.id}: room summary portal ${summary.portal.w_m} × ${summary.portal.h_m} m, sill ${summary.portal.bottom_m}`, near(summary.portal.w_m, rc.door.u1 - rc.door.u0, 0.011) && summary.portal.bottom_m === 0);
  if (t?.ceiling) check(`${rc.id}: summary ceiling ${summary.room.ceiling_m} vs truth`, near(summary.room.ceiling_m ?? NaN, t.ceiling, 0.02));
  const doors = (metrics.doors ??= []) as unknown[];
  doors.push({
    tag: s2.portals[0].tag,
    room: rc.id.startsWith('thyra_') ? `${rc.id} (ours)` : rc.id,
    door: `${p.width.toFixed(2)} × ${p.height.toFixed(2)} m`,
    destination: rec.destination,
    plan: 'Setup required',
    image: rec.stamp,
    pano_mode: rec.pano_mode,
    to_world_ms: rec.time_to_world_ms,
    off_plane_mm: +(offPlane * 1000).toFixed(2),
  });
  if (rc.id === 'thyra_studio') metrics.summary_example = rec.room;
  metrics[`${rc.id}.time_to_world_ms`] = { from_release: rec.time_to_world_ms, pano_mode: rec.pano_mode, note: 'no key: includes a 0.9 s hold on the room read, then sample decode' };
  await sleep(2400); // reveal animation
  const after = shot(`${rc.id}-1-open`);
  doorPixelCheck(rc.id, base, after, s2);
  // Step in: walk to the door
  const doorFoot = wallPoint(s2, wall.id, (rc.door.u0 + rc.door.u1) / 2, floorV + 1.6);
  const nrm = wall.n;
  cli('xr', 'animate-to', { device: 'headset', position: { x: doorFoot[0] + nrm[0] * 0.2, y: 1.6, z: doorFoot[2] + nrm[2] * 0.2 }, duration: 1.2 });
  await sleep(1300);
  const s3 = await waitFor((s) => s.portals[0]?.step === 'inside', 8000, 'inside');
  check(`${rc.id}: Step-in floods the world (inside, flood ${s3.portals[0].flood})`, s3.portals[0].step === 'inside' && s3.portals[0].flood === 1);
  cli('xr', 'animate-to', { device: 'headset', position: { x: doorFoot[0] + nrm[0] * 0.95, y: 1.6, z: doorFoot[2] + nrm[2] * 0.95 }, duration: 0.8 });
  const s4 = await waitFor((s) => s.portals[0]?.step === 'room', 8000, 'back in the room');
  check(`${rc.id}: moving 0.5 m away returns to the room`, s4.portals[0].step === 'room');
  cli('xr', 'set-device-state', {});
  cli('xr', 'set-input-mode', { mode: 'hand' });
  await sleep(300);
  await pressCard('close');
  const s5 = await waitFor((s) => s.portals.length === 0, 5000, 'door closed');
  check(`${rc.id}: Close door removes it`, s5.portals.length === 0);
}

async function guards() {
  const s = await loadRoom('sunlit_living_room');
  const back = s.walls.reduce((a, b) => (b.n[2] > a.n[2] ? b : a));
  await drawDoor(s, back.id, -0.1, 0.15, 1.2);
  await sleep(400);
  const s1 = snapshot();
  check('guard: a 0.25 m door is rejected with a readable hint', s1.portals.length === 0 && (s1.hint ?? '').startsWith('Too small'), s1.hint);
  // three doors, then a fourth replaces the oldest
  const right = s.walls.reduce((a, b) => (b.n[0] < a.n[0] ? b : a));
  const left = s.walls.reduce((a, b) => (b.n[0] > a.n[0] ? b : a));
  await drawDoor(s, back.id, -2.0, -1.2, 2.2);
  await waitFor((x) => x.portals.length === 1, 5000, 'door 1');
  await pressCard('dest-the_sky_is_on_fire');
  await waitFor((x) => x.portals[0]?.phase === 'open', 20000, 'door 1 open');
  await drawDoor(s, right.id, -1.5, -0.7, 2.0);
  await waitFor((x) => x.portals.length === 2, 5000, 'door 2');
  await pressCard('dest-satara_night');
  await waitFor((x) => x.portals[1]?.phase === 'open', 20000, 'door 2 open');
  await drawDoor(s, left.id, 1.0, 1.9, 2.0);
  const s3 = await waitFor((x) => x.portals.length === 3, 5000, 'door 3');
  await pressCard('dest-misty_pines');
  await waitFor((x) => x.portals[2]?.phase === 'open', 20000, 'door 3 open');
  check('multiple portals: three open doors on three walls', new Set(snapshot().portals.map((p) => p.planeId)).size === 3, s3.portals.map((p) => p.tag));
  // perf with three doors open, head turning across them
  evalPage('window.__thyraPerf.start(600)');
  cli('xr', 'animate-to', { device: 'headset', orientation: { x: 0, y: 0.38, z: 0, w: 0.92 }, duration: 3 });
  await sleep(3200);
  cli('xr', 'animate-to', { device: 'headset', orientation: { x: 0, y: -0.38, z: 0, w: 0.92 }, duration: 3 });
  await waitFor(() => evalPage<{ done: number }>('window.__thyraPerf.progress()').done >= 600, 60000, 'perf frames');
  metrics.perf_three_doors = evalPage('window.__thyraPerf.result()');
  cli('xr', 'set-device-state', {});
  cli('xr', 'set-input-mode', { mode: 'hand' });
  const tags = snapshot().portals.map((p) => p.tag);
  await drawDoor(s, back.id, 1.2, 2.0, 2.0);
  const s4 = await waitFor((x) => x.portals.length === 3 && !x.portals.some((p) => p.tag === tags[0]), 5000, 'door 4');
  check(`max 3 doors: a fourth closes the oldest (${tags[0]})`, s4.portals.length === 3 && !s4.portals.some((p) => p.tag === tags[0]), s4.portals.map((p) => p.tag));
  await pressCard('close');
}

async function paperWall() {
  await loadRoom('none');
  await waitFor((s) => (s.hint ?? '').startsWith('No walls found'), 12000, 'no-walls prompt');
  check('no walls: the paper-wall prompt appears', true);
  // pinch two floor points 2 m apart, 2 m ahead
  aim([-1.0, 0, -2.0]);
  await sleep(200);
  cli('xr', 'select', { device: HAND, duration: 0.2 });
  await sleep(400);
  aim([1.0, 0, -2.0]);
  await sleep(200);
  cli('xr', 'select', { device: HAND, duration: 0.2 });
  const s = await waitFor((x) => x.walls.length === 1, 5000, 'paper wall');
  check(`paper wall: a virtual wall is placed and labelled (${s.walls[0].label})`, s.walls[0].label === 'paper wall (virtual)' && near(s.walls[0].bounds.u1 - s.walls[0].bounds.u0, 2.0, 0.05));
  await drawDoor(s, s.walls[0].id, -0.5, 0.5, 2.0);
  await waitFor((x) => x.portals.length === 1, 5000, 'door on paper');
  await pressCard('dest-the_sky_is_on_fire');
  const s2 = await waitFor((x) => x.portals[0]?.phase === 'open', 20000, 'open on paper');
  check('paper wall: a door opens on it', s2.portals[0].phase === 'open');
  await pressCard('close');
}

// ------------------------------------------------------------------ main
mkdirSync(`${XR_DIR}artifacts/e2e`, { recursive: true });
const gw = spawn('node', [`${root}packages/gateway/src/main.ts`], { env: { ...process.env, MODEL_API_KEY: '', THYRA_RUNS_DIR: `${root}deployments/runs-e2e` }, stdio: 'ignore' });
const started = new Date();
const startedMs = Date.now();
let fatal: string | null = null;
try {
  const st = cli<{ browserCommandReady?: boolean }>('runtime', 'status');
  void st;
  try {
    cli('xr', 'exit', {});
  } catch {
    /* no session */
  }
  evalPage(`(location.search = '', true)`);
  await sleep(3500);
  await enterSession();
  await sleep(1500);
  const s = snapshot();
  check('gateway reached; every Meta model shows Setup required', Boolean(s.status) && JSON.stringify(s.status).includes('MODEL_API_KEY'));
  for (const rc of ROOMS) {
    try {
      await roomCase(rc);
    } catch (err) {
      check(`${rc.id}: scenario completed`, false, (err as Error).message);
    }
  }
  try {
    await guards();
  } catch (err) {
    check('guards scenario completed', false, (err as Error).message);
  }
  try {
    await paperWall();
  } catch (err) {
    check('paper-wall scenario completed', false, (err as Error).message);
  }
  // only this run's messages (the CLI keeps a buffer across reloads and earlier sessions)
  const logs = cli<Array<{ level: string; message: string; timestamp: number }>>('browser', 'logs', { count: 200 }).filter((l) => l.timestamp >= startedMs);
  const errors = logs.filter((l) => l.level === 'error');
  check(`console: ${errors.length} errors`, errors.length === 0, errors.slice(0, 3).map((e) => e.message.slice(0, 160)));
  metrics.console_warnings = logs.filter((l) => l.level === 'warn' || l.level === 'warning').map((l) => l.message.slice(0, 140));
} catch (err) {
  fatal = (err as Error).message;
  console.error(fatal);
} finally {
  gw.kill();
}
const passed = checks.filter((c) => c.ok).length;
const out = { started: started.toISOString(), finished: new Date().toISOString(), device: 'IWER metaQuest3 (emulator)', input: 'hands only', fatal, passed, failed: checks.length - passed, checks, metrics };
mkdirSync(`${root}deployments/e2e`, { recursive: true });
const file = `${root}deployments/e2e/${started.toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`\n${passed}/${checks.length} passed → ${file}`);
process.exit(fatal || passed !== checks.length ? 1 : 0);
