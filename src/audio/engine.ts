/**
 * engine.ts — 背景音乐与音效（纯 Web Audio，现场合成，不加载任何音频文件）。
 *
 * 音色与和声直接沿用宣传片配乐 `scripts/make-music.mjs`：
 * 同一套 Am–F–C–G 进行、sawtooth 叠出来的 pad（低通 ~900Hz）、三角波 pluck、
 * 220Hz 低通的正弦 bass，以及 kick / hat / snare 的合成方式。
 * 区别是宣传片"按时间表渲染成 wav"，这里是"按画布状态实时调度"，所以节奏和配器
 * 能跟着生命走：
 *
 *   void   死寂   空世界：只剩一记很深的长音，和很久才出现一次的远处回声
 *   calm   平静   有细胞但平稳：pad + 低音 + 八分音符琶音，没有鼓
 *   bloom  绽放   细胞在快速增多：速度拉起来、十六分音符、鼓组进场、pad 变亮
 *   cosmic 悠远   镜头拉到世界之外：慢、空、长混响，像在俯瞰
 *
 * 判断用人口的一阶差分（增长率）和二阶差分（加速度），并除以人口取相对值，
 * 这样一张大网轻微波动不会被误判成"爆发"，而放下一个图案能立刻点亮。
 * 音效只挂在手动操作上：演化本身不出声，否则每秒几百代会糊成噪音。
 */

export type MusicMode = 'void' | 'calm' | 'bloom' | 'cosmic';

export type SfxName =
  | 'birth'
  | 'death'
  | 'stamp'
  | 'erase'
  | 'clear'
  | 'random'
  | 'undo'
  | 'redo'
  | 'play'
  | 'pause'
  | 'whoosh'
  | 'click';

export interface SoundSettings {
  muted: boolean;
  /** 0..1 */
  music: number;
  /** 0..1 */
  sfx: number;
}

const STORAGE_KEY = 'life-studio:sound';
const DEFAULT_SETTINGS: SoundSettings = { muted: false, music: 0.7, sfx: 0.8 };

const TICK_MS = 30;
/** 提前多久把音符排进音频线程 */
const LOOKAHEAD = 0.18;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** 和声表：和宣传片 scripts/make-music.mjs 里的 CH / BASS_OF / ARP 一致 */
const CHORDS: Record<string, { pad: number[]; bass: number; arp: number[] }> = {
  Am: { pad: [57, 60, 64, 69], bass: 33, arp: [69, 72, 76, 81] },
  F: { pad: [53, 57, 60, 65], bass: 29, arp: [65, 69, 72, 77] },
  C: { pad: [48, 55, 60, 64], bass: 36, arp: [64, 67, 72, 76] },
  G: { pad: [55, 59, 62, 67], bass: 31, arp: [67, 71, 74, 79] },
};
const PROGRESSION = ['Am', 'F', 'C', 'G'];

export class SoundEngine {
  settings: SoundSettings = { ...DEFAULT_SETTINGS };

  /** 给界面看的实时状态 */
  mode: MusicMode = 'void';
  tempo = 96;
  pulse = 0;
  space = 0;
  /** 0..1 律动期：连续放图案 / 大量画细胞冲上去，停手后慢慢退回正常算法 */
  groove = 0;
  rate = 0;
  population = 0;

  /** 自动化测试用：各类音符排了多少次（resetDebugCounts 清零） */
  readonly debugCounts = {
    kick: 0,
    hat: 0,
    snare: 0,
    tom: 0,
    clap: 0,
    pluck: 0,
    bass: 0,
    pad: 0,
  };

  private ctx: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private unlocked = false;
  private visible = true;
  private timer: number | null = null;

  // 调度状态
  private nextStep = 0;
  private step = 0;
  private chordIdx = 0;
  private padHz = 900;
  private drumEnergy = 0;
  private arpEnergy = 0;
  /** 上一次真正铺 pad 的时刻，避免切模式时和按小节排的 pad 撞在一起 */
  private lastPadAt = 0;

  // 环境采样
  private lastPop = 0;
  private lastSampleAt = 0;
  private prevRate = 0;
  private accel = 0;
  private zeroSince = 0;
  private editSpike = 0;
  private grooveUntil = 0;

  // 绘画音效节流
  private lastPaintAt = 0;
  private paintAccum = 0;

  // ── 生命周期 ────────────────────────────────────────────────

  /** 读本地设置；不创建 AudioContext（要等一个用户手势） */
  init(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as Partial<SoundSettings>;
        this.settings = {
          muted: !!v.muted,
          music: clamp(Number(v.music ?? DEFAULT_SETTINGS.music), 0, 1),
          sfx: clamp(Number(v.sfx ?? DEFAULT_SETTINGS.sfx), 0, 1),
        };
      }
    } catch {
      /* 读不出来就用默认值 */
    }
  }

  /** 有没有真正把音频跑起来（浏览器可能要等到用户手势） */
  get active(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get supported(): boolean {
    return typeof window !== 'undefined' && !!(window.AudioContext || webkitCtor());
  }

  /**
   * 解锁音频。浏览器要求用户手势之后才能出声，所以第一次点按/按键时调用，
   * 之后再调用只是 resume。失败就安静地退回无声，不影响游戏。
   */
  unlock(): void {
    if (!this.supported) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? webkitCtor();
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.buildGraph();
        this.unlocked = true;
      }
      void this.ctx.resume();
      this.applyVolumes();
      this.startScheduler();
    } catch {
      this.ctx = null;
      this.unlocked = false;
    }
  }

  /** 切到后台就挂起音频，回来再恢复（省电，也避免调度器被节流后音画错位） */
  setPageVisible(visible: boolean): void {
    this.visible = visible;
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (!visible) void ctx.suspend();
      else if (this.unlocked) void ctx.resume();
    } catch {
      /* ignore */
    }
  }

  setSettings(patch: Partial<SoundSettings>): void {
    this.settings = {
      muted: patch.muted ?? this.settings.muted,
      music: patch.music !== undefined ? clamp(patch.music, 0, 1) : this.settings.music,
      sfx: patch.sfx !== undefined ? clamp(patch.sfx, 0, 1) : this.settings.sfx,
    };
    this.save();
    this.applyVolumes();
  }

  toggleMute(): boolean {
    this.setSettings({ muted: !this.settings.muted });
    return this.settings.muted;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* 隐私模式写不了就算了 */
    }
  }

  private buildGraph(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);

    const musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(master);
    const sfxBus = ctx.createGain();
    sfxBus.gain.value = 0;
    sfxBus.connect(master);

    // 混响：用生成的噪声脉冲，代替宣传片里那三条反馈延迟
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = Math.random() * 2 - 1;
        // 一阶低通把尾巴压暗，听起来更"远"
        lp = lp * 0.72 + n * 0.28;
        data[i] = lp * Math.pow(1 - t, 2.4);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const reverbIn = ctx.createGain();
    reverbIn.gain.value = 0.32;
    reverbIn.connect(conv);
    conv.connect(musicBus);

    // 噪声源（hat / snare / whoosh 共用一块缓冲）
    const noiseLen = Math.floor(ctx.sampleRate * 1.2);
    const noise = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;

    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    this.reverbIn = reverbIn;
    this.analyser = analyser;
    this.noiseBuf = noise;
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.sfxBus) return;
    const now = ctx.currentTime;
    const mute = this.settings.muted ? 0 : 1;
    // 人耳对音量是对数的：平方后再乘系数，滑杆前半段才不是"一调就没了"
    const musicGain = Math.pow(this.settings.music, 1.7) * 0.62 * mute;
    const sfxGain = Math.pow(this.settings.sfx, 1.7) * 0.85 * mute;
    this.musicBus.gain.setTargetAtTime(musicGain, now, 0.12);
    this.sfxBus.gain.setTargetAtTime(sfxGain, now, 0.06);
  }

  /**
   * 音符播完就把这条链路从音频图上摘掉。
   * 不摘的话，挂机几个小时会攒下几万个空转的 gain / filter 节点；
   * Chrome 会自动回收"已经结束的音源"，但下游节点不会自己走。
   */
  private free(src: AudioScheduledSourceNode, ...rest: AudioNode[]): void {
    src.onended = () => {
      try {
        src.disconnect();
      } catch {
        /* 已经断开就算了 */
      }
      for (const n of rest) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
  }

  // ── 环境感知 ────────────────────────────────────────────────

  /**
   * 主循环每隔约 200ms 喂一次画布状态。
   * 增长率 g = dP/dt，加速度 a = dg/dt，都做指数平滑；用 max(400, 人口) 归一化，
   * 于是"放下一个五格滑翔机"和"一张大网自然波动"的响应是同一量级。
   */
  observe(population: number, scale: number): void {
    const now = performance.now();
    const dt = this.lastSampleAt ? (now - this.lastSampleAt) / 1000 : 0;
    if (dt > 0.04 && dt < 2) {
      const rawRate = (population - this.lastPop) / dt;
      this.rate = this.rate * 0.7 + rawRate * 0.3;
      const rawAccel = (this.rate - this.prevRate) / dt;
      this.prevRate = this.rate;
      this.accel = this.accel * 0.72 + rawAccel * 0.28;
    }
    this.lastPop = population;
    this.lastSampleAt = now;
    this.population = population;

    if (population === 0) {
      if (!this.zeroSince) this.zeroSince = now;
    } else {
      this.zeroSince = 0;
    }
    if (this.editSpike > 0) this.editSpike = Math.max(0, this.editSpike - dt * 0.9);

    const denom = Math.max(400, population);
    const growth = Math.max(0, this.rate) / denom;
    const push = Math.max(0, this.accel) / denom;
    const target = clamp(growth * 7 + push * 5 + this.editSpike * 0.55, 0, 1);
    // 增长时跟得紧，回落时慢一点，听起来才像"呼吸"而不是抽搐
    this.pulse += (target - this.pulse) * (target > this.pulse ? 0.34 : 0.09);

    // 镜头拉远：0.55 以下开始，0.25 左右全开（0.55 大约已经能看到 2×2 个世界）
    const spaceTarget = clamp((0.55 - scale) / 0.3, 0, 1);
    this.space += (spaceTarget - this.space) * 0.22;

    const empty = population === 0 && now - this.zeroSince > 1200;
    const nextMode: MusicMode = this.space > 0.55 ? 'cosmic' : empty ? 'void' : this.pulse > 0.35 ? 'bloom' : 'calm';
    if (nextMode !== this.mode) {
      this.mode = nextMode;
      this.onModeChange();
    }

    // 律动期：手动加入细胞会在 kickGroove() 里把截至时间往后推；
    // 冲上去要快（像被点亮），退回来要慢（"持续一会儿后…回归正常算法"）
    const grooveTarget = now < this.grooveUntil ? 1 : 0;
    this.groove += (grooveTarget - this.groove) * (grooveTarget > this.groove ? 0.3 : 0.07);
  }

  /**
   * 手动操作（放图案、连着画细胞）推进"律动期"。
   * 一次操作 4~6 秒；期间再有操作就续上，停手后大约 4 秒淡回正常。
   */
  kickGroove(strength = 1): void {
    const now = performance.now();
    const hold = 3600 + 1600 * Math.min(1, strength);
    this.grooveUntil = Math.max(this.grooveUntil, now + hold);
    this.groove = Math.min(1, this.groove + 0.3 * strength);
  }

  resetDebugCounts(): void {
    for (const k of Object.keys(this.debugCounts) as Array<keyof typeof this.debugCounts>) {
      this.debugCounts[k] = 0;
    }
  }

  /**
   * 切模式时立刻给出一个"新音色"，而不是等下一小节。
   * 否则拉远镜头之后最多要等十几秒才听到悠远，交互上像是坏了。
   */
  private onModeChange(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.visible) return;
    const now = ctx.currentTime;
    // 模式切换时一定要出声，只有"刚好在同一个十六分音符上"才让路
    if (now - this.lastPadAt < 0.35) return;
    const time = now + 0.06;
    const beatDur = 60 / this.tempo;
    if (this.mode === 'void') {
      this.bassNote(33, time, 8, 0.022);
      return;
    }
    const chord = CHORDS[PROGRESSION[this.chordIdx]!]!;
    const cosmic = this.mode === 'cosmic';
    this.pad(chord.pad, time, beatDur * 4 * (cosmic ? 1.6 : 1.05), cosmic ? 0.022 : this.mode === 'bloom' ? 0.13 : 0.12, cosmic ? 1.8 : 0.8);
    this.bassNote(chord.bass, time, beatDur * (cosmic ? 5 : 2.4), cosmic ? 0.075 : 0.14);
  }

  // ── 目标参数（随模式平滑过渡） ──────────────────────────────

  private tempoTarget(): number {
    if (this.mode === 'cosmic') return 64;
    if (this.mode === 'void') return 58;
    const base = this.mode === 'bloom' ? 108 + 42 * this.pulse : 102;
    // 律动期整体再抬一点，听起来像"被推起来了"
    return base + 8 * this.groove;
  }

  private padTarget(): number {
    if (this.mode === 'cosmic') return 620;
    if (this.mode === 'bloom') return 900 + 750 * this.pulse;
    return 900 + 260 * this.groove;
  }

  private drumTarget(): number {
    if (this.mode === 'bloom') return Math.min(1, 0.62 + 0.38 * this.pulse + 0.18 * this.groove);
    if (this.mode === 'calm') return Math.min(1, 0.45 + 0.2 * this.pulse + 0.25 * this.groove);
    return 0;
  }

  private arpTarget(): number {
    if (this.mode === 'void') return 0;
    if (this.mode === 'cosmic') return 0.42;
    const base = this.mode === 'bloom' ? 0.92 : 0.5;
    return Math.min(1, base + 0.45 * this.groove);
  }

  /** 混响送出量：越远越湿 */
  private reverbTarget(): number {
    return this.mode === 'cosmic' ? 0.62 : this.mode === 'void' ? 0.5 : 0.3;
  }

  // ── 调度器 ──────────────────────────────────────────────────

  private startScheduler(): void {
    if (this.timer !== null) return;
    const ctx = this.ctx;
    if (!ctx) return;
    this.nextStep = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.visible) return;

    // 静音或音乐音量归零时不必再排音符：省电，取消静音后下一拍就接上
    if (this.settings.muted || this.settings.music <= 0.001) {
      this.nextStep = ctx.currentTime + 0.08;
      return;
    }

    // 从后台回来时时钟已经跳过去了，别把一堆过期音符挤在一起补
    if (this.nextStep < ctx.currentTime) this.nextStep = ctx.currentTime + 0.05;

    const horizon = ctx.currentTime + LOOKAHEAD;
    let guard = 0;
    while (this.nextStep < horizon && guard++ < 64) {
      this.scheduleStep(this.step, this.nextStep);
      this.nextStep += 60 / this.tempo / 4;
      this.step++;
    }

    // 参数平滑：一次走一小步，听起来是渐变而不是切换
    const k = 0.07;
    this.tempo += (this.tempoTarget() - this.tempo) * k;
    this.padHz += (this.padTarget() - this.padHz) * k;
    this.drumEnergy += (this.drumTarget() - this.drumEnergy) * k;
    this.arpEnergy += (this.arpTarget() - this.arpEnergy) * k;
    if (this.reverbIn) {
      this.reverbIn.gain.setTargetAtTime(this.reverbTarget(), ctx.currentTime, 0.4);
    }
  }

  /** 一个十六分音符步 */
  private scheduleStep(step: number, time: number): void {
    const mode = this.mode;

    // ── 死寂：不铺和声，只有一记很深的长音 + 一下一下的微弱心跳
    if (mode === 'void') {
      if (step % 8 === 0) this.kick(time, 0.055);
      if (step % 8 === 1) this.kick(time, 0.03);
      if (step % 32 === 0) this.bassNote(33, time, 8, 0.022);
      if (step % 64 === 40 && Math.random() < 0.5) this.pluck(81, time, 0.014, 2.2, 0.25);
      return;
    }

    const beatDur = 60 / this.tempo;
    const inBar = step % 16;
    const chordEvery = 16;
    const chordName = PROGRESSION[this.chordIdx]!;
    const chord = CHORDS[chordName]!;

    // ── 和声：每小节换一次，pad 一直铺着（悠远时铺得更长、更慢）
    if (step % chordEvery === 0) {
      // 刚在切模式时铺过就跳过，避免两层 pad 叠在一起突然变响
      if (time - this.lastPadAt > 0.7) {
        const cosmic = mode === 'cosmic';
        const dur = beatDur * 4 * (cosmic ? 1.6 : 1.05);
        const gain = cosmic ? 0.022 : mode === 'bloom' ? 0.13 : 0.12;
        this.pad(chord.pad, time, dur, gain, cosmic ? 1.8 : 0.8);
        this.bassNote(chord.bass, time, beatDur * (cosmic ? 5 : 2.4), cosmic ? 0.075 : 0.14);
      }
      this.chordIdx = (this.chordIdx + 1) % PROGRESSION.length;
    }

    if (mode === 'cosmic') {
      // 悠远：很稀疏的高音，慢慢亮起来又慢慢散掉
      if (step % 16 === 0) {
        const notes = chord.arp;
        const n = notes[(step / 16) % notes.length]! + 24;
        this.pluck(n, time, 0.02, 2.4, ((step / 16) % 2 ? 0.3 : -0.3));
      }
      if (inBar === 0 && Math.random() < 0.5) this.shimmer(chord.arp[0]! + 24, time, 0.016);
      return;
    }

    // ── 低音：平静时半小节一次，绽放时每拍都有存在感
    if (mode === 'bloom' && inBar % 4 === 2) {
      this.bassNote(chord.bass + 12, time, beatDur * 0.35, 0.05 + 0.03 * this.pulse);
    }

    // ── 琶音：平静八分音符，绽放/律动期十六分音符
    const arpEvery = this.arpEnergy > 0.88 ? 1 : this.arpEnergy > 0.7 ? 2 : 4;
    if (inBar % arpEvery === 0) {
      const idx = Math.floor(step / arpEvery) % chord.arp.length;
      const note = chord.arp[idx]! + (mode === 'bloom' ? 12 : 0);
      const gain = (mode === 'bloom' ? 0.05 : 0.045) * (0.55 + this.arpEnergy * 0.45);
      this.pluck(note, time, gain, mode === 'bloom' ? 5.6 : 7, [(-0.3), 0.3, -0.1, 0.1][idx] ?? 0);
    }

    // ── 鼓组：放入细胞之后就有稳定的底鼓 + 踩镲，人口加速时再加密
    const drums = this.drumEnergy;
    if (drums > 0.02) {
      if (inBar % 8 === 0) this.kick(time, 0.12 + 0.16 * drums);
      if (inBar % 8 === 4 && drums > 0.55) this.kick(time, 0.07 + 0.09 * drums);
      if (inBar % 2 === 1) this.hat(time, 0.01 + 0.026 * drums, inBar % 4 === 1 ? 0.25 : -0.22);
      if (drums > 0.55 && (inBar === 4 || inBar === 12)) this.snare(time, 0.035 + 0.05 * drums);
    }

    // ── 律动期：桶鼓、拍手、反拍低音，像一段小型的"加花"
    const g = this.groove;
    if (g > 0.15) {
      if (inBar % 4 === 2) this.tom(time, 156 - 16 * Math.floor(inBar / 4), 0.055 * g);
      if (inBar === 4 || inBar === 12) this.clap(time, 0.05 * g);
      if (inBar % 4 === 3) this.bassNote(chord.bass + 12, time, beatDur * 0.16, 0.05 * g);
      if (inBar === 15) this.hat(time, 0.028 * g, -0.3);
    }
  }

  // ── 乐器 ────────────────────────────────────────────────────

  /** 叠三层略微失谐的锯齿波过低通，就是宣传片里的 pad */
  private pad(notes: number[], time: number, dur: number, gain: number, attack: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.reverbIn) return;
    this.debugCounts.pad++;
    this.lastPadAt = time;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.padHz;
    filter.Q.value = 0.5;
    const g = ctx.createGain();
    const peak = Math.max(0.0002, gain);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + attack);
    g.gain.setValueAtTime(peak, time + Math.max(attack, dur * 0.62));
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    filter.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverbIn);
    const oscs: OscillatorNode[] = [];
    for (const note of notes) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(note);
        o.detune.value = detune;
        o.connect(filter);
        o.start(time);
        o.stop(time + dur + 0.06);
        oscs.push(o);
      }
    }
    // 第一个音源结束时把整条 pad 链路摘掉
    const first = oscs[0];
    if (first) this.free(first, filter, g, ...oscs.slice(1));
  }

  private pluck(note: number, time: number, gain: number, decay: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.reverbIn) return;
    this.debugCounts.pluck++;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiHz(note);
    const g = ctx.createGain();
    const peak = Math.max(0.0002, gain);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 1.4 / decay);
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    o.connect(g);
    g.connect(p);
    p.connect(this.musicBus);
    p.connect(this.reverbIn);
    o.start(time);
    o.stop(time + 1.6 / decay);
    this.free(o, g, p);
  }

  private bassNote(note: number, time: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    this.debugCounts.bass++;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = midiHz(note);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midiHz(note - 12);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    const peak = Math.max(0.0002, gain);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.02);
    g.gain.setValueAtTime(peak, time + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(lp);
    sub.connect(lp);
    lp.connect(g);
    g.connect(this.musicBus);
    // 低音也送一点混响：死寂/悠远时那记长音才有"远处"的空间感
    if (this.reverbIn) g.connect(this.reverbIn);
    o.start(time);
    sub.start(time);
    o.stop(time + dur + 0.05);
    sub.stop(time + dur + 0.05);
    this.free(o, sub, lp, g);
  }

  private kick(time: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    this.debugCounts.kick++;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(196, time);
    o.frequency.exponentialRampToValueAtTime(46, time + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);
    o.connect(g);
    g.connect(this.musicBus);
    o.start(time);
    o.stop(time + 0.36);
    this.free(o, g);
  }

  private hat(time: number, gain: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.noiseBuf) return;
    this.debugCounts.hat++;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    src.connect(hp);
    hp.connect(g);
    g.connect(p);
    p.connect(this.musicBus);
    src.start(time);
    src.stop(time + 0.06);
    this.free(src, hp, g, p);
  }

  private snare(time: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.noiseBuf) return;
    this.debugCounts.snare++;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.musicBus);
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.value = 190;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(gain * 0.5, time);
    bg.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);
    body.connect(bg);
    bg.connect(this.musicBus);
    src.start(time);
    src.stop(time + 0.18);
    body.start(time);
    body.stop(time + 0.12);
    this.free(src, bp, g);
    this.free(body, bg);
  }

  /** 桶鼓：比底鼓高、比军鼓低，律动期用来补反拍 */
  private tom(time: number, hz: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    this.debugCounts.tom++;
    const base = Math.max(70, hz);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(base, time);
    o.frequency.exponentialRampToValueAtTime(base * 0.62, time + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.26);
    o.connect(g);
    g.connect(this.musicBus);
    o.start(time);
    o.stop(time + 0.28);
    this.free(o, g);
  }

  /** 拍手：三下短噪声叠在一起，律动期替军鼓加一层"电子感" */
  private clap(time: number, gain: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    const noise = this.noiseBuf;
    if (!ctx || !bus || !noise) return;
    this.debugCounts.clap++;
    for (let i = 0; i < 3; i++) {
      const t = time + i * 0.011;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1250;
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.max(0.0002, gain) * (i === 2 ? 1 : 0.65), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      src.connect(bp);
      bp.connect(g);
      g.connect(bus);
      src.start(t);
      src.stop(t + 0.1);
      this.free(src, bp, g);
    }
  }

  /** 悠远模式下偶尔出现的高音闪光：慢起慢落，几乎全给混响 */
  private shimmer(note: number, time: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.reverbIn) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = midiHz(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(gain, time + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 3.6);
    o.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverbIn);
    o.start(time);
    o.stop(time + 3.7);
    this.free(o, g);
  }

  // ── 音效 ────────────────────────────────────────────────────

  sfx(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || ctx.state !== 'running') return;
    if (this.settings.muted || this.settings.sfx <= 0.01) return;
    if (name === 'stamp') {
      this.editSpike = 1;
      this.kickGroove(1);
    }
    // 随机播种等于一次放下很多细胞：直接给一段强律动
    if (name === 'random') this.kickGroove(1.5);
    const t = ctx.currentTime + 0.012;
    try {
      switch (name) {
        case 'birth':
          this.sfxBirth(t);
          break;
        case 'death':
          this.sfxDeath(t, 1);
          break;
        case 'erase':
          this.sfxDeath(t, 0.6);
          break;
        case 'stamp':
          this.sfxStamp(t);
          break;
        case 'clear':
          this.sfxWhoosh(t, 0.6, 2200, 0.28);
          this.sfxThump(t, 0.16);
          break;
        case 'random':
          this.sfxDice(t);
          break;
        case 'undo':
          this.sfxBlip(t, 660, 0.05);
          this.sfxBlip(t + 0.07, 494, 0.04);
          break;
        case 'redo':
          this.sfxBlip(t, 494, 0.04);
          this.sfxBlip(t + 0.07, 660, 0.05);
          break;
        case 'play':
          this.sfxBlip(t, 1180, 0.05);
          break;
        case 'pause':
          this.sfxBlip(t, 740, 0.05);
          break;
        case 'whoosh':
          this.sfxWhoosh(t, 0.45, 1800, 0.2);
          break;
        case 'click':
          this.sfxBlip(t, 1500, 0.035);
          break;
      }
    } catch {
      /* 音频节点出问题不该影响游戏 */
    }
  }

  /**
   * 画笔/橡皮：每落一格都会调一次，所以这里做节流，
   * 并且用最近落了多少格来抬音高——一笔画得越长，声音越"爬升"。
   */
  paintTick(kind: 'add' | 'remove'): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || ctx.state !== 'running') return;
    if (this.settings.muted || this.settings.sfx <= 0.01) return;
    const now = ctx.currentTime;
    this.paintAccum = Math.min(40, this.paintAccum + 1);
    if (now - this.lastPaintAt < 0.045) return;
    this.lastPaintAt = now;
    const t = now + 0.008;
    if (kind === 'remove') {
      this.sfxBlip(t, 420, 0.05);
    } else {
      const hz = 1320 + Math.min(1400, this.paintAccum * 70);
      this.sfxBlip(t, hz, 0.035 + Math.min(0.03, this.paintAccum * 0.002));
      // 连着画很多细胞也算"在往世界里加东西"，会推一段律动
      this.kickGroove(0.2);
    }
    this.paintAccum = 0;
  }

  private sfxBlip(time: number, hz: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(time);
    o.stop(time + 0.11);
    this.free(o, g);
  }

  /** 宣传片 birth.wav：880→1320Hz 的亮叮 + 一点噪声 */
  private sfxBirth(time: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, time);
    o.frequency.linearRampToValueAtTime(1320, time + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.16, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.26);
    const shimmerOsc = ctx.createOscillator();
    shimmerOsc.type = 'sine';
    shimmerOsc.frequency.value = 2640;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.04, time);
    sg.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    o.connect(g);
    shimmerOsc.connect(sg);
    g.connect(this.sfxBus);
    sg.connect(this.sfxBus);
    o.start(time);
    shimmerOsc.start(time);
    o.stop(time + 0.28);
    shimmerOsc.stop(time + 0.18);
    this.free(o, g);
    this.free(shimmerOsc, sg);
  }

  /** 宣传片 death.wav：150→55Hz 的塌陷 + 一点漏气 */
  private sfxDeath(time: number, scale: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuf) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, time);
    o.frequency.exponentialRampToValueAtTime(55, time + 0.26);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.2 * scale, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    o.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    o.start(time);
    o.stop(time + 0.32);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05 * scale, time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    src.connect(ng);
    ng.connect(this.sfxBus);
    src.start(time);
    src.stop(time + 0.14);
    this.free(o, lp, g);
    this.free(src, ng);
  }

  /** 放入图案：三个音往上一挑，像把种子按进土里 */
  private sfxStamp(time: number): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    [69, 72, 76].forEach((note, i) => {
      const t = time + i * 0.055;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midiHz(note);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g);
      g.connect(bus);
      o.start(t);
      o.stop(t + 0.36);
      this.free(o, g);
    });
    this.sfxThump(time, 0.1);
  }

  private sfxThump(time: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, time);
    o.frequency.exponentialRampToValueAtTime(44, time + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(time);
    o.stop(time + 0.44);
    this.free(o, g);
  }

  /** 随机播种：四颗骰子撞在一起，最后落定 */
  private sfxDice(time: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuf) return;
    for (let i = 0; i < 4; i++) {
      const t = time + i * 0.075 + Math.random() * 0.03;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800 + Math.random() * 1200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(hp);
      hp.connect(g);
      g.connect(this.sfxBus);
      src.start(t);
      src.stop(t + 0.06);
      this.free(src, hp, g);
    }
    this.sfxThump(time + 0.42, 0.12);
  }

  /** 转场 whoosh：低通扫频的噪声 */
  private sfxWhoosh(time: number, dur: number, cut: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(cut * 0.3, time);
    bp.frequency.linearRampToValueAtTime(cut, time + dur * 0.6);
    bp.frequency.linearRampToValueAtTime(cut * 0.4, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(gain, time + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.sfxBus);
    src.start(time);
    src.stop(time + dur + 0.02);
    this.free(src, bp, g);
  }

  // ── 给自动化测试用的探针 ────────────────────────────────────

  /** 当前输出电平（0..1），用来确认"真的出声了"而不是只有对象 */
  debugLevel(): number {
    const ctx = this.ctx;
    const analyser = this.analyser;
    if (!ctx || !analyser || ctx.state !== 'running') return 0;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
    return Math.sqrt(sum / buf.length);
  }

  get contextState(): string {
    return this.ctx ? this.ctx.state : 'none';
  }
}

function webkitCtor(): typeof AudioContext | undefined {
  const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
  return w.webkitAudioContext;
}

/** 全局单例：整页只有一套音频，主循环和界面都往这里挂 */
export const sound = new SoundEngine();
