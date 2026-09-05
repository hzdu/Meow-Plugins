// sp-ai-provider.js - AI Provider 模块（CRUD、导入导出、过滤、拖拽排序）
// 此文件由 sidepanel.js 拆分而来

// === AI Provider 模块 ===
let myAiSetting = { baseUrl: '', modelId: '', apiKey: '', autoProtocol: true };

// === 获取模型相关 DOM 元素 ===
const aiProviderFetchModelsBtn = document.getElementById('ai-provider-fetch-models-btn');
const aiProviderModelFetchStatus = document.getElementById('ai-provider-model-fetch-status');
const aiProviderModelSelectModal = document.getElementById('ai-provider-model-select-modal');
const closeAiProviderModelSelectModal = document.getElementById('close-ai-provider-model-select-modal');
const aiProviderModelSelectSource = document.getElementById('ai-provider-model-select-source');
const aiProviderModelSelectList = document.getElementById('ai-provider-model-select-list');
const aiProviderModelSelectSearchInput = document.getElementById('ai-provider-model-select-search');
const aiProviderModelSelectCount = document.getElementById('ai-provider-model-select-count');
const aiProviderModelSelectAllBtn = document.getElementById('ai-provider-model-select-all');
const aiProviderModelSelectNoneBtn = document.getElementById('ai-provider-model-select-none');
const aiProviderModelSelectCancelBtn = document.getElementById('ai-provider-model-select-cancel');
const aiProviderModelSelectAddBtn = document.getElementById('ai-provider-model-select-add');

// 模型选择弹窗状态：[{ id, source, existing, checked }]，checked 为实时勾选状态
let aiModelSelectEntries = [];
let aiModelSelectSearch = '';   // 过滤关键字

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
            `<div class="ai-card-url" data-idx="${i}" title="点击复制 Base URL"><i class="fa-regular fa-link"></i>${escapeHtml(url)}</div>`
        ).join('');

        const modelsHtml = models.map((m, i) =>
            `<div class="ai-card-model" data-idx="${i}" title="点击复制 Model"><i class="fa-regular fa-robot"></i><span class="badge">${escapeHtml(m)}</span></div>`
        ).join('');

        const apiType = provider.apiType || 'openai';
        const typeLabel = apiType === 'anthropic' ? 'Anthropic' : 'OpenAI';
        const typeIcon = apiType === 'anthropic' ? 'fa-clock-rotate-left' : 'fa-microchip';
        const officialLink = provider.officialUrl ? escapeHtml(provider.officialUrl) : '';
        const hasNote = provider.note && provider.note.trim();

        card.innerHTML = `
            <div class="ai-card-header">
                <i class="fa-regular fa-chevron-down ai-card-toggle"></i>
                <span class="ai-card-name">${nameDisplay}</span>
                <div class="ai-card-actions">
                    <i class="fa-regular fa-play ai-apply-btn" title="应用到 AI Setting" style="font-size:13px;color:#8b5cf6;"></i>
                    ${hasNote ? `<i class="fa-regular fa-file-lines ai-note-btn" title="查看备注"></i>` : ''}
                    ${officialLink ? `<a class="ai-official-link" href="${officialLink}" target="_blank" title="打开官网" onclick="event.stopPropagation()"><i class="fa-regular fa-window-restore"></i></a>` : ''}
                    <i class="fa-regular fa-pen-to-square ai-edit-btn" data-id="${provider.id}"></i>
                    <i class="fa-regular fa-xmark ai-del-btn" data-id="${provider.id}"></i>
                </div>
            </div>
            <div class="ai-card-body" style="display:none">
                <div class="ai-card-type-row" title="${typeLabel}">
                    <i class="fa-regular ${typeIcon}"></i>
                    <span class="badge type-badge">${typeLabel}</span>
                </div>
                ${urlsHtml}
                <div class="ai-card-key-row" title="点击复制 API Key">
                    <i class="fa-regular fa-key"></i>
                    <span class="ai-card-key-masked">${maskedKey}</span>
                </div>
                ${modelsHtml}
            </div>
        `;

        card.querySelector('.ai-card-header').addEventListener('click', function(e) {
            if (e.target.closest('.ai-card-actions, .ai-official-link')) return;
            const body = card.querySelector('.ai-card-body');
            const isExpanded = card.classList.toggle('expanded');
            body.style.display = isExpanded ? '' : 'none';
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

// ================== 获取模型列表（AI Provider） ==================
// 获取状态显示
function setAiModelFetchStatus(text, type) {
    if (!aiProviderModelFetchStatus) return;
    if (!text) {
        aiProviderModelFetchStatus.textContent = '';
        aiProviderModelFetchStatus.style.display = 'none';
        return;
    }
    aiProviderModelFetchStatus.textContent = text;
    aiProviderModelFetchStatus.className = 'ai-provider-fetch-status' + (type === 'error' ? ' error' : type === 'ok' ? ' ok' : '');
    aiProviderModelFetchStatus.style.display = 'block';
}

// 由 Base URL 推导 models 端点候选（依次尝试，取第一个成功返回的）
function buildModelsEndpointCandidates(rawUrl, apiType) {
    let b = (rawUrl || '').trim().replace(/\/+$/, '');
    if (!b) return [];
    // 用户已直接粘贴了 models 端点
    if (/\/models?$/i.test(b)) return [b];
    // 去掉可能粘贴的完整请求端点
    b = b.replace(/\/(chat\/completions|messages)$/i, '');
    // 去掉末尾 /v1，统一按 /v1/models 补全，避免重复
    const root = b.replace(/\/v1$/i, '');
    const list = [root + '/v1/models'];
    if (apiType !== 'anthropic') list.push(root + '/models');
    return [...new Set(list)];
}

function buildModelsRequestHeaders(apiType, key) {
    if (apiType === 'anthropic') {
        return { 'x-api-key': key || '', 'anthropic-version': '2023-06-01' };
    }
    return { 'Authorization': 'Bearer ' + (key || '') };
}

function extractModelIdsFromJson(json) {
    if (!json || typeof json !== 'object') return [];
    let arr = null;
    if (Array.isArray(json)) {
        arr = json;
    } else {
        arr = Array.isArray(json.data) ? json.data
            : (Array.isArray(json.models) ? json.models
                : (Array.isArray(json.model) ? json.model
                    : (Array.isArray(json.list) ? json.list : null)));
    }
    const ids = [];
    if (arr) {
        arr.forEach(function(it) {
            if (it == null) return;
            if (typeof it === 'string') { if (it) ids.push(it); return; }
            if (typeof it === 'object') {
                let val = it.id || it.name || it.model || it.key || it.slug;
                if (typeof val === 'string' && val) ids.push(val);
                else if (typeof val === 'number') ids.push(String(val));
            }
        });
    } else if (json.id) {
        ids.push(String(json.id));
    }
    return ids;
}

// 针对单个 Base URL 获取模型（多候选地址，认证失败立即终止）
async function fetchModelsFromBase(baseUrl, apiType, key) {
    const candidates = buildModelsEndpointCandidates(baseUrl, apiType);
    if (candidates.length === 0) throw new Error('Base URL 无效');
    const headers = buildModelsRequestHeaders(apiType, key);
    let lastErr = new Error('获取失败');
    for (const endpoint of candidates) {
        const ctrl = new AbortController();
        const timer = setTimeout(function() { ctrl.abort(); }, 20000);
        try {
            const res = await fetch(endpoint, { method: 'GET', headers: headers, signal: ctrl.signal, credentials: 'omit' });
            if (res.status === 401 || res.status === 403) {
                throw new Error('认证失败 (' + res.status + ')');
            }
            if (!res.ok) {
                const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);
                lastErr = new Error('HTTP ' + res.status + (detail ? ' ' + detail : ''));
                continue;
            }
            const text = await res.text();
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
            const ids = extractModelIdsFromJson(json);
            if (ids.length) return ids;
            lastErr = new Error('返回数据中没有模型');
        } catch (e) {
            if (e && e.name === 'AbortError') { lastErr = new Error('请求超时'); break; }
            if (e && /认证失败/.test(e.message)) throw e;
            lastErr = e || lastErr;
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastErr;
}

// 点击“获取模型”：对每个 Base URL 并行获取，汇总后弹出选择框
async function handleFetchProviderModels() {
    if (!aiProviderFetchModelsBtn || !aiProviderUrlInput || !aiProviderKeyInput || !aiProviderTypeInput) return;
    const apiType = aiProviderTypeInput.value || 'openai';
    const urls = (aiProviderUrlInput.value || '').split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
    const key = (aiProviderKeyInput.value || '').trim();

    if (urls.length === 0) { setAiModelFetchStatus('请先填写 Base URL', 'error'); aiProviderUrlInput.focus(); return; }
    if (!key) { setAiModelFetchStatus('请先填写 API Key', 'error'); aiProviderKeyInput.focus(); return; }

    // 按钮进入获取中状态
    const origHtml = aiProviderFetchModelsBtn.innerHTML;
    aiProviderFetchModelsBtn.disabled = true;
    aiProviderFetchModelsBtn.innerHTML = '<span class="material-icons" style="font-size:14px;vertical-align:middle;animation:fa-spin 0.9s linear infinite;">autorenew</span> 获取中…';
    setAiModelFetchStatus(urls.length > 1 ? '正在获取模型…（共 ' + urls.length + ' 个 Base URL）' : '正在获取模型…');

    const foundMap = new Map();   // model id -> 来源 host（跨地址去重）
    const errors = [];
    await Promise.all(urls.map(function(u) {
        return fetchModelsFromBase(u, apiType, key).then(function(ids) {
            (ids || []).forEach(function(id) {
                if (id && !foundMap.has(id)) {
                    let host = u;
                    try { host = new URL(u).host; } catch (e) { host = u; }
                    foundMap.set(id, host);
                }
            });
        }).catch(function(e) {
            errors.push({ url: u, msg: (e && e.message) || '未知错误' });
        });
    }));

    aiProviderFetchModelsBtn.disabled = false;
    aiProviderFetchModelsBtn.innerHTML = origHtml;

    const ids = Array.from(foundMap.keys());
    if (ids.length === 0) {
        let text = '未获取到模型';
        if (errors.length) text += '：' + errors[0].msg + (errors.length > 1 ? '（另有 ' + (errors.length - 1) + ' 个地址失败）' : '');
        setAiModelFetchStatus(text, 'error');
        return;
    }
    const partial = errors.length ? '（' + errors.length + ' 个地址失败）' : '';
    setAiModelFetchStatus('成功获取 ' + ids.length + ' 个模型' + partial, 'ok');
    openAiProviderModelSelect(ids.map(function(id) { return { id: id, source: foundMap.get(id) }; }));
}

// ================== 模型多选弹窗（全量编辑 Model 字段） ==================
function openAiProviderModelSelect(found) {
    const existingSet = new Set((aiProviderModelInput.value || '').split('\n').map(function(s) { return s.trim(); }).filter(Boolean));
    aiModelSelectEntries = found.map(function(f) {
        // 默认只勾选已在 Model 字段中的（=保留）；新获取默认不勾选，需手动勾选才添加
        return { id: f.id, source: f.source, existing: existingSet.has(f.id), checked: existingSet.has(f.id) };
    });
    // 每次打开重置过滤关键字
    aiModelSelectSearch = '';
    if (aiProviderModelSelectSearchInput) aiProviderModelSelectSearchInput.value = '';
    if (aiProviderModelSelectSource) {
        const existingCount = aiModelSelectEntries.filter(function(en) { return en.existing; }).length;
        const tip = '已在 Model 的默认勾选（保留）；新获取的默认不勾选，勾选后才添加；取消勾选已有项会从 Model 中移除';
        aiProviderModelSelectSource.title = tip;
        aiProviderModelSelectSource.textContent = existingCount > 0
            ? '共 ' + found.length + ' 个，其中 ' + existingCount + ' 个已在 Model'
            : '共 ' + found.length + ' 个模型';
    }
    renderAiProviderModelSelectList();
    if (aiProviderModelSelectModal) aiProviderModelSelectModal.classList.remove('hidden');
}

function renderAiProviderModelSelectList() {
    if (!aiProviderModelSelectList) return;
    aiProviderModelSelectList.innerHTML = '';
    const q = aiModelSelectSearch.trim().toLowerCase();
    // 过滤只影响可见列表；勾选状态保存在 entries 里，不受过滤影响
    const visible = q
        ? aiModelSelectEntries.filter(function(en) {
            return en.id.toLowerCase().includes(q) || (en.source || '').toLowerCase().includes(q);
        })
        : aiModelSelectEntries;

    if (visible.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ai-model-select-empty';
        empty.textContent = q ? '没有匹配的模型' : '无可用模型';
        aiProviderModelSelectList.appendChild(empty);
        updateAiProviderModelSelectCount();
        return;
    }

    visible.forEach(function(en) {
        const idx = aiModelSelectEntries.indexOf(en);
        const label = document.createElement('label');
        label.className = 'ai-model-select-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.idx = String(idx);
        cb.checked = !!en.checked;
        cb.addEventListener('change', function() {
            if (aiModelSelectEntries[idx]) aiModelSelectEntries[idx].checked = cb.checked;
            updateAiProviderModelSelectCount();
        });
        label.appendChild(cb);

        const idSpan = document.createElement('span');
        idSpan.className = 'model-id';
        idSpan.textContent = en.id;
        label.appendChild(idSpan);

        if (en.source) {
            const srcSpan = document.createElement('span');
            srcSpan.className = 'model-src';
            srcSpan.textContent = en.source;
            label.appendChild(srcSpan);
        }
        if (en.existing) {
            const st = document.createElement('span');
            st.className = 'model-state';
            st.textContent = '已有';
            st.title = '已在 Model 字段中，取消勾选后将移除';
            label.appendChild(st);
        }
        aiProviderModelSelectList.appendChild(label);
    });
    updateAiProviderModelSelectCount();
}

function updateAiProviderModelSelectCount() {
    const n = aiModelSelectEntries.filter(function(en) { return en.checked; }).length;
    if (aiProviderModelSelectCount) aiProviderModelSelectCount.textContent = '已选 ' + n + ' 项';
    if (aiProviderModelSelectAddBtn) aiProviderModelSelectAddBtn.textContent = '保存 (' + n + ')';
}

function setAiProviderModelSelectAll(checked) {
    aiModelSelectEntries.forEach(function(en) { en.checked = checked; });
    renderAiProviderModelSelectList();
}

function closeAiProviderModelSelect() {
    if (aiProviderModelSelectModal) aiProviderModelSelectModal.classList.add('hidden');
    aiModelSelectEntries = [];
    aiModelSelectSearch = '';
}

// 应用勾选：取消勾选的已有模型从字段移除，勾选的新模型追加
function confirmAiProviderModelSelectAdd() {
    if (!aiProviderModelInput) return;
    // 从数据读取勾选状态（含被过滤隐藏的项）
    const checkedSet = new Set(aiModelSelectEntries.filter(function(en) { return en.checked; }).map(function(en) { return en.id; }));

    // 原始 Model 行（保留未在获取结果里的手写项）
    const original = (aiProviderModelInput.value || '').split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
    const result = [];
    let removedCount = 0;
    original.forEach(function(m) {
        const entry = aiModelSelectEntries.find(function(en) { return en.existing && en.id === m; });
        if (entry && !checkedSet.has(entry.id)) { removedCount++; return; }
        result.push(m);
    });

    // 追加勾选的新模型
    let addedCount = 0;
    aiModelSelectEntries.forEach(function(en) {
        if (en.existing) return;
        if (checkedSet.has(en.id) && result.indexOf(en.id) === -1) { result.push(en.id); addedCount++; }
    });

    aiProviderModelInput.value = result.join('\n');
    closeAiProviderModelSelect();
    if (addedCount && removedCount) showToast('新增 ' + addedCount + ' 个 · 移除 ' + removedCount + ' 个');
    else if (addedCount) showToast('已添加 ' + addedCount + ' 个模型');
    else if (removedCount) showToast('已移除 ' + removedCount + ' 个模型');
    else showToast('Model 无变化');
    aiProviderModelInput.focus();
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

    // === 获取模型相关事件 ===
    if (aiProviderFetchModelsBtn) {
        aiProviderFetchModelsBtn.addEventListener('click', handleFetchProviderModels);
    }
    if (aiProviderModelSelectModal) {
        aiProviderModelSelectModal.addEventListener('click', function(e) {
            if (e.target === aiProviderModelSelectModal) closeAiProviderModelSelect();
        });
    }
    if (closeAiProviderModelSelectModal) {
        closeAiProviderModelSelectModal.addEventListener('click', closeAiProviderModelSelect);
    }
    if (aiProviderModelSelectCancelBtn) {
        aiProviderModelSelectCancelBtn.addEventListener('click', closeAiProviderModelSelect);
    }
    if (aiProviderModelSelectAllBtn) {
        aiProviderModelSelectAllBtn.addEventListener('click', function() { setAiProviderModelSelectAll(true); });
    }
    if (aiProviderModelSelectNoneBtn) {
        aiProviderModelSelectNoneBtn.addEventListener('click', function() { setAiProviderModelSelectAll(false); });
    }
    if (aiProviderModelSelectSearchInput) {
        aiProviderModelSelectSearchInput.addEventListener('input', function() {
            aiModelSelectSearch = this.value;
            renderAiProviderModelSelectList();
        });
    }
    if (aiProviderModelSelectAddBtn) {
        aiProviderModelSelectAddBtn.addEventListener('click', confirmAiProviderModelSelectAdd);
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
