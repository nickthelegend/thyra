import { deltaE, hex, srgbToLab } from './color.ts';

/** Raw RGBA pixels, row-major, top row first (canvas ImageData layout). */
export interface RGBAImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export type PanoMode = 'equirect' | 'equirect+seamfix' | 'cylinder';

export interface PanoAnalysis {
  width: number;
  height: number;
  aspect: number;
  /** Mean CIE76 ΔE between the left and right edge columns, over all rows. */
  seam_delta_e: number;
  /** Typical ΔE between neighbouring columns inside the image (median), for scale. */
  inner_delta_e: number;
  /** Estimated horizon row (0 = top), from a two-segment fit of row colours. */
  horizon_row: number;
  /** (horizon_row − height/2) / height; equirect wants ~0. */
  horizon_offset: number;
  /** Horizontal luminance spread of the top and bottom rows (an equirect pole is ~uniform). */
  pole_spread: number;
  /** Mean colour of the band just above the horizon, used for the floor light spill without a plan. */
  horizon_hex: string;
}

export const THRESHOLDS = {
  /** |aspect − 2| above this → not equirectangular. */
  aspectTolerance: 0.15,
  /** |horizon_offset| above this → cylinder (spec: centre row ± 5%). */
  horizon: 0.05,
  /** seam ΔE above max(seamAbs, seamRel × inner ΔE) → seam fix. */
  seamAbs: 6,
  seamRel: 3,
} as const;

function labAt(img: RGBAImage, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return srgbToLab(img.data[i], img.data[i + 1], img.data[i + 2]);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

export function seamDeltaE(img: RGBAImage): { seam: number; inner: number } {
  const { width: w, height: h } = img;
  let seam = 0;
  for (let y = 0; y < h; y++) seam += deltaE(labAt(img, 0, y), labAt(img, w - 1, y));
  seam /= h;
  // Typical neighbouring-column difference at 16 evenly spaced interior columns.
  const inner: number[] = [];
  for (let k = 1; k <= 16; k++) {
    const x = Math.floor((k * (w - 2)) / 17);
    let s = 0;
    for (let y = 0; y < h; y++) s += deltaE(labAt(img, x, y), labAt(img, x + 1, y));
    inner.push(s / h);
  }
  return { seam, inner: median(inner) };
}

/** Row-mean Lab colours. */
function rowMeans(img: RGBAImage): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const step = Math.max(1, Math.floor(img.width / 256));
  for (let y = 0; y < img.height; y++) {
    let L = 0;
    let a = 0;
    let b = 0;
    let n = 0;
    for (let x = 0; x < img.width; x += step) {
      const c = labAt(img, x, y);
      L += c[0];
      a += c[1];
      b += c[2];
      n++;
    }
    out.push([L / n, a / n, b / n]);
  }
  return out;
}

/**
 * Horizon row: the split of the 20%..80% band that best separates the rows
 * above from the rows below (least squared error of a two-segment fit).
 */
export function horizonRow(img: RGBAImage): number {
  const rows = rowMeans(img);
  const h = rows.length;
  const lo = Math.floor(h * 0.2);
  const hi = Math.ceil(h * 0.8);
  const seg = rows.slice(lo, hi);
  const n = seg.length;
  const pre = [new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1)];
  const pre2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) pre[c][i + 1] = pre[c][i] + seg[i][c];
    pre2[i + 1] = pre2[i] + seg[i][0] ** 2 + seg[i][1] ** 2 + seg[i][2] ** 2;
  }
  const sse = (a: number, b: number) => {
    const m = b - a;
    if (m <= 0) return 0;
    let s = pre2[b] - pre2[a];
    for (let c = 0; c < 3; c++) s -= (pre[c][b] - pre[c][a]) ** 2 / m;
    return s;
  };
  let best = Math.floor(n / 2);
  let bestErr = Infinity;
  for (let k = 2; k < n - 2; k++) {
    const e = sse(0, k) + sse(k, n);
    if (e < bestErr) {
      bestErr = e;
      best = k;
    }
  }
  return lo + best;
}

function poleSpread(img: RGBAImage): number {
  const rowStd = (y: number) => {
    let s = 0;
    let s2 = 0;
    for (let x = 0; x < img.width; x++) {
      const L = labAt(img, x, y)[0];
      s += L;
      s2 += L * L;
    }
    const m = s / img.width;
    return Math.sqrt(Math.max(0, s2 / img.width - m * m));
  };
  return (rowStd(0) + rowStd(img.height - 1)) / 2;
}

function bandHex(img: RGBAImage, y0: number, y1: number): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++)
    for (let x = 0; x < img.width; x += 2) {
      const i = (y * img.width + x) * 4;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
    }
  return n ? hex(r / n, g / n, b / n) : '#808080';
}

export function analyzePanorama(img: RGBAImage): PanoAnalysis {
  const { seam, inner } = seamDeltaE(img);
  const row = horizonRow(img);
  return {
    width: img.width,
    height: img.height,
    aspect: img.width / img.height,
    seam_delta_e: seam,
    inner_delta_e: inner,
    horizon_row: row,
    horizon_offset: (row - img.height / 2) / img.height,
    pole_spread: poleSpread(img),
    horizon_hex: bandHex(img, row - Math.round(img.height * 0.12), row),
  };
}

/** The spec's fallback chain: equirect → equirect+seamfix → cylinder. */
export function choosePanoMode(a: PanoAnalysis, t = THRESHOLDS): PanoMode {
  if (Math.abs(a.aspect - 2) > t.aspectTolerance) return 'cylinder';
  if (Math.abs(a.horizon_offset) > t.horizon) return 'cylinder';
  if (a.seam_delta_e > Math.max(t.seamAbs, t.seamRel * a.inner_delta_e)) return 'equirect+seamfix';
  return 'equirect';
}
