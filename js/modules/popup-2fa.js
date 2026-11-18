// popup-2fa.js - 2FA验证模块
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 2FA 验证模块 ===
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const FA_STEP_SECONDS = 30;
const FA_CODE_DIGITS = 6;

function base32Decode(input) {
    const clean = String(input || '').toUpperCase().replace(/[\s-=]/g, '');
    if (!clean) return null;

    const bytes = [];
    let bits = 0;
    let value = 0;
    for (const ch of clean) {
        const idx = BASE32_ALPHABET.indexOf(ch);
        if (idx === -1) return null;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return bytes.length ? new Uint8Array(bytes) : null;
}

// RFC 6238 TOTP：密钥不出设备，纯本地 HMAC-SHA1 计算
async function computeLocalTOTP(secret) {
    const keyBytes = base32Decode(secret);
    if (!keyBytes) return null;

    const counter = Math.floor(Date.now() / 1000 / FA_STEP_SECONDS);
    const counterBuf = new ArrayBuffer(8);
    const counterView = new DataView(counterBuf);
    // 计数器超过 32 位，JS 位运算会截断，高低位要分开写
    counterView.setUint32(0, Math.floor(counter / 0x100000000));
    counterView.setUint32(4, counter >>> 0);

    const hmacKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const hash = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, counterBuf));

    const offset = hash[hash.length - 1] & 0x0f;
    const binCode = ((hash[offset] & 0x7f) << 24)
        | ((hash[offset + 1] & 0xff) << 16)
        | ((hash[offset + 2] & 0xff) << 8)
        | (hash[offset + 3] & 0xff);
    return String(binCode % Math.pow(10, FA_CODE_DIGITS)).padStart(FA_CODE_DIGITS, '0');
}

async function fetch2FACode(secret) {
    if (faComputeMode === 'local') {
        try {
            return await computeLocalTOTP(secret);
        } catch (error) {
            console.error('2FA local compute error:', error);
            return null;
        }
    }

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

// ===== 2FA 卡片拖拽排序 =====
// 交互与侧边栏「2FA验证」/「服务器管理」卡片完全一致：
//   · 只有标题栏(.fa-card-header)是拖拽手柄，卡片内容区不参与拖拽，
//     验证码仍可正常点击复制、密钥文本仍可拖选；
//   · 拖拽期间被拖卡片脱离文档流、紧贴指针移动，原位由等高虚线占位块顶替，
//     占位块逐格移动实时指示松手后的落点；
//   · 其它卡片通过 FLIP 位移补间平滑让位；
//   · 落点判断按相邻卡片中线，跳过被拖卡片自身。
// 事件用委托只绑一次：render2FA 会重建所有卡片，逐卡绑定会重复注册。
function setup2FACardDrag() {
    if (!faList || typeof setupCardDragSort !== 'function') return;
    setupCardDragSort({
        container: faList,
        cardSelector: '.fa-card',
        headerSelector: '.fa-card-header',
        handleClass: 'fa-card-drag-handle',
        // 弹出窗口用的是 Material Icons，而不是侧边栏的 Font Awesome
        handleIconClass: 'material-icons',
        handleText: 'drag_indicator',
        ignoreSelector: '.fa-card-actions .material-icons',
        placeholderClass: 'fa-drop-placeholder',
        boundKey: 'faDragBound',
        onReorder: function (visibleIds) {
            // DOM 顺序即保存顺序；顺序未变化时不写存储、不重渲染（避免重启取码定时器）
            const byId = new Map(my2faAccounts.map(a => [String(a.id), a]));
            const newOrder = visibleIds.map(id => byId.get(String(id))).filter(Boolean);
            my2faAccounts.forEach(a => {
                if (!visibleIds.includes(String(a.id))) newOrder.push(a);
            });
            const changed = newOrder.some((a, i) => a !== my2faAccounts[i]);
            if (!changed) return;
            my2faAccounts = newOrder;
            save2FA();
            render2FA();
        }
    });
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
        setup2FACardDrag();
        return;
    }
    faEmpty.classList.add('hidden');

    my2faAccounts.forEach((account) => {
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

        // 拖拽排序见 setup2FACardDrag()：标题栏是拖拽手柄，事件统一在列表上委托

        faList.appendChild(card);

        start2FATimer(account, faAutoFetch);
    });

    setup2FACardDrag();
}

function start2FATimer(account, autoFetch) {
    if (faRefreshIntervals[account.id]) {
        clearInterval(faRefreshIntervals[account.id]);
        clearTimeout(faRefreshIntervals[account.id + '_timeout']);
    }

    if (autoFetch) {
        fetchSingle2FACode(account);

        if (faComputeMode === 'local') {
            scheduleLocalRefresh(account);
        } else {
            faRefreshIntervals[account.id] = setInterval(() => {
                fetchSingle2FACode(account);
            }, FA_STEP_SECONDS * 1000);
        }

        let elapsed = 0;
        faRefreshIntervals[account.id + '_timeout'] = setInterval(() => {
            elapsed = faComputeMode === 'local'
                ? Math.floor((Date.now() / 1000) % FA_STEP_SECONDS)
                : (elapsed + 1) % FA_STEP_SECONDS;
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

// 本地模式下有效期由真实时钟决定，等到时间片边界再刷新，避免显示过期验证码
function scheduleLocalRefresh(account) {
    const nextBoundary = (Math.floor(Date.now() / 1000 / FA_STEP_SECONDS) + 1) * FA_STEP_SECONDS * 1000;
    faRefreshIntervals[account.id] = setTimeout(() => {
        fetchSingle2FACode(account);
        scheduleLocalRefresh(account);
    }, Math.max(1000, nextBoundary - Date.now()));
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
                elapsed = faComputeMode === 'local'
                    ? Math.floor((Date.now() / 1000) % FA_STEP_SECONDS)
                    : (elapsed + 1) % FA_STEP_SECONDS;
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

