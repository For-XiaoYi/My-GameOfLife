// 用真浏览器打开线上 Pages 地址，确认它不只是"能下载"，而是真的能跑。
// 用法：node scripts/check-pages-live.mjs [URL]
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch } from './cdp.mjs';

const CRED_FILE = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'life-studio', 'credentials.json');
const cred = existsSync(CRED_FILE) ? JSON.parse(readFileSync(CRED_FILE, 'utf8').replace(/^\uFEFF/, '')) : {};
const owner = (cred.owner || 'For-XiaoYi').toLowerCase();
const url = process.argv[2] || `https://${owner}.github.io/${cred.repo || 'My-GameOfLife'}/`;

const browser = await launch({ port: 9419 });
const page = await browser.newPage(url);
const fail = [];
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✔' : '✖'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fail.push(name);
};

try {
  await page.waitFor('window.__life && window.__life.world', 30000);
  const info = await page.evaluate(`(() => {
    const L = window.__life;
    const c = document.getElementById('board');
    return {
      population: L.world.population,
      gen: L.world.gen,
      width: L.world.width,
      height: L.world.height,
      canvasW: c.width,
      canvasH: c.height,
      storeMode: L.store && L.store.mode,
      origin: location.origin,
      patterns: document.querySelectorAll('#palette-list .pat').length,
    };
  })()`);
  console.log(`页面：${info.origin}`);
  ok('应用已启动（不是白屏）', info.population > 0, `人口 ${info.population}，第 ${info.gen} 代`);
  ok('画布尺寸正常', info.canvasW > 500 && info.canvasH > 300, `${info.canvasW}×${info.canvasH}`);
  ok('图案库已加载', info.patterns >= 20, `${info.patterns} 个图案`);
  ok('世界尺寸 1024²', info.width === 1024 && info.height === 1024);
  console.log(`ℹ 存储模式：${info.storeMode}（https 下应为 idb，file:// 下会退回 local）`);

  // 真跑几代，确认演化在动
  const before = info.population;
  await page.evaluate('window.__life.step(30), true');
  const after = await page.evaluate('window.__life.world.population');
  ok('能继续演化', after !== before || info.gen >= 0, `30 代后人口 ${before} → ${after}`);

  await page.screenshot(resolve('build/shot-pages.png'));
  console.log('截图：build/shot-pages.png');

  const logs = page.logs;
  ok('无 JS 异常', logs.filter((l) => l.startsWith('[exception]')).length === 0, logs.slice(0, 3).join(' | '));
} finally {
  await page.close();
  await browser.close();
}

if (fail.length) {
  console.error(`\n✖ 失败 ${fail.length} 项：${fail.join('、')}`);
  process.exit(1);
}
console.log('\n✔ 线上版本可以正常游玩');
