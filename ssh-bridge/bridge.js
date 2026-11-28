#!/usr/bin/env node
'use strict';

// Meow SSH Bridge —— 命令行入口。
// 托盘 exe（app/MeowSshBridge.cs 编译产物）与这里共用 bridge-core.js：
// 在 127.0.0.1 上提供 WebSocket 接口，用 ssh2 登录真实服务器，
// 并把 PTY 数据转发给扩展里的 xterm.js。
//
// 不想看到命令行窗口时，请使用 desktop 目录打包出的 Meow-SSH-Bridge.exe。

const path = require('path');
const { createBridge } = require('./bridge-core');

const bridge = createBridge({
    dataDir: __dirname,
    port: Number(process.env.MEOW_SSH_PORT || 8765),
    logFile: path.join(__dirname, 'bridge.log'),
    onLog: (level, text) => {
        if (level === 'error') {
            console.error('[meow-ssh] ' + text);
            return;
        }
        console.log('[meow-ssh] ' + text);
    }
});

function shutdown() {
    if (shutdown.started) return;
    shutdown.started = true;
    console.log('\n[meow-ssh] 正在停止...');
    bridge.stop().then(() => process.exit(0), () => process.exit(0));
    setTimeout(() => process.exit(0), 600);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

bridge.start().then((status) => {
    console.log('');
    console.log('  Meow SSH Bridge');
    console.log('  ------------------------------');
    console.log('  地址:  ' + status.address);
    console.log('  令牌:  ' + status.token);
    console.log('');
    console.log('  在 Meow 大日历 → SSH → 右上角插头按钮中填写以上地址和令牌。');
    console.log('  令牌也保存在: ' + status.tokenFile);
    console.log('  按 Ctrl+C 停止桥接。');
    console.log('');
}, () => {
    process.exit(1);
});
