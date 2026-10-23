import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Thin wrapper over the IWSDK CLI (agent mode) used by the emulator e2e. */
export const XR_DIR = fileURLToPath(new URL('../packages/xr/', import.meta.url));
const CLI = `${XR_DIR}node_modules/@iwsdk/cli/dist/cli.js`;

export function cli<T = unknown>(group: string, action: string, input?: unknown, extra: string[] = []): T {
  const args = [CLI, group, action, ...(input !== undefined ? ['--input-json', JSON.stringify(input)] : []), ...extra];
  const out = execFileSync('node', args, { cwd: XR_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180_000 });
  const j = JSON.parse(out) as { ok: boolean; data?: { result?: T }; error?: unknown };
  if (!j.ok) throw new Error(`${group} ${action} failed: ${JSON.stringify(j.error).slice(0, 400)}`);
  return j.data?.result as T;
}

/** Runs packages/xr/e2e/<script>.mjs inside the managed page (Playwright, trusted). */
export function page<T = unknown>(script: string, timeoutMs = 60_000): T {
  const out = execFileSync('node', [CLI, 'browser', 'run', `e2e/${script}`, '--timeout', String(timeoutMs)], {
    cwd: XR_DIR,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs + 30_000,
  });
  const j = JSON.parse(out) as { ok: boolean; data?: { result?: T }; error?: unknown };
  if (!j.ok) throw new Error(`browser run ${script} failed: ${JSON.stringify(j.error).slice(0, 600)}`);
  return j.data?.result as T;
}

/** Evaluates `expr` (a JS expression, may use await) in the app frame. */
export function evalPage<T = unknown>(expr: string, timeoutMs = 60_000): T {
  mkdirSync(`${XR_DIR}e2e/.tmp`, { recursive: true });
  writeFileSync(
    `${XR_DIR}e2e/.tmp/eval.mjs`,
    `export default async function run({ page, frame }) { return await (frame ?? page).evaluate(async () => (${expr})); }\n`,
  );
  return page<T>('.tmp/eval.mjs', timeoutMs);
}

export type Vec3 = [number, number, number];
export const P = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function snapshot(): Snapshot {
  return page<Snapshot>('snap.mjs');
}

export interface Snapshot {
  session: boolean;
  walls: Array<{ id: string; label: string | null; origin: Vec3; n: Vec3; bounds: { u0: number; u1: number; v0: number; v1: number } }>;
  floorY: number | null;
  ceilingY: number | null;
  floorArea: number | null;
  objects: Array<{ label: string; center: Vec3; dims: Vec3 }>;
  labelsSeen: string[];
  head: Vec3;
  drawing: boolean;
  hint: string | null;
  card: { view: string; regions: string[] } | null;
  status: unknown;
  portals: Array<{
    tag: string;
    phase: string;
    planeId: string;
    rect: { u0: number; u1: number; v0: number; v1: number };
    width: number;
    height: number;
    corners: Vec3[];
    step: string;
    flood: number;
    summary: unknown;
    record: Record<string, unknown>;
  }>;
}
