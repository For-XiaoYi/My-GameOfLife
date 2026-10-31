// 录制宣传片用的真实界面操作片段：CDP screencast -> JPEG 序列 -> mp4。
// 用法：node scripts/record-clips.mjs [glider|snapshot|all]
// 前置：生命游戏.html 已构建，promo 依赖已安装。
import { execFileSync } from 'node:child_process';
import { globSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const FPS = 30;
const W = 1920;
const H = 1080;
const OUT = resolve('promo/public');
const TMP = resolve('build/clips');
const FILE = pathToFileURL(resolve('生命游戏.html')).href;

const ffmpegPath = (() => {
  const hits = globSync('promo/node_modules/.pnpm/@remotion+compositor-*/node_modules/@remotion/compositor-*/ffmpeg.exe');
  if (!hits.length) throw new Error('没找到 Remotion 自带的 ffmpeg');
  return resolve(hits[0]);
})();

mkdirSync(OUT, { recursive: true });

/** 注入假光标 + 点击涟漪，让录屏里的操作看得见 */
const CURSOR_JS = `(() => {
  if (window.__cur) return true;
  const c = document.createElement('div');
  c.style.cssText = [
    'position:fixed','left:0','top:0','width:30px','height:30px','margin:-15px 0 0 -15px',
    'border-radius:50%','border:2px solid rgba(255,255,255,0.95)',
    'background:radial-gradient(circle at 50% 50%, rgba(108,245,210,0.9), rgba(108,245,210,0.35))',
    'box-shadow:0 0 0 1px rgba(0,0,0,0.45), 0 8px 28px rgba(0,0,0,0.5)',
    'pointer-events:none','z-index:2147483647','opacity:0',
    'transition:opacity 220ms ease, background 120ms ease'
  ].join(';');
  document.body.appendChild(c);
  window.__cur = c;
  window.__moveCur = (x, y, show) => {
    c.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    if (show !== false) c.style.opacity = '1';
  };
  window.__moveCur(0, 0, false);
  window.__tweenCur = (x0, y0, x1, y1, ms) => new Promise((res) => {
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      window.__moveCur(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
      if (p < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  window.__pressCur = (down) => {
    c.style.background = down
      ? 'radial-gradient(circle at 50% 50%, rgba(255,255,255,1), rgba(108,245,210,0.95))'
      : 'radial-gradient(circle at 50% 50%, rgba(108,245,210,0.9), rgba(108,245,210,0.35))';
    c.style.width = c.style.height = down ? '22px' : '30px';
    c.style.margin = down ? '-11px 0 0 -11px' : '-15px 0 0 -15px';
  };
  window.__ripple = (x, y) => {
    const r = document.createElement('div');
    r.style.cssText = [
      'position:fixed','left:0','top:0','width:24px','height:24px','margin:-12px 0 0 -12px',
      'border-radius:50%','border:2px solid rgba(108,245,210,0.9)','pointer-events:none',
      'z-index:2147483646','transform:translate(' + x + 'px,' + y + 'px) scale(0.3)','opacity:0.9',
      'transition:transform 620ms cubic-bezier(.2,.7,.3,1), opacity 620ms ease'
    ].join(';');
    document.body.appendChild(r);
    requestAnimationFrame(() => {
      r.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(4.2)';
      r.style.opacity = '0';
    });
    setTimeout(() => r.remove(), 760);
  };
  return true;
})()`;

const rectOf = (sel) => `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
})()`;

async function moveTo(page, from, to, ms) {
  await page.evaluate(`window.__tweenCur(${from[0]}, ${from[1]}, ${to[0]}, ${to[1]}, ${ms})`);
  return to;
}

async function clickAt(page, pt) {
  await page.evaluate(`window.__pressCur(true)`);
  await page.evaluate(`window.__ripple(${pt[0]}, ${pt[1]})`);
  await sleep(110);
  await page.evaluate(`window.__pressCur(false)`);
  await sleep(140);
}

/** 指针事件：app 内部状态才会跟着动 */
const pointer = (type, x, y, id = 7) =>
  `document.getElementById('board').dispatchEvent(new PointerEvent('${type}',{clientX:${x},clientY:${y},pointerId:${id},pointerType:'mouse',isPrimary:true,bubbles:true,button:0}))`;

async function record(page, name, perform) {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const frames = [];
  let recording = true;
  const t0 = Date.now();
  page.on('Page.screencastFrame', (p) => {
    if (!recording) return;
    frames.push({ t: Date.now() - t0, data: p.data });
    page.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  });

  await page.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  try {
    await perform();
  } finally {
    await sleep(250);
    recording = false;
    await page.send('Page.stopScreencast');
  }
  if (!frames.length) throw new Error(`${name}: 没录到帧`);
  const dur = frames[frames.length - 1].t;

  let n = 0;
  let cursor = 0;
  for (let t = 0; t <= dur; t += 1000 / FPS) {
    while (cursor + 1 < frames.length && frames[cursor + 1].t <= t) cursor++;
    n++;
    writeFileSync(join(dir, `${String(n).padStart(5, '0')}.jpg`), Buffer.from(frames[cursor].data, 'base64'));
  }

  const out = join(OUT, `clip-${name}.mp4`);
  execFileSync(
    ffmpegPath,
    ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%05d.jpg'),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', out],
    { stdio: 'inherit' },
  );
  rmSync(dir, { recursive: true, force: true });
  console.log(`OK clip-${name}.mp4 ${(dur / 1000).toFixed(1)}s ${n} 帧`);
}

const browser = await launch({ port: 9561, width: W, height: H });
const page = await browser.newPage('about:blank');

try {
  await page.navigate(FILE);
  await page.waitFor('!!window.__life', 20000);
  await sleep(900);
  await page.evaluate(CURSOR_JS);

  const which = process.argv[2] || 'all';
  const want = (k) => which === 'all' || which === k;

  // 滑翔机：放大取景、慢速演化，看清它怎么走
  if (want('glider')) {
    await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit(); L.world.gen = 0;
      const c = document.getElementById('board');
      const s = 40;
      L.view.setView({ scale: s, ox: c.clientWidth / 2 - 500 * s, oy: c.clientHeight / 2 - 500 * s });
      const sl = document.getElementById('speed');
      sl.value = '62';
      sl.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      return document.getElementById('speed-label').textContent;
    })()`);

    await record(page, 'glider', async () => {
      const tile = await page.evaluate(rectOf('#palette .pat[data-id="glider"]'));
      const play = await page.evaluate(rectOf('#btn-play'));
      let pos = [1930, 980];
      await page.evaluate(`window.__moveCur(${pos[0]}, ${pos[1]})`);
      await sleep(150);

      if (tile) {
        pos = await moveTo(page, pos, [tile.x, tile.y], 520);
        await page.evaluate(`document.querySelector('#palette .pat[data-id="glider"]').click()`);
        await clickAt(page, [tile.x, tile.y]);
      }
      await sleep(180);

      const spot = [560, 377];
      pos = await moveTo(page, pos, spot, 460);
      await page.evaluate(pointer('pointermove', spot[0], spot[1]));
      await sleep(240);
      await page.evaluate(pointer('pointerdown', spot[0], spot[1]));
      await page.evaluate(pointer('pointerup', spot[0], spot[1]));
      await clickAt(page, spot);
      await sleep(220);
      await page.evaluate(pointer('pointermove', 1700, 930));

      if (play) {
        pos = await moveTo(page, pos, [play.x, play.y], 460);
        await sleep(140);
        await page.evaluate(`document.getElementById('btn-play').click()`);
        await clickAt(page, [play.x, play.y]);
      }
      await moveTo(page, pos, [1690, 900], 620);
      await sleep(6600);
    });
  }

  // 随机：点“随机”→ 确认 → 不限速 → 播放；呈现时用裁切，不整屏放
  if (want('random')) {
    await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.world.randomize(0.28); L.commit(); L.world.gen = 0;
      const c = document.getElementById('board');
      const s = 5.4;
      // 世界是 1024×576，中心是 512,288；之前按 512,512 取景，随机汤只露了一条边
      L.view.setView({
        scale: s,
        ox: c.clientWidth / 2 - (L.world.width / 2) * s,
        oy: c.clientHeight / 2 - (L.world.height / 2) * s,
      });
      await new Promise((r) => setTimeout(r, 700));
      return true;
    })()`);

    const marks = [];
    const mark = (name) => marks.push({ name, t: (Date.now() - markT0) / 1000 });
    const markT0 = Date.now();
    await record(page, 'random', async () => {
      let pos = [1720, 760];
      await page.evaluate(`window.__moveCur(${pos[0]}, ${pos[1]})`);
      await sleep(1200);

      const rnd = await page.evaluate(rectOf('#btn-random'));
      if (!rnd) throw new Error('没找到随机按钮');
      pos = await moveTo(page, pos, [rnd.x, rnd.y], 600);
      await page.evaluate(`document.getElementById('btn-random').click()`);
      mark('random');
      await clickAt(page, [rnd.x, rnd.y]);
      await sleep(500);

      const ok = await page.evaluate(rectOf('#confirm-ok'));
      if (!ok) throw new Error('没找到确认按钮');
      pos = await moveTo(page, pos, [ok.x, ok.y], 500);
      await page.evaluate(`document.getElementById('confirm-ok').click()`);
      mark('confirm');
      await clickAt(page, [ok.x, ok.y]);
      // 确认后弹窗背板有一个淡出/模糊过渡，等它清掉再动镜头
      await sleep(1800);

      const inf = await page.evaluate(rectOf('#btn-unlimited'));
      if (!inf) throw new Error('没找到不限速按钮');
      pos = await moveTo(page, pos, [inf.x, inf.y], 500);
      await page.evaluate(`document.getElementById('btn-unlimited').click()`);
      mark('unlimited');
      await clickAt(page, [inf.x, inf.y]);
      await sleep(500);

      const play = await page.evaluate(rectOf('#btn-play'));
      if (!play) throw new Error('没找到播放按钮');
      pos = await moveTo(page, pos, [play.x, play.y], 500);
      await page.evaluate(`document.getElementById('btn-play').click()`);
      mark('play');
      await clickAt(page, [play.x, play.y]);
      await moveTo(page, pos, [1700, 820], 700);
      await sleep(6500);
    });
    console.log('随机片段动作时刻（秒）：', JSON.stringify(marks));
  }

  // 快照：打开内容库，保存一帧
  if (want('snapshot')) {
    await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      let seed = 20261021;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      for (let y = 0; y < 124; y++) for (let x = 0; x < 220; x++) if (rnd() < 0.36) L.set(360 + x, 418 + y, 1);
      L.commit(); L.world.gen = 0; L.step(40);
      const c = document.getElementById('board');
      const s = 5.6;
      L.view.setView({ scale: s, ox: c.clientWidth / 2 - 470 * s, oy: c.clientHeight / 2 - 480 * s });
      await new Promise(r => setTimeout(r, 700));
      return true;
    })()`);

    await record(page, 'snapshot', async () => {
      const btn = await page.evaluate(rectOf('#btn-studio'));
      let pos = [1760, 1010];
      await page.evaluate(`window.__moveCur(${pos[0]}, ${pos[1]})`);
      if (btn) {
        pos = await moveTo(page, pos, [btn.x, btn.y], 800);
        await page.evaluate(`document.getElementById('btn-studio').click()`);
        await clickAt(page, [btn.x, btn.y]);
      }
      await sleep(600);
      const save = await page.evaluate(rectOf('#snap-save'));
      if (save) {
        pos = await moveTo(page, pos, [save.x, save.y], 700);
        await page.evaluate(`document.getElementById('snap-save').click()`);
        await clickAt(page, [save.x, save.y]);
      }
      await sleep(1400);
    });
  }
  console.log('片段输出到 promo/public/');
} finally {
  await page.close();
  await browser.close();
}
