import { type GatewayStatus, type RoomSummary, badges } from '@thyra/room';
import type { PanoAnalysis, PanoMode } from '@thyra/pano';
import { BRAND } from './brand.js';
import { CanvasPanel } from './canvas-panel.js';
import { SAMPLES } from './panorama.js';
import { sessionInput } from './session-state.js';

export interface Choice {
  id: string;
  destination: string;
  /** null → generate with Muse Spark + Muse Image (needs the key). */
  sampleId: string | null;
  upload: boolean;
}

export type CardView =
  | { kind: 'choose' }
  | { kind: 'listening'; via: string }
  | { kind: 'working'; summary: RoomSummary; step: string; note: string | null; rationale: string | null }
  | {
      kind: 'open';
      title: string;
      rationale: string | null;
      stamp: string | null;
      credit: string | null;
      mode: PanoMode;
      analysis: PanoAnalysis;
      timeToWorldMs: number;
      planNote: string | null;
    }
  | { kind: 'error'; message: string };

const GENERATE_ONLY = 'a flooded cathedral at dawn';

/** The door tag card: what you choose, what Spark read, what you got. */
export class DoorCard {
  readonly panel = new CanvasPanel('Thyra door card', 1024, 760, 0.56);
  view: CardView = { kind: 'choose' };
  tag = '';
  dims = '';
  status: GatewayStatus | null = null;
  voiceLabel = 'Setup required';

  get keyReady(): boolean {
    return Boolean(this.status?.spark.ready && this.status?.image.ready);
  }

  choices(): Choice[] {
    const list: Choice[] = SAMPLES.map((s) => ({ id: `dest-${s.id}`, destination: s.destination, sampleId: this.keyReady ? null : s.id, upload: false }));
    list.push({ id: 'dest-generate', destination: GENERATE_ONLY, sampleId: null, upload: false });
    if (sessionInput.typed) list.push({ id: 'dest-typed', destination: sessionInput.typed, sampleId: this.keyReady ? null : sessionInput.upload ? null : SAMPLES[0].id, upload: !this.keyReady && Boolean(sessionInput.upload) });
    if (sessionInput.upload) list.push({ id: 'dest-upload', destination: sessionInput.typed || 'your image', sampleId: null, upload: true });
    return list;
  }

  draw(): void {
    const p = this.panel;
    p.regions = [];
    p.clear();
    const W = p.canvas.width;
    // header: door tag + size, like a door schedule row
    p.text(this.tag, 48, 74, 34, { mono: true, color: BRAND.lime, weight: 500 });
    p.text(this.dims, W - 48, 74, 30, { mono: true, color: BRAND.plaster, align: 'right' });
    p.ctx.fillStyle = 'rgba(236,231,222,0.16)';
    p.ctx.fillRect(48, 98, W - 96, 2);
    const v = this.view;
    if (v.kind === 'choose') {
      p.text('Where does it lead?', 48, 168, 52, { weight: 500 });
      const cs = this.choices();
      const cw = (W - 96 - 20) / 2;
      cs.slice(0, 6).forEach((c, i) => {
        const x = 48 + (i % 2) * (cw + 20);
        const y = 200 + Math.floor(i / 2) * 112;
        const generate = c.sampleId === null && !c.upload;
        const enabled = !generate || this.keyReady;
        const sub = c.upload ? 'your image, not generated' : c.sampleId ? 'CC0 sample, not generated' : enabled ? 'Muse Spark + Muse Image' : 'Setup required: MODEL_API_KEY';
        p.chip(c.id, c.destination, x, y, cw, 96, { tone: enabled ? (i === 0 ? 'lime' : 'ghost') : 'setup', enabled, sub });
      });
      const rows = Math.ceil(Math.min(6, cs.length) / 2);
      const y = 200 + rows * 112 + 4;
      p.chip('mic', 'Say it', 48, y, 300, 84, { tone: 'ghost', sub: this.voiceLabel, enabled: this.voiceLabel !== 'unavailable' });
      p.chip('close', 'Close door', W - 48 - 240, y, 240, 84, { tone: 'ghost' });
      this.drawBadges(712);
    } else if (v.kind === 'listening') {
      p.text('Listening…', 48, 180, 56, { weight: 500 });
      p.para(v.via, 48, 240, 30, W - 96, 40, { color: BRAND.grey, mono: true });
      p.chip('mic', 'Done', 48, 330, 300, 90, { tone: 'lime' });
    } else if (v.kind === 'working') {
      const s = v.summary;
      p.text('Reading the room', 48, 166, 46, { weight: 500 });
      const objs = s.room.objects.slice(0, 3).map((o) => `${o.label} ${o.side} ${o.distance_m.toFixed(1)} m`).join(' · ') || 'no labelled furniture near the door';
      const lines = [
        `door ${s.portal.w_m.toFixed(2)} × ${s.portal.h_m.toFixed(2)} m · sill ${s.portal.bottom_m.toFixed(2)} m`,
        `wall ${s.portal.wall.w_m.toFixed(2)} × ${s.portal.wall.h_m.toFixed(2)} m (${s.portal.wall.label ?? 'no label'})`,
        `eye ${s.viewer.eye_height_m.toFixed(2)} m · ${s.viewer.distance_to_portal_m.toFixed(2)} m away`,
        `ceiling ${s.room.ceiling_m === null ? 'unknown' : `${s.room.ceiling_m.toFixed(2)} m`} · floor ${s.room.floor_area_m2 === null ? 'unknown' : `${s.room.floor_area_m2} m²`}`,
        objs,
        `light: ${s.light.available ? 'measured' : 'not available (no light estimation)'} · ${s.local_time}`,
      ];
      let y = 220;
      for (const l of lines) {
        p.text(l, 48, y, 28, { mono: true, color: 'rgba(236,231,222,0.86)', maxWidth: W - 96 });
        y += 42;
      }
      p.text(`"${s.destination_text}"`, 48, y + 22, 34, { color: BRAND.lime, maxWidth: W - 96 });
      y += 86;
      p.text(v.step, 48, y, 34, { weight: 500 });
      if (v.rationale) p.para(v.rationale, 48, y + 46, 28, W - 96, 36, { color: BRAND.plaster, maxLines: 2 });
      else if (v.note) p.para(v.note, 48, y + 46, 26, W - 96, 34, { color: BRAND.setup, mono: true, maxLines: 2 });
    } else if (v.kind === 'open') {
      p.text(v.title, 48, 170, 54, { weight: 500, maxWidth: W - 96 });
      let y = 214;
      if (v.rationale) y = p.para(v.rationale, 48, y, 30, W - 96, 38, { maxLines: 2 });
      else if (v.planNote) y = p.para(v.planNote, 48, y, 26, W - 96, 34, { color: BRAND.setup, mono: true, maxLines: 2 });
      if (v.stamp) {
        const sw = p.text(v.stamp.toUpperCase(), 0, -100, 30, { mono: true, weight: 500 });
        const ctx = p.ctx;
        ctx.fillStyle = 'rgba(255,181,71,0.14)';
        ctx.fillRect(48, y + 6, sw + 40, 52);
        ctx.strokeStyle = BRAND.setup;
        ctx.lineWidth = 2;
        ctx.strokeRect(48, y + 6, sw + 40, 52);
        p.text(v.stamp.toUpperCase(), 68, y + 43, 30, { mono: true, weight: 500, color: BRAND.setup });
        y += 70;
        if (v.credit) {
          p.text(v.credit, 48, y + 24, 24, { mono: true, color: BRAND.grey });
          y += 34;
        }
      }
      const a = v.analysis;
      const rows = [
        `pano_mode  ${v.mode}`,
        `image      ${a.width}×${a.height} · seam ΔE ${a.seam_delta_e.toFixed(1)} · horizon ${(a.horizon_offset * 100).toFixed(1)}%`,
        `to world   ${(v.timeToWorldMs / 1000).toFixed(2)} s from release`,
      ];
      y += 24;
      for (const r of rows) {
        p.text(r, 48, y + 20, 26, { mono: true, color: 'rgba(236,231,222,0.8)', maxWidth: W - 96 });
        y += 38;
      }
      p.text('Walk up to the door or reach through to step in.', 48, 632, 26, { color: BRAND.grey });
      p.chip('close', 'Close door', W - 48 - 240, 666, 240, 70, { tone: 'ghost' });
      p.chip('again', 'Somewhere else', 48, 666, 300, 70, { tone: 'ghost' });
    } else {
      p.text('That did not work', 48, 170, 50, { weight: 500, color: BRAND.error });
      p.para(v.message, 48, 230, 30, W - 96, 40, { mono: true, maxLines: 6 });
      p.chip('again', 'Try again', 48, 560, 300, 90, { tone: 'lime' });
      p.chip('close', 'Close door', W - 48 - 240, 560, 240, 90, { tone: 'ghost' });
    }
    p.commit();
  }

  private drawBadges(y: number): void {
    let x = 48;
    for (const b of badges(this.status, ['spark', 'image', 'transcribe'])) {
      const short = b.tone === 'ready' ? b.name : b.tone === 'offline' ? `${b.name}: offline` : `${b.name}: setup`;
      x += this.panel.badge(short, x, y, b.tone) + 26;
    }
  }
}
