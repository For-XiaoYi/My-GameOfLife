// 拉取 GitHub 上的最新版到 build/remote/，并与本地逐文件比对（不覆盖本地）
// 用法：node scripts/pull-github.mjs [owner/repo]
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const CRED = join(process.env.LOCALAPPDATA ?? '', 'life-studio', 'credentials.json');
const cred = JSON.parse(readFileSync(CRED, 'utf8').replace(/^\uFEFF/, ''));
const TOKEN = process.env.GITHUB_TOKEN || cred.githubToken;
const REPO = process.argv[2] || cred.repo || 'My-GameOfLife';
const OWNER = cred.owner || 'For-XiaoYi';

const api = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'life-studio',
    },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${await res.text()}`);
  return res.json();
};

const repo = await api(`/repos/${OWNER}/${REPO}`);
const branch = repo.default_branch;
const commits = await api(`/repos/${OWNER}/${REPO}/commits?sha=${branch}&per_page=5`);
const head = commits[0];
console.log(`仓库：${OWNER}/${REPO}（${branch}）`);
console.log(`最新提交：${head.sha.slice(0, 7)} · ${head.commit.author.date} · ${head.commit.message.split('\n')[0]}`);
for (const c of commits.slice(1)) {
  console.log(`   之前：${c.sha.slice(0, 7)} · ${c.commit.author.date} · ${c.commit.message.split('\n')[0]}`);
}

const tree = await api(`/repos/${OWNER}/${REPO}/git/trees/${head.sha}?recursive=1`);
const blobs = tree.tree.filter((n) => n.type === 'blob');
console.log(`远端文件：${blobs.length} 个（提交 ${head.sha.slice(0, 7)}）`);

const root = resolve('.');
const outRoot = resolve('build/remote');
const rows = [];
for (const node of blobs) {
  const local = join(root, node.path);
  const localExists = existsSync(local);
  const localSize = localExists ? statSync(local).size : -1;
  let status;
  if (!localExists) status = 'only-remote';
  else if (localSize === node.size) status = 'same-size';
  else status = 'size-diff';
  rows.push({ path: node.path, sha: node.sha, size: node.size, localExists, localSize, status });
}

// 本地有、远端没有
const localFiles = [];
const walk = (dir) => {
  for (const e of readFileSync ? [] : []) void e;
};
void walk;
for (const r of rows) {
  if (r.status === 'same-size') {
    // 再按内容确认（大小相同不代表内容相同）
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/blobs/${r.sha}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'life-studio' },
    });
    const j = await res.json();
    const buf = Buffer.from(j.content, j.encoding === 'base64' ? 'base64' : 'utf8');
    const localBuf = readFileSync(join(root, r.path));
    r.status = buf.equals(localBuf) ? 'same' : 'content-diff';
    if (r.status === 'content-diff') {
      const p = join(outRoot, r.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, buf);
    }
  } else if (r.status === 'size-diff' || r.status === 'only-remote') {
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/blobs/${r.sha}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'life-studio' },
    });
    const j = await res.json();
    const buf = Buffer.from(j.content, j.encoding === 'base64' ? 'base64' : 'utf8');
    const p = join(outRoot, r.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, buf);
  }
}

const buckets = { same: [], 'content-diff': [], 'size-diff': [], 'only-remote': [] };
for (const r of rows) buckets[r.status]?.push(r);

console.log(`\n本地与远端一致：${buckets.same.length} 个`);
const show = (title, list) => {
  if (!list.length) return;
  console.log(`\n${title}（${list.length}）：`);
  for (const r of list) {
    const extra = r.localExists ? `${r.localSize} → ${r.size} 字节` : `远端新增 ${r.size} 字节`;
    console.log(`  ${r.path}  ${extra}`);
  }
};
show('内容不同（远端版本已下载到 build/remote/）', buckets['content-diff']);
show('大小不同（远端版本已下载到 build/remote/）', buckets['size-diff']);
show('只在远端有', buckets['only-remote']);

if (!existsSync(outRoot)) mkdirSync(outRoot, { recursive: true });
writeFileSync(join(outRoot, 'HEAD.json'), JSON.stringify({ sha: head.sha, date: head.commit.author.date, message: head.commit.message }, null, 2));
console.log('\n远端文件已下载到 build/remote/（未改动工作区）');
