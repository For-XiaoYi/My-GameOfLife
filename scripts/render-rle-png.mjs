/**
 * 把 RLE 图案渲染成 PNG，供宣传片当静态大图用（大图案没法用 div 逐格画）。
 *
 * 用法：
 *   node scripts/render-rle-png.mjs <in.rle> <out.png> [--width=1280] [--bg=05080c] [--fg=6cf5d2]
 *
 * 采样方式：按目标宽度做盒式平均（大图案缩小后仍然看得清结构，而不是抽点）。
 * 数据来源：LifeWiki（conwaylife.com）的公开 RLE 集合；
 * 本仓库只缓存了宣传片用到的 turingmachine.rle（Paul Rendell, 2000）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const encodePNG = (w, h, rgb) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

export function parseRLE(text) {
  const lines = text.split(/\r?\n/);
  let w = 0;
  let h = 0;
  let body = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/i);
    if (m) {
      w = +m[1];
      h = +m[2];
      continue;
    }
    body += t;
  }
  if (!w || !h) throw new Error('RLE 头里没有 x/y');
  const cells = new Uint8Array(w * h);
  let x = 0;
  let y = 0;
  let run = 0;
  for (const ch of body) {
    if (ch >= '0' && ch <= '9') {
      run = run * 10 + (+ch);
      continue;
    }
    const n = run || 1;
    run = 0;
    if (ch === 'b' || ch === '.') x += n;
    else if (ch === 'o' || ch === 'A' || ch === '*') {
      for (let i = 0; i < n; i++) if (x + i < w && y < h) cells[y * w + x + i] = 1;
      x += n;
    } else if (ch === '$') {
      y += n;
      x = 0;
    } else if (ch === '!') break;
    else throw new Error(`无法识别的 RLE 字符：${ch}`);
  }
  return { w, h, cells };
}

const hex = (s, fallback) => {
  const t = (s ?? '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(t)) return fallback;
  return [parseInt(t.slice(0, 2), 16), parseInt(t.slice(2, 4), 16), parseInt(t.slice(4, 6), 16)];
};

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const [inFile, outFile] = files;
if (!inFile || !outFile) {
  console.error('usage: node scripts/render-rle-png.mjs in.rle out.png [--width=1280] [--bg=05080c] [--fg=6cf5d2]');
  process.exit(1);
}

const targetW = Math.max(16, parseInt(opt.width ?? '1280', 10) || 1280);
const BG = hex(opt.bg, [5, 8, 12]);
const FG = hex(opt.fg, [108, 245, 210]);

const pat = parseRLE(readFileSync(inFile, 'utf8'));

// --scale=N：一格画成 N×N 像素（适合小棋盘，别用宽度抽样把格子糊掉）
const cellScale = Math.max(1, parseInt(opt.scale ?? '0', 10) || 0);
let W;
let H;
let rgb;
if (cellScale > 1) {
  W = pat.w * cellScale;
  H = pat.h * cellScale;
  rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    const cy = Math.floor(y / cellScale);
    for (let x = 0; x < W; x++) {
      const v = pat.cells[cy * pat.w + Math.floor(x / cellScale)];
      const i = (y * W + x) * 3;
      const c = v ? FG : BG;
      rgb[i] = c[0];
      rgb[i + 1] = c[1];
      rgb[i + 2] = c[2];
    }
  }
} else {
  const scale = pat.w / targetW;
  W = Math.round(pat.w / scale);
  H = Math.round(pat.h / scale);
  rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(pat.h - 1, Math.ceil((y + 1) * scale));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(pat.w - 1, Math.ceil((x + 1) * scale));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * pat.w;
        for (let xx = x0; xx <= x1; xx++) {
          sum += pat.cells[row + xx];
          n++;
        }
      }
      // 密度 → 亮度：单格太稀会糊成黑，这里把 1 格的密度拉到接近满亮
      const d = Math.min(1, (sum / n) * 5.5);
      const i = (y * W + x) * 3;
      rgb[i] = Math.round(BG[0] + (FG[0] - BG[0]) * d);
      rgb[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * d);
      rgb[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * d);
    }
  }
}
writeFileSync(outFile, encodePNG(W, H, rgb));
let alive = 0;
for (const v of pat.cells) alive += v;
console.log(
  `${inFile} → ${outFile}  ${pat.w}×${pat.h} 格, ${alive} 个活细胞, 输出 ${W}×${H}（${Math.round((alive / (pat.w * pat.h)) * 1000) / 10}% 密度）`,
);
