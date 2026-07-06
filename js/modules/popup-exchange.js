// popup-exchange.js - 实时汇率换算
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === 实时汇率换算 (Popup) ===
(() => {
    const amount = document.getElementById('popup-exchange-amount');
    const fromSel = document.getElementById('popup-exchange-from');
    const toSel = document.getElementById('popup-exchange-to');
    const resultVal = document.getElementById('popup-exchange-result');
    const swapBtn = document.getElementById('popup-exchange-swap');
    const rateInfo = document.getElementById('popup-exchange-rate-info');
    const rateText = document.getElementById('popup-exchange-rate-text');
    const updatedTime = document.getElementById('popup-exchange-updated-time');
    const grid = document.getElementById('popup-exchange-grid');

    if (!amount || !fromSel || !toSel || !resultVal) return;

    let exchangeAutoRefresh = false;
    let focusedSelect = null;
    let focusedType = 'to';

    function setFocusedSelect(sel) {
        if (focusedSelect) {
            focusedSelect.classList.remove('exchange-select-focused', 'exchange-select-focused-to');
        }
        if (sel) {
            const row = sel.closest('.popup-exchange-input-row');
            focusedSelect = row || sel;
            const fromRow = amount.closest('.popup-exchange-input-row');
            focusedType = (focusedSelect === fromRow) ? 'from' : 'to';
        } else {
            focusedSelect = null;
            focusedType = 'to';
        }
        if (focusedSelect) {
            focusedSelect.classList.add(focusedType === 'from' ? 'exchange-select-focused' : 'exchange-select-focused-to');
        }
    }

    const currencies = {
        CNY: { name: meowI18n.t('cur_cny_name'), flag: '🇨🇳' },
        USD: { name: meowI18n.t('cur_usd_name'), flag: '🇺🇸' },
        EUR: { name: meowI18n.t('cur_eur_name'), flag: '🇪🇺' },
        GBP: { name: meowI18n.t('cur_gbp_name'), flag: '🇬🇧' },
        RUB: { name: meowI18n.t('cur_rub_name'), flag: '🇷🇺' },
        TWD: { name: meowI18n.t('cur_twd_name'), flag: '🇨🇳' },
        AUD: { name: meowI18n.t('cur_aud_name'), flag: '🇦🇺' },
        NZD: { name: meowI18n.t('cur_nzd_name'), flag: '🇳🇿' },
        CAD: { name: meowI18n.t('cur_cad_name'), flag: '🇨🇦' },
        JPY: { name: meowI18n.t('cur_jpy_name'), flag: '🇯🇵' },
        TRY: { name: meowI18n.t('cur_try_name'), flag: '🇹🇷' }
    };

    let ratesCache = {};

    async function fetchRates(base) {
        if (ratesCache[base] && (Date.now() - ratesCache[base].timestamp < 600000)) {
            return ratesCache[base];
        }
        try {
            const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`);
            const data = await res.json();
            if (data && data.rates) {
                const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                const entry = { base, rates: data.rates, time: now, timestamp: Date.now() };
                ratesCache[base] = entry;
                chrome.storage.local.set({ meow_exchange_cache: entry });
                return entry;
            }
        } catch (e) { console.error('Exchange fetch error:', e); }
        return null;
    }

    async function convert() {
        const from = fromSel.value;
        const to = toSel.value;
        const amt = parseFloat(amount.value);

        if (isNaN(amt) || amt < 0) { resultVal.value = ''; return; }
        if (from === to) {
            resultVal.value = amt.toFixed(2);
            if (rateInfo) { rateText.textContent = `1 ${from} = 1 ${to}`; rateInfo.classList.remove('hidden'); }
            return;
        }

        resultVal.value = '...';
        const data = await fetchRates(from);

        if (data && data.rates && data.rates[to] !== undefined) {
            const rate = data.rates[to];
            resultVal.value = parseFloat((amt * rate).toPrecision(8));
            if (rateInfo) {
                rateText.textContent = `1 ${from} = ${parseFloat(rate.toPrecision(6))} ${to}`;
                updatedTime.textContent = data.time || '--';
                rateInfo.classList.remove('hidden');
            }
            // Render grid
            if (grid) {
                grid.innerHTML = '';
                Object.keys(currencies).forEach(code => {
                    if (code === from) return;
                    const cur = currencies[code];
                    const r = data.rates[code];
                    if (r === undefined) return;
                    const val = parseFloat((amt * r).toPrecision(8));
                    const div = document.createElement('div');
                    div.className = 'exchange-item';
                    div.innerHTML = `
                        <div class="exchange-item-left"><span>${cur.flag}</span><span>${cur.name}</span></div>
                        <span class="exchange-item-rate">${val}</span>
                    `;
                    div.addEventListener('click', () => {
                        if (focusedType === 'from') fromSel.value = code;
                        else toSel.value = code;
                        convert();
                    });
                    grid.appendChild(div);
                });
                grid.classList.remove('hidden');
            }
        } else {
            resultVal.value = '错误';
            if (grid) grid.classList.add('hidden');
        }
    }

    amount.addEventListener('input', convert);
    amount.addEventListener('click', () => setFocusedSelect(amount));
    resultVal.addEventListener('click', () => setFocusedSelect(resultVal));
    fromSel.addEventListener('change', convert);
    toSel.addEventListener('change', convert);
    fromSel.addEventListener('click', () => setFocusedSelect(fromSel));
    toSel.addEventListener('click', () => setFocusedSelect(toSel));
    setFocusedSelect(toSel);
    if (swapBtn) {
        swapBtn.addEventListener('click', () => {
            const f = fromSel.value, t = toSel.value;
            fromSel.value = t; toSel.value = f;
            const fromRow = fromSel.closest('.popup-exchange-input-row');
            const toRow = toSel.closest('.popup-exchange-input-row');
            if (focusedSelect === fromRow) setFocusedSelect(toSel);
            else if (focusedSelect === toRow) setFocusedSelect(fromSel);
            else setFocusedSelect(focusedType === 'from' ? toSel : fromSel);
            convert();
        });
    }

    // Refresh button - force re-fetch
    const refreshBtn = document.getElementById('popup-exchange-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            delete ratesCache[fromSel.value];
            refreshBtn.style.transform = 'rotate(360deg)';
            setTimeout(() => { refreshBtn.style.transform = ''; }, 400);
            convert();
        });
    }

    // Auto-update when switching to Exchange tab
    const exchangeTabBtn = document.querySelector('.tab-btn[data-tab="exchange"]');
    if (exchangeTabBtn) {
        exchangeTabBtn.addEventListener('click', () => {
            if (exchangeAutoRefresh) {
                delete ratesCache[fromSel.value];
            }
            setTimeout(convert, 50);
        });
    }

    // Load cache and auto-convert
    chrome.storage.local.get(['meow_exchange_cache', 'meow_exchange_auto_refresh'], (result) => {
        exchangeAutoRefresh = !!result.meow_exchange_auto_refresh;
        const cache = result.meow_exchange_cache;
        if (cache && cache.base && cache.rates) { ratesCache[cache.base] = cache; }
        convert();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.meow_exchange_auto_refresh) {
            exchangeAutoRefresh = !!changes.meow_exchange_auto_refresh.newValue;
        }
    });
})();

