// popup-habits.js - 习惯功能
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 习惯功能 ===
const loadHabits = async () => {
    const data = await chrome.storage.sync.get(['habits_config', 'habits_records']);
    habitsConfig = data.habits_config || []; 
    habitsRecords = data.habits_records || {};
    let hasChanges = false;
    // 兼容旧数据：将字符串习惯转换为对象格式，并赋予稳定 ID
    habitsConfig = habitsConfig.map((h, i) => {
        if (typeof h === 'string') {
            hasChanges = true;
            // 使用简易 hash 生成 ID，避免每次刷新变动 (简单起见，如果只是为了迁移，现在的Date.now()其实也行，只要保存回去)
            // 但为了防止重复，我们还是先生成，然后立即保存
            return { id: 'habit_' + Date.now() + '_' + i, name: h, targetTime: '' };
        }
        if (!h.id) {
            hasChanges = true;
            h.id = 'habit_' + Date.now() + '_' + i;
        }
        return h;
    });
    
    if (hasChanges) {
        saveHabitsConfig(); // 立即保存标准化的配置
    }
};
const saveHabitsConfig = () => chrome.storage.sync.set({ habits_config: habitsConfig }, () => checkAndHighlightTabs(selectedDateKey));
const saveHabitsRecords = () => chrome.storage.sync.set({ habits_records: habitsRecords });

// 获取习惯记录的key (兼容旧数据)
const getHabitRecordKey = (habit) => habit.id || habit.name || habit;

const renderHabitsView = () => {
    habitsList.innerHTML = "";
    if (habitsConfig.length === 0) emptyStateHabits.classList.remove("hidden");
    else {
        emptyStateHabits.classList.add("hidden");
        const todayRecord = habitsRecords[selectedDateKey] || {};
        const doneCount = habitsConfig.reduce((acc, h) => {
            const key = getHabitRecordKey(h);
            return acc + (todayRecord[key] ? 1 : 0);
        }, 0);
        const totalCount = habitsConfig.length;
        const rate = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);
        
        let titleText = meowI18n.t('habit_progress');
        const todayStr = `${currYear}-${currMonth + 1}-${date.getDate()}`;
        // 如果选中的日期不是今天 (这里简单判断，也可以用 new Date() 对比)
        // 注意：selectedDateKey 格式为 YYYY-M-D (没有补0)，而 todayStr 也是
        // 为了更严谨，我们对比 selectedDateKey 和 "今天" 的 key
        const now = new Date();
        const realTodayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        
        if (selectedDateKey !== realTodayKey) {
            // 显示选中日期
            const [y, m, d] = selectedDateKey.split('-');
            titleText = meowI18n.t('habit_progress_date', { date: `${m}/${d}` });
        }

        habitsList.innerHTML = `<div class="panel-progress-container"><div class="panel-progress-label"><span>${titleText}</span><span>${doneCount}/${totalCount}</span></div><div class="panel-progress-bar"><div class="panel-progress-fill" style="width: ${rate}%"></div></div></div>`;
        
        // 按目标时间排序
        const sortedHabits = [...habitsConfig].sort((a, b) => {
            if (!a.targetTime && !b.targetTime) return 0;
            if (!a.targetTime) return 1;
            if (!b.targetTime) return -1;
            return a.targetTime.localeCompare(b.targetTime);
        });
        
        sortedHabits.forEach((habit) => {
            const originalIndex = habitsConfig.findIndex(h => h.id === habit.id);
            const recordKey = getHabitRecordKey(habit);
            const recordValue = todayRecord[recordKey];
            const isDone = !!recordValue;
            const checkTime = typeof recordValue === 'string' ? recordValue : '';
            
            // 判断是否准时打卡
            let timeStatus = '';
            if (isDone && checkTime && habit.targetTime) {
                const [targetH, targetM] = habit.targetTime.split(':').map(Number);
                const [checkH, checkM] = checkTime.split(':').map(Number);
                const targetMins = targetH * 60 + targetM;
                const checkMins = checkH * 60 + checkM;
                const diff = checkMins - targetMins;
                if (diff <= 0) {
                    timeStatus = 'ontime'; // 准时或提前
                } else if (diff <= 30) {
                    timeStatus = 'late'; // 迟到30分钟内
                } else {
                    timeStatus = 'verylate'; // 迟到超过30分钟
                }
            }
            
            const li = document.createElement("div"); 
            li.className = `habit-item ${isDone ? 'done' : ''}`;
            
            // 显示：目标时间 + 名称 + 实际打卡时间
            let timeDisplay = '';
            if (habit.targetTime) {
                timeDisplay = `<span class="habit-target-time">${habit.targetTime}</span>`;
            }
            let checkTimeDisplay = '';
            if (isDone && checkTime) {
                checkTimeDisplay = `<span class="habit-check-time ${timeStatus}">${checkTime}</span>`;
            }
            
            li.innerHTML = `<input type="checkbox" class="habit-checkbox" ${isDone?'checked':''}>
                ${timeDisplay}
                <span class="habit-text">${escapeHtml(habit.name)}</span>
                ${checkTimeDisplay}
                <div class="habit-actions"><span class="material-icons icon-btn edit">edit</span><span class="material-icons icon-btn delete">delete</span></div>`;
            
            li.onclick = (e) => { 
                if (!e.target.classList.contains('icon-btn') && e.target.tagName !== 'INPUT') { 
                    const cb = li.querySelector('input'); 
                    cb.checked = !cb.checked; 
                    cb.dispatchEvent(new Event('change')); 
                } 
            };
            
            li.querySelector('input').onchange = () => { 
                if (!habitsRecords[selectedDateKey]) habitsRecords[selectedDateKey] = {}; 
                if (!isDone) {
                    const now = new Date();
                    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                    habitsRecords[selectedDateKey][recordKey] = timeStr;
                } else {
                    habitsRecords[selectedDateKey][recordKey] = false;
                }
                saveHabitsRecords(); renderHabitsView(); renderCalendar(); 
            };
            
            li.querySelector('.edit').onclick = (e) => { 
                e.stopPropagation(); 
                const newName = prompt("名称:", habit.name); 
                if(newName === null) return;
                let newTime = prompt("目标时间 (HH:MM):", habit.targetTime || '');
                if(newTime === null) return;
                
                // 校验时间格式 HH:MM
                if (newTime.trim() && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(newTime.trim())) {
                    alert("时间格式错误，请输入 HH:MM (如 08:30)");
                    return;
                }

                if(newName.trim()) { 
                    habitsConfig[originalIndex].name = newName.trim();
                    habitsConfig[originalIndex].targetTime = newTime.trim();
                    saveHabitsConfig(); 
                    renderHabitsView(); 
                } 
            };
            
            li.querySelector('.delete').onclick = async (e) => { 
                e.stopPropagation(); 
                if(await showConfirmDialog({ message: meowI18n.t('delete_confirm'), type: 'danger' })) { 
                    habitsConfig.splice(originalIndex, 1); 
                    saveHabitsConfig(); 
                    renderHabitsView(); 
                    renderCalendar(); 
                } 
            };
            
            habitsList.appendChild(li);
        });
    }
};

const habitHourInput = document.getElementById('habit-hour-input');
const habitMinuteInput = document.getElementById('habit-minute-input');
const habitTimeToggle = document.getElementById('habit-time-toggle');
const habitTimeInputs = document.getElementById('habit-time-inputs');

// 时间开关：控制时间选择器的显示/隐藏
habitTimeToggle.addEventListener('change', () => {
    if (habitTimeToggle.checked) {
        habitTimeInputs.classList.add('show');
        setDefaultHabitTime();
    } else {
        habitTimeInputs.classList.remove('show');
    }
});

addHabitBtn.addEventListener("click", () => { 
    const name = newHabitInput.value.trim();
    if (!name) return;
    
    let targetTime = '';
    
    // 仅当时间开关打开时，验证并获取时间
    if (habitTimeToggle.checked) {
        if (!habitHourInput.value || !habitMinuteInput.value) {
            if (!habitHourInput.value) habitHourInput.style.borderColor = "#ef4444";
            if (!habitMinuteInput.value) habitMinuteInput.style.borderColor = "#ef4444";
            setTimeout(() => {
                if (habitHourInput) habitHourInput.style.borderColor = "";
                if (habitMinuteInput) habitMinuteInput.style.borderColor = "";
            }, 2000);
            return;
        }
        targetTime = `${habitHourInput.value}:${habitMinuteInput.value}`;
    }
    
    habitsConfig.push({ 
        id: 'habit_' + Date.now(), 
        name: name, 
        targetTime: targetTime 
    }); 
    saveHabitsConfig(); 
    newHabitInput.value = ""; 
    if(habitHourInput) habitHourInput.value = "";
    if(habitMinuteInput) habitMinuteInput.value = "";
    renderHabitsView(); 
    renderApp(); 
});
newHabitInput.addEventListener("keypress", (e) => { if (e.key === "Enter") addHabitBtn.click(); });

const setDefaultHabitTime = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    // 分钟向下取5的倍数，因为下拉框是按5分钟间隔的（或者用户可能更喜欢实时时间，但我下拉框是步进的吗？不，我现在下拉框是00-59全量的）
    // 既然是全量的，那就直接设置实时分钟
    const m = String(now.getMinutes()).padStart(2, '0');
    
    if (habitHourInput) habitHourInput.value = h;
    if (habitMinuteInput) habitMinuteInput.value = m;
};

