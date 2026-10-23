// Builds packages/landing/data/schedule.json from the newest real e2e run file.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = `${root}deployments/e2e/`;
const files = readdirSync(dir).filter((f) => /^\d{4}-.*\.json$/.test(f)).sort();
if (!files.length) throw new Error('No e2e run in deployments/e2e; run npm run e2e first.');
const file = files[files.length - 1];
const run = JSON.parse(readFileSync(dir + file, 'utf8'));
const doors = (run.metrics.doors ?? []) as Array<Record<string, unknown>>;
const rows = doors.map((d) => ({
  tag: d.tag,
  room: `${d.room} · emulator`,
  door: d.door,
  destination: d.destination,
  plan: d.plan,
  image: d.image,
  pano_mode: d.pano_mode,
  to_world: `${((d.to_world_ms as number) / 1000).toFixed(2)} s*`,
  off_plane: `${d.off_plane_mm} mm`,
}));
writeFileSync(
  `${root}packages/landing/data/schedule.json`,
  JSON.stringify(
    {
      source: `deployments/e2e/${file} (IWER emulator; * no key: includes a 0.9 s hold on the room read + sample decode)`,
      passed: run.passed,
      total: run.passed + run.failed,
      rows,
      summary: run.metrics.summary_example ?? null,
      summary_from: 'thyra_studio run, emulator',
    },
    null,
    2,
  ),
);
console.log(`schedule.json: ${rows.length} rows from ${file}`);
