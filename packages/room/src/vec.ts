/** Minimal 3-vector maths on plain tuples, so this package needs no three.js. */
export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l < 1e-12 ? [0, 0, 0] : scale(a, 1 / l);
};
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const round = (n: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Column-major 4x4 (WebXR / three.js layout): transform a point. */
export function transformPoint(m: ArrayLike<number>, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Column `i` (0..2) of a column-major 4x4, i.e. a basis axis. */
export function column(m: ArrayLike<number>, i: 0 | 1 | 2): Vec3 {
  return [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
}
