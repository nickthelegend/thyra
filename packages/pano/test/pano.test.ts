import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzePanorama, choosePanoMode, cylinderHeight, deltaE, seamFix, srgbToLab, type RGBAImage } from '../src/index.ts';

const load = (name: string): RGBAImage => ({
  data: new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))),
  width: 256,
  height: 128,
});

describe('colour', () => {
  it('converts sRGB to CIELAB', () => {
    const white = srgbToLab(255, 255, 255);
    expect(white[0]).toBeCloseTo(100, 1);
    expect(Math.abs(white[1])).toBeLessThan(0.5);
    expect(srgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 5);
    expect(deltaE(srgbToLab(255, 0, 0), srgbToLab(255, 0, 0))).toBe(0);
  });
});

describe('analyzePanorama on the committed CC0 samples (Poly Haven)', () => {
  it('reads a true equirectangular panorama as equirect: 2:1, seamless, horizon at the centre', () => {
    for (const name of ['misty_pines_256x128.rgba', 'sky_on_fire_256x128.rgba']) {
      const a = analyzePanorama(load(name));
      expect(a.aspect).toBe(2);
      expect(a.seam_delta_e).toBeLessThan(Math.max(6, 3 * a.inner_delta_e));
      expect(Math.abs(a.horizon_offset)).toBeLessThanOrEqual(0.05);
      expect(choosePanoMode(a)).toBe('equirect');
    }
  });

  it('flags a cropped image whose edges do not meet → equirect+seamfix', () => {
    const a = analyzePanorama(load('misty_pines_cropped_256x128.rgba'));
    expect(a.seam_delta_e).toBeGreaterThan(Math.max(6, 3 * a.inner_delta_e));
    expect(choosePanoMode(a)).toBe('equirect+seamfix');
  });

  it('flags a copy rolled 20% down (horizon off-centre) → cylinder', () => {
    const a = analyzePanorama(load('misty_pines_rolled_256x128.rgba'));
    expect(a.horizon_offset).toBeGreaterThan(0.05);
    expect(choosePanoMode(a)).toBe('cylinder');
  });

  it('rejects aspect ratios far from 2:1', () => {
    const a = analyzePanorama(load('misty_pines_256x128.rgba'));
    expect(choosePanoMode({ ...a, aspect: 1.5 })).toBe('cylinder');
  });
});

describe('seamFix', () => {
  it('makes the left and right edges meet and flattens the pole caps', () => {
    const img = load('misty_pines_cropped_256x128.rgba');
    const before = analyzePanorama(img);
    const fixed = seamFix(img, 64, 0.08);
    const after = analyzePanorama(fixed);
    expect(after.seam_delta_e).toBeLessThan(before.seam_delta_e / 5);
    expect(after.seam_delta_e).toBeLessThan(2);
    expect(after.pole_spread).toBeLessThan(before.pole_spread);
    expect(fixed.data.length).toBe(img.data.length);
  });
});

describe('cylinderHeight', () => {
  it('keeps pixels square on the cylinder', () => {
    expect(cylinderHeight(10, 2)).toBeCloseTo(Math.PI * 10);
  });
});
