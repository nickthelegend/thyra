/**
 * Emulator clips (test recordings, not the demo video): CDP screencast of the
 * managed IWER page while a hands-only choreography runs. Output:
 * grokbot/videos/thyra/<name>.mp4. Same prerequisites as e2e/run.ts.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cli, evalPage, sleep, snapshot, XR_DIR, type Vec3 } from './iwsdk.ts';
import { enterSession, HAND, pressCard, waitFor, wallPoint } from './scenario.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const VIDEOS = fileURLToPath(new URL('../../../videos/thyra/', import.meta.url));
const CLI = `${XR_DIR}node_modules/@iwsdk/cli/dist/cli.js`;

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

async function record(name: string, seconds: number, choreography: () => Promise<void>) {
  mkdirSync(`${XR_DIR}e2e/.tmp`, { recursive: true });
  writeFileSync(`${XR_DIR}e2e/.tmp/rec.json`, JSON.stringify({ name, seconds }));
  const rec = spawn('node', [CLI, 'browser', 'run', 'e2e/screencast.mjs', '--timeout', String((seconds + 30) * 1000)], { cwd: XR_DIR, stdio: 'ignore' });
  const done = new Promise((r) => rec.on('exit', r));
  await sleep(1200);
  const t0 = Date.now();
  await choreography();
  const left = seconds * 1000 - (Date.now() - t0) - 1200;
  if (left > 0) await sleep(left);
  await done;
  const dir = `${XR_DIR}artifacts/rec/${name}`;
  const ts = JSON.parse(readFileSync(`${dir}/frames.json`, 'utf8')) as number[];
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
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`, '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', out]);
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim();
  rmSync(dir, { recursive: true, force: true });
  console.log(`${name}: ${ts.length} frames, ${Number(dur).toFixed(1)} s → ${out}`);
}

const gw = spawn('node', [`${root}packages/gateway/src/main.ts`], { env: { ...process.env, MODEL_API_KEY: '', THYRA_RUNS_DIR: `${root}deployments/runs-e2e` }, stdio: 'ignore' });
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
    await record('thyra-01-tear-open', 30, async () => {
      cli('xr', 'look-at', { device: HAND, target: (([x, y, z]) => ({ x, y, z }))(wallPoint(s, back.id, -1.6, fv + 1.2)) });
      await sleep(2500);
      sweep(wallPoint(s, back.id, -0.75, fv + 2.25), 1.2);
      await sleep(1600);
      cli('xr', 'set-select-value', { device: HAND, value: 1, duration: 0.15 });
      await sleep(400);
      sweep(wallPoint(s, back.id, 0.75, fv + 0.02), 2.2);
      await sleep(2600);
      cli('xr', 'set-select-value', { device: HAND, value: 0, duration: 0.15 });
      await sleep(2200);
      await pressCard('dest-misty_pines');
      await waitFor((x) => x.portals[0]?.phase === 'open', 20000, 'open');
      await sleep(3000);
      head([0.5, 1.6, -0.3], [0, 1.2, -3.4], 3);
      await sleep(3200);
      head([-0.5, 1.6, -0.6], [0, 1.2, -3.4], 3.5);
      await sleep(3600);
    });
  }
  s = snapshot();
  if (want('thyra-02-parallax') && s.portals.length) {
    await record('thyra-02-parallax', 24, async () => {
      head([0, 1.6, 0], [0, 1.25, -3.4], 1.5);
      await sleep(1800);
      head([1.6, 1.6, -1.0], [0, 1.15, -3.4], 4);
      await sleep(4300);
      head([-1.6, 1.6, -1.0], [0, 1.15, -3.4], 6);
      await sleep(6300);
      head([0, 1.75, -2.2], [0, 1.2, -3.4], 4);
      await sleep(4300);
      head([0, 1.3, -2.4], [0, 1.6, -3.4], 3);
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
    cli('xr', 'set-device-state', {});
    cli('xr', 'set-input-mode', { mode: 'hand' });
    s = snapshot();
    const right = s.walls.reduce((a, b) => (b.n[0] < a.n[0] ? b : a));
    const left = s.walls.reduce((a, b) => (b.n[0] > a.n[0] ? b : a));
    await record('thyra-04-three-doors', 34, async () => {
      for (const [wall, u0, u1, top, dest, look] of [
        [right, -1.75, -0.85, 2.15, 'dest-satara_night', [2.5, 1.3, -1.3]],
        [left, 0.6, 1.6, 2.2, 'dest-the_sky_is_on_fire', [-2.5, 1.3, -0.9]],
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
        await sleep(4500);
      }
      head([0, 1.6, 0.4], [-2.5, 1.3, -1.2], 3);
      await sleep(3200);
      head([0, 1.6, 0.4], [2.5, 1.3, -1.4], 6);
      await sleep(6200);
    });
  }
} finally {
  gw.kill();
}
