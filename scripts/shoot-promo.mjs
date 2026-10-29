// 为宣传片抓素材：真实界面截图（README 与视频共用）。
// 用法：node scripts/shoot-promo.mjs     输出到 promo/public/
// 前置：先 node scripts/build.mjs 生成 生命游戏.html
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const OUT = resolve('promo/public');
mkdirSync(OUT, { recursive: true });
const FILE = pathToFileURL(resolve('生命游戏.html')).href;

/** 一片固定种子的随机汤（保证每次截图一致） */
const soup = (x0, y0, w, h, density, gens, scale, cx, cy) => `(async () => {
  const L = window.__life;
  L.world.clear(); L.commit();
  let seed = 20261021;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let y = 0; y < ${h}; y++) for (let x = 0; x < ${w}; x++) if (rnd() < ${density}) L.set(${x0} + x, ${y0} + y, 1);
  L.commit(); L.world.gen = 0;
  if (${gens} > 0) L.step(${gens});
  const c = document.getElementById('board');
  const s = ${scale};
  L.view.setView({ scale: s, ox: c.clientWidth / 2 - ${cx} * s, oy: c.clientHeight / 2 - ${cy} * s });
  await new Promise(r => setTimeout(r, 700));
  return L.world.population;
})()`;

/** 按活细胞包围盒自动取景 */
const frameContent = (pad, maxScale) => `(async () => {
  const L = window.__life;
  const c = document.getElementById('board');
  const bb = L.world.liveBBox();
  if (!bb) return 0;
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  const s = Math.min(${maxScale}, c.clientWidth / (bb.x1 - bb.x0 + ${pad}), c.clientHeight / (bb.y1 - bb.y0 + ${pad}));
  L.view.setView({ scale: s, ox: c.clientWidth / 2 - cx * s, oy: c.clientHeight / 2 - cy * s });
  await new Promise(r => setTimeout(r, 700));
  return L.world.population;
})()`;

const browser = await launch({ port: 9531, width: 1920, height: 1080 });
const page = await browser.newPage('about:blank');

/** 每个镜头单独 try，坏一个不影响其它 */
async function shot(name, fn) {
  try {
    const info = await fn();
    await sleep(320);
    await page.screenshot(resolve(OUT, name));
    console.log(`✔ ${name}`, info === undefined ? '' : JSON.stringify(info));
  } catch (err) {
    console.log(`✖ ${name}: ${err.message}`);
  }
}

try {
  await page.navigate(FILE);
  await page.waitFor('!!window.__life', 20000);
  await sleep(900);

  // 1. 纯画布（沉浸模式，作标题页背景）
  await shot('bg-soup.png', async () => {
    const pop = await page.evaluate(soup(360, 418, 220, 124, 0.36, 55, 6.2, 470, 480));
    await page.evaluate(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
      return true;
    })()`);
    await sleep(1500);
    await page.evaluate(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
      return true;
    })()`);
    await sleep(600);
    return { pop };
  });

  // 2. 主视觉：稠密汤 + 完整界面
  await shot('shot-main.png', () => page.evaluate(soup(360, 418, 220, 124, 0.36, 55, 5.6, 470, 480)));

  // 3. 高斯帕机枪特写
  await shot('shot-zoom.png', () =>
    page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('gosperglidergun', 480, 470); L.commit();
      L.world.gen = 0;
      L.step(40);
      const c = document.getElementById('board');
      const s = 16;
      L.view.setView({ scale: s, ox: c.clientWidth / 2 - 520 * s, oy: c.clientHeight / 2 - 480 * s });
      await new Promise(r => setTimeout(r, 700));
      return { pop: L.world.population };
    })()`),
  );

  // 4. 演化到第 40 / 120 / 200 代（时间回溯段要用）
  for (const gens of [40, 120, 200]) {
    await shot(`shot-gen-${gens}.png`, async () => {
      await page.evaluate(soup(360, 418, 220, 124, 0.36, gens, 6.2, 470, 480));
      return page.evaluate(frameContent(40, 7));
    });
  }

  // 5. 图案库：机枪 + 脉冲星 + 滑翔机，选中脉冲星并悬停出幽灵预览
  await shot('ui-library.png', () =>
    page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('gosperglidergun', 470, 300); L.commit();
      L.place('pulsar', 560, 330); L.commit();
      L.place('glider', 470, 360); L.commit();
      L.step(24);
      const c = document.getElementById('board');
      const s = 7.4;
      L.view.setView({ scale: s, ox: c.clientWidth / 2 - 520 * s, oy: c.clientHeight / 2 - 340 * s });
      const tile = document.querySelector('#palette .pat[data-id="pulsar"]');
      if (tile) tile.click();
      await new Promise(r => setTimeout(r, 260));
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent('pointermove', {
        clientX: r.left + c.clientWidth * 0.52, clientY: r.top + c.clientHeight * 0.44,
        pointerId: 9, pointerType: 'mouse', isPrimary: true, bubbles: true,
      }));
      await new Promise(r => setTimeout(r, 420));
      return { tool: L.tool, pat: L.patternId };
    })()`),
  );

  // 6. 图案库编辑模式
  await shot('shot-edit.png', () =>
    page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('gosperglidergun', 500, 470); L.commit();
      L.place('pulsar', 560, 520); L.commit();
      await new Promise(r => setTimeout(r, 120));
      L.setPaletteMode('edit');
      await new Promise(r => setTimeout(r, 420));
      const c = document.getElementById('board');
      const s = 9;
      L.view.setView({ scale: s, ox: c.clientWidth / 2 - 520 * s, oy: c.clientHeight / 2 - 500 * s });
      await new Promise(r => setTimeout(r, 500));
      return { mode: L.paletteMode };
    })()`),
  );

  // 7. 内容库：先存三张快照，再打开「时刻 · 存档」页签
  await shot('ui-studio.png', async () => {
    await page.evaluate(`(() => { const L = window.__life; if (L.paletteMode === 'edit') L.setPaletteMode('browse'); return true; })()`);
    await sleep(300);
    await page.evaluate(soup(360, 418, 220, 124, 0.36, 40, 5.6, 470, 480));
    await page.evaluate(`(async () => {
      const L = window.__life;
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 120));
        document.getElementById('btn-studio').click();
        await new Promise(r => setTimeout(r, 260));
        const inp = document.querySelector('#studio-panel input, #st-snap input');
        if (inp) { inp.value = '第 ' + L.world.gen + ' 代'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        const save = document.getElementById('snap-save');
        if (save) save.click();
        await new Promise(r => setTimeout(r, 460));
        document.getElementById('modal-close').click();
        await new Promise(r => setTimeout(r, 220));
        L.step(30);
      }
      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 620));
      return true;
    })()`);
    return page.evaluate(`document.querySelectorAll('.snap-card').length`);
  });

  // 8. 帮助面板
  await shot('ui-help.png', async () => {
    await page.evaluate(`document.getElementById('modal-close').click()`);
    await sleep(320);
    await page.evaluate(`document.getElementById('btn-help').click()`);
    await sleep(520);
    return page.evaluate(`document.querySelectorAll('.help-row').length`);
  });
  await page.evaluate(`document.getElementById('modal-close').click()`);

  console.log('\n素材齐了 → promo/public/');
} finally {
  await page.close();
  await browser.close();
}
