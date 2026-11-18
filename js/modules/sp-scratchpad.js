// sp-scratchpad.js - 便签模块（列表渲染、编辑、粘贴处理）
// 此文件由 sidepanel.js 拆分而来

// ================== SCRATCHPAD 逻辑 ==================
if (scratchHeader && scratchBody) {
    scratchHeader.addEventListener('click', function() {
        scratchBody.classList.toggle('expanded');
        scratchHeader.classList.toggle('active');
    });
}

function addPasteHandler(element) {
    if (!element) return;
    element.addEventListener('paste', function(e) {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") === 0) {
                e.preventDefault();
                const reader = new FileReader();
                reader.onload = function(event) { document.execCommand('insertHTML', false, '<img src="' + event.target.result + '">'); };
                reader.readAsDataURL(items[i].getAsFile());
            }
        }
    });
}

// ================== 暂存板卡片拖拽排序 ==================
// 交互与「服务器管理」卡片一致：卡片标题行（时间行）是唯一拖拽手柄，
// 左侧 grip 图标提示可拖拽，松手后按新顺序落盘。

// 保证每条暂存记录都有 order 字段：早期数据按原本的展示顺序（时间倒序）铺开一次，
// 之后 order 就是用户拖拽出来的顺序，编辑内容不再把卡片顶到最前。
function ensureScratchOrder() {
    const missing = myScratchList.filter(s => !Number.isFinite(s.order));
    if (!missing.length) return false;
    if (missing.length === myScratchList.length) {
        myScratchList.slice().sort((a, b) => (b.time || 0) - (a.time || 0)).forEach((s, i) => { s.order = i; });
    } else {
        // 个别新记录缺 order（例如右键菜单保存的）：放到最前面
        let min = Infinity;
        myScratchList.forEach(s => { if (Number.isFinite(s.order)) min = Math.min(min, s.order); });
        if (!Number.isFinite(min)) min = 0;
        missing.sort((a, b) => (a.time || 0) - (b.time || 0)).forEach(s => { s.order = --min; });
    }
    return true;
}

// 新增暂存记录的 order：排在现有卡片最前面
function nextScratchOrder() {
    let min = 0;
    myScratchList.forEach(s => { if (Number.isFinite(s.order)) min = Math.min(min, s.order); });
    return min - 1;
}

// 可见卡片占据的 order 槽位固定不变，只把可见记录按新顺序填回这些槽位，
// 被搜索过滤掉的卡片保持原位。
function applyScratchVisibleOrder(visibleIds) {
    const byId = new Map(myScratchList.map(s => [String(s.id), s]));
    const visible = visibleIds.map(id => byId.get(String(id))).filter(Boolean);
    if (visible.length < 2) return false;
    const visibleSet = new Set(visible);
    const slots = myScratchList.filter(s => visibleSet.has(s)).map(s => s.order).sort((a, b) => a - b);
    let changed = false;
    visible.forEach((s, i) => {
        if (s.order !== slots[i]) { s.order = slots[i]; changed = true; }
    });
    return changed;
}

function setupScratchCardDrag() {
    if (!scratchList || typeof setupCardDragSort !== 'function') return;
    setupCardDragSort({
        container: scratchList,
        cardSelector: '.scratch-card',
        headerSelector: '.scratch-meta',
        handleClass: 'scratch-drag-handle',
        ignoreSelector: '.delete-btn',
        placeholderClass: 'scratch-drop-placeholder',
        placeholderTag: 'li',
        boundKey: 'scratchDragBound',
        onReorder: function (visibleIds) {
            if (!applyScratchVisibleOrder(visibleIds)) return;
            saveData();
            renderScratchList();
        }
    });
}

function renderScratchList() {
    ensureScratchOrder();
    scratchList.innerHTML = '';
    let sorted = myScratchList.slice().sort((a, b) => (a.order - b.order) || ((b.time || 0) - (a.time || 0)));
    const searchTerm = searchScratchInput.value.toLowerCase();
    if (searchTerm) sorted = sorted.filter(s => s.content && s.content.toLowerCase().indexOf(searchTerm) !== -1);
    if (sorted.length === 0) { scratchEmpty.classList.remove('hidden'); } else {
        scratchEmpty.classList.add('hidden');
        sorted.forEach(item => {
            const li = document.createElement('li');
            li.className = 'scratch-card';
            li.dataset.id = item.id;
            li.innerHTML = '<div class="scratch-meta"><span>' + formatTime(item.time) + '</span><i class="fa-regular fa-xmark delete-btn" title="' + meowI18n.t('action_delete') + '"></i></div><div class="scratch-content">' + sanitizeHtml(item.content) + '</div>';
            li.addEventListener('click', function(e) { if (e.target.closest('.delete-btn') || e.target.closest('.scratch-drag-handle')) return; openScratchEditModal(item); });
            li.querySelector('.delete-btn').addEventListener('click', async function(e) { e.stopPropagation(); if(await showConfirmDialog({ message: meowI18n.t('msg_confirm_del'), type: 'danger' })) { myScratchList = myScratchList.filter(s => s.id !== item.id); saveData(); renderScratchList(); } });
            scratchList.appendChild(li);
        });
    }
    // 拖拽排序见 setupScratchCardDrag()：标题行是拖拽手柄，事件统一在列表上委托
    setupScratchCardDrag();
}

function openScratchEditModal(item) {
    currentScratchEditId = item.id;
    scratchModalInput.innerHTML = sanitizeHtml(item.content);
    scratchEditModal.classList.remove('hidden');
    setTimeout(() => { scratchModalInput.focus(); updateScratchImgSelection(); }, 100);
}

function closeScratchEditModal() {
    scratchEditModal.classList.add('hidden');
    currentScratchEditId = null;
}

if (scratchModalSaveBtn) {
    scratchModalSaveBtn.addEventListener('click', function() {
        const newContent = sanitizeHtml(scratchModalInput.innerHTML).trim(); if (!newContent) { showToast(meowI18n.t('msg_empty')); return; }
        const index = myScratchList.findIndex(s => s.id === currentScratchEditId);
        if (index !== -1) { myScratchList[index].content = newContent; myScratchList[index].time = Date.now(); saveData(); renderScratchList(); showToast(meowI18n.t('msg_saved')); closeScratchEditModal(); }
    });
}

if (scratchModalCancelBtn) scratchModalCancelBtn.addEventListener('click', closeScratchEditModal);
if (closeScratchModalBtn) closeScratchModalBtn.addEventListener('click', closeScratchEditModal);
// 点击遮罩层不关闭弹窗且不丢失焦点（与服务器弹窗行为一致）
scratchEditModal.addEventListener('mousedown', function(e) { if (e.target === scratchEditModal) e.preventDefault(); });

if (scratchModalSelectAllBtn) {
    scratchModalSelectAllBtn.addEventListener('click', function() {
        scratchModalInput.focus();
        const range = document.createRange();
        range.selectNodeContents(scratchModalInput);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        updateScratchImgSelection();
    });
}

// 监听选区变化，为选中的图片添加高亮边框
function updateScratchImgSelection() {
    const imgs = scratchModalInput.querySelectorAll('img');
    imgs.forEach(img => img.classList.remove('selected'));
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        imgs.forEach(img => {
            if (range.intersectsNode(img) && sel.containsNode(img, true)) {
                img.classList.add('selected');
            }
        });
    }
}

scratchModalInput.addEventListener('click', function() { setTimeout(updateScratchImgSelection, 0); });
scratchModalInput.addEventListener('keyup', function() { setTimeout(updateScratchImgSelection, 0); });
document.addEventListener('selectionchange', function() {
    if (!scratchEditModal.classList.contains('hidden')) {
        const activeEl = document.activeElement;
        if (activeEl === scratchModalInput || (activeEl && scratchModalInput.contains(activeEl))) {
            updateScratchImgSelection();
        }
    }
});

if (scratchModalCopyBtn) {
    scratchModalCopyBtn.addEventListener('click', function() {
        const text = scratchModalInput.innerText || scratchModalInput.textContent;
        if (!text.trim()) { showToast(meowI18n.t('msg_empty')); return; }
        copyToClipboard(text, scratchModalCopyBtn);
    });
}

closeTextViewModal.addEventListener('click', function() { textViewModal.classList.add('hidden'); textViewContent.innerHTML = ''; });

scratchAddBtn.addEventListener('click', function() {
    const html = sanitizeHtml(scratchInput.innerHTML).trim(), text = scratchInput.innerText.trim();
    if (!text && html.indexOf('<img') === -1) { showToast(meowI18n.t('msg_empty')); return; }
    myScratchList.push({ id: Date.now(), content: html, time: Date.now(), order: nextScratchOrder() });
    scratchInput.innerHTML = ''; saveData(); renderScratchList(); showToast(meowI18n.t('msg_saved'));
});

scratchClearBtn.addEventListener('click', async function() { if (myScratchList.length === 0) return; if (await showConfirmDialog({ message: meowI18n.t('msg_confirm_clear'), type: 'warning' })) { myScratchList = []; saveData(); renderScratchList(); showToast(meowI18n.t('msg_deleted')); } });
