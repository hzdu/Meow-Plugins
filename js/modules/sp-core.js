// sp-core.js - 核心：全局状态、DOM元素、工具函数、数据加载、Tab切换、初始化入口
// 此文件由 sidepanel.js 拆分而来

// ================== 全局状态变量 ==================
let myPrompts = [];
let promptCategories = [
    { id: 'chatgpt', name: 'ChatGPT' },
    { id: 'midjourney', name: 'Midjourney' },
    { id: 'sd', name: 'Stable Diff' },
    { id: 'claude', name: 'Claude' },
    { id: 'other', name: '通用' }
];
let currentFilter = 'all';
let editingPromptId = null;
let myScratchList = [];
let myReadLaterList = [];
let myGalleryImages = [];
let currentLightboxImageId = null;
let currentScratchEditId = null;
let myAiTags = [];
let currentAiTagId = null;
let editingAiTagId = null;

// 图集选中 ID 集合
let selectedImageIds = new Set();

// 2FA 数据
let my2faAccounts = [];
let editing2faId = null;
let faRefreshIntervals = {};
let faAutoFetch = false;
let faDragSrcIndex = null;

let myAiProviders = [];
let editingAiId = null;
let aiDragSrcIndex = null;

// 分类管理拖拽
let dragSrcIndex = null;

// 工具卡片拖拽
let toolDragSrcIndex = null;

// 热搜拖拽
let hotDragSrcEl = null;

// 时钟
let clockInterval = null;

// ================== DOM 元素获取 ==================
const tabBtns = document.querySelectorAll('.tab-btn');
const viewPrompts = document.getElementById('view-prompts');
const viewScratchpad = document.getElementById('view-scratchpad');
const viewReadLater = document.getElementById('view-readlater');
const viewGallery = document.getElementById('view-gallery');
const viewHot = document.getElementById('view-hot');
const viewClock = document.getElementById('view-clock');
const viewTools = document.getElementById('view-tools');
const viewServers = document.getElementById('view-servers');
const viewAiCollection = document.getElementById('view-aicollection');
const view2fa = document.getElementById('view-2fa');
const viewAiProvider = document.getElementById('view-ai-provider');

const filterSection = document.getElementById('sp-filters');
const toolsSection = document.getElementById('sp-tools');
const readLaterTools = document.getElementById('rl-tools');

const searchGroupPrompts = document.getElementById('search-group-prompts');
const searchGroupScratch = document.getElementById('search-group-scratch');
const searchGroupReadLater = document.getElementById('search-group-readlater');
const searchPromptsInput = document.getElementById('search-prompts-input');
const searchScratchInput = document.getElementById('search-scratch-input');
const searchReadLaterInput = document.getElementById('search-readlater-input');

const openFullCatBtn = document.getElementById('open-full-cat-btn');
const fullCatModal = document.getElementById('full-cat-modal');
const closeFullCatModal = document.getElementById('close-full-cat-modal');
const fullCatGrid = document.getElementById('full-cat-grid');

const bottomSection = document.querySelector('.bottom-section');
const inputGroupPrompts = document.getElementById('input-group-prompts');
const inputGroupScratchpad = document.getElementById('input-group-scratchpad');
const inputGroupGallery = document.getElementById('input-group-gallery');
const inputGroupTools = document.getElementById('input-group-tools');
// 图集批量操作元素
const galleryControls = document.getElementById('gallery-controls');
const gallerySelectAllBtn = document.getElementById('gallery-select-all');
const galleryBulkDeleteBtn = document.getElementById('gallery-bulk-delete');
const gallerySelectCountLabel = document.getElementById('gallery-select-count');

// AI 提示词相关
const categorySelect = document.getElementById('sp-category');
const titleInput = document.getElementById('sp-title');
const contentInput = document.getElementById('sp-content');
const addBtn = document.getElementById('sp-add-btn');
const cancelBtn = document.getElementById('sp-cancel-btn');
const filterContainer = document.getElementById('sp-filters');
const listContainer = document.getElementById('sp-list');
const emptyState = document.getElementById('sp-empty');
const promptHeader = document.getElementById('prompt-collapse-header');
const promptBody = document.getElementById('prompt-collapse-body');

const scratchList = document.getElementById('scratch-list');
const scratchEmpty = document.getElementById('scratch-empty');
const scratchInput = document.getElementById('scratch-input');
const scratchAddBtn = document.getElementById('scratch-add-btn');
const scratchClearBtn = document.getElementById('sp-clear-all');
const scratchHeader = document.getElementById('scratch-collapse-header');
const scratchBody = document.getElementById('scratch-collapse-body');

const readLaterList = document.getElementById('readlater-list');
const readLaterEmpty = document.getElementById('readlater-empty');
const readLaterClearBtn = document.getElementById('rl-clear-all');

const galleryGrid = document.getElementById('gallery-grid');
const galleryEmpty = document.getElementById('gallery-empty');
const galleryDropZone = document.getElementById('gallery-drop-zone');
const lightbox = document.getElementById('gallery-lightbox');
const lbImage = document.getElementById('lb-image');
const lbCloseBtn = document.getElementById('lb-close-btn');
const lbCopyBtn = document.getElementById('lb-copy-btn');
const lbBase64Btn = document.getElementById('lb-base64-btn');
const lbOpenBtn = document.getElementById('lb-open-btn');
const lbDownloadBtn = document.getElementById('lb-download-btn');
const lbDeleteBtn = document.getElementById('lb-delete-btn');

// 热门榜单元素
const hotTabs = document.querySelectorAll('.hot-tab');
const hotListContainer = document.getElementById('hot-list');
const hotLoading = document.getElementById('hot-loading');
const hotEmpty = document.getElementById('hot-empty');

// 工具箱元素
const numShorthandInput = document.getElementById("num-shorthand-input");
const numShorthandOutput = document.getElementById("num-shorthand-output");
const numShorthandSpoken = document.getElementById("num-shorthand-spoken");
const numFormatInput = document.getElementById("num-format-input");
const numFormatOutput = document.getElementById("num-format-output");
const numCapitalInput = document.getElementById("num-capital-input");
const numCapitalOutput = document.getElementById("num-capital-output");
const urlInput = document.getElementById("url-input");
const btnUrlEncode = document.getElementById("btn-url-encode");
const btnUrlDecode = document.getElementById("btn-url-decode");
const uniInput = document.getElementById("uni-input");
const btnUniEncode = document.getElementById("btn-uni-encode");
const btnUniDecode = document.getElementById("btn-uni-decode");
const headerInput = document.getElementById("header-input");
const btnHeaderFmt = document.getElementById("btn-header-fmt");
const headerOutput = document.getElementById("header-output");
const imgB64DropZone = document.getElementById("img-b64-drop-zone");
const imgFileInput = document.getElementById("img-file-input");
const imgBase64Output = document.getElementById("img-base64-output");
const btnImgCopy = document.getElementById("btn-img-copy");
const btnImgClear = document.getElementById("btn-img-clear");
const base64ImgInput = document.getElementById("base64-img-input");
const btnBase64Preview = document.getElementById("btn-base64-preview");
const btnBase64Download = document.getElementById("btn-base64-download");
const btnBase64Clear = document.getElementById("btn-base64-clear");
const base64PreviewImg = document.getElementById("base64-preview-img");
const btnIpQuery = document.getElementById('btn-ip-query');
const ipResultArea = document.getElementById('ip-result-area');
const btnCopyCnIp = document.getElementById('btn-copy-cn-ip');
const btnCopyIntlIp = document.getElementById('btn-copy-intl-ip');
const b64TextInput = document.getElementById("b64-text-input");
const b64TextOutput = document.getElementById("b64-text-output");
const btnTextB64Encode = document.getElementById("btn-text-b64-encode");
const btnTextB64Decode = document.getElementById("btn-text-b64-decode");
const btnTextB64Clear = document.getElementById("btn-text-b64-clear");
const btnTextB64Copy = document.getElementById("btn-text-b64-copy");
const ipRiskVal = document.getElementById("ip-risk-val");
const linkScamalytics = document.getElementById("link-scamalytics");
const uuidOutput = document.getElementById("uuid-output");
const btnUuidGenerate = document.getElementById("btn-uuid-generate");
const btnUuidCopy = document.getElementById("btn-uuid-copy");

const toast = document.getElementById('toast');
const manageCatBtn = document.getElementById('manage-cat-btn');
const catModal = document.getElementById('cat-modal');
const closeCatModal = document.getElementById('close-cat-modal');
const catManageList = document.getElementById('cat-manage-list');
const newCatInput = document.getElementById('new-cat-name');
const addNewCatBtn = document.getElementById('add-new-cat-btn');
const textViewModal = document.getElementById('text-view-modal');
const closeTextViewModal = document.getElementById('close-text-modal');
const textViewContent = document.getElementById('text-modal-content');

const scratchEditModal = document.getElementById('scratch-edit-modal');
const closeScratchModalBtn = document.getElementById('close-scratch-modal');
const scratchModalInput = document.getElementById('scratch-modal-input');
const scratchModalSaveBtn = document.getElementById('scratch-modal-save');
const scratchModalCancelBtn = document.getElementById('scratch-modal-cancel');

// 2FA 元素
const faList = document.getElementById('fa-list');
const faEmpty = document.getElementById('fa-empty');
const faAddBtn = document.getElementById('fa-add-btn');
const faModal = document.getElementById('fa-modal');
const faModalTitle = document.getElementById('fa-modal-title');
const closeFaModal = document.getElementById('close-fa-modal');
const faNameInput = document.getElementById('fa-name-input');
const faKeyInput = document.getElementById('fa-key-input');
const faSaveBtn = document.getElementById('fa-save-btn');
const faDeleteBtn = document.getElementById('fa-delete-btn');
const faImportBtn = document.getElementById('fa-import-btn');
const faExportBtn = document.getElementById('fa-export-btn');

// AI Provider 元素
const aiProviderList = document.getElementById('ai-provider-list');
const aiProviderEmpty = document.getElementById('ai-provider-empty');
const aiProviderAddBtn = document.getElementById('ai-provider-add-btn');
const aiProviderExportBtn = document.getElementById('ai-provider-export-btn');
const aiProviderImportBtn = document.getElementById('ai-provider-import-btn');
const aiProviderFilterInput = document.getElementById('ai-provider-filter-input');
const aiProviderFilterClear = document.getElementById('ai-provider-filter-clear');
const aiProviderModal = document.getElementById('ai-provider-modal');
const aiProviderModalTitle = document.getElementById('ai-provider-modal-title');
const closeAiProviderModal = document.getElementById('close-ai-provider-modal');
const aiProviderTitleInput = document.getElementById('ai-provider-title-input');
const aiProviderTypeInput = document.getElementById('ai-provider-type-input');
const aiProviderOfficialInput = document.getElementById('ai-provider-official-input');
const aiProviderUrlInput = document.getElementById('ai-provider-url-input');
const aiProviderKeyInput = document.getElementById('ai-provider-key-input');
const aiProviderModelInput = document.getElementById('ai-provider-model-input');
const aiProviderNoteInput = document.getElementById('ai-provider-note-input');
const aiProviderSaveBtn = document.getElementById('ai-provider-save-btn');
const aiProviderDeleteBtn = document.getElementById('ai-provider-delete-btn');
const aiProviderNoteViewer = document.getElementById('ai-provider-note-viewer');
const aiProviderNoteViewerContent = document.getElementById('ai-provider-note-viewer-content');
const closeAiProviderNoteViewer = document.getElementById('close-ai-provider-note-viewer');

// AI Setting 选择弹窗元素
const aiSettingSelectModal = document.getElementById('ai-setting-select-modal');
const aiSettingSelectTitle = document.getElementById('ai-setting-select-title');
const aiSettingSelectList = document.getElementById('ai-setting-select-list');
const closeAiSettingSelectModal = document.getElementById('close-ai-setting-select-modal');

// AI合集元素
const aiTagsContainer = document.getElementById('ai-tags-container');
const aiIframeWrapper = document.getElementById('ai-iframe-wrapper');
const aiIframe = document.getElementById('ai-iframe');
const aiEmpty = document.getElementById('ai-empty');
const aiTagAddBtn = document.getElementById('ai-tag-add-btn');
const aiTagModal = document.getElementById('ai-tag-modal');
const aiModalTitle = document.getElementById('ai-modal-title');
const closeAiModal = document.getElementById('close-ai-modal');
const aiTagNameInput = document.getElementById('ai-tag-name');
const aiTagUrlInput = document.getElementById('ai-tag-url');
const aiTagSaveBtn = document.getElementById('ai-tag-save-btn');
const aiTagDeleteBtn = document.getElementById('ai-tag-delete-btn');
const aiTagNewtabCheckbox = document.getElementById('ai-tag-newtab');
const aiTagDefaultCheckbox = document.getElementById('ai-tag-default');
const aiTagDefaultLabel = document.getElementById('ai-tag-default-label');
const aiTagAllBtn = document.getElementById('ai-tag-all-btn');
const aiAllModal = document.getElementById('ai-all-modal');
const aiAllGrid = document.getElementById('ai-all-grid');
const closeAiAllModal = document.getElementById('close-ai-all-modal');

// ================== 工具函数 ==================
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 300);
    }, 3000);
}

function copyToClipboard(text, hintElement) {
    const onSuccess = () => {
        showToast(meowI18n.t('msg_copied'));
        if (hintElement) {
            if(hintElement.tagName === 'SPAN') {
                const originalHTML = hintElement.innerHTML;
                hintElement.innerHTML = `<span class="material-icons" style="font-size:12px">check</span> ${meowI18n.t('msg_copied')}`;
                hintElement.classList.add('copied');
                setTimeout(() => {
                    hintElement.innerHTML = originalHTML;
                    hintElement.classList.remove('copied');
                }, 1500);
            } else {
                hintElement.classList.add('copied');
                setTimeout(() => hintElement.classList.remove('copied'), 500);
            }
        }
    };
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            onSuccess();
        } catch (e) {
            console.error('Copy fallback failed:', e);
        }
        document.body.removeChild(textArea);
    });
}

function formatTime(timestamp) {
    const d = new Date(timestamp);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ================== 数据加载与保存 ==================
async function loadData() {
    const syncData = await chrome.storage.sync.get(['meow_prompts', 'prompt_categories', 'meow_scratchpad_list', 'meow_read_later', 'meow_ai_tags', 'meow_hot_tab_order']);
    const localData = await chrome.storage.local.get(['meow_gallery', 'meow_scratchpad', 'meow_scratchpad_list_local', 'meow_2fa_accounts', 'meow_prompts']);

    // 提示词从 sync 迁移到 local（sync 有 8KB 单项限制，长提示词会存储失败）
    if (localData.meow_prompts) {
        myPrompts = localData.meow_prompts;
    } else if (syncData.meow_prompts) {
        myPrompts = syncData.meow_prompts;
        // 迁移到 local 并清理 sync 中的旧数据
        chrome.storage.local.set({ 'meow_prompts': myPrompts });
        chrome.storage.sync.remove('meow_prompts');
    }
    if (syncData.prompt_categories) promptCategories = syncData.prompt_categories;

    if (localData.meow_scratchpad_list_local) {
        myScratchList = localData.meow_scratchpad_list_local;
    } else if (syncData.meow_scratchpad_list) {
        myScratchList = syncData.meow_scratchpad_list;
    }

    if (syncData.meow_read_later) myReadLaterList = syncData.meow_read_later;
    if (syncData.meow_ai_tags) myAiTags = syncData.meow_ai_tags;
    if (localData.meow_gallery) myGalleryImages = localData.meow_gallery;
    my2faAccounts = localData.meow_2fa_accounts || [];
    faAutoFetch = localData.meow_2fa_auto_fetch || false;
}

function saveData() {
    chrome.storage.sync.set({
        'prompt_categories': promptCategories,
        'meow_read_later': myReadLaterList,
        'meow_ai_tags': myAiTags
    });
    chrome.storage.local.set({
        'meow_prompts': myPrompts,
        'meow_gallery': myGalleryImages,
        'meow_scratchpad_list_local': myScratchList,
        'meow_2fa_accounts': my2faAccounts
    });
}

// ================== 辅助函数 ==================
function openIpToolsAndQuery() {
    const toolsBtn = document.querySelector('.tab-btn[data-target="tools"]');
    if (toolsBtn) {
        toolsBtn.click();
    }
    setTimeout(() => {
        const ipCard = document.querySelector('#view-tools .tool-card');
        if (ipCard && ipCard.classList.contains('collapsed')) {
            ipCard.classList.remove('collapsed');
        }
        const queryBtn = document.getElementById('btn-ip-query');
        if (queryBtn) {
            queryBtn.click();
        }
    }, 100);
}

function switchToAiCollection() {
    const aiBtn = document.querySelector('.tab-btn[data-target="aicollection"]');
    if (aiBtn) {
        aiBtn.click();
    }
}

// ================== 保存/恢复上次活跃标签 ==================
function saveLastTab(target) {
    chrome.storage.local.set({ 'meow_last_tab': target });
}

function restoreLastTab() {
    chrome.storage.local.get(['meow_last_tab'], (result) => {
        const saved = result.meow_last_tab;
        if (saved) {
            const targetBtn = document.querySelector(`.tab-btn[data-target="${saved}"]`);
            if (targetBtn) { targetBtn.click(); return; }
        }
        const defaultBtn = document.querySelector('.tab-btn.active');
        if (defaultBtn) defaultBtn.click();
    });
}

// ================== 侧边栏顶部 Tab 拖拽排序 ==================
function saveSpTabOrder() {
    const tabGroup = document.querySelector('.tab-group');
    if (!tabGroup) return;
    const tabs = tabGroup.querySelectorAll('.tab-btn');
    const order = Array.from(tabs).map(t => t.dataset.target);
    chrome.storage.local.set({ 'meow_sp_tab_order': order });
}

function restoreSpTabOrder() {
    const tabGroup = document.querySelector('.tab-group');
    if (!tabGroup) return;
    chrome.storage.local.get(['meow_sp_tab_order'], (result) => {
        const order = result.meow_sp_tab_order;
        if (!order || !Array.isArray(order) || order.length === 0) return;
        const currentTabs = tabGroup.querySelectorAll('.tab-btn');
        const currentOrder = Array.from(currentTabs).map(t => t.dataset.target);
        if (JSON.stringify(order) === JSON.stringify(currentOrder)) return;
        const tabMap = {};
        currentTabs.forEach(t => { tabMap[t.dataset.target] = t; });
        order.forEach(tabKey => {
            if (tabMap[tabKey]) tabGroup.appendChild(tabMap[tabKey]);
        });
    });
}

function initSpTabDragSort() {
    const tabGroup = document.querySelector('.tab-group');
    if (!tabGroup) return;
    const tabs = tabGroup.querySelectorAll('.tab-btn');
    let dragSrcEl = null;
    tabs.forEach(tab => {
        tab.draggable = true;
        tab.addEventListener('dragstart', (e) => {
            dragSrcEl = tab;
            tab.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tab.dataset.target);
        });
        tab.addEventListener('dragend', () => {
            tab.classList.remove('dragging');
            tabGroup.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('drag-over'));
            dragSrcEl = null;
        });
        tab.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            tab.classList.add('drag-over');
        });
        tab.addEventListener('dragleave', () => {
            tab.classList.remove('drag-over');
        });
        tab.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            tab.classList.remove('drag-over');
            if (!dragSrcEl || dragSrcEl === tab) return;
            const allTabs = tabGroup.querySelectorAll('.tab-btn');
            const srcIdx = Array.from(allTabs).indexOf(dragSrcEl);
            const tgtIdx = Array.from(allTabs).indexOf(tab);
            if (srcIdx < 0 || tgtIdx < 0) return;
            if (srcIdx < tgtIdx) tabGroup.insertBefore(dragSrcEl, tab.nextSibling);
            else tabGroup.insertBefore(dragSrcEl, tab);
            saveSpTabOrder();
        });
    });
}

// ================== 全部分类选择面板逻辑 ==================
function renderFullCatPanel() {
    fullCatGrid.innerHTML = '';
    const labelAll = meowI18n.lang.startsWith('zh') ? '全部' : 'All';

    const allItem = document.createElement('div');
    const isAllActive = (currentFilter === 'all');
    allItem.className = 'full-cat-item' + (isAllActive ? ' active' : '');
    allItem.innerHTML = '<span>' + labelAll + '</span>' + (isAllActive ? '<span class="material-icons">check_circle</span>' : '');
    allItem.addEventListener('click', function() { selectCategoryAndClose('all'); });
    fullCatGrid.appendChild(allItem);

    promptCategories.forEach(function(cat) {
        const item = document.createElement('div');
        const isActive = (currentFilter === cat.id);
        item.className = 'full-cat-item' + (isActive ? ' active' : '');
        item.innerHTML = '<span>' + escapeHtml(cat.name) + '</span>' + (isActive ? '<span class="material-icons">check_circle</span>' : '');
        item.addEventListener('click', function() { selectCategoryAndClose(cat.id); });
        fullCatGrid.appendChild(item);
    });
}

function selectCategoryAndClose(catId) {
    currentFilter = catId;
    renderFilters();
    renderPromptList();
    fullCatModal.classList.add('hidden');
    const activeBtn = filterContainer.querySelector('.filter-btn[data-id="' + catId + '"]');
    if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

// ================== 分类管理 ==================
function renderCatManager() {
    catManageList.innerHTML = '';
    promptCategories.forEach(function(cat, index) {
        const div = document.createElement('div');
        div.className = 'cat-item-row';
        div.draggable = true;
        div.dataset.index = index;
        div.innerHTML = '<span class="material-icons drag-handle">drag_indicator</span><span class="cat-name" title="Rename">' + escapeHtml(cat.name) + '</span><div class="cat-actions"><span class="material-icons cat-del-btn" title="Delete">delete</span></div>';

        div.querySelector('.cat-name').addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            const newName = prompt('Rename "' + cat.name + '":', cat.name);
            if (newName && newName.trim()) { promptCategories[index].name = newName.trim(); saveData(); renderCatManager(); renderCategories(); renderFilters(); renderPromptList(); }
        });

        div.querySelector('.cat-del-btn').addEventListener('click', async function(e) {
            e.stopPropagation(); if (promptCategories.length <= 1) { showToast("Keep at least one"); return; }
            if (await showConfirmDialog({ message: meowI18n.t('msg_confirm_del'), type: 'danger' })) { promptCategories.splice(index, 1); if(currentFilter === cat.id) currentFilter = 'all'; saveData(); renderCatManager(); renderCategories(); renderFilters(); renderPromptList(); }
        });

        div.addEventListener('dragstart', function(e) { div.classList.add('dragging'); dragSrcIndex = index; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', index); });
        div.addEventListener('dragend', function() { div.classList.remove('dragging'); document.querySelectorAll('.cat-item-row').forEach(row => row.classList.remove('drag-over')); });
        div.addEventListener('dragover', function(e) { e.preventDefault(); div.classList.add('drag-over'); });
        div.addEventListener('dragleave', function() { div.classList.remove('drag-over'); });
        div.addEventListener('drop', function(e) {
            e.stopPropagation(); e.preventDefault();
            const dragDestIndex = index;
            if (dragSrcIndex !== null && dragSrcIndex !== dragDestIndex) {
                const itemToMove = promptCategories[dragSrcIndex];
                promptCategories.splice(dragSrcIndex, 1);
                promptCategories.splice(dragDestIndex, 0, itemToMove);
                saveData(); renderCatManager(); renderCategories(); renderFilters();
            }
            return false;
        });
        catManageList.appendChild(div);
    });
}

// ================== 初始化入口 ==================
async function initSidepanel() {
    // === 0. 初始化国际化 ===
    if (window.meowI18n) {
        await window.meowI18n.init();
    }

    // === 1. 建立与后台的长连接 (实现 Toggle 关闭功能) ===
    try {
        chrome.windows.getCurrent((win) => {
            if (win) {
                const port = chrome.runtime.connect({ name: 'meow-sidepanel-connection' });
                port.postMessage({ type: 'init', windowId: win.id });

                port.onMessage.addListener((msg) => {
                    if (msg.action === 'close-panel') {
                        window.close();
                    }
                    if (msg.action === 'open-ip-tools') {
                        openIpToolsAndQuery();
                    }
                    if (msg.action === 'open-ai-collection') {
                        switchToAiCollection();
                    }
                });
            }
        });
    } catch (err) {
        console.error("Meow: Failed to connect to background service worker.", err);
    }

    // === 1.5 自动聚焦 ===
    document.addEventListener('mouseenter', () => {
        window.focus();
        document.body.focus();
        console.log("Meow Sidepanel: Focused on mouseenter");
    });

    // 检查是否需要自动打开 IP 工具或 AI 合集
    chrome.storage.local.get(['meow_open_ip_tools', 'meow_open_ai_collection'], (result) => {
        if (result.meow_open_ip_tools) {
            chrome.storage.local.remove('meow_open_ip_tools');
            setTimeout(() => {
                openIpToolsAndQuery();
            }, 300);
        }
        if (result.meow_open_ai_collection) {
            chrome.storage.local.remove('meow_open_ai_collection');
            setTimeout(() => {
                switchToAiCollection();
            }, 300);
        }
    });

    // === 初始化加载 ===
    await loadData();
    renderCategories();
    renderFilters();
    renderPromptList();
    renderScratchList();
    renderReadLaterList();
    renderGallery();
    setupConverterLogic();
    setupToolCardToggle();
    setupToolCardDrag();
    applySavedToolOrder();
    setup2FALogic();
    setupAILogic();
    setupServerLogic();
    addPasteHandler(scratchInput);
    addPasteHandler(scratchModalInput);

    // === 初始化热榜Tab排序 ===
    applySavedHotTabOrder();

    // === 初始加载热榜数据 ===
    const activeHotTab = document.querySelector('.hot-tab.active');
    if (activeHotTab) {
        fetchHotList(activeHotTab.dataset.source);
    }

    // === 搜索监听（在此注册以确保 render 函数已定义）===
    searchPromptsInput.addEventListener('input', renderPromptList);
    searchScratchInput.addEventListener('input', renderScratchList);
    searchReadLaterInput.addEventListener('input', renderReadLaterList);

    // === 恢复顶部 Tab 排序 ===
    restoreSpTabOrder();

    // === 初始化顶部 Tab 拖拽排序 ===
    initSpTabDragSort();

    // === 恢复上次停留的标签页 ===
    restoreLastTab();
}

// ================== Tab 切换逻辑 ==================
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.target;

        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        saveLastTab(target);

        // 1. 隐藏所有视图
        [viewPrompts, viewScratchpad, viewReadLater, viewGallery, viewTools, viewHot, viewClock, viewAiCollection, view2fa, viewAiProvider, viewServers].forEach(el => {
            if(el) el.classList.add('hidden');
        });
        [filterSection.parentElement, toolsSection, readLaterTools].forEach(el => el.classList.add('hidden'));
        [searchGroupPrompts, searchGroupScratch, searchGroupReadLater].forEach(el => el.classList.add('hidden'));

        // 2. 重置底部及批量操作条
        bottomSection.classList.add('hidden');
        galleryControls.classList.add('hidden');
        [inputGroupPrompts, inputGroupScratchpad, inputGroupGallery, inputGroupTools].forEach(el => el.classList.add('hidden'));

        // 如果离开2FA标签，清理定时器
        if (target !== '2fa') {
            Object.keys(faRefreshIntervals).forEach(id => {
                clearInterval(faRefreshIntervals[id]);
                clearTimeout(faRefreshIntervals[id + '_timeout']);
            });
            faRefreshIntervals = {};
        }

        if (target === 'prompts') {
            viewPrompts.classList.remove('hidden');
            filterSection.parentElement.classList.remove('hidden');
            searchGroupPrompts.classList.remove('hidden');
            bottomSection.classList.remove('hidden');
            inputGroupPrompts.classList.remove('hidden');
        } else if (target === 'scratchpad') {
            viewScratchpad.classList.remove('hidden');
            toolsSection.classList.remove('hidden');
            searchGroupScratch.classList.remove('hidden');
            bottomSection.classList.remove('hidden');
            inputGroupScratchpad.classList.remove('hidden');
        } else if (target === 'readlater') {
            viewReadLater.classList.remove('hidden');
            readLaterTools.classList.remove('hidden');
            searchGroupReadLater.classList.remove('hidden');
        } else if (target === 'gallery') {
            viewGallery.classList.remove('hidden');
            galleryControls.classList.remove('hidden');
            bottomSection.classList.remove('hidden');
            inputGroupGallery.classList.remove('hidden');
            renderGallery();
        } else if (target === 'hot') {
            viewHot.classList.remove('hidden');
            const activeHotTab = document.querySelector('.hot-tab.active');
            if (activeHotTab) {
                fetchHotList(activeHotTab.dataset.source);
            }
        } else if (target === 'clock') {
            viewClock.classList.remove('hidden');
            startClockTicker();
        } else if (target === '2fa') {
            view2fa.classList.remove('hidden');
            render2FA();
        } else if (target === 'tools') {
            viewTools.classList.remove('hidden');
            checkAndInitIpTools();
        } else if (target === 'servers') {
            viewServers.classList.remove('hidden');
            if (typeof renderServers === 'function') renderServers();
        } else if (target === 'aicollection') {
            viewAiCollection.classList.remove('hidden');
            renderAiTags();
            loadDefaultAiTag();
        } else if (target === 'ai-provider') {
            viewAiProvider.classList.remove('hidden');
            if (typeof renderAIProviders === 'function') renderAIProviders();
        }
    });
});

// ================== 全部分类面板事件 ==================
openFullCatBtn.addEventListener('click', function() { renderFullCatPanel(); fullCatModal.classList.remove('hidden'); });
closeFullCatModal.addEventListener('click', function() { fullCatModal.classList.add('hidden'); });
fullCatModal.addEventListener('click', function(e) { if (e.target === fullCatModal) fullCatModal.classList.add('hidden'); });

// ================== 分类管理事件 ==================
manageCatBtn.addEventListener('click', function() { renderCatManager(); catModal.classList.remove('hidden'); setTimeout(function() { newCatInput.focus(); }, 100); });
closeCatModal.addEventListener('click', function() { catModal.classList.add('hidden'); });

if (newCatInput) {
    newCatInput.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addNewCatBtn.click(); } });
}

addNewCatBtn.addEventListener('click', function() {
    const name = newCatInput.value.trim(); if (!name) return;
    if (promptCategories.some(function(c) { return c.name === name; })) { showToast("Name exists"); return; }
    const id = 'cat_' + Date.now(); promptCategories.push({ id: id, name: name }); saveData();
    newCatInput.value = ''; renderCatManager(); renderCategories(); renderFilters(); categorySelect.value = id;
    setTimeout(function() { if(catManageList.lastElementChild) catManageList.lastElementChild.scrollIntoView({ behavior: 'smooth' }); }, 50);
});

// ================== 存储监听 ==================
chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'local' && changes.meow_gallery) { loadData().then(renderGallery); return; }
    if (area === 'sync') {
        loadData().then(() => {
            renderCategories(); renderFilters(); renderPromptList(); renderReadLaterList();
            if (!catModal.classList.contains('hidden')) renderCatManager();
        });
    }
    if (area === 'local' && changes.meow_scratchpad_list_local) {
        myScratchList = changes.meow_scratchpad_list_local.newValue || [];
        renderScratchList();
    }
    if (area === 'local' && changes.meow_2fa_accounts) {
        my2faAccounts = changes.meow_2fa_accounts.newValue || [];
        if (!view2fa.classList.contains('hidden')) render2FA();
    }
});

// ================== 键盘与快捷键监听 ==================
document.addEventListener('keydown', function(e) {
    // Alt+F1 切换标签页
    if (e.altKey && (e.code === 'F1' || e.key === 'F1')) {
        e.preventDefault();
        const tabs = Array.from(document.querySelectorAll('.tab-btn')), idx = tabs.findIndex(btn => btn.classList.contains('active'));
        tabs[(idx + 1) % tabs.length].click();
    }
    // Alt+F2 切换热榜竖向Tab
    if (e.altKey && (e.code === 'F2' || e.key === 'F2')) {
        e.preventDefault();
        const hotTabsList = Array.from(document.querySelectorAll('.hot-tab'));
        if (hotTabsList.length > 0) {
            const activeIdx = hotTabsList.findIndex(tab => tab.classList.contains('active'));
            const nextIdx = (activeIdx + 1) % hotTabsList.length;
            hotTabsList[nextIdx].click();
        }
    }
    // Alt+I 打开 IP 工具并查询
    if (e.altKey && (e.code === 'KeyI' || e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        openIpToolsAndQuery();
    }
    if (e.shiftKey) {
        const isUp = e.key === 'ArrowUp', isDown = e.key === 'ArrowDown';
        if (!isUp && !isDown) return;
        const activeEl = document.activeElement;
        const isInputFocus = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true');
        if (isInputFocus) return;

        const targetBody = !viewPrompts.classList.contains('hidden') ? promptBody : (!viewScratchpad.classList.contains('hidden') ? scratchBody : null), targetHeader = !viewPrompts.classList.contains('hidden') ? promptHeader : (!viewScratchpad.classList.contains('hidden') ? scratchHeader : null);
        if (targetBody && targetHeader) {
            e.preventDefault();
            if (isUp) {
                targetBody.classList.add('expanded'); targetHeader.classList.add('active');
                const input = targetBody.querySelector('input, textarea, .rich-input');
                if (input) input.focus();
            } else {
                targetBody.classList.remove('expanded'); targetHeader.classList.remove('active');
                document.activeElement.blur();
            }
        }
    }
});
