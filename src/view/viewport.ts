/** 视图变换：世界坐标 ⇄ 屏幕坐标，负责缩放与平移。 */
import type { ViewState } from '../core/storage.ts';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Viewport {
  /** 每个细胞占多少屏幕像素 */
  scale = 1;
  /** 世界 (0,0) 在屏幕上的位置 */
  ox = 0;
  oy = 0;

  readonly minScale = 0.03;
  readonly maxScale = 64;

  screenToWorld(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.ox) / this.scale, y: (py - this.oy) / this.scale };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.scale + this.ox, y: wy * this.scale + this.oy };
  }

  clampScale(s: number): number {
    return clamp(s, this.minScale, this.maxScale);
  }

  /** 以屏幕上某点为锚缩放（滚轮缩放用）。 */
  zoomAt(px: number, py: number, factor: number): void {
    const next = this.clampScale(this.scale * factor);
    if (next === this.scale) return;
    const k = next / this.scale;
    this.ox = px - (px - this.ox) * k;
    this.oy = py - (py - this.oy) * k;
    this.scale = next;
  }

  panBy(dx: number, dy: number): void {
    this.ox += dx;
    this.oy += dy;
  }

  /** 让整个世界铺满视口。 */
  fit(worldW: number, worldH: number, viewW: number, viewH: number, pad = 48): void {
    const s = Math.min((viewW - pad) / worldW, (viewH - pad) / worldH);
    this.scale = this.clampScale(s);
    this.ox = (viewW - worldW * this.scale) / 2;
    this.oy = (viewH - worldH * this.scale) / 2;
  }

  /** 把世界坐标点放到视口中心。 */
  centerOn(wx: number, wy: number, viewW: number, viewH: number): void {
    this.ox = viewW / 2 - wx * this.scale;
    this.oy = viewH / 2 - wy * this.scale;
  }

  getView(): ViewState {
    return { scale: this.scale, ox: this.ox, oy: this.oy };
  }

  setView(v: ViewState): void {
    this.scale = this.clampScale(v.scale);
    this.ox = v.ox;
    this.oy = v.oy;
  }

  /** 当前视口覆盖的世界矩形（右开区间，未裁剪）。 */
  visibleWorld(viewW: number, viewH: number): { x0: number; y0: number; x1: number; y1: number } {
    return {
      x0: Math.floor((0 - this.ox) / this.scale),
      y0: Math.floor((0 - this.oy) / this.scale),
      x1: Math.ceil((viewW - this.ox) / this.scale),
      y1: Math.ceil((viewH - this.oy) / this.scale),
    };
  }
}
