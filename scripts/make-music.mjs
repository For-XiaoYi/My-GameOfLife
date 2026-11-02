// 宣传片配乐：恒定速度、恒定响度，靠"加层"推进情绪，转场点给重音，最后硬收。
// 结构（秒）：标题 0 · 规则 4.0 · 静物 14.0 · 振荡子 22.667 · 滑翔机静态 30.667
//            实机 35.667 · 滑翔枪 42.667 · 逻辑电路 50.0 · 收尾 60.0 · 断 65.1
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
  circuits: 46.0,
  outro: 56.0,
};
const DUR = 61.5;
const CUT = 61.25;
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

/** 转场重音：低频一击，不喧宾夺主 */
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

// ── 和声：每 2.2 秒一个和弦，整片同一套进行 ────────────────────────────────
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
const CHORDS = [];
for (let t = 0, k = 0; t < DUR; t += 2.2, k++) {
  CHORDS.push([t, Math.min(DUR, t + 2.2), PROG[k % 4]]);
}
const chordAt = (t) => CHORDS.find(([a, b]) => t >= a && t < b)?.[2] ?? 'Am';

CHORDS.forEach(([t0, t1, name], i) => pad(t0 - 0.05, t1 - t0 + 0.3, CH[name], 0.165, Math.sin(i * 0.9) * 0.18));

const BEAT = 0.5;
const beats = (a, b) => {
  const out = [];
  for (let t = a; t < b - 0.02; t += BEAT) out.push(t);
  return out;
};

// 低音：从规则段开始一直到底，音量不变
beats(B.rules, B.outro + 2).forEach((t, i) => {
  const root = BASS_OF[chordAt(t)];
  bass(t, root, 0.4, 0.2);
  if (i % 2 === 1) bass(t + 0.25, root + 12, 0.18, 0.075);
});

// 琶音：16 分音符，音量恒定
for (let t = B.rules + 4; t < B.outro + 2; t += 0.125) {
  const name = chordAt(t);
  const notes = ARP[name];
  const k = Math.round(t / 0.125);
  pluck(t, notes[k % notes.length], 0.055, 0.22, ((k % 4) - 1.5) * 0.2);
}

// 鼓：一直保持同一力度，靠"加不加镲/军鼓"区分段落
beats(B.rules + 4, B.outro + 2).forEach((t, i) => {
  kick(t, 0.4);
  if (t >= B.osc) hat(t, 0.05);
  if (t >= B.osc) hat(t + 0.25, 0.03, -0.25);
  if (t >= B.gliderStill && i % 2 === 1) snare(t, 0.115);
});

// 转场重音 + 短 riser：全部卡在场景边界上
const CUES = [B.rules, B.stills, B.osc, B.gliderStill, B.gliderLive, B.gun, B.circuits, B.outro];
CUES.forEach((c, i) => {
  if (i > 0) riser(c - 0.55, 0.55, 0.1);
  thump(c, i === CUES.length - 1 ? 0.55 : 0.34);
});

// 收束：最后一小节只留 pad + 低音，然后硬切
impactEnd(CUT - 0.9);

function impactEnd(t0) {
  const i0 = Math.round(t0 * SR);
  const n = Math.round(1.2 * SR);
  let prev = 0;
  for (let k = 0; k < n; k++) {
    const t = k / SR;
    const f = 90 * Math.exp(-t * 3) + 32;
    const n2 = rnd() * 2 - 1;
    const hp = n2 - prev;
    prev = n2;
    const v = (Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 3.2) + hp * Math.exp(-t * 26) * 0.3) * 0.75;
    add(i0 + k, v, 0);
    send(i0 + k, v * 0.5);
  }
}

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

// ── 母带：轻压缩 → 归一 → 硬切 ─────────────────────────────────────────────
// 先做一遍慢速自动增益，抹平段落之间的响度差（避免忽大忽小）
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
const fadeIn = Math.round(0.2 * SR);
const cutIdx = Math.round(CUT * SR);
const tail = Math.round(0.025 * SR);
for (let i = 0; i < N; i++) {
  let g = norm;
  if (i < fadeIn) g *= i / fadeIn;
  if (i >= cutIdx) g = 0;
  else if (i > cutIdx - tail) g *= (cutIdx - i) / tail;
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
