# 生命游戏 · Conway's Game of Life

一个跑在浏览器里的康威生命游戏模拟器：1024×1024 的环形世界、可调迭代速度、预设图案库、
缩放平移、时间回溯、快照存档和演化片段回放。

**在线试玩：** https://for-xiaoyi.github.io/My-GameOfLife/

## 三种打开方式

| 方式 | 怎么做 | 适合 |
| --- | --- | --- |
| **在线版** | 打开上面的链接 | 立刻玩，不用下载 |
| **单文件**（最省事） | 双击根目录的 `生命游戏.html` | 离线玩、发给别人 |
| 开发模式 | `pnpm install` → `pnpm build`（vite 见后文说明） | 改代码 |

`dist/index.html` 和 `生命游戏.html` 是同一份内容，都已经把 JS/CSS 内联进去了。

## 玩法

- **画布**：滚轮缩放（锚在光标处，0.03×–64×）、拖拽平移、双指捏合、`0` 键看全图。
- **演化**：底栏 ▶ 播放/暂停、单步 ⏭、速度滑杆 0.1–120 代/秒，右边 ∞ 是不限速（跑满一帧）。
- **创造**：右侧图案库点一个图案 → 在画布上点一下就放下去；`R` 旋转、`M` 镜像，半透明幽灵
  预览会跟着鼠标走，越界会变红。画笔/橡皮/直线/矩形在左侧工具栏，快捷键 `B E I U S`。
  画的过程中就改世界，松手才记为一步历史。
- **时间回溯**：底栏时间轴可以拖回任意一代，`←/→` 单代微调。生命游戏本身不可逆，所以这里
  记录的是每一代**翻转了哪些格子**（增量编码），每 64 代存一个关键帧，拖动时从最近关键帧重放，
  所以拖到第 1 代和第 2999 代是一样快的。历史深度默认 3000 代，内存上限 32 MB，超了从最老的丢。
  在历史中间按播放，就从那儿重新往下演化，原来的"未来"会被截断。
- **快照**：点「存档 → 保存当前」，连世界、代数、镜头一起记下来，点缩略图就跳回那一刻。
- **片段**：点「● 录制片段」开始录，演化一阵再点「■ 停止」，它就成了库里一段可以播放、
  拖动进度条的小电影。
- **存档位置**：优先 IndexedDB；`file://` 下浏览器不给 IndexedDB 时会自动退回 localStorage。
  换浏览器/清缓存会丢，重要的东西用「存档 → 导出」存成 `.life.json` 文件。

## 快捷键

| 键 | 作用 | 键 | 作用 |
| --- | --- | --- | --- |
| `Space` | 播放 / 暂停 | `B` `E` | 画笔 / 橡皮 |
| `←` `→` | 后退 / 前进一代 | `I` `U` | 直线 / 矩形 |
| `↑` `↓` | 放大 / 缩小 | `S` | 摆放图案 |
| `0` | 适应全图 | `R` `M` | 旋转 / 镜像 |
| `G` | 网格 | `O` | 光晕 |
| `Del` | 清空世界 | | |

## 代码结构

```
src/
  core/      世界与规则（world.ts）、历史/回溯（history.ts）、图案库、RLE、存档
  render/    离屏位图 + 年龄着色的渲染器
  view/      视口变换（缩放/平移/坐标换算）
  main.ts    界面、输入、主循环、各个面板
scripts/
  build.mjs  打包成单文件 HTML（直接用 esbuild 二进制，不经过 vite）
  check.mjs  用 CDP 驱动真浏览器做端到端检查（node scripts/check.mjs）
  selftest.ts 纯 Node 的算法自检（node --experimental-strip-types scripts/selftest.ts）
```

**为什么不用 vite 打包**：这台机器上 pnpm 把 `node_modules/vite` 做成了 junction，Node 从真实
路径往上解析依赖，找不到 vite 的传递依赖（rollup/esbuild）。`scripts/build.mjs` 直接找
`@esbuild/win32-x64` 的 exe 来打包，避开这一层。`pnpm dev`（vite 开发服务器）同样受这个问题
影响，起不来时用 `pnpm build` + 直接打开 HTML 即可。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 类型检查 + 打包出 `dist/index.html` 和根目录的 `生命游戏.html` |
| `pnpm test` | 纯 Node 的算法自检（规则、历史回溯、图案周期、机枪节奏） |
| `pnpm check` | 用 CDP 驱动无头 Chrome 做端到端检查（19 项，含交互与像素断言） |
| `pnpm check:gh` | 检查发布凭据是否仍然有效 |
| `pnpm publish:gh` | 把当前目录同步到 GitHub 仓库（走 Git Data API，不需要装 git） |

发布脚本的凭据放在仓库之外的 `%LOCALAPPDATA%\life-studio\credentials.json`，只有当前用户能读，
不会被提交。想换仓库或换 token，改这个文件即可。

## 在线版本

**https://for-xiaoyi.github.io/My-GameOfLife/**

线上跑的是 `main` 分支里 `docs/` 目录下的 `index.html`（就是那份自包含页面）：

- `pnpm build` 会同时产出 `docs/index.html`
- `pnpm publish:gh` 推上去之后，GitHub 会自动重新构建；脚本也会顺手 `POST /pages/builds` 催一次
- `pnpm check:pages` 验证线上返回 200、体积对得上、页面里是真页面而不是开发入口
- `pnpm check:pages:live` 用无头 Chrome 打开线上地址，真的跑几十代并截图

注意别把仓库根目录的 `index.html` 当成网站入口——它只有 `<script src="/src/main.ts">`，
浏览器解析不了 TS，指向根目录会白屏。所以 Pages 的来源固定为 `/docs`。

如果哪天想改 Pages 配置，`PATCH /repos/{owner}/{repo}/pages` 和"首次创建站点"这几个接口
需要 token 有 `Administration: write`（只给 `pages: write` 会被 403 拒绝，经实测确认），
日常发布用不到，网页上手点更省事。

