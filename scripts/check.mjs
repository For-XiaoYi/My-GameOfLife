// 真实浏览器里的端到端检查：用 CDP 打开单文件产物，模拟点击与拖动，
// 断言世界状态、界面文案和画布像素。跑法：node scripts/check.mjs
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const FILE = pathToFileURL(resolve('生命游戏.html')).href;
const results = [];

function record(name, pass, info = '') {
  results.push({ name, pass, info });
  console.log(`${pass ? '  ok' : '  XX'}  ${name}${info ? `  — ${info}` : ''}`);
}

async function main() {
  const browser = await launch({ port: 9412 });
  const page = await browser.newPage('about:blank');
  try {
    await page.navigate(FILE);
    await page.waitFor('!!window.__life', 20000);
    await sleep(400);

    // A 启动
    const boot = await page.evaluate(`(() => ({
      pats: document.querySelectorAll('#palette .pat').length,
      gen: document.getElementById('stat-gen').textContent,
      pop: document.getElementById('stat-pop').textContent,
      mode: window.__life.store.mode,
      canvas: [document.getElementById('board').width, document.getElementById('board').height],
    }))()`);
    record('图案库渲染出全部预设', boot.pats === 20, `${boot.pats} 个`);
    record('画布已按视口尺寸初始化', boot.canvas[0] > 800 && boot.canvas[1] > 500, boot.canvas.join('×'));
    record('启动即有示例图案', Number(boot.pop.replace(/,/g, '')) > 50, `人口 ${boot.pop}`);

    // B 速度
    await page.evaluate(`(() => {
      const sp = document.getElementById('speed');
      sp.value = '0'; sp.dispatchEvent(new Event('input'));
    })()`);
    await sleep(250);
    const slow = await page.evaluate(`document.getElementById('speed-label').textContent`);
    await page.evaluate(`(() => {
      const sp = document.getElementById('speed');
      sp.value = '100'; sp.dispatchEvent(new Event('input'));
    })()`);
    await sleep(250);
    const fast = await page.evaluate(`document.getElementById('speed-label').textContent`);
    record('速度滑杆改变迭代速度', slow !== fast, `${slow} → ${fast}`);

    await page.evaluate(`document.getElementById('btn-unlimited').click()`);
    await sleep(200);
    const unl = await page.evaluate(`document.getElementById('speed-label').textContent`);
    record('不限速按钮生效', unl.includes('不限速'), unl);
    await page.evaluate(`document.getElementById('btn-unlimited').click()`);
    await sleep(200);

    // C 编辑 + 回溯
    const edit = await page.evaluate(`(() => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('glider', 100, 100);
      const p0 = L.world.population;
      L.world.liveBBox();
      const sig = (() => { const bb = L.world.liveBBox(); const a = [];
        for (let y = bb.y0; y < bb.y1; y++) for (let x = bb.x0; x < bb.x1; x++) if (L.world.get(x, y)) a.push(x + ',' + y);
        return a.join(';'); })();
      L.step(4);
      const sig4 = (() => { const bb = L.world.liveBBox(); const a = [];
        for (let y = bb.y0; y < bb.y1; y++) for (let x = bb.x0; x < bb.x1; x++) if (L.world.get(x, y)) a.push(x + ',' + y);
        return a.join(';'); })();
      L.history.seek(0);
      const back = (() => { const bb = L.world.liveBBox(); const a = [];
        for (let y = bb.y0; y < bb.y1; y++) for (let x = bb.x0; x < bb.x1; x++) if (L.world.get(x, y)) a.push(x + ',' + y);
        return a.join(';'); })();
      const gens = L.history.stats().gens;
      L.history.seek(4);
      return { p0, sig, sig4, back, gens, popAfter: L.world.population };
    })()`);
    record('摆放滑翔机（创造模式）', edit.p0 === 5, `人口 ${edit.p0}`);
    record('滑翔机 4 代后整体位移', edit.sig !== edit.sig4);
    record('时间回溯可回到第 0 代', edit.back === edit.sig, `历史 ${edit.gens} 代`);
    record('回溯后能回到第 4 代', edit.popAfter === 5);

    // D 图案 + 枪的正确性
    const gun = await page.evaluate(`(() => {
      const L = window.__life;
      L.world.clear(); L.commit();
      const size = L.place('gosperglidergun', 300, 300);
      const p0 = L.world.population;
      L.step(120);
      return { p0, p1: L.world.population, w: size.w, h: size.h };
    })()`);
    record('高斯帕机枪 120 代人口 +20', gun.p1 - gun.p0 === 20, `${gun.p0} → ${gun.p1}（图案 ${gun.w}×${gun.h}）`);

    // E RLE 导入
    const rle = await page.evaluate(`(async () => {
      document.getElementById('btn-rle').click();
      await new Promise(r => setTimeout(r, 80));
      const L = window.__life;
      L.world.clear(); L.commit();
      const ta = document.getElementById('rle-text');
      ta.value = 'x = 3, y = 3, rule = B3/S23\\nbo$2bo$3o!';
      document.getElementById('rle-import').click();
      await new Promise(r => setTimeout(r, 150));
      return { pop: L.world.population, modal: getComputedStyle(document.getElementById('modal')).display };
    })()`);
    record('RLE 文本导入滑翔机', rle.pop === 5, `人口 ${rle.pop}`);

    // F 存档
    const snap = await page.evaluate(`(async () => {
      const L = window.__life;
      L.history.seek(L.history.stats().maxGen);
      L.world.set(400, 400, 1); L.commit();
      const popBefore = L.world.population;
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 80));
      document.getElementById('btn-snapshots').click();
      await new Promise(r => setTimeout(r, 120));
      document.getElementById('snap-name').value = 'CDP 存档';
      document.getElementById('snap-save').click();
      await new Promise(r => setTimeout(r, 250));
      const cards = document.querySelectorAll('.snap-card').length;
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 80));
      L.world.clear(); L.commit();
      document.getElementById('btn-snapshots').click();
      await new Promise(r => setTimeout(r, 200));
      const card = document.querySelector('.snap-card [data-act=load]');
      if (card) card.click();
      await new Promise(r => setTimeout(r, 250));
      const popAfter = L.world.population;
      document.getElementById('modal-close').click();
      return { cards, popBefore, popAfter, mode: L.store.mode };
    })()`);
    record('保存快照并出现在列表', snap.cards >= 1, `${snap.cards} 张（${snap.mode}）`);
    record('载入快照恢复世界', snap.popAfter === snap.popBefore, `人口 ${snap.popAfter}/${snap.popBefore}`);

    // G 片段录制
    const clip = await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('pulsar', 320, 320);
      document.getElementById('btn-record').click();
      await new Promise(r => setTimeout(r, 60));
      L.step(40);
      await new Promise(r => setTimeout(r, 60));
      document.getElementById('btn-record').click();
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('btn-clips').click();
      await new Promise(r => setTimeout(r, 300));
      const cards = document.querySelectorAll('.card-grid .snap-card').length;
      const play = document.querySelector('.card-grid .snap-card [data-act=play]');
      if (play) play.click();
      await new Promise(r => setTimeout(r, 500));
      const cv = document.getElementById('clip-canvas');
      let ink = 0;
      if (cv) {
        const g = cv.getContext('2d');
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 90) ink++;
      }
      return { cards, ink, hasPlayer: !!document.getElementById('clip-play') };
    })()`);
    record('片段录制后进入片段库', clip.cards >= 1, `${clip.cards} 段`);
    record('片段播放器渲染出内容', clip.hasPlayer && clip.ink > 40, `亮像素 ${clip.ink}`);

    // H 时间轴
    const tl = await page.evaluate(`(async () => {
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 100));
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('pulsar', 320, 320);
      L.step(60);
      const st = L.history.stats();
      const genBefore = L.world.gen;
      const el = document.getElementById('timeline');
      el.value = String(st.minGen); el.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 220));
      const gmin = L.world.gen;
      el.value = String(st.maxGen); el.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 220));
      const gmax = L.world.gen;
      return { min: st.minGen, max: st.maxGen, genBefore, gmin, gmax };
    })()`);
    record('拖动时间轴回到起点', tl.genBefore > tl.min && tl.gmin === tl.min, `${tl.genBefore} → ${tl.gmin}（起点 ${tl.min}）`);
    record('拖动时间轴回到最新代', tl.gmax === tl.max, `${tl.gmax} / ${tl.max}`);

    // I 视图操作
    const view = await page.evaluate(`(async () => {
      const L = window.__life;
      const before = L.view.scale;
      const cv = document.getElementById('board');
      const r = cv.getBoundingClientRect();
      cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: r.width * 0.45, clientY: r.height * 0.5, bubbles: true, cancelable: true }));
      await new Promise(r2 => setTimeout(r2, 150));
      const zoomed = L.view.scale;
      const anchor = L.view.screenToWorld(r.width * 0.45, r.height * 0.5);
      return { before, zoomed, ax: anchor.x, ay: anchor.y };
    })()`);
    record('滚轮放大生效', view.zoomed > view.before * 1.2, `${view.before.toFixed(2)} → ${view.zoomed.toFixed(2)}`);

    // J 收尾：布置一个漂亮场景并截图
    await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('gosperglidergun', 500, 470);
      L.place('pulsar', 620, 520);
      L.place('pentadecathlon', 540, 560);
      L.place('rpentomino', 660, 420);
      L.place('glider', 470, 520);
      L.place('lwss', 700, 560);
      L.step(120);
      L.fit();
    })()`);
    await sleep(500);
    await page.screenshot('build/shot-main.png');

    await page.evaluate(`(() => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('gosperglidergun', 500, 470);
      L.step(120);
      L.fit();
    })()`);
    await sleep(400);
    await page.screenshot('build/shot-gun.png');

    const errs = page.logs.filter((l) => l.startsWith('[exception]') || l.includes('[console.error]'));
    record('运行期间无脚本异常', errs.length === 0, errs.slice(0, 3).join(' / ') || '干净');
  } catch (e) {
    record('检查过程未崩溃', false, e.message);
  } finally {
    page.close();
    browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length) process.exitCode = 1;
}

await main();
