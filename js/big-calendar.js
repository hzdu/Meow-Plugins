// big-calendar.js

// Validates dependencies
if (typeof meowI18n === 'undefined') {
    console.error("i18n not loaded");
}

let currentDate = new Date();
let currentYear = currentDate.getFullYear();
let currentMonth = currentDate.getMonth(); // 0-11
let today = new Date();

// DOM Elements
const displayYear = document.getElementById('display-year');
const displayMonth = document.getElementById('display-month');
const calendarGrid = document.getElementById('calendar-grid');
const btnPrevYear = document.getElementById('btn-prev-year');
const btnNextYear = document.getElementById('btn-next-year');
const btnPrevMonth = document.getElementById('btn-prev-month');
const btnNextMonth = document.getElementById('btn-next-month');
const btnToday = document.getElementById('btn-today');
const monthPlanText = document.getElementById('month-plan-text');
const btnClose = document.getElementById('btn-close');

// Data Cache
let allData = {};

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Init i18n
    if (window.meowI18n) {
        await meowI18n.init();
    }
    
    // Load Data
    await loadData();
    
    // Init Layout (three column)
    initLayout();
    
    // Render
    renderHeader();
    renderCalendar();
    
    // Listeners
    setupEventListeners();
});

async function loadData() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(null, (items) => {
            allData = items || {};
            // Load month plan
            const planKey = `month_plan_${currentYear}-${currentMonth + 1}`;
            if (monthPlanText) {
                monthPlanText.textContent = allData[planKey] || "";
            }
            resolve();
        });
    });
}

function setupEventListeners() {
    btnPrevYear.addEventListener('click', () => changeDate(-12));
    btnNextYear.addEventListener('click', () => changeDate(12));
    btnPrevMonth.addEventListener('click', () => changeDate(-1));
    btnNextMonth.addEventListener('click', () => changeDate(1));
    
    btnToday.addEventListener('click', () => {
        currentDate = new Date();
        currentYear = currentDate.getFullYear();
        currentMonth = currentDate.getMonth();
        renderHeader();
        renderCalendar();
        loadMonthPlan();
    });

    if (monthPlanText) {
        monthPlanText.addEventListener('blur', () => {
            const planKey = `month_plan_${currentYear}-${currentMonth + 1}`;
            const val = monthPlanText.textContent;
            let update = {};
            update[planKey] = val;
            chrome.storage.sync.set(update, () => {
                allData[planKey] = val;
            });
        });
        
        // Prevent enter key from creating new div/br, just basic text
        monthPlanText.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                monthPlanText.blur();
            }
        });
    }

    if (btnClose) {
        btnClose.addEventListener('click', (e) => {
             e.preventDefault();
             window.close(); // Close the tab
        });
    }
}

function changeDate(monthOffset) {
    let targetDate = new Date(currentYear, currentMonth + monthOffset, 1);
    currentYear = targetDate.getFullYear();
    currentMonth = targetDate.getMonth();
    renderHeader();
    renderCalendar();
    loadMonthPlan();
}

function loadMonthPlan() {
    const planKey = `month_plan_${currentYear}-${currentMonth + 1}`;
    monthPlanText.textContent = allData[planKey] || "";
}

function renderHeader() {
    displayYear.textContent = currentYear;
    displayMonth.textContent = String(currentMonth + 1).padStart(2, '0');
}

function renderCalendar() {
    calendarGrid.innerHTML = "";
    
    const firstDay = new Date(currentYear, currentMonth, 1).getDay(); // 0 is Sunday
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    // Previous Month padding
    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = 0; i < firstDay; i++) {
        const dayNum = prevMonthDays - firstDay + i + 1;
        const cell = createDayCell(dayNum, true);
        calendarGrid.appendChild(cell);
    }
    
    // Current Month
    for (let i = 1; i <= daysInMonth; i++) {
        const isToday = (i === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear());
        const cell = createDayCell(i, false, isToday);
        calendarGrid.appendChild(cell);
    }
    
    // Next Month padding
    const totalCells = firstDay + daysInMonth;
    const remainingCells = 42 - totalCells; // 6 rows * 7 cols = 42
    for (let i = 1; i <= remainingCells; i++) {
        const cell = createDayCell(i, true);
        calendarGrid.appendChild(cell);
    }
}

function createDayCell(dayNum, isInactive, isToday = false) {
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (isInactive) cell.classList.add('inactive');
    if (isToday) cell.classList.add('today');
    
    // Calculate date string for data lookup
    let cellYear = currentYear;
    let cellMonth = currentMonth;
    
    if (isInactive) {
        if (dayNum > 15) { // Previous month
            cellMonth--;
            if (cellMonth < 0) { cellMonth = 11; cellYear--; }
        } else { // Next month
            cellMonth++;
            if (cellMonth > 11) { cellMonth = 0; cellYear++; }
        }
    }
    
    // Handle date overflow/underflow logic correctly
    const dateObj = new Date(cellYear, cellMonth, dayNum);
    cellYear = dateObj.getFullYear();
    cellMonth = dateObj.getMonth();
    
    const dateKey = `${cellYear}-${cellMonth + 1}-${dayNum}`;
    const dayOfWeek = dateObj.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) cell.classList.add('weekend');
    
    // Header
    const lunarInfo = getLunarInfo(cellYear, cellMonth, dayNum);
    const lunarClass = lunarInfo.isFestival ? 'lunar-date festival' : 'lunar-date';
    
    const header = document.createElement('div');
    header.className = 'day-header';
    header.innerHTML = `<span class="day-number">${dayNum}</span><span class="${lunarClass}">${lunarInfo.text}</span>`;
    cell.appendChild(header);
    
    // Content container
    const content = document.createElement('div');
    content.className = 'day-content';
    
    // 1. Finance Summary (Top of content)
    const finKey = `fin_${dateKey}`;
    const fins = allData[finKey];
    if (Array.isArray(fins) && fins.length > 0) {
        let dailyIncome = 0;
        let dailyExpense = 0;
        fins.forEach(f => {
            const val = parseFloat(f.amount) || 0;
            if (f.type === 'income') dailyIncome += val;
            else dailyExpense += val;
        });
        
        if (dailyIncome > 0 || dailyExpense > 0) {
            const finSummary = document.createElement('div');
            finSummary.className = 'finance-summary';
            
            let html = '';
            if (dailyIncome > 0) {
                html += `<div class="fin-item fin-income"><span class="material-icons" style="font-size:12px">arrow_upward</span>收入 ${dailyIncome.toFixed(0)}</div>`;
            }
            if (dailyExpense > 0) {
                html += `<div class="fin-item fin-expense"><span class="material-icons" style="font-size:12px">arrow_downward</span>支出 ${dailyExpense.toFixed(0)}</div>`;
            }
            finSummary.innerHTML = html;
            
            // Click to show details
            finSummary.addEventListener('click', (e) => {
                e.stopPropagation();
                showFinanceDetails(dateKey);
            });
            
            content.appendChild(finSummary);
        }
    }
    
    // 2. Task List
    const tasks = allData[dateKey];
    if (Array.isArray(tasks) && tasks.length > 0) {
        const taskList = document.createElement('div');
        taskList.className = 'task-list';
        
        tasks.forEach((task, index) => {
            const item = document.createElement('div');
            item.className = `task-item ${task.done ? 'done' : ''}`;
            
            // Layout: Marker + Text + Action Icons (Edit, Delete)
            item.innerHTML = `
                <div class="task-marker"></div>
                <div class="task-text">${task.text}</div>
                <div class="task-actions">
                    <div class="btn-action edit material-icons" title="编辑">edit</div>
                    <div class="btn-action delete material-icons" title="删除">delete</div>
                </div>
            `;
            item.title = task.text;
            
            const btnEdit = item.querySelector('.btn-action.edit');
            const btnDelete = item.querySelector('.btn-action.delete');
            
            // Edit Click
            btnEdit.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditModal(dateKey, index);
            });
            
            // Delete Click
            btnDelete.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (await showConfirmDialog({ message: '确定要删除这个事项吗？', type: 'danger' })) {
                    deleteTask(dateKey, index);
                }
            });
            
            taskList.appendChild(item);
        });
        
        content.appendChild(taskList);
    }
    
    cell.appendChild(content);
    
    // Interaction
    cell.addEventListener('click', () => {
        // Placeholder for future interaction (e.g. open popup date)
        console.log("Selected", dateKey);
    });

    return cell;
}

// Simple Lunar date placeholder
// Lunar Info Helper
function getLunarInfo(y, m, d) {
    if (typeof Lunar === 'undefined' || typeof Solar === 'undefined') {
        return { text: '', isFestival: false };
    }

    try {
        const date = new Date(y, m, d);
        const lunar = Lunar.fromDate(date);
        const solar = Solar.fromDate(date);
        
        // Priority: Festivals > Solar Terms > Lunar Day
        
        // 1. Solar Festivals (e.g., New Year, Labor Day)
        const solarFestivals = solar.getFestivals();
        if (solarFestivals && solarFestivals.length > 0) {
            return { text: solarFestivals[0], isFestival: true };
        }
        
        // 2. Lunar Festivals (e.g., Spring Festival, Mid-Autumn)
        const lunarFestivals = lunar.getFestivals();
        if (lunarFestivals && lunarFestivals.length > 0) {
             return { text: lunarFestivals[0], isFestival: true };
        }
        
        // 3. Solar Terms (JieQi)
        const jieqi = lunar.getJieQi();
        if (jieqi) {
            return { text: jieqi, isFestival: true };
        }
        
        // 4. Lunar Day - Show full month + day format
        const lunarDay = lunar.getDayInChinese();
        const lunarMonth = lunar.getMonth(); // Get numeric month (negative for leap month)
        const monthNum = Math.abs(lunarMonth);
        const isLeap = lunarMonth < 0;
        
        // Special month names (traditional Chinese calendar names)
        const specialMonthNames = {
            1: '正月',
            11: '冬月',
            12: '腊月'
        };
        
        // Get month name
        let monthName;
        if (specialMonthNames[monthNum]) {
            monthName = (isLeap ? '闰' : '') + specialMonthNames[monthNum];
        } else {
            monthName = (isLeap ? '闰' : '') + lunar.getMonthInChinese() + '月';
        }
        
        // If it's the first day of month, show only Month name
        if (lunarDay === '初一') {
            return { text: monthName, isFestival: false };
        }
        
        // For other days, show full month + day (e.g., "冬月十二")
        return { text: monthName + lunarDay, isFestival: false };
        
    } catch (e) {
        console.error("Lunar calc error", e);
        return { text: '', isFestival: false };
    }
}

function deleteTask(dateKey, index) {
    if (allData[dateKey]) {
        allData[dateKey].splice(index, 1);
        const update = {};
        update[dateKey] = allData[dateKey];
        chrome.storage.sync.set(update, () => {
            renderCalendar();
        });
    }
}

// Modal Logic
const editModal = document.getElementById('edit-task-modal');
const editInput = document.getElementById('task-edit-input');
const btnSaveEdit = document.getElementById('btn-save-edit');
const btnCancelEdit = document.getElementById('btn-cancel-edit');
const btnCloseModal = editModal ? editModal.querySelector('.close-modal') : null;

let currentEditDateKey = null;
let currentEditIndex = null;

function openEditModal(dateKey, index) {
    if (!editModal) return;
    currentEditDateKey = dateKey;
    currentEditIndex = index;
    
    const task = allData[dateKey][index];
    editInput.value = task.text;
    
    editModal.classList.add('visible');
    editModal.classList.remove('hidden');
    editInput.focus();
}

function closeEditModal() {
    if (!editModal) return;
    editModal.classList.remove('visible');
    setTimeout(() => {
        editModal.classList.add('hidden');
    }, 300);
}

if (btnSaveEdit) {
    btnSaveEdit.addEventListener('click', () => {
        const newVal = editInput.value.trim();
        if (newVal && currentEditDateKey && currentEditIndex !== null) {
            allData[currentEditDateKey][currentEditIndex].text = newVal;
            const update = {};
            update[currentEditDateKey] = allData[currentEditDateKey];
            chrome.storage.sync.set(update, () => {
                renderCalendar();
                closeEditModal();
            });
        }
    });
}


if (btnCancelEdit) {
    btnCancelEdit.addEventListener('click', closeEditModal);
}

if (btnCloseModal) {
    btnCloseModal.addEventListener('click', closeEditModal);
}

// Modal Drag Logic
let modalTranslateX = 0;
let modalTranslateY = 0;

function resetModalPosition() {
    modalTranslateX = 0;
    modalTranslateY = 0;
    const content = editModal.querySelector('.modal-content');
    if (content) {
        content.style.transform = '';
    }
}

// Enhance openEditModal to reset position
const originalOpen = openEditModal;
openEditModal = function(dateKey, index) {
    resetModalPosition();
    originalOpen(dateKey, index);
};

// Setup Drag Events
if (editModal) {
    const header = editModal.querySelector('.modal-header');
    if (header) {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let startTranslateX = 0;
        let startTranslateY = 0;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startTranslateX = modalTranslateX;
            startTranslateY = modalTranslateY;
            document.body.style.userSelect = 'none'; // Prevent text selection
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            modalTranslateX = startTranslateX + dx;
            modalTranslateY = startTranslateY + dy;
            
            const content = editModal.querySelector('.modal-content');
            if (content) {
                content.style.transform = `translate(${modalTranslateX}px, ${modalTranslateY}px)`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.userSelect = '';
            }
        });
    }
}

if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeEditModal);
if (btnCloseModal) btnCloseModal.addEventListener('click', closeEditModal);

// Close on click outside
if (editModal) {
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal || e.target.classList.contains('modal-overlay')) {
            closeEditModal();
        }
    });
}

// ==========================================
// Three Column Layout - Resizable Panels
// ==========================================

const LAYOUT_STORAGE_KEY = 'big_calendar_layout';
const DEFAULT_LEFT_WIDTH = 250;
const DEFAULT_RIGHT_WIDTH = 250;
const MIN_PANEL_WIDTH = 150;
const MAX_PANEL_WIDTH = 400;

function initLayout() {
    const panelLeft = document.getElementById('panel-left');
    const panelRight = document.getElementById('panel-right');
    const resizerLeft = document.getElementById('resizer-left');
    const resizerRight = document.getElementById('resizer-right');
    
    if (!panelLeft || !panelRight || !resizerLeft || !resizerRight) {
        console.warn('Layout elements not found');
        return;
    }
    
    // Load saved layout from storage
    chrome.storage.sync.get([LAYOUT_STORAGE_KEY], (result) => {
        const layout = result[LAYOUT_STORAGE_KEY] || {};
        const leftWidth = layout.leftWidth || DEFAULT_LEFT_WIDTH;
        const rightWidth = layout.rightWidth || DEFAULT_RIGHT_WIDTH;
        
        panelLeft.style.width = leftWidth + 'px';
        panelRight.style.width = rightWidth + 'px';
        
        // Restore collapse state
        if (layout.rightCollapsed) {
            setRightPanelCollapsed(true, false);
        }
        if (layout.leftCollapsed) {
            setLeftPanelCollapsed(true, false);
        }
        
        // Restore active panels
        if (layout.activeLeftPanel && leftPanelConfig[layout.activeLeftPanel]) {
            switchToLeftPanel(layout.activeLeftPanel);
        }
        if (layout.activeRightPanel && rightPanelConfig[layout.activeRightPanel]) {
            switchToRightPanel(layout.activeRightPanel);
        }
    });
    
    // Setup resizer events
    setupResizer(resizerLeft, panelLeft, 'left');
    setupResizer(resizerRight, panelRight, 'right');
    
    // Toggle Buttons Right
    const btnCollapseRight = document.getElementById('btn-collapse-right');
    const btnExpandRight = document.getElementById('btn-expand-right');
    
    if (btnCollapseRight) {
        btnCollapseRight.addEventListener('click', () => setRightPanelCollapsed(true));
    }
    if (btnExpandRight) {
        btnExpandRight.addEventListener('click', () => setRightPanelCollapsed(false));
    }

    // Toggle Buttons Left - Click to collapse
    const btnCollapseLeft = document.getElementById('btn-collapse-left');
    if (btnCollapseLeft) {
        btnCollapseLeft.addEventListener('click', () => setLeftPanelCollapsed(true));
    }
    
    // Setup Icon Sidebar Interactions
    setupIconSidebar();
}

// Panel Mapping for Left Icon Sidebar
const leftPanelConfig = {
    'todo': { icon: 'assignment', title: '待办事项' },
    'notes': { icon: 'description', title: '笔记' },
    'bookmark': { icon: 'bookmark', title: '收藏' },
    'settings': { icon: 'settings', title: '设置' }
};

// Panel Mapping for Right Icon Sidebar
const rightPanelConfig = {
    'details': { icon: 'info', title: '详情' },
    'finance': { icon: 'account_balance_wallet', title: '财务' },
    'stats': { icon: 'bar_chart', title: '统计' },
    'help': { icon: 'help_outline', title: '帮助' }
};

let currentLeftPanel = 'todo';
let currentRightPanel = 'details';
let isLeftPanelExpanded = true;
let isRightPanelExpanded = true;

function setupIconSidebar() {
    // Left Sidebar Icons
    const leftSidebarIcons = document.querySelectorAll('#icon-sidebar .sidebar-icon');
    leftSidebarIcons.forEach(icon => {
        icon.addEventListener('click', () => {
            const panelId = icon.dataset.panel;
            
            if (panelId === currentLeftPanel) {
                toggleLeftPanel();
            } else {
                switchToLeftPanel(panelId);
                if (!isLeftPanelExpanded) {
                    setLeftPanelCollapsed(false, false);
                }
            }
        });
    });
    
    // Right Sidebar Icons
    const rightSidebarIcons = document.querySelectorAll('#icon-sidebar-right .sidebar-icon');
    rightSidebarIcons.forEach(icon => {
        icon.addEventListener('click', () => {
            const panelId = icon.dataset.panel;
            
            if (panelId === currentRightPanel) {
                toggleRightPanel();
            } else {
                switchToRightPanel(panelId);
                if (!isRightPanelExpanded) {
                    setRightPanelCollapsed(false, false);
                }
            }
        });
    });
}

function switchToLeftPanel(panelId) {
    currentLeftPanel = panelId;
    
    // Update icon active states (left sidebar only)
    document.querySelectorAll('#icon-sidebar .sidebar-icon').forEach(icon => {
        icon.classList.remove('active');
        if (icon.dataset.panel === panelId) {
            icon.classList.add('active');
        }
    });
    
    // Update panel header
    const config = leftPanelConfig[panelId];
    if (config) {
        const panelIcon = document.getElementById('panel-left-icon');
        const panelTitle = document.getElementById('panel-left-title');
        if (panelIcon) panelIcon.textContent = config.icon;
        if (panelTitle) panelTitle.textContent = config.title;
    }
    
    // Show corresponding section (left panel only)
    document.querySelectorAll('#panel-left .panel-section').forEach(section => {
        section.classList.add('hidden');
    });
    const targetSection = document.getElementById(`section-${panelId}`);
    if (targetSection) {
        targetSection.classList.remove('hidden');
    }
    
    saveLayout();
}

function switchToRightPanel(panelId) {
    currentRightPanel = panelId;
    
    // Update icon active states (right sidebar only)
    document.querySelectorAll('#icon-sidebar-right .sidebar-icon').forEach(icon => {
        icon.classList.remove('active');
        if (icon.dataset.panel === panelId) {
            icon.classList.add('active');
        }
    });
    
    // Update panel header
    const config = rightPanelConfig[panelId];
    if (config) {
        const panelIcon = document.getElementById('panel-right-icon');
        const panelTitle = document.getElementById('panel-right-title');
        if (panelIcon) panelIcon.textContent = config.icon;
        if (panelTitle) panelTitle.textContent = config.title;
    }
    
    // Show corresponding section (right panel only)
    document.querySelectorAll('#panel-right .panel-section').forEach(section => {
        section.classList.add('hidden');
    });
    const targetSection = document.getElementById(`section-${panelId}`);
    if (targetSection) {
        targetSection.classList.remove('hidden');
    }
    
    saveLayout();
}

function toggleLeftPanel() {
    setLeftPanelCollapsed(isLeftPanelExpanded);
}

function toggleRightPanel() {
    setRightPanelCollapsed(isRightPanelExpanded);
}

function setRightPanelCollapsed(collapsed, save = true) {
    const panelRight = document.getElementById('panel-right');
    const resizerRight = document.getElementById('resizer-right');
    
    if (!panelRight || !resizerRight) return;
    
    isRightPanelExpanded = !collapsed;
    
    if (collapsed) {
        panelRight.classList.add('collapsed');
        resizerRight.style.display = 'none';
    } else {
        panelRight.classList.remove('collapsed');
        resizerRight.style.display = 'block';
    }
    
    if (save) saveLayout();
}

function setLeftPanelCollapsed(collapsed, save = true) {
    const panelLeft = document.getElementById('panel-left');
    const resizerLeft = document.getElementById('resizer-left');
    
    if (!panelLeft || !resizerLeft) return;
    
    isLeftPanelExpanded = !collapsed;
    
    if (collapsed) {
        panelLeft.classList.add('collapsed');
        resizerLeft.style.display = 'none';
    } else {
        panelLeft.classList.remove('collapsed');
        resizerLeft.style.display = 'block';
    }
    
    if (save) saveLayout();
}

function setupResizer(resizer, panel, side) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        let diff = e.clientX - startX;
        // For right panel, drag direction is reversed
        if (side === 'right') {
            diff = -diff;
        }
        
        let newWidth = startWidth + diff;
        
        // Clamp to min/max
        newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, newWidth));
        
        panel.style.width = newWidth + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Save layout to storage
            saveLayout();
        }
    });
}

function saveLayout() {
    const panelLeft = document.getElementById('panel-left');
    const panelRight = document.getElementById('panel-right');
    
    if (!panelLeft || !panelRight) return;
    
    const isRightCollapsed = panelRight.classList.contains('collapsed');
    const isLeftCollapsed = panelLeft.classList.contains('collapsed');
    
    // If collapsed, use style.width, otherwise offsetWidth
    const rightW = isRightCollapsed ? 
                   (parseInt(panelRight.style.width) || DEFAULT_RIGHT_WIDTH) : 
                   panelRight.offsetWidth;
                   
    const leftW = isLeftCollapsed ? 
                   (parseInt(panelLeft.style.width) || DEFAULT_LEFT_WIDTH) : 
                   panelLeft.offsetWidth;
    
    const layout = {
        leftWidth: leftW,
        rightWidth: rightW,
        rightCollapsed: isRightCollapsed,
        leftCollapsed: isLeftCollapsed,
        activeLeftPanel: currentLeftPanel,
        activeRightPanel: currentRightPanel
    };
    
    chrome.storage.sync.set({ [LAYOUT_STORAGE_KEY]: layout }, () => {
        // console.log('Layout saved:', layout);
    });
}

// Finance Details Logic
function showFinanceDetails(dateKey) {
    const listContainer = document.querySelector('#panel-right .panel-content');
    if (!listContainer) return;
    
    // Auto expand right panel if collapsed
    const btnExpandRight = document.getElementById('btn-expand-right');
    const panelRight = document.getElementById('panel-right');
    if (panelRight && panelRight.style.display === 'none' && btnExpandRight) {
        setRightPanelCollapsed(false);
    }
    
    const finKey = `fin_${dateKey}`;
    const fins = allData[finKey] || [];
    
    // Header
    const dateObj = new Date(dateKey);
    const dateStr = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日 财务明细`;
    
    let html = `
        <div class="fin-detail-date-header">${dateStr}</div>
        <div class="fin-detail-list">
    `;
    
    if (fins.length === 0) {
        html += `<div class="fin-empty-state">暂无收支记录</div>`;
    } else {
        fins.forEach((f, index) => {
            const amountClass = f.type === 'income' ? 'income' : 'expense';
            const sign = f.type === 'income' ? '+' : '-';
            html += `
                <div class="fin-detail-item">
                    <div class="fin-detail-left">
                        <span class="fin-detail-amount ${amountClass}">${sign}${parseFloat(f.amount).toFixed(2)}</span>
                        <span class="fin-detail-note">${f.note || '无备注'}</span>
                        <span class="fin-detail-note" style="font-size:10px;opacity:0.7">类型: ${f.type === 'income' ? '收入' : '支出'}</span>
                    </div>
                    <div class="fin-detail-actions">
                        <div class="btn-action edit material-icons" title="编辑" data-index="${index}">edit</div>
                        <div class="btn-action delete material-icons" title="删除" data-index="${index}">delete</div>
                    </div>
                </div>
            `;
        });
    }
    
    html += `</div>`;
    listContainer.innerHTML = html;
    
    // Bind events
    const deleteBtns = listContainer.querySelectorAll('.btn-action.delete');
    deleteBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            deleteFinanceItem(dateKey, index);
        });
    });
    
    const editBtns = listContainer.querySelectorAll('.btn-action.edit');
    editBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            editFinanceItem(dateKey, index);
        });
    });
}

async function deleteFinanceItem(dateKey, index) {
    const finKey = `fin_${dateKey}`;
    if (allData[finKey]) {
        if (await showConfirmDialog({ message: '确定要删除这条收支记录吗？', type: 'danger' })) {
            allData[finKey].splice(index, 1);
            const update = {};
            update[finKey] = allData[finKey];
            chrome.storage.sync.set(update, () => {
                renderCalendar();
                showFinanceDetails(dateKey); // Refresh details
            });
        }
    }
}

const finEditModal = document.getElementById('edit-finance-modal');
const finEditAmount = document.getElementById('fin-edit-amount');
const finEditNote = document.getElementById('fin-edit-note');
const btnSaveFin = document.getElementById('btn-save-fin-edit');
const btnCancelFin = document.getElementById('btn-cancel-fin-edit');
const btnCloseFinModal = finEditModal ? finEditModal.querySelector('.close-modal') : null;

let currentFinDateKey = null;
let currentFinIndex = null;

function editFinanceItem(dateKey, index) {
    const finKey = `fin_${dateKey}`;
    const item = allData[finKey][index];
    if (!item) return;

    currentFinDateKey = dateKey;
    currentFinIndex = index;

    // Populate fields
    finEditAmount.value = item.amount;
    finEditNote.value = item.note || '';
    
    const radios = document.getElementsByName('fin-type');
    for (let r of radios) {
        if (r.value === item.type) {
            r.checked = true;
            break;
        }
    }

    if (finEditModal) {
        resetFinModalPosition();
        finEditModal.classList.add('visible');
        finEditModal.classList.remove('hidden');
    }
}

function closeFinModal() {
    if (!finEditModal) return;
    finEditModal.classList.remove('visible');
    setTimeout(() => {
        finEditModal.classList.add('hidden');
    }, 300);
}

if (btnCancelFin) btnCancelFin.addEventListener('click', closeFinModal);
if (btnCloseFinModal) btnCloseFinModal.addEventListener('click', closeFinModal);

if (btnSaveFin) {
    btnSaveFin.addEventListener('click', () => {
        const amountVal = parseFloat(finEditAmount.value);
        const noteVal = finEditNote.value.trim();
        let typeVal = 'expense';
        const radios = document.getElementsByName('fin-type');
        for (let r of radios) {
            if (r.checked) typeVal = r.value;
        }

        if (isNaN(amountVal)) {
            alert('请输入有效金额');
            return;
        }

        const finKey = `fin_${currentFinDateKey}`;
        if (allData[finKey] && allData[finKey][currentFinIndex]) {
            allData[finKey][currentFinIndex] = {
                type: typeVal,
                amount: amountVal,
                note: noteVal
            };
            
            const update = {};
            update[finKey] = allData[finKey];
            chrome.storage.sync.set(update, () => {
                renderCalendar();
                showFinanceDetails(currentFinDateKey);
                closeFinModal();
            });
        }
    });
}

// Finance Modal Drag Logic
let finModalTranslateX = 0;
let finModalTranslateY = 0;

function resetFinModalPosition() {
    finModalTranslateX = 0;
    finModalTranslateY = 0;
    const content = finEditModal ? finEditModal.querySelector('.modal-content') : null;
    if (content) {
        content.style.transform = '';
    }
}

if (finEditModal) {
    const header = finEditModal.querySelector('.modal-header');
    if (header) {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let startTranslateX = 0;
        let startTranslateY = 0;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startTranslateX = finModalTranslateX;
            startTranslateY = finModalTranslateY;
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            finModalTranslateX = startTranslateX + dx;
            finModalTranslateY = startTranslateY + dy;
            
            const content = finEditModal.querySelector('.modal-content');
            if (content) {
                content.style.transform = `translate(${finModalTranslateX}px, ${finModalTranslateY}px)`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.userSelect = '';
            }
        });
    }
}
