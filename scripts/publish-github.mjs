// 把当前项目发布成一个 GitHub 仓库（不依赖 git，直接走 Git Data API）。
// 用法：
//   node scripts/publish-github.mjs            # 用本地保存的凭据
//   node scripts/publish-github.mjs --check    # 只验证凭据是否还有效
//   $env:GITHUB_TOKEN='ghp_xxx'; node scripts/publish-github.mjs
//
// 凭据查找顺序：环境变量 GITHUB_TOKEN → %LOCALAPPDATA%\life-studio\credentials.json
// 凭据文件放在仓库之外，避免被误提交；里面的 token 只对 My-GameOfLife 有 Contents 写权限。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const CRED_FILE = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'life-studio', 'credentials.json');

function loadCredentials() {
  if (!existsSync(CRED_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CRED_FILE, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    console.warn(`凭据文件读不出来（${e.message}），忽略`);
    return {};
  }
}

const cred = loadCredentials();
const TOKEN = process.env.GITHUB_TOKEN || cred.githubToken;
if (!TOKEN) {
  console.error(`缺少 GitHub token：没有 GITHUB_TOKEN 环境变量，${CRED_FILE} 里也没有。`);
  process.exit(1);
}

const CHECK_ONLY = process.argv.includes('--check');
const REPO = process.env.REPO_NAME || cred.repo || 'My-GameOfLife';
const PRIVATE = (process.env.REPO_PRIVATE ?? 'true') !== 'false';
const ROOT = resolve('.');
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.pnpm-store', '.git', '.tools']);
const API = 'https://api.github.com';

async function api(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'life-studio-publisher',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data && data.message ? data.message : String(text).slice(0, 300);
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${msg}`);
  }
  return data;
}

function collect(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      collect(join(dir, e.name), out);
    } else if (e.isFile()) {
      out.push(relative(ROOT, join(dir, e.name)).split('\\').join('/'));
    }
  }
  return out;
}

const files = collect(ROOT).sort();
const totalBytes = files.reduce((n, f) => n + statSync(join(ROOT, f)).size, 0);

const me = await api('/user');

if (CHECK_ONLY) {
  console.log(`凭据有效：${me.login}`);
  try {
    const r = await api(`/repos/${me.login}/${REPO}`);
    console.log(`仓库可访问：${r.full_name}（${r.private ? '私有' : '公开'}，默认分支 ${r.default_branch}）`);
    console.log(`地址：${r.html_url}`);
  } catch (e) {
    console.log(`但访问 ${REPO} 失败：${e.message}`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

console.log(`准备发布 ${files.length} 个文件，共 ${(totalBytes / 1024).toFixed(0)} KB`);
console.log(`账号：${me.login}`);

let repo = null;
try {
  repo = await api(`/repos/${me.login}/${REPO}`);
  console.log(`仓库已存在：${repo.html_url}（追加一次提交）`);
} catch (e) {
  if (!String(e.message).includes('404')) throw e;
}

if (!repo) {
  repo = await api('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: REPO,
      private: PRIVATE,
      description: '浏览器里的康威生命游戏模拟器：1024×1024 环形世界、可调速度、图案库、缩放平移、时间回溯、快照与片段回放。',
      has_issues: true,
      has_wiki: false,
      auto_init: false,
    }),
  });
  console.log(`已创建仓库：${repo.html_url}`);
}

// 逐个文件建 blob（体积小，串行请求足够）
const tree = [];
for (const f of files) {
  const content = readFileSync(join(ROOT, f));
  const blob = await api(`/repos/${me.login}/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
  });
  tree.push({ path: f, mode: '100644', type: 'blob', sha: blob.sha });
  process.stdout.write(`  · ${f}\n`);
}

// 有历史就接在最新提交后面，否则作为首个提交
const BRANCH = repo.default_branch || 'main';
let parents = [];
let baseTree = null;
try {
  const ref = await api(`/repos/${me.login}/${REPO}/git/ref/heads/${BRANCH}`);
  parents = [ref.object.sha];
  const parent = await api(`/repos/${me.login}/${REPO}/git/commits/${ref.object.sha}`);
  baseTree = parent.tree.sha;
} catch {
  /* 空仓库 */
}

const newTree = await api(`/repos/${me.login}/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify(baseTree ? { tree, base_tree: baseTree } : { tree }),
});

const commit = await api(`/repos/${me.login}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message: parents.length
      ? `更新生命游戏模拟器（${files.length} 个文件）`
      : '生命游戏模拟器：1024² 世界、图案库、时间回溯与片段回放',
    tree: newTree.sha,
    parents,
  }),
});

if (parents.length) {
  await api(`/repos/${me.login}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  console.log(`已更新 ${BRANCH} 分支`);
} else {
  await api(`/repos/${me.login}/${REPO}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commit.sha }),
  });
  console.log(`已创建 ${BRANCH} 分支`);
}

await api(`/repos/${me.login}/${REPO}`, {
  method: 'PATCH',
  body: JSON.stringify({ default_branch: 'main' }),
});

console.log(`\n完成：${repo.html_url}`);
console.log(`提交：${commit.sha.slice(0, 7)} · ${files.length} 个文件`);
