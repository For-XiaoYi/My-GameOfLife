// 为宣传片抓素材：真实界面截图 + 真实图案数据（README/视频共用）
// 用法：node scripts/shoot-promo.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const OUT = resolve('promo/public');
mkdirSync(OUT, { recursive: true });

const FILE = pathToFileURL(resolve('生命游戏.html')).href;
const browser = await launch({ port: 9511, width: 1920, height: 1080 });
const page = await browser.newPage('about:blank');

const shot = async (name, opts = {}) => {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot(path);
  console.log(`  ✔ ${name}.png${opts.note ? ' — ' + opts.note : ''}`);
  return path;
};

const evalOk = async (code, label) => {
  try {
    return await page.evaluate(code);
  } catch (err) {
    console.log(`  ✖ ${label}：${err.message}`);
    return null;
  }
};

try {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.navigate(FILE);
  await page.waitFor('!!window.__life', 30000);

  // 清空历史存档，保证每次抓出来的画面一致
  await page.evaluate(`(async () => {
    try { localStorage.clear(); } catch (e) {}
    await new Promise((res) => {
      const req = indexedDB.deleteDatabase('life-studio');
      req.onsuccess = req.onerror = req.onblocked = () => res(true);
      setTimeout(() => res(true), 800);
    });
    return true;
  })()`);
  await page.navigate(FILE);
  await page.waitFor('!!window.__life && window.__life.world', 30000);
  await sleep(900);

  // ── 1. 标题背景：一片稠密演化汤（藏掉所有 UI，只要画布） ────────────────
  await page.evaluate(`(async () => {
    const L = window.__life;
    L.world.clear(); L.commit();
    const W = 210, H = 118, x0 = 407, y0 = 470;
    let seed = 20261021;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rnd() < 0.36) L.set(x0 + x, y0 + y, 1);
    L.commit();
    L.world.gen = 0;
    L.step(58);
    for (const id of ['topbar', 'bottombar', 'palette', 'toolbar', 'hint']) {
      const n = document.getElementById(id);
      if (n) n.style.display = 'none';
    }
    L.fit();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  })()`);
  await shot('bg-soup', { note: '标题背景用的稠密演化' });

  // 顺便把这块汤和人眼可辨的几个图案导出成 JSON，Remotion 里要真演化
  const data = await evalOk(`(() => {
    const L = window.__life;
    const dump = (id) => {
      const p = L.library.byId(id);
      return { id, name: p.name, w: p.w, h: p.h, cells: Array.from(p.cells) };
    };
    const bbox = L.world.liveBBox();
    const soup = { w: 190, h: 100, cells: [] };
    const ox = Math.max(0, Math.round((bbox.x0 + bbox.x1) / 2) - 95);
    const oy = Math.max(0, Math.round((bbox.y0 + bbox.y1) / 2) - 50);
    for (let y = 0; y < soup.h; y++) for (let x = 0; x < soup.w; x++) soup.cells.push(L.world.get(ox + x, oy + y) ? 1 : 0);
    return {
      patterns: ['glider', 'lwss', 'pulsar', 'pentadecathlon', 'gosperglidergun', 'rpentomino'].map(dump),
      soup,
      soupOrigin: { x: ox, y: oy },
    };
  })()`, '导出图案数据');
  if (data) {
    writeFileSync(resolve(OUT, 'patterns.json'), JSON.stringify(data.patterns));
    writeFileSync(resolve(OUT, 'soup.json'), JSON.stringify(data.soup));
    console.log(`  ✔ patterns.json（${data.patterns.length} 个图案）· soup.json（${data.soup.w}×${data.soup.h}）`);
  }

  // 恢复 UI
  await page.evaluate(`(() => {
    for (const id of ['topbar', 'bottombar', 'palette', 'toolbar', 'hint']) {
      const n = document.getElementById(id);
      if (n) n.style.display = '';
    }
    return true;
  })()`);

  // ── 2. 主界面：一组经典图案演化 40 代 ─────────────────────────────────
  await page.evaluate(`(async () => {
    const L = window.__life;
    L.world.clear(); L.commit();
    L.place('gosperglidergun', 500, 470);
    L.place('pulsar', 566, 520);
    L.place('pentadecathlon', 440, 560);
    L.place('rpentomino', 640, 430);
    L.place('lwss', 700, 560);
    L.place('glider', 400, 430);
    L.commit();
    L.world.gen = 0;
    L.step(40);
    L.fit();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  })()`);
  await shot('shot-main', { note: '主界面 + 六种图案' });

  // ── 3. 放大看机枪 ───────────────────────────────────────────────────
  await page.evaluate(`(async () => {
    const L = window.__life;
    const c = document.getElementById('board');
    const s = 16;
    L.view.setView({ scale: s, ox: c.clientWidth / 2 - 512 * s, oy: c.clientHeight / 2 - 474 * s });
    await new Promise((r) => setTimeout(r, 400));
    return true;
  })()`);
  await shot('shot-zoom', { note: '放大到 16 倍看滑翔机枪' });

  // ── 4. 框选：两块选区 + 操作条 ──────────────────────────────────────
  await page.evaluate(`(async () => {
    const L = window.__life;
    L.setTool('select');
    const c = document.getElementById('board');
    const s = 9;
    L.view.setView({ scale: s, ox: c.clientWidth / 2 - 520 * s, oy: c.clientHeight / 2 - 480 * s });
    L.setSelection(480, 452, 548, 496);
    L.addSelection(560, 508, 584, 534);
    await new Promise((r) => setTimeout(r, 420));
    return true;
  })()`);
  await shot('shot-select', { note: '两块选区' });

  // ── 5. 存为图案弹窗 ─────────────────────────────────────────────────
  await page.evaluate(`(async () => {
    document.getElementById('btn-save-preset').click();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  })()`);
  await shot('shot-preset', { note: '框选存成自己的图案' });
  await page.evaluate(`(async () => {
    const b = [...document.querySelectorAll('.modal-actions .btn')].find((n) => n.textContent.includes('取消'));
    if (b) b.click();
    await new Promise((r) => setTimeout(r, 300));
    window.__life.clearSelection();
    return true;
  })()`);

  // ── 6. 编辑模式：图案库变成方块网格 ─────────────────────────────────
  await page.evaluate(`(async () => {
    window.__life.setPaletteMode('edit');
    await new Promise((r) => setTimeout(r, 520));
    return true;
  })()`);
  await shot('shot-edit', { note: '图案库编辑模式' });
  await page.evaluate(`(async () => {
    window.__life.setPaletteMode('browse');
    await new Promise((r) => setTimeout(r, 420));
    return true;
  })()`);

  // ── 7. 快照预览 ─────────────────────────────────────────────────────
  await page.evaluate(`(async () => {
    const L = window.__life;
    L.setTool('pan');
    L.fit();
    document.getElementById('btn-studio').click();
    await new Promise((r) => setTimeout(r, 320));
    const name = document.getElementById('snap-name');
    if (name) name.value = '机枪 · 第 40 代';
    document.getElementById('snap-save').click();
    for (let i = 0; i < 40; i++) {
      if (document.querySelectorAll('.snap-card').length) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    await new Promise((r) => setTimeout(r, 400));
    return true;
  })()`);
  await shot('shot-snapshots', { note: '内容库 · 时刻存档' });
  await page.evaluate(`(async () => {
    const card = document.querySelector('.snap-card');
    if (card) card.click();
    await new Promise((r) => setTimeout(r, 700));
    return true;
  })()`);
  await shot('shot-snap-preview', { note: '快照预览（可缩放平移）' });

  // ── 8. 片段：录一段再打开播放器 ─────────────────────────────────────
  await page.evaluate(`(async () => {
    const L = window.__life;
    document.getElementById('modal-close').click();
    await new Promise((r) => setTimeout(r, 320));
    document.getElementById('btn-record').click();
    await new Promise((r) => setTimeout(r, 180));
    for (let i = 0; i < 48; i++) L.step(1);
    await new Promise((r) => setTimeout(r, 260));
    document.getElementById('btn-record').click();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  })()`);
  await page.evaluate(`(async () => {
    document.getElementById('btn-studio').click();
    await new Promise((r) => setTimeout(r, 260));
    document.getElementById('st-clips').click();
    await new Promise((r) => setTimeout(r, 520));
    return true;
  })()`);
  await shot('shot-clips', { note: '内容库 · 时段片段' });
  await page.evaluate(`(async () => {
    const card = document.querySelector('.snap-card');
    if (card) card.click();
    await new Promise((r) => setTimeout(r, 900));
    return true;
  })()`);
  await shot('shot-clip-player', { note: '片段播放器' });

  // ── 9. 分享 ─────────────────────────────────────────────────────────
  await page.evaluate(`(async () => {
    document.getElementById('modal-close').click();
    await new Promise((r) => setTimeout(r, 320));
    document.getElementById('btn-studio').click();
    await new Promise((r) => setTimeout(r, 260));
    document.getElementById('st-share').click();
    await new Promise((r) => setTimeout(r, 480));
    return true;
  })()`);
  await shot('shot-share', { note: '分享画面 / 导出 PNG' });
  await page.evaluate(`(async () => {
    document.getElementById('modal-close').click();
    await new Promise((r) => setTimeout(r, 280));
    return true;
  })()`);

  // ── 10. 回溯：同一台相机、三个不同代数 ──────────────────────────────
  for (const gen of [200, 120, 40]) {
    await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('gosperglidergun', 470, 460);
      L.place('pulsar', 560, 540);
      L.place('rpentomino', 660, 430);
      L.commit();
      L.world.gen = 0;
      L.step(${gen});
      const c = document.getElementById('board');
      const s = 7.2;
      L.view.setView({ scale: s, ox: c.clientWidth / 2 - 540 * s, oy: c.clientHeight / 2 - 500 * s });
      await new Promise((r) => setTimeout(r, 520));
      return true;
    })()`);
    await shot(`shot-gen-${gen}`, { note: `第 ${gen} 代` });
  }

  // ── 11. 手机版 ──────────────────────────────────────────────────────
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await page.navigate(FILE);
  await page.waitFor('!!window.__life', 30000);
  await sleep(1100);
  await shot('shot-mobile', { note: '手机竖屏 390×844' });

  console.log('\n素材齐了 → promo/public/');
} finally {
  await page.close();
  await browser.close();
}
