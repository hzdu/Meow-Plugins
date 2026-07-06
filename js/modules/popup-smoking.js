// popup-smoking.js - 戒烟规划 + 深呼吸 + 备注列表
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 戒烟规划功能 ===
let smokingGoal = 5;
let smokingRecords = [];
let smokingSleepHours = ''; // 当天睡眠时长
let lastSmokeTimePrevDay = null; // 前一天的最后一条记录时间

const smokingGoalValue = document.getElementById('smoking-goal-value');
const smokingGoalDisplay = document.getElementById('smoking-goal-display');
const smokingGoalMinus = document.getElementById('smoking-goal-minus');
const smokingGoalPlus = document.getElementById('smoking-goal-plus');
const smokingCount = document.getElementById('smoking-count');
const smokingProgressFill = document.getElementById('smoking-progress-fill');
const smokingRecordBtn = document.getElementById('smoking-record-btn');
const smokingRecordCustomBtn = document.getElementById('smoking-record-custom-btn');
const smokingTimeInput = document.getElementById('smoking-time-input');
const smokingClearBtn = document.getElementById('smoking-clear-btn');
const smokingCopyBtn = document.getElementById('smoking-copy-records-btn');
const smokingList = document.getElementById('smoking-list');
const emptyStateSmoking = document.getElementById('empty-state-smoking');
const smokingSleepSelect = document.getElementById('smoking-sleep-select');
const deepBreathCheck = document.getElementById('deep-breath-check');
const deepBreathModal = document.getElementById('deep-breath-modal');

// 更新清醒时间显示 (Helper function)
const updateAwakeTimeDisplay = (sleepHours) => {
    const awakeTimeDisplay = document.getElementById('smoking-awake-time');
    if (awakeTimeDisplay) {
        if (sleepHours) {
            const sleep = parseInt(sleepHours);
            if (!isNaN(sleep)) {
                awakeTimeDisplay.textContent = `(清醒: ${24 - sleep}小时)`;
            } else {
                awakeTimeDisplay.textContent = '';
            }
        } else {
            awakeTimeDisplay.textContent = '';
        }
    }
};

// 加载戒烟数据（与选中日期挂钩）
const loadSmokingData = async () => {
    // 1. 尝试获取选中日期的特定目标
    let goalData = await getStorageData(`smoking_goal_${selectedDateKey}`);
    
    // 2. 如果该日期没设置过，尝试获取全局/最新目标作为默认值
    if (goalData === undefined || goalData === null) {
        goalData = await getStorageData('smoking_goal');
    }
    
    const recordsData = await getStorageData(`smoking_records_${selectedDateKey}`);
    const sleepData = await getStorageData(`smoking_sleep_${selectedDateKey}`);
    const diaryData = await getStorageData(`smoking_diary_${selectedDateKey}`);
    
    smokingGoal = goalData && typeof goalData === 'number' ? goalData : 5; // 默认为5
    smokingRecords = Array.isArray(recordsData) ? recordsData : [];
    
    // 获取前一天的最后一条记录
    const [sy, sm, sd] = selectedDateKey.split('-').map(Number);
    const prevDate = new Date(sy, sm - 1, sd - 1);
    const prevDateKey = `${prevDate.getFullYear()}-${prevDate.getMonth() + 1}-${prevDate.getDate()}`;
    const prevRecords = await getStorageData(`smoking_records_${prevDateKey}`);
    lastSmokeTimePrevDay = (Array.isArray(prevRecords) && prevRecords.length > 0) ? prevRecords[prevRecords.length - 1].time : null;
    
    // 加载日志
    const diaryInput = document.getElementById('smoking-diary-input');
    if (diaryInput) {
        diaryInput.value = typeof diaryData === 'string' ? diaryData : '';
    }
    
    // 渲染视图
    renderSmokingView();
    if (sleepData) {
        smokingSleepHours = sleepData;
        document.getElementById('smoking-sleep-select').value = sleepData;
        updateAwakeTimeDisplay(sleepData);
    } else {
        smokingSleepHours = '';
        document.getElementById('smoking-sleep-select').value = "";
        document.getElementById('smoking-awake-time').textContent = "";
    }
    
    // 加载深呼吸复选框状态
    const deepBreathData = await getStorageData('smoking_deep_breath');
    if (deepBreathCheck) {
        deepBreathCheck.checked = !!deepBreathData;
    }

    // 戒烟子标签切换
    const smokingSubtabs = document.querySelectorAll('.smoking-subtab-btn');
    smokingSubtabs.forEach(btn => {
        btn.addEventListener('click', () => {
            // 移除所有激活状态
            smokingSubtabs.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.smoking-subtab-content').forEach(c => {
                c.classList.remove('active');
                c.classList.add('hidden');
            });
            
            // 激活当前标签
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            const targetContent = document.getElementById(targetId);
            if (targetContent) {
                targetContent.classList.remove('hidden');
                targetContent.classList.add('active');
            }
            
            // 切换到"今日记录"时，自动滚动到最新记录
            if (targetId === 'smoking-view-records' && smokingList && smokingRecords.length > 0) {
                requestAnimationFrame(() => {
                    smokingList.scrollTop = smokingList.scrollHeight;
                });
            }
        });
    });

    // 戒烟日志自动保存 (防抖)
    const diaryInputEl = document.getElementById('smoking-diary-input');
    let diaryTimeout;
    if (diaryInputEl) {
        // 先移除旧的监听器以防重复绑定 (简单处理，实际应在 init 绑定一次)
        const newDiaryInput = diaryInputEl.cloneNode(true);
        diaryInputEl.parentNode.replaceChild(newDiaryInput, diaryInputEl);
        
        const indent = '\u3000\u3000'; // 两个全角空格

        // 初始化内容：如果为空，默认添加两个全角空格
        let initContent = typeof diaryData === 'string' ? diaryData : '';
        if (!initContent) {
            initContent = indent;
        }
        newDiaryInput.value = initContent;
        
        newDiaryInput.addEventListener('input', (e) => {
            clearTimeout(diaryTimeout);
            diaryTimeout = setTimeout(() => {
                saveSmokingDiary(e.target.value);
            }, 1000); // 1秒后自动保存
        });

        // 监听 Shift+Enter 自动缩进
        newDiaryInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                const start = newDiaryInput.selectionStart;
                const end = newDiaryInput.selectionEnd;
                const text = newDiaryInput.value;
                
                // 找到当前行开头
                let lineStart = text.lastIndexOf('\n', start - 1);
                lineStart = (lineStart === -1) ? 0 : lineStart + 1;
                
                // 检查当前行是否已经包含缩进
                const currentLinePrefix = text.substr(lineStart, indent.length);
                const isIndented = (currentLinePrefix === indent);

                if (isIndented) {
                    // 如果已经有缩进 (再次按下) -> 仅换行并新起段落缩进 (保留原行缩进)
                    const insertText = '\n' + indent;
                    newDiaryInput.value = text.substring(0, start) + insertText + text.substring(end);
                    
                    // 光标移动到新行缩进后
                    newDiaryInput.selectionStart = newDiaryInput.selectionEnd = start + insertText.length;
                } else {
                    // 如果没有缩进 -> 在行首插入缩进 (不换行)
                    const newText = text.substring(0, lineStart) + indent + text.substring(lineStart);
                    newDiaryInput.value = newText;
                    // 保持光标相对位置 (加上缩进长度)
                    newDiaryInput.selectionStart = start + indent.length;
                    newDiaryInput.selectionEnd = end + indent.length;
                }
                
                // 触发 input 事件以保存
                newDiaryInput.dispatchEvent(new Event('input'));
            }
        });
        
        // 聚焦时如果为空（或被用户清空了），恢复缩进
        newDiaryInput.addEventListener('focus', () => {
            if (!newDiaryInput.value) {
                newDiaryInput.value = indent;
            }
        });
    }
};

// 保存戒烟日志
const saveSmokingDiary = (content) => {
    const key = `smoking_diary_${selectedDateKey}`;
    const statusEl = document.getElementById('smoking-diary-save-status');
    
    if (statusEl) statusEl.textContent = '保存中...';
    
    chrome.storage.sync.set({ [key]: content }, () => {
        if (chrome.runtime.lastError) {
            console.error('Save diary error:', chrome.runtime.lastError);
            if (statusEl) {
                statusEl.textContent = '保存失败';
                statusEl.style.color = '#ef4444';
            }
        } else {
            if (statusEl) {
                const time = new Date().toLocaleTimeString();
                statusEl.textContent = `已保存 ${time}`;
                statusEl.style.color = '#10b981';
                
                // 3秒后清除状态
                setTimeout(() => {
                    if (statusEl.textContent.includes('已保存')) {
                        statusEl.textContent = '';
                    }
                }, 3000);
            }
        }
    });
};
// 保存戒烟目标（同时保存为该日期的目标和全局默认目标）
const saveSmokingGoal = () => {
    const updates = {};
    // 保存当前选中日期的目标
    updates[`smoking_goal_${selectedDateKey}`] = smokingGoal;
    // 更新全局目标（作为其他新日期的默认值）
    updates['smoking_goal'] = smokingGoal;
    
    chrome.storage.sync.set(updates);
};

// 保存选中日期的记录
const saveSmokingRecords = () => {
    chrome.storage.sync.set({ [`smoking_records_${selectedDateKey}`]: smokingRecords }, () => {
        renderSmokingView();
        renderCalendar(); // 更新日历上的标记
    });
};

// 保存当天睡眠时长
const saveSmokingSleepHours = () => {
    if (smokingSleepHours) {
        chrome.storage.sync.set({ [`smoking_sleep_${selectedDateKey}`]: smokingSleepHours });
    } else {
        chrome.storage.sync.remove(`smoking_sleep_${selectedDateKey}`);
    }
    
    // 更新清醒时间显示
    const awakeTimeDisplay = document.getElementById('smoking-awake-time');
    if (awakeTimeDisplay) {
        if (smokingSleepHours) {
            const sleep = parseInt(smokingSleepHours);
            if (!isNaN(sleep)) {
                awakeTimeDisplay.textContent = `(清醒: ${24 - sleep}小时)`;
            } else {
                awakeTimeDisplay.textContent = '';
            }
        } else {
            awakeTimeDisplay.textContent = '';
        }
    }

    // 睡眠时长变化后，立即更新智能提示
    updateSmokingTip();
};

// 计算时间间隔（分钟）
const calculateInterval = (time1, time2) => {
    const [h1, m1] = time1.split(':').map(Number);
    const [h2, m2] = time2.split(':').map(Number);
    const mins1 = h1 * 60 + m1;
    const mins2 = h2 * 60 + m2;
    return mins2 - mins1;
};

// 格式化间隔时间
const formatInterval = (minutes) => {
    if (minutes < 60) {
        return `${minutes}${meowI18n.t('smoking_min') || '分钟'}`;
    } else {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (mins === 0) {
            return `${hours}${meowI18n.t('smoking_hour') || '小时'}`;
        }
        return `${hours}${meowI18n.t('smoking_hour') || '小时'}${mins}${meowI18n.t('smoking_min') || '分钟'}`;
    }
};

// 获取稳定的随机颜色
const getStableColor = (str) => {
    const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#06b6d4'];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
};

// 渲染戒烟视图
const renderSmokingView = () => {
    // 更新日期标签
    const smokingDateLabel = document.getElementById('smoking-date-label');
    if (smokingDateLabel) {
        const [y, m, d] = selectedDateKey.split('-');
        smokingDateLabel.textContent = `${m}月${d}日记录`;
    }
    
    // 更新目标显示
    if (smokingGoalValue) smokingGoalValue.textContent = smokingGoal;
    if (smokingGoalDisplay) smokingGoalDisplay.textContent = smokingGoal;
    
    // 更新睡眠时长下拉框
    if (smokingSleepSelect) {
        smokingSleepSelect.value = smokingSleepHours;
        // 更新清醒时间显示
        const awakeTimeDisplay = document.getElementById('smoking-awake-time');
        if (awakeTimeDisplay) {
            if (smokingSleepHours) {
                const sleep = parseInt(smokingSleepHours);
                if (!isNaN(sleep)) {
                    awakeTimeDisplay.textContent = `(清醒: ${24 - sleep}小时)`;
                } else {
                    awakeTimeDisplay.textContent = '';
                }
            } else {
                awakeTimeDisplay.textContent = '';
            }
        }
    }
    
    // 更新计数
    const count = smokingRecords.length;
    if (smokingCount) smokingCount.textContent = count;
    
    // 更新进度条
    if (smokingProgressFill) {
        const percent = smokingGoal > 0 ? Math.min((count / smokingGoal) * 100, 100) : 0;
        smokingProgressFill.style.width = `${percent}%`;
    }
    
    // 设置时间选择器默认值为当前时间
    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMinute = String(now.getMinutes()).padStart(2, '0');
    if (smokingTimeInput) smokingTimeInput.value = `${currentHour}:${currentMinute}`;
    
    // 渲染记录列表
    if (!smokingList) return;
    smokingList.innerHTML = '';
    
    if (smokingRecords.length === 0) {
        if (emptyStateSmoking) emptyStateSmoking.classList.remove('hidden');
    } else {
        if (emptyStateSmoking) emptyStateSmoking.classList.add('hidden');
        
        smokingRecords.forEach((record, index) => {
            const li = document.createElement('li');
            li.className = 'smoking-item';
            
            // 计算与上一条的间隔
            let intervalHtml = '';
            let sleepTagHtml = '';
            if (index > 0) {
                const interval = calculateInterval(smokingRecords[index - 1].time, record.time);
                intervalHtml = `<span class="smoking-item-interval">+${formatInterval(interval)}</span>`;

                // 检查是否满足睡眠标签条件
                if (smokingSleepHours) {
                    const sleepThreshold = (parseInt(smokingSleepHours) * 60) - 30;
                    if (interval >= sleepThreshold) {
                         const tagColor = getStableColor('sleep' + record.time);
                         sleepTagHtml = `<span class="sleep-tag" style="background:${tagColor}; color:#fff; padding:1px 4px; border-radius:4px; font-size:0.6rem; margin-left:1px; font-weight:500;">睡觉</span>`;
                    }
                }
            } else if (index === 0 && lastSmokeTimePrevDay) {
                // 第一条记录，如果前一天有记录，计算跨天间隔
                const [ph, pm] = lastSmokeTimePrevDay.split(':').map(Number);
                const [ch, cm] = record.time.split(':').map(Number);
                const prevMin = ph * 60 + pm;
                const currMin = ch * 60 + cm;
                
                // 跨天计算：(24*60 - 前一天时间) + 当天时间
                const interval = (24 * 60 - prevMin) + currMin;
                intervalHtml = `<span class="smoking-item-interval" title="距离昨日">+${formatInterval(interval)}</span>`;
                
                // 检查是否满足睡眠标签条件
                if (smokingSleepHours) {
                    const sleepThreshold = (parseInt(smokingSleepHours) * 60) - 30;
                    if (interval >= sleepThreshold) {
                         const tagColor = getStableColor('sleep' + record.time);
                         sleepTagHtml = `<span class="sleep-tag" style="background:${tagColor}; color:#fff; padding:1px 4px; border-radius:4px; font-size:0.6rem; margin-left:1px; font-weight:500;">睡觉</span>`;
                    }
                }
            }
            
            li.style.flexDirection = 'column';
            li.style.alignItems = 'stretch';
            li.style.gap = '0';

            li.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="smoking-item-left">
                        <span class="smoking-item-number">${index + 1}</span>
                        <div style="display:flex; flex-direction:column; justify-content:center; align-items:flex-start;">
                            <span class="smoking-item-time" style="line-height:1.2;">${record.time}</span>
                            ${record.delayed ? (() => {
                                let text = '成功延迟';
                                if (record.duration) {
                                    const d = record.duration;
                                    if (d < 60) text += `${d}秒`;
                                    else text += `${Math.floor(d/60)}分${d%60}秒`;
                                }
                                return `<span class="delayed-tag" style="background:${record.tagColor || '#10b981'}; color:#fff; padding:1px 4px; border-radius:4px; font-size:0.6rem; margin-top:2px; font-weight:500; display:inline-flex; align-items:center; line-height:1.2; box-shadow:0 1px 2px rgba(0,0,0,0.1);">${text}</span>`;
                            })() : ''}
                        </div>
                    </div>
                    <div class="smoking-item-right">
                        ${intervalHtml}
                        <button class="smoking-item-delete" title="删除">
                            <span class="material-icons">close</span>
                        </button>
                    </div>
                </div>
                ${sleepTagHtml ? `<div style="margin-top:2px; padding-left:34px; display:flex;">${sleepTagHtml}</div>` : ''}
            `;
            
            li.querySelector('.smoking-item-delete').addEventListener('click', () => {
                smokingRecords.splice(index, 1);
                saveSmokingRecords();
            });
            
            smokingList.appendChild(li);
        });
    }
    
    // 更新智能提示
    updateSmokingTip();
    
    // 自动滚动到最新记录（底部）
    if (smokingList && smokingRecords.length > 0) {
        requestAnimationFrame(() => {
            smokingList.scrollTop = smokingList.scrollHeight;
        });
    }
};

// 更新戒烟智能提示
const updateSmokingTip = () => {
    const tipSection = document.getElementById('smoking-tip-section');
    const tipContent = document.getElementById('smoking-tip-content');
    if (!tipSection || !tipContent) return;
    
    const smokedCount = smokingRecords.length;
    const remainingCigs = smokingGoal - smokedCount;
    const sleepHours = parseInt(smokingSleepHours) || 0;
    
    // 获取当前时间（仅用于今天的计算）
    const now = new Date();
    const [selYear, selMonth, selDay] = selectedDateKey.split('-').map(Number);
    const isToday = (now.getFullYear() === selYear && 
                     (now.getMonth() + 1) === selMonth && 
                     now.getDate() === selDay);
    
    // 计算参考清醒时间（用于全天规划）
    const totalAwakeHours = 24 - sleepHours;
    
    // 目标达成状态判断逻辑修正：
    // 1. 剩余 < 0：超标 (Fail)
    // 2. 剩余 == 0：耗尽 (Warning)
    // 3. 剩余 > 0 且 非今天：达成 (Success)
    // 4. 剩余 > 0 且 今天：显示计划 (Plan)
    
    if (remainingCigs < 0) {
        tipSection.className = 'smoking-tip-section warning';
        tipSection.querySelector('.smoking-tip-icon .material-icons').textContent = 'warning';
        // 临时使用硬编码，稍后可补充i18n
        const exceededMsg = meowI18n.t('smoking_tip_goal_exceeded') || '今日目标已超标，请严格控制！';
        tipContent.innerHTML = `${exceededMsg} <span class="smoking-tip-highlight">(${Math.abs(remainingCigs)})</span>`;
        return;
    }
    
    if (remainingCigs === 0) {
        tipSection.className = 'smoking-tip-section warning';
        tipSection.querySelector('.smoking-tip-icon .material-icons').textContent = 'block';
        const limitMsg = meowI18n.t('smoking_tip_goal_limit') || '今日额度已用完，请停止吸烟！';
        tipContent.innerHTML = `${limitMsg}`;
        return;
    }
    
    if (!isToday) {
        // 过去的日子，且有剩余 -> 成功
        tipSection.className = 'smoking-tip-section success';
        tipSection.querySelector('.smoking-tip-icon .material-icons').textContent = 'celebration';
        tipContent.innerHTML = meowI18n.t('smoking_tip_goal_reached') || 
            `<span class="smoking-tip-highlight">太棒了！</span>今日控制良好，继续保持！`;
        return;
    }
    
    // 如果没有设置睡眠时长，提示设置（虽然在动态计算中暂时用不到，但为了完整性还是保留检查，或改为非强制）
    // 为了响应用户需求，这里暂时从逻辑上弱化睡眠时长的强制性，如果没设置默认为8小时
    const usedSleepHours = sleepHours || 8; 

    // 计算剩余可用时间
    // 逻辑修正：用户指出应该是 (24:00 - 最后一个记录的时间) / 剩余额度
    // 睡眠时长被认为“已包含在过去的时间里”，因此不再额外扣除或按比例缩减
    let remainingMinutes = 0;
    
    if (isToday) {
        // 获取基准时间：如果有记录，用最后一条记录的时间；否则用当前时间
        let referenceMinutes = now.getHours() * 60 + now.getMinutes();
        
        if (smokingRecords.length > 0) {
            const lastRecord = smokingRecords[smokingRecords.length - 1];
            const [lh, lm] = lastRecord.time.split(':').map(Number);
            referenceMinutes = lh * 60 + lm;
        }

        const endOfDayMinutes = 24 * 60; 
        remainingMinutes = Math.max(0, endOfDayMinutes - referenceMinutes);

        // 如果用户有设置睡眠时长，则应该先减去睡眠时长的时间
        // if (sleepHours > 0) {
        //     const sleepMinutes = sleepHours * 60;
        //     // 确保剩余时间不会变成负数
        //     remainingMinutes = Math.max(0, remainingMinutes - sleepMinutes);
        // }
    } else {
        // 非今天：显示全天的平均间隔（使用清醒时间）
        // 这里仍然可以扣除睡眠，因为是全天规划
        remainingMinutes = (24 - usedSleepHours) * 60;
    }
    
    // 计算平均间隔
    if (remainingMinutes <= 0) {
        tipSection.className = 'smoking-tip-section warning';
        tipSection.querySelector('.smoking-tip-icon .material-icons').textContent = 'schedule';
        tipContent.innerHTML = meowI18n.t('smoking_tip_no_time') || 
            `今日时间已结束，请注意控制`;
        return;
    }
    
    const intervalMinutes = Math.floor(remainingMinutes / remainingCigs);
    const intervalHours = Math.floor(intervalMinutes / 60);
    const intervalMins = intervalMinutes % 60;
    
    // 格式化间隔时间
    let intervalText = '';
    const unitHour = meowI18n.t('smoking_unit_hour') || '小时';
    const unitMin = meowI18n.t('smoking_unit_minute') || '分钟';
    
    if (intervalHours > 0 && intervalMins > 0) {
        intervalText = `${intervalHours}${unitHour}${intervalMins}${unitMin}`;
    } else if (intervalHours > 0) {
        intervalText = `${intervalHours}${unitHour}`;
    } else {
        intervalText = `${intervalMins}${unitMin}`;
    }
    
    // 计算建议下一支的时间
    let nextSmokeTimeStr = '';
    let finalSmokeTimeStr = '';
    let nextSmokeCountdownStr = '';
    
    if (smokingRecords.length > 0) {
        const lastRecord = smokingRecords[smokingRecords.length - 1];
        const [lh, lm] = lastRecord.time.split(':').map(Number);
        const lastSmokeDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), lh, lm);
        
        const nextSmokeDate = new Date(lastSmokeDate.getTime() + intervalMinutes * 60000);
        
        const complexNextHour = nextSmokeDate.getHours().toString().padStart(2, '0');
        const complexNextMin = nextSmokeDate.getMinutes().toString().padStart(2, '0');
        nextSmokeTimeStr = `${complexNextHour}:${complexNextMin}`;

        // 计算倒计时
        const diffMs = nextSmokeDate - now;
        if (diffMs > 0) {
            const diffMins = Math.floor(diffMs / 60000);
            if (diffMins < 60) {
                nextSmokeCountdownStr = `${diffMins}分钟`;
            } else {
                const h = Math.floor(diffMins / 60);
                const m = diffMins % 60;
                nextSmokeCountdownStr = `${h}小时${m}分钟`;
            }
        } else {
            nextSmokeCountdownStr = '0分钟'; // Or handle as ready?
        }

        // 计算最后一支的时间 (仅当剩余超过1支时显示，否则最后一支就是下一支)
        if (remainingCigs > 1) {
            const finalSmokeDate = new Date(lastSmokeDate.getTime() + (remainingCigs * intervalMinutes) * 60000);
            const finalHour = finalSmokeDate.getHours().toString().padStart(2, '0');
            const finalMin = finalSmokeDate.getMinutes().toString().padStart(2, '0');
            finalSmokeTimeStr = `${finalHour}:${finalMin}`;
        }
    }

    // 设置提示样式和内容
    tipSection.className = 'smoking-tip-section';
    tipSection.querySelector('.smoking-tip-icon .material-icons').textContent = 'tips_and_updates';
    
    // 默认/初始状态提示
    const tipPrefix = isToday ? 
        (meowI18n.t('smoking_tip_today_prefix') || '今日还剩') : 
        (meowI18n.t('smoking_tip_day_prefix') || '当日计划');
    
    const tipQuota = meowI18n.t('smoking_tip_quota') || '支额度，';
    const tipIntervalPre = meowI18n.t('smoking_tip_interval_pre') || '建议每隔';
    const tipIntervalPost = meowI18n.t('smoking_tip_interval_post') || '一支';
    
    const lastEstTip = meowI18n.t('smoking_tip_last_est') || '；预计结束于';
    
    let tipHtml = `${tipPrefix} <span class="smoking-tip-highlight">${remainingCigs}</span> ${tipQuota}` +
        `${tipIntervalPre} <span class="smoking-tip-highlight">${intervalText}</span> ${tipIntervalPost}`;
        
    // 如果有下一支的时间，显示特定格式
    if (nextSmokeTimeStr) {
        tipHtml += `；距离下一支 <span class="smoking-tip-highlight">${nextSmokeTimeStr}</span> 建议后的目标还有 <span class="smoking-tip-highlight">${nextSmokeCountdownStr}</span>，请坚持住`;
    }
    
    if (finalSmokeTimeStr) {
        tipHtml += `${lastEstTip} <span class="smoking-tip-highlight">${finalSmokeTimeStr}</span>`;
    }
    
    tipContent.innerHTML = tipHtml;
};

// === 深呼吸 Modal 逻辑 ===
const showDeepBreathModal = async (onClose) => {
    if (!deepBreathModal) { if (onClose) onClose(); return; }
    
    deepBreathModal.classList.remove('hidden');
    deepBreathModal.classList.add('visible');
    const closeX = document.getElementById('breath-close-x');
    const closeBtnBottom = document.getElementById('breath-close-btn');
    const cancelBtn = document.getElementById('breath-cancel-btn');
    const circle = deepBreathModal.querySelector('.breathing-circle');
    const text = document.getElementById('breath-text');
    const countdown = document.getElementById('breath-countdown');
    const elapsedEl = document.getElementById('breath-elapsed');
    const leaderboardList = document.getElementById('breath-leaderboard-list');

    // 加载并渲染排行榜
    const updateLeaderboardUI = (list) => {
        if (!leaderboardList) return;
        leaderboardList.innerHTML = list.length ? '' : '<div style="padding:20px;text-align:center;color:#9ca3af;font-size:0.8rem;">暂无记录，快来深呼吸吧~</div>';
        
        list.forEach((item, index) => {
            const date = new Date(item.date);
            const dateStr = `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
            const mins = String(Math.floor(item.duration / 60)).padStart(2, '0');
            const secs = String(item.duration % 60).padStart(2, '0');
            
            const li = document.createElement('li');
            li.className = 'leaderboard-item';
            li.innerHTML = `
                <div class="rank-badge">${index + 1}</div>
                <div class="record-date">${dateStr}</div>
                <div class="record-duration" style="margin-right:4px;">${mins}:${secs}</div>
                <button class="record-delete-btn" title="删除">
                    <span class="material-icons" style="font-size:16px;">close</span>
                </button>
            `;
            
            const delBtn = li.querySelector('.record-delete-btn');
            if (delBtn) {
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    list.splice(index, 1);
                    chrome.storage.sync.set({ 'deep_breath_top10': list });
                    updateLeaderboardUI(list);
                };
            }
            leaderboardList.appendChild(li);
        });
    };

    let top10 = await getStorageData('deep_breath_top10') || [];
    updateLeaderboardUI(top10);
    
    // 重置状态
    circle.className = 'breathing-circle';
    text.textContent = '准备';
    countdown.textContent = '';
    if (elapsedEl) elapsedEl.textContent = '00:00';
    
    // 停留计时器
    let elapsedSeconds = 0;
    const elapsedInterval = setInterval(() => {
        elapsedSeconds++;
        const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
        const secs = String(elapsedSeconds % 60).padStart(2, '0');
        if (elapsedEl) elapsedEl.textContent = `${mins}:${secs}`;
    }, 1000);
    
    // 关闭函数
    let breathTimer;
    let countdownInterval;
    const closeModal = (skipRecord = false) => {
        // 如果点击“不点”，记录到戒烟日志
        if (skipRecord) {
            const now = new Date();
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            const msg = `这家伙可以啊，${h}点${m}分我诱惑这家伙抽烟没成功，NND~~`;
            
            const key = `smoking_diary_${selectedDateKey}`;
            chrome.storage.sync.get([key], (result) => {
                let content = result[key] || '';
                // 如果已有内容且最后不是换行，加个换行
                if (content && !content.endsWith('\n')) content += '\n';
                content += msg;
                
                // 保存并更新UI
                saveSmokingDiary(content);
                const diaryInput = document.getElementById('smoking-diary-input');
                if (diaryInput) diaryInput.value = content;
            });
        }

        // 保存记录
        if (!skipRecord && elapsedSeconds > 5) { // 至少呼吸5秒才记录
            const newRecord = {
                date: Date.now(),
                duration: elapsedSeconds
            };
            top10.push(newRecord);
            // 按时长倒序排列
            top10.sort((a, b) => b.duration - a.duration);
            // 只保留前10
            if (top10.length > 10) top10 = top10.slice(0, 10);
            
            chrome.storage.sync.set({ 'deep_breath_top10': top10 });
        }

        deepBreathModal.classList.remove('visible');
        deepBreathModal.classList.add('hidden');
        clearTimeout(breathTimer);
        clearInterval(countdownInterval);
        clearInterval(elapsedInterval);
        circle.className = 'breathing-circle';
        // 如果是跳过记录（不点），则不回调 onClose，或者传 null
        if (!skipRecord && onClose) onClose(elapsedSeconds);
    };
    
    if (closeX) closeX.onclick = () => closeModal(false); // X default to record? or maybe false? Let's assume X means cancel usually, but the user didn't specify. I will keep it same as before (record if > 5s) for now, or maybe safely explicit. Let's stick to previous behavior: X closes and records.
    if (closeBtnBottom) closeBtnBottom.onclick = () => closeModal(false); // 点上 -> 记录
    if (cancelBtn) cancelBtn.onclick = () => closeModal(true); // 不点 -> 不记录
    
    // 点击遮罩关闭
    deepBreathModal.onclick = (e) => {
        if (e.target === deepBreathModal) closeModal(false); // Mask click -> record (default behavior)
    };
    
    // 倒计时辅助函数
    const startCountdown = (seconds) => {
        let remaining = seconds;
        countdown.textContent = remaining;
        clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            remaining--;
            if (remaining > 0) {
                countdown.textContent = remaining;
            } else {
                countdown.textContent = '';
                clearInterval(countdownInterval);
            }
        }, 1000);
    };
    
    // 呼吸循环: 吸气(4s) -> 保持(2s) -> 呼气(4s)
    const breatheLoop = () => {
        circle.className = 'breathing-circle inhale';
        text.textContent = '吸气';
        startCountdown(4);
        
        breathTimer = setTimeout(() => {
            circle.className = 'breathing-circle hold';
            text.textContent = '保持';
            startCountdown(2);
            
            breathTimer = setTimeout(() => {
                circle.className = 'breathing-circle exhale';
                text.textContent = '呼气';
                startCountdown(4);
                
                breathTimer = setTimeout(() => {
                     breatheLoop();
                }, 4000);
                
            }, 2000);
            
        }, 4000);
    };
    
    setTimeout(breatheLoop, 500);
};

// 添加记录的公共函数（带排序）
// 添加记录的公共函数（带排序）
const addSmokingRecord = async (timeStr, isDelayed = false, duration = 0) => {
    // 检查是否已经存在完全相同时间的记录（防止快速点击导致的重复）
    // 如果用户确实需要在同一分钟记录多次，建议间隔几秒或手动修改时间
    // 这里主要防抖，避免BUG
    if (smokingRecords.some(r => r.time === timeStr)) {
        return false;
    }

    // 检查是否超过目标
    if (smokingRecords.length >= smokingGoal) {
        if (!(await showConfirmDialog({ message: meowI18n.t('smoking_over_goal') || '已达到今日目标，确定继续记录？', type: 'warning' }))) {
            return false;
        }
    }
    
    // 根据选中日期和时间字符串生成timestamp用于排序
    const [h, m] = timeStr.split(':').map(Number);
    const [year, month, day] = selectedDateKey.split('-').map(Number);
    const recordDate = new Date(year, month - 1, day, h, m, 0);
    
    // 生成随机颜色
    const getRandomColor = () => {
        const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#06b6d4'];
        return colors[Math.floor(Math.random() * colors.length)];
    };

    const record = { time: timeStr, timestamp: recordDate.getTime() };
    
    if (isDelayed) {
        record.delayed = true;
        record.tagColor = getRandomColor();
        if (duration > 0) record.duration = duration;
        // Debug
        console.log('Adding delayed record:', record);
    }

    smokingRecords.push(record);
    
    // 按时间排序
    smokingRecords.sort((a, b) => a.timestamp - b.timestamp);
    
    saveSmokingRecords();
    return true;
};

// 事件监听
if (smokingGoalMinus) {
    smokingGoalMinus.addEventListener('click', () => {
        if (smokingGoal > 1) {
            smokingGoal--;
            saveSmokingGoal();
            renderSmokingView();
        }
    });
}

if (smokingGoalPlus) {
    smokingGoalPlus.addEventListener('click', () => {
        if (smokingGoal < 50) {
            smokingGoal++;
            saveSmokingGoal();
            renderSmokingView();
        }
    });
}

if (smokingRecordBtn) {
    smokingRecordBtn.addEventListener('click', () => {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (deepBreathCheck && deepBreathCheck.checked) {
            showDeepBreathModal((duration) => {
                addSmokingRecord(timeStr, true, duration);
            });
        } else {
            addSmokingRecord(timeStr);
        }
    });
}

if (smokingClearBtn) {
    smokingClearBtn.addEventListener('click', async () => {
        if (smokingRecords.length === 0) return;
        if (await showConfirmDialog({ message: meowI18n.t('smoking_clear_confirm') || '确定清空今日所有记录？', type: 'warning' })) {
            smokingRecords = [];
            saveSmokingRecords();
        }
    });
}

if (smokingCopyBtn) {
    smokingCopyBtn.addEventListener('click', () => {
        if (smokingRecords.length === 0) return;
        
        const dateLabel = document.getElementById('smoking-date-label').textContent;
        let textToCopy = `### ${dateLabel}\n\n`;
        textToCopy += `| 序号 | 时间 | 间隔 |\n`;
        textToCopy += `| :---: | :---: | :--- |\n`;
        
        smokingRecords.forEach((record, index) => {
            let intervalStr = '-';
            let timeStrFormatted = record.time;
            
            // 延迟标签
            if (record.delayed) {
                let delayedText = ' [成功延迟';
                if (record.duration) {
                    const d = record.duration;
                    if (d < 60) delayedText += `${d}秒`;
                    else delayedText += `${Math.floor(d/60)}分${d%60}秒`;
                }
                delayedText += ']';
                timeStrFormatted += delayedText;
            }

            // 间隔计算 (逻辑复用 renderSmokingView)
            let intervalVal = 0;
            let hasInterval = false;

            if (index > 0) {
                intervalVal = calculateInterval(smokingRecords[index - 1].time, record.time);
                intervalStr = `+${formatInterval(intervalVal)}`;
                hasInterval = true;
            } else if (index === 0 && lastSmokeTimePrevDay) {
                 const [ph, pm] = lastSmokeTimePrevDay.split(':').map(Number);
                 const [ch, cm] = record.time.split(':').map(Number);
                 const prevMin = ph * 60 + pm;
                 const currMin = ch * 60 + cm;
                 intervalVal = (24 * 60 - prevMin) + currMin;
                 intervalStr = `+${formatInterval(intervalVal)}`;
                 hasInterval = true;
            }

            // 睡觉标签
            if (hasInterval && smokingSleepHours) {
                const sleepThreshold = (parseInt(smokingSleepHours) * 60) - 30;
                if (intervalVal >= sleepThreshold) {
                    intervalStr += ' [睡觉]';
                }
            }

            textToCopy += `| ${index + 1} | ${timeStrFormatted} | ${intervalStr} |\n`;
        });
        
        // Append smoking tip content
        const tipContent = document.getElementById('smoking-tip-content');
        if (tipContent) {
            textToCopy += `\n${tipContent.innerText}\n`;
        }
        
        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalInner = smokingCopyBtn.innerHTML;
            smokingCopyBtn.innerHTML = '<span class="material-icons" style="color:#10b981">check</span>';
            setTimeout(() => {
                smokingCopyBtn.innerHTML = originalInner;
            }, 1000);
        }).catch(err => {
            console.error('Copy failed:', err);
            // Fallback for some contexts
            const textArea = document.createElement("textarea");
            textArea.value = textToCopy;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                const originalInner = smokingCopyBtn.innerHTML;
                smokingCopyBtn.innerHTML = '<span class="material-icons" style="color:#10b981">check</span>';
                setTimeout(() => {
                    smokingCopyBtn.innerHTML = originalInner;
                }, 1000);
            } catch (err) {
                console.error('Fallback copy failed', err);
                alert('复制失败 / Copy failed');
            }
            document.body.removeChild(textArea);
        });
    });
}

// 自定义时间记录按钮
if (smokingRecordCustomBtn) {
    smokingRecordCustomBtn.addEventListener('click', () => {
        const timeStr = smokingTimeInput ? smokingTimeInput.value : '';
        
        if (!timeStr) {
            if (smokingTimeInput) {
                smokingTimeInput.style.border = "1px solid #ef4444";
                setTimeout(() => {
                    smokingTimeInput.style.border = "";
                }, 2000);
            }
            return;
        }

        const doRecord = async (isDelayed = false, duration = 0) => {
            if (await addSmokingRecord(timeStr, isDelayed, duration)) {
                const now = new Date();
                const h = String(now.getHours()).padStart(2, '0');
                const m = String(now.getMinutes()).padStart(2, '0');
                if (smokingTimeInput) smokingTimeInput.value = `${h}:${m}`;
            }
        };

        if (deepBreathCheck && deepBreathCheck.checked) {
            showDeepBreathModal((duration) => doRecord(true, duration));
        } else {
            doRecord(false);
        }
    });
}

// 睡眠时长下拉框事件
if (smokingSleepSelect) {
    smokingSleepSelect.addEventListener('change', () => {
        smokingSleepHours = smokingSleepSelect.value;
        saveSmokingSleepHours();
    });
}

// 深呼吸复选框状态保存
if (deepBreathCheck) {
    deepBreathCheck.addEventListener('change', () => {
        chrome.storage.sync.set({ 'smoking_deep_breath': deepBreathCheck.checked });
    });
}

// === 备注列表 ===
const loadAndRenderNotesList = async () => {
    const syncData = await new Promise(r => chrome.storage.sync.get(null, items => r(items || {})));
    const localData = await new Promise(r => chrome.storage.local.get(null, items => r(items || {})));
    const allNotes = [];
    const process = (d) => Object.keys(d).forEach(k => { if(k.startsWith('annotation_') && d[k].url) allNotes.push({key:k, ...d[k]}); });
    process(syncData); process(localData);
    allNotes.sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
    renderNotesList(allNotes);
};

const renderNotesList = (notes) => {
    notesList.innerHTML = ""; 
    notesTotalLabel.textContent = meowI18n.t('notes_total', { n: notes.length });
    
    if (notes.length === 0) emptyStateNotes.classList.remove("hidden");
    else {
        emptyStateNotes.classList.add("hidden");
        notes.forEach((note) => {
            const li = document.createElement("li"); li.className = "notes-item";
            let domain = note.url; try { domain = new URL(note.url).hostname; } catch(e){}
            li.innerHTML = `<div class="notes-info"><span class="notes-title">${escapeHtml(note.title||'No Title')}</span><span class="notes-meta">${escapeHtml(domain)} · ${note.date||'Unknown'}</span></div><div style="display:flex;gap:5px;"><span class="material-icons edit-btn">open_in_new</span><span class="material-icons delete-btn">delete</span></div>`;
            li.querySelector(".notes-info").onclick = () => chrome.tabs.create({ url: `views/viewer.html?id=${note.key}` });
            li.querySelector(".edit-btn").onclick = (e) => { e.stopPropagation(); chrome.storage.local.set({'meow_edit_intent': note.key}); chrome.tabs.create({url:note.url}); };
            li.querySelector(".delete-btn").onclick = (e) => { e.stopPropagation(); chrome.storage.sync.remove(note.key); chrome.storage.local.remove(note.key); loadAndRenderNotesList(); };
            notesList.appendChild(li);
        });
    }
};

