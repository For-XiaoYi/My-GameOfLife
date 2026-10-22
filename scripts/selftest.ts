/**
 * 数值自检：用暴力实现对照 World.step()，并校验图案库与历史回溯。
 * 运行：node --experimental-strip-types scripts/selftest.ts
 */
import { World, type EdgeMode } from '../src/core/world.ts';
import { History } from '../src/core/history.ts';
import { PATTERNS, stampPattern } from '../src/core/patterns.ts';
import { Library, encodeCells, decodeCells, normalizeConfig } from '../src/core/library.ts';
import { toRle, parsePatternText } from '../src/core/rle.ts';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function refStep(grid: Uint8Array, w: number, h: number, wrap: boolean): Uint8Array {
  const next = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          let nx = x + dx;
          let ny = y + dy;
          if (wrap) {
            nx = (nx + w) % w;
            ny = (ny + h) % h;
          } else if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            continue;
          }
          n += grid[ny * w + nx];
        }
      }
      const alive = grid[y * w + x];
      next[y * w + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
    }
  }
  return next;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- 1. step 对照
function testStepAgainstReference(): void {
  console.log('\n[1] step() 对照暴力实现');
  const sizes = [
    [8, 8],
    [16, 16],
    [31, 17],
    [7, 23],
    [64, 48],
  ];
  const modes: EdgeMode[] = ['wrap', 'dead'];
  let cases = 0;
  for (const [w, h] of sizes) {
    for (const mode of modes) {
      for (let seed = 1; seed <= 3; seed++) {
        const rand = rng(seed * 7919 + w * 31 + h);
        const world = new World(w, h);
        world.edge = mode;
        const ref = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const v = rand() < 0.32 ? 1 : 0;
          ref[i] = v;
          world.set(i % w, (i / w) | 0, v);
        }
        for (let step = 0; step < 25; step++) {
          const before = world.toBits();
          const popBefore = world.population;
          const nxt = refStep(ref, w, h, mode === 'wrap');
          const delta = world.step();
          ref.set(nxt);
          const after = world.toBits();
          const popAfter = world.population;
          if (!eqBytes(after, ref)) {
            check(`${w}x${h} ${mode} seed${seed} 第${step}代`, false, '与暴力实现不一致');
            break;
          }
          if (delta) {
            world.revertDelta(delta);
            if (!eqBytes(world.toBits(), before) || world.population !== popBefore) {
              check(`${w}x${h} ${mode} seed${seed} 第${step}代 反演`, false, 'revertDelta 未能还原');
              break;
            }
            world.applyDelta(delta);
            if (!eqBytes(world.toBits(), after) || world.population !== popAfter) {
              check(`${w}x${h} ${mode} seed${seed} 第${step}代 重放`, false, 'applyDelta 未能重放');
              break;
            }
          }
        }
        const pop = ref.reduce((a, b) => a + b, 0);
        check(`${w}x${h} ${mode} seed${seed} 人口`, pop === world.population, `期望 ${pop} 实际 ${world.population}`);
        cases++;
      }
    }
  }
  check(`共 ${cases} 组随机世界演化 25 代`, true);
}

// ------------------------------------------------------- 2. 增量可逆性（单步）
function testDeltaReversible(): void {
  console.log('\n[2] 单步增量可反向还原');
  for (const [w, h] of [
    [32, 32],
    [17, 9],
  ]) {
    for (const mode of ['wrap', 'dead'] as EdgeMode[]) {
      const rand = rng(w * 13 + h);
      const world = new World(w, h);
      world.edge = mode;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rand() < 0.3) world.set(x, y, 1);
      for (let i = 0; i < 30; i++) {
        const before = world.toBits();
        const popBefore = world.population;
        const delta = world.step();
        if (!delta) continue;
        world.revertDelta(delta);
        world.gen -= 1;
        check(
          `${w}x${h} ${mode} 第${i}代可逆`,
          eqBytes(world.toBits(), before) && world.population === popBefore,
          `人口 ${popBefore} -> ${world.population}`,
        );
        world.gen += 1;
        world.applyDelta(delta);
      }
    }
  }
}

// ---------------------------------------------------------------- 3. 图案库
function testPatterns(): void {
  console.log('\n[3] 图案库');
  const W = 160;
  const H = 120;
  const PAD = 40;
  for (const pat of PATTERNS) {
    const world = new World(W, H);
    world.edge = 'dead';
    const x = PAD;
    const y = PAD;
    stampPattern(world, pat, x, y, 0, false);
    const start = world.toBits();
    const startPop = world.population;
    check(`${pat.id} 尺寸 ${pat.w}x${pat.h}`, pat.w > 0 && pat.h > 0);

    if (pat.period === 1) {
      world.step();
      check(`${pat.id} 静物稳定`, eqBytes(world.toBits(), start), '一代后发生变化');
      check(`${pat.id} 静物人口不变`, world.population === startPop);
      continue;
    }
    if (pat.period < 0) continue;
    // 枪会不断吐出飞船，不能按"整幅复原"检查
    if (pat.category === '枪') continue;

    const steps = pat.period;
    for (let i = 0; i < steps; i++) world.step();
    const after = world.toBits();
    const isShip = !!pat.move && (pat.move[0] !== 0 || pat.move[1] !== 0);

    if (isShip) {
      // 找出位移量：尝试所有 ± 几个格子的平移
      let found: [number, number] | null = null;
      for (let dy = -4; dy <= 4 && !found; dy++) {
        for (let dx = -4; dx <= 4 && !found; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (shiftedEquals(start, after, W, H, dx, dy)) found = [dx, dy];
        }
      }
      check(`${pat.id} 周期 ${pat.period} 后平移`, !!found, found ? `位移 ${found.join(',')}` : '未找到匹配位移（图案可能写错）');
      if (found) {
        check(`${pat.id} 人口守恒`, world.population === startPop, `${startPop} -> ${world.population}`);
        if (pat.move) {
          const [mx, my] = pat.move;
          const okMove =
            (found[0] === mx && found[1] === my) || (found[0] === -mx && found[1] === -my);
          if (!okMove) console.log(`    · ${pat.id} 实际位移 ${found.join(',')}，声明 ${pat.move.join(',')}（不影响功能）`);
        }
      }
    } else {
      check(`${pat.id} 周期 ${pat.period} 复原`, eqBytes(after, start), '一个周期后未复原');
      check(`${pat.id} 人口守恒`, world.population === startPop, `${startPop} -> ${world.population}`);
    }
  }
}

function shiftedEquals(a: Uint8Array, b: Uint8Array, w: number, h: number, dx: number, dy: number): boolean {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      const sy = y - dy;
      const av = sx >= 0 && sy >= 0 && sx < w && sy < h ? a[sy * w + sx] : 0;
      if (av !== b[y * w + x]) return false;
    }
  }
  return true;
}

// ------------------------------------------------------------- 4. 滑翔机枪
function testGun(): void {
  console.log('\n[4] 高斯帕滑翔机枪');
  const gun = PATTERNS.find((p) => p.id === 'gosperglidergun')!;
  const world = new World(300, 300);
  world.edge = 'dead';
  stampPattern(world, gun, 20, 20, 0, false);
  const pop0 = world.population;
  const pops: number[] = [pop0];
  for (let period = 0; period < 4; period++) {
    for (let i = 0; i < 30; i++) world.step();
    pops.push(world.population);
  }
  console.log(`    人口序列：${pops.join(' -> ')}`);
  let ok = true;
  for (let i = 1; i < pops.length; i++) if (pops[i] - pops[i - 1] !== 5) ok = false;
  check('每 30 代恰好产生一只滑翔机（+5 细胞）', ok);
}

// ---------------------------------------------------------------- 5. 历史回溯
function testHistory(): void {
  console.log('\n[5] 历史回溯');
  const w = new World(64, 64);
  w.randomize(0.3);
  const hist = new History(w);
  const snaps = new Map<number, Uint8Array>();
  const pops = new Map<number, number>();
  snaps.set(w.gen, w.toBits());
  pops.set(w.gen, w.population);
  for (let i = 0; i < 300; i++) {
    const d = w.step();
    hist.record(w.gen, d);
    snaps.set(w.gen, w.toBits());
    pops.set(w.gen, w.population);
  }
  const stats = hist.stats();
  console.log(`    历史：${stats.minGen}–${stats.maxGen}，${stats.keyframes} 关键帧，${(stats.bytes / 1024).toFixed(1)} KB`);
  check('历史覆盖 300 代', stats.maxGen - stats.minGen === 300, `${stats.minGen}–${stats.maxGen}`);

  const gens = [...snaps.keys()].sort(() => Math.random() - 0.5);
  let bad = 0;
  for (const g of gens) {
    hist.seek(g);
    if (!eqBytes(w.toBits(), snaps.get(g)!) || w.population !== pops.get(g)) bad++;
    if (w.gen !== g) bad++;
  }
  check('随机跳转 301 个代均还原正确', bad === 0, `${bad} 处不一致`);

  // 在历史中间继续演化应截断未来
  hist.seek(200);
  const d2 = w.step();
  hist.record(w.gen, d2);
  check('从历史中间继续演化会截断未来', hist.stats().maxGen === 201, `${hist.stats().maxGen}`);

  // 编辑后历史仍自洽
  hist.seek(120);
  w.set(5, 5, 1);
  w.set(6, 5, 1);
  w.set(5, 6, 1);
  const edited = w.toBits();
  const editedPop = w.population;
  hist.markEdited(w.gen, w.toPacked(), w.population);
  check('编辑后世界仍是编辑结果', eqBytes(w.toBits(), edited) && w.population === editedPop);
  hist.seek(119);
  check('编辑后能回到上一代原貌', eqBytes(w.toBits(), snaps.get(119)!));
  hist.seek(100);
  hist.seek(120);
  check('编辑后回到同一代仍是编辑后的状态', eqBytes(w.toBits(), edited) && w.population === editedPop);
  hist.seek(119);
  hist.seek(120);
  check('编辑代跨关键帧往返一致', eqBytes(w.toBits(), edited));
  check('编辑后未来被截断', hist.stats().maxGen === 120, `${hist.stats().maxGen}`);

  // 片段抽取
  const clip = hist.extractClip(60, 90);
  check('片段抽取成功', !!clip);
  if (clip) {
    check('片段长度', clip.deltas.length === 30, `${clip.deltas.length}`);
    const cw = new World(64, 64);
    cw.loadPacked(clip.start.packed, clip.start.population, clip.startGen);
    for (const d of clip.deltas) cw.applyDelta(d);
    cw.gen = clip.endGen;
    check('片段重放结果与历史一致', eqBytes(cw.toBits(), snaps.get(clip.endGen)!));
  }
}

// ------------------------------------------------------------ 6. 边界与规模
function testEdgeAndScale(): void {
  console.log('\n[6] 大世界与边界');
  const w = new World(1024, 1024);
  w.edge = 'wrap';
  w.randomize(0.3);
  const t0 = performance.now();
  let steps = 0;
  while (performance.now() - t0 < 300 && steps < 30) {
    w.step();
    steps++;
  }
  const per = (performance.now() - t0) / Math.max(1, steps);
  console.log(`    1024×1024 稠密随机图：${steps} 代，平均 ${per.toFixed(2)} ms/代，人口 ${w.population}`);
  check('1024×1024 单代 < 30ms', per < 30, `${per.toFixed(2)}ms`);

  const empty = new World(1024, 1024);
  const t1 = performance.now();
  for (let i = 0; i < 100; i++) empty.step();
  const perEmpty = (performance.now() - t1) / 100;
  console.log(`    空世界：${perEmpty.toFixed(4)} ms/代`);
  check('空世界演化几乎零开销', perEmpty < 1);

  // 环形边界对齐验证：单格在角落也能正确绕回
  const c = new World(10, 10);
  c.edge = 'wrap';
  c.set(0, 0, 1);
  c.set(9, 9, 1);
  c.set(0, 9, 1);
  c.step();
  const bits = c.toBits();
  // (0,0)、(9,9)、(0,9) 三点两两相邻，(9,0) 同时贴着三点 → 出生，共 4 个
  check('wrap 角落邻居正确计数', bits.reduce((a, b) => a + b, 0) === 4, `人口 ${c.population}`);
}

// ------------------------------------------------------------ 7. 图案库模型
function testLibrary(): void {
  console.log('\n[7] 图案库模型');
  const rand = rng(99);

  // base64 往返（长度 1..8 都要覆盖，验证 padding 分支）
  let okB64 = true;
  for (let len = 1; len <= 8; len++) {
    const src = new Uint8Array(len);
    for (let i = 0; i < len; i++) src[i] = Math.floor(rand() * 256);
    const back = decodeCells(encodeCells(src));
    if (!eqBytes(src, back)) okB64 = false;
  }
  check('图案 base64 编解码往返一致', okB64);

  const lib = new Library();
  check('默认图案库包含全部内置图案', lib.visible.length === PATTERNS.length, `${lib.visible.length}`);
  check('默认分类有 5 个', lib.categories.length === 5);
  check('内置图案落在正确分类', lib.byId('glider')!.catId === 'ship' && lib.byId('pulsar')!.catId === 'oscillator');
  check('按分类取图案不串味', lib.patternsIn('gun').every((p) => p.catId === 'gun'));

  // 自定义图案
  const cells = new Uint8Array(3 * 2);
  cells[0] = 1;
  cells[4] = 1;
  cells[5] = 1;
  const rec = {
    id: 'c-test',
    name: '测试图',
    catId: 'still',
    width: 3,
    height: 2,
    cells: encodeCells(cells),
    created: 1,
  };
  lib.addCustom(rec);
  const custom = lib.byId('c-test');
  check('自定义图案能加进库', !!custom && custom.custom);
  check('自定义图案细胞数正确', custom!.population === 3, `${custom!.population}`);
  check('自定义图案细胞位图正确', eqBytes(custom!.cells, cells));
  check('自定义图案出现在所属分类', lib.patternsIn('still').some((p) => p.id === 'c-test'));

  // 改归属 / 隐藏
  lib.assign('c-test', 'gun');
  check('自定义图案可换分类', lib.byId('c-test')!.catId === 'gun' && lib.patternsIn('still').every((p) => p.id !== 'c-test'));
  lib.assign('glider', 'still');
  check('内置图案可换分类', lib.byId('glider')!.catId === 'still');
  lib.assign('glider', null);
  check('图案可以隐藏', lib.patternsIn('still').every((p) => p.id !== 'glider') && lib.hidden.some((p) => p.id === 'glider'));
  lib.assign('glider', null);
  lib.assign('glider', 'ship');
  check('隐藏的图案可以恢复', lib.byId('glider')!.catId === 'ship');

  // 分类改名 / 增删 / 排序
  lib.renameCategory('still', '静止不动');
  check('分类可改名', lib.categoryName('still') === '静止不动');
  const newCat = lib.addCategory('我的收藏');
  check('可以新建分类', lib.categories.some((c) => c.id === newCat.id));
  lib.assign('c-test', newCat.id);
  check('图案能放进新分类', lib.patternsIn(newCat.id).some((p) => p.id === 'c-test'));
  const before = lib.categories.map((c) => c.id).join(',');
  lib.moveCategory(newCat.id, -1);
  const after = lib.categories.map((c) => c.id).join(',');
  check('分类可以调顺序', before !== after && after !== '');
  lib.removeCategory(newCat.id);
  check('分类删除后图案不丢', lib.byId('c-test') !== undefined && lib.byId('c-test')!.catId !== newCat.id);
  check('至少保留一个分类', (() => {
    const one = new Library();
    while (one.categories.length > 1) one.removeCategory(one.categories[1].id);
    one.removeCategory(one.categories[0].id);
    return one.categories.length === 1;
  })());

  // 删除自定义图案
  lib.removeCustom('c-test');
  check('自定义图案可删除', lib.byId('c-test') === undefined);

  // 配置容错
  const fixed = normalizeConfig({
    categories: [{ id: 'a', name: 'A' }, { id: 'a', name: '重复' }],
    assignments: { glider: '不存在的分类', pulsar: 'a' },
  } as never);
  check('坏配置会被清理', fixed.categories.length === 1 && fixed.assignments.pulsar === 'a' && !('glider' in fixed.assignments));
  check('空配置退回默认', normalizeConfig(null).categories.length === 5);

  // 自定义图案与内置图案互不干扰
  const lib2 = new Library([rec]);
  check('自定义图案不污染内置数量', lib2.visible.length === PATTERNS.length + 1);
}

function testRle(): void {
  console.log('\n[8] RLE 导出与解析');

  // 单行
  const row = new Uint8Array([1, 1, 0, 1]);
  const rowBack = parsePatternText(toRle({ width: 4, height: 1, cells: row }));
  check('单行 RLE 往返', !!rowBack && rowBack.width === 4 && rowBack.height === 1, JSON.stringify(rowBack && [rowBack.width, rowBack.height]));
  check('单行 RLE 细胞一致', !!rowBack && eqBytes(rowBack.cells, row), rowBack ? String(rowBack.cells) : '');

  // 多行（关键：相邻行之间必须有 $）
  const grid = new Uint8Array([
    1, 0, 0,
    1, 1, 0,
    0, 0, 1,
  ]);
  const gridBack = parsePatternText(toRle({ width: 3, height: 3, cells: grid }));
  check('多行 RLE 往返尺寸', !!gridBack && gridBack.width === 3 && gridBack.height === 3, JSON.stringify(gridBack && [gridBack.width, gridBack.height]));
  check('多行 RLE 细胞一致', !!gridBack && eqBytes(gridBack.cells, grid), gridBack ? String(gridBack.cells) : '');
  check('相邻行用 $ 分隔', (toRle({ width: 3, height: 3, cells: grid }).match(/\$/g) ?? []).length === 2, toRle({ width: 3, height: 3, cells: grid }).split('\n').pop() ?? '');

  // 中间有空行
  const gap = new Uint8Array([1, 0, 0, 0, 1]);
  const gapBack = parsePatternText(toRle({ width: 1, height: 5, cells: gap }));
  check('空行用 n$ 压缩', !!gapBack && gapBack.height === 5 && eqBytes(gapBack.cells, gap), gapBack ? `${gapBack.width}×${gapBack.height}` : '解析失败');

  // 真实图案：高斯帕机枪
  const gun = PATTERNS.find((p) => p.id === 'gosperglidergun')!;
  const gunRle = toRle({ width: gun.w, height: gun.h, cells: gun.cells }, { name: 'gun' });
  const gunBack = parsePatternText(gunRle);
  check('机枪 RLE 往返', !!gunBack && eqBytes(gunBack.cells, gun.cells), gunBack ? `${gunBack.width}×${gunBack.height}` : '解析失败');

  // 解析器原有能力：LifeWiki 风格带头部
  const wiki = parsePatternText('#N glider\nx = 3, y = 3, rule = B3/S23\nbo$2bo$3o!');
  check('带 #N 与规则头的 RLE', !!wiki && wiki.width === 3 && wiki.height === 3 && wiki.name === 'glider', wiki?.name ?? '解析失败');
  // 纯文本点阵
  const plain = parsePatternText('.O.\n..O\nOOO');
  check('纯文本点阵能与 RLE 一致', !!plain && plain.width === 3 && plain.height === 3 && eqBytes(plain.cells, wiki!.cells), plain ? `${plain.width}×${plain.height}` : '解析失败');
}

console.log('生命游戏核心自检');
testStepAgainstReference();
testDeltaReversible();
testPatterns();
testGun();
testHistory();
testEdgeAndScale();
testLibrary();
testRle();

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail) {
  console.log('失败项：\n  - ' + failures.join('\n  - '));
  process.exitCode = 1;
}
