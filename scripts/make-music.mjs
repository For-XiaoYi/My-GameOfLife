// 给宣传片合成一条配乐（科技 / 生命 / 蓬勃感）。
// 纯手写加法合成 + 简易混响，不依赖任何音频库，输出 16bit 立体声 WAV。
// 用法：node scripts/make-music.mjs [输出路径]
// 随机数用固定种子，所以每次跑出来的音频完全一样。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SR = 44100;
const DUR = 51.5;
const N = Math.round(SR * DUR);

// 固定种子的伪随机（保证可复现）
let seed = 20261029;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const L = new Float32Array(N);
const R = new Float32Array(N);
// 送混响的干声（两声道混合后统一加湿）
const SEND = new Float32Array(N);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

function add(i, v, pan = 0) {
  if (i < 0 || i >= N) return;
  const gl = Math.sqrt(0.5 * (1 - pan));
  const gr = Math.sqrt(0.5 * (1 + pan));
  L[i] += v * gl;
  R[i] += v * gr;
}
function send(i, v) {
  if (i < 0 || i >= N) return;
  SEND[i] += v;
}

// ── 乐器 ──────────────────────────────────────────────────────────────────
/** 一阶低通，返回处理函数（状态闭包） */
function onepole(cut) {
  let y = 0;
  const a = Math.exp((-2 * Math.PI * cut) / SR);
  return (x) => {
    y = (1 - a) * x + a * y;
    return y;
  };
}

/** 铺底 pad：三层失谐锯齿 + 五度，慢起慢落 */
function pad(t0, dur, notes, gain = 0.16, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(N, Math.round((t0 + dur) * SR));
  const atk = 0.07 * SR;
  const rel = 0.12 * SR;
  const lp = [onepole(900), onepole(1100), onepole(800)];
  const phases = notes.map(() => Array.from({ length: 3 }, () => rnd()));
  for (let i = i0; i < i1; i++) {
    const k = i - i0;
    const len = i1 - i0;
    const env = Math.min(1, k / atk) * Math.min(1, (len - k) / rel);
    if (env <= 0) continue;
    let s = 0;
    notes.forEach((n, ni) => {
      const f = midi(n);
      for (let d = 0; d < 3; d++) {
        const det = 1 + (d - 1) * 0.0035;
        const ph = 2 * Math.PI * f * det * (k / SR) + phases[ni][d] * 6.283;
        const saw = Math.sin(ph) * 0.6 + Math.sin(ph * 2) * 0.25 + Math.sin(ph * 3) * 0.12;
        s += lp[d](saw) / (d + 1);
      }
    });
    const v = (s / notes.length) * gain * env * (0.9 + 0.1 * Math.sin(k / SR * 0.7));
    add(i, v, pan);
    send(i, v * 0.6);
  }
}

/** 拨弦/琶音：三角波 + 二次谐波，快速衰减 */
function pluck(t0, note, gain = 0.1, dur = 0.5, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(N, i0 + Math.round(dur * SR));
  const f = midi(note);
  for (let i = i0; i < i1; i++) {
    const k = (i - i0) / SR;
    const env = Math.exp(-k * 6.5) * Math.min(1, k / 0.004);
    const ph = 2 * Math.PI * f * k;
    const v = (Math.sin(ph) * 0.7 + Math.sin(ph * 2) * 0.22 + Math.sin(ph * 3) * 0.08) * env * gain;
    add(i, v, pan);
    send(i, v * 0.9);
  }
}

/** 低音：正弦 + 轻微锯齿 */
function bass(t0, note, dur, gain = 0.22) {
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(N, Math.round((t0 + dur) * SR));
  const f = midi(note);
  const lp = onepole(220);
  for (let i = i0; i < i1; i++) {
    const k = (i - i0) / SR;
    const env = Math.min(1, k / 0.02) * Math.min(1, ((i1 - i) / SR) / 0.08);
    const ph = 2 * Math.PI * f * k;
    const raw = Math.sin(ph) + Math.sin(ph * 2) * 0.18 + Math.sin(ph * 3) * 0.07;
    const v = lp(raw) * env * gain;
    add(i, v, 0);
  }
}

/** 底鼓 */
function kick(t0, gain = 0.5) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(0.34 * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const f = 46 + 150 * Math.exp(-t * 26);
    const env = Math.exp(-t * 9.5);
    const ph = 2 * Math.PI * f * t;
    const v = Math.sin(ph) * env * gain;
    add(i0 + k, v, 0);
  }
}

/** 踩镲：白噪声高通 + 极短包络 */
function hat(t0, gain = 0.07, pan = 0.25) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(0.06 * SR);
  let prev = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const n = rnd() * 2 - 1;
    const hp = n - prev;
    prev = n;
    const v = hp * Math.exp(-t * 70) * gain;
    add(i0 + k, v, pan);
  }
}

/** 轻军鼓（噪声 + 一点音高） */
function snare(t0, gain = 0.16) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(0.16 * SR);
  const bp = onepole(2400);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const n = bp(rnd() * 2 - 1);
    const tone = Math.sin(2 * Math.PI * 190 * t) * 0.35;
    const v = (n * 0.8 + tone) * Math.exp(-t * 22) * gain;
    add(i0 + k, v, -0.05);
    send(i0 + k, v * 1.2);
  }
}

/** 提示音（UI tick）：高频短正弦 */
function tick(t0, freq = 2400, gain = 0.09, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(0.12 * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const env = Math.exp(-t * 34);
    const v = Math.sin(2 * Math.PI * freq * t) * env * gain;
    add(i0 + k, v, pan);
    send(i0 + k, v * 1.1);
  }
}

/** 呼啸：带通噪声扫频 */
function whoosh(t0, dur = 0.9, gain = 0.14, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  let prev = 0;
  let low = 0;
  for (let k = 0; k < len; k++) {
    const u = k / len;
    const t = k / SR;
    const n = rnd() * 2 - 1;
    const hp = n - prev;
    prev = n;
    // 用"低通高音→放行更多高频"近似扫频
    const cut = 400 + 5200 * Math.pow(u, 1.7);
    const a = Math.exp((-2 * Math.PI * cut) / SR);
    low = (1 - a) * hp + a * low;
    const env = Math.sin(Math.PI * Math.min(1, u)) ** 1.5;
    const v = low * env * gain;
    add(i0 + k, v, pan * (u - 0.5) * 2);
    send(i0 + k, v * 1.4);
  }
}

/** 上扬 riser：噪声 + 上滑音，用来做段落推进 */
function riser(t0, dur = 1.4, gain = 0.2) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  let low = 0;
  for (let k = 0; k < len; k++) {
    const u = k / len;
    const n = rnd() * 2 - 1;
    const cut = 300 + 7000 * Math.pow(u, 2.2);
    const a = Math.exp((-2 * Math.PI * cut) / SR);
    low = (1 - a) * n + a * low;
    const tone = Math.sin(2 * Math.PI * (220 * Math.pow(4, u)) * (k / SR)) * 0.25;
    const env = Math.pow(u, 2.6);
    const v = (low * 0.9 + tone) * env * gain;
    add(i0 + k, v, 0);
    send(i0 + k, v * 1.2);
  }
}

/** 闪光：高频钟铃簇，代表"生命点亮" */
function shimmer(t0, gain = 0.1, notes = [84, 88, 91, 96]) {
  notes.forEach((n, idx) => {
    const i0 = Math.round((t0 + idx * 0.055) * SR);
    const len = Math.round(1.8 * SR);
    const f = midi(n);
    for (let k = 0; k < len; k++) {
      const t = k / SR;
      const env = Math.exp(-t * 2.6) * Math.min(1, t / 0.01);
      const v = Math.sin(2 * Math.PI * f * t) * env * gain * 0.5;
      add(i0 + k, v, (idx - 1.5) * 0.4);
      send(i0 + k, v * 1.6);
    }
  });
}

// ── 编曲 ──────────────────────────────────────────────────────────────────
const CH = {
  Am: [57, 60, 64, 69],
  F: [53, 57, 60, 65],
  C: [48, 55, 60, 64],
  G: [55, 59, 62, 67],
};
const BASS_OF = { Am: 33, F: 29, C: 36, G: 31 };

// 和弦时间线（秒）——和六个场景对齐
const CHORDS = [
  [0.0, 4.8, 'Am'],
  [4.8, 7.2, 'Am'],
  [7.2, 9.6, 'F'],
  [9.6, 12.0, 'C'],
  [12.0, 14.4, 'G'],
  [14.4, 16.8, 'Am'],
  [16.8, 19.2, 'F'],
  [19.2, 21.6, 'C'],
  [21.6, 24.0, 'G'],
  [24.0, 26.4, 'Am'],
  [26.4, 28.8, 'C'],
  [28.8, 31.2, 'G'],
  [31.2, 33.6, 'Am'],
  [33.6, 36.0, 'F'],
  [36.0, 38.4, 'G'],
  [38.4, 40.8, 'Am'],
  [40.8, 43.2, 'F'],
  [43.2, 45.6, 'Am'],
  [45.6, 48.0, 'C'],
  [48.0, 51.5, 'Am'],
];

// 铺底：整片都有，越到后面越厚
CHORDS.forEach(([t0, t1, name], i) => {
  const gain = t0 < 4.8 ? 0.13 : t0 < 24 ? 0.15 : t0 < 37.4 ? 0.17 : t0 < 45.7 ? 0.15 : 0.19;
  pad(t0 - 0.15, t1 - t0 + 0.5, CH[name], gain, Math.sin(i * 0.9) * 0.25);
});

// 低音：从规则段开始，功能段加切分
CHORDS.forEach(([t0, t1, name]) => {
  if (t0 < 6.0) return;
  const root = BASS_OF[name];
  if (t0 < 24 || t0 >= 37.4) {
    bass(t0, root, t1 - t0 - 0.05, 0.2);
  } else {
    // 有节奏的段落：每拍一下，第二个落八分
    for (let t = t0; t < t1 - 0.05; t += 0.6) {
      bass(t, root, 0.5, 0.21);
      bass(t + 0.3, root + 12, 0.22, 0.1);
    }
  }
});

// 琶音：规则段起，速度随段落加快
const ARP = { Am: [69, 72, 76, 81], F: [65, 69, 72, 77], C: [64, 67, 72, 76], G: [67, 71, 74, 79] };
for (let i = 0; i < CHORDS.length; i++) {
  const [t0, t1, name] = CHORDS[i];
  if (t0 < 9.6) continue;
  const step = t0 < 24 ? 0.3 : t0 < 37.4 ? 0.15 : 0.3;
  const gain = t0 < 24 ? 0.075 : t0 < 37.4 ? 0.085 : 0.06;
  const notes = ARP[name];
  let k = 0;
  for (let t = t0; t < t1 - 0.02; t += step) {
    pluck(t, notes[k % notes.length], gain, 0.42, ((k % 4) - 1.5) * 0.25);
    k++;
  }
}

// 鼓：只在"能做什么"这一段给推动力
for (let t = 24.0; t < 37.3; t += 0.6) {
  const beat = Math.round((t - 24.0) / 0.6);
  if (beat % 2 === 0) kick(t, 0.42);
  hat(t + 0.3, 0.055, 0.3);
  if (beat % 4 === 2) snare(t, 0.13);
}
// 回溯段留一个稀疏的心跳
for (let t = 38.4; t < 45.4; t += 1.2) kick(t, 0.3);

// 段落推进：每个场景开头前一点来一发 riser
riser(3.6, 1.05, 0.16);
riser(13.9, 1.35, 0.2);
riser(23.2, 1.35, 0.22);
riser(35.9, 1.35, 0.24);
riser(44.9, 1.5, 0.26);

// 转场呼啸
whoosh(4.55, 0.85, 0.1, 0.2);
whoosh(15.2, 0.95, 0.12, -0.2);
whoosh(24.55, 0.9, 0.12, 0.15);
whoosh(37.2, 1.1, 0.13, -0.15);
whoosh(45.55, 1.0, 0.12, 0.1);

// 功能页每换一张截图来一声轻响（每张 74 帧 = 2.4667s）
for (let k = 0; k < 5; k++) tick(24.667 + k * 2.4667, 2200 + k * 160, 0.055, (k - 2) * 0.2);
// 规则页四段的判定音（140→460 帧，每段 80 帧 ≈ 2.667s）
for (let k = 0; k < 4; k++) tick(5.6 + k * 2.6667, 1320 + k * 110, 0.05, (k - 1.5) * 0.25);

// 生命点亮的闪光
shimmer(15.33, 0.09);
shimmer(24.67, 0.08);
shimmer(45.67, 0.11);
shimmer(49.2, 0.07, [81, 84, 88, 93]);

// ── 混响（三条并联反馈延迟 + 阻尼）─────────────────────────────────────────
function reverb(sendBuf, outL, outR) {
  const taps = [
    { d: Math.round(0.031 * SR), fb: 0.5, lp: 0.34, pan: -0.5 },
    { d: Math.round(0.047 * SR), fb: 0.45, lp: 0.42, pan: 0.55 },
    { d: Math.round(0.071 * SR), fb: 0.4, lp: 0.5, pan: 0.1 },
  ];
  for (const tap of taps) {
    const buf = new Float32Array(tap.d);
    let idx = 0;
    let damp = 0;
    const gl = Math.sqrt(0.5 * (1 - tap.pan));
    const gr = Math.sqrt(0.5 * (1 + tap.pan));
    for (let i = 0; i < sendBuf.length; i++) {
      const wet = buf[idx];
      damp = wet * (1 - tap.lp) + damp * tap.lp;
      buf[idx] = sendBuf[i] + damp * tap.fb;
      idx = (idx + 1) % tap.d;
      outL[i] += wet * 0.3 * gl;
      outR[i] += wet * 0.3 * gr;
    }
  }
}
reverb(SEND, L, R);

// ── 母带：软限幅 + 归一化 + 淡入淡出 ─────────────────────────────────────
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.15);
  R[i] = Math.tanh(R[i] * 1.15);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = peak > 0 ? 0.89 / peak : 1;
const fadeIn = Math.round(0.35 * SR);
const fadeOut = Math.round(1.8 * SR);
for (let i = 0; i < N; i++) {
  let g = norm;
  if (i < fadeIn) g *= i / fadeIn;
  if (i > N - fadeOut) g *= Math.max(0, (N - i) / fadeOut) ** 1.4;
  L[i] *= g;
  R[i] *= g;
}

// ── 写 WAV ────────────────────────────────────────────────────────────────
const out = process.argv[2] || 'promo/public/music/score.wav';
mkdirSync(dirname(resolve(out)), { recursive: true });

const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(clamp(Math.round(L[i] * 32767), -32768, 32767), i * 4);
  data.writeInt16LE(clamp(Math.round(R[i] * 32767), -32768, 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0, 'ascii');
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8, 'ascii');
header.write('fmt ', 12, 'ascii');
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(2, 22); // 立体声
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36, 'ascii');
header.writeUInt32LE(data.length, 40);

writeFileSync(out, Buffer.concat([header, data]));

// 简单体检：每 5 秒的 RMS，确认没有静音段也没有爆掉
const stats = [];
for (let s = 0; s < DUR; s += 5) {
  let sum = 0;
  let cnt = 0;
  for (let i = Math.round(s * SR); i < Math.min(N, Math.round((s + 5) * SR)); i++) {
    sum += L[i] * L[i] + R[i] * R[i];
    cnt += 2;
  }
  stats.push(`${s}s:${(Math.sqrt(sum / cnt)).toFixed(3)}`);
}
console.log(`✔ ${out} · ${DUR}s · 峰值 ${peak.toFixed(2)} → 归一 ${norm.toFixed(2)}`);
console.log('RMS 曲线：', stats.join('  '));
