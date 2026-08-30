// sp-regcode.js - 注册码管理模块（软件注册码客户信息管理）
// 管理自己开发的软件所售出的注册码：软件分类、购买人联系方式、硬件码、注册码、购买/到期时间
// 参照 sp-servers.js 的模式创建

// ================== 全局状态 ==================
let myRegCodes = [];
let editingRegId = null;
let regDragSrcIndex = null;

// 软件分类
let regCategories = []; // [{ id, name }]
let regActiveCategoryId = ''; // '' = 全部

// ================== 数据持久化 ==================
function saveRegCodes() {
    chrome.storage.local.set({ 'meow_regcodes': myRegCodes });
}

function saveRegCategories() {
    chrome.storage.local.set({ 'meow_regcode_categories': regCategories });
}

async function loadRegCategories() {
    try {
        const localData = await chrome.storage.local.get(['meow_regcode_categories']);
        regCategories = localData.meow_regcode_categories || [];
    } catch (e) {
        console.error('注册码分类加载失败:', e);
        regCategories = [];
    }
}

// 获取某分类名
function getRegCategoryName(catId) {
    const c = regCategories.find(x => x.id === catId);
    return c ? c.name : '';
}

// ================== 到期状态 ==================
function getRegExpiryInfo(reg) {
    if (!reg.expiry) return { type: 'lifetime', label: '永久授权', className: 'reg-status-lifetime', critical: false };
    const exp = new Date(String(reg.expiry).replace(/-/g, '/') + ' 00:00:00');
    if (isNaN(exp.getTime())) return { type: 'lifetime', label: '永久授权', className: 'reg-status-lifetime', critical: false };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((exp.getTime() - today.getTime()) / 86400000);
    // critical：距到期 ≤ 5 天（含已到期），卡片标题显示红色
    const critical = diffDays <= 5;
    if (diffDays < 0) return { type: 'expired', label: `已到期 ${-diffDays} 天`, className: 'reg-status-expired', critical: true };
    if (diffDays === 0) return { type: 'soon', label: '今日到期', className: 'reg-status-soon', critical: true };
    if (diffDays <= 30) return { type: 'soon', label: `剩余 ${diffDays} 天`, className: 'reg-status-soon', critical };
    return { type: 'normal', label: `剩余 ${diffDays} 天`, className: 'reg-status-normal', critical: false };
}

// 卡片显示名称：昵称 > 微信 > 电话
function getRegDisplayName(reg) {
    return reg.nickname || reg.wechat || reg.phone || '(未命名客户)';
}

// 销售金额格式化（保留最多两位小数，去掉多余的 0）
function formatRegPrice(price) {
    const n = parseFloat(price);
    if (isNaN(n)) return '';
    return (Math.round(n * 100) / 100).toString();
}

// 在日期上增加 N 个月（处理月末溢出，如 1/31 + 1 月 → 2/28）
function addRegMonths(dateStr, months) {
    const d = new Date(String(dateStr).replace(/-/g, '/') + ' 00:00:00');
    if (isNaN(d.getTime())) return '';
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() !== day) d.setDate(0); // 退回上一个月的最后一天
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

// 今天的日期字符串（YYYY-MM-DD）
function getRegToday() {
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ================== 左侧软件分类栏 ==================
function renderRegCatTabs() {
    const sidebar = document.getElementById('reg-sidebar');
    if (!sidebar) return;

    // 保留"全部"Tab，移除中间的分类 Tab
    const allTab = sidebar.querySelector('.srv-cat-tab[data-cat-id=""]');
    sidebar.querySelectorAll('.srv-cat-tab:not([data-cat-id=""])').forEach(el => el.remove());

    if (allTab) {
        const allActive = !regActiveCategoryId;
        allTab.classList.toggle('active', allActive);
        const allIcon = allTab.querySelector('i');
        if (allIcon) allIcon.className = allActive ? 'fa-regular fa-folder-open' : 'fa-regular fa-folder';
        allTab.addEventListener('click', function() {
            regActiveCategoryId = '';
            renderRegCatTabs();
            renderRegCodes();
        });
    }

    regCategories.forEach((cat, index) => {
        const tab = document.createElement('div');
        tab.className = 'srv-cat-tab' + (cat.id === regActiveCategoryId ? ' active' : '');
        tab.dataset.catId = cat.id;
        tab.dataset.catName = cat.name;
        tab.dataset.index = index;
        tab.innerHTML = `<i class="fa-regular ${cat.id === regActiveCategoryId ? 'fa-folder-open' : 'fa-folder'}"></i><span class="srv-cat-label">${escapeHtml(cat.name)}</span>`;
        tab.addEventListener('click', function() {
            regActiveCategoryId = this.dataset.catId;
            renderRegCatTabs();
            renderRegCodes();
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
                const item = regCategories.splice(srcIndex, 1)[0];
                regCategories.splice(destIndex, 0, item);
                saveRegCategories();
                renderRegCatTabs();
            }
        });
        sidebar.appendChild(tab);
    });
}

// ================== 列表渲染 ==================
function renderRegCodes() {
    const regList = document.getElementById('reg-list');
    const regEmpty = document.getElementById('reg-empty');
    const regCountBar = document.getElementById('reg-count-bar');
    if (!regList || !regEmpty) return;
    regList.innerHTML = '';

    const filterInput = document.getElementById('reg-filter-input');
    const filterText = (filterInput ? filterInput.value.trim().toLowerCase() : '');

    if (myRegCodes.length === 0) {
        regEmpty.classList.remove('hidden');
        regEmpty.querySelector('p').innerHTML = '暂无注册码记录<br>点击上方 + 添加';
        if (regCountBar) regCountBar.textContent = '共 0 条注册码';
        renderRegStatusBar();
        return;
    }
    regEmpty.classList.add('hidden');

    let visibleCount = 0;

    myRegCodes.forEach((reg, index) => {
        // 分类过滤
        let matchCategory = true;
        if (regActiveCategoryId) {
            matchCategory = (reg.categoryId === regActiveCategoryId);
        }

        // 搜索过滤
        let matchFilter = true;
        if (filterText) {
            const catName = getRegCategoryName(reg.categoryId);
            const haystack = [reg.nickname, reg.wechat, reg.phone, reg.hwid, reg.code, reg.note, catName].join(' ').toLowerCase();
            matchFilter = haystack.includes(filterText);
        }

        if (!matchCategory || !matchFilter) return;

        visibleCount++;
        const expiryInfo = getRegExpiryInfo(reg);
        const displayName = getRegDisplayName(reg);
        const catName = getRegCategoryName(reg.categoryId);
        const hasPrice = (reg.salePrice !== undefined && reg.salePrice !== null && reg.salePrice !== '');

        // 联系人行（微信/电话）
        const contactParts = [];
        if (reg.wechat) contactParts.push(`<span class="material-icons reg-contact-ic" style="font-size:13px;color:#31c48d;">wechat</span><span class="reg-contact-text">${escapeHtml(reg.wechat)}</span>`);
        if (reg.phone) contactParts.push(`<span class="material-icons reg-contact-ic" style="font-size:13px;color:#3b82f6;">phone</span><span class="reg-contact-text">${escapeHtml(reg.phone)}</span>`);

        const card = document.createElement('div');
        card.className = 'srv-card reg-card';
        card.dataset.id = reg.id;
        card.dataset.index = index;

        card.innerHTML = `
            <div class="srv-card-header reg-card-header">
                <span class="material-icons srv-card-toggle">expand_more</span>
                <span class="material-icons" style="font-size:16px;color:#8b5cf6;">verified_user</span>
                <span class="srv-card-name reg-card-name${expiryInfo.critical ? ' reg-card-name-danger' : ''}" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
                ${hasPrice ? `<span class="reg-price-badge" title="销售金额">¥${formatRegPrice(reg.salePrice)}</span>` : ''}
                <span class="reg-status-badge ${expiryInfo.className}">${expiryInfo.label}</span>
                <div class="srv-card-actions">
                    <span class="material-icons reg-edit-btn" data-id="${reg.id}" title="编辑">edit</span>
                    <i class="fa-regular fa-xmark reg-del-btn" data-id="${reg.id}" title="删除"></i>
                </div>
            </div>
            ${contactParts.length ? `<div class="reg-contact-row">${contactParts.join('')}</div>` : ''}
            <div class="srv-card-body" style="display:none">
                ${catName ? `<div class="srv-info-row"><span class="srv-info-label">软件名称</span><span class="srv-info-val">${escapeHtml(catName)}</span></div>` : ''}
                ${reg.nickname ? `<div class="srv-info-row"><span class="srv-info-label">昵称</span><span class="srv-info-val">${escapeHtml(reg.nickname)}</span></div>` : ''}
                ${reg.wechat ? `<div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(reg.wechat)}" title="点击复制"><span class="srv-info-label">微信号</span><span class="srv-info-val">${escapeHtml(reg.wechat)}</span></div>` : ''}
                ${reg.phone ? `<div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(reg.phone)}" title="点击复制"><span class="srv-info-label">电话</span><span class="srv-info-val">${escapeHtml(reg.phone)}</span></div>` : ''}
                ${reg.hwid ? `<div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(reg.hwid)}" title="点击复制"><span class="srv-info-label">硬件码</span><span class="srv-info-val reg-hw-val">${escapeHtml(reg.hwid)}</span></div>` : ''}
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(reg.code || '')}" title="点击复制"><span class="srv-info-label">注册码</span><span class="srv-info-val reg-code-val-inline">${escapeHtml(reg.code || '--')}</span></div>
                <div class="srv-info-row"><span class="srv-info-label">购买时间</span><span class="srv-info-val">${escapeHtml(reg.purchase || '--')}</span></div>
                <div class="srv-info-row"><span class="srv-info-label">到期时间</span><span class="srv-info-val">${escapeHtml(reg.expiry || '永久授权')}</span></div>
                ${reg.note ? `<div class="srv-note-box"><span class="material-icons" style="font-size:12px;color:#a8a29e;">description</span> ${escapeHtml(reg.note)}</div>` : ''}
                <div class="reg-card-actions">
                    <button class="srv-copy-btn" data-copy-type="all" title="一键复制客户全部信息"><span class="material-icons" style="font-size:13px;">content_copy</span>复制全部信息</button>
                </div>
            </div>
        `;

        // 折叠/展开
        card.querySelector('.srv-card-header').addEventListener('click', function(e) {
            if (e.target.closest('.srv-card-actions, .reg-del-btn, .reg-edit-btn')) return;
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

        // 一键复制全部信息
        const copyAllBtn = card.querySelector('[data-copy-type="all"]');
        if (copyAllBtn) {
            copyAllBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const text = [
                    `软件：${catName || '-'}`,
                    `昵称：${reg.nickname || ''}`,
                    `微信：${reg.wechat || ''}`,
                    `电话：${reg.phone || ''}`,
                    `硬件码：${reg.hwid || ''}`,
                    `注册码：${reg.code || ''}`,
                    `销售金额：¥${formatRegPrice(reg.salePrice) || '0'}`,
                    `购买时间：${reg.purchase || ''}`,
                    `到期时间：${reg.expiry || '永久'}`,
                    `备注：${reg.note || ''}`
                ].join('\n');
                copyToClipboard(text);
                showToast('已复制全部信息');
            });
        }

        // 编辑
        card.querySelector('.reg-edit-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            openRegModal(reg);
        });

        // 删除
        card.querySelector('.reg-del-btn').addEventListener('click', async function(e) {
            e.stopPropagation();
            if (await showConfirmDialog({ message: '确定删除此注册码记录？', type: 'danger' })) {
                myRegCodes = myRegCodes.filter(r => r.id !== reg.id);
                saveRegCodes();
                renderRegCodes();
                showToast('已删除');
            }
        });

        // 拖拽排序
        card.draggable = true;
        card.dataset.index = index;
        card.addEventListener('dragstart', function(e) {
            this.classList.add('dragging');
            regDragSrcIndex = index;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
        });
        card.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            document.querySelectorAll('#reg-list .reg-card').forEach(el => el.classList.remove('drag-over'));
            regDragSrcIndex = null;
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
            if (regDragSrcIndex !== null && regDragSrcIndex !== destIndex) {
                const item = myRegCodes.splice(regDragSrcIndex, 1)[0];
                myRegCodes.splice(destIndex, 0, item);
                saveRegCodes();
                renderRegCodes();
            }
            regDragSrcIndex = null;
        });

        regList.appendChild(card);
    });

    if (visibleCount === 0 && myRegCodes.length > 0) {
        regEmpty.classList.remove('hidden');
        regEmpty.querySelector('p').textContent = '无匹配结果';
    }

    // 更新计数栏
    if (regCountBar) {
        const totalCount = myRegCodes.length;
        let catCount;
        if (regActiveCategoryId) {
            catCount = myRegCodes.filter(r => r.categoryId === regActiveCategoryId).length;
        } else {
            catCount = totalCount;
        }
        if (filterText && visibleCount < totalCount) {
            regCountBar.textContent = `共 ${totalCount} 条注册码（显示 ${visibleCount} 条）`;
        } else if (regActiveCategoryId) {
            const catName = getRegCategoryName(regActiveCategoryId) || '未命名';
            regCountBar.textContent = `「${catName}」下有 ${catCount} 条注册码 / 共 ${totalCount} 条`;
        } else {
            regCountBar.textContent = `共 ${totalCount} 条注册码`;
        }
    }

    renderRegStatusBar();
}

// 底部统计栏：销售额 + 到期状态
function renderRegStatusBar() {
    const bar = document.getElementById('reg-status-bar');
    if (!bar) return;
    if (myRegCodes.length === 0) {
        bar.style.display = 'none';
        bar.innerHTML = '';
        return;
    }
    let totalSales = 0;
    let expired = 0, soon = 0;
    myRegCodes.forEach(r => {
        const price = parseFloat(r.salePrice);
        if (!isNaN(price)) totalSales += price;
        const info = getRegExpiryInfo(r);
        if (info.type === 'expired') expired++;
        else if (info.type === 'soon') soon++;
    });
    const fmtMoney = n => '¥' + (Math.round(n * 100) / 100).toString();
    const parts = [];
    if (totalSales > 0) parts.push(`销售额 <span class="reg-stat-sales">${fmtMoney(totalSales)}</span>`);
    if (soon > 0) parts.push(`<span class="reg-stat-soon">即将到期 ${soon}</span>`);
    if (expired > 0) parts.push(`<span class="reg-stat-expired">已到期 ${expired}</span>`);
    if (parts.length === 0) {
        bar.style.display = 'none';
        bar.innerHTML = '';
        return;
    }
    bar.style.display = '';
    bar.innerHTML = parts.join(' · ');
}

// ================== 编辑弹窗 ==================
function openRegModal(reg) {
    editingRegId = null;

    const modalTitle = document.getElementById('reg-modal-title');
    const softwareInput = document.getElementById('reg-software-input');
    const nicknameInput = document.getElementById('reg-nickname-input');
    const wechatInput = document.getElementById('reg-wechat-input');
    const phoneInput = document.getElementById('reg-phone-input');
    const hwidInput = document.getElementById('reg-hwid-input');
    const codeInput = document.getElementById('reg-code-input');
    const purchaseInput = document.getElementById('reg-purchase-input');
    const expiryInput = document.getElementById('reg-expiry-input');
    const priceInput = document.getElementById('reg-price-input');
    const noteInput = document.getElementById('reg-note-input');
    const deleteBtn = document.getElementById('reg-delete-btn');

    // 填充分类下拉
    softwareInput.innerHTML = '<option value="">未选择软件</option>';
    regCategories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        softwareInput.appendChild(opt);
    });

    // 重置
    softwareInput.value = '';
    nicknameInput.value = '';
    wechatInput.value = '';
    phoneInput.value = '';
    hwidInput.value = '';
    codeInput.value = '';
    purchaseInput.value = '';
    expiryInput.value = '';
    priceInput.value = '';
    noteInput.value = '';
    deleteBtn.classList.add('hidden');

    if (reg) {
        editingRegId = reg.id;
        modalTitle.textContent = '编辑注册码';
        softwareInput.value = reg.categoryId || '';
        nicknameInput.value = reg.nickname || '';
        wechatInput.value = reg.wechat || '';
        phoneInput.value = reg.phone || '';
        hwidInput.value = reg.hwid || '';
        codeInput.value = reg.code || '';
        purchaseInput.value = reg.purchase || '';
        expiryInput.value = reg.expiry || '';
        priceInput.value = (reg.salePrice !== undefined && reg.salePrice !== null && reg.salePrice !== '') ? reg.salePrice : '';
        noteInput.value = reg.note || '';
        deleteBtn.classList.remove('hidden');
    } else {
        modalTitle.textContent = '添加注册码';
        // 新增记录时购买日期默认为当前日期
        purchaseInput.value = getRegToday();
    }

    document.getElementById('reg-modal').classList.remove('hidden');
    setTimeout(() => nicknameInput.focus(), 100);
}

function closeRegModal() {
    document.getElementById('reg-modal').classList.add('hidden');
    editingRegId = null;
}

// ================== 导出 ==================
function exportRegCodes() {
    if (!myRegCodes || myRegCodes.length === 0) {
        showToast('没有可导出的注册码');
        return;
    }
    const data = myRegCodes.map(r => ({
        categoryId: r.categoryId || '',
        categoryName: getRegCategoryName(r.categoryId) || '',
        nickname: r.nickname || '',
        wechat: r.wechat || '',
        phone: r.phone || '',
        hwid: r.hwid || '',
        code: r.code || '',
        purchase: r.purchase || '',
        expiry: r.expiry || '',
        salePrice: (r.salePrice !== undefined && r.salePrice !== null && r.salePrice !== '') ? r.salePrice : '',
        note: r.note || ''
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meow_regcodes_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`已导出 ${data.length} 条注册码`);
}

// ================== 导入 ==================
function importRegCodes() {
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
                let added = 0;
                imported.forEach(r => {
                    let categoryId = r.categoryId || '';
                    // 带软件名称时按名称查找或创建分类，保证导入后仍可筛选
                    if (r.categoryName) {
                        let cat = regCategories.find(c => c.name === r.categoryName);
                        if (!cat) {
                            cat = { id: 'cat_' + Date.now() + '_' + Math.random(), name: r.categoryName };
                            regCategories.push(cat);
                        }
                        categoryId = cat.id;
                    }
                    myRegCodes.push({
                        id: Date.now() + Math.random(),
                        categoryId: categoryId,
                        nickname: r.nickname || '',
                        wechat: r.wechat || '',
                        phone: r.phone || '',
                        hwid: r.hwid || '',
                        code: r.code || '',
                        purchase: r.purchase || '',
                        expiry: r.expiry || '',
                        salePrice: (r.salePrice !== undefined && r.salePrice !== null && r.salePrice !== '') ? r.salePrice : '',
                        note: r.note || ''
                    });
                    added++;
                });
                saveRegCodes();
                saveRegCategories();
                renderRegCatTabs();
                renderRegCodes();
                showToast(`已导入 ${added} 条注册码`);
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

// ================== 软件分类管理弹窗 ==================
function openRegCatManageModal() {
    const modal = document.getElementById('reg-cat-modal');
    if (!modal) return;
    renderRegCatManageList();
    modal.classList.remove('hidden');
    setTimeout(() => {
        const input = document.getElementById('reg-cat-input');
        if (input) input.focus();
    }, 100);
}

function closeRegCatManageModal() {
    document.getElementById('reg-cat-modal').classList.add('hidden');
}

function renderRegCatManageList() {
    const container = document.getElementById('reg-cat-list');
    if (!container) return;
    container.innerHTML = '';

    regCategories.forEach((cat, index) => {
        const item = document.createElement('div');
        item.className = 'srv-cat-list-item';
        item.draggable = true;
        item.dataset.index = index;
        item.innerHTML = `
            <span class="material-icons srv-cat-drag-handle">drag_indicator</span>
            <span class="material-icons" style="font-size:16px;color:#8b5cf6;flex-shrink:0;">apps</span>
            <span class="srv-cat-list-name">${escapeHtml(cat.name)}</span>
            <div class="srv-cat-list-actions">
                <span class="material-icons reg-cat-rename-icon" title="重命名">edit</span>
                <span class="material-icons reg-cat-del-icon" title="删除">delete</span>
            </div>
        `;

        // 重命名
        item.querySelector('.reg-cat-rename-icon').addEventListener('click', async function() {
            const newName = await showPromptDialog({ title: '重命名软件', defaultValue: cat.name, placeholder: '输入软件名称', confirmText: '保存' });
            if (newName && newName.trim() && newName.trim() !== cat.name) {
                cat.name = newName.trim();
                saveRegCategories();
                renderRegCatManageList();
                renderRegCatTabs();
                renderRegCodes();
            }
        });

        // 删除
        item.querySelector('.reg-cat-del-icon').addEventListener('click', async function() {
            if (await showConfirmDialog({ message: `确定删除软件「${cat.name}」？该软件下的注册码将变为「未选择软件」。`, type: 'danger' })) {
                regCategories.splice(index, 1);
                myRegCodes.forEach(r => { if (r.categoryId === cat.id) r.categoryId = ''; });
                saveRegCategories();
                saveRegCodes();
                if (regActiveCategoryId === cat.id) regActiveCategoryId = '';
                renderRegCatManageList();
                renderRegCatTabs();
                renderRegCodes();
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
                const item = regCategories.splice(srcIndex, 1)[0];
                regCategories.splice(destIndex, 0, item);
                saveRegCategories();
                renderRegCatManageList();
                renderRegCatTabs();
            }
        });

        container.appendChild(item);
    });
}

// ================== 初始化逻辑 ==================
function setupRegCodeLogic() {
    const regList = document.getElementById('reg-list');
    if (!regList) return;

    // 加载数据
    (async () => {
        try {
            const localData = await chrome.storage.local.get(['meow_regcodes']);
            myRegCodes = localData.meow_regcodes || [];
        } catch (e) {
            console.error('注册码数据加载失败:', e);
            myRegCodes = [];
        }
        renderRegCodes();
    })();

    // 加载分类
    (async () => {
        await loadRegCategories();
        renderRegCatTabs();
    })();

    // 添加按钮
    document.getElementById('reg-add-btn').addEventListener('click', function() { openRegModal(null); });
    // 导出/导入
    document.getElementById('reg-export-btn').addEventListener('click', exportRegCodes);
    document.getElementById('reg-import-btn').addEventListener('click', importRegCodes);

    // 关闭编辑弹窗（仅通过关闭按钮关闭，点击遮罩不关闭且不丢失焦点）
    document.getElementById('close-reg-modal').addEventListener('click', closeRegModal);
    const regModal = document.getElementById('reg-modal');
    regModal.addEventListener('mousedown', function(e) { if (e.target === regModal) e.preventDefault(); });

    // 保存注册码
    document.getElementById('reg-save-btn').addEventListener('click', function() {
        const categoryId = document.getElementById('reg-software-input').value;
        const nickname = document.getElementById('reg-nickname-input').value.trim();
        const wechat = document.getElementById('reg-wechat-input').value.trim();
        const phone = document.getElementById('reg-phone-input').value.trim();
        const hwid = document.getElementById('reg-hwid-input').value.trim();
        const code = document.getElementById('reg-code-input').value.trim();
        const purchase = document.getElementById('reg-purchase-input').value;
        const expiry = document.getElementById('reg-expiry-input').value;
        const salePrice = document.getElementById('reg-price-input').value;
        const note = document.getElementById('reg-note-input').value.trim();

        if (!nickname && !wechat && !phone) {
            showToast('请至少填写昵称或微信号/电话');
            document.getElementById('reg-nickname-input').focus();
            return;
        }
        if (!code) {
            showToast('注册码不能为空');
            document.getElementById('reg-code-input').focus();
            return;
        }

        const regData = { categoryId, nickname, wechat, phone, hwid, code, purchase, expiry, salePrice, note };

        if (editingRegId) {
            const idx = myRegCodes.findIndex(r => r.id === editingRegId);
            if (idx !== -1) {
                Object.assign(myRegCodes[idx], regData);
                showToast('已更新');
            }
        } else {
            myRegCodes.push({ id: Date.now(), ...regData });
            showToast('已添加');
        }
        saveRegCodes();
        renderRegCodes();
        closeRegModal();
    });

    // 删除（弹窗内）
    document.getElementById('reg-delete-btn').addEventListener('click', async function() {
        if (!editingRegId) return;
        if (await showConfirmDialog({ message: '确定删除此注册码记录？', type: 'danger' })) {
            myRegCodes = myRegCodes.filter(r => r.id !== editingRegId);
            saveRegCodes();
            renderRegCodes();
            closeRegModal();
            showToast('已删除');
        }
    });

    // 弹窗内输入框的复制按钮
    document.querySelectorAll('#reg-modal .srv-icopy-btn').forEach(btn => {
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

    // 注册码输入框回车保存
    const codeInput = document.getElementById('reg-code-input');
    codeInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            document.getElementById('reg-save-btn').click();
        }
    });

    // 付款周期按钮：月付/季付/半年付/年付，自动设置到期时间
    document.querySelectorAll('#reg-modal .reg-plan-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const months = parseInt(this.dataset.months) || 1;
            const purchaseInput = document.getElementById('reg-purchase-input');
            let purchase = purchaseInput.value;
            if (!purchase) {
                purchase = getRegToday();
                purchaseInput.value = purchase;
                showToast('购买时间为空，已按今天计算');
            }
            const expiry = addRegMonths(purchase, months);
            if (!expiry) { showToast('购买时间格式错误'); return; }
            const expiryInput = document.getElementById('reg-expiry-input');
            expiryInput.value = expiry;
            showToast(`已设置到期时间：${expiry}`);
        });
    });

    // === 软件分类管理弹窗 ===
    document.getElementById('reg-cat-manage-btn').addEventListener('click', openRegCatManageModal);
    document.getElementById('close-reg-cat-modal').addEventListener('click', closeRegCatManageModal);
    const regCatModal = document.getElementById('reg-cat-modal');
    regCatModal.addEventListener('mousedown', function(e) { if (e.target === regCatModal) e.preventDefault(); });

    // 添加软件分类
    document.getElementById('reg-cat-add-btn').addEventListener('click', function() {
        const input = document.getElementById('reg-cat-input');
        const name = input.value.trim();
        if (!name) return;
        if (regCategories.some(c => c.name === name)) { showToast('软件已存在'); return; }
        regCategories.push({ id: 'cat_' + Date.now(), name });
        saveRegCategories();
        renderRegCatManageList();
        renderRegCatTabs();
        input.value = '';
        input.focus();
    });
    // 按 Enter 添加
    document.getElementById('reg-cat-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('reg-cat-add-btn').click();
        }
    });

    // === 搜索栏 ===
    const filterInput = document.getElementById('reg-filter-input');
    const filterClear = document.getElementById('reg-filter-clear');
    const regControls = document.getElementById('reg-controls');
    const regSearchToggle = document.getElementById('reg-search-toggle');
    const regSearchBack = document.getElementById('reg-search-back');

    // 点击搜索图标 → 展开全宽搜索栏
    regSearchToggle.addEventListener('click', function() {
        regControls.classList.add('search-active');
        filterInput.focus();
    });

    // 点击返回箭头 → 收起搜索栏
    regSearchBack.addEventListener('click', function() {
        regControls.classList.remove('search-active');
        filterInput.value = '';
        filterClear.style.display = 'none';
        renderRegCodes();
    });

    filterInput.addEventListener('input', function() {
        filterClear.style.display = this.value ? '' : 'none';
        renderRegCodes();
    });

    filterClear.addEventListener('click', function() {
        filterInput.value = '';
        filterInput.focus();
        filterClear.style.display = 'none';
        renderRegCodes();
    });

    // Escape 键收起搜索栏
    filterInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            filterInput.value = '';
            filterClear.style.display = 'none';
            regControls.classList.remove('search-active');
            renderRegCodes();
        }
    });

    // 失焦且内容为空时自动收起
    filterInput.addEventListener('blur', function() {
        if (!filterInput.value.trim()) {
            regControls.classList.remove('search-active');
        }
    });

    // 存储变化监听
    chrome.storage.onChanged.addListener(function(changes, area) {
        if (area === 'local' && changes.meow_regcodes) {
            myRegCodes = changes.meow_regcodes.newValue || [];
            const view = document.getElementById('view-regcodes');
            if (view && !view.classList.contains('hidden')) renderRegCodes();
        }
    });
}
