// 极简 CDP 驱动：用 Node 自带的 fetch + WebSocket 控制无头 Chrome。
// 之所以不用 --virtual-time-budget：那会让 requestAnimationFrame 几乎不触发，
// 主循环跑不起来，测不出真实行为。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 浏览器安装位置按系统环境变量推导，不把某台机器的绝对路径写进仓库。
// 装在别处时可以设 CHROME_PATH，或往 build/browser-path.txt 写一行可执行文件路径。
function candidateBrowsers() {
  const roots = [
    process.env['ProgramW6432'],
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : null,
  ].filter(Boolean);
  const out = [];
  for (const root of roots) {
    out.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    out.push(join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  for (const dir of (process.env.PATH || '').split(';')) {
    if (dir) out.push(join(dir, 'chrome.exe'), join(dir, 'msedge.exe'));
  }
  return out;
}

export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const p of candidateBrowsers()) {
    if (existsSync(p)) return p;
  }
  const local = join(process.cwd(), 'build', 'browser-path.txt');
  if (existsSync(local)) {
    const p = readFileSync(local, 'utf8').trim();
    if (p && existsSync(p)) return p;
  }
  throw new Error('没找到 Chrome 或 Edge：设 CHROME_PATH 环境变量，或在 build/browser-path.txt 写一行浏览器路径');
}

/** 临时配置目录：系统临时目录不可写时（受限环境）退回 build/tmp。 */
function makeProfileDir() {
  for (const root of [tmpdir(), join(process.cwd(), 'build', 'tmp')]) {
    try {
      mkdirSync(root, { recursive: true });
      return mkdtempSync(join(root, 'life-cdp-'));
    } catch {
      /* 换下一个位置 */
    }
  }
  throw new Error('无法创建临时目录：系统临时目录和 build/tmp 都不可写');
}

export async function launch({ port = 9411, width = 1600, height = 1000 } = {}) {
  const profile = makeProfileDir();
  const proc = spawn(
    findChrome(),
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-breakpad',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-dev-shm-usage',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  let version = null;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) {
        version = await r.json();
        break;
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(150);
  }
  if (!version) throw new Error('Chrome 调试端口没起来');

  async function newPage(url) {
    const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    const t = await r.json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    let id = 0;
    const pending = new Map();
    const logs = [];
    const listeners = new Map();
    const on = (method, cb) => listeners.set(method, cb);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
        return;
      }
      if (msg.method && listeners.has(msg.method)) listeners.get(msg.method)(msg.params);
      if (msg.method === 'Runtime.consoleAPICalled') {
        logs.push(
          `[console.${msg.params.type}] ` +
            msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
        );
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        logs.push(`[exception] ${d.exception?.description ?? d.text}`);
      }
    });
    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      }
      return r.result.value;
    };

    const waitFor = async (expression, timeout = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        try {
          if (await evaluate(expression)) return true;
        } catch {
          /* 页面还没就绪 */
        }
        await sleep(120);
      }
      throw new Error(`等待超时：${expression}`);
    };

    const screenshot = async (path) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
      return path;
    };

    const navigate = async (url) => {
      await send('Page.navigate', { url });
    };

    const close = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };

    return { send, evaluate, waitFor, screenshot, navigate, close, logs, on };
  }

  const close = () => {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  };

  return { newPage, close, port };
}

export { sleep };
