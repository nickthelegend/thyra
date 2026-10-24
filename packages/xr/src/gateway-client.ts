import type { GatewayStatus, RoomSummary } from '@thyra/room';

/**
 * The browser never holds MODEL_API_KEY. It talks to the gateway at `/api`
 * on its own origin (Vite proxies it in dev), or at `?gateway=<url>`.
 */
const base = (() => {
  const q = new URLSearchParams(location.search).get('gateway');
  const env = import.meta.env.VITE_THYRA_GATEWAY as string | undefined;
  return (q ?? env ?? '').replace(/\/+$/, '');
})();

export class GatewayError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.message ?? body.error ?? `HTTP ${status}`));
    this.status = status;
    this.body = body;
  }
  get setupRequired(): boolean {
    return this.status === 503 && this.body.setup_required === 'MODEL_API_KEY';
  }
}

async function call<T>(path: string, init?: RequestInit, timeoutMs = 130_000): Promise<T> {
  const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { error: 'bad_response', message: text.slice(0, 200) };
  }
  if (!res.ok) throw new GatewayError(res.status, body);
  return body as T;
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export interface PortalPlan {
  title: string;
  pano_prompt: string;
  camera_height_m: number;
  horizon: 'eye-level';
  ground: { kind: string; material: string };
  time_of_day: string;
  palette: [string, string, string];
  frame_trim: { style: string; hex: string };
  ambient_spill: { hex: string; intensity: number };
  rationale: string;
}

export const gateway = {
  base,
  async status(): Promise<GatewayStatus | null> {
    // A static deploy with no gateway configured: don't probe /api on the static host.
    if (!base && !import.meta.env.DEV) return null;
    try {
      const s = await call<GatewayStatus & { service?: string }>('/api/status', undefined, 4000);
      return s.service === 'thyra-gateway' ? s : null;
    } catch {
      return null;
    }
  },
  plan(room: RoomSummary, destination: string, model = 'muse-spark-1.3') {
    return call<{ run_id: string; model: string; plan: PortalPlan; latency_ms: number }>('/api/plan', json({ room, destination, model }));
  },
  panorama(runId: string) {
    return call<{ run_id: string; image_url: string; width: number | null; height: number | null; latency_ms: number }>(
      '/api/panorama',
      json({ run_id: runId }),
    );
  },
  imageUrl(path: string) {
    return `${base}${path}`;
  },
  createRun(room: RoomSummary, destination: string, source: 'cc0-sample' | 'user-upload', sampleId: string | null) {
    return call<{ id: string }>('/api/runs', json({ room, destination, source, sample_id: sampleId }));
  },
  patchRun(id: string, patch: Record<string, unknown>) {
    return call<unknown>(`/api/runs/${id}`, json(patch, 'PATCH'));
  },
  transcribe(wav: Blob) {
    return call<{ text: string; latency_ms: number }>('/api/transcribe', { method: 'POST', body: wav, headers: { 'Content-Type': 'audio/wav' } });
  },
};
