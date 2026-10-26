/**
 * Emulator clips (test recordings, not the demo video): CDP screencast of the
 * managed IWER page while a hands-only choreography runs. Output:
 * grokbot/videos/thyra/<name>.mp4. Same prerequisites as e2e/run.ts.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { cli, evalPage, sleep, snapshot, XR_DIR, type Vec3 } from './iwsdk.ts';
import { enterSession, HAND, pressCard, waitFor, wallPoint } from './scenario.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const VIDEOS = process.env.THYRA_VIDEO_DIR ?? fileURLToPath(new URL('../../../videos/thyra/', import.meta.url));

function quatLookAt(from: Vec3, to: Vec3): { x: number; y: number; z: number; w: number } {
  // rotation whose -Z axis points from `from` to `to`, +Y kept up
  const f = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const l = Math.hypot(...f);
  const z = [-f[0] / l, -f[1] / l, -f[2] / l];
  let x = [z[2], 0, -z[0]]; // up × z with up = (0,1,0)
  const xl = Math.hypot(...x) || 1;
  x = x.map((v) => v / xl);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = { w: 0.25 / s, x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s };
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
  }
  return q;
}

const handPos = (): Vec3 => {
  const t = cli<{ position: { x: number; y: number; z: number } }>('xr', 'get-transform', { device: HAND });
  return [t.position.x, t.position.y, t.position.z];
};
const sweep = (to: Vec3, seconds: number) =>
  cli('xr', 'animate-to', { device: HAND, orientation: quatLookAt(handPos(), to), duration: seconds, easing: 'minimum-jerk' });
const head = (pos: Vec3 | null, look: Vec3 | null, seconds: number) => {
  const args: Record<string, unknown> = { device: 'headset', duration: seconds, easing: 'minimum-jerk' };
  if (pos) args.position = { x: pos[0], y: pos[1], z: pos[2] };
  if (look) args.orientation = quatLookAt(pos ?? [0, 1.6, 0], look);
  cli('xr', 'animate-to', args);
};

/** Connects to the managed Chromium's loopback CDP endpoint directly, so recording never blocks the CLI queue. */
async function cdpPage() {
  const st = execFileSync('node', [`${XR_DIR}node_modules/@iwsdk/cli/dist/cli.js`, 'dev', 'status'], { cwd: XR_DIR, encoding: 'utf8' });
  const ep = st.match(/"browserAutomation":\s*\{[^}]*?"endpoint":\s*"([^"]+)"/)?.[1];
  if (!ep) throw new Error('start the dev server with --allow-browser-automation');
  const require = createRequire(`${XR_DIR}package.json`);
  const { chromium } = require('playwright') as { chromium: { connectOverCDP(u: string): Promise<CdpBrowser> } };
  const browser = await chromium.connectOverCDP(ep);
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('https://localhost:8443'));
  if (!page) throw new Error('app page not found over CDP');
  return { browser, page };
}
type CdpSession = { on(e: string, f: (x: { data: string; sessionId: number; metadata: { timestamp: number } }) => void): void; send(m: string, p?: object): Promise<unknown>; detach(): Promise<void> };
type CdpPage = { url(): string; context(): { newCDPSession(p: CdpPage): Promise<CdpSession> } };
type CdpBrowser = { contexts(): Array<{ pages(): CdpPage[] }>; close(): Promise<void> };

async function record(name: string, seconds: number, choreography: () => Promise<void>) {
  const dir = `${XR_DIR}artifacts/rec/${name}`;
  mkdirSync(dir, { recursive: true });
  const { browser, page } = await cdpPage();
  const cdp = await page.context().newCDPSession(page);
  const ts: number[] = [];
  cdp.on('Page.screencastFrame', (f) => {
    writeFileSync(`${dir}/f${String(ts.length).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64'));
    ts.push(f.metadata.timestamp);
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  const t0 = Date.now();
  try {
    await choreography();
    const left = seconds * 1000 - (Date.now() - t0);
    if (left > 0) await sleep(left);
  } finally {
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.detach().catch(() => {});
    await browser.close().catch(() => {}); // disconnects only; the managed browser keeps running
  }
  if (ts.length < 10) throw new Error(`only ${ts.length} frames captured for ${name}`);
  // concat list with real frame durations (the screencast is variable-rate)
  const lines: string[] = [];
  ts.forEach((t, i) => {
    lines.push(`file 'f${String(i).padStart(5, '0')}.jpg'`);
    lines.push(`duration ${Math.max(0.001, (ts[i + 1] ?? t + 1 / 30) - t).toFixed(4)}`);
  });
  writeFileSync(`${dir}/list.txt`, lines.join('\n'));
  mkdirSync(VIDEOS, { recursive: true });
  const out = `${VIDEOS}${name}.mp4`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`, '-vf', 'fps=30,crop=iw:ih-28:0:28,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', out]);
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim();
  rmSync(dir, { recursive: true, force: true });
  console.log(`${name}: ${ts.length} frames, ${Number(dur).toFixed(1)} s → ${out}`);
}

const gw = process.env.THYRA_EXTERNAL_GATEWAY ? null : spawn('node', [`${root}packages/gateway/src/main.ts`], { env: { ...process.env, MODEL_API_KEY: '', THYRA_RUNS_DIR: process.env.THYRA_RUNS_DIR ?? `${root}deployments/runs-e2e` }, stdio: 'ignore' });
try {
  try {
    cli('xr', 'exit', {});
  } catch {}
  evalPage(`(location.search = '', true)`);
  await sleep(3500);
  await enterSession();
  evalPage(`window.__thyra.loadRoom('sunlit_living_room')`, 90000);
  let s = await waitFor((x) => x.walls.length >= 4, 30000, 'walls');
  cli('xr', 'set-device-state', {});
  cli('xr', 'set-input-mode', { mode: 'hand' });
  const back = s.walls.reduce((a, b) => (b.n[2] > a.n[2] ? b : a));
  const fv = (s.floorY ?? 0) - back.origin[1];
  const which = process.argv.slice(2);
  const want = (n: string) => which.length === 0 || which.includes(n);

  if (want('thyra-01-tear-open')) {
    head([0.15, 1.6, -1.25], [0, 1.35, -3.4], 0.1);
    await sleep(600);
    await record('thyra-01-tear-open', 32, async () => {
      cli('xr', 'look-at', { device: HAND, target: (([x, y, z]) => ({ x, y, z }))(wallPoint(s, back.id, -1.4, fv + 1.0)) });
      await sleep(2500);
      sweep(wallPoint(s, back.id, -0.8, fv + 2.3), 1.2);
      await sleep(1500);
      cli('xr', 'set-select-value', { device: HAND, value: 1, duration: 0.15 });
      await sleep(400);
      sweep(wallPoint(s, back.id, 0.8, fv + 0.02), 2.4);
      await sleep(2800);
      cli('xr', 'set-select-value', { device: HAND, value: 0, duration: 0.15 });
      await sleep(2200);
      await pressCard('dest-misty_pines');
      await waitFor((x) => x.portals[0]?.phase === 'open', 20000, 'open');
      await sleep(3200);
      head([0.75, 1.6, -1.0], [0, 1.25, -3.4], 3.5);
      await sleep(3700);
      head([-0.6, 1.65, -1.3], [0, 1.3, -3.4], 4);
      await sleep(4200);
    });
  }
  s = snapshot();
  if (want('thyra-02-parallax') && s.portals.length) {
    await record('thyra-02-parallax', 24, async () => {
      head([0, 1.6, -1.2], [0, 1.25, -3.4], 1.5);
      await sleep(1800);
      head([1.5, 1.6, -1.6], [0, 1.2, -3.4], 4);
      await sleep(4300);
      head([-1.5, 1.6, -1.6], [0, 1.2, -3.4], 6);
      await sleep(6300);
      head([0, 1.7, -2.5], [0, 1.25, -3.4], 4);
      await sleep(4300);
      head([0.2, 1.35, -2.6], [0, 1.6, -3.4], 3);
      await sleep(3200);
    });
  }
  if (want('thyra-03-step-in') && snapshot().portals.length) {
    await record('thyra-03-step-in', 32, async () => {
      head([0, 1.6, -1.2], [0, 1.4, -3.4], 2);
      await sleep(2200);
      head([0, 1.6, -3.18], [0, 1.4, -5], 3);
      await waitFor((x) => x.portals[0]?.step === 'inside', 9000, 'inside');
      await sleep(2500);
      head([0, 1.6, -3.18], [-3, 1.5, -3.4], 3);
      await sleep(3200);
      head([0, 1.6, -3.18], [0, 1.4, 1], 4);
      await sleep(4500);
      head([0, 1.6, -3.18], [3, 1.2, -3.4], 4);
      await sleep(4200);
      head([0, 1.6, -2.3], [0, 1.4, -3.4], 2.5);
      await waitFor((x) => x.portals[0]?.step === 'room', 9000, 'room');
      await sleep(2500);
    });
  }
  if (want('thyra-04-three-doors')) {
    if (!snapshot().portals.length) throw new Error('clip 4 expects the door from clip 1');
    cli('xr', 'set-device-state', {});
    cli('xr', 'set-input-mode', { mode: 'hand' });
    s = snapshot();
    const right = s.walls.reduce((a, b) => (b.n[0] < a.n[0] ? b : a));
    const left = s.walls.reduce((a, b) => (b.n[0] > a.n[0] ? b : a));
    await record('thyra-04-three-doors', 38, async () => {
      for (const [wall, u0, u1, top, dest, look] of [
        [right, -1.95, -1.0, 2.15, 'dest-satara_night', [2.5, 1.3, -1.6]],
        [left, -1.25, -2.15, 2.2, 'dest-the_sky_is_on_fire', [-2.5, 1.3, 1.2]],
      ] as const) {
        head([0, 1.6, 0], look as Vec3, 2.2);
        await sleep(2400);
        const w = wall as (typeof s.walls)[number];
        const f = (s.floorY ?? 0) - w.origin[1];
        cli('xr', 'look-at', { device: HAND, target: (([x, y, z]) => ({ x, y, z }))(wallPoint(s, w.id, u0 as number, f + (top as number))) });
        await sleep(500);
        cli('xr', 'set-select-value', { device: HAND, value: 1, duration: 0.15 });
        await sleep(300);
        sweep(wallPoint(s, w.id, u1 as number, f + 0.02), 1.8);
        await sleep(2100);
        cli('xr', 'set-select-value', { device: HAND, value: 0, duration: 0.15 });
        await sleep(1500);
        await pressCard(dest as string);
        await sleep(3800);
      }
      head([0.3, 1.6, -0.2], [-2.5, 1.3, 0.6], 2);
      await sleep(2100);
      head([0.3, 1.6, -0.2], [0, 1.3, -3.4], 3);
      await sleep(3100);
      head([0.3, 1.6, -0.2], [2.5, 1.3, -1.8], 3);
      await sleep(3100);
    });
  }
} finally {
  gw?.kill();
}
