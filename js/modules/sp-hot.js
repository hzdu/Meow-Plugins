// sp-hot.js - 热门榜单模块（Tab排序、拖拽、数据获取）
// 此文件由 sidepanel.js 拆分而来

// === HOT LIST 逻辑 ===

// 应用保存的热搜Tab排序
function applySavedHotTabOrder() {
    chrome.storage.sync.get(['meow_hot_tab_order'], (result) => {
        const savedOrder = result.meow_hot_tab_order;
        if (!savedOrder || !Array.isArray(savedOrder)) return;
        const sidebar = document.querySelector('.hot-sidebar');
        if (!sidebar) return;
        const tabs = Array.from(sidebar.querySelectorAll('.hot-tab'));
        const tabMap = {};
        tabs.forEach(tab => { tabMap[tab.dataset.source] = tab; });
        savedOrder.forEach(source => {
            if (tabMap[source]) {
                sidebar.appendChild(tabMap[source]);
            }
        });
    });
}

// 保存热搜Tab排序
function saveHotTabOrder() {
    const sidebar = document.querySelector('.hot-sidebar');
    if (!sidebar) return;
    const order = Array.from(sidebar.querySelectorAll('.hot-tab')).map(tab => tab.dataset.source);
    chrome.storage.sync.set({ 'meow_hot_tab_order': order });
}

// 热搜Tab点击 + 拖拽排序
function initHotTabEvents() {
    const allHotTabs = document.querySelectorAll('.hot-tab');
    allHotTabs.forEach(tab => {
        tab.setAttribute('draggable', 'true');

        // 点击切换
        tab.addEventListener('click', () => {
            document.querySelectorAll('.hot-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            fetchHotList(tab.dataset.source);
        });

        // 拖拽开始
        tab.addEventListener('dragstart', (e) => {
            hotDragSrcEl = tab;
            tab.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tab.dataset.source);
        });

        // 拖拽经过
        tab.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (tab !== hotDragSrcEl) {
                tab.classList.add('drag-over');
            }
        });

        // 拖拽离开
        tab.addEventListener('dragleave', () => {
            tab.classList.remove('drag-over');
        });

        // 拖拽放下
        tab.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            tab.classList.remove('drag-over');
            if (hotDragSrcEl && hotDragSrcEl !== tab) {
                const sidebar = tab.parentNode;
                const tabs = Array.from(sidebar.querySelectorAll('.hot-tab'));
                const fromIdx = tabs.indexOf(hotDragSrcEl);
                const toIdx = tabs.indexOf(tab);
                if (fromIdx < toIdx) {
                    sidebar.insertBefore(hotDragSrcEl, tab.nextSibling);
                } else {
                    sidebar.insertBefore(hotDragSrcEl, tab);
                }
                saveHotTabOrder();
            }
        });

        // 拖拽结束
        tab.addEventListener('dragend', () => {
            tab.classList.remove('dragging');
            document.querySelectorAll('.hot-tab').forEach(t => t.classList.remove('drag-over'));
            hotDragSrcEl = null;
        });
    });
}

initHotTabEvents();

async function fetchHotList(source) {
    if (!hotListContainer) return;
    hotListContainer.innerHTML = '';
    if (hotLoading) hotLoading.classList.remove('hidden');
    if (hotEmpty) hotEmpty.classList.add('hidden');

    let apiPath = source;
    if (source === 'xhs') apiPath = 'rednote';
    if (source === 'baidu') apiPath = 'baidu/hot';

    try {
        const response = await fetch(`https://60s.ctnis.com/v2/${apiPath}`);
        const res = await response.json();

        if (hotLoading) hotLoading.classList.add('hidden');

        if (res.code === 200 && res.data && Array.isArray(res.data)) {
            if (res.data.length === 0) {
                if (hotEmpty) hotEmpty.classList.remove('hidden');
                return;
            }

            res.data.forEach((item, index) => {
                const div = document.createElement('div');
                div.className = 'hot-item';

                const rank = index + 1;
                const rankClass = rank <= 3 ? `top-${rank}` : '';

                let coverHtml = '';
                if (item.cover) {
                    coverHtml = `<img src="${item.cover}" class="hot-cover" loading="lazy">`;
                }

                // For some sources 'hot_value' might be different key or formatted
                let heatHtml = '';
                let heatText = '';
                if (item.hot_value) {
                    heatText = formatBigNumber(item.hot_value);
                } else if (item.hot_value_desc) {
                    heatText = item.hot_value_desc;
                } else if (item.score) {
                    heatText = item.score;
                }

                if (heatText) {
                    heatHtml = `<span class="hot-meta"><span class="material-icons" style="font-size:12px;">local_fire_department</span> ${heatText}</span>`;
                }

                div.innerHTML = `
                    <div class="hot-rank ${rankClass}">${rank}</div>
                    <div class="hot-info">
                        <div class="hot-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
                        ${heatHtml}
                    </div>
                    ${coverHtml}
                `;

                div.addEventListener('click', () => {
                    if (item.link) {
                        chrome.tabs.create({ url: item.link });
                    } else if (item.url) {
                        chrome.tabs.create({ url: item.url });
                    }
                });

                hotListContainer.appendChild(div);
            });
        } else {
            if (hotEmpty) hotEmpty.classList.remove('hidden');
            showToast(res.message || 'Fetch failed');
        }
    } catch (error) {
        console.error('Hot list fetch error:', error);
        if (hotLoading) hotLoading.classList.add('hidden');
        if (hotEmpty) hotEmpty.classList.remove('hidden');
        showToast('Network error');
    }
}

function formatBigNumber(num) {
    if (!num) return '';
    num = Number(num);
    if (isNaN(num)) return '';
    if (num >= 100000000) {
        return (num / 100000000).toFixed(1) + '亿';
    } else if (num >= 10000) {
        return (num / 10000).toFixed(1) + '万';
    }
    return num.toString();
}
