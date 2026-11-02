// 把仓库镜像 git文件/ 里的改动同步回工程目录（本地推送后 → 沙箱里跟进）
import fs from 'node:fs'
import path from 'node:path'

const MIRROR = path.resolve('../git文件')
const PROJECT = path.resolve('.')

if (!fs.existsSync(MIRROR)) {
  console.error('✖ 没有 git文件/ 镜像，先跑 node scripts/pull-github.mjs')
  process.exit(1)
}

const changed = []
const walk = (d) => {
  for (const n of fs.readdirSync(d)) {
    const src = path.join(d, n)
    const rel = path.relative(MIRROR, src)
    const dst = path.join(PROJECT, rel)
    if (fs.statSync(src).isDirectory()) { walk(src); continue }
    const a = fs.readFileSync(src)
    const b = fs.existsSync(dst) ? fs.readFileSync(dst) : null
    if (b && Buffer.compare(a, b) === 0) continue
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.writeFileSync(dst, a)
    changed.push(rel.split(path.sep).join('/'))
  }
}
walk(MIRROR)

console.log(changed.length ? `已同步回工程 ${changed.length} 个文件：\n  ${changed.join('\n  ')}` : '工程目录与镜像一致，无需同步')
