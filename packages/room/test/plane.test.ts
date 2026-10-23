import { describe, expect, it } from 'vitest';
import { pickWall, polygonArea, rayWall, signedDistance, toPlane2, wallFrame, fromPlane2 } from '../src/index.ts';
import { backWall, rightWall, wallPlane } from './fixtures.ts';

const close = (a: number[], b: number[], eps = 1e-9) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6));

describe('wallFrame', () => {
  it('gives right/up/normal axes and polygon bounds for a wall facing the viewer', () => {
    const f = wallFrame(backWall, [0, 1.6, 0]);
    close(f.u, [1, 0, 0]);
    close(f.v, [0, 1, 0]);
    close(f.n, [0, 0, 1]);
    expect(f.bounds.u0).toBeCloseTo(-2.5);
    expect(f.bounds.u1).toBeCloseTo(2.5);
    expect(f.bounds.v0).toBeCloseTo(-1.35);
    expect(f.bounds.v1).toBeCloseTo(1.35);
  });

  it('flips the normal (and right axis) toward a viewer on the other side', () => {
    const f = wallFrame(backWall, [0, 1.6, -6]);
    close(f.n, [0, 0, -1]);
    close(f.u, [-1, 0, 0]);
  });

  it('keeps U to the viewer’s right on a side wall', () => {
    const f = wallFrame(rightWall, [0, 1.6, 0]);
    close(f.n, [-1, 0, 0]);
    // Facing the right wall you look along +X, so your right is +Z.
    close(f.u, [0, 0, 1]);
  });

  it('round-trips world points through plane coordinates', () => {
    const f = wallFrame(rightWall, [0, 1.6, 0]);
    const p = fromPlane2(f, 0.7, -0.4, 0.25);
    close(toPlane2(f, p), [0.7, -0.4]);
    expect(signedDistance(f, p)).toBeCloseTo(0.25);
  });
});

describe('rayWall / pickWall', () => {
  it('hits the back wall straight ahead at eye height', () => {
    const f = wallFrame(backWall, [0, 1.6, 0]);
    const hit = rayWall(f, [0, 1.6, 0], [0, 0, -1])!;
    expect(hit.t).toBeCloseTo(3.4);
    close(hit.uv, [0, 0.25]);
    expect(hit.inside).toBe(true);
  });

  it('misses outside the polygon and behind the ray', () => {
    const f = wallFrame(backWall, [0, 1.6, 0]);
    expect(rayWall(f, [0, 1.6, 0], [0, 0, 1])).toBeNull();
    const wide = rayWall(f, [0, 1.6, 0], [0.9, 0, -0.3])!;
    expect(wide.inside).toBe(false);
  });

  it('picks the nearest wall the ray actually enters and skips walls seen from behind', () => {
    const frames = [wallFrame(backWall, [0, 1.6, 0]), wallFrame(rightWall, [0, 1.6, 0])];
    const toRight = pickWall(frames, [0, 1.6, 0], [0.8, 0, -0.6])!;
    expect(toRight.frame.planeId).toBe('right');
    const ahead = pickWall(frames, [0, 1.6, 0], [0, 0, -1])!;
    expect(ahead.frame.planeId).toBe('back');
    const near = wallPlane('near', [0, 1.35, -1], [0, 0, -1], 2, 2.7); // faces away from the viewer
    expect(pickWall([wallFrame(near)], [0, 1.6, 0], [0, 0, -1])).toBeNull();
  });
});

describe('polygonArea', () => {
  it('is w × h for the rectangles Quest reports', () => {
    expect(polygonArea(backWall.polygon)).toBeCloseTo(13.5);
  });
});
