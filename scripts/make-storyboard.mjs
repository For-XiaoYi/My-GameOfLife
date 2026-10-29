import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const MARKS = [
  [80, '00:03 · 开场标题'],
  [200, '00:07 · 规则：孤单而死'],
  [320, '00:11 · 规则：继续存活'],
  [430, '00:14 · 规则：拥挤而死'],
  [560, '00:19 · 涌现：给个形状就活'],
  [660, '00:22 · 枪在造滑翔机'],
  [780, '00:26 · 一百万格的画布'],
  [850, '00:28 · 图案库与预览'],
  [925, '00:31 · 图案库可以自己改'],
  [1000, '00:33 · 时刻与时段'],
  [1070, '00:36 · 帮助面板'],
  [1200, '00:40 · 时间回溯'],
];

const cards = MARKS.map(
  ([t, label]) => `
    <figure>
      <img src="./sb-${t}.png" />
      <figcaption>${label}</figcaption>
    </figure>`,
).join('');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; width: 1920px; height: 1080px; padding: 26px 30px;
    background: #05080c; color: #dbe9ee;
    font-family: "PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;
    display: flex; flex-direction: column; gap: 14px;
  }
  header { display: flex; align-items: baseline; justify-content: space-between; }
  h1 { font-size: 26px; margin: 0; letter-spacing: 1px; }
  .meta { font-size: 15px; color: #7b939e; }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  figure { margin: 0; display: flex; flex-direction: column; gap: 7px; }
  img { width: 100%; border-radius: 8px; border: 1px solid rgba(120,200,220,.16); display: block; }
  figcaption { font-size: 14px; color: #7b939e; letter-spacing: .3px; }
  .strip { display: flex; gap: 8px; align-items: center; font-size: 13px; color: #56707c; }
  .bar { height: 4px; flex: 1; border-radius: 99px; background: linear-gradient(to right, #2fe3c4 0%, #2fe3c4 62%, rgba(255,255,255,.08) 62%); }
</style></head>
<body>
  <header>
    <h1>生命游戏 · 宣传片分镜</h1>
    <div class="meta">1920×1080 · 30fps · 51.5 秒 · 12 个关键时刻</div>
  </header>
  <div class="grid">${cards}</div>
  <div class="strip"><span>0s</span><div class="bar"></div><span>51.5s</span></div>
</body></html>`;

const out = resolve('build/sb/storyboard.html');
writeFileSync(out, html);

const browser = await launch({ port: 9531, width: 1920, height: 1080 });
const page = await browser.newPage('about:blank');
try {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.navigate(pathToFileURL(out).href);
  await sleep(1200);
  await page.screenshot(resolve('assets/promo-storyboard.png'));
  console.log('✔ assets/promo-storyboard.png');
} finally {
  await page.close();
  await browser.close();
}
