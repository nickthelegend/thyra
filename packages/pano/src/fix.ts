import type { RGBAImage } from './analyze.ts';

/**
 * Seam fix: cross-fades `fade` px across the left/right seam (each edge moves
 * halfway toward the other at the seam), then replaces the top and bottom
 * `cap` fraction with a gradient from the nearest kept row to its mean colour.
 */
export function seamFix(img: RGBAImage, fade = 64, cap = 0.08): RGBAImage {
  const { width: w, height: h } = img;
  const out = new Uint8ClampedArray(img.data);
  const F = Math.min(Math.floor(fade / 2), Math.floor(w / 4));
  for (let y = 0; y < h; y++) {
    for (let k = 0; k < F; k++) {
      const wgt = 0.5 * (1 - k / F);
      const li = (y * w + k) * 4;
      const ri = (y * w + (w - 1 - k)) * 4;
      for (let c = 0; c < 3; c++) {
        const L = img.data[li + c];
        const R = img.data[ri + c];
        out[li + c] = L * (1 - wgt) + R * wgt;
        out[ri + c] = R * (1 - wgt) + L * wgt;
      }
    }
  }
  const capRows = Math.floor(h * cap);
  const fill = (edgeRow: number, rows: number[]) => {
    const mean = [0, 0, 0];
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) mean[c] += out[(edgeRow * w + x) * 4 + c] / w;
    rows.forEach((y, idx) => {
      const t = (idx + 1) / (rows.length + 1); // 0 next to the kept row → 1 at the pole
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const e = (edgeRow * w + x) * 4;
        for (let c = 0; c < 3; c++) out[o + c] = out[e + c] * (1 - t) + mean[c] * t;
        out[o + 3] = 255;
      }
    });
  };
  if (capRows > 0) {
    fill(capRows, Array.from({ length: capRows }, (_, i) => capRows - 1 - i));
    fill(h - 1 - capRows, Array.from({ length: capRows }, (_, i) => h - capRows + i));
  }
  return { data: out, width: w, height: h };
}

/** Cylinder mode: wall height for a cylinder of `radius` showing a W×H image without stretching. */
export function cylinderHeight(radius: number, aspect: number): number {
  return (2 * Math.PI * radius) / aspect;
}
