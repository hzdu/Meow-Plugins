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

// 数据库默认用户名
function getDefaultDbUsername(dbType) {
    return (dbType === 'mssql') ? 'sa' : 'root';
}

function saveServers() {
    chrome.storage.local.set({ 'meow_servers': myServers });
}

// === 服务器列表渲染 ===
function renderServers() {
    const srvList = document.getElementById('srv-list');
    const srvEmpty = document.getElementById('srv-empty');
    if (!srvList || !srvEmpty) return;
    srvList.innerHTML = '';

    const filterInput = document.getElementById('srv-filter-input');
    const filterText = (filterInput ? filterInput.value.trim().toLowerCase() : '');

    if (myServers.length === 0) {
        srvEmpty.classList.remove('hidden');
        return;
    }
    srvEmpty.classList.add('hidden');

    let hasVisible = false;

    myServers.forEach((srv, index) => {
        let matchFilter = true;
        if (filterText) {
            const title = (srv.title || '').toLowerCase();
            const ip = (srv.ip || '').toLowerCase();
            const user = (srv.username || '').toLowerCase();
            const note = (srv.note || '').toLowerCase();
            const wsDomains = (srv.websites || []).map(w => (w.domain || '').toLowerCase()).join(' ');
            matchFilter = title.includes(filterText) || ip.includes(filterText) || user.includes(filterText) || note.includes(filterText) || wsDomains.includes(filterText);
        }

        const card = document.createElement('div');
        card.className = 'srv-card';
        card.dataset.id = srv.id;

        const osIcon = srv.os === 'Windows' ? 'window' : (srv.os === 'Other' ? 'help_outline' : 'terminal');
        const protocolLabel = SRV_PROTOCOL_LABELS[srv.protocol] || srv.protocol || 'SSH';
        const wsCount = (srv.websites || []).length;
        const displayName = srv.title || srv.ip || '(未设置)';

        // 网站 HTML
        const websitesHtml = (srv.websites || []).map((ws, wi) => {
            const dbLabel = SRV_DB_LABELS[ws.dbType] || '无';
            const dbInfo = ws.dbType && ws.dbType !== 'none' ? `<span class="srv-ws-badge">${dbLabel}</span>` : '';
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
                        <span class="material-icons srv-ws-toggle" style="font-size:14px;color:#94a3b8;cursor:pointer;">expand_more</span>
                        <span class="material-icons" style="font-size:12px;color:#10b981;">language</span>
                        <span class="srv-copy-row" data-copy="${escapeHtml(ws.domain || '')}" title="点击复制域名" style="cursor:pointer;">${escapeHtml(ws.domain || '(未设置域名)')}</span>
                        ${dbInfo}
                        ${ws.adminUrl ? `<a class="srv-ws-link" href="${escapeHtml(ws.adminUrl)}" target="_blank" onclick="event.stopPropagation()" title="打开后台"><span class="material-icons" style="font-size:12px;color:#0891b2;">open_in_new</span></a>` : ''}
                    </div>
                    <div class="srv-ws-item-actions">
                        <button class="srv-copy-btn" data-copy-type="website" data-widx="${wi}" title="一键复制网站信息"><span class="material-icons" style="font-size:13px;">content_copy</span>复制</button>
                        <span class="material-icons srv-ws-edit-btn" data-widx="${wi}" title="编辑网站" style="font-size:14px;color:#cbd5e1;cursor:pointer;">edit</span>
                        <span class="material-icons srv-ws-del-btn" data-widx="${wi}" title="删除网站" style="font-size:14px;color:#cbd5e1;cursor:pointer;">delete</span>
                    </div>
                </div>
                ${wsRows.length > 0 ? `<div class="srv-ws-details" style="display:none">${wsRows.join('')}</div>` : ''}
            </div>`;
        }).join('');

        card.innerHTML = `
            <div class="srv-card-header">
                <span class="material-icons srv-card-toggle">expand_more</span>
                <span class="material-icons" style="font-size:16px;color:#6366f1;">${osIcon}</span>
                <span class="srv-card-name">${escapeHtml(displayName)}</span>
                <span class="srv-card-badge">${escapeHtml(srv.os || '')}</span>
                <div class="srv-card-actions">
                    ${srv.providerUrl ? `<a class="srv-provider-link" href="${escapeHtml(srv.providerUrl)}" target="_blank" onclick="event.stopPropagation()" title="打开供应商"><span class="material-icons" style="font-size:16px;color:#cbd5e1;">open_in_new</span></a>` : ''}
                    <span class="material-icons srv-edit-btn" data-id="${srv.id}" title="编辑">edit</span>
                    <span class="material-icons srv-del-btn" data-id="${srv.id}" title="删除">delete</span>
                </div>
            </div>
            <div class="srv-card-body" style="display:none">
                <div class="srv-section-bar">
                    <span class="srv-section-title"><span class="material-icons" style="font-size:13px;color:#6366f1;">cloud</span> 连接信息</span>
                    <button class="srv-copy-btn" data-copy-type="server" title="一键复制 IP/端口/用户名/密码"><span class="material-icons" style="font-size:13px;">content_copy</span>复制</button>
                </div>
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.ip || '')}" title="点击复制"><span class="srv-info-label">IP 地址</span><span class="srv-info-val" style="color:#6366f1;font-weight:600;">${escapeHtml(srv.ip || '--')}</span></div>
                <div class="srv-info-row"><span class="srv-info-label">协议</span><span class="srv-info-val">${protocolLabel}</span></div>
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.port || '')}" title="点击复制"><span class="srv-info-label">端口</span><span class="srv-info-val">${escapeHtml(srv.port || '--')}</span></div>
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.username || '')}" title="点击复制"><span class="srv-info-label">用户名</span><span class="srv-info-val">${escapeHtml(srv.username || '--')}</span></div>
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.password || '')}" title="点击复制"><span class="srv-info-label">密码</span><span class="srv-info-val srv-masked">${srv.password ? '••••••••' : '--'}</span></div>
                ${srv.panelType && srv.panelType !== 'none' ? `
                <div class="srv-section-bar">
                    <span class="srv-section-title"><span class="material-icons" style="font-size:13px;color:#6366f1;">dashboard</span> ${SRV_PANEL_LABELS[srv.panelType] || '管理面板'}</span>
                    <button class="srv-copy-btn" data-copy-type="panel" title="一键复制面板地址/账号/密码"><span class="material-icons" style="font-size:13px;">content_copy</span>复制</button>
                </div>
                ${srv.panelUrl ? `<div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.panelUrl)}" title="点击复制"><span class="srv-info-label">面板地址</span><span class="srv-info-val" style="color:#0891b2;text-decoration:underline;">${escapeHtml(srv.panelUrl)}</span></div>` : ''}
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.panelUser || '')}" title="点击复制"><span class="srv-info-label">面板账号</span><span class="srv-info-val">${escapeHtml(srv.panelUser || '--')}</span></div>
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(srv.panelPass || '')}" title="点击复制"><span class="srv-info-label">面板密码</span><span class="srv-info-val srv-masked">${srv.panelPass ? '••••••••' : '--'}</span></div>
                ` : ''}
                ${srv.note && srv.note.trim() ? `<div class="srv-note-box"><span class="material-icons" style="font-size:12px;color:#a8a29e;">description</span> ${escapeHtml(srv.note)}</div>` : ''}
                <div class="srv-ws-section">
                    <div class="srv-ws-header">
                        <span class="material-icons" style="font-size:12px;color:#10b981;">language</span>
                        <span>绑定网站 (${wsCount})</span>
                        <button type="button" class="srv-ws-add-btn" title="添加网站"><span class="material-icons" style="font-size:14px;">add</span></button>
                    </div>
                    ${wsCount > 0 ? websitesHtml : '<div class="srv-ws-empty-hint">暂无网站</div>'}
                </div>
            </div>
        `;

        // 折叠/展开
        card.querySelector('.srv-card-header').addEventListener('click', function(e) {
            if (e.target.closest('.srv-card-actions, .srv-ws-del-btn, .srv-ws-edit-btn, .srv-ws-link, .srv-provider-link, .srv-copy-btn, .srv-ws-add-btn')) return;
            const body = card.querySelector('.srv-card-body');
            const toggle = card.querySelector('.srv-card-toggle');
            const isExpanded = card.classList.toggle('expanded');
            body.style.display = isExpanded ? '' : 'none';
            toggle.textContent = isExpanded ? 'expand_less' : 'expand_more';
        });

        // 单行点击复制
        card.querySelectorAll('.srv-copy-row').forEach(row => {
            row.addEventListener('click', function(e) {
                e.stopPropagation();
                const val = this.dataset.copy;
                if (val) copyToClipboard(val);
            });
        });

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
                if (e.target.closest('.srv-copy-btn, .srv-ws-edit-btn, .srv-ws-del-btn, .srv-ws-link, .srv-copy-row')) return;
                const item = this.closest('.srv-ws-item');
                const details = item.querySelector('.srv-ws-details');
                const toggle = this.querySelector('.srv-ws-toggle');
                if (!details) return;
                const isExpanded = details.style.display !== 'none';
                details.style.display = isExpanded ? 'none' : '';
                if (toggle) toggle.textContent = isExpanded ? 'expand_more' : 'expand_less';
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

        // 拖拽排序
        card.draggable = true;
        card.dataset.index = index;
        card.addEventListener('dragstart', function(e) {
            this.classList.add('dragging');
            srvDragSrcIndex = index;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
        });
        card.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            document.querySelectorAll('#srv-list .srv-card').forEach(el => el.classList.remove('drag-over'));
            srvDragSrcIndex = null;
        });
        card.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.classList.add('drag-over');
        });
        card.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
        });
        card.addEventListener('drop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            this.classList.remove('drag-over');
            const destIndex = index;
            if (srvDragSrcIndex !== null && srvDragSrcIndex !== destIndex) {
                const item = myServers.splice(srvDragSrcIndex, 1)[0];
                myServers.splice(destIndex, 0, item);
                saveServers();
                renderServers();
            }
            srvDragSrcIndex = null;
        });

        if (!matchFilter) {
            card.style.display = 'none';
        } else {
            hasVisible = true;
        }

        srvList.appendChild(card);
    });

    if (!hasVisible && myServers.length > 0) {
        srvEmpty.classList.remove('hidden');
        srvEmpty.querySelector('p').textContent = '无匹配结果';
    }
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
    } else {
        modalTitle.textContent = '添加服务器';
    }

    renderSrvEditWebsites();
    document.getElementById('srv-modal').classList.remove('hidden');
    setTimeout(() => titleInput.focus(), 100);
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
        const dbLabel = SRV_DB_LABELS[ws.dbType] || '无';
        item.innerHTML = `
            <div class="srv-ws-edit-info">
                <span class="material-icons" style="font-size:14px;color:#10b981;">language</span>
                <span class="srv-ws-edit-domain">${escapeHtml(ws.domain || '(未设置域名)')}</span>
                ${ws.dbType && ws.dbType !== 'none' ? `<span class="srv-ws-badge">${dbLabel}</span>` : ''}
            </div>
            <div class="srv-ws-edit-actions">
                <span class="material-icons srv-ws-edit-btn" data-idx="${idx}" title="编辑" style="font-size:16px;color:#cbd5e1;cursor:pointer;">edit</span>
                <span class="material-icons srv-ws-edit-del" data-idx="${idx}" title="删除" style="font-size:16px;color:#cbd5e1;cursor:pointer;">delete</span>
            </div>
        `;
        item.querySelector('.srv-ws-edit-btn').addEventListener('click', function() {
            openSrvWebsiteModal(parseInt(this.dataset.idx));
        });
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
            const localData = await chrome.storage.local.get(['meow_servers']);
            myServers = localData.meow_servers || [];
        } catch (e) {
            console.error('Server load error:', e);
            myServers = [];
        }
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

        if (!ip) { showToast('IP 地址不能为空'); document.getElementById('srv-ip-input').focus(); return; }

        const serverData = {
            title, os, protocol, ip, port, username, password,
            providerUrl, note,
            panelType, panelUrl, panelUser, panelPass,
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

    // 常用命令模块：加载与保存
    let srvCommandsCache = '';
    async function loadSrvCommands() {
        try {
            const localData = await chrome.storage.local.get(['meow_srv_commands']);
            srvCommandsCache = localData.meow_srv_commands || '';
            const textarea = document.getElementById('srv-commands-textarea');
            if (textarea) textarea.value = srvCommandsCache;
        } catch (e) {
            console.error('加载常用命令失败:', e);
            srvCommandsCache = '';
        }
    }
    function saveSrvCommands() {
        chrome.storage.local.set({ 'meow_srv_commands': srvCommandsCache });
    }

    // 打开常用命令弹窗
    function openSrvCommandsModal() {
        loadSrvCommands();
        document.getElementById('srv-commands-modal').classList.remove('hidden');
        setTimeout(() => {
            const textarea = document.getElementById('srv-commands-textarea');
            if (textarea) textarea.focus();
        }, 100);
    }
    // 关闭常用命令弹窗
    function closeSrvCommandsModal() {
        document.getElementById('srv-commands-modal').classList.add('hidden');
    }

    // 按钮事件：打开常用命令弹窗
    document.getElementById('srv-commands-btn').addEventListener('click', openSrvCommandsModal);

    // 关闭常用命令弹窗（仅通过关闭按钮关闭，点击遮罩不关闭且不丢失焦点）
    document.getElementById('close-srv-commands-modal').addEventListener('click', closeSrvCommandsModal);
    const commandsModal = document.getElementById('srv-commands-modal');
    commandsModal.addEventListener('mousedown', function(e) { if (e.target === commandsModal) e.preventDefault(); });

    // 监听 Textarea 输入并实时保存
    document.getElementById('srv-commands-textarea').addEventListener('input', function() {
        srvCommandsCache = this.value;
        saveSrvCommands();
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
