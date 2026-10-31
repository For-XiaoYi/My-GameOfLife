// 宣传片配乐 v7：恒速 120BPM，靠“加层”推进情绪；门进场给鼓，宏大结构给高潮，
// 随机演化降下来（慢 pad + 心跳），结尾回到 C 大调后硬切。
// 用法：node scripts/make-music.mjs [输出路径]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SR = 44100;
const B = {
  title: 0,
  rules: 4.0,
  stills: 14.0,
  osc: 20.0,
  gliderStill: 25.0,
  gliderLive: 29.0,
  gun: 38.0,
  switch: 46.0,
  black: 56.0,
  gates: 59.0,
  array: 69.0,
  turing: 75.0,
  grand: 84.0,
  random: 99.0,
  outro: 113.0,
};
const DUR = 125.0;
const CUT = 124.75;
const N = Math.round(SR * DUR);

let seed = 20261029;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const L = new Float32Array(N);
const R = new Float32Array(N);
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
const send = (i, v) => {
  if (i >= 0 && i < N) SEND[i] += v;
};

function onepole(cut) {
  let y = 0;
  const a = Math.exp((-2 * Math.PI * cut) / SR);
  return (x) => {
    y = (1 - a) * x + a * y;
    return y;
  };
}

function pad(t0, dur, notes, gain, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(N, Math.round((t0 + dur) * SR));
  const atk = 0.12 * SR;
  const rel = 0.2 * SR;
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
    const v = (s / notes.length) * gain * env * (0.9 + 0.1 * Math.sin((k / SR) * 0.7));
    add(i, v, pan);
    send(i, v * 0.6);
  }
}

function pluck(t0, note, gain, dur = 0.4, pan = 0) {
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

function bass(t0, note, dur, gain) {
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(N, Math.round((t0 + dur) * SR));
  const f = midi(note);
  const lp = onepole(220);
  for (let i = i0; i < i1; i++) {
    const k = (i - i0) / SR;
    const env = Math.min(1, k / 0.02) * Math.min(1, ((i1 - i) / SR) / 0.08);
    const ph = 2 * Math.PI * f * k;
    const raw = Math.sin(ph) + Math.sin(ph * 2) * 0.18 + Math.sin(ph * 3) * 0.07;
    add(i, lp(raw) * env * gain, 0);
  }
}

function kick(t0, gain = 0.42, len = 0.3) {
  const i0 = Math.round(t0 * SR);
  const n = Math.round(len * SR);
  for (let k = 0; k < n; k++) {
    const t = k / SR;
    const f = 46 + 150 * Math.exp(-t * 26);
    add(i0 + k, Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9.5) * gain, 0);
  }
}

function hat(t0, gain = 0.05, pan = 0.25) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(0.045 * SR);
  let prev = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const n = rnd() * 2 - 1;
    const hp = n - prev;
    prev = n;
    add(i0 + k, hp * Math.exp(-t * 85) * gain, pan);
  }
}

function snare(t0, gain = 0.12) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(0.14 * SR);
  const bp = onepole(2400);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const n = bp(rnd() * 2 - 1);
    const tone = Math.sin(2 * Math.PI * 190 * t) * 0.35;
    const v = (n * 0.8 + tone) * Math.exp(-t * 24) * gain;
    add(i0 + k, v, -0.05);
    send(i0 + k, v * 1.1);
  }
}

function thump(t0, gain = 0.42) {
  const i0 = Math.round(t0 * SR);
  const n = Math.round(0.5 * SR);
  for (let k = 0; k < n; k++) {
    const t = k / SR;
    const f = 120 * Math.exp(-t * 9) + 44;
    add(i0 + k, Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 7) * gain, 0);
  }
}

function riser(t0, dur = 0.6, gain = 0.13) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  let low = 0;
  for (let k = 0; k < len; k++) {
    const u = k / len;
    const n = rnd() * 2 - 1;
    const cut = 400 + 6000 * Math.pow(u, 2);
    const a = Math.exp((-2 * Math.PI * cut) / SR);
    low = (1 - a) * n + a * low;
    add(i0 + k, low * Math.pow(u, 2.2) * gain, 0);
  }
}

// ── 和声 ──────────────────────────────────────────────────────────────────
const CH = {
  Am: [57, 60, 64, 69],
  F: [53, 57, 60, 65],
  C: [48, 55, 60, 64],
  G: [55, 59, 62, 67],
};
const BASS_OF = { Am: 33, F: 29, C: 36, G: 31 };
const ARP = {
  Am: [69, 72, 76, 81],
  F: [65, 69, 72, 77],
  C: [64, 67, 72, 76],
  G: [67, 71, 74, 79],
};
const PROG = ['Am', 'F', 'C', 'G'];

const chordSegs = [];
for (let t = 0, k = 0; t < 56; t += 2.2, k++) {
  chordSegs.push([t, Math.min(56.2, t + 2.2), PROG[k % 4]]);
}
chordSegs.push([56, 59, 'Am']);
['Am', 'F', 'C', 'G', 'Am', 'F', 'C'].forEach((n, i) => {
  chordSegs.push([59 + i * 1.5, 59 + i * 1.5 + 1.5, n]);
});
['F', 'C', 'G', 'Am'].forEach((n, i) => {
  chordSegs.push([69 + i * 1.5, 69 + i * 1.5 + 1.5, n]);
});
chordSegs.push([75, 79, 'Am'], [79, 84, 'F']);
['F', 'C', 'G', 'Am', 'F'].forEach((n, i) => {
  chordSegs.push([84 + i * 3, 84 + i * 3 + 3, n]);
});
chordSegs.push([99, 106, 'Am'], [106, 113, 'F']);
chordSegs.push([113, 118, 'C'], [118, 122, 'F'], [122, 125, 'C']);

const chordAt = (t) => chordSegs.find(([a, b]) => t >= a && t < b)?.[2] ?? 'Am';

const padGain = (t) => {
  if (t < 56) return 0.165;
  if (t < 59) return 0.165;
  if (t < 69) return 0.145;
  if (t < 75) return 0.16;
  if (t < 84) return 0.18;
  if (t < 99) return 0.185;
  if (t < 113) return 0.13;
  return 0.18;
};
chordSegs.forEach(([t0, t1, name], i) => {
  pad(t0 - 0.05, t1 - t0 + 0.3, CH[name], padGain(t0), Math.sin(i * 0.9) * 0.18);
});

// 低音
const beats = (a, b) => {
  const out = [];
  for (let t = a; t < b - 0.02; t += 0.5) out.push(t);
  return out;
};
// 规则段（4–14s）：只留长低音，不铺每拍脉冲
bass(4, BASS_OF[chordAt(4)], 4.6, 0.17);
bass(9, BASS_OF[chordAt(9)], 4.6, 0.17);
beats(14, 56).forEach((t, i) => {
  const root = BASS_OF[chordAt(t)];
  bass(t, root, 0.4, 0.2);
  if (i % 2 === 1) bass(t + 0.25, root + 12, 0.18, 0.075);
});
// 黑屏 + 门：每次进场一根低音
[56, 59, 60.5, 62, 63.5, 65, 66.5, 68].forEach((t) => {
  bass(t, BASS_OF[chordAt(t)], 0.7, t === 56 ? 0.19 : 0.17);
});
// 阵列：每拍推进
beats(69, 75).forEach((t, i) => {
  bass(t, BASS_OF[chordAt(t)], 0.34, 0.16 + (i % 4) * 0.01);
});
// 图灵机：长音
bass(75, BASS_OF.Am, 3.6, 0.2);
bass(79, BASS_OF.F, 4.4, 0.2);
// 宏大结构：更重
[84, 87, 90, 93, 96].forEach((t) => bass(t, BASS_OF[chordAt(t)], 2.6, 0.23));
beats(85, 99).forEach((t, i) => {
  if (i % 2 === 0) bass(t + 0.25, BASS_OF[chordAt(t)] + 12, 0.2, 0.08);
});
// 随机：长音 + 心跳之间的空
bass(99, BASS_OF.Am, 6.5, 0.12);
bass(106, BASS_OF.F, 6.5, 0.12);
// 结尾：C 大调慢慢落
bass(113, BASS_OF.C, 4.6, 0.18);
bass(118, BASS_OF.F, 3.6, 0.16);
bass(122, BASS_OF.C, 2.6, 0.16);

// 琶音
for (let t = 14; t < 56; t += 0.125) {
  const name = chordAt(t);
  const notes = ARP[name];
  const k = Math.round(t / 0.125);
  pluck(t, notes[k % notes.length], 0.055, 0.22, ((k % 4) - 1.5) * 0.2);
}
// 门进场：每次一记高音
[59, 60.5, 62, 63.5].forEach((t, i) => {
  pluck(t, ARP[chordAt(t)][i % 4], 0.07, 0.3, i % 2 ? 0.2 : -0.2);
});
// 阵列：16 分爬升
for (let t = 69; t < 75; t += 0.125) {
  const k = Math.round((t - 69) / 0.125);
  const notes = ARP[chordAt(t)];
  pluck(t, notes[k % 4] + 12, 0.04 + Math.min(0.03, k * 0.0008), 0.18, ((k % 4) - 1.5) * 0.25);
}
// 图灵机：慢一点
for (let t = 75.5; t < 84; t += 0.25) {
  const k = Math.round((t - 75) / 0.25);
  pluck(t, ARP[chordAt(t)][k % 4], 0.04, 0.4, ((k % 4) - 1.5) * 0.25);
}
// 宏大结构：密
for (let t = 84; t < 99; t += 0.125) {
  const k = Math.round((t - 84) / 0.125);
  const notes = ARP[chordAt(t)];
  pluck(t, notes[k % 4], 0.045, 0.2, ((k % 4) - 1.5) * 0.3);
}
// 随机：稀疏高音
[102, 108, 111].forEach((t, i) => pluck(t, [76, 79, 84][i], 0.035, 0.5, 0.25));
// 结尾
[114, 119, 123].forEach((t, i) => pluck(t, [76, 79, 84][i], 0.04, 0.6, 0.1));

// ── 鼓 ─────────────────────────────────────────────────────────────────────
// 前 14 秒规则段不铺密集鼓点，把情绪让给规则本身
beats(14, 56).forEach((t, i) => {
  kick(t, 0.4);
  if (t >= 20) hat(t, 0.05);
  if (t >= 20) hat(t + 0.25, 0.03, -0.25);
  if (t >= 25 && i % 2 === 1) snare(t, 0.115);
});

// 黑屏提问：不做“突然掉下去”，用低脉冲接住前面的强度
thump(56, 0.42);
beats(56, 59).forEach((t) => kick(t, 0.24, 0.34));
// 门：进场四记重鼓 + 细碎脉冲
[59, 60.5, 62, 63.5].forEach((t, i) => {
  thump(t, i === 0 ? 0.72 : 0.56);
  kick(t, 0.42);
  hat(t + 0.25, 0.06);
  if (i === 1 || i === 3) snare(t, 0.13);
});
for (let t = 59; t < 69; t += 0.25) hat(t, 0.032, ((Math.round(t * 4) % 2) ? 0.25 : -0.25));
// 阵列：加密，推到图灵机
thump(69, 0.55);
beats(69, 75).forEach((t, i) => {
  kick(t, 0.56);
  hat(t, 0.065);
  hat(t + 0.25, 0.045, -0.25);
  if (i % 2 === 1) snare(t, 0.16);
});
riser(73.6, 1.4, 0.16);
// 图灵机：大鼓 + 慢拍
thump(75, 0.7);
beats(75, 84).forEach((t, i) => {
  if (i % 2 === 0) kick(t, 0.34);
  if (i % 4 === 2) snare(t, 0.11);
});
// 湮灭碰撞：在画面正中补一记
thump(49.4, 0.58);
snare(49.4, 0.18);
// 宏大结构：高潮
[84, 89, 94].forEach((t) => thump(t, 0.82));
beats(84, 99).forEach((t, i) => {
  kick(t, i % 2 === 0 ? 0.6 : 0.42);
  hat(t, 0.07);
  hat(t + 0.25, 0.05, -0.25);
  if (i % 2 === 1) snare(t, 0.17);
});
riser(82.6, 1.4, 0.16);
riser(97.6, 1.2, 0.10);
// 随机：心跳 60BPM
for (let t = 99; t < 113; t += 1.0) kick(t, 0.2, 0.36);
// 结尾：安静
thump(113, 0.34);

// ── 转场重音 + riser ───────────────────────────────────────────────────────
const CUES = [4, 14, 20, 25, 29, 36, 38, 46, 56, 59, 69, 75, 84, 99, 113];
CUES.forEach((c, i) => {
  if (c === 36) {
    riser(35.95, 1.9, 0.075);
    return;
  }
  if (c === 99) {
    thump(c, 0.22);
    return;
  }
  if (c > 4) riser(c - 0.55, 0.55, c === 84 || c === 75 ? 0.12 : 0.09);
  thump(c, c === 84 || c === 75 ? 0.55 : 0.32);
});
// 最后一下：C 大调收在硬切前
thump(124.2, 0.4);

// ── 混响 ──────────────────────────────────────────────────────────────────
function reverb(sendBuf, outL, outR) {
  const taps = [
    { d: Math.round(0.031 * SR), fb: 0.46, lp: 0.34, pan: -0.5 },
    { d: Math.round(0.047 * SR), fb: 0.42, lp: 0.42, pan: 0.55 },
    { d: Math.round(0.071 * SR), fb: 0.37, lp: 0.5, pan: 0.1 },
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
      outL[i] += wet * 0.26 * gl;
      outR[i] += wet * 0.26 * gr;
    }
  }
}
reverb(SEND, L, R);

// ── 母带 ──────────────────────────────────────────────────────────────────
const W = Math.round(0.4 * SR);
let env = 0;
const target = 0.14;
for (let i = 0; i < N; i++) {
  const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
  env = Math.max(x, env * (1 - 1 / W));
  const g = env > 1e-6 ? clamp(target / env, 0.55, 1.9) : 1;
  L[i] *= g;
  R[i] *= g;
}

let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.15);
  R[i] = Math.tanh(R[i] * 1.15);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = peak > 0 ? 0.9 / peak : 1;

// 段落动态：黑屏压低、门抬起、宏大最强、随机降下来、结尾回温
const GAIN_KEYS = [
  [0, 1], [55.5, 1], [56.6, 1.0], [58.6, 1.0], [59.6, 1.02],
  [68.5, 1.02], [69.6, 1.04], [74.4, 1.04], [75.6, 1.06], [83.4, 1.06],
  [84.6, 1.1], [98.4, 1.1], [100.0, 0.6], [112.4, 0.6], [113.6, 0.95], [125, 0.95],
];
function sectionGain(t) {
  for (let i = 1; i < GAIN_KEYS.length; i++) {
    const [t1, g1] = GAIN_KEYS[i];
    if (t <= t1) {
      const [t0, g0] = GAIN_KEYS[i - 1];
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return g0 + (g1 - g0) * u;
    }
  }
  return GAIN_KEYS[GAIN_KEYS.length - 1][1];
}

const fadeIn = Math.round(0.2 * SR);
const cutIdx = Math.round(CUT * SR);
const tail = Math.round(0.025 * SR);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let g = norm * sectionGain(t);
  if (i < fadeIn) g *= i / fadeIn;
  if (i >= cutIdx) g = 0;
  else if (i > cutIdx - tail) g *= (cutIdx - i) / tail;
  L[i] *= g;
  R[i] *= g;
}

// 段落后再查一次峰值，避免高潮处削波
let finalPeak = 0;
for (let i = 0; i < N; i++) finalPeak = Math.max(finalPeak, Math.abs(L[i]), Math.abs(R[i]));
if (finalPeak > 0.98) {
  const s = 0.98 / finalPeak;
  for (let i = 0; i < N; i++) {
    L[i] *= s;
    R[i] *= s;
  }
  finalPeak = 0.98;
}
console.log('最终峰值：', finalPeak.toFixed(2));

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
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36, 'ascii');
header.writeUInt32LE(data.length, 40);
writeFileSync(out, Buffer.concat([header, data]));

const stats = [];
for (let s = 0; s < DUR - 0.01; s += 4) {
  let sum = 0;
  let cnt = 0;
  for (let i = Math.round(s * SR); i < Math.min(N, Math.round((s + 4) * SR)); i++) {
    sum += L[i] * L[i] + R[i] * R[i];
    cnt += 2;
  }
  stats.push(`${s}s:${(Math.sqrt(sum / cnt)).toFixed(3)}`);
}
console.log(`✔ ${out} · ${DUR.toFixed(2)}s · 峰值 ${peak.toFixed(2)} · 硬切 ${CUT.toFixed(2)}s`);
console.log('RMS 曲线：', stats.join('  '));
