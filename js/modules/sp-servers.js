// sp-servers.js - 服务器管理模块（CRUD、导入导出、过滤、拖拽排序、网站子管理）
// 此文件参照 sp-ai-provider.js 的模式创建

// === 服务器管理 模块 ===

// 全局状态（由 sp-core.js 统一管理 myServers、editingSrvId）
let myServers = [];
let editingSrvId = null;
let srvDragSrcIndex = null;

// 网站子编辑状态
let editingWebsiteId = null; // null=添加, 否则=编辑
let srvWebsiteStandalone = false; // 从卡片直接编辑网站时为 true（不打开服务器弹窗）

// 网站迁移状态
// srvMigrateCtx = { sourceId, ws, draftIdx }
//   sourceId：源服务器 id
//   ws：待迁移的网站对象（卡片内直接取服务器数据，弹窗内取编辑草稿）
//   draftIdx：来自服务器弹窗草稿时的下标，卡片发起时为 null
let srvMigrateCtx = null;
let srvMigrateTargetId = null;

// 分类管理
let srvCategories = []; // [{ id: string, name: string }]
let srvActiveCategoryId = ''; // '' = 全部
let srvChargeFilter = ''; // '' = 全部, unpaid = 收费未收款, paid = 收费已收款
let srvVisibleServers = []; // 最近一次渲染后可见的服务器，供「复制筛选结果」使用

// 协议显示标签
const SRV_PROTOCOL_LABELS = {
    ssh: 'SSH',
    rdp: '远程桌面 (RDP)',
    vnc: 'VNC',
    other: 'Other'
};

// 面板类型标签
const SRV_PANEL_LABELS = {
    none: '无',
    bt: '宝塔',
    cyberpanel: 'Cyberpanel',
    cloudpanel: 'CloudPanel',
    other: '其它'
};

// 操作系统图标（Font Awesome brands + 官方品牌色）
const SRV_OS_ICONS = {
    Windows: { icon: 'fa-brands fa-windows', color: '#0078d4' },
    Ubuntu: { icon: 'fa-brands fa-ubuntu', color: '#e95420' },
    Debian: { icon: 'fa-brands fa-debian', color: '#d70a53' },
    CentOS: { icon: 'fa-brands fa-centos', color: '#932571' },
    Other: { icon: 'fa-regular fa-ellipsis', color: '#94a3b8' }
};

// 数据库类型标签
const SRV_DB_LABELS = {
    none: '无',
    mssql: 'MSSQL',
    mysql: 'MYSQL',
    mariadb: 'MariaDB'
};

// 操作系统默认用户名
function getDefaultUsername(os) {
    return (os === 'Windows') ? 'administrator' : 'root';
}

// 收费金额显示格式化（保留最多两位小数，去掉多余的 0）
function formatSrvFee(fee) {
    const n = parseFloat(fee);
    if (isNaN(n)) return '18';
    return (Math.round(n * 100) / 100).toString();
}

// 数据库默认用户名
function getDefaultDbUsername(dbType) {
    return (dbType === 'mssql') ? 'sa' : 'root';
}

function saveServers() {
    chrome.storage.local.set({ 'meow_servers': myServers });
}

// 服务器显示名（标题为空时退回 IP）
function srvDisplayName(srv) {
    if (!srv) return '(未设置)';
    return srv.title || srv.ip || '(未设置)';
}

// === 分类管理 ===
function saveSrvCategories() {
    chrome.storage.local.set({ 'meow_server_categories': srvCategories });
}

async function loadSrvCategories() {
    try {
        const localData = await chrome.storage.local.get(['meow_server_categories']);
        srvCategories = localData.meow_server_categories || [];
    } catch (e) {
        console.error('Category load error:', e);
        srvCategories = [];
    }
}

function renderSrvCatTabs() {
    const sidebar = document.getElementById('srv-sidebar');
    if (!sidebar) return;

    // 保留"全部"Tab，移除中间的分类 Tab
    const allTab = sidebar.querySelector('.srv-cat-tab[data-cat-id=""]');
    sidebar.querySelectorAll('.srv-cat-tab:not([data-cat-id=""])').forEach(el => el.remove());

    // "全部" Tab 事件和激活状态
    if (allTab) {
        const allActive = !srvActiveCategoryId;
        allTab.classList.toggle('active', allActive);
        // 线性图标随激活状态切换：默认 fa-folder，选中 fa-folder-open
        const allIcon = allTab.querySelector('i');
        if (allIcon) allIcon.className = allActive ? 'fa-regular fa-folder-open' : 'fa-regular fa-folder';
        allTab.addEventListener('click', function() {
            srvActiveCategoryId = '';
            renderSrvCatTabs();
            renderServers();
        });
    }

    // 插入分类 Tab（在全部Tab之后）
    srvCategories.forEach((cat, index) => {
        const tab = document.createElement('div');
        tab.className = 'srv-cat-tab' + (cat.id === srvActiveCategoryId ? ' active' : '');
        tab.dataset.catId = cat.id;
        tab.dataset.catName = cat.name;
        tab.dataset.index = index;
        tab.innerHTML = `<i class="fa-regular ${cat.id === srvActiveCategoryId ? 'fa-folder-open' : 'fa-folder'}"></i><span class="srv-cat-label">${escapeHtml(cat.name)}</span>`;
        tab.addEventListener('click', function() {
            srvActiveCategoryId = this.dataset.catId;
            renderSrvCatTabs();
            renderServers();
        });
        // 拖拽排序
        tab.draggable = true;
        tab.addEventListener('dragstart', function(e) {
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
        });
        tab.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            sidebar.querySelectorAll('.srv-cat-tab').forEach(el => el.classList.remove('drag-over'));
        });
        tab.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.classList.add('drag-over');
        });
        tab.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
        });
        tab.addEventListener('drop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            this.classList.remove('drag-over');
            const srcIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const destIndex = index;
            if (srcIndex !== destIndex) {
                const item = srvCategories.splice(srcIndex, 1)[0];
                srvCategories.splice(destIndex, 0, item);
                saveSrvCategories();
                renderSrvCatTabs();
            }
        });
        sidebar.appendChild(tab);
    });
}

// === 面板账号密码一键填充 ===
function srvWaitTabComplete(tabId, timeoutMs = 20000, waitForLoading = false) {
    return new Promise(async resolve => {
        let settled = false;
        let sawLoading = !waitForLoading;
        function done() {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }
        function listener(id, changeInfo) {
            if (id !== tabId) return;
            if (changeInfo.status === 'loading') sawLoading = true;
            else if (changeInfo.status === 'complete' && sawLoading) done();
        }
        const timer = setTimeout(done, timeoutMs);
        chrome.tabs.onUpdated.addListener(listener);
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.status === 'complete' && sawLoading) done();
        } catch (e) { done(); }
    });
}

// 在 CloudPanel 登录页内执行：把界面语言切为简体中文（提交 locale 表单会触发页面重载）
function srvSetCloudPanelLocale(locale) {
    const form = document.forms['localeSelector'];
    const sel = form ? form.querySelector('select[name="locale"]') : document.querySelector('select#localeSelector');
    if (!sel || !sel.form) return 'no-form';
    if (sel.value === locale) return 'already';
    sel.value = locale;
    sel.form.submit();
    return 'switching';
}

// 在面板登录页内执行：定位账号/密码输入框并填入（兼容 CyberPanel/CloudPanel），返回是否成功
function srvFillPanelLogin(username, password, autoLogin) {
    const isVisible = el => !!el && el.offsetParent !== null && !el.disabled;
    const setNativeValue = (el, value) => {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const passEl = Array.from(document.querySelectorAll('input[type="password"]')).filter(isVisible)[0];
    if (!passEl) return false;
    let userEl = document.querySelector('#id_username'); // CyberPanel（Django 表单）
    if (!isVisible(userEl)) {
        // 通用：密码框前最后一个可见的文本类输入（CloudPanel 的 React 表单）
        userEl = Array.from(document.querySelectorAll('input'))
            .filter(el => el !== passEl && isVisible(el)
                && /^(text|email|tel|search)$/i.test(el.type || 'text')
                && (el.compareDocumentPosition(passEl) & Node.DOCUMENT_POSITION_FOLLOWING))
            .pop();
    }
    let filled = false;
    if (username && userEl) { setNativeValue(userEl, username); filled = true; }
    if (password) { setNativeValue(passEl, password); filled = true; }
    if (filled && autoLogin) {
        const form = passEl.form;
        const btn = form && form.querySelector('button[type="submit"], input[type="submit"]');
        if (btn) btn.click();
        else if (form) form.submit();
    }
    if (filled && userEl && !autoLogin) userEl.focus();
    return filled;
}

async function openPanelAndAutofill(srv) {
    let url = (srv.panelUrl || '').trim();
    if (!url) { showToast('面板地址为空'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const tab = await chrome.tabs.create({ url, active: true });
    showToast('正在打开面板，页面加载后自动填充…');
    await srvWaitTabComplete(tab.id);
    if (srv.panelType === 'cloudpanel') {
        // CloudPanel 登录页先切简体中文（表单提交会重载页面），再等中文页加载完
        try {
            const r = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: srvSetCloudPanelLocale,
                args: ['zh_HANS']
            });
            if (r && r[0] && r[0].result === 'switching') {
                await srvWaitTabComplete(tab.id, 20000, true);
            }
        } catch (e) { /* 页面跳转中或非登录页，忽略 */ }
    }
    for (let i = 0; i < 15; i++) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: srvFillPanelLogin,
                args: [srv.panelUser || '', srv.panelPass || '', !!srv.autoLogin]
            });
            if (results && results[0] && results[0].result) {
                showToast(srv.autoLogin ? '已填充并自动提交登录' : '已填充面板账号密码');
                return;
            }
        } catch (e) { /* 页面仍在跳转，继续重试 */ }
        await new Promise(r => setTimeout(r, 800));
    }
    showToast('未找到登录表单，请手动填写');
}

// === 收费状态筛选 ===
const SRV_CHARGE_FILTERS = [
    { value: '', label: '全部', color: '' },
    { value: 'unpaid', label: '收费未收款', color: '#ef4444' },
    { value: 'paid', label: '收费已收款', color: '#10b981' }
];

function updateSrvFilterButtons() {
    const btn = document.getElementById('srv-charge-filter-btn');
    if (!btn) return;
    btn.classList.toggle('filter-unpaid', srvChargeFilter === 'unpaid');
    btn.classList.toggle('filter-paid', srvChargeFilter === 'paid');
    const current = SRV_CHARGE_FILTERS.find(f => f.value === srvChargeFilter);
    btn.title = srvChargeFilter ? `筛选：${current.label}` : '收费状态筛选';

    const copyBtn = document.getElementById('srv-copy-filtered-btn');
    if (copyBtn) {
        copyBtn.classList.toggle('disabled', !srvChargeFilter);
        copyBtn.title = srvChargeFilter ? '复制筛选结果' : '请先选择收费状态筛选';
    }
}

function openSrvChargeFilterMenu() {
    const existing = document.querySelector('.srv-charge-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = 'srv-charge-menu';
    menu.innerHTML = SRV_CHARGE_FILTERS.map(f => {
        const active = f.value === srvChargeFilter;
        return `<div class="srv-charge-menu-item${active ? ' active' : ''}" data-value="${f.value}">
            <span class="mi fa-regular fa-check" style="font-size:12px;${active ? '' : 'visibility:hidden;'}"></span>
            <span${f.color ? ` style="color:${f.color};"` : ''}>${f.label}</span>
        </div>`;
    }).join('');

    menu.addEventListener('click', function(e) {
        const item = e.target.closest('.srv-charge-menu-item');
        if (!item) return;
        srvChargeFilter = item.dataset.value;
        chrome.storage.local.set({ 'meow_server_charge_filter': srvChargeFilter });
        menu.remove();
        renderServers();
    });

    document.body.appendChild(menu);
    const rect = document.getElementById('srv-charge-filter-btn').getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';

    setTimeout(() => {
        document.addEventListener('click', function onOutside() {
            menu.remove();
            document.removeEventListener('click', onOutside);
            document.removeEventListener('keydown', onEsc);
        });
        function onEsc(e) {
            if (e.key !== 'Escape') return;
            menu.remove();
            document.removeEventListener('click', onOutside);
            document.removeEventListener('keydown', onEsc);
        }
        document.addEventListener('keydown', onEsc);
    }, 0);
}

// === 复制筛选结果（只含收费服务器下的网站域名）===
function copySrvFilteredWebsites() {
    if (!srvChargeFilter) return;
    const domains = [];
    let total = 0;
    let skipped = 0;
    srvVisibleServers.forEach(srv => {
        if (!srv.isCharged) return;
        const srvDomains = (srv.websites || []).map(w => (w.domain || '').trim()).filter(Boolean);
        if (srvDomains.length === 0) { skipped++; return; }
        domains.push(...srvDomains);
        total += parseFloat(srv.chargeFee) || 0;
    });

    if (domains.length === 0) {
        showToast('当前筛选结果没有可复制的网站');
        return;
    }

    const text = domains.map((d, i) => `${i + 1}、${d}`).join('\n')
        + '\n' + '-'.repeat(36)
        + `\n共${domains.length}个网站，合计：${Math.round(total * 100) / 100}元。`;
    copyToClipboard(text);
    showToast(skipped > 0
        ? `已复制 ${domains.length} 个网站（${skipped} 台收费服务器未登记网站，未计入）`
        : `已复制 ${domains.length} 个网站`);
}

// ===== 服务器卡片拖拽排序 =====
// 交互与「工具箱」卡片保持一致：
//   · 只有标题栏(.srv-card-header)是拖拽手柄，卡片内容区不参与拖拽，
//     这样展开后在卡片内的输入框/文本域里仍能正常用鼠标拖选文字；
//   · 拖拽期间被拖卡片脱离文档流、紧贴指针移动；它原来的位置由一个等高的
//     占位块顶替，占位块随指针逐格移动，实时指示"松手后落到哪"；
//   · 其它卡片通过 FLIP 位移补间滑向新位置，形成平滑让位的观感。
// 事件用委托只绑一次：renderServers 会重建所有卡片，逐卡绑定会重复注册。
function setupSrvCardDrag(container) {
    container = container || document.getElementById('srv-list');
    if (!container) return;

    // 每次重建卡片后都要刷新：确保标题栏 draggable、补齐拖拽手柄、重排索引。
    // 注意：只有标题栏是拖拽手柄，卡片本体绝不设置 draggable，
    // 否则卡片展开后在内容区按住鼠标也会被浏览器当成拖拽，
    // 导致输入框/文本域里无法用鼠标拖选文字。
    function refreshIndices() {
        container.querySelectorAll('.srv-card').forEach((card, i) => {
            card.dataset.index = i;
            card.removeAttribute('draggable');
            const header = card.querySelector('.srv-card-header');
            if (!header) return;
            header.setAttribute('draggable', 'true');
            // 标题栏里的链接自带原生拖拽（拖动会变成拖链接而不是拖卡片），统一关掉
            header.querySelectorAll('a[href]').forEach(a => a.setAttribute('draggable', 'false'));
            if (!header.querySelector('.srv-card-drag-handle')) {
                const handle = document.createElement('span');
                handle.className = 'mi fa-regular fa-grip-dots-vertical srv-card-drag-handle';
                header.insertBefore(handle, header.firstChild);
            }
        });
    }

    refreshIndices();

    // 事件委托只需绑定一次（renderServers 每次都会调用本函数）
    if (container.dataset.srvDragBound === '1') return;
    container.dataset.srvDragBound = '1';

    let dragCard = null;      // 正在拖拽的卡片
    let placeholder = null;   // 撑开空位的占位块
    let srcIndex = null;      // 拖拽起点索引
    let grabOffsetX = 0;      // 按下点相对卡片左上角的偏移
    let grabOffsetY = 0;

    // 被筛选隐藏的卡片仍留在 DOM 里（display:none），既不占位也不参与
    // 落点判断；offsetParent 为 null 也一并兜底。
    function isActiveCard(card) {
        return !!card && card !== dragCard && card.style.display !== 'none' && card.offsetParent !== null;
    }

    // 让跟随卡片贴在指针位置
    function followPointer(x, y) {
        if (!dragCard) return;
        dragCard.style.left = (x - grabOffsetX) + 'px';
        dragCard.style.top = (y - grabOffsetY) + 'px';
    }

    // 记录除被拖卡片外的纵向布局位置。
    // 这里刻意用 offsetTop 而非 getBoundingClientRect：offsetTop 反映的是
    // 布局位置，不受 transform 影响，因此让位动画尚未结束时再次测量
    // 也不会把动画中的位移算进去，避免误差累积。
    function snapshotTops() {
        const tops = new Map();
        container.querySelectorAll('.srv-card').forEach(card => {
            if (!isActiveCard(card)) return;
            tops.set(card, card.offsetTop);
        });
        return tops;
    }

    // FLIP：先让卡片瞬移到新布局位置并施加反向位移，再过渡回 0，形成滑入效果
    function animateLetWay(prevTops) {
        container.querySelectorAll('.srv-card').forEach(card => {
            if (!isActiveCard(card)) return;
            const before = prevTops.get(card);
            if (before === undefined) return;
            const dy = before - card.offsetTop;
            if (!dy) return;
            card.style.transition = 'none';
            card.style.transform = 'translateY(' + dy + 'px)';
            void card.offsetWidth; // 强制重排，确保反向位移先生效
            card.style.transition = 'transform .18s cubic-bezier(.2, .8, .2, 1)';
            card.style.transform = '';
        });
    }

    // 取占位块前后真正参与排序的卡片。
    // 必须跳过被拖卡片：它已改为 fixed，offsetTop 变成视口坐标（与其它卡片
    // 相对容器的 offsetTop 不同基准），且视觉上不占位，不能作为落点参照。
    function siblingCard(dir) {
        let node = placeholder;
        if (!node) return null;
        while ((node = dir > 0 ? node.nextElementSibling : node.previousElementSibling)) {
            if (node.classList && node.classList.contains('srv-card') && isActiveCard(node)) return node;
        }
        return null;
    }

    // 让占位块上移/下移一格（dir = 1 下移，-1 上移）
    function shiftPlaceholder(dir) {
        if (!placeholder || !placeholder.parentNode) return false;
        const prevTops = snapshotTops();
        if (dir > 0) {
            const next = siblingCard(1);
            if (!next) return false;
            container.insertBefore(placeholder, next.nextElementSibling);
        } else {
            const prev = siblingCard(-1);
            if (!prev) return false;
            container.insertBefore(placeholder, prev);
        }
        animateLetWay(prevTops);
        return true;
    }

    // 指针是否越过了相邻卡片的中线，越过才换位。
    // 基准取"相邻卡片中线"而不是占位块中心：卡片展开后高度差异很大，
    // 以占位块中心为基准会让高卡片的落点判断严重偏后。
    function shiftTowardsPointer(clientY) {
        if (!placeholder) return false;
        const y = clientY - container.getBoundingClientRect().top;

        const next = siblingCard(1);
        if (next && y > next.offsetTop + next.offsetHeight / 2) return shiftPlaceholder(1);

        const prev = siblingCard(-1);
        if (prev && y < prev.offsetTop + prev.offsetHeight / 2) return shiftPlaceholder(-1);

        return false;
    }

    // 结束拖拽：keepPosition 为 true 表示落到占位块处，false 表示回到起点（取消）
    function finishDrag(keepPosition) {
        if (!dragCard) return;
        const card = dragCard;
        const fromIndex = srcIndex;

        if (placeholder) {
            if (keepPosition) {
                container.insertBefore(card, placeholder);
            } else {
                // 取消时按原索引复位：先从列表里排除自己，再把原索引处的卡片当锚点
                const others = Array.from(container.querySelectorAll('.srv-card')).filter(c => c !== card);
                const anchor = others[fromIndex] || null;
                if (anchor) container.insertBefore(card, anchor);
                else container.appendChild(card);
            }
            if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
        }
        placeholder = null;

        card.classList.remove('dragging-follow', 'dragging', 'drag-over');
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';

        // 清理让位动画的内联样式。
        // 必须先关过渡再清除位移：否则清除位移会按 CSS 的 all .2s 再滑一次，
        // 表现为 drop 后卡片额外滑行一段。归位完成后再恢复默认过渡。
        const cleanupCards = container.querySelectorAll('.srv-card');
        cleanupCards.forEach(c => {
            c.style.transition = 'none';
            c.style.transform = '';
        });
        void container.offsetWidth;
        cleanupCards.forEach(c => { c.style.transition = ''; });

        dragCard = null;
        srvDragSrcIndex = null;

        if (!keepPosition || fromIndex === null) {
            refreshIndices();
            return;
        }

        // 被筛选隐藏的卡片只是 display:none，仍在 DOM 里且没有参与让位，
        // 因此按“可见卡片的新顺序填回原来的可见槽位”，隐藏项保持原位不动。
        const domCards = Array.from(container.querySelectorAll('.srv-card'));
        const visibleIds = domCards
            .filter(c => c.style.display !== 'none')
            .map(c => String(c.dataset.id));
        const visibleSet = new Set(visibleIds);

        const srvById = new Map(myServers.map(s => [String(s.id), s]));
        let vi = 0;
        const newOrder = myServers.map(s => {
            if (!visibleSet.has(String(s.id))) return s;
            return srvById.get(visibleIds[vi++]) || s;
        });

        const changed = newOrder.some((s, i) => s !== myServers[i]);
        if (changed) {
            myServers = newOrder;
            saveServers();
            renderServers();
        }
        // 预览/无数据变化时不会重渲染，这里也补齐索引，保证 dataset.index 永远等于 DOM 顺序
        refreshIndices();
    }

    // 只有拖拽源是标题栏时才视为卡片排序；
    // 卡片内容区里选中文字、拖链接等原生拖拽一律忽略。
    function getDragCard(e) {
        const target = e.target;
        if (!target || typeof target.closest !== 'function') return null;
        const header = target.closest('.srv-card-header');
        if (!header || !container.contains(header)) return null;
        return header.closest('.srv-card');
    }

    container.addEventListener('dragstart', function(e) {
        const card = getDragCard(e);
        if (!card || !isActiveCard(card)) return;

        const rect = card.getBoundingClientRect();
        dragCard = card;
        srcIndex = Array.from(container.querySelectorAll('.srv-card')).indexOf(card);
        srvDragSrcIndex = srcIndex;
        grabOffsetX = e.clientX - rect.left;
        grabOffsetY = e.clientY - rect.top;

        // 原生拖影是浏览器拍下的快照，会和我们 fixed 跟随的卡片叠成重影，
        // 用 1×1 透明图替换掉，只保留跟随指针的那一张。
        try {
            const blank = document.createElement('canvas');
            blank.width = 1;
            blank.height = 1;
            e.dataTransfer.setDragImage(blank, 0, 0);
        } catch (_) {}

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', String(card.dataset.id || srcIndex)); } catch (_) {}
        }

        // 占位块先顶住原位，再把卡片抽出文档流
        placeholder = document.createElement('div');
        placeholder.className = 'srv-drop-placeholder';
        placeholder.style.height = rect.height + 'px';
        container.insertBefore(placeholder, card);

        card.style.width = rect.width + 'px';
        card.style.height = rect.height + 'px';
        card.style.left = rect.left + 'px';
        card.style.top = rect.top + 'px';
        card.classList.add('dragging-follow');
        card.classList.remove('dragging', 'drag-over');
    });

    container.addEventListener('dragover', function(e) {
        if (!dragCard || !placeholder) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        followPointer(e.clientX, e.clientY);

        // 每次 dragover 最多追 4 格：快速拖动时指针一帧能跨过好几张卡片，
        // 只移动一格会明显滞后。上限 4 次是为了避免长列表下逐帧重排过多。
        for (let i = 0; i < 4; i++) {
            if (!shiftTowardsPointer(e.clientY)) break;
        }
    });

    container.addEventListener('drop', function(e) {
        if (!dragCard) return;
        e.preventDefault();
        e.stopPropagation();
        finishDrag(true);
    });

    container.addEventListener('dragend', function() {
        // drop 分支已处理过则 dragCard 已置空；这里兜底「拖到区域外松手」的取消
        if (dragCard) finishDrag(false);
    });

    // 指针移出服务器列表时容器收不到 dragover，卡片会滞留在原处；
    // 用 document 捕获阶段保持跟随（不调用 preventDefault，不影响原生放置判定）
    document.addEventListener('dragover', function(e) {
        if (dragCard) followPointer(e.clientX, e.clientY);
    }, true);
}

// === 服务器列表渲染 ===
function renderServers() {
    const srvList = document.getElementById('srv-list');
    const srvEmpty = document.getElementById('srv-empty');
    const srvCountBar = document.getElementById('srv-count-bar');
    if (!srvList || !srvEmpty) return;
    updateSrvFilterButtons();
    srvVisibleServers = [];
    // 记住重渲染前处于展开状态的卡片（开关等操作会写存储触发 onChanged 全量重建，否则卡片会收起）
    const expandedIds = new Set(Array.from(srvList.querySelectorAll('.srv-card.expanded')).map(c => c.dataset.id));
    srvList.innerHTML = '';

    const filterInput = document.getElementById('srv-filter-input');
    const filterText = (filterInput ? filterInput.value.trim().toLowerCase() : '');

    if (myServers.length === 0) {
        srvEmpty.classList.remove('hidden');
        if (srvCountBar) srvCountBar.textContent = '共 0 台服务器';
        const moneyBarEmpty = document.getElementById('srv-money-bar');
        if (moneyBarEmpty) { moneyBarEmpty.style.display = 'none'; moneyBarEmpty.innerHTML = ''; }
        return;
    }
    srvEmpty.classList.add('hidden');

    let visibleCount = 0;
    let totalCharge = 0, totalPaid = 0;

    myServers.forEach((srv, index) => {
        // 分类过滤
        let matchCategory = true;
        if (srvActiveCategoryId) {
            matchCategory = (srv.categoryId === srvActiveCategoryId);
        }

        let matchFilter = true;
        if (filterText) {
            const title = (srv.title || '').toLowerCase();
            const ip = (srv.ip || '').toLowerCase();
            const user = (srv.username || '').toLowerCase();
            const note = (srv.note || '').toLowerCase();
            const wsDomains = (srv.websites || []).map(w => (w.domain || '').toLowerCase()).join(' ');
            matchFilter = title.includes(filterText) || ip.includes(filterText) || user.includes(filterText) || note.includes(filterText) || wsDomains.includes(filterText);
        }

        const passCategoryFilter = matchCategory;

        let matchCharge = true;
        if (srvChargeFilter === 'unpaid') {
            matchCharge = !!srv.isCharged && !srv.paid;
        } else if (srvChargeFilter === 'paid') {
            matchCharge = !!srv.isCharged && !!srv.paid;
        }

        const card = document.createElement('div');
        card.className = 'srv-card';
        card.dataset.id = srv.id;

        const osMeta = SRV_OS_ICONS[srv.os] || SRV_OS_ICONS.Other;
        const catMeta = srvCategories.find(c => c.id === srv.categoryId);
        const protocolLabel = SRV_PROTOCOL_LABELS[srv.protocol] || srv.protocol || 'SSH';
        const wsCount = (srv.websites || []).length;
        const displayName = srv.title || srv.ip || '(未设置)';
        const canPanelAutofill = (srv.panelType === 'cyberpanel' || srv.panelType === 'cloudpanel') && !!srv.panelUrl && !!(srv.panelUser || srv.panelPass);

        // 网站 HTML
        const websitesHtml = (srv.websites || []).map((ws, wi) => {
            const wsRows = [];
            if (ws.adminUrl) wsRows.push(`<div class="srv-ws-detail-row srv-copy-row" data-copy="${escapeHtml(ws.adminUrl)}" title="点击复制"><span class="srv-ws-detail-label">后台地址</span><span class="srv-ws-detail-val" style="color:#0891b2;text-decoration:underline;">${escapeHtml(ws.adminUrl)}</span></div>`);
            if (ws.adminUser) wsRows.push(`<div class="srv-ws-detail-row srv-copy-row" data-copy="${escapeHtml(ws.adminUser)}" title="点击复制"><span class="srv-ws-detail-label">网站账号</span><span class="srv-ws-detail-val">${escapeHtml(ws.adminUser)}</span></div>`);
            if (ws.adminPass) wsRows.push(`<div class="srv-ws-detail-row srv-copy-row" data-copy="${escapeHtml(ws.adminPass)}" title="点击复制"><span class="srv-ws-detail-label">网站密码</span><span class="srv-ws-detail-val srv-masked">••••••••</span></div>`);
            if (ws.dbType && ws.dbType !== 'none') {
                if (ws.dbUser) wsRows.push(`<div class="srv-ws-detail-row srv-copy-row" data-copy="${escapeHtml(ws.dbUser)}" title="点击复制"><span class="srv-ws-detail-label">数据库用户</span><span class="srv-ws-detail-val">${escapeHtml(ws.dbUser)}</span></div>`);
                if (ws.dbPass) wsRows.push(`<div class="srv-ws-detail-row srv-copy-row" data-copy="${escapeHtml(ws.dbPass)}" title="点击复制"><span class="srv-ws-detail-label">数据库密码</span><span class="srv-ws-detail-val srv-masked">••••••••</span></div>`);
                if (ws.dbTable) wsRows.push(`<div class="srv-ws-detail-row srv-copy-row" data-copy="${escapeHtml(ws.dbTable)}" title="点击复制"><span class="srv-ws-detail-label">数据库名</span><span class="srv-ws-detail-val">${escapeHtml(ws.dbTable)}</span></div>`);
            }
            if (ws.path) wsRows.push(`<div class="srv-ws-detail-row srv-copy-row" data-copy="${escapeHtml(ws.path)}" title="点击复制"><span class="srv-ws-detail-label">绝对路径</span><span class="srv-ws-detail-val">${escapeHtml(ws.path)}</span></div>`);
            return `<div class="srv-ws-item" data-widx="${wi}">
                <div class="srv-ws-item-header">
                    <div class="srv-ws-domain">
                        <span class="mi srv-ws-toggle fa-regular fa-chevron-down" style="font-size:14px;color:#94a3b8;cursor:pointer;"></span>
                        <span class="mi fa-regular fa-globe" style="font-size:12px;color:#10b981;"></span>
                        <span class="srv-copy-row" data-copy="${escapeHtml(ws.domain || '')}" title="点击复制域名" style="cursor:pointer;">${escapeHtml(ws.domain || '(未设置域名)')}</span>
                        ${ws.adminUrl ? `<a class="srv-ws-link" href="${escapeHtml(ws.adminUrl)}" target="_blank" title="打开后台"><span class="mi fa-regular fa-arrow-up-right-from-square" style="font-size:12px;color:#0891b2;"></span></a>` : ''}
                    </div>
                    <div class="srv-ws-item-actions">
                        <button class="srv-copy-btn" data-copy-type="website" data-widx="${wi}" title="一键复制网站信息"><span class="mi fa-regular fa-copy" style="font-size:13px;"></span>复制</button>
                        <span class="mi srv-ws-migrate-btn fa-regular fa-arrow-right-arrow-left" data-widx="${wi}" title="迁移到其它服务器" style="font-size:14px;color:#cbd5e1;cursor:pointer;"></span>
                        <span class="mi srv-ws-edit-btn fa-regular fa-pen-to-square" data-widx="${wi}" title="编辑网站" style="font-size:14px;color:#cbd5e1;cursor:pointer;"></span>
                        <i class="fa-regular fa-xmark srv-ws-del-btn" data-widx="${wi}" title="删除网站" style="font-size:14px;color:#cbd5e1;cursor:pointer;"></i>
                    </div>
                </div>
                ${wsRows.length > 0 ? `<div class="srv-ws-details" style="display:none">${wsRows.join('')}</div>` : ''}
            </div>`;
        }).join('');

        card.innerHTML = `
            <div class="srv-card-header" draggable="true">
                <span class="mi srv-card-drag-handle fa-regular fa-grip-dots-vertical"></span>
                <span class="mi srv-card-toggle fa-regular fa-chevron-down"></span>
                <span class="mi ${osMeta.icon}" style="font-size:16px;color:${osMeta.color};"></span>
                <span class="srv-card-title">
                    <span class="srv-card-name${srv.isCharged ? (srv.paid ? ' srv-card-name-paid' : ' srv-card-name-unpaid') : ''}"${srv.isCharged && !srv.paid ? ' title="已收费但未收款"' : ''}>${escapeHtml(displayName)}</span>
                    <button type="button" class="srv-title-copy-btn" title="复制标题"><span class="mi fa-regular fa-copy" style="font-size:12px;"></span></button>
                </span>
                ${catMeta ? `<span class="srv-card-badge">${escapeHtml(catMeta.name)}</span>` : ''}
                <div class="srv-card-actions">
                    ${srv.providerUrl ? `<a class="srv-provider-link" href="${escapeHtml(srv.providerUrl)}" target="_blank" title="打开供应商" draggable="false"><span class="mi fa-regular fa-arrow-up-right-from-square" style="font-size:16px;color:#cbd5e1;"></span></a>` : ''}
                    <span class="mi srv-edit-btn fa-regular fa-pen-to-square" data-id="${srv.id}" title="编辑"></span>
                    <i class="fa-regular fa-xmark srv-del-btn" data-id="${srv.id}" title="删除"></i>
                </div>
            </div>
            <div class="srv-card-body" style="display:none">
                <div class="srv-section-bar">
                    <span class="srv-section-title"><span class="mi fa-regular fa-cloud" style="font-size:13px;color:#6366f1;"></span> 连接信息</span>
                    <button class="srv-copy-btn" data-copy-type="server" title="一键复制 IP/端口/用户名/密码"><span class="mi fa-regular fa-copy" style="font-size:13px;"></span>复制</button>
                </div>
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.ip || '')}" title="点击复制"><span class="srv-info-label">IP 地址</span><span class="srv-info-val" style="color:#6366f1;font-weight:600;">${escapeHtml(srv.ip || '--')}</span></div>
                <div class="srv-info-row"><span class="srv-info-label">协议</span><span class="srv-info-val">${protocolLabel}</span></div>
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.port || '')}" title="点击复制"><span class="srv-info-label">端口</span><span class="srv-info-val">${escapeHtml(srv.port || '--')}</span></div>
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.username || '')}" title="点击复制"><span class="srv-info-label">用户名</span><span class="srv-info-val">${escapeHtml(srv.username || '--')}</span></div>
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.password || '')}" title="点击复制"><span class="srv-info-label">密码</span><span class="srv-info-val srv-masked">${srv.password ? '••••••••' : '--'}</span></div>
                ${srv.isCharged ? `<div class="srv-info-row"><span class="srv-info-label">收费金额</span><span class="srv-info-val" style="color:#d97706;font-weight:600;">¥ ${escapeHtml(formatSrvFee(srv.chargeFee))}</span></div>` : ''}
                ${srv.panelType && srv.panelType !== 'none' ? `
                <div class="srv-section-bar">
                    <span class="srv-section-title"><span class="mi fa-regular fa-table-cells-large" style="font-size:13px;color:#6366f1;"></span> ${SRV_PANEL_LABELS[srv.panelType] || '管理面板'}</span>
                    <button class="srv-copy-btn" data-copy-type="panel" title="一键复制面板地址/账号/密码"><span class="mi fa-regular fa-copy" style="font-size:13px;"></span>复制</button>
                </div>
                ${canPanelAutofill ? `<div class="srv-info-row"><span class="srv-info-label">自动登录</span><label class="srv-wp-switch" title="填充账号密码后自动点击登录按钮"><input type="checkbox" class="srv-autologin-toggle"${srv.autoLogin ? ' checked' : ''}><span class="srv-wp-slider"></span></label></div>` : ''}
                ${srv.panelUrl ? `<div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.panelUrl)}" title="点击复制"><span class="srv-info-label">面板地址</span><span style="display:flex;align-items:center;gap:6px;justify-content:flex-end;min-width:0;"><span class="srv-info-val" style="color:#0891b2;text-decoration:underline;">${escapeHtml(srv.panelUrl)}</span>${canPanelAutofill ? `<button type="button" class="srv-autofill-btn" title="打开面板并自动填入账号密码"><span class="mi fa-regular fa-key" style="font-size:12px;"></span></button>` : ''}</span></div>` : ''}
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.panelUser || '')}" title="点击复制"><span class="srv-info-label">面板账号</span><span class="srv-info-val">${escapeHtml(srv.panelUser || '--')}</span></div>
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.panelPass || '')}" title="点击复制"><span class="srv-info-label">面板密码</span><span class="srv-info-val srv-masked">${srv.panelPass ? '••••••••' : '--'}</span></div>
                ` : ''}
                ${srv.note && srv.note.trim() ? `<div class="srv-note-box"><span class="mi fa-regular fa-file-lines" style="font-size:12px;color:#a8a29e;"></span> ${escapeHtml(srv.note)}</div>` : ''}
                <div class="srv-ws-section">
                    <div class="srv-ws-header">
                        <span class="mi fa-regular fa-globe" style="font-size:12px;color:#10b981;"></span>
                        <span>绑定网站 (${wsCount})</span>
                        <button type="button" class="srv-ws-add-btn" title="添加网站"><span class="mi fa-regular fa-plus" style="font-size:14px;"></span></button>
                    </div>
                    ${wsCount > 0 ? websitesHtml : '<div class="srv-ws-empty-hint">暂无网站</div>'}
                </div>
            </div>
        `;

        // 折叠/展开
        card.querySelector('.srv-card-header').addEventListener('click', function(e) {
            if (e.target.closest('.srv-card-drag-handle, .srv-card-actions, .srv-ws-del-btn, .srv-ws-edit-btn, .srv-ws-migrate-btn, .srv-ws-link, .srv-provider-link, .srv-copy-btn, .srv-ws-add-btn')) return;
            const body = card.querySelector('.srv-card-body');
            const isExpanded = card.classList.toggle('expanded');
            body.style.display = isExpanded ? '' : 'none';
        });

        // 单行点击复制
        card.querySelectorAll('.srv-copy-row').forEach(row => {
            row.addEventListener('click', function(e) {
                e.stopPropagation();
                const val = this.dataset.copy;
                if (val) copyToClipboard(val);
            });
        });

        // 复制标题
        card.querySelector('.srv-title-copy-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            const title = (srv.title || '').trim();
            if (!title) { showToast('标题为空'); return; }
            copyToClipboard(title);
        });

        // 自动登录开关（仅 Cyberpanel/CloudPanel 且可填充时显示）
        const autoLoginToggle = card.querySelector('.srv-autologin-toggle');
        if (autoLoginToggle) {
            autoLoginToggle.addEventListener('change', function() {
                srv.autoLogin = this.checked;
                saveServers();
            });
        }

        // 面板地址「一键填充」图标：只跳转填充，不触发所在行的点击复制
        const autofillBtn = card.querySelector('.srv-autofill-btn');
        if (autofillBtn) {
            autofillBtn.addEventListener('click', async function(e) {
                e.stopPropagation();
                if (this.disabled) return;
                this.disabled = true;
                try {
                    await openPanelAndAutofill(srv);
                } finally {
                    this.disabled = false;
                }
            });
        }

        // 一键复制按钮
        card.querySelectorAll('.srv-copy-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const type = this.dataset.copyType;
                let text = '';
                if (type === 'server') {
                    text = `IP：${srv.ip || ''}\n端口：${srv.port || ''}\n用户名：${srv.username || ''}\n密码：${srv.password || ''}`;
                    showToast('已复制服务器连接信息');
                } else if (type === 'panel') {
                    text = `面板地址：${srv.panelUrl || ''}\n面板账号：${srv.panelUser || ''}\n面板密码：${srv.panelPass || ''}`;
                    showToast('已复制面板信息');
                } else if (type === 'website') {
                    const wi = parseInt(this.dataset.widx);
                    const ws = (srv.websites || [])[wi];
                    if (!ws) return;
                    text = `后台地址：${ws.adminUrl || ''}\n网站账号：${ws.adminUser || ''}\n网站密码：${ws.adminPass || ''}`;
                    showToast(`已复制「${ws.domain || '网站'}」信息`);
                }
                if (text) copyToClipboard(text);
            });
        });

        // 编辑
        card.querySelector('.srv-edit-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            openSrvModal(srv);
        });

        // 删除
        card.querySelector('.srv-del-btn').addEventListener('click', async function(e) {
            e.stopPropagation();
            if (await showConfirmDialog({ message: '确定删除此服务器记录？', type: 'danger' })) {
                myServers = myServers.filter(s => s.id !== srv.id);
                saveServers();
                renderServers();
                showToast('已删除');
            }
        });

        // 删除网站（卡片内快捷删除）
        card.querySelectorAll('.srv-ws-del-btn').forEach(btn => {
            btn.addEventListener('click', async function(e) {
                e.stopPropagation();
                const wi = parseInt(this.dataset.widx);
                const ws = srv.websites[wi];
                if (!ws) return;
                if (await showConfirmDialog({ message: `确定删除网站「${ws.domain || '未命名'}」？`, type: 'danger' })) {
                    srv.websites.splice(wi, 1);
                    saveServers();
                    renderServers();
                    showToast('已删除网站');
                }
            });
        });

        // 网站折叠/展开（默认收起）
        card.querySelectorAll('.srv-ws-item-header').forEach(header => {
            header.addEventListener('click', function(e) {
                if (e.target.closest('.srv-copy-btn, .srv-ws-edit-btn, .srv-ws-migrate-btn, .srv-ws-del-btn, .srv-ws-link, .srv-copy-row')) return;
                const item = this.closest('.srv-ws-item');
                const details = item.querySelector('.srv-ws-details');
                const toggle = this.querySelector('.srv-ws-toggle');
                if (!details) return;
                const isExpanded = details.style.display !== 'none';
                details.style.display = isExpanded ? 'none' : '';
                if (toggle) toggle.classList.toggle('expanded', !isExpanded);
            });
        });

        // 迁移网站到其它服务器（卡片内直接迁移，作用于已保存的数据）
        card.querySelectorAll('.srv-ws-migrate-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const wi = parseInt(this.dataset.widx);
                const ws = (srv.websites || [])[wi];
                if (!ws) return;
                openSrvMigrateModal(srv.id, ws, null);
            });
        });

        // 编辑网站（卡片内直接编辑，仅打开网站弹窗）
        card.querySelectorAll('.srv-ws-edit-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const wi = parseInt(this.dataset.widx);
                editingSrvId = srv.id;
                srvEditWebsites = (srv.websites || []).map(w => ({ ...w }));
                srvWebsiteStandalone = true;
                openSrvWebsiteModal(wi);
            });
        });

        // 添加网站（卡片内直接添加，仅打开网站弹窗）
        card.querySelector('.srv-ws-add-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            editingSrvId = srv.id;
            srvEditWebsites = (srv.websites || []).map(w => ({ ...w }));
            srvWebsiteStandalone = true;
            openSrvWebsiteModal(null);
        });

        // 拖拽排序见 setupSrvCardDrag()：标题栏是拖拽手柄，事件统一在列表上委托
        card.dataset.index = index;

        if (!matchFilter) {
            card.style.display = 'none';
        } else if (!passCategoryFilter) {
            card.style.display = 'none';
        } else if (!matchCharge) {
            card.style.display = 'none';
        } else {
            visibleCount++;
            srvVisibleServers.push(srv);
            if (srv.isCharged) {
                const fee = parseFloat(srv.chargeFee) || 0;
                totalCharge += fee;
                if (srv.paid) totalPaid += fee;
            }
        }

        if (expandedIds.has(String(srv.id))) {
            card.classList.add('expanded');
            const body = card.querySelector('.srv-card-body');
            if (body) body.style.display = '';
        }

        srvList.appendChild(card);
    });

    if (visibleCount === 0 && myServers.length > 0) {
        srvEmpty.classList.remove('hidden');
        srvEmpty.querySelector('p').textContent = '无匹配结果';
    }

    // 更新计数栏
    if (srvCountBar) {
        const totalCount = myServers.length;
        let catCount;
        if (srvActiveCategoryId) {
            catCount = myServers.filter(s => s.categoryId === srvActiveCategoryId).length;
        } else {
            catCount = totalCount;
        }
        if ((filterText || srvChargeFilter) && visibleCount < totalCount) {
            srvCountBar.textContent = `共 ${totalCount} 台服务器（显示 ${visibleCount} 台）`;
        } else if (srvActiveCategoryId) {
            const catName = srvCategories.find(c => c.id === srvActiveCategoryId)?.name || '未命名';
            srvCountBar.textContent = `「${catName}」下有 ${catCount} 台服务器 / 共 ${totalCount} 台服务器`;
        } else {
            srvCountBar.textContent = `共 ${totalCount} 台服务器`;
        }
    }

    // 收费统计栏：只统计当前筛选后可见的服务器
    const moneyBar = document.getElementById('srv-money-bar');
    if (moneyBar) {
        if (totalCharge > 0) {
            const totalUnpaid = totalCharge - totalPaid;
            const fmtMoney = n => '¥' + (Math.round(n * 100) / 100).toString();
            moneyBar.style.display = '';
            moneyBar.innerHTML = `共收费 ${fmtMoney(totalCharge)} · <span class="srv-money-paid">已收 ${fmtMoney(totalPaid)}</span> · <span class="srv-money-unpaid">未收 ${fmtMoney(totalUnpaid)}</span>`;
        } else {
            moneyBar.style.display = 'none';
            moneyBar.innerHTML = '';
        }
    }

    // 卡片建好后统一整理拖拽手柄/索引（本函数每次重建列表都会被调用）
    setupSrvCardDrag(srvList);
}

// === 服务器编辑弹窗 ===
function openSrvModal(srv) {
    editingSrvId = null;

    const titleInput = document.getElementById('srv-title-input');
    const osInput = document.getElementById('srv-os-input');
    const protocolInput = document.getElementById('srv-protocol-input');
    const ipInput = document.getElementById('srv-ip-input');
    const portInput = document.getElementById('srv-port-input');
    const userInput = document.getElementById('srv-user-input');
    const passInput = document.getElementById('srv-pass-input');
    const providerUrlInput = document.getElementById('srv-provider-url-input');
    const noteInput = document.getElementById('srv-note-input');
    const panelTypeInput = document.getElementById('srv-panel-type-input');
    const panelUrlInput = document.getElementById('srv-panel-url-input');
    const panelUserInput = document.getElementById('srv-panel-user-input');
    const panelPassInput = document.getElementById('srv-panel-pass-input');
    const deleteBtn = document.getElementById('srv-delete-btn');
    const modalTitle = document.getElementById('srv-modal-title');
    const categoryInput = document.getElementById('srv-category-input');
    const chargeToggle = document.getElementById('srv-charge-toggle');
    const chargeFeeInput = document.getElementById('srv-charge-fee-input');
    const chargeFeeGroup = document.getElementById('srv-charge-fee-group');
    const paidToggle = document.getElementById('srv-paid-toggle');

    // 填充分类下拉
    if (categoryInput) {
        categoryInput.innerHTML = '<option value="">无分类</option>';
        srvCategories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            categoryInput.appendChild(opt);
        });
    }

    // 重置
    titleInput.value = '';
    osInput.value = 'Ubuntu';
    protocolInput.value = 'ssh';
    ipInput.value = '';
    portInput.value = '22';
    userInput.value = getDefaultUsername('Ubuntu');
    passInput.value = '';
    providerUrlInput.value = '';
    noteInput.value = '';
    panelTypeInput.value = 'none';
    panelUrlInput.value = '';
    panelUserInput.value = '';
    panelPassInput.value = '';
    if (chargeToggle) chargeToggle.checked = false;
    if (chargeFeeInput) chargeFeeInput.value = '18';
    if (chargeFeeGroup) chargeFeeGroup.style.display = 'none';
    if (paidToggle) { paidToggle.checked = false; paidToggle.disabled = true; }
    deleteBtn.classList.add('hidden');

    // 临时网站列表（编辑期间的副本）
    srvEditWebsites = [];

    if (srv) {
        editingSrvId = srv.id;
        modalTitle.textContent = '编辑服务器';
        titleInput.value = srv.title || '';
        osInput.value = srv.os || 'Ubuntu';
        protocolInput.value = srv.protocol || 'ssh';
        ipInput.value = srv.ip || '';
        portInput.value = srv.port || '';
        userInput.value = srv.username || '';
        passInput.value = srv.password || '';
        providerUrlInput.value = srv.providerUrl || '';
        noteInput.value = srv.note || '';
        panelTypeInput.value = srv.panelType || 'none';
        panelUrlInput.value = srv.panelUrl || '';
        panelUserInput.value = srv.panelUser || '';
        panelPassInput.value = srv.panelPass || '';
        srvEditWebsites = (srv.websites || []).map(w => ({ ...w }));
        deleteBtn.classList.remove('hidden');
        if (categoryInput) categoryInput.value = srv.categoryId || '';
        if (chargeToggle) chargeToggle.checked = !!srv.isCharged;
        if (chargeFeeInput) chargeFeeInput.value = (srv.chargeFee !== undefined && srv.chargeFee !== null && srv.chargeFee !== '') ? srv.chargeFee : '18';
        if (chargeFeeGroup) chargeFeeGroup.style.display = (chargeToggle && chargeToggle.checked) ? 'inline-flex' : 'none';
        if (paidToggle) {
            paidToggle.disabled = !chargeToggle || !chargeToggle.checked;
            paidToggle.checked = !!(chargeToggle && chargeToggle.checked && srv.paid);
        }
    } else {
        modalTitle.textContent = '添加服务器';
    }

    renderSrvEditWebsites();
    switchSrvTab('info');
    document.getElementById('srv-modal').classList.remove('hidden');
    setTimeout(() => titleInput.focus(), 100);
}

// 切换服务器弹窗 Tab
function switchSrvTab(tabName) {
    const modal = document.getElementById('srv-modal');
    if (!modal) return;
    modal.querySelectorAll('.srv-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.srvTab === tabName);
    });
    modal.querySelectorAll('.srv-tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.dataset.srvPane === tabName);
    });
}

function closeSrvModal() {
    document.getElementById('srv-modal').classList.add('hidden');
    srvEditWebsites = [];
    editingSrvId = null;
}

// 编辑期间的临时网站列表
let srvEditWebsites = [];

function renderSrvEditWebsites() {
    const container = document.getElementById('srv-website-list');
    const emptyEl = document.getElementById('srv-website-empty');
    if (!container) return;
    container.innerHTML = '';

    if (srvEditWebsites.length === 0) {
        emptyEl.style.display = '';
        return;
    }
    emptyEl.style.display = 'none';

    srvEditWebsites.forEach((ws, idx) => {
        const item = document.createElement('div');
        item.className = 'srv-ws-edit-item';
        item.innerHTML = `
            <div class="srv-ws-edit-info">
                <span class="mi fa-regular fa-globe" style="font-size:14px;color:#10b981;"></span>
                <span class="srv-ws-edit-domain">${escapeHtml(ws.domain || '(未设置域名)')}</span>
            </div>
            <div class="srv-ws-edit-actions">
                ${ws.adminUrl ? `<a class="srv-ws-link" href="${escapeHtml(ws.adminUrl)}" target="_blank" title="打开后台" style="display:inline-flex;font-size:16px;color:#cbd5e1;text-decoration:none;"><span class="mi fa-regular fa-arrow-up-right-from-square" style="font-size:16px;"></span></a>` : ''}
                ${editingSrvId ? `<span class="mi srv-ws-edit-migrate fa-regular fa-arrow-right-arrow-left" data-idx="${idx}" title="迁移到其它服务器" style="font-size:16px;color:#cbd5e1;cursor:pointer;"></span>` : ''}
                <span class="mi srv-ws-edit-btn fa-regular fa-pen-to-square" data-idx="${idx}" title="编辑" style="font-size:16px;color:#cbd5e1;cursor:pointer;"></span>
                <i class="fa-regular fa-xmark srv-ws-edit-del" data-idx="${idx}" title="删除" style="font-size:16px;color:#cbd5e1;cursor:pointer;"></i>
            </div>
        `;
        item.querySelector('.srv-ws-edit-btn').addEventListener('click', function() {
            openSrvWebsiteModal(parseInt(this.dataset.idx));
        });
        const editMigrateBtn = item.querySelector('.srv-ws-edit-migrate');
        if (editMigrateBtn) {
            editMigrateBtn.addEventListener('click', function() {
                const idx = parseInt(this.dataset.idx);
                const ws = srvEditWebsites[idx];
                if (!ws || !editingSrvId) return;
                // 传入草稿下标：迁移后同步从草稿中移除
                openSrvMigrateModal(editingSrvId, ws, idx);
            });
        }
        item.querySelector('.srv-ws-edit-del').addEventListener('click', async function() {
            const wi = parseInt(this.dataset.idx);
            const w = srvEditWebsites[wi];
            if (await showConfirmDialog({ message: `确定删除网站「${w.domain || '未命名'}」？`, type: 'danger' })) {
                srvEditWebsites.splice(wi, 1);
                renderSrvEditWebsites();
            }
        });
        container.appendChild(item);
    });
}

// 填充网站模板下拉（从当前服务器的已有网站中收集）
function populateWsTemplateSelect() {
    const select = document.getElementById('srv-ws-template-select');
    const wrapper = document.getElementById('srv-ws-template-wrapper');
    if (!select || !wrapper) return;

    select.innerHTML = '<option value="">从同服务器站点复制配置...</option>';

    let count = 0;
    srvEditWebsites.forEach((ws, wi) => {
        const wsDomain = ws.domain || '(未命名)';
        const option = document.createElement('option');
        option.value = `${wi}`;
        option.textContent = wsDomain;
        select.appendChild(option);
        count++;
    });

    // 仅在有可选模板且当前为添加模式时显示
    const isAdding = editingWebsiteId === null || editingWebsiteId === undefined;
    wrapper.style.display = (count > 0 && isAdding) ? 'flex' : 'none';
}

// 历史记录下拉（网站账号/密码、服务器密码共用）
function populateSrvHistoryDD(ddId, values) {
    const dd = document.getElementById(ddId);
    if (!dd) return;
    dd.innerHTML = '';
    if (values.length === 0) {
        dd.innerHTML = '<div class="srv-history-empty">暂无历史记录</div>';
        return;
    }
    values.forEach(val => {
        const item = document.createElement('div');
        item.className = 'srv-history-item';
        item.textContent = val;
        item.addEventListener('mousedown', function(e) {
            e.preventDefault();
            const input = dd.parentElement.querySelector('input');
            if (input) {
                input.value = val;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            dd.classList.remove('show');
        });
        dd.appendChild(item);
    });
}

// === 网站子弹窗 ===
function openSrvWebsiteModal(editIdx) {
    editingWebsiteId = null;
    // 服务器弹窗内调用时重置独立模式
    if (!document.getElementById('srv-modal').classList.contains('hidden')) {
        srvWebsiteStandalone = false;
    }

    const domainInput = document.getElementById('srv-ws-domain-input');
    const dbTypeInput = document.getElementById('srv-ws-dbtype-input');
    const dbUserInput = document.getElementById('srv-ws-dbuser-input');
    const dbPassInput = document.getElementById('srv-ws-dbpass-input');
    const dbTableInput = document.getElementById('srv-ws-dbtable-input');
    const adminUrlInput = document.getElementById('srv-ws-adminurl-input');
    const wpToggle = document.getElementById('srv-ws-wp-toggle');
    const adminUserInput = document.getElementById('srv-ws-adminuser-input');
    const adminPassInput = document.getElementById('srv-ws-adminpass-input');
    const pathInput = document.getElementById('srv-ws-path-input');
    const deleteBtn = document.getElementById('srv-ws-delete-btn');
    const modalTitle = document.getElementById('srv-website-modal-title');

    // 重置
    domainInput.value = '';
    dbTypeInput.value = 'none';
    dbUserInput.value = '';
    dbPassInput.value = '';
    dbTableInput.value = '';
    adminUrlInput.value = '';
    wpToggle.checked = true;
    adminUrlInput.placeholder = '例如：https://example.com（自动追加 /wp-login.php）';
    adminUserInput.value = '';
    adminPassInput.value = '';
    pathInput.value = '';
    deleteBtn.classList.add('hidden');

    if (editIdx !== null && editIdx !== undefined && srvEditWebsites[editIdx]) {
        editingWebsiteId = editIdx;
        const ws = srvEditWebsites[editIdx];
        modalTitle.textContent = '编辑网站';
        domainInput.value = ws.domain || '';
        dbTypeInput.value = ws.dbType || 'none';
        dbUserInput.value = ws.dbUser || '';
        dbPassInput.value = ws.dbPass || '';
        dbTableInput.value = ws.dbTable || '';
        adminUrlInput.value = (ws.adminUrl || '').replace(/\/wp-login\.php$/, '');
        wpToggle.checked = (ws.adminUrl || '').endsWith('wp-login.php');
        if (!wpToggle.checked) adminUrlInput.placeholder = '例如：/admin';
        adminUserInput.value = ws.adminUser || '';
        adminPassInput.value = ws.adminPass || '';
        pathInput.value = ws.path || '';
        deleteBtn.classList.remove('hidden');
    } else {
        modalTitle.textContent = '添加网站';
    }

    // 收集所有服务器的网站账号/密码历史作为下拉 suggestion
    const userHistory = [...new Set(
        myServers.flatMap(s => (s.websites || []).map(w => w.adminUser).filter(Boolean))
    )];
    const passHistory = [...new Set(
        myServers.flatMap(s => (s.websites || []).map(w => w.adminPass).filter(Boolean))
    )];

    // 填充自定义下拉
    populateSrvHistoryDD('srv-user-history-dd', userHistory);
    populateSrvHistoryDD('srv-pass-history-dd', passHistory);

    // 绑定显示/隐藏事件（同一个弹窗只绑一次）
    if (!adminUserInput.dataset.historyBound) {
        adminUserInput.dataset.historyBound = '1';
        adminUserInput.addEventListener('focus', function() {
            const dd = document.getElementById('srv-user-history-dd');
            if (dd) dd.classList.add('show');
        });
        adminPassInput.addEventListener('focus', function() {
            const dd = document.getElementById('srv-pass-history-dd');
            if (dd) dd.classList.add('show');
        });
    }

    document.getElementById('srv-website-modal').classList.remove('hidden');
    // 填充网站模板下拉（依赖 editingWebsiteId 判断添加/编辑模式）
    populateWsTemplateSelect();
    setTimeout(() => domainInput.focus(), 100);
}

function closeSrvWebsiteModal() {
    document.getElementById('srv-website-modal').classList.add('hidden');
    editingWebsiteId = null;
    srvWebsiteStandalone = false;
}

// === 网站迁移（迁移到其它服务器） ===
// 打开迁移弹窗：列出除源服务器外的所有现有服务器
function openSrvMigrateModal(sourceSrvId, ws, draftIdx) {
    const modal = document.getElementById('srv-migrate-modal');
    if (!modal || !ws) return;

    const candidates = myServers.filter(s => s && String(s.id) !== String(sourceSrvId));
    if (candidates.length === 0) {
        showToast('没有其它服务器，请先添加服务器');
        return;
    }

    srvMigrateCtx = {
        sourceId: sourceSrvId,
        ws: ws,
        draftIdx: (typeof draftIdx === 'number' ? draftIdx : null)
    };
    srvMigrateTargetId = null;

    const domainEl = document.getElementById('srv-migrate-domain');
    if (domainEl) domainEl.textContent = ws.domain || '(未设置域名)';

    const listEl = document.getElementById('srv-migrate-list');
    const emptyEl = document.getElementById('srv-migrate-empty');
    if (listEl) {
        listEl.innerHTML = candidates.map(srv => {
            const osMeta = SRV_OS_ICONS[srv.os] || SRV_OS_ICONS.Other;
            const ip = (srv.ip || '').trim();
            const count = (srv.websites || []).length;
            const meta = (ip ? ip + ' · ' : '') + `${count} 个网站`;
            return `<div class="srv-migrate-item" data-id="${escapeHtml(String(srv.id))}" role="option" aria-selected="false" tabindex="0">
                <span class="mi ${osMeta.icon}" style="font-size:16px;color:${osMeta.color};flex-shrink:0;"></span>
                <div class="srv-migrate-info">
                    <span class="srv-migrate-name">${escapeHtml(srvDisplayName(srv))}</span>
                    <span class="srv-migrate-meta">${escapeHtml(meta)}</span>
                </div>
                <span class="mi fa-regular fa-circle-check srv-migrate-check"></span>
            </div>`;
        }).join('');
        listEl.scrollTop = 0;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    const confirmBtn = document.getElementById('srv-migrate-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = true;

    modal.classList.remove('hidden');
}

function closeSrvMigrateModal() {
    const modal = document.getElementById('srv-migrate-modal');
    if (modal) modal.classList.add('hidden');
    srvMigrateCtx = null;
    srvMigrateTargetId = null;
}

// 选中目标服务器（未选中时不可提交）
function selectSrvMigrateTarget(idStr) {
    const listEl = document.getElementById('srv-migrate-list');
    if (!listEl) return;
    listEl.querySelectorAll('.srv-migrate-item').forEach(el => {
        const active = el.dataset.id === String(idStr);
        el.classList.toggle('active', active);
        el.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    srvMigrateTargetId = idStr;
    const confirmBtn = document.getElementById('srv-migrate-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = !idStr;
}

// 真正移动网站：写入目标服务器、从源服务器移除、同步弹窗草稿并持久化
function moveWebsiteToServer(ctx, target) {
    if (!ctx || !target) return null;
    const source = myServers.find(s => String(s.id) === String(ctx.sourceId));
    if (!source) return null;

    const originId = ctx.ws ? ctx.ws.id : undefined;
    const moved = { ...ctx.ws };

    if (!Array.isArray(target.websites)) target.websites = [];
    // 目标服务器已有同 id 记录时重新生成，避免两条网站共用同一个 id
    if (!moved.id || target.websites.some(w => w && w.id === moved.id)) {
        moved.id = Date.now() + Math.random();
    }
    target.websites.push(moved);

    // 从源服务器已保存的数据中移除（草稿里新增、尚未保存的网站不在其中）
    if (Array.isArray(source.websites)) {
        let si = -1;
        if (originId !== undefined && originId !== null) {
            si = source.websites.findIndex(w => w && w.id === originId);
        }
        if (si === -1) si = source.websites.findIndex(w => w === ctx.ws);
        // 列表来自草稿副本、且网站没有 id 时，才按域名回退匹配
        if (si === -1 && (originId === undefined || originId === null) && moved.domain) {
            si = source.websites.findIndex(w => w && (w.domain || '') === (moved.domain || ''));
        }
        if (si !== -1) source.websites.splice(si, 1);
    }

    // 服务器弹窗的编辑草稿同步移除，保存时不会把已迁走的网站再写回源服务器
    if (typeof ctx.draftIdx === 'number' && srvEditWebsites[ctx.draftIdx]) {
        srvEditWebsites.splice(ctx.draftIdx, 1);
    }

    saveServers();
    return moved;
}

function confirmSrvMigrate() {
    if (!srvMigrateCtx || !srvMigrateTargetId) return;
    const ctx = srvMigrateCtx;
    const target = myServers.find(s => String(s.id) === String(srvMigrateTargetId));
    if (!target) {
        closeSrvMigrateModal();
        showToast('目标服务器已不存在');
        return;
    }

    const moved = moveWebsiteToServer(ctx, target);
    if (!moved) {
        closeSrvMigrateModal();
        showToast('迁移失败：源服务器已不存在');
        return;
    }

    const targetName = srvDisplayName(target);
    closeSrvMigrateModal();
    renderServers();
    // 服务器弹窗还开着时同步刷新「绑定网站」列表
    const srvModalEl = document.getElementById('srv-modal');
    if (typeof ctx.draftIdx === 'number' && srvModalEl && !srvModalEl.classList.contains('hidden')) {
        renderSrvEditWebsites();
    }
    showToast(`已将「${moved.domain || '网站'}」迁移到「${targetName}」`);
}

// === 导出 ===
function exportServers() {
    if (!myServers || myServers.length === 0) {
        showToast('没有可导出的服务器');
        return;
    }
    const data = myServers.map(s => ({
        title: s.title,
        os: s.os,
        protocol: s.protocol,
        ip: s.ip,
        port: s.port,
        username: s.username,
        password: s.password,
        providerUrl: s.providerUrl,
        note: s.note,
        panelType: s.panelType,
        panelUrl: s.panelUrl,
        panelUser: s.panelUser,
        panelPass: s.panelPass,
        autoLogin: !!s.autoLogin,
        isCharged: s.isCharged,
        chargeFee: s.chargeFee,
        paid: s.paid,
        websites: (s.websites || []).map(w => ({
            domain: w.domain,
            dbType: w.dbType,
            dbUser: w.dbUser,
            dbPass: w.dbPass,
            dbTable: w.dbTable,
            adminUrl: w.adminUrl,
            adminUser: w.adminUser,
            adminPass: w.adminPass,
            path: w.path
        }))
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meow_servers_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`已导出 ${data.length} 个服务器`);
}

// === 导入 ===
function importServers() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                const imported = JSON.parse(ev.target.result);
                if (!Array.isArray(imported)) { showToast('文件格式错误'); return; }
                imported.forEach(s => {
                    myServers.push({
                        id: Date.now() + Math.random(),
                        title: s.title || '',
                        os: s.os || 'Ubuntu',
                        protocol: s.protocol || 'ssh',
                        ip: s.ip || '',
                        port: s.port || '',
                        username: s.username || '',
                        password: s.password || '',
                        providerUrl: s.providerUrl || '',
                        note: s.note || '',
                        panelType: s.panelType || 'none',
                        panelUrl: s.panelUrl || '',
                        panelUser: s.panelUser || '',
                        panelPass: s.panelPass || '',
                        autoLogin: !!s.autoLogin,
                        isCharged: !!s.isCharged,
                        chargeFee: (s.chargeFee !== undefined && s.chargeFee !== null && s.chargeFee !== '') ? s.chargeFee : 18,
                        paid: !!s.paid,
                        websites: Array.isArray(s.websites) ? s.websites.map(w => ({
                            id: Date.now() + Math.random(),
                            domain: w.domain || '',
                            dbType: w.dbType || 'none',
                            dbUser: w.dbUser || '',
                            dbPass: w.dbPass || '',
                            adminUrl: w.adminUrl || '',
                            adminUser: w.adminUser || '',
                            adminPass: w.adminPass || '',
                            path: w.path || ''
                        })) : []
                    });
                });
                saveServers();
                renderServers();
                showToast(`已导入 ${imported.length} 个服务器`);
            } catch (err) {
                showToast('导入失败：文件格式错误');
            }
        };
        reader.readAsText(file);
    });
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
}

// === 初始化逻辑 ===
function setupServerLogic() {
    const srvList = document.getElementById('srv-list');
    if (!srvList) return;

    // 加载数据
    (async () => {
        try {
            const localData = await chrome.storage.local.get(['meow_servers', 'meow_server_charge_filter']);
            myServers = localData.meow_servers || [];
            srvChargeFilter = localData.meow_server_charge_filter || '';
        } catch (e) {
            console.error('Server load error:', e);
            myServers = [];
        }
        renderServers();
    })();

    // 加载分类
    (async () => {
        await loadSrvCategories();
        renderSrvCatTabs();
        renderServers();
    })();

    // 添加按钮
    document.getElementById('srv-add-btn').addEventListener('click', function() { openSrvModal(null); });
    // 导出/导入
    document.getElementById('srv-export-btn').addEventListener('click', exportServers);
    document.getElementById('srv-import-btn').addEventListener('click', importServers);

    // 关闭服务器弹窗（仅通过关闭按钮关闭，点击遮罩不关闭且不丢失焦点）
    document.getElementById('close-srv-modal').addEventListener('click', closeSrvModal);
    const srvModal = document.getElementById('srv-modal');
    srvModal.addEventListener('mousedown', function(e) { if (e.target === srvModal) e.preventDefault(); });

    // Tab 切换
    srvModal.querySelectorAll('.srv-tab').forEach(tabBtn => {
        tabBtn.addEventListener('click', function() {
            switchSrvTab(this.dataset.srvTab);
        });
    });

    // 是否收费开关：控制收费金额输入框显隐 + 已收款开关可用性
    const chargeToggleEl = document.getElementById('srv-charge-toggle');
    const chargeFeeGroupEl = document.getElementById('srv-charge-fee-group');
    const paidToggleEl = document.getElementById('srv-paid-toggle');
    if (chargeToggleEl && paidToggleEl) {
        chargeToggleEl.addEventListener('change', function() {
            const on = this.checked;
            if (chargeFeeGroupEl) chargeFeeGroupEl.style.display = on ? 'inline-flex' : 'none';
            paidToggleEl.disabled = !on;
            if (!on) paidToggleEl.checked = false;
            if (on) {
                const feeInput = document.getElementById('srv-charge-fee-input');
                if (feeInput && !feeInput.value) feeInput.value = '18';
            }
        });
    }

    // 在服务器弹窗中粘贴服务器信息时自动解析填写
    srvModal.addEventListener('paste', function(e) {
        if (srvModal.classList.contains('hidden')) return;

        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text || !/Main IP\s*:/i.test(text)) return; // 非服务器信息格式，放行默认粘贴

        e.preventDefault();

        const lines = text.split(/\r?\n/);
        let ip = '', username = '', password = '', port = '';
        let domain = '';

        lines.forEach(line => {
            line = line.trim();
            if (!line) return;

            // 解析 Key: Value 格式
            const m = line.match(/^([^:]+)\s*:\s*(.+)$/);
            if (m) {
                const key = m[1].trim().toLowerCase();
                const val = m[2].trim();
                if (key === 'main ip') ip = val;
                else if (key === 'username') username = val;
                else if (key === 'password') password = val;
                else if (key === 'ssh port') port = val;
                return;
            }

            // 非键值行：检查是否为域名（含点、TLD为纯字母、非IP地址）
            if (/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(line) && !/^\d+\.\d+\.\d+\.\d+$/.test(line)) {
                domain = line;
            }
        });

        if (ip) document.getElementById('srv-ip-input').value = ip;
        if (username) document.getElementById('srv-user-input').value = username;
        if (password) document.getElementById('srv-pass-input').value = password;
        if (port) document.getElementById('srv-port-input').value = port;

        // 面板类型设为 CyberPanel，并自动填充面板地址和账号（复用已有逻辑）
        document.getElementById('srv-panel-type-input').value = 'cyberpanel';
        if (ip) {
            document.getElementById('srv-panel-url-input').value = `https://${ip}:8090`;
            document.getElementById('srv-panel-user-input').value = 'admin';
        }

        if (domain) {
            srvEditWebsites.push({
                domain: domain,
                dbType: 'mariadb',
                dbUser: getDefaultDbUsername('mariadb'),          // root
                dbPass: '',
                dbTable: domain.replace(/\./g, '_'),               // 域名 . 替换为 _
                adminUrl: `https://${domain}`,                     // 后台地址
                adminUser: '',
                adminPass: '',
                path: `/home/${domain}/public_html`                // CyberPanel 绝对路径
            });
            renderSrvEditWebsites();
            switchSrvTab('websites');
        }

        showToast('已自动填写服务器信息' + (domain ? '并添加网站' : ''));
    });

    // 保存服务器
    document.getElementById('srv-save-btn').addEventListener('click', function() {
        const title = document.getElementById('srv-title-input').value.trim();
        const os = document.getElementById('srv-os-input').value;
        const protocol = document.getElementById('srv-protocol-input').value;
        const ip = document.getElementById('srv-ip-input').value.trim();
        const port = document.getElementById('srv-port-input').value.trim();
        const username = document.getElementById('srv-user-input').value.trim();
        const password = document.getElementById('srv-pass-input').value;
        const providerUrl = document.getElementById('srv-provider-url-input').value.trim();
        const note = document.getElementById('srv-note-input').value.trim();
        const panelType = document.getElementById('srv-panel-type-input').value;
        const panelUrl = document.getElementById('srv-panel-url-input').value.trim();
        const panelUser = document.getElementById('srv-panel-user-input').value.trim();
        const panelPass = document.getElementById('srv-panel-pass-input').value;
        const chargeToggleSave = document.getElementById('srv-charge-toggle');
        const chargeFeeSave = document.getElementById('srv-charge-fee-input');
        const isCharged = !!(chargeToggleSave && chargeToggleSave.checked);
        const chargeFee = isCharged
            ? (parseFloat(chargeFeeSave ? chargeFeeSave.value : '') || 18)
            : 0;
        const paidToggleSave = document.getElementById('srv-paid-toggle');
        const paid = isCharged && !!(paidToggleSave && paidToggleSave.checked);

        if (!ip) { showToast('IP 地址不能为空'); document.getElementById('srv-ip-input').focus(); return; }

        const serverData = {
            title, os, protocol, ip, port, username, password,
            providerUrl, note,
            panelType, panelUrl, panelUser, panelPass,
            isCharged, chargeFee, paid,
            categoryId: document.getElementById('srv-category-input').value,
            websites: srvEditWebsites
        };

        if (editingSrvId) {
            const idx = myServers.findIndex(s => s.id === editingSrvId);
            if (idx !== -1) {
                Object.assign(myServers[idx], serverData);
                showToast('已更新');
            }
        } else {
            myServers.push({ id: Date.now(), ...serverData });
            showToast('已添加');
        }
        saveServers();
        renderServers();
        closeSrvModal();
    });

    // 服务器密码历史下拉：聚焦时列出所有已保存服务器的密码
    const srvPassInputEl = document.getElementById('srv-pass-input');
    const srvPassHistoryDd = document.getElementById('srv-pass-history-dd-srv');
    if (srvPassInputEl && srvPassHistoryDd) {
        srvPassInputEl.addEventListener('focus', function() {
            const passHistory = [...new Set(
                myServers.map(s => s.password).filter(Boolean)
            )];
            populateSrvHistoryDD('srv-pass-history-dd-srv', passHistory);
            srvPassHistoryDd.classList.add('show');
        });
    }

    // 点击输入框外部时关闭历史下拉
    document.addEventListener('mousedown', function(e) {
        if (!e.target.closest('.srv-input-wrap')) {
            document.querySelectorAll('.srv-history-dd').forEach(dd => dd.classList.remove('show'));
        }
    });

    // 面板输入框复制按钮
    document.querySelectorAll('.srv-icopy-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const targetId = this.dataset.copyTarget;
            if (!targetId) return;
            const input = document.getElementById(targetId);
            if (!input) return;
            const val = input.value;
            if (!val) { showToast('内容为空'); return; }
            copyToClipboard(val);
        });
    });

    // 面板地址打开链接按钮
    document.querySelectorAll('[data-open-url]').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const targetId = this.dataset.openUrl;
            if (!targetId) return;
            const input = document.getElementById(targetId);
            if (!input) return;
            let url = input.value.trim();
            if (!url) { showToast('面板地址为空'); return; }
            if (!/^https?:\/\//i.test(url)) {
                url = 'https://' + url;
            }
            window.open(url, '_blank');
        });
    });

    // 删除服务器（弹窗内）
    document.getElementById('srv-delete-btn').addEventListener('click', async function() {
        if (!editingSrvId) return;
        if (await showConfirmDialog({ message: '确定删除此服务器及其所有网站记录？', type: 'danger' })) {
            myServers = myServers.filter(s => s.id !== editingSrvId);
            saveServers();
            renderServers();
            closeSrvModal();
            showToast('已删除');
        }
    });

    // 操作系统变更：自动填充默认用户名 + 协议联动
    document.getElementById('srv-os-input').addEventListener('change', function() {
        const currentOs = this.value;
        // 1. 自动填充用户名（仅在用户名为空或为其他OS默认值时）
        const userInputEl = document.getElementById('srv-user-input');
        const currentVal = userInputEl.value.trim();
        if (!currentVal || currentVal === 'administrator' || currentVal === 'root') {
            userInputEl.value = getDefaultUsername(currentOs);
        }
        // 2. 非 Windows 选了 RDP，自动切回 SSH
        const protocolSelect = document.getElementById('srv-protocol-input');
        if (currentOs !== 'Windows' && protocolSelect.value === 'rdp') {
            protocolSelect.value = 'ssh';
        }
    });

    // 协议变更：自动填充默认端口
    const defaultPorts = { ssh: '22', rdp: '3389', vnc: '5900', other: '' };
    document.getElementById('srv-protocol-input').addEventListener('change', function() {
        const portInputEl = document.getElementById('srv-port-input');
        const currentVal = portInputEl.value.trim();
        const defaultPort = defaultPorts[this.value] || '';
        // 仅在端口为空或为其他协议的默认值时自动填充
        if (!currentVal || Object.values(defaultPorts).includes(currentVal)) {
            portInputEl.value = defaultPort;
        }
    });

    // 面板类型变更：Cyberpanel/CloudPanel 自动填充面板地址和账号
    document.getElementById('srv-panel-type-input').addEventListener('change', function() {
        const panelType = this.value;
        if (panelType === 'cyberpanel' || panelType === 'cloudpanel') {
            const ip = document.getElementById('srv-ip-input').value.trim();
            const port = panelType === 'cyberpanel' ? '8090' : '8443';
            if (ip) {
                document.getElementById('srv-panel-url-input').value = `https://${ip}:${port}`;
                document.getElementById('srv-panel-user-input').value = 'admin';
            }
        }
    });

    // IP 地址变更：Cyberpanel/CloudPanel 时自动更新面板地址
    document.getElementById('srv-ip-input').addEventListener('input', function() {
        const panelType = document.getElementById('srv-panel-type-input').value;
        if (panelType === 'cyberpanel' || panelType === 'cloudpanel') {
            const ip = this.value.trim();
            const port = panelType === 'cyberpanel' ? '8090' : '8443';
            if (ip) {
                document.getElementById('srv-panel-url-input').value = `https://${ip}:${port}`;
            }
        }
    });

    // 添加网站按钮
    document.getElementById('srv-add-website-btn').addEventListener('click', function() {
        openSrvWebsiteModal(null);
    });

    // 关闭网站子弹窗（仅通过关闭按钮关闭，点击遮罩不关闭且不丢失焦点）
    document.getElementById('close-srv-website-modal').addEventListener('click', closeSrvWebsiteModal);
    const wsModal = document.getElementById('srv-website-modal');
    wsModal.addEventListener('mousedown', function(e) { if (e.target === wsModal) e.preventDefault(); });

    // === 网站迁移弹窗 ===
    const migrateModal = document.getElementById('srv-migrate-modal');
    if (migrateModal) {
        document.getElementById('close-srv-migrate-modal').addEventListener('click', closeSrvMigrateModal);
        document.getElementById('srv-migrate-cancel-btn').addEventListener('click', closeSrvMigrateModal);
        document.getElementById('srv-migrate-confirm-btn').addEventListener('click', confirmSrvMigrate);
        // 无输入内容，点遮罩可直接关闭
        migrateModal.addEventListener('click', function(e) { if (e.target === migrateModal) closeSrvMigrateModal(); });

        const migrateList = document.getElementById('srv-migrate-list');
        if (migrateList) {
            migrateList.addEventListener('click', function(e) {
                const item = e.target.closest('.srv-migrate-item');
                if (!item) return;
                selectSrvMigrateTarget(item.dataset.id);
            });
            migrateList.addEventListener('keydown', function(e) {
                const item = e.target.closest('.srv-migrate-item');
                if (!item) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectSrvMigrateTarget(item.dataset.id);
                }
            });
            // 双击目标服务器直接完成迁移
            migrateList.addEventListener('dblclick', function(e) {
                const item = e.target.closest('.srv-migrate-item');
                if (!item) return;
                selectSrvMigrateTarget(item.dataset.id);
                confirmSrvMigrate();
            });
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && !migrateModal.classList.contains('hidden')) {
                closeSrvMigrateModal();
            }
        });
    }

    // 网站模板选择：从同服务器已有站点复制配置
    document.getElementById('srv-ws-template-select').addEventListener('change', function() {
        const val = this.value;
        if (!val) return;
        const wi = parseInt(val);
        const ws = srvEditWebsites[wi];
        if (!ws) return;

        // 填充所有字段（含域名，方便用户参考后修改）
        const domainInputEl = document.getElementById('srv-ws-domain-input');
        const dbTypeInputEl = document.getElementById('srv-ws-dbtype-input');
        const dbUserInputEl = document.getElementById('srv-ws-dbuser-input');
        const dbPassInputEl = document.getElementById('srv-ws-dbpass-input');
        const dbTableInputEl = document.getElementById('srv-ws-dbtable-input');
        const adminUrlInputEl = document.getElementById('srv-ws-adminurl-input');
        const wpToggleEl = document.getElementById('srv-ws-wp-toggle');
        const adminUserInputEl = document.getElementById('srv-ws-adminuser-input');
        const adminPassInputEl = document.getElementById('srv-ws-adminpass-input');
        const pathInputEl = document.getElementById('srv-ws-path-input');

        domainInputEl.value = ws.domain || '';
        dbTypeInputEl.value = ws.dbType || 'none';
        dbUserInputEl.value = ws.dbUser || '';
        dbPassInputEl.value = ws.dbPass || '';
        dbTableInputEl.value = ws.dbTable || '';

        adminUrlInputEl.value = (ws.adminUrl || '').replace(/\/wp-login\.php$/, '');
        wpToggleEl.checked = (ws.adminUrl || '').endsWith('wp-login.php');
        adminUrlInputEl.placeholder = wpToggleEl.checked
            ? '例如：https://example.com（自动追加 /wp-login.php）'
            : '例如：/admin';

        adminUserInputEl.value = ws.adminUser || '';
        adminPassInputEl.value = ws.adminPass || '';
        pathInputEl.value = ws.path || '';

        // 聚焦域名输入框并全选，方便用户直接输入新域名
        setTimeout(() => {
            domainInputEl.focus();
            domainInputEl.select();
        }, 50);

        // 重置下拉到占位符
        this.value = '';
        showToast('已套用站点模板，请修改域名');
    });

    // 数据库类型变更时自动填充默认数据库用户名
    document.getElementById('srv-ws-dbtype-input').addEventListener('change', function() {
        const dbUserInput = document.getElementById('srv-ws-dbuser-input');
        const currentDbType = this.value;
        const currentVal = dbUserInput.value.trim();
        if (currentDbType === 'none') return;
        if (!currentVal || currentVal === 'sa' || currentVal === 'root') {
            dbUserInput.value = getDefaultDbUsername(currentDbType);
        }
    });

    // WP 开关切换时更新 placeholder
    const wpToggleInit = document.getElementById('srv-ws-wp-toggle');
    const adminUrlInputInit = document.getElementById('srv-ws-adminurl-input');
    wpToggleInit.addEventListener('change', function() {
        adminUrlInputInit.placeholder = this.checked
            ? '例如：https://example.com（自动追加 /wp-login.php）'
            : '例如：/admin';
    });

    // 域名输入联动：自动填充后台地址、数据库名、绝对路径
    document.getElementById('srv-ws-domain-input').addEventListener('input', function() {
        const domain = this.value.trim();
        if (!domain) return;

        // 后台地址自动填入 https://域名
        document.getElementById('srv-ws-adminurl-input').value = `https://${domain}`;

        // 数据库名：域名中 . 替换为 _
        document.getElementById('srv-ws-dbtable-input').value = domain.replace(/\./g, '_');

        // 获取当前服务器面板类型（服务器弹窗打开中 或 独立编辑模式）
        let panelType = 'none';
        const srvModalEl = document.getElementById('srv-modal');
        if (srvModalEl && !srvModalEl.classList.contains('hidden')) {
            panelType = document.getElementById('srv-panel-type-input').value;
        } else if (editingSrvId) {
            const srv = myServers.find(s => s.id === editingSrvId);
            if (srv) panelType = srv.panelType || 'none';
        }

        // Cyberpanel 面板：绝对路径填入 /home/域名/public_html
        // CloudPanel 面板：绝对路径填入 /home/域名/htdocs
        if (panelType === 'cyberpanel') {
            document.getElementById('srv-ws-path-input').value = `/home/${domain}/public_html`;
        } else if (panelType === 'cloudpanel') {
            document.getElementById('srv-ws-path-input').value = `/home/${domain}/htdocs`;
        }
    });

    // 保存网站
    document.getElementById('srv-ws-save-btn').addEventListener('click', function() {
        const domain = document.getElementById('srv-ws-domain-input').value.trim();
        const dbType = document.getElementById('srv-ws-dbtype-input').value;
        const dbUser = document.getElementById('srv-ws-dbuser-input').value.trim();
        const dbPass = document.getElementById('srv-ws-dbpass-input').value;
        const dbTable = document.getElementById('srv-ws-dbtable-input').value.trim();
        const wpChecked = document.getElementById('srv-ws-wp-toggle').checked;
        let adminUrl = document.getElementById('srv-ws-adminurl-input').value.trim();
        // WP 开关：打开时自动追加 wp-login.php，关闭时去除
        if (wpChecked) {
            if (adminUrl && !adminUrl.endsWith('wp-login.php')) {
                adminUrl = adminUrl.replace(/\/+$/, '') + '/wp-login.php';
            }
        } else {
            adminUrl = adminUrl.replace(/\/wp-login\.php$/, '');
        }
        const adminUser = document.getElementById('srv-ws-adminuser-input').value.trim();
        const adminPass = document.getElementById('srv-ws-adminpass-input').value;
        const path = document.getElementById('srv-ws-path-input').value.trim();

        const wsData = { domain, dbType, dbUser, dbPass, dbTable, adminUrl, adminUser, adminPass, path };

        if (editingWebsiteId !== null && editingWebsiteId !== undefined) {
            srvEditWebsites[editingWebsiteId] = { ...srvEditWebsites[editingWebsiteId], ...wsData };
        } else {
            srvEditWebsites.push({ id: Date.now() + Math.random(), ...wsData });
        }

        if (srvWebsiteStandalone) {
            // 独立模式：直接写入服务器数据并持久化
            const idx = myServers.findIndex(s => s.id === editingSrvId);
            if (idx !== -1) {
                myServers[idx].websites = srvEditWebsites;
                saveServers();
                renderServers();
            }
        } else {
            renderSrvEditWebsites();
        }
        closeSrvWebsiteModal();
    });

    // 删除网站（子弹窗内）
    document.getElementById('srv-ws-delete-btn').addEventListener('click', async function() {
        if (editingWebsiteId === null || editingWebsiteId === undefined) return;
        const ws = srvEditWebsites[editingWebsiteId];
        if (await showConfirmDialog({ message: `确定删除网站「${ws.domain || '未命名'}」？`, type: 'danger' })) {
            srvEditWebsites.splice(editingWebsiteId, 1);
            if (srvWebsiteStandalone) {
                const idx = myServers.findIndex(s => s.id === editingSrvId);
                if (idx !== -1) {
                    myServers[idx].websites = srvEditWebsites;
                    saveServers();
                    renderServers();
                }
            } else {
                renderSrvEditWebsites();
            }
            closeSrvWebsiteModal();
        }
    });

    // 过滤
    const filterInput = document.getElementById('srv-filter-input');
    const filterClear = document.getElementById('srv-filter-clear');

    filterInput.addEventListener('input', function() {
        filterClear.style.display = this.value ? '' : 'none';
        renderServers();
    });

    filterClear.addEventListener('click', function() {
        filterInput.value = '';
        filterInput.focus();
        filterClear.style.display = 'none';
        renderServers();
    });

    // Escape 键清空搜索
    filterInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            filterInput.value = '';
            filterClear.style.display = 'none';
            renderServers();
        }
    });

    // === 记事本：多记事本管理 ===
    let srvNotebooks = [];          // [{ id, name, content, updatedAt }]
    let srvActiveNotebookId = '';
    let srvNotebookMenuEl = null;

    function genSrvNotebookId() {
        return 'nb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    }
    function saveSrvNotebooks() {
        chrome.storage.local.set({ 'meow_srv_notebooks': srvNotebooks });
    }
    function getActiveSrvNotebook() {
        return srvNotebooks.find(n => n.id === srvActiveNotebookId) || null;
    }
    function countSrvNotebookLines(content) {
        return content ? content.split('\n').length : 0;
    }
    function persistActiveSrvNotebook() {
        chrome.storage.local.set({ 'meow_srv_active_notebook': srvActiveNotebookId });
    }

    async function loadSrvNotebooks() {
        try {
            const data = await chrome.storage.local.get(['meow_srv_notebooks', 'meow_srv_active_notebook', 'meow_srv_commands']);
            if (Array.isArray(data.meow_srv_notebooks)) {
                srvNotebooks = data.meow_srv_notebooks
                    .filter(n => n && typeof n === 'object')
                    .map(n => ({
                        id: String(n.id || genSrvNotebookId()),
                        name: String(n.name || '未命名记事本'),
                        content: typeof n.content === 'string' ? n.content : '',
                        updatedAt: Number(n.updatedAt) || Date.now()
                    }));
            } else {
                // 首次使用：把旧的单一记录迁移为「我的记事本」
                const legacy = typeof data.meow_srv_commands === 'string' ? data.meow_srv_commands : '';
                srvNotebooks = [{
                    id: genSrvNotebookId(),
                    name: '我的记事本',
                    content: legacy,
                    updatedAt: Date.now()
                }];
                saveSrvNotebooks();
                if (legacy) chrome.storage.local.remove('meow_srv_commands');
            }
            const storedActive = data.meow_srv_active_notebook;
            srvActiveNotebookId = srvNotebooks.some(n => n.id === storedActive)
                ? storedActive
                : (srvNotebooks[0] ? srvNotebooks[0].id : '');
            renderSrvNotebook();
        } catch (e) {
            console.error('加载记事本失败:', e);
            srvNotebooks = [];
            srvActiveNotebookId = '';
            renderSrvNotebook();
        }
    }

    function renderSrvNotebook() {
        const nameEl = document.getElementById('srv-nb-current-name');
        const textarea = document.getElementById('srv-commands-textarea');
        const emptyEl = document.getElementById('srv-nb-empty');
        const metaEl = document.getElementById('srv-nb-meta');
        const selectBtn = document.getElementById('srv-nb-select-btn');
        const renameBtn = document.getElementById('srv-nb-rename-btn');
        const delBtn = document.getElementById('srv-nb-del-btn');
        if (!nameEl || !textarea || !emptyEl || !metaEl) return;

        const current = getActiveSrvNotebook();
        const hasNotebook = !!current;
        nameEl.textContent = hasNotebook ? current.name : '暂无记事本';
        nameEl.classList.toggle('srv-nb-placeholder', !hasNotebook);
        selectBtn.disabled = !hasNotebook;
        renameBtn.disabled = !hasNotebook;
        delBtn.disabled = !hasNotebook;
        textarea.classList.toggle('hidden', !hasNotebook);
        emptyEl.classList.toggle('hidden', hasNotebook);

        if (hasNotebook) {
            if (textarea.value !== current.content) textarea.value = current.content;
            metaEl.textContent = countSrvNotebookLines(current.content) + ' 行';
        } else {
            textarea.value = '';
            metaEl.textContent = '0 行';
        }
        closeSrvNotebookMenu();
    }

    function closeSrvNotebookMenu() {
        if (srvNotebookMenuEl) {
            srvNotebookMenuEl.remove();
            srvNotebookMenuEl = null;
        }
        const btn = document.getElementById('srv-nb-select-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onDocClickSrvNotebookMenu);
        document.removeEventListener('keydown', onDocKeySrvNotebookMenu);
    }
    function onDocClickSrvNotebookMenu(e) {
        if (!srvNotebookMenuEl) return;
        if (srvNotebookMenuEl.contains(e.target)) return;
        if (e.target.closest && e.target.closest('#srv-nb-select-btn')) return;
        closeSrvNotebookMenu();
    }
    function onDocKeySrvNotebookMenu(e) {
        if (e.key === 'Escape' && srvNotebookMenuEl) {
            e.stopPropagation();
            closeSrvNotebookMenu();
        }
    }

    function openSrvNotebookMenu() {
        if (srvNotebookMenuEl) { closeSrvNotebookMenu(); return; }
        if (srvNotebooks.length === 0) return;

        const menu = document.createElement('div');
        menu.className = 'srv-nb-menu';
        menu.setAttribute('role', 'listbox');
        menu.innerHTML = srvNotebooks.map(n => {
            const active = n.id === srvActiveNotebookId;
            return `<div class="srv-nb-menu-item${active ? ' active' : ''}" data-id="${escapeHtml(n.id)}" role="option" aria-selected="${active}">
                <span class="mi fa-regular fa-check srv-nb-menu-check" style="${active ? '' : 'visibility:hidden;'}"></span>
                <span class="srv-nb-menu-name">${escapeHtml(n.name)}</span>
                <span class="srv-nb-menu-count">${countSrvNotebookLines(n.content)} 行</span>
            </div>`;
        }).join('');

        menu.addEventListener('click', function(e) {
            const item = e.target.closest('.srv-nb-menu-item');
            if (!item) return;
            selectSrvNotebook(item.dataset.id);
        });

        document.body.appendChild(menu);
        const rect = document.getElementById('srv-nb-select-btn').getBoundingClientRect();
        menu.style.width = Math.max(Math.min(rect.width, 320), 160) + 'px';
        menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
        let top = rect.bottom + 4;
        if (top + menu.offsetHeight > window.innerHeight - 8) {
            top = Math.max(8, rect.top - menu.offsetHeight - 4);
        }
        menu.style.top = top + 'px';

        const activeEl = menu.querySelector('.srv-nb-menu-item.active');
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });

        srvNotebookMenuEl = menu;
        document.getElementById('srv-nb-select-btn').setAttribute('aria-expanded', 'true');
        setTimeout(() => {
            document.addEventListener('click', onDocClickSrvNotebookMenu);
            document.addEventListener('keydown', onDocKeySrvNotebookMenu);
        }, 0);
    }

    function selectSrvNotebook(id) {
        if (!srvNotebooks.some(n => n.id === id)) return;
        srvActiveNotebookId = id;
        persistActiveSrvNotebook();
        renderSrvNotebook();
        const textarea = document.getElementById('srv-commands-textarea');
        if (textarea) textarea.focus();
    }

    async function addSrvNotebook() {
        const input = await showPromptDialog({ title: '新建记事本', placeholder: '输入记事本名称', confirmText: '创建' });
        if (input === null) return;
        const name = input.trim();
        if (!name) { showToast('记事本名称不能为空'); return; }
        if (srvNotebooks.some(n => n.name === name)) { showToast('已存在同名记事本'); return; }

        const nb = { id: genSrvNotebookId(), name, content: '', updatedAt: Date.now() };
        srvNotebooks.push(nb);
        srvActiveNotebookId = nb.id;
        saveSrvNotebooks();
        persistActiveSrvNotebook();
        renderSrvNotebook();
        const textarea = document.getElementById('srv-commands-textarea');
        if (textarea) textarea.focus();
    }

    async function renameSrvNotebook() {
        const current = getActiveSrvNotebook();
        if (!current) return;
        const input = await showPromptDialog({ title: '重命名记事本', defaultValue: current.name, placeholder: '输入记事本名称', confirmText: '保存' });
        if (input === null) return;
        const name = input.trim();
        if (!name) { showToast('记事本名称不能为空'); return; }
        if (name === current.name) return;
        if (srvNotebooks.some(n => n.id !== current.id && n.name === name)) { showToast('已存在同名记事本'); return; }

        current.name = name;
        current.updatedAt = Date.now();
        saveSrvNotebooks();
        renderSrvNotebook();
        showToast('已重命名');
    }

    async function deleteSrvNotebook() {
        const current = getActiveSrvNotebook();
        if (!current) return;
        if (!await showConfirmDialog({ message: `确定删除记事本「${current.name}」？其中的内容将一并删除。`, type: 'danger', confirmText: '删除' })) return;

        const index = srvNotebooks.findIndex(n => n.id === current.id);
        srvNotebooks.splice(index, 1);
        if (srvNotebooks.length > 0) {
            srvActiveNotebookId = srvNotebooks[Math.min(index, srvNotebooks.length - 1)].id;
        } else {
            srvActiveNotebookId = '';
        }
        saveSrvNotebooks();
        persistActiveSrvNotebook();
        renderSrvNotebook();
        showToast('已删除');
    }

    // 打开记事本弹窗
    async function openSrvCommandsModal() {
        document.getElementById('srv-commands-modal').classList.remove('hidden');
        await loadSrvNotebooks();
        setTimeout(() => {
            const textarea = document.getElementById('srv-commands-textarea');
            if (textarea && !textarea.classList.contains('hidden')) textarea.focus();
        }, 100);
    }
    // 关闭记事本弹窗
    function closeSrvCommandsModal() {
        closeSrvNotebookMenu();
        document.getElementById('srv-commands-modal').classList.add('hidden');
    }

    // 按钮事件：打开记事本弹窗
    document.getElementById('srv-commands-btn').addEventListener('click', openSrvCommandsModal);
    // 收费状态筛选
    document.getElementById('srv-charge-filter-btn').addEventListener('click', function() {
        openSrvChargeFilterMenu();
    });
    document.getElementById('srv-copy-filtered-btn').addEventListener('click', copySrvFilteredWebsites);

    // 关闭记事本弹窗（仅通过关闭按钮关闭，点击遮罩不关闭且不丢失焦点）
    document.getElementById('close-srv-commands-modal').addEventListener('click', closeSrvCommandsModal);
    const commandsModal = document.getElementById('srv-commands-modal');
    commandsModal.addEventListener('mousedown', function(e) { if (e.target === commandsModal) e.preventDefault(); });

    // 记事本工具栏
    document.getElementById('srv-nb-select-btn').addEventListener('click', openSrvNotebookMenu);
    document.getElementById('srv-nb-add-btn').addEventListener('click', addSrvNotebook);
    document.getElementById('srv-nb-rename-btn').addEventListener('click', renameSrvNotebook);
    document.getElementById('srv-nb-del-btn').addEventListener('click', deleteSrvNotebook);

    // 监听 Textarea 输入并实时保存到当前记事本
    document.getElementById('srv-commands-textarea').addEventListener('input', function() {
        const current = getActiveSrvNotebook();
        if (!current) return;
        current.content = this.value;
        current.updatedAt = Date.now();
        saveSrvNotebooks();
        document.getElementById('srv-nb-meta').textContent = countSrvNotebookLines(this.value) + ' 行';
    });

    // === 分类管理弹窗 ===
    function openSrvCatManageModal() {
        const modal = document.getElementById('srv-cat-modal');
        if (!modal) return;
        renderSrvCatManageList();
        modal.classList.remove('hidden');
        setTimeout(() => {
            const input = document.getElementById('srv-cat-input');
            if (input) input.focus();
        }, 100);
    }
    function closeSrvCatManageModal() {
        document.getElementById('srv-cat-modal').classList.add('hidden');
    }

    function renderSrvCatManageList() {
        const container = document.getElementById('srv-cat-list');
        if (!container) return;
        container.innerHTML = '';

        srvCategories.forEach((cat, index) => {
            const item = document.createElement('div');
            item.className = 'srv-cat-list-item';
            item.draggable = true;
            item.dataset.index = index;
            item.innerHTML = `
                <span class="mi srv-cat-drag-handle fa-regular fa-grip-dots-vertical"></span>
                <span class="mi fa-regular fa-folder" style="font-size:16px;color:#6366f1;flex-shrink:0;"></span>
                <span class="srv-cat-list-name">${escapeHtml(cat.name)}</span>
                <div class="srv-cat-list-actions">
                    <span class="mi srv-cat-rename-icon fa-regular fa-pen-to-square" title="重命名"></span>
                    <span class="mi srv-cat-del-icon fa-regular fa-trash-can" title="删除"></span>
                </div>
            `;

            // 重命名
            item.querySelector('.srv-cat-rename-icon').addEventListener('click', async function() {
                const newName = await showPromptDialog({ title: '重命名分类', defaultValue: cat.name, placeholder: '输入分类名称', confirmText: '保存' });
                if (newName && newName.trim() && newName.trim() !== cat.name) {
                    cat.name = newName.trim();
                    saveSrvCategories();
                    renderSrvCatManageList();
                    renderSrvCatTabs();
                    renderServers();
                }
            });

            // 删除
            item.querySelector('.srv-cat-del-icon').addEventListener('click', async function() {
                if (await showConfirmDialog({ message: `确定删除分类「${cat.name}」？该分类下的服务器将变为「无分类」。`, type: 'danger' })) {
                    srvCategories.splice(index, 1);
                    myServers.forEach(s => { if (s.categoryId === cat.id) s.categoryId = ''; });
                    saveSrvCategories();
                    saveServers();
                    if (srvActiveCategoryId === cat.id) srvActiveCategoryId = '';
                    renderSrvCatManageList();
                    renderSrvCatTabs();
                    renderServers();
                    showToast('已删除');
                }
            });

            // 拖拽排序
            item.addEventListener('dragstart', function(e) {
                this.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', index);
            });
            item.addEventListener('dragend', function() {
                this.classList.remove('dragging');
                container.querySelectorAll('.srv-cat-list-item').forEach(el => el.classList.remove('drag-over'));
            });
            item.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                this.classList.add('drag-over');
            });
            item.addEventListener('dragleave', function() {
                this.classList.remove('drag-over');
            });
            item.addEventListener('drop', function(e) {
                e.stopPropagation();
                e.preventDefault();
                this.classList.remove('drag-over');
                const srcIndex = parseInt(e.dataTransfer.getData('text/plain'));
                const destIndex = index;
                if (srcIndex !== destIndex) {
                    const item = srvCategories.splice(srcIndex, 1)[0];
                    srvCategories.splice(destIndex, 0, item);
                    saveSrvCategories();
                    renderSrvCatManageList();
                    renderSrvCatTabs();
                }
            });

            container.appendChild(item);
        });
    }

    // 分类管理按钮
    document.getElementById('srv-cat-manage-btn').addEventListener('click', openSrvCatManageModal);
    // 关闭分类管理弹窗
    document.getElementById('close-srv-cat-modal').addEventListener('click', closeSrvCatManageModal);
    const srvCatModal = document.getElementById('srv-cat-modal');
    srvCatModal.addEventListener('mousedown', function(e) { if (e.target === srvCatModal) e.preventDefault(); });

    // 在分类管理弹窗中添加分类
    document.getElementById('srv-cat-add-btn').addEventListener('click', function() {
        const input = document.getElementById('srv-cat-input');
        const name = input.value.trim();
        if (name) {
            const id = 'cat_' + Date.now();
            srvCategories.push({ id, name });
            saveSrvCategories();
            renderSrvCatManageList();
            renderSrvCatTabs();
            input.value = '';
            input.focus();
        }
    });
    // 按 Enter 添加
    document.getElementById('srv-cat-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('srv-cat-add-btn').click();
        }
    });

    // 存储变化监听
    chrome.storage.onChanged.addListener(function(changes, area) {
        if (area === 'local' && changes.meow_servers) {
            myServers = changes.meow_servers.newValue || [];
            const view = document.getElementById('view-servers');
            if (view && !view.classList.contains('hidden')) renderServers();
        }
    });
}
