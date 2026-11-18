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

// ===== AI Provider 卡片拖拽排序 =====
// 交互与「工具箱」「服务器管理」卡片保持一致：
//   · 只有标题栏(.ai-card-header)是拖拽手柄，卡片内容区不参与拖拽；
//   · 拖拽期间被拖卡片脱离文档流、紧贴指针移动；它原来的位置由一个等高的
//     占位块顶替，占位块随指针逐格移动，实时指示"松手后落到哪"；
//   · 其它卡片通过 FLIP 位移补间滑向新位置，形成平滑让位的观感。
// 事件用委托只绑一次：renderAIProviders 会重建所有卡片，逐卡绑定会重复注册。
function setupAiCardDrag(container) {
    container = container || aiProviderList;
    if (!container) return;

    // 每次重建卡片后都要刷新：确保标题栏 draggable、补齐拖拽手柄、重排索引。
    // 注意：只有标题栏是拖拽手柄，卡片本体绝不设置 draggable，
    // 否则卡片展开后在内容区按住鼠标也会被浏览器当成拖拽。
    function refreshIndices() {
        container.querySelectorAll('.ai-card').forEach((card, i) => {
            card.dataset.index = i;
            card.removeAttribute('draggable');
            const header = card.querySelector('.ai-card-header');
            if (!header) return;
            header.setAttribute('draggable', 'true');
            // 标题栏里的链接自带原生拖拽（拖动会变成拖链接而不是拖卡片），统一关掉
            header.querySelectorAll('a[href]').forEach(a => a.setAttribute('draggable', 'false'));
            if (!header.querySelector('.ai-card-drag-handle')) {
                const handle = document.createElement('span');
                handle.className = 'mi ai-card-drag-handle fa-regular fa-grip-dots-vertical';
                header.insertBefore(handle, header.firstChild);
            }
        });
    }

    refreshIndices();

    // 事件委托只需绑定一次（renderAIProviders 每次都会调用本函数）
    if (container.dataset.aiDragBound === '1') return;
    container.dataset.aiDragBound = '1';

    let dragCard = null;      // 正在拖拽的卡片
    let placeholder = null;   // 撑开空位的占位块
    let srcIndex = null;      // 拖拽起点索引
    let grabOffsetX = 0;      // 按下点相对卡片左上角的偏移
    let grabOffsetY = 0;

    // 被筛选隐藏的卡片仍留在 DOM 里（display:none），既不占位也不参与
    // 落点判断；offsetParent 为 null 也一并兜底。
    function isActiveCard(card) {
        return !!card && card !== dragCard && card.style.display !== 'none' && card.offsetParent !== null;
    }

    // 让跟随卡片贴在指针位置
    function followPointer(x, y) {
        if (!dragCard) return;
        dragCard.style.left = (x - grabOffsetX) + 'px';
        dragCard.style.top = (y - grabOffsetY) + 'px';
    }

    // 记录除被拖卡片外的纵向布局位置。
    // 这里刻意用 offsetTop 而非 getBoundingClientRect：offsetTop 反映的是
    // 布局位置，不受 transform 影响，因此让位动画尚未结束时再次测量
    // 也不会把动画中的位移算进去，避免误差累积。
    function snapshotTops() {
        const tops = new Map();
        container.querySelectorAll('.ai-card').forEach(card => {
            if (!isActiveCard(card)) return;
            tops.set(card, card.offsetTop);
        });
        return tops;
    }

    // FLIP：先让卡片瞬移到新布局位置并施加反向位移，再过渡回 0，形成滑入效果
    function animateLetWay(prevTops) {
        container.querySelectorAll('.ai-card').forEach(card => {
            if (!isActiveCard(card)) return;
            const before = prevTops.get(card);
            if (before === undefined) return;
            const dy = before - card.offsetTop;
            if (!dy) return;
            card.style.transition = 'none';
            card.style.transform = 'translateY(' + dy + 'px)';
            void card.offsetWidth; // 强制重排，确保反向位移先生效
            card.style.transition = 'transform .18s cubic-bezier(.2, .8, .2, 1)';
            card.style.transform = '';
        });
    }

    // 取占位块前后真正参与排序的卡片。
    // 必须跳过被拖卡片：它已改为 fixed，offsetTop 变成视口坐标（与其它卡片
    // 相对容器的 offsetTop 不同基准），且视觉上不占位，不能作为落点参照。
    function siblingCard(dir) {
        let node = placeholder;
        if (!node) return null;
        while ((node = dir > 0 ? node.nextElementSibling : node.previousElementSibling)) {
            if (node.classList && node.classList.contains('ai-card') && isActiveCard(node)) return node;
        }
        return null;
    }

    // 让占位块上移/下移一格（dir = 1 下移，-1 上移）
    function shiftPlaceholder(dir) {
        if (!placeholder || !placeholder.parentNode) return false;
        const prevTops = snapshotTops();
        if (dir > 0) {
            const next = siblingCard(1);
            if (!next) return false;
            container.insertBefore(placeholder, next.nextElementSibling);
        } else {
            const prev = siblingCard(-1);
            if (!prev) return false;
            container.insertBefore(placeholder, prev);
        }
        animateLetWay(prevTops);
        return true;
    }

    // 指针是否越过了相邻卡片的中线，越过才换位。
    // 基准取"相邻卡片中线"而不是占位块中心：卡片展开后高度差异很大，
    // 以占位块中心为基准会让高卡片的落点判断严重偏后。
    function shiftTowardsPointer(clientY) {
        if (!placeholder) return false;
        const y = clientY - container.getBoundingClientRect().top;

        const next = siblingCard(1);
        if (next && y > next.offsetTop + next.offsetHeight / 2) return shiftPlaceholder(1);

        const prev = siblingCard(-1);
        if (prev && y < prev.offsetTop + prev.offsetHeight / 2) return shiftPlaceholder(-1);

        return false;
    }

    // 结束拖拽：keepPosition 为 true 表示落到占位块处，false 表示回到起点（取消）
    function finishDrag(keepPosition) {
        if (!dragCard) return;
        const card = dragCard;
        const fromIndex = srcIndex;

        if (placeholder) {
            if (keepPosition) {
                container.insertBefore(card, placeholder);
            } else {
                // 取消时按原索引复位：先从列表里排除自己，再把原索引处的卡片当锚点
                const others = Array.from(container.querySelectorAll('.ai-card')).filter(c => c !== card);
                const anchor = others[fromIndex] || null;
                if (anchor) container.insertBefore(card, anchor);
                else container.appendChild(card);
            }
            if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
        }
        placeholder = null;

        card.classList.remove('dragging-follow', 'dragging', 'drag-over');
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';

        // 清理让位动画的内联样式。
        // 必须先关过渡再清除位移：否则清除位移会按 CSS 的 all .2s 再滑一次，
        // 表现为 drop 后卡片额外滑行一段。归位完成后再恢复默认过渡。
        const cleanupCards = container.querySelectorAll('.ai-card');
        cleanupCards.forEach(c => {
            c.style.transition = 'none';
            c.style.transform = '';
        });
        void container.offsetWidth;
        cleanupCards.forEach(c => { c.style.transition = ''; });

        dragCard = null;
        aiDragSrcIndex = null;

        if (!keepPosition || fromIndex === null) {
            refreshIndices();
            return;
        }

        // 被筛选隐藏的卡片只是 display:none，仍在 DOM 里且没有参与让位，
        // 因此按“可见卡片的新顺序填回原来的可见槽位”，隐藏项保持原位不动。
        const domCards = Array.from(container.querySelectorAll('.ai-card'));
        const visibleIds = domCards
            .filter(c => c.style.display !== 'none')
            .map(c => String(c.dataset.id));
        const visibleSet = new Set(visibleIds);

        const providerById = new Map(myAiProviders.map(p => [String(p.id), p]));
        let vi = 0;
        const newOrder = myAiProviders.map(p => {
            if (!visibleSet.has(String(p.id))) return p;
            return providerById.get(visibleIds[vi++]) || p;
        });

        const changed = newOrder.some((p, i) => p !== myAiProviders[i]);
        if (changed) {
            myAiProviders = newOrder;
            saveAIProviders();
            renderAIProviders();
        }
        // 预览/无数据变化时不会重渲染，这里也补齐索引，保证 dataset.index 永远等于 DOM 顺序
        refreshIndices();
    }

    // 只有拖拽源是标题栏时才视为卡片排序；
    // 卡片内容区里选中文字、拖链接等原生拖拽一律忽略。
    function getDragCard(e) {
        const target = e.target;
        if (!target || typeof target.closest !== 'function') return null;
        const header = target.closest('.ai-card-header');
        if (!header || !container.contains(header)) return null;
        return header.closest('.ai-card');
    }

    container.addEventListener('dragstart', function(e) {
        const card = getDragCard(e);
        if (!card || !isActiveCard(card)) return;

        const rect = card.getBoundingClientRect();
        dragCard = card;
        srcIndex = Array.from(container.querySelectorAll('.ai-card')).indexOf(card);
        aiDragSrcIndex = srcIndex;
        grabOffsetX = e.clientX - rect.left;
        grabOffsetY = e.clientY - rect.top;

        // 原生拖影是浏览器拍下的快照，会和我们 fixed 跟随的卡片叠成重影，
        // 用 1×1 透明图替换掉，只保留跟随指针的那一张。
        try {
            const blank = document.createElement('canvas');
            blank.width = 1;
            blank.height = 1;
            e.dataTransfer.setDragImage(blank, 0, 0);
        } catch (_) {}

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', String(card.dataset.id || srcIndex)); } catch (_) {}
        }

        // 占位块先顶住原位，再把卡片抽出文档流
        placeholder = document.createElement('div');
        placeholder.className = 'ai-drop-placeholder';
        placeholder.style.height = rect.height + 'px';
        container.insertBefore(placeholder, card);

        card.style.width = rect.width + 'px';
        card.style.height = rect.height + 'px';
        card.style.left = rect.left + 'px';
        card.style.top = rect.top + 'px';
        card.classList.add('dragging-follow');
        card.classList.remove('dragging', 'drag-over');
    });

    container.addEventListener('dragover', function(e) {
        if (!dragCard || !placeholder) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        followPointer(e.clientX, e.clientY);

        // 每次 dragover 最多追 4 格：快速拖动时指针一帧能跨过好几张卡片，
        // 只移动一格会明显滞后。上限 4 次是为了避免长列表下逐帧重排过多。
        for (let i = 0; i < 4; i++) {
            if (!shiftTowardsPointer(e.clientY)) break;
        }
    });

    container.addEventListener('drop', function(e) {
        if (!dragCard) return;
        e.preventDefault();
        e.stopPropagation();
        finishDrag(true);
    });

    container.addEventListener('dragend', function() {
        // drop 分支已处理过则 dragCard 已置空；这里兜底「拖到区域外松手」的取消
        if (dragCard) finishDrag(false);
    });

    // 指针移出列表时容器收不到 dragover，卡片会滞留在原处；
    // 用 document 捕获阶段保持跟随（不调用 preventDefault，不影响原生放置判定）
    document.addEventListener('dragover', function(e) {
        if (dragCard) followPointer(e.clientX, e.clientY);
    }, true);
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
            <div class="ai-card-header" draggable="true">
                <span class="mi ai-card-drag-handle fa-regular fa-grip-dots-vertical"></span>
                <i class="fa-regular fa-chevron-down ai-card-toggle"></i>
                <span class="ai-card-name">${nameDisplay}</span>
                <div class="ai-card-actions">
                    <i class="fa-regular fa-play ai-apply-btn" title="应用到 AI Setting" style="font-size:13px;color:#8b5cf6;"></i>
                    ${hasNote ? `<i class="fa-regular fa-file-lines ai-note-btn" title="查看备注"></i>` : ''}
                    ${officialLink ? `<a class="ai-official-link" href="${officialLink}" target="_blank" title="打开官网" draggable="false"><i class="fa-regular fa-window-restore"></i></a>` : ''}
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
            if (e.target.closest('.ai-card-drag-handle, .ai-card-actions, .ai-official-link')) return;
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

        // 拖放排序见 setupAiCardDrag()：标题栏是拖拽手柄，事件统一在列表上委托
        card.dataset.index = index;

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

    // 卡片建好后统一整理拖拽手柄/索引（本函数每次重建列表都会被调用）
    setupAiCardDrag(aiProviderList);
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
    // 末尾已有版本段（/v1、/v2…）时按同版本补 /models，否则按 /v1 补，避免拼出 /v2/v1/models
    const hasVersion = /\/v\d+[a-z0-9.]*$/i.test(b);
    const list = [hasVersion ? b + '/models' : b + '/v1/models'];
    if (!hasVersion && apiType !== 'anthropic') list.push(b + '/models');
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
    aiProviderFetchModelsBtn.innerHTML = '<span class="mi fa-regular fa-arrows-rotate" style="font-size:14px;vertical-align:middle;animation:fa-spin 0.9s linear infinite;"></span> 获取中…';
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
        const tip = '保存后 Model 字段将被替换为勾选的模型；未勾选的（含不在本次获取结果中的旧模型）会被清除';
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

// 应用勾选：勾选项即 Model 字段最终内容（全量替换，不在本次获取结果中的旧模型会被清除）
function confirmAiProviderModelSelectAdd() {
    if (!aiProviderModelInput) return;
    // 从数据读取勾选状态（含被过滤隐藏的项）
    const result = aiModelSelectEntries.filter(function(en) { return en.checked; }).map(function(en) { return en.id; });
    const resultSet = new Set(result);

    const original = (aiProviderModelInput.value || '').split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
    const originalSet = new Set(original);
    const addedCount = result.filter(function(id) { return !originalSet.has(id); }).length;
    const removedCount = original.filter(function(m) { return !resultSet.has(m); }).length;

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
