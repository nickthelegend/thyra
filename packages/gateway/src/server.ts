import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODELS, PRICES, type GatewayConfig } from './config.ts';
import { imageSize } from './imagesize.ts';
import { Budget, RateLimiter } from './limits.ts';
import { MetaClient, MetaError, redact } from './meta.ts';
import { composeRequest } from './prompt.ts';
import { RunStore, type ImageSource, type RunRecord } from './runs.ts';
import { panoPrompt, validate, validateRoom, type PortalPlan } from './schema.ts';

class HttpError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? status));
    this.status = status;
    this.body = body;
  }
}

const SETUP = { error: 'setup_required', setup_required: 'MODEL_API_KEY', message: 'Setup required: MODEL_API_KEY is not set on the gateway.' };
const MAX_JSON = 64 * 1024;
const MAX_UPLOAD = 15 * 1024 * 1024;
const MAX_AUDIO = 32 * 1024 * 1024;

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, { error: 'too_large', limit_bytes: limit });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await readBody(req, MAX_JSON);
  try {
    const v = JSON.parse(buf.toString('utf8')) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, { error: 'bad_json', message: 'Body must be a JSON object.' });
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

export interface Gateway {
  server: Server;
  store: RunStore;
  budget: Budget;
}

export function createGateway(config: GatewayConfig): Gateway {
  const store = new RunStore(config.runsDir);
  const budget = new Budget(config.runsDir, config.dailyCapUsd);
  const limiter = new RateLimiter(config.rateLimitPerMinute);
  const meta = config.apiKey ? new MetaClient(config.apiKey, config.apiBase) : null;

  const modelStatus = (model: string) =>
    meta ? { ready: true, model } : { ready: false, model, setup: 'MODEL_API_KEY' };

  function status() {
    return {
      service: 'thyra-gateway',
      spark: modelStatus(MODELS.spark),
      wonder: modelStatus(MODELS.wonder),
      image: modelStatus(MODELS.image),
      transcribe: modelStatus(MODELS.transcribe),
      sam3: { ready: false, model: MODELS.sam3, setup: meta ? 'not built: phone mode' : 'MODEL_API_KEY' },
      budget: { spent_usd_today: budget.spentToday(), cap_usd: budget.capUsd },
      key_loaded: Boolean(meta),
    };
  }

  /** Paid routes: key present, under the per-IP limit and the daily cap. */
  function guardPaid(req: IncomingMessage): MetaClient {
    if (!meta) throw new HttpError(503, SETUP);
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (!limiter.allow(ip)) throw new HttpError(429, { error: 'rate_limited', message: `More than ${config.rateLimitPerMinute} requests a minute from this address.` });
    if (budget.exhausted()) throw new HttpError(429, { error: 'budget_exceeded', message: `Daily cap of $${budget.capUsd} reached.`, cap_usd: budget.capUsd });
    return meta;
  }

  function metaFail(run: RunRecord | null, step: string, err: unknown): never {
    if (err instanceof MetaError) {
      if (run) {
        run.errors.push({ step, code: err.code, message: err.message, request_id: err.requestId });
        store.save(run);
      }
      const policy = err.code === 'content_policy_violation';
      throw new HttpError(policy ? 422 : err.status === 401 || err.status === 403 ? 502 : err.status >= 500 ? 502 : err.status, {
        error: policy ? 'content_policy_violation' : 'meta_error',
        meta_status: err.status,
        code: err.code,
        message: policy ? 'Muse Image declined this prompt (content policy). Try another destination.' : err.message,
        request_id: err.requestId,
      });
    }
    throw err;
  }

  async function plan(req: IncomingMessage) {
    const client = guardPaid(req);
    const body = await readJson(req);
    const destination = typeof body.destination === 'string' ? body.destination.trim().slice(0, 300) : '';
    if (!destination) throw new HttpError(400, { error: 'bad_request', message: 'destination is required' });
    const roomErrs = validateRoom(body.room);
    if (roomErrs.length) throw new HttpError(400, { error: 'bad_room', details: roomErrs });
    const model = body.model === MODELS.wonder ? MODELS.wonder : MODELS.spark;
    const run = store.create({ destination, room: body.room });
    type Completion = {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    let call;
    try {
      call = await client.request<Completion>('/chat/completions', { json: composeRequest(model, body.room) });
    } catch (err) {
      metaFail(run, 'plan', err);
    }
    const usage = call.body.usage
      ? { input_tokens: call.body.usage.prompt_tokens ?? 0, output_tokens: call.body.usage.completion_tokens ?? 0 }
      : null;
    const price = PRICES[model];
    const cost = usage ? usage.input_tokens * price.in + usage.output_tokens * price.out : 0;
    budget.add(cost);
    run.cost_usd += cost;
    const tc = call.body.choices?.[0]?.message?.tool_calls?.[0]?.function;
    let parsed: unknown = null;
    let errors: string[] = [];
    if (!tc || tc.name !== 'compose_portal' || typeof tc.arguments !== 'string') errors = ['no compose_portal tool call in the response'];
    else {
      try {
        parsed = JSON.parse(tc.arguments);
        errors = validate(parsed);
      } catch {
        errors = ['tool arguments are not JSON'];
      }
    }
    run.plan = { model, request_id: call.requestId, latency_ms: call.latencyMs, usage, result: parsed };
    if (errors.length) {
      run.errors.push({ step: 'plan', code: 'schema', message: errors.join('; '), request_id: call.requestId });
      store.save(run);
      throw new HttpError(502, { error: 'plan_schema', details: errors, run_id: run.id, request_id: call.requestId });
    }
    store.save(run);
    const p = parsed as PortalPlan;
    if (p.refuse) throw new HttpError(422, { refused: true, reason: p.refuse.reason, run_id: run.id });
    return { run_id: run.id, model, plan: p, latency_ms: call.latencyMs, usage, request_id: call.requestId };
  }

  async function panorama(req: IncomingMessage) {
    const client = guardPaid(req);
    const body = await readJson(req);
    const run = typeof body.run_id === 'string' ? store.get(body.run_id) : null;
    if (!run) throw new HttpError(404, { error: 'no_such_run' });
    const p = run.plan?.result as PortalPlan | undefined;
    if (!p || validate(p).length) throw new HttpError(409, { error: 'no_valid_plan', message: 'Plan the portal first.' });
    type Images = { data?: Array<{ b64_json?: string }> };
    let call;
    try {
      call = await client.request<Images>('/images/generations', {
        json: {
          model: MODELS.image,
          prompt: panoPrompt(p),
          size: '2048x1024', // aspect hint per docs; returned pixels may differ
          n: 1,
          response_format: 'b64_json',
          output_format: 'jpeg',
        },
      });
    } catch (err) {
      metaFail(run, 'image', err);
    }
    const b64 = call.body.data?.[0]?.b64_json;
    if (!b64) {
      run.errors.push({ step: 'image', code: 'no_image', message: 'response had no data[0].b64_json', request_id: call.requestId });
      store.save(run);
      throw new HttpError(502, { error: 'no_image', request_id: call.requestId });
    }
    budget.add(PRICES.image);
    run.cost_usd += PRICES.image;
    const bytes = Buffer.from(b64, 'base64');
    const size = imageSize(bytes);
    const ext = size?.format === 'png' ? 'png' : size?.format === 'webp' ? 'webp' : 'jpg';
    const file = `${run.id}.${ext}`;
    writeFileSync(join(store.dir, file), bytes);
    run.image = {
      source: 'muse-image-1.0',
      stamp: null,
      model: MODELS.image,
      request_id: call.requestId,
      latency_ms: call.latencyMs,
      width: size?.width ?? null,
      height: size?.height ?? null,
      format: size?.format ?? null,
      file,
      sample_id: null,
      web_tools: false,
    };
    store.save(run);
    return { run_id: run.id, image_url: `/api/runs/${run.id}/image`, width: run.image.width, height: run.image.height, source: 'muse-image-1.0', latency_ms: call.latencyMs, request_id: call.requestId };
  }

  async function transcribe(req: IncomingMessage) {
    const client = guardPaid(req);
    const audio = await readBody(req, MAX_AUDIO);
    if (audio.length < 44 || audio.subarray(0, 4).toString('latin1') !== 'RIFF')
      throw new HttpError(400, { error: 'bad_audio', message: 'Send WAV (mono 16-bit PCM, 16 or 24 kHz).' });
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'speech.wav'); // UNVERIFIED field name
    form.append('model', MODELS.transcribe);
    let call;
    try {
      call = await client.request<{ text?: string }>('/asr/transcribe', { form });
    } catch (err) {
      metaFail(null, 'transcribe', err);
    }
    const seconds = Math.max(0, (audio.length - 44) / (2 * (audio.readUInt32LE(24) || 16000)));
    budget.add(seconds * PRICES.transcribePerSecond);
    return { text: call.body.text ?? '', model: MODELS.transcribe, latency_ms: call.latencyMs, request_id: call.requestId };
  }

  /** A no-key run (sample or upload): still recorded, and stamped as not generated. */
  async function createRun(req: IncomingMessage) {
    const body = await readJson(req);
    const destination = typeof body.destination === 'string' ? body.destination.slice(0, 300) : '';
    const source = body.source as ImageSource;
    if (source !== 'cc0-sample' && source !== 'user-upload') throw new HttpError(400, { error: 'bad_source', message: "source must be 'cc0-sample' or 'user-upload'" });
    const roomErrs = validateRoom(body.room);
    if (roomErrs.length) throw new HttpError(400, { error: 'bad_room', details: roomErrs });
    const run = store.create({ destination, room: body.room });
    run.image = {
      source,
      stamp: source === 'cc0-sample' ? 'Sample, not generated' : 'Your image, not generated',
      model: null,
      request_id: null,
      latency_ms: null,
      width: null,
      height: null,
      format: null,
      file: null,
      sample_id: typeof body.sample_id === 'string' ? body.sample_id.slice(0, 64) : null,
      web_tools: false,
    };
    store.save(run);
    return run;
  }

  async function patchRun(req: IncomingMessage, id: string) {
    const run = store.get(id);
    if (!run) throw new HttpError(404, { error: 'no_such_run' });
    const body = await readJson(req);
    if (body.pano && typeof body.pano === 'object') run.pano = body.pano as Record<string, unknown>;
    if (body.timings && typeof body.timings === 'object') {
      const t: Record<string, number> = {};
      for (const [k, v] of Object.entries(body.timings as Record<string, unknown>)) if (typeof v === 'number') t[k] = v;
      run.timings = t;
    }
    if (run.image && typeof body.width === 'number' && typeof body.height === 'number') {
      run.image.width ??= body.width;
      run.image.height ??= body.height;
    }
    store.save(run);
    return run;
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://gateway');
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const path = url.pathname;
    const m = path.match(/^\/api\/runs\/([0-9a-f-]{36})(\/image)?$/);
    if (req.method === 'GET' && path === '/api/status') return send(res, 200, status());
    if (req.method === 'POST' && path === '/api/plan') return send(res, 200, await plan(req));
    if (req.method === 'POST' && path === '/api/panorama') return send(res, 200, await panorama(req));
    if (req.method === 'POST' && path === '/api/transcribe') return send(res, 200, await transcribe(req));
    if (req.method === 'POST' && path === '/api/runs') return send(res, 201, await createRun(req));
    if (req.method === 'GET' && path === '/api/runs') return send(res, 200, { runs: store.list() });
    if (m) {
      const id = m[1];
      if (m[2]) {
        const run = store.get(id);
        if (req.method !== 'GET' || !run?.image?.file) throw new HttpError(404, { error: 'no_image' });
        const data = readFileSync(join(store.dir, run.image.file));
        res.writeHead(200, { 'Content-Type': `image/${run.image.format ?? 'jpeg'}`, 'Cache-Control': 'private, max-age=3600' });
        return void res.end(data);
      }
      if (req.method === 'GET') {
        const run = store.get(id);
        return run ? send(res, 200, run) : send(res, 404, { error: 'no_such_run' });
      }
      if (req.method === 'PATCH') return send(res, 200, await patchRun(req, id));
      if (req.method === 'DELETE') return store.delete(id) ? send(res, 200, { deleted: id }) : send(res, 404, { error: 'no_such_run' });
    }
    send(res, 404, { error: 'not_found' });
  }

  const server = createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) return send(res, err.status, err.body);
      const message = redact((err as Error)?.message ?? String(err), config.apiKey);
      console.error(`[gateway] ${req.method} ${req.url}: ${message}`);
      send(res, 500, { error: 'internal', message });
    });
  });
  return { server, store, budget };
}
