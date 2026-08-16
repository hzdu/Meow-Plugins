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

function renderPromptList() {
    listContainer.innerHTML = '';
    let filtered = (currentFilter === 'all') ? myPrompts : myPrompts.filter(p => p.category === currentFilter);
    const searchTerm = searchPromptsInput.value.toLowerCase();
    if (searchTerm) filtered = filtered.filter(p => (p.title && p.title.toLowerCase().indexOf(searchTerm) !== -1) || (p.content && p.content.toLowerCase().indexOf(searchTerm) !== -1));
    filtered.sort((a, b) => b.id - a.id);

    if (filtered.length === 0) { emptyState.classList.remove('hidden'); } else {
        emptyState.classList.add('hidden');
        filtered.forEach(item => {
            const li = document.createElement('li');
            li.className = 'prompt-card';
            let catOptionsHtml = '';
            promptCategories.forEach(cat => { catOptionsHtml += '<option value="' + cat.id + '"' + (cat.id === item.category ? ' selected' : '') + '>' + escapeHtml(cat.name) + '</option>'; });
            li.innerHTML = '<div class="p-header"><span class="p-title">' + escapeHtml(item.title || meowI18n.t('ph_title')) + '</span><select class="p-cat-select">' + catOptionsHtml + '</select></div><div class="p-content">' + escapeHtml(item.content) + '</div><div class="p-actions"><div class="action-group"><span class="material-icons delete-btn">delete</span></div></div>';
            li.addEventListener('click', function(e) { if (e.target.closest('.action-group') || e.target.closest('.p-cat-select')) return; openPromptViewModal(item); });
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
        if (index !== -1) myPrompts[index] = { id: editingPromptId, title: title, content: content, category: category };
        showToast(meowI18n.t('msg_saved')); exitEditing();
    } else {
        myPrompts.push({ id: Date.now(), title: title, content: content, category: category });
        titleInput.value = ''; contentInput.value = ''; showToast(meowI18n.t('msg_saved'));
        if (currentFilter !== 'all' && currentFilter !== category) { currentFilter = 'all'; renderFilters(); }
    }
    saveData(); renderPromptList();
});
