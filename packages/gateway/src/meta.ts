/**
 * Minimal client for https://api.meta.ai/v1 (OpenAI-compatible surface).
 * Fields marked UNVERIFIED are written from the docs but have not been
 * exercised with a real key yet (none exists in this repo's history).
 */
export class MetaError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  constructor(status: number, code: string, message: string, requestId: string | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export interface MetaCall<T> {
  body: T;
  requestId: string | null;
  latencyMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Removes the key from any text before it can reach a log or a response. */
export function redact(text: string, key: string | undefined): string {
  if (!key) return text;
  return text.split(key).join('[redacted]');
}

export class MetaClient {
  private readonly key: string;
  private readonly base: string;
  private readonly retries: number;
  constructor(key: string, base: string, retries = 2) {
    this.key = key;
    this.base = base;
    this.retries = retries;
  }

  async request<T>(path: string, init: { json?: unknown; form?: FormData }): Promise<MetaCall<T>> {
    const started = performance.now();
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await fetch(`${this.base}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.key}`,
            ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: init.json !== undefined ? JSON.stringify(init.json) : init.form,
          signal: AbortSignal.timeout(120_000),
        });
      } catch (err) {
        throw new MetaError(502, 'meta_unreachable', redact(`Meta API unreachable: ${(err as Error).message}`, this.key), null);
      }
      const requestId = res.headers.get('x-request-id');
      const text = await res.text();
      if (res.ok) {
        try {
          return { body: JSON.parse(text) as T, requestId, latencyMs: Math.round(performance.now() - started) };
        } catch {
          throw new MetaError(502, 'meta_bad_json', 'Meta API returned a non-JSON body', requestId);
        }
      }
      // 503 (and 429) are documented as retryable with backoff.
      if ((res.status === 503 || res.status === 429) && attempt < this.retries) {
        attempt++;
        await sleep(500 * 2 ** attempt);
        continue;
      }
      let code = `http_${res.status}`;
      let message = text.slice(0, 300);
      try {
        const j = JSON.parse(text) as { error?: { code?: string; message?: string } };
        if (j.error?.code) code = j.error.code;
        if (j.error?.message) message = j.error.message;
      } catch {
        /* keep the raw text */
      }
      throw new MetaError(res.status, code, redact(message, this.key), requestId);
    }
  }
}
