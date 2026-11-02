// 把工程目录里「该进仓库」的文件同步到 ../git文件（仓库镜像）。
// 用法：node scripts/sync-git-files.mjs
// 同步后，本地打开 git文件 看到的就是仓库的全部内容；发布脚本只读这个目录。
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { MAX_BLOB, RELEASE_FILES, SKIP_DIRS, SKIP_PATHS } from './publish-rules.mjs';

const SRC = resolve('.');
const DEST = resolve('../git文件');

function collect(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const full = join(dir, e.name);
    const rel = relative(SRC, full).split('\\').join('/');
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

if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

const files = collect(SRC).sort();
let bytes = 0;
const skipped = [];
for (const rel of files) {
  const from = join(SRC, rel);
  const size = statSync(from).size;
  if (RELEASE_FILES.includes(rel) || size > MAX_BLOB) {
    skipped.push(rel);
    continue;
  }
  const to = join(DEST, rel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  bytes += size;
}

console.log(`已同步 ${files.length - skipped.length} 个文件（${(bytes / 1048576).toFixed(1)} MB）→ git文件/`);
if (skipped.length) console.log(`未同步（走 Release / 超过 ${MAX_BLOB / 1048576} MB）：${skipped.join(', ')}`);
