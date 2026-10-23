import type { PlaneLike, Vec3 } from '../src/index.ts';

/** Column-major pose from three basis columns + origin. */
export function pose(x: Vec3, y: Vec3, z: Vec3, o: Vec3): number[] {
  return [...x, 0, ...y, 0, ...z, 0, ...o, 1];
}

/** A wall `w` × `h` m with its centre at `c`, normal `n` (horizontal), as a WebXR plane. */
export function wallPlane(id: string, c: Vec3, n: Vec3, w: number, h: number, label: string | null = 'wall'): PlaneLike {
  // plane +Y = normal; pick plane X horizontal so that X × Y = Z = -up (polygon z runs downward).
  const up: Vec3 = [0, 1, 0];
  const x: Vec3 = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  const z: Vec3 = [x[1] * n[2] - x[2] * n[1], x[2] * n[0] - x[0] * n[2], x[0] * n[1] - x[1] * n[0]];
  return {
    id,
    label,
    orientation: 'vertical',
    matrix: pose(x, n, z, c),
    polygon: [
      { x: -w / 2, z: -h / 2 },
      { x: w / 2, z: -h / 2 },
      { x: w / 2, z: h / 2 },
      { x: -w / 2, z: h / 2 },
    ],
  };
}

/** The back wall of IWER's sunlit_living_room (5.0 × 2.7 m at z = -3.4, facing +Z). */
export const backWall = wallPlane('back', [0, 1.35, -3.4], [0, 0, 1], 5.0, 2.7);
/** Its right wall (5.8 m deep at x = +2.5, facing -X). */
export const rightWall = wallPlane('right', [2.5, 1.35, -0.5], [-1, 0, 0], 5.8, 2.7);
