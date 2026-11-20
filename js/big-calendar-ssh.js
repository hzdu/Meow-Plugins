// big-calendar-ssh.js — 大日历页面第一 TAB：SSH 工作区
// 功能：服务器分组 / 凭据连接 / 真实 SSH（本地桥接）/ 多会话模拟终端 / 常用命令分组
// 说明：真实 SSH 由 ssh-bridge 转发；模拟终端不建立网络连接。

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
    var ui = { collapsed: {}, cmdCollapsed: {}, search: '', mode: 'real' };
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

    function two(n) {
        return n < 10 ? '0' + n : String(n);
    }

    function nowTime() {
        var d = new Date();
        return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
    }

    function fmtLoginDate() {
        var d = new Date(Date.now() - 86400000);
        var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return days[d.getDay()] + ' ' + months[d.getMonth()] + ' ' + d.getDate() + ' ' +
            two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ' ' + d.getFullYear();
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
        var mode = ui.mode === 'sim' ? 'sim' : 'real';
        if (mode === 'real' && !bridge.token) {
            openBridgeModal();
            toast('请先配置真实 SSH 桥接，或切换为本地模拟', 'error');
            return;
        }
        connectServer(server, { username: server.username, password: server.password }, mode);
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

        var mode = ui.mode === 'sim' ? 'sim' : 'real';
        var radios = document.querySelectorAll('input[name="ssh-connect-mode"]');
        Array.prototype.forEach.call(radios, function (radio) {
            radio.checked = radio.value === mode;
        });
        updateConnectModeUI();
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
        var modeEl = document.querySelector('input[name="ssh-connect-mode"]:checked');
        var mode = modeEl && modeEl.value === 'sim' ? 'sim' : 'real';

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
        if (mode === 'real' && !bridge.token) {
            toast('请先配置真实 SSH 桥接，或切换为本地模拟', 'error');
            openBridgeModal();
            return;
        }

        ui.mode = mode;
        saveUi();

        if ($('ssh-connect-save').checked) {
            server.username = username;
            server.password = password;
            saveState(true);
            renderServers();
        }

        closeModal('ssh-connect-modal');
        connectServer(server, { username: username, password: password }, mode);
    }

    // ======================================================================
    // 终端会话
    // ======================================================================

    function createSession(server, creds, mode) {
        var username = String(creds.username || 'root');
        var homeUser = username.replace(/[^\w.-]/g, '_') || 'user';
        var session = {
            id: uid('sess'),
            mode: mode === 'real' ? 'real' : 'sim',
            serverId: server.id,
            title: server.name || server.host,
            host: server.host,
            port: String(server.port || '22'),
            username: username,
            homeUser: homeUser,
            hostname: server.host,
            status: 'connecting',
            connectStartedAt: Date.now(),
            autoRetried: false,
            creds: creds,
            home: ['home', homeUser],
            cwd: ['home', homeUser],
            fs: null,
            real: null,
            hostKey: '',
            lines: [],
            history: [],
            historyIndex: 0,
            timers: [],
            connectedAt: 0
        };
        if (session.mode === 'sim') session.fs = createFs(session);
        return session;
    }

    function connectServer(server, creds, mode) {
        mode = mode === 'sim' ? 'sim' : 'real';

        var existing = sessions.filter(function (s) {
            return s.serverId === server.id && (s.status === 'connecting' || s.status === 'connected');
        })[0];

        if (existing) {
            // 桥接重启后，旧 WebSocket 可能还没触发 close 事件，但底层连接已失效。
            // 这种情况下不能复用旧会话，否则会一直停留在旧的失败状态。
            var stale = existing.mode === 'real' && existing.real && !existing.real.isConnected() &&
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

        if (mode === 'real' && !(window.MeowSshReal && window.MeowSshReal.isSupported())) {
            toast('真实终端组件未加载，请刷新页面后重试', 'error');
            return;
        }
        if (mode === 'real' && location.protocol === 'file:') {
            toast('真实 SSH 需要通过扩展页面打开；file:// 页面会被浏览器阻止本地 WebSocket', 'error');
            return;
        }
        if (mode === 'real' && !bridge.token) {
            toast('请先配置真实 SSH 桥接，或切换为本地模拟', 'error');
            openBridgeModal();
            return;
        }

        var session = createSession(server, creds, mode);

        if (session.mode === 'real') {
            try {
                session.real = window.MeowSshReal.createSession(els.realTerminal, {
                    id: session.id,
                    onStatus: function (status) { onRealStatus(session, status); },
                    onReady: function () { onRealReady(session); },
                    onError: function (message) { onRealError(session, message); },
                    onClose: function () { onRealClosed(session); },
                    onHostKey: function (info) { onRealHostKey(session, info); }
                });
            } catch (err) {
                toast('真实终端初始化失败：' + err.message, 'error');
                return;
            }
        }

        sessions.push(session);
        activeSessionId = session.id;

        renderSessionTabs();
        renderTerminal(true);
        renderServers();

        if (session.mode === 'real') {
            session.real.connect({
                url: bridge.url,
                token: bridge.token,
                host: session.host,
                port: session.port,
                username: session.username,
                password: creds.password
            });
            return;
        }

        startSimulatedConnection(session, creds);
    }

    function startSimulatedConnection(session, creds) {
        var address = creds.username + '@' + session.host + ':' + session.port;

        schedule(session, 120, function () {
            appendLine(session, L('Connecting to ' + address + ' ...'), 'dim');
        });

        schedule(session, 420, function () {
            appendLine(session, L('Connection established.', 'success'));
            appendLine(session, L('Remote protocol version 2.0, remote software version OpenSSH_8.9p1 Ubuntu-3ubuntu0.6'), 'dim');
        });

        schedule(session, 700, function () {
            appendLine(session, L('Authenticating with password for ' + creds.username + ' ...'), 'dim');
        });

        schedule(session, 980, function () {
            appendLine(session, S([
                { t: 'Authentication succeeded. ' },
                { t: 'Welcome back, ' + creds.username + '.', c: 'accent' }
            ]), 'success');
        });

        schedule(session, 1260, function () {
            finishConnection(session);
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
        }
        renderSessionTabs();
        updateStatusBar();
        renderServers();
    }

    function onRealReady(session) {
        if (sessions.indexOf(session) === -1) return;
        session.status = 'connected';
        session.connectedAt = Date.now();
        bridge.status = 'online';
        updateBridgeIndicator();
        renderSessionTabs();
        renderTerminal(true);
        renderServers();
        toast('已连接 ' + session.host, 'success');
    }

    function onRealError(session, message) {
        if (sessions.indexOf(session) === -1) return;

        // 某些服务器/端口转发会在旧连接刚释放时拒绝下一次握手。
        // 首次遇到这种瞬时错误时自动重连一次；主机密钥、认证失败等不会走这里。
        if (session.mode === 'real' && !session.autoRetried && session.creds &&
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
                connectServer(retryServer, retryCreds, 'real');
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

    function finishConnection(session) {
        if (session.status !== 'connecting') return;
        session.status = 'connected';
        session.connectedAt = Date.now();

        appendLine(session, L(''));
        appendLine(session, S([
            { t: 'Welcome to ' },
            { t: 'Ubuntu 22.04.4 LTS', c: 'accent' },
            { t: ' (GNU/Linux 5.15.0-105-generic x86_64)' }
        ]));
        appendLine(session, L(' * Documentation:  https://help.ubuntu.com'), 'dim');
        appendLine(session, L(' * Management:     https://landscape.canonical.com'), 'dim');
        appendLine(session, L(''));
        appendLine(session, L('Last login: ' + fmtLoginDate() + ' from 10.0.0.2'), 'dim');
        appendLine(session, L(''));
        appendLine(session, L('提示：输入 help 查看模拟终端支持的命令。'), 'dim');

        if (session.id === activeSessionId) {
            renderTerminal(true);
        }
        renderSessionTabs();
        renderServers();
        toast('已连接 ' + session.host, 'success');
    }

    function schedule(session, delay, fn) {
        var timer = setTimeout(function () {
            session.timers = session.timers.filter(function (t) { return t !== timer; });
            if (sessions.indexOf(session) === -1) return;
            fn();
        }, delay);
        session.timers.push(timer);
    }

    function clearSessionTimers(session) {
        session.timers.forEach(function (timer) { clearTimeout(timer); });
        session.timers = [];
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
        clearSessionTimers(session);
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
            screen.classList.remove('real-mode');
            if (els.realTerminal) els.realTerminal.classList.add('hidden');
            sessions.forEach(function (item) {
                if (item.real) item.real.setActive(false);
            });
            els.input.disabled = true;
            els.input.value = '';
            els.prompt.innerHTML = '';
            updateStatusBar();
            return;
        }

        empty.classList.add('hidden');
        screen.classList.remove('hidden');

        if (session.mode === 'real') {
            screen.classList.add('real-mode');
            if (els.realTerminal) els.realTerminal.classList.remove('hidden');
            sessions.forEach(function (item) {
                if (item.real) item.real.setActive(item === session);
            });
            els.input.disabled = true;
            els.input.value = '';
            els.prompt.innerHTML = '';
            updateStatusBar();
            if (session.real) {
                session.real.fit();
                if (focus && session.status === 'connected') {
                    setTimeout(function () { session.real.focus(); }, 50);
                }
            }
            return;
        }

        screen.classList.remove('real-mode');
        if (els.realTerminal) els.realTerminal.classList.add('hidden');
        sessions.forEach(function (item) {
            if (item.real) item.real.setActive(false);
        });

        els.lines.innerHTML = '';
        session.lines.forEach(function (line) {
            els.lines.appendChild(lineEl(line));
        });

        els.input.disabled = session.status !== 'connected';
        els.input.value = '';
        els.input.placeholder = session.status === 'connected'
            ? '输入命令，help 查看帮助'
            : '正在建立连接…';
        els.prompt.innerHTML = promptHTML(session);
        updateStatusBar();
        scrollTerminal();

        if (focus && session.status === 'connected') {
            setTimeout(focusInput, 40);
        }
    }

    function updateStatusBar() {
        var session = getActiveSession();
        var dot = els.statusDot;
        var text = els.statusText;
        var meta = els.sessionMeta;
        if (!dot || !text || !meta) return;

        dot.className = 'status-dot';
        if (!session) {
            text.textContent = '未连接';
            meta.textContent = '选择服务器开始';
            updateModeBadge(null);
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
            ' · ' + (session.mode === 'real' ? '真实 SSH' : '模拟') +
            ' · 会话 ' + index + '/' + sessions.length;
        updateModeBadge(session);
    }

    function updateModeBadge(session) {
        var badge = els.modeBadge;
        if (!badge) return;
        var real = session ? session.mode === 'real' : ui.mode !== 'sim';
        badge.className = 'sim-badge' + (real ? ' real' : '');
        badge.innerHTML = real
            ? '<i class="fa-regular fa-plug"></i> 真实 SSH'
            : '<i class="fa-regular fa-flask"></i> 模拟';
        badge.title = real
            ? '通过本机桥接连接真实服务器'
            : '本地模拟终端，不发起网络连接';
        updateModeButton();
    }

    function updateModeButton() {
        var button = $('btn-connection-mode');
        var glyph = $('connection-mode-glyph');
        var real = ui.mode !== 'sim';
        if (button) {
            button.title = real
                ? '下次连接方式：真实 SSH（点击切换为模拟）'
                : '下次连接方式：本地模拟（点击切换为真实）';
            button.classList.toggle('is-sim', !real);
        }
        if (glyph) glyph.textContent = real ? 'R' : 'S';
    }

    function focusInput() {
        var session = getActiveSession();
        if (!session || session.status !== 'connected') return;
        if (session.mode === 'real' && session.real) {
            session.real.focus();
            return;
        }
        if (els.input) els.input.focus();
    }

    function scrollTerminal() {
        if (!els.lines) return;
        els.lines.scrollTop = els.lines.scrollHeight;
    }

    // ======================================================================
    // 终端行
    // ======================================================================

    function L(text, cls) {
        return { segs: [{ t: String(text == null ? '' : text) }], cls: cls || null };
    }

    function S(segs, cls) {
        return { segs: segs, cls: cls || null };
    }

    function normalizeLine(line) {
        if (!line) return L('');
        if (typeof line === 'string') return L(line);
        return {
            segs: (line.segs || []).map(function (seg) {
                return { t: String(seg.t == null ? '' : seg.t), c: seg.c || null };
            }),
            cls: line.cls || null
        };
    }

    function lineEl(line) {
        var div = document.createElement('div');
        div.className = 'term-line' + (line.cls ? ' ' + line.cls : '');
        (line.segs || []).forEach(function (seg) {
            var span = document.createElement('span');
            if (seg.c) span.className = 'term-' + seg.c;
            span.textContent = seg.t;
            div.appendChild(span);
        });
        return div;
    }

    function appendLine(session, line, cls) {
        if (!session) return;
        var normalized = normalizeLine(line);
        if (cls && !normalized.cls) normalized.cls = cls;

        session.lines.push(normalized);
        if (session.lines.length > 900) {
            session.lines.splice(0, session.lines.length - 900);
        }

        if (session.id === activeSessionId && els.lines) {
            els.lines.appendChild(lineEl(normalized));
            while (els.lines.childElementCount > 900) {
                els.lines.removeChild(els.lines.firstChild);
            }
            scrollTerminal();
        }
    }

    function appendLines(session, lines) {
        (lines || []).forEach(function (line) { appendLine(session, line); });
    }

    function lineText(line) {
        return (line.segs || []).map(function (seg) { return seg.t; }).join('');
    }

    function promptSegments(session) {
        return [
            { t: session.username, c: 'user' },
            { t: '@', c: 'symbol' },
            { t: session.hostname, c: 'host' },
            { t: ':', c: 'symbol' },
            { t: cwdDisplay(session), c: 'path' },
            { t: session.username === 'root' ? '#' : '$', c: 'symbol' },
            { t: '', c: 'gap' }
        ];
    }

    function promptHTML(session) {
        return promptSegments(session).map(function (seg) {
            return '<span class="term-' + seg.c + '">' + esc(seg.t) + '</span>';
        }).join('');
    }

    // ======================================================================
    // 模拟文件系统
    // ======================================================================

    function makeDir(children) {
        return { type: 'dir', children: children || {} };
    }

    function makeFile(content) {
        return { type: 'file', content: content || '' };
    }

    function createFs(session) {
        var user = session.homeUser;
        var host = session.host;

        var accessLog = [];
        var errorLog = [];
        for (var i = 0; i < 18; i++) {
            var minute = two((i * 7) % 60);
            accessLog.push('10.0.0.' + (20 + i) + ' - - [19/Nov/2026:' + two(9 + (i % 8)) + ':' + minute + ':11 +0800] ' +
                '"GET /api/v1/health HTTP/1.1" 200 ' + (120 + i * 13) + ' "-" "curl/8.5.0"');
            if (i % 5 === 0) {
                errorLog.push('2026/11/19 ' + two(9 + (i % 8)) + ':' + minute + ':04 [error] upstream timed out (110) while reading response header');
            }
        }

        var syslog = [
            'Nov 19 09:12:01 ' + host + ' systemd[1]: Started Daily apt download activities.',
            'Nov 19 09:14:22 ' + host + ' sshd[2214]: Accepted password for ' + session.username + ' from 10.0.0.2 port 51234 ssh2',
            'Nov 19 09:16:08 ' + host + ' kernel: [ 8123.441] eth0: link up, 1000 Mbps, full duplex',
            'Nov 19 09:21:37 ' + host + ' cron[1441]: (root) CMD (/usr/local/bin/backup.sh)',
            'Nov 19 09:24:02 ' + host + ' nginx[982]: 2026/11/19 09:24:02 [warn] 982#982: server name conflict',
            'Nov 19 09:31:15 ' + host + ' systemd[1]: Reloading nginx.service.',
            'Nov 19 09:31:16 ' + host + ' systemd[1]: Reloaded nginx.service.',
            'Nov 19 09:40:00 ' + host + ' CRON[2311]: (root) CMD (/usr/bin/find /tmp -type f -mtime +7 -delete)'
        ].join('\n');

        var home = makeDir({
            '.bashrc': makeFile('# ~/.bashrc\nexport PS1="\\u@\\h:\\w\\$ "\nalias ll="ls -alF"\n'),
            '.bash_history': makeFile('ls -la\ncd /var/log\ntail -f syslog\nsystemctl status nginx\n'),
            '.ssh': makeDir({
                'authorized_keys': makeFile('# ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... meow-demo\n')
            }),
            'README.md': makeFile('# ' + host + '\n\n这是 Meow SSH 模拟终端生成的演示目录。\n所有命令都在本机模拟执行，不会连接远程主机。\n'),
            'logs': makeDir({
                'access.log': makeFile(accessLog.join('\n')),
                'error.log': makeFile(errorLog.join('\n') || 'no error')
            }),
            'scripts': makeDir({
                'deploy.sh': makeFile('#!/usr/bin/env bash\nset -euo pipefail\necho "deploying to ' + host + '..."\n'),
                'backup.sh': makeFile('#!/usr/bin/env bash\ntar -czf /tmp/site-$(date +%F).tar.gz /var/www\n')
            })
        });

        var homeParent = {};
        homeParent[user] = home;

        return makeDir({
            bin: makeDir({}),
            etc: makeDir({
                'hostname': makeFile(host),
                'os-release': makeFile('NAME="Ubuntu"\nVERSION="22.04.4 LTS (Jammy Jellyfish)"\nID=ubuntu\nPRETTY_NAME="Ubuntu 22.04.4 LTS"'),
                'nginx': makeDir({
                    'nginx.conf': makeFile('user www-data;\nworker_processes auto;\nhttp {\n    include /etc/nginx/sites-enabled/*;\n}\n')
                })
            }),
            home: makeDir(homeParent),
            root: makeDir({
                '.bash_history': makeFile('ls -la\ncd /var/log\n'),
                'deploy.sh': makeFile('#!/usr/bin/env bash\nset -e\necho deploy\n')
            }),
            tmp: makeDir({}),
            var: makeDir({
                log: makeDir({
                    'syslog': makeFile(syslog),
                    'nginx': makeDir({
                        'access.log': makeFile(accessLog.slice(0, 8).join('\n')),
                        'error.log': makeFile(errorLog.join('\n') || 'no error')
                    })
                }),
                www: makeDir({
                    'html': makeDir({ 'index.html': makeFile('<!DOCTYPE html>\n<html><body><h1>Meow</h1></body></html>\n') })
                })
            }),
            opt: makeDir({
                app: makeDir({
                    'config.yml': makeFile('server:\n  port: 8080\n  workers: 4\nlogging:\n  level: info\n'),
                    'app.log': makeFile('[info] server started on :8080\n[info] worker 1 ready\n[info] worker 2 ready\n')
                })
            })
        });
    }

    function resolvePath(session, input) {
        var raw = String(input == null ? '' : input);
        var base;
        if (!raw || raw === '~') return session.home.slice();
        if (raw.indexOf('~/') === 0) {
            base = session.home.slice();
            raw = raw.slice(2);
        } else if (raw.charAt(0) === '/') {
            base = [];
            raw = raw.slice(1);
        } else {
            base = session.cwd.slice();
        }

        raw.split('/').forEach(function (part) {
            if (!part || part === '.') return;
            if (part === '..') {
                base.pop();
                return;
            }
            base.push(part);
        });

        return base;
    }

    function getNode(session, pathArr) {
        var node = session.fs;
        for (var i = 0; i < pathArr.length; i++) {
            if (!node || node.type !== 'dir') return null;
            node = node.children[pathArr[i]];
            if (!node) return null;
        }
        return node;
    }

    function parentNode(session, pathArr) {
        if (!pathArr.length) return { parent: null, name: '' };
        var parent = getNode(session, pathArr.slice(0, -1));
        return { parent: parent, name: pathArr[pathArr.length - 1] };
    }

    function cwdDisplay(session) {
        var cwd = session.cwd || [];
        var home = session.home || ['home', session.homeUser || 'user'];
        var sameHome = cwd.length === home.length && cwd.every(function (v, i) { return v === home[i]; });
        if (sameHome) return '~';
        var inHome = cwd.length > home.length && home.every(function (v, i) { return cwd[i] === v; });
        if (inHome) return '~/' + cwd.slice(home.length).join('/');
        return '/' + cwd.join('/');
    }

    function sortEntries(entries) {
        return entries.sort(function (a, b) {
            if (a.node.type !== b.node.type) return a.node.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    function listEntries(node, all) {
        var entries = Object.keys(node.children).map(function (name) {
            return { name: name, node: node.children[name] };
        });
        if (!all) {
            entries = entries.filter(function (e) { return e.name.charAt(0) !== '.'; });
        }
        return sortEntries(entries);
    }

    // ======================================================================
    // 命令执行
    // ======================================================================

    var COMMAND_NAMES = [
        'help', 'ls', 'll', 'cd', 'pwd', 'cat', 'echo', 'mkdir', 'touch', 'rm', 'mv', 'cp',
        'tail', 'head', 'grep', 'find', 'whoami', 'hostname', 'id', 'uname', 'date', 'uptime',
        'df', 'free', 'ps', 'top', 'ip', 'ifconfig', 'ss', 'netstat', 'ping', 'curl',
        'systemctl', 'docker', 'history', 'env', 'clear', 'exit', 'logout', 'sudo', 'ssh',
        'vim', 'vi', 'nano', 'apt', 'yum', 'crontab', 'neofetch', 'w'
    ];

    function tokenize(input) {
        var out = [];
        var current = '';
        var quote = null;
        for (var i = 0; i < input.length; i++) {
            var ch = input.charAt(i);
            if (quote) {
                if (ch === quote) quote = null;
                else current += ch;
                continue;
            }
            if (ch === '"' || ch === "'") {
                quote = ch;
                continue;
            }
            if (/\s/.test(ch)) {
                if (current) {
                    out.push(current);
                    current = '';
                }
                continue;
            }
            current += ch;
        }
        if (current) out.push(current);
        return out;
    }

    function executeInput(session, raw) {
        if (!session || session.status !== 'connected') return;

        var command = String(raw == null ? '' : raw);
        var prompt = promptSegments(session);

        if (!command.trim()) {
            appendLine(session, S(prompt.slice(0, -1).concat([{ t: '\u00A0', c: 'symbol' }]), 'cmd'));
            updatePromptOnly(session);
            return;
        }

        appendLine(session, S(prompt.concat([{ t: command }]), 'cmd'));

        session.history.push(command);
        if (session.history.length > 120) session.history.shift();
        session.historyIndex = session.history.length;

        var grepPattern = null;
        var grepInsensitive = false;
        var baseCommand = command;

        var grepMatch = command.match(/^([\s\S]*?)\s*\|\s*(?:grep|egrep)\s+(-i\s+)?(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/);
        if (grepMatch) {
            baseCommand = grepMatch[1];
            grepInsensitive = !!grepMatch[2];
            grepPattern = grepMatch[3] || grepMatch[4] || grepMatch[5] || '';
        }

        var result = runCommandWithSudo(session, baseCommand);
        if (!result) return;

        if (grepPattern !== null) {
            var filtered = (result.lines || []).filter(function (line) {
                var text = lineText(line);
                return grepInsensitive
                    ? text.toLowerCase().indexOf(grepPattern.toLowerCase()) >= 0
                    : text.indexOf(grepPattern) >= 0;
            });
            result.lines = filtered;
            result.clear = false;
            result.close = false;
        }

        if (result.clear) {
            session.lines = [];
            renderTerminal(true);
            return;
        }

        appendLines(session, result.lines || []);

        if (result.close) {
            appendLine(session, L('logout'), 'dim');
            appendLine(session, L('Connection to ' + session.host + ' closed.'), 'dim');
            setTimeout(function () { closeSession(session.id); }, 420);
            return;
        }

        updatePromptOnly(session);
    }

    function updatePromptOnly(session) {
        if (session.id === activeSessionId) {
            els.prompt.innerHTML = promptHTML(session);
            els.input.value = '';
            scrollTerminal();
        }
    }

    function runCommandWithSudo(session, command) {
        var trimmed = command.trim();
        if (/^sudo\s+/.test(trimmed)) {
            var rest = trimmed.replace(/^sudo\s+/, '');
            var sudoLine = L('[sudo] password for ' + session.username + ': ', 'dim');
            var result = runBuiltin(session, rest);
            if (result) {
                result.lines = [sudoLine].concat(result.lines || []);
                return result;
            }
            return { lines: [sudoLine] };
        }
        return runBuiltin(session, trimmed);
    }

    function runBuiltin(session, command) {
        var tokens = tokenize(command);
        if (!tokens.length) return { lines: [] };

        var cmd = tokens[0];
        var args = tokens.slice(1);

        switch (cmd) {
            case 'help': return { lines: helpLines() };
            case 'ls': return { lines: cmdLs(session, args) };
            case 'll': return { lines: cmdLs(session, ['-l'].concat(args)) };
            case 'cd': return { lines: cmdCd(session, args) };
            case 'pwd': return { lines: [L('/' + session.cwd.join('/'))] };
            case 'cat': return { lines: cmdCat(session, args) };
            case 'echo': return { lines: [L(args.join(' '))] };
            case 'mkdir': return { lines: cmdMkdir(session, args) };
            case 'touch': return { lines: cmdTouch(session, args) };
            case 'rm': return { lines: cmdRm(session, args) };
            case 'mv':
            case 'cp': return { lines: cmdMoveCopy(session, cmd, args) };
            case 'tail': return { lines: cmdHeadTail(session, args, true) };
            case 'head': return { lines: cmdHeadTail(session, args, false) };
            case 'grep': return { lines: cmdGrep(session, args) };
            case 'find': return { lines: findLines(session, args) };
            case 'whoami': return { lines: [L(session.username)] };
            case 'hostname': return { lines: [L(session.hostname)] };
            case 'id': return { lines: [L('uid=1000(' + session.username + ') gid=1000(' + session.username + ') groups=1000(' + session.username + '),27(sudo)')] };
            case 'uname': return { lines: [L(unameLine(args))] };
            case 'date': return { lines: [L(dateLine())] };
            case 'uptime': return { lines: [L(uptimeLine(session))] };
            case 'df': return { lines: dfLines(session, args) };
            case 'free': return { lines: freeLines() };
            case 'ps': return { lines: psLines(session) };
            case 'top': return { lines: topLines(session) };
            case 'ip': return { lines: ipLines(session) };
            case 'ifconfig': return { lines: ifconfigLines(session) };
            case 'ss':
            case 'netstat': return { lines: socketLines(session) };
            case 'ping': return runPing(session, args);
            case 'curl': return { lines: curlLines(args) };
            case 'systemctl': return { lines: systemctlLines(session, args) };
            case 'docker': return { lines: dockerLines(args) };
            case 'history': return { lines: historyLines(session) };
            case 'env': return { lines: envLines(session) };
            case 'clear': return { clear: true, lines: [] };
            case 'exit':
            case 'logout': return { close: true, lines: [] };
            case 'sudo': return { lines: [L('sudo: 已处于模拟 root 权限，无需提权', 'dim')] };
            case 'ssh': return {
                lines: [
                    L('本页面终端为本地模拟环境，不会发起真实 SSH 连接。', 'warn'),
                    L('请使用左侧服务器列表新建会话，默认使用已保存的账号密码登录。', 'dim')
                ]
            };
            case 'vim':
            case 'vi':
            case 'nano': return { lines: [L('模拟终端不提供 ' + cmd + ' 编辑器，可使用 cat 查看文件。', 'warn')] };
            case 'apt':
            case 'yum': return { lines: [L('模拟环境：软件包管理命令不会真正执行。', 'dim')] };
            case 'crontab': return { lines: crontabLines(args) };
            case 'neofetch': return { lines: neofetchLines(session) };
            case 'w': return { lines: [L(' ' + nowTime() + ' up 42 days,  3:17,  2 users,  load average: 0.08, 0.12, 0.09')] };
            default:
                return {
                    lines: [
                        L('bash: ' + cmd + ': command not found', 'error'),
                        L('输入 help 查看模拟终端支持的命令。', 'dim')
                    ]
                };
        }
    }

    function helpLines() {
        return [
            L('Meow 模拟终端 · 可用命令', 'banner'),
            L('  文件与目录   ls / ll / cd / pwd / cat / mkdir / touch / rm / mv / cp / find'),
            L('  文本处理     echo / head / tail / grep（支持 cmd | grep 关键字）'),
            L('  系统信息     whoami / hostname / id / uname / date / uptime / df / free / ps / top'),
            L('  网络         ip / ifconfig / ss / netstat / ping / curl'),
            L('  服务与容器   systemctl / docker / crontab'),
            L('  其他         history / env / clear / exit / neofetch'),
            L(''),
            L('提示：↑ ↓ 浏览历史命令，Tab 补全命令与路径，Ctrl+L 清屏。', 'dim'),
            L('本终端为纯本地模拟，不会向任何服务器发起网络连接。', 'dim')
        ];
    }

    function groupingArgs(args) {
        var flags = [];
        var values = [];
        args.forEach(function (arg) {
            if (arg.charAt(0) === '-' && arg.length > 1) flags.push(arg);
            else values.push(arg);
        });
        return { flags: flags, values: values };
    }

    function cmdLs(session, args) {
        var parsed = groupingArgs(args);
        var long = parsed.flags.some(function (f) { return f.indexOf('l') >= 0; });
        var all = parsed.flags.some(function (f) { return f.indexOf('a') >= 0; });
        var target = parsed.values[parsed.values.length - 1] || '.';
        var pathArr = resolvePath(session, target);
        var node = getNode(session, pathArr);

        if (!node) {
            return [L("ls: cannot access '" + target + "': No such file or directory", 'error')];
        }
        if (node.type === 'file') {
            return [L(target)];
        }

        var entries = listEntries(node, all);
        if (!entries.length) return [];

        if (long) {
            return entries.map(function (entry) {
                var isDir = entry.node.type === 'dir';
                var size = isDir ? 4096 : (entry.node.content || '').length + 128;
                return S([
                    { t: isDir ? 'drwxr-xr-x' : '-rw-r--r--', c: 'dim' },
                    { t: ' 1 ' + session.username + ' ' + session.username + ' ' },
                    { t: String(size).padStart(6, ' ') + ' Nov 19 10:24 ' },
                    { t: entry.name + (isDir ? '/' : ''), c: isDir ? 'accent' : null }
                ]);
            });
        }

        var segs = [];
        entries.forEach(function (entry, index) {
            if (index) segs.push({ t: '  ' });
            segs.push({
                t: entry.name + (entry.node.type === 'dir' ? '/' : ''),
                c: entry.node.type === 'dir' ? 'accent' : null
            });
        });
        return [{ segs: segs }];
    }

    function cmdCd(session, args) {
        var target = args.filter(function (a) { return a.charAt(0) !== '-'; })[0] || '~';
        var pathArr = resolvePath(session, target);
        var node = getNode(session, pathArr);
        if (!node) return [L('bash: cd: ' + target + ': No such file or directory', 'error')];
        if (node.type !== 'dir') return [L('bash: cd: ' + target + ': Not a directory', 'error')];
        session.cwd = pathArr;
        return [];
    }

    function cmdCat(session, args) {
        var values = groupingArgs(args).values;
        if (!values.length) return [L('cat: 缺少文件参数', 'error')];

        var out = [];
        values.forEach(function (target) {
            var node = getNode(session, resolvePath(session, target));
            if (!node) {
                out.push(L('cat: ' + target + ': No such file or directory', 'error'));
                return;
            }
            if (node.type === 'dir') {
                out.push(L('cat: ' + target + ': Is a directory', 'error'));
                return;
            }
            node.content.split('\n').forEach(function (text) { out.push(L(text)); });
        });
        return out;
    }

    function cmdMkdir(session, args) {
        var parsed = groupingArgs(args);
        var parents = parsed.flags.some(function (f) { return f.indexOf('p') >= 0; });
        if (!parsed.values.length) return [L('mkdir: 缺少目录名', 'error')];

        var out = [];
        parsed.values.forEach(function (target) {
            var pathArr = resolvePath(session, target);
            var parent = getNode(session, pathArr.slice(0, -1));
            var name = pathArr[pathArr.length - 1];
            if (!name) return;

            if (!parent || parent.type !== 'dir') {
                if (parents) {
                    var cursor = session.fs;
                    var failed = false;
                    for (var i = 0; i < pathArr.length; i++) {
                        if (!cursor.children[pathArr[i]]) cursor.children[pathArr[i]] = makeDir({});
                        cursor = cursor.children[pathArr[i]];
                        if (cursor.type !== 'dir') {
                            out.push(L("mkdir: cannot create directory '" + target + "': Not a directory", 'error'));
                            failed = true;
                            break;
                        }
                    }
                    if (failed) return;
                    return;
                }
                out.push(L("mkdir: cannot create directory '" + target + "': No such file or directory", 'error'));
                return;
            }
            if (parent.children[name]) {
                if (parents) return;
                out.push(L("mkdir: cannot create directory '" + target + "': File exists", 'error'));
                return;
            }
            parent.children[name] = makeDir({});
        });
        return out;
    }

    function cmdTouch(session, args) {
        var values = groupingArgs(args).values;
        if (!values.length) return [L('touch: 缺少文件名', 'error')];
        var out = [];
        values.forEach(function (target) {
            var pathArr = resolvePath(session, target);
            var parent = getNode(session, pathArr.slice(0, -1));
            var name = pathArr[pathArr.length - 1];
            if (!parent || parent.type !== 'dir') {
                out.push(L("touch: cannot touch '" + target + "': No such file or directory", 'error'));
                return;
            }
            if (!parent.children[name]) parent.children[name] = makeFile('');
        });
        return out;
    }

    function cmdRm(session, args) {
        var parsed = groupingArgs(args);
        var recursive = parsed.flags.some(function (f) { return f.indexOf('r') >= 0; });
        var force = parsed.flags.some(function (f) { return f.indexOf('f') >= 0; });
        if (!parsed.values.length) return [L('rm: 缺少操作对象', 'error')];

        var out = [];
        parsed.values.forEach(function (target) {
            var pathArr = resolvePath(session, target);
            var info = parentNode(session, pathArr);
            var parent = info.parent;
            var name = info.name;
            if (!parent || parent.type !== 'dir' || !parent.children[name]) {
                if (!force) out.push(L("rm: cannot remove '" + target + "': No such file or directory", 'error'));
                return;
            }
            var node = parent.children[name];
            if (node.type === 'dir' && !recursive) {
                out.push(L("rm: cannot remove '" + target + "': Is a directory", 'error'));
                return;
            }
            delete parent.children[name];
        });
        return out;
    }

    function cmdMoveCopy(session, cmd, args) {
        var values = groupingArgs(args).values;
        if (values.length < 2) return [L(cmd + ': 需要源路径与目标路径', 'error')];

        var srcPath = resolvePath(session, values[0]);
        var dstPath = resolvePath(session, values[1]);
        var srcParent = parentNode(session, srcPath).parent;
        var srcName = srcPath[srcPath.length - 1];
        if (!srcParent || !srcParent.children[srcName]) {
            return [L(cmd + ": cannot stat '" + values[0] + "': No such file or directory", 'error')];
        }

        var srcNode = srcParent.children[srcName];
        var dstNode = getNode(session, dstPath);
        var finalParent;
        var finalName;

        if (dstNode && dstNode.type === 'dir') {
            finalParent = dstNode;
            finalName = srcName;
        } else {
            finalParent = getNode(session, dstPath.slice(0, -1));
            finalName = dstPath[dstPath.length - 1];
        }

        if (!finalParent || finalParent.type !== 'dir' || !finalName) {
            return [L(cmd + ": cannot create '" + values[1] + "': Not a directory", 'error')];
        }

        if (cmd === 'mv') {
            finalParent.children[finalName] = srcNode;
            delete srcParent.children[srcName];
        } else {
            finalParent.children[finalName] = cloneNode(srcNode);
        }
        return [];
    }

    function cloneNode(node) {
        if (node.type === 'file') return makeFile(node.content);
        var children = {};
        Object.keys(node.children).forEach(function (key) {
            children[key] = cloneNode(node.children[key]);
        });
        return makeDir(children);
    }

    function cmdHeadTail(session, args, isTail) {
        var parsed = groupingArgs(args);
        var count = 10;

        for (var i = 0; i < args.length; i++) {
            if (args[i] === '-n') {
                count = parseInt(args[i + 1], 10) || 10;
                break;
            }
            if (/^-n\d+$/.test(args[i])) {
                count = parseInt(args[i].slice(2), 10) || 10;
                break;
            }
            if (/^-\d+$/.test(args[i])) {
                count = parseInt(args[i].slice(1), 10) || 10;
                break;
            }
        }

        var target = parsed.values[parsed.values.length - 1];
        var label = isTail ? 'tail' : 'head';
        if (!target) return [L(label + ': 缺少文件参数', 'error')];

        var node = getNode(session, resolvePath(session, target));
        if (!node) return [L(label + ": cannot open '" + target + "' for reading: No such file or directory", 'error')];
        if (node.type === 'dir') return [L(label + ": error reading '" + target + "': Is a directory", 'error')];

        var lines = node.content.split('\n');
        var slice = isTail ? lines.slice(Math.max(0, lines.length - count)) : lines.slice(0, count);
        var out = slice.map(function (text) { return L(text); });

        if (isTail && args.indexOf('-f') >= 0) {
            out.push(L('（模拟环境：tail -f 不会持续输出）', 'dim'));
        }
        return out;
    }

    function cmdGrep(session, args) {
        var values = groupingArgs(args).values;
        if (values.length < 2) return [L('grep: 用法 grep 关键字 文件', 'error')];
        var pattern = values[0];
        var target = values[1];
        var node = getNode(session, resolvePath(session, target));
        if (!node) return [L('grep: ' + target + ': No such file or directory', 'error')];
        if (node.type === 'dir') return [L('grep: ' + target + ': Is a directory', 'error')];
        return node.content.split('\n')
            .filter(function (text) { return text.indexOf(pattern) >= 0; })
            .map(function (text) { return L(text); });
    }

    function findLines(session, args) {
        var values = groupingArgs(args).values;
        var start = values[0] || '.';
        var nameIndex = args.indexOf('-name');
        var pattern = nameIndex >= 0 ? (args[nameIndex + 1] || '*') : '*';
        var regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

        var rootPath = resolvePath(session, start);
        var root = getNode(session, rootPath);
        if (!root) return [L('find: \'' + start + '\': No such file or directory', 'error')];

        var out = [];
        (function walk(node, pathArr) {
            Object.keys(node.children).forEach(function (name) {
                var child = node.children[name];
                var childPath = pathArr.concat([name]);
                if (regex.test(name)) out.push(L('/' + childPath.join('/')));
                if (child.type === 'dir' && out.length < 200) walk(child, childPath);
            });
        })(root, rootPath);

        return out.length ? out : [L('')];
    }

    function unameLine(args) {
        if (args.indexOf('-a') >= 0) {
            return 'Linux ip-172-31-24-18 5.15.0-105-generic #115-Ubuntu SMP Mon Apr 15 09:52:04 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux';
        }
        return 'Linux';
    }

    function dateLine() {
        var d = new Date();
        var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var offset = -d.getTimezoneOffset();
        var sign = offset >= 0 ? '+' : '-';
        var abs = Math.abs(offset);
        return days[d.getDay()] + ' ' + months[d.getMonth()] + ' ' + d.getDate() + ' ' +
            two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) +
            ' CST ' + d.getFullYear() + ' ' + sign + two(Math.floor(abs / 60)) + two(abs % 60);
    }

    function uptimeLine(session) {
        var seed = hostSeed(session);
        return ' ' + nowTime() + ' up ' + (18 + seed % 60) + ' days,  ' + (seed % 10) + ':' + two(seed % 60) +
            ',  2 users,  load average: 0.0' + (seed % 9) + ', 0.1' + (seed % 7) + ', 0.0' + (seed % 5);
    }

    function hostSeed(session) {
        var seed = 0;
        var text = String(session.host || '');
        for (var i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) % 997;
        return seed;
    }

    function dfLines(session, args) {
        var human = args.join(' ').indexOf('h') >= 0;
        var seed = hostSeed(session);
        var total = 38 + seed % 40;
        var used = Math.floor(total * 0.46);
        var avail = total - used;
        if (human) {
            return [
                L('Filesystem      Size  Used Avail Use% Mounted on'),
                L('/dev/vda1        ' + total + 'G   ' + used + 'G   ' + avail + 'G  ' + Math.round(used / total * 100) + '% /'),
                L('tmpfs           795M     0  795M   0% /dev/shm'),
                L('/dev/vda15      105M  6.1M   99M   6% /boot/efi')
            ];
        }
        return [
            L('Filesystem     1K-blocks     Used Available Use% Mounted on'),
            L('/dev/vda1       ' + (total * 1048576) + ' ' + (used * 1048576) + ' ' + (avail * 1048576) + '  ' + Math.round(used / total * 100) + '% /')
        ];
    }

    function freeLines() {
        return [
            L('               total        used        free      shared  buff/cache   available'),
            L('Mem:           7.8Gi       2.1Gi       4.9Gi        12Mi       812Mi       5.4Gi'),
            L('Swap:          2.0Gi          0B       2.0Gi')
        ];
    }

    function psLines(session) {
        var rows = [
            ['root', '1', '0.0', '0.1', '168412', '12960', '?', 'Ss', '09:12', '0:04', '/sbin/init'],
            ['root', '412', '0.0', '0.2', '61240', '18880', '?', 'Ss', '09:12', '0:01', '/lib/systemd/systemd-journald'],
            ['root', '982', '0.0', '0.1', '55212', '9820', '?', 'Ss', '09:13', '0:00', 'nginx: master process /usr/sbin/nginx'],
            ['www-data', '984', '0.0', '0.1', '55620', '10240', '?', 'S', '09:13', '0:02', 'nginx: worker process'],
            ['root', '1441', '0.0', '0.0', '8420', '3120', '?', 'Ss', '09:13', '0:00', '/usr/sbin/cron -f'],
            [session.username, '2214', '0.0', '0.1', '13484', '7840', '?', 'Ss', '09:14', '0:00', '-bash'],
            ['root', '2388', '0.3', '1.4', '1823104', '112040', '?', 'Ssl', '09:18', '0:22', 'node /opt/app/server.js']
        ];
        var out = [L('USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND')];
        rows.forEach(function (row) {
            out.push(L(row.join(' ')));
        });
        return out;
    }

    function topLines(session) {
        return [
            L('top - ' + nowTime() + ' up 42 days,  3:17,  2 users,  load average: 0.08, 0.12, 0.09'),
            L('Tasks: 128 total,   1 running, 127 sleeping,   0 stopped,   0 zombie'),
            L('%Cpu(s):  1.7 us,  0.7 sy,  0.0 ni, 97.4 id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st'),
            L('MiB Mem :   7952.4 total,   5031.2 free,   2140.8 used,    780.4 buff/cache'),
            L('MiB Swap:   2048.0 total,   2048.0 free,      0.0 used.   5510.3 avail Mem'),
            L(''),
            L('    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND'),
            L('   2388 root      20   0 1823104 112040  18232 S   0.7   1.4   0:22.41 node'),
            L('    982 root      20   0   55212   9820   6120 S   0.0   0.1   0:00.31 nginx'),
            L('   1441 root      20   0    8420   3120   2210 S   0.0   0.0   0:00.12 cron')
        ];
    }

    function ipLines(session) {
        var ip = /^\d+\.\d+\.\d+\.\d+$/.test(session.host) ? session.host : '172.31.24.18';
        return [
            L('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000'),
            L('    inet 127.0.0.1/8 scope host lo'),
            L('2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000'),
            L('    link/ether 02:42:ac:11:00:02 brd ff:ff:ff:ff:ff:ff'),
            L('    inet ' + ip + '/24 brd 172.31.24.255 scope global dynamic eth0'),
            L('       valid_lft 85234sec preferred_lft 85234sec')
        ];
    }

    function ifconfigLines(session) {
        var ip = /^\d+\.\d+\.\d+\.\d+$/.test(session.host) ? session.host : '172.31.24.18';
        return [
            L('eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500'),
            L('        inet ' + ip + '  netmask 255.255.255.0  broadcast 172.31.24.255'),
            L('        ether 02:42:ac:11:00:02  txqueuelen 1000  (Ethernet)'),
            L('        RX packets 184223  bytes 241029311 (241.0 MB)'),
            L('        TX packets 152884  bytes 38019221 (38.0 MB)')
        ];
    }

    function socketLines(session) {
        var ip = /^\d+\.\d+\.\d+\.\d+$/.test(session.host) ? session.host : '172.31.24.18';
        return [
            L('Netid State  Recv-Q Send-Q Local Address:Port   Peer Address:Port'),
            L('tcp   LISTEN 0      128    0.0.0.0:22          0.0.0.0:*'),
            L('tcp   LISTEN 0      511    0.0.0.0:80          0.0.0.0:*'),
            L('tcp   LISTEN 0      511    0.0.0.0:443         0.0.0.0:*'),
            L('tcp   ESTAB  0      0      ' + ip + ':22     10.0.0.2:51234')
        ];
    }

    function runPing(session, args) {
        // 解析 -c 次数，默认 4 次；模拟环境一次性输出，避免与后续命令交错。
        var count = 4;
        var countIndex = args.indexOf('-c');
        if (countIndex >= 0 && args[countIndex + 1]) {
            count = parseInt(args[countIndex + 1], 10);
            if (!count || count < 0) count = 4;
            if (count > 10) count = 10;
        }

        var target = '';
        for (var a = 0; a < args.length; a++) {
            if (args[a] === '-c') { a++; continue; }
            if (args[a].charAt(0) !== '-') { target = args[a]; break; }
        }
        if (!target) return { lines: [L('ping: usage error: Destination address required', 'error')] };

        var out = [L('PING ' + target + ' (' + target + ') 56(84) bytes of data.')];
        var total = 0;
        for (var i = 0; i < count; i++) {
            var ms = 0.32 + i * 0.04 + Math.random() * 0.12;
            total += ms;
            out.push(L('64 bytes from ' + target + ': icmp_seq=' + (i + 1) + ' ttl=56 time=' + ms.toFixed(2) + ' ms'));
        }
        out.push(L(''));
        out.push(L('--- ' + target + ' ping statistics ---'));
        out.push(L(count + ' packets transmitted, ' + count + ' received, 0% packet loss, time ' + (count * 1000) + 'ms'));
        out.push(L('rtt min/avg/max/mdev = ' + (count ? 0.331 : 0) + '/' +
            (count ? (total / count).toFixed(3) : 0) + '/0.511/0.061 ms', 'dim'));
        return { lines: out };
    }

    function curlLines(args) {
        var hasHeader = args.indexOf('-I') >= 0 || args.indexOf('--head') >= 0;
        var url = args.filter(function (a) { return a.charAt(0) !== '-'; })[0] || 'https://example.com';
        if (hasHeader) {
            return [
                L('HTTP/2 200'),
                L('date: Wed, 19 Nov 2026 09:24:02 GMT'),
                L('content-type: text/html; charset=UTF-8'),
                L('server: nginx'),
                L('x-served-by: meow-simulation')
            ];
        }
        return [
            L('{"status":"ok","service":"meow-demo","target":"' + url.replace(/"/g, '') + '","uptime":38201}', 'dim')
        ];
    }

    function systemctlLines(session, args) {
        var action = args[0] || 'status';
        var service = args[1] || 'nginx';

        if (action === 'restart' || action === 'reload' || action === 'start' || action === 'stop') {
            return [L('模拟环境：' + action + ' ' + service + '.service 已完成（未影响真实主机）', 'dim')];
        }
        if (action === 'enable' || action === 'disable') {
            return [L('模拟环境：' + action + ' ' + service + '.service', 'dim')];
        }

        return [
            L('● ' + service + '.service - A high performance web server and a reverse proxy server'),
            L('     Loaded: loaded (/lib/systemd/system/' + service + '.service; enabled; vendor preset: enabled)'),
            L('     Active: active (running) since Wed 2026-11-19 09:13:02 CST; 1h 12min ago', 'success'),
            L('       Docs: man:nginx(8)'),
            L('   Main PID: 982 (nginx)'),
            L('      Tasks: 3 (limit: 9451)'),
            L('     Memory: 8.1M'),
            L('        CPU: 412ms'),
            L('     CGroup: /system.slice/' + service + '.service'),
            L('             ├─982 nginx: master process /usr/sbin/nginx'),
            L('             └─984 nginx: worker process')
        ];
    }

    function dockerLines(args) {
        if (args[0] === 'images') {
            return [
                L('REPOSITORY          TAG       IMAGE ID       CREATED         SIZE'),
                L('nginx               latest    605c77e624dd   2 weeks ago     141MB'),
                L('redis               7-alpine  c1a7c53e1f88   3 weeks ago     41.2MB'),
                L('node                20-alpine 9c1e2e4c6d11   4 weeks ago     132MB')
            ];
        }
        if (args[0] === 'ps') {
            return [
                L('CONTAINER ID   IMAGE          COMMAND                  CREATED       STATUS         PORTS                  NAMES'),
                L('8f2c91a4d6b1   nginx:latest   "/docker-entrypoint.…"   2 hours ago   Up 2 hours     0.0.0.0:80->80/tcp     web'),
                L('b41d77e0c3a2   redis:7        "docker-entrypoint.s…"   2 hours ago   Up 2 hours     6379/tcp               cache')
            ];
        }
        return [L('docker: 模拟环境仅支持 docker ps / docker images', 'dim')];
    }

    function historyLines(session) {
        if (!session.history.length) return [L('    1  help'), L('    2  ls -la'), L('    3  uptime')];
        return session.history.map(function (item, index) {
            return L(String(index + 1).padStart(5, ' ') + '  ' + item);
        });
    }

    function envLines(session) {
        return [
            L('USER=' + session.username),
            L('HOME=/home/' + session.homeUser),
            L('SHELL=/bin/bash'),
            L('PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'),
            L('LANG=en_US.UTF-8'),
            L('TERM=xterm-256color'),
            L('HOSTNAME=' + session.hostname),
            L('SSH_CONNECTION=10.0.0.2 51234 ' + session.host + ' ' + session.port)
        ];
    }

    function crontabLines(args) {
        if (args[0] === '-e') return [L('模拟环境：不提供 crontab 编辑器', 'dim')];
        return [
            L('# m h  dom mon dow   command'),
            L('0 3 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1'),
            L('*/5 * * * * curl -sf http://127.0.0.1/health || systemctl restart nginx')
        ];
    }

    function neofetchLines(session) {
        return [
            S([{ t: '        /\\_/\\        ', c: 'accent' }, { t: session.username + '@' + session.hostname }]),
            S([{ t: '       ( o.o )       ', c: 'accent' }, { t: '-----------------' }]),
            S([{ t: '        > ^ <        ', c: 'accent' }, { t: 'OS: Ubuntu 22.04.4 LTS x86_64' }]),
            S([{ t: '                     ', c: 'accent' }, { t: 'Host: Meow SSH Simulation' }]),
            S([{ t: '', c: null }, { t: 'Kernel: 5.15.0-105-generic' }]),
            S([{ t: '', c: null }, { t: 'Uptime: ' + (18 + hostSeed(session) % 60) + ' days, 3 hours' }]),
            S([{ t: '', c: null }, { t: 'Shell: bash 5.1.16' }]),
            S([{ t: '', c: null }, { t: 'Terminal: Meow Workbench' }]),
            S([{ t: '', c: null }, { t: 'CPU: Intel Xeon Platinum 8259CL (2) @ 2.50GHz' }]),
            S([{ t: '', c: null }, { t: 'Memory: 2140MiB / 7952MiB' }])
        ];
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

        if (!lines.length) return;

        if (session.mode === 'real') {
            if (!session.real) return;
            if (onlyFill) {
                session.real.paste(lines[0]);
                toast('已填入命令，按 Enter 执行');
            } else {
                lines.forEach(function (line) { session.real.sendLine(line); });
                session.real.focus();
            }
            return;
        }

        if (onlyFill) {
            els.input.value = lines[0];
            focusInput();
            toast('已填入命令，按 Enter 执行');
            return;
        }

        for (var i = 0; i < lines.length; i++) {
            if (session.status !== 'connected' || sessions.indexOf(session) === -1) break;
            executeInput(session, lines[i]);
        }
        focusInput();
    }

    function submitTerminal() {
        var session = getActiveSession();
        if (!session || session.status !== 'connected') return;
        if (session.mode === 'real') return;
        var raw = els.input.value;
        els.input.value = '';
        executeInput(session, raw);
        focusInput();
    }

    function historyStep(direction) {
        var session = getActiveSession();
        if (!session || !session.history.length) return;

        var next = session.historyIndex + direction;
        if (next < 0) next = 0;
        if (next > session.history.length) next = session.history.length;
        session.historyIndex = next;

        els.input.value = next === session.history.length ? '' : session.history[next];
        setTimeout(function () {
            els.input.setSelectionRange(els.input.value.length, els.input.value.length);
        }, 0);
    }

    function clearActiveTerminal() {
        var session = getActiveSession();
        if (!session) return;
        if (session.mode === 'real' && session.real) {
            session.real.clear();
            session.real.focus();
            return;
        }
        session.lines = [];
        renderTerminal(true);
    }

    function completeInput() {
        var session = getActiveSession();
        if (!session || session.status !== 'connected') return;

        var value = els.input.value;
        var tokens = value.split(/\s+/);
        var fragment = tokens[tokens.length - 1] || '';

        if (tokens.length <= 1) {
            var matched = COMMAND_NAMES.filter(function (name) {
                return name.indexOf(fragment) === 0;
            });
            if (matched.length === 1) {
                els.input.value = matched[0] + ' ';
                setInputCaret();
                return;
            } else if (matched.length > 1) {
                appendLine(session, S([{ t: matched.join('   ') }], 'dim'));
                scrollTerminal();
                return;
            }
            // 没有命令匹配时按路径处理，便于直接补全当前目录下的文件名
            if (!fragment) return;
        }

        var slash = fragment.lastIndexOf('/');
        var dirPart = slash >= 0 ? fragment.slice(0, slash + 1) : (fragment === '~' ? '~/' : '');
        var basePart = fragment === '~' ? '' : (slash >= 0 ? fragment.slice(slash + 1) : fragment);
        var dirNode = getNode(session, resolvePath(session, dirPart || '.'));

        if (!dirNode || dirNode.type !== 'dir') return;

        var names = Object.keys(dirNode.children).filter(function (name) {
            if (name.charAt(0) === '.' && basePart.charAt(0) !== '.') return false;
            if (tokens[0] === 'cd' && dirNode.children[name].type !== 'dir') return false;
            return name.indexOf(basePart) === 0;
        }).sort(function (a, b) {
            var ad = dirNode.children[a].type === 'dir';
            var bd = dirNode.children[b].type === 'dir';
            if (ad !== bd) return ad ? -1 : 1;
            return a.localeCompare(b);
        });

        if (names.length === 1) {
            var name = names[0];
            var isDir = dirNode.children[name].type === 'dir';
            tokens[tokens.length - 1] = dirPart + name + (isDir ? '/' : ' ');
            els.input.value = tokens.join(' ');
            setInputCaret();
        } else if (names.length > 1) {
            appendLine(session, S(names.map(function (name, index) {
                return {
                    t: (index ? '   ' : '') + name + (dirNode.children[name].type === 'dir' ? '/' : ''),
                    c: dirNode.children[name].type === 'dir' ? 'accent' : null
                };
            }), 'dim'));
            scrollTerminal();
        }
    }

    function setInputCaret() {
        if (!els.input) return;
        var end = els.input.value.length;
        els.input.setSelectionRange(end, end);
    }

    // ======================================================================
    // 真实 SSH 桥接设置
    // ======================================================================

    function updateConnectModeUI() {
        var modeEl = document.querySelector('input[name="ssh-connect-mode"]:checked');
        var mode = modeEl ? modeEl.value : 'real';
        var hint = $('ssh-connect-mode-hint');
        if (hint) hint.classList.toggle('hidden', mode === 'sim');
    }

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
        els.lines = $('terminal-lines');
        els.realTerminal = $('real-terminal');
        els.prompt = $('term-prompt');
        els.input = $('terminal-input');
        els.terminalForm = $('terminal-form');
        els.statusDot = $('term-status-dot');
        els.statusText = $('term-status-text');
        els.sessionMeta = $('term-session-meta');
        els.modeBadge = $('term-mode-badge');
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

        var bridgeBtn = $('btn-ssh-bridge');
        if (bridgeBtn) bridgeBtn.addEventListener('click', openBridgeModal);

        var modeBtn = $('btn-connection-mode');
        if (modeBtn) {
            modeBtn.addEventListener('click', function () {
                ui.mode = ui.mode === 'sim' ? 'real' : 'sim';
                saveUi();
                updateModeButton();
                updateConnectModeUI();
                updateModeBadge(getActiveSession());
                toast(ui.mode === 'real' ? '下次连接使用真实 SSH' : '下次连接使用本地模拟');
            });
        }

        var connectBridgeBtn = $('btn-connect-bridge-config');
        if (connectBridgeBtn) connectBridgeBtn.addEventListener('click', openBridgeModal);

        Array.prototype.forEach.call(
            document.querySelectorAll('input[name="ssh-connect-mode"]'),
            function (radio) {
                radio.addEventListener('change', function () {
                    if (!radio.checked) return;
                    ui.mode = radio.value === 'sim' ? 'sim' : 'real';
                    saveUi();
                    updateConnectModeUI();
                    updateModeButton();
                });
            }
        );

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

        els.terminalScreen.addEventListener('click', function (e) {
            if (e.target.closest('.terminal-input-row')) return;
            if (window.getSelection() && String(window.getSelection()).length) return;
            focusInput();
        });

        els.terminalForm.addEventListener('submit', function (e) {
            e.preventDefault();
            submitTerminal();
        });

        els.input.addEventListener('keydown', function (e) {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                submitTerminal();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                historyStep(-1);
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                historyStep(1);
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                completeInput();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
                e.preventDefault();
                clearActiveTerminal();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
                var selection = window.getSelection();
                if (selection && String(selection).length) return;
                e.preventDefault();
                var session = getActiveSession();
                if (session && session.status === 'connected') {
                    appendLine(session, S(promptSegments(session).concat([
                        { t: els.input.value },
                        { t: '^C', c: 'warn' }
                    ]), 'cmd'));
                    els.input.value = '';
                    scrollTerminal();
                }
            }
        });

        els.input.addEventListener('paste', function (e) {
            var data = e.clipboardData || window.clipboardData;
            var text = data ? data.getData('text') : '';
            if (!text || !/[\r\n]/.test(text)) return;
            e.preventDefault();
            var session = getActiveSession();
            if (!session || session.status !== 'connected') return;
            text.split(/\r?\n/).map(function (line) { return line.trim(); })
                .filter(Boolean)
                .forEach(function (line) {
                    if (session.status === 'connected') executeInput(session, line);
                });
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
                    search: typeof data[UI_KEY].search === 'string' ? data[UI_KEY].search : '',
                    mode: data[UI_KEY].mode === 'sim' ? 'sim' : 'real'
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

            if (els.input) els.input.disabled = true;

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
            updateModeBadge(null);
            updateModeButton();
            setTimeout(refreshBridgeStatus, 250);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
