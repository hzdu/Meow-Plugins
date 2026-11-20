// ssh-real.js — 真实 SSH 终端（xterm.js + 本地 WebSocket 桥接）
// 浏览器扩展不能直接建立 SSH TCP 连接；本文件只负责终端渲染和桥接协议。

(function () {
    'use strict';

    if (!window.Terminal) {
        console.warn('Meow: xterm.js 未加载，真实 SSH 终端不可用');
        return;
    }

    function base64ToBytes(base64) {
        var binary = atob(base64 || '');
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function buildWsUrl(base, token) {
        var url;
        try {
            url = new URL(String(base || '').trim());
        } catch (e) {
            throw new Error('桥接地址格式无效');
        }
        if (url.protocol === 'http:') url.protocol = 'ws:';
        else if (url.protocol === 'https:') url.protocol = 'wss:';
        else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
            throw new Error('桥接地址必须以 ws:// 或 wss:// 开头');
        }
        if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
        url.searchParams.set('token', token || '');
        return url.toString();
    }

    function probe(url, token, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var ws;
            var done = false;
            var timer = setTimeout(function () {
                finish(false, '连接桥接超时，请确认 bridge.js 正在运行');
            }, timeoutMs || 2500);

            function finish(ok, message) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try {
                    if (ws) ws.close();
                } catch (e) { /* ignore */ }
                if (ok) resolve(true);
                else reject(new Error(message || '无法连接桥接'));
            }

            try {
                ws = new WebSocket(buildWsUrl(url, token));
            } catch (err) {
                finish(false, err.message);
                return;
            }

            ws.onopen = function () { finish(true); };
            ws.onerror = function () { finish(false, '桥接未启动、地址错误或令牌不正确'); };
            ws.onclose = function (event) {
                if (done) return;
                finish(false, event && event.code === 1006
                    ? '桥接未启动、地址错误或令牌不正确'
                    : '桥接拒绝连接');
            };
        });
    }

    function createSession(container, options) {
        options = options || {};
        var wrapper = document.createElement('div');
        wrapper.className = 'real-term-instance';
        container.appendChild(wrapper);

        var term = new window.Terminal({
            cursorBlink: true,
            cursorStyle: 'bar',
            fontFamily: '"Cascadia Mono", "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
            fontSize: 12.5,
            lineHeight: 1.3,
            letterSpacing: 0,
            scrollback: 6000,
            convertEol: false,
            allowProposedApi: true,
            theme: {
                background: '#0a0e16',
                foreground: '#dbe4ff',
                cursor: '#a78bfa',
                cursorAccent: '#0a0e16',
                selectionBackground: 'rgba(129, 140, 248, 0.35)',
                black: '#1b2233',
                red: '#fb7185',
                green: '#4ade80',
                yellow: '#fbbf24',
                blue: '#60a5fa',
                magenta: '#c084fc',
                cyan: '#22d3ee',
                white: '#dbe4ff',
                brightBlack: '#64748b',
                brightRed: '#fda4af',
                brightGreen: '#86efac',
                brightYellow: '#fde68a',
                brightBlue: '#93c5fd',
                brightMagenta: '#d8b4fe',
                brightCyan: '#67e8f9',
                brightWhite: '#f8fafc'
            }
        });

        var fitAddon = null;
        if (window.FitAddon && window.FitAddon.FitAddon) {
            fitAddon = new window.FitAddon.FitAddon();
            term.loadAddon(fitAddon);
        }

        term.open(wrapper);
        if (term.element) term.element.classList.add('meow-xterm');

        var ws = null;
        var sessionId = options.id || ('real_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
        var disposed = false;
        var connected = false;
        var intentionallyClosed = false;
        var closeNotified = false;
        var pendingError = null;
        var connectTimer = null;

        function isOpen() {
            return ws && ws.readyState === WebSocket.OPEN;
        }

        function sendJson(payload) {
            if (!isOpen()) return false;
            try {
                ws.send(JSON.stringify(payload));
                return true;
            } catch (e) {
                return false;
            }
        }

        function sendResize() {
            if (!connected) return;
            sendJson({ type: 'resize', id: sessionId, cols: term.cols, rows: term.rows });
        }

        function clearConnectTimer() {
            if (connectTimer) {
                clearTimeout(connectTimer);
                connectTimer = null;
            }
        }

        function fit() {
            if (!fitAddon || disposed) return;
            if (!wrapper.clientWidth || !wrapper.clientHeight) return;
            try {
                fitAddon.fit();
                sendResize();
            } catch (e) { /* hidden or not measurable */ }
        }

        function writeNotice(text, color) {
            var esc = color || '33';
            term.write('\r\n\x1b[' + esc + 'm' + String(text).replace(/\r?\n/g, '\r\n') + '\x1b[0m\r\n');
        }

        term.onData(function (data) {
            if (!connected) return;
            sendJson({ type: 'input', id: sessionId, data: data });
        });

        term.onResize(function () {
            sendResize();
        });

        var resizeObserver = null;
        if (window.ResizeObserver) {
            resizeObserver = new ResizeObserver(function () {
                if (wrapper.classList.contains('active')) fit();
            });
            resizeObserver.observe(wrapper);
        }

        function connect(config) {
            if (disposed) return;
            var url;
            try {
                url = buildWsUrl(config.url, config.token);
            } catch (err) {
                if (options.onError) options.onError(err.message);
                return;
            }

            closeNotified = false;
            pendingError = null;
            if (options.onStatus) options.onStatus('connecting');

            if (connectTimer) clearTimeout(connectTimer);
            connectTimer = setTimeout(function () {
                if (disposed || connected || pendingError) return;
                pendingError = '无法建立到本地 SSH 桥接的连接。请确认 bridge.js 正在运行，且当前页面不是以 file:// 直接打开。';
                if (options.onStatus) options.onStatus('error');
                writeNotice(pendingError, '31');
                if (options.onError) options.onError(pendingError);
                try { if (ws) ws.close(); } catch (e) { /* ignore */ }
            }, 12000);
            try {
                ws = new WebSocket(url);
            } catch (err) {
                if (options.onError) options.onError(err.message);
                return;
            }

            ws.onopen = function () {
                sendJson({
                    type: 'connect',
                    id: sessionId,
                    host: config.host,
                    port: config.port,
                    username: config.username,
                    password: config.password,
                    cols: term.cols || 80,
                    rows: term.rows || 24
                });
            };

            ws.onmessage = function (event) {
                var msg;
                try {
                    msg = JSON.parse(event.data);
                } catch (e) {
                    return;
                }
                if (!msg || msg.id && msg.id !== sessionId) return;

                if (msg.type === 'ready') {
                    if (disposed) return;
                    if (connectTimer) clearTimeout(connectTimer);
                    connected = true;
                    if (options.onStatus) options.onStatus('connected');
                    if (options.onReady) options.onReady();
                    setTimeout(function () {
                        fit();
                        focus();
                    }, 30);
                } else if (msg.type === 'data') {
                    if (disposed) return;
                    try {
                        term.write(base64ToBytes(msg.data));
                    } catch (e) {
                        term.write(String(msg.data || ''));
                    }
                } else if (msg.type === 'hostkey') {
                    if (options.onHostKey) options.onHostKey(msg);
                } else if (msg.type === 'error') {
                    pendingError = msg.message || 'SSH 连接失败';
                    clearConnectTimer();
                    if (options.onStatus) options.onStatus('error');
                    writeNotice(pendingError, '31');
                    if (options.onError) options.onError(pendingError);
                } else if (msg.type === 'closed') {
                    connected = false;
                    clearConnectTimer();
                    if (intentionallyClosed || closeNotified) return;
                    closeNotified = true;
                    if (options.onStatus) options.onStatus('closed');
                    writeNotice('SSH 会话已断开。', '33');
                    if (options.onClose) options.onClose();
                }
            };

            ws.onerror = function () {
                if (disposed || intentionallyClosed) return;
                if (connectTimer) clearTimeout(connectTimer);
                if (!pendingError) {
                    pendingError = '无法连接本地 SSH 桥接，请确认 bridge.js 正在运行，地址和令牌正确。';
                    if (options.onStatus) options.onStatus('error');
                    writeNotice(pendingError, '31');
                    if (options.onError) options.onError(pendingError);
                }
            };

            ws.onclose = function (event) {
                connected = false;
                clearConnectTimer();
                if (disposed || intentionallyClosed || closeNotified) return;
                if (options.onStatus) options.onStatus('closed');
                if (event && event.code !== 1000 && !pendingError) {
                    pendingError = '桥接连接已断开（code ' + event.code + '）。';
                    writeNotice(pendingError, '31');
                    if (options.onError) options.onError(pendingError);
                } else {
                    closeNotified = true;
                    if (options.onClose) options.onClose();
                }
            };
        }

        function setActive(active) {
            wrapper.classList.toggle('active', !!active);
            if (active) {
                setTimeout(fit, 20);
            }
        }

        function send(text) {
            if (!connected || !text) return;
            sendJson({ type: 'input', id: sessionId, data: String(text) });
        }

        function sendLine(text) {
            send(String(text || '').replace(/\r?\n/g, '\r') + '\r');
        }

        function paste(text) {
            if (!connected) return;
            term.paste(String(text || ''));
            focus();
        }

        function clear() {
            term.clear();
        }

        function focus() {
            try { term.focus(); } catch (e) { /* ignore */ }
        }

        function dispose() {
            if (disposed) return;
            disposed = true;
            intentionallyClosed = true;
            connected = false;
            clearConnectTimer();
            try {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'disconnect', id: sessionId }));
                }
            } catch (e) { /* ignore */ }
            try { if (ws) ws.close(); } catch (e) { /* ignore */ }
            if (resizeObserver) {
                try { resizeObserver.disconnect(); } catch (e) { /* ignore */ }
            }
            try { term.dispose(); } catch (e) { /* ignore */ }
            if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        }

        return {
            id: sessionId,
            term: term,
            wrapper: wrapper,
            connect: connect,
            setActive: setActive,
            fit: fit,
            focus: focus,
            send: send,
            sendLine: sendLine,
            paste: paste,
            clear: clear,
            writeNotice: writeNotice,
            dispose: dispose,
            isConnected: function () { return connected; }
        };
    }

    window.MeowSshReal = {
        createSession: createSession,
        probe: probe,
        buildWsUrl: buildWsUrl,
        isSupported: function () {
            return !!(window.Terminal && window.FitAddon && window.FitAddon.FitAddon);
        }
    };
})();
