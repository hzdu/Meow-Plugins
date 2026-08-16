// sp-ai-provider.js - AI Provider 模块（CRUD、导入导出、过滤、拖拽排序）
// 此文件由 sidepanel.js 拆分而来

// === AI Provider 模块 ===
let myAiSetting = { baseUrl: '', modelId: '', apiKey: '', autoProtocol: true };

function saveAIProviders() {
    chrome.storage.local.set({ 'meow_ai_providers': myAiProviders });
}

function renderAIProviders() {
    if (!aiProviderList || !aiProviderEmpty) return;
    aiProviderList.innerHTML = '';

    const filterText = (aiProviderFilterInput ? aiProviderFilterInput.value.trim().toLowerCase() : '');

    if (myAiProviders.length === 0) {
        aiProviderEmpty.classList.remove('hidden');
        return;
    }
    aiProviderEmpty.classList.add('hidden');

    let hasVisible = false;

    myAiProviders.forEach((provider, index) => {
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
                    <span class="material-icons ai-del-btn" data-id="${provider.id}">delete</span>
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

        card.querySelector('.ai-card-header').addEventListener('click', function(e) {
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
                if (aiProviderNoteViewerContent && provider.note) {
                    aiProviderNoteViewerContent.textContent = provider.note;
                }
                if (aiProviderNoteViewer) {
                    aiProviderNoteViewer.classList.remove('hidden');
                }
            });
        }

        card.querySelector('.ai-del-btn').addEventListener('click', async function(e) {
            e.stopPropagation();
            if (await showConfirmDialog({ message: '确定删除此 AI Provider？', type: 'danger' })) {
                myAiProviders = myAiProviders.filter(p => p.id !== provider.id);
                saveAIProviders();
                renderAIProviders();
                showToast('已删除');
            }
        });

        aiProviderList.appendChild(card);

        // 拖放排序
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
            document.querySelectorAll('#ai-provider-list .ai-card').forEach(el => el.classList.remove('drag-over'));
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

        if (!matchFilter) {
            card.style.display = 'none';
        } else {
            hasVisible = true;
        }
    });

    if (!hasVisible && myAiProviders.length > 0) {
        aiProviderEmpty.classList.remove('hidden');
        aiProviderEmpty.querySelector('p').textContent = '无匹配结果';
    }
}

function openAIModal(provider) {
    editingAiId = null;
    aiProviderTitleInput.value = '';
    aiProviderTypeInput.value = 'openai';
    aiProviderOfficialInput.value = '';
    aiProviderUrlInput.value = '';
    aiProviderKeyInput.value = '';
    aiProviderModelInput.value = '';
    aiProviderNoteInput.value = '';
    aiProviderDeleteBtn.classList.add('hidden');

    if (provider) {
        editingAiId = provider.id;
        aiProviderModalTitle.textContent = '编辑 Provider';
        aiProviderTitleInput.value = provider.title || '';
        aiProviderTypeInput.value = provider.apiType || 'openai';
        aiProviderOfficialInput.value = provider.officialUrl || '';
        const urls = Array.isArray(provider.baseUrls) ? provider.baseUrls : (provider.baseUrl ? [provider.baseUrl] : []);
        aiProviderUrlInput.value = urls.join('\n');
        aiProviderKeyInput.value = provider.key || '';
        const models = Array.isArray(provider.models) ? provider.models : (provider.model ? [provider.model] : []);
        aiProviderModelInput.value = models.join('\n');
        aiProviderNoteInput.value = provider.note || '';
        aiProviderDeleteBtn.classList.remove('hidden');
    } else {
        aiProviderModalTitle.textContent = '添加 AI Provider';
    }
    aiProviderModal.classList.remove('hidden');
    setTimeout(() => aiProviderTitleInput.focus(), 100);
}

function closeAIModal() {
    aiProviderModal.classList.add('hidden');
}

function exportAIProviders() {
    if (!myAiProviders || myAiProviders.length === 0) {
        showToast('没有可导出的 Provider');
        return;
    }
    const data = myAiProviders.map(p => ({
        title: p.title,
        apiType: p.apiType,
        officialUrl: p.officialUrl,
        baseUrls: p.baseUrls,
        key: p.key,
        models: p.models,
        note: p.note
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meow_ai_providers_${Date.now()}.json`;
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
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                const imported = JSON.parse(ev.target.result);
                if (!Array.isArray(imported)) { showToast('文件格式错误'); return; }
                imported.forEach(p => {
                    myAiProviders.push({
                        id: Date.now() + Math.random(),
                        title: p.title || '',
                        apiType: p.apiType || 'openai',
                        officialUrl: p.officialUrl || '',
                        baseUrls: Array.isArray(p.baseUrls) ? p.baseUrls : (p.baseUrl ? [p.baseUrl] : []),
                        key: p.key || '',
                        models: Array.isArray(p.models) ? p.models : (p.model ? [p.model] : []),
                        note: p.note || ''
                    });
                });
                saveAIProviders();
                renderAIProviders();
                showToast(`已导入 ${imported.length} 个 Provider`);
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

// === AI Setting 选择弹窗 ===
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
}

function closeAISettingSelectModalFn() {
    if (aiSettingSelectModal) {
        aiSettingSelectModal.classList.add('hidden');
    }
}

/**
 * 将 AI Provider 的内容填入 AI Setting
 */
async function applyProviderToAISetting(provider) {
    const urls = Array.isArray(provider.baseUrls) ? provider.baseUrls : (provider.baseUrl ? [provider.baseUrl] : []);
    const models = Array.isArray(provider.models) ? provider.models : (provider.model ? [provider.model] : []);

    // 加载当前 AI Setting
    try {
        const result = await chrome.storage.local.get(['meow_ai_setting']);
        myAiSetting = result.meow_ai_setting || { baseUrl: '', modelId: '', apiKey: '', autoProtocol: true };
    } catch (e) {
        myAiSetting = { baseUrl: '', modelId: '', apiKey: '', autoProtocol: true };
    }

    // 处理 API Key（立即设置）
    if (provider.key) {
        myAiSetting.apiKey = provider.key;
    }

    // 收集需要弹窗选择的项目（按顺序：先 URL 后 Model）
    const selections = [];

    // 处理 Base URL
    if (urls.length === 0) {
        myAiSetting.baseUrl = '';
    } else if (urls.length === 1) {
        myAiSetting.baseUrl = urls[0];
    } else {
        // 多个 URL，稍后弹窗选择
        selections.push({
            title: '选择 Base URL',
            items: urls,
            apply: function(selected) { myAiSetting.baseUrl = selected; }
        });
    }

    // 处理 Model
    if (models.length === 0) {
        myAiSetting.modelId = '';
    } else if (models.length === 1) {
        myAiSetting.modelId = models[0];
    } else {
        // 多个 Model，稍后弹窗选择
        selections.push({
            title: '选择 Model',
            items: models,
            apply: function(selected) { myAiSetting.modelId = selected; }
        });
    }

    // 自动补充协议地址：如果开启且 Base URL 为空则填入 OpenAI 地址
    if (myAiSetting.autoProtocol !== false) {
        if (!myAiSetting.baseUrl || !myAiSetting.baseUrl.trim()) {
            myAiSetting.baseUrl = 'https://api.openai.com';
        }
    }

    myAiSetting.providerTitle = provider.title || '';

    // 保存函数：写入 storage
    const doSave = () => {
        chrome.storage.local.set({ 'meow_ai_setting': myAiSetting });
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

function setupAILogic() {
    if (!aiProviderList) return;

    // 加载数据
    (async () => {
        try {
            const localData = await chrome.storage.local.get(['meow_ai_providers']);
            myAiProviders = localData.meow_ai_providers || [];
        } catch (e) {
            console.error('AI Provider load error:', e);
            myAiProviders = [];
        }
        renderAIProviders();
    })();

    if (aiProviderAddBtn) {
        aiProviderAddBtn.addEventListener('click', function() { openAIModal(null); });
    }
    if (aiProviderExportBtn) {
        aiProviderExportBtn.addEventListener('click', exportAIProviders);
    }
    if (aiProviderImportBtn) {
        aiProviderImportBtn.addEventListener('click', importAIProviders);
    }
    if (closeAiProviderModal) {
        closeAiProviderModal.addEventListener('click', closeAIModal);
    }
    if (aiProviderModal) {
        aiProviderModal.addEventListener('click', function(e) {
            if (e.target === aiProviderModal) closeAIModal();
        });
    }
    if (closeAiProviderNoteViewer) {
        closeAiProviderNoteViewer.addEventListener('click', function() {
            aiProviderNoteViewer.classList.add('hidden');
        });
    }
    if (aiProviderNoteViewer) {
        aiProviderNoteViewer.addEventListener('click', function(e) {
            if (e.target === aiProviderNoteViewer) aiProviderNoteViewer.classList.add('hidden');
        });
    }
    if (closeAiSettingSelectModal) {
        closeAiSettingSelectModal.addEventListener('click', closeAISettingSelectModalFn);
    }
    if (aiSettingSelectModal) {
        aiSettingSelectModal.addEventListener('click', function(e) {
            if (e.target === aiSettingSelectModal) closeAISettingSelectModalFn();
        });
    }
    if (aiProviderSaveBtn) {
        aiProviderSaveBtn.addEventListener('click', function() {
            const title = aiProviderTitleInput.value.trim();
            const apiType = aiProviderTypeInput.value;
            const officialUrl = aiProviderOfficialInput.value.trim();
            const rawUrls = aiProviderUrlInput.value.trim();
            const baseUrls = rawUrls.split('\n').map(s => s.trim()).filter(Boolean);
            const key = aiProviderKeyInput.value.trim();
            const rawModels = aiProviderModelInput.value.trim();
            const models = rawModels.split('\n').map(s => s.trim()).filter(Boolean);
            const note = aiProviderNoteInput.value.trim();

            if (baseUrls.length === 0) { showToast('Base URL 不能为空'); aiProviderUrlInput.focus(); return; }
            if (!key) { showToast('API Key 不能为空'); aiProviderKeyInput.focus(); return; }
            if (models.length === 0) { showToast('Model 不能为空'); aiProviderModelInput.focus(); return; }

            if (editingAiId) {
                const idx = myAiProviders.findIndex(p => p.id === editingAiId);
                if (idx !== -1) {
                    myAiProviders[idx].title = title;
                    myAiProviders[idx].apiType = apiType;
                    myAiProviders[idx].officialUrl = officialUrl;
                    myAiProviders[idx].baseUrls = baseUrls;
                    myAiProviders[idx].key = key;
                    myAiProviders[idx].models = models;
                    myAiProviders[idx].note = note;
                    showToast('已更新');
                }
            } else {
                myAiProviders.push({ id: Date.now(), title, apiType, officialUrl, baseUrls, key, models, note });
                showToast('已添加');
            }
            saveAIProviders();
            renderAIProviders();
            closeAIModal();
        });
    }
    if (aiProviderDeleteBtn) {
        aiProviderDeleteBtn.addEventListener('click', async function() {
            if (!editingAiId) return;
            if (await showConfirmDialog({ message: '确定删除此 AI Provider？', type: 'danger' })) {
                myAiProviders = myAiProviders.filter(p => p.id !== editingAiId);
                saveAIProviders();
                renderAIProviders();
                closeAIModal();
                showToast('已删除');
            }
        });
    }

    // 过滤
    if (aiProviderFilterInput) {
        aiProviderFilterInput.addEventListener('input', function() {
            if (aiProviderFilterClear) {
                aiProviderFilterClear.style.display = this.value ? '' : 'none';
            }
            renderAIProviders();
        });
    }
    if (aiProviderFilterClear) {
        aiProviderFilterClear.addEventListener('click', function() {
            if (aiProviderFilterInput) {
                aiProviderFilterInput.value = '';
                aiProviderFilterInput.focus();
                aiProviderFilterClear.style.display = 'none';
                renderAIProviders();
            }
        });
    }

    // 存储变化监听
    chrome.storage.onChanged.addListener(function(changes, area) {
        if (area === 'local' && changes.meow_ai_providers) {
            myAiProviders = changes.meow_ai_providers.newValue || [];
            const view = document.getElementById('view-ai-provider');
            if (view && !view.classList.contains('hidden')) renderAIProviders();
        }
    });
}
