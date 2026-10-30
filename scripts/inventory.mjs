// 打印工作区文件地图：哪些文件会被 scripts/publish-github.mjs 上传、哪些不会、每个目录是干什么的。
// 用法：node scripts/inventory.mjs
// 规则必须和 publish-github.mjs 保持一致，脚本会自检并在不一致时报警。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.pnpm-store', '.git', '.tools']);
const SKIP_PATHS = new Set(['promo/out', 'AGENTS.md', 'CLAUDE.md']);
const MAX_BLOB = 12 * 1024 * 1024;
const RELEASE_FILES = ['assets/promo.mp4'];

// 目录/文件 → 一句话说明
const NOTES = [
  ['src/core/', '游戏规则核心：世界、图案、回溯、存储、RLE'],
  ['src/render/', '渲染：离屏位图 + 瓷砖铺满'],
  ['src/view/', '相机 / 视口换算'],
  ['src/', '游戏源码（入口、样式）'],
  ['scripts/', '构建、自检、发布、截图与宣传片脚本'],
  ['tools/patterns/', '内置图案的 RLE 源文件（gen-patterns.mjs 生成 src/core/pattern-data.ts）'],
  ['tools/', '开发期工具数据'],
  ['assets/', 'README 和发布页用图（海报、分镜、截图）'],
  ['docs/', 'GitHub Pages 产物（构建自动生成，不要手改）'],
  ['promo/out/', '宣传片渲染中间产物（不上传，可随时删）'],
  ['promo/public/', '宣传片素材：界面截图、背景图、配乐、片段 mp4'],
  ['promo/src/', 'Remotion 宣传片源码（场景、组件）'],
  ['promo/', 'Remotion 宣传片工程'],
];
const ROOT_FILES = {
  '生命游戏.html': '单文件成品：双击即玩，构建生成',
  'index.html': '开发入口（Vite，只在 dev 时用）',
  'package.json': '依赖与脚本（pnpm build / test / publish:gh）',
  'pnpm-lock.yaml': '依赖锁定',
  'tsconfig.json': 'TypeScript 配置',
  'vite.config.ts': 'Vite 配置',
  'README.md': '项目说明（对外）',
  'FILES.md': '这份文件地图（对外）',
  '.gitignore': 'git 忽略规则',
  '.npmrc': 'pnpm 扁平 node_modules 设置',
  'AGENTS.md': '本机 AI 协作约定（不上传）',
};

const human = (n) =>
  n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB'
  : n >= 1024 ? (n / 1024).toFixed(0) + ' KB'
  : n + ' B';

function collect(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const full = join(dir, e.name);
    const rel = relative(ROOT, full).split('\\').join('/');
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || SKIP_PATHS.has(rel)) continue;
      collect(full, out);
    } else if (e.isFile()) {
      if (SKIP_PATHS.has(rel)) continue;
      out.push(rel);
    }
  }
  return out;
}

function noteFor(rel) {
  if (ROOT_FILES[rel]) return ROOT_FILES[rel];
  for (const [prefix, note] of NOTES) if (rel.startsWith(prefix)) return note;
  return '';
}

// 和发布脚本对账，规则漂了就提醒
function readConst(name) {
  const src = readFileSync(join(ROOT, 'scripts', 'publish-github.mjs'), 'utf8');
  const m = src.match(new RegExp(`const ${name} = ([^;]+);`));
  return m ? m[1] : '(缺失)';
}
const drift = [];
if (readConst('SKIP_DIRS') !== "new Set(['node_modules', 'build', 'dist', '.pnpm-store', '.git', '.tools'])") drift.push('SKIP_DIRS');
if (readConst('SKIP_PATHS') !== "new Set(['promo/out', 'AGENTS.md', 'CLAUDE.md'])") drift.push('SKIP_PATHS');
if (readConst('MAX_BLOB') !== '12 * 1024 * 1024') drift.push('MAX_BLOB');
if (readConst('RELEASE_FILES') !== "['assets/promo.mp4']") drift.push('RELEASE_FILES');

const files = collect(ROOT).sort();
let uploadBytes = 0;
const rows = files.map((rel) => {
  const size = statSync(join(ROOT, rel)).size;
  const release = RELEASE_FILES.includes(rel);
  const big = size > MAX_BLOB;
  const upload = !release && !big;
  if (upload) uploadBytes += size;
  return { rel, size, upload, why: release ? '走 Release 附件' : big ? '超过 12 MB' : '' };
});

const groups = new Map();
for (const r of rows) {
  const key = r.rel.includes('/') ? r.rel.slice(0, r.rel.indexOf('/')) + '/' : '（根目录）';
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

console.log(`# 工作区文件地图`);
console.log(`\n工作区 ${files.length} 个文件，其中 **${rows.filter((r) => r.upload).length} 个会被上传**（合计 ${human(uploadBytes)}），`);
console.log(`其余 ${rows.filter((r) => !r.upload).length} 个不上传。\n`);

for (const [g, list] of groups) {
  const up = list.filter((r) => r.upload);
  const bytes = up.reduce((n, r) => n + r.size, 0);
  const note = g === '（根目录）' ? '仓库顶层文件' : noteFor(g);
  console.log(`## ${g}  ${list.length} 个文件 · 上传 ${up.length} 个 · ${human(bytes)}`);
  if (note) console.log(note);
  for (const r of list) {
    console.log(`- ${r.upload ? '✅ 上传' : '❌ 不上传'}  ${human(r.size).padStart(7)}  ${r.rel.replace(g === '（根目录）' ? '' : g, '')}${r.why ? `（${r.why}）` : ''}`);
  }
  console.log();
}

const skipped = [
  ['node_modules/', '依赖包（本机安装，可重新 install）'],
  ['promo/node_modules/', '宣传片依赖包'],
  ['promo/out/', '渲染中间产物：抽帧、storyboard、测试视频'],
  ['build/', '构建中间文件 build/app.js'],
  ['dist/', '构建中间产物'],
  ['.pnpm-store/', 'pnpm 内容寻址存储'],
  ['.tools/', '下载的便携工具'],
  ['AGENTS.md', '本机 AI 协作约定'],
  ['assets/promo.mp4', '宣传片成片，走 Release 附件（避免 git 仓库膨胀）'],
];
console.log('## 明确不上传');
for (const [p, why] of skipped) console.log(`- ${p} — ${why}`);
console.log(`\n## 浏览器里的运行数据（根本不在这台电脑的文件树里）`);
for (const [p, why] of [
  ['localStorage / IndexedDB', '自定义图案、界面状态、快照、片段、自动存档'],
  ['%LOCALAPPDATA%\\life-studio\\credentials.json', '发布用 token（仅本机）'],
]) console.log(`- ${p} — ${why}`);
if (drift.length) {
  console.log(`\n⚠ 规则漂移：${drift.join(', ')} 与 scripts/publish-github.mjs 不一致，请同步本脚本。`);
  process.exitCode = 1;
}
