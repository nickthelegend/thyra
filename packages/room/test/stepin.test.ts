import { describe, expect, it } from 'vitest';
import { STEP, badges, initialStep, stepIn, type StepInput, type StepState } from '../src/index.ts';

const at = (z: number, extra: Partial<StepInput> = {}): StepInput => ({
  dt: 1 / 60,
  head: [0, 1.6, z],
  headDistance: z + 3.4,
  headInDoor: true,
  handThrough: false,
  ...extra,
});

function run(s: StepState, input: StepInput, seconds: number): StepState {
  for (let t = 0; t < seconds; t += input.dt) s = stepIn(s, input);
  return s;
}

describe('stepIn', () => {
  it('stays in the room while the head is far from the door', () => {
    expect(stepIn(initialStep(), at(-1.5)).mode).toBe('room');
  });

  it('starts the flood within 0.3 m of the door and is inside after 1.2 s', () => {
    let s = stepIn(initialStep(), at(-3.15));
    expect(s.mode).toBe('entering');
    s = run(s, at(-3.15), STEP.floodSeconds * 0.5);
    expect(s.mode).toBe('entering');
    expect(s.t).toBeGreaterThan(0.4);
    s = run(s, at(-3.15), STEP.floodSeconds * 0.6);
    expect(s.mode).toBe('inside');
    expect(s.t).toBe(1);
  });

  it('enters when a hand reaches through, even from a distance', () => {
    expect(stepIn(initialStep(), at(-2.4, { handThrough: true })).mode).toBe('entering');
  });

  it('does not trigger next to the wall but outside the door', () => {
    expect(stepIn(initialStep(), at(-3.15, { headInDoor: false })).mode).toBe('room');
  });

  it('returns to the room after moving 0.5 m from the entry point, and re-arms only after leaving the zone', () => {
    let s = run(initialStep(), at(-3.15), 1.5);
    expect(s.mode).toBe('inside');
    s = stepIn(s, at(-3.15, { head: [0.3, 1.6, -3.15] }));
    expect(s.mode).toBe('inside');
    s = stepIn(s, at(-3.15, { head: [0.6, 1.6, -3.15] }));
    expect(s.mode).toBe('exiting');
    s = run(s, at(-3.15, { head: [0.6, 1.6, -3.15] }), 1.5);
    expect(s.mode).toBe('room');
    expect(stepIn(s, at(-3.15)).mode).toBe('room'); // still in the zone: not armed
    s = stepIn(s, at(-2.5));
    expect(s.armed).toBe(true);
    expect(stepIn(s, at(-3.2)).mode).toBe('entering');
  });
});

describe('badges', () => {
  const status = {
    spark: { ready: false, model: 'muse-spark-1.3', setup: 'MODEL_API_KEY' },
    wonder: { ready: false, model: 'muse-wonder-1.0', setup: 'MODEL_API_KEY' },
    image: { ready: true, model: 'muse-image-1.0' },
    transcribe: { ready: false, model: 'muse-voice-transcribe-1.0', setup: 'MODEL_API_KEY' },
    sam3: { ready: false, model: 'sam-3.1', setup: 'MODEL_API_KEY' },
    budget: { spent_usd_today: 0, cap_usd: 5 },
  };

  it('maps each model to ready / setup required', () => {
    const b = badges(status);
    expect(b.map((x) => x.tone)).toEqual(['setup', 'ready', 'setup']);
    expect(b[0].text).toBe('Muse Spark: Setup required (MODEL_API_KEY)');
    expect(b[1].text).toBe('Muse Image · muse-image-1.0');
  });

  it('says the gateway is offline rather than guessing', () => {
    expect(badges(null).every((x) => x.tone === 'offline')).toBe(true);
  });

  it('shows the daily cap once it is reached', () => {
    expect(badges({ ...status, budget: { spent_usd_today: 5, cap_usd: 5 } })[1].tone).toBe('capped');
  });
});
