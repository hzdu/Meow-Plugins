// popup-assets.js - 固定资产管理（简版：房/门店/车等大件，全款/分期）
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 固定资产元素 ===
const assetsList = document.getElementById('assets-list');
const assetsEmpty = document.getElementById('assets-empty');
const assetsAddBtn = document.getElementById('assets-add-btn');
const assetsModal = document.getElementById('assets-modal');
const assetsModalTitle = document.getElementById('assets-modal-title');
const closeAssetsModal = document.getElementById('close-assets-modal');
const assetsNameInput = document.getElementById('assets-name-input');
const assetsTypeInput = document.getElementById('assets-type-input');
const assetsQuantityInput = document.getElementById('assets-quantity-input');
const assetsPaymentInput = document.getElementById('assets-payment-input');
const assetsUsageInput = document.getElementById('assets-usage-input');
const assetsRentCol = document.getElementById('assets-rent-col');
const assetsRentInput = document.getElementById('assets-rent-input');
const assetsNoteInput = document.getElementById('assets-note-input');
const assetsSaveBtn = document.getElementById('assets-save-btn');
const assetsDeleteBtn = document.getElementById('assets-delete-btn');
const assetsSummary = document.getElementById('assets-summary');
const assetsAiToggleInput = document.getElementById('assets-ai-toggle-input');

// === 状态变量 ===
let myAssets = [];
let editingAssetId = null;
let assetsAiEnabled = false; // AI 分析是否纳入固定资产

// === 类型配置 ===
const ASSETS_TYPES = {
    property: { icon: 'home', color: '#0ea5e9', unit: 'assets_unit_property', label: 'assets_type_property' },
    shop:     { icon: 'store', color: '#f59e0b', unit: 'assets_unit_shop', label: 'assets_type_shop' },
    vehicle:  { icon: 'directions_car', color: '#10b981', unit: 'assets_unit_vehicle', label: 'assets_type_vehicle' },
    other:    { icon: 'inventory_2', color: '#6b7280', unit: 'assets_unit_other', label: 'assets_type_other' }
};

const ASSETS_PAYMENTS = {
    full:       { icon: 'check_circle', color: '#10b981', label: 'assets_payment_full' },
    installment:{ icon: 'schedule', color: '#f59e0b', label: 'assets_payment_installment' }
};

const ASSETS_USAGE = {
    'self-use': { icon: 'person', color: '#6366f1', label: 'assets_usage_self' },
    'rental':   { icon: 'key', color: '#f59e0b', label: 'assets_usage_rental' }
};

// === 数据加载与保存 ===
async function loadAssets() {
    const data = await getStorageData('meow_assets');
    myAssets = Array.isArray(data) ? data : [];
    // 加载 AI 开关状态
    const aiFlag = await getStorageData('meow_assets_ai_enabled');
    assetsAiEnabled = aiFlag === true;
    if (assetsAiToggleInput) assetsAiToggleInput.checked = assetsAiEnabled;
    // 自动将租金计入当月1号财务账本
    await autoAddRentalIncome();
}

// === 自动将租金收入计入财务账本（每月1号）===
async function autoAddRentalIncome() {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${now.getMonth() + 1}`;
    let changed = false;

    for (let i = 0; i < myAssets.length; i++) {
        const asset = myAssets[i];
        if (asset.usage !== 'rental' || !asset.rent) continue;
        if (asset.lastRentMonth === thisMonth) continue;

        const rentVal = parseFloat(asset.rent) || 0;
        if (rentVal <= 0) continue;

        // 构建当月1号的日期 key
        const targetKey = `${now.getFullYear()}-${now.getMonth() + 1}-1`;
        let finData = await getStorageData(`fin_${targetKey}`);
        let finList = Array.isArray(finData) ? finData : [];

        const rentLabel = meowI18n.t('assets_rental_income') || '租金收入';
        const qty = parseInt(asset.quantity) || 1;
        const noteName = asset.name || rentLabel;

        const finId = genFinId();
        finList.push({
            type: 'income',
            amount: (rentVal * qty).toFixed(2),
            note: `${noteName} - ${rentLabel}`,
            id: finId,
            tags: [{ text: rentLabel, color: '#f59e0b' }]
        });

        await new Promise(resolve => {
            chrome.storage.sync.set({ [`fin_${targetKey}`]: finList }, resolve);
        });

        myAssets[i].lastRentMonth = thisMonth;
        myAssets[i].rentFinId = finId;
        changed = true;
    }

    if (changed) {
        chrome.storage.sync.set({ 'meow_assets': myAssets });
    }
}

// === 删除某资产的租金收入记录 ===
async function removeAssetRentIncome(asset) {
    if (!asset || !asset.rentFinId || !asset.lastRentMonth) return false;

    const parts = asset.lastRentMonth.split('-');
    if (parts.length !== 2) return false;

    const targetKey = `${parts[0]}-${parts[1]}-1`;
    let finData = await getStorageData(`fin_${targetKey}`);
    let finList = Array.isArray(finData) ? finData : [];

    const idx = finList.findIndex(f => f.id === asset.rentFinId);
    if (idx > -1) {
        finList.splice(idx, 1);
        await new Promise(resolve => {
            chrome.storage.sync.set({ [`fin_${targetKey}`]: finList }, resolve);
        });
        return true;
    }
    return false;
}

// === 添加某资产的租金收入记录 ===
async function addAssetRentIncome(asset) {
    if (!asset || asset.usage !== 'rental' || !asset.rent) return false;

    const rentVal = parseFloat(asset.rent) || 0;
    if (rentVal <= 0) return false;

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const targetKey = `${now.getFullYear()}-${now.getMonth() + 1}-1`;

    let finData = await getStorageData(`fin_${targetKey}`);
    let finList = Array.isArray(finData) ? finData : [];

    const rentLabel = meowI18n.t('assets_rental_income') || '租金收入';
    const qty = parseInt(asset.quantity) || 1;
    const noteName = asset.name || rentLabel;
    const finId = genFinId();

    finList.push({
        type: 'income',
        amount: (rentVal * qty).toFixed(2),
        note: `${noteName} - ${rentLabel}`,
        id: finId,
        tags: [{ text: rentLabel, color: '#f59e0b' }]
    });

    await new Promise(resolve => {
        chrome.storage.sync.set({ [`fin_${targetKey}`]: finList }, resolve);
    });

    const idx = myAssets.findIndex(a => a.id === asset.id);
    if (idx > -1) {
        myAssets[idx].rentFinId = finId;
        myAssets[idx].lastRentMonth = thisMonth;
    }
    return true;
}

// === 编辑资产时同步租金收入 ===
async function syncRentalIncome(oldAsset, newAsset) {
    let changed = false;

    // 如果原来有租金记录，先删除旧记录
    if (oldAsset && oldAsset.rentFinId) {
        changed = await removeAssetRentIncome(oldAsset);
    }

    // 如果现在是出租且有租金，添加新记录
    if (newAsset && newAsset.usage === 'rental' && newAsset.rent) {
        changed = await addAssetRentIncome(newAsset) || changed;
    } else if (newAsset) {
        // 清除租金追踪字段
        const idx = myAssets.findIndex(a => a.id === newAsset.id);
        if (idx > -1) {
            myAssets[idx].rentFinId = null;
            myAssets[idx].lastRentMonth = null;
        }
    }

    return changed;
}

function saveAssets() {
    chrome.storage.sync.set({ 'meow_assets': myAssets }, () => {
        renderAssetsView();
    });
}

// === 生成唯一ID ===
function generateAssetId() {
    return 'asset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// === 渲染统计摘要 ===
function renderAssetsSummary() {
    if (!assetsSummary) return;
    const typeCounts = {};
    let totalCount = 0;
    myAssets.forEach(a => {
        const q = parseInt(a.quantity) || 1;
        typeCounts[a.type] = (typeCounts[a.type] || 0) + q;
        totalCount += q;
    });

    let html = '';
    Object.keys(ASSETS_TYPES).forEach(type => {
        const cfg = ASSETS_TYPES[type];
        const count = typeCounts[type] || 0;
        const unit = meowI18n.t(cfg.unit) || '';
        html += `
            <div class="assets-summary-card" style="border-color:${cfg.color}33;">
                <div class="assets-summary-icon" style="background:${cfg.color}1a;color:${cfg.color};">
                    <span class="material-icons" style="font-size:18px;">${cfg.icon}</span>
                </div>
                <div class="assets-summary-info">
                    <span class="assets-summary-count" style="color:${cfg.color};">${count}</span>
                    <span class="assets-summary-label">${meowI18n.t(cfg.label) || ''}${unit ? ' ' + unit : ''}</span>
                </div>
            </div>
        `;
    });
    assetsSummary.innerHTML = html;
}

// === 渲染视图 ===
function renderAssetsView() {
    if (!assetsList) return;

    // 渲染统计
    renderAssetsSummary();

    // 列表渲染
    assetsList.innerHTML = '';
    if (myAssets.length === 0) {
        assetsEmpty.classList.remove('hidden');
        assetsList.classList.add('hidden');
        return;
    }
    assetsEmpty.classList.add('hidden');
    assetsList.classList.remove('hidden');

    myAssets.forEach(asset => {
        const cfg = ASSETS_TYPES[asset.type] || ASSETS_TYPES.other;
        const pay = ASSETS_PAYMENTS[asset.payment] || ASSETS_PAYMENTS.full;
        const usage = ASSETS_USAGE[asset.usage] || ASSETS_USAGE['self-use'];
        const qty = parseInt(asset.quantity) || 1;

        const li = document.createElement('li');
        li.className = 'assets-item';
        li.dataset.id = asset.id;
        li.innerHTML = `
            <div class="assets-item-icon" style="background:${cfg.color}1a;color:${cfg.color};">
                <span class="material-icons" style="font-size:20px;">${cfg.icon}</span>
            </div>
            <div class="assets-item-body">
                <div class="assets-item-top">
                    <span class="assets-item-name">${escapeHtml(asset.name)}</span>
                    <span class="assets-item-payment" style="color:${pay.color};background:${pay.color}1a;">
                        <span class="material-icons" style="font-size:12px;">${pay.icon}</span>
                        ${meowI18n.t(pay.label) || pay.label}
                    </span>
                </div>
                <div class="assets-item-meta">
                    <span class="assets-item-type" style="color:${cfg.color};">${meowI18n.t(cfg.label) || cfg.label}</span>
                    <span class="assets-item-qty">×${qty}</span>
                    <span class="assets-item-usage" style="color:${usage.color};">
                        <span class="material-icons" style="font-size:12px;">${usage.icon}</span>
                        ${meowI18n.t(usage.label) || usage.label}
                    </span>
                    ${asset.usage === 'rental' && asset.rent ? `<span class="assets-item-rent" style="color:#f59e0b;"><span class="material-icons" style="font-size:12px;">payments</span>¥${parseFloat(asset.rent).toFixed(0)}/月</span>` : ''}
                    ${asset.note ? `<span class="assets-item-note">${escapeHtml(asset.note)}</span>` : ''}
                </div>
            </div>
            <span class="material-icons assets-item-edit" style="font-size:16px;color:#9ca3af;cursor:pointer;">edit</span>
        `;

        // 点击编辑
        const editBtn = li.querySelector('.assets-item-edit');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openAssetsModal(asset.id);
            });
        }
        li.addEventListener('click', () => openAssetsModal(asset.id));

        assetsList.appendChild(li);
    });
}

// === 打开弹窗 ===
function openAssetsModal(id = null) {
    editingAssetId = id;
    if (id) {
        // 编辑模式
        const asset = myAssets.find(a => a.id === id);
        if (!asset) return;
        assetsModalTitle.textContent = meowI18n.t('assets_btn_edit') || '编辑资产';
        assetsNameInput.value = asset.name || '';
        assetsTypeInput.value = asset.type || 'other';
        assetsQuantityInput.value = asset.quantity || '1';
        assetsPaymentInput.value = asset.payment || 'full';
        assetsUsageInput.value = asset.usage || 'self-use';
        assetsRentInput.value = asset.rent || '';
        if (assetsRentCol) assetsRentCol.classList.toggle('hidden', (asset.usage || 'self-use') !== 'rental');
        assetsNoteInput.value = asset.note || '';
        assetsDeleteBtn.classList.remove('hidden');
    } else {
        // 新增模式
        assetsModalTitle.textContent = meowI18n.t('assets_btn_add') || '添加资产';
        assetsNameInput.value = '';
        assetsTypeInput.value = 'property';
        assetsQuantityInput.value = '1';
        assetsPaymentInput.value = 'full';
        assetsUsageInput.value = 'self-use';
        assetsRentInput.value = '';
        if (assetsRentCol) assetsRentCol.classList.add('hidden');
        assetsNoteInput.value = '';
        assetsDeleteBtn.classList.add('hidden');
    }
    assetsModal.classList.remove('hidden');
    requestAnimationFrame(() => {
        assetsModal.classList.add('visible');
    });
    setTimeout(() => assetsNameInput.focus(), 100);
}

function closeAssetsModalFn() {
    assetsModal.classList.remove('visible');
    setTimeout(() => {
        assetsModal.classList.add('hidden');
        editingAssetId = null;
    }, 200);
}

// === 保存资产 ===
async function handleAssetsSave() {
    const name = assetsNameInput.value.trim();
    if (!name) {
        showToast(meowI18n.t('assets_msg_name_required') || '请输入名称');
        assetsNameInput.focus();
        return;
    }

    const qty = parseInt(assetsQuantityInput.value) || 1;
    const assetData = {
        name: name,
        type: assetsTypeInput.value,
        quantity: Math.max(1, qty),
        payment: assetsPaymentInput.value,
        usage: assetsUsageInput.value,
        rent: assetsUsageInput.value === 'rental' ? (assetsRentInput.value || '') : '',
        note: assetsNoteInput.value.trim()
    };

    let financeChanged = false;

    if (editingAssetId) {
        // 更新
        const idx = myAssets.findIndex(a => a.id === editingAssetId);
        if (idx > -1) {
            const oldAsset = { ...myAssets[idx] };
            myAssets[idx] = { ...myAssets[idx], ...assetData };
            // 同步租金收入：出租↔自用切换、租金/数量/名称变化
            financeChanged = await syncRentalIncome(oldAsset, myAssets[idx]);
        }
    } else {
        // 新增
        assetData.id = generateAssetId();
        assetData.createdAt = new Date().toISOString();
        myAssets.push(assetData);
        // 新增的出租资产立即计入当月租金
        if (assetData.usage === 'rental' && assetData.rent) {
            financeChanged = await addAssetRentIncome(assetData);
        }
    }

    saveAssets();

    // 财务数据有变化时刷新财务视图和日历
    if (financeChanged) {
        await loadAndRenderFinanceList(selectedDateKey);
        renderFinanceView();
        renderCalendar();
    }

    closeAssetsModalFn();
    showToast(meowI18n.t('assets_msg_saved') || '已保存');
}

// === 删除资产 ===
async function handleAssetsDelete() {
    if (!editingAssetId) return;
    if (await showConfirmDialog({ message: meowI18n.t('assets_msg_confirm_delete') || '确认删除？', type: 'danger' })) {
        // 先删除对应的租金收入记录
        const asset = myAssets.find(a => a.id === editingAssetId);
        let financeChanged = false;
        if (asset) {
            financeChanged = await removeAssetRentIncome(asset);
        }
        myAssets = myAssets.filter(a => a.id !== editingAssetId);
        saveAssets();

        if (financeChanged) {
            await loadAndRenderFinanceList(selectedDateKey);
            renderFinanceView();
            renderCalendar();
        }

        closeAssetsModalFn();
        showToast(meowI18n.t('assets_msg_deleted') || '已删除');
    }
}

// === 使用状态切换 → 显示/隐藏租金输入 ===
if (assetsUsageInput && assetsRentCol) {
    assetsUsageInput.addEventListener('change', () => {
        assetsRentCol.classList.toggle('hidden', assetsUsageInput.value !== 'rental');
        if (assetsUsageInput.value === 'rental') {
            setTimeout(() => assetsRentInput.focus(), 50);
        }
    });
}

// === AI 开关事件 ===
if (assetsAiToggleInput) {
    assetsAiToggleInput.addEventListener('change', () => {
        assetsAiEnabled = assetsAiToggleInput.checked;
        chrome.storage.sync.set({ 'meow_assets_ai_enabled': assetsAiEnabled });
    });
}

// === 事件绑定 ===
if (assetsAddBtn) {
    assetsAddBtn.addEventListener('click', () => openAssetsModal());
}
if (closeAssetsModal) {
    closeAssetsModal.addEventListener('click', closeAssetsModalFn);
}
if (assetsSaveBtn) {
    assetsSaveBtn.addEventListener('click', handleAssetsSave);
}
if (assetsDeleteBtn) {
    assetsDeleteBtn.addEventListener('click', handleAssetsDelete);
}
// 点击遮罩关闭
if (assetsModal) {
    assetsModal.addEventListener('click', (e) => {
        if (e.target === assetsModal) closeAssetsModalFn();
    });
}
// 回车保存
if (assetsNameInput) {
    assetsNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAssetsSave();
        }
    });
}
