// popup-weather.js - 天气功能
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 天气功能 ===
const weatherLoading = document.getElementById('weather-loading');
const weatherContent = document.getElementById('weather-content');
const weatherError = document.getElementById('weather-error');
const weatherIcon = document.getElementById('weather-icon');
const weatherTemp = document.getElementById('weather-temp');
const weatherDesc = document.getElementById('weather-desc');
const weatherLocation = document.getElementById('weather-location');
const weatherHumidity = document.getElementById('weather-humidity');
const weatherFeels = document.getElementById('weather-feels');
const weatherLifeList = document.getElementById('weather-life-list');
const weatherRefreshBtn = document.getElementById('weather-refresh');
const weatherRetryBtn = document.getElementById('weather-retry');
const weatherCityInput = document.getElementById('weather-city-input');
const weatherCitySearchBtn = document.getElementById('weather-city-search');

let currentWeatherCity = '韶关'; // 默认城市

// 天气图标映射
const weatherIconMap = {
    'Clear': '☀️', 'Sunny': '☀️',
    'Partly cloudy': '⛅', 'Cloudy': '☁️', 'Overcast': '☁️',
    'Mist': '🌫️', 'Fog': '🌫️', 'Haze': '🌫️',
    'Light rain': '🌧️', 'Rain': '🌧️', 'Heavy rain': '🌧️', 'Patchy rain': '🌧️', 'Drizzle': '🌧️', 'Showers': '🌧️',
    'Thunderstorm': '⛈️', 'Thunder': '⛈️',
    'Light snow': '🌨️', 'Snow': '❄️', 'Heavy snow': '❄️', 'Blizzard': '❄️', 'Sleet': '🌨️',
    'default': '🌤️'
};

function getWeatherIcon(desc) {
    for (const [key, icon] of Object.entries(weatherIconMap)) {
        if (desc && desc.toLowerCase().includes(key.toLowerCase())) return icon;
    }
    return weatherIconMap['default'];
}

async function loadWeather() {
    // 加载保存的城市
    const saved = await new Promise(r => chrome.storage.local.get(['meow_weather_city', 'meow_weather_cache'], r));
    if (saved.meow_weather_city) {
        currentWeatherCity = saved.meow_weather_city;
        if (weatherCityInput) weatherCityInput.value = currentWeatherCity;
    }
    
    // 检查缓存 (30分钟) 且城市相同
    if (saved.meow_weather_cache) {
        const { data, timestamp, city } = saved.meow_weather_cache;
        if (Date.now() - timestamp < 30 * 60 * 1000 && city === currentWeatherCity) {
            displayWeather(data);
            return;
        }
    }
    fetchWeather();
}

async function fetchWeather(forceCity) {
    const city = forceCity || currentWeatherCity;
    showWeatherState('loading');
    try {
        // 使用自定义天气 API
        const res = await fetch(`https://60s.ctnis.com/v2/weather?query=${encodeURIComponent(city)}`);
        if (!res.ok) throw new Error('Network error');
        const json = await res.json();
        
        if (json.code !== 200 || !json.data) throw new Error('API error');
        
        const d = json.data;
        const weather = d.weather;
        const airQuality = d.air_quality;
        const location = d.location;
        
        const weatherData = {
            temp: weather.temperature,
            desc: weather.condition,
            location: location.name || (location.province + location.city),
            humidity: weather.humidity,
            feelsLike: weather.temperature, // API 没有体感温度，用实际温度
            wind: weather.wind_direction + ' ' + weather.wind_power + '级',
            aqi: airQuality ? airQuality.aqi : null,
            aqiQuality: airQuality ? airQuality.quality : null,
            weatherIcon: weather.weather_icon,
            sunrise: d.sunrise ? d.sunrise.sunrise_desc : null,
            sunset: d.sunrise ? d.sunrise.sunset_desc : null,
            lifeIndices: d.life_indices || []
        };
        
        // 缓存天气数据 (含城市)
        currentWeatherCity = city;
        chrome.storage.local.set({ 
            'meow_weather_cache': { data: weatherData, timestamp: Date.now(), city: city },
            'meow_weather_city': city
        });
        
        displayWeather(weatherData);
    } catch (err) {
        console.error('Weather fetch error:', err);
        showWeatherState('error');
    }
}

function displayWeather(data) {
    if (weatherIcon) weatherIcon.textContent = getWeatherIcon(data.desc);
    if (weatherTemp) weatherTemp.textContent = data.temp;
    if (weatherDesc) weatherDesc.textContent = data.desc;
    if (weatherLocation) { weatherLocation.textContent = data.location; weatherLocation.title = data.location; }
    
    // 渲染生活指数
    if (weatherLifeList && data.lifeIndices && data.lifeIndices.length > 0) {
        // 选择几个关键指数显示
        const keyIndices = ['clothes', 'umbrella', 'ultraviolet', 'sports', 'carwash', 'cold'];
        const filtered = data.lifeIndices.filter(i => keyIndices.includes(i.key));
        
        let html = '';
        
        // 1. 风力
        if (data.wind) {
            html += `<div class="weather-forecast-item">
                <span class="forecast-day">风力</span>
                <span class="forecast-icon" style="font-size:16px;">🍃</span>
                <span class="forecast-desc">${data.wind}</span>
                <div class="forecast-temps"></div>
            </div>`;
        }

        // 2. 湿度
        if (data.humidity) {
            html += `<div class="weather-forecast-item">
                <span class="forecast-day">湿度</span>
                <span class="forecast-icon" style="font-size:16px;">💧</span>
                <span class="forecast-desc">${data.humidity}%</span>
                <div class="forecast-temps"></div>
            </div>`;
        }

        // 3. 空气质量
        if (data.aqi !== null) {
            const aqiColor = data.aqi <= 50 ? '#10b981' : (data.aqi <= 100 ? '#f59e0b' : '#ef4444');
            html += `<div class="weather-forecast-item">
                <span class="forecast-day">空气质量</span>
                <span class="forecast-icon" style="font-size:16px;">🌬️</span>
                <span class="forecast-desc">AQI ${data.aqi} · ${data.aqiQuality || ''}</span>
                <div class="forecast-temps"><span style="color:${aqiColor};font-weight:600;">${data.aqiQuality || ''}</span></div>
            </div>`;
        }
        
        // 生活指数
        const iconMap = { clothes: '👔', umbrella: '☂️', ultraviolet: '☀️', sports: '🏃', carwash: '🚗', cold: '🤧' };
        filtered.forEach(idx => {
            html += `<div class="weather-forecast-item">
                <span class="forecast-day">${idx.name}</span>
                <span class="forecast-icon" style="font-size:16px;">${iconMap[idx.key] || '📋'}</span>
                <span class="forecast-desc" title="${idx.description}">${idx.level}</span>
                <div class="forecast-temps"></div>
            </div>`;
        });
        
        weatherLifeList.innerHTML = html;
    }
    
    showWeatherState('content');
}

function showWeatherState(state) {
    if (weatherLoading) weatherLoading.classList.add('hidden');
    if (weatherContent) weatherContent.classList.add('hidden');
    if (weatherError) weatherError.classList.add('hidden');
    if (state === 'loading' && weatherLoading) weatherLoading.classList.remove('hidden');
    else if (state === 'content' && weatherContent) weatherContent.classList.remove('hidden');
    else if (state === 'error' && weatherError) weatherError.classList.remove('hidden');
}

const weatherSubtabs = document.querySelectorAll('.weather-subtab');
const weatherViewRealtime = document.getElementById('weather-view-realtime');
const weatherViewForecast = document.getElementById('weather-view-forecast');
const weatherFutureList = document.getElementById('weather-future-list');

// 切换天气子标签
weatherSubtabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.subtab;
        
        // 更新标签状态
        weatherSubtabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // 切换视图
        if (target === 'realtime') {
            weatherViewRealtime.classList.remove('hidden');
            weatherViewForecast.classList.add('hidden');
        } else {
            weatherViewRealtime.classList.add('hidden');
            weatherViewForecast.classList.remove('hidden');
            loadForecast();
        }
    });
});

async function loadForecast() {
    // 检查是否有缓存的预报数据（简单处理：如果已有内容则不再请求，除非显式刷新）
    // 这里我们每次点击都检查一下是否为空，或者可以加一个时间戳缓存机制
    // 为了简单起见，如果列表为空则请求
    if (weatherFutureList.children.length <= 1) { // 只有loading元素
        fetchForecast();
    }
}

async function fetchForecast() {
    try {
        const city = currentWeatherCity; // 使用当前城市
        
        // 显示加载中
        weatherFutureList.innerHTML = `
            <div class="weather-loading-local" style="text-align:center; padding:20px; color:#6b7280;">
                <span class="material-icons spin" style="font-size:20px; vertical-align:middle;">autorenew</span> 加载中...
            </div>`;
            
        const res = await fetch(`https://60s.ctnis.com/v2/weather/forecast?query=${encodeURIComponent(city)}&day=6`);
        if (!res.ok) throw new Error('Network error');
        const json = await res.json();
        
        if (json.code !== 200 || !json.data) throw new Error('API error');
        
        displayForecast(json.data.daily_forecast);
        
    } catch (err) {
        console.error('Forecast fetch error:', err);
        weatherFutureList.innerHTML = `
            <div style="text-align:center; padding:20px; color:#ef4444; font-size:13px;">
                <span class="material-icons" style="font-size:20px; vertical-align:middle;">error_outline</span> 获取预报失败
                <div style="margin-top:8px;"><button class="weather-retry" onclick="fetchForecast()">重试</button></div>
            </div>`;
    }
}

function displayForecast(daily) {
    if (!daily || daily.length === 0) return;

    // 过滤掉今天之前的过期数据
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const filtered = daily.filter(day => day.date >= todayStr);
    if (filtered.length === 0) return;

    let html = '';

    const tmr = new Date(now);
    tmr.setDate(tmr.getDate() + 1);
    const tomorrowStr = `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, '0')}-${String(tmr.getDate()).padStart(2, '0')}`;

    const weekMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    filtered.forEach((day, index) => {
        const dateObj = new Date(day.date);
        let dayName = weekMap[dateObj.getDay()];
        
        if (day.date === todayStr) dayName = '今天';
        else if (day.date === tomorrowStr) dayName = '明天';
        
        const dateStr = day.date.substring(5).replace('-', '/'); // MM/DD
        
        html += `
            <div class="weather-future-item">
                <div class="future-date">
                    <span class="future-day">${dayName}</span>
                    <span class="future-date-text">${dateStr}</span>
                </div>
                <div class="future-icon">
                    <img src="${day.day_weather_icon}" style="width:24px; height:24px;" alt="${day.day_condition}">
                </div>
                <div class="future-cond">
                    ${day.day_condition}
                    <div style="font-size:11px; color:#9ca3af;">${day.day_wind_direction} ${day.day_wind_power}级</div>
                </div>
                <div class="future-temp-range">
                    <span class="forecast-low">${day.min_temperature}°</span>
                    <span style="color:#9ca3af;">/</span>
                    <span class="forecast-high">${day.max_temperature}°</span>
                </div>
            </div>
        `;
    });
    
    weatherFutureList.innerHTML = html;
}

if (weatherRefreshBtn) weatherRefreshBtn.addEventListener('click', () => {
    fetchWeather(); // 刷新实时天气
    // 如果当前在预报标签页，也刷新预报
    const activeTab = document.querySelector('.weather-subtab.active');
    if (activeTab && activeTab.dataset.subtab === 'forecast') {
        fetchForecast();
    }
});
if (weatherRetryBtn) weatherRetryBtn.addEventListener('click', () => fetchWeather());

// 城市搜索功能
if (weatherCitySearchBtn) {
    weatherCitySearchBtn.addEventListener('click', () => {
        const city = weatherCityInput.value.trim();
        if (city) {
            weatherFutureList.innerHTML = ''; // 清空预报缓存
            fetchWeather(city); // 这会更新全局 currentWeatherCity
            // 切换回实时天气视图，或者刷新当前视图
            const activeTab = document.querySelector('.weather-subtab.active');
            if (activeTab && activeTab.dataset.subtab === 'forecast') {
                fetchForecast();
            }
        }
    });
}
if (weatherCityInput) {
    weatherCityInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const city = weatherCityInput.value.trim();
            if (city) fetchWeather(city);
        }
    });
}

const checkAndHighlightTabs = (dateKey) => {
    chrome.storage.sync.get([dateKey, `fin_${dateKey}`, 'meow_pre_expenses', 'countdowns_config', 'habits_config', 'alarms_config', `smoking_records_${dateKey}`], (items) => {
        const todoBtn = document.querySelector('.tab-btn[data-tab="todo"]');
        if (todoBtn) {
            const hasTodo = items[dateKey] && items[dateKey].length > 0;
            if (hasTodo) todoBtn.classList.add('has-data');
            else todoBtn.classList.remove('has-data');
        }
        const finBtn = document.querySelector('.tab-btn[data-tab="finance"]');
        if (finBtn) {
            const hasFin = items[`fin_${dateKey}`] && items[`fin_${dateKey}`].length > 0;
            if (hasFin) finBtn.classList.add('has-data');
            else finBtn.classList.remove('has-data');
        }
        
        // 财务规划：有未完成的预支出项时显示红点
        const peBtn = document.querySelector('.tab-btn[data-tab="pre-expenses"]');
        if (peBtn) {
            const peList = items['meow_pre_expenses'] || [];
            const hasUncompletedPe = peList.some(item => !item.completed);
            if (hasUncompletedPe) peBtn.classList.add('has-data');
            else peBtn.classList.remove('has-data');
        }
        
        // 倒数日：有未到期的倒数日时显示红点
        const cdBtn = document.querySelector('.tab-btn[data-tab="countdowns"]');
        if (cdBtn) {
            const cdList = items['countdowns_config'] || [];
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const hasUpcoming = cdList.some(cd => {
                const [year, month, day] = cd.date.split('-').map(Number);
                const targetDate = new Date(year, month - 1, day);
                return targetDate >= today;
            });
            if (hasUpcoming) cdBtn.classList.add('has-data');
            else cdBtn.classList.remove('has-data');
        }
        
        // 习惯打卡：有习惯配置时显示红点
        const habitsBtn = document.querySelector('.tab-btn[data-tab="habits"]');
        if (habitsBtn) {
            const habitsList = items['habits_config'] || [];
            if (habitsList.length > 0) habitsBtn.classList.add('has-data');
            else habitsBtn.classList.remove('has-data');
        }
        
        // 闹钟提醒：有闹钟配置时显示红点
        const alarmsBtn = document.querySelector('.tab-btn[data-tab="alarms"]');
        if (alarmsBtn) {
            const alarmsList = items['alarms_config'] || [];
            if (alarmsList.length > 0) alarmsBtn.classList.add('has-data');
            else alarmsBtn.classList.remove('has-data');
        }
        
        // 戒烟规划：有戒烟记录时显示红点
        const smokingBtn = document.querySelector('.tab-btn[data-tab="smoking"]');
        if (smokingBtn) {
            const records = items[`smoking_records_${dateKey}`] || [];
            if (records.length > 0) smokingBtn.classList.add('has-data');
            else smokingBtn.classList.remove('has-data');
        }
    });
};

