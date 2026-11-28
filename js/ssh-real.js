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

    // 终端目录来源的优先级：OSC 7 最可靠，其次是 shell 提示符，最后是窗口标题。
    // 有些服务器（例如 CyberPanel）只在登录时设置一次标题，之后 cd 不会更新标题，
    // 因此不能让标题覆盖从提示符解析出的目录。
    function cwdSourceRank(source) {
        if (source === 'osc7') return 3;
        if (source === 'prompt') return 2;
        if (source === 'title') return 1;
        return 0;
    }

    function normalizeCwd(value) {
        var text = String(value == null ? '' : value).replace(/[\r\n]/g, '').trim();
        if (!text || text.length > 4096) return '';
        if (text.charAt(0) === '~' || text.charAt(0) === '/') return text;
        if (/^[A-Za-z]:[\\/]/.test(text)) return text;
        return '';
    }

    function cwdFromOsc7(data) {
        var text = String(data || '');
        var match = /^file:\/\/[^\/]*(\/.*)$/.exec(text);
        if (!match) return '';
        var value = match[1];
        try { value = decodeURIComponent(value); } catch (e) { /* keep raw */ }
        return normalizeCwd(value);
    }

    function cwdFromTitle(title) {
        var text = String(title || '').trim();
        if (!text) return '';
        var colon = text.lastIndexOf(':');
        var candidate = (colon >= 0 ? text.slice(colon + 1) : text).trim();
        candidate = candidate
            .replace(/\s+\([^)]*\)\s*$/, '')
            .replace(/\s+-\s+.*$/, '')
            .replace(/[#$%*]+\s*$/, '')
            .trim();
        return normalizeCwd(candidate);
    }

    function cwdFromPrompt(text) {
        text = String(text || '').trim();
        // 只有包含 user@host 的典型 shell 提示符才解析，避免把普通输出误认为是目录。
        if (text.indexOf('@') === -1) return '';

        var end = /[#$%\u276f\u279c](?=\s|$)/.exec(text);
        if (!end) return '';

        var prefix = text.slice(0, end.index).replace(/[\])}]+\s*$/, '').trim();
        var colon = prefix.lastIndexOf(':');
        if (colon >= 0) {
            var candidate = prefix.slice(colon + 1).trim();
            candidate = candidate
                .replace(/\s+\([^)]*\)\s*$/, '')
                .replace(/\s+-\s+.*$/, '')
                .replace(/[\])}]+$/, '')
                .trim();
            var fromColon = normalizeCwd(candidate);
            if (fromColon) return fromColon;
        }

        var parts = prefix.split(/\s+/);
        for (var i = parts.length - 1; i >= 0; i--) {
            var token = parts[i]
                .replace(/^[\[({]+/, '')
                .replace(/[\])}]+$/, '');
            var value = normalizeCwd(token);
            if (value) return value;
        }
        return '';
    }

    // xterm 默认把按下位置四舍五入到最近的字符中心。鼠标落在字符右半边时，
    // 选区起点会跳到下一个字符，复制长命令时就会少掉首字符。这里在拖选结束后
    // 根据真实按下/松开位置重新计算一次选区，确保首尾字符都被包含；不改变
    // xterm 的鼠标上报和普通单击行为。
    function installSelectionCorrection(term) {
        if (!term || !term.element) return null;
        var screen = term.element.querySelector('.xterm-screen');
        if (!screen) return null;
        var drag = null;
        var applyTimer = null;

        function pointToCell(event, isEnd) {
            var render = term._core && term._core._renderService;
            var dims = render && render.dimensions && render.dimensions.css;
            var cell = dims && dims.cell;
            if (!cell || !(cell.width > 0) || !(cell.height > 0)) return null;
            var rect = screen.getBoundingClientRect();
            var style = window.getComputedStyle(screen);
            var padLeft = parseFloat(style.paddingLeft) || 0;
            var padTop = parseFloat(style.paddingTop) || 0;
            var maxCol = isEnd ? term.cols : term.cols - 1;
            var rawCol = Math.floor((event.clientX - rect.left - padLeft + 0.5) / cell.width);
            var rawRow = Math.floor((event.clientY - rect.top - padTop + 0.5) / cell.height);
            var viewportY = term.buffer && term.buffer.active ? (term.buffer.active.viewportY || 0) : 0;
            return {
                col: Math.min(Math.max(rawCol, 0), maxCol),
                row: Math.min(Math.max(rawRow, 0), term.rows - 1) + viewportY
            };
        }

        function removeDocumentListeners() {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
        }

        function onMove(event) {
            if (!drag) return;
            var point = pointToCell(event, true);
            if (point) {
                drag.moved = true;
                drag.end = point;
            }
        }

        function onUp(event) {
            if (!drag) return;
            var current = drag;
            drag = null;
            removeDocumentListeners();
            var point = pointToCell(event, true);
            if (point) current.end = point;
            if (!current.moved) return;
            var viewportY = term.buffer && term.buffer.active ? (term.buffer.active.viewportY || 0) : 0;
            // 拖动触发自动滚动时不覆盖 xterm 已经选中的跨屏范围。
            if (viewportY !== current.viewportY) return;
            var rect = screen.getBoundingClientRect();
            if (event.clientY < rect.top || event.clientY > rect.bottom) return;
            applyTimer = setTimeout(function () {
                applyTimer = null;
                var a = current.start;
                var b = current.end;
                var forward = b.row > a.row || (b.row === a.row && b.col >= a.col);
                var start = forward ? a : b;
                var end = forward ? b : a;
                var endCol = Math.min(end.col + 1, term.cols);
                var length = (end.row - start.row) * term.cols + (endCol - start.col);
                if (length > 0) term.select(start.col, start.row, length);
            }, 0);
        }

        function onDown(event) {
            if (event.button !== 0 || event.detail !== 1 || event.shiftKey || event.altKey) {
                drag = null;
                return;
            }
            if (term.modes && term.modes.mouseTrackingMode !== 'none') {
                drag = null;
                return;
            }
            if (applyTimer) {
                clearTimeout(applyTimer);
                applyTimer = null;
            }
            var point = pointToCell(event, false);
            if (!point) {
                drag = null;
                return;
            }
            var viewportY = term.buffer && term.buffer.active ? (term.buffer.active.viewportY || 0) : 0;
            drag = { start: point, end: point, moved: false, viewportY: viewportY };
            document.addEventListener('mousemove', onMove, true);
            document.addEventListener('mouseup', onUp, true);
        }

        screen.addEventListener('mousedown', onDown, false);

        return {
            dispose: function () {
                screen.removeEventListener('mousedown', onDown, false);
                drag = null;
                removeDocumentListeners();
                if (applyTimer) {
                    clearTimeout(applyTimer);
                    applyTimer = null;
                }
            }
        };
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
        var selectionFix = installSelectionCorrection(term);

        var ws = null;
        var sessionId = options.id || ('real_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
        var disposed = false;
        var connected = false;
        var intentionallyClosed = false;
        var closeNotified = false;
        var pendingError = null;
        var connectTimer = null;
        var cwd = '';
        var cwdSource = '';
        var cwdScanTimer = null;
        var cwdOscHandler = null;
        var cwdTitleListener = null;
        var cwdWriteListener = null;

        function setCwd(next, source) {
            var value = normalizeCwd(next);
            if (!value) return;
            var rank = cwdSourceRank(source);
            var currentRank = cwdSourceRank(cwdSource);
            if (rank < currentRank) return;
            if (value === cwd) {
                if (rank > currentRank) cwdSource = source;
                return;
            }
            cwd = value;
            cwdSource = source;
            if (options.onCwd) {
                try { options.onCwd(cwd, source); } catch (e) { /* ignore */ }
            }
        }

        function scanPromptCwd() {
            if (disposed || !connected) return;
            try {
                var buffer = term.buffer.active;
                if (!buffer || (buffer.type && buffer.type !== 'normal')) return;
                var line = buffer.getLine(buffer.baseY + buffer.cursorY);
                if (!line) return;
                var value = cwdFromPrompt(line.translateToString(true));
                if (value) setCwd(value, 'prompt');
            } catch (e) { /* terminal not ready */ }
        }

        function scheduleCwdScan() {
            if (disposed || cwdScanTimer) return;
            cwdScanTimer = setTimeout(function () {
                cwdScanTimer = null;
                scanPromptCwd();
            }, 60);
        }

        if (term.parser && typeof term.parser.registerOscHandler === 'function') {
            try {
                cwdOscHandler = term.parser.registerOscHandler(7, function (data) {
                    var value = cwdFromOsc7(data);
                    if (value) setCwd(value, 'osc7');
                    return true;
                });
            } catch (e) { /* optional API */ }
        }

        if (typeof term.onTitleChange === 'function') {
            cwdTitleListener = term.onTitleChange(function (title) {
                var value = cwdFromTitle(title);
                if (value) setCwd(value, 'title');
            });
        }

        if (typeof term.onWriteParsed === 'function') {
            cwdWriteListener = term.onWriteParsed(scheduleCwdScan);
        }

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
                        scanPromptCwd();
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
            if (cwdScanTimer) {
                clearTimeout(cwdScanTimer);
                cwdScanTimer = null;
            }
            if (cwdOscHandler) {
                try { cwdOscHandler.dispose(); } catch (e) { /* ignore */ }
                cwdOscHandler = null;
            }
            if (cwdTitleListener) {
                try { cwdTitleListener.dispose(); } catch (e) { /* ignore */ }
                cwdTitleListener = null;
            }
            if (cwdWriteListener) {
                try { cwdWriteListener.dispose(); } catch (e) { /* ignore */ }
                cwdWriteListener = null;
            }
            if (selectionFix) {
                try { selectionFix.dispose(); } catch (e) { /* ignore */ }
                selectionFix = null;
            }
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
            getCwd: function () { return cwd; },
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
