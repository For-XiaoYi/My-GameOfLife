import { World } from './world.ts';

/** 空增量：无变化的一代共用同一个零长度数组，不占内存。 */
const EMPTY = new Int32Array(0);

export interface Keyframe {
  packed: Uint8Array;
  population: number;
}

/** 一段可回放的演化片段。 */
export interface ClipData {
  startGen: number;
  endGen: number;
  start: Keyframe;
  /** deltas[i] 把 startGen+i 演化成 startGen+i+1。 */
  deltas: Int32Array[];
}

export interface HistoryStats {
  minGen: number;
  maxGen: number;
  gens: number;
  bytes: number;
  keyframes: number;
  deltas: number;
}

/**
 * 演化历史：增量 + 稀疏关键帧。
 *
 * 生命游戏不可逆，所以不"倒着算"：每代只记录翻转过的格子。
 *   - `deltas`：gen -> 把 gen-1 变成 gen 的翻转清单（空增量共享 EMPTY）
 *   - `keyframes`：gen -> 完整位图（1 bit/格），用于瞬时跳转
 *
 * 不变式：minGen 处一定有 keyframe；deltas 在 (minGen, maxGen] 上连续。
 * 超出内存/代数上限时从最老的 keyframe 处整段丢弃。
 */
export class History {
  readonly world: World;

  private deltas = new Map<number, Int32Array>();
  private keyframes = new Map<number, Keyframe>();
  private minGen = 0;
  private maxGen = 0;
  private bytes = 0;
  private lastKfGen = 0;
  private lastKfAt = 0;

  /** 最多保留多少代。 */
  limitGens = 3000;
  /** 内存上限（字节）。 */
  limitBytes = 32 * 1024 * 1024;
  /** 关键帧间隔（代）。 */
  keyframeEvery = 64;
  /** 录制片段期间暂停淘汰，避免录到一半丢了起点。 */
  protectedRange: { from: number; to: number } | null = null;

  constructor(world: World) {
    this.world = world;
    this.reset();
  }

  /** 以世界当前状态作为新的历史起点。 */
  reset(): void {
    this.deltas.clear();
    this.keyframes.clear();
    this.bytes = 0;
    const gen = this.world.gen;
    this.captureKeyframe(gen);
    this.minGen = gen;
    this.maxGen = gen;
    this.protectedRange = null;
  }

  captureKeyframe(gen: number): void {
    const old = this.keyframes.get(gen);
    if (old) this.bytes -= old.packed.byteLength;
    const kf: Keyframe = {
      packed: this.world.toPacked(),
      population: this.world.population,
    };
    this.keyframes.set(gen, kf);
    this.bytes += kf.packed.byteLength;
    this.lastKfGen = gen;
    this.lastKfAt = performance.now();
  }

  /**
   * 记录一代的演化结果。
   * @param gen 演化后的代数
   * @param codes world.step() 返回的翻转清单（null 表示无变化）
   */
  record(gen: number, codes: Int32Array | null): void {
    // 在历史中间继续演化：丢弃旧的未来
    if (gen - 1 < this.maxGen) this.truncate(gen - 1);
    this.maxGen = gen;
    this.setDelta(gen, codes && codes.length ? codes : EMPTY);
    this.maybeKeyframe(gen);
    this.evict();
  }

  /**
   * 用户编辑（画/擦/贴图）后提交一代的历史。
   * 世界此时已经是编辑后的状态；内部会先回到 gen-1 再与快照求差。
   */
  markEdited(gen: number, packed: Uint8Array, population: number): void {
    this.truncate(gen);
    this.maxGen = gen;

    if (gen > this.minGen) {
      // 编辑是就地改的世界，当前内容已经不等于历史记录的 gen 状态，
      // 因此不能靠增量反推 gen-1，必须从关键帧重放到 gen-1。
      this.forceSeek(gen - 1);
      const codes = this.world.diffPacked(packed);
      this.setDelta(gen, codes.length ? codes : EMPTY);
      this.maxGen = gen;
    } else {
      const old = this.deltas.get(gen);
      if (old) {
        this.bytes -= old.byteLength;
        this.deltas.delete(gen);
      }
      this.minGen = gen;
    }

    const oldKf = this.keyframes.get(gen);
    if (oldKf) this.bytes -= oldKf.packed.byteLength;
    const kf: Keyframe = { packed, population };
    this.keyframes.set(gen, kf);
    this.bytes += packed.byteLength;
    this.lastKfGen = gen;
    this.lastKfAt = performance.now();

    this.world.loadPacked(packed, population, gen);
    this.evict();
  }

  /** 跳到指定代数（自动选择"逐代重放"或"从关键帧重放"）。 */
  seek(target: number): void {
    const w = this.world;
    const t = Math.max(this.minGen, Math.min(this.maxGen, Math.round(target)));
    if (t === w.gen) return;

    if (t > w.gen) {
      let g = w.gen + 1;
      for (; g <= t; g++) {
        const d = this.deltas.get(g);
        if (!d) break;
        w.applyDelta(d);
      }
      w.gen = g - 1;
    } else if (w.gen - t <= this.keyframeEvery) {
      for (let g = w.gen; g > t; g--) {
        const d = this.deltas.get(g);
        if (!d) break;
        w.revertDelta(d);
      }
      w.gen = t;
    } else {
      const k = this.keyframeLE(t);
      const kf = this.keyframes.get(k);
      if (!kf) {
        w.gen = t;
        return;
      }
      w.loadPacked(kf.packed, kf.population, k);
      for (let g = k + 1; g <= t; g++) {
        const d = this.deltas.get(g);
        if (!d) break;
        w.applyDelta(d);
      }
      w.gen = t;
    }
  }

  /** 截取 [g0, g1] 的演化片段（不改变世界当前状态）。 */
  extractClip(g0: number, g1: number): ClipData | null {
    const a = Math.max(this.minGen, g0);
    const b = Math.min(this.maxGen, g1);
    if (b < a) return null;
    const keep = this.world.gen;
    this.seek(a);
    const start: Keyframe = {
      packed: this.world.toPacked(),
      population: this.world.population,
    };
    const ds: Int32Array[] = [];
    for (let g = a + 1; g <= b; g++) ds.push(this.deltas.get(g) ?? EMPTY);
    this.seek(keep);
    return { startGen: a, endGen: b, start, deltas: ds };
  }

  stats(): HistoryStats {
    return {
      minGen: this.minGen,
      maxGen: this.maxGen,
      gens: this.maxGen - this.minGen,
      bytes: this.bytes,
      keyframes: this.keyframes.size,
      deltas: this.deltas.size,
    };
  }

  clearFuture(): void {
    this.truncate(this.world.gen);
  }

  // ---- 内部 ----

  /** 不看当前世界内容，强制从最近的关键帧重放到 t（世界内容被外部改过之后用）。 */
  private forceSeek(t: number): void {
    const k = this.keyframeLE(t);
    const kf = this.keyframes.get(k);
    if (!kf) return;
    this.world.loadPacked(kf.packed, kf.population, k);
    for (let g = k + 1; g <= t; g++) {
      const d = this.deltas.get(g);
      if (!d) break;
      this.world.applyDelta(d);
    }
    this.world.gen = t;
  }

  private setDelta(gen: number, codes: Int32Array): void {
    const old = this.deltas.get(gen);
    if (old) this.bytes -= old.byteLength;
    this.deltas.set(gen, codes);
    this.bytes += codes.byteLength;
  }

  private truncate(upTo: number): void {
    if (upTo < this.minGen) return;
    for (const [g, c] of this.deltas) {
      if (g > upTo) {
        this.bytes -= c.byteLength;
        this.deltas.delete(g);
      }
    }
    for (const [g, k] of this.keyframes) {
      if (g > upTo) {
        this.bytes -= k.packed.byteLength;
        this.keyframes.delete(g);
      }
    }
    if (this.maxGen > upTo) this.maxGen = upTo;
  }

  private maybeKeyframe(gen: number): void {
    const gap = gen - this.lastKfGen;
    if (gap <= 0) return;
    const now = performance.now();
    // 每 512 代强制一帧；否则每 keyframeEvery 代且距上次超过 24ms 才存，
    // 避免高速播放时关键帧把帧时间撑爆。
    if (gap >= 512 || (gap >= this.keyframeEvery && now - this.lastKfAt > 24)) {
      this.captureKeyframe(gen);
    }
  }

  private keyframeLE(t: number): number {
    let best = this.minGen;
    for (const g of this.keyframes.keys()) {
      if (g <= t && g > best) best = g;
    }
    return best;
  }

  /** 调整可回溯的代数和内存上限，立刻按新限制淘汰旧记录。 */
  setDepth(gens: number, bytes?: number): void {
    this.limitGens = Math.max(64, Math.floor(gens));
    if (typeof bytes === 'number') this.limitBytes = Math.max(4 * 1024 * 1024, Math.floor(bytes));
    this.evict();
  }

  private evict(): void {
    if (this.protectedRange) return;
    let guard = 0;
    while (
      (this.maxGen - this.minGen > this.limitGens || this.bytes > this.limitBytes) &&
      guard++ < 256
    ) {
      const kfs = [...this.keyframes.keys()].sort((a, b) => a - b);
      if (kfs.length < 2) break;
      const nextMin = kfs[1];
      if (nextMin <= this.minGen) break;
      for (const [g, c] of this.deltas) {
        if (g <= nextMin) {
          this.bytes -= c.byteLength;
          this.deltas.delete(g);
        }
      }
      for (const [g, k] of this.keyframes) {
        if (g < nextMin) {
          this.bytes -= k.packed.byteLength;
          this.keyframes.delete(g);
        }
      }
      this.minGen = nextMin;
    }
  }
}
