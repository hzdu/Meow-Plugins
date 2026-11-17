// sp-tools.js - 工具箱模块（单位换算、编码解码、IP查询、油价、汇率、UUID、Pip等）
// 此文件由 sidepanel.js 拆分而来

// ================== 通用工具函数 ==================
// 依次请求多个地址，返回第一个成功且格式正确的纯文本 IP
const fetchTextOnce = async (urls, timeoutMs = 0) => {
    for (const url of urls) {
        try {
            const resp = await fetch(url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined);
            if (resp.ok) {
                const t = (await resp.text()).trim();
                if (t && /^[\da-f:.]+$/i.test(t)) return t;
            }
        } catch (e) {}
    }
    return null;
};

// IPv6 出口探测：多源并行，谁先返回用谁；没有 IPv6 出口时最多等 V6_PROBE_TIMEOUT
const V6_PROBE_TIMEOUT = 4000;
const fetchPublicV6 = () => new Promise((resolve) => {
    const tasks = [
        'https://api-ipv6.ip.sb/ip',
        'https://ipv6.icanhazip.com',
        'https://v6.ident.me',
        'https://ipv6.lookup.test-ipv6.com/ip/'
    ].map(url => () => fetchTextOnce([url], V6_PROBE_TIMEOUT));
    // Cloudflare trace 用 IPv6 字面量地址，强制走 IPv6，双栈网络下不会被 DNS 拉回 IPv4
    tasks.push(async () => {
        const resp = await fetch('https://[2606:4700:4700::1111]/cdn-cgi/trace', { signal: AbortSignal.timeout(V6_PROBE_TIMEOUT) });
        if (!resp.ok) return null;
        const m = (await resp.text()).match(/^ip=([\da-f:.]+)$/im);
        return m && m[1].includes(':') ? m[1] : null;
    });
    let pending = tasks.length;
    tasks.forEach(run => {
        Promise.resolve().then(run).then(v => { if (v) resolve(v); }).catch(() => {}).finally(() => {
            if (--pending === 0) resolve(null);
        });
    });
});

// 查询 IP 所在地（pconline 中文查询，ipinfo 兜底）
let ipinfoApiKey = '';
const fetchIpLocation = async (ip) => {
    try {
        const resp = await fetch('https://whois.pconline.com.cn/ipJson.jsp?ip=' + encodeURIComponent(ip) + '&json=true');
        const buf = await resp.arrayBuffer();
        const text = new TextDecoder('gbk').decode(buf);
        const d = JSON.parse(text);
        if (d && d.addr) return d.addr.trim() || null;
    } catch (e) {}
    try {
        const url = 'https://ipinfo.io/' + encodeURIComponent(ip) + '/json' + (ipinfoApiKey ? '?token=' + encodeURIComponent(ipinfoApiKey) : '');
        const resp = await fetch(url);
        if (resp.ok) {
            const d = await resp.json();
            const parts = [d.city, d.region, d.country].filter(Boolean);
            if (parts.length) return parts.join(' ');
        }
    } catch (e) {}
    return null;
};

// ================== TOOLS (工具逻辑) ==================
// IPINFO API Key：读取 + 保存
function initIpinfoKey() {
    const keyInput = document.getElementById('ipinfo-key-input');
    const saveBtn = document.getElementById('btn-ipinfo-key-save');
    chrome.storage.local.get(['meow_ipinfo_key'], (result) => {
        ipinfoApiKey = (result.meow_ipinfo_key || '').trim();
        if (keyInput) keyInput.value = ipinfoApiKey;
    });
    if (saveBtn && keyInput) {
        const doSave = () => {
            ipinfoApiKey = keyInput.value.trim();
            chrome.storage.local.set({ 'meow_ipinfo_key': ipinfoApiKey }, () => {
                if (typeof showToast === 'function') showToast(meowI18n.t('msg_saved'));
            });
        };
        saveBtn.addEventListener('click', doSave);
        keyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSave();
        });
    }
}
initIpinfoKey();

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
    if (numCapitalInput && numCapitalOutput) { numCapitalInput.addEventListener('input', function() { const val = parseFloat(numCapitalInput.value.replace(/,/g, '')); if (isNaN(val)) { numCapitalOutput.innerHTML = '...'; if (numShorthandSpoken) numShorthandSpoken.innerHTML = '<span style="color:#cbd5e1;" data-copy-skip="1">口语金额</span>'; } else { const digitUppercase = function(n) { const fraction = ['角', '分'], digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'], unit = [['元', '万', '亿'], ['', '拾', '佰', '仟']]; let num = Math.abs(n), s = ''; for (let i = 0; i < fraction.length; i++) s += (digit[Math.floor(num * 10 * Math.pow(10, i)) % 10] + fraction[i]).replace(/零./, ''); s = s || '整'; num = Math.floor(num); for (let i = 0; i < unit[0].length && num > 0; i++) { let p = ''; for (let j = 0; j < unit[1].length && num > 0; j++) { p = digit[num % 10] + unit[1][j] + p; num = Math.floor(num / 10); } s = p.replace(/(零.)*零$/, '').replace(/^$/, '零') + unit[0][i] + s; } return s.replace(/(零.)*零元/, '元').replace(/(零.)+/g, '零').replace(/^整$/, '零元整'); }; numCapitalOutput.textContent = digitUppercase(val); if (numShorthandSpoken) numShorthandSpoken.textContent = numberToSpokenChinese(val); } }); }
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
        const newUUID = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : generateUUID();
        btnUuidGenerate.onclick = () => { uuidOutput.value = Array.from({ length: 5 }, newUUID).join('\n'); };
        btnUuidCopy.onclick = () => { if (!uuidOutput.value) btnUuidGenerate.onclick(); copyToClipboard(uuidOutput.value, btnUuidCopy); };
    }
    if (btnIpQuery && ipResultArea) {
        // 海外次要地址展示：IPv4 / IPv6 出口都并行探测，
        // 主地址只显示 011102 返回的那一个，另一族地址在此补充，避免缺失
        let intlQuerySeq = 0;
        const isV4Str = (s) => !!s && /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
        const isV6Str = (s) => !!s && s.includes(':');
        const V6_ADDR_COLOR = '#8b5cf6';
        const V6_EMPTY_COLOR = '#94a3b8';
        const setIntlRow = (elId, wrapId, val) => {
            const el = document.getElementById(elId);
            const wrap = document.getElementById(wrapId);
            if (!el || !wrap) return;
            if (val) { el.textContent = val; wrap.style.display = 'flex'; }
            else { el.textContent = '--'; wrap.style.display = 'none'; }
        };
        // 探不到 IPv6 时保留该行并写明原因，避免看起来像"漏显示"
        const setIpv6Row = (elId, wrapId, val, mainIsV6) => {
            const el = document.getElementById(elId);
            const wrap = document.getElementById(wrapId);
            if (!el || !wrap) return;
            const copyBtn = wrap.querySelector('.ip-copy-btn');
            if (val) {
                el.textContent = val;
                el.style.color = V6_ADDR_COLOR;
                if (copyBtn) copyBtn.style.display = '';
            } else if (mainIsV6) {
                el.textContent = '--';
                wrap.style.display = 'none';
                return;
            } else {
                el.textContent = meowI18n.t('ip_v6_unavailable');
                el.style.color = V6_EMPTY_COLOR;
                if (copyBtn) copyBtn.style.display = 'none';
            }
            wrap.style.display = 'flex';
        };
        const showIntlSecondary = (v4, v6, mainIp) => {
            setIntlRow('ip-intl-ipv4', 'ip-intl-ipv4-wrapper', (isV4Str(v4) && v4 !== mainIp) ? v4 : null);
            setIpv6Row('ip-intl-ipv6', 'ip-intl-ipv6-wrapper', (isV6Str(v6) && v6 !== mainIp) ? v6 : null, isV6Str(mainIp));
        };
        const clearIntlSecondary = () => {
            setIntlRow('ip-intl-ipv4', 'ip-intl-ipv4-wrapper', null);
            const v6Wrap = document.getElementById('ip-intl-ipv6-wrapper');
            if (v6Wrap) v6Wrap.style.display = 'none';
        };

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
            btnIpQuery.innerHTML = '<span class="mi fa-regular fa-arrows-rotate" style="font-size: 14px; vertical-align: middle;"></span> ' + meowI18n.t('action_query_net');
        };

        // Check checking/auto-query logic
        window.checkAndInitIpTools = function() {
            chrome.storage.local.get(['meow_ip_cache'], (result) => {
                const cache = result.meow_ip_cache;
                if (cache && cache.ip) {
                    // Use cached data
                    updateIpUi(cache.ip, cache.country, cache.city, cache.isp, cache.riskHtml, cache.riskColor);
                    showIntlSecondary(cache.ipv4, cache.ipv6, cache.ip);
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
            // 清空海外次要行，等待本次探测结果
            const seq = ++intlQuerySeq;
            clearIntlSecondary();

            // 公共出口探针：国内 / 海外两组复用，避免同一地址重复请求
            const publicV4Promise = fetchTextOnce(['https://api-ipv4.ip.sb/ip', 'https://ipv4.icanhazip.com', 'https://api.ipify.org'], V6_PROBE_TIMEOUT);
            const publicV6Promise = fetchPublicV6();

            // 国内 (CN)：IPv4 / IPv6 同时展示
            (async () => {
                // 直连境内来源优先（VPN 智能分流下为真实地址，不受代理影响）
                const proxyIpip = (url) => new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: 'proxy-fetch', url }, res => {
                        try {
                            if (res && res.success) {
                                const d = JSON.parse(res.data);
                                if (d && d.data) resolve({ ip: d.data.ip, location: d.data.location });
                                else resolve(null);
                            } else resolve(null);
                        } catch (e) { resolve(null); }
                    });
                });

                const [ipip, myip4, v4, v6] = await Promise.all([
                    proxyIpip('https://myip.ipip.net/json'),
                    proxyIpip('https://myip4.ipip.net/json'),
                    publicV4Promise,
                    publicV6Promise
                ]);

                const cnAddr = document.getElementById('ip-cn-addr');
                const isV4 = (ip) => ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
                const isV6 = (ip) => ip && ip.includes(':');

                const ipipIp = ipip && ipip.ip;
                // 主地址：优先 ipip 直连 IPv4 -> myip4 直连 IPv4 -> 外网 IPv4 -> ipip IPv6 -> 外网 IPv6
                const mainIp = isV4(ipipIp) ? ipipIp
                    : ((myip4 && myip4.ip) || v4 || ipipIp || v6 || 'Error');
                if (cnAddr) cnAddr.textContent = mainIp;

                // IPv6 次要展示（优先 ipip 直连 IPv6，其次外网 IPv6，不重复主地址）
                let ipv6Val = null;
                if (isV6(ipipIp) && ipipIp !== mainIp) ipv6Val = ipipIp;
                else if (v6 && v6 !== mainIp) ipv6Val = v6;
                setIpv6Row('ip-cn-ipv6', 'ip-cn-ipv6-wrapper', ipv6Val, isV6(mainIp));

                // 所在地：优先 ipip 地区库（省份/城市/运营商）
                if (ipip && ipip.location) {
                    const loc = ipip.location;
                    const pro = document.getElementById('ip-cn-pro');
                    const city = document.getElementById('ip-cn-city');
                    const isp = document.getElementById('ip-cn-isp');
                    if (pro) pro.textContent = (loc[1] || '--');
                    if (city) city.textContent = (loc[2] || '--');
                    if (isp) isp.textContent = (loc[4] || '--');
                } else if (isV4(mainIp)) {
                    // ipip 不可用时兜底 pconline
                    const loc = await fetchIpLocation(mainIp);
                    if (loc) {
                        const pro = document.getElementById('ip-cn-pro');
                        if (pro) pro.textContent = loc;
                    }
                }
            })();

            try {
                // New API Source: https://ip.011102.xyz/
                // 海外出口需同时探测 IPv4 / IPv6（011102 只返回其一，另一族在此补充展示）
                const [ipRes, intlV4, intlV6] = await Promise.all([
                    fetch('https://ip.011102.xyz/'),
                    publicV4Promise,
                    publicV6Promise
                ]);
                const ipData = await ipRes.json();

                if (ipData && ipData.IP) {
                    const ip = ipData.IP.IP || '--';
                    const country = ipData.IP.Country || '--';
                    const city = ipData.IP.City || '--';
                    const isp = ipData.IP.ASOrganization || '--';
                    const riskText = '--';
                    const riskColor = '';

                    updateIpUi(ip, country, city, isp, riskText, riskColor);
                    if (seq === intlQuerySeq) showIntlSecondary(intlV4, intlV6, ip);

                    const cacheV4 = (intlV4 && intlV4 !== ip) ? intlV4 : null;
                    const cacheV6 = (intlV6 && intlV6 !== ip) ? intlV6 : null;
                    chrome.storage.local.set({
                        meow_ip_cache: { ip, country, city, isp, ipv4: cacheV4, ipv6: cacheV6, riskHtml: riskText, riskColor, timestamp: Date.now() }
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
                showIntlSecondary(null, null, null);
                console.error("Meow IP Check Error:", e);
            }
            // Reset button text happens in updateIpUi or on error case
btnIpQuery.innerHTML = '<span class="mi fa-regular fa-arrows-rotate" style="font-size: 14px; vertical-align: middle;"></span> ' + meowI18n.t('action_query_net');
        };

         // Initial check
         checkAndInitIpTools();
    }
    // IP/域名 → IP & 所在地查询
    if (domainInput && btnDomainQuery && domainResult) {
        const isValidDomain = (str) => {
            return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(str);
        };
        const isIp = (str) => /^\d{1,3}(\.\d{1,3}){3}$/.test(str) || (str.includes(':') && /^[\da-fA-F:.]+$/.test(str));

        // DoH 解析（多源兜底，返回 A 记录）
        const resolveViaDoH = async (domain) => {
            const endpoints = [
                'https://dns.alidns.com/resolve?name=' + encodeURIComponent(domain) + '&type=A',
                'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(domain) + '&type=A',
                'https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=A&cd=1'
            ];
            for (const url of endpoints) {
                try {
                    const init = url.includes('cloudflare') ? { headers: { Accept: 'application/dns-json' } } : undefined;
                    const resp = await fetch(url, init);
                    if (!resp.ok) continue;
                    const data = await resp.json();
                    if (data && Array.isArray(data.Answer)) {
                        const ips = [...new Set(data.Answer.filter(r => r.type === 1).map(r => r.data))];
                        if (ips.length) return ips;
                    }
                } catch (e) {}
            }
            return null;
        };

        // 查询 IP 所在地（pconline 中文查询，ipinfo 兜底）
        btnDomainQuery.onclick = async () => {
            const input = domainInput.value.trim();
            if (!input) return;

            // 直接查询 IP（IPv4 / IPv6）所在地
            if (isIp(input)) {
                domainResult.innerHTML = '<span style="color:#94a3b8;">正在查询...</span>';
                const loc = await fetchIpLocation(input);
                const ipColor = input.includes(':') ? '#8b5cf6' : '#0ea5e9';
                domainResult.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
                    '<code style="background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:12px;color:' + ipColor + ';max-width:100%;word-break:break-all;overflow-wrap:anywhere;">' + input + '</code>' +
                    (loc
                        ? '<span style="color:#64748b;margin-left:8px;min-width:0;word-break:break-all;overflow-wrap:anywhere;">所在地：' + escapeHtml(loc) + '</span>'
                        : '<span style="color:#94a3b8;margin-left:8px;">所在地未知</span>') +
                    '</div>';
                return;
            }

            if (!isValidDomain(input)) {
                domainResult.innerHTML = '<span style="color:#ef4444;">请输入有效的 IP 或域名（如 1.2.3.4 或 example.com）</span>';
                return;
            }
            const domain = input;

            domainResult.innerHTML = '<span style="color:#94a3b8;">正在解析...</span>';

            try {
                let ips = await resolveViaDoH(domain);

                // 无 A 记录时尝试 IPv6
                let ipv6 = [];
                if (!ips) {
                    try {
                        const resp6 = await fetch('https://dns.alidns.com/resolve?name=' + encodeURIComponent(domain) + '&type=AAAA');
                        const data6 = await resp6.json();
                        if (data6 && Array.isArray(data6.Answer)) {
                            ipv6 = [...new Set(data6.Answer.filter(r => r.type === 28).map(r => r.data))];
                        }
                    } catch (e) {}
                    if (!ipv6.length) {
                        domainResult.innerHTML = '<span style="color:#ef4444;">域名解析失败，请检查域名是否正确</span>';
                        return;
                    }
                }

                // 逐个查询所在地（并行）
                const targetIps = ips || ipv6;
                const rows = await Promise.all(targetIps.map(async (ip, idx) => {
                    return { ip, loc: await fetchIpLocation(ip), first: idx === 0, isV6: ipv6.length > 0 };
                }));

                let html = '<div style="display:flex;flex-direction:column;gap:3px;">';
                rows.forEach(row => {
                    const ipColor = row.isV6 ? '#8b5cf6' : '#0ea5e9';
                    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;min-width:0;">';
                    html += '<span style="min-width:0;">' + (row.first ? '<span style="color:#10b981;">✓ </span>' : '') + '<code style="background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:12px;color:' + ipColor + ';max-width:100%;word-break:break-all;overflow-wrap:anywhere;">' + row.ip + '</code></span>';
                    html += row.loc
                        ? '<span style="color:#64748b;margin-left:8px;min-width:0;word-break:break-all;overflow-wrap:anywhere;">所在地：' + escapeHtml(row.loc) + '</span>'
                        : '<span style="color:#94a3b8;margin-left:8px;">所在地未知</span>';
                    html += '</div>';
                });
                html += '</div>';
                domainResult.innerHTML = html;
            } catch (e) {
                domainResult.innerHTML = '<span style="color:#ef4444;">解析请求失败：' + escapeHtml(e.message) + '</span>';
            }
        };

        // Enter key support
        domainInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') btnDomainQuery.click();
        });
    }
    if (btnCopyCnIp) btnCopyCnIp.onclick = () => { const ip = document.getElementById('ip-cn-addr').innerText; if (ip && ip !== '--' && ip !== 'Error') copyToClipboard(ip); };
    const btnCopyCnIpV6 = document.getElementById('btn-copy-cn-ipv6');
    if (btnCopyCnIpV6) btnCopyCnIpV6.onclick = () => { const ip = document.getElementById('ip-cn-ipv6').innerText; if (ip && ip.includes(':')) copyToClipboard(ip); };
    if (btnCopyIntlIp) btnCopyIntlIp.onclick = () => { const ip = document.getElementById('ip-intl-addr').innerText; if (ip && ip !== '--' && ip !== 'Error') copyToClipboard(ip); };
    const btnCopyIntlIpV4 = document.getElementById('btn-copy-intl-ipv4');
    if (btnCopyIntlIpV4) btnCopyIntlIpV4.onclick = () => { const ip = document.getElementById('ip-intl-ipv4').innerText; if (ip && ip !== '--' && ip !== 'Error') copyToClipboard(ip); };
    const btnCopyIntlIpV6 = document.getElementById('btn-copy-intl-ipv6');
    if (btnCopyIntlIpV6) btnCopyIntlIpV6.onclick = () => { const ip = document.getElementById('ip-intl-ipv6').innerText; if (ip && ip.includes(':')) copyToClipboard(ip); };

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
                                <span class="fuel-price-value">${escapeHtml(item.price_desc || (item.price + meowI18n.t('fuel_price_unit')))}</span>
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

            btnFuelQuery.innerHTML = '<span class="mi fa-regular fa-magnifying-glass" style="font-size: 14px; vertical-align: middle;"></span> ' + meowI18n.t('fuel_action_query');
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
            // 与 popup 的汇率刷新键保持同一套动画（popup-exchange.js 同款写法），
            // 用户对比后点名要这个行为，不要再"优化"成 WAAPI 单向一圈。
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
        h.onclick = function(e) {
            // MV3 CSP 禁止内联事件处理器，外链点击的拦截改在这里做：
            // 点到 h3 里的链接（如「打开站长工具」）时不折叠/展开卡片
            if (e.target && typeof e.target.closest === 'function' && e.target.closest('a')) return;
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

// ================== 工具箱输入框 / 结果框一键复制 ==================
function setupToolCopyButtons() {
    const root = document.getElementById('view-tools');
    if (!root || root.dataset.toolCopyBound === '1') return;
    root.dataset.toolCopyBound = '1';

    // 按住复制按钮时不要抢走输入框的焦点和已选中的内容
    root.addEventListener('mousedown', function(e) {
        const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('.tool-icopy-btn') : null;
        if (btn) e.preventDefault();
    });

    // 事件委托：以后新增 [data-copy-target] 按钮无需再改这里
    root.addEventListener('click', function(e) {
        const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('.tool-icopy-btn') : null;
        if (!btn) return;
        const targetId = btn.dataset.copyTarget;
        const el = targetId ? document.getElementById(targetId) : null;
        if (!el) return;

        let text;
        if (typeof el.value === 'string') {
            text = el.value;                    // input / textarea
        } else {
            // 结果框这类容器：跳过占位提示，只复制真正的结果文本
            const clone = el.cloneNode(true);
            clone.querySelectorAll('[data-copy-skip]').forEach(node => node.remove());
            text = clone.textContent || '';
        }
        text = (text || '').trim();
        if (!text) { showToast('内容为空'); return; }
        copyToClipboard(text, btn);
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
        // 标题栏里的链接自带原生拖拽（拖动会变成拖链接而不是拖卡片），
        // 统一关掉，让整个标题栏行为一致：按住标题即拖拽排序
        h3.querySelectorAll('a[href]').forEach(a => a.setAttribute('draggable', 'false'));
        if (h3.querySelector('.tool-drag-handle')) return;
        const handle = document.createElement('span');
        handle.className = 'mi fa-regular fa-grip-dots-vertical tool-drag-handle';
        const toggle = h3.querySelector('.toggle-icon');
        if (toggle) {
            h3.insertBefore(handle, toggle);
        } else {
            h3.appendChild(handle);
        }
    });

    // 统一添加拖放事件（每次重新获取当前 index）
    // 注意：只有标题栏(h3)是拖拽手柄，卡片本体绝不设置 draggable。
    // 否则卡片展开后，在内容区按住鼠标也会被浏览器当成拖拽，
    // 导致输入框/文本域里无法用鼠标拖选文字。
    function refreshIndices() {
        container.querySelectorAll('.tool-card').forEach((c, i) => {
            c.dataset.index = i;
            c.removeAttribute('draggable');
            const header = c.querySelector('h3');
            if (header) header.setAttribute('draggable', 'true');
        });
    }

    refreshIndices();

    // 事件委托只需绑定一次（initSidepanel 可能被重复调用）
    if (container.dataset.toolDragBound === '1') return;
    container.dataset.toolDragBound = '1';

    // 只有拖拽源是标题栏(h3)时才视为卡片排序；
    // 内容区里选中文字、拖图片等原生拖拽一律忽略。
    function getDragCard(e) {
        const target = e.target;
        if (!target || typeof target.closest !== 'function') return null;
        const header = target.closest('.tool-card h3');
        if (!header || !container.contains(header)) return null;
        return header.closest('.tool-card');
    }

    // ===== 拖拽排序：占位块撑开空位，其它卡片平滑让位 =====
    // 交互模型：拖拽期间被拖卡片脱离文档流、紧贴指针移动；它原来的位置由一个
    // 等高的占位块顶替，占位块随指针逐格移动，实时指示"松手后落到哪"。
    // 其它卡片则通过 FLIP 位移补间滑向新位置，形成上移/下移让开的观感。
    let dragCard = null;      // 正在拖拽的卡片
    let placeholder = null;   // 撑开空位的占位块
    let srcIndex = null;      // 拖拽起点索引
    let grabOffsetX = 0;      // 按下点相对卡片左上角的偏移
    let grabOffsetY = 0;

    // 让跟随卡片贴在指针位置
    function followPointer(x, y) {
        if (!dragCard) return;
        dragCard.style.left = (x - grabOffsetX) + 'px';
        dragCard.style.top = (y - grabOffsetY) + 'px';
    }

    // 记录除被拖卡片外的纵向布局位置。
    // 这里刻意用 offsetTop 而非 getBoundingClientRect：offsetTop 反映的是
    // 布局位置，不受 transform 影响，因此让位动画尚未结束时再次测量
    // 也不会把动画中的位移算进去，避免误差累积。
    function snapshotTops() {
        const tops = new Map();
        container.querySelectorAll('.tool-card').forEach(card => {
            if (card === dragCard) return;
            tops.set(card, card.offsetTop);
        });
        return tops;
    }

    // FLIP：先让卡片瞬移到新布局位置并施加反向位移，再过渡回 0，形成滑入效果
    function animateLetWay(prevTops) {
        container.querySelectorAll('.tool-card').forEach(card => {
            if (card === dragCard) return;
            const before = prevTops.get(card);
            if (before === undefined) return;
            const dy = before - card.offsetTop;
            if (!dy) return;
            card.style.transition = 'none';
            card.style.transform = 'translateY(' + dy + 'px)';
            void card.offsetWidth; // 强制重排，确保反向位移先生效
            card.style.transition = 'transform .18s cubic-bezier(.2, .8, .2, 1)';
            card.style.transform = '';
        });
    }

    // 取占位块前后真正参与排序的卡片。
    // 必须跳过被拖卡片：它已改为 fixed，offsetTop 变成视口坐标（与其它卡片
    // 相对容器的 offsetTop 不同基准），且视觉上不占位，不能作为落点参照。
    function siblingCard(dir) {
        let node = placeholder;
        while ((node = dir > 0 ? node.nextElementSibling : node.previousElementSibling)) {
            if (node === dragCard) continue;
            if (node.classList && node.classList.contains('tool-card')) return node;
        }
        return null;
    }

    // 让占位块上移/下移一格（dir = 1 下移，-1 上移）
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

    // 指针是否越过了相邻卡片的中线，越过才换位。
    // 基准取"相邻卡片中线"而不是占位块中心：卡片高度差异很大（折叠 ~46px，
    // 展开可到 200px+），以占位块中心为基准会让高卡片的落点判断严重偏后。
    // 用 offsetTop / offsetHeight 而不是 getBoundingClientRect，是因为这两个值
    // 反映布局位置，不受让位动画中的 transform 干扰。
    function shiftTowardsPointer(clientY) {
        if (!placeholder) return false;
        const y = clientY - container.getBoundingClientRect().top;

        const next = siblingCard(1);
        if (next && y > next.offsetTop + next.offsetHeight / 2) return shiftPlaceholder(1);

        const prev = siblingCard(-1);
        if (prev && y < prev.offsetTop + prev.offsetHeight / 2) return shiftPlaceholder(-1);

        return false;
    }

    // 结束拖拽：keepPosition 为 true 表示落到占位块处，false 表示回到起点（取消）
    function finishDrag(keepPosition) {
        if (!dragCard) return;
        const card = dragCard;

        if (placeholder) {
            if (keepPosition) {
                container.insertBefore(card, placeholder);
            } else {
                // 取消时按原索引复位：先从列表里排除自己，再把原索引处的卡片当锚点
                const others = Array.from(container.querySelectorAll('.tool-card')).filter(c => c !== card);
                const anchor = others[srcIndex] || null;
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
        const cleanupCards = container.querySelectorAll('.tool-card');
        cleanupCards.forEach(c => {
            c.style.transition = 'none';
            c.style.transform = '';
        });
        void container.offsetWidth;
        cleanupCards.forEach(c => { c.style.transition = ''; });

        dragCard = null;
        toolDragSrcIndex = null;
        refreshIndices();
        if (keepPosition) saveToolOrder();
    }

    // 使用事件委托避免每次重新绑定
    container.addEventListener('dragstart', function(e) {
        const card = getDragCard(e);
        if (!card) return;

        const rect = card.getBoundingClientRect();
        dragCard = card;
        srcIndex = parseInt(card.dataset.index, 10);
        toolDragSrcIndex = srcIndex;
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
            try { e.dataTransfer.setData('text/plain', card.dataset.toolId || String(srcIndex)); } catch (_) {}
        }

        // 占位块先顶住原位，再把卡片抽出文档流
        placeholder = document.createElement('div');
        placeholder.className = 'tool-drop-placeholder';
        placeholder.style.height = rect.height + 'px';
        container.insertBefore(placeholder, card);

        card.style.width = rect.width + 'px';
        card.style.height = rect.height + 'px';
        card.style.left = rect.left + 'px';
        card.style.top = rect.top + 'px';
        card.classList.add('dragging-follow');
        card.classList.remove('dragging');
    });

    container.addEventListener('dragover', function(e) {
        if (!dragCard || !placeholder) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        followPointer(e.clientX, e.clientY);

        // 每次 dragover 最多追 4 格：快速拖动时指针一帧能跨过好几张卡片，
        // 只移动一格会明显滞后。上限 4 次是为了避免长列表下逐帧重排过多。
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
        // drop 分支已处理过则 dragCard 已置空；这里兜底「拖到区域外松手」的取消
        if (dragCard) finishDrag(false);
    });

    // 指针移出工具箱时容器收不到 dragover，卡片会滞留在原处；
    // 用 document 捕获阶段保持跟随（不调用 preventDefault，不影响原生放置判定）
    document.addEventListener('dragover', function(e) {
        if (dragCard) followPointer(e.clientX, e.clientY);
    }, true);
}

// ================== 字符串工具（长度 / 主域名 / 大小写） ==================
// 主域名（可注册域名，即 eTLD+1）判定所需的二级公共后缀。
// 说明：这不是完整的 Public Suffix List，仅内置常见国别域名的二级后缀；
// 未命中时按「取最后两段」处理，对 example.com / a.example.com 的结果均正确。
const STR_MULTI_PART_SUFFIXES = new Set([
    // 英国
    'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'ac.uk', 'gov.uk', 'sch.uk',
    // 中国
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'mil.cn',
    'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk', 'idv.hk',
    'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw', 'idv.tw',
    'com.mo', 'net.mo', 'org.mo', 'edu.mo', 'gov.mo',
    // 日韩
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ed.jp', 'gr.jp', 'lg.jp',
    'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr', 're.kr', 'pe.kr',
    // 大洋洲 / 东南亚
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
    'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'govt.nz', 'school.nz', 'geek.nz',
    'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg', 'per.sg',
    'com.my', 'net.my', 'org.my', 'edu.my', 'gov.my', 'id.my',
    'co.id', 'or.id', 'net.id', 'web.id', 'ac.id', 'go.id', 'sch.id', 'my.id', 'biz.id',
    'co.th', 'in.th', 'or.th', 'ac.th', 'go.th', 'net.th', 'mi.th',
    'com.ph', 'net.ph', 'org.ph', 'gov.ph', 'edu.ph',
    'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn', 'biz.vn', 'info.vn', 'name.vn',
    // 南亚 / 中东
    'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in', 'ac.in', 'edu.in', 'gov.in', 'res.in',
    'com.pk', 'net.pk', 'org.pk', 'gov.pk', 'edu.pk',
    'com.bd', 'com.np', 'com.lk',
    'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il', 'mun.il',
    'co.ir', 'org.ir', 'net.ir', 'ac.ir', 'gov.ir',
    'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr', 'av.tr', 'bel.tr', 'biz.tr', 'gen.tr', 'info.tr', 'k12.tr', 'name.tr', 'web.tr',
    'com.sa', 'com.eg', 'com.ae', 'co.ae', 'net.ae', 'org.ae', 'ac.ae', 'gov.ae',
    // 欧洲
    'com.ru', 'net.ru', 'org.ru', 'pp.ru',
    'com.ua', 'net.ua', 'org.ua', 'gov.ua', 'edu.ua', 'in.ua',
    'com.pl', 'net.pl', 'org.pl', 'edu.pl', 'gov.pl', 'info.pl',
    'co.at', 'or.at', 'ac.at', 'gv.at',
    'com.gr', 'com.cy', 'com.mt', 'com.pt', 'com.es', 'com.hr', 'com.ee', 'com.lv', 'com.lt',
    // 非洲 / 拉美
    'co.za', 'org.za', 'net.za', 'gov.za', 'web.za', 'ac.za',
    'co.ke', 'or.ke', 'ne.ke', 'go.ke', 'ac.ke', 'sc.ke',
    'com.ng', 'net.ng', 'org.ng', 'edu.ng', 'gov.ng',
    'co.tz', 'co.ug', 'co.zw', 'co.bw', 'co.mz', 'com.gh', 'com.et',
    'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'art.br', 'blog.br', 'eco.br',
    'com.mx', 'net.mx', 'org.mx', 'gob.mx', 'edu.mx',
    'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'edu.ar',
    'com.co', 'net.co', 'org.co', 'edu.co', 'gov.co', 'nom.co',
    'com.pe', 'net.pe', 'org.pe', 'gob.pe', 'edu.pe',
    'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo', 'com.do',
    'com.gt', 'com.sv', 'com.hn', 'com.ni', 'com.pa', 'com.cr'
]);

const STR_IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

// 从任意字符串中提取主机名（host）。
// 依次尝试：带协议的 URL → 裸 IPv4/IPv6 → 裸域名；都取不到时返回空串。
function strExtractHost(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return '';

    // 1) 带协议的 URL：交给 URL 解析，端口、认证信息、路径都会被正确剥离
    const urlMatch = text.match(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/i);
    if (urlMatch) {
        try {
            // URL.hostname 对 IPv6 会带方括号，统一去掉
            const host = new URL(urlMatch[0]).hostname.replace(/^\[|\]$/g, '');
            if (host) return host.toLowerCase().replace(/\.$/, '');
        } catch (e) { /* 落到底下的裸域名匹配 */ }
    }

    // 2) 裸 IPv6（含或不含方括号）
    const v6Match = text.match(/\[([0-9a-f:.]+:[0-9a-f:.]+)\]|((?:[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4})/i);
    if (v6Match) {
        const candidate = (v6Match[1] || v6Match[2] || '').trim();
        if (candidate.indexOf(':') !== -1 && /^[0-9a-f:.]+$/i.test(candidate)) return candidate.toLowerCase();
    }

    // 3) 裸 IPv4
    const v4Match = text.match(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/);
    if (v4Match && v4Match[0].split('.').every(n => Number(n) <= 255)) return v4Match[0];

    // 4) 裸域名（自动忽略前后的中文、空格、路径等噪声）
    const domMatch = text.match(/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/i);
    if (domMatch) return domMatch[0].toLowerCase().replace(/\.$/, '');

    return '';
}

// 取主域名：a.b.example.com → example.com，shop.example.co.uk → example.co.uk。
// IP 地址不属于域名体系，原样返回。
// 后缀判定优先查内置表；未命中时再用通用二级前缀兜底（如 com.ga、co.ao 等
// 未逐一枚举的国别组合），最后退化为「取最后两段」。
const STR_GENERIC_SLD_RE = /^(?:com|net|org|gov|edu|ac|co|or|ne|go|gob|mil|sch|info|biz|web|nom|firm|gen|ind|res|per|asn|art|blog|eco|id|in)\./;

function strRegistrableDomain(host) {
    if (!host) return '';
    if (STR_IPV4_RE.test(host) || host.indexOf(':') !== -1) return host;

    const labels = host.split('.').filter(Boolean);
    if (labels.length <= 2) return labels.join('.');

    const lastTwo = labels.slice(-2).join('.');
    const isMultiPart = STR_MULTI_PART_SUFFIXES.has(lastTwo) || STR_GENERIC_SLD_RE.test(lastTwo);
    const take = isMultiPart ? 3 : 2;
    return labels.slice(-take).join('.');
}

// 按字形簇（grapheme）统计字符数：emoji、组合字符不会被拆成多个
function strCountGraphemes(text) {
    try {
        const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        let n = 0;
        for (const _g of seg.segment(text)) n++;
        return n;
    } catch (e) {
        return [...text].length;
    }
}

function setupStringTool() {
    const input = document.getElementById('str-tool-input');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';

    const lenOut = document.getElementById('str-len-output');
    const domainOut = document.getElementById('str-domain-output');
    const upperOut = document.getElementById('str-upper-output');
    const lowerOut = document.getElementById('str-lower-output');
    const lenDetail = document.getElementById('str-len-detail');

    // 空值统一显示灰色占位（带 data-copy-skip，复制按钮不会把它当成内容）
    function renderResult(el, value, hintKey) {
        if (!el) return;
        el.textContent = '';
        if (value) {
            el.textContent = value;
            return;
        }
        const hintText = hintKey ? meowI18n.t(hintKey) : '';
        if (!hintText) return;
        const span = document.createElement('span');
        span.style.color = '#cbd5e1';
        span.setAttribute('data-copy-skip', '1');
        span.textContent = hintText;
        el.appendChild(span);
    }

    function render() {
        const raw = input.value;
        if (!raw) {
            renderResult(lenOut, '', 'tool_str_hint');
            renderResult(domainOut, '', 'tool_str_hint');
            renderResult(upperOut, '', 'tool_str_hint');
            renderResult(lowerOut, '', 'tool_str_hint');
            if (lenDetail) lenDetail.textContent = '';
            return;
        }

        const chars = strCountGraphemes(raw);
        const noSpace = strCountGraphemes(raw.replace(/\s/g, ''));
        const bytes = new TextEncoder().encode(raw).length;

        renderResult(lenOut, String(chars));
        if (lenDetail) lenDetail.textContent = meowI18n.t('tool_str_len_extra', { ws: noSpace, bytes: bytes });

        const domain = strRegistrableDomain(strExtractHost(raw));
        renderResult(domainOut, domain, 'tool_str_no_domain');

        renderResult(upperOut, raw.toUpperCase());
        renderResult(lowerOut, raw.toLowerCase());
    }

    // 长文本输入时用 rAF 合并多次 input，避免逐键重算大字符串
    let queued = false;
    const scheduleRender = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; render(); });
    };

    input.addEventListener('input', scheduleRender);

    // 语言切换后占位文案需要按新语言重绘
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.meow_locale) render();
    });

    render();
}
