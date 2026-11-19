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
        // 重新排序后刷新 dataset.index，保证索引与 DOM 顺序一致
        setupHotTabDrag();
    });
}

// 上次落盘的 TAB 顺序（顺序没变就不重复写同步存储）
let hotTabOrderSnapshot = null;

// 保存热搜Tab排序
function saveHotTabOrder() {
    const sidebar = document.querySelector('.hot-sidebar');
    if (!sidebar) return;
    const order = Array.from(sidebar.querySelectorAll('.hot-tab')).map(tab => tab.dataset.source);
    // 原地放下也会走到这里，顺序没变就跳过，避免无意义的同步存储写入
    if (hotTabOrderSnapshot && hotTabOrderSnapshot.length === order.length &&
        hotTabOrderSnapshot.every((source, i) => source === order[i])) return;
    hotTabOrderSnapshot = order;
    chrome.storage.sync.set({ 'meow_hot_tab_order': order });
}

// 把当前 DOM 顺序记为已持久化的基准顺序
function syncHotTabOrderSnapshot() {
    const sidebar = document.querySelector('.hot-sidebar');
    if (!sidebar) return;
    hotTabOrderSnapshot = Array.from(sidebar.querySelectorAll('.hot-tab')).map(tab => tab.dataset.source);
}

// ===== 热门榜单左侧 TAB 拖拽排序 =====
// 交互与侧边栏「AI Provider」「服务器管理」卡片一致：
//   · TAB 只有 40×40，整块就是拖拽手柄，因此不再额外插入 grip 图标；
//   · 拖拽期间被拖 TAB 脱离文档流、紧贴指针移动，原位置由等大的虚线占位块顶替，
//     占位块随指针逐格移动，实时指示松手后的落点；
//   · 其它 TAB 通过 FLIP 位移补间平滑让位。
// 事件用委托只绑一次：TAB 只是改变 DOM 顺序，不会被重建。
function setupHotTabDrag() {
    const sidebar = document.querySelector('.hot-sidebar');
    if (!sidebar || typeof setupCardDragSort !== 'function') return;
    setupCardDragSort({
        container: sidebar,
        // TAB 本身既是卡片也是手柄：整块可拖，handleClass 为空表示不插 grip 图标
        cardSelector: '.hot-tab',
        headerSelector: '.hot-tab',
        handleClass: '',
        placeholderClass: 'hot-tab-placeholder',
        boundKey: 'hotTabDragBound',
        onReorder: function () {
            // DOM 顺序即保存顺序
            saveHotTabOrder();
        }
    });
    // 当前 DOM 顺序就是已持久化的顺序（首次进入或应用保存排序后）
    syncHotTabOrderSnapshot();
}

// 热搜Tab点击 + 拖拽排序
function initHotTabEvents() {
    const allHotTabs = document.querySelectorAll('.hot-tab');
    allHotTabs.forEach(tab => {
        // 点击切换（拖拽排序见 setupHotTabDrag，事件在容器上委托）
        tab.addEventListener('click', () => {
            document.querySelectorAll('.hot-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            fetchHotList(tab.dataset.source);
        });
    });

    setupHotTabDrag();
}

initHotTabEvents();

let hotFetchSeq = 0;

async function fetchHotList(source) {
    if (!hotListContainer) return;
    const seq = ++hotFetchSeq;
    hotListContainer.innerHTML = '';
    if (hotLoading) hotLoading.classList.remove('hidden');
    if (hotEmpty) hotEmpty.classList.add('hidden');

    let apiPath = source;
    if (source === 'xhs') apiPath = 'rednote';
    if (source === 'baidu') apiPath = 'baidu/hot';

    let fetchTimer = 0;
    try {
        // 弱网下接口可能一直不返回：10s 后主动中断，至少让界面停止转圈并给出错误态
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        if (controller) fetchTimer = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`https://60s.ctnis.com/v2/${apiPath}`, controller ? { signal: controller.signal } : undefined);
        const res = await response.json();
        if (seq !== hotFetchSeq) return; // 已切到别的榜单，丢弃过期结果

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
                if (item.cover && isSafeHtmlUrl(item.cover)) {
                    coverHtml = `<img src="${escapeHtml(item.cover)}" class="hot-cover" loading="lazy">`;
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
                    heatHtml = `<span class="hot-meta"><span class="mi fa-regular fa-fire" style="font-size:12px;"></span> ${escapeHtml(heatText)}</span>`;
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
        if (seq !== hotFetchSeq) return;
        console.error('Hot list fetch error:', error);
        if (hotLoading) hotLoading.classList.add('hidden');
        if (hotEmpty) hotEmpty.classList.remove('hidden');
        showToast('Network error');
    } finally {
        if (fetchTimer) clearTimeout(fetchTimer);
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
