// popup-calendar.js - 日历逻辑 + Tooltip + 待办事项
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 日历逻辑 ===
let pickerBaseYear = new Date().getFullYear();
const renderYearGrid = () => {
    yearGrid.innerHTML = "";
    const startY = pickerBaseYear;
    const endY = startY + 11;
    document.getElementById("picker-year-range").textContent = `${startY} - ${endY}`;
    for (let y = startY; y <= endY; y++) {
        const div = document.createElement("div");
        div.className = `picker-item ${y === currYear ? 'active' : ''}`;
        div.textContent = y;
        div.onclick = () => { currYear = y; renderYearGrid(); };
        yearGrid.appendChild(div);
    }
};

const renderMonthGrid = () => {
    monthGrid.innerHTML = "";
    for (let m = 0; m < 12; m++) {
        const div = document.createElement("div");
        div.className = `picker-item ${m === currMonth ? 'active' : ''}`;
        div.textContent = (m + 1) + meowI18n.t('month_suffix');
        div.onclick = () => {
            currMonth = m;
            date = new Date(currYear, currMonth, 1);
            renderCalendar();
            togglePicker(false);
        };
        monthGrid.appendChild(div);
    }
};

const togglePicker = (show) => {
    if (show) {
        datePickerPanel.classList.remove("hidden");
        pickerBaseYear = Math.floor(currYear / 12) * 12; 
        renderYearGrid();
        renderMonthGrid();
    } else {
        datePickerPanel.classList.add("hidden");
    }
};

dateHeaderBtn.addEventListener("click", () => togglePicker(datePickerPanel.classList.contains("hidden")));
prevYearsBtn.addEventListener("click", () => { pickerBaseYear -= 12; renderYearGrid(); });
nextYearsBtn.addEventListener("click", () => { pickerBaseYear += 12; renderYearGrid(); });
let _lastMonthNavFocus = 0;
const handleMonthNav = (dir) => {
    const now = Date.now();
    if (now - _lastMonthNavFocus < 150) return; // Debounce
    _lastMonthNavFocus = now;

    if (dir === -1) {
        currMonth--;
        if (currMonth < 0) { currMonth = 11; currYear--; }
    } else {
        currMonth++;
        if (currMonth > 11) { currMonth = 0; currYear++; }
    }
    renderCalendar();
};

prevIcon.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); handleMonthNav(-1); });
nextIcon.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); handleMonthNav(1); });
todayBtn.addEventListener("click", () => { date = new Date(); currYear=date.getFullYear(); currMonth=date.getMonth(); selectedDateKey=`${currYear}-${currMonth+1}-${date.getDate()}`; renderApp(); });

const renderCalendar = async () => {
    hideCalendarTooltip(); // 隐藏可能残留的 Tooltip
    const allData = await new Promise(r => chrome.storage.sync.get(null, items => r(items || {})));
    calendarAllData = allData; // 缓存供 Tooltip 使用
    let firstDayofMonth = new Date(currYear, currMonth, 1).getDay();
    let lastDateofMonth = new Date(currYear, currMonth + 1, 0).getDate();
    let lastDayofMonth = new Date(currYear, currMonth, lastDateofMonth).getDay();
    let lastDateofLastMonth = new Date(currYear, currMonth, 0).getDate();
    let liTag = "";
    
    let monthTotalIncome = 0;
    let monthTotalExpense = 0;
    const balanceKey = `fin_bal_${currYear}-${currMonth + 1}`;
    let beginBalance = parseFloat(allData[balanceKey]) || 0;

    for (let i = firstDayofMonth; i > 0; i--) liTag += `<div class="inactive">${lastDateofLastMonth - i + 1}</div>`;

    for (let i = 1; i <= lastDateofMonth; i++) {
        let dateKey = `${currYear}-${currMonth + 1}-${i}`;
        let activeClass = dateKey === selectedDateKey ? "active" : "";
        let noteData = allData[dateKey]; 
        let markClass = "";
        let countHtml = "";
        if (Array.isArray(noteData) && noteData.length > 0) {
            const hasUnfinished = noteData.some(t => !t.done);
            markClass = hasUnfinished ? "has-unfinished" : "all-finished";
            countHtml = `<span class="task-count" data-tip-type="todo">${noteData.length}</span>`;
        }
        let finHtml = "";
        const finKey = `fin_${dateKey}`;
        const finData = allData[finKey];
        if (Array.isArray(finData) && finData.length > 0) {
            let dayInc = 0, dayExp = 0;
            finData.forEach(item => {
                const val = parseFloat(item.amount) || 0;
                if (item.type === 'income') { dayInc += val; monthTotalIncome += val; } 
                else { dayExp += val; monthTotalExpense += val; }
            });
            let finClass = "";
            if (dayInc > dayExp) finClass = "fin-tag-green"; 
            else if (dayInc < dayExp) finClass = "fin-tag-red"; 
            else finClass = "fin-tag-orange"; 
            finHtml = `<span class="fin-tag ${finClass}" data-tip-type="finance">¥</span>`;
        }
        const currentY = currYear;
        const currentM = String(currMonth + 1).padStart(2, '0');
        const currentD = String(i).padStart(2, '0');
        const formattedDate = `${currentY}-${currentM}-${currentD}`;
        
        const hasCountdown = myCountdowns.some(c => c.date === formattedDate);
        
        let smokingHtml = "";
        const smokingKey = `smoking_records_${dateKey}`;
        const smokingData = allData[smokingKey];
        if (Array.isArray(smokingData) && smokingData.length > 0) {
            smokingHtml = `<span class="smoking-tag" data-tip-type="smoking">
                <span class="material-icons">smoke_free</span>
                <span class="count">${smokingData.length}</span>
            </span>`;
        }
        
        let cdHtml = "";
        if (hasCountdown) {
            cdHtml = `<span class="material-icons countdown-tag" data-tip-type="countdown">flag</span>`;
        }

        // 财务规划：每月重复任务在对应日期显示角标
        let peRecurHtml = "";
        if (Array.isArray(preExpensesList) && preExpensesList.some(item => {
            if (!item.recurring) return false;
            const effectiveDay = getEffectiveRecurDay(item, currYear, currMonth);
            return effectiveDay === i;
        })) {
            peRecurHtml = `<span class="pe-recur-tag" data-tip-type="prexpense"><span class="material-icons">repeat</span></span>`;
        }

        liTag += `<div class="${activeClass} ${markClass}" data-date="${dateKey}"><span class="day-number">${i}</span>${countHtml}${finHtml}${smokingHtml}${cdHtml}${peRecurHtml}</div>`;
    }
    for (let i = lastDayofMonth; i < 6; i++) liTag += `<div class="inactive">${i - lastDayofMonth + 1}</div>`;
    
    // 多语言日期标题
    if (meowI18n.lang === 'en') {
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        currentDateText.innerText = `${monthNames[currMonth]} ${currYear}`;
    } else {
        currentDateText.innerText = `${currYear}${meowI18n.t('year_suffix')} ${currMonth + 1}${meowI18n.t('month_suffix')}`;
    }

    daysTag.innerHTML = liTag;
    monthBeginVal.innerText = beginBalance.toFixed(2);
    document.getElementById('month-total-income').innerText = monthTotalIncome.toFixed(2);
    document.getElementById('month-total-expense').innerText = monthTotalExpense.toFixed(2);
    document.getElementById('month-total-balance').innerText = (monthTotalIncome - monthTotalExpense).toFixed(2);
    let endBalance = beginBalance + monthTotalIncome - monthTotalExpense;
    monthEndVal.innerText = endBalance.toFixed(2);
    addClickEventToDays();
};

const addClickEventToDays = () => {
    document.querySelectorAll(".calendar-days div:not(.inactive)").forEach(day => {
        day.addEventListener("click", async () => {
            selectedDateKey = day.getAttribute("data-date");
            renderCalendar(); loadAndRenderTaskList(selectedDateKey); loadAndRenderFinanceList(selectedDateKey); renderHabitsView(); checkAndHighlightTabs(selectedDateKey);
            await loadSmokingData(); renderSmokingView();
        });
        day.addEventListener("dblclick", async () => {
            const dateKey = day.getAttribute("data-date");
            if (dateKey) await openDateDetail(dateKey);
        });
        // 财务账本拖拽放置
        day.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            day.classList.add("drag-over-fin");
        });
        day.addEventListener("dragleave", () => {
            day.classList.remove("drag-over-fin");
        });
        day.addEventListener("drop", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            day.classList.remove("drag-over-fin");
            const targetDateKey = day.getAttribute("data-date");
            if (!targetDateKey) return;
            try {
                const data = JSON.parse(e.dataTransfer.getData("text/plain"));
                const { index: srcIndex, dateKey: srcDateKey } = data;
                if (srcDateKey === targetDateKey) return; // 同一日期，无需移动
                
                // 从源日期中移除该条目
                const srcData = await getStorageData(`fin_${srcDateKey}`);
                const srcList = Array.isArray(srcData) ? srcData : [];
                if (srcIndex < 0 || srcIndex >= srcList.length) return;
                const [movedItem] = srcList.splice(srcIndex, 1);
                
                // 移动账本项时，同步更新关联中的 dateKey
                if (movedItem && movedItem.id) {
                    let linksChanged = false;
                    finLinks.forEach(l => {
                        if (l.from.id === movedItem.id && l.from.dateKey === srcDateKey) { l.from.dateKey = targetDateKey; linksChanged = true; }
                        if (l.to.id === movedItem.id && l.to.dateKey === srcDateKey) { l.to.dateKey = targetDateKey; linksChanged = true; }
                    });
                    if (linksChanged) saveFinLinks();
                }
                
                // 保存源日期数据
                if (srcList.length > 0) chrome.storage.sync.set({ [`fin_${srcDateKey}`]: srcList });
                else chrome.storage.sync.remove(`fin_${srcDateKey}`);
                
                // 添加到目标日期
                const targetData = await getStorageData(`fin_${targetDateKey}`);
                const targetList = Array.isArray(targetData) ? targetData : [];
                targetList.push(movedItem);
                chrome.storage.sync.set({ [`fin_${targetDateKey}`]: targetList }, () => {
                    // 刷新视图
                    renderCalendar();
                    checkAndHighlightTabs(selectedDateKey);
                    if (selectedDateKey === srcDateKey || selectedDateKey === targetDateKey) {
                        loadAndRenderFinanceList(selectedDateKey);
                        renderFinanceView();
                    }
                    showToast(`已移动到 ${targetDateKey}`);
                });
            } catch (err) {
                // 忽略非财务拖拽
            }
        });

        // === 日历图标 Tooltip & 点击切换面板 ===
        // 图标类型 → Tab 名称映射
        const tipTypeToTab = {
            'todo': 'todo',
            'finance': 'finance',
            'smoking': 'smoking',
            'countdown': 'countdowns',
            'prexpense': 'pre-expenses'
        };

        day.querySelectorAll('[data-tip-type]').forEach(icon => {
            let hoverTimer = null;
            icon.addEventListener('mouseenter', (e) => {
                const tipType = icon.getAttribute('data-tip-type');
                const dateKey = day.getAttribute('data-date');
                hoverTimer = setTimeout(() => {
                    const rect = icon.getBoundingClientRect();
                    showCalendarTooltip(tipType, dateKey, rect);
                }, 200);
            });
            icon.addEventListener('mouseleave', () => {
                if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
                hideCalendarTooltip();
            });
            icon.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止冒泡到日期格的 click
                hideCalendarTooltip();

                // 先选中该日期
                const dateKey = day.getAttribute('data-date');
                if (dateKey && dateKey !== selectedDateKey) {
                    selectedDateKey = dateKey;
                    renderCalendar();
                    loadAndRenderTaskList(selectedDateKey);
                    loadAndRenderFinanceList(selectedDateKey);
                    renderHabitsView();
                    checkAndHighlightTabs(selectedDateKey);
                    loadSmokingData().then(renderSmokingView);
                }

                // 切换到对应 Tab
                const tipType = icon.getAttribute('data-tip-type');
                const tabName = tipTypeToTab[tipType];
                if (tabName) {
                    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
                    if (tabBtn) tabBtn.click();
                }
            });
        });
    });
};

// === 日历图标 Tooltip 功能 ===
let calendarTooltipEl = null;

const ensureCalendarTooltipEl = () => {
    if (calendarTooltipEl) return calendarTooltipEl;
    calendarTooltipEl = document.createElement('div');
    calendarTooltipEl.className = 'cal-day-tooltip';
    document.body.appendChild(calendarTooltipEl);
    return calendarTooltipEl;
};

const buildTooltipContent = (tipType, dateKey) => {
    const data = calendarAllData;
    const [y, m, d] = dateKey.split('-');
    let html = '';

    if (tipType === 'todo') {
        const tasks = data[dateKey];
        const taskList = Array.isArray(tasks) ? tasks : [];
        const doneCount = taskList.filter(t => t.done).length;
        const todoCount = taskList.length - doneCount;

        html += `<div class="ct-header" style="color:#7c3aed;"><span class="material-icons">check_circle</span>待办事项</div>`;
        html += `<div class="ct-summary"><span>共 ${taskList.length} 项</span><span style="color:#22c55e;">已完成 ${doneCount}</span><span style="color:#ef4444;">待办 ${todoCount}</span></div>`;
        if (taskList.length > 0) {
            html += '<div class="ct-list">';
            taskList.forEach(t => {
                html += `<div class="ct-item ${t.done ? 'done' : ''}">`;
                html += `<span class="material-icons ct-check">${t.done ? 'check_box' : 'check_box_outline_blank'}</span>`;
                html += `<span class="ct-text">${escapeHtml(t.text)}</span>`;
                html += '</div>';
            });
            html += '</div>';
        }
    } else if (tipType === 'finance') {
        const finData = data[`fin_${dateKey}`];
        const finList = Array.isArray(finData) ? finData : [];
        let totalInc = 0, totalExp = 0;
        finList.forEach(item => {
            const val = parseFloat(item.amount) || 0;
            if (item.type === 'income') totalInc += val;
            else totalExp += val;
        });

        html += `<div class="ct-header" style="color:#f59e0b;"><span class="material-icons">account_balance_wallet</span>财务账本</div>`;
        html += `<div class="ct-summary"><span style="color:#10b981;">收 +${totalInc.toFixed(2)}</span><span style="color:#ef4444;">支 -${totalExp.toFixed(2)}</span><span style="color:#6b7280;">余 ${(totalInc - totalExp).toFixed(2)}</span></div>`;
        if (finList.length > 0) {
            html += '<div class="ct-list">';
            finList.forEach(item => {
                const val = parseFloat(item.amount) || 0;
                const isInc = item.type === 'income';
                html += `<div class="ct-item">`;
                html += `<span class="ct-text">${escapeHtml(item.note || '无备注')}</span>`;
                html += `<span class="ct-amount ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}${val.toFixed(2)}</span>`;
                html += '</div>';
            });
            html += '</div>';
        }
    } else if (tipType === 'smoking') {
        const smokingData = data[`smoking_records_${dateKey}`];
        const records = Array.isArray(smokingData) ? smokingData : [];
        const goal = data[`smoking_goal_${dateKey}`] || data['smoking_goal'] || 0;

        html += `<div class="ct-header" style="color:#f97316;"><span class="material-icons">smoke_free</span>戒烟记录</div>`;
        html += `<div class="ct-summary"><span>已吸 ${records.length} 支</span><span>目标 ${goal} 支</span><span style="color:${records.length > goal ? '#ef4444' : '#22c55e'};">剩余 ${Math.max(0, goal - records.length)} 支</span></div>`;
        if (records.length > 0) {
            html += '<div class="ct-list">';
            records.forEach((r, i) => {
                html += `<div class="ct-item">`;
                html += `<span class="ct-num">${i + 1}</span>`;
                html += `<span class="ct-text">${r.time}</span>`;
                if (i > 0) {
                    const interval = calculateInterval(records[i - 1].time, r.time);
                    html += `<span class="ct-tag">+${formatInterval(interval)}</span>`;
                }
                html += '</div>';
            });
            html += '</div>';
        }
    } else if (tipType === 'countdown') {
        const currentM = String(currMonth + 1).padStart(2, '0');
        const currentD = String(d).padStart(2, '0');
        const formattedDate = `${currYear}-${currentM}-${currentD}`;
        const countdowns = myCountdowns.filter(c => c.date === formattedDate);

        html += `<div class="ct-header" style="color:#8b5cf6;"><span class="material-icons">flag</span>倒数日</div>`;
        if (countdowns.length > 0) {
            html += '<div class="ct-list">';
            const today = new Date(); today.setHours(0, 0, 0, 0);
            countdowns.forEach(cd => {
                const [cy, cm, cday] = cd.date.split('-').map(Number);
                const targetDate = new Date(cy, cm - 1, cday);
                const diffDays = Math.round((targetDate - today) / (1000 * 60 * 60 * 24));
                let diffText = '';
                let tagClass = '';
                if (diffDays === 0) { diffText = '今天'; tagClass = 'urgent'; }
                else if (diffDays > 0) { diffText = `还有 ${diffDays} 天`; tagClass = diffDays <= 3 ? 'urgent' : ''; }
                else { diffText = `已过 ${Math.abs(diffDays)} 天`; tagClass = 'past'; }

                html += `<div class="ct-item">`;
                html += `<span class="ct-text">${escapeHtml(cd.title)}</span>`;
                html += `<span class="ct-tag ${tagClass}">${diffText}</span>`;
                html += '</div>';
            });
            html += '</div>';
        }
    } else if (tipType === 'prexpense') {
        const dayNum = parseInt(d);
        const peItems = preExpensesList.filter(item => {
            if (!item.recurring || item.enabled === false) return false;
            const effectiveDay = getEffectiveRecurDay(item, currYear, currMonth);
            return effectiveDay === dayNum;
        });

        html += `<div class="ct-header" style="color:#6366f1;"><span class="material-icons">repeat</span>财务规划</div>`;
        html += `<div class="ct-summary"><span>每月${dayNum}号</span><span>${peItems.length} 项</span></div>`;
        if (peItems.length > 0) {
            html += '<div class="ct-list">';
            peItems.forEach(item => {
                const val = parseFloat(item.amount) || 0;
                const typeLabel = item.type === 'income' ? '收入' : item.type === 'necessary' ? '必要' : '非必要';
                const isInc = item.type === 'income';
                html += `<div class="ct-item">`;
                html += `<span class="ct-text">${escapeHtml(item.name)}</span>`;
                html += `<span class="ct-tag">${typeLabel}</span>`;
                html += `<span class="ct-amount ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}${val.toFixed(2)}</span>`;
                html += '</div>';
            });
            html += '</div>';
        }
    }

    return html;
};

const showCalendarTooltip = (tipType, dateKey, rect) => {
    const tooltip = ensureCalendarTooltipEl();
    tooltip.innerHTML = buildTooltipContent(tipType, dateKey);
    tooltip.style.display = 'block';
    tooltip.classList.add('show');

    // 智能定位：始终显示在下方
    const tooltipRect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    let top = rect.bottom + 8;

    // 水平边界检查
    if (left < 8) left = 8;
    if (left + tooltipRect.width > vw - 8) left = vw - tooltipRect.width - 8;

    // 垂直边界检查：下方不够则向上推
    if (top + tooltipRect.height > vh - 8) top = Math.max(8, rect.top - tooltipRect.height - 8);

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
};

const hideCalendarTooltip = () => {
    if (calendarTooltipEl) {
        calendarTooltipEl.classList.remove('show');
        calendarTooltipEl.style.display = 'none';
    }
};

editBeginBtn.addEventListener("click", async () => {
    const currentVal = document.getElementById("month-begin-val").innerText;
    const input = prompt(meowI18n.t('set_balance_prompt'), currentVal);
    if (input !== null) {
        const numVal = parseFloat(input);
        if (!isNaN(numVal)) {
            let data = {}; data[`fin_bal_${currYear}-${currMonth + 1}`] = numVal;
            await new Promise(resolve => chrome.storage.sync.set(data, resolve));
            renderCalendar();
        }
    }
});

// === 待办事项 ===
const loadAndRenderTaskList = async (dateKey) => {
    const [y, m, d] = dateKey.split('-');
    if (selectedDateDisplay) { selectedDateDisplay.innerText = `${m}月${d}日`; } 
    let data = await getStorageData(dateKey);
    currentTaskList = Array.isArray(data) ? data : [];
    renderListView();
};

const renderListView = () => {
    todoList.innerHTML = "";
    const total = currentTaskList.length;
    const doneCount = currentTaskList.filter(t => t.done).length;
    const todoCount = total - doneCount;
    
    // 更新统计数字
    const statAll = document.getElementById('stat-all');
    if (statAll) statAll.innerText = total;
    statDone.innerText = doneCount;
    statTodo.innerText = todoCount;
    
    // 根据过滤条件筛选
    let filteredList = currentTaskList;
    if (todoFilter === 'todo') {
        filteredList = currentTaskList.filter(t => !t.done);
    } else if (todoFilter === 'done') {
        filteredList = currentTaskList.filter(t => t.done);
    }
    
    if (filteredList.length === 0) {
        emptyStateTodo.classList.remove("hidden");
    } else {
        emptyStateTodo.classList.add("hidden");
        filteredList.forEach((task) => {
            // 找到原始索引
            const index = currentTaskList.indexOf(task);
            const li = document.createElement("li");
            li.className = `todo-item ${task.done ? 'completed' : ''}`;
            li.innerHTML = `<div class="todo-left"><input type="checkbox" class="todo-checkbox" ${task.done ? 'checked' : ''}><span class="todo-text">${escapeHtml(task.text)}</span></div><div style="display:flex;"><span class="material-icons edit-btn">edit</span><span class="material-icons delete-btn">close</span></div>`;
            li.querySelector(".todo-left").addEventListener("click", (e) => { if (e.target.tagName !== 'INPUT') { currentTaskList[index].done = !currentTaskList[index].done; saveTaskData(); } });
            li.querySelector(".todo-checkbox").addEventListener("change", () => { currentTaskList[index].done = !currentTaskList[index].done; saveTaskData(); });
            li.querySelector(".delete-btn").addEventListener("click", (e) => { e.stopPropagation(); currentTaskList.splice(index, 1); saveTaskData(); });
            li.querySelector(".edit-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                const input = document.createElement("input"); input.type = "text"; input.value = task.text; input.className = "todo-edit-input";
                li.querySelector(".todo-left").replaceChild(input, li.querySelector(".todo-text")); input.focus();
                const save = () => { if(input.value.trim()){currentTaskList[index].text=input.value.trim(); saveTaskData();} else renderListView(); };
                input.addEventListener("keypress", (ev) => { if (ev.key === "Enter") save(); }); input.addEventListener("blur", save); input.addEventListener("click", (ev) => ev.stopPropagation());
            });
            todoList.appendChild(li);
        });
    }
};

const saveTaskData = () => {
    renderListView();
    if (currentTaskList.length > 0) { let data = {}; data[selectedDateKey] = currentTaskList; chrome.storage.sync.set(data, () => { renderCalendar(); checkAndHighlightTabs(selectedDateKey); }); }
    else chrome.storage.sync.remove(selectedDateKey, () => { renderCalendar(); checkAndHighlightTabs(selectedDateKey); });
};

