// 构建：用 esbuild 二进制把 TS 打成单文件 IIFE，再内联 CSS/JS 生成可双击打开的 HTML。
// 不依赖 vite 的 node 包装层，直接调 esbuild 二进制，产物只有一份、构建更快也更好排查。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));

const platformPkg = `${process.platform}-${process.arch}`;
const exeName = process.platform === 'win32' ? 'esbuild.exe' : join('bin', 'esbuild');

/** 在 pnpm 的 .pnpm 目录里找到 @esbuild/<platform> 的二进制。 */
function findInPnpm() {
  const store = join(root, 'node_modules', '.pnpm');
  if (!existsSync(store)) return null;
  for (const dir of readdirSync(store)) {
    if (!dir.startsWith(`@esbuild+${platformPkg}@`)) continue;
    const bin = join(store, dir, 'node_modules', '@esbuild', platformPkg, exeName);
    if (existsSync(bin)) return bin;
  }
  return null;
}

function findEsbuildBinary() {
  try {
    const main = require.resolve('esbuild');
    const pkgDir = dirname(dirname(main));
    const direct =
      process.platform === 'win32'
        ? join(dirname(pkgDir), '@esbuild', platformPkg, 'esbuild.exe')
        : join(dirname(pkgDir), '@esbuild', platformPkg, exeName);
    if (existsSync(direct)) return direct;
  } catch {
    /* 顶层没装 esbuild（pnpm 严格链接），继续找 */
  }
  return findInPnpm();
}

const bin = findEsbuildBinary();
if (!bin) {
  console.error('✖ 找不到 esbuild 可执行文件，请先运行 pnpm install');
  process.exit(1);
}

mkdirSync(join(root, 'build'), { recursive: true });
const outFile = join(root, 'build', 'app.js');

const args = [
  'src/main.ts',
  '--bundle',
  '--format=iife',
  '--target=es2022',
  '--charset=utf8',
  '--legal-comments=none',
  '--log-level=warning',
  `--outfile=${outFile}`,
];

const res = spawnSync(bin, args, { cwd: root, stdio: 'inherit' });
if (res.status !== 0) {
  console.error(`✖ esbuild 打包失败 (${res.status ?? res.error?.message})`);
  process.exit(res.status ?? 1);
}

const css = readFileSync(join(root, 'src', 'style.css'), 'utf8');
const js = readFileSync(outFile, 'utf8').replace(/<\/script/gi, '<\\/script');

let html = readFileSync(join(root, 'index.html'), 'utf8');
const before = html;

html = html.replace(
  /<link rel="stylesheet" href="\/src\/style\.css"\s*\/?>/,
  () => `<style>\n${css}</style>`,
);
html = html.replace(
  /<script type="module" src="\/src\/main\.ts"><\/script>/,
  () => `<script>\n${js}</script>`,
);

if (html === before) {
  console.error('✖ index.html 里没找到预期的 <link> / <script> 标签，模板可能改过了');
  process.exit(1);
}
if (!html.includes('<style>') || !html.includes('</script>')) {
  console.error('✖ 内联失败');
  process.exit(1);
}

mkdirSync(join(root, 'dist'), { recursive: true });
const distFile = join(root, 'dist', 'index.html');
writeFileSync(distFile, html, 'utf8');
const singleFile = join(root, '生命游戏.html');
writeFileSync(singleFile, html, 'utf8');

// GitHub Pages 用：docs/ 目录直接作为站点根，index.html 就是这份自包含页面。
mkdirSync(join(root, 'docs'), { recursive: true });
const docsFile = join(root, 'docs', 'index.html');
writeFileSync(docsFile, html, 'utf8');

const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
console.log(`✔ build/app.js       ${kb(outFile)}`);
console.log(`✔ dist/index.html    ${kb(distFile)}`);
console.log(`✔ 生命游戏.html      ${kb(singleFile)}   ← 双击即可打开`);
console.log(`✔ docs/index.html    ${kb(docsFile)}   ← GitHub Pages`);
