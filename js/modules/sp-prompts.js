// sp-prompts.js - AI 提示词模块（分类、筛选、列表渲染、增删改）
// 此文件由 sidepanel.js 拆分而来

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
            const catObj = promptCategories.find(c => c.id === item.category);
            const defaultIds = ['chatgpt', 'midjourney', 'sd', 'claude', 'other'];
            const tagClass = defaultIds.indexOf(item.category) !== -1 ? 'tag-' + item.category : 'tag-custom';
            li.innerHTML = '<div class="p-header"><span class="p-title">' + escapeHtml(item.title || meowI18n.t('ph_title')) + '</span><span class="p-tag ' + tagClass + '">' + escapeHtml(catObj ? catObj.name : 'Unknown') + '</span></div><div class="p-content">' + escapeHtml(item.content) + '</div><div class="p-actions"><span class="copy-hint" id="hint-' + item.id + '"><span class="material-icons" style="font-size:12px">content_copy</span> ' + meowI18n.t('action_copy') + '</span><div class="action-group"><span class="material-icons edit-btn">edit</span><span class="material-icons delete-btn">delete</span></div></div>';
            li.addEventListener('click', function(e) { if (e.target.closest('.action-group')) return; copyToClipboard(item.content, li.querySelector('#hint-' + item.id)); });
            li.querySelector('.edit-btn').addEventListener('click', function(e) { e.stopPropagation(); startEditing(item); });
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
