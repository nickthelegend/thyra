import { type Vec3, distance } from './vec.ts';

export type StepMode = 'room' | 'entering' | 'inside' | 'exiting';

export interface StepState {
  mode: StepMode;
  /** Flood progress 0..1 (0 = only the door shows the world, 1 = it surrounds you). */
  t: number;
  /** Head position when the flood started; leaving it by `exitRadius` returns to the room. */
  entry: Vec3 | null;
  /** Re-armed once the head has left the trigger zone after an exit. */
  armed: boolean;
}

export interface StepInput {
  dt: number;
  head: Vec3;
  /** Head's signed distance from the wall (positive = room side). */
  headDistance: number;
  /** Head projects inside the door rectangle (with a small margin). */
  headInDoor: boolean;
  /** A hand's index tip went through the door (behind the wall, inside the rectangle). */
  handThrough: boolean;
}

export const STEP = {
  triggerDistance: 0.3,
  rearmDistance: 0.45,
  exitRadius: 0.5,
  floodSeconds: 1.2,
} as const;

export const initialStep = (): StepState => ({ mode: 'room', t: 0, entry: null, armed: true });

/** Pure Step-in state machine (spec: walk within 0.3 m or reach through; leave 0.5 m to return). */
export function stepIn(s: StepState, i: StepInput): StepState {
  const near = i.headInDoor && Math.abs(i.headDistance) < STEP.triggerDistance;
  const rate = i.dt / STEP.floodSeconds;
  switch (s.mode) {
    case 'room': {
      const armed = s.armed || !i.headInDoor || Math.abs(i.headDistance) > STEP.rearmDistance;
      if (armed && (near || i.handThrough)) return { mode: 'entering', t: 0, entry: [...i.head], armed: false };
      return armed === s.armed ? s : { ...s, armed };
    }
    case 'entering': {
      const t = Math.min(1, s.t + rate);
      return { ...s, mode: t >= 1 ? 'inside' : 'entering', t };
    }
    case 'inside':
      if (s.entry && distance(s.entry, i.head) > STEP.exitRadius) return { ...s, mode: 'exiting' };
      return s;
    case 'exiting': {
      const t = Math.max(0, s.t - rate);
      return t <= 0 ? { mode: 'room', t: 0, entry: null, armed: false } : { ...s, t };
    }
  }
}
