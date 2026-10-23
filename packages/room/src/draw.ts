import type { Bounds2 } from './plane.ts';

/** A door rectangle in wall-plane coordinates (metres). */
export interface DoorRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export interface DrawOptions {
  /** Snap distance to the wall's edges and the floor (m). */
  snap: number;
  minWidth: number;
  minHeight: number;
  /** The floor's height in plane V coordinates, if known. */
  floorV: number | null;
}

/**
 * Spec says 2 cm. With an emulated or real hand ray at 1.5-2.5 m, pinch jitter
 * alone is 1-2 cm, so the default is 5 cm; it is a parameter, not a constant.
 */
export const DEFAULT_DRAW: DrawOptions = { snap: 0.05, minWidth: 0.4, minHeight: 0.6, floorV: null };

export interface DrawResult {
  rect: DoorRect;
  valid: boolean;
  width: number;
  height: number;
  snapped: { left: boolean; right: boolean; top: boolean; bottom: boolean; floor: boolean };
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/**
 * The rectangle spanned by the pinch start and the current pinch point,
 * clamped to the wall's bounds and snapped to its edges and to the floor.
 */
export function drawRect(
  start: [number, number],
  current: [number, number],
  bounds: Bounds2,
  options: Partial<DrawOptions> = {},
): DrawResult {
  const o = { ...DEFAULT_DRAW, ...options };
  let u0 = clamp(Math.min(start[0], current[0]), bounds.u0, bounds.u1);
  let u1 = clamp(Math.max(start[0], current[0]), bounds.u0, bounds.u1);
  let v0 = clamp(Math.min(start[1], current[1]), bounds.v0, bounds.v1);
  let v1 = clamp(Math.max(start[1], current[1]), bounds.v0, bounds.v1);
  const snapped = { left: false, right: false, top: false, bottom: false, floor: false };
  if (u0 - bounds.u0 < o.snap) {
    u0 = bounds.u0;
    snapped.left = true;
  }
  if (bounds.u1 - u1 < o.snap) {
    u1 = bounds.u1;
    snapped.right = true;
  }
  if (bounds.v1 - v1 < o.snap) {
    v1 = bounds.v1;
    snapped.top = true;
  }
  const floorV = o.floorV;
  if (floorV !== null && Math.abs(v0 - floorV) < o.snap && floorV >= bounds.v0 - o.snap) {
    v0 = Math.max(floorV, bounds.v0);
    snapped.floor = true;
  } else if (v0 - bounds.v0 < o.snap) {
    v0 = bounds.v0;
    snapped.bottom = true;
  }
  const width = u1 - u0;
  const height = v1 - v0;
  return {
    rect: { u0, u1, v0, v1 },
    valid: width >= o.minWidth && height >= o.minHeight,
    width,
    height,
    snapped,
  };
}

/** "1.20 × 2.05 m" — the dimension label drawn on the frame. */
export function dimensionLabel(width: number, height: number): string {
  return `${width.toFixed(2)} × ${height.toFixed(2)} m`;
}

export function rectCenter(r: DoorRect): [number, number] {
  return [(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2];
}

export function insideRect(r: DoorRect, uv: [number, number], margin = 0): boolean {
  return uv[0] >= r.u0 - margin && uv[0] <= r.u1 + margin && uv[1] >= r.v0 - margin && uv[1] <= r.v1 + margin;
}
