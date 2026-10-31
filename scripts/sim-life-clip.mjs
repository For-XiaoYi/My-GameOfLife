/**
 * 把 Life 大图案真的跑起来，渲染成宣传片用的动态片段。
 *
 * 用法：
 *   node scripts/sim-life-clip.mjs <in.rle> <out.mp4> \
 *     --crop=x,y,w,h --scale=2 --frames=150 --gpf=1 --fps=30 \
 *     [--margin=600] [--bg=05080c] [--fg=8ffbe0] [--ffmpeg=...]
 *
 * 说明：
 * - 稀疏集合模拟（只记活细胞），适合 8k/12k 的大图案；
 * - 直接通过 stdin 把 rgb24 帧喂给 ffmpeg，不落中间 PNG；
 * - crop 允许负数：太空填充者从 200 个细胞往外长，取景框要提前留出空白。
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

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
  console.error('usage: node scripts/sim-life-clip.mjs in.rle out.mp4 --crop=x,y,w,h --scale=2 --frames=150');
  process.exit(1);
}

const [cropX, cropY, cropW, cropH] = (opt.crop ?? '0,0,960,540').split(',').map(Number);
const scale = Number(opt.scale ?? 2);
const frames = Math.max(1, Number(opt.frames ?? 150));
const gpf = Math.max(1, Number(opt.gpf ?? 1));
const fps = Number(opt.fps ?? 30);
const margin = Math.max(100, Number(opt.margin ?? 800));
const W = Math.round(cropW * scale);
const H = Math.round(cropH * scale);
if (W % 2 || H % 2) throw new Error(`输出宽高必须偶数：${W}x${H}`);
const BG = (opt.bg ?? '05080c').match(/.{2}/g).map((h) => parseInt(h, 16));
const FG = (opt.fg ?? '8ffbe0').match(/.{2}/g).map((h) => parseInt(h, 16));
const HALO = [Math.round(FG[0] * 0.55), Math.round(FG[1] * 0.55), Math.round(FG[2] * 0.55)];
const s = Math.max(1, Math.round(scale));

function parseRLE(text) {
  const lines = text.split(/\r?\n/);
  let w = 0, h = 0, body = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/i);
    if (m) { w = +m[1]; h = +m[2]; continue; }
    body += t;
  }
  const cells = [];
  let x = 0, y = 0, run = 0;
  for (const ch of body) {
    if (ch >= '0' && ch <= '9') { run = run * 10 + (+ch); continue; }
    const n = run || 1; run = 0;
    if (ch === 'b' || ch === '.') x += n;
    else if (ch === 'o' || ch === 'A' || ch === '*') {
      for (let i = 0; i < n; i++) cells.push([x + i, y]);
      x += n;
    } else if (ch === '$') { y += n; x = 0; }
    else if (ch === '!') break;
    else throw new Error(`无法识别的 RLE 字符：${ch}`);
  }
  return { w, h, cells };
}

const pat = parseRLE(readFileSync(inFile, 'utf8'));
const S = pat.w + 2 * margin;
let live = new Set(pat.cells.map(([x, y]) => (y + margin) * S + (x + margin)));

function step() {
  const cnt = new Map();
  for (const k of live) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nk = k + dy * S + dx;
      cnt.set(nk, (cnt.get(nk) || 0) + 1);
    }
  }
  const next = new Set();
  for (const [k, c] of cnt) if (c === 3 || (c === 2 && live.has(k))) next.add(k);
  live = next;
}

const ffmpeg = opt.ffmpeg || process.env.FFMPEG ||
  'promo/node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@4.0.539/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe';
// Remotion 自带的 ffmpeg 没编 rawvideo 解复用器，但支持 bmp 解码；
// 自己封一个 24bit BMP 头，走 image2pipe，比 PNG 编码省 CPU。
const BMP_STRIDE = Math.ceil((W * 3) / 4) * 4;
const bmp = Buffer.alloc(54 + BMP_STRIDE * H);
bmp.write('BM', 0, 'ascii');
bmp.writeUInt32LE(54 + BMP_STRIDE * H, 2);
bmp.writeUInt32LE(54, 10);
bmp.writeUInt32LE(40, 14);
bmp.writeInt32LE(W, 18);
bmp.writeInt32LE(H, 22);
bmp.writeUInt16LE(1, 26);
bmp.writeUInt16LE(24, 28);
bmp.writeUInt32LE(BMP_STRIDE * H, 34);
function encodeBmp(rgb) {
  for (let y = 0; y < H; y++) {
    const src = y * W * 3;
    const dst = 54 + (H - 1 - y) * BMP_STRIDE;
    for (let x = 0; x < W; x++) {
      bmp[dst + x * 3] = rgb[src + x * 3 + 2];
      bmp[dst + x * 3 + 1] = rgb[src + x * 3 + 1];
      bmp[dst + x * 3 + 2] = rgb[src + x * 3];
    }
  }
  return bmp;
}

const child = spawn(ffmpeg, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-framerate', String(fps), '-f', 'image2pipe', '-vcodec', 'bmp',
  '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile,
], { stdio: ['pipe', 'inherit', 'inherit'] });
child.on('error', (e) => { console.error(e); process.exit(1); });

const write = (buf) => new Promise((res, rej) => {
  child.stdin.write(buf, (err) => (err ? rej(err) : res()));
});

const rgb = Buffer.alloc(W * H * 3);
const setPx = (x, y, c, a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  if (a >= 1) {
    rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2];
  } else {
    rgb[i] = Math.round(rgb[i] * (1 - a) + c[0] * a);
    rgb[i + 1] = Math.round(rgb[i + 1] * (1 - a) + c[1] * a);
    rgb[i + 2] = Math.round(rgb[i + 2] * (1 - a) + c[2] * a);
  }
};

const t0 = Date.now();
let population = live.size;
try {
for (let f = 0; f < frames; f++) {
  if (f > 0) for (let g = 0; g < gpf; g++) step();
  population = live.size;
  rgb.fill(0);
  // 背景
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = BG[0]; rgb[i * 3 + 1] = BG[1]; rgb[i * 3 + 2] = BG[2];
  }
  for (const k of live) {
    const px = (k % S) - margin;
    const py = ((k / S) | 0) - margin;
    if (px < cropX || py < cropY || px >= cropX + cropW || py >= cropY + cropH) continue;
    const sx = Math.floor((px - cropX) * scale);
    const sy = Math.floor((py - cropY) * scale);
    // 光晕
    for (let dy = -1; dy <= s; dy++) for (let dx = -1; dx <= s; dx++) {
      if (dx === 0 && dy === 0) continue;
      setPx(sx + dx, sy + dy, HALO, 0.16);
    }
    // 核心
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) setPx(sx + dx, sy + dy, FG, 1);
  }
  await write(encodeBmp(rgb));
  if (f % 30 === 0) {
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`  ${f}/${frames}  pop=${population}  ${el}s`);
  }
}
} catch (e) {
  console.error('渲染中断：', e.message);
  child.kill();
  process.exit(1);
}
child.stdin.end();
await new Promise((res, rej) => child.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)))));
console.log(`✔ ${outFile}  ${W}x${H}  ${frames} 帧  ${((Date.now() - t0) / 1000).toFixed(1)}s  crop=${cropX},${cropY},${cropW},${cropH}`);
