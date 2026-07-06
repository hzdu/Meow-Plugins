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
        cities.forEach(city => {
            const item = document.createElement('div');
            item.className = 'clock-item';
            item.id = 'clock-item-' + city.zone.replace(/\//g, '-');
            item.innerHTML = `
                <div class="clock-city-info">
                    <div class="clock-city-name">${meowI18n.t(city.key)}</div>
                    <div class="clock-city-diff" id="diff-${city.zone.replace(/\//g, '-')}">--</div>
                </div>
                <div class="clock-right-col">
                    <div class="clock-city-time" id="time-${city.zone.replace(/\//g, '-')}">--:--</div>
                    <div class="clock-city-date" id="date-${city.zone.replace(/\//g, '-')}">--</div>
                </div>
            `;
            listEl.appendChild(item);
        });
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

// 监听 Tab 切换如果切走了就停止计时器节省资源
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
         if (btn.dataset.target !== 'clock' && clockInterval) {
             clearInterval(clockInterval);
             clockInterval = null;
         }
    });
});

// ================== 启动初始化 ==================
initSidepanel();
