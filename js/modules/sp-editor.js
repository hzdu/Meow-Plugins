// sp-editor.js - 编辑器模块（JSON 编辑器 / Markdown 编辑器 / HTML 编辑器）
// 功能概览：
//   1. 左侧竖向 Tab：JSON / Markdown / HTML
//   2. 每个编辑器均为「上下分屏」：上屏输入，下屏实时结果（可拖动分隔条调整比例）
//   3. 每个编辑器都有独立搜索栏：实时高亮命中项 + 上一个/下一个跳转 + 命中计数
//   4. JSON：下屏树状展示，支持选中节点/值右键复制、插入节点、编辑节点、删除节点，上屏同步
//   5. Markdown：内置轻量 Markdown 解析器，实时预览（标题/列表/表格/代码块/引用/行内格式）
//   6. HTML：下屏用沙箱 iframe 实时预览（样式互不污染），并支持在新标签页打开预览
//   7. HTML / JSON 编辑器：输入「>」时自动补全 HTML 闭合标签（可开关，默认开启）
// 说明：本模块不依赖 chrome API 也能运行（无 chrome 时自动跳过内容持久化），
//       便于通过 dev/editor-preview.html 单独预览调试。
(function () {
    'use strict';

    // ================== 常量 ==================
    const K_JSON = 'meow_editor_json';
    const K_MD = 'meow_editor_md';
    const K_HTML = 'meow_editor_html';
    const K_ACTIVE = 'meow_editor_active';
    const K_SPLIT = 'meow_editor_split';
    const K_AUTOCLOSE = 'meow_editor_autoclose';
    const K_SNIPPETS = 'meow_editor_snippets';
    const K_RAIL = 'meow_editor_rail_order';
    const RAIL_IDS = ['json', 'markdown', 'html'];
    const MAX_HITS = 5000;      // 单次搜索最大命中数
    const MAX_VAL_LEN = 400;    // 树中字符串值最大展示长度

    // HTML 预览 iframe 内的命中高亮样式（iframe 里拿不到 sidepanel.css，需要注入）
    const HIT_STYLE =
        'mark.ed-hit{background:#fde68a;color:inherit;border-radius:2px;padding:0;}' +
        'mark.ed-hit.ed-hit-current{background:#6366f1;color:#fff;}';

    // ================== 代码片段存储 ==================
    function getSnippets() {
        if (!state.snippets) state.snippets = builtinSnippetList();
        return state.snippets;
    }

    function setSnippets(list) {
        state.snippets = Array.isArray(list) ? list : builtinSnippetList();
        state.snippets = state.snippets
            .filter(s => s && typeof s.key === 'string' && s.key.trim())
            .map(s => ({ key: s.key.trim(), desc: String(s.desc || ''), body: String(s.body == null ? '' : s.body) }));
        persistSnippets();
    }

    function persistSnippets() {
        if (!hasStorage()) return;
        try { chrome.storage.local.set({ [K_SNIPPETS]: getSnippets() }); } catch (e) { /* 忽略 */ }
    }

    function saveSnippetsNow() {
        persistSnippets();
        renderSnippetList();
    }

    // ================== 运行时状态 ==================
    const state = {
        active: 'json',
        autoClose: true,            // 输入 > 时自动补全 HTML 闭合标签（HTML / JSON 编辑器）
        snippets: null,             // HTML 代码片段（null = 使用内置）
        json: {
            text: '', data: null, valid: true,
            collapsed: new Set(),
            selectedPath: null,
            splitRatio: 0.5
        },
        md: {
            text: '',
            splitRatio: 0.5
        },
        html: {
            text: '',
            splitRatio: 0.5
        }
    };
    const dom = { root: null, rail: null, json: {}, md: {}, html: {} };
    let saveTimer = null;

    // 面板 key（dom/state）与 data-pane 名称的对应关系
    const PANE_KEYS = ['json', 'md', 'html'];
    const PANE_NAME = { json: 'json', md: 'markdown', html: 'html' };

    // ================== 基础工具 ==================
    const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const ESC_RE = /[&<>"']/g;

    function esc(s) {
        if (s == null) return '';
        const str = typeof s === 'string' ? s : String(s);
        if (!/[&<>"']/.test(str)) return str;      // 快路径：无需转义
        return str.replace(ESC_RE, ch => ESC_MAP[ch]);
    }

    function toast(msg) {
        if (typeof window.showToast === 'function') { window.showToast(msg); return; }
        let el = document.getElementById('ed-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ed-toast';
            el.className = 'ed-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.remove('show'), 1800);
    }

    // ================== 自动闭合 HTML 标签 ==================
    // 空元素（无需闭合标签）
    const VOID_TAGS = {
        area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1,
        meta: 1, param: 1, source: 1, track: 1, wbr: 1, basefont: 1, frame: 1, isindex: 1
    };
    // 完整的「开始标签」形态：<tag 属性="值" ... >（属性部分严格校验，避免误判 a > b 之类的文本）
    const TAG_RE = /^<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>$/;

    // 在光标处插入文本（优先用 execCommand，保证 Ctrl+Z 能整体撤销）
    function insertAtCaret(ta, text, caretOffset) {
        const start = ta.selectionStart;
        let done = false;
        try { done = document.execCommand('insertText', false, text); } catch (e) { done = false; }
        if (!done) {
            const end = ta.selectionEnd;
            ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const pos = start + (typeof caretOffset === 'number' ? caretOffset : text.length);
        try { ta.selectionStart = ta.selectionEnd = pos; } catch (e) { /* 忽略 */ }
    }

    // Tab 键：优先交给 hook 处理（片段展开 / 占位符跳转），否则插入两个空格
    function setupTabKey(ta, hook) {
        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                if (hook && hook(ta, e) === true) return;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                clearFields(ta);
                const pad = '  ';
                ta.value = ta.value.slice(0, start) + pad + ta.value.slice(end);
                ta.selectionStart = ta.selectionEnd = start + pad.length;
                ta.dispatchEvent(new Event('input'));
            } else if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
                       e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {
                clearFields(ta);
            }
        });
    }

    // 输入「>」时自动补全闭合标签（用于 HTML 编辑器，以及 JSON 编辑器里字符串中的 HTML）
    function setupAutoCloseTags(ta) {
        ta.addEventListener('keydown', (e) => {
            if (!state.autoClose) return;
            if (e.key !== '>' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            if (start !== end) return;                                   // 有选区时交给默认行为
            const before = ta.value.slice(0, start);
            const lt = before.lastIndexOf('<');
            if (lt === -1) return;
            const m = (before.slice(lt) + '>').match(TAG_RE);
            if (!m) return;                                              // 不是合法的开始标签
            const tag = m[1].toLowerCase();
            if (m[3] === '/') return;                                    // 已写成 <tag/>
            if (VOID_TAGS[tag]) return;                                  // 空元素
            const after = ta.value.slice(end);
            if (new RegExp('^\\s*</' + tag + '\\s*>', 'i').test(after)) return;   // 后面已有闭合标签
            e.preventDefault();
            // 光标停在 > 与 </tag> 之间
            insertAtCaret(ta, '>' + '</' + m[1] + '>', 1);
        });
    }

    function syncAutoCloseButtons() {
        if (!dom.root) return;
        dom.root.querySelectorAll('[data-act="autoclose"]').forEach(btn => {
            btn.classList.toggle('active', state.autoClose);
            btn.title = '自动闭合 HTML 标签：' + (state.autoClose ? '已开启（点击关闭）' : '已关闭（点击开启）');
        });
    }

    function toggleAutoClose() {
        state.autoClose = !state.autoClose;
        syncAutoCloseButtons();
        scheduleSave();
        toast('自动闭合 HTML 标签已' + (state.autoClose ? '开启' : '关闭'));
    }

    function copyText(text, msg) {
        const done = () => toast(msg || '已复制');
        const legacy = () => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.top = '-1000px';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                done();
            } catch (e) {
                toast('复制失败');
            }
        };
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(legacy);
            } else {
                legacy();
            }
        } catch (e) { legacy(); }
    }

    function confirmDialog(opts) {
        if (typeof window.showConfirmDialog === 'function') return window.showConfirmDialog(opts);
        return Promise.resolve(window.confirm(opts.message || '确定继续？'));
    }

    function hasStorage() {
        try {
            return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
        } catch (e) { return false; }
    }

    function scheduleSave() {
        if (!hasStorage()) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                chrome.storage.local.set({
                    [K_JSON]: state.json.text,
                    [K_MD]: state.md.text,
                    [K_HTML]: state.html.text,
                    [K_ACTIVE]: state.active,
                    [K_AUTOCLOSE]: !!state.autoClose,
                    [K_SPLIT]: { json: state.json.splitRatio, md: state.md.splitRatio, html: state.html.splitRatio }
                });
            } catch (e) { /* 忽略持久化失败 */ }
        }, 600);
    }

    // ================== 搜索命中通用逻辑 ==================
    function computeMatches(text, query) {
        const list = [];
        if (!query) return list;
        const needle = query.toLowerCase();
        const hay = String(text).toLowerCase();
        let from = 0;
        let at = hay.indexOf(needle, from);
        while (at !== -1 && list.length < MAX_HITS) {
            list.push({ start: at, end: at + needle.length });
            from = at + Math.max(1, needle.length);
            at = hay.indexOf(needle, from);
        }
        return list;
    }

    function unwrapMarks(rootEl) {
        if (!rootEl) return;
        const marks = rootEl.querySelectorAll('mark.ed-hit');
        marks.forEach(m => {
            const parent = m.parentNode;
            if (!parent) return;
            parent.replaceChild(document.createTextNode(m.textContent), m);
            parent.normalize();
        });
    }

    // 在已渲染的 DOM 中高亮命中词，返回命中元素数组（按文档顺序）
    function highlightInElement(rootEl, query) {
        const marks = [];
        if (!rootEl || !query) return marks;
        // 用节点自身所属的 document 创建遍历器/节点，兼容 HTML 预览 iframe
        const doc = rootEl.ownerDocument || document;
        const needle = query.toLowerCase();
        const walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        textNodes.forEach(node => {
            const text = node.nodeValue || '';
            const lower = text.toLowerCase();
            let idx = lower.indexOf(needle);
            if (idx === -1) return;
            const frag = doc.createDocumentFragment();
            let pos = 0;
            while (idx !== -1 && marks.length < MAX_HITS) {
                if (idx > pos) frag.appendChild(doc.createTextNode(text.slice(pos, idx)));
                const mk = doc.createElement('mark');
                mk.className = 'ed-hit';
                mk.textContent = text.slice(idx, idx + needle.length);
                frag.appendChild(mk);
                marks.push(mk);
                pos = idx + needle.length;
                idx = lower.indexOf(needle, pos);
            }
            if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)));
            if (node.parentNode) node.parentNode.replaceChild(frag, node);
        });
        return marks;
    }

    function scrollToHit(container, el, ratio) {
        if (!container || !el) return;
        const dy = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
        const anchor = typeof ratio === 'number' ? ratio : 0.34;
        const next = container.scrollTop + dy - container.clientHeight * anchor;
        container.scrollTop = Math.max(0, next);
    }

    // ================== 顶部编辑区（textarea + 高亮背板） ==================
    function backdropHtml(text, st) {
        const src = String(text == null ? '' : text);
        if (!st || !st.query || !st.matches.length) return esc(src) + '\n';
        let out = '';
        let pos = 0;
        st.matches.forEach((m, i) => {
            if (m.start < pos) return;
            out += esc(src.slice(pos, m.start));
            out += '<mark class="ed-hit' + (i === st.index ? ' ed-hit-current' : '') + '">' + esc(src.slice(m.start, m.end)) + '</mark>';
            pos = m.end;
        });
        out += esc(src.slice(pos));
        return out + '\n';
    }

    function updateBackdrop(pane) {
        const ta = pane.ta;
        const bd = pane.backdrop;
        if (!ta || !bd) return;
        // wireSearch 返回的对象本身就是搜索状态（含 query / matches / index）
        const st = pane.search || { query: '', matches: [], index: -1 };
        const text = String(pane.getText());
        // 滚动位置用缓存值，避免在刚改过 DOM 后读取几何信息而触发整篇同步布局
        const sy = typeof pane.scrollY === 'number' ? pane.scrollY : 0;
        const sx = typeof pane.scrollX === 'number' ? pane.scrollX : 0;
        if (!pane.decorate) {
            if (!st.query) bd.textContent = text + '\n';
            else bd.innerHTML = backdropHtml(text, st);
            bd.scrollTop = sy;
            bd.scrollLeft = sx;
            if (pane.afterBackdrop) pane.afterBackdrop(pane);
            return;
        }
        // HTML 编辑器：只着色可视窗口，窗口外用纯文本（排版完全一致）。
        // 输入事件里绝不读取/写入任何几何信息，避免触发整篇同步布局（大文档上就是几十毫秒）
        const width = typeof pane.clientW === 'number' ? pane.clientW : bd.clientWidth;
        // computeWindow 内部会判断"旧窗口是否仍然盖住可视区"，直接复用同一对象即表示可复用
        const win = computeWindow(pane);
        const reusable = win === pane.lnWin && win.tops && win.tops.length;
        const html = pane.decorate(text, st, pane, win) + '\n';
        const changed = html !== pane.lastHtml;
        if (changed) {
            bd.innerHTML = html;
            pane.lastHtml = html;
            // 重设内容会把滚回位置归零，需要重新对齐（放到 rAF，帧内先对齐再绘制，不会闪）
            pane.scrollPending = true;
        }
        if (!pane.gutterInner) return;
        pane.lnWin = {
            text: text, width: width, from: win.from, to: win.to,
            tops: reusable ? win.tops : null, pending: !reusable
        };
        if (reusable) renderLineNumbers(pane);
        if (!reusable || pane.scrollPending) scheduleGutter(pane);
    }

    // 滚动对齐 + 行号测量都放到帧里/帧后执行：输入事件只负责生成 HTML
    function scheduleGutter(pane) {
        if (!pane || pane.gutterRaf || pane.gutterTid) return;
        pane.gutterRaf = requestAnimationFrame(() => {
            pane.gutterRaf = 0;
            const bd = pane.backdrop;
            if (pane.scrollPending) {
                pane.scrollPending = false;
                bd.scrollTop = typeof pane.scrollY === 'number' ? pane.scrollY : 0;
                bd.scrollLeft = typeof pane.scrollX === 'number' ? pane.scrollX : 0;
            }
            // 布局已经由上面这次滚动对齐完成，帧后再测量没有额外开销
            pane.gutterTid = setTimeout(() => {
                pane.gutterTid = 0;
                finishGutter(pane, pane.gutterDepth || 0);
            }, 0);
        });
    }

    function finishGutter(pane, depth) {
        if (!pane || !pane.gutterInner || !pane.decorate) return;
        const ta = pane.ta;
        const bd = pane.backdrop;
        if (!ta.clientHeight) return;                 // 面板隐藏时不测量
        if (!pane.lnWin || !pane.lnWin.pending) { renderLineNumbers(pane); return; }
        const win = pane.lnWin;
        // 此时布局已干净，顺带刷新几何缓存
        pane.scrollY = ta.scrollTop;
        pane.scrollX = ta.scrollLeft;
        pane.clientW = bd.clientWidth;
        pane.clientH = ta.clientHeight;
        const text = String(pane.getText());
        if (win.text !== text || win.width !== pane.clientW) { win.pending = false; updateBackdrop(pane); return; }
        win.pending = false;
        const tops = measureLineTops(pane, win);
        win.tops = tops;
        if (tops.length > 1 && tops[tops.length - 1] > tops[0]) {
            pane.pxPerLine = (tops[tops.length - 1] - tops[0]) / (tops.length - 1);
        }
        renderLineNumbers(pane);
        const needTop = pane.scrollY;
        const needBottom = needTop + pane.clientH;
        const top0 = tops.length ? tops[0] : 0;
        const top1 = tops.length ? tops[tops.length - 1] + 18 : 0;
        if (depth >= 3 || (top0 <= needTop + 2 && top1 >= needBottom - 2)) { pane.gutterDepth = 0; return; }
        // 窗口与可视区错位：按窗口内真实行密度换算出锚点行，重建窗口（最多 3 次）
        const span = tops.length > 1 ? tops[tops.length - 1] - tops[0] : 0;
        const density = span > 0 ? (tops.length - 1) / span : 1 / 18;
        const totalLines = lineStarts(pane).length;
        pane.winAnchor = Math.max(0, Math.min(totalLines - 1, win.from + Math.round((needTop - top0) * density)));
        pane.gutterDepth = depth + 1;
        updateBackdrop(pane);
    }

    function scrollEditorToHit(pane) {
        const ta = pane.ta;
        const bd = pane.backdrop;
        if (!ta || !bd) return;
        const mark = bd.querySelector('mark.ed-hit-current');
        if (!mark) return;
        const dy = mark.getBoundingClientRect().top - bd.getBoundingClientRect().top;
        const h = mark.getBoundingClientRect().height;
        const next = ta.scrollTop + dy - ta.clientHeight / 2 + h / 2;
        ta.scrollTop = Math.max(0, next);
        pane.scrollY = ta.scrollTop;
        pane.scrollX = ta.scrollLeft;
    }

    // ================== 搜索栏装配 ==================
    // handlers: { getText(), onUpdate(st, opts) }
    function wireSearch(scopeEl, handlers) {
        const input = scopeEl.querySelector('.ed-search-input');
        const prevBtn = scopeEl.querySelector('.ed-search-prev');
        const nextBtn = scopeEl.querySelector('.ed-search-next');
        const countEl = scopeEl.querySelector('.ed-search-count');
        const st = { query: '', matches: [], index: -1 };

        function updateCount() {
            if (!st.query) { countEl.textContent = ''; countEl.classList.remove('no-hit'); return; }
            countEl.textContent = st.matches.length ? (st.index + 1) + '/' + st.matches.length : '0/0';
            countEl.classList.toggle('no-hit', !st.matches.length);
        }

        function recompute() {
            st.matches = computeMatches(handlers.getText(), st.query);
            st.index = st.matches.length ? 0 : -1;
        }

        function run(opts) {
            recompute();
            updateCount();
            handlers.onUpdate(st, opts || {});
        }

        function step(dir) {
            if (!st.matches.length) {
                run({ scroll: false });
                return;
            }
            st.index = (st.index + dir + st.matches.length) % st.matches.length;
            updateCount();
            handlers.onUpdate(st, { scroll: true });
        }

        input.addEventListener('input', () => {
            st.query = input.value;
            run({ scroll: false });
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                input.value = '';
                st.query = '';
                run({ scroll: false });
                input.blur();
            }
        });
        prevBtn.addEventListener('click', () => step(-1));
        nextBtn.addEventListener('click', () => step(1));

        st.refresh = () => run({ scroll: false });
        st.refreshWithScroll = () => run({ scroll: true });
        // 文本自身变化时（用户输入 / 程序改写）重算命中并刷新计数，尽量保留当前序号
        st.syncFromText = () => {
            st.matches = computeMatches(handlers.getText(), st.query);
            if (!st.matches.length) st.index = -1;
            else if (st.index < 0 || st.index >= st.matches.length) st.index = 0;
            updateCount();
            handlers.onUpdate(st, {});
        };
        st.clear = () => {
            input.value = '';
            st.query = '';
            st.matches = [];
            st.index = -1;
            updateCount();
            handlers.onUpdate(st, { scroll: false });
        };
        return st;
    }

    // ================== 分屏拖拽 ==================
    function initSplitter(paneKey, pane) {
        const handle = pane.split.querySelector('.ed-splitter');
        const topCell = pane.topCell;
        if (!handle || !topCell) return;

        const apply = (ratio) => {
            state[paneKey].splitRatio = ratio;
            topCell.style.flexBasis = (ratio * 100).toFixed(2) + '%';
        };
        apply(state[paneKey].splitRatio);

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            handle.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            const rect = pane.split.getBoundingClientRect();

            const onMove = (ev) => {
                if (!rect.height) return;
                let ratio = (ev.clientY - rect.top) / rect.height;
                ratio = Math.min(0.85, Math.max(0.12, ratio));
                apply(ratio);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                handle.classList.remove('dragging');
                document.body.style.cursor = '';
                scheduleSave();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        handle.addEventListener('dblclick', () => {
            apply(0.5);
            scheduleSave();
        });
    }

    // ================== JSON 树 ==================
    function kindOf(v) {
        if (v === null) return 'null';
        if (Array.isArray(v)) return 'array';
        return typeof v;
    }

    function isContainer(v) {
        return v !== null && typeof v === 'object';
    }

    function pathAttr(path) {
        return JSON.stringify(path);
    }

    function pathToText(path) {
        let out = '$';
        path.forEach(k => {
            if (typeof k === 'number') out += '[' + k + ']';
            else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)) out += '.' + k;
            else out += '["' + String(k).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
        });
        return out;
    }

    function resolvePath(path) {
        let cur = state.json.data;
        if (!path.length) return { parent: null, key: null, value: cur, exists: true, isIndex: false };
        for (let i = 0; i < path.length - 1; i++) {
            if (!isContainer(cur)) return { exists: false };
            cur = cur[path[i]];
        }
        if (!isContainer(cur)) return { exists: false };
        const key = path[path.length - 1];
        return {
            parent: cur,
            key: key,
            value: cur[key],
            exists: Object.prototype.hasOwnProperty.call(cur, key),
            isIndex: Array.isArray(cur)
        };
    }

    function rawValueText(v) {
        if (v === null) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
        return '';
    }

    function displayValue(v) {
        const kind = kindOf(v);
        if (kind === 'string') {
            const s = v.length > MAX_VAL_LEN ? v.slice(0, MAX_VAL_LEN) + '…' : v;
            return { cls: 'jstr', text: JSON.stringify(s), full: JSON.stringify(v) };
        }
        if (kind === 'number') return { cls: 'jnum', text: String(v), full: String(v) };
        if (kind === 'boolean') return { cls: 'jbool', text: String(v), full: String(v) };
        if (kind === 'null') return { cls: 'jnull', text: 'null', full: 'null' };
        return { cls: 'jpunc', text: String(v), full: String(v) };
    }

    function nodeHtml(key, value, path) {
        const isArr = Array.isArray(value);
        const isObj = isContainer(value);
        const attr = pathAttr(path);
        const collapsed = state.json.collapsed.has(attr);
        const selected = state.json.selectedPath === attr;

        let keyHtml = '';
        if (key !== null && key !== undefined) {
            if (typeof key === 'number') {
                keyHtml = '<span class="jidx" data-role="key">' + key + '</span><span class="jpunc">: </span>';
            } else {
                keyHtml = '<span class="jkey" data-role="key">' + esc(JSON.stringify(String(key))) + '</span><span class="jpunc">: </span>';
            }
        }

        if (!isObj) {
            const dv = displayValue(value);
            return '<div class="jnode jleaf" data-path="' + esc(attr) + '" data-kind="' + kindOf(value) + '">' +
                '<div class="jline' + (selected ? ' selected' : '') + '" data-role="line">' +
                '<span class="jtoggle empty"></span>' + keyHtml +
                '<span class="jval ' + dv.cls + '" data-role="value" title="' + esc(dv.full) + '">' + esc(dv.text) + '</span>' +
                '</div></div>';
        }

        const open = isArr ? '[' : '{';
        const close = isArr ? ']' : '}';
        const size = isArr ? value.length : Object.keys(value).length;

        let children = '';
        let closeLine = '';
        if (size === 0) {
            // 空容器
            return '<div class="jnode" data-path="' + esc(attr) + '" data-kind="' + kindOf(value) + '">' +
                '<div class="jline' + (selected ? ' selected' : '') + '" data-role="line">' +
                '<span class="jtoggle empty"></span>' + keyHtml +
                '<span class="jpunc">' + open + close + '</span>' +
                '<span class="jmeta">空</span>' +
                '</div></div>';
        }
        if (!collapsed) {
            const parts = [];
            if (isArr) {
                value.forEach((v, i) => parts.push(nodeHtml(i, v, path.concat(i))));
            } else {
                Object.keys(value).forEach(k => parts.push(nodeHtml(k, value[k], path.concat(k))));
            }
            children = '<div class="jchildren">' + parts.join('') + '</div>';
            closeLine = '<div class="jline jclose"><span class="jtoggle empty"></span><span class="jpunc">' + close + '</span></div>';
        }

        return '<div class="jnode' + (collapsed ? ' collapsed' : '') + '" data-path="' + esc(attr) + '" data-kind="' + kindOf(value) + '">' +
            '<div class="jline' + (selected ? ' selected' : '') + '" data-role="line">' +
            '<span class="jtoggle" data-role="toggle">▸</span>' + keyHtml +
            '<span class="jpunc">' + open + '</span>' +
            '<span class="jmeta">' + size + ' 项</span>' +
            (collapsed ? '<span class="jpunc">' + close + '</span>' : '') +
            '</div>' +
            children + closeLine +
            '</div>';
    }

    function renderTree() {
        const pane = dom.json;
        if (!pane || !pane.tree) return;
        if (!state.json.valid) {
            pane.tree.classList.add('stale');   // 语法错误时保留上一次的树
            return;
        }
        pane.tree.classList.remove('stale');
        if (!String(state.json.text || '').trim()) {
            pane.tree.innerHTML = '';
        } else {
            pane.tree.innerHTML = nodeHtml(null, state.json.data, []);
        }
        if (pane.emptyHint) {
            pane.emptyHint.classList.toggle('hidden', !!String(state.json.text || '').trim());
        }
    }

    function parseJsonText() {
        const pane = dom.json;
        const text = pane.ta.value;
        state.json.text = text;
        if (!text.trim()) {
            state.json.valid = true;
            state.json.data = null;
            pane.errEl.classList.add('hidden');
            pane.tree.classList.remove('stale');
            pane.tree.innerHTML = '';
            if (pane.emptyHint) pane.emptyHint.classList.remove('hidden');
            pane.search.syncFromText();
            return;
        }
        try {
            const data = JSON.parse(text);
            state.json.data = data;
            state.json.valid = true;
            pane.errEl.classList.add('hidden');
            pane.tree.classList.remove('stale');
            renderTree();
            pane.search.syncFromText();
        } catch (err) {
            state.json.valid = false;
            pane.tree.classList.add('stale');
            pane.errEl.textContent = 'JSON 语法错误：' + String(err && err.message ? err.message : err);
            pane.errEl.classList.remove('hidden');
            pane.search.syncFromText();
        }
    }

    // 把当前 JSON 数据同步回上屏文本并重绘
    function commitJson(silent) {
        const pane = dom.json;
        state.json.valid = true;
        pane.errEl.classList.add('hidden');
        pane.tree.classList.remove('stale');
        const text = JSON.stringify(state.json.data, null, 2);
        state.json.text = text === undefined ? '' : text;
        pane.ta.value = state.json.text;
        updateBackdrop(pane);
        renderTree();
        pane.search.syncFromText();
        scheduleSave();
        if (!silent) toast('已同步到上方 JSON');
    }

    function jsonSearchUpdate(st, opts) {
        const pane = dom.json;
        updateBackdrop(pane);
        if (opts && opts.scroll) scrollEditorToHit(pane);
        unwrapMarks(pane.tree);
        const marks = highlightInElement(pane.tree, st.query);
        if (marks.length) {
            const idx = Math.min(Math.max(st.index, 0), marks.length - 1);
            marks[idx].classList.add('ed-hit-current');
            if (opts && opts.scroll) scrollToHit(pane.paneBody, marks[idx]);
        }
    }

    // ---------- 右键菜单 ----------
    let ctxEl = null;
    function closeCtxMenu() {
        if (ctxEl && ctxEl.parentNode) ctxEl.parentNode.removeChild(ctxEl);
        ctxEl = null;
    }

    function openCtxMenu(x, y, items) {
        closeCtxMenu();
        const el = document.createElement('div');
        el.className = 'ed-ctx';
        items.forEach(it => {
            if (it.sep) {
                const sep = document.createElement('div');
                sep.className = 'ed-ctx-sep';
                el.appendChild(sep);
                return;
            }
            const row = document.createElement('div');
            row.className = 'ed-ctx-item' + (it.danger ? ' danger' : '');
            row.innerHTML = '<span class="material-icons">' + esc(it.icon || 'chevron_right') + '</span>' +
                '<span class="ed-ctx-label">' + esc(it.label) + '</span>';
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                closeCtxMenu();
                try { it.run(); } catch (err) { toast('操作失败：' + (err.message || err)); }
            });
            el.appendChild(row);
        });
        document.body.appendChild(el);
        const rect = el.getBoundingClientRect();
        const left = Math.min(x, window.innerWidth - rect.width - 6);
        const top = Math.min(y, window.innerHeight - rect.height - 6);
        el.style.left = Math.max(4, left) + 'px';
        el.style.top = Math.max(4, top) + 'px';
        ctxEl = el;
    }

    function selectNode(pathArr, lineEl) {
        state.json.selectedPath = pathAttr(pathArr);
        const tree = dom.json.tree;
        tree.querySelectorAll('.jline.selected').forEach(el => el.classList.remove('selected'));
        if (lineEl) lineEl.classList.add('selected');
    }

    function buildJsonMenu(pathArr) {
        const info = resolvePath(pathArr);
        if (!info.exists) return [];
        const value = info.value;
        const items = [];
        if (isContainer(value)) {
            items.push({ label: '复制值（JSON）', icon: 'content_copy', run: () => copyText(JSON.stringify(value, null, 2), '已复制节点 JSON') });
        } else {
            items.push({ label: '复制值', icon: 'content_copy', run: () => copyText(rawValueText(value), '已复制值') });
        }
        if (info.key !== null && !info.isIndex) {
            items.push({ label: '复制键名', icon: 'vpn_key', run: () => copyText(String(info.key), '已复制键名') });
        }
        items.push({ label: '复制路径', icon: 'link', run: () => copyText(pathToText(pathArr), '已复制路径') });
        items.push({ label: '复制节点 JSON', icon: 'data_object', run: () => copyText(JSON.stringify(value, null, 2), '已复制节点 JSON') });
        items.push({ sep: true });
        // 容器节点只能改名（数组元素无键名，不可编辑）
        if (!isContainer(value) || !info.isIndex) {
            items.push({ label: '编辑节点', icon: 'edit', run: () => openNodeDialog('edit', pathArr) });
        }
        if (isContainer(value)) {
            items.push({ label: '插入子节点', icon: 'add', run: () => openNodeDialog('insert', pathArr) });
        }
        if (pathArr.length) {
            items.push({ sep: true });
            items.push({ label: '删除节点', icon: 'delete', danger: true, run: () => removeNode(pathArr) });
        }
        return items;
    }

    function removeNode(pathArr) {
        const info = resolvePath(pathArr);
        if (!info.exists || !info.parent) return;
        confirmDialog({ message: '确定删除节点 ' + pathToText(pathArr) + ' ？', type: 'danger' }).then(ok => {
            if (!ok) return;
            if (info.isIndex) info.parent.splice(info.key, 1);
            else delete info.parent[info.key];
            if (state.json.selectedPath === pathAttr(pathArr)) state.json.selectedPath = null;
            commitJson(true);
            toast('节点已删除');
        });
    }

    // ---------- 节点编辑弹窗 ----------
    const dlg = { el: null, cfg: null };

    function buildDialog() {
        const el = document.createElement('div');
        el.className = 'ed-dialog hidden';
        el.innerHTML =
            '<div class="ed-dialog-box">' +
            '  <div class="ed-dialog-title">编辑节点</div>' +
            '  <div class="ed-dialog-body">' +
            '    <label class="ed-field" data-field="key"><span>键名</span><input type="text" class="ed-input ed-dlg-key" spellcheck="false"></label>' +
            '    <label class="ed-field" data-field="index"><span>插入位置（0 起，留空为末尾）</span><input type="text" class="ed-input ed-dlg-index" placeholder="末尾"></label>' +
            '    <label class="ed-field" data-field="type"><span>类型</span>' +
            '      <select class="ed-select ed-dlg-type">' +
            '        <option value="string">字符串</option>' +
            '        <option value="number">数字</option>' +
            '        <option value="boolean">布尔</option>' +
            '        <option value="null">null</option>' +
            '        <option value="object">对象 {}</option>' +
            '        <option value="array">数组 []</option>' +
            '      </select></label>' +
            '    <label class="ed-field" data-field="value"><span class="ed-dlg-value-label">值</span><textarea class="ed-input ed-dlg-value" spellcheck="false"></textarea></label>' +
            '    <label class="ed-field" data-field="bool"><span>值</span>' +
            '      <select class="ed-select ed-dlg-bool"><option value="true">true</option><option value="false">false</option></select></label>' +
            '    <div class="ed-dialog-error"></div>' +
            '  </div>' +
            '  <div class="ed-dialog-footer">' +
            '    <button type="button" class="ed-btn ed-dlg-cancel">取消</button>' +
            '    <button type="button" class="ed-btn primary ed-dlg-ok">确定</button>' +
            '  </div>' +
            '</div>';

        const $ = (sel) => el.querySelector(sel);
        const fields = {
            key: $('[data-field="key"]'),
            index: $('[data-field="index"]'),
            type: $('[data-field="type"]'),
            value: $('[data-field="value"]'),
            bool: $('[data-field="bool"]')
        };
        const keyInput = $('.ed-dlg-key');
        const indexInput = $('.ed-dlg-index');
        const typeSel = $('.ed-dlg-type');
        const valueInput = $('.ed-dlg-value');
        const boolSel = $('.ed-dlg-bool');
        const errEl = $('.ed-dialog-error');

        function syncValueField() {
            const t = typeSel.value;
            fields.value.classList.toggle('hidden', !(t === 'string' || t === 'number'));
            fields.bool.classList.toggle('hidden', t !== 'boolean');
            const label = valueInput.parentNode.querySelector('.ed-dlg-value-label');
            if (label) label.textContent = t === 'number' ? '值（数字）' : '值';
            if (valueInput.tagName === 'TEXTAREA' && t === 'number') valueInput.style.minHeight = '0';
            else valueInput.style.minHeight = '';
        }

        dlg.fields = fields;
        dlg.keyInput = keyInput;
        dlg.indexInput = indexInput;
        dlg.typeSel = typeSel;
        dlg.valueInput = valueInput;
        dlg.boolSel = boolSel;
        dlg.errEl = errEl;
        dlg.el = el;

        typeSel.addEventListener('change', syncValueField);
        $('.ed-dlg-cancel').addEventListener('click', () => closeDialog());
        $('.ed-dlg-ok').addEventListener('click', () => submitDialog());
        el.addEventListener('mousedown', (e) => { if (e.target === el) closeDialog(); });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitDialog(); }
        });
        dlg.sync = syncValueField;
        return el;
    }

    function openDialog(cfg) {
        if (!dlg.el) return;
        dlg.cfg = cfg;
        dlg.el.querySelector('.ed-dialog-title').textContent = cfg.title || '编辑节点';
        dlg.fields.key.classList.toggle('hidden', !cfg.showKey);
        dlg.fields.index.classList.toggle('hidden', !cfg.showIndex);
        dlg.fields.type.classList.toggle('hidden', !cfg.showType);
        dlg.keyInput.value = cfg.key || '';
        dlg.indexInput.value = cfg.index == null ? '' : String(cfg.index);
        dlg.typeSel.value = cfg.type || 'string';
        dlg.typeSel.disabled = !!cfg.typeLocked;
        dlg.boolSel.value = cfg.value === 'false' ? 'false' : 'true';
        dlg.valueInput.value = cfg.value == null ? '' : String(cfg.value);
        dlg.errEl.textContent = '';
        dlg.el.classList.remove('hidden');
        dlg.sync();
        setTimeout(() => {
            const first = cfg.showKey ? dlg.keyInput : (cfg.showValue === false ? dlg.indexInput : dlg.valueInput);
            if (first && !first.disabled) { first.focus(); if (first.select) first.select(); }
        }, 30);
    }

    // ================== 代码片段管理弹窗 ==================
    let snipEl = null;
    let snipEditing = null;      // 正在编辑的片段原触发词（null = 新增）

    function buildSnippetDialog() {
        const el = document.createElement('div');
        el.className = 'ed-dialog ed-snip-dialog hidden';
        el.innerHTML =
            '<div class="ed-dialog-box ed-snip-box">' +
            '  <div class="ed-dialog-title">代码片段<span class="ed-snip-tip">输入触发词后按 Tab 展开（支持 div.card、ul&gt;li*3 等简写）</span></div>' +
            '  <div class="ed-dialog-body ed-snip-body">' +
            '    <div class="ed-snip-list"></div>' +
            '    <div class="ed-snip-form hidden">' +
            '      <label class="ed-field"><span>触发词</span><input type="text" class="ed-input ed-snip-fkey" spellcheck="false" placeholder="例如 div.card 或 mycard"></label>' +
            '      <label class="ed-field"><span>说明</span><input type="text" class="ed-input ed-snip-fdesc" spellcheck="false" placeholder="例如 卡片容器"></label>' +
            '      <label class="ed-field"><span>内容（${1:默认值} 为占位符，Tab 可依次跳转）</span>' +
            '        <textarea class="ed-input ed-snip-ftext" spellcheck="false"></textarea></label>' +
            '      <div class="ed-dialog-error ed-snip-error"></div>' +
            '    </div>' +
            '  </div>' +
            '  <div class="ed-dialog-footer">' +
            '    <button type="button" class="ed-btn ed-snip-reset">恢复内置</button>' +
            '    <span class="ed-snip-gap"></span>' +
            '    <button type="button" class="ed-btn ed-snip-add">新增片段</button>' +
            '    <button type="button" class="ed-btn ed-snip-cancel hidden">取消</button>' +
            '    <button type="button" class="ed-btn primary ed-snip-save hidden">保存</button>' +
            '    <button type="button" class="ed-btn ed-snip-close">关闭</button>' +
            '  </div>' +
            '</div>';

        el.querySelector('.ed-snip-close').addEventListener('click', closeSnippetDialog);
        el.querySelector('.ed-snip-add').addEventListener('click', () => showSnipForm(null));
        el.querySelector('.ed-snip-cancel').addEventListener('click', showSnipList);
        el.querySelector('.ed-snip-save').addEventListener('click', saveSnipForm);
        el.querySelector('.ed-snip-reset').addEventListener('click', () => {
            confirmDialog({ message: '恢复内置片段？自定义的片段会被清空。', type: 'danger' }).then(ok => {
                if (!ok) return;
                setSnippets(builtinSnippetList());
                renderSnippetList();
                toast('已恢复内置片段');
            });
        });
        el.addEventListener('mousedown', (e) => { if (e.target === el) closeSnippetDialog(); });
        el.querySelector('.ed-snip-fkey').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); el.querySelector('.ed-snip-fdesc').focus(); }
        });
        return el;
    }

    function openSnippetDialog() {
        if (!snipEl) return;
        showSnipList();
        snipEl.classList.remove('hidden');
    }

    function closeSnippetDialog() {
        if (!snipEl) return;
        snipEl.classList.add('hidden');
        showSnipList();
    }

    function setSnipError(msg) {
        if (!snipEl) return;
        const box = snipEl.querySelector('.ed-snip-error');
        box.textContent = msg || '';
        box.classList.toggle('hidden', !msg);
    }

    function renderSnippetList() {
        if (!snipEl) return;
        const list = getSnippets();
        const box = snipEl.querySelector('.ed-snip-list');
        if (!list.length) {
            box.innerHTML = '<div class="ed-snip-empty">暂无片段，点「新增片段」或「恢复内置」</div>';
            return;
        }
        const builtinKeys = {};
        BUILTIN_SNIPPETS.forEach(s => { builtinKeys[s.key] = 1; });
        let html = '';
        list.forEach((s, i) => {
            html += '<div class="ed-snip-item" data-idx="' + i + '">' +
                '<div class="ed-snip-main">' +
                '<code class="ed-snip-key">' + esc(s.key) + '</code>' +
                (builtinKeys[s.key] ? '<span class="ed-snip-badge">内置</span>' : '') +
                '<span class="ed-snip-desc">' + esc(s.desc || '') + '</span>' +
                '</div>' +
                '<div class="ed-snip-ops">' +
                '<button type="button" class="ed-mini-btn" data-op="edit" title="编辑"><span class="material-icons">edit</span></button>' +
                '<button type="button" class="ed-mini-btn" data-op="del" title="删除"><span class="material-icons">delete</span></button>' +
                '</div>' +
                '</div>';
        });
        box.innerHTML = html;
        box.querySelectorAll('.ed-snip-item').forEach(row => {
            const idx = parseInt(row.dataset.idx, 10);
            row.querySelector('[data-op="edit"]').addEventListener('click', () => showSnipForm(getSnippets()[idx]));
            row.querySelector('[data-op="del"]').addEventListener('click', () => removeSnip(getSnippets()[idx]));
        });
    }

    function showSnipForm(snip) {
        if (!snipEl) return;
        snipEditing = snip ? snip.key : null;
        snipEl.querySelector('.ed-snip-list').classList.add('hidden');
        const form = snipEl.querySelector('.ed-snip-form');
        form.classList.remove('hidden');
        form.querySelector('.ed-snip-fkey').value = snip ? snip.key : '';
        form.querySelector('.ed-snip-fdesc').value = snip ? snip.desc || '' : '';
        form.querySelector('.ed-snip-ftext').value = snip ? snip.body : '';
        setSnipError('');
        snipEl.querySelector('.ed-snip-add').classList.add('hidden');
        snipEl.querySelector('.ed-snip-reset').hidden = true;
        snipEl.querySelector('.ed-snip-save').classList.remove('hidden');
        snipEl.querySelector('.ed-snip-cancel').classList.remove('hidden');
        form.querySelector('.ed-snip-fkey').focus();
    }

    function showSnipList() {
        if (!snipEl) return;
        snipEditing = null;
        snipEl.querySelector('.ed-snip-form').classList.add('hidden');
        snipEl.querySelector('.ed-snip-list').classList.remove('hidden');
        snipEl.querySelector('.ed-snip-add').classList.remove('hidden');
        snipEl.querySelector('.ed-snip-reset').hidden = false;
        snipEl.querySelector('.ed-snip-save').classList.add('hidden');
        snipEl.querySelector('.ed-snip-cancel').classList.add('hidden');
        setSnipError('');
        renderSnippetList();
    }

    function saveSnipForm() {
        if (!snipEl) return;
        const form = snipEl.querySelector('.ed-snip-form');
        const key = form.querySelector('.ed-snip-fkey').value.trim();
        const desc = form.querySelector('.ed-snip-fdesc').value.trim();
        const body = form.querySelector('.ed-snip-ftext').value;
        if (!key) { setSnipError('触发词不能为空'); return; }
        if (/\s/.test(key)) { setSnipError('触发词不能包含空格'); return; }
        if (!body.trim()) { setSnipError('片段内容不能为空'); return; }
        const list = getSnippets().slice();
        if (list.some(s => s.key === key && s.key !== snipEditing)) {
            setSnipError('触发词「' + key + '」已存在');
            return;
        }
        if (snipEditing !== null) {
            const i = list.findIndex(s => s.key === snipEditing);
            if (i === -1) list.push({ key: key, desc: desc, body: body });
            else list[i] = { key: key, desc: desc, body: body };
        } else {
            list.push({ key: key, desc: desc, body: body });
        }
        setSnippets(list);
        showSnipList();
        toast('已保存片段：' + key);
    }

    function removeSnip(snip) {
        if (!snip) return;
        confirmDialog({ message: '确定删除片段「' + snip.key + '」？', type: 'danger' }).then(ok => {
            if (!ok) return;
            setSnippets(getSnippets().filter(s => s.key !== snip.key));
            renderSnippetList();
            toast('已删除片段：' + snip.key);
        });
    }

    function closeDialog() {
        if (!dlg.el) return;
        dlg.el.classList.add('hidden');
        dlg.cfg = null;
    }

    function submitDialog() {
        if (!dlg.cfg) return;
        const cfg = dlg.cfg;
        const values = {
            key: dlg.keyInput.value,
            index: dlg.indexInput.value,
            type: dlg.typeSel.value,
            value: dlg.typeSel.value === 'boolean' ? dlg.boolSel.value : dlg.valueInput.value
        };
        try {
            const result = cfg.onOk(values);
            if (typeof result === 'string' && result) {
                dlg.errEl.textContent = result;
                return;
            }
        } catch (err) {
            dlg.errEl.textContent = String(err && err.message ? err.message : err);
            return;
        }
        closeDialog();
    }

    function openNodeDialog(mode, pathArr) {
        if (mode === 'edit') {
            const info = resolvePath(pathArr);
            if (!info.exists) return;
            const container = isContainer(info.value);
            const inArray = !!info.isIndex;
            const kind = kindOf(info.value);
            openDialog({
                title: '编辑节点' + (inArray ? '（数组元素 #' + info.key + '）' : ''),
                showKey: !inArray && info.key !== null,
                key: inArray ? '' : String(info.key),
                showType: !container,
                type: container ? (Array.isArray(info.value) ? 'array' : 'object') : (kind === 'object' ? 'object' : kind),
                typeLocked: container,
                showValue: !container,
                value: container ? '' : rawValueText(info.value),
                onOk: (v) => {
                    let finalKey = info.key;
                    if (!inArray && info.key !== null) {
                        const nk = String(v.key || '').trim();
                        if (!nk) return '键名不能为空';
                        if (nk !== String(info.key)) {
                            if (Object.prototype.hasOwnProperty.call(info.parent, nk)) return '键名「' + nk + '」已存在';
                            const oldKey = String(info.key);
                            const entries = Object.keys(info.parent).map(k => [k, info.parent[k]]);
                            Object.keys(info.parent).forEach(k => delete info.parent[k]);
                            entries.forEach(pair => {
                                info.parent[pair[0] === oldKey ? nk : pair[0]] = pair[1];
                            });
                            finalKey = nk;
                        }
                    }
                    if (!container) {
                        const parsed = parseValueInput(v.type, v.value);
                        if (info.parent === null) {
                            state.json.data = parsed;   // 根节点本身
                        } else {
                            info.parent[finalKey] = parsed;
                        }
                    }
                    state.json.selectedPath = pathAttr(pathArr.slice(0, -1).concat(finalKey));
                    commitJson(true);
                    toast('节点已更新');
                    return null;
                }
            });
            return;
        }

        // insert
        const parentInfo = resolvePath(pathArr);
        if (!parentInfo.exists || !isContainer(parentInfo.value)) return;
        const parent = parentInfo.value;
        const isArr = Array.isArray(parent);
        openDialog({
            title: isArr ? '插入子节点（数组）' : '插入子节点（对象）',
            showKey: !isArr,
            key: '',
            showIndex: isArr,
            index: parent.length,
            showType: true,
            type: 'string',
            showValue: true,
            value: '',
            onOk: (v) => {
                const parsed = parseValueInput(v.type, v.value);
                let newPath;
                if (isArr) {
                    let idx = parent.length;
                    const raw = String(v.index || '').trim();
                    if (raw !== '') {
                        if (!/^\d+$/.test(raw)) return '插入位置需为非负整数';
                        idx = Math.min(parent.length, parseInt(raw, 10));
                    }
                    parent.splice(idx, 0, parsed);
                    newPath = pathArr.concat(idx);
                } else {
                    const nk = String(v.key || '').trim();
                    if (!nk) return '键名不能为空';
                    if (Object.prototype.hasOwnProperty.call(parent, nk)) return '键名「' + nk + '」已存在';
                    parent[nk] = parsed;
                    newPath = pathArr.concat(nk);
                }
                state.json.collapsed.delete(pathAttr(pathArr));
                state.json.selectedPath = pathAttr(newPath);
                commitJson(true);
                toast('已插入新节点');
                return null;
            }
        });
    }

    function parseValueInput(type, text) {
        switch (type) {
            case 'string':
                return String(text);
            case 'number': {
                const raw = String(text).trim();
                if (raw === '' || isNaN(Number(raw)) || !isFinite(Number(raw))) throw new Error('请输入合法数字');
                return Number(raw);
            }
            case 'boolean':
                return String(text) === 'true';
            case 'null':
                return null;
            case 'object':
                return {};
            case 'array':
                return [];
            default:
                return String(text);
        }
    }

    // ================== Markdown 解析 ==================
    function safeUrl(url) {
        const s = String(url || '').trim();
        if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
        if (/^data:image\//i.test(s)) return s;
        if (/^[./#]/.test(s)) return s;
        return '#';
    }

    function mdInline(text) {
        let s = esc(text);
        const codes = [];
        // 行内代码
        s = s.replace(/`([^`]+)`/g, (m, c) => {
            codes.push(c);
            return '\u0000' + (codes.length - 1) + '\u0000';
        });
        // 图片
        s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, alt, url) =>
            '<img src="' + safeUrl(url) + '" alt="' + alt + '" loading="lazy">');
        // 链接
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, t, url) =>
            '<a href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer">' + t + '</a>');
        // 粗体 / 斜体 / 删除线
        s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
        s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        // 裸链接自动识别
        s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+)/g, (m, p, url) =>
            p + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>');
        // 还原行内代码
        s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + codes[Number(i)] + '</code>');
        return s;
    }

    function isBlockStart(line) {
        if (/^\s*$/.test(line)) return true;
        if (/^(\s*)(```+|~~~+)/.test(line)) return true;
        if (/^#{1,6}\s+/.test(line)) return true;
        if (/^\s{0,3}>/.test(line)) return true;
        if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) return true;
        if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) return true;
        return false;
    }

    function collectListItems(lines, start) {
        const items = [];
        let i = start;
        while (i < lines.length) {
            const line = lines[i];
            const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
            if (!m) {
                if (items.length && !/^\s*$/.test(line) && !isBlockStart(line)) {
                    items[items.length - 1].text += ' ' + line.trim();
                    i++;
                    continue;
                }
                break;
            }
            const indent = m[1].replace(/\t/g, '    ').length;
            let text = m[3];
            let task = false;
            let checked = false;
            const t = text.match(/^\[([ xX])\]\s+(.*)$/);
            if (t) {
                task = true;
                checked = t[1].toLowerCase() === 'x';
                text = t[2];
            }
            items.push({ indent, ordered: /\d/.test(m[2]), text, task, checked });
            i++;
        }
        return { items, next: i };
    }

    function renderList(node) {
        let html = node.ordered ? '<ol>' : '<ul>';
        node.children.forEach(c => {
            let inner = mdInline(c.text);
            if (c.task) inner = '<span class="md-task">' + (c.checked ? '☑' : '☐') + '</span> ' + inner;
            const sub = c.sub ? renderList(c.sub) : '';
            html += '<li>' + inner + sub + '</li>';
        });
        return html + (node.ordered ? '</ol>' : '</ul>');
    }

    function buildList(items) {
        const root = { children: [], ordered: items.length ? items[0].ordered : false, indent: -1 };
        const stack = [root];
        items.forEach(it => {
            while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) stack.pop();
            let parent = stack[stack.length - 1];
            if (it.indent > parent.indent && parent.children.length) {
                const last = parent.children[parent.children.length - 1];
                if (!last.sub) last.sub = { children: [], ordered: it.ordered, indent: it.indent };
                parent = last.sub;
                stack.push(parent);
            }
            parent.children.push({ text: it.text, task: it.task, checked: it.checked });
        });
        return renderList(root);
    }

    function splitRow(line) {
        return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(s => s.trim());
    }

    function mdRender(src) {
        const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
        const out = [];
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            if (/^\s*$/.test(line)) { i++; continue; }

            // 代码块
            const fence = line.match(/^\s*(```+|~~~+)\s*([^\s`]*)\s*$/);
            if (fence) {
                const marker = fence[1][0] === '`' ? '```' : '~~~';
                const re = new RegExp('^\\s*' + marker.replace(/([`~])/g, '\\$1') + '+\\s*$');
                const buf = [];
                i++;
                while (i < lines.length && !re.test(lines[i])) { buf.push(lines[i]); i++; }
                if (i < lines.length) i++;
                out.push('<pre class="md-code"' + (fence[2] ? ' data-lang="' + esc(fence[2]) + '"' : '') + '><code>' + esc(buf.join('\n')) + '</code></pre>');
                continue;
            }

            // 标题
            const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
            if (h) {
                const lv = h[1].length;
                out.push('<h' + lv + '>' + mdInline(h[2]) + '</h' + lv + '>');
                i++;
                continue;
            }

            // 分隔线
            if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
                out.push('<hr>');
                i++;
                continue;
            }

            // 引用
            if (/^\s{0,3}>/.test(line)) {
                const buf = [];
                while (i < lines.length) {
                    if (/^\s{0,3}>/.test(lines[i])) {
                        buf.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
                        i++;
                    } else if (buf.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) {
                        buf.push(lines[i]);
                        i++;
                    } else break;
                }
                out.push('<blockquote>' + mdRender(buf.join('\n')) + '</blockquote>');
                continue;
            }

            // 表格
            if (line.indexOf('|') !== -1 && i + 1 < lines.length &&
                lines[i + 1].indexOf('|') !== -1 &&
                /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
                const head = splitRow(line);
                const sep = splitRow(lines[i + 1]);
                const aligns = sep.map(s => (/^:-+:$/.test(s) ? 'center' : (/-+:$/.test(s) ? 'right' : 'left')));
                let html = '<table><thead><tr>';
                head.forEach((cell, idx) => {
                    html += '<th style="text-align:' + (aligns[idx] || 'left') + '">' + mdInline(cell) + '</th>';
                });
                html += '</tr></thead><tbody>';
                i += 2;
                while (i < lines.length && lines[i].indexOf('|') !== -1 && !/^\s*$/.test(lines[i])) {
                    const cells = splitRow(lines[i]);
                    html += '<tr>';
                    head.forEach((cell, idx) => {
                        html += '<td style="text-align:' + (aligns[idx] || 'left') + '">' + mdInline(cells[idx] == null ? '' : cells[idx]) + '</td>';
                    });
                    html += '</tr>';
                    i++;
                }
                html += '</tbody></table>';
                out.push(html);
                continue;
            }

            // 列表
            if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
                const res = collectListItems(lines, i);
                if (res.items.length) out.push(buildList(res.items));
                i = res.next;
                continue;
            }

            // 段落
            const buf = [];
            while (i < lines.length && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
            if (buf.length) out.push('<p>' + buf.map(mdInline).join('<br>') + '</p>');
            else i++;
        }
        return out.join('\n');
    }

    // ================== Markdown 面板渲染 ==================
    function renderMarkdown(opts) {
        const pane = dom.md;
        if (!pane || !pane.body) return;
        const st = pane.search || { query: '', matches: [], index: -1 };
        const keepTop = pane.body.scrollTop;
        const hasText = !!(state.md.text && state.md.text.trim());
        pane.body.innerHTML = hasText ? mdRender(state.md.text) : '';
        if (pane.emptyHint) pane.emptyHint.classList.toggle('hidden', hasText);
        pane.body.scrollTop = keepTop;
        mdSearchUpdate(st, opts);
    }

    function mdSearchUpdate(st, opts) {
        const pane = dom.md;
        updateBackdrop(pane);
        if (opts && opts.scroll) scrollEditorToHit(pane);
        unwrapMarks(pane.body);
        const marks = highlightInElement(pane.body, st.query);
        if (marks.length) {
            const idx = Math.min(Math.max(st.index, 0), marks.length - 1);
            marks[idx].classList.add('ed-hit-current');
            if (opts && opts.scroll) scrollToHit(pane.body, marks[idx]);
        }
    }

    // ================== HTML 语法高亮 / 标签配对 ==================
    // 把 HTML 源码切成带类型的小段（不增删任何字符，保证与 textarea 排版一致）
    // 返回 { segs: [{start, end, text, cls}], tags: [{name, start, end, isEnd, selfClosed, isMarkup}] }
    function htmlSegments(src) {
        const segs = [];
        const tags = [];
        const push = (start, end, cls) => {
            if (end > start) segs.push({ start: start, end: end, text: src.slice(start, end), cls: cls });
        };
        // 文本段：把 HTML 实体单独标色
        const pushText = (start, end) => {
            if (end <= start) return;
            const re = /&[a-zA-Z][a-zA-Z0-9]{1,10};|&#\d{1,6};|&#x[0-9a-fA-F]{1,6};/g;
            let pos = start;
            let m = re.exec(src.slice(start, end));
            while (m) {
                const s2 = start + m.index;
                push(pos, s2, 'hx-text');
                push(s2, s2 + m[0].length, 'hx-ent');
                pos = s2 + m[0].length;
                m = re.exec(src.slice(start, end));
            }
            push(pos, end, 'hx-text');
        };
        const len = src.length;
        let i = 0;
        while (i < len) {
            const lt = src.indexOf('<', i);
            if (lt === -1) { pushText(i, len); break; }
            if (lt > i) pushText(i, lt);
            if (src.startsWith('<!--', lt)) {
                const e = src.indexOf('-->', lt + 4);
                const end = e === -1 ? len : e + 3;
                push(lt, end, 'hx-comment');
                tags.push({ name: '', start: lt, end: end, isEnd: false, selfClosed: true, isMarkup: true });
                i = end; continue;
            }
            if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
                const e = src.indexOf('>', lt + 2);
                const end = e === -1 ? len : e + 1;
                push(lt, end, 'hx-doctype');
                tags.push({ name: '', start: lt, end: end, isEnd: false, selfClosed: true, isMarkup: true });
                i = end; continue;
            }
            const head = /^<(\/?)([a-zA-Z][a-zA-Z0-9:._-]*)/.exec(src.slice(lt, lt + 80));
            if (!head) { push(lt, lt + 1, 'hx-punc'); i = lt + 1; continue; }
            const isEnd = head[1] === '/';
            const name = head[2];
            const nameStart = lt + 1 + head[1].length;
            push(lt, nameStart, 'hx-punc');
            push(nameStart, nameStart + name.length, 'hx-tag');
            let j = nameStart + name.length;
            let closed = false;          // 是否已经遇到 '>'
            let selfClosed = false;
            while (j < len) {
                const ch = src[j];
                if (ch === '>') { push(j, j + 1, 'hx-punc'); j++; closed = true; break; }
                if (ch === '/' && src[j + 1] === '>') { push(j, j + 2, 'hx-punc'); j += 2; closed = true; selfClosed = true; break; }
                if (/\s/.test(ch)) {
                    let k = j; while (k < len && /\s/.test(src[k])) k++;
                    push(j, k, 'hx-ws'); j = k; continue;
                }
                if (ch === '=') { push(j, j + 1, 'hx-punc'); j++; continue; }
                if (ch === '"' || ch === "'") {
                    const e = src.indexOf(ch, j + 1);
                    const end = e === -1 ? len : e + 1;
                    push(j, end, 'hx-str');
                    j = end; continue;
                }
                let k = j;
                while (k < len && !/[\s=>]/.test(src[k]) && !(src[k] === '/' && src[k + 1] === '>')) k++;
                if (k === j) k = j + 1;
                push(j, k, 'hx-attr');
                j = k;
            }
            tags.push({
                name: name, start: lt, end: j,
                isEnd: isEnd, selfClosed: selfClosed || VOID_TAGS[name.toLowerCase()] === 1,
                isMarkup: false, closed: closed
            });
            i = j;
            // script / style 内容原样着色
            if (closed && !isEnd && !selfClosed && /^(script|style)$/i.test(name)) {
                const re = new RegExp('</' + name + '(?=[\\s/>]|$)', 'i');
                const m = re.exec(src.slice(i));
                if (m && m.index > 0) { push(i, i + m.index, 'hx-raw'); i += m.index; }
            }
        }
        return { segs: segs, tags: tags };
    }

    // 同名标签配对：返回 Map(开始标签下标 -> 结束标签下标，双向)
    function buildTagPairs(tags) {
        const pairs = new Map();
        const stack = [];
        tags.forEach((t, idx) => {
            if (t.isMarkup || t.selfClosed || !t.name) return;
            if (!t.isEnd) { stack.push(idx); return; }
            for (let k = stack.length - 1; k >= 0; k--) {
                if (tags[stack[k]].name.toLowerCase() === t.name.toLowerCase()) {
                    pairs.set(stack[k], idx);
                    pairs.set(idx, stack[k]);
                    stack.length = k;
                    break;
                }
            }
        });
        return pairs;
    }

    // 光标所在标签及其配对标签的字符区间
    function matchedTagRanges(tags, pairs, caret) {
        for (let i = 0; i < tags.length; i++) {
            const t = tags[i];
            if (t.isMarkup || caret < t.start || caret > t.end) continue;
            const p = pairs.get(i);
            if (p === undefined) return [[t.start, t.end]];
            return [[t.start, t.end], [tags[p].start, tags[p].end]];
        }
        return null;
    }

    // 行首偏移（按文本缓存，供窗口计算 / 行号 / 高亮共用）
    function lineStarts(pane) {
        const src = String(pane.getText());
        if (pane.lsText !== src) {
            const starts = [0];
            for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
            pane.lsText = src;
            pane.lsStarts = starts;
        }
        return pane.lsStarts;
    }

    // 把窗口起点回退到安全的标签边界（避免从标签/注释中间开始分词）
    function safeFrom(src, off) {
        let a = src.lastIndexOf('>', off) + 1;
        const cmt = src.lastIndexOf('<!--', off);
        if (cmt !== -1 && src.indexOf('-->', cmt) > off) a = Math.min(a, cmt);
        const sc = Math.max(src.lastIndexOf('<script', off), src.lastIndexOf('<style', off));
        if (sc !== -1 && src.indexOf('>', sc) < off && src.indexOf('>', sc) !== -1) a = Math.min(a, sc);
        return Math.max(0, Math.min(a, off));
    }

    // 把窗口终点推进到标签之后
    function safeTo(src, off) {
        const gt = src.indexOf('>', off);
        return gt === -1 ? src.length : gt + 1;
    }

    // 生成 HTML 编辑器的背板：只对可视窗口分词着色，窗口外用纯文本（排版完全一致）
    function htmlBackdrop(src, st, pane, win) {
        const starts = pane ? lineStarts(pane) : null;
        let a = 0;
        let b = src.length;
        let head = '';
        let tail = '';
        if (win && starts && starts.length) {
            if (win.from > 0) {
                a = safeFrom(src, starts[Math.min(win.from, starts.length - 1)]);
                head = esc(src.slice(0, a));
            }
            if (win.to < starts.length - 1) {
                const nextStart = starts[Math.min(win.to + 1, starts.length - 1)];
                b = safeTo(src, nextStart);
                tail = esc(src.slice(b));
            }
        }
        const slice = src.slice(a, b);
        const parsed = slice ? htmlSegments(slice) : { segs: [], tags: [] };
        const segs = parsed.segs;
        const pairs = buildTagPairs(parsed.tags);
        const caret = pane && pane.ta ? pane.ta.selectionStart : -1;
        const ranges = caret >= 0 ? matchedTagRanges(parsed.tags, pairs, caret - a) : null;
        const inRanges = (s, e) => {
            if (!ranges) return false;
            for (let i = 0; i < ranges.length; i++) {
                if (s >= ranges[i][0] && e <= ranges[i][1]) return true;
            }
            return false;
        };
        const query = st && st.query && st.matches && st.matches.length ? st.query : '';
        const hits = query ? st.matches : [];
        let out = head;
        segs.forEach(seg => {
            const absStart = seg.start + a;
            const absEnd = seg.end + a;
            let cls = 'hx-seg ' + seg.cls + (inRanges(seg.start, seg.end) ? ' hx-match' : '');
            let html = '';
            let pos = absStart;
            hits.forEach((m, i) => {
                if (m.end <= absStart || m.start >= absEnd) return;
                const s = Math.max(m.start, absStart);
                const e = Math.min(m.end, absEnd);
                if (s > pos) html += esc(src.slice(pos, s));
                html += '<mark class="ed-hit' + (i === st.index ? ' ed-hit-current' : '') + '">' + esc(src.slice(s, e)) + '</mark>';
                pos = e;
            });
            if (pos < absEnd) html += esc(src.slice(pos, absEnd));
            if (!html) return;
            out += '<span class="' + cls + '">' + html + '</span>';
        });
        return out + tail;
    }

    // ================== 行号 / 可视窗口 ==================
    // 光标所在行（二分查找行首偏移，O(log n)）
    function caretLineIndex(pane) {
        const starts = lineStarts(pane);
        const caret = pane.ta.selectionStart || 0;
        let lo = 0;
        let hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= caret) lo = mid; else hi = mid - 1;
        }
        return lo;
    }

    // 计算当前需要着色与测量的行窗口（尽量沿用上一次的窗口，滚动时才重建）
    function computeWindow(pane) {
        const ta = pane.ta;
        const starts = lineStarts(pane);
        const total = starts.length;
        const clientH = typeof pane.clientH === 'number' && pane.clientH > 0 ? pane.clientH : 320;
        const scrollTop = typeof pane.scrollY === 'number' ? pane.scrollY : 0;
        const rows = Math.max(2, Math.round(clientH / 18) + 1);
        const buf = 24;
        const width = typeof pane.clientW === 'number' ? pane.clientW : 0;
        const prev = pane.lnWin;
        let first = null;
        if (scrollTop <= 0) {
            first = 0;                                   // 回到顶部：一定从第一行开始
        } else if (prev && prev.text === String(pane.getText()) && prev.width === width && prev.tops && prev.tops.length > 1) {
            const tops = prev.tops;
            const lastTop = tops[tops.length - 1];
            if (scrollTop >= tops[0] && scrollTop < lastTop) {
                // 可视顶部落在已测量窗口内：精确反推所在行
                for (let i = 0; i < tops.length - 1; i++) {
                    if (tops[i] <= scrollTop && scrollTop < tops[i + 1]) { first = prev.from + i; break; }
                }
                // 仍处于窗口内侧：直接复用，避免每次输入都重建
                if (first !== null && first - prev.from >= 6 && prev.to - (first + rows) >= 6) return prev;
            } else if (Math.abs(scrollTop - (scrollTop < tops[0] ? tops[0] : lastTop)) > (lastTop - tops[0]) * 2) {
                // 一下子跳得很远：窗口内的局部行密度外推不可靠，改用全局平均行高
                const ppl = pane.pxPerLine > 18 ? pane.pxPerLine : 18;
                first = scrollTop / ppl;
            } else {
                // 滚出窗口一点点：按窗口内的行密度外推（换行多时比按 18px 估算准得多）
                const density = (tops.length - 1) / Math.max(1, lastTop - tops[0]);
                first = prev.from + (scrollTop - tops[0]) * density;
            }
        }
        if (first === null) {
            if (typeof pane.winAnchor === 'number') {
                first = pane.winAnchor;
            } else {
                // 用最近一次测得的"每行像素高度"估算可视首行（换行多的文档比按 18px 准得多）；
                // 光标离估算位置太远说明光标不在视野内，此时以估算为准
                const ppl = pane.pxPerLine > 18 ? pane.pxPerLine : 18;
                const est = scrollTop / ppl;
                const caret = caretLineIndex(pane);
                first = Math.abs(caret - est) > rows * 1.5 ? est : caret;
            }
        }
        first = Math.max(0, Math.min(total - 1, Math.round(first)));
        pane.winAnchor = null;
        const rw = {
            from: Math.max(0, first - buf),
            to: Math.min(total - 1, first + rows + buf)
        };
        return rw;
    }

    // 只测量窗口内各行的纵坐标（返回与 win.from 对齐的数组）
    function measureLineTops(pane, win) {
        const bd = pane.backdrop;
        const src = String(pane.getText());
        const starts = lineStarts(pane);
        const doc = bd.ownerDocument || document;
        const bdRect = bd.getBoundingClientRect();
        // 收集背板内的文本节点及其累计字符偏移（背板文本 = 源码 + 末尾换行）
        const walker = doc.createTreeWalker(bd, NodeFilter.SHOW_TEXT, null);
        const nodes = [];
        let acc = 0;
        let n;
        while ((n = walker.nextNode())) { nodes.push({ node: n, start: acc }); acc += n.nodeValue.length; }
        const total = acc;
        if (!nodes.length) return [];
        const range = doc.createRange();
        let idx = 0;
        const at = (want) => {
            const w = Math.min(Math.max(want, 0), total);
            while (idx < nodes.length - 1 && nodes[idx].start + nodes[idx].node.nodeValue.length < w) idx++;
            const item = nodes[idx];
            return { node: item.node, off: Math.max(0, Math.min(item.node.nodeValue.length, w - item.start)) };
        };
        const from = win ? Math.max(0, win.from) : 0;
        const to = win ? Math.min(win.to, starts.length - 1) : starts.length - 1;
        const tops = [];
        let prevTop = parseFloat(getComputedStyle(bd).paddingTop) || 0;
        let prevHeight = 18;
        for (let i = from; i <= to; i++) {
            const s = starts[i];
            const e = i + 1 < starts.length ? starts[i + 1] - 1 : src.length;
            let top = null;
            let height = 18;
            if (e > s) {
                try {
                    const p1 = at(s);
                    const p2 = at(e);
                    range.setStart(p1.node, p1.off);
                    range.setEnd(p2.node, p2.off);
                    const r = range.getBoundingClientRect();
                    // 空行/无法测量时 top 会退化成 0
                    if (r && (r.top - bdRect.top + bd.scrollTop) > 0.5) {
                        top = r.top - bdRect.top + bd.scrollTop;
                        height = Math.max(18, Math.round(r.height / 18) * 18 || 18);
                    }
                } catch (err) { top = null; }
            }
            if (top === null) top = i === from ? prevTop : prevTop + prevHeight;
            tops.push(top);
            prevTop = top;
            prevHeight = height;
        }
        return tops;
    }

    function renderLineNumbers(pane) {
        if (!pane || !pane.gutterInner) return;
        const ta = pane.ta;
        const win = pane.lnWin;
        if (!win || !win.tops || !win.tops.length) {
            pane.gutterInner.innerHTML = '';
            pane.lnHtml = '';
            return;
        }
        const st = typeof pane.scrollY === 'number' ? pane.scrollY : ta.scrollTop;
        const ch = typeof pane.clientH === 'number' && pane.clientH > 0 ? pane.clientH : ta.clientHeight;
        const tops = win.tops;
        const from = st - 80;
        const to = st + ch + 80;
        let html = '';
        for (let i = 0; i < tops.length; i++) {
            if (tops[i] < from || tops[i] > to) continue;
            html += '<span class="code-ln" style="top:' + Math.round(tops[i]) + 'px;">' + (win.from + i + 1) + '</span>';
        }
        if (pane.lnHtml !== html) {
            pane.gutterInner.innerHTML = html;
            pane.lnHtml = html;
        }
        pane.gutterInner.style.transform = 'translateY(' + (-st) + 'px)';
    }

    // ================== 代码片段（Emmet 风格 Tab 展开） ==================
    const SNIP_MARK = '\u0000';      // 展开后光标落点占位

    const BUILTIN_SNIPPETS = [
        { key: '!', desc: 'HTML5 骨架', body: '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${1:页面标题}</title>\n</head>\n<body>\n  ${2}\n</body>\n</html>' },
        { key: 'html:5', desc: 'HTML5 骨架', body: '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${1:页面标题}</title>\n</head>\n<body>\n  ${2}\n</body>\n</html>' },
        { key: 'meta:vp', desc: '移动端 viewport', body: '<meta name="viewport" content="width=device-width, initial-scale=1.0">' },
        { key: 'link:css', desc: '引入样式表', body: '<link rel="stylesheet" href="${1:style.css}">' },
        { key: 'script:src', desc: '引入外部脚本', body: '<script src="${1:app.js}"></script>' },
        { key: 'style', desc: '样式块', body: '<style>\n  ${1}\n</style>' },
        { key: 'a', desc: '超链接', body: '<a href="${1:#}">${2:链接文字}</a>' },
        { key: 'img', desc: '图片', body: '<img src="${1:图片地址}" alt="${2:说明}">' },
        { key: 'input:text', desc: '文本输入框', body: '<input type="text" name="${1:name}" placeholder="${2:请输入}">' },
        { key: 'ul>li', desc: '无序列表（3 项）', body: '<ul>\n  <li>${1:第一项}</li>\n  <li>${2:第二项}</li>\n  <li>${3:第三项}</li>\n</ul>' },
        { key: 'ol>li', desc: '有序列表（3 项）', body: '<ol>\n  <li>${1:第一项}</li>\n  <li>${2:第二项}</li>\n  <li>${3:第三项}</li>\n</ol>' },
        { key: 'table', desc: '表格', body: '<table>\n  <thead>\n    <tr>\n      <th>${1:表头}</th>\n    </tr>\n  </thead>\n  <tbody>\n    <tr>\n      <td>${2:内容}</td>\n    </tr>\n  </tbody>\n</table>' },
        { key: 'form', desc: '表单', body: '<form action="${1:#}" method="${2:post}">\n  ${3}\n</form>' },
        { key: 'select', desc: '下拉框', body: '<select name="${1:name}">\n  <option value="${2:1}">${3:选项}</option>\n</select>' },
        { key: 'card', desc: '卡片容器', body: '<div class="card">\n  <div class="card-title">${1:标题}</div>\n  <div class="card-body">${2:内容}</div>\n</div>' },
        { key: 'flex', desc: 'Flex 布局', body: '<div style="display:flex; align-items:center; gap:8px;">\n  ${1}\n</div>' },
        { key: 'grid', desc: 'Grid 布局', body: '<div style="display:grid; grid-template-columns:repeat(${1:2}, 1fr); gap:8px;">\n  ${2}\n</div>' },
        { key: 'center', desc: '水平垂直居中', body: '<div style="display:flex; align-items:center; justify-content:center; height:100%;">\n  ${1}\n</div>' },
        { key: 'btn', desc: '按钮', body: '<button type="button" class="${1:btn}">${2:按钮}</button>' },
        { key: 'cbox', desc: '复选框', body: '<label>\n  <input type="checkbox" name="${1:name}"${2: checked}> ${3:选项}\n</label>' }
    ];

    function builtinSnippetList() {
        return BUILTIN_SNIPPETS.map(s => ({ key: s.key, desc: s.desc, body: s.body }));
    }

    // 内置 HTML 标签名（用于判断一个裸单词是否值得展开成标签）
    const KNOWN_TAGS = ('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col ' +
        'colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head ' +
        'header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup ' +
        'option output p param picture pre progress q rp rt ruby s samp script section select slot small source span strong style sub summary ' +
        'sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr').split(' ');

    function isKnownTag(name) {
        const n = String(name || '').toLowerCase();
        return KNOWN_TAGS.indexOf(n) !== -1 || /^h[1-6]$/.test(n);
    }

    // 解析简写：tag#id.a.b[attr=val]{text}*n，支持 > 子级、+ 同级
    function parseAbbr(src) {
        let pos = 0;
        const parseNode = () => {
            const node = { name: null, id: null, classes: [], attrs: '', text: null, repeat: 1, children: [] };
            if (src[pos] === '!') { node.name = '!'; pos++; }
            else {
                const m = /^[A-Za-z][A-Za-z0-9:_-]*/.exec(src.slice(pos));
                if (m) { node.name = m[0]; pos += m[0].length; }
            }
            for (;;) {
                const c = src[pos];
                if (c === '#') {
                    const m = /^#([A-Za-z0-9_:-]+)/.exec(src.slice(pos));
                    if (!m) return null;
                    node.id = m[1]; pos += m[0].length; continue;
                }
                if (c === '.') {
                    const m = /^\.([A-Za-z0-9_:-]+)/.exec(src.slice(pos));
                    if (!m) return null;
                    node.classes.push(m[1]); pos += m[0].length; continue;
                }
                if (c === '[') {
                    const e = src.indexOf(']', pos);
                    if (e === -1) return null;
                    node.attrs = src.slice(pos + 1, e); pos = e + 1; continue;
                }
                if (c === '{') {
                    const e = src.indexOf('}', pos);
                    if (e === -1) return null;
                    node.text = src.slice(pos + 1, e); pos = e + 1; continue;
                }
                break;
            }
            if (src[pos] === '*') {
                const m = /^\*(\d{1,3})/.exec(src.slice(pos));
                if (!m) return null;
                node.repeat = Math.max(1, Math.min(50, parseInt(m[1], 10)));
                pos += m[0].length;
            }
            if (!node.name && !node.id && !node.classes.length && node.text === null && !node.attrs) return null;
            return node;
        };
        const parseSeq = () => {
            const nodes = [];
            for (;;) {
                const n = parseNode();
                if (!n) return null;
                if (src[pos] === '>') {
                    pos++;
                    const kids = parseSeq();
                    if (!kids) return null;
                    n.children = kids;
                }
                nodes.push(n);
                if (src[pos] === '+') { pos++; continue; }
                break;
            }
            return nodes;
        };
        const nodes = parseSeq();
        if (!nodes || !nodes.length || pos !== src.length) return null;
        return nodes;
    }

    function renderAbbrNodes(nodes, depth, out) {
        nodes.forEach(n => {
            for (let r = 0; r < n.repeat; r++) {
                renderAbbrNode(n, depth, n.repeat > 1 ? String(r + 1) : '', out);
            }
        });
    }

    function renderAbbrNode(n, depth, rep, out) {
        const sub = s => String(s == null ? '' : s).replace(/\$/g, rep || '');
        const pad = '  '.repeat(depth);
        const tag = n.name && n.name !== '!' ? n.name : 'div';
        if (n.name === '!') {
            out.text += (out.text ? '\n' : '') + sub(BUILTIN_SNIPPETS[0].body);
            return;
        }
        const isVoid = VOID_TAGS[tag.toLowerCase()] === 1;
        let attrs = '';
        if (n.id) attrs += ' id="' + sub(n.id) + '"';
        if (n.classes.length) attrs += ' class="' + n.classes.map(sub).join(' ') + '"';
        if (n.attrs) attrs += ' ' + sub(n.attrs);
        if (out.text) out.text += '\n' + pad;
        out.text += '<' + tag + attrs + '>';
        if (isVoid) { if (n.text !== null) out.text += sub(n.text); return; }
        if (n.children.length) {
            renderAbbrNodes(n.children, depth + 1, out);
            out.text += '\n' + pad + '</' + tag + '>';
        } else if (n.text !== null) {
            out.text += sub(n.text) + '</' + tag + '>';
        } else {
            // 无内容的元素：光标默认落在标签中间
            if (out.caret === -1) out.caret = out.text.length;
            out.text += SNIP_MARK + '</' + tag + '>';
        }
    }

    // 展开简写；失败返回 null
    function expandAbbreviation(abbr) {
        const nodes = parseAbbr(abbr);
        if (!nodes) return null;
        const out = { text: '', caret: -1 };
        renderAbbrNodes(nodes, 0, out);
        if (!out.text) return null;
        return out;
    }

    // 处理占位符 ${n:默认值} / ${n} / $n，返回 { text, fields: [{start,end}] }
    function applyPlaceholders(body) {
        const fields = [];
        let text = '';
        let i = 0;
        const src = String(body == null ? '' : body);
        const re = /\$\{(\d+)(?::([^}]*))?\}|\$(\d+)/g;
        let m = re.exec(src);
        while (m) {
            text += src.slice(i, m.index);
            const num = parseInt(m[1] || m[3], 10);
            const def = m[1] !== undefined ? (m[2] === undefined ? '' : m[2]) : '';
            const start = text.length;
            text += def;
            fields.push({ num: num, start: start, end: text.length });
            i = re.lastIndex;
            m = re.exec(src);
        }
        text += src.slice(i);
        fields.sort((a, b) => (a.num - b.num) || (a.start - b.start));
        return { text: text, fields: fields };
    }

    function findSnippet(key) {
        const list = getSnippets();
        const k = String(key || '');
        for (let i = 0; i < list.length; i++) {
            if (list[i].key === k) return list[i];
        }
        return null;
    }

    // 光标前的简写/触发词（到空白或 < 为止，允许 div.card、ul>li*3 这类写法）
    function abbreviationBefore(ta, maxLen) {
        const caret = ta.selectionStart;
        if (caret !== ta.selectionEnd) return null;
        const src = ta.value.slice(0, caret);
        const m = /[^\s<]+$/.exec(src);
        if (!m) return null;
        const text = m[0];
        const limit = maxLen || 48;
        if (!text || text.length > limit) return null;
        return { text: text, start: caret - text.length, end: caret };
    }

    // 是否值得当作简写展开
    function looksLikeAbbreviation(text) {
        if (findSnippet(text)) return true;
        if (/[>+*#.[\]{}:$]/.test(text)) return true;
        return isKnownTag(text);
    }

    function expandSnippetAt(ta, abbr) {
        const snip = findSnippet(abbr.text);
        let text = '';
        let fields = [];
        let caret = -1;
        if (snip) {
            const ph = applyPlaceholders(snip.body);
            text = ph.text;
            fields = ph.fields;
        } else {
            const ex = expandAbbreviation(abbr.text);
            if (!ex) return false;
            text = ex.text;
            caret = ex.caret;
        }
        const markAt = text.indexOf(SNIP_MARK);
        text = text.split(SNIP_MARK).join('');
        if (markAt !== -1) caret = markAt;
        replaceRangeText(ta, abbr.start, abbr.end, text);
        const base = abbr.start;
        if (fields.length) {
            setFields(ta, fields.map(f => ({ start: base + f.start, end: base + f.end })));
        } else if (caret !== -1) {
            ta.selectionStart = ta.selectionEnd = base + caret;
            clearFields(ta);
        } else {
            ta.selectionStart = ta.selectionEnd = base + text.length;
            clearFields(ta);
        }
        return true;
    }

    // 用 execCommand 替换一段文本（保证可整体撤销）
    function replaceRangeText(ta, start, end, text) {
        let done = false;
        try {
            ta.setSelectionRange(start, end);
            done = document.execCommand('insertText', false, text);
        } catch (e) { done = false; }
        if (!done) {
            ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
            ta.selectionStart = ta.selectionEnd = start + text.length;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // ================== 占位符跳转（Tab 键在片段字段间移动） ==================
    function setFields(ta, fields) {
        ta._snipFields = fields;
        ta._snipIndex = 0;
        ta._snipLen = ta.value.length;
        selectField(ta, 0);
    }

    function clearFields(ta) {
        ta._snipFields = null;
        ta._snipIndex = -1;
    }

    function selectField(ta, idx) {
        const fields = ta._snipFields;
        if (!fields || !fields[idx]) return;
        ta._snipIndex = idx;
        ta.focus();
        ta.selectionStart = fields[idx].start;
        ta.selectionEnd = fields[idx].end;
    }

    function jumpToNextField(ta) {
        const fields = ta._snipFields;
        if (!fields || !fields.length) return false;
        const cur = fields[ta._snipIndex];
        // 光标已被用户移出当前占位符：视为离开片段编辑状态
        if (!cur || ta.selectionStart < cur.start || ta.selectionStart > cur.end) { clearFields(ta); return false; }
        if (ta._snipIndex >= fields.length - 1) {
            // 最后一个占位符：收拢选区，避免随后的 Tab 缩进覆盖占位符内容
            const end = cur.end;
            clearFields(ta);
            ta.selectionStart = ta.selectionEnd = end;
            return false;
        }
        selectField(ta, ta._snipIndex + 1);
        return true;
    }

    // 用户继续输入时，同步后续字段的偏移
    function shiftFields(ta) {
        const fields = ta._snipFields;
        if (!fields || !fields.length) return;
        const len = ta.value.length;
        const delta = len - (typeof ta._snipLen === 'number' ? ta._snipLen : len);
        ta._snipLen = len;
        if (!delta) return;
        const current = fields[ta._snipIndex] || fields[0];
        fields.forEach(f => {
            if (f === current) return;
            if (f.start >= current.end) { f.start += delta; f.end += delta; }
        });
        current.end = Math.max(current.start, current.end + delta);
    }

    // ================== HTML 面板渲染 ==================
    // 片段自动补全为完整文档（预览 iframe 与新标签页保持一致）
    function wrapHtmlDocument(src) {
        const html = String(src == null ? '' : src);
        if (/<html[\s>]/i.test(html)) return html;
        return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<title>HTML 预览</title>\n</head>\n<body>\n' +
            html + '\n</body>\n</html>';
    }

    function htmlFrameDoc() {
        const frame = dom.html && dom.html.frame;
        if (!frame) return null;
        try {
            // 沙箱 iframe（allow-same-origin）与父页面同源，可直接读写其文档
            return frame.contentDocument || (frame.contentWindow && frame.contentWindow.document) || null;
        } catch (e) { return null; }
    }

    function renderHtmlPreview(opts) {
        const pane = dom.html;
        if (!pane || !pane.frame) return;
        const hasText = !!(state.html.text && state.html.text.trim());
        if (pane.emptyHint) pane.emptyHint.classList.toggle('hidden', hasText);
        if (!hasText) {
            // 空内容：清空预览
            const doc = htmlFrameDoc();
            if (doc) {
                doc.open();
                doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>');
                doc.close();
            }
            pane.renderedHtml = '';
            return;
        }
        const wrapped = wrapHtmlDocument(state.html.text);
        if (pane.renderedHtml === wrapped) { htmlSearchUpdate(pane.search, opts); return; }
        pane.renderedHtml = wrapped;
        // 记住滚动位置，重绘后恢复
        const doc0 = htmlFrameDoc();
        pane.keepScroll = doc0 && doc0.defaultView ? doc0.defaultView.scrollY : 0;
        pane.frame.setAttribute('srcdoc', wrapped);
    }

    // iframe 载入完成：注入命中高亮样式、恢复滚动、重新应用搜索高亮
    function onHtmlFrameLoad() {
        const pane = dom.html;
        if (!pane || !pane.frame) return;
        const doc = htmlFrameDoc();
        if (!doc) return;
        try {
            if (doc.head && !doc.getElementById('ed-hit-style')) {
                const style = doc.createElement('style');
                style.id = 'ed-hit-style';
                style.textContent = HIT_STYLE;
                doc.head.appendChild(style);
            }
            if (doc.defaultView && pane.keepScroll) {
                doc.defaultView.scrollTo(0, pane.keepScroll);
                pane.keepScroll = 0;
            }
        } catch (e) { /* 忽略 */ }
        htmlSearchUpdate(pane.search, {});
    }

    function htmlSearchUpdate(st, opts) {
        const pane = dom.html;
        if (!pane) return;
        updateBackdrop(pane);
        if (opts && opts.scroll) scrollEditorToHit(pane);
        const doc = htmlFrameDoc();
        if (!doc || !doc.body) return;
        unwrapMarks(doc.body);
        const marks = highlightInElement(doc.body, st.query);
        if (!marks.length) return;
        const idx = Math.min(Math.max(st.index, 0), marks.length - 1);
        marks[idx].classList.add('ed-hit-current');
        if (opts && opts.scroll) {
            // 只滚动 iframe 内部，避免带动外层分屏
            const win = doc.defaultView;
            const rect = marks[idx].getBoundingClientRect();
            if (win && win.scrollTo) {
                win.scrollTo(0, Math.max(0, win.scrollY + rect.top - win.innerHeight / 3));
            }
        }
    }

    // 在新标签页打开预览
    function openHtmlInNewTab() {
        const src = state.html.text || '';
        if (!src.trim()) { toast('内容为空，无法预览'); return; }
        const full = wrapHtmlDocument(src);
        let url = '';
        try {
            url = URL.createObjectURL(new Blob([full], { type: 'text/html;charset=utf-8' }));
        } catch (e) {
            toast('预览失败：' + (e.message || e));
            return;
        }
        const release = () => setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { } }, 90000);
        try {
            if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
                chrome.tabs.create({ url: url, active: true }, () => {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        toast('打开失败：' + chrome.runtime.lastError.message);
                        return;
                    }
                    toast('已在新标签页打开预览');
                });
                release();
                return;
            }
        } catch (e) { /* 回退到 window.open */ }
        const win = window.open(url, '_blank');
        if (!win) toast('无法打开新标签页，请允许弹出窗口');
        else toast('已在新标签页打开预览');
        release();
    }

    // ================== DOM 构建 ==================
    // 每种编辑器的差异部分（搜索占位符、工具栏动作、下屏内容）
    const PANE_CONF = {
        json: {
            hidden: '',
            searchPlaceholder: '搜索 JSON 内容...',
            inputPlaceholder: '在此输入 / 粘贴 JSON...',
            hint: '下屏将以树状展示 JSON，可右键复制 / 编辑节点',
            tabindex: ' tabindex="0"',
            bodyClass: '',
            bodyInner: '<div class="ed-tree"></div>',
            actions:
                '<button type="button" class="ed-mini-btn" data-act="format" title="格式化"><span class="material-icons">format_align_left</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="minify" title="压缩为一行"><span class="material-icons">compress</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="expand" title="展开全部节点"><span class="material-icons">unfold_more</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="collapse" title="折叠全部节点"><span class="material-icons">unfold_less</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="autoclose" title="自动闭合 HTML 标签"><span class="material-icons">sell</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="copy" title="复制 JSON"><span class="material-icons">content_copy</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="clear" title="清空"><span class="material-icons">delete_sweep</span></button>'
        },
        markdown: {
            hidden: ' hidden',
            searchPlaceholder: '搜索 Markdown 内容...',
            inputPlaceholder: '在此输入 / 粘贴 Markdown...',
            hint: '下屏将实时预览 Markdown',
            tabindex: '',
            bodyClass: '',
            bodyInner: '<div class="md-body"></div>',
            actions:
                '<button type="button" class="ed-mini-btn" data-act="copy" title="复制 Markdown 源码"><span class="material-icons">content_copy</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="copyhtml" title="复制预览 HTML"><span class="material-icons">code</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="clear" title="清空"><span class="material-icons">delete_sweep</span></button>'
        },
        html: {
            hidden: ' hidden',
            searchPlaceholder: '搜索 HTML 内容...',
            inputPlaceholder: '在此输入 / 粘贴 HTML...',
            hint: '下屏将实时预览 HTML（输入触发词后按 Tab 可展开片段）',
            tabindex: '',
            bodyClass: ' no-pad',
            gutter: true,
            bodyInner: '<iframe class="html-frame" title="HTML 预览" sandbox="allow-same-origin"></iframe>',
            actions:
                '<button type="button" class="ed-mini-btn" data-act="snippets" title="代码片段（输入触发词后按 Tab 展开）"><span class="material-icons">bookmarks</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="autoclose" title="自动闭合 HTML 标签"><span class="material-icons">sell</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="copy" title="复制 HTML 源码"><span class="material-icons">content_copy</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="newtab" title="在新标签页预览"><span class="material-icons">open_in_new</span></button>' +
                '<button type="button" class="ed-mini-btn" data-act="clear" title="清空"><span class="material-icons">delete_sweep</span></button>'
        }
    };

    function paneHtml(name, kind) {
        const cfg = PANE_CONF[kind];
        const searchBar =
            '<div class="ed-search">' +
            '  <span class="material-icons ed-search-icon">search</span>' +
            '  <input type="text" class="ed-search-input" spellcheck="false" placeholder="' + cfg.searchPlaceholder + '">' +
            '  <span class="ed-search-count"></span>' +
            '  <button type="button" class="ed-mini-btn ed-search-prev" title="上一个（Shift+Enter）"><span class="material-icons">keyboard_arrow_up</span></button>' +
            '  <button type="button" class="ed-mini-btn ed-search-next" title="下一个（Enter）"><span class="material-icons">keyboard_arrow_down</span></button>' +
            '</div>';

        return '<section class="ed-pane' + cfg.hidden + '" data-pane="' + kind + '">' +
            '<div class="ed-toolbar">' + searchBar + '<div class="ed-actions">' + cfg.actions + '</div></div>' +
            '<div class="ed-split">' +
            '  <div class="ed-cell ed-cell-top">' +
            '    <div class="code-area' + (cfg.gutter ? ' has-gutter' : '') + '">' +
            (cfg.gutter ? '      <div class="code-gutter"><div class="code-gutter-inner"></div></div>' : '') +
            '      <pre class="code-backdrop" aria-hidden="true"></pre>' +
            '      <textarea class="code-textarea" spellcheck="false" placeholder="' + cfg.inputPlaceholder + '"></textarea>' +
            '    </div>' +
            '  </div>' +
            '  <div class="ed-splitter" title="拖动调整分屏比例（双击复位）"><span></span></div>' +
            '  <div class="ed-cell ed-cell-bottom">' +
            '    <div class="ed-error hidden"></div>' +
            '    <div class="ed-pane-body' + cfg.bodyClass + '"' + cfg.tabindex + '>' +
            cfg.bodyInner +
            '    </div>' +
            '    <div class="ed-empty-hint hidden">' + cfg.hint + '</div>' +
            '  </div>' +
            '</div>' +
            '</section>';
    }

    function buildHtml() {
        return '<div class="ed-rail" title="按住图标可拖动排序">' +
            '<div class="ed-rail-tab active" data-editor="json" title="JSON 编辑器">' +
            '  <span class="material-icons ed-rail-icon">data_object</span>' +
            '  <span class="ed-rail-label">JSON</span>' +
            '</div>' +
            '<div class="ed-rail-tab" data-editor="markdown" title="Markdown 编辑器">' +
            '  <span class="material-icons ed-rail-icon">article</span>' +
            '  <span class="ed-rail-label">Markdown</span>' +
            '</div>' +
            '<div class="ed-rail-tab" data-editor="html" title="HTML 编辑器">' +
            '  <span class="material-icons ed-rail-icon">code</span>' +
            '  <span class="ed-rail-label">HTML</span>' +
            '</div>' +
            '</div>' +
            '<div class="ed-main">' +
            paneHtml('json', 'json') +
            paneHtml('markdown', 'markdown') +
            paneHtml('html', 'html') +
            '</div>';
    }

    // ================== 左侧 Tab 拖动排序 ==================
    let railOrder = RAIL_IDS.slice();
    let railDrag = null;
    let railJustDragged = false;

    function railTabs() {
        if (!dom.rail) return [];
        return Array.prototype.slice.call(dom.rail.querySelectorAll('.ed-rail-tab'));
    }

    function setRailOrder(list) {
        const out = [];
        const rest = [];
        (Array.isArray(list) ? list : []).forEach(id => {
            if (RAIL_IDS.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id);
        });
        RAIL_IDS.forEach(id => { if (out.indexOf(id) < 0) rest.push(id); });
        railOrder = out.concat(rest);
    }

    // 按 railOrder 重排 DOM（未知项保留原有相对顺序）
    function applyRailOrder() {
        if (!dom.rail) return;
        const tabs = railTabs();
        const byId = {};
        tabs.forEach(t => { byId[t.dataset.editor] = t; });
        const seq = [];
        railOrder.forEach(id => { if (byId[id]) { seq.push(byId[id]); delete byId[id]; } });
        tabs.forEach(t => { if (byId[t.dataset.editor]) seq.push(t); });
        seq.forEach(t => dom.rail.appendChild(t));
    }

    function saveRailNow() {
        if (!hasStorage()) return;
        try { chrome.storage.local.set({ [K_RAIL]: railOrder.slice() }); } catch (e) { /* 忽略 */ }
    }

    // 拖动过程中：被拖的 Tab 吸附到目标槽位，其余 Tab 让位
    function paintRailDrag() {
        const d = railDrag;
        if (!d || !d.active) return;
        const shift = d.to - d.from;
        d.tab.style.transform = shift ? 'translateY(' + (shift * d.step) + 'px)' : '';
        d.list.forEach((t, i) => {
            if (t === d.tab) return;
            let ty = 0;
            if (shift > 0 && i > d.from && i <= d.to) ty = -d.step;
            else if (shift < 0 && i >= d.to && i < d.from) ty = d.step;
            t.style.transform = ty ? 'translateY(' + ty + 'px)' : '';
        });
    }

    function clearRailDragStyles(list) {
        (list || []).forEach(t => {
            t.style.transform = '';
            t.style.transition = '';
            t.classList.remove('dragging');
        });
    }

    function endRailDrag(commit) {
        const d = railDrag;
        if (!d) return;
        railDrag = null;
        if (!d.active) return;                        // 只是普通点击
        railJustDragged = true;
        setTimeout(() => { railJustDragged = false; }, 0);
        if (d.pointerId != null && d.tab.releasePointerCapture) {
            try { d.tab.releasePointerCapture(d.pointerId); } catch (e) { /* 忽略 */ }
        }
        dom.rail.classList.remove('reordering');
        if (commit && d.to !== d.from) {
            const seq = d.list.slice();
            seq.splice(d.from, 1);
            seq.splice(d.to, 0, d.tab);
            // 先关掉过渡再落位，避免出现"弹回去"的动画
            d.list.forEach(t => { t.style.transition = 'none'; });
            seq.forEach(t => dom.rail.appendChild(t));
            void dom.rail.offsetHeight;
            clearRailDragStyles(d.list);
            railOrder = seq.map(t => t.dataset.editor);
            saveRailNow();
        } else {
            clearRailDragStyles(d.list);              // 取消或没换位置：动画归位
        }
    }

    function onRailPointerDown(e) {
        if (e.button && e.button !== 0) return;
        const tab = e.currentTarget;
        const list = railTabs();
        if (list.length < 2) return;
        const from = list.indexOf(tab);
        if (from < 0) return;
        const rects = list.map(t => t.getBoundingClientRect());
        const step = rects.length > 1
            ? (rects[1].top - rects[0].top)
            : (rects[0].height + 8);
        if (!(step > 0)) return;
        railDrag = {
            tab: tab, list: list, from: from, to: from, step: step,
            x: e.clientX, y: e.clientY, active: false, pointerId: e.pointerId
        };
        if (tab.setPointerCapture) {
            try { tab.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        }
    }

    function onRailPointerMove(e) {
        const d = railDrag;
        if (!d || e.pointerId !== d.pointerId) return;
        const dy = e.clientY - d.y;
        if (!d.active) {
            if (Math.abs(dy) < 5 && Math.abs(e.clientX - d.x) < 5) return;
            d.active = true;
            d.tab.classList.add('dragging');
            dom.rail.classList.add('reordering');
        }
        if (e.cancelable) e.preventDefault();
        const shift = Math.max(-d.from, Math.min(d.list.length - 1 - d.from, Math.round(dy / d.step)));
        const to = d.from + shift;
        if (to === d.to) return;
        d.to = to;
        paintRailDrag();
    }

    function onRailPointerUp(e) {
        const d = railDrag;
        if (!d || e.pointerId !== d.pointerId) return;
        endRailDrag(true);
    }

    function bindRail() {
        railTabs().forEach(tab => {
            tab.addEventListener('click', () => {
                if (railJustDragged) { railJustDragged = false; return; }
                switchEditor(tab.dataset.editor);
            });
            tab.addEventListener('pointerdown', onRailPointerDown);
            tab.addEventListener('pointermove', onRailPointerMove);
            tab.addEventListener('pointerup', onRailPointerUp);
            tab.addEventListener('pointercancel', () => endRailDrag(false));
        });
        // 拖动中按 Esc 取消
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape' && railDrag && railDrag.active) endRailDrag(false);
        });
    }

    // ================== 面板事件装配 ==================
    function bindJsonPane() {
        const root = dom.root;
        const paneEl = root.querySelector('.ed-pane[data-pane="json"]');
        const ta = paneEl.querySelector('.code-textarea');
        const backdrop = paneEl.querySelector('.code-backdrop');

        dom.json = {
            el: paneEl,
            ta: ta,
            backdrop: backdrop,
            split: paneEl.querySelector('.ed-split'),
            topCell: paneEl.querySelector('.ed-cell-top'),
            paneBody: paneEl.querySelector('.ed-pane-body'),
            tree: paneEl.querySelector('.ed-tree'),
            errEl: paneEl.querySelector('.ed-error'),
            emptyHint: paneEl.querySelector('.ed-empty-hint'),
            getText: () => ta.value,
            search: null
        };

        ta.addEventListener('scroll', () => {
            backdrop.scrollTop = ta.scrollTop;
            backdrop.scrollLeft = ta.scrollLeft;
        });

        let inputTimer = null;
        ta.addEventListener('input', () => {
            state.json.text = ta.value;
            dom.json.search.syncFromText();
            clearTimeout(inputTimer);
            inputTimer = setTimeout(parseJsonText, 220);
            scheduleSave();
        });

        dom.json.search = wireSearch(paneEl, {
            getText: () => ta.value,
            onUpdate: (st, opts) => jsonSearchUpdate(st, opts)
        });

        setupTabKey(ta);
        setupAutoCloseTags(ta);

        // 工具栏
        paneEl.querySelectorAll('.ed-actions .ed-mini-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const act = btn.dataset.act;
                if (act === 'format') {
                    try {
                        const data = JSON.parse(ta.value);
                        state.json.collapsed.clear();
                        ta.value = JSON.stringify(data, null, 2);
                        parseJsonText();
                        scheduleSave();
                        toast('已格式化');
                    } catch (err) {
                        toast('JSON 语法错误，无法格式化');
                    }
                } else if (act === 'minify') {
                    try {
                        const data = JSON.parse(ta.value);
                        ta.value = JSON.stringify(data);
                        parseJsonText();
                        scheduleSave();
                        toast('已压缩');
                    } catch (err) {
                        toast('JSON 语法错误，无法压缩');
                    }
                } else if (act === 'expand') {
                    state.json.collapsed.clear();
                    renderTree();
                    dom.json.search.refresh();
                } else if (act === 'collapse') {
                    state.json.collapsed.clear();
                    const walk = (val, path) => {
                        if (!isContainer(val)) return;
                        if (Array.isArray(val)) {
                            if (val.length) state.json.collapsed.add(pathAttr(path));
                            val.forEach((v, i) => walk(v, path.concat(i)));
                        } else {
                            const keys = Object.keys(val);
                            if (keys.length) state.json.collapsed.add(pathAttr(path));
                            keys.forEach(k => walk(val[k], path.concat(k)));
                        }
                    };
                    walk(state.json.data, []);
                    renderTree();
                    dom.json.search.refresh();
                } else if (act === 'autoclose') {
                    toggleAutoClose();
                } else if (act === 'copy') {
                    copyText(ta.value, '已复制 JSON');
                } else if (act === 'clear') {
                    ta.value = '';
                    state.json.text = '';
                    state.json.data = null;
                    state.json.valid = true;
                    state.json.selectedPath = null;
                    state.json.collapsed.clear();
                    dom.json.search.clear();
                    parseJsonText();
                    scheduleSave();
                }
            });
        });

        // 树：折叠 / 选中 / 右键菜单
        const tree = dom.json.tree;
        tree.addEventListener('click', (e) => {
            const nodeEl = e.target.closest('.jnode');
            if (!nodeEl) return;
            const lineEl = e.target.closest('.jline');
            const roleEl = e.target.closest('[data-role]');
            const role = roleEl ? roleEl.dataset.role : 'line';
            let pathArr;
            try { pathArr = JSON.parse(nodeEl.dataset.path); } catch (err) { return; }
            if (role === 'toggle') {
                const attr = nodeEl.dataset.path;
                if (state.json.collapsed.has(attr)) state.json.collapsed.delete(attr);
                else state.json.collapsed.add(attr);
                state.json.selectedPath = attr;
                renderTree();
                dom.json.search.refresh();
                return;
            }
            selectNode(pathArr, lineEl);
        });

        tree.addEventListener('dblclick', (e) => {
            const nodeEl = e.target.closest('.jnode');
            if (!nodeEl) return;
            let pathArr;
            try { pathArr = JSON.parse(nodeEl.dataset.path); } catch (err) { return; }
            const info = resolvePath(pathArr);
            if (!info.exists || isContainer(info.value)) return;
            openNodeDialog('edit', pathArr);
        });

        tree.addEventListener('contextmenu', (e) => {
            const nodeEl = e.target.closest('.jnode');
            if (!nodeEl) return;
            e.preventDefault();
            let pathArr;
            try { pathArr = JSON.parse(nodeEl.dataset.path); } catch (err) { return; }
            const lineEl = e.target.closest('.jline');
            selectNode(pathArr, lineEl);
            const items = buildJsonMenu(pathArr);
            if (items.length) openCtxMenu(e.clientX, e.clientY, items);
        });

        // 键盘：Ctrl+C 复制选中节点
        dom.json.paneBody.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'c' && state.json.selectedPath) {
                let pathArr;
                try { pathArr = JSON.parse(state.json.selectedPath); } catch (err) { return; }
                const info = resolvePath(pathArr);
                if (!info.exists) return;
                e.preventDefault();
                copyText(isContainer(info.value) ? JSON.stringify(info.value, null, 2) : rawValueText(info.value), '已复制');
            } else if (e.key === 'Escape') {
                state.json.selectedPath = null;
                tree.querySelectorAll('.jline.selected').forEach(el => el.classList.remove('selected'));
            }
        });

        initSplitter('json', dom.json);
    }

    function bindMdPane() {
        const root = dom.root;
        const paneEl = root.querySelector('.ed-pane[data-pane="markdown"]');
        const ta = paneEl.querySelector('.code-textarea');
        const backdrop = paneEl.querySelector('.code-backdrop');

        dom.md = {
            el: paneEl,
            ta: ta,
            backdrop: backdrop,
            split: paneEl.querySelector('.ed-split'),
            topCell: paneEl.querySelector('.ed-cell-top'),
            paneBody: paneEl.querySelector('.ed-pane-body'),
            body: paneEl.querySelector('.md-body'),
            emptyHint: paneEl.querySelector('.ed-empty-hint'),
            getText: () => ta.value,
            search: null
        };

        ta.addEventListener('scroll', () => {
            backdrop.scrollTop = ta.scrollTop;
            backdrop.scrollLeft = ta.scrollLeft;
        });

        let inputTimer = null;
        ta.addEventListener('input', () => {
            state.md.text = ta.value;
            dom.md.search.syncFromText();
            clearTimeout(inputTimer);
            inputTimer = setTimeout(() => renderMarkdown({}), 140);
            scheduleSave();
        });

        dom.md.search = wireSearch(paneEl, {
            getText: () => ta.value,
            onUpdate: (st, opts) => mdSearchUpdate(st, opts)
        });

        setupTabKey(ta);

        paneEl.querySelectorAll('.ed-actions .ed-mini-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const act = btn.dataset.act;
                if (act === 'copy') {
                    copyText(ta.value, '已复制 Markdown 源码');
                } else if (act === 'copyhtml') {
                    // 复制预览 HTML 时去掉搜索高亮标记，避免把 <mark> 带出去
                    const clone = dom.md.body.cloneNode(true);
                    clone.querySelectorAll('mark.ed-hit').forEach(m => {
                        m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
                    });
                    copyText(clone.innerHTML, '已复制预览 HTML');
                } else if (act === 'clear') {
                    ta.value = '';
                    state.md.text = '';
                    dom.md.search.clear();
                    renderMarkdown({});
                    scheduleSave();
                }
            });
        });

        initSplitter('md', dom.md);
    }

    // ================== 输入提示下拉框（HTML / CSS3 / JS） ==================
    // 每条： [提示词, 插入内容（支持 ${1:默认值} 占位符）, 说明]
    const HINTS_HTML = [
        ['!', '<!DOCTYPE html>\n<html lang="${1:zh-CN}">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${2:标题}</title>\n</head>\n<body>\n  ${3}\n</body>\n</html>', 'HTML5 文档骨架'],
        ['html', '<html lang="${1:zh-CN}">\n  ${2}\n</html>', '根元素'],
        ['head', '<head>\n  ${1}\n</head>', '文档头'],
        ['meta', '<meta charset="${1:UTF-8}">', '元信息'],
        ['meta:vp', '<meta name="viewport" content="width=device-width, initial-scale=1">', '移动端视口'],
        ['title', '<title>${1}</title>', '文档标题'],
        ['link', '<link rel="${1:stylesheet}" href="${2}">', '引入样式/图标'],
        ['script', '<script>\n  ${1}\n</script>', '内联脚本'],
        ['script:src', '<script src="${1}"></script>', '外部脚本'],
        ['style', '<style>\n  ${1}\n</style>', '内联样式'],
        ['body', '<body>\n  ${1}\n</body>', '文档体'],
        ['div', '<div class="${1}">${2}</div>', '块级容器'],
        ['span', '<span>${1}</span>', '行内容器'],
        ['p', '<p>${1}</p>', '段落'],
        ['h1', '<h1>${1}</h1>', '一级标题'],
        ['h2', '<h2>${1}</h2>', '二级标题'],
        ['h3', '<h3>${1}</h3>', '三级标题'],
        ['h4', '<h4>${1}</h4>', '四级标题'],
        ['h5', '<h5>${1}</h5>', '五级标题'],
        ['h6', '<h6>${1}</h6>', '六级标题'],
        ['a', '<a href="${1}"${2}>${3}</a>', '超链接'],
        ['img', '<img src="${1}" alt="${2}">', '图片'],
        ['picture', '<picture>\n  <source srcset="${1}">\n  <img src="${2}" alt="${3}">\n</picture>', '响应式图片'],
        ['ul', '<ul>\n  <li>${1}</li>\n</ul>', '无序列表'],
        ['ol', '<ol>\n  <li>${1}</li>\n</ol>', '有序列表'],
        ['li', '<li>${1}</li>', '列表项'],
        ['dl', '<dl>\n  <dt>${1}</dt>\n  <dd>${2}</dd>\n</dl>', '描述列表'],
        ['table', '<table>\n  <thead>\n    <tr><th>${1}</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>${2}</td></tr>\n  </tbody>\n</table>', '表格'],
        ['thead', '<thead>\n  ${1}\n</thead>', '表头'],
        ['tbody', '<tbody>\n  ${1}\n</tbody>', '表体'],
        ['tr', '<tr>\n  <td>${1}</td>\n</tr>', '表格行'],
        ['th', '<th>${1}</th>', '表头单元格'],
        ['td', '<td>${1}</td>', '单元格'],
        ['form', '<form action="${1}" method="${2:post}">\n  ${3}\n</form>', '表单'],
        ['label', '<label for="${1}">${2}</label>', '表单标签'],
        ['input', '<input type="${1:text}" name="${2}" value="${3}">', '输入框'],
        ['input:text', '<input type="text" name="${1}" placeholder="${2}">', '文本输入'],
        ['input:checkbox', '<input type="checkbox" id="${1}" name="${2}">', '复选框'],
        ['input:radio', '<input type="radio" name="${1}" value="${2}">', '单选框'],
        ['input:file', '<input type="file" name="${1}" accept="${2}">', '文件选择'],
        ['button', '<button type="${1:button}">${2}</button>', '按钮'],
        ['select', '<select name="${1}">\n  <option value="${2}">${3}</option>\n</select>', '下拉框'],
        ['option', '<option value="${1}">${2}</option>', '选项'],
        ['textarea', '<textarea name="${1}" rows="${2:3}">${3}</textarea>', '多行文本'],
        ['fieldset', '<fieldset>\n  <legend>${1}</legend>\n  ${2}\n</fieldset>', '字段集'],
        ['datalist', '<datalist id="${1}">\n  <option value="${2}">\n</datalist>', '候选数据'],
        ['output', '<output name="${1}">${2}</output>', '计算结果'],
        ['header', '<header>\n  ${1}\n</header>', '页头'],
        ['footer', '<footer>\n  ${1}\n</footer>', '页脚'],
        ['nav', '<nav>\n  ${1}\n</nav>', '导航'],
        ['main', '<main>\n  ${1}\n</main>', '主内容'],
        ['aside', '<aside>\n  ${1}\n</aside>', '侧栏'],
        ['section', '<section>\n  ${1}\n</section>', '区块'],
        ['article', '<article>\n  ${1}\n</article>', '文章'],
        ['figure', '<figure>\n  <img src="${1}" alt="${2}">\n  <figcaption>${3}</figcaption>\n</figure>', '插图'],
        ['figcaption', '<figcaption>${1}</figcaption>', '插图说明'],
        ['details', '<details>\n  <summary>${1}</summary>\n  ${2}\n</details>', '折叠面板'],
        ['summary', '<summary>${1}</summary>', '折叠标题'],
        ['dialog', '<dialog open>\n  ${1}\n</dialog>', '对话框'],
        ['template', '<template>\n  ${1}\n</template>', '模板'],
        ['video', '<video src="${1}" controls></video>', '视频'],
        ['audio', '<audio src="${1}" controls></audio>', '音频'],
        ['source', '<source src="${1}" type="${2}">', '媒体源'],
        ['track', '<track src="${1}" kind="${2:subtitles}" srclang="${3:zh}">', '字幕轨'],
        ['canvas', '<canvas id="${1}" width="${2:300}" height="${3:150}"></canvas>', '画布'],
        ['svg', '<svg viewBox="${1:0 0 24 24}">${2}</svg>', '矢量图'],
        ['iframe', '<iframe src="${1}" title="${2}"></iframe>', '内嵌框架'],
        ['pre', '<pre>${1}</pre>', '预格式文本'],
        ['code', '<code>${1}</code>', '行内代码'],
        ['blockquote', '<blockquote>${1}</blockquote>', '引用'],
        ['hr', '<hr>', '分隔线'],
        ['br', '<br>', '换行'],
        ['strong', '<strong>${1}</strong>', '强调'],
        ['em', '<em>${1}</em>', '着重'],
        ['mark', '<mark>${1}</mark>', '高亮标记'],
        ['small', '<small>${1}</small>', '小号字'],
        ['time', '<time datetime="${1}">${2}</time>', '时间'],
        ['abbr', '<abbr title="${1}">${2}</abbr>', '缩写'],
        ['progress', '<progress value="${1}" max="${2:100}"></progress>', '进度条'],
        ['meter', '<meter value="${1}" min="${2:0}" max="${3:100}"></meter>', '度量'],
        ['slot', '<slot name="${1}"></slot>', '插槽']
    ];

    const HINTS_ATTR = [
        ['class', 'class="${1}"', '样式类名'],
        ['id', 'id="${1}"', '唯一标识'],
        ['style', 'style="${1}"', '内联样式'],
        ['title', 'title="${1}"', '悬停提示'],
        ['href', 'href="${1}"', '链接地址'],
        ['src', 'src="${1}"', '资源地址'],
        ['srcset', 'srcset="${1}"', '多倍图源'],
        ['alt', 'alt="${1}"', '替代文本'],
        ['target', 'target="${1:_blank}"', '打开方式'],
        ['rel', 'rel="${1:noopener}"', '链接关系'],
        ['type', 'type="${1:text}"', '类型'],
        ['name', 'name="${1}"', '名称'],
        ['value', 'value="${1}"', '值'],
        ['placeholder', 'placeholder="${1}"', '占位提示'],
        ['content', 'content="${1}"', '内容（meta）'],
        ['charset', 'charset="UTF-8"', '字符集'],
        ['lang', 'lang="${1:zh-CN}"', '语言'],
        ['dir', 'dir="${1:ltr}"', '书写方向'],
        ['data-', 'data-${1:key}="${2}"', '自定义数据'],
        ['aria-label', 'aria-label="${1}"', '无障碍名称'],
        ['aria-hidden', 'aria-hidden="${1:true}"', '无障碍隐藏'],
        ['role', 'role="${1:button}"', 'ARIA 角色'],
        ['tabindex', 'tabindex="${1:0}"', 'Tab 顺序'],
        ['disabled', 'disabled', '禁用'],
        ['readonly', 'readonly', '只读'],
        ['required', 'required', '必填'],
        ['checked', 'checked', '选中'],
        ['selected', 'selected', '选中项'],
        ['multiple', 'multiple', '多选'],
        ['autofocus', 'autofocus', '自动聚焦'],
        ['autocomplete', 'autocomplete="${1:off}"', '自动填充'],
        ['pattern', 'pattern="${1}"', '校验正则'],
        ['maxlength', 'maxlength="${1:20}"', '最大长度'],
        ['min', 'min="${1:0}"', '最小值'],
        ['max', 'max="${1:100}"', '最大值'],
        ['step', 'step="${1:1}"', '步长'],
        ['rows', 'rows="${1:3}"', '行数'],
        ['cols', 'cols="${1:30}"', '列数'],
        ['colspan', 'colspan="${1:2}"', '跨列'],
        ['rowspan', 'rowspan="${1:2}"', '跨行'],
        ['scope', 'scope="${1:col}"', '表头范围'],
        ['for', 'for="${1}"', '关联表单控件'],
        ['method', 'method="${1:post}"', '提交方式'],
        ['action', 'action="${1}"', '提交地址'],
        ['enctype', 'enctype="multipart/form-data"', '编码方式'],
        ['datetime', 'datetime="${1}"', '日期时间'],
        ['width', 'width="${1:100}"', '宽度'],
        ['height', 'height="${1:100}"', '高度'],
        ['loading', 'loading="${1:lazy}"', '懒加载'],
        ['decoding', 'decoding="${1:async}"', '解码方式'],
        ['referrerpolicy', 'referrerpolicy="${1:no-referrer}"', '来源策略'],
        ['crossorigin', 'crossorigin="${1:anonymous}"', '跨域设置'],
        ['defer', 'defer', '延迟执行'],
        ['async', 'async', '异步执行'],
        ['integrity', 'integrity="${1}"', '子资源校验'],
        ['media', 'media="${1:(max-width: 768px)}"', '媒体条件'],
        ['controls', 'controls', '显示控件'],
        ['autoplay', 'autoplay', '自动播放'],
        ['muted', 'muted', '静音'],
        ['loop', 'loop', '循环'],
        ['playsinline', 'playsinline', '内联播放'],
        ['poster', 'poster="${1}"', '视频封面'],
        ['preload', 'preload="${1:metadata}"', '预加载'],
        ['draggable', 'draggable="${1:true}"', '可拖拽'],
        ['contenteditable', 'contenteditable="${1:true}"', '可编辑'],
        ['spellcheck', 'spellcheck="${1:false}"', '拼写检查'],
        ['hidden', 'hidden', '隐藏'],
        ['download', 'download="${1}"', '下载文件名'],
        ['accept', 'accept="${1:image/*}"', '接受的文件类型'],
        ['novalidate', 'novalidate', '跳过校验']
    ];

    const HINTS_CSS = [
        ['display', 'display: ${1:flex};', '显示方式'],
        ['position', 'position: ${1:relative};', '定位方式'],
        ['inset', 'inset: ${1:0};', '四边定位'],
        ['top', 'top: ${1:0};', '上偏移'],
        ['right', 'right: ${1:0};', '右偏移'],
        ['bottom', 'bottom: ${1:0};', '下偏移'],
        ['left', 'left: ${1:0};', '左偏移'],
        ['z-index', 'z-index: ${1:10};', '层级'],
        ['width', 'width: ${1:100%};', '宽度'],
        ['height', 'height: ${1:100%};', '高度'],
        ['min-width', 'min-width: ${1:0};', '最小宽度'],
        ['max-width', 'max-width: ${1:100%};', '最大宽度'],
        ['min-height', 'min-height: ${1:0};', '最小高度'],
        ['max-height', 'max-height: ${1:100%};', '最大高度'],
        ['margin', 'margin: ${1:0 auto};', '外边距'],
        ['margin-top', 'margin-top: ${1:8px};', '上外边距'],
        ['margin-bottom', 'margin-bottom: ${1:8px};', '下外边距'],
        ['margin-left', 'margin-left: ${1:8px};', '左外边距'],
        ['margin-right', 'margin-right: ${1:8px};', '右外边距'],
        ['padding', 'padding: ${1:8px};', '内边距'],
        ['padding-top', 'padding-top: ${1:8px};', '上内边距'],
        ['padding-bottom', 'padding-bottom: ${1:8px};', '下内边距'],
        ['padding-left', 'padding-left: ${1:8px};', '左内边距'],
        ['padding-right', 'padding-right: ${1:8px};', '右内边距'],
        ['box-sizing', 'box-sizing: border-box;', '盒模型'],
        ['color', 'color: ${1:#334155};', '文字颜色'],
        ['background', 'background: ${1:#ffffff};', '背景'],
        ['background-color', 'background-color: ${1:#f8fafc};', '背景色'],
        ['background-image', 'background-image: url("${1}");', '背景图'],
        ['background-size', 'background-size: ${1:cover};', '背景图尺寸'],
        ['background-position', 'background-position: ${1:center};', '背景位置'],
        ['background-repeat', 'background-repeat: ${1:no-repeat};', '背景重复'],
        ['linear-gradient', 'background: linear-gradient(${1:135deg}, ${2:#6366f1}, ${3:#a855f7});', '线性渐变'],
        ['border', 'border: 1px solid ${1:#e2e8f0};', '边框'],
        ['border-radius', 'border-radius: ${1:8px};', '圆角'],
        ['border-color', 'border-color: ${1:#e2e8f0};', '边框颜色'],
        ['border-width', 'border-width: ${1:1px};', '边框粗细'],
        ['border-style', 'border-style: ${1:solid};', '边框样式'],
        ['box-shadow', 'box-shadow: 0 ${1:2px} ${2:8px} rgba(15, 23, 42, .08);', '阴影'],
        ['outline', 'outline: ${1:none};', '轮廓'],
        ['opacity', 'opacity: ${1:.85};', '不透明度'],
        ['overflow', 'overflow: ${1:hidden};', '溢出处理'],
        ['overflow-x', 'overflow-x: ${1:auto};', '横向溢出'],
        ['overflow-y', 'overflow-y: ${1:auto};', '纵向溢出'],
        ['font', 'font: ${1:14px/1.6} ${2:sans-serif};', '字体简写'],
        ['font-size', 'font-size: ${1:14px};', '字号'],
        ['font-weight', 'font-weight: ${1:600};', '字重'],
        ['font-family', 'font-family: ${1:sans-serif};', '字体族'],
        ['font-style', 'font-style: ${1:italic};', '字体风格'],
        ['line-height', 'line-height: ${1:1.6};', '行高'],
        ['letter-spacing', 'letter-spacing: ${1:.5px};', '字距'],
        ['text-align', 'text-align: ${1:center};', '水平对齐'],
        ['text-decoration', 'text-decoration: ${1:none};', '文本装饰'],
        ['text-overflow', 'text-overflow: ellipsis;', '溢出省略号'],
        ['text-transform', 'text-transform: ${1:uppercase};', '大小写'],
        ['text-shadow', 'text-shadow: 0 ${1:1px} ${2:2px} rgba(0, 0, 0, .2);', '文字阴影'],
        ['text-indent', 'text-indent: ${1:2em};', '首行缩进'],
        ['white-space', 'white-space: ${1:nowrap};', '空白处理'],
        ['word-break', 'word-break: ${1:break-all};', '断词规则'],
        ['vertical-align', 'vertical-align: ${1:middle};', '垂直对齐'],
        ['list-style', 'list-style: ${1:none};', '列表样式'],
        ['flex', 'flex: ${1:1} ${2:1} ${3:auto};', '弹性伸缩'],
        ['flex-direction', 'flex-direction: ${1:column};', '主轴方向'],
        ['flex-wrap', 'flex-wrap: ${1:wrap};', '换行'],
        ['justify-content', 'justify-content: ${1:center};', '主轴对齐'],
        ['align-items', 'align-items: ${1:center};', '交叉轴对齐'],
        ['align-content', 'align-content: ${1:space-between};', '多行对齐'],
        ['align-self', 'align-self: ${1:center};', '单项对齐'],
        ['gap', 'gap: ${1:12px};', '间距'],
        ['order', 'order: ${1:1};', '排序'],
        ['grid', 'display: grid;\ngrid-template-columns: repeat(${1:3}, 1fr);\ngap: ${2:12px};', '网格布局'],
        ['grid-template-columns', 'grid-template-columns: repeat(${1:3}, 1fr);', '网格列'],
        ['grid-template-rows', 'grid-template-rows: repeat(${1:2}, auto);', '网格行'],
        ['grid-area', 'grid-area: ${1:1 / 1 / 2 / 2};', '网格区域'],
        ['grid-column', 'grid-column: span ${1:2};', '跨列'],
        ['grid-row', 'grid-row: span ${1:2};', '跨行'],
        ['place-items', 'place-items: center;', '整体居中'],
        ['transition', 'transition: ${1:all} ${2:.2s} ${3:ease};', '过渡'],
        ['transform', 'transform: translate${1:Y}(${2:4px});', '变换'],
        ['transform-origin', 'transform-origin: ${1:center};', '变换原点'],
        ['animation', 'animation: ${1:spin} ${2:.6s} ${3:linear} infinite;', '动画'],
        ['@keyframes', '@keyframes ${1:spin} {\n  from { transform: rotate(0deg); }\n  to { transform: rotate(360deg); }\n}', '关键帧'],
        ['@media', '@media (max-width: ${1:768px}) {\n  ${2}\n}', '媒体查询'],
        ['@font-face', '@font-face {\n  font-family: "${1}";\n  src: url("${2}");\n}', '自定义字体'],
        ['filter', 'filter: blur(${1:2px});', '滤镜'],
        ['backdrop-filter', 'backdrop-filter: blur(${1:8px});', '背景模糊'],
        ['object-fit', 'object-fit: ${1:cover};', '替换元素填充'],
        ['aspect-ratio', 'aspect-ratio: ${1:16 / 9};', '宽高比'],
        ['cursor', 'cursor: ${1:pointer};', '鼠标样式'],
        ['pointer-events', 'pointer-events: none;', '鼠标穿透'],
        ['user-select', 'user-select: none;', '禁止选择'],
        ['visibility', 'visibility: ${1:hidden};', '可见性'],
        ['content', 'content: "${1}";', '伪元素内容'],
        ['will-change', 'will-change: ${1:transform};', '性能提示'],
        ['scroll-behavior', 'scroll-behavior: smooth;', '平滑滚动'],
        ['scroll-snap-type', 'scroll-snap-type: x mandatory;', '滚动吸附'],
        ['accent-color', 'accent-color: ${1:#4f46e5};', '强调色'],
        ['appearance', 'appearance: none;', '原生外观'],
        ['resize', 'resize: ${1:vertical};', '可调整大小'],
        ['contain', 'contain: ${1:layout paint};', '渲染隔离'],
        ['mix-blend-mode', 'mix-blend-mode: ${1:multiply};', '混合模式'],
        ['clip-path', 'clip-path: circle(${1:50%});', '裁剪']
    ];

    const HINTS_JS = [
        ['const', 'const ${1:name} = ${2:value};', '常量'],
        ['let', 'let ${1:name} = ${2:value};', '变量'],
        ['var', 'var ${1:name} = ${2:value};', '变量（旧写法）'],
        ['this', 'this.${1}', '当前对象'],
        ['new', 'new ${1:Name}(${2})', '创建实例'],
        ['delete', 'delete ${1:obj}.${2:key};', '删除属性'],
        ['function', 'function ${1:name}(${2}) {\n  ${3}\n}', '函数'],
        ['arrow', '(${1}) => ${2}', '箭头函数'],
        ['return', 'return ${1};', '返回'],
        ['if', 'if (${1:cond}) {\n  ${2}\n}', '条件'],
        ['else', 'else {\n  ${1}\n}', '否则'],
        ['else-if', 'else if (${1:cond}) {\n  ${2}\n}', '否则如果'],
        ['for', 'for (let i = 0; i < ${1:n}; i++) {\n  ${2}\n}', '计数循环'],
        ['for-of', 'for (const ${1:item} of ${2:list}) {\n  ${3}\n}', '遍历可迭代'],
        ['for-in', 'for (const ${1:key} in ${2:obj}) {\n  ${3}\n}', '遍历键'],
        ['while', 'while (${1:cond}) {\n  ${2}\n}', '当循环'],
        ['do-while', 'do {\n  ${1}\n} while (${2:cond});', '先执行再判断'],
        ['break', 'break;', '跳出循环'],
        ['continue', 'continue;', '进入下一轮'],
        ['throw', 'throw new Error("${1}");', '抛出异常'],
        ['finally', 'finally {\n  ${1}\n}', '最终执行'],
        ['case', 'case ${1:value}:\n  ${2}\n  break;', '分支项'],
        ['default', 'default:\n  ${1}\n  break;', '默认分支'],
        ['in', '${1:key} in ${2:obj}', '属性是否存在'],
        ['of', 'of ${1:list}', '遍历取值'],
        ['super', 'super(${1});', '父类构造'],
        ['extends', 'extends ${1:Base}', '继承'],
        ['static', 'static ${1:method}() {\n  ${2}\n}', '静态成员'],
        ['yield', 'yield ${1};', '暂停产出'],
        ['void', 'void ${1}', '返回 undefined'],
        ['switch', 'switch (${1:value}) {\n  case ${2}:\n    ${3}\n    break;\n  default:\n    break;\n}', '分支'],
        ['try', 'try {\n  ${1}\n} catch (${2:err}) {\n  ${3}\n}', '异常捕获'],
        ['class', 'class ${1:Name} {\n  constructor(${2}) {\n    ${3}\n  }\n}', '类'],
        ['async', 'async function ${1:name}(${2}) {\n  ${3}\n}', '异步函数'],
        ['await', 'await ${1};', '等待'],
        ['true', 'true', '真'],
        ['false', 'false', '假'],
        ['null', 'null', '空值'],
        ['undefined', 'undefined', '未定义'],
        ['NaN', 'NaN', '非数字'],
        ['Infinity', 'Infinity', '无穷大'],
        ['Boolean', 'Boolean(${1})', '转布尔'],
        ['Symbol', 'Symbol("${1}")', '唯一值'],
        ['BigInt', 'BigInt(${1})', '大整数'],
        ['Set', 'new Set(${1})', '集合'],
        ['Map', 'new Map(${1})', '映射表'],
        ['Proxy', 'new Proxy(${1}, {})', '代理'],
        ['Reflect', 'Reflect.get(${1}, "${2}")', '反射'],
        ['promise', 'new Promise((resolve, reject) => {\n  ${1}\n});', 'Promise'],
        ['import', 'import ${1:name} from "${2}";', '导入模块'],
        ['export', 'export ${1:default} ${2};', '导出模块'],
        ['console.log', 'console.log(${1});', '打印'],
        ['console.error', 'console.error(${1});', '错误日志'],
        ['console.table', 'console.table(${1});', '表格日志'],
        ['querySelector', 'document.querySelector("${1}")', '查单个元素'],
        ['querySelectorAll', 'document.querySelectorAll("${1}")', '查多个元素'],
        ['getElementById', 'document.getElementById("${1}")', '按 id 取元素'],
        ['createElement', 'document.createElement("${1}")', '创建元素'],
        ['document.querySelector', 'document.querySelector("${1}")', '查单个元素'],
        ['document.querySelectorAll', 'document.querySelectorAll("${1}")', '查多个元素'],
        ['document.getElementById', 'document.getElementById("${1}")', '按 id 取元素'],
        ['document.createElement', 'document.createElement("${1}")', '创建元素'],
        ['document.addEventListener', 'document.addEventListener("${1:DOMContentLoaded}", () => {\n  ${2}\n});', '文档事件'],
        ['document.body', 'document.body', 'body 元素'],
        ['document.title', 'document.title', '文档标题'],
        ['window.addEventListener', 'window.addEventListener("${1:resize}", () => {\n  ${2}\n});', '窗口事件'],
        ['window.location', 'window.location.href', '当前地址'],
        ['window.innerWidth', 'window.innerWidth', '可视宽度'],
        ['window.innerHeight', 'window.innerHeight', '可视高度'],
        ['element.classList', '${1:el}.classList.add("${2}")', '增删类名'],
        ['element.style', '${1:el}.style.${2:display} = "${3:none}";', '设置样式'],
        ['addEventListener', '${1:el}.addEventListener("${2:click}", (e) => {\n  ${3}\n});', '绑定事件'],
        ['removeEventListener', '${1:el}.removeEventListener("${2:click}", ${3:handler});', '解绑事件'],
        ['setTimeout', 'setTimeout(() => {\n  ${1}\n}, ${2:300});', '延时执行'],
        ['setInterval', 'setInterval(() => {\n  ${1}\n}, ${2:1000});', '定时执行'],
        ['clearInterval', 'clearInterval(${1});', '清除定时器'],
        ['requestAnimationFrame', 'requestAnimationFrame(() => {\n  ${1}\n});', '帧回调'],
        ['fetch', 'fetch("${1}")\n  .then((r) => r.json())\n  .then((data) => {\n    ${2}\n  });', '网络请求'],
        ['fetch-await', 'const res = await fetch("${1}");\nconst data = await res.json();', '异步请求'],
        ['JSON.parse', 'JSON.parse(${1})', '解析 JSON'],
        ['JSON.stringify', 'JSON.stringify(${1}, null, 2)', '序列化 JSON'],
        ['map', '${1:arr}.map((${2:item}) => ${3})', '映射'],
        ['filter', '${1:arr}.filter((${2:item}) => ${3})', '过滤'],
        ['reduce', '${1:arr}.reduce((acc, cur) => ${2}, ${3:0})', '归并'],
        ['forEach', '${1:arr}.forEach((${2:item}) => {\n  ${3}\n});', '遍历'],
        ['find', '${1:arr}.find((${2:item}) => ${3})', '查找首个'],
        ['some', '${1:arr}.some((${2:item}) => ${3})', '存在满足'],
        ['every', '${1:arr}.every((${2:item}) => ${3})', '全部满足'],
        ['sort', '${1:arr}.sort((a, b) => a - b)', '排序'],
        ['includes', '${1}.includes(${2})', '包含'],
        ['push', '${1}.push(${2})', '尾部添加'],
        ['pop', '${1}.pop()', '尾部删除'],
        ['slice', '${1}.slice(${2:0}, ${3})', '截取'],
        ['splice', '${1}.splice(${2:index}, ${3:1})', '增删'],
        ['join', '${1}.join("${2:,}")', '连接'],
        ['split', '${1}.split("${2:,}")', '切分'],
        ['trim', '${1}.trim()', '去空格'],
        ['padStart', '${1}.padStart(${2:2}, "${3:0}")', '前补位'],
        ['repeat', '${1}.repeat(${2:3})', '重复'],
        ['toUpperCase', '${1}.toUpperCase()', '转大写'],
        ['replace', '${1}.replace(/${2:pattern}/g, "${3}")', '替换'],
        ['match', '${1}.match(/${2:pattern}/g)', '匹配'],
        ['Object.keys', 'Object.keys(${1})', '键数组'],
        ['Object.values', 'Object.values(${1})', '值数组'],
        ['Object.entries', 'Object.entries(${1})', '键值对数组'],
        ['Object.assign', 'Object.assign({}, ${1})', '合并对象'],
        ['Array.from', 'Array.from(${1})', '转数组'],
        ['Array.isArray', 'Array.isArray(${1})', '是否数组'],
        ['parseInt', 'parseInt(${1}, 10)', '转整数'],
        ['parseFloat', 'parseFloat(${1})', '转小数'],
        ['Number', 'Number(${1})', '转数字'],
        ['String', 'String(${1})', '转字符串'],
        ['Math.max', 'Math.max(${1})', '最大值'],
        ['Math.min', 'Math.min(${1})', '最小值'],
        ['Math.round', 'Math.round(${1})', '四舍五入'],
        ['Math.random', 'Math.random()', '随机数'],
        ['Date', 'new Date()', '当前时间'],
        ['RegExp', 'new RegExp("${1}", "${2:g}")', '正则对象'],
        ['typeof', 'typeof ${1}', '类型判断'],
        ['instanceof', '${1} instanceof ${2}', '实例判断'],
        ['localStorage', 'localStorage.setItem("${1}", JSON.stringify(${2}));', '本地存储'],
        ['sessionStorage', 'sessionStorage.getItem("${1}")', '会话存储'],
        ['classList', '${1}.classList.add("${2}")', '增删类名'],
        ['style', '${1}.style.${2:display} = "${3:none}";', '设置样式'],
        ['textContent', '${1}.textContent = ${2};', '文本内容'],
        ['innerHTML', '${1}.innerHTML = ${2};', 'HTML 内容'],
        ['dataset', '${1}.dataset.${2}', '自定义数据'],
        ['appendChild', '${1}.appendChild(${2})', '追加子节点'],
        ['removeChild', '${1}.removeChild(${2})', '移除子节点'],
        ['remove', '${1}.remove()', '移除自身'],
        ['closest', '${1}.closest("${2:selector}")', '查找最近祖先'],
        ['getAttribute', '${1}.getAttribute("${2}")', '读属性'],
        ['setAttribute', '${1}.setAttribute("${2}", "${3}")', '写属性'],
        ['location', 'location.href', '当前地址'],
        ['history', 'history.pushState({}, "", "${1}")', '历史记录'],
        ['navigator', 'navigator.clipboard.writeText(${1})', '剪贴板'],
        ['URLSearchParams', 'new URLSearchParams(location.search).get("${1}")', '查询参数'],
        ['alert', 'alert(${1})', '弹窗提示'],
        ['confirm', 'confirm("${1}")', '确认框'],
        ['prompt', 'prompt("${1}", "${2}")', '输入框'],
        ['encodeURIComponent', 'encodeURIComponent(${1})', 'URL 编码'],
        ['decodeURIComponent', 'decodeURIComponent(${1})', 'URL 解码']
    ];

    // 成员访问提示：word 形如 document.que 时只提示点后面的成员
    // 第 4 项是该成员所属的对象（可选），命中时排在最前面
    const HINT_MEMBER = [
        ['log', 'log(${1})', '打印', 'console'],
        ['error', 'error(${1})', '错误日志', 'console'],
        ['warn', 'warn(${1})', '警告日志', 'console'],
        ['info', 'info(${1})', '信息日志', 'console'],
        ['table', 'table(${1})', '表格日志', 'console'],
        ['time', 'time("${1}")', '计时开始', 'console'],
        ['timeEnd', 'timeEnd("${1}")', '计时结束', 'console'],
        ['group', 'group("${1}")', '分组开始', 'console'],
        ['groupEnd', 'groupEnd()', '分组结束', 'console'],
        ['count', 'count("${1}")', '计数', 'console'],
        ['dir', 'dir(${1})', '对象结构', 'console'],
        ['assert', 'assert(${1}, "${2}")', '断言', 'console'],
        ['clear', 'clear()', '清屏', 'console'],

        ['getElementById', 'getElementById("${1}")', '按 id 取元素', 'document'],
        ['createElement', 'createElement("${1}")', '创建元素', 'document'],
        ['createTextNode', 'createTextNode("${1}")', '创建文本节点', 'document'],
        ['body', 'body', 'body 元素', 'document'],
        ['documentElement', 'documentElement', 'html 元素', 'document'],
        ['title', 'title', '文档标题', 'document'],
        ['cookie', 'cookie', 'Cookie', 'document'],

        ['parse', 'parse(${1})', '解析 JSON', 'json'],
        ['stringify', 'stringify(${1}, null, 2)', '序列化 JSON', 'json'],

        ['keys', 'keys()', '键数组', 'object'],
        ['values', 'values()', '值数组', 'object'],
        ['entries', 'entries()', '键值对数组', 'object'],
        ['assign', 'assign({}, ${1})', '合并对象', 'object'],
        ['hasOwn', 'hasOwn(${1}, "${2}")', '是否有自有属性', 'object'],

        ['from', 'from(${1})', '转数组', 'array'],
        ['isArray', 'isArray(${1})', '是否数组', 'array'],

        ['max', 'max(${1})', '最大值', 'math'],
        ['min', 'min(${1})', '最小值', 'math'],
        ['round', 'round(${1})', '四舍五入', 'math'],
        ['floor', 'floor(${1})', '向下取整', 'math'],
        ['ceil', 'ceil(${1})', '向上取整', 'math'],
        ['abs', 'abs(${1})', '绝对值', 'math'],
        ['random', 'random()', '随机数', 'math'],
        ['pow', 'pow(${1}, ${2})', '幂', 'math'],

        ['then', 'then((res) => ${1})', '成功后', 'promise'],
        ['catch', 'catch((err) => {\n  ${1}\n})', '失败后', 'promise'],
        ['finally', 'finally(() => {\n  ${1}\n})', '最终执行', 'promise'],
        ['resolve', 'resolve(${1})', '成功', 'promise'],
        ['reject', 'reject(${1})', '失败', 'promise'],

        ['getItem', 'getItem("${1}")', '读取', 'storage'],
        ['setItem', 'setItem("${1}", ${2})', '写入', 'storage'],
        ['removeItem', 'removeItem("${1}")', '删除', 'storage'],
        ['clear', 'clear()', '清空', 'storage'],

        ['writeText', 'writeText(${1})', '写剪贴板', 'navigator'],
        ['clipboard', 'clipboard.writeText(${1})', '剪贴板', 'navigator'],

        // 不限定对象的通用成员（数组 / 字符串 / 元素 / Map / Set 等）
        ['map', 'map((${1:item}) => ${2})', '映射'],
        ['filter', 'filter((${1:item}) => ${2})', '过滤'],
        ['forEach', 'forEach((${1:item}) => {\n  ${2}\n})', '遍历'],
        ['find', 'find((${1:item}) => ${2})', '查找首个'],
        ['findIndex', 'findIndex((${1:item}) => ${2})', '查找下标'],
        ['some', 'some((${1:item}) => ${2})', '存在满足'],
        ['every', 'every((${1:item}) => ${2})', '全部满足'],
        ['reduce', 'reduce((acc, cur) => ${1}, ${2:0})', '归并'],
        ['sort', 'sort((a, b) => a - b)', '排序'],
        ['reverse', 'reverse()', '反转'],
        ['push', 'push(${1})', '尾部添加'],
        ['pop', 'pop()', '尾部删除'],
        ['shift', 'shift()', '头部删除'],
        ['unshift', 'unshift(${1})', '头部添加'],
        ['slice', 'slice(${1:0}, ${2})', '截取'],
        ['splice', 'splice(${1:index}, ${2:1})', '增删'],
        ['concat', 'concat(${1})', '拼接'],
        ['join', 'join("${1:,}")', '连接成字符串'],
        ['includes', 'includes(${1})', '是否包含'],
        ['indexOf', 'indexOf(${1})', '首次出现位置'],
        ['length', 'length', '长度'],
        ['split', 'split("${1:,}")', '切分'],
        ['trim', 'trim()', '去首尾空格'],
        ['toUpperCase', 'toUpperCase()', '转大写'],
        ['toLowerCase', 'toLowerCase()', '转小写'],
        ['replace', 'replace(/${1:pattern}/g, "${2}")', '替换'],
        ['match', 'match(/${1:pattern}/g)', '匹配'],
        ['padStart', 'padStart(${1:2}, "${2:0}")', '前补位'],
        ['padEnd', 'padEnd(${1:2}, "${2:0}")', '后补位'],
        ['repeat', 'repeat(${1:3})', '重复'],
        ['charAt', 'charAt(${1:0})', '指定位置字符'],
        ['startsWith', 'startsWith("${1}")', '以…开头'],
        ['endsWith', 'endsWith("${1}")', '以…结尾'],
        ['toString', 'toString()', '转字符串'],
        ['querySelector', 'querySelector("${1}")', '查单个子元素'],
        ['querySelectorAll', 'querySelectorAll("${1}")', '查多个子元素'],
        ['classList', 'classList.add("${1}")', '类名操作'],
        ['style', 'style.${1:display} = "${2:none}"', '样式'],
        ['dataset', 'dataset.${1}', '自定义数据'],
        ['textContent', 'textContent = ${1}', '文本内容'],
        ['innerHTML', 'innerHTML = ${1}', 'HTML 内容'],
        ['value', 'value', '表单值'],
        ['checked', 'checked', '是否选中'],
        ['children', 'children', '子元素'],
        ['parentElement', 'parentElement', '父元素'],
        ['appendChild', 'appendChild(${1})', '追加子节点'],
        ['removeChild', 'removeChild(${1})', '移除子节点'],
        ['remove', 'remove()', '移除自身'],
        ['closest', 'closest("${1:selector}")', '最近祖先'],
        ['getAttribute', 'getAttribute("${1}")', '读属性'],
        ['setAttribute', 'setAttribute("${1}", "${2}")', '写属性'],
        ['addEventListener', 'addEventListener("${1:click}", (e) => {\n  ${2}\n})', '绑定事件'],
        ['removeEventListener', 'removeEventListener("${1:click}", ${2:handler})', '解绑事件'],
        ['focus', 'focus()', '聚焦'],
        ['click', 'click()', '触发点击'],
        ['json', 'json()', '解析响应为 JSON'],
        ['text', 'text()', '响应文本'],
        ['preventDefault', 'preventDefault()', '阻止默认行为'],
        ['stopPropagation', 'stopPropagation()', '阻止冒泡'],
        ['has', 'has(${1})', '是否存在'],
        ['get', 'get(${1})', '读取'],
        ['set', 'set(${1}, ${2})', '写入'],
        ['delete', 'delete(${1})', '删除'],
        ['size', 'size', '成员数量']
    ];

    const HINT_META = {
        html: 'HTML 标签',
        attr: 'HTML 属性',
        css: 'CSS3 属性',
        js: 'JavaScript',
        member: 'JS 成员'
    };

    let hintCache = null;

    function hintList(name) {
        if (!hintCache) hintCache = {};
        if (!hintCache[name]) {
            const src = name === 'attr' ? HINTS_ATTR : (name === 'css' ? HINTS_CSS : (name === 'js' ? HINTS_JS : HINTS_HTML));
            hintCache[name] = src.map(h => ({
                key: h[0], ins: h[1], desc: h[2] || '', low: String(h[0]).toLowerCase(), ini: humpInitials(h[0])
            }));
        }
        return hintCache[name];
    }

    // 光标所在语境：style 块 → css / script 块 → js / on* 属性值 → js / 标签内 → attr / 其它 → html
    // 返回 '' 表示这个位置不提示
    function hintContext(src, caret) {
        const head = src.slice(Math.max(0, caret - 200000), caret);
        const re = /<(\/?)(script|style)(?=[\s/>])/gi;
        let last = null;
        let m = re.exec(head);
        while (m) {
            last = { close: m[1] === '/', tag: m[2].toLowerCase() };
            m = re.exec(head);
        }
        if (last && !last.close) {
            // 处在字符串里就别提示了
            const line = src.slice(src.lastIndexOf('\n', caret - 1) + 1, caret);
            const dq = (line.split('"').length - 1) % 2;
            const sq = (line.split("'").length - 1) % 2;
            if (dq || sq) return '';
            return last.tag === 'style' ? 'css' : 'js';
        }
        const lt = head.lastIndexOf('<');
        const gt = head.lastIndexOf('>');
        if (lt > gt) {
            const after = head.slice(lt + 1);
            const dq = (after.split('"').length - 1) % 2;
            const sq = (after.split("'").length - 1) % 2;
            if (dq || sq) {
                // 属性值里：onclick / oninput 这类事件属性写的是 JS，按 JS 提示
                const q = dq ? after.lastIndexOf('"') : after.lastIndexOf("'");
                const am = /([A-Za-z][A-Za-z0-9-]*)\s*=\s*$/.exec(after.slice(0, q));
                return am && /^on/i.test(am[1]) ? 'js' : '';
            }
            const tm = /^\/?([A-Za-z][A-Za-z0-9-]*)([\s/]*)$/.exec(after);
            if (tm && !tm[2]) return 'html';                                         // 正在写标签名
            return 'attr';                                                           // 已经进到属性区
        }
        return 'html';
    }

    // 当前正在输入的词（起始位置会连带前面的 < 或 </，避免插入后多出一个尖括号）
    function hintWord(src, caret, ctx) {
        const before = src.slice(0, caret);
        const re = ctx === 'js' ? /[A-Za-z_$][A-Za-z0-9_$.]*$/ : /[A-Za-z_$@-][A-Za-z0-9_$.:-]*$/;
        const m = re.exec(before);
        let start;
        let text;
        let angle = false;
        if (m && m[0]) {
            text = m[0];
            start = caret - text.length;
        } else if (ctx === 'js' && before.charAt(caret - 1) === '.') {
            text = '';                                          // 形如 getElementById("dd"). 后面还没打字母
            start = caret;
        } else if (before.charAt(caret - 1) === '<') {
            text = '';
            start = caret - 1;
            angle = true;
        } else {
            return null;
        }
        if (ctx !== 'js' && text && (src.charAt(start - 1) === '<' || src.charAt(start - 1) === '/')) {
            if (src.charAt(start - 1) === '/') start--;
            if (src.charAt(start - 1) === '<') { start--; angle = true; }
        }
        if (ctx === 'js') {
            const mem = jsMemberWord(src, caret, start, text);
            if (mem) return mem;
        }
        return { text: text, start: start, end: caret, angle: angle };
    }

    // 从点号往前取出"对象表达式"，支持标识符链、调用()、下标[]
    function receiverBefore(src, dot) {
        let i = dot - 1;
        let depth = 0;
        let quote = '';
        while (i >= 0) {
            const c = src.charAt(i);
            if (quote) {
                if (c === quote && src.charAt(i - 1) !== '\\') quote = '';
                i--;
                continue;
            }
            if (c === '"' || c === "'" || c === '`') { quote = c; i--; continue; }
            if (c === ')' || c === ']' || c === '}') { depth++; i--; continue; }
            if (c === '(' || c === '[' || c === '{') {
                if (depth === 0) break;
                depth--; i--; continue;
            }
            if (depth > 0) { i--; continue; }
            if (/[A-Za-z0-9_$.]/.test(c)) { i--; continue; }
            break;
        }
        return src.slice(i + 1, dot);
    }

    // JS 成员访问：document.que / arr.ma / document.getElementById("dd"). / foo().bar
    // 只替换点后面的成员名，保留前面已经写好的对象，返回 null 表示不是成员访问
    function jsMemberWord(src, caret, start, text) {
        const i = src.charAt(start - 1) === '.' ? start - 1 : -1;
        if (i < 0) {
            if (!text) return null;
            const dot = text.lastIndexOf('.');
            if (dot <= 0 || dot >= text.length) return null;
            return {
                text: text, start: start + dot + 1, end: caret, angle: false,
                base: text.slice(0, dot), member: text.slice(dot + 1)
            };
        }
        return {
            text: text, start: start, end: caret, angle: false,
            base: receiverBefore(src, i), member: text
        };
    }

    // 首字母缩写：querySelectorAll → qsa、getElementById → gebi、addEventListener → ael
    // 这样只按几个字母也能命中（qsa / gebi / ael）
    function humpInitials(key) {
        const s = String(key);
        let out = '';
        for (let i = 0; i < s.length; i++) {
            const c = s.charAt(i);
            if (!/[A-Za-z]/.test(c)) continue;
            const prev = i ? s.charAt(i - 1) : '';
            if (i === 0 || (c >= 'A' && c <= 'Z') || /[.\-_: ]/.test(prev)) out += c.toLowerCase();
        }
        return out;
    }

    // 前缀命中时保持词表本身的顺序（哪个更常用是人肉排好的）

    function hintMatches(ctx, word) {
        const list = hintList(ctx);
        const w = String(word || '').toLowerCase();
        if (!w) return list.slice(0, 200);
        const out = [];
        for (let i = 0; i < list.length && out.length < 60; i++) {
            if (list[i].low.indexOf(w) === 0) out.push(list[i]);
        }
        // 前缀命中不多时按首字母缩写补（qsa → querySelectorAll）
        if (w.length >= 2 && out.length < 6) {
            list.forEach(h => {
                if (out.length < 20 && h.ini.indexOf(w) === 0 && out.indexOf(h) < 0) out.push(h);
            });
        }
        // 还是太少时补几个"包含"命中，但要够长才补，避免 di 这类短词混进无关项
        if (w.length >= 3 && out.length < 3) {
            list.forEach(h => {
                if (out.length < 20 && h.low.indexOf(w) > 0 && out.indexOf(h) < 0) out.push(h);
            });
        }
        return out;
    }

    let memberCache = null;

    function memberList() {
        if (!memberCache) {
            memberCache = HINT_MEMBER.map(h => ({
                key: h[0], ins: h[1], desc: h[2] || '', low: String(h[0]).toLowerCase(),
                ini: humpInitials(h[0]), on: h[3] || ''
            }));
        }
        return memberCache;
    }

    // 对象表达式 → 提示分组：先看结尾调用的函数名（返回什么），再看最后一段标识符
    const RECV_BY_CALL = {
        queryselector: 'element', queryselectorall: 'element', getelementbyid: 'element',
        getelementsbyclassname: 'element', getelementsbytagname: 'element', createelement: 'element',
        closest: 'element', appendchild: 'element', cloneNode: 'element',
        fetch: 'promise', then: 'promise', catch: 'promise', finally: 'promise'
    };
    const RECV_BY_NAME = {
        body: 'element', target: 'element', currenttarget: 'element', parentelement: 'element',
        firstchild: 'element', lastchild: 'element', nextelementsibling: 'element', previouselementsibling: 'element'
    };
    // 元素 / Promise 上最常用的一批成员（按常用度排好）
    const MEMBER_PREFER = {
        element: ['classList', 'style', 'textContent', 'innerHTML', 'dataset', 'value', 'checked',
            'addEventListener', 'getAttribute', 'setAttribute', 'appendChild', 'children',
            'parentElement', 'closest', 'querySelector', 'remove', 'focus', 'click'],
        promise: ['then', 'catch', 'finally', 'json', 'text']
    };

    function receiverGroup(expr) {
        let s = String(expr || '').trim();
        let call = '';
        for (let g = 0; g < 6; g++) {
            const m = /(\(([^()]*)\)|\[[^\[\]]*\])\s*$/.exec(s);
            if (!m) break;
            const head = s.slice(0, m.index);
            const nm = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(head);
            if (nm && !call) call = nm[1].toLowerCase();
            s = head;
        }
        if (call && RECV_BY_CALL[call]) return RECV_BY_CALL[call];
        const last = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(s);
        const name = last ? last[1].toLowerCase() : '';
        return RECV_BY_NAME[name] || name;
    }

    // 成员提示：命中对象本身的成员排前面，通用成员跟着，关键字还能再筛
    function memberMatches(receiver, member) {
        const grp = receiverGroup(receiver);
        const w = String(member || '').toLowerCase();
        const all = memberList();
        const byKey = {};
        all.forEach(h => { byKey[h.key] = h; });
        const spec = [];
        const pref = MEMBER_PREFER[grp];
        if (pref) pref.forEach(k => { if (byKey[k]) spec.push(byKey[k]); });
        else if (grp) all.forEach(h => { if (h.on === grp) spec.push(h); });
        const gen = all.filter(h => h.on === '' && spec.indexOf(h) < 0);
        const starts = arr => arr.filter(h => !w || h.low.indexOf(w) === 0);
        const out = starts(spec).concat(starts(gen));
        if (w.length >= 2 && out.length < 6) {
            spec.concat(gen).forEach(h => {
                if (out.length < 40 && h.ini.indexOf(w) === 0 && out.indexOf(h) < 0) out.push(h);
            });
        }
        if (w.length >= 2 && out.length < 3) {
            all.forEach(h => {
                if (out.length < 40 && h.low.indexOf(w) > 0 && out.indexOf(h) < 0) out.push(h);
            });
        }
        return out.slice(0, 80);
    }

    // 下拉框状态
    const ac = {
        el: null, list: null, title: null,
        items: [], index: 0, open: false,
        start: 0, end: 0, ctx: '', word: '', lastHtml: '', inserting: false, navigated: false,
        raf: 0, tid: 0
    };

    function ensureAcEl() {
        if (ac.el) return ac.el;
        const el = document.createElement('div');
        el.className = 'ed-ac hidden';
        el.innerHTML = '<div class="ed-ac-head"><span class="ed-ac-title">HTML 标签</span>' +
            '<span class="ed-ac-keys">↑↓ 选择 · Tab/空格/回车 确认</span></div>' +
            '<div class="ed-ac-list"></div>';
        document.body.appendChild(el);
        ac.el = el;
        ac.list = el.querySelector('.ed-ac-list');
        ac.title = el.querySelector('.ed-ac-title');
        ac.list.addEventListener('mousedown', e => {
            e.preventDefault();
            const item = e.target && e.target.closest ? e.target.closest('.ed-ac-item') : null;
            if (!item) return;
            ac.index = parseInt(item.dataset.i, 10) || 0;
            acInsert();
        });
        return el;
    }

    function closeAc() {
        if (ac.tid) { clearTimeout(ac.tid); ac.tid = 0; }
        if (ac.raf) { cancelAnimationFrame(ac.raf); ac.raf = 0; }
        if (!ac.open) return;
        ac.open = false;
        if (ac.el) ac.el.classList.add('hidden');
    }

    function renderAc() {
        const items = ac.items;
        if (ac.title) ac.title.textContent = HINT_META[ac.ctx] || '';
        const html = items.map((it, i) =>
            '<div class="ed-ac-item' + (i === ac.index ? ' on' : '') + '" data-i="' + i + '">' +
            '<code>' + esc(it.key) + '</code><span>' + esc(it.desc) + '</span></div>').join('');
        if (ac.lastHtml !== html) {
            ac.list.innerHTML = html;
            ac.lastHtml = html;
        }
    }

    // 光标在镜像层里的屏幕位置（此时镜像与源文本逐字符对应）
    function caretScreenRect(pane) {
        const bd = pane.backdrop;
        const ta = pane.ta;
        const caret = ta.selectionStart;
        const walker = document.createTreeWalker(bd, NodeFilter.SHOW_TEXT);
        let n;
        let acc = 0;
        while ((n = walker.nextNode())) {
            const len = n.data.length;
            if (caret <= acc + len) {
                const r = document.createRange();
                r.setStart(n, caret - acc);
                r.setEnd(n, caret - acc);
                const rc = r.getBoundingClientRect();
                if (rc && (rc.height || rc.width || rc.top)) return rc;
                break;
            }
            acc += len;
        }
        return null;
    }

    // 定位放到帧后执行：那时布局已干净，读取几何信息不会造成输入卡顿
    function acPosition(pane) {
        if (!ac.open || !ac.el) return;
        const rect = caretScreenRect(pane);
        if (!rect) { closeAc(); return; }
        const w = ac.el.offsetWidth || 240;
        const h = ac.el.offsetHeight || 200;
        let left = Math.round(rect.left);
        let top = Math.round(rect.bottom + 2);
        if (top + h > window.innerHeight - 6) top = Math.max(6, Math.round(rect.top - h - 2));
        if (left + w > window.innerWidth - 6) left = Math.max(6, window.innerWidth - w - 6);
        ac.el.style.left = left + 'px';
        ac.el.style.top = top + 'px';
        scrollAcIntoView();
    }

    // 让选中项滚进可视区
    function scrollAcIntoView() {
        const cur = ac.list && ac.list.children[ac.index];
        if (!cur) return;
        const top = cur.offsetTop;
        const bot = top + cur.offsetHeight;
        if (top < ac.list.scrollTop) ac.list.scrollTop = top;
        else if (bot > ac.list.scrollTop + ac.list.clientHeight) ac.list.scrollTop = bot - ac.list.clientHeight;
    }

    function scheduleAcPosition(pane) {
        if (ac.raf || ac.tid) return;
        ac.raf = requestAnimationFrame(() => {
            ac.raf = 0;
            ac.tid = setTimeout(() => {
                ac.tid = 0;
                acPosition(pane);
            }, 0);
        });
    }

    function openAc(pane, keepIndex) {
        const el = ensureAcEl();
        if (!keepIndex) ac.index = 0;
        if (ac.index >= ac.items.length) ac.index = 0;
        if (!ac.open) {
            el.classList.remove('hidden');
            el.style.left = '-9999px';
            el.style.top = '0px';
            ac.open = true;
        }
        ac.lastHtml = '';
        renderAc();
        scheduleAcPosition(pane);
    }

    function acInsert() {
        const pane = dom.html;
        if (!pane || !ac.items.length) { closeAc(); return; }
        const item = ac.items[ac.index];
        if (!item) { closeAc(); return; }
        const ta = pane.ta;
        const ph = applyPlaceholders(item.ins);
        let text = ph.text;
        let caretRel = -1;
        const markAt = text.indexOf(SNIP_MARK);
        if (markAt !== -1) {
            text = text.split(SNIP_MARK).join('');
            caretRel = markAt;
        }
        const before = ta.value;
        ac.inserting = true;
        replaceRangeText(ta, ac.start, ac.end, text);
        const base = ac.start;
        if (ph.fields.length) {
            setFields(ta, ph.fields.map(f => ({ start: base + f.start, end: base + f.end })));
        } else if (caretRel !== -1) {
            ta.selectionStart = ta.selectionEnd = base + caretRel;
            clearFields(ta);
        } else {
            ta.selectionStart = ta.selectionEnd = base + text.length;
            clearFields(ta);
        }
        closeAc();
        if (ta.value !== before) ta.dispatchEvent(new Event('input', { bubbles: true }));
        updateBackdrop(pane);
        setTimeout(() => { ac.inserting = false; }, 0);
    }

    // 输入时刷新候选（只做字符串运算，定位延后）
    function acOnInput(pane) {
        if (!pane || pane !== dom.html || ac.inserting) return;
        const ta = pane.ta;
        if (ta.selectionStart !== ta.selectionEnd) { closeAc(); return; }
        const src = String(pane.getText());
        const caret = ta.selectionStart;
        const ctx = hintContext(src, caret);
        if (!ctx) { closeAc(); return; }
        const word = hintWord(src, caret, ctx);
        if (!word) { closeAc(); return; }
        // 正文里的标签提示只在打了 < 之后才弹，否则写英文单词时会误触（如 the + 空格）
        if (ctx === 'html' && word.text && !word.angle) { closeAc(); return; }
        const isMember = ctx === 'js' && word.member !== undefined;
        const items = isMember ? memberMatches(word.base, word.member) : hintMatches(ctx, word.text);
        if (!items.length) { closeAc(); return; }
        const ctxKey = isMember ? 'member' : ctx;
        const same = ac.open && ac.ctx === ctxKey && ac.word === word.text && ac.start === word.start;
        ac.ctx = ctxKey;
        ac.word = word.text;
        ac.start = word.start;
        ac.end = word.end;
        ac.items = items;
        if (!same) ac.navigated = false;         // 词变了就重新回到默认选中项
        openAc(pane, same);
    }

    function acMove(delta) {
        if (!ac.items.length) return;
        ac.index = (ac.index + delta + ac.items.length) % ac.items.length;
        ac.navigated = true;
        renderAc();
        scheduleAcPosition(dom.html);            // 帧后顺带把选中项滚进可视区
    }

    // ===================== Ctrl+/ 注释选中代码 =====================
    // 选区覆盖的整行范围（选区末尾正好落在行首时，不把下一行算进来）
    function lineBounds(ta) {
        const v = ta.value;
        const s = ta.selectionStart;
        let e = ta.selectionEnd;
        if (e > s && v.charAt(e - 1) === '\n') e--;
        const a = v.lastIndexOf('\n', s - 1) + 1;
        let b = v.indexOf('\n', e);
        if (b < 0) b = v.length;
        return { a: a, b: b };
    }

    function indentLen(line) {
        const m = /^[ \t]*/.exec(line);
        return m ? m[0].length : 0;
    }

    // 行注释切换（JS 用 //）
    function toggleLineComment(ta, marker) {
        const v = ta.value;
        const r = lineBounds(ta);
        const lines = v.slice(r.a, r.b).split('\n');
        const hasText = lines.some(l => l.trim());
        const all = hasText && lines.every(l => !l.trim() || l.trim().indexOf(marker) === 0);
        const out = lines.map(l => {
            if (!l.trim()) return l;
            const pad = indentLen(l);
            const body = l.slice(pad);
            if (!all) return l.slice(0, pad) + marker + ' ' + body;
            let rest = body.slice(marker.length);
            if (rest.charAt(0) === ' ') rest = rest.slice(1);
            return l.slice(0, pad) + rest;
        }).join('\n');
        return { from: r.a, to: r.b, text: out };
    }

    // 块注释范围：有选区就包住选区（跨行则对齐到整行正文），没有就包住当前行正文
    function blockTarget(ta) {
        const v = ta.value;
        let s = ta.selectionStart;
        let e = ta.selectionEnd;
        const r = lineBounds(ta);
        if (e === s) {
            s = r.a + indentLen(v.slice(r.a, r.b));
            e = r.b;
        } else if (v.slice(s, e).indexOf('\n') >= 0) {
            s = r.a + indentLen(v.slice(r.a, r.b));
            e = r.b;
        }
        return { s: s, e: e };
    }

    function toggleBlockComment(ta, open, close) {
        const v = ta.value;
        const t = blockTarget(ta);
        const head = v.slice(0, t.s);
        const tail = v.slice(t.e);
        const headTrim = head.replace(/\s+$/, '');
        const tailTrim = tail.replace(/^\s+/, '');
        if (headTrim.endsWith(open) && tailTrim.startsWith(close)) {
            const from = headTrim.length - open.length;
            const to = t.e + (tail.length - tailTrim.length) + close.length;
            let text = v.slice(from + open.length, to - close.length);
            if (text.charAt(0) === ' ') text = text.slice(1);
            if (text.charAt(text.length - 1) === ' ') text = text.slice(0, -1);
            return { from: from, to: to, text: text };
        }
        const inner = v.slice(t.s, t.e);
        const innerTrim = inner.replace(/^\s+/, '').replace(/\s+$/, '');
        // 目标本身已经是一整段注释 → 去掉标记
        if (innerTrim.length > open.length + close.length &&
            innerTrim.startsWith(open) && innerTrim.endsWith(close)) {
            const lead = inner.length - inner.replace(/^\s+/, '').length;
            let text = innerTrim.slice(open.length, innerTrim.length - close.length);
            if (text.charAt(0) === ' ') text = text.slice(1);
            if (text.charAt(text.length - 1) === ' ') text = text.slice(0, -1);
            return { from: t.s + lead, to: t.s + lead + innerTrim.length, text: text };
        }
        return { from: t.s, to: t.e, text: innerTrim ? open + ' ' + inner + ' ' + close : open + ' ' + close };
    }

    // 写回输入框：优先用 execCommand，保住浏览器原生撤销栈（Ctrl+Z 能整段回退）
    function applyEdit(ta, from, to, text) {
        const selStart = ta.selectionStart;
        const selEnd = ta.selectionEnd;
        closeAc();
        ta.focus();
        ta.setSelectionRange(from, to);
        let ok = false;
        try { ok = document.execCommand('insertText', false, text); } catch (err) { ok = false; }
        // execCommand 在隐藏的输入框上会"返回成功但没写进去"，所以要核对结果
        if (!ok || ta.value.slice(from, from + text.length) !== text) {
            ta.setRangeText(text, from, to, 'end');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (selEnd > selStart) {
            ta.setSelectionRange(from, from + text.length);
        } else {
            const delta = text.length - (to - from);
            const c = Math.max(from, Math.min(from + text.length, selStart + delta));
            ta.setSelectionRange(c, c);
        }
    }

    function toggleComment(ta, kind) {
        let r;
        if (kind === 'js') r = toggleLineComment(ta, '//');
        else if (kind === 'css') r = toggleBlockComment(ta, '/*', '*/');
        else r = toggleBlockComment(ta, '<!--', '-->');
        if (r) applyEdit(ta, r.from, r.to, r.text);
    }

    // HTML 编辑器按语境选注释方式：<script> → // ／ <style> → /* */ ／ 其它 → <!-- -->
    function commentKind(pane, isHtml) {
        if (!isHtml) return 'html';
        const ctx = hintContext(String(pane.ta.value), pane.ta.selectionStart);
        if (ctx === 'js') return 'js';
        if (ctx === 'css') return 'css';
        return 'html';
    }

    function bindCommentKeys(pane, isHtml) {
        pane.ta.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            if (e.key !== '/' && e.code !== 'Slash' && e.keyCode !== 191) return;
            e.preventDefault();
            e.stopPropagation();
            toggleComment(pane.ta, commentKind(pane, isHtml));
        }, true);
    }

    // 捕获阶段处理按键：打开时 Tab/空格/回车都用于确认，方向键选择
    function acKeydown(e) {
        if (!ac.open) {
            if ((e.key === ' ' || e.code === 'Space') && (e.ctrlKey || e.metaKey)) {
                const pane = dom.html;
                if (!pane) return;
                const src = String(pane.getText());
                const caret = pane.ta.selectionStart;
                const ctx = hintContext(src, caret) || 'html';
                const word = hintWord(src, caret, ctx) || { text: '', start: caret, end: caret };
                const isMember = ctx === 'js' && word.member !== undefined;
                ac.ctx = isMember ? 'member' : ctx;
                ac.word = word.text;
                ac.start = word.start;
                ac.end = word.end;
                ac.items = isMember ? memberMatches(word.base, word.member) : hintMatches(ctx, '');
                if (ac.items.length) { e.preventDefault(); e.stopPropagation(); openAc(pane); }
            }
            return;
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); acMove(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); acMove(-1); return; }
        if (e.key === 'Tab') {
            // 没有在列表里选过时，Tab 仍然是"片段展开"键（保持原有习惯）
            if (!ac.navigated) {
                const ta = dom.html && dom.html.ta;
                const abbr = ta ? abbreviationBefore(ta) : null;
                if (abbr && looksLikeAbbreviation(abbr.text)) { closeAc(); return; }
            }
            e.preventDefault();
            e.stopPropagation();
            acInsert();
            return;
        }
        if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            e.stopPropagation();
            acInsert();
            return;
        }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAc(); return; }
        if (e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown' ||
            e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            closeAc();
        }
    }

    function bindHtmlPane() {
        const root = dom.root;
        const paneEl = root.querySelector('.ed-pane[data-pane="html"]');
        const ta = paneEl.querySelector('.code-textarea');
        const backdrop = paneEl.querySelector('.code-backdrop');
        const frame = paneEl.querySelector('.html-frame');

        dom.html = {
            el: paneEl,
            ta: ta,
            backdrop: backdrop,
            frame: frame,
            split: paneEl.querySelector('.ed-split'),
            topCell: paneEl.querySelector('.ed-cell-top'),
            paneBody: paneEl.querySelector('.ed-pane-body'),
            body: frame,                     // 搜索高亮容器由 htmlSearchUpdate 内部处理
            emptyHint: paneEl.querySelector('.ed-empty-hint'),
            gutterInner: paneEl.querySelector('.code-gutter-inner'),
            getText: () => ta.value,
            search: null,
            renderedHtml: null,
            keepScroll: 0,
            // 背板用 HTML 语法高亮 + 配对高亮 + 搜索命中（仅着色可视窗口）
            decorate: (src, st, pane, win) => htmlBackdrop(src, st, pane, win)
        };

        frame.addEventListener('load', onHtmlFrameLoad);

        let scrollRaf = 0;
        ta.addEventListener('scroll', () => {
            const p = dom.html;
            const sy = ta.scrollTop;
            const sx = ta.scrollLeft;
            const ch = ta.clientHeight;
            p.scrollY = sy;
            p.scrollX = sx;
            p.clientH = ch;
            backdrop.scrollTop = sy;
            backdrop.scrollLeft = sx;
            if (scrollRaf) return;
            scrollRaf = requestAnimationFrame(() => {
                scrollRaf = 0;
                const win = p.lnWin;
                // 窗口必须覆盖可视区；滚回顶部时窗口还得从第一行开始，否则第 1 行的行号会缺
                const covered = win && win.tops && win.tops.length &&
                    sy >= win.tops[0] - 30 && sy + ch <= win.tops[win.tops.length - 1] + 48 &&
                    !(sy <= 0 && win.from > 0);
                if (covered) renderLineNumbers(p);
                else updateBackdrop(p);
            });
        });

        let inputTimer = null;
        ta.addEventListener('input', () => {
            state.html.text = ta.value;
            shiftFields(ta);
            dom.html.search.syncFromText();
            acOnInput(dom.html);
            clearTimeout(inputTimer);
            inputTimer = setTimeout(() => renderHtmlPreview({}), 300);
            scheduleSave();
        });

        // 输入提示：捕获阶段拦截，保证 Tab/空格/回车/方向键先给下拉框用
        ta.addEventListener('keydown', acKeydown, true);
        ta.addEventListener('blur', () => closeAc());
        ta.addEventListener('scroll', () => closeAc());
        ta.addEventListener('click', () => closeAc());
        // 面板被隐藏 / 失焦 / 改变大小时，浮层必须收起来
        window.addEventListener('blur', () => closeAc());
        window.addEventListener('resize', () => closeAc());

        // 光标移动时刷新配对标签高亮
        let matchRaf = 0;
        const refreshMatch = () => {
            if (matchRaf) return;
            matchRaf = requestAnimationFrame(() => {
                matchRaf = 0;
                updateBackdrop(dom.html);
            });
        };
        ta.addEventListener('keyup', refreshMatch);
        ta.addEventListener('click', refreshMatch);
        ta.addEventListener('select', refreshMatch);

        dom.html.search = wireSearch(paneEl, {
            getText: () => ta.value,
            onUpdate: (st, opts) => htmlSearchUpdate(st, opts)
        });

        // Tab：先尝试占位符跳转 / 片段展开，否则插入两个空格
        setupTabKey(ta, () => {
            if (jumpToNextField(ta)) return true;
            const abbr = abbreviationBefore(ta);
            if (!abbr || !looksLikeAbbreviation(abbr.text)) return false;
            return expandSnippetAt(ta, abbr);
        });
        setupAutoCloseTags(ta);

        paneEl.querySelectorAll('.ed-actions .ed-mini-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const act = btn.dataset.act;
                if (act === 'copy') {
                    copyText(ta.value, '已复制 HTML 源码');
                } else if (act === 'newtab') {
                    openHtmlInNewTab();
                } else if (act === 'autoclose') {
                    toggleAutoClose();
                } else if (act === 'snippets') {
                    openSnippetDialog();
                } else if (act === 'clear') {
                    ta.value = '';
                    state.html.text = '';
                    clearFields(ta);
                    dom.html.search.clear();
                    renderHtmlPreview({});
                    updateBackdrop(dom.html);
                    scheduleSave();
                }
            });
        });

        initSplitter('html', dom.html);
    }

    // ================== 外部分屏同步 ==================
    function syncBackdrops() {
        PANE_KEYS.forEach(k => {
            const pane = dom[k];
            if (!pane || !pane.ta || !pane.backdrop) return;
            pane.scrollY = pane.ta.scrollTop;
            pane.scrollX = pane.ta.scrollLeft;
            pane.backdrop.scrollTop = pane.scrollY;
            pane.backdrop.scrollLeft = pane.scrollX;
            if (pane.topCell) {
                const ratio = state[k].splitRatio || 0.5;
                pane.topCell.style.flexBasis = (ratio * 100).toFixed(2) + '%';
            }
        });
    }

    function switchEditor(name) {
        if (name !== 'json' && name !== 'markdown' && name !== 'html') return;
        state.active = name;
        dom.root.querySelectorAll('.ed-rail-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.editor === name);
        });
        PANE_KEYS.forEach(k => {
            const pane = dom[k];
            if (!pane || !pane.el) return;
            pane.el.classList.toggle('hidden', PANE_NAME[k] !== name);
        });
        syncBackdrops();
        closeAc();
        if (name === 'html' && dom.html && dom.html.el) {
            dom.html.clientW = undefined;
            dom.html.clientH = undefined;
            requestAnimationFrame(() => updateBackdrop(dom.html));
        }
        scheduleSave();
    }

    // ================== 初始化 ==================
    function init() {
        const root = document.getElementById('view-editor');
        if (!root) return;
        if (root.dataset.editorReady === '1') return;
        const wrap = document.createElement('div');
        wrap.className = 'ed-wrap';
        wrap.innerHTML = buildHtml();
        root.innerHTML = '';
        root.appendChild(wrap);
        root.dataset.editorReady = '1';
        dom.root = wrap;
        dom.rail = wrap.querySelector('.ed-rail');

        bindJsonPane();
        bindMdPane();
        bindHtmlPane();
        wrap.appendChild(buildDialog());
        snipEl = buildSnippetDialog();
        wrap.appendChild(snipEl);
        syncAutoCloseButtons();

        // 左侧竖向 Tab：点击切换 + 按住拖动排序
        bindRail();
        if (dom.html) bindCommentKeys(dom.html, true);
        if (dom.md) bindCommentKeys(dom.md, false);
        applyRailOrder();

        // 分屏拖动/窗口尺寸变化后行号需要重新测量
        const htmlPane = dom.html.el;
        const invalidateHtmlGeom = () => {
            dom.html.clientW = undefined;
            dom.html.clientH = undefined;
            updateBackdrop(dom.html);
        };
        htmlPane.querySelector('.ed-splitter').addEventListener('mouseup', invalidateHtmlGeom);
        htmlPane.querySelector('.ed-splitter').addEventListener('dblclick', invalidateHtmlGeom);
        window.addEventListener('resize', () => {
            if (dom.html && dom.html.el) invalidateHtmlGeom();
        });

        // 全局：点击/滚动关闭右键菜单
        document.addEventListener('click', (e) => {
            if (ctxEl && !ctxEl.contains(e.target)) closeCtxMenu();
        });
        window.addEventListener('resize', closeCtxMenu);
        window.addEventListener('blur', closeCtxMenu);

        // 默认示例内容（首次使用时展示；有持久化内容则覆盖）
        switchEditor(state.active);
        if (hasStorage()) loadPersisted();
        else applyDefaultContent();
    }

    function applyDefaultContent() {
        const jsonSample = {
            name: 'Meow',
            version: '19.1.1',
            features: ['sidepanel', 'calendar', 'annotation'],
            editor: { json: true, markdown: true, html: true, search: { highlight: true, prevNext: true } }
        };
        const mdSample = '# Meow Markdown 编辑器\n\n上方输入 Markdown，下方实时预览。\n\n- 支持 **粗体**、*斜体*、~~删除线~~、`行内代码`\n- 支持列表、引用、表格、代码块\n\n| 功能 | 状态 |\n| --- | :---: |\n| 搜索高亮 | ✅ |\n| 上一个/下一个 | ✅ |\n\n> 提示：右键 JSON 树节点可复制 / 编辑 / 插入 / 删除。\n\n```js\nconst editor = { json: true, markdown: true, html: true };\n```\n';
        const htmlSample = '<div class="card">\n  <h2>Meow HTML 预览</h2>\n  <p>上方输入 HTML，下方实时预览，样式与侧边栏互不影响。</p>\n  <ul>\n    <li>支持完整的 HTML / CSS</li>\n    <li>搜索栏可高亮预览中的命中词</li>\n    <li>点右上角 ↗ 可<strong>在新标签页打开预览</strong></li>\n  </ul>\n</div>\n\n<style>\n  body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif; color: #334155; }\n  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; background: #f8fafc; }\n  .card h2 { margin: 0 0 8px; font-size: 16px; color: #4f46e5; }\n  .card ul { margin: 8px 0 0; padding-left: 18px; line-height: 1.8; }\n</style>\n';
        dom.json.ta.value = JSON.stringify(jsonSample, null, 2);
        dom.md.ta.value = mdSample;
        dom.html.ta.value = htmlSample;
        state.json.text = dom.json.ta.value;
        state.md.text = dom.md.ta.value;
        state.html.text = dom.html.ta.value;
        parseJsonText();
        renderMarkdown({});
        renderHtmlPreview({});
        updateBackdrop(dom.html);
    }

    function loadPersisted() {
        if (!hasStorage()) { applyDefaultContent(); return; }
        try {
            chrome.storage.local.get([K_JSON, K_MD, K_HTML, K_ACTIVE, K_AUTOCLOSE, K_SNIPPETS, K_SPLIT, K_RAIL], (res) => {
                const data = res || {};
                let restored = false;
                if (typeof data[K_AUTOCLOSE] === 'boolean') state.autoClose = data[K_AUTOCLOSE];
                if (Array.isArray(data[K_SNIPPETS])) setSnippets(data[K_SNIPPETS]);
                if (Array.isArray(data[K_RAIL])) {
                    setRailOrder(data[K_RAIL]);
                    applyRailOrder();
                }
                if (typeof data[K_JSON] === 'string' && data[K_JSON].length) {
                    dom.json.ta.value = data[K_JSON];
                    state.json.text = data[K_JSON];
                    parseJsonText();
                    restored = true;
                }
                if (typeof data[K_MD] === 'string' && data[K_MD].length) {
                    dom.md.ta.value = data[K_MD];
                    state.md.text = data[K_MD];
                    renderMarkdown({});
                    restored = true;
                }
                if (typeof data[K_HTML] === 'string' && data[K_HTML].length) {
                    dom.html.ta.value = data[K_HTML];
                    state.html.text = data[K_HTML];
                    renderHtmlPreview({});
                    updateBackdrop(dom.html);
                    restored = true;
                }
                if (data[K_SPLIT] && typeof data[K_SPLIT] === 'object') {
                    PANE_KEYS.forEach(k => {
                        if (typeof data[K_SPLIT][k] === 'number') state[k].splitRatio = data[K_SPLIT][k];
                    });
                }
                if (!restored) applyDefaultContent();
                if (data[K_ACTIVE] === 'json' || data[K_ACTIVE] === 'markdown' || data[K_ACTIVE] === 'html') {
                    state.active = data[K_ACTIVE];
                }
                switchEditor(state.active);
                syncAutoCloseButtons();
            });
        } catch (e) {
            applyDefaultContent();
        }
    }

    // 供 sp-core 在切换到编辑器标签时调用
    function onShown() {
        const root = document.getElementById('view-editor');
        if (!root || root.dataset.editorReady !== '1') init();
        syncBackdrops();
    }

    window.initEditor = init;
    window.onEditorTabShown = onShown;
    window.switchEditorRail = switchEditor;
})();
