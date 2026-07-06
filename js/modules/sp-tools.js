// sp-tools.js - 工具箱模块（单位换算、编码解码、IP查询、油价、汇率、UUID、Pip等）
// 此文件由 sidepanel.js 拆分而来

// ================== TOOLS (工具逻辑) ==================
function setupConverterLogic() {
    const lenRates = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.34 };
    const wtRates = { mg: 0.001, g: 1, kg: 1000, t: 1000000, oz: 28.3495, lb: 453.592, jin: 500 };
    function setupConverter(input1Id, sel1Id, input2Id, sel2Id, rates) {
        const i1 = document.getElementById(input1Id), s1 = document.getElementById(sel1Id), i2 = document.getElementById(input2Id), s2 = document.getElementById(sel2Id);
        if (!i1 || !s1 || !i2 || !s2) return;
        function calc(direction) {
            if (direction === 1) { const val = parseFloat(i1.value); if (isNaN(val)) { i2.value = ''; return; } i2.value = parseFloat((val * rates[s1.value] / rates[s2.value]).toPrecision(6)); }
            else { const val = parseFloat(i2.value); if (isNaN(val)) { i1.value = ''; return; } i1.value = parseFloat((val * rates[s2.value] / rates[s1.value]).toPrecision(6)); }
        }
        i1.addEventListener('input', () => calc(1)); s1.addEventListener('change', () => calc(1)); i2.addEventListener('input', () => calc(2)); s2.addEventListener('change', () => calc(1));
    }
    setupConverter('len-input-1', 'len-select-1', 'len-input-2', 'len-select-2', lenRates);
    setupConverter('wt-input-1', 'wt-select-1', 'wt-input-2', 'wt-select-2', wtRates);

    const byteRates = { b: 1, Kb: 1024, Mb: 1048576, Gb: 1073741824, Tb: 1099511627776 };
    setupConverter('byte-input-1', 'byte-select-1', 'byte-input-2', 'byte-select-2', byteRates);

    // Add swap (上下交换) functionality for length/weight/byte converters
    function addSwapHandler(input1Id, sel1Id, input2Id, sel2Id) {
        const i1 = document.getElementById(input1Id), s1 = document.getElementById(sel1Id);
        const i2 = document.getElementById(input2Id), s2 = document.getElementById(sel2Id);
        if (!i1 || !s1 || !i2 || !s2) return;
        const group = i1.closest('.converter-group');
        if (!group) return;
        const row = group.parentElement;
        if (!row) return;
        const swapValuesBtn = row.querySelector('.swap-values');
        const swapUnitsBtn = row.querySelector('.swap-units');
        const swapBothBtn = row.querySelector('.swap-both');
        // Swap only numeric values
        if (swapValuesBtn) {
            swapValuesBtn.addEventListener('click', () => {
                [i1.value, i2.value] = [i2.value, i1.value];
                if (i1.value) i1.dispatchEvent(new Event('input'));
                else if (i2.value) i2.dispatchEvent(new Event('input'));
            });
        }
        // Swap only units
        if (swapUnitsBtn) {
            swapUnitsBtn.addEventListener('click', () => {
                [s1.value, s2.value] = [s2.value, s1.value];
                if (i1.value) i1.dispatchEvent(new Event('input'));
                else if (i2.value) i2.dispatchEvent(new Event('input'));
            });
        }
        // Swap both values and units
        if (swapBothBtn) {
            swapBothBtn.addEventListener('click', () => {
                [i1.value, i2.value] = [i2.value, i1.value];
                [s1.value, s2.value] = [s2.value, s1.value];
                if (i1.value) i1.dispatchEvent(new Event('input'));
                else if (i2.value) i2.dispatchEvent(new Event('input'));
            });
        }
    }
    addSwapHandler('len-input-1', 'len-select-1', 'len-input-2', 'len-select-2');
    addSwapHandler('wt-input-1', 'wt-select-1', 'wt-input-2', 'wt-select-2');
    addSwapHandler('byte-input-1', 'byte-select-1', 'byte-input-2', 'byte-select-2');

    // Number to spoken Chinese (e.g., 121000 → 十二万一千元)
    function numberToSpokenChinese(num) {
        const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
        if (num === 0) return '零元';
        let n = Math.floor(Math.abs(num));
        if (isNaN(n)) return '';
        let result = '';
        function readSection(x) {
            if (x === 0) return '';
            const s = x.toString();
            const len = s.length;
            let str = '';
            for (let i = 0; i < len; i++) {
                const d = parseInt(s[i]);
                const pos = len - 1 - i;
                if (d === 0) {
                    if (i < len - 1 && parseInt(s[i + 1]) > 0 && !str.endsWith('零')) str += '零';
                } else {
                    if (d === 1 && pos === 1 && str === '') str += '十';
                    else str += digits[d] + (pos > 0 ? (pos === 1 ? '十' : pos === 2 ? '百' : '千') : '');
                }
            }
            return str;
        }
        if (n >= 100000000) {
            const yi = Math.floor(n / 100000000);
            result += readSection(yi) + '亿';
            n %= 100000000;
            if (n > 0 && n < 10000000) result += '零';
        }
        if (n >= 10000) {
            const wan = Math.floor(n / 10000);
            result += readSection(wan) + '万';
            n %= 10000;
            if (n > 0 && n < 1000) result += '零';
        }
        if (n > 0) result += readSection(n);
        return result + '元';
    }

    if (numShorthandInput && numShorthandOutput) {
        numShorthandInput.addEventListener('input', function() {
            const val = numShorthandInput.value.trim().toLowerCase(); if (!val) { numShorthandOutput.value = ''; if (numShorthandSpoken) numShorthandSpoken.textContent = ''; return; }
            const match = val.match(/^([\d.]+)\s*([kkwmb万]+)$/);
            if (match) { let num = parseFloat(match[1]), suffix = match[2], factor = 1; if (suffix === 'k') factor = 1000; else if (suffix === 'w' || suffix === '万') factor = 10000; else if (suffix === 'm') factor = 1000000; else if (suffix === 'b') factor = 1000000000; numShorthandOutput.value = (num * factor).toString(); }
            else { const num = parseFloat(val); numShorthandOutput.value = isNaN(num) ? '' : num; }
            // Update spoken Chinese display
            if (numShorthandSpoken) {
                const numVal = parseFloat(numShorthandOutput.value.replace(/,/g, ''));
                numShorthandSpoken.textContent = isNaN(numVal) ? '' : numberToSpokenChinese(numVal);
            }
            // Sync result to 金额大写 input and trigger conversion
            if (numCapitalInput && numShorthandOutput.value) {
                numCapitalInput.value = numShorthandOutput.value;
                numCapitalInput.dispatchEvent(new Event('input'));
            }
        });
    }
    if (numFormatInput && numFormatOutput) { numFormatInput.addEventListener('input', function() { let val = numFormatInput.value.trim().replace(/,/g, ''); if (!val || isNaN(val)) { numFormatOutput.value = ''; return; } const parts = val.split('.'); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); numFormatOutput.value = parts.join('.'); }); }
    if (numCapitalInput && numCapitalOutput) { numCapitalInput.addEventListener('input', function() { const val = parseFloat(numCapitalInput.value.replace(/,/g, '')); if (isNaN(val)) { numCapitalOutput.innerHTML = '...'; if (numShorthandSpoken) numShorthandSpoken.innerHTML = '<span style="color:#cbd5e1;">口语金额</span>'; } else { const digitUppercase = function(n) { const fraction = ['角', '分'], digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'], unit = [['元', '万', '亿'], ['', '拾', '佰', '仟']]; let num = Math.abs(n), s = ''; for (let i = 0; i < fraction.length; i++) s += (digit[Math.floor(num * 10 * Math.pow(10, i)) % 10] + fraction[i]).replace(/零./, ''); s = s || '整'; num = Math.floor(num); for (let i = 0; i < unit[0].length && num > 0; i++) { let p = ''; for (let j = 0; j < unit[1].length && num > 0; j++) { p = digit[num % 10] + unit[1][j] + p; num = Math.floor(num / 10); } s = p.replace(/(零.)*零$/, '').replace(/^$/, '零') + unit[0][i] + s; } return s.replace(/(零.)*零元/, '元').replace(/(零.)+/g, '零').replace(/^整$/, '零元整'); }; numCapitalOutput.textContent = digitUppercase(val); if (numShorthandSpoken) numShorthandSpoken.textContent = numberToSpokenChinese(val); } }); }
    if (urlInput && btnUrlEncode && btnUrlDecode) { btnUrlEncode.onclick = () => { if (urlInput.value) try { urlInput.value = encodeURIComponent(urlInput.value); } catch(e) {} }; btnUrlDecode.onclick = () => { if (urlInput.value) try { urlInput.value = decodeURIComponent(urlInput.value); } catch(e) {} }; }
    if (uniInput && btnUniEncode && btnUniDecode) { btnUniEncode.onclick = () => { if (uniInput.value) uniInput.value = uniInput.value.split('').map(c => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)).join(''); }; btnUniDecode.onclick = () => { if (uniInput.value) try { uniInput.value = uniInput.value.replace(/\\u[\dA-F]{4}/gi, match => String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16))); } catch(e) {} }; }
    if (headerInput && btnHeaderFmt && headerOutput) { btnHeaderFmt.onclick = () => { const raw = headerInput.value.trim(); if (!raw) return; const result = {}; raw.split('\n').forEach(line => { line = line.trim(); const idx = line.indexOf(':'); if (idx > -1) { const key = line.substring(0, idx).trim(), val = line.substring(idx + 1).trim(); if (key) result[key] = val; } }); headerOutput.value = JSON.stringify(result, null, 4); }; }
    if (imgB64DropZone && imgFileInput && imgBase64Output) {
        const handleFile = function(file) { if (file && file.type.startsWith('image/')) { const reader = new FileReader(); reader.onload = evt => imgBase64Output.value = evt.target.result; reader.readAsDataURL(file); } };
        imgB64DropZone.onclick = () => imgFileInput.click(); imgFileInput.onchange = e => handleFile(e.target.files[0]); imgB64DropZone.ondragover = e => { e.preventDefault(); imgB64DropZone.classList.add('drag-over'); }; imgB64DropZone.ondragleave = () => imgB64DropZone.classList.remove('drag-over'); imgB64DropZone.ondrop = e => { e.preventDefault(); imgB64DropZone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); };
        btnImgCopy.onclick = () => { if (imgBase64Output.value) navigator.clipboard.writeText(imgBase64Output.value).then(() => showToast(meowI18n.t('msg_copied'))).catch(() => showToast('Copy Failed')); };
        btnImgClear.onclick = () => { imgBase64Output.value = ''; imgFileInput.value = ''; };
        if (base64ImgInput) { btnBase64Preview.onclick = () => { const b64 = base64ImgInput.value.trim(); if (b64) { base64PreviewImg.src = b64; base64PreviewImg.style.display = 'inline-block'; } }; btnBase64Download.onclick = () => { if (base64PreviewImg.src && base64PreviewImg.style.display !== 'none') { const link = document.createElement('a'); link.href = base64PreviewImg.src; link.download = 'meow_convert.png'; document.body.appendChild(link); link.click(); document.body.removeChild(link); } }; btnBase64Clear.onclick = () => { base64ImgInput.value = ''; base64PreviewImg.src = ''; base64PreviewImg.style.display = 'none'; }; }
    }
    if (uuidOutput && btnUuidGenerate && btnUuidCopy) {
        const generateUUID = () => {
            let d = new Date().getTime(), d2 = (typeof performance !== 'undefined' && performance.now && (performance.now() * 1000)) || 0;
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                let r = Math.random() * 16;
                if (d > 0) { r = (d + r) % 16 | 0; d = Math.floor(d / 16); } else { r = (d2 + r) % 16 | 0; d2 = Math.floor(d2 / 16); }
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        };
        btnUuidGenerate.onclick = () => { uuidOutput.value = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : generateUUID(); };
        btnUuidCopy.onclick = () => { if (!uuidOutput.value) btnUuidGenerate.onclick(); copyToClipboard(uuidOutput.value, btnUuidCopy); };
    }
    if (btnIpQuery && ipResultArea) {
        // Helper to update UI with IP data
        const updateIpUi = (ip, country, city, isp, riskText, riskColor) => {
            document.getElementById('ip-intl-addr').textContent = ip;
            document.getElementById('ip-intl-country').textContent = country;
            document.getElementById('ip-intl-city').textContent = city;
            document.getElementById('ip-intl-isp').textContent = isp;

            ipRiskVal.textContent = riskText;
            ipRiskVal.style.color = riskColor;

            linkScamalytics.href = 'https://ping0.cc/ip/' + ip;
            linkScamalytics.style.display = 'inline';

            ipResultArea.classList.remove('hidden');
            btnIpQuery.innerHTML = '<span class="material-icons" style="font-size: 14px; vertical-align: middle;">refresh</span> ' + meowI18n.t('action_query');
        };

        // Check checking/auto-query logic
        window.checkAndInitIpTools = function() {
            chrome.storage.local.get(['meow_ip_cache'], (result) => {
                const cache = result.meow_ip_cache;
                if (cache && cache.ip) {
                    // Use cached data
                    updateIpUi(cache.ip, cache.country, cache.city, cache.isp, cache.riskHtml, cache.riskColor);
                } else {
                    // No cache (fresh install?), auto query
                    if (!btnIpQuery.textContent.includes('...')) {
                        btnIpQuery.click();
                    }
                }
            });
        };

        btnIpQuery.onclick = async () => {
            btnIpQuery.textContent = '...';
            ipResultArea.classList.remove('hidden');
            ipRiskVal.textContent = '--';
            linkScamalytics.style.display = 'none';

            chrome.runtime.sendMessage({ action: 'proxy-fetch', url: 'https://myip.ipip.net/json' }, res => {
                if (res && res.success) {
                    try {
                        const d = JSON.parse(res.data);
                        if (d.data && d.data.location) {
                            const loc = d.data.location;
                            document.getElementById('ip-cn-addr').textContent = d.data.ip;
                            document.getElementById('ip-cn-pro').textContent = loc[1];
                            document.getElementById('ip-cn-city').textContent = loc[2];
                            document.getElementById('ip-cn-isp').textContent = loc[4];
                            return;
                        }
                    } catch (e) {}
                }
                document.getElementById('ip-cn-addr').textContent = 'Error';
            });

            try {
                // New API Source: https://ip.011102.xyz/
                const ipRes = await fetch('https://ip.011102.xyz/');
                const ipData = await ipRes.json();

                if (ipData && ipData.IP) {
                    const ip = ipData.IP.IP || '--';
                    const country = ipData.IP.Country || '--';
                    const city = ipData.IP.City || '--';
                    const isp = ipData.IP.ASOrganization || '--';
                    const riskText = '--';
                    const riskColor = '';

                    updateIpUi(ip, country, city, isp, riskText, riskColor);

                    chrome.storage.local.set({
                        meow_ip_cache: { ip, country, city, isp, riskHtml: riskText, riskColor, timestamp: Date.now() }
                    });
                    return; // Done
                }
                /* OLD CODE DISABLED */
                if (false) {
                    const ip = null;
                    fetch('https://ping0.cc/ip/' + ip).then(r => r.text()).then(html => {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(html, 'text/html');

                        const locEl = doc.querySelector('.line.loc .content');
                        let country = '--', city = '--', isp = '--';

                        if (locEl) {
                            const reportSpan = locEl.querySelector('.report');
                            if (reportSpan) reportSpan.remove();

                            let fullText = locEl.textContent.trim();
                            let locPart = fullText;
                            let ispPart = '--';

                            if (fullText.includes('—')) {
                                const parts = fullText.split('—');
                                locPart = parts[0].trim();
                                ispPart = parts.slice(1).join('—').trim();
                            } else if (fullText.includes('-')) {
                                const parts = fullText.split('-');
                            }

                            const locTokens = locPart.split(/\s+/);
                            country = locTokens[0] || '--';
                            city = locTokens.slice(1).join(' ') || '--';
                            isp = ispPart;
                        }

                        const riskNode = doc.querySelector('.riskitem.riskcurrent');
                        let riskText = 'Check Link';
                        let riskColor = '';

                        if (riskNode) {
                            const valStr = riskNode.querySelector('.value')?.textContent?.trim() || '';
                            const labStr = riskNode.querySelector('.lab')?.textContent?.trim() || '';
                            const percentage = parseInt(valStr.replace('%', '')) || 0;

                            riskText = valStr + ' ' + labStr;
                            riskColor = percentage > 50 ? 'red' : (percentage > 20 ? 'orange' : '#10b981');
                        }

                        updateIpUi(ip, country, city, isp, riskText, riskColor);

                        chrome.storage.local.set({
                            meow_ip_cache: {
                                ip: ip,
                                country: country,
                                city: city,
                                isp: isp,
                                riskHtml: riskText,
                                riskColor: riskColor,
                                timestamp: Date.now()
                            }
                        });

                    }).catch(() => ipRiskVal.textContent = 'N/A');
                }
            } catch (e) {
                document.getElementById('ip-intl-addr').textContent = 'Error';
                console.error("Meow IP Check Error:", e);
            }
            // Reset button text happens in updateIpUi or on error case
             btnIpQuery.innerHTML = '<span class="material-icons" style="font-size: 14px; vertical-align: middle;">refresh</span> ' + meowI18n.t('action_query');
        };

         // Initial check
         checkAndInitIpTools();
    }
    if (btnCopyCnIp) btnCopyCnIp.onclick = () => { const ip = document.getElementById('ip-cn-addr').innerText; if (ip && ip !== '--' && ip !== 'Error') copyToClipboard(ip); };
    if (btnCopyIntlIp) btnCopyIntlIp.onclick = () => { const ip = document.getElementById('ip-intl-addr').innerText; if (ip && ip !== '--' && ip !== 'Error') copyToClipboard(ip); };

    // Fuel Price Tool
    const fuelRegionInput = document.getElementById('fuel-region-input');
    const btnFuelQuery = document.getElementById('btn-fuel-query');
    const fuelResultArea = document.getElementById('fuel-result-area');
    const fuelRegionName = document.getElementById('fuel-region-name');
    const fuelPriceList = document.getElementById('fuel-price-list');
    const fuelUpdatedTime = document.getElementById('fuel-updated-time');

    // Load saved fuel region from storage
    if (fuelRegionInput) {
        chrome.storage.local.get(['meow_fuel_region'], (result) => {
            if (result.meow_fuel_region) {
                fuelRegionInput.value = result.meow_fuel_region;
            }
        });
    }

    if (btnFuelQuery && fuelResultArea) {
        btnFuelQuery.onclick = async () => {
            const region = fuelRegionInput.value.trim();
            if (!region) {
                showToast(meowI18n.t('msg_input_region'));
                return;
            }

            // Save region to storage
            chrome.storage.local.set({ 'meow_fuel_region': region });

            btnFuelQuery.textContent = meowI18n.t('msg_search_loading');

            try {
                const response = await fetch(`https://60s.ctnis.com/v2/fuel-price?region=${encodeURIComponent(region)}`);
                const res = await response.json();

                if (res.code === 200 && res.data) {
                    fuelResultArea.classList.remove('hidden');
                    fuelRegionName.textContent = res.data.region || region;
                    fuelUpdatedTime.textContent = res.data.updated || '--';

                    // Render price list
                    fuelPriceList.innerHTML = '';
                    if (res.data.items && Array.isArray(res.data.items)) {
                        res.data.items.forEach(item => {
                            const div = document.createElement('div');
                            div.className = 'fuel-price-item';
                            div.innerHTML = `
                                <span class="fuel-price-name">${escapeHtml(item.name)}</span>
                                <span class="fuel-price-value">${item.price_desc || (item.price + meowI18n.t('fuel_price_unit'))}</span>
                            `;
                            fuelPriceList.appendChild(div);
                        });
                    }
                } else {
                    showToast(res.message || meowI18n.t('msg_query_failed'));
                    fuelResultArea.classList.add('hidden');
                }
            } catch (error) {
                console.error('Fuel price fetch error:', error);
                showToast(meowI18n.t('msg_network_error'));
                fuelResultArea.classList.add('hidden');
            }

            btnFuelQuery.innerHTML = '<span class="material-icons" style="font-size: 14px; vertical-align: middle;">search</span> ' + meowI18n.t('fuel_action_query');
        };
    }

    // Exchange Rate Tool (实时汇率换算)
    const exchangeAmount = document.getElementById('exchange-amount');
    const exchangeFromSelect = document.getElementById('exchange-from-select');
    const exchangeToSelect = document.getElementById('exchange-to-select');
    const exchangeResultVal = document.getElementById('exchange-result-val');
    const exchangeSwapBtn = document.getElementById('exchange-swap-btn');
    const exchangeRateInfo = document.getElementById('exchange-rate-info');
    const exchangeRateText = document.getElementById('exchange-rate-text');
    const exchangeUpdatedTime = document.getElementById('exchange-updated-time');
    const exchangeGrid = document.getElementById('exchange-grid');

    const exchangeCurrencies = {
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

    // Cache: { base: 'USD', rates: {...}, time: '...', timestamp: ... }
    let exchangeRatesCache = {};
    let exchangeFocusedSelect = null;
    let exchangeFocusedType = 'to';

    function setExchangeFocusedSelect(sel) {
        if (exchangeFocusedSelect) {
            exchangeFocusedSelect.classList.remove('exchange-select-focused', 'exchange-select-focused-to');
        }
        if (sel) {
            const row = sel.closest('.exchange-input-row');
            exchangeFocusedSelect = row || sel;
            const fromRow = exchangeAmount.closest('.exchange-input-row');
            exchangeFocusedType = (exchangeFocusedSelect === fromRow) ? 'from' : 'to';
        } else {
            exchangeFocusedSelect = null;
            exchangeFocusedType = 'to';
        }
        if (exchangeFocusedSelect) {
            exchangeFocusedSelect.classList.add(exchangeFocusedType === 'from' ? 'exchange-select-focused' : 'exchange-select-focused-to');
        }
    }

    async function fetchExchangeRates(base) {
        // Return cached if fresh (< 10 min)
        if (exchangeRatesCache[base] && (Date.now() - exchangeRatesCache[base].timestamp < 600000)) {
            return exchangeRatesCache[base];
        }
        try {
            const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`);
            const res = await response.json();
            if (res && res.rates) {
                const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                const cacheEntry = { base, rates: res.rates, time: now, timestamp: Date.now() };
                exchangeRatesCache[base] = cacheEntry;
                // Persist
                chrome.storage.local.set({ meow_exchange_cache: cacheEntry });
                return cacheEntry;
            }
        } catch (error) {
            console.error('Exchange rate fetch error:', error);
        }
        return null;
    }

    async function doExchangeConvert() {
        if (!exchangeAmount || !exchangeFromSelect || !exchangeToSelect || !exchangeResultVal) return;
        const from = exchangeFromSelect.value;
        const to = exchangeToSelect.value;
        const amount = parseFloat(exchangeAmount.value);

        if (isNaN(amount) || amount < 0) {
            exchangeResultVal.value = '';
            return;
        }

        if (from === to) {
            exchangeResultVal.value = amount.toFixed(2);
            if (exchangeRateInfo) {
                exchangeRateText.textContent = `1 ${from} = 1 ${to}`;
                exchangeRateInfo.classList.remove('hidden');
            }
            return;
        }

        exchangeResultVal.value = '...';
        const data = await fetchExchangeRates(from);

        if (data && data.rates && data.rates[to] !== undefined) {
            const rate = data.rates[to];
            const result = amount * rate;
            exchangeResultVal.value = parseFloat(result.toPrecision(8));
            if (exchangeRateInfo) {
                exchangeRateText.textContent = `1 ${from} = ${parseFloat(rate.toPrecision(6))} ${to}`;
                exchangeUpdatedTime.textContent = data.time || '--';
                exchangeRateInfo.classList.remove('hidden');
            }
            // Render grid for all other currencies
            if (exchangeGrid) {
                exchangeGrid.innerHTML = '';
                Object.keys(exchangeCurrencies).forEach(code => {
                    if (code === from) return;
                    const cur = exchangeCurrencies[code];
                    const r = data.rates[code];
                    if (r === undefined) return;
                    const val = parseFloat((amount * r).toPrecision(8));
                    const div = document.createElement('div');
                    div.className = 'exchange-item';
                    div.innerHTML = `
                        <div class="exchange-item-left">
                            <span>${cur.flag}</span>
                            <span>${cur.name}</span>
                        </div>
                        <span class="exchange-item-rate">${val}</span>
                    `;
                    // Click to set target currency
                    div.style.cursor = 'pointer';
                    div.addEventListener('click', () => {
                        if (exchangeFocusedType === 'from') exchangeFromSelect.value = code;
                        else exchangeToSelect.value = code;
                        doExchangeConvert();
                    });
                    exchangeGrid.appendChild(div);
                });
                exchangeGrid.classList.remove('hidden');
            }
        } else {
            exchangeResultVal.value = '错误';
            showToast('汇率查询失败');
            if (exchangeGrid) exchangeGrid.classList.add('hidden');
        }
    }

    if (exchangeAmount) {
        exchangeAmount.addEventListener('input', doExchangeConvert);
        exchangeAmount.addEventListener('click', () => setExchangeFocusedSelect(exchangeAmount));
    }
    if (exchangeResultVal) {
        exchangeResultVal.addEventListener('click', () => setExchangeFocusedSelect(exchangeResultVal));
    }
    if (exchangeFromSelect) {
        exchangeFromSelect.addEventListener('change', doExchangeConvert);
        exchangeFromSelect.addEventListener('click', () => setExchangeFocusedSelect(exchangeFromSelect));
    }
    if (exchangeToSelect) {
        exchangeToSelect.addEventListener('change', doExchangeConvert);
        exchangeToSelect.addEventListener('click', () => setExchangeFocusedSelect(exchangeToSelect));
    }
    setExchangeFocusedSelect(exchangeToSelect);
    if (exchangeSwapBtn) {
        exchangeSwapBtn.addEventListener('click', () => {
            const fromVal = exchangeFromSelect.value;
            const toVal = exchangeToSelect.value;
            exchangeFromSelect.value = toVal;
            exchangeToSelect.value = fromVal;
            const fromRow = exchangeFromSelect.closest('.exchange-input-row');
            const toRow = exchangeToSelect.closest('.exchange-input-row');
            if (exchangeFocusedSelect === fromRow) setExchangeFocusedSelect(exchangeToSelect);
            else if (exchangeFocusedSelect === toRow) setExchangeFocusedSelect(exchangeFromSelect);
            else setExchangeFocusedSelect(exchangeFocusedType === 'from' ? exchangeToSelect : exchangeFromSelect);
            doExchangeConvert();
        });
    }

    // Refresh button - force re-fetch
    const exchangeRefreshBtn = document.getElementById('exchange-refresh-btn');
    if (exchangeRefreshBtn) {
        exchangeRefreshBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            delete exchangeRatesCache[exchangeFromSelect.value];
            exchangeRefreshBtn.style.transform = 'rotate(360deg)';
            setTimeout(() => { exchangeRefreshBtn.style.transform = ''; }, 400);
            doExchangeConvert();
        });
    }

    // Auto-update when expanding the Exchange card
    const exchangeCardHeaders = document.querySelectorAll('.tool-card h3');
    exchangeCardHeaders.forEach(h => {
        if (h.textContent.includes('实时汇率') || h.querySelector('#exchange-refresh-btn')) {
            h.addEventListener('click', () => {
                const card = h.parentElement;
                // If it was just expanded (it will NOT have 'collapsed' class anymore)
                if (!card.classList.contains('collapsed')) {
                    // Force fetch to update time info
                    delete exchangeRatesCache[exchangeFromSelect.value];
                    // Give layout time to unhide
                    setTimeout(doExchangeConvert, 50);
                }
            });
        }
    });

    // Load cache and auto-convert on open
    if (exchangeAmount) {
        chrome.storage.local.get(['meow_exchange_cache'], (result) => {
            const cache = result.meow_exchange_cache;
            if (cache && cache.base && cache.rates) {
                exchangeRatesCache[cache.base] = cache;
            }
            // Auto-convert with default values
            doExchangeConvert();
        });
    }


    if (b64TextInput && b64TextOutput) { btnTextB64Encode.onclick = () => { const raw = b64TextInput.value; if (raw) try { b64TextOutput.value = btoa(unescape(encodeURIComponent(raw))); } catch(e) {} }; btnTextB64Decode.onclick = () => { const raw = b64TextInput.value.trim(); if (raw) try { b64TextOutput.value = decodeURIComponent(escape(atob(raw))); } catch(e) {} }; btnTextB64Clear.onclick = () => { b64TextInput.value = ''; b64TextOutput.value = ''; }; btnTextB64Copy.onclick = () => { if (b64TextOutput.value) navigator.clipboard.writeText(b64TextOutput.value).then(() => showToast(meowI18n.t('msg_copied'))).catch(() => showToast('Copy Failed')); }; }

    // Pip Tool
    const pipInput = document.getElementById('pip-input');
    const pipOutput = document.getElementById('pip-output');
    const btnPipConvert = document.getElementById('btn-pip-convert');
    const btnPipCopy = document.getElementById('btn-pip-copy');
    const btnPipClear = document.getElementById('btn-pip-clear');
    const chkPyinstaller = document.getElementById('chk-pyinstaller');
    const chkAutoPy = document.getElementById('chk-auto-py');

    if (pipInput && pipOutput && btnPipConvert) {
        const doConvert = () => {
            let text = pipInput.value.trim();
            // Remove 'pip install' prefix (case insensitive)
            text = text.replace(/^pip\s+install\s+/i, '');

            let packages = [];
            if (text) {
                // Split by whitespace
                packages = text.split(/\s+/).filter(p => p.trim().length > 0);
            }

            // Add optional packages
            if (chkPyinstaller && chkPyinstaller.checked) {
                if (!packages.includes('pyinstaller')) packages.push('pyinstaller');
            }
            if (chkAutoPy && chkAutoPy.checked) {
                if (!packages.includes('auto-py-to-exe')) packages.push('auto-py-to-exe');
            }

            // Join with newlines
            pipOutput.value = packages.join('\n');
        };

        btnPipConvert.onclick = doConvert;

        // Auto-update when checkboxes change
        if (chkPyinstaller) chkPyinstaller.onchange = doConvert;
        if (chkAutoPy) chkAutoPy.onchange = doConvert;

        btnPipCopy.onclick = () => {
            if (pipOutput.value) navigator.clipboard.writeText(pipOutput.value).then(() => showToast(meowI18n.t('msg_copied'))).catch(() => showToast('Copy Failed'));
        };
        btnPipClear.onclick = () => {
            pipInput.value = '';
            pipOutput.value = '';
            if (chkPyinstaller) chkPyinstaller.checked = false;
            if (chkAutoPy) chkAutoPy.checked = false;
        };
    }
}

// ================== 工具卡片折叠/展开 ==================
function setupToolCardToggle() {
    document.querySelectorAll('.tool-card h3').forEach(h => {
        h.onclick = function() {
            const card = h.parentElement;
            const isCollapsed = card.classList.contains('collapsed');
            // 先收起所有面板
            document.querySelectorAll('.tool-card').forEach(c => c.classList.add('collapsed'));
            // 如果点击的面板之前是收起状态，则展开它
            if (isCollapsed) {
                card.classList.remove('collapsed');
            }
        };
    });
}

// ================== 工具卡片拖拽排序 ==================
function applySavedToolOrder() {
    chrome.storage.sync.get(['meow_tool_order'], (result) => {
        const savedOrder = result.meow_tool_order;
        if (!savedOrder || !Array.isArray(savedOrder) || savedOrder.length === 0) return;
        const container = document.getElementById('view-tools');
        if (!container) return;
        const cards = container.querySelectorAll('.tool-card');
        const cardMap = {};
        cards.forEach(card => { cardMap[card.dataset.toolId] = card; });
        savedOrder.forEach(id => {
            if (cardMap[id]) {
                container.appendChild(cardMap[id]);
            }
        });
    });
}

function saveToolOrder() {
    const container = document.getElementById('view-tools');
    if (!container) return;
    const order = Array.from(container.querySelectorAll('.tool-card')).map(card => card.dataset.toolId);
    chrome.storage.sync.set({ 'meow_tool_order': order });
}

function setupToolCardDrag() {
    const container = document.getElementById('view-tools');
    if (!container) return;

    // 为每个 tool-card 的 h3 添加拖拽手柄
    container.querySelectorAll('.tool-card h3').forEach(h3 => {
        if (h3.querySelector('.tool-drag-handle')) return;
        const handle = document.createElement('span');
        handle.className = 'material-icons tool-drag-handle';
        handle.textContent = 'drag_indicator';
        const toggle = h3.querySelector('.toggle-icon');
        if (toggle) {
            h3.insertBefore(handle, toggle);
        } else {
            h3.appendChild(handle);
        }
    });

    // 统一添加拖放事件（每次重新获取当前 index）
    function refreshIndices() {
        container.querySelectorAll('.tool-card').forEach((c, i) => {
            c.dataset.index = i;
            c.setAttribute('draggable', 'true');
        });
    }

    refreshIndices();

    // 使用事件委托避免每次重新绑定
    container.addEventListener('dragstart', function(e) {
        const card = e.target.closest('.tool-card');
        if (!card) return;
        card.classList.add('dragging');
        toolDragSrcIndex = parseInt(card.dataset.index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.index);
    });

    container.addEventListener('dragend', function(e) {
        const card = e.target.closest('.tool-card');
        if (card) card.classList.remove('dragging');
        container.querySelectorAll('.tool-card').forEach(el => el.classList.remove('drag-over'));
        toolDragSrcIndex = null;
    });

    container.addEventListener('dragover', function(e) {
        const card = e.target.closest('.tool-card');
        if (!card || toolDragSrcIndex === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
    });

    container.addEventListener('dragleave', function(e) {
        const card = e.target.closest('.tool-card');
        if (card) card.classList.remove('drag-over');
    });

    container.addEventListener('drop', function(e) {
        const destCard = e.target.closest('.tool-card');
        if (!destCard || toolDragSrcIndex === null) return;
        e.stopPropagation();
        e.preventDefault();
        destCard.classList.remove('drag-over');

        const destIndex = parseInt(destCard.dataset.index);
        if (toolDragSrcIndex !== destIndex) {
            const allCards = Array.from(container.querySelectorAll('.tool-card'));
            const srcCard = allCards[toolDragSrcIndex];
            if (srcCard) {
                if (toolDragSrcIndex < destIndex) {
                    destCard.parentNode.insertBefore(srcCard, destCard.nextSibling);
                } else {
                    destCard.parentNode.insertBefore(srcCard, destCard);
                }
                saveToolOrder();
                refreshIndices();
            }
        }
        toolDragSrcIndex = null;
    });
}
