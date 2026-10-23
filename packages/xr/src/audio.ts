/** Tiny synthesized sound design (no audio files): tear, open, step-in. */
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noise(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = buf;
  return s;
}

/** Paper tearing: band-passed noise sweeping up. */
export function playTear(): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const n = noise(c, 0.9);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(5200, t + 0.75);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.22, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
  n.connect(bp).connect(g).connect(c.destination);
  n.start(t);
  n.stop(t + 0.9);
}

/** The world arriving: a soft open fifth that swells and fades. */
export function playOpen(): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.09, t + 0.8);
  out.gain.exponentialRampToValueAtTime(0.001, t + 3.6);
  out.connect(c.destination);
  for (const f of [196, 293.66, 392, 587.33]) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.detune.value = (Math.random() - 0.5) * 8;
    o.connect(out);
    o.start(t);
    o.stop(t + 3.7);
  }
}

/** Step-in: a low whoosh. */
export function playWhoosh(): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const n = noise(c, 1.4);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(200, t);
  lp.frequency.exponentialRampToValueAtTime(1800, t + 0.6);
  lp.frequency.exponentialRampToValueAtTime(150, t + 1.3);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.25, t + 0.4);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.35);
  n.connect(lp).connect(g).connect(c.destination);
  n.start(t);
  n.stop(t + 1.4);
}
