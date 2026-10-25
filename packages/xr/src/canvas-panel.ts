import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type Vector2 } from '@iwsdk/core';
import { BRAND } from './brand.js';

export interface HitRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
}

/**
 * A flat UI surface drawn with Canvas 2D in the brand fonts and hit-tested by
 * Thyra's own pointer rays (hand ray, gaze, mouse). Sizes are in canvas px;
 * the mesh is `widthM` metres wide.
 */
export class CanvasPanel {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  readonly mesh: Mesh;
  regions: HitRegion[] = [];
  hover: string | null = null;
  pressed: string | null = null;

  constructor(name: string, pxW: number, pxH: number, widthM: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false });
    this.mesh = new Mesh(new PlaneGeometry(widthM, (widthM * pxH) / pxW), mat);
    this.mesh.name = name;
    this.mesh.renderOrder = 200;
  }

  /** uv (0..1, origin bottom-left) → region id. */
  regionAt(uv: Vector2): string | null {
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;
    for (const r of this.regions) if (r.enabled && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
    return null;
  }

  commit(): void {
    this.texture.needsUpdate = true;
  }

  // ---- drawing helpers (architectural drawing sheet style)

  clear(bg = 'rgba(23,22,20,0.86)', radius = 28): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = bg;
    roundRect(ctx, 2, 2, canvas.width - 4, canvas.height - 4, radius);
    ctx.fill();
    ctx.strokeStyle = 'rgba(236,231,222,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private font(size: number, weight: number, mono?: boolean, tracking?: number): void {
    const { ctx } = this;
    ctx.font = `${weight} ${size}px ${mono ? BRAND.mono : BRAND.sans}`;
    if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${tracking ?? (mono ? 0 : -0.02 * size)}px`;
  }

  text(s: string, x: number, y: number, size: number, opts: { color?: string; weight?: number; mono?: boolean; align?: CanvasTextAlign; maxWidth?: number; tracking?: number } = {}): number {
    const { ctx } = this;
    this.font(size, opts.weight ?? (opts.mono ? 400 : 500), opts.mono, opts.tracking);
    ctx.fillStyle = opts.color ?? BRAND.plaster;
    ctx.textAlign = opts.align ?? 'left';
    ctx.textBaseline = 'alphabetic';
    // A line that is far too long (a long typed destination) is cut with an ellipsis instead of being squeezed
    // by fillText's maxWidth into unreadable glyphs; up to 8 % over is still squeezed.
    if (opts.maxWidth !== undefined && ctx.measureText(s).width > opts.maxWidth * 1.08) {
      let cut = s;
      while (cut.length > 1 && ctx.measureText(`${cut}…`).width > opts.maxWidth) cut = cut.slice(0, -1);
      s = `${cut.trimEnd()}…`;
    }
    ctx.fillText(s, x, y, opts.maxWidth);
    return ctx.measureText(s).width;
  }

  /** Word-wrapped paragraph; returns the y after the last line. */
  para(s: string, x: number, y: number, size: number, maxWidth: number, lineHeight: number, opts: { color?: string; mono?: boolean; weight?: number; maxLines?: number } = {}): number {
    const { ctx } = this;
    // measure with the same font AND letter spacing text() will draw with: the spacing left over from the
    // previous call (e.g. a sans title's negative tracking) made mono lines measure ~70 px short and overflow
    this.font(size, opts.weight ?? 400, opts.mono);
    const words = s.split(/\s+/);
    let line = '';
    let lines = 0;
    const max = opts.maxLines ?? 6;
    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        this.text(lines === max - 1 ? `${line}…` : line, x, y, size, { ...opts, weight: opts.weight ?? 400 });
        lines++;
        y += lineHeight;
        line = words[i];
        if (lines >= max) return y;
      } else line = test;
    }
    if (line) {
      this.text(line, x, y, size, { ...opts, weight: opts.weight ?? 400 });
      y += lineHeight;
    }
    return y;
  }

  chip(id: string, label: string, x: number, y: number, w: number, h: number, opts: { tone?: 'lime' | 'ghost' | 'setup' | 'off'; enabled?: boolean; sub?: string } = {}): void {
    const { ctx } = this;
    const enabled = opts.enabled ?? true;
    const tone = enabled ? opts.tone ?? 'ghost' : 'off';
    const hot = enabled && this.hover === id;
    const down = enabled && this.pressed === id;
    ctx.save();
    roundRect(ctx, x, y, w, h, h / 2);
    if (tone === 'lime') ctx.fillStyle = down ? '#a9d21f' : hot ? '#d8ff5c' : BRAND.lime;
    else if (tone === 'setup') ctx.fillStyle = 'rgba(255,181,71,0.10)';
    else if (tone === 'off') ctx.fillStyle = 'rgba(236,231,222,0.04)';
    else ctx.fillStyle = down ? 'rgba(200,240,60,0.30)' : hot ? 'rgba(200,240,60,0.18)' : 'rgba(236,231,222,0.08)';
    ctx.fill();
    ctx.lineWidth = hot ? 4 : 2;
    ctx.strokeStyle = tone === 'lime' ? BRAND.lime : tone === 'setup' ? 'rgba(255,181,71,0.55)' : hot ? BRAND.lime : 'rgba(236,231,222,0.22)';
    ctx.stroke();
    ctx.restore();
    const color = tone === 'lime' ? BRAND.sumi : tone === 'setup' ? BRAND.setup : tone === 'off' ? 'rgba(236,231,222,0.35)' : BRAND.plaster;
    if (opts.sub) {
      this.text(label, x + w / 2, y + h * 0.47, h * 0.34, { color, align: 'center', weight: 500, maxWidth: w - 24 });
      this.text(opts.sub, x + w / 2, y + h * 0.78, h * 0.21, { color: tone === 'lime' ? BRAND.sumi : BRAND.grey, align: 'center', mono: true, maxWidth: w - 24 });
    } else this.text(label, x + w / 2, y + h * 0.63, h * 0.38, { color, align: 'center', weight: 500, maxWidth: w - 24 });
    this.regions.push({ id, x, y, w, h, enabled });
  }

  /** Small status dot + text. */
  badge(text: string, x: number, y: number, tone: 'ready' | 'setup' | 'offline' | 'capped' | 'info'): number {
    const color = tone === 'ready' ? BRAND.lime : tone === 'setup' || tone === 'capped' ? BRAND.setup : tone === 'offline' ? BRAND.error : BRAND.grey;
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x + 9, y - 9, 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    return 28 + this.text(text, x + 28, y, 26, { mono: true, color: tone === 'ready' ? BRAND.plaster : color });
  }

  /** Dimension line with end ticks (elevation drawing). */
  dimLine(x0: number, x1: number, y: number, label: string, color = BRAND.lime): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    for (const x of [x0, x1]) {
      ctx.moveTo(x - 7, y + 7);
      ctx.lineTo(x + 7, y - 7);
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x, y + 12);
    }
    ctx.stroke();
    this.font(26, 400, true); // the label's own font, not whatever was drawn last
    const w = this.ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(23,22,20,1)';
    ctx.fillRect((x0 + x1) / 2 - w / 2 - 14, y - 18, w + 28, 36);
    this.text(label, (x0 + x1) / 2, y + 9, 26, { mono: true, color, align: 'center' });
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
