import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface GatewayConfig {
  /** Read from the environment only; never logged, never returned. */
  apiKey: string | undefined;
  apiBase: string;
  port: number;
  host: string;
  runsDir: string;
  dailyCapUsd: number;
  /** Requests per minute per client IP on the paid routes. */
  rateLimitPerMinute: number;
  /** Origins allowed to call the gateway cross-origin (same-origin proxying needs none). */
  allowedOrigins: string[];
}

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const key = env.MODEL_API_KEY?.trim();
  return {
    apiKey: key ? key : undefined,
    apiBase: (env.META_API_BASE ?? 'https://api.meta.ai/v1').replace(/\/+$/, ''),
    port: Number(env.THYRA_GATEWAY_PORT ?? 8430),
    host: env.THYRA_GATEWAY_HOST ?? '127.0.0.1',
    runsDir: env.THYRA_RUNS_DIR ?? resolve(repoRoot, 'deployments/runs'),
    dailyCapUsd: Number(env.THYRA_DAILY_CAP_USD ?? 5),
    rateLimitPerMinute: Number(env.THYRA_RATE_LIMIT_PER_MIN ?? 30),
    allowedOrigins: (env.THYRA_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

export const MODELS = {
  spark: 'muse-spark-1.3',
  wonder: 'muse-wonder-1.0',
  image: 'muse-image-1.0',
  transcribe: 'muse-voice-transcribe-1.0',
  sam3: 'sam-3.1',
} as const;

/** Pricing page, checked Oct 24 2026 (USD). */
export const PRICES = {
  'muse-spark-1.3': { in: 1.25 / 1e6, out: 4.25 / 1e6 },
  'muse-wonder-1.0': { in: 4.0 / 1e6, out: 20.0 / 1e6 },
  image: 0.01,
  transcribePerSecond: 0.18 / 3600,
} as const;
