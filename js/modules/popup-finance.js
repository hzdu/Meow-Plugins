// popup-finance.js - 财务 + 账本关联 + 图谱 + 备注历史 + 预支出
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 财务功能 ===
const loadAndRenderFinanceList = async (dateKey) => {
    let data = await getStorageData(`fin_${dateKey}`);
    currentFinList = Array.isArray(data) ? data : [];
    exitFinEditMode(); 
};

// === 存款计入余额开关 ===
const loadDepositInBalanceSetting = async () => {
    const data = await getStorageData('meow_deposit_in_balance');
    depositInBalance = data === true; // 默认关闭，仅当明确存为 true 时才开启
    if (depositInBalanceToggle) depositInBalanceToggle.checked = depositInBalance;
};

if (depositInBalanceToggle) {
    depositInBalanceToggle.addEventListener('change', () => {
        depositInBalance = depositInBalanceToggle.checked;
        chrome.storage.sync.set({ 'meow_deposit_in_balance': depositInBalance });
        renderFinanceView();
        renderCalendar();
    });
}

const renderFinanceView = () => {
    finList.innerHTML = "";
    let totalIncome = 0, totalExpense = 0;
    if (currentFinList.length === 0) emptyStateFin.classList.remove("hidden");
    else {
        emptyStateFin.classList.add("hidden");
        currentFinList.forEach((item, index) => {
            const val = parseFloat(item.amount);
            if (item.type === 'income') totalIncome += val;
            else if (item.type === 'deposit') { /* 存款不计入收支显示 */ }
            else totalExpense += val;
            const li = document.createElement("li"); li.className = "fin-item";
            li.draggable = true; // 允许拖拽
            if (index === editingFinIndex) li.style.backgroundColor = "#f0f9ff";
            
            li.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("text/plain", JSON.stringify({ index, dateKey: selectedDateKey }));
                e.dataTransfer.effectAllowed = "move";
                li.style.opacity = "0.5";
            });
            li.addEventListener("dragend", () => {
                li.style.opacity = "1";
            });

            const typeLabel = item.type === 'income' ? meowI18n.t('income') : item.type === 'deposit' ? meowI18n.t('deposit') : meowI18n.t('expense');
            const valClass = item.type === 'income' ? 'inc' : item.type === 'deposit' ? 'dep' : 'exp';
            const valSign = item.type === 'income' ? '+' : '-';
            const tagsHtml = item.tags ? item.tags.map(t => `<span class="fin-item-tag" style="background-color:${t.color}">${t.text}</span>`).join('') : '';
            const tagsRow = tagsHtml ? `<div class="fin-tags-row">${tagsHtml}</div>` : '';
            const hasLinks = !!(item.id && finLinks.some(l => l.from.id === item.id || l.to.id === item.id));
            li.innerHTML = `<div class="fin-info"><span class="fin-note">${escapeHtml(item.note || 'No note')}</span><span class="fin-meta">${typeLabel}</span>${tagsRow}</div><div style="display:flex;align-items:center;gap:5px;"><span class="fin-val ${valClass}">${valSign}${val.toFixed(2)}</span><span class="material-icons fin-link-btn ${hasLinks?'has-links':''}" title="账本关联">hub</span><span class="material-icons edit-btn">edit</span><span class="material-icons delete-btn">close</span></div>`;
            
            li.querySelector(".delete-btn").onclick = () => { if(editingFinIndex===index)exitFinEditMode(); const delId = item.id; currentFinList.splice(index,1); saveFinanceData(); if (delId) cleanupFinLinks(delId); };
            li.querySelector(".edit-btn").onclick = () => enterFinEditMode(index, item);
            li.querySelector(".fin-link-btn").onclick = () => openFinLinkModal(index, item);
            finList.appendChild(li);
        });
    }
    summaryIncome.innerText = `+${totalIncome.toFixed(2)}`;
    summaryExpense.innerText = `-${totalExpense.toFixed(2)}`;
};

const enterFinEditMode = (index, item) => {
    editingFinIndex = index; finType.value = item.type; finAmount.value = item.amount; finNote.value = item.note;
    addFinBtn.innerHTML = "save"; cancelFinBtn.classList.remove("hidden"); finInputRow.classList.add("editing"); finAmount.focus();
    renderFinanceView();
};
const exitFinEditMode = () => {
    editingFinIndex = -1; finAmount.value = ""; finNote.value = "";
    addFinBtn.innerHTML = "check"; cancelFinBtn.classList.add("hidden"); finInputRow.classList.remove("editing");
    renderFinanceView();
};
const addFinance = () => {
    const amount = parseFloat(finAmount.value); const note = finNote.value.trim(); const type = finType.value;
    if (!isNaN(amount) && amount > 0) {
        if (editingFinIndex > -1) { 
            const old = currentFinList[editingFinIndex] || {};
            const updated = { type, amount, note };
            if (old.id) updated.id = old.id;
            if (old.tags) updated.tags = old.tags;
            currentFinList[editingFinIndex] = updated;
            exitFinEditMode(); 
        } 
        else { currentFinList.push({ type, amount, note, id: genFinId() }); finAmount.value = ""; finNote.value = ""; }
        saveFinanceData();
        updateFinNoteHistory(note);
        finAmount.focus();
    } else { finAmount.style.border = "1px solid red"; setTimeout(() => finAmount.style.border = "1px solid #eee", 1000); }
};
const saveFinanceData = () => {
    if (editingFinIndex === -1) renderFinanceView();
    const key = `fin_${selectedDateKey}`;
    if (currentFinList.length > 0) chrome.storage.sync.set({[key]: currentFinList}, () => { renderCalendar(); checkAndHighlightTabs(selectedDateKey); });
    else chrome.storage.sync.remove(key, () => { renderCalendar(); checkAndHighlightTabs(selectedDateKey); });
};

// === 账本关联功能 ===
const genFinId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const ensureFinIds = (list) => {
    let changed = false;
    if (Array.isArray(list)) {
        list.forEach(item => { if (!item.id) { item.id = genFinId(); changed = true; } });
    }
    return changed;
};

const loadFinLinks = async () => {
    const data = await getStorageData('meow_fin_links');
    finLinks = Array.isArray(data) ? data : [];
};

const saveFinLinks = () => {
    chrome.storage.sync.set({ meow_fin_links: finLinks });
};

const getLinksForItem = (itemId) => {
    if (!itemId) return [];
    return finLinks.filter(l => l.from.id === itemId || l.to.id === itemId);
};

const isLinked = (idA, idB) => {
    if (!idA || !idB) return false;
    return finLinks.some(l =>
        (l.from.id === idA && l.to.id === idB) ||
        (l.to.id === idA && l.from.id === idB)
    );
};

const createFinLink = (currentId, currentDateKey, targetId, targetDateKey) => {
    if (!currentId || !targetId || currentId === targetId) return;
    if (isLinked(currentId, targetId)) { showToast('已存在关联'); return; }
    finLinks.push({
        id: 'link_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        from: { dateKey: currentDateKey, id: currentId },
        to: { dateKey: targetDateKey, id: targetId }
    });
    saveFinLinks();
    renderFinLinkCurrent();
    renderFinLinkList();
    drawFinLinkCanvas();
    if (finLinkGraphMode) renderFinLinkGraph();
    showToast('关联成功');
};

const removeFinLink = (linkId) => {
    finLinks = finLinks.filter(l => l.id !== linkId);
    saveFinLinks();
    renderFinLinkCurrent();
    renderFinLinkList();
    if (finLinkGraphMode) renderFinLinkGraph();
};

// 删除某账本项时清理其所有关联
const cleanupFinLinks = (itemId) => {
    if (!itemId) return;
    const before = finLinks.length;
    finLinks = finLinks.filter(l => l.from.id !== itemId && l.to.id !== itemId);
    if (finLinks.length !== before) saveFinLinks();
};

// 打开关联窗口
const openFinLinkModal = async (index, item) => {
    // 确保当前项有 id
    let needSave = false;
    if (!item.id) { item.id = genFinId(); currentFinList[index] = item; needSave = true; }
    if (ensureFinIds(currentFinList)) needSave = true;
    if (needSave) chrome.storage.sync.set({ [`fin_${selectedDateKey}`]: currentFinList });

    finLinkCurrentItem = { dateKey: selectedDateKey, index, item };
    await loadFinLinks();
    finLinkSourceDate = selectedDateKey;

    finLinkModal.classList.remove('hidden');
    finLinkModal.classList.add('visible');

    // 初始化日期选择器
    if (!finLinkDatePicker && finLinkDateInput && typeof flatpickr !== 'undefined') {
        const localeStr = (window.meowI18n && window.meowI18n.lang === 'zh-TW') ? 'zh_tw' : (window.meowI18n && window.meowI18n.lang === 'en' ? 'en' : 'zh');
        finLinkDatePicker = flatpickr(finLinkDateInput, {
            locale: localeStr,
            dateFormat: 'Y-m-d',
            disableMobile: true,
            onChange: (dates) => {
                if (dates[0]) {
                    const d = dates[0];
                    finLinkSourceDate = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
                }
                renderFinLinkList();
            }
        });
    }
    // 将 selectedDateKey (如 "2024-1-5") 解析为 Date 并设置
    const skParts = selectedDateKey.split('-');
    const initDate = new Date(parseInt(skParts[0]), parseInt(skParts[1]) - 1, parseInt(skParts[2]));
    if (finLinkDatePicker) finLinkDatePicker.setDate(initDate, false);
    if (finLinkDateInput) finLinkDateInput.value = selectedDateKey;

    renderFinLinkCurrent();
    renderFinLinkList();
    requestAnimationFrame(() => { resizeFinLinkCanvas(); drawFinLinkCanvas(); });
};

const closeFinLinkModal = () => {
    finLinkModal.classList.add('hidden');
    finLinkModal.classList.remove('visible');
    finLinkCurrentItem = null;
    finLinkDrag = null;
    finLinkGraphConnectDrag = null;
    hideGraphLineMenu();
    closeGraphLinkPanel();
    // 重置图谱视图
    if (finLinkGraphMode) {
        finLinkGraphMode = false;
        if (finLinkGraphToggle) finLinkGraphToggle.classList.remove('active');
        if (finLinkGraphView) finLinkGraphView.classList.add('hidden');
        if (finLinkLeftPanel) finLinkLeftPanel.classList.remove('hidden');
        if (finLinkRightPanel) finLinkRightPanel.classList.remove('hidden');
        if (finLinkCanvas) finLinkCanvas.classList.remove('hidden');
    }
    renderFinanceView();
};

// 点击左侧已关联项 → 右侧跳转到对应日期并高亮目标项
const jumpToLinkedItem = async (targetDateKey, targetItemId) => {
    if (!targetDateKey || !targetItemId) return;
    // 如果在图谱视图，先切回普通视图
    if (finLinkGraphMode) await toggleFinLinkGraph();
    if (finLinkSourceDate !== targetDateKey) {
        finLinkSourceDate = targetDateKey;
        if (finLinkDatePicker) {
            const pk = targetDateKey.split('-');
            finLinkDatePicker.setDate(new Date(parseInt(pk[0]), parseInt(pk[1]) - 1, parseInt(pk[2])), false);
        }
        if (finLinkDateInput) finLinkDateInput.value = targetDateKey;
    }
    await renderFinLinkList();
    // 滚动并高亮
    requestAnimationFrame(() => {
        const targetNode = finLinkList.querySelector(`.fin-link-node[data-id="${targetItemId}"]`);
        if (targetNode) {
            const rightPanel = finLinkBody.querySelector('.fin-link-right');
            if (rightPanel) targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetNode.classList.add('jump-highlight');
            setTimeout(() => targetNode.classList.remove('jump-highlight'), 1600);
        }
        drawFinLinkCanvas();
    });
};

// 渲染左侧当前节点 + 已关联列表
const renderFinLinkCurrent = async () => {
    if (!finLinkCurrentItem) return;
    const { item, dateKey } = finLinkCurrentItem;
    const val = parseFloat(item.amount);
    const typeLabel = item.type === 'income' ? meowI18n.t('income') : item.type === 'deposit' ? meowI18n.t('deposit') : meowI18n.t('expense');
    finLinkCurrentNode.innerHTML = `
        <div class="fin-link-node-row">
            <span class="fin-link-node-note">${escapeHtml(item.note || 'No note')}</span>
            <span class="fin-link-node-amount ${item.type==='income'?'inc':item.type==='deposit'?'dep':'exp'}">${item.type==='income'?'+':'-'}${val.toFixed(2)}</span>
        </div>
        <div class="fin-link-node-meta">${typeLabel} · ${dateKey}</div>
    `;

    const myLinks = getLinksForItem(item.id);
    if (myLinks.length === 0) {
        finLinkLinkedList.innerHTML = '<div class="fin-link-empty">暂无关联，从右侧拖拽节点到此建立关联</div>';
        return;
    }

    const dateKeys = [...new Set(myLinks.map(l => {
        const other = l.from.id === item.id ? l.to : l.from;
        return other.dateKey;
    }))];
    const allData = await new Promise(r => chrome.storage.sync.get(dateKeys.map(k => `fin_${k}`), items => r(items || {})));

    finLinkLinkedList.innerHTML = '';
    myLinks.forEach(link => {
        const other = link.from.id === item.id ? link.to : link.from;
        const list = allData[`fin_${other.dateKey}`];
        const otherItem = Array.isArray(list) ? list.find(x => x.id === other.id) : null;
        const div = document.createElement('div');
        div.className = 'fin-link-linked-item';
        if (otherItem) {
            const oVal = parseFloat(otherItem.amount);
            const oSign = otherItem.type === 'income' ? '+' : '-';
            div.innerHTML = `
                <div class="fin-link-linked-info">
                    <span class="fin-link-linked-note">${escapeHtml(otherItem.note || 'No note')}</span>
                    <span class="fin-link-linked-meta">${other.dateKey} · ${oSign}${oVal.toFixed(2)}</span>
                </div>
                <span class="material-icons fin-link-linked-del">close</span>
            `;
        } else {
            div.innerHTML = `
                <div class="fin-link-linked-info">
                    <span class="fin-link-linked-note" style="color:#9ca3af;">（账本已删除）</span>
                    <span class="fin-link-linked-meta">${other.dateKey}</span>
                </div>
                <span class="material-icons fin-link-linked-del">close</span>
            `;
        }
        const delBtn = div.querySelector('.fin-link-linked-del');
        delBtn.addEventListener('click', (e) => { e.stopPropagation(); removeFinLink(link.id); });
        // 点击已关联项 → 右侧跳转到对应日期并高亮目标项
        div.addEventListener('click', () => jumpToLinkedItem(other.dateKey, other.id));
        div.style.cursor = 'pointer';
        finLinkLinkedList.appendChild(div);
    });
};

// 渲染右侧日期账本列表
const renderFinLinkList = async () => {
    if (!finLinkList || !finLinkSourceDate) return;
    const data = await getStorageData(`fin_${finLinkSourceDate}`);
    finLinkSourceList = Array.isArray(data) ? data : [];
    if (ensureFinIds(finLinkSourceList)) {
        chrome.storage.sync.set({ [`fin_${finLinkSourceDate}`]: finLinkSourceList });
    }

    finLinkList.innerHTML = '';
    if (finLinkSourceList.length === 0) {
        finLinkList.innerHTML = '<div class="fin-link-empty">该日暂无账本记录</div>';
        drawFinLinkCanvas();
        return;
    }

    const currentId = finLinkCurrentItem ? finLinkCurrentItem.item.id : '';
    finLinkSourceList.forEach((item, index) => {
        const val = parseFloat(item.amount);
        const typeLabel = item.type === 'income' ? meowI18n.t('income') : item.type === 'deposit' ? meowI18n.t('deposit') : meowI18n.t('expense');
        const linked = isLinked(currentId, item.id);
        const isSelf = finLinkCurrentItem && finLinkSourceDate === finLinkCurrentItem.dateKey && index === finLinkCurrentItem.index;

        const node = document.createElement('div');
        node.className = 'fin-link-node' + (linked ? ' linked' : '') + (isSelf ? '' : ' draggable');
        node.setAttribute('data-id', item.id || '');
        node.setAttribute('data-date', finLinkSourceDate);
        node.innerHTML = `
            <div class="fin-link-node-row">
                <span class="fin-link-node-note">${escapeHtml(item.note || 'No note')}</span>
                <span class="fin-link-node-amount ${item.type==='income'?'inc':item.type==='deposit'?'dep':'exp'}">${item.type==='income'?'+':'-'}${val.toFixed(2)}</span>
            </div>
            <div class="fin-link-node-meta">${typeLabel}${linked ? ' · 已关联' : ''}</div>
        `;
        if (isSelf) {
            node.style.opacity = '0.4';
            node.title = '当前账本';
        } else {
            node.title = '拖拽到左侧当前账本建立关联';
            node.addEventListener('pointerdown', (e) => startFinLinkDrag(e, node, item.id, finLinkSourceDate));
        }
        finLinkList.appendChild(node);
    });

    drawFinLinkCanvas();
};

// 拖拽连线
const startFinLinkDrag = (e, node, fromId, fromDateKey) => {
    e.preventDefault();
    finLinkDrag = { fromId, fromDateKey, fromEl: node, currentX: e.clientX, currentY: e.clientY };
    node.classList.add('dragging');

    const onMove = (ev) => {
        finLinkDrag.currentX = ev.clientX;
        finLinkDrag.currentY = ev.clientY;
        const rect = finLinkCurrentNode.getBoundingClientRect();
        if (ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
            finLinkCurrentNode.classList.add('drag-over');
        } else {
            finLinkCurrentNode.classList.remove('drag-over');
        }
        drawFinLinkCanvas();
    };

    const onUp = (ev) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        node.classList.remove('dragging');
        finLinkCurrentNode.classList.remove('drag-over');
        const rect = finLinkCurrentNode.getBoundingClientRect();
        if (ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
            createFinLink(finLinkCurrentItem.item.id, finLinkCurrentItem.dateKey, fromId, fromDateKey);
        }
        finLinkDrag = null;
        drawFinLinkCanvas();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
};

// 画布尺寸适配
const resizeFinLinkCanvas = () => {
    if (!finLinkCanvas || !finLinkBody) return;
    const dpr = window.devicePixelRatio || 1;
    const w = finLinkBody.clientWidth;
    const h = finLinkBody.clientHeight;
    if (w < 10 || h < 10) return;
    finLinkCanvas.width = w * dpr;
    finLinkCanvas.height = h * dpr;
    finLinkCanvas.style.width = w + 'px';
    finLinkCanvas.style.height = h + 'px';
    const ctx = finLinkCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

// 绘制贝塞尔箭头
const drawArrow = (ctx, x1, y1, x2, y2, color, dashed) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    if (dashed) ctx.setLineDash([6, 4]);
    const cpX = (x1 + x2) / 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(cpX, y1, cpX, y2, x2, y2);
    ctx.stroke();
    if (!dashed) {
        const headLen = 8;
        const dir = x2 >= cpX ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * dir, y2 - headLen * 0.5);
        ctx.lineTo(x2 - headLen * dir, y2 + headLen * 0.5);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
};

// 绘制所有连线
const drawFinLinkCanvas = () => {
    if (!finLinkCanvas || !finLinkBody || !finLinkCurrentItem) return;
    const ctx = finLinkCanvas.getContext('2d');
    const w = finLinkBody.clientWidth;
    const h = finLinkBody.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const currentId = finLinkCurrentItem.item.id;
    if (!currentId) return;

    const bodyRect = finLinkBody.getBoundingClientRect();
    const curRect = finLinkCurrentNode.getBoundingClientRect();
    const curX = curRect.right - bodyRect.left;
    const curY = curRect.top - bodyRect.top + curRect.height / 2;

    // 已有关联连线
    const rightNodes = finLinkList.querySelectorAll('.fin-link-node[data-id]');
    rightNodes.forEach(node => {
        const nodeId = node.getAttribute('data-id');
        if (!nodeId) return;
        if (isLinked(currentId, nodeId)) {
            const nRect = node.getBoundingClientRect();
            const nx = nRect.left - bodyRect.left;
            const ny = nRect.top - bodyRect.top + nRect.height / 2;
            drawArrow(ctx, curX, curY, nx, ny, '#8b5cf6', false);
        }
    });

    // 拖拽中的临时连线
    if (finLinkDrag && finLinkDrag.currentX != null) {
        const nRect = finLinkDrag.fromEl.getBoundingClientRect();
        const sx = nRect.left - bodyRect.left;
        const sy = nRect.top - bodyRect.top + nRect.height / 2;
        const tx = finLinkDrag.currentX - bodyRect.left;
        const ty = finLinkDrag.currentY - bodyRect.top;
        drawArrow(ctx, sx, sy, tx, ty, '#6366f1', true);
    }
};

// 关联窗口事件绑定
if (finLinkClose) finLinkClose.addEventListener('click', closeFinLinkModal);
if (finLinkModal) {
    finLinkModal.addEventListener('click', (e) => { if (e.target === finLinkModal) closeFinLinkModal(); });
}
if (finLinkBody) {
    const redrawOnScroll = () => drawFinLinkCanvas();
    finLinkBody.addEventListener('scroll', redrawOnScroll);
    const leftPanel = finLinkBody.querySelector('.fin-link-left');
    const rightPanel = finLinkBody.querySelector('.fin-link-right');
    if (leftPanel) leftPanel.addEventListener('scroll', redrawOnScroll);
    if (rightPanel) rightPanel.addEventListener('scroll', redrawOnScroll);
    new ResizeObserver(() => { resizeFinLinkCanvas(); drawFinLinkCanvas(); if (finLinkGraphMode) resizeFinLinkGraphCanvas(); }).observe(finLinkBody);
}

// === 关联图谱视图 ===

// BFS 计算从当前节点出发的全链路关联网络
const computeLinkNetwork = (startId, startDateKey) => {
    const visited = new Set();
    const nodes = [];     // { id, dateKey, depth }
    const edges = [];     // { fromId, toId, linkId, direct }
    const nodeMap = new Map();

    const queue = [{ id: startId, dateKey: startDateKey, depth: 0 }];
    while (queue.length > 0) {
        const { id, dateKey, depth } = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        const node = { id, dateKey, depth };
        nodes.push(node);
        nodeMap.set(id, node);

        finLinks.forEach(l => {
            if (l.from.id === id || l.to.id === id) {
                const other = l.from.id === id ? l.to : l.from;
                const edgeKey = [id, other.id].sort().join('|');
                if (!edges.some(e => [e.fromId, e.toId].sort().join('|') === edgeKey)) {
                    edges.push({ fromId: id, toId: other.id, linkId: l.id });
                }
                if (!visited.has(other.id)) {
                    queue.push({ id: other.id, dateKey: other.dateKey, depth: depth + 1 });
                }
            }
        });
    }
    return { nodes, edges };
};

// 金字塔树状布局：当前节点在顶部居中，其余按深度逐层向下排列
const layoutGraph = (network, w, h) => {
    const nodeW = 140;  // 节点宽度（含间距）
    const nodeH = 70;   // 节点高度（含间距）
    const layerH = 110; // 层间距

    const byDepth = {};
    const maxDepth = 0;
    network.nodes.forEach(n => {
        if (!byDepth[n.depth]) byDepth[n.depth] = [];
        byDepth[n.depth].push(n);
    });

    const positions = new Map();
    const depths = Object.keys(byDepth).map(Number).sort((a, b) => a - b);
    const totalLayers = depths.length;
    const startY = 50;

    depths.forEach(depth => {
        const items = byDepth[depth];
        const y = startY + depth * layerH;
        if (items.length === 1) {
            positions.set(items[0].id, { x: w / 2, y });
        } else {
            // 均匀分布在宽度内
            const spacing = w / (items.length + 1);
            items.forEach((item, i) => {
                positions.set(item.id, { x: spacing * (i + 1), y });
            });
        }
    });
    return positions;
};

// 加载所有节点的账本数据
const loadGraphItems = async (network) => {
    const dateKeys = [...new Set(network.nodes.map(n => n.dateKey))];
    const allData = await new Promise(r => chrome.storage.sync.get(dateKeys.map(k => `fin_${k}`), items => r(items || {})));
    const itemMap = new Map();
    network.nodes.forEach(n => {
        const list = allData[`fin_${n.dateKey}`];
        const item = Array.isArray(list) ? list.find(x => x.id === n.id) : null;
        if (item) itemMap.set(n.id, { item, dateKey: n.dateKey, depth: n.depth });
    });
    return itemMap;
};

// 应用 pan/zoom 变换到节点层和画布
const applyGraphTransform = () => {
    if (!finLinkGraphNodes) return;
    finLinkGraphNodes.style.transform = `translate(${finLinkGraphPanX}px, ${finLinkGraphPanY}px) scale(${finLinkGraphScale})`;
    finLinkGraphNodes.style.transformOrigin = '0 0';
    drawFinLinkGraphCanvas();
};

// Ctrl+0：将所有节点缩放居中到当前视图（类似 Photoshop Fit on Screen）
const fitGraphToView = () => {
    if (!finLinkGraphView || !finLinkGraphPos || !finLinkGraphData) return;
    if (finLinkGraphData.nodes.length === 0) return;

    // 1. 计算所有节点的包围盒（考虑节点尺寸 130x60）
    const nodeHalfW = 65;
    const nodeHalfH = 30;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    finLinkGraphData.nodes.forEach(n => {
        const p = finLinkGraphPos.get(n.id);
        if (!p) return;
        minX = Math.min(minX, p.x - nodeHalfW);
        minY = Math.min(minY, p.y - nodeHalfH);
        maxX = Math.max(maxX, p.x + nodeHalfW);
        maxY = Math.max(maxY, p.y + nodeHalfH);
    });
    if (minX === Infinity) return;

    const contentW = maxX - minX;
    const contentH = maxY - minY;

    // 2. 获取视口尺寸
    const viewW = finLinkGraphView.clientWidth || finLinkBody.clientWidth || 640;
    const viewH = finLinkGraphView.clientHeight || finLinkBody.clientHeight || 400;

    // 3. 计算缩放比例（留 40px 边距）
    const padding = 40;
    const scaleX = (viewW - padding * 2) / contentW;
    const scaleY = (viewH - padding * 2) / contentH;
    let newScale = Math.min(scaleX, scaleY);
    newScale = Math.max(0.3, Math.min(3, newScale));

    // 4. 计算平移使内容居中
    const scaledW = contentW * newScale;
    const scaledH = contentH * newScale;
    const offsetX = (viewW - scaledW) / 2 - minX * newScale;
    const offsetY = (viewH - scaledH) / 2 - minY * newScale;

    finLinkGraphScale = newScale;
    finLinkGraphPanX = offsetX;
    finLinkGraphPanY = offsetY;
    applyGraphTransform();
};

// 渲染图谱视图
const renderFinLinkGraph = async () => {
    if (!finLinkCurrentItem) return;
    const startId = finLinkCurrentItem.item.id;
    const startDateKey = finLinkCurrentItem.dateKey;

    // 1. 计算全链路网络
    finLinkGraphData = computeLinkNetwork(startId, startDateKey);

    // 2. 加载所有节点数据
    finLinkGraphItemMap = await loadGraphItems(finLinkGraphData);

    // 3. 等待 DOM 布局稳定后获取尺寸
    await new Promise(r => setTimeout(r, 100));

    let w = 0, h = 0;
    const bodyRect = finLinkBody.getBoundingClientRect();
    w = bodyRect.width;
    h = bodyRect.height;
    if (w < 50) {
        const contentEl = finLinkModal.querySelector('.fin-link-modal-content');
        if (contentEl) {
            const cRect = contentEl.getBoundingClientRect();
            w = cRect.width;
            h = cRect.height - 50;
        }
    }
    if (w < 50) w = 640;
    if (h < 50) h = 400;

    // 重置 pan/zoom
    finLinkGraphScale = 1;
    finLinkGraphPanX = 0;
    finLinkGraphPanY = 0;

    finLinkGraphPos = layoutGraph(finLinkGraphData, w, h);

    // 4. 渲染 DOM 节点
    finLinkGraphNodes.innerHTML = '';
    finLinkGraphData.nodes.forEach(node => {
        const data = finLinkGraphItemMap.get(node.id);
        if (!data) return;
        const { item, dateKey, depth } = data;
        const val = parseFloat(item.amount);
        const isCurrent = node.id === startId;

        const el = document.createElement('div');
        el.className = 'fin-link-graph-node' + (isCurrent ? ' current' : '') + (depth > 0 ? ` depth-${Math.min(depth, 3)}` : '');
        el.setAttribute('data-id', node.id);
        el.innerHTML = `
            <div class="fin-link-graph-node-note">${escapeHtml(item.note || 'No note')}</div>
            <div class="fin-link-graph-node-amount ${item.type==='income'?'inc':item.type==='deposit'?'dep':'exp'}">${item.type==='income'?'+':'-'}${val.toFixed(2)}</div>
            <div class="fin-link-graph-node-date">${dateKey}</div>
            ${depth > 0 ? `<div class="fin-link-graph-node-depth">${depth}</div>` : ''}
            <div class="fin-link-graph-anchor anchor-top" data-anchor="top">+</div>
            <div class="fin-link-graph-anchor anchor-bottom" data-anchor="bottom">+</div>
            <div class="fin-link-graph-anchor anchor-left" data-anchor="left">+</div>
            <div class="fin-link-graph-anchor anchor-right" data-anchor="right">+</div>
        `;
        const pos = finLinkGraphPos.get(node.id);
        if (pos) {
            el.style.left = pos.x + 'px';
            el.style.top = pos.y + 'px';
            el.style.transform = 'translate(-50%, -50%)';
        }

        el.addEventListener('pointerdown', (e) => startGraphNodeDrag(e, el, node.id));
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isCurrent) jumpToLinkedItem(dateKey, node.id);
        });

        // 锚点：点击→打开右侧选择面板 / 拖拽→拉出连线
        el.querySelectorAll('.fin-link-graph-anchor').forEach(anchor => {
            // 阻止 click 冒泡到节点，防止触发 jumpToLinkedItem 导致退出图谱视图
            anchor.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
            anchor.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startY = e.clientY;
                let dragStarted = false;

                const onMove = (ev) => {
                    if (dragStarted) return;
                    if (Math.abs(ev.clientX - startX) > 5 || Math.abs(ev.clientY - startY) > 5) {
                        dragStarted = true;
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                        startGraphConnectDrag(ev, node.id, dateKey);
                    }
                };

                const onUp = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    if (!dragStarted) {
                        openGraphLinkPanel(node.id, dateKey, item);
                    }
                };

                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            });
        });

        finLinkGraphNodes.appendChild(el);
    });

    // 5. 调整画布尺寸 + 应用变换 + 绘制连线
    resizeFinLinkGraphCanvas();
    applyGraphTransform();
};

// 图谱画布尺寸适配
const resizeFinLinkGraphCanvas = () => {
    if (!finLinkGraphCanvas || !finLinkBody) return;
    const dpr = window.devicePixelRatio || 1;
    const w = finLinkBody.clientWidth;
    const h = finLinkBody.clientHeight;
    if (w < 10 || h < 10) return;
    finLinkGraphCanvas.width = w * dpr;
    finLinkGraphCanvas.height = h * dpr;
    finLinkGraphCanvas.style.width = w + 'px';
    finLinkGraphCanvas.style.height = h + 'px';
    const ctx = finLinkGraphCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

// 绘制图谱连线
const drawFinLinkGraphCanvas = () => {
    if (!finLinkGraphCanvas || !finLinkGraphView || !finLinkGraphData) return;
    const ctx = finLinkGraphCanvas.getContext('2d');
    const w = finLinkGraphView.clientWidth || finLinkBody.clientWidth;
    const h = finLinkGraphView.clientHeight || finLinkBody.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const startId = finLinkCurrentItem ? finLinkCurrentItem.item.id : '';
    const s = finLinkGraphScale;
    const px = finLinkGraphPanX;
    const py = finLinkGraphPanY;

    // 将逻辑坐标转换为画布坐标
    const toCanvas = (pos) => ({
        x: pos.x * s + px,
        y: pos.y * s + py
    });

    finLinkGraphData.edges.forEach(edge => {
        const fromPos = finLinkGraphPos.get(edge.fromId);
        const toPos = finLinkGraphPos.get(edge.toId);
        if (!fromPos || !toPos) return;

        const fromData = finLinkGraphItemMap.get(edge.fromId);
        const toData = finLinkGraphItemMap.get(edge.toId);
        if (!fromData || !toData) return;

        const isDirect = edge.fromId === startId || edge.toId === startId;
        const color = isDirect ? '#8b5cf6' : '#c4b5fd';
        const dashed = !isDirect;

        const fp = toCanvas(fromPos);
        const tp = toCanvas(toPos);

        // 节点半宽/半高（考虑缩放）
        const halfW = 65 * s;
        const halfH = 30 * s;

        const dx = tp.x - fp.x, dy = tp.y - fp.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return;
        const shrink = Math.min(halfW, halfH);
        const ux = dx / dist, uy = dy / dist;
        const sx = fp.x + ux * shrink;
        const sy = fp.y + uy * shrink;
        const ex = tp.x - ux * shrink;
        const ey = tp.y - uy * shrink;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = (isDirect ? 2.5 : 1.8) * Math.sqrt(s);
        if (dashed) ctx.setLineDash([5, 4]);

        const cpX = (sx + ex) / 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(cpX, sy, cpX, ey, ex, ey);
        ctx.stroke();

        // 箭头
        ctx.setLineDash([]);
        const headLen = (isDirect ? 8 : 6) * Math.sqrt(s);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - headLen * ux + headLen * 0.5 * uy, ey - headLen * uy - headLen * 0.5 * ux);
        ctx.lineTo(ex - headLen * ux - headLen * 0.5 * uy, ey - headLen * uy + headLen * 0.5 * ux);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    });

    // 绘制从锚点拖出的临时连线
    if (finLinkGraphConnectDrag) {
        const fromPos = finLinkGraphPos.get(finLinkGraphConnectDrag.fromId);
        if (fromPos) {
            const fp = toCanvas(fromPos);
            const tx = finLinkGraphConnectDrag.x;
            const ty = finLinkGraphConnectDrag.y;
            ctx.save();
            ctx.strokeStyle = '#6366f1';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(fp.x, fp.y);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            // 终点小圆点
            ctx.setLineDash([]);
            ctx.fillStyle = '#6366f1';
        ctx.beginPath();
        ctx.arc(tx, ty, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        }
    }
};

// 图谱节点拖拽
const startGraphNodeDrag = (e, el, nodeId) => {
    e.preventDefault();
    e.stopPropagation();
    const viewRect = finLinkGraphView.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let hasMoved = false;
    const s = finLinkGraphScale;
    finLinkGraphDragNode = {
        id: nodeId,
        el,
        offsetX: (e.clientX - (elRect.left + elRect.width / 2)) / s,
        offsetY: (e.clientY - (elRect.top + elRect.height / 2)) / s
    };
    el.classList.add('dragging');

    const onMove = (ev) => {
        if (!finLinkGraphDragNode) return;
        if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) hasMoved = true;
        // 将屏幕坐标转换为逻辑坐标（考虑 pan/zoom）
        const x = (ev.clientX - viewRect.left - finLinkGraphPanX) / s - finLinkGraphDragNode.offsetX;
        const y = (ev.clientY - viewRect.top - finLinkGraphPanY) / s - finLinkGraphDragNode.offsetY;
        finLinkGraphPos.set(nodeId, { x, y });
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        drawFinLinkGraphCanvas();
    };

    const onUp = (ev) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (finLinkGraphDragNode) {
            finLinkGraphDragNode.el.classList.remove('dragging');
            finLinkGraphDragNode = null;
        }
        if (hasMoved) {
            ev.preventDefault();
            ev.stopPropagation();
            const blocker = (ce) => { ce.preventDefault(); ce.stopPropagation(); el.removeEventListener('click', blocker, true); };
            el.addEventListener('click', blocker, true);
        }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
};

// 从锚点拖出连线
const startGraphConnectDrag = (e, fromId, fromDateKey) => {
    const viewRect = finLinkGraphView.getBoundingClientRect();
    finLinkGraphConnectDrag = {
        fromId,
        fromDateKey,
        x: e.clientX - viewRect.left,
        y: e.clientY - viewRect.top
    };

    const onMove = (ev) => {
        if (!finLinkGraphConnectDrag) return;
        finLinkGraphConnectDrag.x = ev.clientX - viewRect.left;
        finLinkGraphConnectDrag.y = ev.clientY - viewRect.top;
        drawFinLinkGraphCanvas();
    };

    const onUp = (ev) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (!finLinkGraphConnectDrag) return;

        // 检测释放位置是否在某个节点上
        const targetEl = document.elementFromPoint(ev.clientX, ev.clientY);
        const nodeEl = targetEl ? targetEl.closest('.fin-link-graph-node') : null;
        if (nodeEl) {
            const targetId = nodeEl.getAttribute('data-id');
            if (targetId && targetId !== fromId) {
                const targetData = finLinkGraphItemMap.get(targetId);
                if (targetData) {
                    createFinLink(fromId, fromDateKey, targetId, targetData.dateKey);
                }
            }
        }
        finLinkGraphConnectDrag = null;
        drawFinLinkGraphCanvas();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
};

// 检测点击位置是否在某条连线上，返回 edge 或 null
const hitTestGraphEdge = (clickX, clickY) => {
    if (!finLinkGraphData || !finLinkGraphPos) return null;
    const s = finLinkGraphScale;
    const px = finLinkGraphPanX;
    const py = finLinkGraphPanY;
    const threshold = 12;

    for (const edge of finLinkGraphData.edges) {
        const fromPos = finLinkGraphPos.get(edge.fromId);
        const toPos = finLinkGraphPos.get(edge.toId);
        if (!fromPos || !toPos) continue;

        const fp = { x: fromPos.x * s + px, y: fromPos.y * s + py };
        const tp = { x: toPos.x * s + px, y: toPos.y * s + py };

        const halfW = 65 * s;
        const halfH = 30 * s;
        const dx = tp.x - fp.x, dy = tp.y - fp.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) continue;
        const shrink = Math.min(halfW, halfH);
        const ux = dx / dist, uy = dy / dist;
        const sx = fp.x + ux * shrink;
        const sy = fp.y + uy * shrink;
        const ex = tp.x - ux * shrink;
        const ey = tp.y - uy * shrink;
        const cpX = (sx + ex) / 2;

        let hit = false;
        for (let i = 0; i <= 30; i++) {
            const t = i / 30;
            const u = 1 - t;
            const bx = u * u * u * sx + 3 * u * u * t * cpX + 3 * u * t * t * cpX + t * t * t * ex;
            const by = u * u * u * sy + 3 * u * u * t * sy + 3 * u * t * t * ey + t * t * t * ey;
            const ddx = bx - clickX, ddy = by - clickY;
            if (ddx * ddx + ddy * ddy < threshold * threshold) { hit = true; break; }
        }
        if (hit) return edge;
    }
    return null;
};

// 连线点击弹出删除菜单
let finLinkGraphMenu = null;
const showGraphLineMenu = (x, y, edge) => {
    hideGraphLineMenu();
    const menu = document.createElement('div');
    menu.className = 'fin-link-graph-line-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `<div class="fin-link-graph-line-menu-item" data-action="delete"><span class="material-icons" style="font-size:15px;vertical-align:middle;margin-right:4px;">link_off</span>删除关联线</div>`;
    finLinkGraphView.appendChild(menu);
    finLinkGraphMenu = menu;

    menu.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        removeFinLink(edge.linkId);
        hideGraphLineMenu();
    });

    setTimeout(() => {
        const close = (ev) => {
            if (!menu.contains(ev.target)) {
                hideGraphLineMenu();
                document.removeEventListener('pointerdown', close, true);
            }
        };
        document.addEventListener('pointerdown', close, true);
    }, 0);
};

const hideGraphLineMenu = () => {
    if (finLinkGraphMenu) {
        finLinkGraphMenu.remove();
        finLinkGraphMenu = null;
    }
};

// 图谱鼠标滚轮缩放
if (finLinkGraphView) {
    finLinkGraphView.addEventListener('wheel', (e) => {
        if (!finLinkGraphMode) return;
        e.preventDefault();
        const viewRect = finLinkGraphView.getBoundingClientRect();
        const mouseX = e.clientX - viewRect.left;
        const mouseY = e.clientY - viewRect.top;

        const oldScale = finLinkGraphScale;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        let newScale = oldScale * delta;
        newScale = Math.max(0.3, Math.min(3, newScale));

        // 以鼠标位置为缩放中心
        finLinkGraphPanX = mouseX - (mouseX - finLinkGraphPanX) * (newScale / oldScale);
        finLinkGraphPanY = mouseY - (mouseY - finLinkGraphPanY) * (newScale / oldScale);
        finLinkGraphScale = newScale;
        applyGraphTransform();
    }, { passive: false });

    // 按住空白区域拖拽平移 + 点击连线弹出菜单
    finLinkGraphView.addEventListener('pointerdown', (e) => {
        if (!finLinkGraphMode) return;
        // 如果点击的是节点或锚点，不触发平移
        if (e.target.closest('.fin-link-graph-node')) return;
        // 如果点击的是菜单，不触发
        if (e.target.closest('.fin-link-graph-line-menu')) return;
        // 如果点击的是右侧滑动面板，不触发平移
        if (e.target.closest('.fin-link-graph-panel')) return;
        e.preventDefault();
        hideGraphLineMenu();
        const viewRect = finLinkGraphView.getBoundingClientRect();
        const clickX = e.clientX - viewRect.left;
        const clickY = e.clientY - viewRect.top;
        finLinkGraphPanning = true;
        const startX = e.clientX;
        const startY = e.clientY;
        const startPanX = finLinkGraphPanX;
        const startPanY = finLinkGraphPanY;
        let hasMoved = false;
        finLinkGraphView.style.cursor = 'grabbing';

        const onMove = (ev) => {
            if (!finLinkGraphPanning) return;
            if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) hasMoved = true;
            finLinkGraphPanX = startPanX + (ev.clientX - startX);
            finLinkGraphPanY = startPanY + (ev.clientY - startY);
            applyGraphTransform();
        };
        const onUp = () => {
            finLinkGraphPanning = false;
            finLinkGraphView.style.cursor = '';
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            // 如果没有移动，视为点击 → 检测是否点中连线
            if (!hasMoved) {
                const edge = hitTestGraphEdge(clickX, clickY);
                if (edge) {
                    showGraphLineMenu(clickX, clickY, edge);
                }
            }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });
}

// 切换图谱视图
const toggleFinLinkGraph = async () => {
    finLinkGraphMode = !finLinkGraphMode;
    if (finLinkGraphMode) {
        finLinkGraphToggle.classList.add('active');
        finLinkLeftPanel.classList.add('hidden');
        finLinkRightPanel.classList.add('hidden');
        finLinkCanvas.classList.add('hidden');
        finLinkGraphView.classList.remove('hidden');
        await renderFinLinkGraph();
    } else {
        closeGraphLinkPanel();
        finLinkGraphToggle.classList.remove('active');
        finLinkLeftPanel.classList.remove('hidden');
        finLinkRightPanel.classList.remove('hidden');
        finLinkCanvas.classList.remove('hidden');
        finLinkGraphView.classList.add('hidden');
        resizeFinLinkCanvas();
        drawFinLinkCanvas();
    }
};

if (finLinkGraphToggle) finLinkGraphToggle.addEventListener('click', toggleFinLinkGraph);

// === 图谱加号 → 右侧滑动选择面板 ===

// 打开右侧滑动面板
const openGraphLinkPanel = async (fromId, fromDateKey, item) => {
    if (!finLinkGraphPanel) return;
    finLinkGraphPanelSourceNode = { fromId, fromDateKey, item };

    // 显示源节点信息
    const val = parseFloat(item.amount);
    const typeLabel = item.type === 'income' ? meowI18n.t('income') : item.type === 'deposit' ? meowI18n.t('deposit') : meowI18n.t('expense');
    if (finLinkGraphPanelSource) {
        finLinkGraphPanelSource.innerHTML = `
            <div class="fin-link-graph-panel-source-note">${escapeHtml(item.note || 'No note')}</div>
            <div class="fin-link-graph-panel-source-meta">${typeLabel} · ${fromDateKey} · ${item.type==='income'?'+':'-'}${val.toFixed(2)}</div>
        `;
    }

    // 初始化日期选择器（只初始化一次）
    if (!finLinkGraphPanelDatePicker && finLinkGraphPanelDateInput && typeof flatpickr !== 'undefined') {
        const localeStr = (window.meowI18n && window.meowI18n.lang === 'zh-TW') ? 'zh_tw' : (window.meowI18n && window.meowI18n.lang === 'en' ? 'en' : 'zh');
        finLinkGraphPanelDatePicker = flatpickr(finLinkGraphPanelDateInput, {
            locale: localeStr,
            dateFormat: 'Y-m-d',
            disableMobile: true,
            onChange: (dates) => {
                if (dates[0]) {
                    const d = dates[0];
                    finLinkGraphPanelDate = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
                }
                renderGraphPanelList();
            }
        });
    }

    // 默认选择源节点的日期
    finLinkGraphPanelDate = fromDateKey;
    if (finLinkGraphPanelDatePicker) {
        const pk = fromDateKey.split('-');
        finLinkGraphPanelDatePicker.setDate(new Date(parseInt(pk[0]), parseInt(pk[1]) - 1, parseInt(pk[2])), false);
    }
    if (finLinkGraphPanelDateInput) finLinkGraphPanelDateInput.value = fromDateKey;

    // 滑出面板
    finLinkGraphPanel.classList.add('open');

    // 渲染列表
    await renderGraphPanelList();
};

// 关闭右侧滑动面板
const closeGraphLinkPanel = () => {
    if (finLinkGraphPanel) finLinkGraphPanel.classList.remove('open');
    finLinkGraphPanelSourceNode = null;
};

// 渲染面板中的账本列表
const renderGraphPanelList = async () => {
    if (!finLinkGraphPanelList || !finLinkGraphPanelSourceNode || !finLinkGraphPanelDate) return;
    const { fromId, fromDateKey } = finLinkGraphPanelSourceNode;

    const data = await getStorageData(`fin_${finLinkGraphPanelDate}`);
    const list = Array.isArray(data) ? data : [];
    if (ensureFinIds(list)) {
        chrome.storage.sync.set({ [`fin_${finLinkGraphPanelDate}`]: list });
    }

    finLinkGraphPanelList.innerHTML = '';
    if (list.length === 0) {
        finLinkGraphPanelList.innerHTML = '<div class="fin-link-graph-panel-empty">该日暂无账本记录</div>';
        return;
    }

    list.forEach((item) => {
        const val = parseFloat(item.amount);
        const typeLabel = item.type === 'income' ? meowI18n.t('income') : item.type === 'deposit' ? meowI18n.t('deposit') : meowI18n.t('expense');
        const linked = isLinked(fromId, item.id);
        const isSelf = (item.id === fromId && finLinkGraphPanelDate === fromDateKey);

        const el = document.createElement('div');
        el.className = 'fin-link-graph-panel-item' + (linked ? ' linked' : '') + (isSelf ? ' self' : '');
        el.innerHTML = `
            <div class="fin-link-graph-panel-item-row">
                <span class="fin-link-graph-panel-item-note">${escapeHtml(item.note || 'No note')}</span>
                <span class="fin-link-graph-panel-item-amount ${item.type==='income'?'inc':item.type==='deposit'?'dep':'exp'}">${item.type==='income'?'+':'-'}${val.toFixed(2)}</span>
            </div>
            <div class="fin-link-graph-panel-item-meta">${typeLabel}${linked ? ' · 已关联' : ''}${isSelf ? ' · 当前节点' : ''}</div>
        `;
        if (!isSelf && !linked) {
            el.addEventListener('click', () => {
                createFinLink(fromId, fromDateKey, item.id, finLinkGraphPanelDate);
                renderGraphPanelList();
            });
        }
        finLinkGraphPanelList.appendChild(el);
    });
};

// 面板关闭按钮事件
if (finLinkGraphPanelClose) {
    finLinkGraphPanelClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeGraphLinkPanel();
    });
}

// === 备注历史记录 ===
const loadFinNoteHistory = async () => {
    const data = await getStorageData('meow_fin_note_history');
    finNoteHistory = Array.isArray(data) ? data : [];
    renderFinNoteHistory();
};

const renderFinNoteHistory = () => { /* no-op: 下拉列表在输入时动态生成 */ };

// 获取过滤后的候选项
const getFilteredNotes = () => {
    const input = finNote.value.trim().toLowerCase();
    if (!input) return finNoteHistory.slice();
    return finNoteHistory.filter(n => n.toLowerCase().includes(input));
};

// 渲染下拉列表
const renderFinNoteDropdown = (notes) => {
    if (!finNoteDropdown) return;
    finNoteDropdown.innerHTML = '';
    if (notes.length === 0) {
        hideFinNoteDropdown();
        return;
    }
    notes.forEach((note, i) => {
        const item = document.createElement('div');
        item.className = 'fin-note-dropdown-item';
        if (i === finNoteActiveIndex) item.classList.add('active');
        item.textContent = note;
        item.addEventListener('mousedown', (e) => {
            e.preventDefault(); // 防止 input 失焦
            finNote.value = note;
            hideFinNoteDropdown();
            finNote.focus();
        });
        finNoteDropdown.appendChild(item);
    });
    finNoteDropdown.classList.remove('hidden');
};

const hideFinNoteDropdown = () => {
    if (finNoteDropdown) finNoteDropdown.classList.add('hidden');
    finNoteActiveIndex = -1;
};

const updateFinNoteActiveItem = () => {
    if (!finNoteDropdown) return;
    const items = finNoteDropdown.querySelectorAll('.fin-note-dropdown-item');
    items.forEach((item, i) => {
        item.classList.toggle('active', i === finNoteActiveIndex);
    });
    // 滚动到可视区域
    if (finNoteActiveIndex >= 0 && items[finNoteActiveIndex]) {
        items[finNoteActiveIndex].scrollIntoView({ block: 'nearest' });
    }
};

const updateFinNoteHistory = (note) => {
    const trimmed = (note || '').trim();
    if (!trimmed) return;
    // 去重：先移除已有的相同项，再放到最前面
    finNoteHistory = finNoteHistory.filter(n => n !== trimmed);
    finNoteHistory.unshift(trimmed);
    // 只保留最近 10 条
    if (finNoteHistory.length > 10) finNoteHistory = finNoteHistory.slice(0, 10);
    chrome.storage.sync.set({ 'meow_fin_note_history': finNoteHistory });
    renderFinNoteHistory();
};

// === 预支出功能 ===
let editingPeIndex = -1;

// 检查每月重复任务的指定日期是否已过本月
const getLastDayOfMonth = (year, month) => new Date(year, month + 1, 0).getDate();

const getEffectiveRecurDay = (item, year, month) => {
    const day = item.recurDay || 1;
    const lastDay = getLastDayOfMonth(year, month);
    return Math.min(day, lastDay);
};

const isRecurDayPassed = (item) => {
    if (!item.recurring) return false;
    const now = new Date();
    const effectiveDay = getEffectiveRecurDay(item, now.getFullYear(), now.getMonth());
    return now.getDate() > effectiveDay;
};

const loadPreExpenses = async () => {
    const data = await getStorageData('meow_pre_expenses');
    preExpensesList = Array.isArray(data) ? data : [];
    // 向后兼容：旧数据缺少字段
    preExpensesList.forEach(item => {
        if (item.recurring === undefined) item.recurring = false;
        if (item.recurDay === undefined) item.recurDay = 1;
        if (item.enabled === undefined) item.enabled = true; // 默认启用
    });
    checkAndResetRecurring();
    await autoAddPlannedIncome();
};

const savePreExpenses = () => {
    chrome.storage.sync.set({ 'meow_pre_expenses': preExpensesList }, () => {
        renderPreExpensesView();
        renderCalendar(); // 更新日历上的财务规划角标
        checkAndHighlightTabs(selectedDateKey); // 更新tab红点状态
    });
};

// 检查并重置周期性的财务规划项
const checkAndResetRecurring = () => {
    const now = new Date();
    const currentDay = now.getDate();
    let changed = false;

    preExpensesList.forEach(item => {
        if (!item.recurring || !item.enabled) return;
        // 如果 item 没有 lastResetMonth，默认用当前月
        if (!item.lastResetMonth) {
            item.lastResetMonth = `${now.getFullYear()}-${now.getMonth() + 1}`;
            changed = true;
        }
        const resetKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
        const effectiveDay = getEffectiveRecurDay(item, now.getFullYear(), now.getMonth());
        // 如果当前月尚未重置，且今天已到达或超过指定日
        if (item.lastResetMonth !== resetKey && currentDay >= effectiveDay) {
            item.completed = false;
            item.lastResetMonth = resetKey;
            changed = true;
        }
    });

    if (changed) {
        chrome.storage.sync.set({ 'meow_pre_expenses': preExpensesList });
    }
};

// 自动将到期的收入项计入财务账本（仅对开启每月重复的收入项生效）
const autoAddPlannedIncome = async () => {
    const now = new Date();
    const currentDay = now.getDate();
    const thisMonth = `${now.getFullYear()}-${now.getMonth() + 1}`;
    let changed = false;

    for (let i = 0; i < preExpensesList.length; i++) {
        const item = preExpensesList[i];
        if (item.type !== 'income' || !item.recurring || !item.enabled || item.completed) continue;
        if (item.lastAutoAddMonth === thisMonth) continue;

        const effectiveDay = getEffectiveRecurDay(item, now.getFullYear(), now.getMonth());
        if (currentDay < effectiveDay) continue;

        // 构建目标日期的 key
        const targetKey = `${now.getFullYear()}-${now.getMonth() + 1}-${effectiveDay}`;
        let finData = await getStorageData(`fin_${targetKey}`);
        let finList = Array.isArray(finData) ? finData : [];

        finList.push({
            type: 'income',
            amount: item.amount,
            note: item.name,
            id: genFinId(),
            tags: [{ text: '财务规划', color: getRandomColor() }]
        });

        await new Promise(resolve => {
            chrome.storage.sync.set({ [`fin_${targetKey}`]: finList }, resolve);
        });

        item.completed = true;
        item.lastAutoAddMonth = thisMonth;
        changed = true;
    }

    if (changed) {
        chrome.storage.sync.set({ 'meow_pre_expenses': preExpensesList });
    }
};

const renderPreExpensesView = () => {
    peList.innerHTML = "";
    let total = 0, necTotal = 0, unnecTotal = 0, incomeTotal = 0;
    let hasUncompletedItems = false; // 跟踪是否有未完成项

    // 计算各分类数量
    let allCount = 0, ongoingCount = 0, completedCount = 0, recurringCount = 0;
    preExpensesList.forEach(item => {
        allCount++;
        if (!item.completed && !(item.recurring && isRecurDayPassed(item))) ongoingCount++;
        if (item.completed) completedCount++;
        if (item.recurring) recurringCount++;
    });
    document.getElementById('pe-stat-all').textContent = allCount;
    document.getElementById('pe-stat-ongoing').textContent = ongoingCount;
    document.getElementById('pe-stat-completed').textContent = completedCount;
    document.getElementById('pe-stat-recurring').textContent = recurringCount;

    // 处理筛选标签状态
    const peStatBadges = document.querySelectorAll('#view-pre-expenses .pe-subtab-panel.active .stat-badge');
    peStatBadges.forEach(badge => {
        badge.classList.remove('active');
        if (badge.dataset.filter === peFilter) {
            badge.classList.add('active');
        }
        badge.onclick = () => {
            peFilter = badge.dataset.filter;
            renderPreExpensesView();
        };
    });

    // 根据筛选条件过滤显示列表
    const filteredItems = preExpensesList.map((item, index) => ({ ...item, originalIndex: index }))
        .filter(item => {
            if (peFilter === 'all') return true;
            if (peFilter === 'ongoing') return !item.completed && !(item.recurring && isRecurDayPassed(item));
            if (peFilter === 'completed') return item.completed === true;
            if (peFilter === 'recurring') return item.recurring === true;
            return true;
        });

    // 统计所有未完成项的金额（不受筛选影响）
    preExpensesList.forEach(item => {
        // 被禁用的项不计入统计
        if (item.recurring && !item.enabled) return;
        if (!item.completed) {
            const amt = parseFloat(item.amount);
            if (item.type === 'income') incomeTotal += amt;
            else total += amt;
            if (item.type === 'necessary') necTotal += amt;
            else if (item.type === 'unnecessary') unnecTotal += amt;
            hasUncompletedItems = true;
        }
    });

    if (filteredItems.length === 0) {
        emptyStatePe.classList.remove("hidden");
    } else {
        emptyStatePe.classList.add("hidden");
        filteredItems.forEach((item) => {
            const index = item.originalIndex;
            const amount = parseFloat(item.amount);
            const isCompleted = item.completed === true;

            const li = document.createElement("li");
            const isDisabled = item.recurring && item.enabled === false;
            li.className = `pe-item ${item.type}${isCompleted ? ' completed' : ''}${isDisabled ? ' disabled' : ''}`; 
            if (index === editingPeIndex) li.style.backgroundColor = "#f0f9ff";
            const typeLabel = item.type === 'necessary' ? meowI18n.t('pre_necessary') : item.type === 'income' ? meowI18n.t('pre_income') : meowI18n.t('pre_unnecessary');
            const checkboxTitle = item.type === 'income' && item.recurring ? '每月指定日期自动计入收入' : '计入当天并完成';
            const enabledToggleHtml = item.recurring ? `<label class="pe-enabled-toggle" title="启用/禁用此重复项">
                <input type="checkbox" class="pe-enabled-checkbox" ${item.enabled !== false ? 'checked' : ''}>
                <span class="pe-toggle-track-sm">
                    <span class="pe-toggle-thumb-sm"></span>
                </span>
            </label>` : '';
            
            li.innerHTML = `
                ${enabledToggleHtml}
                ${!item.recurring ? '<input type="checkbox" class="pe-checkbox" ' + (isCompleted ? 'checked' : '') + ' title="' + checkboxTitle + '">' : ''}
                <div class="pe-info">
                    <span class="pe-title" data-tooltip="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                </div>
                <div style="display:flex; align-items:center;">
                    <span class="pe-amount">¥${amount.toFixed(2)}</span>
                    <span class="material-icons edit-btn" title="编辑" style="cursor:pointer;font-size:18px;color:#64748b;margin-left:8px;">edit</span>
                    <span class="material-icons delete-btn" title="删除" style="cursor:pointer;font-size:18px;color:#64748b;margin-left:4px;">close</span>
                </div>
                <span class="pe-meta">${item.recurring ? '<span class="pe-recur-badge"><span class="material-icons">repeat</span>' + (item.recurDay || 1) + '号</span>' : ''}<span>${typeLabel}</span>${item.recurring && item.enabled === false ? '<span class="pe-recur-pending-badge"><span class="material-icons">schedule</span>本月待完成</span>' : item.recurring ? '<span class="pe-recur-done-badge"><span class="material-icons">check_circle</span>本月已完成</span>' : ''}</span>
            `;
            
            // 复选框事件：勾选后标记完成（仅非重复项有复选框）
            const peCheckbox = li.querySelector('.pe-checkbox');
            if (peCheckbox) {
            peCheckbox.addEventListener('change', async (e) => {
                if (e.target.checked && !item.completed) {
                    if (item.type === 'income' && item.recurring) {
                        // 重复收入项：由 autoAddPlannedIncome 在指定日期自动计入财务账本
                        preExpensesList[index].completed = true;
                        savePreExpenses();
                    } else {
                        // 一次性收入或支出：立即计入当天财务账本
                        const today = new Date();
                        const todayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
                        const finType = item.type === 'income' ? 'income' : 'expense';
                        
                        let finData = await getStorageData(`fin_${todayKey}`);
                        let finList = Array.isArray(finData) ? finData : [];
                        
                        finList.push({
                            type: finType,
                            amount: item.amount,
                            note: item.name,
                            id: genFinId(),
                            tags: [{ text: '财务规划', color: getRandomColor() }]
                        });
                        
                        await new Promise(resolve => {
                            chrome.storage.sync.set({ [`fin_${todayKey}`]: finList }, resolve);
                        });
                        
                        preExpensesList[index].completed = true;
                        savePreExpenses();
                        
                        if (selectedDateKey === todayKey) {
                            currentFinList = finList;
                            renderFinanceView();
                            renderCalendar();
                        }
                    }
                } else if (!e.target.checked && item.completed) {
                    // 取消完成：仅恢复状态
                    preExpensesList[index].completed = false;
                    savePreExpenses();
                }
            });
            } // end if (peCheckbox)
            
            // 手动启用/禁用开关事件
            const enabledCheckbox = li.querySelector('.pe-enabled-checkbox');
            if (enabledCheckbox) {
                enabledCheckbox.addEventListener('change', (e) => {
                    preExpensesList[index].enabled = e.target.checked;
                    savePreExpenses();
                });
            }
            
            li.querySelector('.edit-btn').addEventListener('click', () => enterPeEditMode(index, item));
            li.querySelector('.delete-btn').addEventListener('click', async () => {
                if (await showConfirmDialog({ message: meowI18n.t('delete_confirm'), type: 'danger' })) {
                    if (editingPeIndex === index) exitPeEditMode();
                    preExpensesList.splice(index, 1);
                    savePreExpenses();
                }
            });
            peList.appendChild(li);
        });
    }

    peTotal.textContent = total.toFixed(2);
    peNecessary.textContent = necTotal.toFixed(2);
    peUnnecessary.textContent = unnecTotal.toFixed(2);
    if (peIncome) peIncome.textContent = incomeTotal.toFixed(2);

    // 更新左侧面板的预支出摘要
    const peLeftNecessary = document.getElementById('pe-left-necessary');
    const peLeftUnnecessary = document.getElementById('pe-left-unnecessary');
    const peLeftIncome = document.getElementById('pe-left-income');
    const peLeftTotal = document.getElementById('pe-left-total');
    const peLeftSummary = document.getElementById('pre-expense-left-summary');
    
    if (peLeftNecessary) peLeftNecessary.textContent = '¥' + necTotal.toFixed(2);
    if (peLeftUnnecessary) peLeftUnnecessary.textContent = '¥' + unnecTotal.toFixed(2);
    if (peLeftIncome) peLeftIncome.textContent = '¥' + incomeTotal.toFixed(2);
    if (peLeftTotal) peLeftTotal.textContent = '¥' + total.toFixed(2);
    
    // 当没有需要规划的金额时，隐藏预支出摘要区域
    if (peLeftSummary) {
        if (total > 0 || incomeTotal > 0) {
            peLeftSummary.classList.remove('hidden');
        } else {
            peLeftSummary.classList.add('hidden');
        }
    }

    // 绑定标题自定义 tooltip
    bindPECustomTooltips();
};

// 自定义 tooltip — 绑定到含 data-tooltip 的元素（日历图标 Tooltip 风格）
const peTooltipEl = (() => {
    const el = document.createElement('div');
    el.className = 'pe-custom-tooltip';
    document.body.appendChild(el);
    return el;
})();
let peTooltipTimer = null;

const bindPECustomTooltips = () => {
    document.querySelectorAll('#pe-list .pe-title[data-tooltip]').forEach(el => {
        // 避免重复绑定
        if (el._peTooltipBound) return;
        el._peTooltipBound = true;
        
        el.addEventListener('mouseenter', (e) => {
            clearTimeout(peTooltipTimer);
            peTooltipEl.textContent = el.getAttribute('data-tooltip');
            const rect = el.getBoundingClientRect();
            peTooltipEl.style.left = rect.left + 'px';
            peTooltipEl.style.top = (rect.bottom + 4) + 'px';
            peTooltipEl.style.display = 'block';
            // 触发重排后添加 show class 以启动动画
            void peTooltipEl.offsetWidth;
            peTooltipEl.classList.add('show');
        });
        
        el.addEventListener('mousemove', (e) => {
            const rect = el.getBoundingClientRect();
            peTooltipEl.style.left = rect.left + 'px';
            peTooltipEl.style.top = (rect.bottom + 4) + 'px';
        });
        
        el.addEventListener('mouseleave', () => {
            peTooltipTimer = setTimeout(() => {
                peTooltipEl.classList.remove('show');
                peTooltipEl.style.display = 'none';
            }, 100);
        });
    });
};

const enterPeEditMode = (index, item) => {
    editingPeIndex = index;
    peType.value = item.type;
    peAmount.value = item.amount;
    peName.value = item.name;
    peRecurToggle.checked = item.recurring === true;
    peRecurDay.value = item.recurDay || 1;
    peRecurDayGroup.classList.toggle('hidden', !item.recurring);
    addPeBtn.innerHTML = '<span class="material-icons">save</span>';
    // 切换到添加子标签
    switchPeSubtab('add');
    peAmount.focus();
};

const exitPeEditMode = () => {
    editingPeIndex = -1;
    peType.value = 'necessary';
    peAmount.value = '';
    peName.value = '';
    peRecurToggle.checked = false;
    peRecurDay.value = 1;
    peRecurDayGroup.classList.add('hidden');
    addPeBtn.innerHTML = '<span class="material-icons">add</span>';
    // 切回列表子标签
    switchPeSubtab('list');
    renderPreExpensesView();
};

const addPreExpense = () => {
    const name = peName.value.trim();
    const amount = parseFloat(peAmount.value);
    const type = peType.value;
    const recurring = peRecurToggle.checked;
    const recurDay = parseInt(peRecurDay.value) || 1;

    if (!name || isNaN(amount) || amount <= 0) {
        alert("Invalid input");
        return;
    }

    if (editingPeIndex > -1) {
        preExpensesList[editingPeIndex] = {
            id: preExpensesList[editingPeIndex].id,
            name, amount, type,
            recurring, recurDay,
            completed: preExpensesList[editingPeIndex].completed || false,
            enabled: preExpensesList[editingPeIndex].enabled !== false,
            lastResetMonth: preExpensesList[editingPeIndex].lastResetMonth || `${currYear}-${currMonth + 1}`,
            lastAutoAddMonth: preExpensesList[editingPeIndex].lastAutoAddMonth || ''
        };
        exitPeEditMode();
    } else {
        preExpensesList.push({
            id: Date.now(), name, amount, type,
            recurring, recurDay,
            completed: false,
            enabled: true,
            lastResetMonth: `${currYear}-${currMonth + 1}`
        });
        peName.value = "";
        peAmount.value = "";
        peRecurToggle.checked = false;
        peRecurDayGroup.classList.add('hidden');
    }
    savePreExpenses();
    updatePeNameHistory(name);
    // 添加后返回
    if (peBackToggle && peBackToggle.checked && editingPeIndex === -1) {
        switchPeSubtab('list');
    }
    peAmount.focus();
};

addPeBtn.addEventListener("click", addPreExpense);
peName.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        if (peNameEnterConsumed) { peNameEnterConsumed = false; return; }
        addPreExpense();
    }
});
peAmount.addEventListener("keypress", (e) => { if (e.key === "Enter") addPreExpense(); });

// === 财务规划项目名称历史下拉框 ===
const loadPeNameHistory = async () => {
    const data = await getStorageData('meow_pe_name_history');
    peNameHistory = Array.isArray(data) ? data : [];

    // 如果历史为空，从现有财务规划项中预填充
    if (peNameHistory.length === 0 && preExpensesList.length > 0) {
        const names = new Set();
        preExpensesList.forEach(item => {
            if (item && item.name && item.name.trim()) {
                names.add(item.name.trim());
            }
        });
        if (names.size > 0) {
            peNameHistory = Array.from(names).slice(0, 10);
            chrome.storage.sync.set({ 'meow_pe_name_history': peNameHistory });
        }
    }
};

const getFilteredPeNames = () => {
    const input = peName.value.trim().toLowerCase();
    if (!input) return peNameHistory.slice();
    return peNameHistory.filter(n => n.toLowerCase().includes(input));
};

const renderPeNameDropdown = (names) => {
    if (!peNameDropdown) return;
    peNameDropdown.innerHTML = '';
    if (names.length === 0) {
        hidePeNameDropdown();
        return;
    }
    names.forEach((name, i) => {
        const item = document.createElement('div');
        item.className = 'pe-name-dropdown-item';
        if (i === peNameActiveIndex) item.classList.add('active');
        item.textContent = name;
        item.addEventListener('mousedown', (e) => {
            e.preventDefault(); // 防止 input 失焦
            peName.value = name;
            hidePeNameDropdown();
            peName.focus();
        });
        peNameDropdown.appendChild(item);
    });
    peNameDropdown.classList.remove('hidden');
};

const hidePeNameDropdown = () => {
    if (peNameDropdown) peNameDropdown.classList.add('hidden');
    peNameActiveIndex = -1;
};

const updatePeNameActiveItem = () => {
    if (!peNameDropdown) return;
    const items = peNameDropdown.querySelectorAll('.pe-name-dropdown-item');
    items.forEach((item, i) => {
        item.classList.toggle('active', i === peNameActiveIndex);
    });
    if (peNameActiveIndex >= 0 && items[peNameActiveIndex]) {
        items[peNameActiveIndex].scrollIntoView({ block: 'nearest' });
    }
};

const updatePeNameHistory = (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    peNameHistory = peNameHistory.filter(n => n !== trimmed);
    peNameHistory.unshift(trimmed);
    if (peNameHistory.length > 10) peNameHistory = peNameHistory.slice(0, 10);
    chrome.storage.sync.set({ 'meow_pe_name_history': peNameHistory });
};

// 项目名称历史下拉框事件
let peNameEnterConsumed = false;

peName.addEventListener('input', () => {
    peNameActiveIndex = -1;
    const names = getFilteredPeNames();
    if (names.length > 0) renderPeNameDropdown(names);
    else hidePeNameDropdown();
});

peName.addEventListener('focus', () => {
    if (peNameHistory.length === 0) return;
    peNameActiveIndex = -1;
    const names = getFilteredPeNames();
    if (names.length > 0) renderPeNameDropdown(names);
});

peName.addEventListener('blur', () => {
    setTimeout(hidePeNameDropdown, 150);
});

peName.addEventListener('keydown', (e) => {
    if (peNameDropdown && peNameDropdown.classList.contains('hidden')) return;
    const items = peNameDropdown ? peNameDropdown.querySelectorAll('.pe-name-dropdown-item') : [];
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        peNameActiveIndex = (peNameActiveIndex + 1) % items.length;
        updatePeNameActiveItem();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        peNameActiveIndex = (peNameActiveIndex - 1 + items.length) % items.length;
        updatePeNameActiveItem();
    } else if (e.key === 'Enter') {
        if (peNameActiveIndex >= 0 && items[peNameActiveIndex]) {
            e.preventDefault();
            peName.value = items[peNameActiveIndex].textContent;
            hidePeNameDropdown();
            peNameEnterConsumed = true;
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        hidePeNameDropdown();
    }
});

// 预支出子标签页切换
function switchPeSubtab(tab) {
    peSubtab = tab;
    document.querySelectorAll('.pe-subtab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pertab === tab);
    });
    document.querySelectorAll('.pe-subtab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.pertab === tab);
    });
    if (tab === 'list' && editingPeIndex > -1) {
        exitPeEditMode();
    }
}
document.querySelectorAll('.pe-subtab').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        switchPeSubtab(btn.dataset.pertab);
    });
});

