import {
  type Vec3,
  add,
  column,
  cross,
  dot,
  normalize,
  scale,
  sub,
  transformPoint,
} from './vec.ts';

/**
 * A detected plane as WebXR reports it: a pose (plane space -> world) whose
 * local +Y is the surface normal, and a polygon in the plane's local X/Z.
 * On Quest these polygons are axis-aligned rectangles.
 */
export interface PlaneLike {
  id: string;
  /** `XRPlane.semanticLabel` when the runtime fills it (wall, floor, ...), else null. */
  label: string | null;
  orientation: 'horizontal' | 'vertical' | null;
  /** Column-major 4x4, plane space -> world. */
  matrix: ArrayLike<number>;
  polygon: ReadonlyArray<{ x: number; z: number }>;
}

/** Plane-local 2D bounds in metres along U (right) and V (up). */
export interface Bounds2 {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * A wall as a drawing surface: origin, right axis U, up axis V and the normal
 * N facing the viewer (U x V = N), plus the polygon's bounds in (u, v).
 */
export interface WallFrame {
  planeId: string;
  label: string | null;
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
  bounds: Bounds2;
}

const UP: Vec3 = [0, 1, 0];

export function isVerticalPlane(plane: PlaneLike): boolean {
  if (plane.orientation === 'vertical') return true;
  if (plane.orientation === 'horizontal') return false;
  // No orientation reported: decide from the normal.
  return Math.abs(dot(normalize(column(plane.matrix, 1)), UP)) < 0.3;
}

/**
 * Builds the drawing frame of a vertical plane. When `viewer` is given, the
 * normal is flipped (if needed) so it points toward the viewer.
 */
export function wallFrame(plane: PlaneLike, viewer?: Vec3): WallFrame {
  const m = plane.matrix;
  const origin: Vec3 = [m[12], m[13], m[14]];
  let n = normalize(column(m, 1));
  if (viewer && dot(n, sub(viewer, origin)) < 0) n = scale(n, -1);
  // V: the in-plane axis closest to world up.
  const ax = normalize(column(m, 0));
  const az = normalize(column(m, 2));
  let v = Math.abs(dot(ax, UP)) > Math.abs(dot(az, UP)) ? ax : az;
  if (dot(v, UP) < 0) v = scale(v, -1);
  // Gravity-align V inside the plane (planes are rarely perfectly plumb).
  const vProj = sub(UP, scale(n, dot(UP, n)));
  if (Math.hypot(...vProj) > 0.5) v = normalize(vProj);
  const u = normalize(cross(v, n));
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of plane.polygon) {
    const w = transformPoint(m, [p.x, 0, p.z]);
    const d = sub(w, origin);
    const pu = dot(d, u);
    const pv = dot(d, v);
    u0 = Math.min(u0, pu);
    u1 = Math.max(u1, pu);
    v0 = Math.min(v0, pv);
    v1 = Math.max(v1, pv);
  }
  if (!Number.isFinite(u0)) u0 = u1 = v0 = v1 = 0;
  return { planeId: plane.id, label: plane.label, origin, u, v, n, bounds: { u0, u1, v0, v1 } };
}

export function toPlane2(frame: WallFrame, p: Vec3): [number, number] {
  const d = sub(p, frame.origin);
  return [dot(d, frame.u), dot(d, frame.v)];
}

export function fromPlane2(frame: WallFrame, u: number, v: number, offset = 0): Vec3 {
  return add(add(add(frame.origin, scale(frame.u, u)), scale(frame.v, v)), scale(frame.n, offset));
}

/** Signed distance of a point from the wall (positive on the viewer's side). */
export function signedDistance(frame: WallFrame, p: Vec3): number {
  return dot(sub(p, frame.origin), frame.n);
}

export interface RayHit {
  t: number;
  point: Vec3;
  uv: [number, number];
  inside: boolean;
}

/** Ray against the wall's infinite plane; `inside` is within the polygon bounds (+margin). */
export function rayWall(frame: WallFrame, origin: Vec3, dir: Vec3, margin = 0): RayHit | null {
  const denom = dot(dir, frame.n);
  if (Math.abs(denom) < 1e-6) return null;
  const t = dot(sub(frame.origin, origin), frame.n) / denom;
  if (t <= 0) return null;
  const point = add(origin, scale(dir, t));
  const uv = toPlane2(frame, point);
  const b = frame.bounds;
  const inside =
    uv[0] >= b.u0 - margin && uv[0] <= b.u1 + margin && uv[1] >= b.v0 - margin && uv[1] <= b.v1 + margin;
  return { t, point, uv, inside };
}

/** Nearest wall the ray hits inside its bounds. */
export function pickWall(
  frames: ReadonlyArray<WallFrame>,
  origin: Vec3,
  dir: Vec3,
): { frame: WallFrame; hit: RayHit } | null {
  let best: { frame: WallFrame; hit: RayHit } | null = null;
  for (const frame of frames) {
    // Only walls facing the ray (the viewer sees their front).
    if (dot(dir, frame.n) >= 0) continue;
    const hit = rayWall(frame, origin, dir);
    if (!hit || !hit.inside) continue;
    if (!best || hit.t < best.hit.t) best = { frame, hit };
  }
  return best;
}

/** Shoelace area of a plane polygon (m^2). */
export function polygonArea(polygon: ReadonlyArray<{ x: number; z: number }>): number {
  let a = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}
