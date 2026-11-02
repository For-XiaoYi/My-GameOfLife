# 工程文件说明（项目文件\）

> 这里是整个游戏工程。仓库镜像在隔壁 `../git文件\`，上传只从镜像走；根目录只放本机文档。

## 这个目录里的东西

| 路径 | 是什么 |
| --- | --- |
| `src\` | 真正的源码（`main.ts` 界面与交互、`core\` 世界/渲染/存储/图案、`style.css`） |
| `scripts\` | 构建与运维脚本：`build.mjs`、`selftest.ts`、`check.mjs`、`shoot-hero.mjs`、发布三件套（sync/publish/pull） |
| `docs\` | GitHub Pages 出站目录，只有一份构建好的 `index.html` |
| `assets\` | README 截图、宣传片海报/分镜、`promo.mp4`（走 Release，不进仓库树） |
| `promo\` | 宣传片工程（Remotion + 素材）；`promo\out` 是渲染中间产物，不进仓库 |
| `build\` / `dist\` / `node_modules\` / `.pnpm-store\` / `.tools\` | 构建输出与依赖，全部不进仓库 |
| `生命游戏.html` | 单文件成品，双击即玩；由 `scripts\postbuild.mjs` 从 `dist\` 复制 |
| `package.json` | 脚本入口：`build`、`test`、`check`、`sync:repo`、`publish:gh`、`pull:gh`、`check:pages`… |
| `FILES.md`（本文件） | 工程内部地图；根目录的 `索引.md` 是给「整个文件夹」看的 |

## 上传规则（唯一来源：`scripts\publish-rules.mjs`）

- 跳过目录：`node_modules`、`build`、`dist`、`.pnpm-store`、`.git`、`.tools`
- 跳过路径：`promo/out`、`AGENTS.md`、`CLAUDE.md`
- 大文件：`assets/promo.mp4` 走 Release 附件；超过 12 MB 的单文件不进仓库树

## 上传 / 拉取

```bat
cd 项目文件
node scripts\sync-git-files.mjs        :: 按规则刷新 ../git文件（仓库镜像）
node scripts\publish-github.mjs --dry  :: 看文件数/体积
node scripts\publish-github.mjs        :: 推送（或 pnpm publish:gh）
node scripts\pull-github.mjs           :: 拉远端到 ../git文件 做比对，不动工程
```

## 浏览器里的数据

图案库的「自定义」组、快照、片段、界面状态都只存在浏览器 localStorage / IndexedDB；换机器/清缓存就没了，也不会上传。内置图案在 `src\core\pattern-data.ts`，是编译进去的。
