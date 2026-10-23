import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type ImageSource = 'muse-image-1.0' | 'user-upload' | 'cc0-sample';

export interface RunRecord {
  id: string;
  created_at: string;
  destination: string;
  room: unknown;
  plan: null | {
    model: string;
    request_id: string | null;
    latency_ms: number;
    usage: { input_tokens: number; output_tokens: number } | null;
    result: unknown;
  };
  image: null | {
    source: ImageSource;
    /** Shown on the frame and in the record whenever the image was not generated. */
    stamp: string | null;
    model: string | null;
    request_id: string | null;
    latency_ms: number | null;
    width: number | null;
    height: number | null;
    format: string | null;
    file: string | null;
    sample_id: string | null;
    web_tools: false;
  };
  transcript: null | { text: string; model: string; latency_ms: number; request_id: string | null };
  /** Filled by the client after it checks the decoded image (packages/pano). */
  pano: null | Record<string, unknown>;
  /** Client timings (ms): pinch release → plan, image, first pixel. */
  timings: null | Record<string, number>;
  cost_usd: number;
  errors: Array<{ step: string; code: string; message: string; request_id: string | null }>;
}

const ID = /^[0-9a-f-]{36}$/;

export class RunStore {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }
  create(partial: Pick<RunRecord, 'destination' | 'room'>): RunRecord {
    const run: RunRecord = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      destination: partial.destination,
      room: partial.room,
      plan: null,
      image: null,
      transcript: null,
      pano: null,
      timings: null,
      cost_usd: 0,
      errors: [],
    };
    this.save(run);
    return run;
  }
  save(run: RunRecord): void {
    writeFileSync(join(this.dir, `${run.id}.json`), JSON.stringify(run, null, 2));
  }
  get(id: string): RunRecord | null {
    if (!ID.test(id)) return null;
    const p = join(this.dir, `${id}.json`);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as RunRecord;
  }
  list(): RunRecord[] {
    return readdirSync(this.dir)
      .filter((f) => /^[0-9a-f-]{36}\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as RunRecord)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  imagePath(id: string, ext: string): string {
    return join(this.dir, `${id}.${ext}`);
  }
  delete(id: string): boolean {
    const run = this.get(id);
    if (!run) return false;
    if (run.image?.file) rmSync(join(this.dir, run.image.file), { force: true });
    rmSync(join(this.dir, `${id}.json`), { force: true });
    return true;
  }
}
