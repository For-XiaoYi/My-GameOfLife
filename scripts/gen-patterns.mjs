/**
 * 由 tools/patterns/*.rle 生成 src/core/pattern-data.ts。
 *
 * 数据来源：LifeWiki（conwaylife.com）的标准 RLE 图案文件，已随仓库缓存，
 * 因此离线也能重新生成。
 *
 * 用法：node scripts/gen-patterns.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'tools', 'patterns');
const OUT = join(root, 'src', 'core', 'pattern-data.ts');

/** id -> 展示信息。id 与 tools/patterns/<id>.rle 对应。 */
const META = [
  { id: 'block', name: '方块', en: 'Block', category: '静物' },
  { id: 'beehive', name: '蜂巢', en: 'Beehive', category: '静物' },
  { id: 'loaf', name: '面包', en: 'Loaf', category: '静物' },
  { id: 'boat', name: '小船', en: 'Boat', category: '静物' },
  { id: 'tub', name: '浴缸', en: 'Tub', category: '静物' },
  { id: 'pond', name: '池塘', en: 'Pond', category: '静物' },
  { id: 'ship', name: '大船', en: 'Ship', category: '静物' },
  { id: 'blinker', name: '闪光灯', en: 'Blinker', category: '振荡子' },
  { id: 'toad', name: '蟾蜍', en: 'Toad', category: '振荡子' },
  { id: 'beacon', name: '灯塔', en: 'Beacon', category: '振荡子' },
  { id: 'pulsar', name: '脉冲星', en: 'Pulsar', category: '振荡子' },
  { id: 'pentadecathlon', name: '十五面体', en: 'Pentadecathlon', category: '振荡子' },
  { id: 'glider', name: '滑翔机', en: 'Glider', category: '飞船' },
  { id: 'lwss', name: '轻型飞船', en: 'Lightweight Spaceship', category: '飞船' },
  { id: 'mwss', name: '中型飞船', en: 'Middleweight Spaceship', category: '飞船' },
  { id: 'hwss', name: '重型飞船', en: 'Heavyweight Spaceship', category: '飞船' },
  { id: 'gosperglidergun', name: '高斯帕滑翔机枪', en: 'Gosper Glider Gun', category: '枪' },
  { id: 'rpentomino', name: 'R 五连块', en: 'R-pentomino', category: '长寿者' },
  { id: 'acorn', name: '橡果', en: 'Acorn', category: '长寿者' },
  { id: 'diehard', name: '顽固者', en: 'Diehard', category: '长寿者' },
];

// ---------------------------------------------------------------- RLE 解析

function parseRLE(text) {
  const lines = text.split(/\r?\n/);
  let w = 0;
  let h = 0;
  let body = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/i);
    if (m) {
      w = Number(m[1]);
      h = Number(m[2]);
      continue;
    }
    body += t;
  }
  const grid = [];
  let row = new Uint8Array(w);
  let x = 0;
  let run = 0;
  const endRow = () => {
    grid.push(row);
    row = new Uint8Array(w);
    x = 0;
  };
  for (const ch of body) {
    if (ch >= '0' && ch <= '9') {
      run = run * 10 + (ch.charCodeAt(0) - 48);
      continue;
    }
    const n = run || 1;
    run = 0;
    if (ch === 'b' || ch === '.') x += n;
    else if (ch === 'o' || ch === 'A' || ch === '*') {
      for (let i = 0; i < n; i++) if (x + i < w) row[x + i] = 1;
      x += n;
    } else if (ch === '$') {
      for (let i = 0; i < n; i++) endRow();
    } else if (ch === '!') break;
    else if (ch === 'B') x += n;
  }
  if (x > 0 || grid.length < h) endRow();
  while (grid.length && grid[grid.length - 1].every((v) => !v)) grid.pop();
  return { w, h, grid };
}

/** 裁掉四周空白，返回紧凑的行字符串。 */
function toRows(grid) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (!grid[y][x]) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return [];
  const rows = [];
  for (let y = y0; y <= y1; y++) {
    let s = '';
    for (let x = x0; x <= x1; x++) s += grid[y][x] ? 'O' : '.';
    rows.push(s);
  }
  return rows;
}

// -------------------------------------------------- 用纯 JS 复算周期与位移

function stepGrid(grid, w, h) {
  const next = [];
  for (let y = 0; y < h; y++) {
    const row = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          n += grid[ny][nx];
        }
      }
      const alive = grid[y][x];
      row[x] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
    }
    next.push(row);
  }
  return next;
}

function bbox(grid, w, h) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  let pop = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y][x]) continue;
      pop++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1, pop };
}

function shapeKey(grid, box) {
  const parts = [];
  for (let y = box.y0; y <= box.y1; y++) {
    let s = '';
    for (let x = box.x0; x <= box.x1; x++) s += grid[y][x] ? '1' : '0';
    parts.push(s);
  }
  return parts.join('/');
}

function findPeriod(rows) {
  const h0 = rows.length;
  const w0 = Math.max(...rows.map((r) => r.length));
  const pad = 24;
  const W = w0 + pad * 2;
  const H = h0 + pad * 2;
  let grid = [];
  for (let y = 0; y < H; y++) grid.push(new Uint8Array(W));
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < rows[y].length; x++) if (rows[y][x] === 'O') grid[y + pad][x + pad] = 1;
  }
  const start = bbox(grid, W, H);
  const startKey = shapeKey(grid, start);
  for (let g = 1; g <= 240; g++) {
    grid = stepGrid(grid, W, H);
    const b = bbox(grid, W, H);
    if (b.pop === 0) return null;
    if (shapeKey(grid, b) === startKey) {
      return { period: g, move: [b.x0 - start.x0, b.y0 - start.y0] };
    }
  }
  return null;
}

// ---------------------------------------------------------------- 生成文件

const entries = [];
for (const meta of META) {
  const file = join(SRC, meta.id + '.rle');
  if (!existsSync(file)) throw new Error('缺少图案文件：' + file);
  const { w, h, grid } = parseRLE(readFileSync(file, 'utf8'));
  const rows = toRows(grid);
  const found = findPeriod(rows);
  const period = found ? found.period : meta.category === '枪' ? 30 : null;
  const move = found ? found.move : null;
  entries.push({ meta, rows, period, move, declared: [w, h] });
  console.log(
    `${meta.id.padEnd(16)} ${String(rows[0].length).padStart(3)}x${String(rows.length).padStart(2)}  ` +
      `周期 ${period ?? '-'}${move ? ` 位移 ${move.join(',')}` : ''}`,
  );
}

const lines = [];
lines.push('/**');
lines.push(' * 图案库数据，由 `node scripts/gen-patterns.mjs` 从 tools/patterns/*.rle 生成。');
lines.push(' * 数据来源：LifeWiki（conwaylife.com）的标准 RLE。请勿手改本文件。');
lines.push(' */');
lines.push('');
lines.push("import type { PatternCategory } from './patterns.ts';");
lines.push('');
lines.push('export interface PatternEntry {');
lines.push('  id: string;');
lines.push('  name: string;');
lines.push('  en: string;');
lines.push('  category: PatternCategory;');
lines.push('  rows: string[];');
lines.push('  period: number | null;');
lines.push('  move: [number, number] | null;');
lines.push('}');
lines.push('');
lines.push('export const PATTERN_ENTRIES: PatternEntry[] = [');
for (const e of entries) {
  lines.push('  {');
  lines.push(`    id: ${JSON.stringify(e.meta.id)},`);
  lines.push(`    name: ${JSON.stringify(e.meta.name)},`);
  lines.push(`    en: ${JSON.stringify(e.meta.en)},`);
  lines.push(`    category: ${JSON.stringify(e.meta.category)},`);
  lines.push('    rows: [');
  for (const r of e.rows) lines.push(`      ${JSON.stringify(r)},`);
  lines.push('    ],');
  lines.push(`    period: ${e.period === null ? 'null' : e.period},`);
  lines.push(`    move: ${e.move ? `[${e.move[0]}, ${e.move[1]}]` : 'null'},`);
  lines.push('  },');
}
lines.push('];');
lines.push('');
writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`\n已写入 ${OUT}`);
