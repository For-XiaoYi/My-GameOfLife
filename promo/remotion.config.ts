// Remotion 渲染配置：用本机装的 Chrome，避免它自己去下载 headless shell。
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
Config.setConcurrency(2);

const CHROME = 'U:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
Config.setBrowserExecutable(CHROME);
