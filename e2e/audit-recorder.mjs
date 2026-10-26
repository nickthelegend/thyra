import { fileURLToPath } from 'node:url';
/** Reattach console/page/network capture whenever IWSDK replaces managed Chrome. */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require = createRequire(new URL('../packages/xr/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const out = `${root}audit/xr/browser-events.jsonl`;
const ready = '/tmp/thyra-t5-capture-ready.json';
let endpoint = '', browser, stop = false, epoch = 0;
const stage = () => { try { return readFileSync('/tmp/thyra-t5-stage', 'utf8').trim(); } catch { return 'startup'; } };
const log = (type, detail) => appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), epoch, stage: stage(), type, ...detail }) + '\n');
const seen = new WeakSet();
const attach = page => {
  if (seen.has(page)) return;
  seen.add(page);
  page.on('console', m => log('console', { level: m.type(), message: m.text().slice(0, 1800) }));
  page.on('pageerror', e => log('pageerror', { message: e.message }));
  page.on('request', r => log('request', { method: r.method(), url: r.url(), resource: r.resourceType() }));
  page.on('response', r => log('response', { method: r.request().method(), url: r.url(), status: r.status() }));
  page.on('requestfailed', r => log('requestfailed', { url: r.url(), failure: r.failure()?.errorText }));
  page.on('websocket', w => log('websocket', { url: w.url() }));
};
process.on('SIGTERM', () => { stop = true; });
process.on('SIGINT', () => { stop = true; });
while (!stop) {
  try {
    const s = JSON.parse(readFileSync(`${root}packages/xr/.iwsdk/runtime/session.json`, 'utf8'));
    const next = s.browserAutomation?.enabled && s.browserAutomation.endpoint;
    if (next && (next !== endpoint || !browser?.isConnected())) {
      browser = await chromium.connectOverCDP(next);
      endpoint = next;
      epoch++;
      for (const c of browser.contexts()) { c.pages().forEach(attach); c.on('page', attach); }
      browser.on('disconnected', () => log('disconnected', {}));
      log('attached', { pid: s.pid });
      writeFileSync(ready, JSON.stringify({ endpointHash: createHash('sha256').update(endpoint).digest('hex'), epoch, at: Date.now() }));
    }
  } catch { /* Browser replacement: retry the current registry, never reuse the old endpoint. */ }
  await new Promise(r => setTimeout(r, 100));
}
log('stopped', {});
// Do not browser.close(): IWSDK owns this process and its context.
process.exit(0);
