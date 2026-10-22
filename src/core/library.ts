/**
 * 图案库模型：内置图案 + 用户自定义图案 + 可自定义的分类（改名 / 增删 / 排序 / 归属）。
 * 纯数据层，不碰 DOM，方便自检脚本直接跑。
 */
import { PATTERNS, type PatternDef } from './patterns.ts';

/** 用户框选出来存下的图案。cells 用 base64 存 0/1 字节，省空间。 */
export interface CustomPatternRecord {
  id: string;
  name: string;
  catId: string;
  width: number;
  height: number;
  cells: string;
  created: number;
}

export interface CategoryDef {
  id: string;
  name: string;
}

/** 图案归属表里表示「不在库里显示」的值。 */
export const HIDDEN = '__hidden';

export interface LibraryConfig {
  categories: CategoryDef[];
  /** 图案 id -> 分类 id（或 HIDDEN）。没有条目就用默认归属。 */
  assignments: Record<string, string>;
  /** 全局显示顺序（图案 id）。分类内部顺序、以及同一分类的排列都由它决定。 */
  order: string[];
}

/** 内置分类：id 固定，名字可改。 */
export const BUILTIN_CATEGORIES: CategoryDef[] = [
  { id: 'still', name: '静物' },
  { id: 'oscillator', name: '振荡子' },
  { id: 'ship', name: '飞船' },
  { id: 'gun', name: '枪' },
  { id: 'methuselah', name: '长寿者' },
];

const CN_TO_CAT: Record<string, string> = {
  静物: 'still',
  振荡子: 'oscillator',
  飞船: 'ship',
  枪: 'gun',
  长寿者: 'methuselah',
};

export function defaultConfig(): LibraryConfig {
  return { categories: BUILTIN_CATEGORIES.map((c) => ({ ...c })), assignments: {}, order: [] };
}

/** 带分类 id 与「是否自定义」标记的图案（其余字段与 PatternDef 完全一致）。 */
export interface LibPattern extends PatternDef {
  catId: string;
  custom: boolean;
}

export function builtinCatId(p: PatternDef): string {
  return CN_TO_CAT[p.category] ?? 'other';
}

// ---------------------------------------------------------------- base64

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeCells(cells: Uint8Array): string {
  let out = '';
  for (let i = 0; i < cells.length; i += 3) {
    const a = cells[i] ?? 0;
    const b = cells[i + 1] ?? 0;
    const c = cells[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63];
    out += i + 1 < cells.length ? B64[(n >>> 6) & 63] : '=';
    out += i + 2 < cells.length ? B64[n & 63] : '=';
  }
  return out;
}

export function decodeCells(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2]) & 63) << 6) |
      (B64.indexOf(clean[i + 3]) & 63);
    out[o++] = (n >>> 16) & 255;
    if (o < out.length) out[o++] = (n >>> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// ---------------------------------------------------------------- 模型

export function customToPattern(rec: CustomPatternRecord): LibPattern {
  const cells = decodeCells(rec.cells);
  let population = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i]) population++;
  return {
    id: rec.id,
    name: rec.name,
    en: '自定义',
    category: rec.catId,
    cells,
    w: rec.width,
    h: rec.height,
    population,
    still: false,
    period: -1,
    move: [0, 0],
    catId: rec.catId,
    custom: true,
  };
}

export class Library {
  config: LibraryConfig;
  /** 自定义图案的原始记录，按 id 索引 */
  readonly customs = new Map<string, CustomPatternRecord>();
  private cache: LibPattern[] = [];
  private index = new Map<string, LibPattern>();

  constructor(customPatterns: CustomPatternRecord[] = [], config?: LibraryConfig | null) {
    this.config = normalizeConfig(config);
    for (const rec of customPatterns) this.customs.set(rec.id, rec);
    this.rebuild();
  }

  private rebuild(): void {
    const list: LibPattern[] = [];
    for (const p of PATTERNS) {
      const catId = this.assignOf(p.id) ?? builtinCatId(p);
      list.push({ ...p, catId, custom: false });
    }
    for (const rec of this.customs.values()) {
      const pat = customToPattern(rec);
      pat.catId = this.assignOf(rec.id) ?? rec.catId;
      list.push(pat);
    }
    // 按配置里的显式顺序排（没登记过的排在后面，保持自然顺序）
    const order = this.config.order;
    const pos = new Map<string, number>();
    for (let i = 0; i < order.length; i++) if (!pos.has(order[i]!)) pos.set(order[i]!, i);
    const BIG = Number.MAX_SAFE_INTEGER;
    list.sort((a, b) => (pos.get(a.id) ?? BIG) - (pos.get(b.id) ?? BIG));
    // 把新出现的图案补进顺序表，下次顺序就稳定了
    for (const p of list) {
      if (!pos.has(p.id)) {
        pos.set(p.id, order.length);
        order.push(p.id);
      }
    }
    this.cache = list;
    this.index = new Map(list.map((p) => [p.id, p]));
  }

  private assignOf(id: string): string | undefined {
    const v = this.config.assignments[id];
    return v === undefined ? undefined : v;
  }

  /** 分类列表（含空分类，顺序即显示顺序）。 */
  get categories(): CategoryDef[] {
    return this.config.categories;
  }

  categoryName(id: string): string {
    return this.config.categories.find((c) => c.id === id)?.name ?? '未分类';
  }

  /** 该分类下可见的图案（隐藏的不返回）。 */
  patternsIn(catId: string): LibPattern[] {
    return this.cache.filter((p) => p.catId === catId && p.catId !== HIDDEN);
  }

  /** 所有可见图案，按分类顺序展开。 */
  get visible(): LibPattern[] {
    const out: LibPattern[] = [];
    for (const cat of this.config.categories) out.push(...this.patternsIn(cat.id));
    return out;
  }

  /** 被隐藏的图案，管理面板里可以恢复。 */
  get hidden(): LibPattern[] {
    return this.cache.filter((p) => p.catId === HIDDEN);
  }

  byId(id: string): LibPattern | undefined {
    return this.index.get(id);
  }

  // ---------------- 图案 ----------------

  addCustom(rec: CustomPatternRecord): void {
    this.customs.set(rec.id, rec);
    this.rebuild();
  }

  removeCustom(id: string): void {
    this.customs.delete(id);
    delete this.config.assignments[id];
    this.config.order = this.config.order.filter((x) => x !== id);
    this.rebuild();
  }

  /** 修改图案归属；catId 传 null 表示从库里隐藏。 */
  assign(patternId: string, catId: string | null): void {
    const pat = this.index.get(patternId);
    const fallback = pat ? (pat.custom ? pat.catId : builtinCatId(pat)) : undefined;
    if (catId === null) this.config.assignments[patternId] = HIDDEN;
    else if (fallback === undefined || catId === fallback) delete this.config.assignments[patternId];
    else this.config.assignments[patternId] = catId;
    this.rebuild();
  }

  /** 把图案挪到某个分类，并插到 beforeId 之前（null = 放到该分类末尾）。 */
  movePattern(patternId: string, catId: string, beforeId?: string | null): void {
    this.assign(patternId, catId);
    const order = this.config.order.filter((x) => x !== patternId);
    if (beforeId && beforeId !== patternId) {
      const i = order.indexOf(beforeId);
      if (i >= 0) order.splice(i, 0, patternId);
      else order.push(patternId);
    } else {
      // 放到该分类最后一个图案之后
      const mates = this.cache.filter((p) => p.id !== patternId && p.catId === catId);
      const last = mates[mates.length - 1];
      const at = last ? order.indexOf(last.id) + 1 : order.length;
      order.splice(at, 0, patternId);
    }
    this.config.order = order;
    this.rebuild();
  }

  /** 收进仓库（等同隐藏），并保留原分类信息以便随时取回。 */
  stash(patternId: string): void {
    this.assign(patternId, null);
  }

  /** 从仓库取出，放回指定分类（默认放回它本来属于的分类）。 */
  unstash(patternId: string, catId?: string): void {
    const pat = this.index.get(patternId);
    if (!pat) return;
    const fallback = pat.custom ? pat.catId : builtinCatId(pat);
    this.movePattern(patternId, catId ?? fallback);
  }

  // ---------------- 分类 ----------------

  renameCategory(id: string, name: string): void {
    const cat = this.config.categories.find((c) => c.id === id);
    if (cat) cat.name = name.trim() || cat.name;
  }

  addCategory(name: string): CategoryDef {
    const base = 'cat-' + Date.now().toString(36);
    let id = base;
    let n = 2;
    while (this.config.categories.some((c) => c.id === id)) id = base + '-' + n++;
    const cat: CategoryDef = { id, name: name.trim() || '新分类' };
    this.config.categories.push(cat);
    return cat;
  }

  /** 删除分类：其中的图案改归第一个分类，不让它们凭空消失。 */
  removeCategory(id: string): void {
    if (this.config.categories.length <= 1) return;
    const idx = this.config.categories.findIndex((c) => c.id === id);
    if (idx < 0) return;
    this.config.categories.splice(idx, 1);
    const first = this.config.categories[0].id;
    for (const p of this.cache) {
      if (p.catId !== id) continue;
      if (p.custom) {
        const rec = this.customs.get(p.id);
        if (rec) rec.catId = first;
        delete this.config.assignments[p.id];
      } else {
        const def = builtinCatId(p);
        if (def === first) delete this.config.assignments[p.id];
        else this.config.assignments[p.id] = first;
      }
    }
    this.rebuild();
  }

  /** 上移/下移分类（delta = -1 / +1）。 */
  moveCategory(id: string, delta: number): void {
    const cats = this.config.categories;
    const i = cats.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= cats.length) return;
    const [c] = cats.splice(i, 1);
    cats.splice(j, 0, c);
  }

  /** 拖拽排序：把分类放到 beforeId 之前（null = 移到最后）。 */
  moveCategoryBefore(id: string, beforeId?: string | null): void {
    const cats = this.config.categories;
    const i = cats.findIndex((c) => c.id === id);
    if (i < 0) return;
    const [c] = cats.splice(i, 1);
    if (!beforeId) {
      cats.push(c);
      return;
    }
    const j = cats.findIndex((x) => x.id === beforeId);
    cats.splice(j < 0 ? cats.length : j, 0, c);
  }
}

/** 容错：读回来的配置可能缺字段或引用了不存在的分类。 */
export function normalizeConfig(raw?: LibraryConfig | null): LibraryConfig {
  const base = defaultConfig();
  const keepOrder = (src: unknown): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const id of Array.isArray(src) ? src : []) {
      if (typeof id === 'string' && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  };
  if (!raw || !Array.isArray(raw.categories) || raw.categories.length === 0) {
    if (!raw) return base;
    return {
      ...base,
      assignments: { ...(raw.assignments ?? {}) },
      order: keepOrder(raw.order),
    };
  }
  const cats: CategoryDef[] = [];
  const seen = new Set<string>();
  for (const c of raw.categories) {
    if (!c || typeof c.id !== 'string' || seen.has(c.id)) continue;
    seen.add(c.id);
    cats.push({ id: c.id, name: typeof c.name === 'string' && c.name ? c.name : c.id });
  }
  if (!cats.length) return base;
  const assignments: Record<string, string> = {};
  const valid = new Set(cats.map((c) => c.id));
  for (const [k, v] of Object.entries(raw.assignments ?? {})) {
    if (v === HIDDEN || valid.has(v)) assignments[k] = v;
  }
  const order = keepOrder(raw.order);
  return { categories: cats, assignments, order };
}
