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
  readonly age: Uint8Array;

  edge: EdgeMode = 'wrap';
  gen = 0;
  population = 0;

  private nextBuf: Uint8Array;
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
    this.age = new Uint8Array(size);
    this.nextBuf = new Uint8Array(size);
    // 单代最大翻转数不会超过世界格数，一次性分配避免热路径上的扩容判断。
    this.changeBuf = new Int32Array(width * height);
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
    if (v) {
      this.age[i] = 1;
      this.population++;
      this.expandBBox(x, y);
    } else {
      this.age[i] = 0;
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
    this.age[i] = v ? 1 : 0;
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
    this.age.fill(0);
    this.nextBuf.fill(0);
    this.population = 0;
    this.gen = 0;
    this.clearBBox();
    this.markAllDirty();
  }

  /** 以给定密度随机播种（限定在中心区域，方便观察）。 */
  randomize(density = 0.32, rng: () => number = Math.random): void {
    this.cells.fill(0);
    this.age.fill(0);
    const W = this.width;
    const H = this.height;
    const span = Math.min(W, H) * 0.62;
    const x0 = Math.max(0, ((W - span) / 2) | 0);
    const y0 = Math.max(0, ((H - span) / 2) | 0);
    const x1 = Math.min(W, x0 + span);
    const y1 = Math.min(H, y0 + span);
    const S = this.stride;
    const cells = this.cells;
    const age = this.age;
    for (let y = y0; y < y1; y++) {
      const row = (y + 1) * S;
      for (let x = x0; x < x1; x++) {
        if (rng() < density) {
          cells[row + x + 1] = 1;
          age[row + x + 1] = 1;
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
          this.age[i] = 1;
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
    const S = this.stride;
    const cells = this.cells;
    const next = this.nextBuf;
    const age = this.age;

    if (this.population === 0) {
      this.gen++;
      return null;
    }

    if (this.edge === 'wrap') this.refreshBorder();

    const xSpans = expandedSpans(this.bx0, this.bx1, W, this.edge === 'wrap');
    const ySpans = expandedSpans(this.by0, this.by1, H, this.edge === 'wrap');
    const buf = this.changeBuf;
    let changeCount = 0;
    let nx0 = W;
    let ny0 = H;
    let nx1 = 0;
    let ny1 = 0;
    let pop = this.population;

    for (let sy = 0; sy < ySpans.length; sy += 2) {
      const ya = ySpans[sy];
      const yb = ySpans[sy + 1];
      for (let sx = 0; sx < xSpans.length; sx += 2) {
        const xa = xSpans[sx];
        const xb = xSpans[sx + 1];
        for (let y = ya; y < yb; y++) {
          const rowM = y * S;
          const row0 = (y + 1) * S;
          const rowP = (y + 2) * S;
          for (let x = xa; x < xb; x++) {
            const c = x + 1;
            const n =
              cells[rowM + c - 1] +
              cells[rowM + c] +
              cells[rowM + c + 1] +
              cells[row0 + c - 1] +
              cells[row0 + c + 1] +
              cells[rowP + c - 1] +
              cells[rowP + c] +
              cells[rowP + c + 1];
            const alive = cells[row0 + c];
            next[row0 + c] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
          }
        }
      }
    }

    for (let sy = 0; sy < ySpans.length; sy += 2) {
      const ya = ySpans[sy];
      const yb = ySpans[sy + 1];
      for (let sx = 0; sx < xSpans.length; sx += 2) {
        const xa = xSpans[sx];
        const xb = xSpans[sx + 1];
        for (let y = ya; y < yb; y++) {
          const row0 = (y + 1) * S;
          for (let x = xa; x < xb; x++) {
            const i = row0 + x + 1;
            const nv = next[i];
            const ov = cells[i];
            if (nv !== ov) {
              cells[i] = nv;
              if (nv) {
                age[i] = 1;
                pop++;
                buf[changeCount++] = i;
              } else {
                age[i] = 0;
                pop--;
                buf[changeCount++] = -(i + 1);
              }
            } else if (nv && age[i] < 255) {
              age[i]++;
            }
            if (nv) {
              if (x < nx0) nx0 = x;
              if (x + 1 > nx1) nx1 = x + 1;
              if (y < ny0) ny0 = y;
              if (y + 1 > ny1) ny1 = y + 1;
            }
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
    for (let sy = 0; sy < ySpans.length; sy += 2) {
      for (let sx = 0; sx < xSpans.length; sx += 2) {
        this.markDirty(xSpans[sx], ySpans[sy], xSpans[sx + 1], ySpans[sy + 1]);
      }
    }

    this.gen++;
    if (changeCount === 0) return null;
    const out = new Int32Array(changeCount);
    out.set(buf.subarray(0, changeCount));
    return out;
  }

  /** 把世界四周的 padding 环填成对边内容（环形边界）。 */
  private refreshBorder(): void {
    const W = this.width;
    const H = this.height;
    const S = this.stride;
    const p = this.cells;
    for (let x = 0; x < W; x++) {
      p[x + 1] = p[H * S + x + 1]; // 上 padding = 世界最后一行
      p[(H + 1) * S + x + 1] = p[S + x + 1]; // 下 padding = 世界第一行
    }
    for (let y = 0; y < H; y++) {
      const row = (y + 1) * S;
      p[row] = p[row + W]; // 左 padding = 世界最后一列
      p[row + W + 1] = p[row + 1]; // 右 padding = 世界第一列
    }
    p[0] = p[H * S + W];
    p[W + 1] = p[H * S + 1];
    p[(H + 1) * S] = p[S + W];
    p[(H + 1) * S + W + 1] = p[S + 1];
  }

  /** 用未填充位图覆盖整个世界（历史关键帧恢复用）。 */
  loadBits(bits: Uint8Array, population: number, gen: number): void {
    const W = this.width;
    const H = this.height;
    const S = this.stride;
    this.cells.fill(0);
    this.age.fill(0);
    for (let y = 0; y < H; y++) {
      const row = (y + 1) * S;
      const src = y * W;
      for (let x = 0; x < W; x++) {
        if (bits[src + x]) {
          const i = row + x + 1;
          this.cells[i] = 1;
          this.age[i] = 1;
        }
      }
    }
    this.population = population;
    this.gen = gen;
    this.recompute();
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
    this.age.fill(0);
    let bit = 0;
    for (let y = 0; y < H; y++) {
      const row = (y + 1) * S;
      for (let x = 0; x < W; x++) {
        if ((packed[bit >> 3] >> (bit & 7)) & 1) {
          const i = row + x + 1;
          this.cells[i] = 1;
          this.age[i] = 1;
        }
        bit++;
      }
    }
    this.population = population;
    this.gen = gen;
    this.recompute();
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
    const age = this.age;
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
        age[i] = 1;
        pop++;
      } else {
        cells[i] = 0;
        age[i] = 0;
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
    const age = this.age;
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
        age[i] = 0;
        pop--;
      } else {
        cells[i] = 1;
        age[i] = 1;
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
