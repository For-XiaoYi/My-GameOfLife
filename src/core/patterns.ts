import type { World } from './world.ts';
import { PATTERN_ENTRIES } from './pattern-data.ts';

export type PatternCategory = '静物' | '振荡子' | '飞船' | '枪' | '长寿者' | '编队';

export interface PatternDef {
  id: string;
  name: string;
  en: string;
  /** 分类：内置图案是中文分类名，自定义图案存分类 id */
  category: string;
  w: number;
  h: number;
  cells: Uint8Array;
  /** 一个周期需要多少代（-1 表示不复原，比如枪和长寿者） */
  period: number;
  /** 一个周期后的位移，用于"这个图案会往哪走"的提示 */
  move: [number, number] | null;
  /** 活细胞数 */
  population: number;
  /** 是否永恒静止 */
  still: boolean;
}

function parseRows(rows: string[]): { w: number; h: number; cells: Uint8Array; population: number } {
  const h = rows.length;
  let w = 0;
  for (const r of rows) if (r.length > w) w = r.length;
  const cells = new Uint8Array(w * h);
  let population = 0;
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '.';
      if (ch === 'O' || ch === '#' || ch === '*') {
        cells[y * w + x] = 1;
        population++;
      }
    }
  }
  return { w, h, cells, population };
}

export const PATTERNS: PatternDef[] = PATTERN_ENTRIES.map((e) => {
  const { w, h, cells, population } = parseRows(e.rows);
  return {
    id: e.id,
    name: e.name,
    en: e.en,
    category: e.category,
    w,
    h,
    cells,
    period: e.period ?? -1,
    move: e.move,
    population,
    still: e.period === 1,
  };
});

export const PATTERN_BY_ID = new Map<string, PatternDef>(PATTERNS.map((p) => [p.id, p]));

export const CATEGORY_ORDER: PatternCategory[] = ['静物', '振荡子', '飞船', '枪', '长寿者'];

/** 图案旋转后的尺寸。 */
export function patternSize(pat: PatternDef, rotation: number): { w: number; h: number } {
  const rot = ((rotation % 4) + 4) % 4;
  const swap = rot === 1 || rot === 3;
  return { w: swap ? pat.h : pat.w, h: swap ? pat.w : pat.h };
}

/**
 * 把图案写进世界（可旋转 0/90/180/270，可镜像）。
 * 返回图案占据的包围盒（世界坐标，右开区间）。
 */
export function stampPattern(
  world: World,
  pat: PatternDef,
  x: number,
  y: number,
  rotation = 0,
  mirror = false,
): { x0: number; y0: number; x1: number; y1: number } {
  const r = renderPattern(pat, rotation, mirror);
  world.stamp(r.cells, r.w, r.h, x, y);
  return { x0: x, y0: y, x1: x + r.w, y1: y + r.h };
}

/** 预览用：返回旋转/镜像后的位图。 */
export function renderPattern(
  pat: PatternDef,
  rotation: number,
  mirror: boolean,
): { w: number; h: number; cells: Uint8Array } {
  const { cells, w, h } = pat;
  const rot = ((rotation % 4) + 4) % 4;
  const swap = rot === 1 || rot === 3;
  const ow = swap ? h : w;
  const oh = swap ? w : h;
  const out = new Uint8Array(ow * oh);
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      if (!cells[sy * w + sx]) continue;
      const dx = mirror ? w - 1 - sx : sx;
      const dy = sy;
      let rx: number;
      let ry: number;
      if (rot === 0) {
        rx = dx;
        ry = dy;
      } else if (rot === 1) {
        rx = h - 1 - dy;
        ry = dx;
      } else if (rot === 2) {
        rx = w - 1 - dx;
        ry = h - 1 - dy;
      } else {
        rx = dy;
        ry = w - 1 - dx;
      }
      out[ry * ow + rx] = 1;
    }
  }
  return { w: ow, h: oh, cells: out };
}
