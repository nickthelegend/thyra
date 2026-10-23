import { describe, expect, it } from 'vitest';
import { buildRoomSummary, objectSide, wallFrame } from '../src/index.ts';
import { backWall } from './fixtures.ts';

const frame = wallFrame(backWall, [0, 1.6, 0]);
const rect = { u0: -0.6, u1: 0.6, v0: -1.35, v1: 0.7 }; // 1.20 × 2.05 m door down to the floor

describe('objectSide', () => {
  it('classifies objects left/right along the wall, in front, or behind it', () => {
    expect(objectSide(frame, rect, [-1.6, 0.4, -2.9]).side).toBe('left');
    expect(objectSide(frame, rect, [1.8, 0.4, -3.0]).side).toBe('right');
    expect(objectSide(frame, rect, [0.1, 0.4, -1.2]).side).toBe('in front');
    expect(objectSide(frame, rect, [0, 0.4, -5]).side).toBe('behind the wall');
  });
});

describe('buildRoomSummary', () => {
  const summary = buildRoomSummary({
    frame,
    rect,
    head: [0.1, 1.62, -1.9],
    floorY: 0,
    ceilingY: 2.7,
    floorArea: 29,
    objects: [
      { label: 'couch', center: [-1.6, 0.4, -2.95], dims: [2.0, 0.8, 0.9] },
      { label: 'lamp', center: [1.9, 0.8, -3.1], dims: [0.4, 1.6, 0.4] },
      { label: 'shelf', center: [0, 1, -6], dims: [1, 2, 0.4] },
      { label: 'table', center: [0, 0.4, 3.5], dims: [1, 0.7, 1] },
    ],
    now: new Date(2026, 9, 24, 19, 40),
    destination: 'a flooded cathedral at dawn',
  });

  it('matches the spec shape with sizes in metres', () => {
    expect(summary.portal).toEqual({ w_m: 1.2, h_m: 2.05, bottom_m: 0, wall: { label: 'wall', w_m: 5, h_m: 2.7 } });
    expect(summary.viewer).toEqual({ eye_height_m: 1.62, distance_to_portal_m: 1.5 });
    expect(summary.room.ceiling_m).toBe(2.7);
    expect(summary.room.floor_area_m2).toBe(29);
    expect(summary.light).toEqual({ available: false });
    expect(summary.local_time).toBe('19:40');
    expect(summary.destination_text).toBe('a flooded cathedral at dawn');
  });

  it('keeps nearby room-side objects, sorted by distance, and drops what is behind the wall or far', () => {
    expect(summary.room.objects.map((o) => [o.label, o.side])).toEqual([
      ['couch', 'left'],
      ['lamp', 'right'],
    ]);
    expect(summary.room.objects[0].dims_m).toEqual([2, 0.8, 0.9]);
  });

  it('reports null heights when the floor is unknown (never a guess)', () => {
    const s = buildRoomSummary({ frame, rect, head: [0, 1.6, -1], floorY: null, ceilingY: 2.7, floorArea: null, objects: [], now: new Date(), destination: 'x' });
    expect(s.room.ceiling_m).toBeNull();
    expect(s.room.floor_area_m2).toBeNull();
  });
});
