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
      tool: (document.querySelector('#toolbar .tool.active') || {}).dataset?.tool,
    }))()`);
    record('图案库渲染出全部预设', boot.pats === 20, `${boot.pats} 个`);
    record('画布已按视口尺寸初始化', boot.canvas[0] > 800 && boot.canvas[1] > 500, boot.canvas.join('×'));
    record('启动即有示例图案', Number(boot.pop.replace(/,/g, '')) > 50, `人口 ${boot.pop}`);
    record('默认工具是平移', boot.tool === 'pan', boot.tool);

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
      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 150));
      document.getElementById('st-rle').click();
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
      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 150));
      document.getElementById('st-snap').click();
      await new Promise(r => setTimeout(r, 120));
      document.getElementById('snap-name').value = 'CDP 存档';
      document.getElementById('snap-save').click();
      // idb 是异步落盘，等它真的写进去再看列表
      for (let i = 0; i < 40; i++) {
        if ((await L.store.listSnapshots()).length) break;
        await new Promise(r => setTimeout(r, 50));
      }
      await new Promise(r => setTimeout(r, 200));
      const cards = document.querySelectorAll('.snap-card').length;
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 80));
      L.world.clear(); L.commit();
      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 150));
      document.getElementById('st-snap').click();
      await new Promise(r => setTimeout(r, 200));
      const card = document.querySelector('.snap-card [data-act=load]');
      if (card) card.click();
      await new Promise(r => setTimeout(r, 250));
      // 载入要过一道游戏内确认
      document.getElementById('confirm-ok').click();
      await new Promise(r => setTimeout(r, 300));
      const popAfter = L.world.population;
      const modalOpen = !document.getElementById('modal').classList.contains('hidden');
      if (modalOpen) document.getElementById('modal-close').click();
      return { cards, popBefore, popAfter, mode: L.store.mode, modalOpen };
    })()`);
    record('保存快照并出现在列表', snap.cards >= 1, `${snap.cards} 张（${snap.mode}）`);
    record('载入快照恢复世界', snap.popAfter === snap.popBefore, `人口 ${snap.popAfter}/${snap.popBefore}`);
    record('载入后自动关闭内容库', snap.modalOpen === false, `modalOpen=${snap.modalOpen}`);

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
      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 150));
      document.getElementById('st-clips').click();
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

    // K 框选存为自定义图案
    const preset = await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('glider', 200, 200);
      L.setSelection(194, 194, 214, 214);
      await new Promise(r => setTimeout(r, 80));
      const bar = document.getElementById('sel-bar');
      const barInfo = document.getElementById('sel-info').textContent;
      const barShown = !bar.classList.contains('hidden');
      document.getElementById('btn-save-preset').click();
      await new Promise(r => setTimeout(r, 120));
      const nameInput = document.querySelector('.preset-form .text-input');
      const hadModal = !!nameInput;
      const catSelect = document.querySelector('.preset-form select');
      const defaultCat = catSelect ? { value: catSelect.value, text: catSelect.selectedOptions[0]?.textContent } : null;
      if (nameInput) nameInput.value = '我的滑翔机';
      document.querySelector('.modal-actions .primary').click();
      await new Promise(r => setTimeout(r, 250));
      const ids = [...document.querySelectorAll('#palette .pat')].map(b => b.dataset.id);
      const customId = ids.find(id => id.startsWith('c-'));
      const cats = L.library.categories.map(c => c.name);
      const customCat = L.library.categories.find(c => c.name === '自定义');
      const customInCat = customId ? L.library.byId(customId)?.catId : null;
      const modalClosed = getComputedStyle(document.getElementById('modal')).display === 'none';
      let placed = null;
      if (customId) {
        L.world.clear(); L.commit();
        L.place(customId, 300, 300);
        placed = L.world.population;
      }
      // 再打开一次弹窗：已经有「自定义」分组时应该直接默认它，而不是再建一个
      L.setSelection(294, 294, 314, 314);
      await new Promise(r => setTimeout(r, 80));
      document.getElementById('btn-save-preset').click();
      await new Promise(r => setTimeout(r, 140));
      const sel2 = document.querySelector('.preset-form select');
      const second = sel2 ? { value: sel2.value, text: sel2.selectedOptions[0]?.textContent, opts: sel2.options.length } : null;
      const cancelBtn = document.querySelector('.modal-actions .btn:not(.primary)');
      if (cancelBtn) cancelBtn.click();
      await new Promise(r => setTimeout(r, 120));
      return { barShown, barInfo, hadModal, defaultCat, second, cats, customCatId: customCat?.id ?? '',
               customInCat, count: ids.length, customId, modalClosed, placed,
               tool: document.querySelector('#toolbar .tool.active')?.dataset.tool };
    })()`);
    record('框选后出现操作条', preset.barShown && preset.barInfo.includes('×'), preset.barInfo);
    record('存为图案的弹窗能打开', preset.hadModal === true);
    record('默认分类是「自定义」（没有就提示自动新建）',
      !!preset.defaultCat && (preset.defaultCat.value === '' ||
        preset.customCatId === preset.defaultCat.value),
      `${preset.defaultCat?.text ?? '无下拉'}（value "${preset.defaultCat?.value ?? ''}"）`);
    record('保存后图案库多出自定义图案', preset.count === 21 && !!preset.customId, `${preset.count} 个`);
    record('保存的图案进了「自定义」分组',
      preset.cats.includes('自定义') && preset.customInCat === preset.customCatId,
      `${preset.cats.length} 个分类 · ${preset.customInCat}`);
    record('保存后自动切到贴图工具', preset.tool === 'stamp', String(preset.tool));
    record('已有「自定义」分组时直接默认它',
      !!preset.second && preset.second.value === preset.customCatId && preset.second.text === '自定义',
      `${preset.second?.text ?? '无'} · ${preset.second?.opts ?? 0} 个选项`);
    record('自定义图案能正常摆放', preset.placed === 5 && preset.modalClosed, `人口 ${preset.placed}`);

    // L 图案库管理：改名 / 收进仓库（侧栏编辑模式）
    const libMan = await page.evaluate(`(async () => {
      const L = window.__life;
      const toolBefore = L.tool;
      const patBefore = L.patternId;
      document.getElementById('btn-lib-manage').click();
      await new Promise(r => setTimeout(r, 150));
      const inputs = [...document.querySelectorAll('#palette-list .edit-cat-head .text-input')];
      const firstName = inputs[0];
      firstName.value = '静止类';
      firstName.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 150));
      // 编辑模式下分类名直接就是列表里可见的文字
      const titles = [...document.querySelectorAll('#palette-list .edit-cat-head .text-input')].map(t => t.value);
      // 收进仓库一个内置图案（按名字精确匹配，别误伤自定义的「我的滑翔机」）
      const rows = [...document.querySelectorAll('#palette-list .edit-tile')];
      const blockRow = rows.find(r => r.querySelector('.tile-name')?.textContent === '方块');
      blockRow.querySelector('.tile-stash').click();
      await new Promise(r => setTimeout(r, 200));
      const mode = L.paletteMode;
      return { titles, renamed: titles.includes('静止类'), hidBlock: !!blockRow, mode,
        toolBefore, patBefore, toolAfter: L.tool, patAfter: L.patternId };
    })()`);
    record('分类可以改名', libMan.renamed, libMan.titles.slice(0, 3).join(' / '));
    record('图案可以收进仓库', libMan.hidBlock, `编辑模式 ${libMan.mode}`);
    record('进编辑模式不改变工具和选中图案',
      libMan.toolBefore === libMan.toolAfter && libMan.patBefore === libMan.patAfter,
      `工具 ${libMan.toolBefore}→${libMan.toolAfter} · patternId "${libMan.patBefore}"`);
    const hiddenCount = await page.evaluate(`(() => {
      const L = window.__life;
      L.setPaletteMode('browse');
      return { pats: document.querySelectorAll('#palette .pat').length, hidden: L.library.hidden.length };
    })()`);
    record('收进仓库后不在图案库里', hiddenCount.pats === 20 && hiddenCount.hidden === 1,
      `${hiddenCount.pats} 个 · 仓库 ${hiddenCount.hidden}`);

    // M 刷新后自定义图案与改名都还在
    // 先等存储落盘（idb 是异步的，直接刷新会读到旧状态）
    await page.evaluate(`(async () => {
      for (let i = 0; i < 40; i++) {
        const n = await window.__life.store.listCustomPatterns();
        if (n.length >= 1) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    })()`);
    await sleep(120);
    await page.navigate(FILE);
    await page.waitFor('!!window.__life', 20000);
    await sleep(600);
    const after = await page.evaluate(`(() => {
      const L = window.__life;
      return {
        custom: L.library.visible.filter(p => p.custom).length,
        customTotal: L.library.customs.size,
        hidden: L.library.hidden.map(p => p.name),
        cats: L.library.categories.map(c => c.name),
        pats: document.querySelectorAll('#palette .pat').length,
      };
    })()`);
    record('刷新后自定义图案仍在', after.custom === 1 && after.customTotal === 1, `${after.customTotal} 个 / 共 ${after.pats}`);
    record('刷新后分类改名仍生效', after.cats.includes('静止类'), after.cats.join(','));
    record('刷新后隐藏状态仍生效', after.hidden.includes('方块'), after.hidden.join(',') || '无');

    // N 撤销 / 重做
    const und = await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      const pop0 = L.world.population;
      L.place('glider', 400, 400);
      const pop1 = L.world.population;
      L.place('block', 500, 500);
      const pop2 = L.world.population;
      document.getElementById('btn-undo').click();
      const pop3 = L.world.population;
      document.getElementById('btn-undo').click();
      const pop4 = L.world.population;
      document.getElementById('btn-redo').click();
      const pop5 = L.world.population;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      const pop6 = L.world.population;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
      const pop7 = L.world.population;
      return { pop0, pop1, pop2, pop3, pop4, pop5, pop6, pop7 };
    })()`);
    record('撤销一步回到上一个状态', und.pop3 === und.pop1, `${und.pop2} → ${und.pop3}`);
    record('连续撤销可以回到空世界', und.pop4 === und.pop0, `${und.pop4}`);
    record('重做恢复被撤销的图案', und.pop5 === und.pop1, `${und.pop5}`);
    record('Ctrl+Z 撤销', und.pop6 === und.pop0, `${und.pop6}`);
    record('Ctrl+Shift+Z 重做', und.pop7 === und.pop1, `${und.pop7}`);

    // O 分享：PNG / 链接 / 全屏
    await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('gosperglidergun', 500, 470);
      L.step(30);
    })()`);
    await sleep(200);
    const shareInfo = await page.evaluate(`(() => {
      const L = window.__life;
      L.openShare();
      return { pop: L.world.population, gen: L.world.gen, link: L.shareLink() };
    })()`);
    await sleep(250);
    const shareUi = await page.evaluate(`(() => {
      const b = document.getElementById('modal-body');
      return {
        title: document.getElementById('modal-title').textContent,
        buttons: [...b.querySelectorAll('.btn-row .btn')].map(x => x.textContent),
      };
    })()`);
    record('分享面板打开', shareUi.title.includes('分享') && shareUi.buttons.length === 3, shareUi.buttons.join(' / '));
    record('分享链接长度合理', !!shareInfo.link && shareInfo.link.length < 4000, `${shareInfo.link ? shareInfo.link.length : 0} 字符`);
    await page.evaluate(`(() => document.getElementById('modal-close').click())`);

    // 打开链接应该还原同样的世界
    await page.navigate('about:blank');
    await sleep(200);
    await page.navigate(shareInfo.link);
    await page.waitFor('!!window.__life', 20000);
    await sleep(600);
    const shared = await page.evaluate(`(() => {
      const L = window.__life;
      return { pop: L.world.population, gen: L.world.gen, w: L.world.width, pats: document.querySelectorAll('#palette .pat').length };
    })()`);
    record('分享链接能还原世界', shared.pop === shareInfo.pop, `人口 ${shareInfo.pop} → ${shared.pop}`);
    record('分享链接保留代数', shared.gen === shareInfo.gen && shared.w === 1024, `第 ${shared.gen} 代 · ${shared.w}²`);
    record('分享模式不覆盖自动存档', shared.pats === 20, `${shared.pats} 个图案`);

    // P 拖动选区里的内容
    const moved = await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('glider', 200, 200);
      const pop0 = L.world.population;
      L.setSelection(194, 194, 214, 214);
      document.querySelector('#toolbar .tool[data-tool="select"]').click();
      const cv = document.getElementById('board');
      const r = cv.getBoundingClientRect();
      const fire = (type, wx, wy) => {
        const s = L.view.worldToScreen(wx, wy);
        cv.dispatchEvent(new PointerEvent(type, {
          clientX: r.left + s.x, clientY: r.top + s.y,
          pointerId: 7, pointerType: 'mouse', isPrimary: true,
          bubbles: true, cancelable: true, buttons: 1, button: 0,
        }));
      };
      fire('pointerdown', 200, 200);
      await new Promise((res) => setTimeout(res, 60));
      const cut = L.world.population;
      fire('pointermove', 260, 200);
      await new Promise((res) => setTimeout(res, 60));
      fire('pointerup', 260, 200);
      await new Promise((res) => setTimeout(res, 120));
      const pop1 = L.world.population;
      const sel = L.selection;
      let alive = 0;
      for (let y = 194; y <= 214; y++) for (let x = 254; x <= 274; x++) if (L.world.get(x, y)) alive++;
      let leftBehind = 0;
      for (let y = 194; y <= 214; y++) for (let x = 194; x <= 214; x++) if (L.world.get(x, y)) leftBehind++;
      return { pop0, cut, pop1, sel, alive, leftBehind, undo: L.undoDepth };
    })()`);
    record('拖走时选区内容被拿起', moved.cut === 0, `拿起后人口 ${moved.cut}`);
    record('松手后内容落到新位置', moved.pop1 === moved.pop0 && moved.alive === 5, `人口 ${moved.pop1}，新位置 ${moved.alive} 格`);
    record('原位置已被清空', moved.leftBehind === 0);
    record('选区框跟着走', !!moved.sel && moved.sel[0] && moved.sel[0].x0 === 254, JSON.stringify(moved.sel));
    record('移动可以撤销', moved.undo >= 1, `撤销栈 ${moved.undo}`);

    // Q 选择框：Ctrl 加选 / Esc 退出 / Del 删除 / 撤销
    const multi = await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('block', 200, 200);
      L.place('block', 260, 200);
      L.setTool('select');
      L.setSelection(196, 196, 210, 210);
      L.addSelection(256, 196, 270, 210);
      const info = document.querySelector('#sel-info').textContent;
      const one = L.selection.length;
      const pop = L.world.population;
      L.deleteSelection();
      const afterDel = L.world.population;
      L.undo();
      const afterUndo = L.world.population;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      return {
        one, info, pop, afterDel, afterUndo,
        selAfterEsc: L.selection.length,
        toolAfterEsc: L.tool,
        barHidden: document.getElementById('sel-bar').classList.contains('hidden'),
      };
    })()`);
    record('Ctrl 加选得到两个框', multi.one === 2 && multi.info.includes('2 块'), multi.info);
    record('Del 删除选区内容', multi.afterDel === 0 && multi.pop > 0, `人口 ${multi.pop} → ${multi.afterDel}`);
    record('删除可以撤销', multi.afterUndo === multi.pop, `撤销后 ${multi.afterUndo}`);
    record('Esc 退出选择框', multi.selAfterEsc === 0 && multi.toolAfterEsc !== 'select' && multi.barHidden, `工具 ${multi.toolAfterEsc}`);

    // R 笔刷大小：滚轮默认缩放，Alt+滚轮调大小
    const brush = await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.setTool('erase');
      L.setBrushSize(1);
      const cv = document.getElementById('board');
      const r = cv.getBoundingClientRect();
      const wheel = (dy, mods) => cv.dispatchEvent(new WheelEvent('wheel', {
        deltaY: dy,
        ctrlKey: !!(mods && mods.ctrl),
        altKey: !!(mods && mods.alt),
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        bubbles: true, cancelable: true,
      }));
      const s0 = L.view.scale;
      // 橡皮下直接滚轮：应该缩放，不该改笔刷
      wheel(-120, null);
      const sizeAfterPlain = L.brushSize;
      const s1 = L.view.scale;
      // Alt+滚轮：改笔刷，不缩放
      wheel(-120, { alt: true });
      const size = L.brushSize;
      const s2 = L.view.scale;
      const hint = document.getElementById('hint').textContent;
      // 用大号橡皮拖一把，确认一次能擦掉一片
      L.setTool('brush');
      L.setBrushSize(1);
      L.view.setView({
        scale: 8,
        ox: cv.clientWidth / 2 - 300 * 8,
        oy: cv.clientHeight / 2 - 300 * 8,
      });
      const fire = (type, wx, wy) => {
        const p = L.view.worldToScreen(wx, wy);
        cv.dispatchEvent(new PointerEvent(type, {
          clientX: r.left + p.x, clientY: r.top + p.y,
          pointerId: 9, pointerType: 'mouse', isPrimary: true,
          bubbles: true, cancelable: true, buttons: 1, button: 0,
        }));
      };
      fire('pointerdown', 300, 300);
      fire('pointermove', 316, 300);
      // 涂抹过程中笔刷范围框应该还在
      const brushDuringDrag = !!L.overlay.brush && L.overlay.brush.size === L.brushSize;
      const cursorDuring = document.getElementById('board').style.cursor;
      fire('pointerup', 316, 300);
      await new Promise((res) => setTimeout(res, 100));
      const painted = L.world.population;
      L.setTool('erase');
      L.setBrushSize(9);
      fire('pointerdown', 308, 300);
      fire('pointerup', 308, 300);
      await new Promise((res) => setTimeout(res, 100));
      return { s0, sizeAfterPlain, s1, size, s2, hint, painted, cursorDuring, brushDuringDrag, afterErase: L.world.population };
    })()`);
    record('橡皮下直接滚轮是缩放', brush.s1 > brush.s0 && brush.sizeAfterPlain === 1,
      `缩放 ${brush.s0.toFixed(2)} → ${brush.s1.toFixed(2)}，笔刷 ${brush.sizeAfterPlain}`);
    record('涂抹过程中笔刷框不消失', brush.brushDuringDrag === true, `overlay.brush=${brush.brushDuringDrag}`);
    record('Alt+滚轮调整橡皮大小', brush.size > 1, `大小 1 → ${brush.size}`);
    record('Alt+滚轮调大小时不缩放', brush.s1 === brush.s2, `缩放 ${brush.s1.toFixed(3)}`);
    record('大号橡皮一次擦掉一片', brush.afterErase < brush.painted, `人口 ${brush.painted} → ${brush.afterErase}`);
    record('提示文案跟随笔刷大小', brush.hint.includes('×'), brush.hint.replace(/\\s+/g, ' ').trim().slice(0, 40));

    // S 真实指针：Ctrl 拖拽加选、删除按钮、平移工具拖动画布
    const real = await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('block', 300, 300);
      const cv = document.getElementById('board');
      const r = cv.getBoundingClientRect();
      L.setTool('select');
      L.clearSelection();
      const fire = (type, wx, wy, mods) => {
        const p = L.view.worldToScreen(wx, wy);
        cv.dispatchEvent(new PointerEvent(type, {
          clientX: r.left + p.x, clientY: r.top + p.y,
          pointerId: 11, pointerType: 'mouse', isPrimary: true,
          bubbles: true, cancelable: true, buttons: 1, button: 0,
          ctrlKey: !!(mods && mods.ctrl),
        }));
      };
      fire('pointerdown', 290, 290, null);
      fire('pointermove', 310, 310, null);
      fire('pointerup', 310, 310, null);
      await new Promise((res) => setTimeout(res, 60));
      const first = L.selection.length;
      fire('pointerdown', 340, 340, { ctrl: true });
      fire('pointermove', 360, 360, { ctrl: true });
      fire('pointerup', 360, 360, { ctrl: true });
      await new Promise((res) => setTimeout(res, 60));
      const both = L.selection.length;

      // 删除按钮
      L.addSelection(296, 296, 306, 306);
      document.getElementById('btn-del-selection').click();
      await new Promise((res) => setTimeout(res, 60));
      const afterBtn = L.world.population;

      // 平移工具：拖动画布应该改变视口偏移
      L.clearSelection();
      L.setTool('pan');
      const ox0 = L.view.ox;
      const pan = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, {
        clientX: r.left + x, clientY: r.top + y, pointerId: 12, pointerType: 'mouse',
        isPrimary: true, bubbles: true, cancelable: true, buttons: 1, button: 0,
      }));
      pan('pointerdown', 700, 400);
      pan('pointermove', 620, 400);
      pan('pointerup', 620, 400);
      await new Promise((res) => setTimeout(res, 60));
      return { first, both, afterBtn, moved: Math.abs(L.view.ox - ox0) };
    })()`);
    record('Ctrl 拖拽加选（真实指针）', real.first === 1 && real.both === 2, `${real.first} → ${real.both} 块`);
    record('选择条上的删除按钮生效', real.afterBtn === 0, `人口 ${real.afterBtn}`);
    record('平移工具拖拽画布', real.moved > 20, `视口偏移 ${real.moved.toFixed(1)}px`);

    // T 选择框：拖边框改大小、Alt 拖框内只挪框、都能撤销
    const sel2 = await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('block', 300, 300);
      L.setTool('select');
      L.setSelection(296, 296, 306, 306);
      const cv = document.getElementById('board');
      const r = cv.getBoundingClientRect();
      const fire = (type, wx, wy, mods) => {
        const p = L.view.worldToScreen(wx, wy);
        cv.dispatchEvent(new PointerEvent(type, {
          clientX: r.left + p.x, clientY: r.top + p.y,
          pointerId: 21, pointerType: 'mouse', isPrimary: true,
          bubbles: true, cancelable: true, buttons: 1, button: 0,
          altKey: !!(mods && mods.alt),
        }));
        return p;
      };
      // 光标形态：边上应是 resize，框内应是 move
      const onEdge = fire('pointermove', 307, 301, null);
      const edgeCursor = cv.style.cursor;
      fire('pointermove', 300, 300, null);
      const innerCursor = cv.style.cursor;

      // 拖右边框：x1 306 → 320
      const popBefore = L.world.population;
      fire('pointerdown', 307, 301, null);
      fire('pointermove', 320, 301, null);
      fire('pointerup', 320, 301, null);
      await new Promise((res) => setTimeout(res, 60));
      const afterResize = L.selection[0];
      const popAfterResize = L.world.population;

      // Alt 拖框内：只挪框，细胞不动
      fire('pointerdown', 300, 300, { alt: true });
      fire('pointermove', 310, 310, { alt: true });
      fire('pointerup', 310, 310, { alt: true });
      await new Promise((res) => setTimeout(res, 60));
      const afterMove = L.selection[0];
      const popAfterMove = L.world.population;

      // 撤销两次：先回到没挪，再回到没改大小
      L.undo(); L.undo();
      await new Promise((res) => setTimeout(res, 60));
      const afterUndo = L.selection[0];
      return {
        edgeCursor, innerCursor, popBefore, popAfterResize,
        resizedRight: afterResize.x1, afterMove, popAfterMove, afterUndo,
      };
    })()`);
    record('选择框边上光标是缩放', sel2.edgeCursor.includes('resize'), sel2.edgeCursor || '(空)');
    record('选择框内部光标是移动', sel2.innerCursor === 'move', sel2.innerCursor || '(空)');
    record('拖边框改大小', Math.abs(sel2.resizedRight - 319) <= 1 && sel2.popAfterResize === sel2.popBefore,
      `x1 306 → ${sel2.resizedRight}，人口不变 ${sel2.popAfterResize}`);
    record('Alt 拖框内只挪框', sel2.afterMove.x0 > 296 && sel2.popAfterMove === sel2.popBefore,
      `x0 ${296} → ${sel2.afterMove.x0}，人口 ${sel2.popAfterMove}`);
    record('改框大小/挪框可撤销', sel2.afterUndo.x0 === 296 && sel2.afterUndo.x1 === 306,
      `撤销后 ${sel2.afterUndo.x0}..${sel2.afterUndo.x1}`);

    // U 空格播放/暂停、方向键单步
    const keys = await page.evaluate(`(async () => {
      const L = window.__life;
      const space = () => window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Space', key: ' ', keyCode: 32, bubbles: true, cancelable: true,
      }));
      space();
      await new Promise((res) => setTimeout(res, 60));
      const playing1 = L.playing;
      space();
      await new Promise((res) => setTimeout(res, 60));
      const playing2 = L.playing;
      const g0 = L.world.gen;
      const arrow = (key) => window.dispatchEvent(new KeyboardEvent('keydown', {
        key, code: key === 'ArrowRight' ? 'ArrowRight' : 'ArrowLeft', bubbles: true, cancelable: true,
      }));
      arrow('ArrowRight');
      await new Promise((res) => setTimeout(res, 120));
      const g1 = L.world.gen;
      arrow('ArrowLeft');
      await new Promise((res) => setTimeout(res, 120));
      const g2 = L.world.gen;
      return { playing1, playing2, g0, g1, g2 };
    })()`);
    record('空格播放/暂停', keys.playing1 === true && keys.playing2 === false,
      `${keys.playing1} → ${keys.playing2}`);
    record('方向键前后单步', keys.g1 === keys.g0 + 1 && keys.g2 === keys.g0,
      `${keys.g0} → ${keys.g1} → ${keys.g2}`);

    // V 图案库侧栏：编辑模式、拖拽换分类/排序、仓库、收起后的小图标
    const side = await page.evaluate(`(async () => {
      const L = window.__life;
      const pal = document.getElementById('palette');
      const hiddenBefore = L.library.hidden.length;
      L.setPaletteMode('edit');
      await new Promise((r) => setTimeout(r, 260));
      const editWidth = pal.offsetWidth;
      const cats = document.querySelectorAll('#palette-list .edit-cat').length;
      const patRows = document.querySelectorAll('#palette-list .edit-tile').length;
      // 图案换分类
      L.movePattern('glider', 'gun');
      const gliderCat = L.library.byId('glider').catId;
      const gunCount = L.library.patternsIn('gun').length;
      // 分类拖拽排序
      L.moveCategoryBefore('gun', 'still');
      const firstCat = L.library.categories[0].id;
      // 收进仓库
      L.stashPattern('pulsar');
      const hiddenLen = L.library.hidden.length;
      const stashRows = document.querySelectorAll('#palette-list .stash-sec .edit-tile').length;
      // 从仓库取回
      L.unstashPattern('pulsar');
      const backCat = L.library.byId('pulsar').catId;
      // 还原顺序，免得影响后面的截图
      L.movePattern('glider', 'ship');
      L.moveCategoryBefore('still', 'gun');
      L.setPaletteMode('browse');
      await new Promise((r) => setTimeout(r, 260));
      const palCount = document.querySelectorAll('#palette .pat').length;
      return { editWidth, cats, patRows, gliderCat, gunCount, firstCat, hiddenBefore,
        hiddenLen, stashRows, backCat, palCount };
    })()`);
    record('点编辑按钮侧栏变编辑模式', side.editWidth > 300 && side.cats >= 5,
      `宽 ${side.editWidth}px · ${side.cats} 个分类 · ${side.patRows} 行图案`);
    record('图案能换分类', side.gliderCat === 'gun' && side.gunCount === 2,
      `滑翔机 → ${side.gliderCat}（该分类 ${side.gunCount} 个）`);
    record('分类能拖拽排序', side.firstCat === 'gun', `第一个分类 ${side.firstCat}`);
    record('图案能收进仓库', side.hiddenLen === side.hiddenBefore + 1 && side.stashRows === side.hiddenLen,
      `仓库 ${side.stashRows} 行（原 ${side.hiddenBefore}）`);
    record('仓库里的图案能取回', side.backCat === 'oscillator', `回到 ${side.backCat}`);

    // 指针拖拽：把「滑翔机」拖进「枪」分类（真实鼠标输入）
    const dndPos = await page.evaluate(`(async () => {
      const L = window.__life;
      L.setPaletteMode('edit');
      await new Promise((r) => setTimeout(r, 340));
      const rows = [...document.querySelectorAll('#palette-list .edit-tile')];
      const glider = rows.find((r) => r.querySelector('.tile-name')?.textContent === '滑翔机');
      const heads = [...document.querySelectorAll('#palette-list .edit-cat-head')];
      const gunHead = heads.find((h) => h.querySelector('.text-input')?.value === '枪');
      const grid = gunHead.parentElement.querySelector('.edit-grid').getBoundingClientRect();
      const r0 = glider.getBoundingClientRect();
      return {
        from: { x: r0.x + r0.width / 2, y: r0.y + r0.height / 2 },
        to: { x: grid.left + 10, y: grid.top + 10 },
      };
    })()`);
    const mouse = (type, p, buttons) => page.send('Input.dispatchMouseEvent', {
      type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', buttons,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
    await mouse('mouseMoved', dndPos.from, 0);
    await mouse('mousePressed', dndPos.from, 1);
    await mouse('mouseMoved', { x: dndPos.from.x + 8, y: dndPos.from.y + 8 }, 1);
    await mouse('mouseMoved', { x: dndPos.from.x + 40, y: dndPos.from.y + 30 }, 1);
    await sleep(120);
    const dndMid = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('#palette-list .edit-tile')];
      const glider = rows.find((r) => r.querySelector('.tile-name')?.textContent === '滑翔机');
      return {
        ghosted: !!glider && getComputedStyle(glider).display === 'none',
        floating: !!document.querySelector('.drag-ghost'),
      };
    })()`);
    await mouse('mouseMoved', dndPos.to, 1);
    await sleep(160);
    const dndSlot = await page.evaluate(
      `(() => ({ hasSlot: !!document.querySelector('#palette-list .drop-slot') }))()`);
    await mouse('mouseReleased', dndPos.to, 0);
    await sleep(260);
    const dndEnd = await page.evaluate(`(async () => {
      const L = window.__life;
      const out = {
        cat: L.library.byId('glider').catId,
        gunCount: L.library.patternsIn('gun').length,
        slotGone: !document.querySelector('#palette-list .drop-slot'),
        ghostGone: !document.querySelector('.drag-ghost'),
        backCount: document.querySelectorAll('#palette-list .edit-tile').length,
      };
      L.movePattern('glider', 'ship');
      L.setPaletteMode('browse');
      await new Promise((r) => setTimeout(r, 260));
      return out;
    })()`);
    record('指针拖拽能换分类', dndEnd.cat === 'gun' && dndEnd.gunCount === 2, `拖进「枪」→ ${dndEnd.cat}`);
    record('拖动时源方块收起、只留跟手的浮动预览', dndMid.ghosted && dndMid.floating,
      `源 display=${dndMid.ghosted ? 'none' : '可见'} · 浮动预览 ${dndMid.floating ? '有' : '无'}`);
    record('拖动时出现落点占位槽', dndSlot.hasSlot, `占位槽 ${dndSlot.hasSlot ? '有' : '无'}`);
    record('松手后占位槽与浮动预览都收起', dndEnd.slotGone && dndEnd.ghostGone && dndEnd.backCount > 0,
      `占位槽 ${dndEnd.slotGone ? '没了' : '还在'} · 预览 ${dndEnd.ghostGone ? '没了' : '还在'}`);

    // 拖到列表末尾（「+ 新建分类」那一带）也应该有落点，且落在最后一个分类
    const gapPos = await page.evaluate(`(async () => {
      const L = window.__life;
      L.setPaletteMode('edit');
      await new Promise((r) => setTimeout(r, 340));
      const list = document.getElementById('palette-list');
      list.scrollTop = list.scrollHeight;
      await new Promise((r) => setTimeout(r, 180));
      const lr = list.getBoundingClientRect();
      const tiles = [...list.querySelectorAll('.edit-tile')].filter((t) => !t.closest('.stash-sec'));
      const visible = tiles.find((t) => {
        const r = t.getBoundingClientRect();
        return r.top > lr.top + 8 && r.bottom < lr.bottom - 8 && r.height > 10;
      });
      if (!visible) return null;
      const tr = visible.getBoundingClientRect();
      const add = list.querySelector('.add-cat')?.getBoundingClientRect();
      return {
        id: visible.dataset.patId,
        from: { x: tr.x + tr.width / 2, y: tr.y + tr.height / 2 },
        to: add ? { x: add.x + add.width / 2, y: add.y + add.height / 2 } : null,
        lastId: L.library.categories[L.library.categories.length - 1].id,
      };
    })()`);
    let gapRes = { hasSlot: false, movedCat: null, lastId: null };
    if (gapPos && gapPos.to) {
      await mouse('mouseMoved', gapPos.from, 0);
      await mouse('mousePressed', gapPos.from, 1);
      await mouse('mouseMoved', { x: gapPos.from.x + 10, y: gapPos.from.y - 10 }, 1);
      await mouse('mouseMoved', gapPos.to, 1);
      await sleep(170);
      const gSlot = await page.evaluate(
        `(() => ({ hasSlot: !!document.querySelector('#palette-list .drop-slot') }))()`);
      await mouse('mouseReleased', gapPos.to, 0);
      await sleep(260);
      const movedCat = await page.evaluate(
        `(() => window.__life.library.byId(${JSON.stringify(gapPos.id)})?.catId ?? null)()`);
      await page.evaluate(`(async () => {
        const L = window.__life;
        L.movePattern(${JSON.stringify(gapPos.id)}, ${JSON.stringify(gapPos.lastId)});
        L.setPaletteMode('browse');
        await new Promise((r) => setTimeout(r, 240));
      })()`);
      gapRes = { hasSlot: gSlot.hasSlot, movedCat, lastId: gapPos.lastId };
    }
    record('拖到空白处也有落点', gapRes.hasSlot, `占位槽 ${gapRes.hasSlot ? '有' : '无'}`);
    record('空白处松手落到最后一个分类', !!gapRes.movedCat && gapRes.movedCat === gapRes.lastId,
      `落在 ${gapRes.movedCat}（最后一个分类 ${gapRes.lastId}）`);

    const collapse = await page.evaluate(`(async () => {
      document.getElementById('btn-palette-collapse').click();
      await new Promise((r) => setTimeout(r, 300));
      const p = document.getElementById('palette').getBoundingClientRect();
      return {
        w: Math.round(p.width),
        h: Math.round(p.height),
        icon: document.getElementById('btn-palette-collapse').textContent,
        collapsed: document.getElementById('palette').classList.contains('collapsed'),
      };
    })()`);
    record('收起后只剩一个小图标', collapse.collapsed && collapse.w <= 44 && collapse.h <= 44,
      `${collapse.w}×${collapse.h} · 图标 ${collapse.icon}`);
    await page.evaluate(`(async () => {
      document.getElementById('btn-palette-collapse').click();
      await new Promise((r) => setTimeout(r, 260));
    })()`);

    // W 贴图模式默认不选图案、点空白处取消选中、拖左边缘加宽
    const pick = await page.evaluate(`(async () => {
      const L = window.__life;
      L.setTool('stamp');
      const noPat = L.patternId;
      document.querySelector('#palette .pat').click();
      await new Promise((r) => setTimeout(r, 140));
      const picked = L.patternId;
      document.getElementById('palette-list').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 140));
      return { noPat, picked, after: L.patternId };
    })()`);
    record('贴图模式不默认选图案', pick.noPat === '', `patternId "${pick.noPat}"`);
    record('点图案库空白处取消选中', pick.picked !== '' && pick.after === '',
      `${pick.picked} → "${pick.after}"`);

    const widen = await page.evaluate(`(async () => {
      const L = window.__life;
      L.setPaletteMode('edit');
      await new Promise((r) => setTimeout(r, 280));
      const pal = document.getElementById('palette');
      const before = pal.offsetWidth;
      const h = document.getElementById('palette-resize');
      const box = h.getBoundingClientRect();
      const y = box.top + box.height / 2;
      const fire = (type, x) => h.dispatchEvent(new PointerEvent(type, {
        clientX: x, clientY: y, pointerId: 31, pointerType: 'mouse',
        isPrimary: true, bubbles: true, cancelable: true,
      }));
      fire('pointerdown', box.left + 4);
      fire('pointermove', box.left - 100);
      fire('pointerup', box.left - 100);
      await new Promise((r) => setTimeout(r, 320));
      const after = pal.offsetWidth;
      L.setPaletteMode('browse');
      await new Promise((r) => setTimeout(r, 280));
      return { before, after };
    })()`);
    record('拖左边缘能加宽图案库', widen.after > widen.before + 60,
      `${widen.before}px → ${widen.after}px`);

    // 真实鼠标：图案方块与分类头拖起来后源项要抽走
    const dragRects = await page.evaluate(`(async () => {
      const L = window.__life;
      L.setPaletteMode('edit');
      await new Promise((r) => setTimeout(r, 340));
      const tile = document.querySelector('#palette-list .edit-tile');
      const tr = tile.getBoundingClientRect();
      const grip = document.querySelector('#palette-list .edit-cat-head .grip').getBoundingClientRect();
      return {
        tile: { x: tr.x + tr.width / 2, y: tr.y + tr.height / 2 },
        grip: { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 },
      };
    })()`);
    await mouse('mouseMoved', dragRects.tile, 0);
    await mouse('mousePressed', dragRects.tile, 1);
    await mouse('mouseMoved', { x: dragRects.tile.x + 40, y: dragRects.tile.y + 30 }, 1);
    await sleep(130);
    await page.evaluate(`(() => {
      const tile = document.querySelector('#palette-list .edit-tile');
      window.__dragProbe = {
        tileHidden: !tile || getComputedStyle(tile).display === 'none',
        tileGhosted: !!document.querySelector('.drag-ghost'),
        dbg: 'display=' + (tile ? getComputedStyle(tile).display : 'gone')
          + ' · ghost=' + document.querySelectorAll('.drag-ghost').length
          + ' · pdrag=' + JSON.stringify(window.__life.dragging),
      };
    })()`);
    await mouse('mouseReleased', { x: dragRects.tile.x + 40, y: dragRects.tile.y + 30 }, 0);
    await sleep(220);
    await page.evaluate(`(() => {
      window.__dragProbe.tileBack = document.querySelectorAll('#palette-list .edit-tile').length > 0;
    })()`);
    await mouse('mouseMoved', dragRects.grip, 0);
    await mouse('mousePressed', dragRects.grip, 1);
    await mouse('mouseMoved', { x: dragRects.grip.x + 6, y: dragRects.grip.y + 46 }, 1);
    await sleep(130);
    await page.evaluate(`(() => {
      const cats = [...document.querySelectorAll('#palette-list .edit-cat')];
      window.__dragProbe.catHidden = !!cats[0] && getComputedStyle(cats[0]).display === 'none';
    })()`);
    await mouse('mouseReleased', { x: dragRects.grip.x + 6, y: dragRects.grip.y + 46 }, 0);
    await sleep(220);
    await page.evaluate(`(() => {
      window.__dragProbe.catBack = document.querySelectorAll('#palette-list .edit-cat').length > 0;
      window.__life.setPaletteMode('browse');
    })()`);
    await sleep(240);

    // X 拖拽时源项抽走、分类头布局、一键展开/收起、删分类要确认
    const edit2 = await page.evaluate(`(async () => {
      const L = window.__life;
      L.setPaletteMode('edit');
      await new Promise((r) => setTimeout(r, 320));

      const probe = window.__dragProbe || {};
      const { tileHidden, tileGhosted, tileBack, catHidden, catBack, dbg } = probe;

      const head2 = document.querySelector('#palette-list .edit-cat-head');
      const kids = [...head2.children];
      const input = head2.querySelector('input');
      const grip = head2.querySelector('.grip');
      const layout = {
        firstIsButton: kids[0]?.tagName === 'BUTTON',
        inputW: Math.round(input.getBoundingClientRect().width),
        gripW: Math.round(grip.getBoundingClientRect().width),
        inputIdx: kids.indexOf(input),
        gripIdx: kids.indexOf(grip),
      };

      const openCount = () => document.querySelectorAll('#palette-list .edit-cat .edit-tile').length;
      const openA = openCount();
      document.querySelector('.edit-tools .btn').click();
      await new Promise((r) => setTimeout(r, 220));
      const openB = openCount();
      const labelB = document.querySelector('.edit-tools .btn').textContent.trim();
      document.querySelector('.edit-tools .btn').click();
      await new Promise((r) => setTimeout(r, 220));
      const openC = openCount();

      const base = L.library.categories.length;
      L.library.addCategory('临时测试');
      L.setPaletteMode('browse');
      await new Promise((r) => setTimeout(r, 200));
      L.setPaletteMode('edit');
      await new Promise((r) => setTimeout(r, 260));
      const withTemp = L.library.categories.length;

      let dels = [...document.querySelectorAll('#palette-list .edit-cat-head .btn.danger')];
      dels[dels.length - 1].click();
      await new Promise((r) => setTimeout(r, 200));
      const confirmBox = document.getElementById('confirm');
      const confirmShown = !confirmBox.classList.contains('hidden');
      const card = confirmBox.querySelector('.confirm-card').getBoundingClientRect();
      const centered =
        Math.abs((card.left + card.right) / 2 - innerWidth / 2) < 4
        && Math.abs((card.top + card.bottom) / 2 - innerHeight / 2) < 4;
      const title = document.getElementById('confirm-title').textContent;
      document.getElementById('confirm-cancel').click();
      await new Promise((r) => setTimeout(r, 200));
      const afterCancel = L.library.categories.length;
      const closedAfterCancel = document.getElementById('confirm').classList.contains('hidden');

      dels = [...document.querySelectorAll('#palette-list .edit-cat-head .btn.danger')];
      dels[dels.length - 1].click();
      await new Promise((r) => setTimeout(r, 200));
      document.getElementById('confirm-ok').click();
      await new Promise((r) => setTimeout(r, 280));
      const afterOk = L.library.categories.length;

      L.setPaletteMode('browse');
      await new Promise((r) => setTimeout(r, 260));
      return { tileHidden, tileGhosted, dbg, tileBack, catHidden, catBack, layout, openA, openB, openC, labelB,
        base, withTemp, afterCancel, afterOk, confirmShown, centered, title, closedAfterCancel };
    })()`);
    record('拖拽中的图案不参与排序', edit2.tileHidden && edit2.tileGhosted && edit2.tileBack,
      `拖动时内容隐藏=${edit2.tileHidden}，松手恢复=${edit2.tileBack}（${edit2.dbg}）`);
    record('拖拽中的分类不参与排序', edit2.catHidden && edit2.catBack,
      `拖动时隐藏=${edit2.catHidden}，松手恢复=${edit2.catBack}`);
    record('分类头布局：三角在最左、拖拽区在名称右边',
      edit2.layout.firstIsButton && edit2.layout.inputIdx < edit2.layout.gripIdx
        && edit2.layout.inputW <= 150 && edit2.layout.gripW >= 40,
      `名称 ${edit2.layout.inputW}px · 拖拽区 ${edit2.layout.gripW}px`);
    record('一键收起/展开全部分类',
      edit2.openA > 0 && edit2.openB === 0 && edit2.openC > 0 && edit2.labelB.includes('展开'),
      `${edit2.openA} → ${edit2.openB} → ${edit2.openC} 个图案`);
    record('删除分类要二次确认',
      edit2.withTemp === edit2.base + 1 && edit2.afterCancel === edit2.withTemp
        && edit2.afterOk === edit2.base,
      `取消后 ${edit2.afterCancel}，确认后 ${edit2.afterOk}（原有 ${edit2.base}）`);
    record('确认框是游戏内弹窗且居中',
      edit2.confirmShown && edit2.centered && edit2.title.includes('删除')
        && edit2.closedAfterCancel,
      `标题「${edit2.title}」· 居中 ${edit2.centered}`);

    // Y 打开遮挡画布的界面会暂停演化
    const pauseOnModal = await page.evaluate(`(async () => {
      const L = window.__life;
      if (!L.playing) document.getElementById('btn-play').click();
      await new Promise(r => setTimeout(r, 120));
      const before = L.playing;
      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 150));
      const afterStudio = L.playing;
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 100));
      document.getElementById('btn-help').click();
      await new Promise(r => setTimeout(r, 150));
      const afterHelp = L.playing;
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 100));
      return { before, afterStudio, afterHelp };
    })()`);
    record(
      '打开内容库 / 帮助会自动暂停演化',
      pauseOnModal.before && !pauseOnModal.afterStudio && !pauseOnModal.afterHelp,
      `播放 ${pauseOnModal.before} → 内容库 ${pauseOnModal.afterStudio} → 帮助 ${pauseOnModal.afterHelp}`,
    );

    // Z 回溯深度可调（在底栏右侧）
    const depth = await page.evaluate(`(async () => {
      const L = window.__life;
      const before = L.history.limitGens;
      const sel = document.getElementById('depth-select');
      const opts = sel ? [...sel.options].map(o => o.value) : [];
      sel.value = '500';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const after = L.history.limitGens;
      const note = sel.title;
      sel.value = '3000';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      const restored = L.history.limitGens;
      return { before, after, restored, note, opts };
    })()`);
    record(
      '回溯深度可以在底栏调整',
      depth.after === 500 && depth.restored === 3000 && depth.opts.length >= 5,
      `${depth.before} → ${depth.after} → ${depth.restored}，档位 ${depth.opts.join('/')}`,
    );
    record(
      '回溯深度的说明里有已用代数与内存上限',
      /回溯深度/.test(depth.note) && /上限/.test(depth.note),
      depth.note,
    );

    // AA 快照：点卡片进预览，不直接覆盖世界
    const preview = await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('glider', 300, 300);
      const popSnap = L.world.population;
      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 150));
      document.getElementById('st-snap').click();
      await new Promise(r => setTimeout(r, 200));
      document.getElementById('snap-name').value = '预览用快照';
      document.getElementById('snap-save').click();
      for (let i = 0; i < 40; i++) {
        if (document.querySelectorAll('.snap-card').length) break;
        await new Promise(r => setTimeout(r, 50));
      }
      await new Promise(r => setTimeout(r, 250));
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 120));

      L.world.clear(); L.commit();
      L.place('pulsar', 400, 400);
      const popNow = L.world.population;

      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 150));
      document.getElementById('st-snap').click();
      await new Promise(r => setTimeout(r, 250));
      const card = document.querySelector('.card-grid .snap-card');
      card.click();
      await new Promise(r => setTimeout(r, 350));
      const inPreview = !!document.getElementById('snap-canvas');
      const popInPreview = L.world.population;
      const hasLoad = !!document.getElementById('snap-load');
      const hasBack = !!document.getElementById('snap-back');
      // 预览里滚轮缩放不应该报错
      const pane = document.getElementById('snap-view');
      const pr = pane.getBoundingClientRect();
      pane.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -240, clientX: pr.left + pr.width / 2, clientY: pr.top + pr.height / 2,
        bubbles: true, cancelable: true,
      }));
      await new Promise(r => setTimeout(r, 120));
      document.getElementById('snap-load').click();
      await new Promise(r => setTimeout(r, 200));
      const confirmShown = !document.getElementById('confirm').classList.contains('hidden');
      document.getElementById('confirm-ok').click();
      await new Promise(r => setTimeout(r, 350));
      const popAfter = L.world.population;
      return { popSnap, popNow, popInPreview, inPreview, hasLoad, hasBack, confirmShown, popAfter };
    })()`);
    record(
      '点快照卡片先进预览、不覆盖当前世界',
      preview.inPreview && preview.popInPreview === preview.popNow && preview.popNow !== preview.popSnap,
      `预览时人口 ${preview.popInPreview}（当前 ${preview.popNow}，快照 ${preview.popSnap}）`,
    );
    record(
      '快照预览里有「载入到画布」且载入要确认',
      preview.hasLoad && preview.confirmShown && preview.popAfter === preview.popSnap,
      `确认 ${preview.confirmShown} · 载入后人口 ${preview.popAfter}`,
    );

    // AB 片段播放器：一屏放得下、操作栏可收起、能全屏
    const player = await page.evaluate(`(async () => {
      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 150));
      document.getElementById('st-clips').click();
      await new Promise(r => setTimeout(r, 300));
      const card = document.querySelector('.card-grid .snap-card');
      if (!card) return { none: true };
      card.click();
      await new Promise(r => setTimeout(r, 450));
      const body = document.getElementById('modal-body');
      const bar = document.getElementById('clip-bar');
      const stage = document.getElementById('clip-stage');
      const scrollable = body.scrollHeight > body.clientHeight + 2;
      const barVisible = !!bar && getComputedStyle(bar).display !== 'none';
      const hasFs = !!document.getElementById('clip-fs');
      document.getElementById('clip-dock').click();
      await new Promise(r => setTimeout(r, 150));
      const bareHidden = getComputedStyle(bar).display === 'none';
      const showBtn = document.getElementById('clip-showbar');
      const showVisible = !showBtn.classList.contains('hidden');
      showBtn.click();
      await new Promise(r => setTimeout(r, 150));
      const barBack = getComputedStyle(bar).display !== 'none';
      const sr = stage.getBoundingClientRect();
      stage.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -240, clientX: sr.left + sr.width / 2, clientY: sr.top + sr.height / 2,
        bubbles: true, cancelable: true,
      }));
      await new Promise(r => setTimeout(r, 150));
      const stageH = Math.round(sr.height);
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 200));
      return { none: false, scrollable, barVisible, hasFs, bareHidden, showVisible, barBack, stageH };
    })()`);
    record(
      '片段播放器一屏放得下（不出滚动条）',
      !player.none && !player.scrollable && player.stageH > 200,
      player.none ? '没有片段' : `舞台高 ${player.stageH}`,
    );
    record(
      '片段播放器操作栏能收起 / 展开',
      !player.none && player.barVisible && player.bareHidden && player.showVisible && player.barBack,
      player.none ? '没有片段' : `收起 ${player.bareHidden} · 展开 ${player.barBack}`,
    );
    record('片段播放器有全屏按钮', !player.none && player.hasFs, `hasFs=${player.hasFs}`);

    // AD 回溯深度：挪到底栏右侧，改完立刻生效
    const depthBar = await page.evaluate(`(async () => {
      const sel = document.getElementById('depth-select');
      const bar = document.getElementById('bottombar');
      const inBar = !!sel && bar.contains(sel);
      const opts = sel ? [...sel.options].map((o) => o.value) : [];
      sel.value = '500';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      let saved = '';
      try { saved = localStorage.getItem('life-studio:history-depth') || ''; } catch (e) {}
      const stillInSettings = !!document.getElementById('set-depth');
      // 还原，别影响后面的用例
      sel.value = '3000';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      return { inBar, opts, saved, stillInSettings };
    })()`);
    record(
      '回溯深度在底栏右侧、六档可选、改完立刻记住',
      depthBar.inBar && depthBar.opts.length === 6 && depthBar.saved === '500' && !depthBar.stillInSettings,
      `?inBar=${depthBar.inBar} · ${depthBar.opts.join('/')} · 存了 ${depthBar.saved}`,
    );

    // AE 遮挡界面：打开时暂停，关掉后恢复原来的播放状态
    const pauseRun = await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit(); L.place('glider', 300, 300);
      if (!L.playing) document.getElementById('btn-play').click();
      await new Promise(r => setTimeout(r, 150));
      const before = L.playing;
      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 220));
      const pausedOnOpen = L.playing;
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 260));
      const resumed = L.playing;
      // 本来就没在跑的时候，关掉之后也不该自己跑起来
      if (L.playing) document.getElementById('btn-play').click();
      await new Promise(r => setTimeout(r, 150));
      const idleBefore = L.playing;
      document.getElementById('btn-help').click();
      await new Promise(r => setTimeout(r, 220));
      const idlePaused = L.playing;
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 260));
      const idleAfter = L.playing;
      return { before, pausedOnOpen, resumed, idleBefore, idlePaused, idleAfter };
    })()`);
    record(
      '弹窗遮挡时暂停，关掉后恢复原来的播放状态',
      pauseRun.before &&
        !pauseRun.pausedOnOpen &&
        pauseRun.resumed &&
        !pauseRun.idleBefore &&
        !pauseRun.idlePaused &&
        !pauseRun.idleAfter,
      `播放中开弹窗 ${pauseRun.pausedOnOpen} → 关掉 ${pauseRun.resumed}；暂停中开弹窗 ${pauseRun.idlePaused} → 关掉 ${pauseRun.idleAfter}`,
    );

    // AF 片段播放器：真鼠标点「▴ 操作栏」；关掉后回到内容库片段页签
    const dockPos = await page.evaluate(`(async () => {
      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 180));
      document.getElementById('st-clips').click();
      await new Promise(r => setTimeout(r, 280));
      const card = document.querySelector('.card-grid .snap-card');
      if (!card) return { none: true };
      card.click();
      await new Promise(r => setTimeout(r, 450));
      document.getElementById('clip-dock').click();
      await new Promise(r => setTimeout(r, 160));
      const btn = document.getElementById('clip-showbar');
      const r = btn.getBoundingClientRect();
      const bar = document.getElementById('clip-bar');
      return {
        none: false,
        bare: getComputedStyle(bar).display === 'none',
        at: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      };
    })()`);
    let dockBack = { visible: false, studio: false, active: '' };
    if (!dockPos.none) {
      const realMouse = (type, buttons) => page.send('Input.dispatchMouseEvent', {
        type,
        x: Math.round(dockPos.at.x),
        y: Math.round(dockPos.at.y),
        button: 'left',
        buttons,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      });
      await realMouse('mouseMoved', 0);
      await realMouse('mousePressed', 1);
      await realMouse('mouseReleased', 0);
      await sleep(220);
      dockBack = await page.evaluate(`(async () => {
        const bar = document.getElementById('clip-bar');
        const visible = !!bar && getComputedStyle(bar).display !== 'none';
        document.getElementById('modal-close').click();
        await new Promise(r => setTimeout(r, 280));
        const tabs = document.querySelector('.studio-tabs');
        const active = document.querySelector('.studio-tab.active');
        const out = { visible, studio: !!tabs, active: active ? active.textContent.trim() : '' };
        document.getElementById('modal-close').click();
        await new Promise(r => setTimeout(r, 200));
        return out;
      })()`);
    }
    record(
      '播放器「▴ 操作栏」用真鼠标点得动',
      !dockPos.none && dockPos.bare && dockBack.visible,
      dockPos.none ? '没有片段' : `收起后 ${dockPos.bare} · 点回来 ${dockBack.visible}`,
    );
    record(
      '关掉播放器回到内容库的片段页签',
      !dockPos.none && dockBack.studio && dockBack.active.includes('片段'),
      dockPos.none ? '没有片段' : `回到 ${dockBack.studio ? '内容库' : '画布'} · 页签「${dockBack.active}」`,
    );

    // AG 快照预览关掉后也回内容库，而不是直接掉回画布
    const snapBack = await page.evaluate(`(async () => {
      document.getElementById('btn-studio').click();
      await new Promise(r => setTimeout(r, 200));
      const card = document.querySelector('.snap-card');
      if (!card) return { none: true };
      card.click();
      await new Promise(r => setTimeout(r, 420));
      const opened = !!document.getElementById('snap-view');
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 280));
      const active = document.querySelector('.studio-tab.active');
      const out = { none: false, opened, studio: !!document.querySelector('.studio-tabs'), active: active ? active.textContent.trim() : '' };
      document.getElementById('modal-close').click();
      await new Promise(r => setTimeout(r, 220));
      return out;
    })()`);
    record(
      '关掉快照预览回到内容库「时刻 · 存档」',
      !snapBack.none && snapBack.opened && snapBack.studio && snapBack.active.includes('时刻'),
      snapBack.none ? '没有快照' : `页签「${snapBack.active}」`,
    );

    // AC 清空世界要确认
    const clearAsk = await page.evaluate(`(async () => {
      const L = window.__life;
      L.world.clear(); L.commit();
      L.place('block', 300, 300);
      const pop = L.world.population;
      document.getElementById('btn-clear').click();
      await new Promise(r => setTimeout(r, 220));
      const asked = !document.getElementById('confirm').classList.contains('hidden');
      const untouched = L.world.population === pop;
      document.getElementById('confirm-cancel').click();
      await new Promise(r => setTimeout(r, 150));
      return { asked, untouched, afterCancel: L.world.population === pop };
    })()`);
    record(
      '清空世界要先确认，取消后不动',
      clearAsk.asked && clearAsk.untouched && clearAsk.afterCancel,
      `弹窗 ${clearAsk.asked} · 取消后保留 ${clearAsk.afterCancel}`,
    );

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
