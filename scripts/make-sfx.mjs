/**
 * 规则段的生死音效：纯代码合成，不依赖采样库。
 * 输出：promo/public/sfx/{birth,death,tick}.wav
 * 用法：node scripts/make-sfx.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'promo', 'public', 'sfx');
mkdirSync(OUT, { recursive: true });

const SR = 44100;
const TAU = Math.PI * 2;
let seed = 20261031;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(clamp(samples[i], -1, 1) * 32767), 44 + i * 2);
  writeFileSync(join(OUT, name), buf);
  console.log(`wrote sfx/${name} ${(n / SR).toFixed(2)}s`);
}

/** 一阶低通，给噪声去毛刺 */
function lowpass(sig, cut) {
  const a = Math.exp((-TAU * cut) / SR);
  let y = 0;
  return sig.map((v) => (y = (1 - a) * v + a * y));
}

// 生：亮色叮 + 短促的“噗”
{
  const dur = 0.26;
  const n = Math.round(dur * SR);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 18);
    const envNoise = Math.exp(-t * 60);
    const f = 880 + 420 * Math.min(1, t / 0.05);
    const tone = Math.sin(TAU * f * t) * 0.5 + Math.sin(TAU * f * 2.01 * t) * 0.22;
    const shimmer = Math.sin(TAU * 2640 * t) * 0.12 * Math.exp(-t * 26);
    out[i] = (tone + shimmer) * env * 0.82 + (rnd() * 2 - 1) * envNoise * 0.05;
  }
  writeWav('birth.wav', out);
}

// 死：低频塌陷 + 向下漏气
{
  const dur = 0.3;
  const n = Math.round(dur * SR);
  const out = new Array(n).fill(0);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 150 - 95 * Math.min(1, t / 0.26);
    phase += (TAU * f) / SR;
    const thud = Math.sin(phase) * Math.exp(-t * 15) * 0.75;
    const fizz = (rnd() * 2 - 1) * Math.exp(-t * 9) * 0.22;
    out[i] = thud + fizz;
  }
  // 低通去噪
  const lp = lowpass(out, 900);
  writeWav('death.wav', lp.map((v, i) => v * (1 - i / n) + out[i] * 0.15));
}

// 活：极轻的一下 tick
{
  const dur = 0.09;
  const n = Math.round(dur * SR);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 55);
    out[i] = (Math.sin(TAU * 1760 * t) * 0.4 + (rnd() * 2 - 1) * 0.18) * env;
  }
  writeWav('tick.wav', out);
}

// 翻页/转场用的小 whoosh（滑翔枪预告卡可以垫一下）
{
  const dur = 0.55;
  const n = Math.round(dur * SR);
  const out = new Array(n).fill(0);
  const noise = lowpass(Array.from({ length: n }, () => rnd() * 2 - 1), 2200);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.sin((Math.PI * t) / dur) ** 2;
    out[i] = noise[i] * env * 0.5;
  }
  writeWav('whoosh.wav', out);
}

// 活：规则 2 的确认音，两个音，比 tick 更有存在感
{
  const dur = 0.34;
  const n = Math.round(dur * SR);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.008) * Math.exp(-t * 8);
    const a = Math.sin(TAU * 660 * t) * 0.34;
    const b = Math.sin(TAU * 990 * t) * 0.2 * Math.exp(-t * 12);
    out[i] = (a + b) * env;
  }
  const lp = lowpass(out, 3200);
  writeWav('live.wav', lp);
}

// 湮灭碰撞：一记低频重击 + 一点噪声裂口
{
  const dur = 0.72;
  const n = Math.round(dur * SR);
  const out = new Array(n).fill(0);
  let phase = 0;
  const noise = lowpass(Array.from({ length: n }, () => rnd() * 2 - 1), 700);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 64 * Math.exp(-t * 5) + 34;
    phase += (TAU * f) / SR;
    const boom = Math.sin(phase) * Math.exp(-t * 4.2) * 0.95;
    const crack = (rnd() * 2 - 1) * Math.exp(-t * 38) * 0.22;
    out[i] = boom + noise[i] * Math.exp(-t * 7) * 0.35 + crack;
  }
  writeWav('impact.wav', out.map((v) => Math.tanh(v * 1.25)));
}

// UI 点击：随机/确认按钮用
{
  const dur = 0.075;
  const n = Math.round(dur * SR);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 75);
    out[i] = (Math.sin(TAU * 1500 * t) * 0.35 + (rnd() * 2 - 1) * 0.22) * env;
  }
  writeWav('click.wav', out);
}
