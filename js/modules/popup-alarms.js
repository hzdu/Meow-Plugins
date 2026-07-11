// popup-alarms.js - 闹钟 + 倒数日 + 暂存板
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 闹钟功能 ===
const loadAlarms = async () => {
    const data = await getStorageData('alarms_config');
    myAlarms = Array.isArray(data) ? data : [];
};
const saveAlarms = () => { chrome.storage.sync.set({ 'alarms_config': myAlarms }); };
const renderAlarmsView = async () => {
    // 从 session 存储读取当前响铃的闹钟 ID
    try {
        const session = await chrome.storage.session.get('ringingAlarmId');
        currentRingingAlarmId = session.ringingAlarmId || null;
    } catch (e) { /* session 不可用时忽略 */ }
    alarmsList.innerHTML = "";
    if (myAlarms.length === 0) { emptyStateAlarms.classList.remove("hidden"); }
    else {
        emptyStateAlarms.classList.add("hidden");
        myAlarms.sort((a, b) => a.time.localeCompare(b.time));
        myAlarms.forEach((alarm, index) => {
            const li = document.createElement("li");
            const isRinging = alarm.id === currentRingingAlarmId;

            // 同时更新顶栏响铃条
            if (isRinging) {
                alarmRingingBar.classList.remove("hidden");
            }

            li.className = `alarm-item ${alarm.enabled ? '' : 'disabled'} ${isRinging ? 'ringing' : ''}`;
            const interval = alarm.intervalDays || 1;
            const intervalLabel = interval === 1 ? '每天' : `每${interval}天`;
            const stopBtnHtml = isRinging ? `<span class="material-icons stop-btn" title="停止响铃">stop_circle</span>` : '';
            li.innerHTML = `<div class="alarm-info"><div class="alarm-time-row"><label class="alarm-switch"><input type="checkbox" ${alarm.enabled ? 'checked' : ''}><span class="slider"></span></label><span class="alarm-time">${alarm.time}</span></div><div class="alarm-label-row"><span class="alarm-interval-badge">${intervalLabel}</span><span class="alarm-label">${escapeHtml(alarm.label || meowI18n.t('tab_alarms'))}</span></div></div><div class="alarm-actions">${stopBtnHtml}<span class="material-icons alarm-icon-btn edit-btn">edit</span><span class="material-icons alarm-icon-btn delete-btn">close</span></div>`;
            const toggle = li.querySelector("input[type='checkbox']");
            toggle.addEventListener("change", () => { myAlarms[index].enabled = toggle.checked; updateSystemAlarm(myAlarms[index]); saveAlarms(); renderAlarmsView(); });
            li.querySelector(".delete-btn").addEventListener("click", () => { const item = myAlarms[index]; chrome.alarms.clear(`alarm_${item.id}`); myAlarms.splice(index, 1); saveAlarms(); renderAlarmsView(); });
            li.querySelector(".edit-btn").addEventListener("click", (e) => { e.stopPropagation(); editAlarm(index); });
            const stopBtn = li.querySelector(".stop-btn");
            if (stopBtn) {
                stopBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    chrome.runtime.sendMessage({ action: 'stop-alarm' }).catch(() => {});
                    // 关闭已打开的通知
                    chrome.notifications.getAll((notifications) => {
                        Object.keys(notifications).forEach(nid => {
                            if (nid.startsWith('alarm_')) chrome.notifications.clear(nid);
                        });
                    });
                    chrome.storage.session.remove('ringingAlarmId').catch(() => {});
                    currentRingingAlarmId = null;
                    renderAlarmsView();
                    alarmRingingBar.classList.add("hidden");
                });
            }
            alarmsList.appendChild(li);
        });
    }
};
const addAlarm = () => {
    const timeStr = alarmTimeInput.value;
    const label = alarmLabelInput.value.trim() || meowI18n.t('tab_alarms');
    const isPeriodic = alarmPeriodicToggle.checked;
    const intervalDays = isPeriodic ? (parseInt(alarmIntervalInput.value) || 1) : 1;
    if (!timeStr) { alert("Please select time"); return; }
    if (isPeriodic && intervalDays < 1) { alert("周期天数不能小于1"); return; }
    if (editingAlarmIndex > -1) {
        // 编辑模式：更新已有闹钟
        const oldAlarm = myAlarms[editingAlarmIndex];
        myAlarms[editingAlarmIndex] = { ...oldAlarm, time: timeStr, label: label, intervalDays: intervalDays };
        updateSystemAlarm(myAlarms[editingAlarmIndex]);
        saveAlarms();
        updateAlarmLabelHistory(alarmLabelInput.value.trim());
        exitAlarmEditMode();
    } else {
        // 新增模式
        const newAlarm = { id: Date.now(), time: timeStr, label: label, intervalDays: intervalDays, enabled: true };
        myAlarms.push(newAlarm); updateSystemAlarm(newAlarm); saveAlarms();
        updateAlarmLabelHistory(alarmLabelInput.value.trim());
        alarmTimeInput.value = ""; alarmLabelInput.value = "";
        alarmIntervalInput.value = "1";
        renderAlarmsView();
    }
};
const updateSystemAlarm = (alarmItem) => {
    const alarmName = `alarm_${alarmItem.id}`;
    if (alarmItem.enabled) {
        const now = new Date(); const [hours, minutes] = alarmItem.time.split(':').map(Number);
        const nextAlarm = new Date(); nextAlarm.setHours(hours, minutes, 0, 0);
        if (nextAlarm <= now) nextAlarm.setDate(nextAlarm.getDate() + 1);
        const intervalDays = alarmItem.intervalDays || 1;
        chrome.alarms.create(alarmName, { when: nextAlarm.getTime(), periodInMinutes: intervalDays * 1440 });
    } else { chrome.alarms.clear(alarmName); }
};

const editAlarm = (index) => {
    const alarm = myAlarms[index];
    editingAlarmIndex = index;
    alarmTimeInput.value = alarm.time;
    alarmLabelInput.value = alarm.label;
    alarmPeriodicToggle.checked = alarm.intervalDays > 1;
    alarmIntervalInput.disabled = !alarmPeriodicToggle.checked;
    alarmIntervalInput.value = alarm.intervalDays > 1 ? alarm.intervalDays : 1;
    addAlarmBtn.innerHTML = "save";
    cancelAlarmBtn.classList.remove("hidden");
    cancelAlarmBtn.style.display = "flex";
    alarmTimeInput.focus();
    renderAlarmsView();
};

const exitAlarmEditMode = () => {
    editingAlarmIndex = -1;
    alarmTimeInput.value = "";
    alarmLabelInput.value = "";
    alarmIntervalInput.value = "1";
    alarmPeriodicToggle.checked = true;
    alarmIntervalInput.disabled = false;
    addAlarmBtn.innerHTML = "add_alarm";
    cancelAlarmBtn.classList.add("hidden");
    cancelAlarmBtn.style.display = "none";
    renderAlarmsView();
};

addAlarmBtn.addEventListener("click", addAlarm);
let alarmLabelEnterConsumed = false;
alarmLabelInput.addEventListener("keypress", (e) => {
    if (e.key === 'Enter') {
        if (alarmLabelEnterConsumed) { alarmLabelEnterConsumed = false; return; }
        addAlarm();
    }
});
alarmPeriodicToggle.addEventListener("change", () => {
    alarmIntervalInput.disabled = !alarmPeriodicToggle.checked;
});

cancelAlarmBtn.addEventListener("click", exitAlarmEditMode);

// === 闹钟备注历史下拉框 ===
const loadAlarmLabelHistory = async () => {
    const data = await getStorageData('meow_alarm_label_history');
    alarmLabelHistory = Array.isArray(data) ? data : [];

    // 如果历史为空，从现有闹钟项中预填充
    if (alarmLabelHistory.length === 0 && myAlarms.length > 0) {
        const labels = new Set();
        myAlarms.forEach(item => {
            if (item && item.label && item.label.trim()) {
                labels.add(item.label.trim());
            }
        });
        if (labels.size > 0) {
            alarmLabelHistory = Array.from(labels).slice(0, 10);
            chrome.storage.sync.set({ 'meow_alarm_label_history': alarmLabelHistory });
        }
    }
};

const getFilteredAlarmLabels = () => {
    const input = alarmLabelInput.value.trim().toLowerCase();
    if (!input) return alarmLabelHistory.slice();
    return alarmLabelHistory.filter(n => n.toLowerCase().includes(input));
};

const renderAlarmLabelDropdown = (labels) => {
    if (!alarmLabelDropdown) return;
    alarmLabelDropdown.innerHTML = '';
    if (labels.length === 0) {
        hideAlarmLabelDropdown();
        return;
    }
    labels.forEach((label, i) => {
        const item = document.createElement('div');
        item.className = 'alarm-label-dropdown-item';
        if (i === alarmLabelActiveIndex) item.classList.add('active');
        item.textContent = label;
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            alarmLabelInput.value = label;
            hideAlarmLabelDropdown();
            alarmLabelInput.focus();
        });
        alarmLabelDropdown.appendChild(item);
    });
    alarmLabelDropdown.classList.remove('hidden');
};

const hideAlarmLabelDropdown = () => {
    if (alarmLabelDropdown) alarmLabelDropdown.classList.add('hidden');
    alarmLabelActiveIndex = -1;
};

const updateAlarmLabelActiveItem = () => {
    if (!alarmLabelDropdown) return;
    const items = alarmLabelDropdown.querySelectorAll('.alarm-label-dropdown-item');
    items.forEach((item, i) => {
        item.classList.toggle('active', i === alarmLabelActiveIndex);
    });
    if (alarmLabelActiveIndex >= 0 && items[alarmLabelActiveIndex]) {
        items[alarmLabelActiveIndex].scrollIntoView({ block: 'nearest' });
    }
};

const updateAlarmLabelHistory = (label) => {
    const trimmed = (label || '').trim();
    if (!trimmed) return;
    alarmLabelHistory = alarmLabelHistory.filter(n => n !== trimmed);
    alarmLabelHistory.unshift(trimmed);
    if (alarmLabelHistory.length > 10) alarmLabelHistory = alarmLabelHistory.slice(0, 10);
    chrome.storage.sync.set({ 'meow_alarm_label_history': alarmLabelHistory });
};

alarmLabelInput.addEventListener('input', () => {
    alarmLabelActiveIndex = -1;
    const labels = getFilteredAlarmLabels();
    if (labels.length > 0) renderAlarmLabelDropdown(labels);
    else hideAlarmLabelDropdown();
});

alarmLabelInput.addEventListener('focus', () => {
    if (alarmLabelHistory.length === 0) return;
    alarmLabelActiveIndex = -1;
    const labels = getFilteredAlarmLabels();
    if (labels.length > 0) renderAlarmLabelDropdown(labels);
});

alarmLabelInput.addEventListener('blur', () => {
    setTimeout(hideAlarmLabelDropdown, 150);
});

alarmLabelInput.addEventListener('keydown', (e) => {
    if (alarmLabelDropdown && alarmLabelDropdown.classList.contains('hidden')) return;
    const items = alarmLabelDropdown ? alarmLabelDropdown.querySelectorAll('.alarm-label-dropdown-item') : [];
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        alarmLabelActiveIndex = (alarmLabelActiveIndex + 1) % items.length;
        updateAlarmLabelActiveItem();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        alarmLabelActiveIndex = (alarmLabelActiveIndex - 1 + items.length) % items.length;
        updateAlarmLabelActiveItem();
    } else if (e.key === 'Enter') {
        if (alarmLabelActiveIndex >= 0 && items[alarmLabelActiveIndex]) {
            e.preventDefault();
            alarmLabelInput.value = items[alarmLabelActiveIndex].textContent;
            hideAlarmLabelDropdown();
            alarmLabelEnterConsumed = true;
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        hideAlarmLabelDropdown();
    }
});

// 停止响铃按钮
stopAlarmBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: 'stop-alarm' }).catch(() => {});
    chrome.notifications.getAll((notifications) => {
        Object.keys(notifications).forEach(nid => {
            if (nid.startsWith('alarm_')) chrome.notifications.clear(nid);
        });
    });
    chrome.storage.session.remove('ringingAlarmId').catch(() => {});
    currentRingingAlarmId = null;
    alarmRingingBar.classList.add("hidden");
    renderAlarmsView();
});

// 监听来自 background 的响铃状态
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'alarm-ringing') {
        currentRingingAlarmId = msg.alarmId || null;
        if (currentRingingAlarmId) {
            chrome.storage.session.set({ ringingAlarmId: currentRingingAlarmId }).catch(() => {});
        }
        alarmRingingBar.classList.remove("hidden");
        renderAlarmsView();
    } else if (msg.action === 'alarm-stopped') {
        currentRingingAlarmId = null;
        chrome.storage.session.remove('ringingAlarmId').catch(() => {});
        alarmRingingBar.classList.add("hidden");
        renderAlarmsView();
    }
});

// === 倒数日功能 ===
let editingCdIndex = -1;
const cancelCdBtn = document.getElementById("cancel-cd-btn");

const loadCountdowns = async () => {
    const data = await getStorageData('countdowns_config');
    myCountdowns = Array.isArray(data) ? data : [];
};
const saveCountdowns = () => { chrome.storage.sync.set({ 'countdowns_config': myCountdowns }, () => { renderCalendar(); renderCountdownSummary(); checkAndHighlightTabs(selectedDateKey); }); };

const renderCountdownsView = () => {
    cdList.innerHTML = "";
    
    const today = new Date(); today.setHours(0,0,0,0);
    
    // 计算各分类数量
    let allCount = 0, upcomingCount = 0, expiredCount = 0;
    myCountdowns.forEach(cd => {
        const [year, month, day] = cd.date.split('-').map(Number);
        const targetDate = new Date(year, month - 1, day);
        const diffDays = Math.round((targetDate - today) / (1000 * 60 * 60 * 24));
        allCount++;
        if (diffDays >= 0) upcomingCount++;
        else expiredCount++;
    });
    document.getElementById('cd-stat-all').textContent = allCount;
    document.getElementById('cd-stat-upcoming').textContent = upcomingCount;
    document.getElementById('cd-stat-expired').textContent = expiredCount;
    
    // 处理筛选按钮状态
    const statBadges = document.querySelectorAll('#view-countdowns .stat-badge');
    statBadges.forEach(badge => {
        badge.classList.remove('active');
        if (badge.dataset.filter === cdFilter) {
            badge.classList.add('active');
        }
        badge.onclick = () => {
            cdFilter = badge.dataset.filter;
            renderCountdownsView();
        };
    });
    
    // 根据筛选条件过滤
    let filtered = myCountdowns.map((cd, originalIndex) => {
        // 解析日期字符串为本地时间，避免UTC时区问题
        const [year, month, day] = cd.date.split('-').map(Number);
        const targetDate = new Date(year, month - 1, day);
        const diffTime = targetDate - today;
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        return { ...cd, originalIndex, diffDays };
    });
    
    if (cdFilter === 'upcoming') {
        filtered = filtered.filter(item => item.diffDays >= 0);
        filtered.sort((a, b) => a.diffDays - b.diffDays); // 未到期：近的在前
    } else if (cdFilter === 'expired') {
        filtered = filtered.filter(item => item.diffDays < 0);
        filtered.sort((a, b) => b.diffDays - a.diffDays); // 已到期：最近过期的在前
    } else {
        // 'all'：全部显示，时间近的排在前面（未到期从最近→最远，已到期从最近过期→最久）
        const upcoming = filtered.filter(item => item.diffDays >= 0).sort((a, b) => a.diffDays - b.diffDays);
        const expired = filtered.filter(item => item.diffDays < 0).sort((a, b) => b.diffDays - a.diffDays);
        filtered = [...upcoming, ...expired];
    }
    
    if (filtered.length === 0) { 
        emptyStateCd.classList.remove("hidden"); 
    } else {
        emptyStateCd.classList.add("hidden");
        filtered.forEach((item) => {
            let displayDays;
            if (item.diffDays === 0) {
                displayDays = meowI18n.t('cd_today'); // 今天到期
            } else if (item.diffDays > 0) {
                displayDays = meowI18n.t('cd_days_left', {n: item.diffDays});
            } else {
                displayDays = meowI18n.t('cd_days_past', {n: Math.abs(item.diffDays)});
            }

            const isUrgent = item.diffDays <= 3 && item.diffDays >= 0;
            const isExpired = item.diffDays < 0;
            const li = document.createElement("li");
            li.className = "cd-item";
            if (item.originalIndex === editingCdIndex) {
                 li.style.backgroundColor = "#f0f9ff";
            }
            li.innerHTML = `<div class="cd-info"><span class="cd-title${isExpired ? ' expired' : ''}">${escapeHtml(item.title)}</span><div class="cd-meta-row"><span class="cd-date">${item.date}</span><span class="cd-days-left${isUrgent ? ' urgent' : ''}${isExpired ? ' expired' : ''}">${displayDays}</span></div></div><div class="cd-actions"><span class="material-icons edit-btn">edit</span><span class="material-icons delete-btn">close</span></div>`;
            
            // 编辑按钮
            li.querySelector(".edit-btn").addEventListener("click", () => enterCdEditMode(item.originalIndex, item));
            
            // 删除按钮
            li.querySelector(".delete-btn").addEventListener("click", async () => {
                const ok = await showConfirmDialog({ message: meowI18n.t('delete_confirm'), type: 'danger' });
                if (ok) {
                    if (editingCdIndex === item.originalIndex) exitCdEditMode();
                    myCountdowns.splice(item.originalIndex, 1);
                    saveCountdowns();
                    renderCountdownsView();
                }
            });
            cdList.appendChild(li);
        });
    }
};

const enterCdEditMode = (index, item) => {
    editingCdIndex = index;
    if (cdDateInput._flatpickr) {
        cdDateInput._flatpickr.setDate(item.date, false);
    } else {
        cdDateInput.value = item.date;
    }
    cdTitleInput.value = item.title;
    addCdBtn.innerText = "check"; // Use icon text
    cancelCdBtn.classList.remove("hidden");
    cdTitleInput.focus();
    renderCountdownsView();
};

const exitCdEditMode = () => {
    editingCdIndex = -1;
    if (cdDateInput._flatpickr) {
        cdDateInput._flatpickr.clear(false);
    } else {
        cdDateInput.value = "";
    }
    cdTitleInput.value = "";
    addCdBtn.innerText = "add"; // Use icon text
    cancelCdBtn.classList.add("hidden");
    renderCountdownsView();
};

const addCountdown = () => {
    const dateStr = cdDateInput.value;
    const title = cdTitleInput.value.trim();
    if (!dateStr || !title) { 
        // Simple validation feedback
        if(!dateStr) cdDateInput.style.borderColor = "red";
        if(!title) cdTitleInput.style.borderColor = "red";
        setTimeout(() => {
            cdDateInput.style.borderColor = "";
            cdTitleInput.style.borderColor = "";
        }, 1500);
        return; 
    }

    if (editingCdIndex > -1) {
        // Update existing
        myCountdowns[editingCdIndex].date = dateStr;
        myCountdowns[editingCdIndex].title = title;
        exitCdEditMode();
    } else {
        // Add new
        myCountdowns.push({ id: Date.now(), date: dateStr, title: title });
        if (cdDateInput._flatpickr) {
            cdDateInput._flatpickr.clear(false);
        } else {
            cdDateInput.value = ""; 
        }
        cdTitleInput.value = "";
    }
    saveCountdowns();
    updateCdTitleHistory(title);
    renderCountdownsView();
};

addCdBtn.addEventListener("click", addCountdown);
if(cancelCdBtn) cancelCdBtn.addEventListener("click", exitCdEditMode);
let cdTitleEnterConsumed = false;
cdTitleInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        if (cdTitleEnterConsumed) { cdTitleEnterConsumed = false; return; }
        addCountdown();
    }
});

// === 倒数日标题历史下拉框 ===
const loadCdTitleHistory = async () => {
    const data = await getStorageData('meow_cd_title_history');
    cdTitleHistory = Array.isArray(data) ? data : [];

    // 如果历史为空，从现有点数日项中预填充
    if (cdTitleHistory.length === 0 && myCountdowns.length > 0) {
        const titles = new Set();
        myCountdowns.forEach(item => {
            if (item && item.title && item.title.trim()) {
                titles.add(item.title.trim());
            }
        });
        if (titles.size > 0) {
            cdTitleHistory = Array.from(titles).slice(0, 10);
            chrome.storage.sync.set({ 'meow_cd_title_history': cdTitleHistory });
        }
    }
};

const getFilteredCdTitles = () => {
    const input = cdTitleInput.value.trim().toLowerCase();
    if (!input) return cdTitleHistory.slice();
    return cdTitleHistory.filter(n => n.toLowerCase().includes(input));
};

const renderCdTitleDropdown = (titles) => {
    if (!cdTitleDropdown) return;
    cdTitleDropdown.innerHTML = '';
    if (titles.length === 0) {
        hideCdTitleDropdown();
        return;
    }
    titles.forEach((title, i) => {
        const item = document.createElement('div');
        item.className = 'cd-title-dropdown-item';
        if (i === cdTitleActiveIndex) item.classList.add('active');
        item.textContent = title;
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            cdTitleInput.value = title;
            hideCdTitleDropdown();
            cdTitleInput.focus();
        });
        cdTitleDropdown.appendChild(item);
    });
    cdTitleDropdown.classList.remove('hidden');
};

const hideCdTitleDropdown = () => {
    if (cdTitleDropdown) cdTitleDropdown.classList.add('hidden');
    cdTitleActiveIndex = -1;
};

const updateCdTitleActiveItem = () => {
    if (!cdTitleDropdown) return;
    const items = cdTitleDropdown.querySelectorAll('.cd-title-dropdown-item');
    items.forEach((item, i) => {
        item.classList.toggle('active', i === cdTitleActiveIndex);
    });
    if (cdTitleActiveIndex >= 0 && items[cdTitleActiveIndex]) {
        items[cdTitleActiveIndex].scrollIntoView({ block: 'nearest' });
    }
};

const updateCdTitleHistory = (title) => {
    const trimmed = (title || '').trim();
    if (!trimmed) return;
    cdTitleHistory = cdTitleHistory.filter(n => n !== trimmed);
    cdTitleHistory.unshift(trimmed);
    if (cdTitleHistory.length > 10) cdTitleHistory = cdTitleHistory.slice(0, 10);
    chrome.storage.sync.set({ 'meow_cd_title_history': cdTitleHistory });
};

cdTitleInput.addEventListener('input', () => {
    cdTitleActiveIndex = -1;
    const titles = getFilteredCdTitles();
    if (titles.length > 0) renderCdTitleDropdown(titles);
    else hideCdTitleDropdown();
});

cdTitleInput.addEventListener('focus', () => {
    if (cdTitleHistory.length === 0) return;
    cdTitleActiveIndex = -1;
    const titles = getFilteredCdTitles();
    if (titles.length > 0) renderCdTitleDropdown(titles);
});

cdTitleInput.addEventListener('blur', () => {
    setTimeout(hideCdTitleDropdown, 150);
});

cdTitleInput.addEventListener('keydown', (e) => {
    if (cdTitleDropdown && cdTitleDropdown.classList.contains('hidden')) return;
    const items = cdTitleDropdown ? cdTitleDropdown.querySelectorAll('.cd-title-dropdown-item') : [];
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        cdTitleActiveIndex = (cdTitleActiveIndex + 1) % items.length;
        updateCdTitleActiveItem();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cdTitleActiveIndex = (cdTitleActiveIndex - 1 + items.length) % items.length;
        updateCdTitleActiveItem();
    } else if (e.key === 'Enter') {
        if (cdTitleActiveIndex >= 0 && items[cdTitleActiveIndex]) {
            e.preventDefault();
            cdTitleInput.value = items[cdTitleActiveIndex].textContent;
            hideCdTitleDropdown();
            cdTitleEnterConsumed = true;
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        hideCdTitleDropdown();
    }
});

// === 修复：倒数日通知栏多语言支持 ===
const renderCountdownSummary = () => {
    const container = document.getElementById("countdown-summary-card");
    if (!container) return;
    if (tickerInterval) { clearInterval(tickerInterval); tickerInterval = null; }
    const today = new Date(); today.setHours(0,0,0,0);
    const upcoming = myCountdowns.map(cd => {
        // 解析日期字符串为本地时间，避免UTC时区问题
        const [year, month, day] = cd.date.split('-').map(Number);
        const target = new Date(year, month - 1, day);
        const diff = Math.round((target - today) / (1000 * 60 * 60 * 24)); 
        return { ...cd, diff };
    }).filter(item => item.diff >= 0).sort((a, b) => a.diff - b.diff);
    if (upcoming.length === 0) { container.classList.add("hidden"); return; } 
    container.classList.remove("hidden");
    let trackHtml = '';
    
    // 使用 i18n 获取文本
    const labelGoal = meowI18n.t('cd_summary_goal');
    const labelPrefix = meowI18n.t('cd_summary_prefix');
    const labelSuffix = meowI18n.t('cd_summary_suffix');

    upcoming.forEach(item => {
        const isUrgent = item.diff <= 3;
        const isToday = item.diff === 0;
        
        let rightPart;
        if (isToday) {
            // 今天到期：不显示"距离"前缀，直接显示"今天到期"
            rightPart = `<span class="cd-summary-days urgent" style="min-width: auto; font-size: 0.9rem;">${meowI18n.t('cd_today')}</span>`;
        } else {
            // 未来日期：显示"剩 X 天"
            rightPart = `
                <span style="color: #9ca3af; font-size: 0.8rem; margin-right: 4px;">${labelPrefix}</span>
                <span class="cd-summary-days ${isUrgent ? 'urgent' : ''}" style="min-width: auto; font-size: 1.1rem;">${item.diff}</span>
                <span style="color: #9ca3af; font-size: 0.8rem; margin-left: 2px;">${labelSuffix}</span>
            `;
        }
        
        trackHtml += `
        <div class="cd-ticker-item">
            <div style="display: flex; align-items: center; flex: 1; overflow: hidden; margin-right: 8px;">
                ${isToday ? '' : `<span style="color: #9ca3af; font-size: 0.8rem; margin-right: 4px; flex-shrink: 0;">${labelGoal}</span>`}
                <span class="cd-summary-label" style="margin: 0;" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
            </div>
            <div style="display: flex; align-items: baseline; flex-shrink: 0;">
                ${rightPart}
            </div>
        </div>`;
    });
    container.innerHTML = `<div class="cd-ticker-track" id="cd-ticker-track">${trackHtml}</div>`;
    if (upcoming.length > 1) {
        const track = document.getElementById("cd-ticker-track");
        const firstChild = track.firstElementChild.cloneNode(true);
        track.appendChild(firstChild);
        let currentIndex = 0; const itemHeight = 36; const totalItems = upcoming.length;
        tickerInterval = setInterval(() => {
            currentIndex++;
            track.style.transition = 'transform 0.5s ease-in-out';
            track.style.transform = `translateY(-${currentIndex * itemHeight}px)`;
            if (currentIndex === totalItems) { setTimeout(() => { track.style.transition = 'none'; currentIndex = 0; track.style.transform = `translateY(0)`; }, 500); }
        }, 3000); 
    }
};

// === 全局暂存板逻辑 ===
const loadScratchpad = async () => {
    const data = await new Promise(r => chrome.storage.local.get(['meow_scratchpad'], r));
    if (data.meow_scratchpad) {
        scratchpadArea.value = data.meow_scratchpad;
    }
};

let spTimeout;
scratchpadArea.addEventListener('input', () => {
    spStatus.innerText = meowI18n.t('sp_saving');
    clearTimeout(spTimeout);
    spTimeout = setTimeout(() => {
        chrome.storage.local.set({ 'meow_scratchpad': scratchpadArea.value }, () => {
            spStatus.innerText = `${meowI18n.t('sp_saved')} ${new Date().toLocaleTimeString()}`;
        });
    }, 500);
});

spCopyBtn.addEventListener('click', () => {
    if (!scratchpadArea.value) return;
    scratchpadArea.select();
    document.execCommand('copy');
    window.getSelection().removeAllRanges();
    const originalText = spCopyBtn.innerHTML;
    spCopyBtn.innerHTML = `<span class="material-icons" style="font-size: 14px;">check</span> ${meowI18n.t('sp_copied')}`;
    spCopyBtn.style.backgroundColor = "#10b981";
    setTimeout(() => { spCopyBtn.innerHTML = originalText; spCopyBtn.style.backgroundColor = ""; }, 1500);
});

spClearBtn.addEventListener('click', async () => {
    if (await showConfirmDialog({ message: meowI18n.t('sp_confirm_clear'), type: 'warning' })) {
        scratchpadArea.value = "";
        chrome.storage.local.remove('meow_scratchpad');
        spStatus.innerText = meowI18n.t('sp_cleared');
    }
});

// === 暂存板工具设置 ===
function setupScratchpadTools() {
    if (!spBtnTitle || !spBtnLower || !spBtnUpper || !scratchpadArea) return;
    spBtnTitle.addEventListener('click', () => {
        const text = scratchpadArea.value; if (!text) return;
        scratchpadArea.value = text.replace(/[a-zA-Z]+/g, function(word) { return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(); });
        scratchpadArea.dispatchEvent(new Event('input'));
    });
    spBtnLower.addEventListener('click', () => { if (!scratchpadArea.value) return; scratchpadArea.value = scratchpadArea.value.toLowerCase(); scratchpadArea.dispatchEvent(new Event('input')); });
    spBtnUpper.addEventListener('click', () => { if (!scratchpadArea.value) return; scratchpadArea.value = scratchpadArea.value.toUpperCase(); scratchpadArea.dispatchEvent(new Event('input')); });
}

