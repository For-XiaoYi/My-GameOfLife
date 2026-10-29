import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { launch, sleep } from './cdp.mjs';
const FILE = pathToFileURL(resolve('生命游戏.html')).href;
const browser = await launch({ port: 9519, width: 1280, height: 800 });
const page = await browser.newPage('about:blank');
try {
  await page.navigate(FILE);
  await page.waitFor('!!window.__life', 20000);
  await sleep(600);
  const data = await page.evaluate(`(() => {
    const L = window.__life;
    const dump = (id) => { const p = L.library.byId(id); return { id, name: p.name, w: p.w, h: p.h, period: p.period, move: p.move, cells: Array.from(p.cells) }; };
    return ['glider','lwss','pulsar','pentadecathlon','gosperglidergun','rpentomino'].map(dump);
  })()`);
  writeFileSync(resolve('promo/src/assets/patterns.json'), JSON.stringify(data));
  writeFileSync(resolve('promo/public/patterns.json'), JSON.stringify(data));
  console.log(data.map(p => `${p.id} ${p.w}x${p.h} period=${p.period}`).join(' | '));
} finally { await page.close(); await browser.close(); }
