// workbench-ssh.js — 工作台页面第一 TAB：SSH 工作区
// 功能：服务器分组 / 凭据连接 / 真实 SSH（本地桥接）/ 多会话终端 / 常用命令分组
// 说明：真实 SSH 由 ssh-bridge 转发，不再提供本地模拟终端。

(function () {
    'use strict';

    var view = document.getElementById('view-ssh');
    if (!view) return;

    var STORE_KEY = 'meow_ssh_workspace_v1';
    var UI_KEY = 'meow_ssh_ui_v1';
    var BRIDGE_KEY = 'meow_ssh_bridge_v1';

    var HAS_CHROME_STORAGE = false;
    try {
        HAS_CHROME_STORAGE = !!(window.chrome && chrome.storage && chrome.storage.local);
    } catch (e) {
        HAS_CHROME_STORAGE = false;
    }

    // ======================================================================
    // 状态
    // ======================================================================

    var state = null;
    var ui = { collapsed: {}, cmdCollapsed: {}, search: '' };
    var commandSearch = '';
    var dragState = null;
    var suppressCommandClickUntil = 0;
    var bridge = { url: 'ws://127.0.0.1:8765', token: '', status: 'unknown' };

    var sessions = [];
    var activeSessionId = null;

    var editingServerId = null;
    var editingCommandId = null;
    var connectTargetId = null;

    var promptCallback = null;
    var promptValidator = null;

    var saveTimer = null;

    var els = {};

    // ======================================================================
    // 工具
    // ======================================================================

    function $(id) {
        return document.getElementById(id);
    }

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    function uid(prefix) {
        return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    }

    // ======================================================================
    // 存储
    // ======================================================================

    function storageGet(keys) {
        return new Promise(function (resolve) {
            if (HAS_CHROME_STORAGE) {
                var finished = false;
                var finish = function (value) {
                    if (finished) return;
                    finished = true;
                    resolve(value || {});
                };
                var timer = setTimeout(function () { finish({}); }, 1800);
                try {
                    chrome.storage.local.get(keys, function (result) {
                        clearTimeout(timer);
                        try {
                            if (chrome.runtime && chrome.runtime.lastError) {
                                finish({});
                                return;
                            }
                        } catch (e) { /* ignore */ }
                        finish(result);
                    });
                } catch (e) {
                    clearTimeout(timer);
                    finish({});
                }
                return;
            }

            var out = {};
            keys.forEach(function (key) {
                try {
                    var raw = localStorage.getItem(key);
                    out[key] = raw ? JSON.parse(raw) : null;
                } catch (e) {
                    out[key] = null;
                }
            });
            resolve(out);
        });
    }

    function storageSet(obj) {
        if (HAS_CHROME_STORAGE) {
            try {
                chrome.storage.local.set(obj);
            } catch (e) { /* ignore */ }
            return;
        }
        Object.keys(obj).forEach(function (key) {
            try {
                localStorage.setItem(key, JSON.stringify(obj[key]));
            } catch (e) { /* ignore */ }
        });
    }

    function saveState(immediate) {
        clearTimeout(saveTimer);
        var payload = {};
        payload[STORE_KEY] = state;
        if (immediate) {
            storageSet(payload);
        } else {
            saveTimer = setTimeout(function () { storageSet(payload); }, 100);
        }
    }

    function saveUi() {
        var payload = {};
        payload[UI_KEY] = ui;
        storageSet(payload);
    }

    function saveBridge() {
        var payload = {};
        payload[BRIDGE_KEY] = { url: bridge.url, token: bridge.token };
        storageSet(payload);
    }

    function seedData() {
        var stamp = Date.now().toString(36);
        var ops = 'cg_ops_' + stamp;
        var logs = 'cg_logs_' + stamp;
        var deploy = 'cg_deploy_' + stamp;

        return {
            groups: [
                { id: 'grp_prod_' + stamp, name: '生产环境' },
                { id: 'grp_stage_' + stamp, name: '预发布环境' }
            ],
            servers: [],
            commandGroups: [
                { id: ops, name: '系统巡检' },
                { id: logs, name: '日志排查' },
                { id: deploy, name: '部署发布' }
            ],
            commands: [
                { id: 'cmd_df_' + stamp, name: '磁盘占用', cmd: 'df -h', groupId: ops },
                { id: 'cmd_free_' + stamp, name: '内存使用', cmd: 'free -h', groupId: ops },
                { id: 'cmd_load_' + stamp, name: '系统负载', cmd: 'uptime', groupId: ops },
                { id: 'cmd_ps_' + stamp, name: '进程列表', cmd: 'ps aux', groupId: ops },
                { id: 'cmd_syslog_' + stamp, name: '系统日志', cmd: 'tail -n 30 /var/log/syslog', groupId: logs },
                { id: 'cmd_nginx_' + stamp, name: 'Nginx 状态', cmd: 'systemctl status nginx', groupId: logs },
                { id: 'cmd_docker_' + stamp, name: '容器列表', cmd: 'docker ps', groupId: deploy },
                { id: 'cmd_neofetch_' + stamp, name: '系统信息', cmd: 'neofetch', groupId: '' }
            ]
        };
    }

    function normalizeData(raw) {
        var data = (raw && typeof raw === 'object') ? raw : seedData();

        var groups = (Array.isArray(data.groups) ? data.groups : []).filter(function (g) {
            return g && typeof g.name === 'string' && g.name.trim();
        }).map(function (g) {
            return { id: String(g.id || uid('grp')), name: String(g.name).trim() };
        });

        var groupIds = {};
        groups.forEach(function (g) { groupIds[g.id] = true; });

        var servers = (Array.isArray(data.servers) ? data.servers : []).filter(function (s) {
            return s && String(s.host || '').trim();
        }).map(function (s) {
            var groupId = String(s.groupId || '');
            return {
                id: String(s.id || uid('srv')),
                name: String(s.name || s.host).trim(),
                groupId: groupIds[groupId] ? groupId : '',
                host: String(s.host).trim(),
                port: String(s.port || '22'),
                username: String(s.username || 'root'),
                password: String(s.password || ''),
                note: String(s.note || ''),
                os: String(s.os || '')
            };
        });

        var commandGroups = (Array.isArray(data.commandGroups) ? data.commandGroups : []).filter(function (g) {
            return g && typeof g.name === 'string' && g.name.trim();
        }).map(function (g) {
            return { id: String(g.id || uid('cg')), name: String(g.name).trim() };
        });

        var commandGroupIds = {};
        commandGroups.forEach(function (g) { commandGroupIds[g.id] = true; });

        var commands = (Array.isArray(data.commands) ? data.commands : []).filter(function (c) {
            return c && String(c.cmd || '').trim();
        }).map(function (c) {
            var groupId = String(c.groupId || '');
            return {
                id: String(c.id || uid('cmd')),
                name: String(c.name || c.cmd).trim(),
                cmd: String(c.cmd),
                groupId: commandGroupIds[groupId] ? groupId : ''
            };
        });

        return { groups: groups, servers: servers, commandGroups: commandGroups, commands: commands };
    }

    // ======================================================================
    // Toast / 确认框
    // ======================================================================

    function toast(message, type) {
        var stack = $('glass-toast-stack');
        if (!stack) return;

        var el = document.createElement('div');
        el.className = 'glass-toast' + (type ? ' ' + type : '');
        var icon = type === 'error' ? 'fa-circle-exclamation'
            : type === 'success' ? 'fa-circle-check' : 'fa-circle-info';
        el.innerHTML = '<i class="fa-regular ' + icon + '"></i><span>' + esc(message) + '</span>';
        stack.appendChild(el);

        setTimeout(function () {
            el.classList.add('leaving');
            setTimeout(function () {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 220);
        }, 2600);
    }

    function confirmDialog(options) {
        if (typeof window.showConfirmDialog === 'function') {
            try {
                return Promise.resolve(window.showConfirmDialog(options)).catch(function () { return false; });
            } catch (e) { /* fall through */ }
        }
        return Promise.resolve(window.confirm(options && options.message ? options.message : '确定继续？'));
    }

    function legacyCopyText(text) {
        return new Promise(function (resolve, reject) {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.left = '-9999px';
            area.style.top = '0';
            document.body.appendChild(area);
            area.select();
            area.setSelectionRange(0, area.value.length);
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
            if (area.parentNode) area.parentNode.removeChild(area);
            if (ok) resolve();
            else reject(new Error('复制命令不可用'));
        });
    }

    function copyText(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                return navigator.clipboard.writeText(text).catch(function () {
                    return legacyCopyText(text);
                });
            } catch (e) {
                return legacyCopyText(text);
            }
        }
        return legacyCopyText(text);
    }

    // ======================================================================
    // 模态框
    // ======================================================================

    function openModal(id) {
        var modal = $(id);
        if (!modal) return;
        modal.classList.remove('hidden');
        void modal.offsetWidth;
        modal.classList.add('visible');
    }

    function closeModal(id) {
        var modal = $(id);
        if (!modal) return;
        modal.classList.remove('visible');
        setTimeout(function () {
            if (!modal.classList.contains('visible')) modal.classList.add('hidden');
        }, 200);
    }

    function bindModalDismiss(id) {
        var modal = $(id);
        if (!modal) return;
        modal.addEventListener('mousedown', function (e) {
            if (e.target === modal || e.target.classList.contains('modal-overlay')) {
                closeModal(id);
            }
        });
        Array.prototype.forEach.call(modal.querySelectorAll('[data-close]'), function (btn) {
            btn.addEventListener('click', function () { closeModal(id); });
        });
    }

    function openPrompt(options) {
        $('glass-prompt-title').textContent = options.title || '输入';
        $('glass-prompt-label').textContent = options.label || '名称';
        var input = $('glass-prompt-input');
        input.value = options.value || '';
        input.placeholder = options.placeholder || '';
        var hint = $('glass-prompt-hint');
        if (options.hint) {
            hint.textContent = options.hint;
            hint.classList.remove('hidden');
        } else {
            hint.textContent = '';
            hint.classList.add('hidden');
        }
        promptCallback = options.onConfirm || null;
        promptValidator = options.validator || null;
        openModal('glass-prompt-modal');
        setTimeout(function () {
            input.focus();
            input.select();
        }, 60);
    }

    function submitPrompt() {
        var value = $('glass-prompt-input').value.trim();
        if (!value) {
            toast('名称不能为空', 'error');
            return;
        }
        if (promptValidator && promptValidator(value) === false) return;
        var callback = promptCallback;
        promptCallback = null;
        promptValidator = null;
        closeModal('glass-prompt-modal');
        if (callback) callback(value);
    }

    // ======================================================================
    // 服务器渲染
    // ======================================================================

    function getActiveSession() {
        for (var i = 0; i < sessions.length; i++) {
            if (sessions[i].id === activeSessionId) return sessions[i];
        }
        return null;
    }

    function getServer(id) {
        for (var i = 0; i < state.servers.length; i++) {
            if (state.servers[i].id === id) return state.servers[i];
        }
        return null;
    }

    function getCommand(id) {
        for (var i = 0; i < state.commands.length; i++) {
            if (state.commands[i].id === id) return state.commands[i];
        }
        return null;
    }

    function osIcon(os) {
        var map = {
            Windows: 'fa-brands fa-windows',
            Ubuntu: 'fa-brands fa-ubuntu',
            Debian: 'fa-brands fa-debian',
            CentOS: 'fa-brands fa-centos'
        };
        return '<i class="' + (map[os] || 'fa-regular fa-server') + '"></i>';
    }

    function serverMatches(srv, query) {
        return [srv.name, srv.host, srv.username, srv.note, srv.port]
            .join(' ')
            .toLowerCase()
            .indexOf(query) >= 0;
    }

    function renderServers() {
        var list = els.serverList;
        if (!list) return;

        var scrollTop = list.scrollTop;
        var query = (ui.search || '').trim().toLowerCase();
        list.innerHTML = '';

        if (els.serverCount) els.serverCount.textContent = String(state.servers.length);

        if (!state.servers.length) {
            list.appendChild(buildServerListEmpty());
            return;
        }

        var groups = state.groups.slice();
        groups.push({ id: '', name: '未分组', fallback: true });

        var matched = 0;

        groups.forEach(function (group) {
            var items = state.servers.filter(function (srv) {
                return (srv.groupId || '') === group.id;
            });

            if (query) items = items.filter(function (srv) { return serverMatches(srv, query); });

            if (group.fallback && !items.length && !query) return;
            if (query && !items.length) return;

            matched += items.length;
            list.appendChild(buildServerGroup(group, items, !!query));
        });

        if (query && matched === 0) {
            var empty = document.createElement('div');
            empty.className = 'list-empty';
            empty.innerHTML = '<i class="fa-regular fa-magnifying-glass"></i>' +
                '<span>没有匹配「' + esc(ui.search) + '」的服务器</span>';
            list.appendChild(empty);
        }

        list.scrollTop = scrollTop;
    }

    function buildServerListEmpty() {
        var wrap = document.createElement('div');
        wrap.className = 'list-empty';
        wrap.innerHTML = '<i class="fa-regular fa-hard-drive"></i>' +
            '<span>还没有服务器<br>添加一台，填入账号密码即可开始</span>';

        var add = document.createElement('button');
        add.type = 'button';
        add.className = 'glass-btn primary';
        add.innerHTML = '<i class="fa-regular fa-plus"></i> 添加服务器';
        add.addEventListener('click', function () { openServerModal(null, null); });

        var imp = document.createElement('button');
        imp.type = 'button';
        imp.className = 'glass-btn';
        imp.innerHTML = '<i class="fa-regular fa-cloud-arrow-down"></i> 从服务器管理导入';
        imp.addEventListener('click', importServers);

        wrap.appendChild(add);
        wrap.appendChild(imp);
        return wrap;
    }

    function buildServerGroup(group, items, searching) {
        var collapsed = !!ui.collapsed[group.id] && !searching;
        var wrap = document.createElement('div');
        wrap.className = 'srv-group' + (collapsed ? ' collapsed' : '');
        var head = document.createElement('div');
        head.className = 'srv-group-head';
        head.innerHTML =
            '<button type="button" class="srv-group-toggle" title="展开 / 收起"><i class="fa-regular fa-chevron-down"></i></button>' +
            '<i class="fa-regular ' + (collapsed ? 'fa-folder' : 'fa-folder-open') + ' srv-group-folder"></i>' +
            '<span class="srv-group-name" title="' + esc(group.name) + '">' + esc(group.name) + '</span>' +
            '<span class="srv-group-count">' + items.length + '</span>' +
            '<div class="srv-group-actions">' +
            '<button type="button" class="icon-ghost" data-act="add" title="在此分组添加服务器"><i class="fa-regular fa-plus"></i></button>' +
            (group.fallback ? '' :
                '<button type="button" class="icon-ghost" data-act="rename" title="重命名分组"><i class="fa-regular fa-pen"></i></button>' +
                '<button type="button" class="icon-ghost danger" data-act="delete" title="删除分组"><i class="fa-regular fa-trash-can"></i></button>') +
            '</div>';

        head.addEventListener('click', function (e) {
            var action = e.target.closest('[data-act]');
            if (action) {
                e.stopPropagation();
                var act = action.dataset.act;
                if (act === 'add') {
                    openServerModal(null, group.id);
                } else if (act === 'rename') {
                    openPrompt({
                        title: '重命名分组',
                        label: '分组名称',
                        value: group.name,
                        validator: function (value) {
                            var dup = state.groups.some(function (g) {
                                return g.id !== group.id && g.name === value;
                            });
                            if (dup) {
                                toast('已存在同名分组', 'error');
                                return false;
                            }
                            return true;
                        },
                        onConfirm: function (value) {
                            group.name = value;
                            saveState(true);
                            renderServers();
                            renderGroupSelects();
                        }
                    });
                } else if (act === 'delete') {
                    deleteGroup(group);
                }
                return;
            }

            ui.collapsed[group.id] = !ui.collapsed[group.id];
            saveUi();
            renderServers();
        });

        wrap.appendChild(head);

        if (items.length) {
            var body = document.createElement('div');
            body.className = 'srv-group-body';
            items.forEach(function (srv) { body.appendChild(buildServerItem(srv)); });
            wrap.appendChild(body);
        } else if (!searching) {
            var empty = document.createElement('div');
            empty.className = 'srv-empty';
            empty.innerHTML = '<i class="fa-regular fa-plus"></i> 添加服务器到这个分组';
            empty.addEventListener('click', function () { openServerModal(null, group.id); });
            wrap.appendChild(empty);
        }

        return wrap;
    }

    function buildServerItem(srv) {
        var active = getActiveSession();
        var isActive = !!(active && active.serverId === srv.id);
        var online = sessions.some(function (s) {
            return s.serverId === srv.id && s.status === 'connected';
        });

        var item = document.createElement('div');
        item.className = 'srv-item' + (isActive ? ' active' : '');
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', '连接 ' + srv.name);
        item.dataset.id = srv.id;
        item.title = srv.note ? (srv.name + '\n' + srv.note) : srv.name;

        item.innerHTML =
            '<span class="srv-status' + (online ? ' online' : '') + '"></span>' +
            '<div class="srv-info">' +
            '<div class="srv-name">' + esc(srv.name) + '</div>' +
            '<div class="srv-sub">' + esc(srv.username || 'root') + '@' + esc(srv.host) + ':' + esc(srv.port || '22') + '</div>' +
            '</div>' +
            '<span class="srv-os" title="' + esc(srv.os || '') + '">' + osIcon(srv.os) + '</span>' +
            '<div class="srv-actions">' +
            '<button type="button" class="icon-ghost" data-act="connect" title="连接"><i class="fa-solid fa-play"></i></button>' +
            '<button type="button" class="icon-ghost" data-act="edit" title="编辑"><i class="fa-regular fa-pen"></i></button>' +
            '<button type="button" class="icon-ghost danger" data-act="delete" title="删除"><i class="fa-regular fa-trash-can"></i></button>' +
            '</div>';

        item.addEventListener('click', function (e) {
            var action = e.target.closest('[data-act]');
            if (action) {
                e.stopPropagation();
                var act = action.dataset.act;
                if (act === 'connect') requestConnect(srv);
                else if (act === 'edit') openServerModal(srv, null);
                else if (act === 'delete') deleteServer(srv);
                return;
            }
            requestConnect(srv);
        });

        item.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                requestConnect(srv);
            }
        });

        return item;
    }

    function renderCommands() {
        var list = els.commandList;
        if (!list) return;

        if (dragState) clearCommandDrag();

        var listScrollTop = list.scrollTop;
        list.innerHTML = '';
        if (els.commandCount) els.commandCount.textContent = String(state.commands.length);

        var query = commandSearch.trim().toLowerCase();
        var searching = !!query;

        if (!state.commands.length) {
            var empty = document.createElement('div');
            empty.className = 'cmd-empty';
            empty.innerHTML = '还没有常用命令<br>点击右上角 + 添加，或从 Xshell 导入';
            list.appendChild(empty);
            list.scrollTop = listScrollTop;
            return;
        }

        var groups = state.commandGroups.slice();
        groups.push({ id: '', name: '未分组', fallback: true });
        var matched = 0;

        groups.forEach(function (group) {
            var allItems = state.commands.filter(function (cmd) {
                return (cmd.groupId || '') === group.id;
            });
            var groupMatch = searching && String(group.name || '').toLowerCase().indexOf(query) >= 0;
            var items = allItems;

            if (searching && !groupMatch) {
                items = allItems.filter(function (cmd) {
                    return String(cmd.name || '').toLowerCase().indexOf(query) >= 0 ||
                        String(cmd.cmd || '').toLowerCase().indexOf(query) >= 0;
                });
            }

            if (group.fallback && !allItems.length) return;
            if (searching && !items.length) return;

            matched += items.length;
            list.appendChild(buildCommandGroup(group, items, searching));
        });

        if (searching && !matched) {
            var noMatch = document.createElement('div');
            noMatch.className = 'cmd-empty';
            noMatch.innerHTML = '没有匹配「' + esc(commandSearch.trim()) + '」的命令';
            list.appendChild(noMatch);
        }
        list.scrollTop = listScrollTop;
    }

    function buildCommandGroup(group, items, searching) {
        var collapsed = !searching && ui.cmdCollapsed[group.id] !== false;
        var wrap = document.createElement('div');
        wrap.className = 'cmd-group' + (collapsed ? ' collapsed' : '');

        var head = document.createElement('div');
        head.className = 'cmd-group-head';
        head.innerHTML =
            '<button type="button" class="srv-group-toggle cmd-group-toggle" title="展开 / 收起" aria-expanded="' + (!collapsed) + '"><i class="fa-regular fa-chevron-down"></i></button>' +
            '<i class="fa-regular ' + (collapsed ? 'fa-folder' : 'fa-folder-open') + ' srv-group-folder"></i>' +
            '<span class="cmd-group-name" title="' + esc(group.name) + '">' + esc(group.name) + '</span>' +
            '<span class="srv-group-count">' + items.length + '</span>' +
            '<div class="cmd-group-actions">' +
            '<button type="button" class="icon-ghost" data-act="add" title="在此分组添加命令"><i class="fa-regular fa-plus"></i></button>' +
            (group.fallback ? '' :
                '<button type="button" class="icon-ghost" data-act="rename" title="重命名分组"><i class="fa-regular fa-pen"></i></button>' +
                '<button type="button" class="icon-ghost danger" data-act="delete" title="删除分组"><i class="fa-regular fa-trash-can"></i></button>') +
            '</div>';

        head.addEventListener('click', function (e) {
            var action = e.target.closest('[data-act]');
            if (!action) {
                if (searching) return;
                ui.cmdCollapsed[group.id] = !collapsed;
                saveUi();
                renderCommands();
                return;
            }
            e.stopPropagation();
            var act = action.dataset.act;
            if (act === 'add') {
                openCommandModal(null, group.id);
            } else if (act === 'rename') {
                openPrompt({
                    title: '重命名命令分组',
                    label: '分组名称',
                    value: group.name,
                    validator: function (value) {
                        var dup = state.commandGroups.some(function (g) {
                            return g.id !== group.id && g.name === value;
                        });
                        if (dup) {
                            toast('已存在同名分组', 'error');
                            return false;
                        }
                        return true;
                    },
                    onConfirm: function (value) {
                        group.name = value;
                        saveState(true);
                        renderCommands();
                        renderGroupSelects();
                    }
                });
            } else if (act === 'delete') {
                deleteCommandGroup(group);
            }
        });

        wrap.appendChild(head);

        var body = document.createElement('div');
        body.className = 'cmd-group-body';
        body.dataset.groupId = group.id || '';
        wrap.dataset.groupId = group.id || '';

        if (!items.length) {
            var hint = document.createElement('div');
            hint.className = 'cmd-empty';
            hint.textContent = searching ? '该分组没有匹配的命令' : '该分组暂无命令';
            body.appendChild(hint);
        } else {
            items.forEach(function (cmd) { body.appendChild(buildCommandItem(cmd, searching)); });
        }

        wrap.appendChild(body);
        return wrap;
    }

    function buildCommandItem(cmd, searching) {
        var item = document.createElement('div');
        item.className = 'cmd-item' + (searching ? ' cmd-no-drag' : '');
        item.tabIndex = 0;
        item.draggable = !searching;
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', '执行命令 ' + cmd.name);
        item.dataset.id = cmd.id;
        item.title = cmd.name + '\n' + cmd.cmd;

        var firstLine = String(cmd.cmd).split(/\r?\n/)[0];
        item.innerHTML =
            (searching ? '' : '<span class="cmd-drag-handle" title="拖动排序" aria-hidden="true"><i class="fa-regular fa-grip-dots-vertical"></i></span>') +
            '<div class="cmd-name">' + esc(cmd.name) + '</div>' +
            '<div class="cmd-text">' + esc(firstLine) + '</div>' +
            '<div class="cmd-actions">' +
            '<button type="button" class="icon-ghost" data-act="edit" title="编辑"><i class="fa-regular fa-pen"></i></button>' +
            '<button type="button" class="icon-ghost danger" data-act="delete" title="删除"><i class="fa-regular fa-trash-can"></i></button>' +
            '</div>';

        item.addEventListener('click', function (e) {
            if (e.target.closest('.cmd-drag-handle')) {
                e.stopPropagation();
                return;
            }
            var action = e.target.closest('[data-act]');
            if (action) {
                e.stopPropagation();
                var act = action.dataset.act;
                if (act === 'edit') openCommandModal(cmd, null);
                else if (act === 'delete') deleteCommand(cmd);
                return;
            }
            if (Date.now() < suppressCommandClickUntil) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            sendCommandText(cmd.cmd, e.shiftKey);
        });

        item.addEventListener('dragstart', function (e) {
            if (searching) {
                e.preventDefault();
                return;
            }
            beginCommandDrag(e, item, cmd);
        });
        item.addEventListener('dragend', endCommandDrag);

        item.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                sendCommandText(cmd.cmd, e.shiftKey);
            }
        });

        return item;
    }

    // ======================================================================
    // 常用命令拖放排序
    // ======================================================================

    function beginCommandDrag(e, item, cmd) {
        if (commandSearch.trim() || !e.dataTransfer) return;
        if (e.target && e.target.closest && e.target.closest('button')) {
            e.preventDefault();
            return;
        }

        var body = item.parentNode;
        if (!body || !body.classList.contains('cmd-group-body')) return;

        var height = Math.max(32, Math.round(item.getBoundingClientRect().height));
        var placeholder = document.createElement('div');
        placeholder.className = 'cmd-drop-placeholder';
        placeholder.style.height = height + 'px';
        placeholder.innerHTML =
            '<i class="fa-regular fa-grip-dots-vertical" aria-hidden="true"></i><span>放到这里</span>';
        body.insertBefore(placeholder, item);

        var next = item.nextElementSibling;
        dragState = {
            cmd: cmd,
            item: item,
            placeholder: placeholder,
            dropBody: body,
            targetGroupId: cmd.groupId || '',
            beforeId: next && next.classList.contains('cmd-item') ? next.dataset.id : null,
            dropped: false
        };

        item.classList.add('cmd-drag-source');
        item.setAttribute('aria-grabbed', 'true');
        e.dataTransfer.effectAllowed = 'move';
        try {
            e.dataTransfer.setData('text/plain', cmd.id);
        } catch (err) { /* ignore */ }
        if (els.commandList) els.commandList.classList.add('cmd-drag-active');

        // 让浏览器先截取拖拽缩略图，再把原节点从布局中移走，避免出现两个卡片。
        setTimeout(function () {
            if (dragState && dragState.item === item) item.classList.add('dragging');
        }, 0);
        suppressCommandClickUntil = Date.now() + 300;
    }

    function endCommandDrag() {
        if (!dragState) return;
        var dropped = dragState.dropped;
        clearCommandDrag();
        if (!dropped) renderCommands();
        suppressCommandClickUntil = Date.now() + 250;
    }

    function clearCommandDrag() {
        var current = dragState;
        if (!current) return;
        dragState = null;

        if (current.placeholder && current.placeholder.parentNode) {
            current.placeholder.parentNode.removeChild(current.placeholder);
        }
        if (current.item) {
            current.item.classList.remove('dragging', 'cmd-drag-source');
            current.item.removeAttribute('aria-grabbed');
        }
        if (els.commandList) {
            els.commandList.classList.remove('cmd-drag-active');
            var activeBodies = els.commandList.querySelectorAll('.cmd-group-body.drop-active');
            Array.prototype.forEach.call(activeBodies, function (body) {
                body.classList.remove('drop-active');
            });
        }
    }

    function onCommandDragOver(e) {
        if (!dragState) return;
        var target = e.target;
        if (!target || !target.closest) return;

        var body = target.closest('.cmd-group-body');
        var headerDrop = false;
        if (!body) {
            var head = target.closest('.cmd-group-head');
            if (!head) return;
            var group = head.closest('.cmd-group');
            body = group ? group.querySelector('.cmd-group-body') : null;
            if (!body) return;
            expandCommandGroupForDrag(group);
            headerDrop = true;
        }

        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        autoScrollCommandList(e.clientY);

        if (headerDrop) {
            setCommandDropTarget(body, null);
        } else {
            setCommandDropTarget(body, commandInsertionPoint(body, e.clientY));
        }
    }

    function onCommandDrop(e) {
        if (!dragState) return;
        var target = e.target;
        if (!target || !target.closest) return;

        var body = target.closest('.cmd-group-body');
        var headerDrop = false;
        if (!body) {
            var head = target.closest('.cmd-group-head');
            if (!head) return;
            var group = head.closest('.cmd-group');
            body = group ? group.querySelector('.cmd-group-body') : null;
            headerDrop = true;
        }
        if (!body) return;

        e.preventDefault();
        var groupId = body.dataset.groupId || '';
        var beforeId = headerDrop ? null : dragState.beforeId;
        var moved = moveCommandInState(dragState.cmd, groupId, beforeId);

        // 拖放后展开目标分组，确保用户能看到刚移动的命令。
        ui.cmdCollapsed[groupId] = false;
        saveUi();

        if (!moved) {
            endCommandDrag();
            return;
        }

        dragState.dropped = true;
        clearCommandDrag();
        saveState(true);
        renderCommands();
        suppressCommandClickUntil = Date.now() + 300;
    }

    function onCommandDragLeave(e) {
        if (!dragState || !els.commandList) return;
        var related = e.relatedTarget;
        if (related && related.nodeType && els.commandList.contains(related)) return;
        var activeBodies = els.commandList.querySelectorAll('.cmd-group-body.drop-active');
        Array.prototype.forEach.call(activeBodies, function (body) {
            body.classList.remove('drop-active');
        });
    }

    function expandCommandGroupForDrag(group) {
        if (!group || !group.classList.contains('collapsed')) return;
        group.classList.remove('collapsed');
        var toggle = group.querySelector('.cmd-group-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
        var folder = group.querySelector('.srv-group-folder');
        if (folder) {
            folder.classList.remove('fa-folder');
            folder.classList.add('fa-folder-open');
        }
    }

    function commandInsertionPoint(body, clientY) {
        var items = body.querySelectorAll('.cmd-item');
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (item.classList.contains('dragging') || item.classList.contains('cmd-drag-source')) continue;
            var rect = item.getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) return item;
        }
        return null;
    }

    function setCommandDropTarget(body, before) {
        if (!dragState || !dragState.placeholder) return;
        var placeholder = dragState.placeholder;
        var changed = placeholder.parentNode !== body || placeholder.nextElementSibling !== before;
        var snapshot = changed ? collectCommandLayout() : null;

        if (changed) {
            if (before) body.insertBefore(placeholder, before);
            else body.appendChild(placeholder);
        }

        dragState.dropBody = body;
        dragState.targetGroupId = body.dataset.groupId || '';
        dragState.beforeId = before ? before.dataset.id : null;

        if (els.commandList) {
            var activeBodies = els.commandList.querySelectorAll('.cmd-group-body.drop-active');
            Array.prototype.forEach.call(activeBodies, function (activeBody) {
                if (activeBody !== body) activeBody.classList.remove('drop-active');
            });
        }
        body.classList.add('drop-active');

        if (changed) animateCommandLayout(snapshot);
    }

    function collectCommandLayout() {
        if (!els.commandList) return [];
        var nodes = els.commandList.querySelectorAll('.cmd-item:not(.dragging):not(.cmd-drag-source), .cmd-drop-placeholder');
        var layout = [];
        Array.prototype.forEach.call(nodes, function (node) {
            // offsetTop 不受 FLIP 动画的 transform 影响，连续拖动时不会累加偏差。
            if (node.offsetParent === null) return;
            layout.push({ node: node, top: node.offsetTop });
        });
        return layout;
    }

    function animateCommandLayout(layout) {
        if (!layout || !layout.length) return;
        layout.forEach(function (entry) {
            var node = entry.node;
            if (!node || !node.parentNode || typeof node.animate !== 'function') return;
            var nextTop = node.offsetTop;
            var delta = entry.top - nextTop;
            if (!delta) return;
            try {
                node.animate(
                    [
                        { transform: 'translateY(' + delta + 'px)' },
                        { transform: 'translateY(0)' }
                    ],
                    { duration: 170, easing: 'cubic-bezier(.2, .8, .2, 1)' }
                );
            } catch (err) { /* ignore */ }
        });
    }

    function autoScrollCommandList(clientY) {
        var list = els.commandList;
        if (!list) return;
        var rect = list.getBoundingClientRect();
        var edge = 30;
        if (clientY < rect.top + edge) list.scrollTop -= 9;
        else if (clientY > rect.bottom - edge) list.scrollTop += 9;
    }

    function moveCommandInState(command, groupId, beforeId) {
        var index = state.commands.indexOf(command);
        if (index < 0) return false;
        state.commands.splice(index, 1);
        command.groupId = groupId || '';

        var insertAt = state.commands.length;
        if (beforeId) {
            for (var i = 0; i < state.commands.length; i++) {
                if (state.commands[i].id === beforeId) {
                    insertAt = i;
                    break;
                }
            }
        }
        state.commands.splice(insertAt, 0, command);
        return true;
    }

    function renderGroupSelects() {
        var srvSelect = $('ssh-srv-group');
        if (srvSelect) {
            var current = srvSelect.value;
            srvSelect.innerHTML = '<option value="">未分组</option>' +
                state.groups.map(function (g) {
                    return '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>';
                }).join('');
            if (current && srvSelect.querySelector('option[value="' + current.replace(/"/g, '\\"') + '"]')) {
                srvSelect.value = current;
            }
        }

        var cmdSelect = $('ssh-cmd-group');
        if (cmdSelect) {
            var currentCmd = cmdSelect.value;
            cmdSelect.innerHTML = '<option value="">未分组</option>' +
                state.commandGroups.map(function (g) {
                    return '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>';
                }).join('');
            if (currentCmd && cmdSelect.querySelector('option[value="' + currentCmd.replace(/"/g, '\\"') + '"]')) {
                cmdSelect.value = currentCmd;
            }
        }
    }

    // ======================================================================
    // 服务器 CRUD
    // ======================================================================

    function openServerModal(server, presetGroupId) {
        editingServerId = server ? server.id : null;
        $('ssh-server-modal-title').textContent = server ? '编辑服务器' : '添加服务器';
        $('ssh-srv-name').value = server ? server.name : '';
        $('ssh-srv-host').value = server ? server.host : '';
        $('ssh-srv-port').value = server ? (server.port || '22') : '22';
        $('ssh-srv-user').value = server ? (server.username || '') : 'root';
        $('ssh-srv-pass').value = server ? (server.password || '') : '';
        $('ssh-srv-pass').type = 'password';
        $('btn-ssh-srv-eye').innerHTML = '<i class="fa-regular fa-eye"></i>';
        $('ssh-srv-note').value = server ? (server.note || '') : '';

        renderGroupSelects();
        var groupValue = server ? server.groupId : (presetGroupId || '');
        $('ssh-srv-group').value = groupValue || '';

        openModal('ssh-server-modal');
        setTimeout(function () { $('ssh-srv-name').focus(); }, 60);
    }

    function saveServer() {
        var name = $('ssh-srv-name').value.trim();
        var host = $('ssh-srv-host').value.trim();
        var port = parseInt($('ssh-srv-port').value, 10);
        var username = $('ssh-srv-user').value.trim() || 'root';
        var password = $('ssh-srv-pass').value;
        var groupId = $('ssh-srv-group').value || '';
        var note = $('ssh-srv-note').value.trim();

        if (!host) {
            toast('请填写主机地址或 IP', 'error');
            $('ssh-srv-host').focus();
            return;
        }
        if (!port || port < 1 || port > 65535) {
            toast('端口需在 1 - 65535 之间', 'error');
            $('ssh-srv-port').focus();
            return;
        }

        var payload = {
            name: name || host,
            host: host,
            port: String(port),
            username: username,
            password: password,
            groupId: groupId,
            note: note
        };

        if (editingServerId) {
            var server = getServer(editingServerId);
            if (!server) return;
            Object.assign(server, payload);
            toast('服务器已更新', 'success');
        } else {
            payload.id = uid('srv');
            payload.os = '';
            state.servers.push(payload);
            toast('服务器已添加', 'success');
        }

        saveState(true);
        renderServers();
        closeModal('ssh-server-modal');
        editingServerId = null;
    }

    function deleteServer(server) {
        confirmDialog({
            message: '删除服务器「' + server.name + '」？相关终端会话会被关闭。',
            type: 'danger'
        }).then(function (ok) {
            if (!ok) return;
            state.servers = state.servers.filter(function (s) { return s.id !== server.id; });
            sessions.filter(function (s) { return s.serverId === server.id; })
                .slice()
                .forEach(function (s) { closeSession(s.id, true); });
            saveState(true);
            renderServers();
            toast('已删除服务器', 'success');
        });
    }

    function deleteGroup(group) {
        var count = state.servers.filter(function (s) { return s.groupId === group.id; }).length;
        confirmDialog({
            message: '删除分组「' + group.name + '」？' + (count ? '组内 ' + count + ' 台服务器会移到「未分组」。' : ''),
            type: 'danger'
        }).then(function (ok) {
            if (!ok) return;
            state.groups = state.groups.filter(function (g) { return g.id !== group.id; });
            state.servers.forEach(function (s) {
                if (s.groupId === group.id) s.groupId = '';
            });
            delete ui.collapsed[group.id];
            saveState(true);
            saveUi();
            renderServers();
            renderGroupSelects();
            toast('分组已删除', 'success');
        });
    }

    function addServerGroup() {
        openPrompt({
            title: '新建服务器分组',
            label: '分组名称',
            placeholder: '例如：生产环境 / 客户 A',
            validator: function (value) {
                var dup = state.groups.some(function (g) { return g.name === value; });
                if (dup) {
                    toast('已存在同名分组', 'error');
                    return false;
                }
                return true;
            },
            onConfirm: function (value) {
                state.groups.push({ id: uid('grp'), name: value });
                saveState(true);
                renderServers();
                renderGroupSelects();
                toast('分组已创建', 'success');
            }
        });
    }

    // ======================================================================
    // 常用命令 CRUD
    // ======================================================================

    function openCommandModal(command, presetGroupId) {
        editingCommandId = command ? command.id : null;
        $('ssh-cmd-modal-title').textContent = command ? '编辑常用命令' : '添加常用命令';
        $('ssh-cmd-name').value = command ? command.name : '';
        $('ssh-cmd-text').value = command ? command.cmd : '';

        renderGroupSelects();
        $('ssh-cmd-group').value = (command ? command.groupId : presetGroupId) || '';

        openModal('ssh-cmd-modal');
        setTimeout(function () { $('ssh-cmd-name').focus(); }, 60);
    }

    function saveCommand() {
        var name = $('ssh-cmd-name').value.trim();
        var cmd = $('ssh-cmd-text').value.trim();
        var groupId = $('ssh-cmd-group').value || '';

        if (!cmd) {
            toast('请填写要执行的命令', 'error');
            $('ssh-cmd-text').focus();
            return;
        }

        if (editingCommandId) {
            var command = getCommand(editingCommandId);
            if (!command) return;
            command.name = name || cmd.split(/\r?\n/)[0];
            command.cmd = cmd;
            command.groupId = groupId;
            toast('命令已更新', 'success');
        } else {
            state.commands.push({
                id: uid('cmd'),
                name: name || cmd.split(/\r?\n/)[0],
                cmd: cmd,
                groupId: groupId
            });
            toast('命令已添加', 'success');
        }

        saveState(true);
        renderCommands();
        closeModal('ssh-cmd-modal');
        editingCommandId = null;
    }

    function deleteCommand(command) {
        confirmDialog({
            message: '删除常用命令「' + command.name + '」？',
            type: 'danger'
        }).then(function (ok) {
            if (!ok) return;
            state.commands = state.commands.filter(function (c) { return c.id !== command.id; });
            saveState(true);
            renderCommands();
            toast('命令已删除', 'success');
        });
    }

    function addCommandGroup() {
        openPrompt({
            title: '新建命令分组',
            label: '分组名称',
            placeholder: '例如：数据库 / 运维巡检',
            validator: function (value) {
                var dup = state.commandGroups.some(function (g) { return g.name === value; });
                if (dup) {
                    toast('已存在同名分组', 'error');
                    return false;
                }
                return true;
            },
            onConfirm: function (value) {
                state.commandGroups.push({ id: uid('cg'), name: value });
                saveState(true);
                renderCommands();
                renderGroupSelects();
                toast('命令分组已创建', 'success');
            }
        });
    }

    function deleteCommandGroup(group) {
        var count = state.commands.filter(function (c) { return c.groupId === group.id; }).length;
        confirmDialog({
            message: '删除命令分组「' + group.name + '」？' + (count ? '组内 ' + count + ' 条命令会移到「未分组」。' : ''),
            type: 'danger'
        }).then(function (ok) {
            if (!ok) return;
            state.commandGroups = state.commandGroups.filter(function (g) { return g.id !== group.id; });
            state.commands.forEach(function (c) {
                if (c.groupId === group.id) c.groupId = '';
            });
            delete ui.cmdCollapsed[group.id];
            saveState(true);
            saveUi();
            renderCommands();
            renderGroupSelects();
            toast('命令分组已删除', 'success');
        });
    }

    // ======================================================================
    // 从侧边栏「服务器管理」导入
    // ======================================================================

    function importServers() {
        storageGet(['meow_servers', 'meow_server_categories']).then(function (data) {
            var source = Array.isArray(data.meow_servers) ? data.meow_servers : [];
            var categories = Array.isArray(data.meow_server_categories) ? data.meow_server_categories : [];
            var sshServers = source.filter(function (srv) {
                if (!srv) return false;
                var protocol = String(srv.protocol || 'ssh').toLowerCase();
                return protocol === 'ssh' && String(srv.ip || srv.host || '').trim();
            });

            if (!sshServers.length) {
                toast('「服务器管理」里没有可导入的 SSH 服务器', 'error');
                return;
            }

            var added = 0;
            var skipped = 0;

            sshServers.forEach(function (src) {
                var host = String(src.ip || src.host || '').trim();
                var username = String(src.username || 'root');
                var port = String(src.port || '22');
                var exists = state.servers.some(function (s) {
                    return s.host === host && s.username === username && String(s.port) === port;
                });
                if (exists) {
                    skipped++;
                    return;
                }

                var groupId = '';
                if (src.categoryId) {
                    var category = categories.filter(function (c) { return String(c.id) === String(src.categoryId); })[0];
                    if (category && category.name) {
                        var group = state.groups.filter(function (g) { return g.name === category.name; })[0];
                        if (!group) {
                            group = { id: uid('grp'), name: String(category.name) };
                            state.groups.push(group);
                        }
                        groupId = group.id;
                    }
                }

                state.servers.push({
                    id: uid('srv'),
                    name: String(src.title || host),
                    groupId: groupId,
                    host: host,
                    port: port,
                    username: username,
                    password: String(src.password || ''),
                    note: String(src.note || ''),
                    os: String(src.os || '')
                });
                added++;
            });

            saveState(true);
            renderServers();
            renderGroupSelects();

            if (added) {
                toast('已导入 ' + added + ' 台服务器' + (skipped ? '，跳过 ' + skipped + ' 台重复项' : ''), 'success');
            } else {
                toast('没有新增服务器（' + skipped + ' 台已存在）', 'error');
            }
        });
    }

    // ======================================================================
    // 从 Xshell「快速命令」(QuickButton Files) 导入
    // ======================================================================

    function openXshellImport() {
        openModal('ssh-xshell-modal');
    }

    function pickXshellFolder() {
        var input = $('xshell-folder-input');
        if (input) input.click();
    }

    function pickXshellFiles() {
        var input = $('xshell-files-input');
        if (input) input.click();
    }

    function readXshellFile(file) {
        return new Promise(function (resolve, reject) {
            if (file && typeof file.arrayBuffer === 'function') {
                file.arrayBuffer().then(function (buffer) {
                    resolve(decodeXshellBuffer(buffer));
                }, reject);
                return;
            }
            var reader = new FileReader();
            reader.onload = function () { resolve(decodeXshellBuffer(reader.result)); };
            reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
            reader.readAsArrayBuffer(file);
        });
    }

    function decodeXshellBuffer(buffer) {
        var bytes = new Uint8Array(buffer);
        var encoding = 'utf-8';
        var offset = 0;

        if (bytes[0] === 0xff && bytes[1] === 0xfe) {
            encoding = 'utf-16le';
            offset = 2;
        } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
            encoding = 'utf-16be';
            offset = 2;
        } else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
            offset = 3;
        } else {
            var zeros = 0;
            var end = Math.min(bytes.length, 512);
            for (var i = 0; i < end; i++) if (bytes[i] === 0) zeros++;
            if (zeros > 64) encoding = 'utf-16le';
        }

        try {
            return new TextDecoder(encoding).decode(bytes.subarray(offset));
        } catch (err) {
            return new TextDecoder('utf-8').decode(bytes.subarray(offset));
        }
    }

    function normalizeXshellAction(value) {
        return String(value || '')
            // Xshell 把换行保存为 \r\n；部分版本会保存成 \\r\\n。
            .replace(/\\\\r\\\\n/g, '\n')
            .replace(/\\\\n/g, '\n')
            .replace(/\\\\r/g, '\n')
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\n')
            .replace(/\r\n?/g, '\n')
            .trim();
    }

    function parseXshellQuickButtons(text) {
        var rows = {};
        var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);

        lines.forEach(function (line) {
            var pos = line.indexOf('=');
            if (pos < 0) return;
            var key = line.slice(0, pos).trim();
            var match = /^Button_(\d+)_(Name|Action)$/i.exec(key);
            if (!match) return;
            var index = parseInt(match[1], 10);
            if (!rows[index]) rows[index] = {};
            rows[index][match[2].toLowerCase()] = line.slice(pos + 1);
        });

        return Object.keys(rows).map(function (key) { return parseInt(key, 10); })
            .sort(function (a, b) { return a - b; })
            .map(function (index) { return rows[index]; })
            .filter(function (row) { return row && String(row.action || '').trim(); })
            .map(function (row) {
                var action = normalizeXshellAction(row.action);
                var name = String(row.name || '').replace(/\r?\n/g, ' ').trim();
                return {
                    name: name || action.split('\n')[0].trim() || 'Xshell 命令',
                    action: action
                };
            });
    }

    function xshellGroupName(file) {
        var relative = String((file && (file.webkitRelativePath || file.relativePath)) || '').replace(/\\/g, '/');
        var all = relative.split('/').filter(Boolean);
        if (!all.length || all.length === 1) return 'Xshell 快速命令';

        var dirs = all.slice(0, -1);
        var quickIndex = -1;
        for (var i = 0; i < dirs.length; i++) {
            if (/^QuickButton Files$/i.test(dirs[i])) {
                quickIndex = i;
                break;
            }
        }
        if (quickIndex >= 0) dirs = dirs.slice(quickIndex + 1);

        if (!dirs.length) {
            var root = all[0];
            if (root && !/^(QuickButton Files|Xshell|Documents|NetSarang Computer)$/i.test(root)) {
                return root;
            }
            return 'Xshell 快速命令';
        }
        return dirs.join(' / ');
    }

    function handleXshellFiles(fileList) {
        var files = [];
        Array.prototype.forEach.call(fileList || [], function (file) {
            if (file && /\.qbl$/i.test(file.name || '')) files.push(file);
        });

        if (!files.length) {
            toast('请选择 Xshell 的 QuickButton Files 文件夹或 .qbl 文件', 'error');
            return;
        }

        toast('正在读取 Xshell 快速命令…');
        Promise.all(files.map(function (file) {
            return readXshellFile(file).then(function (text) {
                return { file: file, entries: parseXshellQuickButtons(text) };
            }).catch(function () {
                return null;
            });
        })).then(function (results) {
            var parsed = results.filter(function (item) { return item && item.entries.length; });
            if (!parsed.length) {
                toast('没有在所选文件中找到可导入的快速命令', 'error');
                return;
            }
            importXshellCommands(parsed);
        }).catch(function (err) {
            toast('读取 Xshell 文件失败：' + (err && err.message ? err.message : '未知错误'), 'error');
        });
    }

    function importXshellCommands(parsed) {
        var groupIds = {};
        var groupCountBefore = state.commandGroups.length;
        state.commandGroups.forEach(function (group) { groupIds[group.name] = group.id; });

        var existing = {};
        state.commands.forEach(function (command) {
            var cmd = normalizeXshellAction(command.cmd);
            existing[(command.groupId || '') + '\u0000' + cmd] = true;
        });

        var before = state.commands.length;
        var skipped = 0;

        parsed.forEach(function (item) {
            var groupName = xshellGroupName(item.file);
            var groupId = '';

            item.entries.forEach(function (entry) {
                var action = normalizeXshellAction(entry.action);
                if (!action) return;

                if (!groupId) {
                    if (!groupIds[groupName]) {
                        var group = { id: uid('cg'), name: groupName || 'Xshell 快速命令' };
                        state.commandGroups.push(group);
                        groupIds[group.name] = group.id;
                    }
                    groupId = groupIds[groupName];
                }

                var key = groupId + '\u0000' + action;
                if (existing[key]) {
                    skipped++;
                    return;
                }

                state.commands.push({
                    id: uid('cmd'),
                    name: String(entry.name || action.split('\n')[0] || 'Xshell 命令').slice(0, 80),
                    cmd: action,
                    groupId: groupId
                });
                existing[key] = true;
            });
        });

        var added = state.commands.length - before;
        var groupsAdded = state.commandGroups.length - groupCountBefore;

        if (!added) {
            toast('没有新增命令' + (skipped ? '（' + skipped + ' 条已存在）' : ''), 'error');
            return;
        }

        saveState(true);
        renderCommands();
        renderGroupSelects();
        closeModal('ssh-xshell-modal');
        toast('已从 Xshell 导入 ' + added + ' 条命令' +
            (groupsAdded ? '，新建 ' + groupsAdded + ' 个分组' : '') +
            (skipped ? '，跳过 ' + skipped + ' 条重复项' : ''), 'success');
    }

    // ======================================================================
    // 连接
    // ======================================================================

    function requestConnect(server) {
        if (!server.username || !server.password) {
            openConnectModal(server);
            return;
        }
        if (!bridge.token) {
            openBridgeModal();
            toast('请先配置真实 SSH 桥接', 'error');
            return;
        }
        connectServer(server, { username: server.username, password: server.password });
    }

    function openConnectModal(server) {
        connectTargetId = server.id;
        $('ssh-connect-title').textContent = server.name;
        $('ssh-connect-addr').textContent = (server.username || 'root') + '@' + server.host + ':' + (server.port || '22');
        $('ssh-connect-user').value = server.username || 'root';
        $('ssh-connect-pass').value = server.password || '';
        $('ssh-connect-pass').type = 'password';
        $('btn-ssh-connect-eye').innerHTML = '<i class="fa-regular fa-eye"></i>';
        $('ssh-connect-save').checked = true;

        openModal('ssh-connect-modal');
        setTimeout(function () {
            if (server.password) $('ssh-connect-pass').focus();
            else $('ssh-connect-user').focus();
        }, 60);
    }

    function submitConnect() {
        var server = getServer(connectTargetId);
        if (!server) {
            closeModal('ssh-connect-modal');
            return;
        }

        var username = $('ssh-connect-user').value.trim();
        var password = $('ssh-connect-pass').value;

        if (!username) {
            toast('请输入用户名', 'error');
            $('ssh-connect-user').focus();
            return;
        }
        if (!password) {
            toast('请输入密码', 'error');
            $('ssh-connect-pass').focus();
            return;
        }
        if (!bridge.token) {
            toast('请先配置真实 SSH 桥接', 'error');
            openBridgeModal();
            return;
        }

        if ($('ssh-connect-save').checked) {
            server.username = username;
            server.password = password;
            saveState(true);
            renderServers();
        }

        closeModal('ssh-connect-modal');
        connectServer(server, { username: username, password: password });
    }

    // ======================================================================
    // 终端会话
    // ======================================================================

    function createSession(server, creds) {
        return {
            id: uid('sess'),
            serverId: server.id,
            title: server.name || server.host,
            host: server.host,
            port: String(server.port || '22'),
            username: String(creds.username || 'root'),
            status: 'connecting',
            connectStartedAt: Date.now(),
            autoRetried: false,
            creds: creds,
            real: null,
            hostKey: '',
            connectedAt: 0,
            cwd: ''
        };
    }

    function connectServer(server, creds) {
        var existing = sessions.filter(function (s) {
            return s.serverId === server.id && (s.status === 'connecting' || s.status === 'connected');
        })[0];

        if (existing) {
            // 桥接重启后，旧 WebSocket 可能还没触发 close 事件，但底层连接已失效。
            // 这种情况下不能复用旧会话，否则会一直停留在旧的失败状态。
            var stale = existing.real && !existing.real.isConnected() &&
                (existing.status === 'connected' ||
                    (existing.status === 'connecting' && Date.now() - existing.connectStartedAt > 15000));
            if (stale) {
                closeSession(existing.id, true);
                existing = null;
            }
        }

        if (existing) {
            activateSession(existing.id);
            toast('已切换到现有会话', 'success');
            return;
        }

        if (!(window.MeowSshReal && window.MeowSshReal.isSupported())) {
            toast('真实终端组件未加载，请刷新页面后重试', 'error');
            return;
        }
        if (location.protocol === 'file:') {
            toast('真实 SSH 需要通过扩展页面打开；file:// 页面会被浏览器阻止本地 WebSocket', 'error');
            return;
        }
        if (!bridge.token) {
            toast('请先配置真实 SSH 桥接', 'error');
            openBridgeModal();
            return;
        }

        var session = createSession(server, creds);
        try {
            session.real = window.MeowSshReal.createSession(els.realTerminal, {
                id: session.id,
                onStatus: function (status) { onRealStatus(session, status); },
                onReady: function () { onRealReady(session); },
                onError: function (message) { onRealError(session, message); },
                onClose: function () { onRealClosed(session); },
                onHostKey: function (info) { onRealHostKey(session, info); },
                onCwd: function (cwd) { onRealCwd(session, cwd); }
            });
        } catch (err) {
            toast('真实终端初始化失败：' + err.message, 'error');
            return;
        }

        sessions.push(session);
        activeSessionId = session.id;

        renderSessionTabs();
        renderTerminal(true);
        renderServers();

        session.real.connect({
            url: bridge.url,
            token: bridge.token,
            host: session.host,
            port: session.port,
            username: session.username,
            password: creds.password
        });
    }

    function onRealStatus(session, status) {
        if (sessions.indexOf(session) === -1) return;
        if (status === 'connected') {
            session.status = 'connected';
            session.connectedAt = Date.now();
            bridge.status = 'online';
            updateBridgeIndicator();
        } else if (status === 'error' || status === 'closed') {
            session.status = 'closed';
            session.cwd = '';
        }
        renderSessionTabs();
        updateStatusBar();
        renderServers();
    }

    function onRealCwd(session, cwd) {
        if (sessions.indexOf(session) === -1) return;
        var value = String(cwd || '').trim();
        if (!value || session.cwd === value) return;
        session.cwd = value;
        if (session === getActiveSession()) updateStatusBar();
    }

    function onRealReady(session) {
        if (sessions.indexOf(session) === -1) return;
        session.status = 'connected';
        session.connectedAt = Date.now();
        bridge.status = 'online';
        updateBridgeIndicator();
        if (session.real && typeof session.real.getCwd === 'function') {
            var cwd = session.real.getCwd();
            if (cwd) onRealCwd(session, cwd);
        }
        renderSessionTabs();
        renderTerminal(true);
        renderServers();
        toast('已连接 ' + session.host, 'success');
    }

    function onRealError(session, message) {
        if (sessions.indexOf(session) === -1) return;

        // 某些服务器/端口转发会在旧连接刚释放时拒绝下一次握手。
        // 首次遇到这种瞬时错误时自动重连一次；主机密钥、认证失败等不会走这里。
        if (!session.autoRetried && session.creds &&
            /Connection lost before handshake/i.test(String(message || ''))) {
            session.autoRetried = true;
            var retryCreds = session.creds;
            var retryServer = {
                id: session.serverId,
                name: session.title,
                host: session.host,
                port: session.port
            };
            toast('SSH 握手被服务器中断，正在重试一次…', 'info');
            setTimeout(function () {
                if (sessions.indexOf(session) === -1) return;
                closeSession(session.id, true);
                connectServer(retryServer, retryCreds);
            }, 900);
            return;
        }

        if (session.status !== 'connected') session.status = 'closed';
        renderSessionTabs();
        updateStatusBar();
        renderServers();
        toast(message || 'SSH 连接失败', 'error');
    }

    function onRealClosed(session) {
        if (sessions.indexOf(session) === -1) return;
        session.status = 'closed';
        session.cwd = '';
        renderSessionTabs();
        updateStatusBar();
        renderServers();
    }

    function onRealHostKey(session, info) {
        if (!info) return;
        session.hostKey = info.fingerprint || '';
        if (info.isNew) {
            toast('首次连接，已记录主机指纹 ' + (info.fingerprint || ''), 'success');
        }
    }

    function activateSession(id) {
        if (activeSessionId === id) {
            focusInput();
            return;
        }
        activeSessionId = id;
        renderSessionTabs();
        renderTerminal(true);
        renderServers();
    }

    function closeSession(id, silent) {
        var index = -1;
        for (var i = 0; i < sessions.length; i++) {
            if (sessions[i].id === id) {
                index = i;
                break;
            }
        }
        if (index === -1) return;

        var session = sessions[index];
        if (session.real) session.real.dispose();
        session.creds = null;
        sessions.splice(index, 1);

        if (activeSessionId === id) {
            activeSessionId = sessions.length
                ? sessions[Math.min(index, sessions.length - 1)].id
                : null;
        }

        renderSessionTabs();
        renderTerminal(false);
        renderServers();
        if (!silent) toast('会话已关闭');
    }

    function renderSessionTabs() {
        var tabs = els.terminalTabs;
        if (!tabs) return;
        tabs.innerHTML = '';

        sessions.forEach(function (session) {
            var tab = document.createElement('div');
            tab.className = 'term-tab' + (session.id === activeSessionId ? ' active' : '');
            tab.dataset.sid = session.id;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', session.id === activeSessionId ? 'true' : 'false');
            tab.tabIndex = session.id === activeSessionId ? 0 : -1;
            tab.title = session.username + '@' + session.host + ':' + session.port;

            tab.innerHTML =
                '<span class="tab-dot ' + session.status + '"></span>' +
                '<span class="tab-title">' + esc(session.title) + '</span>' +
                '<span class="tab-close" role="button" title="关闭会话" aria-label="关闭会话">' +
                '<i class="fa-regular fa-xmark"></i></span>';

            tab.addEventListener('click', function (e) {
                if (e.target.closest('.tab-close')) {
                    e.stopPropagation();
                    closeSession(session.id);
                    return;
                }
                activateSession(session.id);
            });

            tab.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activateSession(session.id);
                } else if (e.key === 'Delete') {
                    e.preventDefault();
                    closeSession(session.id);
                }
            });

            tabs.appendChild(tab);
        });

        var activeTab = tabs.querySelector('.term-tab.active');
        if (activeTab && activeTab.scrollIntoView) {
            activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    function renderTerminal(focus) {
        var session = getActiveSession();
        var empty = els.terminalEmpty;
        var screen = els.terminalScreen;
        if (!empty || !screen) return;

        if (!session) {
            empty.classList.remove('hidden');
            screen.classList.add('hidden');
            if (els.realTerminal) els.realTerminal.classList.add('hidden');
            sessions.forEach(function (item) {
                if (item.real) item.real.setActive(false);
            });
            updateStatusBar();
            return;
        }

        empty.classList.add('hidden');
        screen.classList.remove('hidden');
        if (els.realTerminal) els.realTerminal.classList.remove('hidden');
        sessions.forEach(function (item) {
            if (item.real) item.real.setActive(item === session);
        });
        updateStatusBar();

        if (session.real) {
            session.real.fit();
            if (focus && session.status === 'connected') {
                setTimeout(function () { session.real.focus(); }, 50);
            }
        }
    }

    function updateStatusBar() {
        var session = getActiveSession();
        var dot = els.statusDot;
        var text = els.statusText;
        var meta = els.sessionMeta;
        var cwdPath = els.cwdPath;
        var cwdWrap = els.cwdWrap;
        var copyBtn = els.copyCwd;
        var cwd = session && session.cwd ? session.cwd : '';

        if (cwdPath) {
            cwdPath.textContent = cwd || '—';
            cwdPath.title = cwd
                ? '当前目录：' + cwd + (cwd === '~' ? '（用户主目录）' : '')
                : '尚未获取当前目录';
        }
        if (cwdWrap) cwdWrap.classList.toggle('empty', !cwd);
        if (copyBtn) {
            copyBtn.disabled = !cwd;
            copyBtn.title = cwd ? '复制当前目录' : '当前目录不可用';
        }

        if (!dot || !text || !meta) return;

        dot.className = 'status-dot';
        if (!session) {
            text.textContent = '未连接';
            meta.textContent = '选择服务器开始';
            return;
        }

        var labels = {
            connecting: '连接中',
            connected: '已连接',
            closed: '已断开'
        };

        dot.classList.add(session.status === 'connected' ? 'connected'
            : session.status === 'connecting' ? 'connecting' : 'closed');
        text.textContent = labels[session.status] || session.status;

        var index = sessions.indexOf(session) + 1;
        meta.textContent = session.username + '@' + session.host + ':' + session.port +
            ' · 会话 ' + index + '/' + sessions.length;
    }

    function copyCurrentCwd() {
        var session = getActiveSession();
        var cwd = session && session.cwd ? session.cwd : '';
        if (!cwd) {
            toast('当前目录不可用', 'error');
            return;
        }
        copyText(cwd).then(function () {
            toast('已复制当前目录', 'success');
        }).catch(function () {
            toast('复制失败，请手动选择路径', 'error');
        });
    }

    function focusInput() {
        var session = getActiveSession();
        if (!session || session.status !== 'connected' || !session.real) return;
        session.real.focus();
    }

    // ======================================================================
    // 输入 / 快捷命令
    // ======================================================================

    function sendCommandText(text, onlyFill) {
        var session = getActiveSession();
        if (!session || session.status !== 'connected') {
            toast('请先连接一台服务器', 'error');
            return;
        }

        var lines = String(text || '').split(/\r?\n/).map(function (line) {
            return line.trim();
        }).filter(Boolean);

        if (!lines.length || !session.real) return;

        if (onlyFill) {
            session.real.paste(lines[0]);
            toast('已填入命令，按 Enter 执行');
        } else {
            lines.forEach(function (line) { session.real.sendLine(line); });
            session.real.focus();
        }
    }

    function clearActiveTerminal() {
        var session = getActiveSession();
        if (!session || !session.real) return;
        session.real.clear();
        session.real.focus();
    }

    // ======================================================================
    // 真实 SSH 桥接设置
    // ======================================================================

    function updateBridgeIndicator(message) {
        var dot = els.bridgeDot;
        var row = els.bridgeStatusRow;
        var text = els.bridgeStatusText;
        var status = bridge.status || 'unknown';

        if (dot) {
            dot.className = 'bridge-dot' +
                (status === 'online' ? ' online' :
                    status === 'offline' ? ' offline' :
                        status === 'checking' ? ' checking' : '');
            dot.title = status === 'online' ? '桥接在线' :
                status === 'offline' ? '桥接离线' : '桥接未检测';
        }

        if (row) {
            row.className = 'bridge-status-row' +
                (status === 'online' ? ' online' :
                    status === 'offline' ? ' offline' :
                        status === 'checking' ? ' checking' : '');
        }

        if (text) {
            if (message) text.textContent = message;
            else if (status === 'online') text.textContent = '桥接在线 · ' + bridge.url;
            else if (status === 'checking') text.textContent = '正在检测桥接…';
            else if (status === 'offline') text.textContent = '桥接离线，请先运行 ssh-bridge\\start.bat';
            else if (!bridge.token) text.textContent = '尚未配置访问令牌';
            else text.textContent = '尚未检测'; 
        }
    }

    function openBridgeModal() {
        var url = $('ssh-bridge-url');
        var token = $('ssh-bridge-token');
        if (url) url.value = bridge.url || 'ws://127.0.0.1:8765';
        if (token) {
            token.value = bridge.token || '';
            token.type = 'password';
        }
        var eye = $('btn-ssh-bridge-eye');
        if (eye) eye.innerHTML = '<i class="fa-regular fa-eye"></i>';
        updateBridgeIndicator();
        openModal('ssh-bridge-modal');
        setTimeout(function () {
            if (token) token.focus();
        }, 60);
        if (bridge.token) refreshBridgeStatus();
    }

    function refreshBridgeStatus() {
        if (!bridge.token) {
            bridge.status = 'unconfigured';
            updateBridgeIndicator();
            return;
        }
        if (!(window.MeowSshReal && window.MeowSshReal.probe)) {
            bridge.status = 'offline';
            updateBridgeIndicator('真实终端组件未加载');
            return;
        }

        bridge.status = 'checking';
        updateBridgeIndicator();
        window.MeowSshReal.probe(bridge.url, bridge.token, 2500).then(function () {
            bridge.status = 'online';
            updateBridgeIndicator();
        }).catch(function (err) {
            bridge.status = 'offline';
            updateBridgeIndicator(err && err.message ? err.message : undefined);
        });
    }

    function saveBridgeConfig() {
        var url = String(($('ssh-bridge-url') || {}).value || '').trim();
        var token = String(($('ssh-bridge-token') || {}).value || '').trim();
        var button = $('btn-ssh-bridge-save');

        if (!url) {
            toast('请填写桥接地址', 'error');
            return;
        }
        if (!token) {
            toast('请填写访问令牌', 'error');
            return;
        }
        if (!(window.MeowSshReal && window.MeowSshReal.probe)) {
            toast('真实终端组件未加载，请刷新页面', 'error');
            return;
        }

        try {
            window.MeowSshReal.buildWsUrl(url, token);
        } catch (err) {
            toast(err.message, 'error');
            return;
        }

        if (button) button.disabled = true;
        bridge.status = 'checking';
        updateBridgeIndicator('正在测试桥接…');

        window.MeowSshReal.probe(url, token, 3500).then(function () {
            bridge.url = url;
            bridge.token = token;
            bridge.status = 'online';
            saveBridge();
            updateBridgeIndicator();
            toast('桥接连接成功，已保存', 'success');
            setTimeout(function () { closeModal('ssh-bridge-modal'); }, 350);
        }).catch(function (err) {
            bridge.status = 'offline';
            updateBridgeIndicator(err && err.message ? err.message : undefined);
            toast('桥接连接失败：' + (err && err.message ? err.message : '未知错误'), 'error');
        }).then(function () {
            if (button) button.disabled = false;
        });
    }

    // ======================================================================
    // 初始化 / 事件绑定
    // ======================================================================

    function cacheEls() {
        els.serverList = $('ssh-server-list');
        els.serverCount = $('ssh-server-count');
        els.commandList = $('ssh-command-list');
        els.commandCount = $('ssh-command-count');
        els.terminalTabs = $('terminal-tabs');
        els.terminalEmpty = $('terminal-empty');
        els.terminalScreen = $('terminal-screen');
        els.realTerminal = $('real-terminal');
        els.statusDot = $('term-status-dot');
        els.statusText = $('term-status-text');
        els.sessionMeta = $('term-session-meta');
        els.cwdWrap = $('term-cwd-wrap');
        els.cwdPath = $('term-cwd-path');
        els.copyCwd = $('btn-copy-cwd');
        els.bridgeDot = $('ssh-bridge-dot');
        els.bridgeStatusRow = $('ssh-bridge-status');
        els.bridgeStatusText = $('ssh-bridge-status-text');
    }

    function bindEye(btnId, inputId) {
        var button = $(btnId);
        var input = $(inputId);
        if (!button || !input) return;
        button.addEventListener('click', function () {
            var show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            button.innerHTML = '<i class="fa-regular ' + (show ? 'fa-eye-slash' : 'fa-eye') + '"></i>';
        });
    }

    function bindModalEnter(modalId, handler, skipSelector) {
        var modal = $(modalId);
        if (!modal) return;
        modal.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            if (e.target && skipSelector && e.target.matches(skipSelector)) return;
            e.preventDefault();
            handler();
        });
    }

    function bindStatic() {
        var addGroupBtn = $('btn-ssh-add-group');
        if (addGroupBtn) addGroupBtn.addEventListener('click', addServerGroup);

        var addServerBtn = $('btn-ssh-add-server');
        if (addServerBtn) addServerBtn.addEventListener('click', function () { openServerModal(null, null); });

        var importBtn = $('btn-ssh-import');
        if (importBtn) importBtn.addEventListener('click', importServers);

        var search = $('ssh-search');
        if (search) {
            search.addEventListener('input', function () {
                ui.search = search.value;
                var box = search.closest('.search-box');
                if (box) box.classList.toggle('has-value', !!search.value);
                renderServers();
            });
            search.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && search.value) {
                    e.stopPropagation();
                    search.value = '';
                    ui.search = '';
                    var box = search.closest('.search-box');
                    if (box) box.classList.remove('has-value');
                    renderServers();
                }
            });
        }

        var searchClear = $('btn-ssh-search-clear');
        if (searchClear) {
            searchClear.addEventListener('click', function () {
                if (!search) return;
                search.value = '';
                ui.search = '';
                var box = search.closest('.search-box');
                if (box) box.classList.remove('has-value');
                renderServers();
                search.focus();
            });
        }

        var addCmdBtn = $('btn-cmd-add');
        if (addCmdBtn) addCmdBtn.addEventListener('click', function () { openCommandModal(null, null); });

        var cmdSearchInput = $('ssh-cmd-search');
        if (cmdSearchInput) {
            cmdSearchInput.addEventListener('input', function () {
                commandSearch = cmdSearchInput.value;
                var box = cmdSearchInput.closest('.search-box');
                if (box) box.classList.toggle('has-value', !!cmdSearchInput.value);
                renderCommands();
            });
            cmdSearchInput.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && cmdSearchInput.value) {
                    e.stopPropagation();
                    cmdSearchInput.value = '';
                    commandSearch = '';
                    var box = cmdSearchInput.closest('.search-box');
                    if (box) box.classList.remove('has-value');
                    renderCommands();
                }
            });
        }

        var cmdSearchClear = $('btn-ssh-cmd-search-clear');
        if (cmdSearchClear) {
            cmdSearchClear.addEventListener('click', function () {
                if (!cmdSearchInput) return;
                cmdSearchInput.value = '';
                commandSearch = '';
                var box = cmdSearchInput.closest('.search-box');
                if (box) box.classList.remove('has-value');
                renderCommands();
                cmdSearchInput.focus();
            });
        }

        if (els.commandList) {
            els.commandList.addEventListener('dragover', onCommandDragOver);
            els.commandList.addEventListener('drop', onCommandDrop);
            els.commandList.addEventListener('dragleave', onCommandDragLeave);
        }

        var addCmdGroupBtn = $('btn-cmd-add-group');
        if (addCmdGroupBtn) addCmdGroupBtn.addEventListener('click', addCommandGroup);

        var xshellImportBtn = $('btn-cmd-import-xshell');
        if (xshellImportBtn) xshellImportBtn.addEventListener('click', openXshellImport);

        var xshellPickFolderBtn = $('btn-xshell-pick-folder');
        if (xshellPickFolderBtn) xshellPickFolderBtn.addEventListener('click', pickXshellFolder);

        var xshellPickFilesBtn = $('btn-xshell-pick-files');
        if (xshellPickFilesBtn) xshellPickFilesBtn.addEventListener('click', pickXshellFiles);

        var xshellFolderInput = $('xshell-folder-input');
        if (xshellFolderInput) {
            xshellFolderInput.addEventListener('change', function () {
                var files = this.files;
                handleXshellFiles(files);
                this.value = '';
            });
        }

        var xshellFilesInput = $('xshell-files-input');
        if (xshellFilesInput) {
            xshellFilesInput.addEventListener('change', function () {
                var files = this.files;
                handleXshellFiles(files);
                this.value = '';
            });
        }

        var xshellCancelBtn = $('btn-xshell-cancel');
        if (xshellCancelBtn) xshellCancelBtn.addEventListener('click', function () { closeModal('ssh-xshell-modal'); });

        var newSessionBtn = $('btn-terminal-new');
        if (newSessionBtn) {
            newSessionBtn.addEventListener('click', function () {
                if (!state.servers.length) {
                    openServerModal(null, null);
                    return;
                }
                if (search) search.focus();
                toast('从左侧选择一台服务器建立新会话');
            });
        }

        var clearBtn = $('btn-terminal-clear');
        if (clearBtn) clearBtn.addEventListener('click', clearActiveTerminal);

        var copyCwdBtn = $('btn-copy-cwd');
        if (copyCwdBtn) copyCwdBtn.addEventListener('click', copyCurrentCwd);

        var bridgeBtn = $('btn-ssh-bridge');
        if (bridgeBtn) bridgeBtn.addEventListener('click', openBridgeModal);

        var connectBridgeBtn = $('btn-connect-bridge-config');
        if (connectBridgeBtn) connectBridgeBtn.addEventListener('click', openBridgeModal);

        var bridgeSave = $('btn-ssh-bridge-save');
        if (bridgeSave) bridgeSave.addEventListener('click', saveBridgeConfig);
        var bridgeCancel = $('btn-ssh-bridge-cancel');
        if (bridgeCancel) bridgeCancel.addEventListener('click', function () { closeModal('ssh-bridge-modal'); });

        var toggleCommands = $('btn-toggle-commands');
        var layout = $('ssh-layout');
        if (toggleCommands && layout) {
            toggleCommands.addEventListener('click', function () {
                layout.classList.toggle('commands-open');
            });
        }

        var emptyAdd = $('btn-empty-add-server');
        if (emptyAdd) emptyAdd.addEventListener('click', function () { openServerModal(null, null); });

        var emptyImport = $('btn-empty-import');
        if (emptyImport) emptyImport.addEventListener('click', importServers);

        els.terminalScreen.addEventListener('click', function () {
            if (window.getSelection() && String(window.getSelection()).length) return;
            focusInput();
        });

        // 弹窗
        bindModalDismiss('ssh-server-modal');
        bindModalDismiss('ssh-connect-modal');
        bindModalDismiss('ssh-bridge-modal');
        bindModalDismiss('ssh-cmd-modal');
        bindModalDismiss('glass-prompt-modal');

        var srvSave = $('btn-ssh-srv-save');
        if (srvSave) srvSave.addEventListener('click', saveServer);
        var srvCancel = $('btn-ssh-srv-cancel');
        if (srvCancel) srvCancel.addEventListener('click', function () { closeModal('ssh-server-modal'); });

        var cmdSave = $('btn-ssh-cmd-save');
        if (cmdSave) cmdSave.addEventListener('click', saveCommand);
        var cmdCancel = $('btn-ssh-cmd-cancel');
        if (cmdCancel) cmdCancel.addEventListener('click', function () { closeModal('ssh-cmd-modal'); });

        var connectGo = $('btn-ssh-connect-go');
        if (connectGo) connectGo.addEventListener('click', submitConnect);
        var connectCancel = $('btn-ssh-connect-cancel');
        if (connectCancel) connectCancel.addEventListener('click', function () { closeModal('ssh-connect-modal'); });

        var promptOk = $('glass-prompt-ok');
        if (promptOk) promptOk.addEventListener('click', submitPrompt);
        var promptCancel = $('glass-prompt-cancel');
        if (promptCancel) promptCancel.addEventListener('click', function () {
            promptCallback = null;
            promptValidator = null;
            closeModal('glass-prompt-modal');
        });
        var promptInput = $('glass-prompt-input');
        if (promptInput) {
            promptInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    submitPrompt();
                }
            });
        }

        bindEye('btn-ssh-srv-eye', 'ssh-srv-pass');
        bindEye('btn-ssh-connect-eye', 'ssh-connect-pass');
        bindEye('btn-ssh-bridge-eye', 'ssh-bridge-token');
        bindModalEnter('ssh-server-modal', saveServer, 'textarea, select, button');
        bindModalEnter('ssh-connect-modal', submitConnect, 'button');
        bindModalEnter('ssh-bridge-modal', saveBridgeConfig, 'button');
        bindModalEnter('ssh-cmd-modal', saveCommand, 'textarea, select, button');

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;

            var layout = $('ssh-layout');
            if (layout) layout.classList.remove('commands-open');

            ['ssh-server-modal', 'ssh-connect-modal', 'ssh-bridge-modal', 'ssh-cmd-modal', 'ssh-xshell-modal', 'glass-prompt-modal'].forEach(function (id) {
                var modal = $(id);
                if (modal && modal.classList.contains('visible')) closeModal(id);
            });
        });

        document.addEventListener('meow:tabchange', function (e) {
            if (e.detail && e.detail.tab === 'ssh') {
                setTimeout(focusInput, 120);
            }
        });
    }

    function init() {
        cacheEls();

        storageGet([STORE_KEY, UI_KEY, BRIDGE_KEY]).then(function (data) {
            var raw = data[STORE_KEY];
            state = normalizeData(raw);

            if (data[UI_KEY] && typeof data[UI_KEY] === 'object') {
                ui = {
                    collapsed: (data[UI_KEY].collapsed && typeof data[UI_KEY].collapsed === 'object')
                        ? data[UI_KEY].collapsed : {},
                    cmdCollapsed: (data[UI_KEY].cmdCollapsed && typeof data[UI_KEY].cmdCollapsed === 'object')
                        ? data[UI_KEY].cmdCollapsed : {},
                    search: typeof data[UI_KEY].search === 'string' ? data[UI_KEY].search : ''
                };
            }

            var savedBridge = data[BRIDGE_KEY];
            if (savedBridge && typeof savedBridge === 'object') {
                bridge.url = typeof savedBridge.url === 'string' && savedBridge.url.trim()
                    ? savedBridge.url.trim() : 'ws://127.0.0.1:8765';
                bridge.token = typeof savedBridge.token === 'string' ? savedBridge.token : '';
            }

            if (!raw) saveState(true);

            bindStatic();

            var search = $('ssh-search');
            if (search && ui.search) {
                search.value = ui.search;
                var box = search.closest('.search-box');
                if (box) box.classList.add('has-value');
            }

            renderGroupSelects();
            renderServers();
            renderCommands();
            renderSessionTabs();
            renderTerminal(false);
            setTimeout(refreshBridgeStatus, 250);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
