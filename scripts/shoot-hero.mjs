// 生成 README 用的效果图：在真浏览器里摆一个好看的场景，跑一段，截图保存。
// 用法：node scripts/shoot-hero.mjs [输出路径] [DPR] [缩放] [中心x] [中心y] [代数] [模式 soup|scene]
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { launch } from './cdp.mjs';

const out = resolve(process.argv[2] || 'assets/screenshot.png');
const dpr = Number(process.argv[3] || 1.5);
const scale = Number(process.argv[4] || 5.6);
const cx = Number(process.argv[5] || 470);
const cy = Number(process.argv[6] || 480);
const gens = Number(process.argv[7] || 55);
const mode = process.argv[8] || 'soup';
const URL = 'https://for-xiaoyi.github.io/My-GameOfLife/';

mkdirSync(dirname(out), { recursive: true });

const browser = await launch({ port: 9421, width: 1600, height: 1000 });
const page = await browser.newPage(URL);

try {
  await page.waitFor('window.__life && window.__life.world', 30000);

  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: dpr,
    mobile: false,
  });
  await page.evaluate('window.dispatchEvent(new Event("resize")), true');

  const scene = `
    const L = window.__life;
    L.world.clear();
    const setCell = L.set ? (x, y, v) => L.set(x, y, v) : (x, y, v) => L.world.set(x, y, v);
    if (${JSON.stringify(mode)} === 'soup') {
      // 一片随机稠密初始态，演化若干代后会出现丰富的结构
      const w = 210, h = 124;
      const x0 = ${cx} - w / 2, y0 = ${cy} - h / 2;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (Math.random() < 0.33) setCell(x0 + x, y0 + y, 1);
        }
      }
    } else {
      L.place('gosperglidergun', 420, 360);
      L.place('pulsar', 620, 330);
      L.place('pentadecathlon', 640, 440);
      L.place('beacon', 330, 380);
      L.place('lwss', 360, 470);
      L.place('beehive', 400, 300);
      L.place('block', 680, 520);
    }
    L.step(${gens});
    const c = document.getElementById('board');
    L.view.setView({
      scale: ${scale},
      ox: c.clientWidth / 2 - ${cx} * ${scale},
      oy: c.clientHeight / 2 - ${cy} * ${scale},
    });
    true;
  `;

  await page.evaluate(`(() => { ${scene} })()`);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot(out);
  const pop = await page.evaluate('window.__life.world.population');
  console.log(`✔ ${out}（模式 ${mode}，人口 ${pop}，缩放 ${scale}，DPR ${dpr}）`);
} finally {
  await page.close();
  await browser.close();
}
