import { captureReady } from './audit-capture.ts';
/**
 * Meta VR Glasses profile (IWER metaVRGlasses): gaze aims, a hand pinch
 * selects; the door card must sit inside the glasses' view (±37°, +25°/−43°).
 * Temporarily switches dev.emulator.device in iwsdk.config.json and restores it.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cli, evalPage, P, sleep, snapshot, XR_DIR, type Vec3 } from './iwsdk.ts';
import { HAND, waitFor, wallPoint } from './scenario.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const cfgPath = `${XR_DIR}iwsdk.config.json`;
const original = readFileSync(cfgPath, 'utf8');
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 200)}` : ''}`);
};
const gazeAt = (t: Vec3) => cli('xr', 'look-at', { device: 'headset', target: P(t) });

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const st = execFileSync('node', [`${XR_DIR}node_modules/@iwsdk/cli/dist/cli.js`, 'dev', 'status'], { cwd: XR_DIR, encoding: 'utf8' });
      if (/"browserCommandReady":\s*true/.test(st)) return;
    } catch {}
    await sleep(2000);
  }
  throw new Error('dev server did not come back');
}

const startedMs = Date.now();
const gw = process.env.THYRA_EXTERNAL_GATEWAY ? null : spawn('node', [`${root}packages/gateway/src/main.ts`], { env: { ...process.env, MODEL_API_KEY: '', THYRA_RUNS_DIR: process.env.THYRA_RUNS_DIR ?? `${root}deployments/runs-e2e` }, stdio: 'ignore' });
try {
  const cfg = JSON.parse(original);
  cfg.dev.emulator.device = 'metaVRGlasses';
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  await sleep(6000);
  await waitReady();
  await captureReady();
  cli('browser', 'reload', {});
  await sleep(3000);
  await waitReady();
  for (let i = 0; i < 15; i++) {
    try {
      cli('xr', 'enter', {});
    } catch {}
    await sleep(1500);
    if (cli<{ sessionActive: boolean }>('xr', 'status').sessionActive) break;
  }
  const st = cli<{ deviceName: string; enabledFeatures: string[] }>('xr', 'status');
  check(`glasses profile active (${st.deviceName}), gaze-tracking granted`, st.deviceName === 'Meta VR Glasses' && st.enabledFeatures.includes('gaze-tracking'), st.enabledFeatures);
  cli('xr', 'set-input-mode', { mode: 'hand' });
  evalPage(`window.__thyra.loadRoom('sunlit_living_room')`, 90000);
  const s = await waitFor((x) => x.walls.length >= 4, 30000, 'walls');
  const back = s.walls.reduce((a, b) => (b.n[2] > a.n[2] ? b : a));
  const fv = (s.floorY ?? 0) - back.origin[1];
  // gaze at the top-left corner, pinch, look to the bottom-right, release
  gazeAt(wallPoint(s, back.id, -0.5, fv + 1.9));
  await sleep(300);
  cli('xr', 'set-select-value', { device: HAND, value: 1 });
  await sleep(300);
  for (let i = 1; i <= 5; i++) {
    gazeAt(wallPoint(s, back.id, -0.5 + i * 0.2, fv + 1.9 - (i / 5) * 1.87));
    await sleep(150);
  }
  cli('xr', 'set-select-value', { device: HAND, value: 0 });
  const s1 = await waitFor((x) => x.portals.length === 1 && x.card !== null, 6000, 'door by gaze');
  check(`gaze + pinch draws a ${s1.portals[0].width.toFixed(2)} × ${s1.portals[0].height.toFixed(2)} m door`, Math.abs(s1.portals[0].width - 1.0) < 0.02);
  // card inside the glasses' view while looking at the door centre
  gazeAt(wallPoint(s, back.id, 0, fv + 1.2));
  await sleep(1500);
  const fov = evalPage<{ h: number; v: number }[]>(`(() => {
    const m = window.__thyraCardCorners();
    return m;
  })()`);
  const worst = fov.reduce<{ h: number; v: number; vmin: number }>((a, c) => ({ h: Math.max(a.h, Math.abs(c.h)), v: Math.max(a.v, c.v), vmin: Math.min(a.vmin, c.v) }), { h: 0, v: -90, vmin: 90 });
  check(`door card inside the glasses view (max |h| ${worst.h.toFixed(1)}°, v ${worst.vmin.toFixed(1)}…${worst.v.toFixed(1)}°)`, worst.h <= 35 && worst.v <= 23 && worst.vmin >= -41, fov);
  mkdirSync(`${XR_DIR}artifacts/e2e`, { recursive: true });
  cli('browser', 'screenshot', {}, ['--output-file', 'artifacts/e2e/glasses-card.png']);
  // gaze at a destination button and pinch
  const target = evalPage<Vec3>(`window.__thyra.cardTarget('dest-the_sky_is_on_fire')`);
  gazeAt(target);
  await sleep(400);
  cli('xr', 'select', { device: HAND, duration: 0.2 });
  const s2 = await waitFor((x) => x.portals[0]?.phase === 'open', 20000, 'open by gaze');
  check('gaze + pinch on the card opens the world', s2.portals[0].phase === 'open');
  await sleep(2500);
  cli('browser', 'screenshot', {}, ['--output-file', 'artifacts/e2e/glasses-open.png']);
  const openSnapshot = snapshot();
  check('sample remains labelled and generation stays Setup required', openSnapshot.portals[0].record.stamp === 'Sample, not generated' && JSON.stringify(openSnapshot.status).includes('MODEL_API_KEY'), openSnapshot);
  gazeAt(evalPage<Vec3>(`window.__thyra.cardTarget('close')`));
  await sleep(300);
  cli('xr', 'select', { device: HAND, duration: 0.2 });
  await waitFor((x) => x.portals.length === 0, 5000, 'closed by gaze');
  cli('xr', 'exit', {});
  await sleep(400);
  cli('xr', 'enter', {});
  await sleep(1000);
  cli('xr', 'set-input-mode', { mode: 'hand' });
  gazeAt(wallPoint(s, back.id, -0.5, fv + 1.9));
  cli('xr', 'set-select-value', { device: HAND, value: 1 });
  gazeAt(wallPoint(s, back.id, 0.5, fv + 0.03));
  cli('xr', 'set-select-value', { device: HAND, value: 0 });
  await waitFor((x) => x.portals.length === 1 && x.card !== null, 6000, 'reentered gaze draw');
  gazeAt(wallPoint(s, back.id, 0, fv + 1.2));
  await sleep(1000);
  const reentry = evalPage<Array<{h:number;v:number}>>('window.__thyraCardCorners()');
  check('glasses close, re-enter and gaze-pinch draw retains card fit', reentry.every((x) => Math.abs(x.h) <= 35 && x.v <= 23 && x.v >= -41), reentry);
  const errors = cli<Array<{ level: string; timestamp: number; message: string }>>('browser', 'logs', { count: 200 }).filter((l) => l.level === 'error' && l.timestamp >= startedMs);
  check(`console: ${errors.length} errors`, errors.length === 0, errors.slice(0, 3).map((e) => e.message.slice(0, 160)));
  void snapshot;
} catch (err) {
  check('glasses scenario completed', false, (err as Error).message);
} finally {
  writeFileSync(cfgPath, original);
  gw?.kill();
}
const passed = checks.filter((c) => c.ok).length;
const outputDir = process.env.THYRA_AUDIT_DIR ?? `${root}deployments/e2e`;
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/${process.env.THYRA_AUDIT_DIR ? 'glasses-checks' : `glasses-${new Date().toISOString().replace(/[:.]/g, '-')}`}.json`, JSON.stringify({ device: 'IWER metaVRGlasses (emulator)', started: new Date(startedMs).toISOString(), finished: new Date().toISOString(), passed, failed: checks.length - passed, checks }, null, 2));
console.log(`${passed}/${checks.length} passed`);
process.exit(passed === checks.length ? 0 : 1);
