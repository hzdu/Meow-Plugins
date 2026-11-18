// sp-prompts.js - AI 提示词模块（分类、筛选、列表渲染、增删改）
// 此文件由 sidepanel.js 拆分而来

// ================== 提示词查看/编辑 Modal ==================
const promptViewModal = document.getElementById('prompt-view-modal');
const promptViewTitleInput = document.getElementById('prompt-view-title-input');
const promptViewTextarea = document.getElementById('prompt-view-textarea');
const promptViewSelectAllBtn = document.getElementById('prompt-view-selectall-btn');
const promptViewCopyBtn = document.getElementById('prompt-view-copy-btn');
const promptViewCancelBtn = document.getElementById('prompt-view-cancel-btn');
const promptViewSaveBtn = document.getElementById('prompt-view-save-btn');
const closePromptViewModal = document.getElementById('close-prompt-view-modal');
let currentViewingPromptId = null;

function openPromptViewModal(item) {
    currentViewingPromptId = item.id;
    promptViewTitleInput.value = item.title || '';
    promptViewTextarea.value = item.content || '';
    promptViewModal.classList.remove('hidden');
    setTimeout(() => { promptViewTextarea.focus(); }, 100);
}

function closePromptViewModalFn() {
    promptViewModal.classList.add('hidden');
    currentViewingPromptId = null;
}

closePromptViewModal.addEventListener('click', closePromptViewModalFn);
promptViewCancelBtn.addEventListener('click', closePromptViewModalFn);
// 点击遮罩层不关闭弹窗且不丢失焦点（与服务器弹窗行为一致）
promptViewModal.addEventListener('mousedown', function(e) { if (e.target === promptViewModal) e.preventDefault(); });

promptViewSelectAllBtn.addEventListener('click', function() {
    promptViewTextarea.focus();
    promptViewTextarea.select();
});

promptViewCopyBtn.addEventListener('click', function() {
    const text = promptViewTextarea.value;
    if (!text) { showToast(meowI18n.t('msg_empty')); return; }
    copyToClipboard(text, promptViewCopyBtn);
});

promptViewSaveBtn.addEventListener('click', function() {
    if (currentViewingPromptId === null) return;
    const newTitle = promptViewTitleInput.value.trim();
    const newContent = promptViewTextarea.value;
    if (!newContent.trim()) { showToast(meowI18n.t('msg_empty')); return; }
    const index = myPrompts.findIndex(p => p.id === currentViewingPromptId);
    if (index !== -1) {
        myPrompts[index].title = newTitle;
        myPrompts[index].content = newContent;
        saveData();
        renderPromptList();
        showToast(meowI18n.t('msg_saved'));
    }
    closePromptViewModalFn();
});

// ================== PROMPTS 逻辑 ==================
if (promptHeader && promptBody) {
    promptHeader.addEventListener('click', function() {
        promptBody.classList.toggle('expanded');
        promptHeader.classList.toggle('active');
    });
}

function renderCategories() {
    const currentVal = categorySelect.value;
    let html = '';
    promptCategories.forEach(cat => { html += '<option value="' + cat.id + '">' + escapeHtml(cat.name) + '</option>'; });
    categorySelect.innerHTML = html;
    if (promptCategories.some(c => c.id === currentVal)) categorySelect.value = currentVal;
}

function renderFilters() {
    const displayTextAll = (meowI18n.lang.indexOf('zh') !== -1) ? '全部' : 'All';
    let html = '<button class="filter-btn' + (currentFilter === 'all' ? ' active' : '') + '" data-id="all">' + displayTextAll + '</button>';
    promptCategories.forEach(cat => { html += '<button class="filter-btn' + (currentFilter === cat.id ? ' active' : '') + '" data-id="' + cat.id + '">' + escapeHtml(cat.name) + '</button>'; });
    filterContainer.innerHTML = html;
    filterContainer.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() { currentFilter = btn.dataset.id; renderFilters(); renderPromptList(); });
    });
}

// ================== 提示词卡片拖拽排序 ==================
// 交互与「服务器管理」卡片一致：标题行是唯一拖拽手柄（左侧 grip 图标提示，
// 与侧边栏服务器管理卡片的 grip 手柄相同），松手后按新顺序落盘。

// 保证每条提示词都有 order 字段：早期数据按原本的展示顺序（id 倒序）铺开一次，
// 之后 order 就是用户拖拽出来的顺序。
function ensurePromptOrder() {
    const missing = myPrompts.filter(p => !Number.isFinite(p.order));
    if (!missing.length) return false;
    if (missing.length === myPrompts.length) {
        myPrompts.slice().sort((a, b) => b.id - a.id).forEach((p, i) => { p.order = i; });
    } else {
        // 个别新记录缺 order：放到最前面，与「新增在最上」的观感一致
        let min = Infinity;
        myPrompts.forEach(p => { if (Number.isFinite(p.order)) min = Math.min(min, p.order); });
        if (!Number.isFinite(min)) min = 0;
        missing.sort((a, b) => a.id - b.id).forEach(p => { p.order = --min; });
    }
    return true;
}

// 新增提示词的 order：排在现有卡片最前面
function nextPromptOrder() {
    let min = 0;
    myPrompts.forEach(p => { if (Number.isFinite(p.order)) min = Math.min(min, p.order); });
    return min - 1;
}

// 可见卡片占据的 order 槽位固定不变，只把可见记录按新顺序填回这些槽位，
// 被分类/搜索过滤掉的卡片保持原位。
function applyPromptVisibleOrder(visibleIds) {
    const byId = new Map(myPrompts.map(p => [String(p.id), p]));
    const visible = visibleIds.map(id => byId.get(String(id))).filter(Boolean);
    if (visible.length < 2) return false;
    const visibleSet = new Set(visible);
    const slots = myPrompts.filter(p => visibleSet.has(p)).map(p => p.order).sort((a, b) => a - b);
    let changed = false;
    visible.forEach((p, i) => {
        if (p.order !== slots[i]) { p.order = slots[i]; changed = true; }
    });
    return changed;
}

function setupPromptCardDrag() {
    if (!listContainer || typeof setupCardDragSort !== 'function') return;
    setupCardDragSort({
        container: listContainer,
        cardSelector: '.prompt-card',
        headerSelector: '.p-header',
        handleClass: 'prompt-drag-handle',
        ignoreSelector: '.p-cat-select, .delete-btn',
        placeholderClass: 'prompt-drop-placeholder',
        placeholderTag: 'li',
        boundKey: 'promptDragBound',
        onReorder: function (visibleIds) {
            if (!applyPromptVisibleOrder(visibleIds)) return;
            saveData();
            renderPromptList();
        }
    });
}

function renderPromptList() {
    ensurePromptOrder();
    listContainer.innerHTML = '';
    let filtered = (currentFilter === 'all') ? myPrompts : myPrompts.filter(p => p.category === currentFilter);
    const searchTerm = searchPromptsInput.value.toLowerCase();
    if (searchTerm) filtered = filtered.filter(p => (p.title && p.title.toLowerCase().indexOf(searchTerm) !== -1) || (p.content && p.content.toLowerCase().indexOf(searchTerm) !== -1));
    filtered.sort((a, b) => (a.order - b.order) || (b.id - a.id));

    if (filtered.length === 0) { emptyState.classList.remove('hidden'); } else {
        emptyState.classList.add('hidden');
        filtered.forEach(item => {
            const li = document.createElement('li');
            li.className = 'prompt-card';
            li.dataset.id = item.id;
            let catOptionsHtml = '';
            promptCategories.forEach(cat => { catOptionsHtml += '<option value="' + cat.id + '"' + (cat.id === item.category ? ' selected' : '') + '>' + escapeHtml(cat.name) + '</option>'; });
            li.innerHTML = '<div class="p-header"><span class="p-title">' + escapeHtml(item.title || meowI18n.t('ph_title')) + '</span><span class="p-header-right"><select class="p-cat-select">' + catOptionsHtml + '</select><i class="fa-regular fa-xmark delete-btn" title="' + meowI18n.t('action_delete') + '"></i></span></div><div class="p-content">' + escapeHtml(item.content) + '</div>';
            li.addEventListener('click', function(e) { if (e.target.closest('.delete-btn') || e.target.closest('.p-cat-select') || e.target.closest('.prompt-drag-handle')) return; openPromptViewModal(item); });
            li.querySelector('.p-cat-select').addEventListener('change', function(e) {
                e.stopPropagation();
                const index = myPrompts.findIndex(p => p.id === item.id);
                if (index !== -1) {
                    myPrompts[index].category = e.target.value;
                    saveData();
                    if (currentFilter !== 'all' && currentFilter !== e.target.value) {
                        renderPromptList();
                    } else {
                        renderFilters();
                    }
                    showToast(meowI18n.t('msg_saved'));
                }
            });
            li.querySelector('.delete-btn').addEventListener('click', async function(e) { e.stopPropagation(); if (await showConfirmDialog({ message: meowI18n.t('msg_confirm_del'), type: 'danger' })) { myPrompts = myPrompts.filter(p => p.id !== item.id); saveData(); if(editingPromptId === item.id) exitEditing(); renderPromptList(); } });
            listContainer.appendChild(li);
        });
    }
    // 拖拽排序见 setupPromptCardDrag()：标题行是拖拽手柄，事件统一在列表上委托
    setupPromptCardDrag();
}

function startEditing(item) {
    editingPromptId = item.id; titleInput.value = item.title; contentInput.value = item.content; categorySelect.value = item.category;
    addBtn.textContent = meowI18n.t('action_save'); cancelBtn.classList.remove('hidden'); contentInput.focus();
    if (promptBody && !promptBody.classList.contains('expanded')) { promptBody.classList.add('expanded'); promptHeader.classList.add('active'); }
}

function exitEditing() { editingPromptId = null; titleInput.value = ''; contentInput.value = ''; addBtn.textContent = meowI18n.t('action_add_prompt'); cancelBtn.classList.add('hidden'); }

cancelBtn.addEventListener('click', exitEditing);
addBtn.addEventListener('click', function() {
    const title = titleInput.value.trim(), content = contentInput.value.trim(), category = categorySelect.value;
    if (!content) { showToast(meowI18n.t('msg_empty')); return; }
    if (editingPromptId) {
        const index = myPrompts.findIndex(p => p.id === editingPromptId);
        // 保留原有 order：编辑内容不应打乱用户拖拽出来的顺序
        if (index !== -1) myPrompts[index] = { id: editingPromptId, title: title, content: content, category: category, order: myPrompts[index].order };
        showToast(meowI18n.t('msg_saved')); exitEditing();
    } else {
        myPrompts.push({ id: Date.now(), title: title, content: content, category: category, order: nextPromptOrder() });
        titleInput.value = ''; contentInput.value = ''; showToast(meowI18n.t('msg_saved'));
        if (currentFilter !== 'all' && currentFilter !== category) { currentFilter = 'all'; renderFilters(); }
    }
    saveData(); renderPromptList();
});
