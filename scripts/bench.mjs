// 性能剖析：引擎单代耗时 + 不限速模式下的实际代/秒。
import { resolve } from 'node:path';
import { launch } from '../scripts/cdp.mjs';

const browser = await launch({ port: 9431, width: 1600, height: 1000 });
const page = await browser.newPage('file:///' + resolve('生命游戏.html').replace(/\\/g, '/'));
try {
  await page.waitFor('window.__life && window.__life.world', 30000);

  const r = await page.evaluate(`(() => {
    const L = window.__life;
    const w = L.world;
    const out = {};

    // 场景 1：稠密随机汤（100 万格约 32% 活）
    w.clear();
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let y = 0; y < w.height; y++) {
      for (let x = 0; x < w.width; x++) if (rnd() < 0.32) w.set(x, y, 1);
    }
    out.densePop = w.population;
    let t0 = performance.now();
    for (let i = 0; i < 20; i++) w.step();
    out.denseMs = (performance.now() - t0) / 20;

    // 场景 2：稀疏（一个高斯帕机枪）
    w.clear();
    L.place('gosperglidergun', 500, 500);
    t0 = performance.now();
    for (let i = 0; i < 500; i++) w.step();
    out.sparseMs = (performance.now() - t0) / 500;

    // 场景 3：900×900 实心方块（脏矩形≈全图的最坏情况）
    w.clear();
    for (let y = 100; y < 900; y++) for (let x = 100; x < 900; x++) w.set(x, y, 1);
    t0 = performance.now();
    for (let i = 0; i < 10; i++) w.step();
    out.fullMs = (performance.now() - t0) / 10;
    return out;
  })()`);

  console.log('稠密汤    人口', r.densePop.toFixed(0), '· step', r.denseMs.toFixed(2), 'ms  →', (1000 / r.denseMs).toFixed(0), '代/秒');
  console.log('单枪稀疏  step', r.sparseMs.toFixed(4), 'ms  →', (1000 / r.sparseMs).toFixed(0), '代/秒');
  console.log('满屏实心  step', r.fullMs.toFixed(2), 'ms  →', (1000 / r.fullMs).toFixed(0), '代/秒');

  // 场景 4：不限速模式的端到端吞吐（含渲染与 UI）
  await page.evaluate(`(() => {
    const L = window.__life;
    L.world.clear();
    for (let y = 200; y < 800; y++) for (let x = 200; x < 900; x++) if ((x * 7 + y * 13) % 5 < 2) L.world.set(x, y, 1);
    document.getElementById('btn-unlimited').click();
    // 启动时是暂停的，先按播放（按钮文字为 ▶ 时代表暂停状态）
    const play = document.getElementById('btn-play');
    if (play.textContent === '▶') play.click();
    return true;
  })()`);
  const g0 = await page.evaluate('window.__life.world.gen');
  await new Promise((res) => setTimeout(res, 2000));
  const g1 = await page.evaluate('window.__life.world.gen');
  console.log('不限速端到端（含渲染）', ((g1 - g0) / 2).toFixed(0), '代/秒');
} finally {
  await page.close();
  await browser.close();
}
