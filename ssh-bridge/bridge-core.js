'use strict';

// Meow SSH Bridge 核心服务。
// 命令行入口（../bridge.js）和桌面托盘程序（./main.js）共用这一份实现，
// 保证两种启动方式对外暴露的 WebSocket 协议、令牌和主机指纹校验完全一致。
//
// 安全边界：
// - 只监听 127.0.0.1，不监听局域网地址
// - 必须携带启动时生成（或 MEOW_SSH_TOKEN 指定）的访问令牌
// - 首次连接某个 host:port 时记录主机公钥指纹（TOFU），之后指纹变化会拒绝连接
// - 密码只保存在内存中，不写日志、不落盘

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { Client } = require('ssh2');

const MAX_SESSIONS_PER_SOCKET = 6;
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const TOKEN_FILE_NAME = '.bridge-token';
const KNOWN_HOSTS_FILE_NAME = 'known_hosts.json';

function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function fingerprint(key) {
    return 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}

function friendlyError(err, session) {
    if (session && session.hostKeyMismatch) {
        return '主机公钥指纹与上次记录不一致，已拒绝连接。\n' +
            '期望: ' + session.hostKeyMismatch.expected + '\n' +
            '实际: ' + session.hostKeyMismatch.actual + '\n' +
            '如果服务器确实更换了密钥，请删除 known_hosts.json 中对应条目后重试。';
    }
    const message = String(err && err.message || err || '未知错误');
    const level = err && err.level;
    if (level === 'client-authentication' || /authentication/i.test(message)) {
        return 'SSH 认证失败，请检查用户名和密码。';
    }
    if (level === 'client-timeout' || /timed out/i.test(message)) {
        return '连接服务器超时，请检查地址、端口和网络。';
    }
    if (/ECONNREFUSED/i.test(message)) {
        return '服务器拒绝连接，请检查 SSH 端口是否开放。';
    }
    if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
        return '无法解析服务器地址，请检查主机名。';
    }
    if (/Host denied|verification failed/i.test(message)) {
        return '服务器主机密钥验证失败。';
    }
    return message;
}

function cleanupSession(session) {
    if (!session || session.finished) return;
    session.finished = true;
    if (session.timer) clearTimeout(session.timer);
    try {
        if (session.stream) session.stream.end();
    } catch (err) { /* ignore */ }
    try {
        if (session.client) session.client.end();
    } catch (err) { /* ignore */ }
    // end() 在握手未完成时不一定会立即释放 socket；强制销毁，避免服务器
    // 留下半开连接或端口/连接数占用，导致下一次连接被拒绝。
    try {
        if (session.client) session.client.destroy();
    } catch (err) { /* ignore */ }
}

class SshBridge {
    constructor(options) {
        const opts = options || {};
        this.host = '127.0.0.1';
        this.port = clampInt(opts.port || process.env.MEOW_SSH_PORT || 8765, 1, 65535, 8765);
        this.dataDir = opts.dataDir || process.cwd();
        this.logFile = opts.logFile || null;
        this.onLog = typeof opts.onLog === 'function' ? opts.onLog : null;
        this.onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;

        this.tokenFile = path.join(this.dataDir, TOKEN_FILE_NAME);
        this.knownHostsFile = path.join(this.dataDir, KNOWN_HOSTS_FILE_NAME);

        this.token = null;
        this.knownHosts = {};
        this.httpServer = null;
        this.wss = null;
        this.listening = false;
        this.startedAt = null;
        this.sessions = 0;
        this.stopping = false;
    }

    get address() {
        return 'ws://' + this.host + ':' + this.port;
    }

    status() {
        return {
            listening: this.listening,
            host: this.host,
            port: this.port,
            address: this.address,
            token: this.token || '',
            tokenFile: this.tokenFile,
            knownHostsFile: this.knownHostsFile,
            dataDir: this.dataDir,
            sessions: this.sessions,
            startedAt: this.startedAt
        };
    }

    emitStatus() {
        if (!this.onStatus) return;
        try {
            this.onStatus(this.status());
        } catch (err) { /* ignore */ }
    }

    log(level, text) {
        const levelName = level || 'info';
        if (this.onLog) {
            try {
                this.onLog(levelName, text);
            } catch (err) { /* ignore */ }
        }
        if (this.logFile) {
            try {
                fs.appendFileSync(this.logFile, new Date().toISOString() + ' [' + levelName + '] ' + text + '\r\n');
            } catch (err) { /* ignore */ }
        }
    }

    ensureDataDir() {
        try {
            fs.mkdirSync(this.dataDir, { recursive: true });
        } catch (err) {
            this.log('warn', '无法创建数据目录 ' + this.dataDir + '：' + err.message);
        }
        if (!fs.existsSync(this.dataDir)) {
            this.log('warn', '数据目录不存在：' + this.dataDir);
        }
    }

    loadToken() {
        if (process.env.MEOW_SSH_TOKEN) return String(process.env.MEOW_SSH_TOKEN);
        try {
            const saved = fs.readFileSync(this.tokenFile, 'utf8').trim();
            if (saved) return saved;
        } catch (err) { /* create below */ }

        const token = crypto.randomBytes(24).toString('base64url');
        try {
            fs.writeFileSync(this.tokenFile, token + '\n', { mode: 0o600 });
        } catch (err) {
            this.log('warn', '无法保存令牌文件 ' + this.tokenFile + '：' + err.message);
        }
        return token;
    }

    loadKnownHosts() {
        let value = {};
        try {
            value = JSON.parse(fs.readFileSync(this.knownHostsFile, 'utf8'));
        } catch (err) {
            value = {};
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            this.log('error', 'known_hosts.json 格式错误，应为 JSON 对象');
            value = {};
        }
        this.knownHosts = value;
    }

    saveKnownHosts() {
        try {
            const tmp = this.knownHostsFile + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this.knownHosts, null, 2), { mode: 0o600 });
            fs.renameSync(tmp, this.knownHostsFile);
        } catch (err) {
            this.log('warn', '无法保存 known_hosts.json：' + err.message);
        }
    }

    countSessions(delta) {
        this.sessions = Math.max(0, this.sessions + delta);
        this.emitStatus();
    }

    send(ws, payload) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
        }
    }

    createHttpServer() {
        const httpServer = http.createServer((req, res) => {
            if (req.method === 'GET' && req.url === '/health') {
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    ok: true,
                    name: 'meow-ssh-bridge',
                    version: 1,
                    sessions: this.sessions
                }));
                return;
            }
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Not found');
        });
        return httpServer;
    }

    createWebSocketServer() {
        const wss = new WebSocketServer({
            noServer: true,
            maxPayload: MAX_MESSAGE_BYTES,
            perMessageDeflate: false
        });

        this.httpServer.on('upgrade', (req, socket, head) => {
            let url;
            try {
                url = new URL(req.url, 'http://127.0.0.1');
            } catch (err) {
                socket.destroy();
                return;
            }

            if (url.pathname !== '/ws' || !safeEqual(url.searchParams.get('token') || '', this.token)) {
                socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }

            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        });

        wss.on('connection', (ws) => this.handleConnection(ws));
        return wss;
    }

    handleConnection(ws) {
        const sessions = new Map();
        let alive = true;
        const self = this;

        ws.on('pong', () => { alive = true; });
        const heartbeat = setInterval(() => {
            if (!alive) {
                ws.terminate();
                return;
            }
            alive = false;
            try { ws.ping(); } catch (err) { /* ignore */ }
        }, 30000);

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(String(raw));
            } catch (err) {
                self.send(ws, { type: 'error', message: '桥接收到无效消息。' });
                return;
            }
            if (!msg || typeof msg !== 'object') return;

            if (msg.type === 'connect') {
                const id = String(msg.id || '');
                if (!id || sessions.has(id)) {
                    self.send(ws, { type: 'error', id, message: '会话 ID 无效或重复。' });
                    return;
                }
                if (sessions.size >= MAX_SESSIONS_PER_SOCKET) {
                    self.send(ws, { type: 'error', id, message: '同时打开的 SSH 会话过多（最多 6 个）。' });
                    return;
                }

                const host = String(msg.host || '').trim();
                const username = String(msg.username || '').trim();
                const password = String(msg.password == null ? '' : msg.password);
                const port = clampInt(msg.port, 1, 65535, 22);
                const cols = clampInt(msg.cols, 2, 500, 80);
                const rows = clampInt(msg.rows, 1, 200, 24);

                if (!host || !username || !password) {
                    self.send(ws, { type: 'error', id, message: '主机、用户名和密码不能为空。' });
                    return;
                }

                const hostId = host + ':' + port;
                self.log('info', '连接 ' + username + '@' + hostId);
                const session = {
                    id,
                    client: null,
                    stream: null,
                    host,
                    port,
                    username,
                    hostKey: null,
                    hostKeyMismatch: null,
                    finished: false,
                    timer: null
                };
                sessions.set(id, session);
                self.countSessions(1);

                const drop = () => {
                    if (sessions.delete(id)) self.countSessions(-1);
                };

                const client = new Client();
                session.client = client;

                client.on('ready', () => {
                    if (session.finished) return;
                    self.log('info', 'SSH 认证成功 ' + username + '@' + hostId);

                    if (session.hostKey) {
                        const isNewHostKey = !self.knownHosts[hostId];
                        if (isNewHostKey) {
                            self.knownHosts[hostId] = session.hostKey;
                            self.saveKnownHosts();
                            self.log('info', '记录主机指纹 ' + hostId + ' → ' + session.hostKey);
                        }
                        self.send(ws, {
                            type: 'hostkey',
                            id,
                            hostId,
                            fingerprint: session.hostKey,
                            isNew: isNewHostKey
                        });
                    }

                    client.shell({
                        term: 'xterm-256color',
                        cols: cols,
                        rows: rows,
                        width: 0,
                        height: 0
                    }, (err, stream) => {
                        if (err) {
                            self.send(ws, { type: 'error', id, message: friendlyError(err, session) });
                            cleanupSession(session);
                            drop();
                            return;
                        }
                        if (session.finished) {
                            try { stream.end(); } catch (e) { /* ignore */ }
                            return;
                        }

                        session.stream = stream;
                        self.send(ws, { type: 'ready', id });

                        stream.on('data', (chunk) => {
                            self.send(ws, { type: 'data', id, data: Buffer.from(chunk).toString('base64') });
                        });
                        stream.stderr.on('data', (chunk) => {
                            self.send(ws, { type: 'data', id, data: Buffer.from(chunk).toString('base64') });
                        });
                        stream.on('close', () => {
                            if (session.finished) return;
                            self.send(ws, { type: 'closed', id });
                            self.log('info', '会话结束 ' + username + '@' + hostId);
                            cleanupSession(session);
                            drop();
                        });
                    });
                });

                client.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
                    finish([password]);
                });

                client.on('error', (err) => {
                    self.log('error', '连接失败 ' + username + '@' + hostId + '：' + (err && err.message));
                    if (session.finished) return;
                    self.send(ws, { type: 'error', id, message: friendlyError(err, session) });
                    cleanupSession(session);
                    drop();
                });

                client.on('close', () => {
                    if (session.finished) return;
                    self.send(ws, { type: 'closed', id });
                    cleanupSession(session);
                    drop();
                });

                try {
                    client.connect({
                        host,
                        port,
                        username,
                        password,
                        readyTimeout: 25000,
                        keepaliveInterval: 15000,
                        keepaliveCountMax: 3,
                        tryKeyboard: true,
                        hostVerifier: (key) => {
                            const fp = fingerprint(key);
                            session.hostKey = fp;
                            const known = self.knownHosts[hostId];
                            if (known && known !== fp) {
                                session.hostKeyMismatch = { expected: known, actual: fp };
                                self.log('error', '主机指纹不一致 ' + hostId + '：期望 ' + known + '，实际 ' + fp);
                                return false;
                            }
                            return true;
                        }
                    });
                } catch (err) {
                    self.send(ws, { type: 'error', id, message: friendlyError(err, session) });
                    cleanupSession(session);
                    drop();
                }
                return;
            }

            if (msg.type === 'input') {
                const session = sessions.get(String(msg.id || ''));
                if (!session || !session.stream || session.finished) return;
                const data = typeof msg.data === 'string' ? msg.data : '';
                if (!data) return;
                try {
                    session.stream.write(data);
                } catch (err) {
                    self.send(ws, { type: 'error', id: session.id, message: '写入 SSH 终端失败: ' + err.message });
                }
                return;
            }

            if (msg.type === 'resize') {
                const session = sessions.get(String(msg.id || ''));
                if (!session || !session.stream || session.finished) return;
                const cols = clampInt(msg.cols, 2, 500, 80);
                const rows = clampInt(msg.rows, 1, 200, 24);
                try {
                    session.stream.setWindow(rows, cols, 0, 0);
                } catch (err) { /* ignore */ }
                return;
            }

            if (msg.type === 'disconnect') {
                const session = sessions.get(String(msg.id || ''));
                if (!session) return;
                cleanupSession(session);
                self.send(ws, { type: 'closed', id: session.id });
                if (sessions.delete(session.id)) self.countSessions(-1);
                return;
            }

            if (msg.type === 'ping') {
                self.send(ws, { type: 'pong', id: msg.id });
            }
        });

        const closeSocket = () => {
            clearInterval(heartbeat);
            for (const session of sessions.values()) cleanupSession(session);
            const count = sessions.size;
            sessions.clear();
            if (count) self.countSessions(-count);
        };

        ws.on('close', closeSocket);
        ws.on('error', closeSocket);
    }

    // 端口被上一个实例短暂占用时重试，返回 Promise。
    async start() {
        this.ensureDataDir();
        this.stopping = false;
        this.token = this.loadToken();
        this.loadKnownHosts();

        this.httpServer = this.createHttpServer();
        this.wss = this.createWebSocketServer();

        let attempt = 0;
        const listen = () => new Promise((resolve, reject) => {
            const onListening = () => {
                this.httpServer.removeListener('error', onError);
                resolve();
            };
            const onError = (err) => {
                this.httpServer.removeListener('error', onError);
                this.httpServer.removeListener('listening', onListening);
                if (err && err.code === 'EADDRINUSE' && attempt < 10) {
                    attempt += 1;
                    this.log('warn', '端口 ' + this.port + ' 仍被上一个桥接实例占用，等待其退出（' + attempt + '/10）...');
                    setTimeout(() => listen().then(resolve, reject), 300);
                    return;
                }
                if (err && err.code === 'EADDRINUSE') {
                    const error = new Error('端口 ' + this.port + ' 已被占用，请关闭占用该端口的程序，或在上方改用其它端口。');
                    error.code = 'EADDRINUSE';
                    this.log('error', error.message);
                    reject(error);
                    return;
                }
                this.log('error', '启动失败：' + (err && err.message));
                reject(err);
            };

            // 显式管理两个监听器：重试时不会累积，避免 Node 报 MaxListenersExceededWarning。
            this.httpServer.once('error', onError);
            this.httpServer.once('listening', onListening);
            this.httpServer.listen(this.port, this.host);
        });

        await listen();

        this.listening = true;
        this.startedAt = Date.now();
        this.log('success', '桥接已启动，监听 ' + this.address);
        this.emitStatus();
        return this.status();
    }

    async stop() {
        if (this.stopping) return;
        this.stopping = true;
        this.listening = false;

        if (this.wss) {
            for (const client of this.wss.clients) {
                try { client.terminate(); } catch (err) { /* ignore */ }
            }
            try { this.wss.close(); } catch (err) { /* ignore */ }
            this.wss = null;
        }

        const httpServer = this.httpServer;
        this.httpServer = null;
        this.sessions = 0;

        if (httpServer) {
            if (typeof httpServer.closeAllConnections === 'function') {
                try { httpServer.closeAllConnections(); } catch (err) { /* ignore */ }
            }
            await new Promise((resolve) => {
                let done = false;
                const finish = () => {
                    if (done) return;
                    done = true;
                    resolve();
                };
                try {
                    httpServer.close(finish);
                } catch (err) {
                    finish();
                }
                // 不等待 WebSocket 关闭握手；尽快释放端口，避免紧接着重启时 EADDRINUSE。
                setTimeout(finish, 300);
            });
        }

        this.log('warn', '桥接已停止');
        this.emitStatus();
    }

    async restart(nextPort) {
        await this.stop();
        if (nextPort) this.port = clampInt(nextPort, 1, 65535, this.port);
        this.stopping = false;
        return this.start();
    }
}

module.exports = { SshBridge, createBridge: (options) => new SshBridge(options) };
