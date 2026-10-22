/**
 * world.ts — Life 世界的核心数据与演化引擎。
 *
 * 设计要点
 * ─────────
 * 1. 带 1 圈 padding 的 Uint8Array 网格：邻居统计无需任何边界分支，
 *    环形边界只需把对边拷贝进 padding（且仅在矩形贴边时才刷新）。
 * 2. 脏矩形：只演化"活细胞包围盒 ± 1"的区域，一个滑翔机在 1024² 的世界里
 *    每代只计算约 25 个格子，代价与世界尺寸无关。
 * 3. 每代会返回"翻转清单"（born 记 +paddedIndex，died 记 -(paddedIndex+1)），
 *    供 history.ts 做增量时间回溯，几乎零额外成本。
 */

export type EdgeMode = 'wrap' | 'dead';

/** 未填充索引（y * width + x），用于关键帧 / RLE / 选区。 */
export type CellIndex = number;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function rectIsEmpty(r: Rect): boolean {
  return r.x1 <= r.x0 || r.y1 <= r.y0;
}

export function rectUnion(a: Rect, b: Rect): Rect {
  if (rectIsEmpty(a)) return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
  if (rectIsEmpty(b)) return { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 };
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

const EMPTY_INT32 = new Int32Array(0);

export class World {
  readonly width: number;
  readonly height: number;
  /** 带 padding 的存储，步长 = width + 2。 */
  readonly stride: number;
  readonly cells: Uint8Array;
  /** 每格的出生代数（低 16 位）；渲染时用 gen - birth 算年龄。 */
  readonly birth: Uint16Array;
  /** cells 的位图镜像（1 bit/格，含 padding），演化走它。 */
  readonly bits: Uint32Array;
  /** 每行（含左右 padding）占多少个 32 位字。 */
  readonly bitsStride: number;

  gen = 0;
  population = 0;

  private _edge: EdgeMode = 'wrap';
  private nextBits: Uint32Array;
  private changeBuf: Int32Array;

  /** 活细胞包围盒（右开区间）。population === 0 时视为空。 */
  private bx0 = 0;
  private by0 = 0;
  private bx1 = 0;
  private by1 = 0;

  /** 待重绘的渲染脏矩形。 */
  private dx0 = 0;
  private dy0 = 0;
  private dx1 = 0;
  private dy1 = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.stride = width + 2;
    const size = (width + 2) * (height + 2);
    this.cells = new Uint8Array(size);
    this.birth = new Uint16Array(size);
    this.bitsStride = (width + 2 + 31) >> 5;
    const words = this.bitsStride * (height + 2);
    this.bits = new Uint32Array(words);
    this.nextBits = new Uint32Array(words);
    // 单代最大翻转数不会超过世界格数，一次性分配避免热路径上的扩容判断。
    this.changeBuf = new Int32Array(width * height);
  }

  get edge(): EdgeMode {
    return this._edge;
  }

  /** 切换边界模式时把 padding 归零，避免上一模式的残留影响邻居统计。 */
  set edge(v: EdgeMode) {
    if (v === this._edge) return;
    this._edge = v;
    this.clearPadding();
  }

  /** 每格已存活的代数（1 起，最大 255），供渲染取色。 */
  ageAt(i: number): number {
    const a = (this.gen - this.birth[i]) & 0xffff;
    return a < 1 ? 1 : a > 255 ? 255 : a;
  }

  // ── 位图镜像维护 ────────────────────────────────────────────

  private setBit(i: number, v: number): void {
    const row = (i / this.stride) | 0;
    const col = i - row * this.stride;
    const wi = row * this.bitsStride + (col >>> 5);
    const mask = 1 << (col & 31);
    if (v) this.bits[wi] |= mask;
    else this.bits[wi] &= ~mask;
  }

  /** 用 cells 重建整张位图（批量载入后调用）。 */
  private rebuildBits(): void {
    const W = this.width;
    const S = this.stride;
    const BW = this.bitsStride;
    const cells = this.cells;
    const bits = this.bits;
    bits.fill(0);
    for (let y = 0; y < this.height; y++) {
      const src = (y + 1) * S + 1;
      const dst = (y + 1) * BW;
      for (let x = 0; x < W; x++) {
        if (cells[src + x]) bits[dst + ((x + 1) >>> 5)] |= 1 << ((x + 1) & 31);
      }
    }
  }

  /** 把 padding 环整体清零（cells 与位图）。 */
  private clearPadding(): void {
    const W = this.width;
    const H = this.height;
    const S = this.stride;
    const p = this.cells;
    for (let x = 0; x <= W + 1; x++) {
      p[x] = 0;
      p[(H + 1) * S + x] = 0;
    }
    for (let y = 0; y <= H + 1; y++) {
      const row = y * S;
      p[row] = 0;
      p[row + W + 1] = 0;
    }
    this.bits.fill(0);
    for (let y = 1; y <= H; y++) {
      const r = y * S;
      const d = y * this.bitsStride;
      for (let x = 0; x < W; x++) {
        if (p[r + x + 1]) this.bits[d + ((x + 1) >>> 5)] |= 1 << ((x + 1) & 31);
      }
    }
  }

  // ── 坐标与读写 ──────────────────────────────────────────────

  /** 未填充索引 -> padding 索引 */
  pidx(idx: CellIndex): number {
    const x = idx % this.width;
    return ((idx - x) / this.width + 1) * this.stride + x + 1;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.cells[(y + 1) * this.stride + x + 1];
  }

  set(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y + 1) * this.stride + x + 1;
    const old = this.cells[i];
    if (old === (v ? 1 : 0)) return;
    this.cells[i] = v ? 1 : 0;
    this.setBit(i, v ? 1 : 0);
    if (v) {
      this.birth[i] = this.gen & 0xffff;
      this.population++;
      this.expandBBox(x, y);
    } else {
      this.birth[i] = 0;
      this.population--;
      if (this.population <= 0) {
        this.population = 0;
        this.clearBBox();
      }
    }
    this.markDirty(x, y, x + 1, y + 1);
  }

  /** 直接写入 padding 索引（历史回放用），不做脏矩形/包围盒维护。 */
  writePadded(i: number, v: number): void {
    this.cells[i] = v;
    this.birth[i] = v ? this.gen & 0xffff : 0;
    this.setBit(i, v);
  }

  // ── 包围盒 ──────────────────────────────────────────────────

  private expandBBox(x: number, y: number): void {
    if (this.population === 1) {
      this.bx0 = x;
      this.by0 = y;
      this.bx1 = x + 1;
      this.by1 = y + 1;
      return;
    }
    if (x < this.bx0) this.bx0 = x;
    if (y < this.by0) this.by0 = y;
    if (x + 1 > this.bx1) this.bx1 = x + 1;
    if (y + 1 > this.by1) this.by1 = y + 1;
  }

  private clearBBox(): void {
    this.bx0 = this.by0 = this.bx1 = this.by1 = 0;
  }

  /** 重新计算人口与包围盒（粘贴 / RLE 载入 / 历史恢复后用）。 */
  recompute(): void {
    let n = 0;
    let x0 = this.width;
    let y0 = this.height;
    let x1 = 0;
    let y1 = 0;
    const { width: W, height: H, stride: S, cells } = this;
    for (let y = 0; y < H; y++) {
      const row = (y + 1) * S;
      for (let x = 0; x < W; x++) {
        if (cells[row + x + 1]) {
          n++;
          if (x < x0) x0 = x;
          if (x + 1 > x1) x1 = x + 1;
          if (y < y0) y0 = y;
          if (y + 1 > y1) y1 = y + 1;
        }
      }
    }
    this.population = n;
    if (n === 0) {
      this.clearBBox();
    } else {
      this.bx0 = x0;
      this.by0 = y0;
      this.bx1 = x1;
      this.by1 = y1;
    }
  }

  liveBBox(): Rect {
    if (this.population === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    return { x0: this.bx0, y0: this.by0, x1: this.bx1, y1: this.by1 };
  }

  // ── 渲染脏矩形 ──────────────────────────────────────────────

  markDirty(x0: number, y0: number, x1: number, y1: number): void {
    if (this.dx1 <= this.dx0 || this.dy1 <= this.dy0) {
      this.dx0 = x0;
      this.dy0 = y0;
      this.dx1 = x1;
      this.dy1 = y1;
      return;
    }
    if (x0 < this.dx0) this.dx0 = x0;
    if (y0 < this.dy0) this.dy0 = y0;
    if (x1 > this.dx1) this.dx1 = x1;
    if (y1 > this.dy1) this.dy1 = y1;
  }

  markAllDirty(): void {
    this.dx0 = 0;
    this.dy0 = 0;
    this.dx1 = this.width;
    this.dy1 = this.height;
  }

  /** 取出并清空脏矩形；无变化时返回 null。 */
  consumeDirty(): Rect | null {
    if (this.dx1 <= this.dx0 || this.dy1 <= this.dy0) return null;
    const r: Rect = { x0: this.dx0, y0: this.dy0, x1: this.dx1, y1: this.dy1 };
    this.dx0 = this.dy0 = this.dx1 = this.dy1 = 0;
    return r;
  }

  // ── 编辑操作 ────────────────────────────────────────────────

  clear(): void {
    this.cells.fill(0);
    this.birth.fill(0);
    this.bits.fill(0);
    this.nextBits.fill(0);
    this.population = 0;
    this.gen = 0;
    this.clearBBox();
    this.markAllDirty();
  }

  /** 以给定密度随机播种（限定在中心区域，方便观察）。 */
  randomize(density = 0.32, rng: () => number = Math.random): void {
    this.cells.fill(0);
    this.birth.fill(0);
    this.bits.fill(0);
    const W = this.width;
    const H = this.height;
    const span = Math.min(W, H) * 0.62;
    const x0 = Math.max(0, ((W - span) / 2) | 0);
    const y0 = Math.max(0, ((H - span) / 2) | 0);
    const x1 = Math.min(W, x0 + span);
    const y1 = Math.min(H, y0 + span);
    const S = this.stride;
    const cells = this.cells;
    const birth = this.birth;
    const bits = this.bits;
    const BW = this.bitsStride;
    for (let y = y0; y < y1; y++) {
      const row = (y + 1) * S;
      const brow = (y + 1) * BW;
      for (let x = x0; x < x1; x++) {
        if (rng() < density) {
          const i = row + x + 1;
          cells[i] = 1;
          birth[i] = 0;
          bits[brow + ((x + 1) >>> 5)] |= 1 << ((x + 1) & 31);
        }
      }
    }
    this.gen = 0;
    this.recompute();
    this.markAllDirty();
  }

  /**
   * 把一块未填充图案贴到世界。返回实际写入的格数。
   * 越界部分按世界尺寸取模（环绕）或裁剪（死边界）。
   */
  stamp(cells: Uint8Array, pw: number, ph: number, ox: number, oy: number): number {
    let written = 0;
    const W = this.width;
    const H = this.height;
    const S = this.stride;
    const wrap = this.edge === 'wrap';
    for (let y = 0; y < ph; y++) {
      let wy = oy + y;
      if (wy < 0 || wy >= H) {
        if (!wrap) continue;
        wy = ((wy % H) + H) % H;
      }
      const rowM = (wy + 1) * S;
      const srcRow = y * pw;
      for (let x = 0; x < pw; x++) {
        if (!cells[srcRow + x]) continue;
        let wx = ox + x;
        if (wx < 0 || wx >= W) {
          if (!wrap) continue;
          wx = ((wx % W) + W) % W;
        }
        const i = rowM + wx + 1;
        if (!this.cells[i]) {
          this.cells[i] = 1;
          this.birth[i] = this.gen & 0xffff;
          this.setBit(i, 1);
          this.population++;
          written++;
        }
      }
    }
    this.recompute();
    this.markAllDirty();
    return written;
  }

  /** 读取一块矩形为未填充图案（用于复制/导出）。 */
  extract(x0: number, y0: number, w: number, h: number): Uint8Array {
    const out = new Uint8Array(w * h);
    const S = this.stride;
    for (let y = 0; y < h; y++) {
      const wy = y0 + y;
      if (wy < 0 || wy >= this.height) continue;
      const row = (wy + 1) * S;
      for (let x = 0; x < w; x++) {
        const wx = x0 + x;
        if (wx < 0 || wx >= this.width) continue;
        out[y * w + x] = this.cells[row + wx + 1];
      }
    }
    return out;
  }

  /** 统计矩形内的活细胞数（选区信息用）。 */
  countRect(x0: number, y0: number, w: number, h: number): number {
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (this.get(x0 + x, y0 + y)) n++;
    }
    return n;
  }

  // ── 演化 ────────────────────────────────────────────────────

  /**
   * 推进一步。返回本代的翻转清单（null 表示无变化/空世界）。
   * 编码：出生记 +paddedIndex，死亡记 -(paddedIndex + 1)。
   */
  step(): Int32Array | null {
    const W = this.width;
    const H = this.height;
    if (this.population === 0) {
      this.gen++;
      return null;
    }

    const wrap = this._edge === 'wrap';
    if (wrap) this.refreshBorderBits();

    const S = this.stride;
    const BW = this.bitsStride;
    const wr = (W + 1) >>> 5;
    const br = (W + 1) & 31;
    // 最后一个字里列 W+1（右侧 padding）及以上的位都不是世界的一部分
    const lastMask = (1 << br) - 1;
    const bits = this.bits;
    const nextB = this.nextBits;
    const cells = this.cells;
    const birth = this.birth;
    const buf = this.changeBuf;
    const genNow = this.gen & 0xffff;

    const xSpans = expandedSpans(this.bx0, this.bx1, W, wrap);
    const ySpans = expandedSpans(this.by0, this.by1, H, wrap);

    // 第一遍：纯计算，把下一状态写进 nextBits（此时 bits 保持上一代，三行都能读到原值）。
    for (let si = 0; si < ySpans.length; si += 2) {
      const ya = ySpans[si];
      const yb = ySpans[si + 1];
      for (let y = ya; y < yb; y++) {
        const rM = y * BW;
        const r0 = (y + 1) * BW;
        const rP = (y + 2) * BW;
        for (let sj = 0; sj < xSpans.length; sj += 2) {
          const kw0 = (xSpans[sj] + 1) >>> 5;
          const kw1 = xSpans[sj + 1] >>> 5;
          for (let k = kw0; k <= kw1; k++) {
            const m = bits[rM + k];
            const c = bits[r0 + k];
            const p = bits[rP + k];
            const mL = (m << 1) | (k > 0 ? bits[rM + k - 1] >>> 31 : 0);
            const mR = (m >>> 1) | (k + 1 < BW ? bits[rM + k + 1] << 31 : 0);
            const cL = (c << 1) | (k > 0 ? bits[r0 + k - 1] >>> 31 : 0);
            const cR = (c >>> 1) | (k + 1 < BW ? bits[r0 + k + 1] << 31 : 0);
            const pL = (p << 1) | (k > 0 ? bits[rP + k - 1] >>> 31 : 0);
            const pR = (p >>> 1) | (k + 1 < BW ? bits[rP + k + 1] << 31 : 0);

            // 每行的邻居数：上下行各 3 个（左中右），中心行只有 2 个（左右）。
            const mX = mL ^ m;
            const mS = mX ^ mR;
            const mC = (mL & m) | (mR & mX);
            const cS = cL ^ cR;
            const cC = cL & cR;
            const pX = pL ^ p;
            const pS = pX ^ pR;
            const pC = (pL & p) | (pR & pX);

            // 三行合并成 4 个位平面：总数 = p0 + 2*p1 + 4*p2 + 8*p3
            const sX = mS ^ cS;
            const p0 = sX ^ pS;
            const s1 = (mS & cS) | (pS & sX);
            const tX = mC ^ cC;
            const t0 = tX ^ pC;
            const t1 = (mC & cC) | (pC & tX);
            const p1 = s1 ^ t0;
            const carry1 = s1 & t0;
            const p2 = t1 ^ carry1;
            const p3 = t1 & carry1;

            // 规则：邻居数 == 3 出生；邻居数 == 2 且自身存活则续命。
            let nv = p1 & ~p2 & ~p3 & (p0 | c);
            // 只保留有效列（padding 列 0 与 W+1 之间）：最后一个字里超出的位被
            // 邻居窗口污染后可能算出 1，写回 cells 时会越界到下一行。
            if (k === 0) nv &= ~1;
            if (k === wr) nv &= lastMask;
            nextB[r0 + k] = nv;
          }
        }
      }
    }

    // 第二遍：写回 bits、收集翻转清单、统计人口与包围盒。
    let changeCount = 0;
    let pop = this.population;
    let nx0 = W;
    let ny0 = H;
    let nx1 = 0;
    let ny1 = 0;

    for (let si = 0; si < ySpans.length; si += 2) {
      const ya = ySpans[si];
      const yb = ySpans[si + 1];
      for (let y = ya; y < yb; y++) {
        const r0 = (y + 1) * BW;
        const base = (y + 1) * S;
        let kFirst = -1;
        let kLast = -1;
        for (let sj = 0; sj < xSpans.length; sj += 2) {
          const kw0 = (xSpans[sj] + 1) >>> 5;
          const kw1 = xSpans[sj + 1] >>> 5;
          for (let k = kw0; k <= kw1; k++) {
            const old = bits[r0 + k];
            const nv = nextB[r0 + k];
            // 记录本行第一个/最后一个还有活细胞的字（可能不等于区间首尾字）
            if (nv !== 0) {
              if (kFirst < 0) kFirst = k;
              kLast = k;
            }
            if (nv === old) continue;
            bits[r0 + k] = nv;
            let d = nv ^ old;
            // padding 列的那两位只用于邻居计算，不属于世界，不能算进人口与变化清单
            if (k === 0) d &= ~1;
            if (k === wr) d &= lastMask;
            while (d !== 0) {
              const bit = 31 - Math.clz32(d & -d);
              const i = base + (k << 5) + bit;
              if ((nv >>> bit) & 1) {
                cells[i] = 1;
                birth[i] = genNow;
                pop++;
                buf[changeCount++] = i;
              } else {
                cells[i] = 0;
                birth[i] = 0;
                pop--;
                buf[changeCount++] = -(i + 1);
              }
              d &= d - 1;
            }
          }
        }
        // 本行还有活细胞吗？有就把包围盒扩到它们（按位图定位首末非零字）。
        if (kFirst >= 0) {
          const w0 = nextB[r0 + kFirst];
          const w1 = nextB[r0 + kLast];
          if (w0 !== 0) {
            const col0 = (kFirst << 5) + (31 - Math.clz32(w0 & -w0));
            const x = col0 - 1;
            if (x < nx0) nx0 = x < 0 ? 0 : x;
            if (y < ny0) ny0 = y;
            if (y + 1 > ny1) ny1 = y + 1;
          }
          if (w1 !== 0) {
            const col1 = (kLast << 5) + (31 - Math.clz32(w1));
            const x = col1 - 1;
            if (x + 1 > nx1) nx1 = x + 1 > W ? W : x + 1;
            if (y < ny0) ny0 = y;
            if (y + 1 > ny1) ny1 = y + 1;
          }
        }
      }
    }

    this.population = pop;
    if (pop === 0) {
      this.clearBBox();
    } else {
      this.bx0 = nx0;
      this.by0 = ny0;
      this.bx1 = nx1;
      this.by1 = ny1;
    }

    // 渲染脏区 = 本次演化的整个区域（含仅年龄变化的活细胞）
    for (let si = 0; si < ySpans.length; si += 2) {
      for (let sj = 0; sj < xSpans.length; sj += 2) {
        this.markDirty(xSpans[sj], ySpans[si], xSpans[sj + 1], ySpans[si + 1]);
      }
    }

    this.gen++;
    if (changeCount === 0) return null;
    const out = new Int32Array(changeCount);
    out.set(buf.subarray(0, changeCount));
    return out;
  }

  /** 把世界四周的位图 padding 环填成对边内容（环形边界）。 */
  private refreshBorderBits(): void {
    const W = this.width;
    const H = this.height;
    const BW = this.bitsStride;
    const b = this.bits;
    const wl = W >>> 5;
    const bl = W & 31;
    const wr = (W + 1) >>> 5;
    const br = (W + 1) & 31;
    const maskR = ~(1 << br);
    // 左右 padding 列：padded 列 0 取列 W，列 W+1 取列 1。
    // 必须先填内部行的列 padding，再整行拷贝上下 padding 行，否则四个角落会缺一位。
    for (let y = 1; y <= H; y++) {
      const base = y * BW;
      const leftVal = (b[base + wl] >>> bl) & 1;
      const rightVal = (b[base] >>> 1) & 1;
      if (leftVal) b[base] |= 1;
      else b[base] &= ~1;
      if (rightVal) b[base + wr] |= 1 << br;
      else b[base + wr] &= maskR;
    }
    // 上下 padding 行直接整行拷贝（此时源行的列 padding 已是最新）
    for (let k = 0; k < BW; k++) {
      b[k] = b[H * BW + k];
      b[(H + 1) * BW + k] = b[BW + k];
    }
  }

  /** 用未填充位图覆盖整个世界（历史关键帧恢复用）。 */
  loadBits(bits: Uint8Array, population: number, gen: number): void {
    const W = this.width;
    const H = this.height;
    const S = this.stride;
    this.cells.fill(0);
    this.birth.fill(0);
    this.gen = gen;
    const g = gen & 0xffff;
    for (let y = 0; y < H; y++) {
      const row = (y + 1) * S;
      const src = y * W;
      for (let x = 0; x < W; x++) {
        if (bits[src + x]) {
          const i = row + x + 1;
          this.cells[i] = 1;
          this.birth[i] = g;
        }
      }
    }
    this.population = population;
    this.recompute();
    this.rebuildBits();
    this.markAllDirty();
  }

  /** 导出未填充位图（历史关键帧 / 存档用）。 */
  toBits(): Uint8Array {
    const W = this.width;
    const H = this.height;
    const S = this.stride;
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = (y + 1) * S;
      const dst = y * W;
      for (let x = 0; x < W; x++) out[dst + x] = this.cells[row + x + 1];
    }
    return out;
  }

  /** 打包成 1 bit/格 的位图（比 Uint8Array 小 8 倍，关键帧存储用）。 */
  toPacked(): Uint8Array {
    const W = this.width;
    const H = this.height;
    const S = this.stride;
    const out = new Uint8Array(((W * H) >> 3) + 1);
    const cells = this.cells;
    let bit = 0;
    let acc = 0;
    let n = 0;
    let o = 0;
    for (let y = 0; y < H; y++) {
      const row = (y + 1) * S;
      for (let x = 0; x < W; x++) {
        if (cells[row + x + 1]) acc |= 1 << n;
        n++;
        bit++;
        if (n === 8) {
          out[o++] = acc;
          acc = 0;
          n = 0;
        }
      }
    }
    if (n) out[o++] = acc;
    return out.subarray(0, o);
  }

  /** 从打包位图恢复整个世界。 */
  loadPacked(packed: Uint8Array, population: number, gen: number): void {
    const W = this.width;
    const H = this.height;
    const S = this.stride;
    this.cells.fill(0);
    this.birth.fill(0);
    this.gen = gen;
    const g = gen & 0xffff;
    let bit = 0;
    for (let y = 0; y < H; y++) {
      const row = (y + 1) * S;
      for (let x = 0; x < W; x++) {
        if ((packed[bit >> 3] >> (bit & 7)) & 1) {
          const i = row + x + 1;
          this.cells[i] = 1;
          this.birth[i] = g;
        }
        bit++;
      }
    }
    this.population = population;
    this.recompute();
    this.rebuildBits();
    this.markAllDirty();
  }

  /** 与打包位图比较，返回把世界变成该位图所需的翻转清单。 */
  diffPacked(packed: Uint8Array): Int32Array {
    const W = this.width;
    const H = this.height;
    const S = this.stride;
    const cells = this.cells;
    const out: number[] = [];
    let bit = 0;
    for (let y = 0; y < H; y++) {
      const row = (y + 1) * S;
      for (let x = 0; x < W; x++) {
        const bitVal = (packed[bit >> 3] >> (bit & 7)) & 1;
        bit++;
        const i = row + x + 1;
        const cur = cells[i];
        if (cur !== bitVal) out.push(cur ? -(i + 1) : i);
      }
    }
    return Int32Array.from(out);
  }

  /** 从打包位图统计人口。 */
  populationOfPacked(packed: Uint8Array): number {
    let n = 0;
    const total = this.width * this.height;
    for (let bit = 0; bit < total; bit++) if ((packed[bit >> 3] >> (bit & 7)) & 1) n++;
    return n;
  }


  /** 应用一次翻转清单（历史前进用）。返回被改动的矩形并标记脏区。 */
  applyDelta(codes: Int32Array): Rect {
    const S = this.stride;
    const cells = this.cells;
    const birth = this.birth;
    const g = this.gen & 0xffff;
    let pop = this.population;
    let x0 = this.width;
    let y0 = this.height;
    let x1 = 0;
    let y1 = 0;
    for (let k = 0; k < codes.length; k++) {
      const code = codes[k];
      const i = code >= 0 ? code : -code - 1;
      if (code >= 0) {
        cells[i] = 1;
        birth[i] = g;
        this.setBit(i, 1);
        pop++;
      } else {
        cells[i] = 0;
        birth[i] = 0;
        this.setBit(i, 0);
        pop--;
      }
      const cx = (i % S) - 1;
      const cy = (i - cx - 1) / S - 1;
      if (cx < x0) x0 = cx;
      if (cy < y0) y0 = cy;
      if (cx + 1 > x1) x1 = cx + 1;
      if (cy + 1 > y1) y1 = cy + 1;
    }
    this.population = pop < 0 ? 0 : pop;
    if (codes.length) {
      this.markDirty(x0, y0, x1, y1);
      this.expandBBox(x0, y0);
      this.expandBBox(x1 - 1, y1 - 1);
    }
    return { x0, y0, x1, y1 };
  }

  /** 反向应用一次翻转清单（历史后退用）。 */
  revertDelta(codes: Int32Array): Rect {
    const S = this.stride;
    const cells = this.cells;
    const birth = this.birth;
    const g = this.gen & 0xffff;
    let pop = this.population;
    let x0 = this.width;
    let y0 = this.height;
    let x1 = 0;
    let y1 = 0;
    for (let k = 0; k < codes.length; k++) {
      const code = codes[k];
      const i = code >= 0 ? code : -code - 1;
      if (code >= 0) {
        cells[i] = 0;
        birth[i] = 0;
        this.setBit(i, 0);
        pop--;
      } else {
        cells[i] = 1;
        birth[i] = g;
        this.setBit(i, 1);
        pop++;
      }
      const cx = (i % S) - 1;
      const cy = (i - cx - 1) / S - 1;
      if (cx < x0) x0 = cx;
      if (cy < y0) y0 = cy;
      if (cx + 1 > x1) x1 = cx + 1;
      if (cy + 1 > y1) y1 = cy + 1;
    }
    this.population = pop < 0 ? 0 : pop;
    if (codes.length) {
      this.markDirty(x0, y0, x1, y1);
      this.expandBBox(x0, y0);
      this.expandBBox(x1 - 1, y1 - 1);
    }
    return { x0, y0, x1, y1 };
  }
}

/**
 * 计算 [a,b) 在长度为 n 的环上向外扩张 1 格后的区间（跨 0 点时会裂成两段）。
 * 返回值是扁平数组：[start0, end0, start1, end1, ...]
 */
function expandedSpans(a: number, b: number, n: number, wrap: boolean): number[] {
  const s = a - 1;
  const e = b + 1;
  if (!wrap) {
    return [Math.max(0, s), Math.min(n, e)];
  }
  if (s >= 0 && e <= n) return [s, e];
  if (s < 0 && e > n) return [0, n];
  if (s < 0) {
    const tail = n + s;
    if (e >= tail) return [0, n]; // 两段相接，合并成整行
    return [tail, n, 0, e];
  }
  const head = e - n;
  if (s <= head) return [0, n]; // 两段相接，合并成整行
  return [s, n, 0, head];
}

export { EMPTY_INT32 };
