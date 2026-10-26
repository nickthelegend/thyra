import { describe, expect, it } from 'vitest';
import { dimensionLabel, drawRect, insideRect, rectsOverlap } from '../src/index.ts';

const bounds = { u0: -2.5, u1: 2.5, v0: -1.35, v1: 1.35 };

describe('drawRect', () => {
  it('spans the two pinch points in either drag direction', () => {
    const a = drawRect([0.2, 0.9], [-0.5, -0.8], bounds);
    expect(a.rect).toEqual({ u0: -0.5, u1: 0.2, v0: -0.8, v1: 0.9 });
    expect(a.valid).toBe(true);
    expect(a.width).toBeCloseTo(0.7);
  });

  it('clamps to the wall and snaps within the snap distance', () => {
    const r = drawRect([2.47, 0], [3.4, 1.9], bounds, { snap: 0.05 });
    expect(r.rect.u1).toBe(2.5);
    expect(r.rect.v1).toBe(1.35);
    expect(r.snapped.right && r.snapped.top).toBe(true);
    expect(r.snapped.left).toBe(false);
  });

  it('snaps the sill to the floor when the floor is known', () => {
    const r = drawRect([0, -1.32], [0.8, 0.8], bounds, { floorV: -1.35, snap: 0.05 });
    expect(r.rect.v0).toBe(-1.35);
    expect(r.snapped.floor).toBe(true);
  });

  it('rejects doors under the minimum 0.4 × 0.6 m', () => {
    expect(drawRect([0, 0], [0.39, 0.7], bounds).valid).toBe(false);
    expect(drawRect([0, 0], [0.5, 0.59], bounds).valid).toBe(false);
    expect(drawRect([0, 0], [0.4, 0.6], bounds).valid).toBe(true);
  });

  it('labels dimensions like an elevation drawing', () => {
    expect(dimensionLabel(1.2, 2.05)).toBe('1.20 × 2.05 m');
  });

  it('accepts the inclusive minimum after XR Float32 projection round-off', () => {
    const r = drawRect([-0.2, -0.75], [Math.fround(0.2) - 1e-7, -1.32], bounds, { floorV: -1.35 });
    expect(r.snapped.floor).toBe(true);
    expect(r.valid).toBe(true);
    expect(drawRect([0, 0], [0.3999, 0.6], bounds).valid).toBe(false);
    expect(drawRect([0, 0], [0.4, 0.5999], bounds).valid).toBe(false);
  });

  it('tests points against the rectangle with a margin', () => {
    const r = { u0: 0, u1: 1, v0: 0, v1: 2 };
    expect(insideRect(r, [1.05, 1])).toBe(false);
    expect(insideRect(r, [1.05, 1], 0.1)).toBe(true);
  });
});

describe('rectsOverlap', () => {
  const door = { u0: -0.6, u1: 0.6, v0: -1.35, v1: 0.7 };
  it('finds a door drawn over, inside or across another', () => {
    expect(rectsOverlap(door, { ...door })).toBe(true);
    expect(rectsOverlap(door, { u0: -0.4, u1: 0.4, v0: -0.75, v1: 0.25 })).toBe(true);
    expect(rectsOverlap(door, { u0: 0.5, u1: 1.3, v0: -1.35, v1: 0.6 })).toBe(true);
  });
  it('lets doors stand side by side, touching edges included', () => {
    expect(rectsOverlap(door, { u0: 0.6, u1: 1.4, v0: -1.35, v1: 0.6 })).toBe(false);
    expect(rectsOverlap(door, { u0: 1.4, u1: 2.2, v0: -1.35, v1: 0.65 })).toBe(false);
    expect(rectsOverlap(door, { u0: -0.6, u1: 0.6, v0: 0.7, v1: 1.35 })).toBe(false);
  });
  it('accepts a shared hand-ray edge after Float32 projection, but rejects measurable overlap', () => {
    const a = { u0: -1.0000000515913285, u1: 1.973552840595083e-8, v0: -1.35, v1: 0.55 };
    expect(rectsOverlap(a, { u0: -2, u1: -0.99999999, v0: -1.35, v1: 0.55 })).toBe(false);
    expect(rectsOverlap(a, { u0: -2, u1: -0.9999, v0: -1.35, v1: 0.55 })).toBe(true);
  });
});
