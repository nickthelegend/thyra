/**
 * Spoken destination. Path 1: the mic is captured as 16 kHz mono 16-bit WAV
 * and sent to the gateway (Muse Voice Transcribe). Path 2, only when the
 * gateway reports transcribe as Setup required: the browser's own speech
 * recognition, labelled as such (audio goes to the browser vendor).
 */
export type VoiceResult =
  | { ok: true; text: string; via: 'muse-voice-transcribe-1.0' | 'browser-speech'; latencyMs: number }
  | { ok: false; reason: string };

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

/** Linear resample to 16 kHz. */
function resample(input: Float32Array, from: number, to = 16000): Float32Array {
  if (from === to) return input;
  const out = new Float32Array(Math.floor((input.length * to) / from));
  const r = from / to;
  for (let i = 0; i < out.length; i++) {
    const x = i * r;
    const i0 = Math.floor(x);
    const f = x - i0;
    out[i] = (input[i0] ?? 0) * (1 - f) + (input[i0 + 1] ?? 0) * f;
  }
  return out;
}

export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  recording = false;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but universally available (incl. Quest Browser) and fine for a few seconds.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = (e) => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(this.node);
    this.node.connect(this.ctx.destination);
    this.recording = true;
  }

  async stop(): Promise<Blob> {
    this.recording = false;
    const rate = this.ctx?.sampleRate ?? 48000;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    const len = this.chunks.reduce((s, c) => s + c.length, 0);
    const all = new Float32Array(len);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    return encodeWav(resample(all, rate), 16000);
  }
}

type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
};

export function browserSpeechAvailable(): boolean {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export function browserSpeech(timeoutMs = 8000): Promise<VoiceResult> {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return Promise.resolve({ ok: false, reason: 'This browser has no speech recognition.' });
  const t0 = performance.now();
  return new Promise((resolve) => {
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let done = false;
    const finish = (r: VoiceResult) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    rec.onresult = (e) => finish({ ok: true, text: e.results[0][0].transcript, via: 'browser-speech', latencyMs: Math.round(performance.now() - t0) });
    rec.onerror = (e) => finish({ ok: false, reason: `Browser speech error: ${e.error}` });
    rec.onend = () => finish({ ok: false, reason: 'Nothing heard.' });
    setTimeout(() => finish({ ok: false, reason: 'Nothing heard.' }), timeoutMs);
    rec.start();
  });
}
