/** Canvas 渲染器：世界位图 → 离屏 1px/格 画布 → 按缩放贴到主画布。 */
import type { World } from '../core/world.ts';
import type { Viewport } from '../view/viewport.ts';

const BG = '#05080c';
const WORLD_BG = '#0a1017';
const DEAD_RGB: [number, number, number] = [10, 16, 23];

/** 年龄渐变色带：刚出生的细胞最亮，越老越深。 */
const AGE_STOPS: Array<{ age: number; rgb: [number, number, number] }> = [
  { age: 1, rgb: [206, 255, 244] },
  { age: 2, rgb: [162, 255, 229] },
  { age: 4, rgb: [112, 252, 214] },
  { age: 8, rgb: [70, 238, 197] },
  { age: 16, rgb: [44, 212, 182] },
  { age: 32, rgb: [30, 178, 168] },
  { age: 64, rgb: [24, 145, 154] },
  { age: 120, rgb: [21, 112, 136] },
  { age: 200, rgb: [19, 86, 118] },
  { age: 255, rgb: [17, 68, 99] },
];

function pack(rgb: [number, number, number]): number {
  return (0xff << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
}

const PALETTE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  PALETTE[i] = pack(DEAD_RGB);
}
for (let s = 0; s < AGE_STOPS.length - 1; s++) {
  const a = AGE_STOPS[s];
  const b = AGE_STOPS[s + 1];
  for (let age = a.age; age <= b.age; age++) {
    const t = (age - a.age) / (b.age - a.age);
    const rgb: [number, number, number] = [
      Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
      Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
      Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
    ];
    PALETTE[age] = pack(rgb);
  }
}
PALETTE[0] = pack(DEAD_RGB);
export const LIVE_COLOR = '#6cf5d2';

export interface Ghost {
  cells: Uint8Array;
  w: number;
  h: number;
  x: number;
  y: number;
  ok: boolean;
}

export interface ShapePreview {
  kind: 'line' | 'rect';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  erase: boolean;
}

export interface RenderOverlay {
  ghost?: Ghost | null;
  brush?: { x: number; y: number; size: number } | null;
  shape?: ShapePreview | null;
  selection?: { x0: number; y0: number; x1: number; y1: number }[] | null;
}

export interface RenderOptions {
  grid: boolean;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  private buf: Uint32Array | null = null;
  private world: World | null = null;
  dpr = 1;
  cssW = 0;
  cssH = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d', { alpha: false, willReadFrequently: false })!;
  }

  attach(world: World): void {
    this.world = world;
    this.off.width = world.width;
    this.off.height = world.height;
    this.img = this.offCtx.createImageData(world.width, world.height);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.paintAll();
  }

  resize(cssW: number, cssH: number, dpr = window.devicePixelRatio || 1): void {
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
  }

  /** 全量重画离屏位图（切换世界 / 载入存档后调用）。 */
  paintAll(): void {
    const w = this.world;
    if (!w) return;
    this.paintRect(0, 0, w.width, w.height);
  }

  private paintRect(x0: number, y0: number, x1: number, y1: number): void {
    const w = this.world;
    const img = this.img;
    const buf = this.buf;
    if (!w || !img || !buf) return;
    const W = w.width;
    const S = w.stride;
    const cells = w.cells;
    const birth = w.birth;
    const gen = w.gen;
    const ax0 = Math.max(0, Math.floor(x0));
    const ay0 = Math.max(0, Math.floor(y0));
    const ax1 = Math.min(W, Math.ceil(x1));
    const ay1 = Math.min(w.height, Math.ceil(y1));
    if (ax1 <= ax0 || ay1 <= ay0) return;
    for (let y = ay0; y < ay1; y++) {
      const base = (y + 1) * S + 1;
      let o = y * W + ax0;
      for (let x = ax0; x < ax1; x++) {
        const idx = base + x;
        if (cells[idx]) {
          let a = (gen - birth[idx]) & 0xffff;
          if (a < 1) a = 1;
          else if (a > 255) a = 255;
          buf[o++] = PALETTE[a];
        } else {
          buf[o++] = PALETTE[0];
        }
      }
    }
    this.offCtx.putImageData(img, 0, 0, ax0, ay0, ax1 - ax0, ay1 - ay0);
  }

  /** 把世界标脏的区域刷到离屏画布。 */
  sync(): void {
    const w = this.world;
    if (!w) return;
    const d = w.consumeDirty();
    if (!d) return;
    this.paintRect(d.x0, d.y0, d.x1, d.y1);
  }

  render(view: Viewport, opts: RenderOptions, overlay?: RenderOverlay): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    const w = this.world;
    if (!w) return;

    const scale = view.scale;
    const dx = view.ox;
    const dy = view.oy;
    const dw = w.width * scale;
    const dh = w.height * scale;

    ctx.fillStyle = WORLD_BG;
    ctx.fillRect(dx, dy, dw, dh);

    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(this.off, dx, dy, dw, dh);

    if (opts.grid) this.drawGrid(ctx, view, w);
    this.drawBorder(ctx, view, w);
    if (overlay?.ghost) this.drawGhost(ctx, view, overlay.ghost);
    if (overlay?.brush) this.drawBrush(ctx, view, overlay.brush, w);
    if (overlay?.shape) this.drawShape(ctx, view, overlay.shape);
    if (overlay?.selection) this.drawSelection(ctx, view, overlay.selection);
  }

  private drawSelection(
    ctx: CanvasRenderingContext2D,
    view: Viewport,
    rects: { x0: number; y0: number; x1: number; y1: number }[],
  ): void {
    if (rects.length === 0) return;
    const s = view.scale;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = (performance.now() / 60) % 10;
    ctx.lineWidth = 1.5;
    for (const sel of rects) {
      const x0 = Math.min(sel.x0, sel.x1);
      const y0 = Math.min(sel.y0, sel.y1);
      const wCells = Math.abs(sel.x1 - sel.x0) + 1;
      const hCells = Math.abs(sel.y1 - sel.y0) + 1;
      const px = view.ox + x0 * s;
      const py = view.oy + y0 * s;
      const pw = wCells * s;
      const ph = hCells * s;
      ctx.fillStyle = 'rgba(108,245,210,0.10)';
      ctx.fillRect(px, py, pw, ph);
      // 先描一层深色实线，再叠亮的虚线，任你背景多亮多暗都看得清
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(4,10,14,0.75)';
      ctx.strokeRect(px, py, pw, ph);
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = LIVE_COLOR;
      ctx.strokeRect(px + 0.75, py + 0.75, Math.max(1, pw - 1.5), Math.max(1, ph - 1.5));

      // 四角的小方块：提示这里可以拖着改大小
      ctx.setLineDash([]);
      const hs = 5;
      for (const [cx, cy] of [
        [px, py],
        [px + pw, py],
        [px, py + ph],
        [px + pw, py + ph],
      ] as const) {
        ctx.fillStyle = LIVE_COLOR;
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
        ctx.strokeStyle = 'rgba(4,10,14,0.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - hs / 2 + 0.5, cy - hs / 2 + 0.5, hs - 1, hs - 1);
      }
    }
    ctx.restore();
  }

  private drawShape(ctx: CanvasRenderingContext2D, view: Viewport, shape: ShapePreview): void {
    const s = view.scale;
    if (s < 0.12) return;
    const x0 = Math.min(shape.x0, shape.x1);
    const y0 = Math.min(shape.y0, shape.y1);
    const x1 = Math.max(shape.x0, shape.x1);
    const y1 = Math.max(shape.y0, shape.y1);
    ctx.save();
    ctx.fillStyle = shape.erase ? 'rgba(255,122,122,0.34)' : 'rgba(108,245,210,0.34)';
    ctx.strokeStyle = shape.erase ? '#ff7a7a' : LIVE_COLOR;
    ctx.lineWidth = 1;
    if (shape.kind === 'rect') {
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      ctx.fillRect(view.ox + x0 * s, view.oy + y0 * s, w * s, h * s);
      ctx.globalAlpha = 0.9;
      ctx.strokeRect(view.ox + x0 * s - 0.5, view.oy + y0 * s - 0.5, w * s + 1, h * s + 1);
    } else {
      const size = Math.max(1, s);
      let x = shape.x0;
      let y = shape.y0;
      const dx = Math.abs(shape.x1 - shape.x0);
      const dy = -Math.abs(shape.y1 - shape.y0);
      const sx = shape.x0 < shape.x1 ? 1 : -1;
      const sy = shape.y0 < shape.y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        ctx.fillRect(view.ox + x * s, view.oy + y * s, size, size);
        if (x === shape.x1 && y === shape.y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y += sy;
        }
      }
    }
    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, view: Viewport, w: World): void {
    const scale = view.scale;
    const vis = view.visibleWorld(this.cssW, this.cssH);
    const x0 = Math.max(0, vis.x0);
    const y0 = Math.max(0, vis.y0);
    const x1 = Math.min(w.width, vis.x1);
    const y1 = Math.min(w.height, vis.y1);
    if (x1 <= x0 || y1 <= y0) return;

    if (scale >= 5) {
      if (x1 - x0 > 3000 || y1 - y0 > 3000) return;
      ctx.strokeStyle = 'rgba(110, 190, 200, 0.13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        const px = Math.round(view.ox + x * scale) + 0.5;
        ctx.moveTo(px, view.oy + y0 * scale);
        ctx.lineTo(px, view.oy + y1 * scale);
      }
      for (let y = y0; y <= y1; y++) {
        const py = Math.round(view.oy + y * scale) + 0.5;
        ctx.moveTo(view.ox + x0 * scale, py);
        ctx.lineTo(view.ox + x1 * scale, py);
      }
      ctx.stroke();
    } else if (scale >= 0.5) {
      const step = 16;
      ctx.strokeStyle = 'rgba(110, 190, 200, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const gx0 = Math.ceil(x0 / step) * step;
      const gy0 = Math.ceil(y0 / step) * step;
      for (let x = gx0; x <= x1; x += step) {
        const px = Math.round(view.ox + x * scale) + 0.5;
        ctx.moveTo(px, view.oy + y0 * scale);
        ctx.lineTo(px, view.oy + y1 * scale);
      }
      for (let y = gy0; y <= y1; y += step) {
        const py = Math.round(view.oy + y * scale) + 0.5;
        ctx.moveTo(view.ox + x0 * scale, py);
        ctx.lineTo(view.ox + x1 * scale, py);
      }
      ctx.stroke();
    }
  }

  private drawBorder(ctx: CanvasRenderingContext2D, view: Viewport, w: World): void {
    ctx.strokeStyle = 'rgba(120, 210, 225, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(view.ox) + 0.5,
      Math.round(view.oy) + 0.5,
      Math.round(w.width * view.scale),
      Math.round(w.height * view.scale),
    );
  }

  private drawGhost(ctx: CanvasRenderingContext2D, view: Viewport, ghost: Ghost): void {
    const s = view.scale;
    if (s < 0.15) return;
    ctx.save();
    ctx.globalAlpha = ghost.ok ? 0.62 : 0.32;
    ctx.fillStyle = ghost.ok ? LIVE_COLOR : '#ff7a7a';
    const size = Math.max(1, s);
    for (let y = 0; y < ghost.h; y++) {
      for (let x = 0; x < ghost.w; x++) {
        if (!ghost.cells[y * ghost.w + x]) continue;
        const px = view.ox + (ghost.x + x) * s;
        const py = view.oy + (ghost.y + y) * s;
        ctx.fillRect(px, py, size, size);
      }
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = ghost.ok ? 'rgba(108,245,210,0.8)' : '#ff7a7a';
    ctx.lineWidth = 1;
    ctx.strokeRect(view.ox + ghost.x * s - 0.5, view.oy + ghost.y * s - 0.5, ghost.w * s + 1, ghost.h * s + 1);
    ctx.restore();
  }

  private drawBrush(
    ctx: CanvasRenderingContext2D,
    view: Viewport,
    brush: { x: number; y: number; size: number },
    w: World,
  ): void {
    const s = view.scale;
    if (s < 0.4) return;
    const x = ((brush.x % w.width) + w.width) % w.width;
    const y = ((brush.y % w.height) + w.height) % w.height;
    const n = Math.max(1, brush.size | 0);
    const r = (n - 1) >> 1;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(view.ox + (x - r) * s) + 0.5,
      Math.round(view.oy + (y - r) * s) + 0.5,
      Math.max(s * n, 2),
      Math.max(s * n, 2),
    );
    if (n > 2 && s > 2) {
      // 大笔刷再画一个淡淡的内部描边，方便判断中心
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.strokeRect(
        Math.round(view.ox + (x - r) * s) + 1.5,
        Math.round(view.oy + (y - r) * s) + 1.5,
        Math.max(s * n - 2, 2),
        Math.max(s * n - 2, 2),
      );
    }
    ctx.restore();
  }
}

/** 生成存档/片段用的缩略图（dataURL）。 */
export function makeThumb(world: World, size = 192): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = WORLD_BG;
  ctx.fillRect(0, 0, size, size);
  const bb = world.liveBBox();
  const empty = bb.x1 <= bb.x0 || bb.y1 <= bb.y0;
  const bx0 = empty ? 0 : bb.x0;
  const by0 = empty ? 0 : bb.y0;
  const bw = empty ? world.width : Math.max(1, bb.x1 - bb.x0);
  const bh = empty ? world.height : Math.max(1, bb.y1 - bb.y0);
  const pad = 6;
  const k = Math.min((size - pad * 2) / bw, (size - pad * 2) / bh);
  const dw = Math.max(1, Math.round(bw * k));
  const dh = Math.max(1, Math.round(bh * k));
  const ox = Math.round((size - dw) / 2);
  const oy = Math.round((size - dh) / 2);
  const img = ctx.createImageData(dw, dh);
  const buf = new Uint32Array(img.data.buffer);
  const S = world.stride;
  for (let y = 0; y < dh; y++) {
    const wy = by0 + Math.floor((y + 0.5) / k);
    if (wy < 0 || wy >= world.height) continue;
    for (let x = 0; x < dw; x++) {
      const wx = bx0 + Math.floor((x + 0.5) / k);
      if (wx < 0 || wx >= world.width) continue;
      const i = (wy + 1) * S + (wx + 1);
      buf[y * dw + x] = world.cells[i] ? PALETTE[world.ageAt(i)] : pack([8, 13, 19]);
    }
  }
  ctx.putImageData(img, ox, oy);
  return canvas.toDataURL('image/png');
}
