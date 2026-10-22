// 自检脚本跑在 Node 上，但没有安装 @types/node —— 这里只声明用到的那几个成员。
declare const process: {
  argv: string[];
  exitCode?: number;
  stdout: { write(chunk: string): boolean };
  cwd(): string;
};
