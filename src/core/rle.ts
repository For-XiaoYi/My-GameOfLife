/**
 * RLE / plaintext 图案的解析与生成。
 * 支持从 LifeWiki 之类的站点直接粘贴：`#N 名字` + `x = , y = , rule = B3/S23` + `bo$2bo!`
 * 也兼容纯文本点阵（`.` 死 / `O` 活）。
 */

export interface PatternBitmap {
  width: number;
  height: number;
  /** 1 = 活细胞，行优先 */
  cells: Uint8Array;
}

export interface ParsedPattern extends PatternBitmap {
  name?: string;
  rule?: string;
  comments: string[];
}

const DEFAULT_RULE = 'B3/S23';

/** 去掉四周空白，返回紧凑位图。全空时返回 1×1 的空图。 */
export function cropBitmap(cells: Uint8Array, width: number, height: number): PatternBitmap {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (cells[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { width: 1, height: 1, cells: new Uint8Array(1) };
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = cells[(y + y0) * width + (x + x0)];
  }
  return { width: w, height: h, cells: out };
}

export function parsePatternText(text: string): ParsedPattern | null {
  const lines = text.replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').split('\n');
  const comments: string[] = [];
  let name: string | undefined;
  let rule: string | undefined;
  const bodyLines: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === '#') {
      const v = line.slice(1).trim();
      const tag = v[0] ?? '';
      const rest = v.slice(1).trim();
      if (tag === 'N' || tag === 'n') name = rest;
      else if (tag === 'C' || tag === 'c' || tag === 'D' || tag === 'd') comments.push(rest);
      if (!rule) {
        const m = /B[0-9]*\s*\/\s*S[0-9]*/i.exec(v);
        if (m) rule = m[0].replace(/\s+/g, '').toUpperCase();
      }
      continue;
    }
    bodyLines.push(line);
  }

  const body = bodyLines.join('\n');
  if (!body.trim()) return null;
  if (/^\s*x\s*=/im.test(body)) return parseRleBody(body, name, rule, comments);
  return parsePlaintext(body, name, rule, comments);
}

function parseRleBody(
  body: string,
  name: string | undefined,
  rule: string | undefined,
  comments: string[],
): ParsedPattern | null {
  const head = /x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)\s*(?:,\s*rule\s*=\s*([^,\n]+))?/i.exec(body);
  if (!head) return null;
  const W = Math.max(1, Math.min(100000, parseInt(head[1], 10)));
  const H = Math.max(1, Math.min(100000, parseInt(head[2], 10)));
  const ruleText = (head[3] ?? '').trim();
  const cells = new Uint8Array(W * H);

  const rest = body.slice(head.index + head[0].length);
  const re = /(\d*)\s*([bo$!])/gi;
  let x = 0;
  let y = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    const n = m[1] ? parseInt(m[1], 10) : 1;
    const t = m[2].toLowerCase();
    if (t === 'b') {
      x += n;
    } else if (t === 'o') {
      for (let k = 0; k < n; k++) {
        if (x >= 0 && x < W && y >= 0 && y < H) cells[y * W + x] = 1;
        x++;
      }
    } else if (t === '$') {
      y += n;
      x = 0;
    } else {
      break;
    }
    if (y >= H) break;
  }

  const cropped = cropBitmap(cells, W, H);
  return {
    ...cropped,
    name,
    rule: ruleText ? ruleText.toUpperCase() : rule,
    comments,
  };
}

function parsePlaintext(
  body: string,
  name: string | undefined,
  rule: string | undefined,
  comments: string[],
): ParsedPattern | null {
  const rows = body
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => /[.O*#oX]/.test(l));
  if (!rows.length) return null;
  let w = 0;
  for (const r of rows) if (r.length > w) w = r.length;
  const h = rows.length;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = rows[y];
    for (let x = 0; x < r.length; x++) {
      const c = r[x];
      if (c === 'O' || c === 'o' || c === '*' || c === '#' || c === 'X') cells[y * w + x] = 1;
    }
  }
  const cropped = cropBitmap(cells, w, h);
  return { ...cropped, name, rule, comments };
}

/** 生成 RLE 文本。 */
export function toRle(
  bmp: PatternBitmap,
  opts: { name?: string; rule?: string; comments?: string[]; lineWidth?: number } = {},
): string {
  const { width: W, height: H, cells } = bmp;
  const lineWidth = opts.lineWidth ?? 70;
  const lines: string[] = [];
  if (opts.name) lines.push(`#N ${opts.name}`);
  for (const c of opts.comments ?? []) lines.push(`#C ${c}`);
  lines.push(`x = ${W}, y = ${H}, rule = ${opts.rule ?? DEFAULT_RULE}`);

  const tokens: string[] = [];
  let prevRow = -1;
  for (let y = 0; y < H; y++) {
    const row = encodeRow(cells, y * W, W);
    if (!row) continue;
    const gap = y - prevRow - 1;
    if (gap > 0) tokens.push(gap > 1 ? `${gap}$` : '$');
    tokens.push(row);
    prevRow = y;
  }
  tokens.push('!');

  let cur = '';
  for (const t of tokens) {
    if (cur.length + t.length > lineWidth && cur) {
      lines.push(cur);
      cur = '';
    }
    cur += t;
  }
  if (cur) lines.push(cur);
  return lines.join('\n') + '\n';
}

function encodeRow(cells: Uint8Array, offset: number, w: number): string {
  let out = '';
  let run = 0;
  let cur = 0;
  let lastAlive = -1;
  for (let x = 0; x < w; x++) if (cells[offset + x]) lastAlive = x;
  if (lastAlive < 0) return '';
  for (let x = 0; x <= lastAlive; x++) {
    const v = cells[offset + x] ? 1 : 0;
    if (v === cur) {
      run++;
    } else {
      out += (run > 1 ? String(run) : '') + (cur ? 'o' : 'b');
      cur = v;
      run = 1;
    }
  }
  out += (run > 1 ? String(run) : '') + (cur ? 'o' : 'b');
  return out;
}
