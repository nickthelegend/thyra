import { CanvasTexture, Texture } from '@iwsdk/core';
import { analyzePanorama, choosePanoMode, seamFix, type PanoAnalysis, type PanoMode } from '@thyra/pano';

export interface Sample {
  id: string;
  file: string;
  title: string;
  destination: string;
  credit: string;
}

/** CC0 samples committed in public/panoramas (Poly Haven; see ASSETS.md). */
export const SAMPLES: Sample[] = [
  { id: 'misty_pines', file: 'panoramas/misty_pines.jpg', title: 'Misty Pines', destination: 'a misty pine forest', credit: 'Greg Zaal, Poly Haven (CC0)' },
  { id: 'the_sky_is_on_fire', file: 'panoramas/the_sky_is_on_fire.jpg', title: 'The Sky Is On Fire', destination: 'a seafront at sunset', credit: 'Greg Zaal & Rico Cilliers, Poly Haven (CC0)' },
  { id: 'satara_night', file: 'panoramas/satara_night.jpg', title: 'Satara Night', destination: 'a savanna under the stars', credit: 'Greg Zaal, Poly Haven (CC0)' },
];

export interface LoadedPano {
  texture: Texture;
  mode: PanoMode;
  analysis: PanoAnalysis;
  /** The decoded image's own size (what the model really returned). */
  width: number;
  height: number;
  decodeMs: number;
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

/** Decode → check (packages/pano on a 512×256 copy) → pick pano_mode → texture. */
export async function preparePanorama(url: string): Promise<LoadedPano> {
  const t0 = performance.now();
  const img = await loadImage(url);
  const W = 512;
  const H = Math.max(2, Math.round((W * img.naturalHeight) / img.naturalWidth));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const small = ctx.getImageData(0, 0, W, H);
  const analysis = analyzePanorama({ data: small.data, width: W, height: H });
  // the real size, not the analysis copy
  analysis.width = img.naturalWidth;
  analysis.height = img.naturalHeight;
  analysis.aspect = img.naturalWidth / img.naturalHeight;
  const mode = choosePanoMode(analysis);
  let texture: Texture;
  if (mode === 'equirect+seamfix') {
    const fw = Math.min(4096, img.naturalWidth);
    const fh = Math.round(fw / 2);
    const full = document.createElement('canvas');
    full.width = fw;
    full.height = fh;
    const fctx = full.getContext('2d', { willReadFrequently: true })!;
    fctx.drawImage(img, 0, 0, fw, fh);
    const fixed = seamFix({ data: fctx.getImageData(0, 0, fw, fh).data, width: fw, height: fh }, Math.round(fw / 32), 0.08);
    fctx.putImageData(new ImageData(new Uint8ClampedArray(fixed.data), fw, fh), 0, 0);
    texture = new CanvasTexture(full);
  } else {
    texture = new Texture(img);
  }
  texture.needsUpdate = true;
  return { texture, mode, analysis, width: img.naturalWidth, height: img.naturalHeight, decodeMs: Math.round(performance.now() - t0) };
}
