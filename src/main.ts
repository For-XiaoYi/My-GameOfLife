import { World } from './core/world.ts';
import { History } from './core/history.ts';
import {
  PATTERNS,
  PATTERN_BY_ID,
  CATEGORY_ORDER,
  renderPattern,
  patternSize,
  stampPattern,
  type PatternDef,
} from './core/patterns.ts';
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
type ToolName = 'brush' | 'erase' | 'line' | 'rect' | 'stamp' | 'pan';

interface DragState {
  kind: 'pan' | 'paint' | 'shape';
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
}

const SPEED_MIN = 0.1;
const SPEED_MAX = 120;

let world: World;
let history: History;
let renderer: Renderer;
let store: Store;
const view = new Viewport();

const state = {
  tool: 'brush' as ToolName,
  patternId: 'gosperglidergun',
  rotation: 0,
  mirror: false,
  grid: true,
  glow: true,
  playing: false,
  unlimited: false,
  speed: 10,
  acc: 0,
  drag: null as DragState | null,
  hover: null as { x: number; y: number } | null,
  editPending: false,
  recordStart: -1,
  pointers: new Map<number, { x: number; y: number }>(),
  pinch: null as null | { dist: number; cx: number; cy: number },
  modalOpen: false,
};

const keys = { space: false };
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
  const gun = PATTERN_BY_ID.get('gosperglidergun');
  const pulsar = PATTERN_BY_ID.get('pulsar');
  const penta = PATTERN_BY_ID.get('pentadecathlon');
  const rp = PATTERN_BY_ID.get('rpentomino');
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
  renderer.render(view, { grid: state.grid, glow: state.glow }, overlay);

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
} {
  let ghost: Ghost | null = null;
  let brush: { x: number; y: number; size: number } | null = null;

  if (state.hover && !state.drag) {
    if (state.tool === 'stamp') {
      const pat = PATTERN_BY_ID.get(state.patternId);
      if (pat) {
        const r = renderPattern(pat, state.rotation, state.mirror);
        const x = state.hover.x - Math.floor(r.w / 2);
        const y = state.hover.y - Math.floor(r.h / 2);
        const ok = x >= 0 && y >= 0 && x + r.w <= world.width && y + r.h <= world.height;
        ghost = { cells: r.cells, w: r.w, h: r.h, x, y, ok };
      }
    } else if (state.tool === 'brush' || state.tool === 'erase') {
      brush = { x: state.hover.x, y: state.hover.y, size: 1 };
    }
  }

  const d = state.drag;
  return { ghost, brush, shape: d && d.kind === 'shape' ? d.shape : null };
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
// 编辑
// ──────────────────────────────────────────────────────────────────────────
function commitEdit(): void {
  history.markEdited(world.gen, world.toPacked(), world.population);
  uiDirty = true;
}

function paintCell(x: number, y: number, value: number): void {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
  if (world.get(x, y) === value) return;
  world.set(x, y, value);
  state.editPending = true;
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
  const pat = PATTERN_BY_ID.get(state.patternId);
  if (!pat) return;
  const size = patternSize(pat, state.rotation);
  const x = p.x - Math.floor(size.w / 2);
  const y = p.y - Math.floor(size.h / 2);
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
  state.tool = tool;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#toolbar .tool')) {
    btn.classList.toggle('active', btn.dataset.tool === tool);
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

  canvas.setPointerCapture(e.pointerId);
  const wp = worldAt(p);
  const wantPan = state.tool === 'pan' || e.button === 2 || e.button === 1 || keys.space;

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
  if (!d) return;

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
    }
  } else if (d.kind === 'shape' && d.shape) {
    applyShape(d.shape);
    if (state.editPending) {
      commitEdit();
      state.editPending = false;
    }
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
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;

  if (e.key === 'Escape' && state.modalOpen) {
    closeModal();
    return;
  }
  if (state.modalOpen) return;

  if (e.code === 'Space') {
    if (!keys.space) {
      keys.space = true;
      stageEl.classList.add('panning');
    }
    e.preventDefault();
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
    case 'h':
      setTool('pan');
      break;
    case 'g':
      toggleGrid();
      break;
    case 'o':
      toggleGlow();
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
      clearWorld();
      break;
    default:
      break;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    keys.space = false;
    stageEl.classList.remove('panning');
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
  const palW = palEl.offsetWidth > 0 ? palEl.offsetWidth + 24 : 16;
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
  world.clear();
  commitEdit();
  toast('世界已清空');
}

function randomWorld(): void {
  if (state.playing) setPlaying(false);
  world.clear();
  world.randomize(0.28);
  commitEdit();
  toast('随机播种完成');
}

function toggleGrid(): void {
  state.grid = !state.grid;
  el('tgl-grid').classList.toggle('on', state.grid);
}

function toggleGlow(): void {
  state.glow = !state.glow;
  el('tgl-glow').classList.toggle('on', state.glow);
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

function buildPalette(): void {
  const list = el('palette-list');
  list.innerHTML = '';
  for (const cat of CATEGORY_ORDER) {
    const items = PATTERNS.filter((p) => p.category === cat);
    if (!items.length) continue;
    const title = document.createElement('div');
    title.className = 'cat-title';
    title.textContent = cat;
    list.append(title);
    const grid = document.createElement('div');
    grid.className = 'pat-grid';
    for (const pat of items) {
      const btn = document.createElement('button');
      btn.className = 'pat';
      btn.dataset.id = pat.id;
      btn.title = `${pat.name} · ${pat.en}${pat.period > 1 ? ` · 周期 ${pat.period}` : ''}`;
      const c = document.createElement('canvas');
      c.width = 56;
      c.height = 38;
      drawPatternIcon(c, pat);
      const label = document.createElement('span');
      label.textContent = pat.name;
      btn.append(c, label);
      btn.addEventListener('click', () => selectPattern(pat.id));
      grid.append(btn);
    }
    list.append(grid);
  }
  selectPattern(state.patternId);
}

function selectPattern(id: string): void {
  const pat = PATTERN_BY_ID.get(id);
  if (!pat) return;
  state.patternId = id;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#palette .pat')) {
    btn.classList.toggle('active', btn.dataset.id === id);
  }
  setTool('stamp');
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
      r.render(v, { grid: false, glow: true });
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
// 帮助
// ──────────────────────────────────────────────────────────────────────────
function openHelp(): void {
  openModal('操作说明', (body) => {
    body.innerHTML = `
      <dl class="help-list">
        <dt>拖拽</dt><dd>用当前工具绘制（画笔 / 橡皮 / 直线 / 矩形）</dd>
        <dt>右键 / 空格 + 拖拽</dt><dd>平移画布</dd>
        <dt>滚轮 / 双指</dt><dd>以光标为中心缩放（0.03× – 64×）</dd>
        <dt><kbd>B</kbd> <kbd>E</kbd> <kbd>I</kbd> <kbd>U</kbd> <kbd>S</kbd> <kbd>H</kbd></dt>
        <dd>画笔 / 橡皮 / 直线 / 矩形 / 贴图 / 平移</dd>
        <dt><kbd>R</kbd> <kbd>M</kbd></dt><dd>旋转 90°、左右镜像（贴图前）</dd>
        <dt><kbd>P</kbd></dt><dd>播放 / 暂停</dd>
        <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>时间轴上退一代 / 前进一代</dd>
        <dt><kbd>G</kbd> <kbd>O</kbd></dt><dd>网格、光晕开关</dd>
        <dt><kbd>0</kbd></dt><dd>缩放到整幅世界</dd>
        <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>放大 / 缩小</dd>
        <dt><kbd>Del</kbd></dt><dd>清空世界</dd>
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
  el('btn-snapshots').addEventListener('click', () => void openSnapshots());
  el('btn-clips').addEventListener('click', () => void openClips());
  el('btn-rle').addEventListener('click', openRle);
  el('btn-help').addEventListener('click', openHelp);

  el('tgl-grid').addEventListener('click', toggleGrid);
  el('tgl-glow').addEventListener('click', toggleGlow);
  el('btn-rotate').addEventListener('click', rotatePattern);
  el('btn-mirror').addEventListener('click', mirrorPattern);
  el('btn-palette-collapse').addEventListener('click', () => {
    el('palette').classList.toggle('collapsed');
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

  let auto = null;
  try {
    auto = await store.getAutoSave();
  } catch {
    auto = null;
  }

  if (auto && auto.width > 0) {
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
  if (auto && auto.view) view.setView(auto.view);
  else fitContent();

  bindUi();
  setPlaying(false);
  el('tgl-grid').classList.toggle('on', state.grid);
  el('tgl-glow').classList.toggle('on', state.glow);
  flushUi();

  // 调试钩子：自动化冒烟测试与线上排查用，正常操作不依赖它
  Object.defineProperty(window, '__life', {
    configurable: true,
    value: {
      get world() { return world; },
      get history() { return history; },
      get view() { return view; },
      get store() { return store; },
      step(n = 1) { for (let i = 0; i < n; i++) advanceOne(); },
      commit: () => commitEdit(),
      set(x: number, y: number, v: number) { world.set(x, y, v); },
      place(id: string, x: number, y: number) {
        const p = PATTERN_BY_ID.get(id);
        if (!p) return null;
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
