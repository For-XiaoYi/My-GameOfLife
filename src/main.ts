import { World } from './core/world.ts';
import { History } from './core/history.ts';
import {
  renderPattern,
  patternSize,
  stampPattern,
  type PatternDef,
} from './core/patterns.ts';
import {
  Library,
  encodeCells,
  type CustomPatternRecord,
  type LibPattern,
} from './core/library.ts';
import { parsePatternText, toRle } from './core/rle.ts';
import { Store, uid, type SnapshotRecord, type ClipRecord } from './core/storage.ts';
import { Viewport } from './view/viewport.ts';
import { Renderer, makeThumb, type Ghost, type ShapePreview } from './render/renderer.ts';

// ──────────────────────────────────────────────────────────────────────────
// DOM 小工具
// ──────────────────────────────────────────────────────────────────────────
const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as unknown as T;

const nf = new Intl.NumberFormat('en-US');

// ──────────────────────────────────────────────────────────────────────────
// 全局状态
// ──────────────────────────────────────────────────────────────────────────
type ToolName = 'brush' | 'erase' | 'line' | 'rect' | 'stamp' | 'select' | 'pan';

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface DragState {
  kind: 'pan' | 'paint' | 'shape' | 'select' | 'move' | 'resize' | 'movebox';
  tool: ToolName;
  erase: boolean;
  sx: number;
  sy: number;
  lx: number;
  ly: number;
  viewOx: number;
  viewOy: number;
  shape: ShapePreview | null;
  moved: boolean;
  additive?: boolean;
  selIndex?: number;
  selEdge?: SelEdge;
  selOrig?: Rect;
  startWx?: number;
  startWy?: number;
}

const SPEED_MIN = 0.1;
const SPEED_MAX = 120;

let world: World;
let history: History;
let renderer: Renderer;
let store: Store;
let library: Library;
/** 打开分享链接时不写自动存档，免得把用户自己的存档冲掉。 */
let shareMode = false;
const view = new Viewport();

const state = {
  tool: 'pan' as ToolName,
  lastTool: 'pan' as ToolName,
  patternId: '',
  rotation: 0,
  mirror: false,
  grid: true,
  playing: false,
  unlimited: false,
  speed: 10,
  acc: 0,
  brushSize: 1,
  drag: null as DragState | null,
  hover: null as { x: number; y: number } | null,
  selection: [] as Rect[],
  editPending: false,
  recordStart: -1,
  pointers: new Map<number, { x: number; y: number }>(),
  pinch: null as null | { dist: number; cx: number; cy: number },
  modalOpen: false,
  paletteMode: 'browse' as 'browse' | 'edit',
};

let lastTs = 0;
let uiDirty = true;
let lastUi = 0;

const canvas = el<HTMLCanvasElement>('board');
const stageEl = el('stage');

// ──────────────────────────────────────────────────────────────────────────
// 速度映射
// ──────────────────────────────────────────────────────────────────────────
function sliderToSpeed(v: number): number {
  return SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, v / 100);
}

function speedToSlider(s: number): number {
  return (100 * Math.log(s / SPEED_MIN)) / Math.log(SPEED_MAX / SPEED_MIN);
}

function fmtSpeed(s: number): string {
  if (s < 1) return (Math.round(s * 100) / 100).toFixed(2).replace(/0$/, '');
  if (s < 10) return (Math.round(s * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return String(Math.round(s));
}

// ──────────────────────────────────────────────────────────────────────────
// 世界初始化
// ──────────────────────────────────────────────────────────────────────────
function seedShowcase(w: World): void {
  const cx = Math.floor(w.width / 2);
  const cy = Math.floor(w.height / 2);
  const gun = library.byId('gosperglidergun');
  const pulsar = library.byId('pulsar');
  const penta = library.byId('pentadecathlon');
  const rp = library.byId('rpentomino');
  if (gun) stampPattern(w, gun, cx - 52, cy - 22, 0, false);
  if (pulsar) stampPattern(w, pulsar, cx + 20, cy - 30, 0, false);
  if (penta) stampPattern(w, penta, cx - 26, cy + 18, 0, false);
  if (rp) stampPattern(w, rp, cx + 44, cy + 26, 0, false);
}

function rebuildWorld(width: number, height: number, edge: 'wrap' | 'dead', seed = false): void {
  world = new World(width, height);
  world.edge = edge;
  if (seed) seedShowcase(world);
  history = new History(world);
  renderer.attach(world);
  state.selection = [];
  updateSelBar();
  if (renderer.cssW > 0) fitWorld();
  uiDirty = true;
}

// ──────────────────────────────────────────────────────────────────────────
// 主循环
// ──────────────────────────────────────────────────────────────────────────
function advanceOne(): void {
  const codes = world.step();
  history.record(world.gen, codes);
  if (state.recordStart >= 0) {
    history.protectedRange = { from: state.recordStart, to: world.gen };
    updateRecordBadge();
  }
  uiDirty = true;
}

function loop(ts: number): void {
  const dt = lastTs ? Math.min(0.3, (ts - lastTs) / 1000) : 0;
  lastTs = ts;

  if (state.playing) {
    if (state.unlimited) {
      const t0 = performance.now();
      while (performance.now() - t0 < 11) {
        advanceOne();
        if (!state.playing) break;
      }
    } else {
      state.acc += dt * state.speed;
      let budget = 64;
      while (state.acc >= 1 && budget-- > 0) {
        state.acc -= 1;
        advanceOne();
      }
      if (state.acc > 3) state.acc = 1;
    }
  } else {
    state.acc = 0;
  }

  renderer.sync();
  const overlay = buildOverlay();
  renderer.render(view, { grid: state.grid }, overlay);

  if (uiDirty && ts - lastUi > 80) {
    lastUi = ts;
    uiDirty = false;
    flushUi();
  }
  requestAnimationFrame(loop);
}

function buildOverlay(): {
  ghost: Ghost | null;
  brush: { x: number; y: number; size: number } | null;
  shape: ShapePreview | null;
  selection: Rect[] | null;
} {
  let ghost: Ghost | null = null;
  let brush: { x: number; y: number; size: number } | null = null;

  // 涂抹过程中也要一直显示笔刷范围，否则看不出擦到哪了
  const painting = state.drag?.kind === 'paint';
  if (state.hover && (!state.drag || painting)) {
    if (state.tool === 'stamp') {
      const pat = library.byId(state.patternId);
      if (pat) {
        const r = renderPattern(pat, state.rotation, state.mirror);
        const x = state.hover.x - Math.floor(r.w / 2);
        const y = state.hover.y - Math.floor(r.h / 2);
        const ok = x >= 0 && y >= 0 && x + r.w <= world.width && y + r.h <= world.height;
        ghost = { cells: r.cells, w: r.w, h: r.h, x, y, ok };
      }
    } else if (state.tool === 'brush' || state.tool === 'erase') {
      brush = { x: state.hover.x, y: state.hover.y, size: state.brushSize };
    }
  }

  const d = state.drag;
  let selection: Rect[] = state.selection;
  if (d && d.kind === 'select' && state.hover) {
    const live = normalizeSelection(d.lx, d.ly, state.hover.x, state.hover.y);
    selection = live ? [...state.selection, live] : state.selection;
  }
  if (moveState) {
    const m = moveState;
    ghost = { cells: m.cells, w: m.w, h: m.h, x: m.x0 + m.dx, y: m.y0 + m.dy, ok: true };
    selection = m.rects.map((r) => ({
      x0: r.x0 + m.dx,
      y0: r.y0 + m.dy,
      x1: r.x1 + m.dx,
      y1: r.y1 + m.dy,
    }));
  }
  return {
    ghost,
    brush,
    shape: d && d.kind === 'shape' ? d.shape : null,
    selection: selection.length > 0 ? selection : null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// UI 刷新
// ──────────────────────────────────────────────────────────────────────────
function flushUi(): void {
  el('stat-gen').textContent = nf.format(world.gen);
  el('stat-pop').textContent = nf.format(world.population);
  el('stat-speed').textContent = state.unlimited ? '∞' : fmtSpeed(state.speed);
  el('speed-label').textContent = state.unlimited ? '不限速' : `${fmtSpeed(state.speed)} 代/秒`;
  const st = history.stats();
  el('stat-hist').textContent = nf.format(st.gens);
  updateTimeline(st.minGen, st.maxGen);
}

function updateTimeline(min: number, max: number): void {
  const tl = el<HTMLInputElement>('timeline');
  tl.min = String(min);
  tl.max = String(max);
  if (document.activeElement !== tl) tl.value = String(world.gen);
  el('timeline-label').textContent = `第 ${nf.format(world.gen)} 代`;
}

function updateRecordBadge(): void {
  const badge = el('rec-badge');
  if (state.recordStart < 0) {
    badge.classList.add('hidden');
    return;
  }
  badge.classList.remove('hidden');
  el('rec-count').textContent = String(Math.max(0, world.gen - state.recordStart));
}

function setPlaying(on: boolean): void {
  state.playing = on;
  state.acc = 0;
  el('btn-play').textContent = on ? '❙❙' : '▶';
  el('btn-play').classList.toggle('primary', !on);
}

const toastEl = el('toast');
let toastTimer = 0;
function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1900);
}

// ──────────────────────────────────────────────────────────────────────────
// 编辑与撤销
// ──────────────────────────────────────────────────────────────────────────
interface EditSnapshot {
  kind: 'world';
  packed: Uint8Array;
  population: number;
  label: string;
}

interface SelSnapshot {
  kind: 'sel';
  rects: Rect[];
  label: string;
}

type UndoEntry = EditSnapshot | SelSnapshot;

const UNDO_BYTES = 24 * 1024 * 1024;
let undoStack: UndoEntry[] = [];
let redoStack: UndoEntry[] = [];
let editBase: EditSnapshot | null = null;

function snapshot(label: string): EditSnapshot {
  return { kind: 'world', packed: world.toPacked(), population: world.population, label };
}

/** 在任何改动世界之前调用，记下改动前的样子。 */
function beginEdit(label: string): void {
  editBase = snapshot(label);
}

/** 选区变化也进同一个撤销栈，这样 Ctrl+Z 能一路退回去。 */
function pushSelUndo(rects: Rect[], label: string): void {
  undoStack.push({ kind: 'sel', rects: rects.map((r) => ({ ...r })), label });
  redoStack = [];
  trimUndo();
}

function trimUndo(): void {
  let bytes = 0;
  for (const s of undoStack) if (s.kind === 'world') bytes += s.packed.byteLength;
  while (undoStack.length > 1 && bytes > UNDO_BYTES) {
    const dropped = undoStack.shift();
    if (dropped && dropped.kind === 'world') bytes -= dropped.packed.byteLength;
  }
  const maxEntries = 200;
  if (undoStack.length > maxEntries) undoStack = undoStack.slice(-maxEntries);
}

function commitEdit(label?: string): void {
  if (editBase) {
    undoStack.push({ ...editBase, label: label ?? editBase.label });
    editBase = null;
    redoStack = [];
    trimUndo();
  }
  history.markEdited(world.gen, world.toPacked(), world.population);
  uiDirty = true;
}

function applySnapshot(s: EditSnapshot): void {
  world.loadPacked(s.packed, s.population, world.gen);
  history.markEdited(world.gen, s.packed, s.population);
  uiDirty = true;
}

function restoreRects(rects: Rect[]): void {
  state.selection = rects.map((r) => ({ ...r }));
  updateSelBar();
}

function undoEdit(): void {
  const entry = undoStack.pop();
  if (!entry) {
    toast('没有可以撤销的操作了');
    return;
  }
  if (entry.kind === 'sel') {
    redoStack.push({ kind: 'sel', rects: state.selection.map((r) => ({ ...r })), label: entry.label });
    restoreRects(entry.rects);
    toast(`已撤销：${entry.label}`);
    return;
  }
  redoStack.push(snapshot(entry.label));
  applySnapshot(entry);
  toast(`已撤销：${entry.label}`);
}

function redoEdit(): void {
  const entry = redoStack.pop();
  if (!entry) {
    toast('没有可以重做的操作了');
    return;
  }
  if (entry.kind === 'sel') {
    undoStack.push({ kind: 'sel', rects: state.selection.map((r) => ({ ...r })), label: entry.label });
    restoreRects(entry.rects);
    toast(`已重做：${entry.label}`);
    return;
  }
  undoStack.push(snapshot(entry.label));
  applySnapshot(entry);
  toast(`已重做：${entry.label}`);
}

function paintCell(x: number, y: number, value: number): void {
  const n = state.brushSize;
  if (n <= 1) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
    if (world.get(x, y) === value) return;
    world.set(x, y, value);
    state.editPending = true;
    return;
  }
  const r = (n - 1) >> 1;
  let touched = false;
  for (let dy = -r; dy <= r; dy++) {
    const wy = y + dy;
    if (wy < 0 || wy >= world.height) continue;
    for (let dx = -r; dx <= r; dx++) {
      const wx = x + dx;
      if (wx < 0 || wx >= world.width) continue;
      if (world.get(wx, wy) === value) continue;
      world.set(wx, wy, value);
      touched = true;
    }
  }
  if (touched) state.editPending = true;
}

function paintLine(x0: number, y0: number, x1: number, y1: number, value: number): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    paintCell(x, y, value);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function applyShape(s: ShapePreview): void {
  const value = s.erase ? 0 : 1;
  if (s.kind === 'line') {
    paintLine(s.x0, s.y0, s.x1, s.y1, value);
  } else {
    const x0 = Math.min(s.x0, s.x1);
    const y0 = Math.min(s.y0, s.y1);
    const x1 = Math.max(s.x0, s.x1);
    const y1 = Math.max(s.y0, s.y1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) paintCell(x, y, value);
    }
  }
}

function placePattern(p: { x: number; y: number }): void {
  const pat = library.byId(state.patternId);
  if (!pat) {
    toast('先在右边图案库里点一个图案');
    return;
  }
  const size = patternSize(pat, state.rotation);
  const x = p.x - Math.floor(size.w / 2);
  const y = p.y - Math.floor(size.h / 2);
  beginEdit(`放置 ${pat.name}`);
  stampPattern(world, pat, x, y, state.rotation, state.mirror);
  state.editPending = false;
  commitEdit();
  toast(`${pat.name} 已放置`);
}

// ──────────────────────────────────────────────────────────────────────────
// 指针交互
// ──────────────────────────────────────────────────────────────────────────
function localPoint(e: PointerEvent | MouseEvent | WheelEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function worldAt(p: { x: number; y: number }): { x: number; y: number } {
  const w = view.screenToWorld(p.x, p.y);
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}

function setTool(tool: ToolName): void {
  if (tool !== state.tool && state.tool !== 'select') state.lastTool = state.tool;
  state.tool = tool;
  canvas.style.cursor = '';
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#toolbar .tool')) {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  }
  updateHint();
}

const BRUSH_MAX = 31;

function adjustBrushSize(delta: number): void {
  const next = Math.max(1, Math.min(BRUSH_MAX, state.brushSize + delta));
  if (next === state.brushSize) return;
  state.brushSize = next;
  updateHint();
}

function updateHint(): void {
  const draw = el('hint').querySelector<HTMLElement>('[data-hint="draw"]');
  const mid = el('hint').querySelector<HTMLElement>('[data-hint="mid"]');
  const wheel = el('hint').querySelector<HTMLElement>('[data-hint="wheel"]');
  if (!draw || !mid || !wheel) return;
  mid.textContent = '右键拖拽平移';
  if (state.tool === 'brush' || state.tool === 'erase') {
    const name = state.tool === 'erase' ? '橡皮' : '画笔';
    draw.textContent = `${name} ${state.brushSize}×${state.brushSize}`;
    mid.textContent = 'Ctrl+滚轮调大小';
    wheel.textContent = '滚轮缩放 · [ ] 也可调';
  } else if (state.tool === 'select') {
    draw.textContent = '拖拽框选';
    mid.textContent = 'Ctrl 加选 · Shift 重框';
    wheel.textContent = 'Alt 移框 · Esc 退出';
  } else if (state.tool === 'pan') {
    draw.textContent = '拖拽平移画布';
    mid.textContent = '0 适应视图';
    wheel.textContent = '滚轮缩放';
  } else if (state.tool === 'stamp') {
    const pat = library.byId(state.patternId);
    draw.textContent = pat ? `点击摆放「${pat.name}」` : '先在右边挑一个图案';
    mid.textContent = pat ? 'R 旋转 · M 镜像' : '点空白处可取消选中';
    wheel.textContent = '滚轮缩放';
  } else {
    draw.textContent = '拖拽绘制';
    wheel.textContent = '滚轮缩放';
  }
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  const p = localPoint(e);
  state.pointers.set(e.pointerId, p);

  if (state.pointers.size === 2) {
    if (state.drag && state.drag.kind === 'paint' && state.editPending) {
      commitEdit();
      state.editPending = false;
    }
    state.drag = null;
    state.pinch = null;
    return;
  }
  if (state.pointers.size > 2) return;

  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* 合成事件或指针已失效时浏览器会抛错，忽略即可 */
  }
  const wp = worldAt(p);
  const wantPan = state.tool === 'pan' || e.button === 2 || e.button === 1;

  if (wantPan) {
    stageEl.classList.add('panning');
    state.drag = {
      kind: 'pan',
      tool: state.tool,
      erase: false,
      sx: p.x,
      sy: p.y,
      lx: p.x,
      ly: p.y,
      viewOx: view.ox,
      viewOy: view.oy,
      shape: null,
      moved: false,
    };
    return;
  }

  if (state.playing) setPlaying(false);

  if (state.tool === 'stamp') {
    placePattern(wp);
    return;
  }

  if (state.tool === 'select') {
    const additive = e.ctrlKey || e.metaKey;
    const handle = selectionHandleAt(wp.x, wp.y);
    // 1) 按在边框 / 角上 = 改这个框的大小
    if (handle && !additive && !e.shiftKey) {
      pushSelUndo(state.selection, '调整选择框');
      state.drag = {
        kind: 'resize',
        tool: 'select',
        erase: false,
        sx: p.x,
        sy: p.y,
        lx: wp.x,
        ly: wp.y,
        viewOx: view.ox,
        viewOy: view.oy,
        shape: null,
        moved: false,
        selIndex: handle.index,
        selEdge: handle.edge,
        selOrig: { ...state.selection[handle.index]! },
      };
      return;
    }
    // 2) 框内按下：Alt = 只挪这个框，默认 = 连内容一起搬
    if (state.selection.length > 0 && !e.shiftKey && !additive && insideSelection(wp.x, wp.y)) {
      if (e.altKey) {
        const idx = selectionIndexAt(wp.x, wp.y);
        pushSelUndo(state.selection, '移动选择框');
        state.drag = {
          kind: 'movebox',
          tool: 'select',
          erase: false,
          sx: p.x,
          sy: p.y,
          lx: wp.x,
          ly: wp.y,
          viewOx: view.ox,
          viewOy: view.oy,
          shape: null,
          moved: false,
          selIndex: idx,
          selOrig: { ...state.selection[idx]! },
          startWx: wp.x,
          startWy: wp.y,
        };
        return;
      }
      startMoveSelection(wp.x, wp.y);
      return;
    }
    state.drag = {
      kind: 'select',
      tool: state.tool,
      erase: false,
      sx: p.x,
      sy: p.y,
      lx: wp.x,
      ly: wp.y,
      viewOx: view.ox,
      viewOy: view.oy,
      shape: null,
      moved: false,
      additive,
    };
    if (!additive) {
      if (state.selection.length > 0) pushSelUndo(state.selection, '重新框选');
      state.selection = [];
    }
    updateSelBar();
    return;
  }

  const erase = state.tool === 'erase' || e.altKey;
  if (state.tool === 'line' || state.tool === 'rect') {
    state.drag = {
      kind: 'shape',
      tool: state.tool,
      erase,
      sx: p.x,
      sy: p.y,
      lx: wp.x,
      ly: wp.y,
      viewOx: view.ox,
      viewOy: view.oy,
      shape: {
        kind: state.tool,
        x0: wp.x,
        y0: wp.y,
        x1: wp.x,
        y1: wp.y,
        erase,
      },
      moved: false,
    };
    return;
  }

  state.drag = {
    kind: 'paint',
    tool: state.tool,
    erase,
    sx: p.x,
    sy: p.y,
    lx: wp.x,
    ly: wp.y,
    viewOx: view.ox,
    viewOy: view.oy,
    shape: null,
    moved: false,
  };
  beginEdit(erase ? '擦除' : '绘制');
  paintCell(wp.x, wp.y, erase ? 0 : 1);
});

window.addEventListener('pointermove', (e) => {
  const p = localPoint(e);

  if (state.pointers.has(e.pointerId)) state.pointers.set(e.pointerId, p);

  if (state.pointers.size === 2) {
    updatePinch();
    return;
  }

  if (p.x >= 0 && p.y >= 0 && p.x <= canvas.clientWidth && p.y <= canvas.clientHeight) {
    state.hover = worldAt(p);
  } else {
    state.hover = null;
  }

  const d = state.drag;
  if (!d) {
    updateSelectCursor(p);
    return;
  }

  if (d.kind === 'pan') {
    const dx = p.x - d.sx;
    const dy = p.y - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    view.ox = d.viewOx + dx;
    view.oy = d.viewOy + dy;
    return;
  }

  const wp = worldAt(p);
  d.moved = true;
  if (d.kind === 'paint') {
    paintLine(d.lx, d.ly, wp.x, wp.y, d.erase ? 0 : 1);
    d.lx = wp.x;
    d.ly = wp.y;
  } else if (d.kind === 'shape' && d.shape) {
    d.shape.x1 = wp.x;
    d.shape.y1 = wp.y;
  } else if (d.kind === 'resize' && d.selOrig && d.selIndex !== undefined && d.selEdge) {
    state.selection[d.selIndex] = resizeRect(d.selOrig, d.selEdge, wp.x, wp.y);
    updateSelBar();
  } else if (d.kind === 'movebox' && d.selOrig && d.selIndex !== undefined) {
    const dx = wp.x - (d.startWx ?? wp.x);
    const dy = wp.y - (d.startWy ?? wp.y);
    const w = d.selOrig.x1 - d.selOrig.x0;
    const h = d.selOrig.y1 - d.selOrig.y0;
    const x0 = Math.max(0, Math.min(world.width - 1 - w, d.selOrig.x0 + dx));
    const y0 = Math.max(0, Math.min(world.height - 1 - h, d.selOrig.y0 + dy));
    state.selection[d.selIndex] = { x0, y0, x1: x0 + w, y1: y0 + h };
    updateSelBar();
  } else if (d.kind === 'move' && moveState) {
    moveState.dx = wp.x - moveState.startWx;
    moveState.dy = wp.y - moveState.startWy;
    uiDirty = true;
  }
});

function endPointer(e: PointerEvent): void {
  state.pointers.delete(e.pointerId);
  if (state.pointers.size < 2) state.pinch = null;

  const d = state.drag;
  state.drag = null;
  stageEl.classList.remove('panning');
  if (!d) return;

  if (d.kind === 'paint') {
    if (state.editPending) {
      commitEdit();
      state.editPending = false;
    } else {
      editBase = null;
    }
  } else if (d.kind === 'shape' && d.shape) {
    beginEdit(d.erase ? '矩形擦除' : d.shape.kind === 'line' ? '直线' : '矩形');
    applyShape(d.shape);
    if (state.editPending) {
      commitEdit();
      state.editPending = false;
    } else {
      editBase = null;
    }
  } else if (d.kind === 'select') {
    const wp = worldAt(localPoint(e));
    const rect = normalizeSelection(d.lx, d.ly, wp.x, wp.y);
    if (rect && d.moved) {
      state.selection = d.additive ? [...state.selection, rect] : [rect];
    }
    updateSelBar();
  } else if (d.kind === 'move') {
    finishMoveSelection();
  } else if (d.kind === 'resize' || d.kind === 'movebox') {
    updateSelBar();
    uiDirty = true;
  }
}

window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  if (state.pointers.size === 0) state.hover = null;
});

function updatePinch(): void {
  const pts = Array.from(state.pointers.values());
  if (pts.length < 2) return;
  const a = pts[0];
  const b = pts[1];
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const prev = state.pinch;
  if (!prev) {
    state.pinch = { dist, cx, cy };
    return;
  }
  if (prev.dist > 1) view.zoomAt(cx, cy, dist / prev.dist);
  view.panBy(cx - prev.cx, cy - prev.cy);
  state.pinch = { dist, cx, cy };
}

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = localPoint(e);
    const sizeTool = state.tool === 'brush' || state.tool === 'erase';
    // 滚轮默认缩放；画笔/橡皮下 Ctrl+滚轮改笔刷大小（Alt/Shift 也行）
    if (sizeTool && (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) {
      state.hover = worldAt(p);
      adjustBrushSize(e.deltaY > 0 ? -2 : 2);
      return;
    }
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.06 : 0.0016));
    view.zoomAt(p.x, p.y, factor);
    state.hover = worldAt(p);
  },
  { passive: false },
);

// ──────────────────────────────────────────────────────────────────────────
// 键盘
// ──────────────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  // 确认框开着的时候，键盘只服务于它
  if (confirmOpen()) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeConfirm(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      closeConfirm(true);
    }
    return;
  }
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;

  if (e.key === 'Escape' && state.modalOpen) {
    closeModal();
    return;
  }
  if (e.key === 'Escape' && moveState) {
    cancelMoveSelection();
    state.drag = null;
    toast('已放回原处');
    return;
  }
  if (e.key === 'Escape' && state.tool === 'select') {
    clearSelection();
    setTool(state.lastTool ?? 'pan');
    toast('已退出选择框');
    return;
  }
  if (state.modalOpen) return;

  // 撤销 / 重做
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoEdit();
      else undoEdit();
      return;
    }
    if (k === 'y') {
      e.preventDefault();
      redoEdit();
      return;
    }
  }

  if (e.code === 'Space') {
    e.preventDefault();
    if (e.repeat) return;
    setPlaying(!state.playing);
    return;
  }

  const k = e.key.toLowerCase();
  switch (k) {
    case 'b':
      setTool('brush');
      break;
    case 'e':
      setTool('erase');
      break;
    case 'i':
      setTool('line');
      break;
    case 'u':
      setTool('rect');
      break;
    case 's':
      setTool('stamp');
      break;
    case 'k':
      setTool('select');
      break;
    case 'h':
      setTool('pan');
      break;
    case 'g':
      toggleGrid();
      break;
    case 'p':
      setPlaying(!state.playing);
      break;
    case 'r':
      rotatePattern();
      break;
    case 'm':
      mirrorPattern();
      break;
    case 'arrowright':
      stepOnce(1);
      e.preventDefault();
      break;
    case 'arrowleft':
      stepOnce(-1);
      e.preventDefault();
      break;
    case 'arrowup':
      view.zoomAt(renderer.cssW / 2, renderer.cssH / 2, 1.25);
      e.preventDefault();
      break;
    case 'arrowdown':
      view.zoomAt(renderer.cssW / 2, renderer.cssH / 2, 0.8);
      e.preventDefault();
      break;
    case '0':
      fitWorld();
      break;
    case 'delete':
    case 'backspace':
      // 有选区就删选区内容（可撤销），没有就清空世界
      if (state.selection.length > 0) deleteSelection();
      else clearWorld();
      break;
    case '[':
      adjustBrushSize(-2);
      break;
    case ']':
      adjustBrushSize(2);
      break;
    default:
      break;
  }
});

function stepOnce(dir: number): void {
  if (state.playing) setPlaying(false);
  if (dir > 0) {
    advanceOne();
  } else {
    const st = history.stats();
    if (world.gen > st.minGen) history.seek(world.gen - 1);
  }
  renderer.sync();
  flushUi();
}

/**
 * 画布上真正「空着」的区域：左边工具栏、右边图案库都是浮层，居中要避开它们，
 * 否则世界会偏到图案库底下。
 */
function freeArea(): { x: number; y: number; w: number; h: number } {
  const box = stageEl.getBoundingClientRect();
  const palEl = el<HTMLElement>('palette');
  // 收起后只是一个 40×40 的小图标，不再占用右侧一整条
  const collapsed = palEl.classList.contains('collapsed');
  const palW = collapsed || palEl.offsetWidth === 0 ? 56 : palEl.offsetWidth + 24;
  const left = 72;
  const right = palW + 12;
  return {
    x: left,
    y: 14,
    w: Math.max(180, box.width - left - right),
    h: Math.max(180, box.height - 28),
  };
}

function fitWorld(): void {
  const a = freeArea();
  const s = view.clampScale(Math.min(a.w / world.width, a.h / world.height));
  view.scale = s;
  view.ox = a.x + (a.w - world.width * s) / 2;
  view.oy = a.y + (a.h - world.height * s) / 2;
  uiDirty = true;
}

/** 把当前所有活细胞框进视野（初次进入时用，免得 1024² 的图案小得看不见）。 */
function fitContent(pad = 28): void {
  const bb = world.liveBBox();
  if (bb.x1 <= bb.x0 || bb.y1 <= bb.y0) {
    fitWorld();
    return;
  }
  const a = freeArea();
  const w = bb.x1 - bb.x0;
  const h = bb.y1 - bb.y0;
  const s = view.clampScale(Math.min((a.w - pad * 2) / w, (a.h - pad * 2) / h, 11));
  view.scale = s;
  view.ox = a.x + (a.w - w * s) / 2 - bb.x0 * s;
  view.oy = a.y + (a.h - h * s) / 2 - bb.y0 * s;
  uiDirty = true;
}

function clearWorld(): void {
  if (state.playing) setPlaying(false);
  beginEdit('清空世界');
  world.clear();
  commitEdit();
  toast('世界已清空');
}

function randomWorld(): void {
  if (state.playing) setPlaying(false);
  beginEdit('随机播种');
  world.clear();
  world.randomize(0.28);
  commitEdit();
  toast('随机播种完成');
}

function toggleGrid(): void {
  state.grid = !state.grid;
  el('tgl-grid').classList.toggle('on', state.grid);
}

function rotatePattern(): void {
  state.rotation = (state.rotation + 1) % 4;
  el('btn-rotate').textContent = `旋转 ${state.rotation * 90}°`;
}

function mirrorPattern(): void {
  state.mirror = !state.mirror;
  el('btn-mirror').classList.toggle('on', state.mirror);
  el('btn-mirror').textContent = state.mirror ? '镜像 开' : '镜像';
}

// ──────────────────────────────────────────────────────────────────────────
// 图案库
// ──────────────────────────────────────────────────────────────────────────
function drawPatternIcon(c: HTMLCanvasElement, pat: PatternDef): void {
  const ctx = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  ctx.clearRect(0, 0, W, H);
  const k = Math.min((W - 6) / pat.w, (H - 6) / pat.h);
  const ox = (W - pat.w * k) / 2;
  const oy = (H - pat.h * k) / 2;
  ctx.fillStyle = '#6cf5d2';
  for (let y = 0; y < pat.h; y++) {
    for (let x = 0; x < pat.w; x++) {
      if (!pat.cells[y * pat.w + x]) continue;
      ctx.fillRect(ox + x * k, oy + y * k, Math.max(1, k), Math.max(1, k));
    }
  }
}

/** 按当前模式重建图案库（浏览 = 方块按钮，编辑 = 管理面板）。 */
function refreshPalette(): void {
  if (state.paletteMode === 'edit') buildEditPanel();
  else buildPalette();
}

function buildPalette(): void {
  const list = el('palette-list');
  list.innerHTML = '';
  for (const cat of library.categories) {
    const items = library.patternsIn(cat.id);
    if (!items.length) continue;
    const title = document.createElement('div');
    title.className = 'cat-title';
    title.textContent = cat.name;
    list.append(title);
    const grid = document.createElement('div');
    grid.className = 'pat-grid';
    for (const pat of items) {
      const btn = document.createElement('button');
      btn.className = 'pat';
      btn.dataset.id = pat.id;
      btn.title = `${pat.name}${pat.custom ? '（自定义）' : ' · ' + pat.en}${pat.period > 1 ? ` · 周期 ${pat.period}` : ''}`;
      const c = document.createElement('canvas');
      c.width = 56;
      c.height = 38;
      drawPatternIcon(c, pat);
      const label = document.createElement('span');
      label.textContent = pat.name;
      btn.append(c, label);
      btn.addEventListener('click', () => {
        selectPattern(pat.id);
        clearSelection();
      });
      grid.append(btn);
    }
    list.append(grid);
  }
  if (!library.visible.length) {
    const tip = document.createElement('div');
    tip.className = 'cat-title';
    tip.textContent = '库里没有图案，点右上角 ⚙ 恢复';
    list.append(tip);
  }
  // 不再自动选中第一个图案：进贴图模式时不该凭空冒出一个幽灵
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#palette .pat')) {
    btn.classList.toggle('active', btn.dataset.id === state.patternId);
  }
}

function selectPattern(id: string): void {
  const pat = library.byId(id);
  if (!pat) return;
  state.patternId = id;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#palette .pat')) {
    btn.classList.toggle('active', btn.dataset.id === id);
  }
  setTool('stamp');
}

/** 取消选中：贴图工具下光标不再跟着一个幽灵图案。 */
function deselectPattern(): void {
  state.patternId = '';
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#palette .pat')) {
    btn.classList.remove('active');
  }
  uiDirty = true;
}

// ──────────────────────────────────────────────────────────────────────────
// 框选：把选中的内容存成自定义图案
// ──────────────────────────────────────────────────────────────────────────
function normalizeSelection(x0: number, y0: number, x1: number, y1: number): Rect | null {
  const cx0 = Math.max(0, Math.min(x0, x1));
  const cx1 = Math.min(world.width - 1, Math.max(x0, x1));
  const cy0 = Math.max(0, Math.min(y0, y1));
  const cy1 = Math.min(world.height - 1, Math.max(y0, y1));
  if (cx1 < cx0 || cy1 < cy0) return null;
  return { x0: cx0, y0: cy0, x1: cx1, y1: cy1 };
}

/** 多个选区框的总包围盒。 */
function selectionBBox(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    if (r.x0 < x0) x0 = r.x0;
    if (r.y0 < y0) y0 = r.y0;
    if (r.x1 > x1) x1 = r.x1;
    if (r.y1 > y1) y1 = r.y1;
  }
  return { x0, y0, x1, y1 };
}

/** 把若干选区框覆盖的活细胞提到一张位图上（坐标系是总包围盒）。 */
function selectionMask(
  rects: Rect[],
): { box: Rect; cells: Uint8Array; w: number; h: number } | null {
  const box = selectionBBox(rects);
  if (!box) return null;
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const cells = new Uint8Array(w * h);
  for (const r of rects) {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        if (!world.get(x, y)) continue;
        cells[(y - box.y0) * w + (x - box.x0)] = 1;
      }
    }
  }
  return { box, cells, w, h };
}

function insideSelection(wx: number, wy: number): boolean {
  return state.selection.some((s) => wx >= s.x0 && wx <= s.x1 && wy >= s.y0 && wy <= s.y1);
}

// ── 选择框的边角手柄：拖边框改大小、Alt 拖框内只挪框 ──────────────────────
type SelEdge = 'l' | 'r' | 't' | 'b' | 'tl' | 'tr' | 'bl' | 'br';

const HANDLE_PX = 7;

/** 命中哪个框的哪条边（或哪个角）。容差按屏幕像素折算，缩放多大都好点。 */
function selectionHandleAt(wx: number, wy: number): { index: number; edge: SelEdge } | null {
  if (state.tool !== 'select' || state.selection.length === 0) return null;
  const tol = HANDLE_PX / Math.max(view.scale, 0.001);
  for (let i = state.selection.length - 1; i >= 0; i--) {
    const r = state.selection[i]!;
    const left = r.x0;
    const right = r.x1 + 1;
    const top = r.y0;
    const bottom = r.y1 + 1;
    const onL = Math.abs(wx - left) <= tol;
    const onR = Math.abs(wx - right) <= tol;
    const onT = Math.abs(wy - top) <= tol;
    const onB = Math.abs(wy - bottom) <= tol;
    const inX = wx >= left - tol && wx <= right + tol;
    const inY = wy >= top - tol && wy <= bottom + tol;
    if (!inX || !inY) continue;
    const hSide = onL ? 'l' : onR ? 'r' : '';
    const vSide = onT ? 't' : onB ? 'b' : '';
    if (hSide && vSide) return { index: i, edge: `${vSide}${hSide}` as SelEdge };
    if (hSide) return { index: i, edge: hSide as SelEdge };
    if (vSide) return { index: i, edge: vSide as SelEdge };
  }
  return null;
}

function handleCursor(edge: SelEdge): string {
  switch (edge) {
    case 'l':
    case 'r':
      return 'ew-resize';
    case 't':
    case 'b':
      return 'ns-resize';
    case 'tl':
    case 'br':
      return 'nwse-resize';
    default:
      return 'nesw-resize';
  }
}

function selectionIndexAt(wx: number, wy: number): number {
  for (let i = state.selection.length - 1; i >= 0; i--) {
    const r = state.selection[i]!;
    if (wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1) return i;
  }
  return -1;
}

/** 正在拖的框按鼠标位置重算（保持对边不动，钳在世界内）。 */
function resizeRect(orig: Rect, edge: SelEdge, wx: number, wy: number): Rect {
  let { x0, y0, x1, y1 } = orig;
  if (edge.includes('l')) x0 = Math.max(0, Math.min(wx, x1));
  if (edge.includes('r')) x1 = Math.min(world.width - 1, Math.max(wx, x0));
  if (edge.includes('t')) y0 = Math.max(0, Math.min(wy, y1));
  if (edge.includes('b')) y1 = Math.min(world.height - 1, Math.max(wy, y0));
  return { x0, y0, x1, y1 };
}

function updateSelectCursor(p: { x: number; y: number }): void {
  if (state.tool !== 'select') {
    if (canvas.style.cursor) canvas.style.cursor = '';
    return;
  }
  if (state.drag) return;
  const wp = worldAt(p);
  const h = selectionHandleAt(wp.x, wp.y);
  let c = 'crosshair';
  if (h) c = handleCursor(h.edge);
  else if (selectionIndexAt(wp.x, wp.y) >= 0) c = 'move';
  if (canvas.style.cursor !== c) canvas.style.cursor = c;
}

// ── 拖动选区里的内容 ──────────────────────────────────────────────────────
interface MoveState {
  cells: Uint8Array;
  w: number;
  h: number;
  x0: number;
  y0: number;
  rects: Rect[];
  dx: number;
  dy: number;
  startWx: number;
  startWy: number;
}

let moveState: MoveState | null = null;

function startMoveSelection(wx: number, wy: number): void {
  const mask = selectionMask(state.selection);
  if (!mask) return;
  let pop = 0;
  for (let i = 0; i < mask.cells.length; i++) pop += mask.cells[i];
  if (pop === 0) {
    toast('选区里没有活细胞');
    return;
  }
  beginEdit('移动选区');
  for (const r of state.selection) {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        if (world.get(x, y)) world.set(x, y, 0);
      }
    }
  }
  moveState = {
    cells: mask.cells,
    w: mask.w,
    h: mask.h,
    x0: mask.box.x0,
    y0: mask.box.y0,
    rects: state.selection.map((r) => ({ ...r })),
    dx: 0,
    dy: 0,
    startWx: wx,
    startWy: wy,
  };
  state.drag = {
    kind: 'move',
    tool: 'select',
    erase: false,
    sx: wx,
    sy: wy,
    lx: wx,
    ly: wy,
    viewOx: view.ox,
    viewOy: view.oy,
    shape: null,
    moved: false,
  };
  toast('拖动中：松手放下，Esc 放回原处');
}

function finishMoveSelection(): void {
  const m = moveState;
  moveState = null;
  if (!m) return;
  world.stamp(m.cells, m.w, m.h, m.x0 + m.dx, m.y0 + m.dy);
  state.selection = m.rects.map((r) =>
    normalizeSelection(r.x0 + m.dx, r.y0 + m.dy, r.x1 + m.dx, r.y1 + m.dy),
  ).filter((r): r is Rect => !!r);
  updateSelBar();
  commitEdit();
}

function cancelMoveSelection(): void {
  const m = moveState;
  moveState = null;
  if (!m) return;
  world.stamp(m.cells, m.w, m.h, m.x0, m.y0);
  editBase = null;
  state.selection = m.rects;
  updateSelBar();
}

function selectionBitmap(
  rects: Rect[],
  trim = true,
): { cells: Uint8Array; w: number; h: number; population: number; trimmed: boolean } {
  const mask = selectionMask(rects);
  if (!mask) return { cells: new Uint8Array(0), w: 0, h: 0, population: 0, trimmed: false };
  const { cells, w, h } = mask;
  let population = 0;
  for (let i = 0; i < cells.length; i++) population += cells[i];
  if (!trim || population === 0) return { cells, w, h, population, trimmed: false };

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!cells[y * w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  if (tw === w && th === h) return { cells, w, h, population, trimmed: false };
  const out = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    out.set(cells.subarray((y + minY) * w + minX, (y + minY) * w + minX + tw), y * tw);
  }
  return { cells: out, w: tw, h: th, population, trimmed: true };
}

function updateSelBar(): void {
  const bar = el('sel-bar');
  const box = selectionBBox(state.selection);
  if (!box) {
    bar.classList.add('hidden');
    uiDirty = true;
    return;
  }
  const bmp = selectionBitmap(state.selection, false);
  const blocks = state.selection.length > 1 ? ` · ${state.selection.length} 块` : '';
  el('sel-info').textContent = `${bmp.w} × ${bmp.h} · ${bmp.population} 个活细胞${blocks}`;
  bar.classList.remove('hidden');
  uiDirty = true;
}

function clearSelection(withUndo = true): void {
  if (state.selection.length === 0) return;
  if (withUndo) pushSelUndo(state.selection, '取消选择');
  state.selection = [];
  updateSelBar();
}

/** 删掉所有选区框里的活细胞，算一步可撤销的编辑。 */
function deleteSelection(): void {
  if (state.selection.length === 0) {
    toast('还没有选区：按 K 或点左侧虚线框工具框一块');
    return;
  }
  const bmp = selectionBitmap(state.selection, false);
  if (bmp.population === 0) {
    toast('选区里没有活细胞');
    return;
  }
  beginEdit('删除选区内容');
  for (const r of state.selection) {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        if (world.get(x, y)) world.set(x, y, 0);
      }
    }
  }
  commitEdit();
  toast(`已删除 ${bmp.population} 个细胞`);
}

function openSavePreset(): void {
  if (state.selection.length === 0) {
    toast('先用选择框工具（K）框一块区域');
    return;
  }
  const bmp = selectionBitmap(state.selection);
  if (!bmp.population) {
    toast('这块区域里没有活细胞');
    return;
  }
  openModal('存为图案', (body) => {
    const wrap = document.createElement('div');
    wrap.className = 'preset-form';

    const pv = document.createElement('canvas');
    pv.className = 'preset-preview';
    const k = Math.max(1, Math.min(14, Math.floor(240 / Math.max(bmp.w, bmp.h))));
    pv.width = Math.max(1, bmp.w * k);
    pv.height = Math.max(1, bmp.h * k);
    const pctx = pv.getContext('2d')!;
    pctx.fillStyle = '#0a1017';
    pctx.fillRect(0, 0, pv.width, pv.height);
    pctx.fillStyle = '#6cf5d2';
    for (let y = 0; y < bmp.h; y++) {
      for (let x = 0; x < bmp.w; x++) {
        if (bmp.cells[y * bmp.w + x]) pctx.fillRect(x * k, y * k, k, k);
      }
    }

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'text-input';
    nameInput.value = `自定义 ${bmp.w}×${bmp.h}`;
    nameInput.maxLength = 24;

    const catSel = document.createElement('select');
    catSel.className = 'select-input';
    // 新存的图案默认进「自定义」分组；没有这个分组就自动建一个（值 '' 代表待新建）
    const CUSTOM_CAT = '自定义';
    const NEW_CAT = '';
    const customCat = library.categories.find((c) => c.name === CUSTOM_CAT);
    for (const cat of library.categories) {
      const o = document.createElement('option');
      o.value = cat.id;
      o.textContent = cat.name;
      catSel.append(o);
    }
    if (customCat) {
      catSel.value = customCat.id;
    } else {
      const o = document.createElement('option');
      o.value = NEW_CAT;
      o.textContent = `${CUSTOM_CAT}（自动新建分组）`;
      catSel.append(o);
      catSel.value = NEW_CAT;
    }

    const row = document.createElement('div');
    row.className = 'preset-row';
    const label1 = document.createElement('label');
    label1.textContent = '名称';
    label1.append(nameInput);
    const label2 = document.createElement('label');
    label2.textContent = '分类';
    label2.append(catSel);
    row.append(label1, label2);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = mkButton('取消', '', () => closeModal());
    const ok = mkButton('保存到图案库', 'primary', () => {
      let catId = catSel.value;
      if (!catId) {
        // 还没有自定义分组：现在建一个，让所有自己框出来的图案都归到这里
        catId = library.addCategory(CUSTOM_CAT).id;
        saveLibraryConfig();
      }
      const rec: CustomPatternRecord = {
        id: 'c-' + uid(),
        name: nameInput.value.trim() || `自定义 ${bmp.w}×${bmp.h}`,
        catId,
        width: bmp.w,
        height: bmp.h,
        cells: encodeCells(bmp.cells),
        created: Date.now(),
      };
      void store.saveCustomPattern(rec);
      library.addCustom(rec);
      clearSelection(false);
      refreshPalette();
      selectPattern(rec.id);
      // 新存的图案如果落在滚动区外，滚过去让它露出来
      requestAnimationFrame(() => {
        el('palette-list')
          .querySelector<HTMLElement>(`[data-id="${rec.id}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      });
      closeModal();
      const where = library.categoryName(catId);
      toast(`已存进「${where}」：${rec.name}，点击画布即可摆放`);
    });
    actions.append(cancel, ok);

    const meta = document.createElement('p');
    meta.className = 'modal-note';
    meta.textContent = `图案 ${bmp.w}×${bmp.h}，${bmp.population} 个活细胞${bmp.trimmed ? '（已裁掉四周空白）' : ''}。存下来之后就能像内置图案一样摆放、旋转、镜像。`;

    wrap.append(pv, row, meta, actions);
    body.append(wrap);
    nameInput.focus();
    nameInput.select();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 图案库管理：分类改名 / 增删 / 排序，图案归属与隐藏
// ──────────────────────────────────────────────────────────────────────────
function mkButton(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'btn' + (cls ? ' ' + cls : '');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function saveLibraryConfig(): void {
  void store.setLibraryConfig(library.config);
}

function openLibraryManager(): void {
  openModal('图案库管理', (body) => {
    let query = '';

    const refresh = (): void => {
      body.innerHTML = '';
      body.append(catSection(), patSection(), hiddenSection());
    };

    const afterChange = (): void => {
      saveLibraryConfig();
      buildPalette();
      refresh();
    };

    function catSection(): HTMLElement {
      const sec = document.createElement('section');
      sec.className = 'lib-sec';
      const h = document.createElement('h4');
      h.textContent = '分类（名字可以直接改，顺序按上下移）';
      sec.append(h);

      for (const cat of library.categories) {
        const row = document.createElement('div');
        row.className = 'lib-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'text-input grow';
        input.value = cat.name;
        input.maxLength = 16;
        input.addEventListener('change', () => {
          library.renameCategory(cat.id, input.value);
          afterChange();
        });
        const count = document.createElement('span');
        count.className = 'lib-count';
        count.textContent = `${library.patternsIn(cat.id).length} 个`;
        row.append(
          input,
          count,
          mkButton('↑', 'tiny', () => {
            library.moveCategory(cat.id, -1);
            afterChange();
          }),
          mkButton('↓', 'tiny', () => {
            library.moveCategory(cat.id, 1);
            afterChange();
          }),
          mkButton('✕', 'tiny danger', () => {
            if (library.categories.length <= 1) {
              toast('至少保留一个分类');
              return;
            }
            library.removeCategory(cat.id);
            afterChange();
          }),
        );
        sec.append(row);
      }

      const addRow = document.createElement('div');
      addRow.className = 'lib-row';
      addRow.append(
        mkButton('+ 新建分类', '', () => {
          const cat = library.addCategory('新分类');
          saveLibraryConfig();
          refresh();
          // 新建后直接聚焦到名字输入框，省一次点击
          const inputs = body.querySelectorAll<HTMLInputElement>('.lib-sec .text-input');
          const target = inputs[library.categories.length - 1];
          if (target && target.value === cat.name) {
            target.focus();
            target.select();
          }
        }),
      );
      sec.append(addRow);
      return sec;
    }

    function patSection(): HTMLElement {
      const sec = document.createElement('section');
      sec.className = 'lib-sec';
      const h = document.createElement('h4');
      h.textContent = '图案归属（换分类、或从库里隐藏）';
      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'text-input';
      search.placeholder = '搜索图案…';
      search.value = query;
      search.addEventListener('input', () => {
        query = search.value;
        const box = sec.querySelector('.lib-list');
        if (box) fillList(box as HTMLElement);
      });

      const list = document.createElement('div');
      list.className = 'lib-list';
      sec.append(h, search, list);
      fillList(list);
      return sec;
    }

    function fillList(list: HTMLElement): void {
      list.innerHTML = '';
      const q = query.trim().toLowerCase();
      const rows = library.visible.filter(
        (p) => !q || p.name.toLowerCase().includes(q) || p.en.toLowerCase().includes(q),
      );
      if (!rows.length) {
        const p = document.createElement('p');
        p.className = 'modal-note';
        p.textContent = q ? '没有匹配的图案。' : '库里还没有图案。';
        list.append(p);
        return;
      }
      for (const pat of rows) list.append(patternRow(pat));
    }

    function patternRow(pat: LibPattern): HTMLElement {
      const row = document.createElement('div');
      row.className = 'lib-row';
      const c = document.createElement('canvas');
      c.width = 40;
      c.height = 28;
      c.className = 'lib-icon';
      drawPatternIcon(c, pat);
      const name = document.createElement('span');
      name.className = 'lib-name grow';
      name.textContent = pat.name;
      const sel = document.createElement('select');
      sel.className = 'select-input';
      for (const cat of library.categories) {
        const o = document.createElement('option');
        o.value = cat.id;
        o.textContent = cat.name;
        sel.append(o);
      }
      sel.value = pat.catId;
      sel.addEventListener('change', () => {
        library.assign(pat.id, sel.value);
        afterChange();
      });
      row.append(
        c,
        name,
        sel,
        mkButton('隐藏', 'tiny', () => {
          library.assign(pat.id, null);
          afterChange();
        }),
      );
      if (pat.custom) {
        row.append(
          mkButton('删除', 'tiny danger', () => {
            const rec = library.customs.get(pat.id);
            if (!rec) return;
            void askConfirm('删除图案', `删除自定义图案「${rec.name}」？删掉之后就找不回来了。`, '删除').then(
              (ok) => {
                if (!ok) return;
                library.removeCustom(pat.id);
                void store.deleteCustomPattern(pat.id);
                afterChange();
              },
            );
          }),
        );
      }
      return row;
    }

    function hiddenSection(): HTMLElement {
      const sec = document.createElement('section');
      sec.className = 'lib-sec';
      const hidden = library.hidden;
      if (!hidden.length) return sec;
      const h = document.createElement('h4');
      h.textContent = `已隐藏（${hidden.length}）`;
      sec.append(h);
      for (const pat of hidden) {
        const row = document.createElement('div');
        row.className = 'lib-row';
        const name = document.createElement('span');
        name.className = 'lib-name grow';
        name.textContent = pat.name;
        row.append(
          name,
          mkButton('恢复', 'tiny', () => {
            library.assign(pat.id, null);
            library.assign(pat.id, library.categories[0].id);
            afterChange();
          }),
        );
        sec.append(row);
      }
      return sec;
    }

    refresh();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 侧栏编辑模式：拖拽排序分类与图案、把图案收进仓库/从仓库取回
// ──────────────────────────────────────────────────────────────────────────
type DragPayload = { kind: 'pat' | 'cat'; id: string } | null;

const expandedCats = new Set<string>();
let dragPayload: DragPayload = null;
let dropSlot: HTMLElement | null = null;
// 被拖动的那一项要等拖拽真正开始（第一次 dragover）后才从列表里抽走：
// 在 dragstart 里就设 display:none 会让浏览器当场取消整次拖拽。
let dragSourceEl: HTMLElement | null = null;

function afterEdit(): void {
  saveLibraryConfig();
  buildPalette();
  buildEditPanel();
  uiDirty = true;
}

// 两种模式都能拖动左边缘改宽度，宽度分别记在本地
const PALETTE_W_KEY = 'life-studio:palette-width'; // 编辑模式
const PALETTE_W_KEY_BROWSE = 'life-studio:palette-width-browse';
const PALETTE_W_DEFAULT = { browse: 236, edit: 336 };
let paletteWidth: Record<'browse' | 'edit', number> = {
  browse: PALETTE_W_DEFAULT.browse,
  edit: PALETTE_W_DEFAULT.edit,
};

function currentWidthKey(): string {
  return state.paletteMode === 'edit' ? PALETTE_W_KEY : PALETTE_W_KEY_BROWSE;
}

function applyPaletteWidth(): void {
  const pal = el<HTMLElement>('palette');
  // 收起时用 CSS 的 40×40 小图标；手机上让 CSS 的固定宽度说了算
  if (pal.classList.contains('collapsed') || window.innerWidth <= 700) {
    pal.style.width = '';
    return;
  }
  pal.style.width = `${Math.round(paletteWidth[state.paletteMode])}px`;
}

function bindPaletteResizer(): void {
  try {
    const edit = Number(localStorage.getItem(PALETTE_W_KEY));
    if (Number.isFinite(edit) && edit >= 200) paletteWidth.edit = edit;
    const browse = Number(localStorage.getItem(PALETTE_W_KEY_BROWSE));
    if (Number.isFinite(browse) && browse >= 200) paletteWidth.browse = browse;
  } catch {
    /* 本地存储不可用就用默认宽度 */
  }
  const handle = el('palette-resize');
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const mode = state.paletteMode;
    const startX = e.clientX;
    const startW = el('palette').offsetWidth;
    const maxW = Math.max(300, Math.min(760, window.innerWidth - 120));
    const minW = mode === 'edit' ? 260 : 180;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件没有真实指针，忽略 */
    }
    const move = (ev: PointerEvent): void => {
      paletteWidth[mode] = Math.max(minW, Math.min(maxW, startW + (startX - ev.clientX)));
      applyPaletteWidth();
      uiDirty = true;
    };
    const up = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      try {
        handle.releasePointerCapture(e.pointerId);
        localStorage.setItem(currentWidthKey(), String(Math.round(paletteWidth[mode])));
      } catch {
        /* 忽略 */
      }
      uiDirty = true;
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

function setPaletteCollapsed(collapsed: boolean): void {
  el('palette').classList.toggle('collapsed', collapsed);
  const btn = el('btn-palette-collapse');
  btn.textContent = collapsed ? '▦' : '›';
  btn.title = collapsed ? '展开图案库' : '收起';
  applyPaletteWidth();
  uiDirty = true;
}

function setPaletteMode(mode: 'browse' | 'edit'): void {
  state.paletteMode = mode;
  const pal = el('palette');
  if (mode === 'edit') pal.classList.remove('collapsed');
  pal.classList.toggle('edit', mode === 'edit');
  el('btn-lib-manage').textContent = mode === 'edit' ? '✓' : '⚙';
  el('btn-lib-manage').title = mode === 'edit' ? '完成编辑' : '编辑图案库';
  const h3 = pal.querySelector('header h3');
  if (h3) h3.textContent = mode === 'edit' ? '编辑图案库' : '图案库';
  applyPaletteWidth();
  if (mode === 'edit') {
    // 默认展开所有分类，一进来就能看到全部图案
    for (const c of library.categories) expandedCats.add(c.id);
    buildEditPanel();
  } else {
    el('palette-list').classList.remove('edit-list');
    buildPalette();
  }
  uiDirty = true;
}

function clearDropMarks(): void {
  for (const n of document.querySelectorAll('.drop-target, .drop-into')) {
    n.classList.remove('drop-target', 'drop-into');
  }
}

/**
 * 拖动时用一个占位槽标出落点：槽插进去以后，其它方块会被挤开，
 * 松手后图案/分类会落到哪里一眼就能看出来。
 */
function dragSlot(): HTMLElement {
  if (!dropSlot) {
    const s = document.createElement('div');
    s.className = 'drop-slot';
    dropSlot = s;
  }
  return dropSlot;
}

/** 把占位槽放到 container 里、before 之前（before 为 null 就放末尾）。 */
function putSlot(container: HTMLElement, before: Element | null): void {
  const slot = dragSlot();
  if (slot.parentElement === container && slot.nextElementSibling === before) return;
  container.insertBefore(slot, before);
}

function endDrag(): void {
  dropSlot?.remove();
  dropSlot = null;
  dragPayload = null;
  dragSourceEl = null;
  for (const n of document.querySelectorAll('.dragging, .drop-into, .drop-target')) {
    n.classList.remove('dragging', 'drop-into', 'drop-target');
  }
}

/** 分类块里没有网格（空分类 / 空仓库）时就临时造一个，好放占位槽。 */
function gridOf(block: HTMLElement, catId: string): HTMLElement {
  const found = block.querySelector<HTMLElement>('.edit-grid');
  if (found) return found;
  const g = document.createElement('div');
  g.className = 'edit-grid';
  g.dataset.catId = catId;
  block.append(g);
  return g;
}

function onPaletteDragOver(e: DragEvent): void {
  const p = dragPayload;
  const list = el('palette-list');
  const t = e.target as HTMLElement | null;
  if (!p || !t || !list.contains(t)) return;
  // 拖拽已经真的开始了，这时才把源项从列表里抽走
  if (dragSourceEl && !dragSourceEl.classList.contains('dragging')) {
    dragSourceEl.classList.add('dragging');
  }
  clearDropMarks();

  if (p.kind === 'cat') {
    const block = t.closest<HTMLElement>('.edit-cat');
    if (!block) return;
    e.preventDefault();
    const r = block.getBoundingClientRect();
    putSlot(list, e.clientY > r.top + r.height / 2 ? block.nextElementSibling : block);
    block.classList.add('drop-into');
    return;
  }

  // 拖的是图案
  const stash = t.closest<HTMLElement>('.stash-sec');
  if (stash) {
    e.preventDefault();
    const g = gridOf(stash, '');
    g.dataset.stash = '1';
    putSlot(g, null);
    stash.classList.add('drop-into');
    return;
  }
  const tile = t.closest<HTMLElement>('.edit-tile');
  const grid = tile?.parentElement;
  if (tile && grid && grid.classList.contains('edit-grid')) {
    e.preventDefault();
    const r = tile.getBoundingClientRect();
    putSlot(grid as HTMLElement, e.clientX > r.left + r.width / 2 ? tile.nextElementSibling : tile);
    return;
  }
  const head = t.closest<HTMLElement>('.edit-cat-head');
  if (head) {
    e.preventDefault();
    const block = head.parentElement as HTMLElement;
    putSlot(gridOf(block, block.dataset.catId ?? ''), null);
    block.classList.add('drop-into');
    return;
  }

  // 落在空隙、空白或「新建分类」上：松手就放到最后
  e.preventDefault();
  if (p.kind === 'pat') {
    const grids = [
      ...list.querySelectorAll<HTMLElement>('.edit-cat .edit-grid'),
    ];
    const last = grids[grids.length - 1];
    if (!last) return;
    putSlot(last, null);
    (last.closest('.edit-cat') as HTMLElement | null)?.classList.add('drop-into');
  } else {
    const blocks = [...list.querySelectorAll<HTMLElement>('.edit-cat')];
    const last = blocks[blocks.length - 1];
    putSlot(list, last ? last.nextElementSibling : null);
    last?.classList.add('drop-into');
  }
}

function onPaletteDrop(e: DragEvent): void {
  const p = dragPayload;
  if (!p) return;
  e.preventDefault();
  const slot = dropSlot;
  if (!slot) return;
  const parent = slot.parentElement as HTMLElement | null;
  // 先把落点信息取下来：endDrag 会把占位槽从 DOM 里删掉，之后就读不到兄弟节点了
  const before = (slot.nextElementSibling as HTMLElement | null) ?? null;
  endDrag();
  if (!parent) return;
  if (parent.classList.contains('edit-grid')) {
    if (p.kind !== 'pat') return;
    if (parent.dataset.stash) library.stash(p.id);
    else library.movePattern(p.id, parent.dataset.catId ?? '', before?.dataset.patId ?? null);
  } else if (p.kind === 'cat') {
    library.moveCategoryBefore(p.id, before?.dataset.catId ?? null);
  } else {
    return;
  }
  afterEdit();
}

/** 编辑模式里的一个图案方块；catId 为 null 表示它在仓库里。 */
function patternTile(pat: LibPattern, catId: string | null): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'edit-tile';
  tile.draggable = true;
  tile.dataset.patId = pat.id;
  tile.title =
    catId === null
      ? `${pat.name} · 双击或点「取出」放回图案库`
      : `${pat.name}${pat.custom ? '（自定义）' : ''} · 拖到别的分类或仓库`;
  tile.addEventListener('dragstart', (e) => {
    dragPayload = { kind: 'pat', id: pat.id };
    dragSourceEl = tile;
    e.dataTransfer?.setData('text/plain', pat.id);
  });
  tile.addEventListener('dragend', endDrag);

  const c = document.createElement('canvas');
  c.width = 52;
  c.height = 34;
  drawPatternIcon(c, pat);
  const nm = document.createElement('span');
  nm.className = 'tile-name';
  nm.textContent = pat.name;
  tile.append(c, nm);

  if (catId === null) {
    const take = document.createElement('button');
    take.type = 'button';
    take.className = 'tile-stash';
    take.textContent = '↑';
    take.title = '取出，放回图案库';
    take.addEventListener('click', (e) => {
      e.stopPropagation();
      library.unstash(pat.id);
      afterEdit();
    });
    tile.append(take);
    tile.addEventListener('dblclick', () => {
      library.unstash(pat.id);
      afterEdit();
    });
    return tile;
  }

  const stash = document.createElement('button');
  stash.type = 'button';
  stash.className = 'tile-stash';
  stash.textContent = '↓';
  stash.title = '收进仓库';
  stash.addEventListener('click', (e) => {
    e.stopPropagation();
    library.stash(pat.id);
    afterEdit();
  });
  tile.append(stash);

  if (pat.custom) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tile-del';
    del.textContent = '✕';
    del.title = '删除这个自定义图案';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      const rec = library.customs.get(pat.id);
      if (!rec) return;
      void askConfirm('删除图案', `删除自定义图案「${rec.name}」？删掉之后就找不回来了。`, '删除').then(
        (ok) => {
          if (!ok) return;
          library.removeCustom(pat.id);
          void store.deleteCustomPattern(pat.id);
          afterEdit();
        },
      );
    });
    tile.append(del);
  }

  return tile;
}

function buildEditPanel(): void {
  const list = el('palette-list');
  list.innerHTML = '';
  list.classList.add('edit-list');

  // 顶部工具条：一键展开/收起所有分类
  const tools = document.createElement('div');
  tools.className = 'edit-tools';
  const allOpen = library.categories.every((c) => expandedCats.has(c.id));
  const toggleAll = mkButton(allOpen ? '⇱ 全部收起' : '⇲ 全部展开', 'btn tiny', () => {
    const open = library.categories.every((c) => expandedCats.has(c.id));
    if (open) expandedCats.clear();
    else for (const c of library.categories) expandedCats.add(c.id);
    buildEditPanel();
  });
  toggleAll.title = '展开或收起所有分类';
  tools.append(toggleAll);
  list.append(tools);

  for (const cat of library.categories) {
    const wrap = document.createElement('div');
    wrap.className = 'edit-cat';
    wrap.dataset.catId = cat.id;

    const head = document.createElement('div');
    head.className = 'edit-cat-head';
    head.draggable = true;
    head.addEventListener('dragstart', (e) => {
      dragPayload = { kind: 'cat', id: cat.id };
      dragSourceEl = wrap;
      e.dataTransfer?.setData('text/plain', cat.id);
    });
    head.addEventListener('dragend', endDrag);

    const toggle = mkButton(expandedCats.has(cat.id) ? '▾' : '▸', 'tiny', () => {
      if (expandedCats.has(cat.id)) expandedCats.delete(cat.id);
      else expandedCats.add(cat.id);
      buildEditPanel();
    });
    toggle.title = expandedCats.has(cat.id) ? '收起这个分类' : '展开这个分类';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'text-input grow';
    name.value = cat.name;
    name.maxLength = 16;
    name.addEventListener('change', () => {
      library.renameCategory(cat.id, name.value);
      afterEdit();
    });
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.textContent = '⠿';
    grip.title = '按住拖动可以调整分类顺序';
    const count = document.createElement('span');
    count.className = 'lib-count';
    count.textContent = `${library.patternsIn(cat.id).length}`;
    const del = mkButton('✕', 'tiny danger', () => {
      if (library.categories.length <= 1) {
        toast('至少保留一个分类');
        return;
      }
      const n = library.patternsIn(cat.id).length;
      const msg = n
        ? `删除分类「${cat.name}」？\n里面的 ${n} 个图案会移到第一个分类，不会丢失。`
        : `删除分类「${cat.name}」？`;
      void askConfirm('删除分类', msg, '删除').then((ok) => {
        if (!ok) return;
        library.removeCategory(cat.id);
        afterEdit();
        toast(`已删除分类「${cat.name}」`);
      });
    });
    del.title = '删除这个分类';
    head.append(toggle, name, grip, count, del);
    wrap.append(head);

    if (expandedCats.has(cat.id)) {
      const items = library.patternsIn(cat.id);
      if (!items.length) {
        const p = document.createElement('div');
        p.className = 'stash-empty';
        p.style.padding = '2px 8px 8px';
        p.textContent = '这个分类还是空的，可以把图案拖进来。';
        wrap.append(p);
      } else {
        const grid = document.createElement('div');
        grid.className = 'edit-grid';
        grid.dataset.catId = cat.id;
        for (const pat of items) grid.append(patternTile(pat, cat.id));
        wrap.append(grid);
      }
    }
    list.append(wrap);
  }

  list.append(
    mkButton('+ 新建分类', 'tiny add-cat', () => {
      const cat = library.addCategory('新分类');
      expandedCats.add(cat.id);
      afterEdit();
    }),
  );

  const stashSec = document.createElement('div');
  stashSec.className = 'stash-sec';
  const sh = document.createElement('div');
  sh.className = 'cat-title';
  const hidden = library.hidden;
  sh.textContent = `仓库（${hidden.length}）`;
  stashSec.append(sh);
  if (!hidden.length) {
    const p = document.createElement('div');
    p.className = 'stash-empty';
    p.textContent = '把图案拖到这里（或点方块右上角的 ↓）就先存起来，不占图案库的位置，随时能取回去。';
    stashSec.append(p);
  } else {
    const grid = document.createElement('div');
    grid.className = 'edit-grid';
    grid.dataset.stash = '1';
    for (const pat of hidden) grid.append(patternTile(pat, null));
    stashSec.append(grid);
  }
  list.append(stashSec);
}

// ──────────────────────────────────────────────────────────────────────────
// 模态框
// ──────────────────────────────────────────────────────────────────────────
let modalCleanup: (() => void) | null = null;

function openModal(title: string, build: (body: HTMLElement) => void): void {
  const body = el('modal-body');
  el('modal-title').textContent = title;
  body.innerHTML = '';
  build(body);
  el('modal').classList.remove('hidden');
  state.modalOpen = true;
}

function closeModal(): void {
  el('modal').classList.add('hidden');
  state.modalOpen = false;
  if (modalCleanup) {
    modalCleanup();
    modalCleanup = null;
  }
  el('modal-body').innerHTML = '';
}

el('modal-close').addEventListener('click', closeModal);
document.querySelector('.modal-mask')!.addEventListener('click', closeModal);

// ──────────────────────────────────────────────────────────────────────────
// 确认框（游戏风格，不用浏览器自带的 confirm）
// ──────────────────────────────────────────────────────────────────────────
let confirmResolve: ((ok: boolean) => void) | null = null;

function askConfirm(title: string, message: string, okLabel = '确定'): Promise<boolean> {
  return new Promise((resolve) => {
    // 上一个没关掉就先当取消处理，避免 resolve 丢失
    confirmResolve?.(false);
    confirmResolve = resolve;
    el('confirm-title').textContent = title;
    el('confirm-msg').textContent = message;
    el('confirm-ok').textContent = okLabel;
    el('confirm').classList.remove('hidden');
    el('confirm-cancel').focus();
  });
}

function closeConfirm(ok: boolean): void {
  if (el('confirm').classList.contains('hidden')) return;
  el('confirm').classList.add('hidden');
  const r = confirmResolve;
  confirmResolve = null;
  r?.(ok);
}

function confirmOpen(): boolean {
  return !el('confirm').classList.contains('hidden');
}

el('confirm-ok').addEventListener('click', () => closeConfirm(true));
el('confirm-cancel').addEventListener('click', () => closeConfirm(false));
el('confirm').addEventListener('click', (e) => {
  if (e.target === el('confirm')) closeConfirm(false);
});

// ──────────────────────────────────────────────────────────────────────────
// 存档
// ──────────────────────────────────────────────────────────────────────────
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function makeSnapshot(name: string): SnapshotRecord {
  return {
    id: uid(),
    name: name || `第 ${world.gen} 代`,
    created: Date.now(),
    gen: world.gen,
    population: world.population,
    edge: world.edge,
    width: world.width,
    height: world.height,
    packed: world.toPacked(),
    view: view.getView(),
    thumb: makeThumb(world, 192),
  };
}

async function openSnapshots(): Promise<void> {
  openModal('存档', (body) => {
    const head = document.createElement('div');
    head.className = 'row';
    head.style.marginBottom = '12px';
    head.innerHTML = `
      <input class="input grow" id="snap-name" placeholder="给这个瞬间起个名字…" maxlength="40" />
      <button class="btn primary" id="snap-save">保存当前</button>`;
    body.append(head);

    const grid = document.createElement('div');
    grid.className = 'card-grid';
    body.append(grid);

    const refresh = async (): Promise<void> => {
      const list = await store.listSnapshots();
      list.sort((a, b) => b.created - a.created);
      grid.innerHTML = '';
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '还没有存档。画出有趣的一幕，然后点「保存当前」。';
        grid.style.gridTemplateColumns = '1fr';
        grid.append(empty);
        return;
      }
      grid.style.gridTemplateColumns = '';
      for (const rec of list) {
        grid.append(snapshotCard(rec, refresh));
      }
    };

    head.querySelector('#snap-save')!.addEventListener('click', async () => {
      const input = body.querySelector<HTMLInputElement>('#snap-name')!;
      const rec = makeSnapshot(input.value.trim());
      await store.saveSnapshot(rec);
      input.value = '';
      toast('已保存到存档库');
      await refresh();
    });

    void refresh();
  });
}

function snapshotCard(rec: SnapshotRecord, refresh: () => Promise<void>): HTMLElement {
  const card = document.createElement('div');
  card.className = 'snap-card';
  card.innerHTML = `
    <img alt="" src="${rec.thumb}">
    <div class="snap-meta"><b></b><span class="m1"></span><span class="m2"></span></div>
    <div class="snap-actions">
      <button data-act="load">载入</button>
      <button data-act="del">删除</button>
    </div>`;
  card.querySelector('b')!.textContent = rec.name;
  card.querySelector('.m1')!.textContent =
    `第 ${nf.format(rec.gen)} 代 · 人口 ${nf.format(rec.population)}`;
  card.querySelector('.m2')!.textContent = `${rec.width}² · ${fmtTime(rec.created)}`;
  card.querySelector('[data-act="load"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    loadSnapshot(rec);
    closeModal();
  });
  card.querySelector('[data-act="del"]')!.addEventListener('click', async (e) => {
    e.stopPropagation();
    await store.deleteSnapshot(rec.id);
    await refresh();
  });
  card.addEventListener('click', () => {
    loadSnapshot(rec);
    closeModal();
  });
  return card;
}

function loadSnapshot(rec: SnapshotRecord): void {
  if (state.playing) setPlaying(false);
  const sameSize = world.width === rec.width && world.height === rec.height;
  if (!sameSize) {
    world = new World(rec.width, rec.height);
    world.edge = rec.edge;
    world.loadPacked(rec.packed, rec.population, rec.gen);
    history = new History(world);
    renderer.attach(world);
  } else {
    world.edge = rec.edge;
    world.loadPacked(rec.packed, rec.population, rec.gen);
    history.reset();
    renderer.paintAll();
  }
  el<HTMLSelectElement>('sel-size').value = String(rec.width);
  el<HTMLSelectElement>('sel-edge').value = rec.edge;
  view.setView(rec.view);
  uiDirty = true;
  flushUi();
  toast(`已载入「${rec.name}」`);
}

// ──────────────────────────────────────────────────────────────────────────
// 片段
// ──────────────────────────────────────────────────────────────────────────
async function toggleRecord(): Promise<void> {
  const btn = el('btn-record');
  if (state.recordStart < 0) {
    state.recordStart = world.gen;
    history.protectedRange = { from: world.gen, to: world.gen };
    btn.classList.add('on');
    btn.textContent = '■ 停止录制';
    if (!state.playing) setPlaying(true);
    updateRecordBadge();
    toast('开始录制，按「停止」后即可回放');
    return;
  }

  const start = state.recordStart;
  state.recordStart = -1;
  history.protectedRange = null;
  btn.classList.remove('on');
  btn.textContent = '● 录制片段';
  updateRecordBadge();

  const clip = history.extractClip(start, world.gen);
  if (!clip) {
    toast('片段太短，未保存');
    return;
  }
  const rec: ClipRecord = {
    id: uid(),
    name: `第 ${nf.format(clip.startGen)}–${nf.format(clip.endGen)} 代`,
    created: Date.now(),
    width: world.width,
    height: world.height,
    startGen: clip.startGen,
    endGen: clip.endGen,
    startPacked: clip.start.packed,
    startPopulation: clip.start.population,
    deltas: clip.deltas,
    thumb: makeThumb(world, 192),
  };
  await store.saveClip(rec);
  toast(`片段已保存（${clip.deltas.length} 代）`);
  void openClips();
}

async function openClips(): Promise<void> {
  openModal('片段库', (body) => {
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    body.append(grid);
    const refresh = async (): Promise<void> => {
      const list = await store.listClips();
      list.sort((a, b) => b.created - a.created);
      grid.innerHTML = '';
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '还没有片段。点底栏「录制片段」开始录，停止后自动出现在这里。';
        grid.style.gridTemplateColumns = '1fr';
        grid.append(empty);
        return;
      }
      grid.style.gridTemplateColumns = '';
      for (const rec of list) grid.append(clipCard(rec, refresh));
    };
    void refresh();
  });
}

function clipCard(rec: ClipRecord, refresh: () => Promise<void>): HTMLElement {
  const card = document.createElement('div');
  card.className = 'snap-card';
  card.innerHTML = `
    <img alt="" src="${rec.thumb}">
    <div class="snap-meta"><b></b><span class="m1"></span><span class="m2"></span></div>
    <div class="snap-actions">
      <button data-act="play">播放</button>
      <button data-act="del">删除</button>
    </div>`;
  card.querySelector('b')!.textContent = rec.name;
  card.querySelector('.m1')!.textContent = `${rec.deltas.length} 代 · 起点人口 ${nf.format(rec.startPopulation)}`;
  card.querySelector('.m2')!.textContent = `${rec.width}² · ${fmtTime(rec.created)}`;
  card.querySelector('[data-act="play"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    openClipPlayer(rec);
  });
  card.querySelector('[data-act="del"]')!.addEventListener('click', async (e) => {
    e.stopPropagation();
    await store.deleteClip(rec.id);
    await refresh();
  });
  return card;
}

function openClipPlayer(rec: ClipRecord): void {
  openModal(`片段 · ${rec.name}`, (body) => {
    body.innerHTML = `
      <div class="clip-stage"><canvas id="clip-canvas"></canvas></div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="clip-play">▶ 播放</button>
        <input id="clip-seek" type="range" class="grow" min="0" max="${rec.deltas.length}" value="0" />
        <span class="small muted" id="clip-label" style="min-width:96px;text-align:right"></span>
      </div>`;

    const cvs = body.querySelector<HTMLCanvasElement>('#clip-canvas')!;
    const seekEl = body.querySelector<HTMLInputElement>('#clip-seek')!;
    const playEl = body.querySelector<HTMLButtonElement>('#clip-play')!;
    const labelEl = body.querySelector('#clip-label')!;

    const w = new World(rec.width, rec.height);
    w.loadPacked(rec.startPacked, rec.startPopulation, rec.startGen);
    const r = new Renderer(cvs);
    r.attach(w);
    const v = new Viewport();
    const box = body.querySelector<HTMLElement>('.clip-stage')!;
    const rect = box.getBoundingClientRect();
    r.resize(rect.width || 640, rect.height || 400);

    // 扫一遍片段，算出整段活动的包围盒，让画面框住真正在动的部分，
    // 而不是把 1024² 的整个世界缩成一小块。
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    const grow = (): void => {
      const bb = w.liveBBox();
      if (bb.x1 > bb.x0 && bb.y1 > bb.y0) {
        bx0 = Math.min(bx0, bb.x0);
        by0 = Math.min(by0, bb.y0);
        bx1 = Math.max(bx1, bb.x1);
        by1 = Math.max(by1, bb.y1);
      }
    };
    grow();
    for (const d of rec.deltas) {
      w.applyDelta(d);
      w.gen++;
      grow();
    }
    for (let i = rec.deltas.length - 1; i >= 0; i--) {
      w.revertDelta(rec.deltas[i]);
      w.gen--;
    }
    if (bx0 < Infinity) {
      const bw = Math.max(8, bx1 - bx0);
      const bh = Math.max(8, by1 - by0);
      const s = v.clampScale(Math.min((r.cssW - 28) / bw, (r.cssH - 28) / bh, 26));
      v.scale = s;
      v.ox = (r.cssW - bw * s) / 2 - bx0 * s;
      v.oy = (r.cssH - bh * s) / 2 - by0 * s;
    } else {
      v.fit(rec.width, rec.height, r.cssW, r.cssH, 16);
    }

    let idx = 0;
    let playing = false;
    let raf = 0;
    let last = 0;
    let acc = 0;

    const paint = (): void => {
      r.sync();
      r.render(v, { grid: false });
      labelEl.textContent = `第 ${nf.format(rec.startGen + idx)} 代`;
    };

    const goTo = (target: number): void => {
      const t = Math.max(0, Math.min(rec.deltas.length, target));
      while (idx < t) {
        w.applyDelta(rec.deltas[idx]);
        w.gen++;
        idx++;
      }
      while (idx > t) {
        idx--;
        w.revertDelta(rec.deltas[idx]);
        w.gen--;
      }
      seekEl.value = String(idx);
      paint();
    };

    const tick = (ts: number): void => {
      if (!playing) return;
      const dt = last ? ts - last : 16;
      last = ts;
      acc += dt;
      if (acc >= 70) {
        acc = 0;
        goTo(idx + 1);
        if (idx >= rec.deltas.length) {
          playing = false;
          playEl.textContent = '▶ 播放';
        }
      }
      raf = requestAnimationFrame(tick);
    };

    playEl.addEventListener('click', () => {
      playing = !playing;
      playEl.textContent = playing ? '❙❙ 暂停' : '▶ 播放';
      if (playing) {
        if (idx >= rec.deltas.length) goTo(0);
        last = 0;
        acc = 0;
        raf = requestAnimationFrame(tick);
      }
    });

    seekEl.addEventListener('input', () => {
      playing = false;
      playEl.textContent = '▶ 播放';
      goTo(Number(seekEl.value));
    });

    paint();
    modalCleanup = () => {
      playing = false;
      cancelAnimationFrame(raf);
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────
// RLE
// ──────────────────────────────────────────────────────────────────────────
function openRle(): void {
  openModal('RLE 导入 / 导出', (body) => {
    body.innerHTML = `
      <p class="small muted" style="margin:0 0 8px">
        粘贴 LifeWiki 上的 RLE 或纯文本图案，导入到当前视图中心；也可以把整个世界导出成 RLE。
      </p>
      <textarea class="rle" id="rle-text" placeholder="x = 3, y = 3, rule = B3/S23&#10;bo$2bo$3o!"></textarea>
      <div class="btn-row">
        <button class="btn primary" id="rle-import">导入到世界</button>
        <button class="btn" id="rle-export">把世界导出到此处</button>
        <button class="btn" id="rle-download">下载 .rle</button>
      </div>`;
    const text = body.querySelector<HTMLTextAreaElement>('#rle-text')!;

    body.querySelector('#rle-import')!.addEventListener('click', () => {
      const parsed = parsePatternText(text.value);
      if (!parsed) {
        toast('解析失败：看看是不是缺少 RLE 头或字符不合法');
        return;
      }
      if (state.playing) setPlaying(false);
      beginEdit('导入 RLE');
      const cx = Math.floor((view.visibleWorld(renderer.cssW, renderer.cssH).x0 + view.visibleWorld(renderer.cssW, renderer.cssH).x1) / 2);
      const cy = Math.floor((view.visibleWorld(renderer.cssW, renderer.cssH).y0 + view.visibleWorld(renderer.cssW, renderer.cssH).y1) / 2);
      world.stamp(parsed.cells, parsed.width, parsed.height, cx - Math.floor(parsed.width / 2), cy - Math.floor(parsed.height / 2));
      commitEdit();
      closeModal();
      toast(`已导入 ${parsed.width}×${parsed.height} 图案`);
    });

    const exportTo = (): string => {
      const bb = world.liveBBox();
      const empty = bb.x1 <= bb.x0 || bb.y1 <= bb.y0;
      const x0 = empty ? 0 : bb.x0;
      const y0 = empty ? 0 : bb.y0;
      const w = empty ? 1 : bb.x1 - bb.x0;
      const h = empty ? 1 : bb.y1 - bb.y0;
      const cells = world.extract(x0, y0, w, h);
      return toRle({ width: w, height: h, cells }, { name: `gen-${world.gen}` });
    };

    body.querySelector('#rle-export')!.addEventListener('click', () => {
      text.value = exportTo();
      toast('已导出到文本框');
    });

    body.querySelector('#rle-download')!.addEventListener('click', () => {
      const blob = new Blob([exportTo()], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `life-gen-${world.gen}.rle`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 分享：导出图片 / 复制链接 / 全屏
// ──────────────────────────────────────────────────────────────────────────
function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** 把世界压成 RLE 再转 base64，做成可以发给别人的链接。 */
function shareLink(): string | null {
  const bb = world.liveBBox();
  const empty = bb.x1 <= bb.x0 || bb.y1 <= bb.y0;
  const x0 = empty ? 0 : bb.x0;
  const y0 = empty ? 0 : bb.y0;
  const w = empty ? 1 : bb.x1 - bb.x0;
  const h = empty ? 1 : bb.y1 - bb.y0;
  const cells = world.extract(x0, y0, w, h);
  const rle = toRle({ width: w, height: h, cells }, { name: `gen-${world.gen}` });
  if (rle.length > 60000) return null;
  const bytes = new TextEncoder().encode(rle);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const payload = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const base = location.href.split('#')[0];
  return `${base}#w=${world.width}&e=${world.edge}&g=${world.gen}&xy=${x0},${y0}&s=${payload}`;
}

/** 打开带 #w=...&s=... 的链接时还原世界。 */
function applyShareFromHash(): boolean {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return false;
  const params = new Map<string, string>();
  for (const part of hash.split('&')) {
    const i = part.indexOf('=');
    if (i > 0) params.set(part.slice(0, i), part.slice(i + 1));
  }
  const payload = params.get('s');
  if (!payload) return false;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const text = new TextDecoder().decode(bytes);
    const parsed = parsePatternText(text);
    if (!parsed) return false;
    const size = Number(params.get('w')) || 1024;
    world = new World(size, size);
    world.edge = params.get('e') === 'dead' ? 'dead' : 'wrap';
    const [px, py] = (params.get('xy') ?? '0,0').split(',').map(Number);
    world.stamp(parsed.cells, parsed.width, parsed.height, px || 0, py || 0);
    world.gen = Number(params.get('g')) || 0;
    el<HTMLSelectElement>('sel-size').value = String(size);
    el<HTMLSelectElement>('sel-edge').value = world.edge;
    shareMode = true;
    return true;
  } catch {
    return false;
  }
}

function openShare(): void {
  openModal('分享这个画面', (body) => {
    body.innerHTML = `
      <p class="small muted" style="margin:0 0 14px">
        把当前画面存成图片，或者生成一个带着这个图案的链接发给别人。
      </p>
      <div class="btn-row">
        <button class="btn primary" id="share-png">存成 PNG 图片</button>
        <button class="btn" id="share-link">复制分享链接</button>
        <button class="btn" id="share-full">全屏</button>
      </div>
      <p class="modal-note" id="share-note"></p>`;

    const note = body.querySelector<HTMLParagraphElement>('#share-note')!;

    body.querySelector('#share-png')!.addEventListener('click', () => {
      canvas.toBlob((blob) => {
        if (!blob) {
          note.textContent = '导出失败，浏览器没给出图片数据。';
          return;
        }
        downloadBlob(blob, `生命游戏-第${world.gen}代.png`);
        note.textContent = `已保存当前视野的 PNG（${canvas.width}×${canvas.height}）。`;
      }, 'image/png');
    });

    body.querySelector('#share-link')!.addEventListener('click', () => {
      const link = shareLink();
      if (!link) {
        note.textContent = '这个世界太满了，链接会超长。可以先用「清空」或缩小面积再试。';
        return;
      }
      const done = (): void => {
        note.textContent = `链接已复制（${link.length} 个字符），粘贴到浏览器就能打开这个画面。`;
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(link).then(done, () => {
          window.prompt('复制这个链接：', link);
        });
      } else {
        window.prompt('复制这个链接：', link);
      }
    });

    body.querySelector('#share-full')!.addEventListener('click', () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void document.documentElement.requestFullscreen?.().catch(() => {
          note.textContent = '这个浏览器不让进全屏（可能是 iframe 限制），按 F11 也一样。';
        });
      }
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 帮助
// ──────────────────────────────────────────────────────────────────────────
function openHelp(): void {
  openModal('操作说明', (body) => {
    body.innerHTML = `
      <dl class="help-list">
        <dt>拖拽</dt><dd>默认是平移：拖哪看哪。左侧工具条可以换成画笔 / 橡皮 / 直线 / 矩形 / 贴图 / 选择框</dd>
        <dt>右键拖拽</dt><dd>任何工具下都能临时平移画布</dd>
        <dt>滚轮 / 双指</dt><dd>以光标为中心缩放（0.03× – 64×）；画笔和橡皮下 <kbd>Ctrl</kbd> + 滚轮改成调笔刷大小</dd>
        <dt><kbd>B</kbd> <kbd>E</kbd> <kbd>I</kbd> <kbd>U</kbd> <kbd>S</kbd> <kbd>K</kbd> <kbd>H</kbd></dt>
        <dd>画笔 / 橡皮 / 直线 / 矩形 / 贴图 / 选择框 / 平移</dd>
        <dt>橡皮大小</dt><dd><kbd>Ctrl</kbd> + 滚轮或 <kbd>[</kbd> <kbd>]</kbd> 调，最大 31×31，一次能擦一大片；涂抹时也会显示范围框</dd>
        <dt>选择框后</dt><dd>把框住的内容存成自定义图案，之后就能反复摆放（默认存进「自定义」分组，没有这个分组会自动建一个）；
          按住框内拖动可以整块搬走（<kbd>Shift</kbd> 拖动才是重新框选，<kbd>Esc</kbd> 放回原处）；
          拖框的边或角可以改大小；<kbd>Alt</kbd> + 拖框内只挪这个框、不动里面的细胞；
          按住 <kbd>Ctrl</kbd> 再拖可以加框，几块一起存成一张复杂图案；<kbd>Del</kbd> 删掉框里的细胞，<kbd>Esc</kbd> 退出选择框</dd>
        <dt>贴图 <kbd>S</kbd></dt><dd>先在图案库点一个图案，光标下才会出现预览；没选图案时点画布会提醒你挑一个。
          点图案库的空白处可以取消选中</dd>
        <dt>图案库 <kbd>⚙</kbd></dt><dd>点 ⚙ 侧栏原地变成编辑模式（再点 ✓ 退出）：图案变成方块网格，拖左边缘可以调宽；
          拖动分类标题可以排序，拖动图案方块时会出现一个闪烁的虚线占位框，它插在哪里、松手后就落在哪里；
          顶部的「全部收起 / 全部展开」可以一键折叠所有分组；
          <kbd>↓</kbd> 把图案收进下面的「仓库」，仓库里的点「↑」（或双击）就放回来；分类名直接改，删分类会先确认</dd>
        <dt>侧栏 <kbd>›</kbd></dt><dd>点右上角的小箭头可以收起图案库，只留一个 <kbd>▦</kbd> 小图标，画布更大；
          展开时拖侧栏左边缘可以调宽（浏览和编辑模式都行，宽度会记住）</dd>
        <dt><kbd>R</kbd> <kbd>M</kbd></dt><dd>旋转 90°、左右镜像（贴图前）</dd>
        <dt><kbd>Ctrl</kbd> + <kbd>Z</kbd></dt><dd>撤销上一步编辑（<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> 重做）；框选、改框大小、挪框也能撤销</dd>
        <dt><kbd>Space</kbd></dt><dd>播放 / 暂停（同 <kbd>P</kbd>）</dd>
        <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>上一代 / 下一代（可以按住连发）</dd>
        <dt><kbd>G</kbd></dt><dd>网格开关</dd>
        <dt><kbd>0</kbd></dt><dd>缩放到整幅世界</dd>
        <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>放大 / 缩小</dd>
        <dt><kbd>Del</kbd></dt><dd>有选区时删掉选区里的细胞，没有选区时清空世界（都能撤销）</dd>
        <dt>分享</dt><dd>存成 PNG 图片、复制一条能还原当前画面的链接，或全屏观看</dd>
        <dt>手机上</dt><dd>单指绘制、双指捏合缩放、双指拖动平移；顶栏向右滑可以看到更多按钮</dd>
      </dl>
      <p class="small muted" style="margin-top:14px">
        回溯原理：程序记录每一代被翻转的格子（增量），并按固定间隔保存关键帧，
        所以拖动底栏进度条可以瞬时回到过去的任意一代。历史默认保留最近 3000 代。
      </p>`;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 自动存档
// ──────────────────────────────────────────────────────────────────────────
async function autoSaveNow(): Promise<void> {
  if (shareMode) return;
  try {
    await store.setAutoSave({
      width: world.width,
      height: world.height,
      gen: world.gen,
      population: world.population,
      edge: world.edge,
      packed: world.toPacked(),
      view: view.getView(),
      savedAt: Date.now(),
    });
  } catch {
    /* 存档失败不打断使用 */
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 事件绑定
// ──────────────────────────────────────────────────────────────────────────
function bindUi(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#toolbar .tool')) {
    btn.addEventListener('click', () => setTool(btn.dataset.tool as ToolName));
  }

  el('btn-play').addEventListener('click', () => setPlaying(!state.playing));
  el('btn-next').addEventListener('click', () => stepOnce(1));
  el('btn-prev').addEventListener('click', () => stepOnce(-1));
  el('btn-clear').addEventListener('click', clearWorld);
  el('btn-random').addEventListener('click', randomWorld);
  el('btn-undo').addEventListener('click', undoEdit);
  el('btn-redo').addEventListener('click', redoEdit);

  const speedEl = el<HTMLInputElement>('speed');
  speedEl.value = String(Math.round(speedToSlider(state.speed)));
  speedEl.addEventListener('input', () => {
    state.speed = sliderToSpeed(Number(speedEl.value));
    state.unlimited = false;
    el('btn-unlimited').classList.remove('on');
    uiDirty = true;
  });

  el('btn-unlimited').addEventListener('click', () => {
    state.unlimited = !state.unlimited;
    el('btn-unlimited').classList.toggle('on', state.unlimited);
    uiDirty = true;
  });

  const tl = el<HTMLInputElement>('timeline');
  tl.addEventListener('input', () => {
    if (state.playing) setPlaying(false);
    history.seek(Number(tl.value));
    renderer.sync();
    flushUi();
  });

  el('btn-record').addEventListener('click', () => void toggleRecord());
  el('btn-share').addEventListener('click', openShare);
  el('btn-snapshots').addEventListener('click', () => void openSnapshots());
  el('btn-clips').addEventListener('click', () => void openClips());
  el('btn-rle').addEventListener('click', openRle);
  el('btn-help').addEventListener('click', openHelp);

  el('tgl-grid').addEventListener('click', toggleGrid);
  el('btn-rotate').addEventListener('click', rotatePattern);
  el('btn-mirror').addEventListener('click', mirrorPattern);
  el('btn-lib-manage').addEventListener('click', () => {
    // 窄屏侧栏放不下编辑界面，仍然用弹窗
    if (window.innerWidth < 900) {
      openLibraryManager();
      return;
    }
    setPaletteMode(state.paletteMode === 'edit' ? 'browse' : 'edit');
  });
  bindPaletteResizer();
  applyPaletteWidth();
  window.addEventListener('resize', () => applyPaletteWidth());
  // 点图案库的空白处就取消选中，光标下不再挂着幽灵图案
  el('palette-list').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (state.paletteMode === 'edit') return;
    if (t.closest('.pat')) return;
    if (state.patternId) deselectPattern();
  });
  // 编辑模式里的拖拽排序：dragover 负责摆占位槽，drop 负责落位
  // 注意：dragover 必须无条件 preventDefault，否则浏览器认为这里不接受放置，
  // 松手就不会产生 drop 事件（拖到空隙上时尤其明显）。
  const plist = el('palette-list');
  plist.addEventListener('dragenter', (e) => {
    if (!dragPayload) return;
    e.preventDefault();
  });
  plist.addEventListener('dragover', (e) => {
    if (!dragPayload) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    onPaletteDragOver(e);
  });
  plist.addEventListener('drop', onPaletteDrop);
  plist.addEventListener('dragleave', (e) => {
    if (!plist.contains(e.relatedTarget as Node | null)) {
      clearDropMarks();
      dropSlot?.remove();
      dropSlot = null;
    }
  });
  el('btn-save-preset').addEventListener('click', openSavePreset);
  el('btn-sel-cancel').addEventListener('click', () => {
    clearSelection();
    setTool(state.lastTool);
  });
  el('btn-del-selection').addEventListener('click', deleteSelection);
  el('btn-palette-collapse').addEventListener('click', () => {
    if (state.paletteMode === 'edit') setPaletteMode('browse');
    setPaletteCollapsed(!el('palette').classList.contains('collapsed'));
  });

  el<HTMLSelectElement>('sel-size').addEventListener('change', (e) => {
    const size = Number((e.target as HTMLSelectElement).value);
    if (size === world.width) return;
    if (state.playing) setPlaying(false);
    rebuildWorld(size, size, world.edge, true);
    toast(`世界已重建为 ${size}×${size}`);
    flushUi();
  });

  el<HTMLSelectElement>('sel-edge').addEventListener('change', (e) => {
    const mode = (e.target as HTMLSelectElement).value as 'wrap' | 'dead';
    world.edge = mode;
    world.recompute();
    history.reset();
    renderer.paintAll();
    uiDirty = true;
    toast(mode === 'wrap' ? '边界：环绕（左右上下相连）' : '边界：死亡（越界即消失）');
  });

  window.addEventListener('resize', () => {
    const r = stageEl.getBoundingClientRect();
    renderer.resize(r.width, r.height);
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 启动
// ──────────────────────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  store = new Store();
  try {
    await store.init();
  } catch {
    /* 退化为内存存储 */
  }

  renderer = new Renderer(canvas);

  let customs: CustomPatternRecord[] = [];
  let libConfig = null;
  try {
    customs = await store.listCustomPatterns();
    libConfig = await store.getLibraryConfig();
  } catch {
    /* 读不到就用默认图案库 */
  }
  library = new Library(customs, libConfig);

  let auto = null;
  try {
    auto = await store.getAutoSave();
  } catch {
    auto = null;
  }

  const fromLink = applyShareFromHash();
  if (fromLink) {
    /* 世界已经由链接里的图案建好 */
  } else if (auto && auto.width > 0) {
    world = new World(auto.width, auto.height);
    world.edge = auto.edge;
    world.loadPacked(auto.packed, auto.population, auto.gen);
    el<HTMLSelectElement>('sel-size').value = String(auto.width);
    el<HTMLSelectElement>('sel-edge').value = auto.edge;
  } else {
    world = new World(1024, 1024);
    seedShowcase(world);
  }

  history = new History(world);
  renderer.attach(world);
  buildPalette();

  const r = stageEl.getBoundingClientRect();
  renderer.resize(r.width, r.height);
  // 窄屏先把图案库收起来，给画布留出空间
  if (window.innerWidth <= 700) setPaletteCollapsed(true);
  if (auto && auto.view && !fromLink) view.setView(auto.view);
  else fitContent();

  bindUi();
  // 图案库初始化时会顺手切到贴图工具，这里恢复成默认的平移
  setTool('pan');
  setPlaying(false);
  el('tgl-grid').classList.toggle('on', state.grid);
  flushUi();

  // 调试钩子：自动化冒烟测试与线上排查用，正常操作不依赖它
  Object.defineProperty(window, '__life', {
    configurable: true,
    value: {
      get world() { return world; },
      get history() { return history; },
      get view() { return view; },
      get store() { return store; },
      get library() { return library; },
      step(n = 1) { for (let i = 0; i < n; i++) advanceOne(); },
      commit: () => commitEdit(),
      set(x: number, y: number, v: number) { world.set(x, y, v); },
      setSelection(x0: number, y0: number, x1: number, y1: number) {
        const rect = normalizeSelection(x0, y0, x1, y1);
        state.selection = rect ? [rect] : [];
        updateSelBar();
        return state.selection;
      },
      addSelection(x0: number, y0: number, x1: number, y1: number) {
        const rect = normalizeSelection(x0, y0, x1, y1);
        if (rect) state.selection.push(rect);
        updateSelBar();
        return state.selection;
      },
      clearSelection: () => clearSelection(),
      deleteSelection: () => deleteSelection(),
      setTool: (t: ToolName) => setTool(t),
      get tool() { return state.tool; },
      get brushSize() { return state.brushSize; },
      setBrushSize(n: number) { state.brushSize = n; updateHint(); },
      savePreset: () => openSavePreset(),
      manageLibrary: () => openLibraryManager(),
      undo: () => undoEdit(),
      redo: () => redoEdit(),
      get playing() { return state.playing; },
      get overlay() { return buildOverlay(); },
      shareLink: () => shareLink(),
      openShare: () => openShare(),
      get undoDepth() { return undoStack.length; },
      get redoDepth() { return redoStack.length; },
      get selection() { return state.selection; },
      get selectionBBox() { return selectionBBox(state.selection); },
      get paletteMode() { return state.paletteMode; },
      get patternId() { return state.patternId; },
      get paletteWidth() { return el('palette').offsetWidth; },
      setPaletteMode: (m: 'browse' | 'edit') => setPaletteMode(m),
      editList: () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '#palette-list .edit-cat-head, #palette-list .edit-tile, #palette-list .stash-sec',
          ),
        ].map((n) => ({
          kind: n.classList.contains('edit-cat-head')
            ? 'cat'
            : n.classList.contains('stash-sec')
              ? 'stash'
              : 'tile',
          name: n.textContent?.trim() ?? '',
        })),
      movePattern: (id: string, catId: string, beforeId?: string) => {
        library.movePattern(id, catId, beforeId);
        afterEdit();
      },
      stashPattern: (id: string) => {
        library.stash(id);
        afterEdit();
      },
      unstashPattern: (id: string, catId?: string) => {
        library.unstash(id, catId);
        afterEdit();
      },
      moveCategoryBefore: (id: string, beforeId?: string) => {
        library.moveCategoryBefore(id, beforeId);
        afterEdit();
      },
      beginEdit: (label: string) => beginEdit(label),
      place(id: string, x: number, y: number) {
        const p = library.byId(id);
        if (!p) return null;
        beginEdit(`放置 ${p.name}`);
        stampPattern(world, p, x, y, 0, false);
        commitEdit();
        return patternSize(p, 0);
      },
      fit: () => fitContent(),
      scale: (s: number) => { view.scale = view.clampScale(s); uiDirty = true; },
    },
  });

  new ResizeObserver(() => {
    const box = stageEl.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    if (box.width === renderer.cssW && box.height === renderer.cssH) return;
    const w0 = view.screenToWorld(renderer.cssW / 2, renderer.cssH / 2);
    renderer.resize(box.width, box.height);
    const p0 = view.worldToScreen(w0.x, w0.y);
    view.panBy(box.width / 2 - p0.x, box.height / 2 - p0.y);
    uiDirty = true;
  }).observe(stageEl);

  requestAnimationFrame(loop);

  window.setInterval(() => void autoSaveNow(), 15000);
  window.addEventListener('pagehide', () => void autoSaveNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void autoSaveNow();
  });

  if (auto) toast(`已恢复上次的现场（第 ${nf.format(auto.gen)} 代）`);
}

void boot();
