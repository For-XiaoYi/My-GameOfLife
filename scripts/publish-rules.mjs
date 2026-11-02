// 发布规则：哪些文件进仓库树、哪些走 Release。
// publish-github.mjs 与 sync-git-files.mjs 共用这一份，避免两边规则漂移。
export const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.pnpm-store', '.git', '.tools']);
// 整目录 / 整文件跳过：渲染中间产物、本机协作约定（宣传片工程要进仓库，用于沙箱↔本地协同）
export const SKIP_PATHS = new Set(['promo/out', 'AGENTS.md', 'CLAUDE.md']);
// 单文件超过这个体积就不进仓库树（REST blob 上限约 20 MB，留余量）
export const MAX_BLOB = 12 * 1024 * 1024;
// 永远走 Release 附件的成品
export const RELEASE_FILES = ['assets/promo.mp4'];
