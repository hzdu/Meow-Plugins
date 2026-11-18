// sp-clock.js - 国际时钟模块 + 初始化调用入口
// 此文件由 sidepanel.js 拆分而来

// ================== CLOCK (国际时钟) ==================
const cities = [
    { key: 'clock_washington', zone: 'America/New_York' },
    { key: 'clock_phoenix', zone: 'America/Phoenix' },
    { key: 'clock_moscow', zone: 'Europe/Moscow' },
    { key: 'clock_london', zone: 'Europe/London' },
    { key: 'clock_munich', zone: 'Europe/Berlin' },
    { key: 'clock_sydney', zone: 'Australia/Sydney' },
    { key: 'clock_saopaulo', zone: 'America/Sao_Paulo' }
];

// 用户拖拽保存的城市顺序（zone 数组）
let worldClockOrder = null;

function startClockTicker() {
    if (clockInterval) clearInterval(clockInterval);
    updateClock();
    clockInterval = setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();

    // 1. 更新北京时间 (主时钟)
    const currentLang = meowI18n.lang; // e.g., 'zh-CN', 'en'
    const beijingTimeStr = now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Shanghai' });
    const beijingDateStr = now.toLocaleDateString(currentLang, { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Shanghai' });

    const bjTimeEl = document.getElementById('clock-beijing-time');
    const bjDateEl = document.getElementById('clock-beijing-date');
    if (bjTimeEl) bjTimeEl.textContent = beijingTimeStr;
    if (bjDateEl) bjDateEl.textContent = beijingDateStr;

    // 2. 更新其他城市
    const listEl = document.getElementById('world-clock-list');
    if (!listEl) return;

    // 首次生成结构
    if (listEl.children.length === 0) {
        buildClockItems(listEl);
    }

    // 更新数据
    cities.forEach(city => {
        const timeEl = document.getElementById(`time-${city.zone.replace(/\//g, '-')}`);
        const dateEl = document.getElementById(`date-${city.zone.replace(/\//g, '-')}`);
        const diffEl = document.getElementById(`diff-${city.zone.replace(/\//g, '-')}`);

        if (timeEl && diffEl && dateEl) {
            // 计算该城市时间
            const cityTimeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: city.zone });

            // 格式化日期：2月14日 周五
            const cityDateStr = now.toLocaleDateString(currentLang, { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: city.zone });

            timeEl.textContent = cityTimeStr;
            dateEl.textContent = cityDateStr;

            // 计算时差 (相对于北京)
            const bjDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
            const cityDate = new Date(now.toLocaleString('en-US', { timeZone: city.zone }));

            const diffHours = (cityDate - bjDate) / (1000 * 60 * 60);
            const diffStr = diffHours >= 0 ? `+${Math.round(diffHours)}` : `${Math.round(diffHours)}`;

            diffEl.textContent = `${meowI18n.t('clock_diff_prefix')} ${diffStr}h`;
            if (diffHours < 0) diffEl.style.color = '#ef4444';
            else if (diffHours > 0) diffEl.style.color = '#10b981';
            else diffEl.style.color = '#94a3b8';
        }
    });
}

// ===== 国际时钟卡片拖拽排序 =====
// 交互与「工具箱」「服务器管理」「AI Provider」卡片保持一致：
//   · 卡片左侧 grip 手柄是唯一拖拽入口，卡片本体不参与拖拽（内容仍可选中文字）；
//   · 拖拽期间被拖卡片脱离文档流、紧贴指针移动，原位置由等大占位块顶替；
//   · 其它卡片通过 FLIP 位移补间滑向新位置，形成平滑让位的观感。
// 差异：国际时钟列表是双列 grid，落点按"指针最近卡片 + 阅读顺序（先行后列）
// 前后侧"决定，占位块一次移动到目标格，grid 自动重排其余卡片。
// 事件用委托只绑一次：buildClockItems 重建全部卡片时逐卡绑定会重复注册。
function setupClockDrag(container) {
    container = container || document.getElementById('world-clock-list');
    if (!container) return;

    // 每次重建卡片后都要刷新：补齐手柄、重排索引，并移除整卡 draggable。
    // 卡片本体绝不设置 draggable，否则在内容区按住鼠标也会被浏览器当成拖拽。
    function refreshIndices() {
        container.querySelectorAll('.clock-item').forEach((item, i) => {
            item.dataset.index = i;
            item.removeAttribute('draggable');
            if (!item.querySelector('.clock-drag-handle')) {
                const handle = document.createElement('span');
                handle.className = 'mi clock-drag-handle fa-regular fa-grip-dots-vertical';
                item.insertBefore(handle, item.firstChild);
            }
            const handle = item.querySelector('.clock-drag-handle');
            if (handle) handle.setAttribute('draggable', 'true');
        });
    }

    refreshIndices();

    // 事件委托只需绑定一次
    if (container.dataset.clockDragBound === '1') return;
    container.dataset.clockDragBound = '1';

    let dragCard = null;      // 正在拖拽的卡片
    let placeholder = null;   // 撑开空位的占位块
    let srcIndex = null;      // 拖拽起点索引
    let grabOffsetX = 0;      // 按下点相对卡片左上角的偏移
    let grabOffsetY = 0;

    // 被拖卡片已改为 fixed，视觉上不占位，不参与落点判断
    function isActiveCard(item) {
        return !!item && item !== dragCard && item.style.display !== 'none' && item.offsetParent !== null;
    }

    // 让跟随卡片贴在指针位置
    function followPointer(x, y) {
        if (!dragCard) return;
        dragCard.style.left = (x - grabOffsetX) + 'px';
        dragCard.style.top = (y - grabOffsetY) + 'px';
    }

    // 记录除被拖卡片外的布局位置。双列 grid 需要同时记录横向偏移。
    // 刻意用 offsetTop/offsetLeft（布局位置，不受 transform 影响），
    // 让位动画进行中再次测量也不会把动画位移算进去，避免误差累积。
    function snapshotPositions() {
        const map = new Map();
        container.querySelectorAll('.clock-item').forEach(item => {
            if (!isActiveCard(item)) return;
            map.set(item, { top: item.offsetTop, left: item.offsetLeft });
        });
        return map;
    }

    // FLIP：先让卡片瞬移到新布局位置并施加反向位移，再过渡回 0，形成滑入效果
    function animateLetWay(prevPositions) {
        container.querySelectorAll('.clock-item').forEach(item => {
            if (!isActiveCard(item)) return;
            const before = prevPositions.get(item);
            if (!before) return;
            const dx = before.left - item.offsetLeft;
            const dy = before.top - item.offsetTop;
            if (!dx && !dy) return;
            item.style.transition = 'none';
            item.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
            void item.offsetWidth; // 强制重排，确保反向位移先生效
            item.style.transition = 'transform .18s cubic-bezier(.2, .8, .2, 1)';
            item.style.transform = '';
        });
    }

    // 布局矩形（不受 FLIP 动画的 transform 影响，拖拽过程中测量稳定）。
    // 单元格视口位置 = 容器视口位置 + 元素相对容器的布局偏移。
    function layoutRect(el) {
        const cr = container.getBoundingClientRect();
        return {
            left: cr.left + el.offsetLeft,
            top: cr.top + el.offsetTop,
            right: cr.left + el.offsetLeft + el.offsetWidth,
            bottom: cr.top + el.offsetTop + el.offsetHeight
        };
    }

    // 把占位块移动到指针最近的槽位。
    // 槽位 = 在流项目（活动卡片 + 占位块自身）按阅读顺序（先行后列）占的单元格；
    // 占位块自身槽位也参与"最近"比较，指针停在占位块上时目标不变，落点稳定不回跳。
    // grid 行优先自动流下阅读顺序即 DOM 顺序，这里按布局位置显式排序做保证。
    function placePlaceholderAt(x, y) {
        if (!placeholder) return false;
        const cards = Array.from(container.querySelectorAll('.clock-item')).filter(isActiveCard);
        if (!cards.length) return false;

        const inFlow = cards.concat([placeholder]);
        inFlow.sort((a, b) => {
            const ra = layoutRect(a);
            const rb = layoutRect(b);
            if (Math.abs(ra.top - rb.top) > 1) return ra.top - rb.top;
            return ra.left - rb.left;
        });

        let targetIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < inFlow.length; i++) {
            const rect = layoutRect(inFlow[i]);
            const dx = Math.max(rect.left - x, 0, x - rect.right);
            const dy = Math.max(rect.top - y, 0, y - rect.bottom);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) {
                minDist = d;
                targetIdx = i;
            }
        }

        const currentIdx = inFlow.indexOf(placeholder);
        if (targetIdx === currentIdx) return false;

        // 移动到目标槽位：
        //   目标在后（targetIdx > currentIdx）→ 插到「当前占目标后一槽位」的项目前（越过它一格）
        //   目标在前（targetIdx < currentIdx）→ 插到「当前占目标槽位」的项目前
        const refIdx = targetIdx > currentIdx ? targetIdx + 1 : targetIdx;
        const ref = refIdx < inFlow.length ? inFlow[refIdx] : null;

        const prevPositions = snapshotPositions();
        container.insertBefore(placeholder, ref);
        animateLetWay(prevPositions);
        return true;
    }

    // 结束拖拽：keepPosition 为 true 表示落到占位块处，false 表示回到起点（取消）
    function finishDrag(keepPosition) {
        if (!dragCard) return;
        const card = dragCard;
        const fromIndex = srcIndex;

        if (placeholder) {
            if (keepPosition) {
                container.insertBefore(card, placeholder);
            } else {
                // 取消时按原索引复位：先从列表里排除自己，再把原索引处的卡片当锚点
                const others = Array.from(container.querySelectorAll('.clock-item')).filter(c => c !== card);
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

        // 清理让位动画的内联样式。
        // 必须先关过渡再清除位移：否则清除位移会按 CSS 的 all .2s 再滑一次，
        // 表现为 drop 后卡片额外滑行一段。归位完成后再恢复默认过渡。
        const cleanupItems = container.querySelectorAll('.clock-item');
        cleanupItems.forEach(c => {
            c.style.transition = 'none';
            c.style.transform = '';
        });
        void container.offsetWidth;
        cleanupItems.forEach(c => { c.style.transition = ''; });

        dragCard = null;

        if (!keepPosition || fromIndex === null) {
            refreshIndices();
            return;
        }

        // DOM 顺序即保存顺序，按新顺序写回 storage；顺序未变则不写
        const newOrder = Array.from(container.querySelectorAll('.clock-item'))
            .map(el => el.dataset.zone)
            .filter(Boolean);
        const unchanged = worldClockOrder && worldClockOrder.length === newOrder.length &&
            worldClockOrder.every((zone, i) => zone === newOrder[i]);
        if (!unchanged) saveWorldClockOrder();
        refreshIndices();
    }

    // 只有手柄起拖才算卡片排序；卡片内容区选中文字等原生拖拽一律忽略
    function getDragCard(e) {
        const target = e.target;
        if (!target || typeof target.closest !== 'function') return null;
        const handle = target.closest('.clock-drag-handle');
        if (!handle || !container.contains(handle)) return null;
        return handle.closest('.clock-item');
    }

    container.addEventListener('dragstart', function(e) {
        const card = getDragCard(e);
        if (!card || !isActiveCard(card)) return;

        const rect = card.getBoundingClientRect();
        dragCard = card;
        srcIndex = Array.from(container.querySelectorAll('.clock-item')).indexOf(card);
        grabOffsetX = e.clientX - rect.left;
        grabOffsetY = e.clientY - rect.top;

        // 原生拖影是浏览器拍下的快照，会和我们 fixed 跟随的卡片叠成重影，
        // 用 1×1 透明图替换掉，只保留跟随指针的那一张。
        try {
            const blank = document.createElement('canvas');
            blank.width = 1;
            blank.height = 1;
            e.dataTransfer.setDragImage(blank, 0, 0);
        } catch (_) {}

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', String(card.dataset.zone || srcIndex)); } catch (_) {}
        }

        // 占位块先顶住原位（宽度对齐网格单元），再把卡片抽出文档流
        placeholder = document.createElement('div');
        placeholder.className = 'clock-drop-placeholder';
        placeholder.style.width = rect.width + 'px';
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
        placePlaceholderAt(e.clientX, e.clientY);
    });

    container.addEventListener('drop', function(e) {
        if (!dragCard) return;
        e.preventDefault();
        e.stopPropagation();
        finishDrag(true);
    });

    container.addEventListener('dragend', function() {
        // drop 分支已处理过则 dragCard 已置空；这里兜底「拖到区域外松手」的取消
        if (dragCard) finishDrag(false);
    });

    // 指针移出列表时容器收不到 dragover，卡片会滞留在原处；
    // 用 document 捕获阶段保持跟随（不调用 preventDefault，不影响原生放置判定）
    document.addEventListener('dragover', function(e) {
        if (dragCard) followPointer(e.clientX, e.clientY);
    }, true);
}

// 生成城市卡片列表，支持拖放排序
function buildClockItems(listEl) {
    // 优先使用用户保存的顺序，未知城市保持原有相对顺序
    let ordered = cities;
    if (worldClockOrder && worldClockOrder.length) {
        const saved = worldClockOrder.map(zone => cities.find(c => c.zone === zone)).filter(Boolean);
        const rest = cities.filter(c => worldClockOrder.indexOf(c.zone) === -1);
        ordered = saved.concat(rest);
    }

    ordered.forEach(city => {
        const zoneKey = city.zone.replace(/\//g, '-');
        const item = document.createElement('div');
        item.className = 'clock-item';
        item.id = 'clock-item-' + zoneKey;
        item.dataset.zone = city.zone;
        item.innerHTML = `
                <div class="clock-city-info">
                    <div class="clock-city-name">${meowI18n.t(city.key)}</div>
                    <div class="clock-city-diff" id="diff-${zoneKey}">--</div>
                </div>
                <div class="clock-right-col">
                    <div class="clock-city-time" id="time-${zoneKey}">--:--</div>
                    <div class="clock-city-date" id="date-${zoneKey}">--</div>
                </div>
            `;

        // 拖放排序见 setupClockDrag()：手柄是唯一拖拽入口，事件统一在列表上委托

        listEl.appendChild(item);
    });

    // 卡片建好后统一整理拖拽手柄/索引（本函数每次重建列表都会被调用）
    setupClockDrag(listEl);
}

// 保存当前 DOM 顺序到 storage
function saveWorldClockOrder() {
    const listEl = document.getElementById('world-clock-list');
    if (!listEl) return;
    worldClockOrder = Array.from(listEl.querySelectorAll('.clock-item'))
        .map(el => el.dataset.zone)
        .filter(Boolean);
    chrome.storage.local.set({ 'meow_world_clock_order': worldClockOrder });
}

// 按保存的顺序重排已生成的列表
function reorderClockList() {
    const listEl = document.getElementById('world-clock-list');
    if (!listEl || !worldClockOrder || !worldClockOrder.length) return;
    const items = Array.from(listEl.querySelectorAll('.clock-item'));
    worldClockOrder.forEach(zone => {
        const item = items.find(el => el.dataset.zone === zone);
        if (item) item.parentNode.appendChild(item);
    });
}

// ================== 监听 Tab 切换 ==================
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
         if (btn.dataset.target !== 'clock' && clockInterval) {
             clearInterval(clockInterval);
             clockInterval = null;
         }
    });
});

// ================== 启动初始化 ==================
// 读取已保存的城市顺序并应用（若列表已生成则重排）
chrome.storage.local.get(['meow_world_clock_order'], (result) => {
    if (Array.isArray(result.meow_world_clock_order) && result.meow_world_clock_order.length) {
        worldClockOrder = result.meow_world_clock_order;
        reorderClockList();
    }
});

// initSidepanel 是 async 函数，此处调用必须加 .catch 避免 unhandled rejection 静默失败
// （长时间未打开侧边栏后，首次唤醒 Service Worker 可能偶发 storage API 错误）
initSidepanel().catch(err => {
    console.error("Meow: initSidepanel() threw unhandled error:", err);
    // 兜底：确保至少有一个视图显示
    try {
        const defaultBtn = document.querySelector('.tab-btn.active') || document.querySelector('.tab-btn');
        if (defaultBtn) defaultBtn.click();
    } catch (e) {
        console.error("Meow: fallback tab click failed.", e);
    }
});
