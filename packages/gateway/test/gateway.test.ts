import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config.ts';
import { createGateway, type Gateway } from '../src/server.ts';
import { imageSize } from '../src/imagesize.ts';
import { panoPrompt, validate } from '../src/schema.ts';
import { readFileSync } from 'node:fs';

const room = {
  portal: { w_m: 1.2, h_m: 2.05, bottom_m: 0, wall: { label: 'wall', w_m: 5, h_m: 2.7 } },
  viewer: { eye_height_m: 1.62, distance_to_portal_m: 1.5 },
  room: { ceiling_m: 2.7, floor_area_m2: 29, objects: [{ label: 'couch', dims_m: [2, 0.8, 0.9], side: 'left', distance_m: 1.6 }] },
  light: { available: false },
  local_time: '19:40',
  destination_text: 'a flooded cathedral at dawn',
};

const validPlan = {
  title: 'Flooded nave',
  pano_prompt: 'a gothic cathedral nave flooded with still water at dawn',
  camera_height_m: 1.62,
  horizon: 'eye-level',
  ground: { kind: 'water', material: 'still water over stone' },
  time_of_day: 'dawn',
  palette: ['#c8d4e0', '#6b7c8f', '#f2c48d'],
  frame_trim: { style: 'carved stone', hex: '#d9d2c3' },
  ambient_spill: { hex: '#f2c48d', intensity: 0.4 },
  rationale: '2.05 m tall in a 2.7 m room → a nave at your eye height',
};

async function start(env: Record<string, string>): Promise<{ gw: Gateway; base: string; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'thyra-gw-'));
  const gw = createGateway(configFromEnv({ THYRA_RUNS_DIR: dir, THYRA_GATEWAY_PORT: '0', ...env }));
  await new Promise<void>((r) => gw.server.listen(0, '127.0.0.1', r));
  const { port } = gw.server.address() as AddressInfo;
  return { gw, base: `http://127.0.0.1:${port}`, dir };
}

const post = (base: string, path: string, body: unknown, method = 'POST') =>
  fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('gateway without MODEL_API_KEY (the honest no-key path)', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    ctx = await start({});
  });
  afterAll(() => {
    ctx.gw.server.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('reports every Meta model as Setup required', async () => {
    const s = await (await fetch(`${ctx.base}/api/status`)).json();
    for (const k of ['spark', 'wonder', 'image', 'transcribe', 'sam3']) {
      expect(s[k].ready).toBe(false);
      expect(s[k].setup).toBe('MODEL_API_KEY');
    }
    expect(s.spark.model).toBe('muse-spark-1.3');
    expect(s.image.model).toBe('muse-image-1.0');
    expect(s.key_loaded).toBe(false);
    expect(s.budget).toEqual({ spent_usd_today: 0, cap_usd: 5 });
  });

  it('answers plan, panorama and transcribe with 503 setup_required, never a canned result', async () => {
    for (const [path, body] of [
      ['/api/plan', { room, destination: 'x' }],
      ['/api/panorama', { run_id: 'x' }],
    ] as const) {
      const res = await post(ctx.base, path, body);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: 'setup_required', setup_required: 'MODEL_API_KEY' });
    }
    const t = await fetch(`${ctx.base}/api/transcribe`, { method: 'POST', body: new Uint8Array(64) });
    expect(t.status).toBe(503);
  });

  it('records a no-key run stamped "not generated", accepts pano checks, and deletes it', async () => {
    const created = await post(ctx.base, '/api/runs', { room, destination: 'misty forest', source: 'cc0-sample', sample_id: 'misty_pines' });
    expect(created.status).toBe(201);
    const run = await created.json();
    expect(run.image).toMatchObject({ source: 'cc0-sample', stamp: 'Sample, not generated', model: null });
    const patched = await (await post(ctx.base, `/api/runs/${run.id}`, { pano: { pano_mode: 'equirect', seam_delta_e: 1.2 }, timings: { first_pixel_ms: 840, bogus: 'x' }, width: 4096, height: 2048 }, 'PATCH')).json();
    expect(patched.pano.pano_mode).toBe('equirect');
    expect(patched.timings).toEqual({ first_pixel_ms: 840 });
    expect(patched.image.width).toBe(4096);
    const list = await (await fetch(`${ctx.base}/api/runs`)).json();
    expect(list.runs.map((r: { id: string }) => r.id)).toContain(run.id);
    expect((await fetch(`${ctx.base}/api/runs/${run.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(`${ctx.base}/api/runs/${run.id}`)).status).toBe(404);
  });

  it('rejects bad input with readable errors', async () => {
    const bad = await fetch(`${ctx.base}/api/runs`, { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('bad_json');
    const src = await post(ctx.base, '/api/runs', { room, destination: 'x', source: 'muse-image-1.0' });
    expect(src.status).toBe(400);
    const noRoom = await post(ctx.base, '/api/runs', { destination: 'x', source: 'user-upload' });
    expect((await noRoom.json()).error).toBe('bad_room');
    expect((await fetch(`${ctx.base}/api/nope`)).status).toBe(404);
  });
});

describe('gateway with a key (live calls to api.meta.ai)', () => {
  const FAKE = 'thyra-test-not-a-real-key-7d1f2c';
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    ctx = await start({ MODEL_API_KEY: FAKE, THYRA_RATE_LIMIT_PER_MIN: '3' });
  });
  afterAll(() => {
    ctx.gw.server.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('turns the real 401 for an invalid key into a readable error that never echoes the key', async () => {
    const res = await post(ctx.base, '/api/plan', { room, destination: 'a flooded cathedral at dawn' });
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain(FAKE);
    const body = JSON.parse(text);
    expect(body).toMatchObject({ error: 'meta_error', meta_status: 401, code: 'invalid_api_key' });
    expect(typeof body.request_id).toBe('string');
    // the failed attempt is in the run record, without the key
    const runs = await (await fetch(`${ctx.base}/api/runs`)).text();
    expect(runs).toContain('invalid_api_key');
    expect(runs).not.toContain(FAKE);
  });

  it('rate-limits paid routes per client', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await post(ctx.base, '/api/plan', { room: {}, destination: '' })).status);
    expect(codes.at(-1)).toBe(429);
  });

  it('refuses paid calls once the daily cap is spent (no network call)', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const capped = await start({ MODEL_API_KEY: FAKE, THYRA_DAILY_CAP_USD: '0.5' });
    writeFileSync(join(capped.dir, `budget-${day}.json`), JSON.stringify({ spent_usd: 0.5 }));
    const res = await post(capped.base, '/api/plan', { room, destination: 'x' });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('budget_exceeded');
    capped.gw.server.close();
    rmSync(capped.dir, { recursive: true, force: true });
  });
});

describe('compose_portal schema', () => {
  it('accepts a complete plan', () => {
    expect(validate(validPlan)).toEqual([]);
  });
  it('rejects unknown fields, bad hex, wrong palette size and missing fields', () => {
    expect(validate({ ...validPlan, mood: 'x' })).toContain('$.mood: unknown field');
    expect(validate({ ...validPlan, frame_trim: { style: 'x', hex: 'red' } })).toContain('$.frame_trim.hex: bad format');
    expect(validate({ ...validPlan, palette: ['#000000'] })).toContain('$.palette: too few items');
    const { rationale: _r, ...missing } = validPlan;
    expect(validate(missing)).toContain('$.rationale: required');
    expect(validate({ ...validPlan, ambient_spill: { hex: '#ffffff', intensity: 3 } })).toContain('$.ambient_spill.intensity: above 1');
  });
  it('always appends the panorama contract to the prompt', () => {
    const p = panoPrompt(validPlan);
    expect(p).toContain('equirectangular 360° panorama, 2:1, horizon exactly at the vertical centre, camera at 1.62 m, seamless left and right edges');
  });
});

describe('imageSize', () => {
  it('reads W×H from the committed sample JPEG header', () => {
    const buf = new Uint8Array(readFileSync(new URL('../../xr/public/panoramas/misty_pines.jpg', import.meta.url)));
    expect(imageSize(buf)).toEqual({ width: 4096, height: 2048, format: 'jpeg' });
  });
});
