export type Bitmap = { w: number; h: number; cells: number[] };
export type Frame = { w: number; h: number; cells: number[]; age: number[] };

/** 环面演化一代（小世界直接遍历整张图，够快也够简单） */
export function stepOnce(cur: number[], w: number, h: number): number[] {
  const out = new Array<number>(w * h).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = (y + dy + h) % h;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          n += cur[yy * w + ((x + dx + w) % w)];
        }
      }
      const alive = cur[y * w + x];
      out[y * w + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
    }
  }
  return out;
}

const cache = new Map<string, Frame[]>();

/** 演化 gens 代，返回每一代（含年龄），按 key 缓存避免每帧重算 */
export function framesOf(key: string, bm: Bitmap, gens: number): Frame[] {
  const cacheKey = `${key}:${bm.w}x${bm.h}:${gens}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const frames: Frame[] = [];
  let cells = bm.cells.slice();
  let age: number[] = cells.map((v) => (v ? 1 : 0));
  frames.push({ w: bm.w, h: bm.h, cells: cells.slice(), age: age.slice() });

  for (let g = 1; g <= gens; g++) {
    const next = stepOnce(cells, bm.w, bm.h);
    const nextAge = next.map((v, i) => (v ? Math.min(255, (age[i] ?? 0) + 1) : 0));
    cells = next;
    age = nextAge;
    frames.push({ w: bm.w, h: bm.h, cells: cells.slice(), age: age.slice() });
  }
  cache.set(cacheKey, frames);
  return frames;
}

const NEW = [214, 255, 246];
const OLD = [38, 168, 145];

/** 年龄 → 颜色：刚出生接近亮白青，十来代之后稳定在青绿（不会暗到看不见） */
export function ageColor(a: number): string {
  const t = Math.max(0, Math.min(1, (Math.max(1, a) - 1) / 9));
  const r = Math.round(NEW[0] + (OLD[0] - NEW[0]) * t);
  const g = Math.round(NEW[1] + (OLD[1] - NEW[1]) * t);
  const b = Math.round(NEW[2] + (OLD[2] - NEW[2]) * t);
  return `rgb(${r},${g},${b})`;
}

/** 四周补空白，让飞船有地方飞出去 */
export function padBitmap(bm: Bitmap, px: number, py = px): Bitmap {
  const w = bm.w + px * 2;
  const h = bm.h + py * 2;
  const cells = new Array<number>(w * h).fill(0);
  for (let y = 0; y < bm.h; y++) {
    for (let x = 0; x < bm.w; x++) cells[(y + py) * w + (x + px)] = bm.cells[y * bm.w + x];
  }
  return { w, h, cells };
}

/** 把图案贴到一张指定大小的空白画布上（可指定左上角坐标） */
export function placeBitmap(bm: Bitmap, w: number, h: number, ox: number, oy: number): Bitmap {
  const cells = new Array<number>(w * h).fill(0);
  for (let y = 0; y < bm.h; y++) {
    for (let x = 0; x < bm.w; x++) {
      const tx = ox + x;
      const ty = oy + y;
      if (tx >= 0 && ty >= 0 && tx < w && ty < h) cells[ty * w + tx] = bm.cells[y * bm.w + x];
    }
  }
  return { w, h, cells };
}

/** 从 patterns.json 里取一个图案 */
export function getPattern(id: string): Bitmap & { name: string; period: number } {
  // 静态 JSON：打包时读一次
  const all = patterns as Array<{ id: string; name: string; w: number; h: number; period: number; cells: number[] }>;
  const p = all.find((x) => x.id === id);
  if (!p) throw new Error(`图案不存在：${id}`);
  return { w: p.w, h: p.h, cells: p.cells, name: p.name, period: p.period };
}

import patterns from '../assets/patterns.json';
