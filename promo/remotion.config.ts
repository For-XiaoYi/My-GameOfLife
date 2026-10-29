// Remotion 渲染配置。
// 如果本机装了 Chrome，就用它（省得 Remotion 再去下载 headless shell）；
// 找不到就交给 Remotion 自己准备浏览器，换一台机器也不用改代码。
import { existsSync } from 'node:fs';
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
Config.setConcurrency(2);

const join = (...parts: string[]) => parts.filter(Boolean).join(process.platform === 'win32' ? '\\' : '/');
const WIN_TAILS = [
  join('Google', 'Chrome', 'Application', 'chrome.exe'),
  join('Microsoft', 'Edge', 'Application', 'msedge.exe'),
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  ...WIN_TAILS.map((t) => (process.env.ProgramFiles ? join(process.env.ProgramFiles, t) : '')),
  ...WIN_TAILS.map((t) => (process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], t) : '')),
  ...WIN_TAILS.map((t) => (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, t) : '')),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
});

if (chrome) {
  Config.setBrowserExecutable(chrome);
}
