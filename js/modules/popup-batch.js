// popup-batch.js - 批量定时功能
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 批量定时功能 ===
let myBatchTimers = [];
let editingBatchId = null;
let myBatchLogs = [];

function saveBatchTimers() {
    chrome.storage.local.set({ 'meow_batch_timers': myBatchTimers });
}

async function loadBatchTimers() {
    const data = await chrome.storage.local.get(['meow_batch_timers']);
    myBatchTimers = Array.isArray(data.meow_batch_timers) ? data.meow_batch_timers : [];
}

// === 批量定时运行日志 ===
function saveBatchLogs() {
    chrome.storage.local.set({ 'meow_batch_logs': myBatchLogs });
}

async function loadBatchLogs() {
    const data = await chrome.storage.local.get(['meow_batch_logs']);
    myBatchLogs = Array.isArray(data.meow_batch_logs) ? data.meow_batch_logs : [];
}

function addBatchLog(taskName, urlCount, success) {
    myBatchLogs.unshift({
        id: Date.now(),
        name: taskName || '未命名任务',
        urlCount: urlCount || 0,
        success: success !== false,
        time: new Date().toLocaleString('zh-CN', { hour12: false })
    });
    // 最多保留 100 条
    if (myBatchLogs.length > 100) {
        myBatchLogs = myBatchLogs.slice(0, 100);
    }
    saveBatchLogs();
    renderBatchLogs();
}

function deleteBatchLog(logId) {
    myBatchLogs = myBatchLogs.filter(log => log.id !== logId);
    saveBatchLogs();
    renderBatchLogs();
}

async function clearBatchLogs() {
    if (myBatchLogs.length === 0) return;
    if (!(await showConfirmDialog({ message: '确定清空所有运行日志？', type: 'danger' }))) return;
    myBatchLogs = [];
    saveBatchLogs();
    renderBatchLogs();
}

function renderBatchLogs() {
    if (!batchLogList || !batchLogEmpty || !batchLogClearBtn) return;
    batchLogList.innerHTML = '';

    if (myBatchLogs.length === 0) {
        batchLogEmpty.classList.remove('hidden');
        batchLogClearBtn.style.display = 'none';
        return;
    }
    batchLogEmpty.classList.add('hidden');
    batchLogClearBtn.style.display = '';

    myBatchLogs.forEach(log => {
        const div = document.createElement('div');
        div.className = 'batch-log-item';

        const statusIcon = log.success ? 'check_circle' : 'error';
        const statusClass = log.success ? 'success' : 'fail';
        const statusText = log.success ? '成功' : '失败';

        div.innerHTML = `
            <div class="batch-log-info">
                <span class="batch-log-status ${statusClass} material-icons">${statusIcon}</span>
                <span class="batch-log-name" title="${escapeHtml(log.name)}">${escapeHtml(log.name)}</span>
                <span style="color: #9ca3af; font-size: 10px;">(${log.urlCount} 个)</span>
                <span class="batch-log-time">${escapeHtml(log.time)}</span>
            </div>
            <span class="material-icons batch-log-del-btn" title="删除此条日志">close</span>
        `;

        const delBtn = div.querySelector('.batch-log-del-btn');
        delBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            deleteBatchLog(log.id);
        });

        batchLogList.appendChild(div);
    });
}

// 立即执行批量定时任务（从背景页打开标签页）
function executeBatchTimerNow(item) {
    if (!item || !Array.isArray(item.urls) || item.urls.length === 0) {
        showToast('没有可打开的网址');
        return;
    }
    if (!item.enabled) {
        showToast('该任务已禁用');
        return;
    }
    const validUrls = item.urls
        .filter(u => u && u.trim().length > 0)
        .map(u => {
            let url = u.trim();
            if (!/^https?:\/\//i.test(url)) {
                url = 'https://' + url;
            }
            return url;
        });
    if (validUrls.length === 0) {
        showToast('没有有效的网址');
        return;
    }
    // 通过 background 打开标签页（popup 可能马上关闭）
    chrome.runtime.sendMessage({
        type: 'execute_batch_timer',
        urls: validUrls,
        name: item.name || '批量定时',
        autoClose: item.autoClose !== false
    });
    showToast(`正在打开 ${validUrls.length} 个标签页...`);
    // 记录运行日志
    addBatchLog(item.name || '批量定时', validUrls.length, true);
}

function updateBatchAlarm(item) {
    const alarmName = `batch_timer_${item.id}`;
    chrome.alarms.clear(alarmName);
    if (!item.enabled) return;
    if (item.date) {
        const [year, month, day] = item.date.split('-').map(Number);
        const [hours, minutes] = (item.time || '00:00').split(':').map(Number);
        const fireTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
        if (fireTime > new Date()) {
            chrome.alarms.create(alarmName, { when: fireTime.getTime() });
        }
    } else if (item.time) {
        const now = new Date();
        const [hours, minutes] = item.time.split(':').map(Number);
        const nextFire = new Date();
        nextFire.setHours(hours, minutes, 0, 0);
        if (nextFire <= now) {
            nextFire.setDate(nextFire.getDate() + 1);
        }
        chrome.alarms.create(alarmName, { when: nextFire.getTime(), periodInMinutes: 1440 });
    }
}

function renderBatchTimers() {
    if (!batchTimerList || !batchEmpty) return;
    batchTimerList.innerHTML = '';

    if (myBatchTimers.length === 0) {
        batchEmpty.classList.remove('hidden');
        return;
    }
    batchEmpty.classList.add('hidden');

    myBatchTimers.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = `batch-timer-item${item.enabled ? '' : ' disabled'}`;

        const urls = Array.isArray(item.urls) ? item.urls : [];
        const urlsHtml = urls.slice(0, 3).map(u =>
            `<span class="url-line"><span class="url-dot"></span>${escapeHtml(u)}</span>`
        ).join('');
        const urlOverflow = urls.length > 3 ? `<span class="url-line" style="color: #f59e0b;">…还有 ${urls.length - 3} 个</span>` : '';

        const dateDisplay = item.date ? `<span class="batch-timer-date">${escapeHtml(item.date)}</span>` : '';
        div.innerHTML = `
            <div class="batch-timer-header">
                <div class="batch-timer-name">
                    <span class="material-icons" style="font-size: 14px; color: #f59e0b;">schedule</span>
                    ${escapeHtml(item.name || '未命名任务')}
                    ${dateDisplay}
                    <span class="batch-timer-time">${escapeHtml(item.time || '--:--')}</span>
                </div>
                <div class="batch-timer-actions">
                    <label class="batch-item-toggle" title="${item.enabled ? '已启用' : '已禁用'}">
                        <input type="checkbox" ${item.enabled ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                    <span class="material-icons batch-run-btn" title="立即执行" style="color:#10b981;">play_arrow</span>
                    <span class="material-icons batch-edit-btn" data-id="${item.id}">edit</span>
                    <span class="material-icons batch-del-btn" data-id="${item.id}">delete</span>
                </div>
            </div>
            <div class="batch-timer-urls">${urlsHtml}${urlOverflow}</div>
        `;

        // 启用/禁用切换
        const toggle = div.querySelector('input[type="checkbox"]');
        toggle.addEventListener('change', function() {
            myBatchTimers[index].enabled = this.checked;
            updateBatchAlarm(myBatchTimers[index]);
            saveBatchTimers();
            renderBatchTimers();
        });

        // 立即执行
        const runBtn = div.querySelector('.batch-run-btn');
        if (runBtn) {
            runBtn.addEventListener('click', function() {
                executeBatchTimerNow(item);
            });
        }

        // 编辑
        div.querySelector('.batch-edit-btn').addEventListener('click', function() {
            openBatchModal(item);
        });

        // 删除
        div.querySelector('.batch-del-btn').addEventListener('click', async function() {
            if (await showConfirmDialog({ message: '确定删除此批量定时任务？', type: 'danger' })) {
                chrome.alarms.clear(`batch_timer_${item.id}`);
                myBatchTimers = myBatchTimers.filter(t => t.id !== item.id);
                saveBatchTimers();
                renderBatchTimers();
                showToast('已删除');
            }
        });

        batchTimerList.appendChild(div);
    });
}

function openBatchModal(item) {
    editingBatchId = null;
    batchNameInput.value = '';
    batchDateInput.value = '';
    batchTimeInput.value = '';
    batchUrlsInput.value = '';
    batchEnabledInput.checked = true;
    batchAutoCloseInput.checked = true;
    batchDeleteBtn.classList.add('hidden');

    if (item) {
        editingBatchId = item.id;
        batchModalTitle.textContent = '编辑定时任务';
        batchNameInput.value = item.name || '';
        batchDateInput.value = item.date || '';
        batchTimeInput.value = item.time || '';
        batchUrlsInput.value = (Array.isArray(item.urls) ? item.urls : []).join('\n');
        batchEnabledInput.checked = item.enabled !== false;
        batchAutoCloseInput.checked = item.autoClose !== false;
        batchDeleteBtn.classList.remove('hidden');
    } else {
        batchModalTitle.textContent = '添加定时任务';
    }

    batchModal.classList.remove('hidden');
    batchModal.classList.add('visible');
    setTimeout(() => batchNameInput.focus(), 100);
}

function closeBatchModal() {
    batchModal.classList.add('hidden');
    batchModal.classList.remove('visible');
}

// AI Provider 初始化
(async function initAIProviders() {
    try {
        const localData = await chrome.storage.local.get(['meow_ai_providers']);
        myAiProviders = localData.meow_ai_providers || [];
    } catch (e) {
        console.error('AI Provider load error:', e);
        myAiProviders = [];
    }
    try {
        renderAIProviders();
    } catch (e) {
        console.error('AI Provider render error:', e);
    }

    if (aiAddBtn) {
        aiAddBtn.addEventListener('click', function() { openAIModal(null); });
    }
    if (aiExportBtn) {
        aiExportBtn.addEventListener('click', exportAIProviders);
    }
    if (aiImportBtn) {
        aiImportBtn.addEventListener('click', importAIProviders);
    }
    if (closeAiModal) {
        closeAiModal.addEventListener('click', closeAIModal);
    }
    if (closeAiNoteViewer) {
        closeAiNoteViewer.addEventListener('click', function() {
            aiNoteViewer.classList.add('hidden');
            aiNoteViewer.classList.remove('visible');
        });
    }
    if (aiNoteViewer) {
        aiNoteViewer.addEventListener('click', function(e) {
            if (e.target === aiNoteViewer) {
                aiNoteViewer.classList.add('hidden');
                aiNoteViewer.classList.remove('visible');
            }
        });
    }
    if (aiModal) {
        aiModal.addEventListener('click', function(e) {
            if (e.target === aiModal) closeAIModal();
        });
    }
    if (aiSaveBtn) {
        aiSaveBtn.addEventListener('click', function() {
            const title = aiTitleInput.value.trim();
            const apiType = aiTypeInput.value;
            const officialUrl = aiOfficialInput.value.trim();
            const rawUrls = aiUrlInput.value.trim();
            const baseUrls = rawUrls.split('\n').map(s => s.trim()).filter(Boolean);
            const key = aiKeyInput.value.trim();
            const rawModels = aiModelInput.value.trim();
            const models = rawModels.split('\n').map(s => s.trim()).filter(Boolean);
            const note = aiNoteInput.value.trim();

            if (baseUrls.length === 0) {
                showToast(meowI18n.t('ai_msg_empty_url') || 'Base URL 不能为空');
                aiUrlInput.focus();
                return;
            }
            if (!key) {
                showToast(meowI18n.t('ai_msg_empty_key') || 'API Key 不能为空');
                aiKeyInput.focus();
                return;
            }
            if (models.length === 0) {
                showToast(meowI18n.t('ai_msg_empty_model') || 'Model 不能为空');
                aiModelInput.focus();
                return;
            }

            if (editingAiId) {
                const index = myAiProviders.findIndex(p => p.id === editingAiId);
                if (index !== -1) {
                    myAiProviders[index].title = title;
                    myAiProviders[index].apiType = apiType;
                    myAiProviders[index].officialUrl = officialUrl;
                    myAiProviders[index].baseUrls = baseUrls;
                    myAiProviders[index].key = key;
                    myAiProviders[index].models = models;
                    myAiProviders[index].note = note;
                    showToast(meowI18n.t('ai_msg_updated') || '已更新');
                }
            } else {
                myAiProviders.push({ id: Date.now(), title: title, apiType: apiType, officialUrl: officialUrl, baseUrls: baseUrls, key: key, models: models, note: note });
                showToast(meowI18n.t('ai_msg_added') || '已添加');
            }

            saveAIProviders();
            renderAIProviders();
            closeAIModal();
        });
    }
    if (aiDeleteBtn) {
        aiDeleteBtn.addEventListener('click', async function() {
            if (!editingAiId) return;
            if (await showConfirmDialog({ message: meowI18n.t('ai_msg_confirm_delete') || '确定删除此 AI Provider？', type: 'danger' })) {
                myAiProviders = myAiProviders.filter(p => p.id !== editingAiId);
                saveAIProviders();
                renderAIProviders();
                closeAIModal();
                showToast(meowI18n.t('ai_msg_deleted') || '已删除');
            }
        });
    }

    // 过滤输入事件
    if (aiFilterInput) {
        aiFilterInput.addEventListener('input', function() {
            if (aiFilterClear) {
                aiFilterClear.style.display = this.value ? '' : 'none';
            }
            renderAIProviders();
        });
    }
    if (aiFilterClear) {
        aiFilterClear.addEventListener('click', function() {
            if (aiFilterInput) {
                aiFilterInput.value = '';
                aiFilterInput.focus();
                aiFilterClear.style.display = 'none';
                renderAIProviders();
            }
        });
    }

    chrome.storage.onChanged.addListener(function(changes, area) {
        if (area === 'local' && changes.meow_ai_providers) {
            myAiProviders = changes.meow_ai_providers.newValue || [];
            const view = document.getElementById('view-ai-provider');
            if (view && !view.classList.contains('hidden')) renderAIProviders();
        }
    });
})();

// AI Setting 初始化
(async function initAISetting() {
    await loadAISetting();

    if (aiSettingSaveBtn) {
        aiSettingSaveBtn.addEventListener('click', function() {
            myAiSetting.baseUrl = aiSettingBaseUrl ? aiSettingBaseUrl.value.trim() : '';
            myAiSetting.modelId = aiSettingModelId ? aiSettingModelId.value.trim() : '';
            myAiSetting.apiKey = aiSettingApiKey ? aiSettingApiKey.value.trim() : '';
            myAiSetting.autoProtocol = aiSettingAutoProtocol ? aiSettingAutoProtocol.checked : true;
            // 自动补充协议地址
            if (myAiSetting.autoProtocol && !myAiSetting.baseUrl) {
                myAiSetting.baseUrl = 'https://api.openai.com';
                if (aiSettingBaseUrl) aiSettingBaseUrl.value = myAiSetting.baseUrl;
            }
            saveAISetting();
            showAISettingStatus('AI Setting 已保存');
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

    // 监听外部 storage 变化同步 AI Setting
    chrome.storage.onChanged.addListener(function(changes, area) {
        if (area === 'local' && changes.meow_ai_setting) {
            myAiSetting = changes.meow_ai_setting.newValue || { baseUrl: '', modelId: '', apiKey: '', autoProtocol: true };
            if (aiSettingBaseUrl) aiSettingBaseUrl.value = myAiSetting.baseUrl || '';
            if (aiSettingModelId) aiSettingModelId.value = myAiSetting.modelId || '';
            if (aiSettingApiKey) aiSettingApiKey.value = myAiSetting.apiKey || '';
            if (aiSettingAutoProtocol) aiSettingAutoProtocol.checked = myAiSetting.autoProtocol !== false;
        }
    });
})();

// 批量定时初始化
(async function initBatchTimers() {
    try {
        await loadBatchTimers();
    } catch (e) {
        console.error('Batch timer load error:', e);
        myBatchTimers = [];
    }
    try {
        renderBatchTimers();
    } catch (e) {
        console.error('Batch timer render error:', e);
    }

    // 加载并渲染运行日志
    try {
        await loadBatchLogs();
    } catch (e) {
        console.error('Batch log load error:', e);
        myBatchLogs = [];
    }
    try {
        renderBatchLogs();
    } catch (e) {
        console.error('Batch log render error:', e);
    }

    // 为所有已启用的任务注册闹钟
    myBatchTimers.forEach(item => updateBatchAlarm(item));

    if (batchAddBtn) {
        batchAddBtn.addEventListener('click', function() { openBatchModal(null); });
    }
    if (batchCloseBtn) {
        batchCloseBtn.addEventListener('click', closeBatchModal);
    }
    if (batchModal) {
        batchModal.addEventListener('click', function(e) {
            if (e.target === batchModal) closeBatchModal();
        });
    }
    if (batchLogClearBtn) {
        batchLogClearBtn.addEventListener('click', clearBatchLogs);
    }
    if (batchSaveBtn) {
        batchSaveBtn.addEventListener('click', function() {
            const name = batchNameInput.value.trim();
            const dateVal = (batchDateInput || {}).value || '';
            const time = batchTimeInput.value;
            const rawUrls = batchUrlsInput.value.trim();
            const urls = rawUrls.split('\n').map(s => s.trim()).filter(Boolean);
            const enabled = batchEnabledInput.checked;

            if (!time) {
                showToast('请选择执行时间');
                batchTimeInput.focus();
                return;
            }
            if (urls.length === 0) {
                showToast('请填写要打开的网址');
                batchUrlsInput.focus();
                return;
            }

            if (dateVal) {
                const [y, m, d] = dateVal.split('-').map(Number);
                const [h, min] = time.split(':').map(Number);
                const scheduledDate = new Date(y, m - 1, d, h, min, 0, 0);
                if (scheduledDate <= new Date()) {
                    showToast('指定的日期时间已过，请调整');
                    return;
                }
            }

            const autoClose = batchAutoCloseInput.checked;

            if (editingBatchId) {
                const index = myBatchTimers.findIndex(t => t.id === editingBatchId);
                if (index !== -1) {
                    chrome.alarms.clear(`batch_timer_${myBatchTimers[index].id}`);
                    myBatchTimers[index].name = name;
                    myBatchTimers[index].date = dateVal;
                    myBatchTimers[index].time = time;
                    myBatchTimers[index].urls = urls;
                    myBatchTimers[index].enabled = enabled;
                    myBatchTimers[index].autoClose = autoClose;
                    updateBatchAlarm(myBatchTimers[index]);
                    saveBatchTimers();
                    renderBatchTimers();
                    closeBatchModal();
                    showToast('已更新');
                }
            } else {
                const newItem = { id: Date.now(), name: name, date: dateVal, time: time, urls: urls, enabled: enabled, autoClose: autoClose };
                myBatchTimers.push(newItem);
                updateBatchAlarm(newItem);
                saveBatchTimers();
                renderBatchTimers();
                closeBatchModal();
                showToast('已添加');
            }
        });
    }
    if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', async function() {
            if (!editingBatchId) return;
            if (await showConfirmDialog({ message: '确定删除此批量定时任务？', type: 'danger' })) {
                chrome.alarms.clear(`batch_timer_${editingBatchId}`);
                myBatchTimers = myBatchTimers.filter(t => t.id !== editingBatchId);
                saveBatchTimers();
                renderBatchTimers();
                closeBatchModal();
                showToast('已删除');
            }
        });
    }
})();

// 2FA 初始化
(async function init2FA() {
    const localData = await chrome.storage.local.get(['meow_2fa_accounts', 'meow_2fa_auto_fetch']);
    my2faAccounts = localData.meow_2fa_accounts || [];
    faAutoFetch = localData.meow_2fa_auto_fetch || false;

    const autoFetchToggle = document.getElementById('settings-2fa-auto-fetch');
    if (autoFetchToggle) {
        autoFetchToggle.checked = faAutoFetch;
        autoFetchToggle.addEventListener('change', function() {
            faAutoFetch = this.checked;
            chrome.storage.local.set({ 'meow_2fa_auto_fetch': faAutoFetch });
            const view2fa = document.getElementById('view-2fa');
            if (view2fa && !view2fa.classList.contains('hidden')) render2FA();
        });
    }

    // 实时汇率自动刷新开关
    const exchangeAutoRefreshToggle = document.getElementById('settings-exchange-auto-refresh');
    if (exchangeAutoRefreshToggle) {
        chrome.storage.local.get(['meow_exchange_auto_refresh'], (result) => {
            exchangeAutoRefreshToggle.checked = !!result.meow_exchange_auto_refresh;
        });
        exchangeAutoRefreshToggle.addEventListener('change', function() {
            chrome.storage.local.set({ 'meow_exchange_auto_refresh': this.checked });
        });
    }

    if (faAddBtn) {
        faAddBtn.addEventListener('click', function() { open2FAModal(null); });
    }
    if (faImportBtn) {
        faImportBtn.addEventListener('click', import2FABackup);
    }
    if (faExportBtn) {
        faExportBtn.addEventListener('click', export2FABackup);
    }
    if (closeFaModal) {
        closeFaModal.addEventListener('click', close2FAModal);
    }
    if (faModal) {
        faModal.addEventListener('click', function(e) {
            if (e.target === faModal) close2FAModal();
        });
    }
    if (faSaveBtn) {
        faSaveBtn.addEventListener('click', function() {
            const name = faNameInput.value.trim();
            const key = faKeyInput.value.trim().replace(/\s+/g, '').toUpperCase();

            if (!name) {
                showToast(meowI18n.t('2fa_msg_empty_name'));
                faNameInput.focus();
                return;
            }
            if (!key) {
                showToast(meowI18n.t('2fa_msg_empty_key'));
                faKeyInput.focus();
                return;
            }

            if (editing2faId) {
                const index = my2faAccounts.findIndex(a => a.id === editing2faId);
                if (index !== -1) {
                    if (my2faAccounts[index].key !== key) {
                        if (faRefreshIntervals[editing2faId]) {
                            clearInterval(faRefreshIntervals[editing2faId]);
                            clearTimeout(faRefreshIntervals[editing2faId + '_timeout']);
                            delete faRefreshIntervals[editing2faId];
                            delete faRefreshIntervals[editing2faId + '_timeout'];
                        }
                    }
                    my2faAccounts[index].name = name;
                    my2faAccounts[index].key = key;
                    showToast(meowI18n.t('2fa_msg_updated'));
                }
            } else {
                my2faAccounts.push({ id: Date.now(), name: name, key: key });
                showToast(meowI18n.t('2fa_msg_added'));
            }

            save2FA();
            render2FA();
            close2FAModal();
        });
    }
    if (faDeleteBtn) {
        faDeleteBtn.addEventListener('click', async function() {
            if (!editing2faId) return;
            if (await showConfirmDialog({ message: meowI18n.t('2fa_msg_confirm_delete'), type: 'danger' })) {
                my2faAccounts = my2faAccounts.filter(a => a.id !== editing2faId);
                if (faRefreshIntervals[editing2faId]) {
                    clearInterval(faRefreshIntervals[editing2faId]);
                    clearTimeout(faRefreshIntervals[editing2faId + '_timeout']);
                    delete faRefreshIntervals[editing2faId];
                    delete faRefreshIntervals[editing2faId + '_timeout'];
                }
                save2FA();
                render2FA();
                close2FAModal();
                showToast(meowI18n.t('2fa_msg_deleted'));
            }
        });
    }
    if (faKeyInput) {
        faKeyInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                faSaveBtn.click();
            }
        });
    }

    chrome.storage.onChanged.addListener(function(changes, area) {
        if (area === 'local' && changes.meow_2fa_accounts) {
            my2faAccounts = changes.meow_2fa_accounts.newValue || [];
            const view2fa = document.getElementById('view-2fa');
            if (view2fa && !view2fa.classList.contains('hidden')) render2FA();
        }
    });
})();

