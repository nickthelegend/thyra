/**
 * Landing page + the app's 2D page at 375 px and 1280 px: no horizontal
 * scroll, data rendered, no console errors. Uses the Playwright that the
 * IWSDK CLI already installs (packages/xr/node_modules). Closes its browser.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(`${root}packages/xr/package.json`);
type Page = { on(e: string, f: (x: { type?(): string; text?(): string; message?: string }) => void): void; goto(u: string, o: object): Promise<unknown>; waitForTimeout(ms: number): Promise<void>; evaluate<T>(f: () => T): Promise<T>; locator(s: string): { count(): Promise<number>; first(): { innerText(): Promise<string> }; allInnerTexts(): Promise<string[]> }; screenshot(o: object): Promise<unknown> };
type Browser = { newContext(o: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>; close(): Promise<void> };
const { chromium } = require('playwright') as { chromium: { launch(o: object): Promise<Browser> } };
const site = `${root}packages/landing/`;
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.mp4': 'video/mp4' };
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  const f = join(site, p);
  if (!f.startsWith(site) || !existsSync(f)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
const appUrl = process.argv[2]; // e.g. https://localhost:8443/ (optional)
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 200)}` : ''}`);
};
mkdirSync(`${root}packages/xr/artifacts/e2e`, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [label, url] of [['landing', base], ...(appUrl ? [['app 2D page', appUrl]] : [])] as const) {
    for (const width of [375, 1280]) {
      const ctx = await browser.newContext({ viewport: { width, height: 812 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('console', (m) => m.type?.() === 'error' && errors.push(m.text?.() ?? ''));
      page.on('pageerror', (e) => errors.push(e.message ?? ''));
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
      await page.waitForTimeout(1200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${label} @${width}px: no horizontal scroll (${overflow}px)`, overflow <= 0);
      if (label === 'landing') {
        const rows = await page.locator('#doors tr').count();
        const first = await page.locator('#doors tr').first().innerText();
        check(`${label} @${width}px: door schedule rendered (${rows} rows)`, rows >= 1 && !/loading|Could not/.test(first), first.slice(0, 80));
      } else {
        const badges = await page.locator('#thyra-badges li').allInnerTexts();
        check(`${label} @${width}px: status badges shown`, badges.length >= 3, badges);
      }
      check(`${label} @${width}px: no console errors`, errors.length === 0, errors.slice(0, 3));
      await page.screenshot({ path: `${root}packages/xr/artifacts/e2e/${label.replace(/\W+/g, '-')}-${width}.png`, fullPage: label === 'landing' });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
const passed = checks.filter((c) => c.ok).length;
mkdirSync(`${root}deployments/e2e`, { recursive: true });
writeFileSync(`${root}deployments/e2e/pages-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify({ passed, failed: checks.length - passed, checks }, null, 2));
console.log(`${passed}/${checks.length} passed`);
process.exit(passed === checks.length ? 0 : 1);
