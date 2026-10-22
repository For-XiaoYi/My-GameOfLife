// 构建收尾：把 dist/index.html 复制成可以双击打开的单文件 HTML。
import { copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'dist', 'index.html');
const dst = join(root, '生命游戏.html');

copyFileSync(src, dst);

const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
console.log(`✔ dist/index.html  ${kb(src)}`);
console.log(`✔ 生命游戏.html    ${kb(dst)}   ← 双击即可打开`);
