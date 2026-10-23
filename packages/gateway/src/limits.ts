import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Per-IP fixed window (one minute). */
export class RateLimiter {
  private readonly perMinute: number;
  private readonly hits = new Map<string, { windowStart: number; count: number }>();
  constructor(perMinute: number) {
    this.perMinute = perMinute;
  }
  allow(ip: string, now = Date.now()): boolean {
    const h = this.hits.get(ip);
    if (!h || now - h.windowStart >= 60_000) {
      this.hits.set(ip, { windowStart: now, count: 1 });
      return true;
    }
    h.count++;
    return h.count <= this.perMinute;
  }
}

/** Daily spend (UTC day), persisted next to the run records. */
export class Budget {
  private readonly dir: string;
  readonly capUsd: number;
  constructor(dir: string, capUsd: number) {
    this.dir = dir;
    this.capUsd = capUsd;
  }
  private file(day = new Date().toISOString().slice(0, 10)) {
    return join(this.dir, `budget-${day}.json`);
  }
  spentToday(): number {
    const f = this.file();
    if (!existsSync(f)) return 0;
    return (JSON.parse(readFileSync(f, 'utf8')) as { spent_usd: number }).spent_usd;
  }
  add(usd: number): void {
    writeFileSync(this.file(), JSON.stringify({ spent_usd: +(this.spentToday() + usd).toFixed(6) }));
  }
  exhausted(): boolean {
    return this.spentToday() >= this.capUsd;
  }
}
