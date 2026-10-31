import { framesOf, getPattern, type Bitmap, type Frame } from './life';

export type GateKind = 'AND' | 'OR' | 'NOT' | 'XOR';
export type GateCase = { a: number; b: number; q: number };
export type GateDemo = {
  kind: GateKind;
  name: string;
  en: string;
  desc: string;
  color: string;
  w: number;
  h: number;
  px: number;
  gap: number;
  gens: number;
  /** 只展示棋盘的一块（格子太小看不清，裁掉空白边） */
  crop: { x: number; y: number; w: number; h: number };
  cases: GateCase[];
  frames: Frame[][];
  note?: string;
};

const flipX = (bm: Bitmap): Bitmap => {
  const out: Bitmap = { w: bm.w, h: bm.h, cells: bm.cells.slice() };
  for (let y = 0; y < bm.h; y++) {
    for (let x = 0; x < bm.w; x++) out.cells[y * bm.w + x] = bm.cells[y * bm.w + (bm.w - 1 - x)];
  }
  return out;
};

type Piece = { bm: Bitmap; x: number; y: number };
const board = (w: number, h: number, pieces: Piece[]): Bitmap => {
  const cells = new Array<number>(w * h).fill(0);
  for (const p of pieces) {
    for (let y = 0; y < p.bm.h; y++) {
      for (let x = 0; x < p.bm.w; x++) {
        if (!p.bm.cells[y * p.bm.w + x]) continue;
        const X = p.x + x;
        const Y = p.y + y;
        if (X >= 0 && Y >= 0 && X < w && Y < h) cells[Y * w + X] = 1;
      }
    }
  }
  return { w, h, cells };
};

const GLIDER = getPattern('glider');
const MIRROR = flipX(GLIDER);
const BLOCK: Bitmap = { w: 2, h: 2, cells: [1, 1, 1, 1] };

const build = (
  kind: GateKind,
  w: number,
  h: number,
  px: number,
  gap: number,
  gens: number,
  crop: { x: number; y: number; w: number; h: number },
  cases: { a: number; b: number; q: number; pieces: Piece[] }[],
): GateDemo => ({
  kind,
  name: { AND: '与', OR: '或', NOT: '非', XOR: '异或' }[kind],
  en: kind,
  desc: {
    AND: '两路都到，才留下一个方块',
    OR: '任一路到，都会被反射出去',
    NOT: '来一颗信号，就抹掉一拍',
    XOR: '同到就消失，只到一颗就走',
  }[kind],
  color: {
    AND: '#6cf5d2',
    OR: '#9bff9b',
    NOT: '#ffb86b',
    XOR: '#8fb8ff',
  }[kind],
  w,
  h,
  px,
  gap,
  gens,
  crop,
  cases: cases.map((c) => ({ a: c.a, b: c.b, q: c.q })),
  frames: cases.map((c, i) => {
    const bm = board(w, h, c.pieces);
    return framesOf(`${kind}-case${i}`, bm, c.pieces.length ? gens : 0, { wrapX: false, wrapY: false });
  }),
});

// 与：两颗平行滑翔机错位 (-2,+3)，同时到会留下一个 4 格方块；单独一颗只是路过
const AND_A: Piece = { bm: GLIDER, x: 10, y: 5 };
const AND_B: Piece = { bm: GLIDER, x: 8, y: 8 };

export const AND_DEMO = build('AND', 52, 36, 8, 1, 80, { x: 2, y: 0, w: 38, h: 26 }, [
  { a: 0, b: 0, q: 0, pieces: [] },
  { a: 1, b: 0, q: 0, pieces: [AND_A] },
  { a: 0, b: 1, q: 0, pieces: [AND_B] },
  { a: 1, b: 1, q: 1, pieces: [AND_A, AND_B] },
]);

// 或：一个方块反射器；两路平行输入分别打在它上面，各自反射出一颗滑翔机
const OR_BLOCK: Piece = { bm: BLOCK, x: 30, y: 30 };
const OR_A: Piece = { bm: GLIDER, x: 6, y: 22 };
const OR_B: Piece = { bm: GLIDER, x: 17, y: 11 };

export const OR_DEMO = build('OR', 60, 60, 6, 1, 120, { x: 0, y: 6, w: 48, h: 38 }, [
  { a: 0, b: 0, q: 0, pieces: [OR_BLOCK] },
  { a: 1, b: 0, q: 1, pieces: [OR_BLOCK, OR_A] },
  { a: 0, b: 1, q: 1, pieces: [OR_BLOCK, OR_B] },
  { a: 1, b: 1, q: 1, pieces: [OR_BLOCK, OR_A, OR_B] },
]);

// 非：三条滑翔机的时钟流 + 一颗输入；输入正好抹掉第一拍
const NOT_CLOCK: Piece[] = [
  { bm: GLIDER, x: 4, y: 6 },
  { bm: GLIDER, x: 16, y: 18 },
  { bm: GLIDER, x: 28, y: 30 },
];
const NOT_IN: Piece = { bm: MIRROR, x: 34, y: 7 };

export const NOT_DEMO = build('NOT', 70, 60, 5, 1, 80, { x: 0, y: 0, w: 56, h: 46 }, [
  { a: 0, b: 1, q: 1, pieces: NOT_CLOCK },
  { a: 1, b: 1, q: 0, pieces: [...NOT_CLOCK, NOT_IN] },
]);
NOT_DEMO.note = 'B = 时钟（常 1）';

// 异或：两颗镜像滑翔机对撞；同到 → 0，只到一颗 → 穿过
const XOR_A: Piece = { bm: GLIDER, x: 13, y: 6 };
const XOR_B: Piece = { bm: MIRROR, x: 43, y: 7 };

export const XOR_DEMO = build('XOR', 56, 40, 7, 1, 80, { x: 6, y: 0, w: 42, h: 34 }, [
  { a: 0, b: 0, q: 0, pieces: [] },
  { a: 1, b: 0, q: 1, pieces: [XOR_A] },
  { a: 0, b: 1, q: 1, pieces: [XOR_B] },
  { a: 1, b: 1, q: 0, pieces: [XOR_A, XOR_B] },
]);

export const GATE_DEMOS: GateDemo[] = [AND_DEMO, OR_DEMO, NOT_DEMO, XOR_DEMO];
