// sp-2fa.js - 2FA 验证码模块（获取、渲染、定时刷新、导入导出、弹窗管理）
// 此文件由 sidepanel.js 拆分而来

// ================== 2FA 模块逻辑 ==================
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

// ===== 2FA 卡片拖拽排序 =====
// 与「服务器管理」卡片同一套交互：
//   · 只有标题栏(.fa-card-header)是拖拽手柄，卡片内容区不参与拖拽，
//     这样密钥文本仍可用鼠标拖选；
//   · 拖拽期间被拖卡片脱离文档流、紧贴指针移动，原位由等大占位块顶替，
//     占位块逐格移动实时指示落点；
//   · 其它卡片通过 FLIP 位移补间平滑让位。
// 事件用委托只绑一次：render2FA 会重建所有卡片，逐卡绑定会重复注册。
function setup2FACardDrag(container) {
    container = container || faList;
    if (!container) return;

    function refreshIndices() {
        container.querySelectorAll('.fa-card').forEach((card, i) => {
            card.dataset.index = i;
            card.removeAttribute('draggable');
            const header = card.querySelector('.fa-card-header');
            if (!header) return;
            header.setAttribute('draggable', 'true');
            header.querySelectorAll('a[href]').forEach(a => a.setAttribute('draggable', 'false'));
            if (!header.querySelector('.fa-card-drag-handle')) {
                const handle = document.createElement('span');
                handle.className = 'mi fa-regular fa-grip-dots-vertical fa-card-drag-handle';
                header.insertBefore(handle, header.firstChild);
            }
        });
    }

    refreshIndices();

    if (container.dataset.faDragBound === '1') return;
    container.dataset.faDragBound = '1';

    let dragCard = null;
    let placeholder = null;
    let srcIndex = null;
    let grabOffsetX = 0;
    let grabOffsetY = 0;

    function isActiveCard(card) {
        return !!card && card !== dragCard && card.style.display !== 'none' && card.offsetParent !== null;
    }

    function followPointer(x, y) {
        if (!dragCard) return;
        dragCard.style.left = (x - grabOffsetX) + 'px';
        dragCard.style.top = (y - grabOffsetY) + 'px';
    }

    // 用 offsetTop 而非 getBoundingClientRect：offsetTop 不受 transform 影响，
    // 让位动画未结束时再次测量也不会把动画位移算进去。
    function snapshotTops() {
        const tops = new Map();
        container.querySelectorAll('.fa-card').forEach(card => {
            if (!isActiveCard(card)) return;
            tops.set(card, card.offsetTop);
        });
        return tops;
    }

    function animateLetWay(prevTops) {
        container.querySelectorAll('.fa-card').forEach(card => {
            if (!isActiveCard(card)) return;
            const before = prevTops.get(card);
            if (before === undefined) return;
            const dy = before - card.offsetTop;
            if (!dy) return;
            card.style.transition = 'none';
            card.style.transform = 'translateY(' + dy + 'px)';
            void card.offsetWidth;
            card.style.transition = 'transform .18s cubic-bezier(.2, .8, .2, 1)';
            card.style.transform = '';
        });
    }

    function siblingCard(dir) {
        let node = placeholder;
        if (!node) return null;
        while ((node = dir > 0 ? node.nextElementSibling : node.previousElementSibling)) {
            if (node.classList && node.classList.contains('fa-card') && isActiveCard(node)) return node;
        }
        return null;
    }

    function shiftPlaceholder(dir) {
        if (!placeholder || !placeholder.parentNode) return false;
        const prevTops = snapshotTops();
        if (dir > 0) {
            const next = siblingCard(1);
            if (!next) return false;
            container.insertBefore(placeholder, next.nextElementSibling);
        } else {
            const prev = siblingCard(-1);
            if (!prev) return false;
            container.insertBefore(placeholder, prev);
        }
        animateLetWay(prevTops);
        return true;
    }

    // 基准取「相邻卡片中线」：卡片高度不同时，以占位块中心为基准会让落点判断偏后
    function shiftTowardsPointer(clientY) {
        if (!placeholder) return false;
        const y = clientY - container.getBoundingClientRect().top;

        const next = siblingCard(1);
        if (next && y > next.offsetTop + next.offsetHeight / 2) return shiftPlaceholder(1);

        const prev = siblingCard(-1);
        if (prev && y < prev.offsetTop + prev.offsetHeight / 2) return shiftPlaceholder(-1);

        return false;
    }

    function finishDrag(keepPosition) {
        if (!dragCard) return;
        const card = dragCard;
        const fromIndex = srcIndex;

        if (placeholder) {
            if (keepPosition) {
                container.insertBefore(card, placeholder);
            } else {
                const others = Array.from(container.querySelectorAll('.fa-card')).filter(c => c !== card);
                const anchor = others[fromIndex] || null;
                if (anchor) container.insertBefore(card, anchor);
                else container.appendChild(card);
            }
            if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
        }
        placeholder = null;

        card.classList.remove('dragging-follow', 'dragging', 'drag-over');
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';

        // 先关过渡再清位移，否则清除位移会按 CSS 的 all .2s 再滑一次
        const cleanupCards = container.querySelectorAll('.fa-card');
        cleanupCards.forEach(c => {
            c.style.transition = 'none';
            c.style.transform = '';
        });
        void container.offsetWidth;
        cleanupCards.forEach(c => { c.style.transition = ''; });

        dragCard = null;

        if (!keepPosition || fromIndex === null) {
            refreshIndices();
            return;
        }

        // DOM 顺序即保存顺序；顺序未变化时不写存储、不重渲染（重渲染会重启取码定时器）
        const domIds = Array.from(container.querySelectorAll('.fa-card')).map(c => String(c.dataset.id));
        const accountById = new Map(my2faAccounts.map(a => [String(a.id), a]));
        const newOrder = domIds.map(id => accountById.get(id)).filter(Boolean);
        my2faAccounts.forEach(a => {
            if (!domIds.includes(String(a.id))) newOrder.push(a);
        });

        const changed = newOrder.some((a, i) => a !== my2faAccounts[i]);
        if (changed) {
            my2faAccounts = newOrder;
            saveData();
            render2FA();
        }
        refreshIndices();
    }

    // 只有拖拽源是标题栏时才视为卡片排序，内容区选中文字等原生拖拽一律忽略
    function getDragCard(e) {
        const target = e.target;
        if (!target || typeof target.closest !== 'function') return null;
        const header = target.closest('.fa-card-header');
        if (!header || !container.contains(header)) return null;
        return header.closest('.fa-card');
    }

    container.addEventListener('dragstart', function(e) {
        const card = getDragCard(e);
        if (!card || !isActiveCard(card)) return;

        const rect = card.getBoundingClientRect();
        dragCard = card;
        srcIndex = Array.from(container.querySelectorAll('.fa-card')).indexOf(card);
        grabOffsetX = e.clientX - rect.left;
        grabOffsetY = e.clientY - rect.top;

        // 原生拖影会和 fixed 跟随的卡片叠成重影，用 1×1 透明图替换
        try {
            const blank = document.createElement('canvas');
            blank.width = 1;
            blank.height = 1;
            e.dataTransfer.setDragImage(blank, 0, 0);
        } catch (_) {}

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', String(card.dataset.id || srcIndex)); } catch (_) {}
        }

        placeholder = document.createElement('div');
        placeholder.className = 'fa-drop-placeholder';
        placeholder.style.height = rect.height + 'px';
        container.insertBefore(placeholder, card);

        card.style.width = rect.width + 'px';
        card.style.height = rect.height + 'px';
        card.style.left = rect.left + 'px';
        card.style.top = rect.top + 'px';
        card.classList.add('dragging-follow');
        card.classList.remove('dragging', 'drag-over');
    });

    container.addEventListener('dragover', function(e) {
        if (!dragCard || !placeholder) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        followPointer(e.clientX, e.clientY);

        for (let i = 0; i < 4; i++) {
            if (!shiftTowardsPointer(e.clientY)) break;
        }
    });

    container.addEventListener('drop', function(e) {
        if (!dragCard) return;
        e.preventDefault();
        e.stopPropagation();
        finishDrag(true);
    });

    container.addEventListener('dragend', function() {
        // drop 分支已处理则 dragCard 已置空；这里兜底「拖到区域外松手」的取消
        if (dragCard) finishDrag(false);
    });

    // 指针移出列表时容器收不到 dragover，用 document 捕获阶段保持跟随
    document.addEventListener('dragover', function(e) {
        if (dragCard) followPointer(e.clientX, e.clientY);
    }, true);
}

function render2FA() {
    // 清除所有定时器
    Object.keys(faRefreshIntervals).forEach(id => {
        clearInterval(faRefreshIntervals[id]);
        clearTimeout(faRefreshIntervals[id + '_timeout']);
    });
    faRefreshIntervals = {};

    faList.innerHTML = '';

    if (my2faAccounts.length === 0) {
        faEmpty.classList.remove('hidden');
        setup2FACardDrag(faList);
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
            <div class="fa-card-header" draggable="true">
                <span class="mi fa-card-drag-handle fa-regular fa-grip-dots-vertical"></span>
                <span class="fa-card-name">${safeName}</span>
                <div class="fa-card-actions">
                    <span class="mi fa-refresh-btn fa-regular fa-arrows-rotate" data-id="${account.id}"></span>
                    <span class="mi fa-edit-btn fa-regular fa-pen-to-square" data-id="${account.id}"></span>
                    <i class="fa-regular fa-xmark fa-del-btn" data-id="${account.id}"></i>
                </div>
            </div>
            <div class="fa-card-key">${safeKey}</div>
            <div class="fa-code-row" data-id="${account.id}">
                <div class="fa-timer">
                    <svg class="fa-timer-svg" viewBox="0 0 28 28">
                        <circle class="fa-timer-bg" cx="14" cy="14" r="11"/>
                        <circle class="fa-timer-progress" id="timer-progress-${account.id}" cx="14" cy="14" r="11" stroke-dasharray="69.115" stroke-dashoffset="0"/>
                    </svg>
                </div>
                <span class="fa-code-value refreshing" id="fa-code-${account.id}">${meowI18n.t('2fa_code_refreshing')}</span>
                <span class="fa-copy-hint"><span class="mi fa-regular fa-copy" style="font-size:12px"></span> ${meowI18n.t('action_copy')}</span>
            </div>
        `;

        // 复制代码
        card.querySelector('.fa-code-row').addEventListener('click', function(e) {
            if (e.target.closest('.fa-refresh-btn')) return;
            const codeEl = this.querySelector('.fa-code-value');
            if (codeEl && !codeEl.classList.contains('refreshing') && !codeEl.classList.contains('error')) {
                if (codeEl.classList.contains('fetch-prompt')) {
                    fetchSingle2FACode(account);
                } else {
                    copyToClipboard(codeEl.textContent, this.querySelector('.fa-copy-hint'));
                }
            }
        });

        // 刷新按钮
        card.querySelector('.fa-refresh-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            this.classList.add('spin');
            setTimeout(() => this.classList.remove('spin'), 600);
            fetchSingle2FACode(account);
        });

        // 编辑按钮
        card.querySelector('.fa-edit-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            open2FAModal(account);
        });

        // 删除按钮
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
                saveData();
                render2FA();
                showToast(meowI18n.t('2fa_msg_deleted'));
            }
        });

        // 拖拽排序见 setup2FACardDrag()：标题栏是拖拽手柄，事件统一在列表上委托

        faList.appendChild(card);

        // 开始自动刷新代码
        start2FATimer(account);
    });

    setup2FACardDrag(faList);
}

function start2FATimer(account) {
    // 先清除旧的定时器
    if (faRefreshIntervals[account.id]) {
        clearInterval(faRefreshIntervals[account.id]);
        clearTimeout(faRefreshIntervals[account.id + '_timeout']);
    }

    if (faAutoFetch) {
        // 立即获取一次
        fetchSingle2FACode(account);

        // 每30秒自动刷新
        faRefreshIntervals[account.id] = setInterval(() => {
            fetchSingle2FACode(account);
        }, 30000);

        // 定时器进度条更新（每秒）
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
    const totalLength = 69.115; // 2 * PI * r (r=11)
    const remaining = (30 - elapsed) / 30;
    const offset = totalLength * (1 - remaining);
    progressEl.style.strokeDashoffset = offset;

    // 颜色变化
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

// 2FA 弹窗管理
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
    setTimeout(() => faNameInput.focus(), 100);
}

function close2FAModal() {
    faModal.classList.add('hidden');
    editing2faId = null;
}

function import2FABackup() {
    // 创建隐藏的文件输入
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
                // 解析 otpauth://totp/ 格式
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

                    // 确定显示名称: 优先用 issuer 参数，其次从 label 中提取
                    let name = issuer ? decodeURIComponent(issuer).trim() : '';
                    if (!name) {
                        // label 格式可能是 "Issuer:username" 或 "username"
                        const colonIdx = labelPart.indexOf(':');
                        name = colonIdx > 0 ? labelPart.substring(0, colonIdx) : labelPart;
                        name = decodeURIComponent(name).trim();
                    }

                    // 检查是否已存在相同 secret 的账号
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
                saveData();
                render2FA();
                showToast(`成功导入 ${imported} 个密钥` + (skipped > 0 ? `，跳过 ${skipped} 个` : ''));
            } else {
                showToast('未导入任何密钥' + (skipped > 0 ? `（跳过 ${skipped} 个）` : ''));
            }

            // 清理文件输入以便下次选择同一个文件也能触发 change
            fileInput.value = '';
        };
        reader.readAsText(file);
    });

    document.body.appendChild(fileInput);
    fileInput.click();
    // 使用后移除 DOM 节点
    setTimeout(() => fileInput.remove(), 1000);
}

// === 导出2FA备份 ===
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

function setup2FALogic() {
    if (!faList || !faAddBtn) return;

    // 添加按钮
    faAddBtn.addEventListener('click', function() {
        open2FAModal(null);
    });

    // 导入备份按钮
    if (faImportBtn) {
        faImportBtn.addEventListener('click', import2FABackup);
    }

    // 导出备份按钮
    if (faExportBtn) {
        faExportBtn.addEventListener('click', export2FABackup);
    }

    // 关闭弹窗
    if (closeFaModal) {
        closeFaModal.addEventListener('click', close2FAModal);
    }
    faModal.addEventListener('click', function(e) {
        if (e.target === faModal) close2FAModal();
    });

    // 保存
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
                // 如果key改变了，清除旧的定时器
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

        saveData();
        render2FA();
        close2FAModal();
    });

    // 删除
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
            saveData();
            render2FA();
            close2FAModal();
            showToast(meowI18n.t('2fa_msg_deleted'));
        }
    });

    // 回车键快速保存
    faKeyInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            faSaveBtn.click();
        }
    });
}
