// 抖音竖版 60 秒配乐：借「开智的小曲」的底层结构，不抄旋律——
// 仪式感合唱 + 4 音动机 + 太鼓/808/拍手 + 段落 drop + 随机段的心跳与音乐盒。
// 用法：node scripts/make-douyin-music.mjs [输出路径]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SR = 44100;
const DUR = 60.0;
const CUT = 59.8;
const N = Math.round(SR * DUR);
const BPM = 90;
const BEAT = 60 / BPM;

const B = {
  hook: 0,
  rules: 4,
  glider: 10,
  gun: 14,
  switch: 20,
  gates: 28,
  array: 32,
  turing: 36,
  grand: 44,
  random: 52,
  end: 58,
};

let seed = 20261031;
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
  const atk = 0.2 * SR;
  const rel = 0.3 * SR;
  const lp = [onepole(800), onepole(1000), onepole(700)];
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
        const det = 1 + (d - 1) * 0.004;
        const ph = 2 * Math.PI * f * det * (k / SR) + phases[ni][d] * 6.283;
        const saw = Math.sin(ph) * 0.6 + Math.sin(ph * 2) * 0.25 + Math.sin(ph * 3) * 0.12;
        s += lp[d](saw) / (d + 1);
      }
    });
    const v = (s / notes.length) * gain * env;
    add(i, v, pan);
    send(i, v * 0.55);
  }
}

// 仪式感合唱：加法合成三个共振峰（啊音），三声部轻微失谐
function choir(t0, dur, notes, gain, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(N, Math.round((t0 + dur) * SR));
  const atk = 0.45 * SR;
  const rel = 0.65 * SR;
  const phases = notes.map(() => Array.from({ length: 3 }, () => rnd() * 6.283));
  const formant = (f, c, bw) => Math.exp(-Math.pow((f - c) / bw, 2));
  for (let i = i0; i < i1; i++) {
    const k = i - i0;
    const len = i1 - i0;
    const env = Math.min(1, k / atk) * Math.min(1, (len - k) / rel);
    if (env <= 0) continue;
    let s = 0;
    notes.forEach((n, ni) => {
      const f0 = midi(n);
      for (let h = 1; h <= 12; h++) {
        const f = f0 * h;
        if (f > SR / 2.4) break;
        const w =
          formant(f, 700, 150) +
          0.55 * formant(f, 1220, 200) +
          0.26 * formant(f, 2600, 340);
        if (w < 0.02) continue;
        for (let d = 0; d < 3; d++) {
          const det = 1 + (d - 1) * 0.0035;
          const vib = 1 + 0.0022 * Math.sin((2 * Math.PI * 4.8 * k) / SR + n);
          s +=
            Math.sin((2 * Math.PI * f * det * vib * k) / SR + phases[ni][d] + h * 0.7) *
            (w / h) *
            (0.8 + 0.2 * Math.sin(k / SR * 0.9));
        }
      }
    });
    const v = (s / (notes.length * 8)) * gain * env;
    add(i, v, pan);
    send(i, v * 1.4);
  }
}

function pluck(t0, note, gain, dur = 0.4, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(N, i0 + Math.round(dur * SR));
  const f = midi(note);
  for (let i = i0; i < i1; i++) {
    const k = (i - i0) / SR;
    const env = Math.exp(-k * 6.2) * Math.min(1, k / 0.004);
    const ph = 2 * Math.PI * f * k;
    const v = (Math.sin(ph) * 0.7 + Math.sin(ph * 2) * 0.22 + Math.sin(ph * 3) * 0.08) * env * gain;
    add(i, v, pan);
    send(i, v * 0.9);
  }
}

function musicBox(t0, note, gain, dur = 1.2, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(N, i0 + Math.round(dur * SR));
  const f = midi(note);
  for (let i = i0; i < i1; i++) {
    const k = (i - i0) / SR;
    const env = Math.exp(-k * 3.2) * Math.min(1, k / 0.006);
    const ph = 2 * Math.PI * f * k;
    const v =
      (Math.sin(ph) * 0.7 + Math.sin(ph * 2) * 0.3 + Math.sin(ph * 4.01) * 0.12 + Math.sin(ph * 6.9) * 0.05) *
      env *
      gain;
    add(i, v, pan);
    send(i, v * 1.2);
  }
}

function bell(t0, note, gain, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(N, i0 + Math.round(1.8 * SR));
  const f = midi(note);
  for (let i = i0; i < i1; i++) {
    const k = (i - i0) / SR;
    const env = Math.exp(-k * 1.8);
    const v =
      (Math.sin(2 * Math.PI * f * k) * 0.7 +
        Math.sin(2 * Math.PI * f * 2.01 * k) * 0.25 +
        Math.sin(2 * Math.PI * f * 3.9 * k) * 0.12) *
      env *
      gain;
    add(i, v, pan);
    send(i, v * 1.5);
  }
}

function bass(t0, note, dur, gain) {
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(N, Math.round((t0 + dur) * SR));
  const f = midi(note);
  const lp = onepole(240);
  for (let i = i0; i < i1; i++) {
    const k = (i - i0) / SR;
    const env = Math.min(1, k / 0.02) * Math.min(1, (i1 - i) / SR / 0.08);
    const ph = 2 * Math.PI * f * k;
    const raw = Math.sin(ph) + Math.sin(ph * 2) * 0.18 + Math.sin(ph * 3) * 0.07;
    add(i, lp(raw) * env * gain, 0);
  }
}

function eight08(t0, note, dur, gain, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(N, Math.round((t0 + dur) * SR));
  const f0 = midi(note);
  const f1 = midi(note + 12);
  for (let i = i0; i < i1; i++) {
    const k = (i - i0) / SR;
    const f = f0 + (f1 - f0) * Math.exp(-k * 16);
    const env = Math.min(1, k / 0.006) * Math.exp(-k * 2.6);
    const v = Math.tanh(Math.sin(2 * Math.PI * f * k) * 2.4) * env * gain;
    add(i, v, pan);
    send(i, v * 0.35);
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

function taiko(t0, gain = 0.4) {
  const i0 = Math.round(t0 * SR);
  const n = Math.round(0.55 * SR);
  for (let k = 0; k < n; k++) {
    const t = k / SR;
    const f = 88 * Math.exp(-t * 14) + 46;
    const body = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 5.2);
    const noise = (rnd() * 2 - 1) * Math.exp(-t * 28) * 0.18;
    const v = (body + noise) * gain;
    add(i0 + k, v, 0);
    send(i0 + k, v * 0.6);
  }
}

function clap(t0, gain = 0.15) {
  const i0 = Math.round(t0 * SR);
  const n = Math.round(0.18 * SR);
  const lp = onepole(3200);
  for (let k = 0; k < n; k++) {
    const t = k / SR;
    let env = 0;
    for (let j = 0; j < 3; j++) {
      const d = k - j * 0.012 * SR;
      if (d >= 0) env += Math.exp(-(d / SR) * 90) * (j === 0 ? 1 : 0.6);
    }
    const v = lp((rnd() * 2 - 1) * env) * gain;
    add(i0 + k, v, 0.05);
    send(i0 + k, v * 1.2);
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

function openHat(t0, gain = 0.06, pan = -0.2) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(0.12 * SR);
  let prev = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const n = rnd() * 2 - 1;
    const hp = n - prev;
    prev = n;
    add(i0 + k, hp * Math.exp(-t * 30) * gain, pan);
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
    const cut = 400 + 6500 * Math.pow(u, 2);
    const a = Math.exp((-2 * Math.PI * cut) / SR);
    low = (1 - a) * n + a * low;
    add(i0 + k, low * Math.pow(u, 2.2) * gain, 0);
    send(i0 + k, low * Math.pow(u, 2) * gain * 0.8);
  }
}

function breath(t0, dur = 1.6, gain = 0.06, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  let low = 0;
  for (let k = 0; k < len; k++) {
    const u = k / len;
    const n = rnd() * 2 - 1;
    const a = Math.exp((-2 * Math.PI * 900) / SR);
    low = (1 - a) * n + a * low;
    const env = Math.sin(Math.PI * Math.pow(u, 0.8));
    const v = low * env * gain;
    add(i0 + k, v, pan);
    send(i0 + k, v * 1.2);
  }
}

// ── 和声：D 弗里几亚 ──────────────────────────────────────────────────────
const CH = {
  Dm: [50, 57, 62, 65],
  Bb: [46, 53, 58, 62],
  Gm: [43, 50, 55, 58],
  A: [45, 52, 57, 61],
};
const ROOT = { Dm: 38, Bb: 34, Gm: 31, A: 33 };
const CHOIR = {
  Dm: [62, 65, 69],
  Bb: [58, 62, 65],
  Gm: [55, 58, 62],
  A: [57, 61, 64],
};
const MOTIF = [62, 65, 63, 62];

const segs = [
  [0, 4, 'Dm'],
  [4, 7, 'Dm'],
  [7, 10, 'Bb'],
  [10, 14, 'Dm'],
  [14, 17, 'Dm'],
  [17, 20, 'Bb'],
  [20, 23, 'Dm'],
  [23, 26, 'Bb'],
  [26, 28, 'Dm'],
  [28, 30, 'Gm'],
  [30, 32, 'A'],
  [32, 34, 'Bb'],
  [34, 36, 'A'],
  [36, 40, 'Dm'],
  [40, 44, 'Bb'],
  [44, 46, 'Dm'],
  [46, 48, 'Bb'],
  [48, 50, 'Gm'],
  [50, 52, 'A'],
  [52, 55, 'Dm'],
  [55, 58, 'Bb'],
  [58, 60, 'Dm'],
];
const chordAt = (t) => segs.find(([a, b]) => t >= a && t < b)?.[2] ?? 'Dm';

// pad + 合唱
segs.forEach(([t0, t1, name], i) => {
  pad(t0 - 0.05, t1 - t0 + 0.3, CH[name], t0 >= 52 ? 0.13 : t0 >= 44 ? 0.17 : 0.14, Math.sin(i * 0.8) * 0.2);
  choir(t0, t1 - t0 + 0.15, CHOIR[name], t0 >= 52 ? 0.09 : t0 >= 44 ? 0.13 : t0 >= 20 ? 0.11 : 0.08, Math.sin(i * 0.6) * 0.2);
});

// 低音 / 808
bass(0, ROOT.Dm, 3.8, 0.18);
bass(4, ROOT.Dm, 2.8, 0.16);
bass(7, ROOT.Bb, 2.8, 0.16);
bass(10, ROOT.Dm, 3.8, 0.18);
[14, 17, 20, 23, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50].forEach((t) => {
  eight08(t, ROOT[chordAt(t)], 1.5, t >= 44 ? 0.16 : 0.12, 0);
});
bass(52, ROOT.Dm, 5.6, 0.12);
bass(58, ROOT.Dm, 1.8, 0.2);

// 4 音动机：拨弦 + 钟
[0.7, 1.4, 2.1, 2.8].forEach((t, i) => {
  pluck(t, MOTIF[i], 0.1, 0.8, i % 2 ? 0.2 : -0.2);
});
[4.2, 8.2, 12.2, 16.2, 20.2, 24.2, 28.2, 32.2, 36.2, 40.2, 44.2, 48.2, 52.2].forEach((t, i) => {
  bell(t, [74, 77, 75, 74, 77, 75, 74, 77, 75, 74, 77, 75, 74][i], 0.035, i % 2 ? 0.25 : -0.25);
});

// 琶音
for (let t = 4; t < 14; t += 0.333) {
  const k = Math.round((t - 4) / 0.333);
  pluck(t, [62, 65, 69, 72, 69, 65][k % 6], 0.035, 0.28, ((k % 4) - 1.5) * 0.2);
}
for (let t = 14; t < 20; t += 0.1667) {
  const k = Math.round((t - 14) / 0.1667);
  pluck(t, [62, 65, 69, 74, 72, 69, 65, 63][k % 8], 0.04, 0.2, ((k % 4) - 1.5) * 0.25);
}
for (let t = 20; t < 28; t += 0.1667) {
  const k = Math.round((t - 20) / 0.1667);
  if (t >= 22.2 && t < 22.6) continue;
  pluck(t, [62, 65, 69, 74, 72, 69, 65, 63][k % 8], 0.035, 0.2, ((k % 4) - 1.5) * 0.25);
}
for (let t = 28; t < 32; t += 0.125) {
  const k = Math.round((t - 28) / 0.125);
  pluck(t, [55, 58, 62, 67, 65, 62, 58, 55][k % 8], 0.04, 0.16, ((k % 4) - 1.5) * 0.3);
}
for (let t = 32; t < 36; t += 0.1667) {
  const k = Math.round((t - 32) / 0.1667);
  pluck(t, [58, 62, 65, 70, 69, 65, 62, 61][k % 8], 0.04, 0.2, ((k % 4) - 1.5) * 0.25);
}
for (let t = 36; t < 44; t += 0.333) {
  const k = Math.round((t - 36) / 0.333);
  pluck(t, [62, 65, 69, 72, 69, 65][k % 6], 0.035, 0.4, ((k % 4) - 1.5) * 0.2);
}
for (let t = 44; t < 52; t += 0.125) {
  const k = Math.round((t - 44) / 0.125);
  pluck(t, [62, 65, 69, 74, 72, 69, 65, 63][k % 8], 0.04, 0.2, ((k % 4) - 1.5) * 0.3);
}

// ── 鼓 ───────────────────────────────────────────────────────────────────
// 0–4 钩子：只给心脏和呼吸
thump(0, 0.7);
taiko(0.9, 0.5);
breath(0, 2.2, 0.07, 0);
riser(3.1, 0.9, 0.07);

// 4–10 规则：太鼓 + 轻拍
[4, 5.333, 6.667, 8, 9.333].forEach((t, i) => {
  taiko(t, i === 0 ? 0.36 : 0.24);
  kick(t, 0.22, 0.26);
  if (i % 2 === 1) clap(t, 0.1);
});
for (let t = 4; t < 10; t += 0.333) hat(t, 0.018, ((Math.round(t * 3) % 2) ? 0.3 : -0.3));

// 10–14 滑翔机：推进
for (let t = 10; t < 14; t += BEAT) {
  kick(t, 0.4);
  clap(t + BEAT / 2, 0.09);
}
for (let t = 10; t < 14; t += 0.1667) hat(t, 0.035, ((Math.round(t * 6) % 2) ? 0.3 : -0.3));
riser(13.0, 1.0, 0.1);

// 14–20 滑翔枪：drop
[14, 17.333].forEach((t) => {
  taiko(t, 0.5);
  thump(t, 0.32);
});
for (let t = 14; t < 20; t += BEAT) {
  kick(t, 0.5);
  if (Math.round(t / BEAT) % 2 === 1) clap(t, 0.13);
}
for (let t = 14; t < 20; t += 0.1667) hat(t, 0.045, ((Math.round(t * 6) % 2) ? 0.3 : -0.3));
openHat(18.333, 0.05);
riser(19.0, 1.0, 0.12);

// 20–28 判断：最大 drop，22.4 的碰撞留空
[20, 20 + 4 / 3, 20 + 8 / 3].forEach((t) => taiko(t, 0.5));
for (let t = 20; t < 28; t += BEAT) {
  if (t >= 21.8 && t < 22.5) continue;
  kick(t, 0.52);
  if (Math.round(t / BEAT) % 2 === 1) clap(t, 0.14);
}
for (let t = 20; t < 28; t += 0.1667) {
  if (t >= 21.7 && t < 22.2) continue;
  hat(t, 0.04, ((Math.round(t * 6) % 2) ? 0.3 : -0.3));
}
thump(22.0, 0.85);
taiko(22.0, 0.6);
bell(22.15, 74, 0.05);
riser(26.6, 1.4, 0.13);

// 28–32 四种门：门一记
[28, 29, 30, 31].forEach((t, i) => {
  taiko(t, i === 0 ? 0.4 : 0.22);
  kick(t, 0.32);
  bell(t + 0.02, [74, 77, 75, 79][i], 0.03);
});
for (let t = 28; t < 32; t += 0.25) hat(t, 0.03, ((Math.round(t * 4) % 2) ? 0.3 : -0.3));

// 32–36 阵列：推进
for (let t = 32; t < 36; t += BEAT) {
  kick(t, 0.42);
  if (Math.round(t / BEAT) % 2 === 1) clap(t, 0.1);
}
for (let t = 32; t < 36; t += 0.1667) hat(t, 0.04, ((Math.round(t * 6) % 2) ? 0.3 : -0.3));
riser(35.0, 1.0, 0.11);

// 36–44 图灵机：半速重拍
[36, 40].forEach((t) => {
  taiko(t, 0.55);
  thump(t, 0.4);
});
for (let t = 36; t < 44; t += BEAT) {
  kick(t, 0.3);
  if (Math.round(t / BEAT) % 2 === 1) snare(t, 0.11);
}
for (let t = 36; t < 44; t += 0.333) hat(t, 0.025, ((Math.round(t * 3) % 2) ? 0.3 : -0.3));
riser(42.6, 1.4, 0.13);

// 44–52 宏大结构：全开
[44, 48].forEach((t) => {
  taiko(t, 0.72);
  thump(t, 0.55);
});
for (let t = 44; t < 52; t += BEAT) {
  kick(t, 0.55);
  if (Math.round(t / BEAT) % 2 === 1) clap(t, 0.16);
  hat(t + 0.1667, 0.05, ((Math.round(t * 6) % 2) ? 0.3 : -0.3));
}
for (let t = 44; t < 52; t += 0.1667) hat(t, 0.045, ((Math.round(t * 6) % 2) ? 0.3 : -0.3));
riser(51.0, 1.0, 0.12);

// 52–58 随机：鼓退，心跳 + 音乐盒
for (let t = 52; t < 57; t += 1.0) kick(t, 0.24, 0.36);
[52.4, 53.4, 54.4, 55.4, 56.4].forEach((t, i) => musicBox(t, [74, 77, 75, 74, 70][i], 0.05, 1.4, i % 2 ? 0.25 : -0.25));
breath(52, 3.2, 0.06, 0);
riser(56.2, 1.6, 0.14);

// 58–60 结尾：最后一击
thump(58, 0.8);
taiko(58, 0.6);
bell(58, 74, 0.07);
[58, 58 + 2 / 3, 58 + 4 / 3].forEach((t) => kick(t, 0.3, 0.3));

// ── 转场重音 ──────────────────────────────────────────────────────────────
const CUES = [4, 10, 14, 20, 28, 32, 36, 44, 52, 58];
CUES.forEach((c) => {
  if (c > 0) riser(c - 0.55, 0.55, c === 20 || c === 44 ? 0.12 : 0.08);
  thump(c, c === 20 || c === 44 || c === 58 ? 0.5 : 0.28);
});

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
const target = 0.15;
for (let i = 0; i < N; i++) {
  const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
  env = Math.max(x, env * (1 - 1 / W));
  const g = env > 1e-6 ? clamp(target / env, 0.55, 1.9) : 1;
  L[i] *= g;
  R[i] *= g;
}

let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.2);
  R[i] = Math.tanh(R[i] * 1.2);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = peak > 0 ? 0.9 / peak : 1;

const GAIN_KEYS = [
  [0, 0.9],
  [4, 0.82],
  [10, 0.9],
  [14, 1.0],
  [20, 1.05],
  [21.8, 1.05],
  [21.95, 0.18],
  [22.1, 0.55],
  [22.7, 1.0],
  [28, 1.0],
  [32, 1.04],
  [36, 1.02],
  [44, 1.12],
  [52, 0.68],
  [58, 1.02],
  [60, 1.02],
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

const fadeIn = Math.round(0.15 * SR);
const cutIdx = Math.round(CUT * SR);
const tail = Math.round(0.03 * SR);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let g = norm * sectionGain(t);
  if (i < fadeIn) g *= i / fadeIn;
  if (i >= cutIdx) g = 0;
  else if (i > cutIdx - tail) g *= (cutIdx - i) / tail;
  L[i] *= g;
  R[i] *= g;
}

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

const out = process.argv[2] || 'promo/public/music/douyin.wav';
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
