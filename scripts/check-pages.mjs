// 检查 GitHub Pages 上的成品是否已经上线，并确认它真的是那份自包含页面（不是开发入口）。
// 用法：node scripts/check-pages.mjs [最多等几秒，默认 180]
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CRED_FILE = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'life-studio', 'credentials.json');
const cred = existsSync(CRED_FILE) ? JSON.parse(readFileSync(CRED_FILE, 'utf8').replace(/^\uFEFF/, '')) : {};
const OWNER = (cred.owner || 'For-XiaoYi').toLowerCase();
const REPO = cred.repo || 'My-GameOfLife';
const URL_BASE = `https://${OWNER}.github.io/${REPO}/`;

const deadline = Date.now() + Number(process.argv[2] ?? 180) * 1000;
const bust = () => `${URL_BASE}?t=${Date.now()}`;

async function probe() {
  const res = await fetch(bust(), { redirect: 'follow' });
  const body = res.ok ? await res.text() : '';
  return { status: res.status, body };
}

let last = { status: 0, body: '' };
while (Date.now() < deadline) {
  try {
    last = await probe();
  } catch (e) {
    last = { status: -1, body: String(e.message) };
  }
  if (last.status === 200) break;
  process.stdout.write(`等待中… HTTP ${last.status}\r`);
  await new Promise((r) => setTimeout(r, 5000));
}

if (last.status !== 200) {
  console.error(`\n✖ 还没上线（最后一次 HTTP ${last.status}）：${URL_BASE}`);
  process.exit(1);
}

const hasBoard = last.body.includes('id="board"');
const hasDevEntry = last.body.includes('/src/main.ts'); // 开发入口才会出现，线上出现就是配错了
const bigEnough = last.body.length > 50_000; // 自包含页面约 114 KB

console.log(`\n✔ 已上线：${URL_BASE}`);
console.log(`  HTTP 200 · ${(last.body.length / 1024).toFixed(0)} KB · canvas=${hasBoard ? '有' : '无'}`);
if (hasDevEntry) {
  console.error('✖ 页面里引用了 /src/main.ts —— 发布的是开发入口，浏览器里会白屏');
  process.exit(1);
}
if (!hasBoard || !bigEnough) {
  console.error('✖ 页面内容不对（缺少 #board 画布，或体积明显偏小）');
  process.exit(1);
}
console.log('  ✔ 是自包含的可玩版本，不是开发入口');
