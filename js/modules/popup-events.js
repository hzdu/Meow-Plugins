// popup-events.js - 事件监听 + Tab拖放 + 财务导出 + 备份恢复
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 事件监听 ===
tabBtns.forEach(btn => btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    tabContents.forEach(c => c.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`view-${btn.dataset.tab}`).classList.remove("hidden");
    
    // 离开2FA标签时清理定时器
    if (btn.dataset.tab !== '2fa') {
        Object.keys(faRefreshIntervals).forEach(id => {
            clearInterval(faRefreshIntervals[id]);
            clearTimeout(faRefreshIntervals[id + '_timeout']);
        });
        faRefreshIntervals = {};
    }
    
    // 恢复 tab-tracker 过渡动画（如被滚动禁用）
    if (tabTracker) {
        clearTimeout(tabTracker._scrollTimer);
        tabTracker.style.transition = '';
    }
    updateTabTracker();

    // 确保激活的 tab 在垂直滚动区域内可见
    const verticalTabGroup = btn.closest('.tab-group.vertical-tabs');
    if (verticalTabGroup) {
        btn.scrollIntoView({ block: 'nearest' });
    }
    
    // 保存当前选中的 Tab，以便下次打开时恢复
    chrome.storage.local.set({ 'meow_last_active_tab': btn.dataset.tab });

    if (btn.dataset.tab === 'habits') setDefaultHabitTime();
    if (btn.dataset.tab === 'notes') loadAndRenderNotesList();
    if (btn.dataset.tab === 'alarms') renderAlarmsView(); 
    if (btn.dataset.tab === 'countdowns') renderCountdownsView(); 
    if (btn.dataset.tab === 'pre-expenses') renderPreExpensesView(); 
    if (btn.dataset.tab === 'smoking') renderSmokingView();
    if (btn.dataset.tab === '2fa') render2FA();
    if (btn.dataset.tab === 'ai-provider') renderAIProviders();
    if (btn.dataset.tab === 'assets') renderAssetsView();
}));

if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleSidebarState);
}
if (toggleRightBtn) {
    toggleRightBtn.addEventListener('click', toggleRightPanelState);
}
window.addEventListener('resize', updateTabTracker);

// === Tab 拖放排序 ===
function saveTabOrder() {
    const tabGroup = document.querySelector('.tab-group.vertical-tabs');
    if (!tabGroup) return;
    const tabs = tabGroup.querySelectorAll('.tab-btn:not(.settings-btn)');
    const order = Array.from(tabs).map(t => t.dataset.tab);
    chrome.storage.local.set({ 'meow_tab_order': order });
}

function restoreTabOrder() {
    const tabGroup = document.querySelector('.tab-group.vertical-tabs');
    if (!tabGroup) return;
    chrome.storage.local.get(['meow_tab_order'], (result) => {
        const order = result.meow_tab_order;
        if (!order || !Array.isArray(order) || order.length === 0) return;
        const currentTabs = tabGroup.querySelectorAll('.tab-btn:not(.settings-btn)');
        const currentOrder = Array.from(currentTabs).map(t => t.dataset.tab);
        if (JSON.stringify(order) === JSON.stringify(currentOrder)) return;
        const tabMap = {};
        currentTabs.forEach(t => { tabMap[t.dataset.tab] = t; });
        const divider = tabGroup.querySelector('.tab-divider-h');
        order.forEach(tabKey => {
            if (tabMap[tabKey]) tabGroup.insertBefore(tabMap[tabKey], divider);
        });
        setTimeout(updateTabTracker, 100);
    });
}

function initTabDragSort() {
    const tabGroup = document.querySelector('.tab-group.vertical-tabs');
    if (!tabGroup) return;
    const tabs = tabGroup.querySelectorAll('.tab-btn:not(.settings-btn)');
    let dragSrcEl = null;
    tabs.forEach(tab => {
        tab.draggable = true;
        tab.addEventListener('dragstart', (e) => {
            dragSrcEl = tab;
            tab.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tab.dataset.tab);
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
            const allTabs = tabGroup.querySelectorAll('.tab-btn:not(.settings-btn)');
            const srcIdx = Array.from(allTabs).indexOf(dragSrcEl);
            const tgtIdx = Array.from(allTabs).indexOf(tab);
            if (srcIdx < 0 || tgtIdx < 0) return;
            if (srcIdx < tgtIdx) tabGroup.insertBefore(dragSrcEl, tab.nextSibling);
            else tabGroup.insertBefore(dragSrcEl, tab);
            saveTabOrder();
            setTimeout(updateTabTracker, 50);
        });
    });
}

let todoEnterConsumed = false;

newTaskInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        if (todoEnterConsumed) { todoEnterConsumed = false; return; }
        addTaskBtn.click();
    }
});

// 待办历史下拉框：输入时弹出、上下键选择、回车填入
newTaskInput.addEventListener('input', () => {
    todoActiveIndex = -1;
    const todos = getFilteredTodos();
    if (todos.length > 0) renderTodoDropdown(todos);
    else hideTodoDropdown();
});

newTaskInput.addEventListener('focus', () => {
    if (todoHistory.length === 0) return;
    todoActiveIndex = -1;
    const todos = getFilteredTodos();
    if (todos.length > 0) renderTodoDropdown(todos);
});

newTaskInput.addEventListener('blur', () => {
    setTimeout(hideTodoDropdown, 150);
});

newTaskInput.addEventListener('keydown', (e) => {
    if (todoDropdown && todoDropdown.classList.contains('hidden')) return;
    const items = todoDropdown ? todoDropdown.querySelectorAll('.todo-dropdown-item') : [];
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        todoActiveIndex = (todoActiveIndex + 1) % items.length;
        updateTodoActiveItem();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        todoActiveIndex = (todoActiveIndex - 1 + items.length) % items.length;
        updateTodoActiveItem();
    } else if (e.key === 'Enter') {
        if (todoActiveIndex >= 0 && items[todoActiveIndex]) {
            e.preventDefault();
            newTaskInput.value = items[todoActiveIndex].textContent;
            hideTodoDropdown();
            todoEnterConsumed = true;
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        hideTodoDropdown();
    }
});

addTaskBtn.addEventListener("click", () => { const t=newTaskInput.value.trim(); if(t){currentTaskList.push({text:t,done:false});updateTodoHistory(t);newTaskInput.value="";saveTaskData();} });

addFinBtn.addEventListener("click", addFinance);
cancelFinBtn.addEventListener("click", exitFinEditMode);
finAmount.addEventListener("keypress", (e) => { if (e.key === "Enter") { e.preventDefault(); finNote.focus(); } });
let finNoteEnterConsumed = false;

finNote.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        if (finNoteEnterConsumed) { finNoteEnterConsumed = false; return; }
        addFinance();
    }
});

// 备注历史下拉框：输入时弹出、上下键选择、回车填入
finNote.addEventListener('input', () => {
    finNoteActiveIndex = -1;
    const notes = getFilteredNotes();
    if (notes.length > 0) renderFinNoteDropdown(notes);
    else hideFinNoteDropdown();
});

finNote.addEventListener('focus', () => {
    if (finNoteHistory.length === 0) return;
    finNoteActiveIndex = -1;
    const notes = getFilteredNotes();
    if (notes.length > 0) renderFinNoteDropdown(notes);
});

finNote.addEventListener('blur', () => {
    setTimeout(hideFinNoteDropdown, 150);
});

finNote.addEventListener('keydown', (e) => {
    if (finNoteDropdown && finNoteDropdown.classList.contains('hidden')) return;
    const items = finNoteDropdown ? finNoteDropdown.querySelectorAll('.fin-note-dropdown-item') : [];
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        finNoteActiveIndex = (finNoteActiveIndex + 1) % items.length;
        updateFinNoteActiveItem();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        finNoteActiveIndex = (finNoteActiveIndex - 1 + items.length) % items.length;
        updateFinNoteActiveItem();
    } else if (e.key === 'Enter') {
        if (finNoteActiveIndex >= 0 && items[finNoteActiveIndex]) {
            e.preventDefault();
            finNote.value = items[finNoteActiveIndex].textContent;
            hideFinNoteDropdown();
            finNoteEnterConsumed = true;
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        hideFinNoteDropdown();
    }
});

// 连按两次加号/减号/星号快速切换收支类型
let finLastPlusTime = 0;
let finLastMinusTime = 0;
let finLastStarTime = 0;
const FIN_DOUBLE_PRESS_MS = 400;

finAmount.addEventListener('keydown', (e) => {
    if (e.key === '+') {
        const now = Date.now();
        if (now - finLastPlusTime < FIN_DOUBLE_PRESS_MS) {
            e.preventDefault();
            finType.value = 'income';
            finAmount.value = String(finAmount.value).replace(/^[+-]+/, '');
            finLastPlusTime = 0;
            finType.style.borderColor = '#10b981';
            setTimeout(() => finType.style.borderColor = '', 600);
        } else {
            finLastPlusTime = now;
        }
    } else if (e.key === '-') {
        const now = Date.now();
        if (now - finLastMinusTime < FIN_DOUBLE_PRESS_MS) {
            e.preventDefault();
            finType.value = 'expense';
            finAmount.value = String(finAmount.value).replace(/^[+-]+/, '');
            finLastMinusTime = 0;
            finType.style.borderColor = '#ef4444';
            setTimeout(() => finType.style.borderColor = '', 600);
        } else {
            finLastMinusTime = now;
        }
    } else if (e.key === '*') {
        const now = Date.now();
        if (now - finLastStarTime < FIN_DOUBLE_PRESS_MS) {
            e.preventDefault();
            finType.value = 'deposit';
            finAmount.value = String(finAmount.value).replace(/^[+-]+/, '');
            finLastStarTime = 0;
            finType.style.borderColor = '#8b5cf6';
            // 自动填写备注
            if (!finNote.value.trim()) {
                finNote.value = '转入存款账户';
            }
            setTimeout(() => finType.style.borderColor = '', 600);
        } else {
            finLastStarTime = now;
        }
    } else {
        finLastPlusTime = 0;
        finLastMinusTime = 0;
        finLastStarTime = 0;
    }
});


document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePanel(); return; }
    // Ctrl+0 在关联图谱中：缩放居中显示所有节点
    if (e.ctrlKey && (e.key === '0' || e.code === 'Digit0')) {
        if (finLinkGraphMode && finLinkModal && !finLinkModal.classList.contains('hidden')) {
            e.preventDefault();
            fitGraphToView();
            return;
        }
    }
    if (e.altKey && e.key === 'F1') {
        e.preventDefault(); 
        const tabs = Array.from(document.querySelectorAll('.tab-btn'));
        const idx = tabs.findIndex(b => b.classList.contains('active'));
        tabs[(idx+1)%tabs.length].click();
    }
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const tagName = e.target.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea') return;
        
        e.preventDefault();
        if (e.key === 'ArrowLeft') toggleSidebarState();
        if (e.key === 'ArrowRight') toggleRightPanelState();
    }
});

window.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'switch-tab') {
        const targetTab = event.data.target;
        const btn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
        if (btn) btn.click();
        if (targetTab === 'scratchpad') {
            setTimeout(() => {
                const textarea = document.getElementById("scratchpad-area");
                if (textarea) {
                    textarea.focus();
                    const len = textarea.value.length;
                    textarea.setSelectionRange(len, len);
                }
            }, 50);
        }
    }
});

document.getElementById('cleanup-btn')?.addEventListener('click', async () => {
    if(await showConfirmDialog({ message: meowI18n.t('cleanup_confirm'), type: 'danger' })){
        const days = document.getElementById('cleanup-range').value;
        if(days==='all') { chrome.storage.sync.clear(); chrome.storage.local.clear(); }
        alert(meowI18n.t('cleanup_done')); 
        renderApp();
    }
});

// === 财务导出逻辑 ===
if (exportBtn) {
    exportBtn.addEventListener('click', () => {
        const range = exportRange.value;
        exportFinanceData(range);
    });
}

function exportFinanceData(rangeType) {
    const now = new Date();
    let startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    if (rangeType === 'current_month') {
        startDate.setDate(1); 
    } else if (rangeType === 'last_month') {
        startDate.setMonth(startDate.getMonth() - 1);
        startDate.setDate(1);
    } else if (rangeType === 'last_3_months') {
        startDate.setMonth(startDate.getMonth() - 2); 
        startDate.setDate(1);
    }

    let endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    
    if (rangeType === 'last_month') {
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        endDate.setHours(23, 59, 59, 999);
    }

    chrome.storage.sync.get(null, (items) => {
        let csvContent = '\uFEFF日期,类型,金额,备注\n'; 
        let hasData = false;
        
        let totalIncome = 0;
        let totalExpense = 0;

        Object.keys(items).forEach(key => {
            if (key.startsWith('fin_') && !key.startsWith('fin_bal_')) {
                const dateStr = key.replace('fin_', '');
                const parts = dateStr.split('-');
                if (parts.length === 3) {
                    const itemDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                    
                    if (itemDate >= startDate && itemDate <= endDate) {
                        const records = items[key];
                        if (Array.isArray(records)) {
                            records.forEach(r => {
                                const amountVal = parseFloat(r.amount || 0);
                                const typeStr = r.type === 'income' ? '收入' : r.type === 'deposit' ? '存款' : '支出';
                                
                                if (r.type === 'income') totalIncome += amountVal;
                                else if (r.type === 'deposit') { /* 存款不计入收支 */ }
                                else totalExpense += amountVal;

                                let safeNote = (r.note || '').replace(/"/g, '""'); 
                                if (safeNote.includes(',') || safeNote.includes('\n')) {
                                    safeNote = `"${safeNote}"`;
                                }
                                csvContent += `${dateStr},${typeStr},${amountVal.toFixed(2)},${safeNote}\n`;
                                hasData = true;
                            });
                        }
                    }
                }
            }
        });

        if (hasData) {
            const balance = totalIncome - totalExpense;
            csvContent += '\n'; 
            csvContent += `---,---,---,---\n`;
            csvContent += `总收入,,${totalIncome.toFixed(2)},\n`;
            csvContent += `总支出,,${totalExpense.toFixed(2)},\n`;
            csvContent += `结余,,${balance.toFixed(2)},\n`;

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            const filenameDate = now.toISOString().split('T')[0];
            link.setAttribute("download", `Meow_Finance_${rangeType}_${filenameDate}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            alert('No data found for this period.');
        }
    });
}

// === 数据备份与恢复 (JSON) ===
if (backupBtn) {
    backupBtn.addEventListener('click', async () => {
        try {
            const syncData = await new Promise(r => chrome.storage.sync.get(null, r));
            const localData = await new Promise(r => chrome.storage.local.get(null, r));
            
            const backupPayload = {
                version: '2.7',
                timestamp: Date.now(),
                sync: syncData,
                local: localData
            };
            
            const jsonStr = JSON.stringify(backupPayload, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = `Meow_Backup_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showStatus(backupStatus, 'Success', 'success');
        } catch (e) {
            console.error(e);
            showStatus(backupStatus, 'Error: ' + e.message, 'error');
        }
    });
}

if (restoreInput) {
    restoreInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!(await showConfirmDialog({ message: 'This will overwrite all current data. Continue?', type: 'danger' }))) {
            restoreInput.value = ''; 
            return;
        }
        
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const payload = JSON.parse(event.target.result);
                
                if (!payload.sync && !payload.local) {
                    throw new Error('Invalid backup file');
                }
                
                await new Promise(r => chrome.storage.sync.clear(r));
                await new Promise(r => chrome.storage.local.clear(r));
                
                if (payload.sync && Object.keys(payload.sync).length > 0) {
                    await new Promise(r => chrome.storage.sync.set(payload.sync, r));
                }
                
                if (payload.local && Object.keys(payload.local).length > 0) {
                    await new Promise(r => chrome.storage.local.set(payload.local, r));
                }
                
                showStatus(backupStatus, 'Restored! Refreshing...', 'success');
                setTimeout(() => {
                    renderApp(); 
                    restoreInput.value = '';
                }, 1500);
                
            } catch (err) {
                console.error(err);
                showStatus(backupStatus, 'Error: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    });
}

function showStatus(element, msg, type) {
    element.textContent = msg;

    element.style.color = type === 'success' ? '#10b981' : '#ef4444';
    setTimeout(() => {
        element.textContent = '';
    }, 4000);
}

