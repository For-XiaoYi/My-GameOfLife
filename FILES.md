# 文件地图

> 一句话：**源码在 `src/`，成品是 `生命游戏.html` 和 `docs/index.html`，工具在 `scripts/`，宣传片在 `promo/`**；
> `node_modules`、`build`、`dist`、`promo/out`、`AGENTS.md` 不会上传到 GitHub。
> 想核对某个具体文件：`node scripts/inventory.mjs`（输出才是权威清单，本文数字以它为准）。

## 我想……

| 想做的事 | 去这里 |
| --- | --- |
| 玩一局 / 发给别人 | 根目录的 `生命游戏.html`（单文件，双击即开） |
| 看线上版 | `docs/index.html`（GitHub Pages 发布的就是它） |
| 改玩法与交互 | `src/main.ts`（约 160 KB，界面、工具、快捷键都在这里） |
| 改演化规则 / 性能 | `src/core/world.ts`（位并行演化） |
| 改时间回溯 | `src/core/history.ts` |
| 改存档、快照、片段 | `src/core/storage.ts` |
| 改图案库的分类与模型 | `src/core/library.ts`、`src/core/patterns.ts`、`src/core/pattern-data.ts` |
| 改配色与布局 | `src/style.css` |
| 加内置图案 | 写 `tools/patterns/*.rle` → `node scripts/gen-patterns.mjs` |
| 改宣传片 | `promo/src/`，见 README「在自己电脑上改这支片子」 |
| 重出宣传片里的图灵机 PNG | `node scripts/render-rle-png.mjs tools/patterns/turingmachine.rle promo/public/pattern-turing.png --width=1280` |
| 发版 / 验证 token | `node scripts/publish-github.mjs`（`--check` 只验证，`--dry` 只列文件不推） |
| 查某个文件会不会上传 | `node scripts/inventory.mjs` |
| 跑自检 | `node --experimental-strip-types scripts/selftest.ts`；浏览器端到端 `node scripts/check.mjs` |

## 目录

| 目录 | 放什么 | 文件数 | 上传 |
| --- | --- | --- | --- |
| `src/` | 游戏源码：入口与界面、演化、回溯、渲染、存储、图案 | 11 | ✅ |
| `src/core/` `src/render/` `src/view/` | 依次是规则核心、离屏渲染、相机换算 | — | ✅ |
| `scripts/` | 构建、自检、发布、CDP 截图、宣传片脚本 | 22 | ✅ |
| `tools/patterns/` | 20 个内置图案的 RLE + 1 个宣传片专用的图灵机；`gen-patterns.mjs` 只认 META 里列出的内置图案 | 21 | ✅ |
| `assets/` | README 与发布页的图：截图、海报、分镜图；宣传片成片也在这一层 | 4 | ✅（成片走 Release） |
| `docs/` | GitHub Pages 产物，构建自动生成，**不要手改** | 1 | ✅ |
| `promo/` | Remotion 宣传片工程：场景、组件、素材、配乐、动态 Life 片段；`public/pattern-turing.png`、`grand-*.png`、`spacefiller-seed.png` 由 RLE 生成 | 63 | ✅ |
| `promo/out/` | 渲染中间产物（抽帧、storyboard、测试视频），可随时删 | 45 | ❌ |
| `promo/node_modules/` | 宣传片依赖 | — | ❌ |

## 根目录文件

| 文件 | 作用 | 上传 |
| --- | --- | --- |
| `生命游戏.html` | 单文件成品，构建生成 | ✅ |
| `docs/index.html` | Pages 版成品 | ✅ |
| `index.html` | 开发入口（只在 Vite dev 时用） | ✅ |
| `package.json` / `pnpm-lock.yaml` | 依赖与脚本 | ✅ |
| `tsconfig.json` / `vite.config.ts` | TS 与打包配置 | ✅ |
| `README.md` | 对外说明 | ✅ |
| `FILES.md` | 本文件 | ✅ |
| `.gitignore` | git 忽略规则（只管 git，发布脚本另有规则） | ✅ |
| `.npmrc` | pnpm 扁平 `node_modules` 设置 | ✅ |
| `AGENTS.md` | 本机 AI 协作约定，只给本地会话读 | ❌ |

## 哪些会上传：规则在 `scripts/publish-github.mjs`

1. 从工作区根目录递归遍历所有文件；
2. **整目录跳过**：`node_modules` `build` `dist` `.pnpm-store` `.git` `.tools`；
3. **路径跳过**：`promo/out`、`AGENTS.md`、`CLAUDE.md`；
4. **体积策略**：单文件超过 12 MB 不进仓库树，改走 Release 附件；`assets/promo.mp4` 固定走 Release（否则每次 clone 都要拖一个大视频）；
5. 规则一改，同步 `scripts/inventory.mjs` 顶部的常量，否则它末尾会报「规则漂移」。

按现状：工作区 **132** 个文件，**130** 个会上传（约 31.8 MB），1 个走 Release 附件、1 个是超过 12 MB 的配乐 wav 中间产物（入库的是 `score.mp3`）。
上传是全量重传（每次重新上传所有 blob），一次约 2–3 分钟——后续会改成只传变化的文件。

## 不在文件树里的东西（浏览器本地数据）

这些**既不会上传，也不会出现在任何文件夹里**，只存在浏览器里：

- localStorage / IndexedDB：自动存档、快照（时刻）、片段（时段）、自定义图案、界面状态；
- 换浏览器或清缓存就会丢，重要的画面请存 PNG 或者复制分享链接；
- 发布用的 token：`%LOCALAPPDATA%\life-studio\credentials.json`（仅本机，绝不进仓库）。

## 找文件的几条命令

```powershell
# 按文件名找
Get-ChildItem -Recurse -File | Where-Object { $_.Name -like '*renderer*' }

# 按内容找
Select-String -Path src\*.ts, src\core\*.ts -Pattern 'glow' -Encoding utf8

# 权威清单：谁会上传、谁不会、各占多大
node scripts/inventory.mjs

# 谁最占地方
Get-ChildItem -Recurse -File | Sort-Object Length -Descending | Select-Object -First 15
```

## 维护

目录结构或上传规则变化时：先改 `scripts/inventory.mjs` 的 `NOTES` / 规则常量，跑一次核对，
再同步本页。本页只写「人和规则」，逐文件的权威信息永远以脚本输出为准。
