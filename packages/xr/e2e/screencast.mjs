// Records the managed page with CDP screencast for the duration in e2e/.tmp/rec.json.
// Frames land in artifacts/rec/<name>/ with their timestamps (frames.json).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function run({ page, workspaceRoot }) {
  const { name, seconds } = JSON.parse(readFileSync(join(workspaceRoot, 'e2e/.tmp/rec.json'), 'utf8'));
  const dir = join(workspaceRoot, 'artifacts/rec', name);
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const i = frames.length;
    writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'));
    frames.push(f.metadata.timestamp);
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
    } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  try {
    await new Promise((r) => setTimeout(r, seconds * 1000));
  } finally {
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.detach().catch(() => {});
  }
  writeFileSync(join(dir, 'frames.json'), JSON.stringify(frames));
  return { frames: frames.length, dir };
}
