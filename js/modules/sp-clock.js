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

        // 拖放排序
        item.draggable = true;
        item.addEventListener('dragstart', function(e) {
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.id);
        });
        item.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            document.querySelectorAll('#world-clock-list .clock-item').forEach(el => el.classList.remove('drag-over'));
        });
        item.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.classList.add('drag-over');
        });
        item.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
        });
        item.addEventListener('drop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            this.classList.remove('drag-over');
            const source = document.getElementById(e.dataTransfer.getData('text/plain'));
            const after = this;
            if (source && source !== after && source.parentNode === listEl) {
                const siblings = Array.from(listEl.children);
                const srcIdx = siblings.indexOf(source);
                const dstIdx = siblings.indexOf(after);
                const ref = dstIdx > srcIdx ? after.nextSibling : after;
                listEl.insertBefore(source, ref);
                saveWorldClockOrder();
            }
        });

        listEl.appendChild(item);
    });
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
