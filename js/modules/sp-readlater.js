// sp-readlater.js - 稍后阅读模块
// 此文件由 sidepanel.js 拆分而来

// ================== READ LATER ==================

// 可见卡片占据的数组槽位固定不变，只把可见条目按新顺序填回这些槽位，
// 被搜索过滤掉的条目保持原位（与提示词/暂存板的筛选语义一致）。
function applyReadLaterVisibleOrder(visibleIds) {
    const byId = new Map(myReadLaterList.map(item => [String(item.id), item]));
    const visible = visibleIds.map(id => byId.get(String(id))).filter(Boolean);
    if (visible.length < 2) return false;
    const visibleSet = new Set(visible);
    const slots = [];
    myReadLaterList.forEach((item, i) => { if (visibleSet.has(item)) slots.push(i); });
    const next = myReadLaterList.slice();
    let changed = false;
    visible.forEach((item, i) => {
        if (next[slots[i]] !== item) { next[slots[i]] = item; changed = true; }
    });
    if (changed) myReadLaterList = next;
    return changed;
}

// 卡片拖拽排序：标题行是唯一拖拽手柄（左侧 grip 图标），
// 交互与服务器管理/AI Provider 卡片一致（见 card-drag.js）。
function setupReadLaterCardDrag() {
    if (!readLaterList || typeof setupCardDragSort !== 'function') return;
    setupCardDragSort({
        container: readLaterList,
        cardSelector: '.scratch-card',
        headerSelector: '.rl-title',
        handleClass: 'readlater-drag-handle',
        placeholderClass: 'readlater-drop-placeholder',
        placeholderTag: 'li',
        boundKey: 'readLaterDragBound',
        onReorder: function (visibleIds) {
            // 数组顺序即展示顺序，重排后落盘；顺序没变则不写
            if (!applyReadLaterVisibleOrder(visibleIds)) return;
            saveData();
        }
    });
}

function renderReadLaterList() {
    readLaterList.innerHTML = '';
    let filtered = myReadLaterList.slice();
    const searchTerm = searchReadLaterInput.value.toLowerCase();
    if (searchTerm) filtered = filtered.filter(item => (item.title && item.title.toLowerCase().indexOf(searchTerm) !== -1) || (item.url && item.url.toLowerCase().indexOf(searchTerm) !== -1));
    if (filtered.length === 0) { readLaterEmpty.classList.remove('hidden'); } else {
        readLaterEmpty.classList.add('hidden');
        filtered.forEach(item => {
            const li = document.createElement('li');
            li.className = 'scratch-card';
            li.dataset.id = item.id;
            const faviconImg = (item.favIconUrl && isSafeHtmlUrl(item.favIconUrl)) ? '<img class="rl-icon" src="' + escapeHtml(item.favIconUrl) + '" alt="">' : '<span class="mi fa-regular fa-globe rl-icon rl-icon-fallback"></span>';
            li.innerHTML = '<div class="rl-title">' + faviconImg + '<span class="rl-title-text">' + escapeHtml(item.title || 'No Title') + '</span></div><div class="rl-url">' + escapeHtml(item.url) + '</div><div class="scratch-meta"><span>' + formatTime(item.time) + '</span></div><div class="scratch-actions"><span class="s-action open"><span class="mi fa-regular fa-arrow-up-right-from-square" style="font-size:14px"></span> ' + meowI18n.t('action_open') + '</span><span class="s-action copy"><span class="mi fa-regular fa-copy" style="font-size:14px"></span> ' + meowI18n.t('action_copy') + '</span><span class="s-action del"><i class="fa-regular fa-xmark" style="font-size:14px"></i> ' + meowI18n.t('action_delete') + '</span></div>';
            li.querySelector('.open').addEventListener('click', function() { chrome.tabs.create({ url: item.url }); });
            li.querySelector('.copy').addEventListener('click', function() { copyToClipboard(item.url, this); });
            li.querySelector('.del').addEventListener('click', function() { myReadLaterList = myReadLaterList.filter(s => s.id !== item.id); saveData(); renderReadLaterList(); });
            readLaterList.appendChild(li);
        });
    }
    // 拖拽排序见 setupReadLaterCardDrag()：标题行是拖拽手柄，事件统一在列表上委托
    setupReadLaterCardDrag();
}
if (readLaterClearBtn) readLaterClearBtn.addEventListener('click', async function() { if (myReadLaterList.length === 0) return; if (await showConfirmDialog({ message: meowI18n.t('msg_confirm_clear'), type: 'warning' })) { myReadLaterList = []; saveData(); renderReadLaterList(); showToast(meowI18n.t('msg_deleted')); } });
