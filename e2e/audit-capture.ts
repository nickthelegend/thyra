import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sleep, XR_DIR } from './iwsdk.ts';

/** Block fresh navigation until the independent recorder has attached to this epoch. */
export async function captureReady(): Promise<void> {
  if (!process.env.THYRA_AUDIT_DIR) return;
  for (let i = 0; i < 200; i++) {
    try {
      const session = JSON.parse(readFileSync(`${XR_DIR}.iwsdk/runtime/session.json`, 'utf8'));
      const ready = JSON.parse(readFileSync('/tmp/thyra-t5-capture-ready.json', 'utf8'));
      const endpoint = session.browserAutomation?.endpoint;
      if (endpoint && ready.endpointHash === createHash('sha256').update(endpoint).digest('hex')) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('Independent recorder did not attach to current Chrome');
}
