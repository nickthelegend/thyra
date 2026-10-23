import { execFileSync } from 'node:child_process';

/** Mean RGB of a square patch of a PNG (decoded by ffmpeg; no image libraries). */
export function patchMean(png: string, cx: number, cy: number, size = 24): [number, number, number] {
  const x = Math.max(0, Math.round(cx - size / 2));
  const y = Math.max(0, Math.round(cy - size / 2));
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-vf', `crop=${size}:${size}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    maxBuffer: 1 << 24,
  });
  const m = [0, 0, 0];
  for (let i = 0; i < raw.length; i += 3) for (let c = 0; c < 3; c++) m[c] += raw[i + c];
  const n = raw.length / 3;
  return [m[0] / n, m[1] / n, m[2] / n];
}

export function pngSize(png: string): [number, number] {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', png], { encoding: 'utf8' });
  const [w, h] = out.trim().split(',').map(Number);
  return [w, h];
}

export const rgbDist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
