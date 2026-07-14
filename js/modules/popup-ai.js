// popup-ai.js - AI Provider + AI Setting
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === AI Provider 模块 ===
function saveAIProviders() {
    chrome.storage.local.set({ 'meow_ai_providers': myAiProviders });
}

function renderAIProviders() {
    if (!aiList) { console.error('ai-list element not found'); return; }
    if (!aiEmpty) { console.error('ai-empty element not found'); return; }
    aiList.innerHTML = '';

    const filterText = (aiFilterInput ? aiFilterInput.value.trim().toLowerCase() : '');

    if (myAiProviders.length === 0) {
        aiEmpty.querySelector('p').innerHTML = meowI18n.t('ai_empty') ? '' : '暂无 AI Provider<br>点击上方 + 添加';
        aiEmpty.classList.remove('hidden');
        return;
    }

    let hasVisible = false;

    myAiProviders.forEach((provider, index) => {
        // 过滤：匹配标题或 Model
        let matchFilter = true;
        if (filterText) {
            const title = (provider.title || '').toLowerCase();
            const models = Array.isArray(provider.models) ? provider.models : (provider.model ? [provider.model] : []);
            const modelsStr = models.join(' ').toLowerCase();
            matchFilter = title.includes(filterText) || modelsStr.includes(filterText);
        }

        const card = document.createElement('div');
        card.className = 'ai-card';
        card.dataset.id = provider.id;

        // 兼容旧数据：单个 baseUrl 字符串 → 转为数组
        const urls = Array.isArray(provider.baseUrls) ? provider.baseUrls : (provider.baseUrl ? [provider.baseUrl] : []);
        const models = Array.isArray(provider.models) ? provider.models : (provider.model ? [provider.model] : []);
        const safeKey = escapeHtml(provider.key);
        const nameDisplay = provider.title ? escapeHtml(provider.title) : (urls.length > 0 ? escapeHtml(urls[0].replace(/^https?:\/\//, '').split('/')[0] || urls[0]) : 'AI Provider');
        const maskedKey = safeKey.length > 8 ? safeKey.slice(0, 4) + '••••' + safeKey.slice(-4) : '••••••••';

        const urlsHtml = urls.map((url, i) =>
            `<div class="ai-card-url" data-idx="${i}" title="点击复制 Base URL"><span class="material-icons">link</span>${escapeHtml(url)}</div>`
        ).join('');

        const modelsHtml = models.map((m, i) =>
            `<div class="ai-card-model" data-idx="${i}" title="点击复制 Model"><span class="material-icons">smart_toy</span><span class="badge">${escapeHtml(m)}</span></div>`
        ).join('');

        const apiType = provider.apiType || 'openai';
        const typeLabel = apiType === 'anthropic' ? 'Anthropic' : 'OpenAI';
        const typeIcon = apiType === 'anthropic' ? 'history' : 'api';
        const officialLink = provider.officialUrl ? escapeHtml(provider.officialUrl) : '';
        const hasNote = provider.note && provider.note.trim();

        card.innerHTML = `
            <div class="ai-card-header">
                <span class="material-icons ai-card-toggle">expand_more</span>
                <span class="ai-card-name">${nameDisplay}</span>
                <div class="ai-card-actions">
                    <span class="material-icons ai-apply-btn" title="应用到 AI Setting" style="font-size:16px;color:#8b5cf6;">play_arrow</span>
                    ${hasNote ? `<span class="material-icons ai-note-btn" title="查看备注">description</span>` : ''}
                    ${officialLink ? `<a class="ai-official-link" href="${officialLink}" target="_blank" title="打开官网" onclick="event.stopPropagation()"><span class="material-icons">open_in_new</span></a>` : ''}
                    <span class="material-icons ai-edit-btn" data-id="${provider.id}">edit</span>
                    <span class="material-icons ai-del-btn" data-id="${provider.id}">close</span>
                </div>
            </div>
            <div class="ai-card-body" style="display:none">
                <div class="ai-card-type-row" title="${typeLabel}">
                    <span class="material-icons">${typeIcon}</span>
                    <span class="badge type-badge">${typeLabel}</span>
                </div>
                ${urlsHtml}
                <div class="ai-card-key-row" title="点击复制 API Key">
                    <span class="material-icons">key</span>
                    <span class="ai-card-key-masked">${maskedKey}</span>
                </div>
                ${modelsHtml}
            </div>
        `;

        // 点击卡片头部切换展开/收起
        card.querySelector('.ai-card-header').addEventListener('click', function(e) {
            // 如果点击的是操作按钮（edit/del），不触发切换（它们有 stopPropagation）
            if (e.target.closest('.ai-card-actions, .ai-official-link')) return;
            const body = card.querySelector('.ai-card-body');
            const toggle = card.querySelector('.ai-card-toggle');
            const isExpanded = card.classList.toggle('expanded');
            body.style.display = isExpanded ? '' : 'none';
            toggle.textContent = isExpanded ? 'expand_less' : 'expand_more';
        });

        card.querySelectorAll('.ai-card-url').forEach(el => {
            el.addEventListener('click', function() {
                const idx = parseInt(this.dataset.idx);
                copyToClipboard(urls[idx]);
            });
        });

        card.querySelector('.ai-card-key-row').addEventListener('click', function() {
            copyToClipboard(provider.key);
        });

        card.querySelectorAll('.ai-card-model').forEach(el => {
            el.addEventListener('click', function() {
                const idx = parseInt(this.dataset.idx);
                copyToClipboard(models[idx]);
            });
        });

        card.querySelector('.ai-edit-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            openAIModal(provider);
        });

        card.querySelector('.ai-apply-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            applyProviderToAISetting(provider);
        });

        const noteBtn = card.querySelector('.ai-note-btn');
        if (noteBtn) {
            noteBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (aiNoteViewerContent && provider.note) {
                    aiNoteViewerContent.textContent = provider.note;
                }
                if (aiNoteViewer) {
                    aiNoteViewer.classList.remove('hidden');
                    aiNoteViewer.classList.add('visible');
                }
            });
        }

        card.querySelector('.ai-del-btn').addEventListener('click', async function(e) {
            e.stopPropagation();
            if (await showConfirmDialog({ message: meowI18n.t('ai_msg_confirm_delete') || '确定删除此 AI Provider？', type: 'danger' })) {
                myAiProviders = myAiProviders.filter(p => p.id !== provider.id);
                saveAIProviders();
                renderAIProviders();
                showToast(meowI18n.t('ai_msg_deleted') || '已删除');
            }
        });

        card.draggable = true;
        card.dataset.index = index;

        card.addEventListener('dragstart', function(e) {
            this.classList.add('dragging');
            aiDragSrcIndex = index;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
        });
        card.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            document.querySelectorAll('#ai-list .ai-card').forEach(el => el.classList.remove('drag-over'));
            aiDragSrcIndex = null;
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
            if (aiDragSrcIndex !== null && aiDragSrcIndex !== destIndex) {
                const item = myAiProviders.splice(aiDragSrcIndex, 1)[0];
                myAiProviders.splice(destIndex, 0, item);
                saveAIProviders();
                renderAIProviders();
            }
            aiDragSrcIndex = null;
        });

        aiList.appendChild(card);

        if (!matchFilter) {
            card.style.display = 'none';
        } else {
            hasVisible = true;
        }
    });

    // 过滤后有匹配结果？显示/隐藏空状态
    if (hasVisible) {
        aiEmpty.classList.add('hidden');
    } else if (myAiProviders.length > 0) {
        aiEmpty.querySelector('p').innerHTML = meowI18n.t('ai_empty_search') || '无匹配结果';
        aiEmpty.classList.remove('hidden');
    }
}

function openAIModal(provider) {
    editingAiId = null;
    aiTitleInput.value = '';
    aiTypeInput.value = 'openai';
    aiOfficialInput.value = '';
    aiUrlInput.value = '';
    aiKeyInput.value = '';
    aiModelInput.value = '';
    aiNoteInput.value = '';
    aiDeleteBtn.classList.add('hidden');

    if (provider) {
        editingAiId = provider.id;
        aiModalTitle.textContent = meowI18n.t('ai_btn_edit') || '编辑 Provider';
        aiTitleInput.value = provider.title || '';
        aiTypeInput.value = provider.apiType || 'openai';
        aiOfficialInput.value = provider.officialUrl || '';
        const urls = Array.isArray(provider.baseUrls) ? provider.baseUrls : (provider.baseUrl ? [provider.baseUrl] : []);
        aiUrlInput.value = urls.join('\n');
        aiKeyInput.value = provider.key;
        const models = Array.isArray(provider.models) ? provider.models : (provider.model ? [provider.model] : []);
        aiModelInput.value = models.join('\n');
        aiNoteInput.value = provider.note || '';
        aiDeleteBtn.classList.remove('hidden');
    } else {
        aiModalTitle.textContent = meowI18n.t('ai_btn_add') || '添加 Provider';
    }

    aiModal.classList.remove('hidden');
    aiModal.classList.add('visible');
    setTimeout(() => aiUrlInput.focus(), 100);
}

function closeAIModal() {
    aiModal.classList.add('hidden');
    aiModal.classList.remove('visible');
}

function exportAIProviders() {
    if (!myAiProviders || myAiProviders.length === 0) {
        showToast('没有可导出的 Provider');
        return;
    }
    const data = myAiProviders.map(p => ({
        title: p.title || '',
        apiType: p.apiType || 'openai',
        officialUrl: p.officialUrl || '',
        baseUrls: Array.isArray(p.baseUrls) ? p.baseUrls : (p.baseUrl ? [p.baseUrl] : []),
        key: p.key,
        models: Array.isArray(p.models) ? p.models : (p.model ? [p.model] : []),
        note: p.note || ''
    }));
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-provider-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`已导出 ${data.length} 个 Provider`);
}

function importAIProviders() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.addEventListener('change', function() {
        const file = fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const imported = JSON.parse(e.target.result);
                if (!Array.isArray(imported)) throw new Error('格式错误');
                let added = 0, skipped = 0;
                imported.forEach(item => {
                    if (!item.baseUrls || item.baseUrls.length === 0 || !item.key) {
                        skipped++;
                        return;
                    }
                    const exists = myAiProviders.some(p => p.key === item.key);
                    if (exists) { skipped++; return; }
                    myAiProviders.push({
                        id: Date.now() + added,
                        title: item.title || '',
                        apiType: item.apiType || 'openai',
                        officialUrl: item.officialUrl || '',
                        baseUrls: item.baseUrls,
                        key: item.key,
                        models: item.models || [],
                        note: item.note || ''
                    });
                    added++;
                });
                if (added > 0) {
                    saveAIProviders();
                    renderAIProviders();
                    showToast(`成功导入 ${added} 个 Provider` + (skipped > 0 ? `，跳过 ${skipped} 个` : ''));
                } else {
                    showToast('未导入任何 Provider' + (skipped > 0 ? `（跳过 ${skipped} 个）` : ''));
                }
            } catch (err) {
                showToast('导入失败：文件格式错误');
            }
            fileInput.value = '';
        };
        reader.readAsText(file);
    });
    document.body.appendChild(fileInput);
    fileInput.click();
    setTimeout(() => fileInput.remove(), 1000);
}

// === AI Setting 模块 ===
function saveAISetting() {
    chrome.storage.local.set({ 'meow_ai_setting': myAiSetting });
}

async function loadAISetting() {
    try {
        const result = await chrome.storage.local.get(['meow_ai_setting']);
        myAiSetting = result.meow_ai_setting || { baseUrl: '', modelId: '', apiKey: '', autoProtocol: true };
        if (aiSettingBaseUrl) aiSettingBaseUrl.value = myAiSetting.baseUrl || '';
        if (aiSettingModelId) aiSettingModelId.value = myAiSetting.modelId || '';
        if (aiSettingApiKey) aiSettingApiKey.value = myAiSetting.apiKey || '';
        if (aiSettingAutoProtocol) aiSettingAutoProtocol.checked = myAiSetting.autoProtocol !== false;
    } catch (e) {
        console.error('AI Setting load error:', e);
        myAiSetting = { baseUrl: '', modelId: '', apiKey: '', autoProtocol: true };
    }
}

function showAISettingStatus(msg, isError) {
    if (!aiSettingStatus) return;
    aiSettingStatus.textContent = msg;
    aiSettingStatus.style.color = isError ? '#ef4444' : '#22c55e';
    setTimeout(() => { if (aiSettingStatus) aiSettingStatus.textContent = ''; }, 3000);
}

function openAISettingSelectModal(title, items, callback) {
    if (!aiSettingSelectModal || !aiSettingSelectTitle || !aiSettingSelectList) return;
    aiSettingSelectTitle.textContent = title;
    aiSettingSelectList.innerHTML = '';
    items.forEach((item) => {
        const btn = document.createElement('button');
        btn.className = 'ai-setting-select-item';
        btn.textContent = item;
        btn.addEventListener('click', function() {
            closeAISettingSelectModalFn();
            callback(item);
        });
        aiSettingSelectList.appendChild(btn);
    });
    aiSettingSelectModal.classList.remove('hidden');
    aiSettingSelectModal.classList.add('visible');
}

function closeAISettingSelectModalFn() {
    if (aiSettingSelectModal) {
        aiSettingSelectModal.classList.add('hidden');
        aiSettingSelectModal.classList.remove('visible');
    }
}

/**
 * 将 AI Provider 的内容填入 AI Setting
 */
function applyProviderToAISetting(provider) {
    const urls = Array.isArray(provider.baseUrls) ? provider.baseUrls : (provider.baseUrl ? [provider.baseUrl] : []);
    const models = Array.isArray(provider.models) ? provider.models : (provider.model ? [provider.model] : []);

    // 处理 API Key（立即设置）
    if (provider.key && aiSettingApiKey) {
        aiSettingApiKey.value = provider.key;
    }

    // 收集需要弹窗选择的项目（按顺序：先 URL 后 Model）
    const selections = [];

    // 处理 Base URL
    if (urls.length === 0) {
        if (aiSettingBaseUrl) aiSettingBaseUrl.value = '';
    } else if (urls.length === 1) {
        if (aiSettingBaseUrl) aiSettingBaseUrl.value = urls[0];
    } else {
        // 多个 URL，稍后弹窗选择
        selections.push({
            title: '选择 Base URL',
            items: urls,
            apply: function(selected) { if (aiSettingBaseUrl) aiSettingBaseUrl.value = selected; }
        });
    }

    // 处理 Model
    if (models.length === 0) {
        if (aiSettingModelId) aiSettingModelId.value = '';
    } else if (models.length === 1) {
        if (aiSettingModelId) aiSettingModelId.value = models[0];
    } else {
        // 多个 Model，稍后弹窗选择
        selections.push({
            title: '选择 Model',
            items: models,
            apply: function(selected) { if (aiSettingModelId) aiSettingModelId.value = selected; }
        });
    }

    // 自动补充协议地址：如果开启且 Base URL 为空则填入 OpenAI 地址
    if (aiSettingAutoProtocol && aiSettingAutoProtocol.checked) {
        const baseUrlVal = aiSettingBaseUrl ? aiSettingBaseUrl.value.trim() : '';
        if (!baseUrlVal) {
            const defaultUrl = 'https://api.openai.com';
            if (aiSettingBaseUrl) aiSettingBaseUrl.value = defaultUrl;
        }
    }

    // 保存函数：读取当前输入框值并写入 storage
    const doSave = () => {
        myAiSetting.baseUrl = aiSettingBaseUrl ? aiSettingBaseUrl.value : '';
        myAiSetting.modelId = aiSettingModelId ? aiSettingModelId.value : '';
        myAiSetting.apiKey = aiSettingApiKey ? aiSettingApiKey.value : '';
        myAiSetting.providerTitle = provider.title || '';
        saveAISetting();
        showToast('已从 Provider 填入 AI Setting');
    };

    if (selections.length === 0) {
        // 无需弹窗，直接保存
        doSave();
    } else {
        // 依次弹窗选择，最后一个选择完成后再保存
        const showNext = (index) => {
            if (index >= selections.length) {
                doSave();
                return;
            }
            const sel = selections[index];
            openAISettingSelectModal(sel.title, sel.items, function(selected) {
                sel.apply(selected);
                showNext(index + 1);
            });
        };
        showNext(0);
    }
}

