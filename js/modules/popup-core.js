// popup-core.js - 核心：DOM元素获取、状态变量、辅助函数、Tab/UI逻辑、renderApp入口
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// js/popup.js - Meow 完整版 (已修复倒数日通知栏多语言)

// 全局变量，用于倒数日翻页动画
let tickerInterval = null;

// === DOM 元素获取 ===
// 日历相关
const daysTag = document.getElementById("calendar-days");
const dateHeaderBtn = document.getElementById("date-header-btn");
const currentDateText = document.getElementById("current-date-text");
const datePickerPanel = document.getElementById("date-picker-panel");
const yearGrid = document.getElementById("year-grid");
const monthGrid = document.getElementById("month-grid");
const pickerYearRange = document.getElementById("picker-year-range");
const prevYearsBtn = document.getElementById("prev-years");
const nextYearsBtn = document.getElementById("next-years");
const prevIcon = document.getElementById("prev");
const nextIcon = document.getElementById("next");
const todayBtn = document.getElementById("today-btn");
const selectedDateDisplay = document.getElementById("selected-date-display");

// 选项卡与布局
const tabBtns = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");
const tabTracker = document.querySelector('.tab-tracker');
const toggleBtn = document.getElementById('toggle-sidebar-btn');
const toggleRightBtn = document.getElementById('toggle-right-btn');
const mainContainer = document.getElementById('main-container');
const taskPanel = document.getElementById('task-panel');

// 待办元素
const newTaskInput = document.getElementById("new-task-input");
const addTaskBtn = document.getElementById("add-task-btn");
const todoList = document.getElementById("todo-list");
const emptyStateTodo = document.getElementById("empty-state-todo");
const statDone = document.getElementById("stat-done");
const statTodo = document.getElementById("stat-todo");

// 财务元素
const finType = document.getElementById("fin-type");
const finAmount = document.getElementById("fin-amount");
const finNote = document.getElementById("fin-note");
const addFinBtn = document.getElementById("add-fin-btn");
const cancelFinBtn = document.getElementById("cancel-fin-btn");
const finList = document.getElementById("fin-list");
const emptyStateFin = document.getElementById("empty-state-fin");
const summaryIncome = document.getElementById("summary-income");
const summaryExpense = document.getElementById("summary-expense");
const finInputRow = document.querySelector(".fin-input-container");
const finNoteDropdown = document.getElementById("fin-note-dropdown");

// 账本关联 Modal 元素
const finLinkModal = document.getElementById('fin-link-modal');
const finLinkClose = document.getElementById('fin-link-close');
const finLinkBody = document.getElementById('fin-link-body');
const finLinkCurrentNode = document.getElementById('fin-link-current-node');
const finLinkLinkedList = document.getElementById('fin-link-linked-list');
const finLinkDateInput = document.getElementById('fin-link-date-input');
const finLinkList = document.getElementById('fin-link-list');
const finLinkCanvas = document.getElementById('fin-link-canvas');
const finLinkGraphToggle = document.getElementById('fin-link-graph-toggle');
const finLinkGraphView = document.getElementById('fin-link-graph-view');
const finLinkGraphCanvas = document.getElementById('fin-link-graph-canvas');
const finLinkGraphNodes = document.getElementById('fin-link-graph-nodes');
const finLinkLeftPanel = document.getElementById('fin-link-left');
const finLinkRightPanel = document.getElementById('fin-link-right');
const finLinkGraphPanel = document.getElementById('fin-link-graph-panel');
const finLinkGraphPanelClose = document.getElementById('fin-link-graph-panel-close');
const finLinkGraphPanelSource = document.getElementById('fin-link-graph-panel-source');
const finLinkGraphPanelDateInput = document.getElementById('fin-link-graph-panel-date-input');
const finLinkGraphPanelList = document.getElementById('fin-link-graph-panel-list');
let finNoteHistory = [];
let finNoteActiveIndex = -1;

// 预支出元素
const peType = document.getElementById("pe-type");
const peAmount = document.getElementById("pe-amount");
const peName = document.getElementById("pe-name");
const addPeBtn = document.getElementById("add-pe-btn");
const peList = document.getElementById("pe-list");
const emptyStatePe = document.getElementById("empty-state-pe");
const peTotal = document.getElementById("pe-total");
const peNecessary = document.getElementById("pe-necessary");
const peUnnecessary = document.getElementById("pe-unnecessary");
const peIncome = document.getElementById("pe-income");
const peRecurToggle = document.getElementById("pe-recur-toggle");
const peRecurDayGroup = document.getElementById("pe-recur-day-group");
const peRecurDay = document.getElementById("pe-recur-day");
const peBackToggle = document.getElementById("pe-back-toggle");

// 初始化周期天选择器 (1-31)
(function initPeRecurDay() {
    if (!peRecurDay) return;
    for (let d = 1; d <= 31; d++) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        peRecurDay.appendChild(opt);
    }
})();

// 周期开关控制天数选择器显示 & 收入选项
if (peRecurToggle && peRecurDayGroup) {
    peRecurToggle.addEventListener('change', () => {
        const isRecur = peRecurToggle.checked;
        peRecurDayGroup.classList.toggle('hidden', !isRecur);
        
        // 开启重复时显示收入选项，关闭时隐藏并切回支出
        const incomeOpt = peType.querySelector('option[value="income"]');
        if (incomeOpt) incomeOpt.style.display = isRecur ? '' : 'none';
        if (!isRecur && peType.value === 'income') {
            peType.value = 'necessary';
        }
    });
    // 初始化：确保页面加载时收入选项状态正确
    const incomeOpt = peType.querySelector('option[value="income"]');
    if (incomeOpt) incomeOpt.style.display = 'none';
}

// 月度汇总元素
const editBeginBtn = document.getElementById("edit-begin-btn");
const monthBeginVal = document.getElementById("month-begin-val");
const monthEndVal = document.getElementById("month-end-val");

// 备注元素
const notesList = document.getElementById("notes-list");
const emptyStateNotes = document.getElementById("empty-state-notes");
const notesTotalLabel = document.getElementById("notes-total-label");

// 习惯元素
const habitsList = document.getElementById("habits-list");
const newHabitInput = document.getElementById("new-habit-input");
const addHabitBtn = document.getElementById("add-habit-btn");
const emptyStateHabits = document.getElementById("empty-state-habits");

// 闹钟元素
const alarmsList = document.getElementById("alarms-list");
const alarmTimeInput = document.getElementById("alarm-time-input");
const alarmLabelInput = document.getElementById("alarm-label-input");
const alarmIntervalInput = document.getElementById("alarm-interval-input");
const alarmPeriodicToggle = document.getElementById("alarm-periodic-toggle");
const alarmIntervalGroup = document.getElementById("alarm-interval-group");
const addAlarmBtn = document.getElementById("add-alarm-btn");
const cancelAlarmBtn = document.getElementById("cancel-alarm-btn");
const emptyStateAlarms = document.getElementById("empty-state-alarms");
const alarmRingingBar = document.getElementById("alarm-ringing-bar");
const stopAlarmBtn = document.getElementById("stop-alarm-btn");
let currentRingingAlarmId = null;   // 当前正在响铃的闹钟 ID
let editingAlarmIndex = -1;        // 当前编辑的闹钟索引，-1 表示新增

// 倒数日元素
const cdDateInput = document.getElementById("cd-date-input");
const cdTitleInput = document.getElementById("cd-title-input");
const addCdBtn = document.getElementById("add-cd-btn");
const cdList = document.getElementById("cd-list");
const emptyStateCd = document.getElementById("empty-state-cd");
const countdownSummaryCard = document.getElementById("countdown-summary-card");

// 暂存板元素
const scratchpadArea = document.getElementById("scratchpad-area");
const spCopyBtn = document.getElementById("sp-copy-btn");
const spClearBtn = document.getElementById("sp-clear-btn");
const spStatus = document.getElementById("scratchpad-status");
const spBtnTitle = document.getElementById("sp-btn-title");
const spBtnLower = document.getElementById("sp-btn-lower");
const spBtnUpper = document.getElementById("sp-btn-upper");

// 导出与备份元素
const exportBtn = document.getElementById("export-btn");
const exportRange = document.getElementById("export-range");
const backupBtn = document.getElementById("backup-btn");
const restoreInput = document.getElementById("restore-file-input");
const backupStatus = document.getElementById("backup-status");

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
const toastEl = document.getElementById('toast');

// AI Provider 元素
const aiList = document.getElementById('ai-list');
const aiEmpty = document.getElementById('ai-empty');
const aiAddBtn = document.getElementById('ai-add-btn');
const aiModal = document.getElementById('ai-modal');
const aiModalTitle = document.getElementById('ai-modal-title');
const closeAiModal = document.getElementById('close-ai-modal');
const aiTitleInput = document.getElementById('ai-title-input');
const aiTypeInput = document.getElementById('ai-type-input');
const aiOfficialInput = document.getElementById('ai-official-input');
const aiUrlInput = document.getElementById('ai-url-input');
const aiKeyInput = document.getElementById('ai-key-input');
const aiModelInput = document.getElementById('ai-model-input');
const aiNoteInput = document.getElementById('ai-note-input');
const aiSaveBtn = document.getElementById('ai-save-btn');
const aiDeleteBtn = document.getElementById('ai-delete-btn');
const aiExportBtn = document.getElementById('ai-export-btn');
const aiImportBtn = document.getElementById('ai-import-btn');
const aiFilterInput = document.getElementById('ai-filter-input');
const aiFilterClear = document.getElementById('ai-filter-clear');
const aiNoteViewer = document.getElementById('ai-note-viewer');
const aiNoteViewerContent = document.getElementById('ai-note-viewer-content');
const closeAiNoteViewer = document.getElementById('close-ai-note-viewer');

// AI Setting 元素
const aiSettingBaseUrl = document.getElementById('ai-setting-base-url');
const aiSettingModelId = document.getElementById('ai-setting-model-id');
const aiSettingApiKey = document.getElementById('ai-setting-api-key');
const aiSettingSaveBtn = document.getElementById('ai-setting-save-btn');
const aiSettingStatus = document.getElementById('ai-setting-status');
const aiSettingSelectModal = document.getElementById('ai-setting-select-modal');
const aiSettingSelectTitle = document.getElementById('ai-setting-select-title');
const aiSettingSelectList = document.getElementById('ai-setting-select-list');
const closeAiSettingSelectModal = document.getElementById('close-ai-setting-select-modal');
const aiSettingAutoProtocol = document.getElementById('ai-setting-auto-protocol');

// 批量定时元素
const batchAddBtn = document.getElementById('batch-add-btn');
const batchTimerList = document.getElementById('batch-timer-list');
const batchEmpty = document.getElementById('batch-empty');
const batchModal = document.getElementById('batch-modal');
const batchModalTitle = document.getElementById('batch-modal-title');
const batchCloseBtn = document.getElementById('close-batch-modal');
const batchNameInput = document.getElementById('batch-name-input');
const batchTimeInput = document.getElementById('batch-time-input');
const batchUrlsInput = document.getElementById('batch-urls-input');
const batchEnabledInput = document.getElementById('batch-enabled-input');
const batchAutoCloseInput = document.getElementById('batch-autoclose-input');
const batchSaveBtn = document.getElementById('batch-save-btn');
const batchDeleteBtn = document.getElementById('batch-delete-btn');
const batchDateInput = document.getElementById('batch-date-input');

// 批量定时日志元素
const batchLogList = document.getElementById('batch-log-list');
const batchLogEmpty = document.getElementById('batch-log-empty');
const batchLogClearBtn = document.getElementById('batch-log-clear-btn');

// === 状态变量 ===
let date = new Date();
let currYear = date.getFullYear();
let currMonth = date.getMonth();

let habitsConfig = []; 
let habitsRecords = {}; 
let myAlarms = []; 
let myCountdowns = []; 
let preExpensesList = [];
let calendarAllData = {}; // 缓存日历渲染时的所有数据，供 Tooltip 使用 
let cdFilter = 'all'; // 'all', 'upcoming' or 'expired'
let peFilter = 'ongoing'; // 'all', 'ongoing', 'completed'
let peSubtab = 'list'; // 'list' or 'add' — 预支出子标签

let selectedDateKey = `${currYear}-${currMonth + 1}-${date.getDate()}`;
let currentTaskList = [];
let currentFinList = [];
let editingFinIndex = -1;
let todoFilter = 'all'; // 'all', 'todo', 'done'

// 账本关联状态
let finLinkCurrentItem = null;   // 当前正在关联的账本项 { dateKey, index, item }
let finLinkSourceDate = '';       // 右侧列表所选日期
let finLinkSourceList = [];       // 右侧列表数据
let finLinks = [];                // 所有关联数据 [{ from:{dateKey,id}, to:{dateKey,id} }]
let finLinkDatePicker = null;     // flatpickr 实例
let finLinkDrag = null;           // 拖拽状态 { fromId, fromEl }
let finLinkGraphMode = false;     // 是否处于图谱视图
let finLinkGraphData = null;      // 图谱数据 { nodes:[], edges:[] }
let finLinkGraphPos = new Map();  // 节点位置 id -> {x, y}
let finLinkGraphItemMap = new Map(); // id -> {item, dateKey}
let finLinkGraphDragNode = null;  // 正在拖拽的图谱节点 { id, el, offsetX, offsetY }
let finLinkGraphScale = 1;        // 图谱缩放比例
let finLinkGraphPanX = 0;         // 图谱平移 X
let finLinkGraphPanY = 0;         // 图谱平移 Y
let finLinkGraphPanning = false;  // 是否正在平移
let finLinkGraphConnectDrag = null; // 从锚点拖出连线的状态 { fromId, fromDateKey, x, y }
let finLinkGraphPanelSourceNode = null; // 图谱面板源节点 { fromId, fromDateKey, item }
let finLinkGraphPanelDatePicker = null; // 图谱面板日期选择器
let finLinkGraphPanelDate = ''; // 图谱面板当前选择的日期

// 2FA 数据
let my2faAccounts = [];
let editing2faId = null;
let faRefreshIntervals = {};
let faAutoFetch = false;
let faDragSrcIndex = null;

// AI Provider 数据
let myAiProviders = [];
let editingAiId = null;
let aiDragSrcIndex = null;

// AI Setting 数据
let myAiSetting = { baseUrl: '', modelId: '', apiKey: '', autoProtocol: true };

// === 辅助函数 ===
async function getStorageData(key) {
    return new Promise((resolve) => {
        chrome.storage.sync.get([key], (result) => {
            resolve(result[key]);
        });
    });
}

const escapeHtml = (text) => (text != null ? String(text) : '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

const getRandomColor = () => {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 50%)`;
};

function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    requestAnimationFrame(() => {
        toastEl.classList.add('show');
    });
    setTimeout(() => {
        toastEl.classList.remove('show');
        setTimeout(() => {
            toastEl.classList.add('hidden');
        }, 300);
    }, 3000);
}

// showConfirmDialog 已独立为 js/meow-confirm.js 模块

// 显示 AI 配置提示弹窗
function showAIConfigPrompt() {
    const modal = document.getElementById('ai-config-prompt-modal');
    if (!modal) return;
    const closeBtn = document.getElementById('ai-config-close-btn');
    const goBtn = document.getElementById('ai-config-go-provider-btn');
    
    const close = () => {
        modal.classList.remove('visible');
        modal.classList.add('hidden');
    };
    
    if (closeBtn) {
        closeBtn.onclick = close;
    }
    if (goBtn) {
        goBtn.onclick = () => {
            close();
            // 切换到设置标签页，并滚动到 AI Setting 区域
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.tab === 'settings') btn.classList.add('active');
            });
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            const settingsView = document.getElementById('view-settings');
            if (settingsView) settingsView.classList.remove('hidden');
            updateTabTracker();
            // 滚动到 AI Setting 区域
            const allSections = settingsView ? settingsView.querySelectorAll('.settings-section') : [];
            for (const sec of allSections) {
                const h3 = sec.querySelector('h3');
                if (h3 && h3.textContent.includes('AI Setting')) {
                    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    break;
                }
            }
        };
    }
    
    modal.classList.remove('hidden');
    // 触发动画
    requestAnimationFrame(() => {
        modal.classList.add('visible');
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast(meowI18n.t('msg_copied') || '已复制');
    }).catch(() => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast(meowI18n.t('msg_copied') || '已复制');
        } catch (e) {
            console.error('Copy fallback failed:', e);
        }
        document.body.removeChild(textArea);
    });
}

// === Tab 滑动动画逻辑 ===
function updateTabTracker() {
    const activeBtn = document.querySelector('.tab-btn.active');
    if (activeBtn && tabTracker) {
        const isVertical = activeBtn.closest('.vertical-tabs');
        if (isVertical) {
            const tabGroup = activeBtn.closest('.tab-group');
            const scrollTop = tabGroup ? tabGroup.scrollTop : 0;
            const top = activeBtn.offsetTop - scrollTop;
            const height = activeBtn.offsetHeight;
            tabTracker.style.top = `${top}px`;
            tabTracker.style.height = `${height}px`;
            tabTracker.style.left = '4px';
            tabTracker.style.width = '32px';
        } else {
            const left = activeBtn.offsetLeft;
            const width = activeBtn.offsetWidth;
            tabTracker.style.left = `${left}px`;
            tabTracker.style.width = `${width}px`;
        }
    }
}

// Tab 组滚动时更新 tracker 位置（滚动时禁用 transition 避免拖影）
document.querySelectorAll('.tab-group').forEach(group => {
    group.addEventListener('scroll', () => {
        if (tabTracker) {
            clearTimeout(tabTracker._scrollTimer);
            tabTracker._scrollTimer = setTimeout(() => {
                tabTracker.style.transition = '';
            }, 100);
            tabTracker.style.transition = 'none';
        }
        updateTabTracker();
    });
});

// === 更新 Tab Title (多语言) ===
function updateTabTitleTips() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        const key = `tab_${btn.dataset.tab.replace('-', '_')}`;
        btn.setAttribute('title', meowI18n.t(key));
    });
}

// === 侧边栏折叠逻辑 ===
function toggleSidebarState() {
    const isRightCollapsed = mainContainer.classList.contains('right-panel-collapsed');
    // 如果右侧已折叠,先展开右侧,再折叠左侧
    if (isRightCollapsed && !mainContainer.classList.contains('sidebar-collapsed')) {
        mainContainer.classList.remove('right-panel-collapsed');
        chrome.storage.local.set({ 'meow_right_panel_collapsed': false });
    }
    mainContainer.classList.toggle('sidebar-collapsed');
    const isCollapsed = mainContainer.classList.contains('sidebar-collapsed');
    chrome.storage.local.set({ 'meow_sidebar_collapsed': isCollapsed });
    setTimeout(updateTabTracker, 305);
}

// === 右侧面板折叠逻辑 ===
function toggleRightPanelState() {
    const isSidebarCollapsed = mainContainer.classList.contains('sidebar-collapsed');
    // 如果左侧已折叠,先展开左侧,再折叠右侧
    if (isSidebarCollapsed && !mainContainer.classList.contains('right-panel-collapsed')) {
        mainContainer.classList.remove('sidebar-collapsed');
        chrome.storage.local.set({ 'meow_sidebar_collapsed': false });
    }
    mainContainer.classList.toggle('right-panel-collapsed');
    const isCollapsed = mainContainer.classList.contains('right-panel-collapsed');
    chrome.storage.local.set({ 'meow_right_panel_collapsed': isCollapsed });
    setTimeout(updateTabTracker, 305);
}

// === 全局渲染入口 ===
const renderApp = async () => {
    // 0. 恢复保存的 tab 排序
    restoreTabOrder();
    
    // 1. 初始化语言
    await meowI18n.init();
    updateTabTitleTips();

    // 绑定语言选择事件
    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.addEventListener('change', async (e) => {
            await meowI18n.setLang(e.target.value);
            // 重新渲染所有内容以更新文本
            renderCalendar();
            renderCountdownSummary();
            renderHabitsView();
            renderAlarmsView();
            renderCountdownsView();
            renderPreExpensesView();
            renderFinanceView(); 
            renderAssetsView();
            loadAndRenderNotesList(); 
            updateTabTitleTips();
        });
    }

    const sidebarStateKey = 'meow_sidebar_collapsed';
    const rightPanelStateKey = 'meow_right_panel_collapsed';
    chrome.storage.local.get([sidebarStateKey, rightPanelStateKey], (result) => {
        // 防止两侧同时折叠导致空白
        if (result[sidebarStateKey] && result[rightPanelStateKey]) {
            // 两侧都折叠了,清除状态恢复正常
            chrome.storage.local.set({ 
                'meow_sidebar_collapsed': false, 
                'meow_right_panel_collapsed': false 
            });
        } else {
            if (result[sidebarStateKey]) {
                mainContainer.classList.add('sidebar-collapsed');
            }
            if (result[rightPanelStateKey]) {
                mainContainer.classList.add('right-panel-collapsed');
            }
        }
        setTimeout(updateTabTracker, 100); 
    });

    await loadHabits();
    await loadAlarms(); 
    await loadCountdowns(); 
    await loadScratchpad(); 
    await loadPreExpenses(); 
    await loadAssets();
    await loadSmokingData();
    await renderCalendar();
    
    renderHabitsView(); 
    renderAlarmsView(); 
    renderCountdownsView(); 
    renderCountdownSummary(); 
    renderPreExpensesView(); 
    renderSmokingView();
    renderAssetsView();
    await loadAndRenderTaskList(selectedDateKey);
    await loadAndRenderFinanceList(selectedDateKey);
    await loadFinNoteHistory();
    await loadFinLinks();
    renderFinanceView();
    
    checkAndHighlightTabs(selectedDateKey);
    
    // 加载天气
    loadWeather();
    
    // 恢复上次选中的功能面板 Tab
    chrome.storage.local.get(['meow_last_active_tab'], (result) => {
        if (result.meow_last_active_tab) {
            const lastTab = result.meow_last_active_tab;
            const btn = document.querySelector(`.tab-btn[data-tab="${lastTab}"]`);
            if (btn) {
                btn.click();
            }
        }
    });
    // 初始化 tab 拖放排序
    initTabDragSort();
};

