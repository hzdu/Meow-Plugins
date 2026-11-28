#!/usr/bin/env node
'use strict';

// Meow SSH Bridge —— 单文件 exe 的入口（由 esbuild 打包后注入 Node SEA）。
// 与 bridge.js 共用 bridge-core.js，所以协议、令牌和指纹校验完全一致。
//
// 用法：
//   bridge.exe --port 8765 --data-dir "C:\Users\me\AppData\Local\MeowSshBridge"
// 环境变量 MEOW_SSH_PORT / MEOW_SSH_TOKEN 仍然有效。
//
// 输出约定（供托盘程序解析）：
//   [info] / [success] / [warn] / [error]  运行日志
//   [meow-bridge-ready] address=ws://127.0.0.1:8765 token=xxxx  启动完成

const path = require('path');
const os = require('os');
const { createBridge } = require('../bridge-core.js');

function readArg(name) {
    const argv = process.argv.slice(2);
    const prefix = '--' + name + '=';
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--' + name) {
            const next = argv[i + 1];
            if (next && !next.startsWith('--')) return next;
            return '';
        }
        if (argv[i].startsWith(prefix)) return argv[i].slice(prefix.length);
    }
    return '';
}

const port = Number(readArg('port') || process.env.MEOW_SSH_PORT || 8765);
const dataDir = readArg('data-dir') || path.join(os.homedir(), '.meow-ssh-bridge');
const logFile = readArg('log-file') || path.join(dataDir, 'bridge.log');

function write(level, text) {
    const stream = (level === 'error' || level === 'warn') ? process.stderr : process.stdout;
    const body = String(text == null ? '' : text);
    for (const line of body.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            stream.write('[' + level + '] ' + line + '\n');
        } catch (err) { /* 父进程已退出 */ }
    }
}

const bridge = createBridge({
    dataDir,
    port,
    logFile,
    onLog: (level, text) => write(level, text)
});

process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

function shutdown() {
    if (shutdown.started) return;
    shutdown.started = true;
    bridge.stop().then(() => process.exit(0), () => process.exit(0));
    setTimeout(() => process.exit(0), 800);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

// 宿主程序（托盘 exe）通过 stdin 发送 quit 让桥接优雅退出，
// 这样正在运行的 SSH 会话会先被清理，端口也能立刻释放。
// 宿主进程如果被强杀，stdin 管道会关闭（end/close），同样触发退出，
// 避免留下占着端口的孤儿进程。
try {
    process.stdin.on('data', (chunk) => {
        if (String(chunk).toLowerCase().indexOf('quit') >= 0) shutdown();
    });
    process.stdin.on('end', shutdown);
    process.stdin.on('close', shutdown);
    process.stdin.on('error', shutdown);
    process.stdin.resume();
} catch (err) { /* 无管道时忽略 */ }

// 兜底：父进程消失时主动退出（进程被强杀时管道事件偶尔来不及触发）。
const parentPid = process.ppid;
if (parentPid && parentPid > 0) {
    const watchdog = setInterval(() => {
        try {
            process.kill(parentPid, 0);
        } catch (err) {
            shutdown();
        }
    }, 10000);
    if (typeof watchdog.unref === 'function') watchdog.unref();
}

bridge.start().then((status) => {
    process.stdout.write('[meow-bridge-ready] address=' + status.address +
        ' token=' + status.token +
        ' data-dir=' + status.dataDir + '\n');
}, (err) => {
    write('error', '桥接启动失败：' + (err && err.message ? err.message : err));
    process.exit(1);
});
