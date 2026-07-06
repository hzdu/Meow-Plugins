// popup-2fa.js - 2FA验证模块
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 2FA 验证模块 ===
async function fetch2FACode(secret) {
    try {
        const response = await fetch(`https://api.zhi.to/2fa/app/2fa.php?key=${encodeURIComponent(secret)}`);
        const res = await response.json();
        if (res.code) return res.code;
        return null;
    } catch (error) {
        console.error('2FA fetch error:', error);
        return null;
    }
}

function save2FA() {
    chrome.storage.local.set({ 'meow_2fa_accounts': my2faAccounts });
}

function render2FA() {
    Object.keys(faRefreshIntervals).forEach(id => {
        clearInterval(faRefreshIntervals[id]);
        clearTimeout(faRefreshIntervals[id + '_timeout']);
    });
    faRefreshIntervals = {};

    faList.innerHTML = '';

    if (my2faAccounts.length === 0) {
        faEmpty.classList.remove('hidden');
        return;
    }
    faEmpty.classList.add('hidden');

    my2faAccounts.forEach((account, index) => {
        const card = document.createElement('div');
        card.className = 'fa-card';
        card.dataset.id = account.id;

        const safeKey = escapeHtml(account.key);
        const safeName = escapeHtml(account.name);

        card.innerHTML = `
            <div class="fa-card-header">
                <span class="fa-card-name">${safeName}</span>
                <div class="fa-card-actions">
                    <span class="material-icons fa-refresh-btn" data-id="${account.id}">refresh</span>
                    <span class="material-icons fa-edit-btn" data-id="${account.id}">edit</span>
                    <span class="material-icons fa-del-btn" data-id="${account.id}">close</span>
                </div>
            </div>
            
            <div class="fa-code-row" data-id="${account.id}">
                <div class="fa-timer">
                    <svg class="fa-timer-svg" viewBox="0 0 28 28">
                        <circle class="fa-timer-bg" cx="14" cy="14" r="11"/>
                        <circle class="fa-timer-progress" id="timer-progress-${account.id}" cx="14" cy="14" r="11" stroke-dasharray="69.115" stroke-dashoffset="0"/>
                    </svg>
                </div>
                <span class="fa-code-value refreshing" id="fa-code-${account.id}">${meowI18n.t('2fa_code_refreshing')}</span>
                <span class="fa-copy-hint"><span class="material-icons" style="font-size:12px">content_copy</span> ${meowI18n.t('action_copy') || '复制'}</span>
            </div>
        `;

        card.querySelector('.fa-code-row').addEventListener('click', function(e) {
            if (e.target.closest('.fa-refresh-btn')) return;
            const codeEl = this.querySelector('.fa-code-value');
            if (codeEl && !codeEl.classList.contains('refreshing') && !codeEl.classList.contains('error')) {
                if (codeEl.classList.contains('fetch-prompt')) {
                    fetchSingle2FACode(account);
                } else {
                    copyToClipboard(codeEl.textContent);
                }
            }
        });

        card.querySelector('.fa-refresh-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            this.classList.add('spin');
            setTimeout(() => this.classList.remove('spin'), 600);
            fetchSingle2FACode(account);
        });

        card.querySelector('.fa-edit-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            open2FAModal(account);
        });

        card.querySelector('.fa-del-btn').addEventListener('click', async function(e) {
            e.stopPropagation();
            if (await showConfirmDialog({ message: meowI18n.t('2fa_msg_confirm_delete'), type: 'danger' })) {
                my2faAccounts = my2faAccounts.filter(a => a.id !== account.id);
                if (faRefreshIntervals[account.id]) {
                    clearInterval(faRefreshIntervals[account.id]);
                    clearTimeout(faRefreshIntervals[account.id + '_timeout']);
                    delete faRefreshIntervals[account.id];
                    delete faRefreshIntervals[account.id + '_timeout'];
                }
                save2FA();
                render2FA();
                showToast(meowI18n.t('2fa_msg_deleted'));
            }
        });

        // 拖放排序
        card.draggable = true;
        card.dataset.index = index;
        card.addEventListener('dragstart', function(e) {
            this.classList.add('dragging');
            faDragSrcIndex = index;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
        });
        card.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            document.querySelectorAll('#fa-list .fa-card').forEach(el => el.classList.remove('drag-over'));
            faDragSrcIndex = null;
        });
        card.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.classList.add('drag-over');
        });
        card.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
        });
        card.addEventListener('drop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            this.classList.remove('drag-over');
            const destIndex = index;
            if (faDragSrcIndex !== null && faDragSrcIndex !== destIndex) {
                const item = my2faAccounts.splice(faDragSrcIndex, 1)[0];
                my2faAccounts.splice(destIndex, 0, item);
                save2FA();
                render2FA();
            }
            faDragSrcIndex = null;
        });

        faList.appendChild(card);

        start2FATimer(account, faAutoFetch);
    });
}

function start2FATimer(account, autoFetch) {
    if (faRefreshIntervals[account.id]) {
        clearInterval(faRefreshIntervals[account.id]);
        clearTimeout(faRefreshIntervals[account.id + '_timeout']);
    }

    if (autoFetch) {
        fetchSingle2FACode(account);

        faRefreshIntervals[account.id] = setInterval(() => {
            fetchSingle2FACode(account);
        }, 30000);

        let elapsed = 0;
        faRefreshIntervals[account.id + '_timeout'] = setInterval(() => {
            elapsed = (elapsed + 1) % 30;
            updateTimerProgress(account.id, elapsed);
        }, 1000);
    } else {
        const codeEl = document.getElementById(`fa-code-${account.id}`);
        if (codeEl) {
            codeEl.textContent = meowI18n.t('2fa_click_to_fetch');
            codeEl.className = 'fa-code-value fetch-prompt';
        }
        const timerEl = document.querySelector(`.fa-card[data-id="${account.id}"] .fa-timer`);
        if (timerEl) {
            timerEl.style.display = 'none';
        }
    }
}

function updateTimerProgress(id, elapsed) {
    const progressEl = document.getElementById(`timer-progress-${id}`);
    if (!progressEl) return;
    const totalLength = 69.115;
    const remaining = (30 - elapsed) / 30;
    const offset = totalLength * (1 - remaining);
    progressEl.style.strokeDashoffset = offset;

    progressEl.classList.remove('warning', 'danger');
    if (remaining < 0.2) {
        progressEl.classList.add('danger');
    } else if (remaining < 0.5) {
        progressEl.classList.add('warning');
    }
}

async function fetchSingle2FACode(account) {
    const codeEl = document.getElementById(`fa-code-${account.id}`);
    if (!codeEl) return;

    codeEl.textContent = meowI18n.t('2fa_code_refreshing');
    codeEl.className = 'fa-code-value refreshing';

    const code = await fetch2FACode(account.key);
    if (code) {
        codeEl.textContent = code;
        codeEl.className = 'fa-code-value';

        // 显示倒计时圆环
        const timerEl = document.querySelector(`.fa-card[data-id="${account.id}"] .fa-timer`);
        if (timerEl) timerEl.style.display = '';

        // 获取验证码成功后启动倒计时动画（如果尚未启动）
        if (!faRefreshIntervals[account.id + '_timeout']) {
            let elapsed = 0;
            faRefreshIntervals[account.id + '_timeout'] = setInterval(() => {
                elapsed = (elapsed + 1) % 30;
                updateTimerProgress(account.id, elapsed);
            }, 1000);
        }
    } else {
        codeEl.textContent = meowI18n.t('2fa_code_failed');
        codeEl.className = 'fa-code-value error';
    }
}

function open2FAModal(account) {
    if (account) {
        editing2faId = account.id;
        faModalTitle.textContent = meowI18n.t('2fa_btn_edit_key');
        faNameInput.value = account.name;
        faKeyInput.value = account.key;
        faDeleteBtn.classList.remove('hidden');
    } else {
        editing2faId = null;
        faModalTitle.textContent = meowI18n.t('2fa_btn_add_key');
        faNameInput.value = '';
        faKeyInput.value = '';
        faDeleteBtn.classList.add('hidden');
    }
    faModal.classList.remove('hidden');
    faModal.classList.add('visible');
    setTimeout(() => faNameInput.focus(), 100);
}

function close2FAModal() {
    faModal.classList.add('hidden');
    faModal.classList.remove('visible');
    editing2faId = null;
}

function import2FABackup() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.txt,.otpauth,.txt,text/plain';
    fileInput.style.display = 'none';

    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const content = e.target.result;
            const lines = content.split(/\r?\n/).filter(line => line.trim());
            let imported = 0;
            let skipped = 0;

            lines.forEach(line => {
                line = line.trim();
                if (!line.startsWith('otpauth://totp/')) {
                    skipped++;
                    return;
                }

                try {
                    const withoutPrefix = line.slice('otpauth://totp/'.length);
                    const qIndex = withoutPrefix.indexOf('?');
                    if (qIndex === -1) return;

                    const labelPart = withoutPrefix.substring(0, qIndex);
                    const queryStr = withoutPrefix.substring(qIndex + 1);
                    const params = new URLSearchParams(queryStr);
                    const secret = params.get('secret');
                    const issuer = params.get('issuer');

                    if (!secret) {
                        skipped++;
                        return;
                    }

                    let name = issuer ? decodeURIComponent(issuer).trim() : '';
                    if (!name) {
                        const colonIdx = labelPart.indexOf(':');
                        name = colonIdx > 0 ? labelPart.substring(0, colonIdx) : labelPart;
                        name = decodeURIComponent(name).trim();
                    }

                    const exists = my2faAccounts.some(a => a.key === secret);
                    if (exists) {
                        skipped++;
                        return;
                    }

                    my2faAccounts.push({
                        id: Date.now() + imported,
                        name: name || 'Imported',
                        key: secret.toUpperCase()
                    });
                    imported++;
                } catch (err) {
                    skipped++;
                }
            });

            if (imported > 0) {
                save2FA();
                render2FA();
                showToast(`成功导入 ${imported} 个密钥` + (skipped > 0 ? `，跳过 ${skipped} 个` : ''));
            } else {
                showToast('未导入任何密钥' + (skipped > 0 ? `（跳过 ${skipped} 个）` : ''));
            }

            fileInput.value = '';
        };
        reader.readAsText(file);
    });

    document.body.appendChild(fileInput);
    fileInput.click();
    setTimeout(() => fileInput.remove(), 1000);
}

function export2FABackup() {
    if (!my2faAccounts || my2faAccounts.length === 0) {
        showToast('没有可导出的密钥');
        return;
    }

    const lines = my2faAccounts.map(acc => {
        const encodedName = encodeURIComponent(acc.name);
        return `otpauth://totp/${encodedName}?secret=${acc.key}&issuer=${acc.name}`;
    });

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `2fa-backup-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`已导出 ${lines.length} 个密钥`);
}

