// 把当前项目发布成一个 GitHub 仓库（不依赖 git，直接走 Git Data API）。
// 用法：
//   node scripts/publish-github.mjs            # 用保存的凭据更新仓库
//   node scripts/publish-github.mjs --check    # 只验证 token 与仓库访问
//
// 凭据查找顺序：环境变量 GITHUB_TOKEN → %LOCALAPPDATA%\life-studio\credentials.json
// （里面放 { "githubToken": "...", "repo": "My-GameOfLife", "owner": "..." }，不进仓库）
// token 需要目标仓库的 Contents 读写权限，想顺手触发 Pages 重新部署还需要 Pages 读写权限。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

function loadCredentials() {
  const env = process.env.LOCALAPPDATA;
  if (!env) return null;
  try {
    const raw = readFileSync(join(env, 'life-studio', 'credentials.json'), 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const cred = loadCredentials();
const TOKEN = process.env.GITHUB_TOKEN || (cred && cred.githubToken) || '';
if (!TOKEN) {
  console.error(
    '缺少 token：设置环境变量 GITHUB_TOKEN，或把它存到 %LOCALAPPDATA%\\life-studio\\credentials.json',
  );
  process.exit(1);
}

const CHECK_ONLY = process.argv.includes('--check');
const DRY = process.argv.includes('--dry');
const REPO = process.env.REPO_NAME || (cred && cred.repo) || 'My-GameOfLife';
const PRIVATE = (process.env.REPO_PRIVATE ?? 'true') !== 'false';
const ROOT = resolve('.');
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.pnpm-store', '.git', '.tools']);
// 整目录跳过：渲染中间产物和工程内依赖
const SKIP_PATHS = new Set(['promo/out']);
// 单个 blob 走 REST 上传时，超过这个体积会被挡（实测 20 MB 的 mp4 直接 401），
// 这类文件改走 Release 资产（上传接口 201，支持 2 GB）。
const MAX_BLOB = 8 * 1024 * 1024;
const RELEASE_TAG = 'promo-v1';
const RELEASE_FILES = ['assets/promo.mp4'];
const API = 'https://api.github.com';

async function api(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'game-of-life-publisher',
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
      const child = join(dir, e.name);
      if (SKIP_PATHS.has(relative(ROOT, child).split('\\').join('/'))) continue;
      collect(child, out);
    } else if (e.isFile()) {
      const rel = relative(ROOT, join(dir, e.name)).split('\\').join('/');
      if (statSync(join(dir, e.name)).size > MAX_BLOB) {
        bigFiles.push(rel);
        continue;
      }
      out.push(rel);
    }
  }
  return out;
}
const bigFiles = [];

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

if (DRY) {
  for (const f of files) {
    console.log(`  · ${(statSync(join(ROOT, f)).size / 1024).toFixed(1).padStart(9)} KB  ${f}`);
  }
  process.exit(0);
}

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

// 固定默认分支只是锦上添花：fine-grained token 没有 Administration 权限时这里会 403，
// 内容其实已经推成功了，所以失败只提示、不中断。
try {
  await api(`/repos/${me.login}/${REPO}`, {
    method: 'PATCH',
    body: JSON.stringify({ default_branch: BRANCH }),
  });
} catch (e) {
  console.log(`（可选）设置默认分支跳过：${e.message}`);
}

// 大文件走 Release 资产：视频这类几十 MB 的东西塞不进 git tree（REST blob 会 401）
async function ensureRelease(tag, name, body) {
  let res = await fetch(`${API}/repos/${me.login}/${REPO}/releases/tags/${tag}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'game-of-life-publisher' },
  });
  if (res.status === 200) return res.json();
  res = await fetch(`${API}/repos/${me.login}/${REPO}/releases`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'game-of-life-publisher',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tag_name: tag, name, body, draft: false, prerelease: false }),
  });
  const text = await res.text();
  if (res.status !== 201) throw new Error(`创建 release ${tag} → ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const releaseTargets = bigFiles.filter((f) => RELEASE_FILES.includes(f));
if (releaseTargets.length) {
  const rel = await ensureRelease(RELEASE_TAG, '宣传片 v1', '生命游戏宣传片成片（1920×1080 / 30fps / 51.5 秒）');
  for (const f of releaseTargets) {
    const buf = readFileSync(join(ROOT, f));
    const fileName = f.split('/').pop();
    const exists = (rel.assets || []).find((a) => a.name === fileName && a.size === buf.length);
    if (exists) {
      console.log(`  · ${f} 已在 release 里（${(buf.length / 1048576).toFixed(1)} MB），跳过`);
      continue;
    }
    const up = await fetch(
      `https://uploads.github.com/repos/${me.login}/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(fileName)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'game-of-life-publisher',
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(buf.length),
        },
        body: buf,
      },
    );
    const txt = await up.text();
    if (up.status !== 201) throw new Error(`上传 ${f} → ${up.status} ${txt.slice(0, 200)}`);
    console.log(`  · ${f} → release ${RELEASE_TAG}（${(buf.length / 1048576).toFixed(1)} MB）`);
  }
  if (bigFiles.length > releaseTargets.length) {
    console.log(`（其余大文件未上传：${bigFiles.filter((f) => !releaseTargets.includes(f)).join(', ')}）`);
  }
}
// 如果仓库已经开过 Pages，顺便触发一次重新构建，省得等自动那几分钟。
try {
  const builds = await api(`/repos/${me.login}/${REPO}/pages/builds`, { method: 'POST' });
  console.log(`已触发 Pages 重新部署（${builds.status}）`);
} catch (e) {
  console.log(`Pages 未启用或无法触发，跳过：${e.message}`);
}

console.log(`\n完成：${repo.html_url}`);
console.log(`提交：${commit.sha.slice(0, 7)} · ${files.length} 个文件`);
