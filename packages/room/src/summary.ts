import type { DoorRect } from './draw.ts';
import { type WallFrame, fromPlane2, signedDistance } from './plane.ts';
import { type Vec3, dot, round, sub } from './vec.ts';

/** A detected 3D object (XRMesh with a semantic label) in world space. */
export interface ObjectLike {
  label: string;
  center: Vec3;
  /** [width, height, depth] in metres. */
  dims: Vec3;
}

export interface RoomSummary {
  portal: {
    w_m: number;
    h_m: number;
    bottom_m: number;
    wall: { label: string | null; w_m: number; h_m: number };
  };
  viewer: { eye_height_m: number; distance_to_portal_m: number };
  room: {
    ceiling_m: number | null;
    floor_area_m2: number | null;
    objects: Array<{ label: string; dims_m: Vec3; side: Side; distance_m: number }>;
  };
  light: { available: false } | { available: true; [k: string]: unknown };
  local_time: string;
  destination_text: string;
}

export type Side = 'left' | 'right' | 'in front' | 'behind the wall';

export interface SummaryInput {
  frame: WallFrame;
  rect: DoorRect;
  head: Vec3;
  floorY: number | null;
  ceilingY: number | null;
  floorArea: number | null;
  objects: ReadonlyArray<ObjectLike>;
  light?: RoomSummary['light'];
  now: Date;
  destination: string;
  /** Objects further than this from the door are left out (m). */
  maxObjectDistance?: number;
}

/**
 * Side of an object as seen by someone facing the door: "left"/"right" along
 * the wall, "in front" (between the wall and the viewer's back), or "behind the
 * wall". Distance is horizontal, from the door's bottom centre.
 */
export function objectSide(frame: WallFrame, rect: DoorRect, center: Vec3): { side: Side; distance: number } {
  const doorBottom = fromPlane2(frame, (rect.u0 + rect.u1) / 2, rect.v0);
  const d = sub(center, doorBottom);
  const along = dot(d, frame.u);
  const out = signedDistance(frame, center);
  const horizontal = Math.hypot(d[0], d[2]);
  let side: Side;
  if (out < -0.05) side = 'behind the wall';
  else if (Math.abs(along) >= Math.abs(out) * 0.75) side = along < 0 ? 'left' : 'right';
  else side = 'in front';
  return { side, distance: horizontal };
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** The exact JSON Muse Spark receives: geometry and labels, never pixels. */
export function buildRoomSummary(input: SummaryInput): RoomSummary {
  const { frame, rect, head, floorY } = input;
  const bottomWorld = fromPlane2(frame, (rect.u0 + rect.u1) / 2, rect.v0)[1];
  const floor = floorY ?? null;
  const maxD = input.maxObjectDistance ?? 4;
  const objects = input.objects
    .map((o) => {
      const s = objectSide(frame, rect, o.center);
      return {
        label: o.label,
        dims_m: o.dims.map((x) => round(x)) as Vec3,
        side: s.side,
        distance_m: round(s.distance),
      };
    })
    .filter((o) => o.side !== 'behind the wall' && o.distance_m <= maxD)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 8);
  return {
    portal: {
      w_m: round(rect.u1 - rect.u0),
      h_m: round(rect.v1 - rect.v0),
      bottom_m: floor === null ? round(bottomWorld) : round(bottomWorld - floor),
      wall: {
        label: frame.label,
        w_m: round(frame.bounds.u1 - frame.bounds.u0),
        h_m: round(frame.bounds.v1 - frame.bounds.v0),
      },
    },
    viewer: {
      eye_height_m: round(floor === null ? head[1] : head[1] - floor),
      distance_to_portal_m: round(Math.abs(signedDistance(frame, head))),
    },
    room: {
      ceiling_m: input.ceilingY === null || floor === null ? null : round(input.ceilingY - floor),
      floor_area_m2: input.floorArea === null ? null : round(input.floorArea, 1),
      objects,
    },
    light: input.light ?? { available: false },
    local_time: hhmm(input.now),
    destination_text: input.destination,
  };
}
