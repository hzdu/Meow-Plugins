// sp-fb-clock.js - Facebook 投放时间换算（挂在国际时钟视图内）
// 依赖 sp-core.js 的 showToast / meowI18n / escapeHtml

// ================== 时区数学（纯函数，可脱离 DOM 测试） ==================

// 投放目标国：按广告投放常用度分组
const FBTZ_TARGET_ZONES = [
    { group: 'fbtz_g_na', key: 'fbtz_z_ny', zone: 'America/New_York' },
    { group: 'fbtz_g_na', key: 'fbtz_z_chi', zone: 'America/Chicago' },
    { group: 'fbtz_g_na', key: 'fbtz_z_la', zone: 'America/Los_Angeles' },
    { group: 'fbtz_g_na', key: 'fbtz_z_denver', zone: 'America/Denver' },
    { group: 'fbtz_g_na', key: 'fbtz_z_phoenix', zone: 'America/Phoenix' },
    { group: 'fbtz_g_na', key: 'fbtz_z_toronto', zone: 'America/Toronto' },
    { group: 'fbtz_g_na', key: 'fbtz_z_mexico', zone: 'America/Mexico_City' },
    { group: 'fbtz_g_latam', key: 'fbtz_z_saopaulo', zone: 'America/Sao_Paulo' },
    { group: 'fbtz_g_eu', key: 'fbtz_z_london', zone: 'Europe/London' },
    { group: 'fbtz_g_eu', key: 'fbtz_z_paris', zone: 'Europe/Paris' },
    { group: 'fbtz_g_eu', key: 'fbtz_z_berlin', zone: 'Europe/Berlin' },
    { group: 'fbtz_g_eu', key: 'fbtz_z_madrid', zone: 'Europe/Madrid' },
    { group: 'fbtz_g_eu', key: 'fbtz_z_moscow', zone: 'Europe/Moscow' },
    { group: 'fbtz_g_eu', key: 'fbtz_z_istanbul', zone: 'Europe/Istanbul' },
    { group: 'fbtz_g_mea', key: 'fbtz_z_dubai', zone: 'Asia/Dubai' },
    { group: 'fbtz_g_mea', key: 'fbtz_z_riyadh', zone: 'Asia/Riyadh' },
    { group: 'fbtz_g_mea', key: 'fbtz_z_jhb', zone: 'Africa/Johannesburg' },
    { group: 'fbtz_g_apac', key: 'fbtz_z_kolkata', zone: 'Asia/Kolkata' },
    { group: 'fbtz_g_apac', key: 'fbtz_z_bangkok', zone: 'Asia/Bangkok' },
    { group: 'fbtz_g_apac', key: 'fbtz_z_singapore', zone: 'Asia/Singapore' },
    { group: 'fbtz_g_apac', key: 'fbtz_z_jakarta', zone: 'Asia/Jakarta' },
    { group: 'fbtz_g_apac', key: 'fbtz_z_shanghai', zone: 'Asia/Shanghai' },
    { group: 'fbtz_g_apac', key: 'fbtz_z_tokyo', zone: 'Asia/Tokyo' },
    { group: 'fbtz_g_apac', key: 'fbtz_z_seoul', zone: 'Asia/Seoul' },
    { group: 'fbtz_g_apac', key: 'fbtz_z_sydney', zone: 'Australia/Sydney' },
    { group: 'fbtz_g_apac', key: 'fbtz_z_perth', zone: 'Australia/Perth' },
    { group: 'fbtz_g_apac', key: 'fbtz_z_auckland', zone: 'Pacific/Auckland' }
];

// Facebook 广告账户时区：按 Meta 后台的账户时区命名（Rails 风格城市组），
// (GMT±HH:MM) 前缀按该时区此刻的真实偏移动态算，跟后台一样跟着夏令时变
const FBTZ_ACCOUNT_ZONES = [
    { group: 'fbtz_g_na', key: 'fbtz_ac_la', zone: 'America/Los_Angeles' },
    { group: 'fbtz_g_na', key: 'fbtz_ac_denver', zone: 'America/Denver' },
    { group: 'fbtz_g_na', key: 'fbtz_ac_phoenix', zone: 'America/Phoenix' },
    { group: 'fbtz_g_na', key: 'fbtz_ac_chi', zone: 'America/Chicago' },
    { group: 'fbtz_g_na', key: 'fbtz_ac_ny', zone: 'America/New_York' },
    { group: 'fbtz_g_na', key: 'fbtz_ac_halifax', zone: 'America/Halifax' },
    { group: 'fbtz_g_na', key: 'fbtz_ac_anchorage', zone: 'America/Anchorage' },
    { group: 'fbtz_g_na', key: 'fbtz_ac_honolulu', zone: 'Pacific/Honolulu' },
    { group: 'fbtz_g_na', key: 'fbtz_ac_mexico', zone: 'America/Mexico_City' },
    { group: 'fbtz_g_latam', key: 'fbtz_ac_bogota', zone: 'America/Bogota' },
    { group: 'fbtz_g_latam', key: 'fbtz_ac_santiago', zone: 'America/Santiago' },
    { group: 'fbtz_g_latam', key: 'fbtz_ac_saopaulo', zone: 'America/Sao_Paulo' },
    { group: 'fbtz_g_latam', key: 'fbtz_ac_buenos', zone: 'America/Argentina/Buenos_Aires' },
    { group: 'fbtz_g_eu', key: 'fbtz_ac_london', zone: 'Europe/London' },
    { group: 'fbtz_g_eu', key: 'fbtz_ac_paris', zone: 'Europe/Paris' },
    { group: 'fbtz_g_eu', key: 'fbtz_ac_berlin', zone: 'Europe/Berlin' },
    { group: 'fbtz_g_eu', key: 'fbtz_ac_warsaw', zone: 'Europe/Warsaw' },
    { group: 'fbtz_g_eu', key: 'fbtz_ac_helsinki', zone: 'Europe/Helsinki' },
    { group: 'fbtz_g_eu', key: 'fbtz_ac_athens', zone: 'Europe/Athens' },
    { group: 'fbtz_g_eu', key: 'fbtz_ac_moscow', zone: 'Europe/Moscow' },
    { group: 'fbtz_g_mea', key: 'fbtz_ac_jerusalem', zone: 'Asia/Jerusalem' },
    { group: 'fbtz_g_mea', key: 'fbtz_ac_dubai', zone: 'Asia/Dubai' },
    { group: 'fbtz_g_mea', key: 'fbtz_ac_riyadh', zone: 'Asia/Riyadh' },
    { group: 'fbtz_g_mea', key: 'fbtz_ac_cairo', zone: 'Africa/Cairo' },
    { group: 'fbtz_g_mea', key: 'fbtz_ac_lagos', zone: 'Africa/Lagos' },
    { group: 'fbtz_g_mea', key: 'fbtz_ac_pretoria', zone: 'Africa/Johannesburg' },
    { group: 'fbtz_g_apac', key: 'fbtz_ac_shanghai', zone: 'Asia/Shanghai' },
    { group: 'fbtz_g_apac', key: 'fbtz_ac_taipei', zone: 'Asia/Taipei' },
    { group: 'fbtz_g_apac', key: 'fbtz_ac_kolkata', zone: 'Asia/Kolkata' },
    { group: 'fbtz_g_apac', key: 'fbtz_ac_dhaka', zone: 'Asia/Dhaka' },
    { group: 'fbtz_g_apac', key: 'fbtz_ac_bangkok', zone: 'Asia/Bangkok' },
    { group: 'fbtz_g_apac', key: 'fbtz_ac_singapore', zone: 'Asia/Singapore' },
    { group: 'fbtz_g_apac', key: 'fbtz_ac_tokyo', zone: 'Asia/Tokyo' },
    { group: 'fbtz_g_apac', key: 'fbtz_ac_seoul', zone: 'Asia/Seoul' },
    { group: 'fbtz_g_apac', key: 'fbtz_ac_sydney', zone: 'Australia/Sydney' },
    { group: 'fbtz_g_apac', key: 'fbtz_ac_brisbane', zone: 'Australia/Brisbane' },
    { group: 'fbtz_g_apac', key: 'fbtz_ac_auckland', zone: 'Pacific/Auckland' }
];

// 缩写 -> 候选 IANA 时区（按广告投放主流度排序，首个为默认解释）
const FBTZ_ABBR = {
    'EST': ['America/New_York', 'America/Toronto', 'America/Jamaica'],
    'EDT': ['America/New_York', 'America/Toronto'],
    'CST': ['America/Chicago', 'Asia/Shanghai', 'America/Havana'],
    'CDT': ['America/Chicago', 'America/Havana'],
    'MST': ['America/Denver', 'America/Phoenix'],
    'MDT': ['America/Denver'],
    'PST': ['America/Los_Angeles', 'America/Vancouver', 'America/Tijuana'],
    'PDT': ['America/Los_Angeles', 'America/Vancouver', 'America/Tijuana'],
    'AKST': ['America/Anchorage'], 'AKDT': ['America/Anchorage'],
    'HST': ['Pacific/Honolulu'],
    'AST': ['America/Puerto_Rico', 'America/Halifax', 'Atlantic/Bermuda'],
    'ADT': ['America/Halifax', 'Atlantic/Bermuda'],
    'NST': ['America/St_Johns'], 'NDT': ['America/St_Johns'],
    'BRT': ['America/Sao_Paulo'], 'BRST': ['America/Sao_Paulo'],
    'ART': ['America/Argentina/Buenos_Aires'],
    'COT': ['America/Bogota'], 'PET': ['America/Lima'],
    'BST': ['Europe/London', 'Asia/Dhaka'],
    'WET': ['Europe/Lisbon', 'Atlantic/Canary'], 'WEST': ['Europe/Lisbon', 'Atlantic/Canary'],
    'CET': ['Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Warsaw'],
    'CEST': ['Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Warsaw'],
    'EET': ['Europe/Athens', 'Europe/Helsinki', 'Europe/Bucharest'],
    'EEST': ['Europe/Athens', 'Europe/Helsinki', 'Europe/Bucharest'],
    'MSK': ['Europe/Moscow'],
    'IST': ['Asia/Kolkata', 'Asia/Jerusalem', 'Asia/Karachi'],
    'JST': ['Asia/Tokyo'], 'KST': ['Asia/Seoul'],
    'SGT': ['Asia/Singapore', 'Atlantic/South_Georgia'],
    'HKT': ['Asia/Hong_Kong'], 'MYT': ['Asia/Kuala_Lumpur'], 'PHT': ['Asia/Manila'],
    'WIB': ['Asia/Jakarta'], 'WITA': ['Asia/Makassar'], 'WIT': ['Asia/Jayapura'],
    'ICT': ['Asia/Bangkok', 'Asia/Ho_Chi_Minh'],
    'PKT': ['Asia/Karachi'], 'BDT': ['Asia/Dhaka'], 'NPT': ['Asia/Kathmandu'],
    'GST': ['Asia/Dubai', 'Atlantic/South_Georgia'],
    'AEST': ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth'],
    'AEDT': ['Australia/Sydney', 'Australia/Melbourne'],
    'AWST': ['Australia/Perth'], 'ACST': ['Australia/Adelaide', 'Australia/Darwin'],
    'ACDT': ['Australia/Adelaide'],
    'NZST': ['Pacific/Auckland'], 'NZDT': ['Pacific/Auckland']
};

// 缩写的标准偏移（分钟，东为正）——不依赖 ICU 短名，跨引擎结果一致
const FBTZ_ABBR_OFFSET = {
    EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360,
    PST: -480, PDT: -420, AKST: -540, AKDT: -480, HST: -600,
    AST: -240, ADT: -180, NST: -210, NDT: -150,
    BRT: -180, BRST: -120, ART: -180, COT: -300, PET: -300,
    BST: 60, WET: 0, WEST: 60, CET: 60, CEST: 120, EET: 120, EEST: 180, MSK: 180,
    IST: 330, JST: 540, KST: 540, SGT: 480, HKT: 480, MYT: 480, PHT: 480,
    WIB: 420, WITA: 480, WIT: 540, ICT: 420, PKT: 300, BDT: 360, NPT: 345, GST: 240,
    AEST: 600, AEDT: 660, AWST: 480, ACST: 570, ACDT: 630, NZST: 720, NZDT: 780
};

// 夏令时/冬令时配对，用于「输入 AEST 但当前实为 AEDT」这类情况
const FBTZ_ABBR_PAIR = {
    EST: 'EDT', EDT: 'EST', CST: 'CDT', CDT: 'CST', MST: 'MDT', MDT: 'MST',
    PST: 'PDT', PDT: 'PST', AKST: 'AKDT', AKDT: 'AKST', AST: 'ADT', ADT: 'AST',
    NST: 'NDT', NDT: 'NST', BRT: 'BRST', BRST: 'BRT', CET: 'CEST', CEST: 'CET',
    WET: 'WEST', WEST: 'WET', EET: 'EEST', EEST: 'EET', BST: 'GMT',
    AEST: 'AEDT', AEDT: 'AEST', ACST: 'ACDT', ACDT: 'ACST',
    NZST: 'NZDT', NZDT: 'NZST'
};

const FBTZ_OFFSET_RE = /^(?:UTC?|GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/;
const FBTZ_UTC_WORDS = { 'UTC': 1, 'GMT': 1, 'UT': 1, 'Z': 1, 'UNIVERSAL': 1, 'ZULU': 1 };

function fbtzIsValidIana(name) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: name });
        return true;
    } catch (e) {
        return false;
    }
}

// 某时区在 instantMs 时刻的 UTC 偏移（分钟，东为正）
function fbtzZoneOffsetMinutes(zone, instantMs) {
    if (zone.kind === 'offset') return zone.id;
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: zone.id, hourCycle: 'h23', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = {};
    dtf.formatToParts(new Date(instantMs)).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUtc - instantMs) / 60000);
}

// 某 IANA 时区在 instantMs 时刻使用的缩写（按标准偏移反查，不依赖 ICU 短名）
// 固定偏移无缩写，返回 ''，由调用方显示 UTC±H
function fbtzZoneAbbr(zone, instantMs) {
    if (!zone || zone.kind !== 'iana') return '';
    const off = fbtzZoneOffsetMinutes(zone, instantMs);
    return Object.keys(FBTZ_ABBR_OFFSET).find(abbr =>
        (FBTZ_ABBR[abbr] || []).includes(zone.id) && FBTZ_ABBR_OFFSET[abbr] === off
    ) || '';
}

// 毫秒差 -> "17" / "-11.5" / "+5:30"（sign=true 时带正负号）
function fbtzFormatHours(ms, withSign) {
    const totalMin = Math.round(ms / 60000);
    const sign = totalMin < 0 ? '-' : (withSign ? '+' : '');
    const abs = Math.abs(totalMin);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    if (m === 0) return `${sign}${h}`;
    if (withSign) return `${sign}${h}:${String(m).padStart(2, '0')}`;
    return `${sign}${h}.${m === 30 ? 5 : Math.round(m / 60 * 10)}`;
}

function fbtzPad2(n) { return String(n).padStart(2, '0'); }

// 时刻 -> 该时区的日历字段
function fbtzPartsInZone(zone, ms) {
    if (zone.kind === 'offset') {
        const d = new Date(ms + zone.id * 60000);
        return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
    }
    const p = {};
    new Intl.DateTimeFormat('en-US', {
        timeZone: zone.id, hourCycle: 'h23', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date(ms)).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

// 墙上时间 -> UTC 毫秒。两遍校正处理 DST。
// 春季跳表造成「不存在的时刻」时统一归到跳变之后（02:30 -> 03:30）；
// 秋季重复时刻取第一次出现。
function fbtzWallToUtc(zone, y, m, d, h, mi) {
    const wallAsUtc = Date.UTC(y, m - 1, d, h, mi, 0);
    if (zone.kind === 'offset') return wallAsUtc - zone.id * 60000;
    const matches = ms => {
        const p = fbtzPartsInZone(zone, ms);
        return p.y === y && p.m === m && p.d === d && p.h === h && p.mi === mi;
    };
    const o1 = fbtzZoneOffsetMinutes(zone, wallAsUtc);
    const c1 = wallAsUtc - o1 * 60000;
    const o2 = fbtzZoneOffsetMinutes(zone, c1);
    if (o2 === o1) return c1;
    const c2 = wallAsUtc - o2 * 60000;
    if (matches(c2)) return c2;
    if (matches(c1)) return c1;
    return Math.max(c1, c2);
}

// 日历日期差（天）
function fbtzDayDiff(a, b) {
    return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
}

const FBTZ_CN_WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function fbtzWeekdayName(y, m, d, lang) {
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (lang && lang !== 'zh-CN' && lang !== 'zh-TW') {
        return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd];
    }
    return `${FBTZ_CN_WEEK[wd]}`;
}

// 解析用户输入的时区：IANA / UTC 偏移 / 缩写
// 返回 { ok, zone, note, abbrNow, candidates } 或 { ok:false, error }
function fbtzParseZoneCore(raw, nowMs) {
    const text = String(raw || '').trim();
    if (!text) return { ok: false, error: 'empty' };
    const upper = text.toUpperCase();

    if (FBTZ_UTC_WORDS[upper]) {
        return { ok: true, zone: { kind: 'offset', id: 0 }, note: '' };
    }

    const offMatch = text.match(FBTZ_OFFSET_RE);
    if (offMatch) {
        const sign = offMatch[1] === '-' ? -1 : 1;
        const h = parseInt(offMatch[2], 10);
        const mi = offMatch[3] ? parseInt(offMatch[3], 10) : 0;
        if (h > 14 || mi > 59) return { ok: false, error: 'bad_offset' };
        const id = sign * (h * 60 + mi);
        return { ok: true, zone: { kind: 'offset', id }, note: '' };
    }

    const cands = FBTZ_ABBR[upper];
    if (cands && cands.length) {
        const want = FBTZ_ABBR_OFFSET[upper];
        const pairAbbr = FBTZ_ABBR_PAIR[upper];
        const pairWant = pairAbbr ? FBTZ_ABBR_OFFSET[pairAbbr] : undefined;
        const offsetOf = id => fbtzZoneOffsetMinutes({ kind: 'iana', id }, nowMs);
        const first = cands[0];
        const firstOff = offsetOf(first);
        let chosen = first, note = '';
        if (want !== undefined && firstOff === want) {
            note = '';
        } else if (pairWant !== undefined && firstOff === pairWant) {
            // 主流时区此刻用的是配对的夏令/冬令缩写（写 AEST 但悉尼现为 AEDT）
            note = 'shift';
        } else {
            const alt = cands.slice(1).find(id => want !== undefined && offsetOf(id) === want);
            if (alt) { chosen = alt; note = ''; }
            else note = 'now-not';
        }
        return {
            ok: true,
            zone: { kind: 'iana', id: chosen },
            note,
            candidates: cands
        };
    }

    if (text.includes('/') || fbtzIsValidIana(text)) {
        if (fbtzIsValidIana(text)) return { ok: true, zone: { kind: 'iana', id: text }, note: '' };
        return { ok: false, error: 'bad_zone' };
    }

    return { ok: false, error: 'unknown' };
}

function fbtzParseZone(raw, nowMs) {
    const r = fbtzParseZoneCore(raw, nowMs);
    if (r.ok) r.zoneInput = String(raw || '').trim();
    return r;
}

// ==== [DOM] ====
// ================== Facebook 投放排期换算 UI ==================
// 输入：FB 后台此刻（时区+日期+时间）、投放国家、该国当地开始时刻与第几天
// 输出：FB 后台该填的日期 + 时间
const FBTZ_STORE = { state: 'meow_fb_tz_state', presets: 'meow_fb_tz_presets', collapsed: 'meow_fb_tz_collapsed' };

const fbTz = {
    fb: { zone: '__custom__', custom: 'PDT' },
    target: { zone: 'Australia/Sydney', custom: '' },
    fbDate: '',
    fbTime: '',
    targetTime: '07:00',
    dayOffset: 0,
    collapsed: false,
    presets: [],
    last: null
};

function fbTz$(id) { return document.getElementById(id); }

function fbTzRefMs(dateStr) {
    const dp = fbTzParseDate(dateStr);
    // 用目标日期正午判定缩写属于夏令时还是冬令时
    return dp ? Date.UTC(dp.y, dp.mo - 1, dp.d, 12) : Date.now();
}

function fbTzParseDate(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}

function fbTzParseTime(s) {
    // 浏览器可能回传 HH:MM:SS（带秒格或程序赋值），秒对排期无意义，容忍并忽略
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return { h, mi };
}

// 侧栏选中的时区：下拉值（国家 IANA / 常用缩写 / UTC），或「其他」里手输
function fbTzSlotZone(slot, refMs) {
    if (slot.zone === '__custom__') return fbtzParseZone(slot.custom, refMs);
    const r = fbtzParseZone(slot.zone, refMs);
    // 下拉里选缩写是明确意图，不再套「此刻不生效」这类歧义提示
    if (r.ok) r.note = '';
    return r;
}

// 同一个时区可能同时在两张表里：FB 侧要 (GMT±HH:MM) 账户写法，投放侧要城市名
function fbTzSlotName(slot, asAccount) {
    if (slot.zone === '__custom__') return slot.custom.trim() || meowI18n.t('fbtz_custom_zone');
    const primary = asAccount ? FBTZ_ACCOUNT_ZONES : FBTZ_TARGET_ZONES;
    const hit = primary.find(x => x.zone === slot.zone);
    if (hit) return asAccount ? `${fbTzGmtPrefix(hit.zone, Date.now())} ${meowI18n.t(hit.key)}` : meowI18n.t(hit.key);
    const other = (asAccount ? FBTZ_TARGET_ZONES : FBTZ_ACCOUNT_ZONES).find(x => x.zone === slot.zone);
    return other ? meowI18n.t(other.key) : slot.zone;
}

// Meta 后台那种 (GMT+08:00) 前缀，按该时区当下真实偏移
function fbTzGmtPrefix(zoneId, atMs) {
    const min = fbtzZoneOffsetMinutes({ kind: 'iana', id: zoneId }, atMs);
    const sign = min < 0 ? '-' : '+';
    const abs = Math.abs(min);
    return `(GMT${sign}${fbtzPad2(Math.floor(abs / 60))}:${fbtzPad2(abs % 60)})`;
}

function fbTzStamp(zone, ms) {
    const p = fbtzPartsInZone(zone, ms);
    return {
        time: `${fbtzPad2(p.h)}:${fbtzPad2(p.mi)}`,
        date: `${p.y}-${fbtzPad2(p.m)}-${fbtzPad2(p.d)}`,
        weekday: fbtzWeekdayName(p.y, p.m, p.d, meowI18n.lang),
        parts: p
    };
}

function fbTzZoneLabel(zone, atMs) {
    const abbr = fbtzZoneAbbr(zone, atMs);
    const off = `UTC${fbtzFormatHours(fbtzZoneOffsetMinutes(zone, atMs) * 60000, true)}`;
    return abbr ? `${abbr} · ${off}` : off;
}

function fbTzDayText(days) {
    const key = Math.abs(days) <= 2 ? `fbtz_day_${days < 0 ? 'm' : 'p'}${Math.abs(days)}` : (days < 0 ? 'fbtz_days_ago' : 'fbtz_days_later');
    let txt = meowI18n.t(key);
    if (Math.abs(days) > 2) txt = txt.replace('{n}', Math.abs(days));
    return txt;
}

function fbTzDayBadge(days) {
    const cls = days === 0 ? 'today' : (days > 0 ? 'later' : 'earlier');
    return `<span class="fb-tz-day ${cls}">${escapeHtml(fbTzDayText(days))}</span>`;
}

// ---------- 换算主流程 ----------
function fbTzSolve() {
    const fb = fbTzSlotZone(fbTz.fb, fbTzRefMs(fbTz.fbDate));
    if (!fb.ok) return { error: fb.error === 'empty' ? 'fb-empty' : 'fb-bad' };
    const dp = fbTzParseDate(fbTz.fbDate);
    const ftp = fbTzParseTime(fbTz.fbTime);
    if (!dp || !ftp) return { error: 'fb-datetime' };

    const fbNowMs = fbtzWallToUtc(fb.zone, dp.y, dp.mo, dp.d, ftp.h, ftp.mi);

    const target = fbTzSlotZone(fbTz.target, fbNowMs);
    if (!target.ok) return { error: target.error === 'empty' ? 'target-empty' : 'target-bad' };
    const ttp = fbTzParseTime(fbTz.targetTime);
    if (!ttp) return { error: 'target-time' };

    // 目标国「今天」按目标国日历算，以 FB 后台此刻为基准
    const base = fbtzPartsInZone(target.zone, fbNowMs);
    const dayUtc = Date.UTC(base.y, base.m - 1, base.d) + fbTz.dayOffset * 86400000;
    const dd = new Date(dayUtc);
    const startMs = fbtzWallToUtc(target.zone, dd.getUTCFullYear(), dd.getUTCMonth() + 1, dd.getUTCDate(), ttp.h, ttp.mi);

    return {
        fb, target, fbNowMs, startMs,
        baseDate: `${base.y}-${fbtzPad2(base.m)}-${fbtzPad2(base.d)}`,
        targetDate: `${dd.getUTCFullYear()}-${fbtzPad2(dd.getUTCMonth() + 1)}-${fbtzPad2(dd.getUTCDate())}`,
        fbNow: fbTzStamp(fb.zone, fbNowMs),
        start: fbTzStamp(target.zone, startMs),
        answer: fbTzStamp(fb.zone, startMs),
        dayDiff: fbtzDayDiff(fbtzPartsInZone(fb.zone, startMs), fbtzPartsInZone(fb.zone, fbNowMs)),
        deltaMin: fbtzZoneOffsetMinutes(target.zone, startMs) - fbtzZoneOffsetMinutes(fb.zone, startMs),
        waitMs: startMs - fbNowMs
    };
}

// 缩写与实际生效时区不一致、或临近夏令时切换时的提醒
function fbTzNotes(r) {
    const lines = [];
    [r.fb, r.target].forEach(res => {
        if (!res || !res.ok) return;
        if (res.note === 'shift') {
            lines.push(meowI18n.t('fbtz_note_shift', { input: res.zoneInput, zone: res.zone.id || '', abbr: fbtzZoneAbbr(res.zone, r.startMs) || '-' }));
        } else if (res.note === 'now-not') {
            lines.push(meowI18n.t('fbtz_note_unknown', { input: res.zoneInput, zone: res.zone.id || '' }));
        }
    });
    const near = fbtzDstNear(r.target.zone, r.startMs) || fbtzDstNear(r.fb.zone, r.startMs);
    if (near) lines.push(meowI18n.t('fbtz_note_dst', { zone: near.zone, date: near.date, inDays: near.inDays }));
    return lines;
}

function fbtzDstNear(zone, ms) {
    if (!zone || zone.kind !== 'iana') return null;
    const base = fbtzZoneOffsetMinutes(zone, ms);
    const day = 86400000;
    for (let i = 1; i <= 45; i++) {
        if (fbtzZoneOffsetMinutes(zone, ms + i * day) !== base) {
            const at = fbtzPartsInZone(zone, ms + i * day);
            return { zone: zone.id, date: `${at.y}-${fbtzPad2(at.m)}-${fbtzPad2(at.d)}`, inDays: i };
        }
    }
    return null;
}

function fbTzErrorText(err) {
    if (err === 'fb-datetime') return meowI18n.t('fbtz_err_fb_datetime');
    if (err === 'target-time') return meowI18n.t('fbtz_err_target_time');
    const isFb = err.indexOf('fb') === 0;
    const name = meowI18n.t(isFb ? 'fbtz_fb_now' : 'fbtz_deliver_to');
    return err.endsWith('empty')
        ? meowI18n.t('fbtz_err_zone_empty', { side: name })
        : meowI18n.t('fbtz_err_zone_bad', { side: name });
}

// ---------- 渲染 ----------
function fbTzRender() {
    const answer = fbTz$('fb-tz-answer');
    if (!answer) return;
    const r = fbTzSolve();

    if (r.error) {
        fbTz.last = null;
        answer.className = 'fb-tz-answer is-empty';
        answer.innerHTML = `<div class="fb-tz-empty">${escapeHtml(fbTzErrorText(r.error))}</div>`;
        fbTzRenderDays(null);
        fbTzRenderSides(null);
        fbTzRenderNotes(null);
        return;
    }
    fbTz.last = r;

    const waitH = r.waitMs / 3600000;
    const past = r.waitMs < 0;
    let whenLine;
    if (past) whenLine = meowI18n.t('fbtz_already_past');
    else if (r.waitMs < 60000) whenLine = meowI18n.t('fbtz_right_now');
    else if (waitH < 1) whenLine = meowI18n.t('fbtz_in_minutes', { n: Math.round(r.waitMs / 60000) });
    else whenLine = meowI18n.t('fbtz_in_hours', { n: Math.round(waitH * 10) / 10 });
    const copyText = `${r.answer.time} ${r.answer.date}${r.dayDiff !== 0 ? ' ' + fbTzDayText(r.dayDiff) : ''} (${fbTzSlotName(fbTz.target, false)} ${r.start.time} ${r.start.date})`;

    answer.className = 'fb-tz-answer';
    answer.innerHTML = `
        <div class="fb-tz-cap">${escapeHtml(meowI18n.t('fbtz_answer_fb'))}</div>
        <div class="fb-tz-line1">
            <span class="fb-tz-big">${escapeHtml(r.answer.time)}</span>
            <span class="fb-tz-date">${escapeHtml(r.answer.date)} ${escapeHtml(r.answer.weekday)} ${fbTzDayBadge(r.dayDiff)}</span>
            <button type="button" class="filter-btn fb-tz-copy" id="fb-tz-copy" data-copy="${escapeHtml(copyText)}">
                <span class="mi fa-regular fa-copy" style="font-size:12px;vertical-align:middle;"></span> ${escapeHtml(meowI18n.t('fbtz_copy'))}
            </button>
        </div>
        <div class="fb-tz-sub ${past ? 'is-past' : ''}">${escapeHtml(`${fbTzSlotName(fbTz.target, false)} ${r.start.date} ${r.start.time} · ${whenLine}`)}</div>`;

    fbTzRenderDays(r);
    fbTzRenderSides(r);
    fbTzRenderNotes(r);
}

// 今天/明天/后天 按目标国日历显示具体日期，避免「明天」歧义
function fbTzRenderDays(r) {
    const box = fbTz$('fb-tz-days');
    if (!box) return;
    const labels = ['fbtz_today', 'fbtz_tomorrow', 'fbtz_day_after'];
    [...box.querySelectorAll('[data-day]')].forEach(btn => {
        const off = +btn.dataset.day;
        let text = meowI18n.t(labels[off]);
        if (r) {
            // 基准是目标国「今天」，不含已选档位
            const p = new Date(Date.parse(r.baseDate + 'T00:00:00Z') + off * 86400000);
            text += ` ${fbtzPad2(p.getUTCMonth() + 1)}-${fbtzPad2(p.getUTCDate())}`;
        }
        btn.textContent = text;
        btn.classList.toggle('active', fbTz.dayOffset === off);
    });
}

function fbTzRenderSides(r) {
    const fbAt = fbTz$('fb-tz-fb-at');
    const tgAt = fbTz$('fb-tz-target-at');
    if (fbAt) fbAt.textContent = r ? fbTzZoneLabel(r.fb.zone, r.startMs) : '';
    if (tgAt) tgAt.textContent = r ? `${meowI18n.t('fbtz_now_at')} ${r.start.time}` : '';
}

// 只留会算错时间的提醒（缩写歧义、临近夏令时切换）
function fbTzRenderNotes(r) {
    const box = fbTz$('fb-tz-notes');
    if (!box) return;
    const lines = r ? fbTzNotes(r) : [];
    box.innerHTML = lines.map(n => `<div class="fb-tz-note-line">${escapeHtml(n)}</div>`).join('');
}

// ---------- 控件同步 ----------
function fbTzSyncToDom() {
    [['fb', 'fb'], ['target', 'target']].forEach(pair => {
        const slot = fbTz[pair[1]];
        const sel = fbTz$(`fb-tz-${pair[0]}-select`);
        const custom = fbTz$(`fb-tz-${pair[0]}-custom`);
        if (sel) sel.value = slot.zone;
        if (custom) {
            custom.value = slot.custom;
            custom.classList.toggle('hidden', slot.zone !== '__custom__');
        }
    });
    const fd = fbTz$('fb-tz-fb-date');
    if (fd) fd.value = fbTz.fbDate;
    const ft = fbTz$('fb-tz-fb-time');
    if (ft) ft.value = fbTz.fbTime;
    const tt = fbTz$('fb-tz-target-time');
    if (tt) tt.value = fbTz.targetTime;
}

// FB 后台此刻默认填真实当前时间（换算到 FB 时区）
function fbTzFillFbNow() {
    const ref = Date.now();
    const fb = fbTzSlotZone(fbTz.fb, ref);
    const p = fbtzPartsInZone(fb.ok ? fb.zone : { kind: 'iana', id: 'UTC' }, ref);
    fbTz.fbDate = `${p.y}-${fbtzPad2(p.m)}-${fbtzPad2(p.d)}`;
    fbTz.fbTime = `${fbtzPad2(p.h)}:${fbtzPad2(p.mi)}`;
}

function fbTzSaveState() {
    chrome.storage.local.set({
        [FBTZ_STORE.state]: {
            fb: fbTz.fb, target: fbTz.target,
            targetTime: fbTz.targetTime, dayOffset: fbTz.dayOffset
        }
    });
}

function fbTzBuildSelects() {
    ['fb', 'target'].forEach(side => {
        const sel = fbTz$(`fb-tz-${side}-select`);
        if (!sel || sel.options.length) return;
        const items = side === 'fb' ? FBTZ_ACCOUNT_ZONES : FBTZ_TARGET_ZONES;
        const groups = [];
        items.forEach(item => {
            let g = groups.find(x => x.key === item.group);
            if (!g) { g = { key: item.group, items: [] }; groups.push(g); }
            g.items.push(item);
        });
        groups.forEach(g => {
            const og = document.createElement('optgroup');
            og.dataset.i18nGroup = g.key;
            og.label = meowI18n.t(g.key);
            g.items.forEach(item => {
                const op = document.createElement('option');
                op.value = item.zone;
                // 账户项自己带 (GMT±HH:MM) 前缀，不能交给 data-i18n 覆盖
                if (side !== 'fb') op.dataset.i18n = item.key;
                op.textContent = fbTzOptionText(item, side === 'fb');
                og.appendChild(op);
            });
            sel.appendChild(og);
        });
        const custom = document.createElement('option');
        custom.value = '__custom__';
        custom.dataset.i18n = 'fbtz_custom_zone';
        custom.textContent = meowI18n.t('fbtz_custom_zone');
        sel.appendChild(custom);
    });
}

function fbTzOptionText(item, isAccount) {
    const name = meowI18n.t(item.key);
    return isAccount ? `${fbTzGmtPrefix(item.zone, Date.now())} ${name}` : name;
}

function fbTzBuildDatalist() {
    const dl = fbTz$('fb-tz-zone-list');
    if (!dl || dl.children.length) return;
    const seen = new Set();
    const add = v => {
        if (seen.has(v)) return;
        seen.add(v);
        const o = document.createElement('option');
        o.value = v;
        dl.appendChild(o);
    };
    Object.keys(FBTZ_ABBR).forEach(add);
    ['UTC', 'UTC+8', 'UTC-5', '+8', '-07:00'].forEach(add);
    FBTZ_TARGET_ZONES.forEach(t => add(t.zone));
    ['Asia/Shanghai', 'Asia/Taipei', 'Asia/Hong_Kong', 'America/Toronto', 'America/Argentina/Buenos_Aires', 'Pacific/Honolulu', 'Europe/Lisbon', 'Europe/Dublin', 'Europe/Stockholm', 'Asia/Kathmandu', 'Asia/Yangon', 'Asia/Tehran'].forEach(add);
}

// 账户项的 (GMT±HH:MM) 前缀和 optgroup 的 label 都不归 data-i18n 管，切语言后要自己刷
function fbTzRefreshLabels() {
    document.querySelectorAll('#fb-tz-card [data-i18n-group]').forEach(og => {
        og.label = meowI18n.t(og.dataset.i18nGroup);
    });
    const fbSel = fbTz$('fb-tz-fb-select');
    if (fbSel) [...fbSel.options].forEach(op => {
        const acc = FBTZ_ACCOUNT_ZONES.find(a => a.zone === op.value);
        if (acc) op.textContent = fbTzOptionText(acc, true);
    });
    fbTzRender();
}

// ---------- 方案 ----------
function fbTzRenderPresets() {
    const list = fbTz$('fb-tz-schemes');
    if (!list) return;
    if (!fbTz.presets.length) {
        list.classList.add('hidden');
        list.innerHTML = '';
        return;
    }
    list.classList.remove('hidden');
    list.innerHTML = fbTz.presets.map((s, i) => `
        <div class="fb-tz-scheme">
            <button type="button" class="fb-tz-scheme-use" data-i="${i}">${escapeHtml(s.name)}</button>
            <button type="button" class="fb-tz-scheme-del" data-i="${i}" title="${escapeHtml(meowI18n.t('fbtz_scheme_del'))}"><span class="mi fa-solid fa-xmark" style="font-size:11px;"></span></button>
        </div>`).join('');
}

function fbTzApplyPreset(s) {
    if (!s) return;
    fbTz.fb = Object.assign({ zone: '', custom: '' }, s.fb);
    fbTz.target = Object.assign({ zone: '', custom: '' }, s.target);
    fbTz.targetTime = s.targetTime || fbTz.targetTime;
    fbTz.dayOffset = typeof s.dayOffset === 'number' ? s.dayOffset : 0;
    fbTzFillFbNow();
    fbTzSyncToDom();
    fbTzRender();
    fbTzSaveState();
}

function fbTzDefaultPresetName(r) {
    const day = fbTz.dayOffset === 1 ? meowI18n.t('fbtz_tomorrow') : (fbTz.dayOffset === 2 ? meowI18n.t('fbtz_day_after') : '');
    const to = `${fbTzSlotName(fbTz.target, false)} ${day}${fbTz.targetTime}`.replace(/\s+/g, ' ');
    return `${to.trim()} → FB ${r ? r.answer.time : ''}`.replace(/\s+/g, ' ').trim();
}

async function fbTzSavePreset() {
    const name = await showPromptDialog({
        title: meowI18n.t('fbtz_scheme_save_title'),
        placeholder: meowI18n.t('fbtz_scheme_ph'),
        defaultValue: fbTzDefaultPresetName(fbTz.last)
    });
    if (!name) return;
    fbTz.presets.unshift({
        id: Date.now(), name,
        fb: { zone: fbTz.fb.zone, custom: fbTz.fb.custom },
        target: { zone: fbTz.target.zone, custom: fbTz.target.custom },
        targetTime: fbTz.targetTime,
        dayOffset: fbTz.dayOffset
    });
    if (fbTz.presets.length > 12) fbTz.presets.length = 12;
    chrome.storage.local.set({ [FBTZ_STORE.presets]: fbTz.presets });
    fbTzRenderPresets();
    showToast(meowI18n.t('fbtz_scheme_saved'));
}

// 手动把「Facebook 后台现在」重新拉成此刻的真实时间
function fbTzRefreshNow() {
    fbTzFillFbNow();
    fbTzSyncToDom();
    fbTzRender();
    showToast(`${meowI18n.t('fbtz_refreshed')} ${fbTz.fbDate} ${fbTz.fbTime}`);
}

function fbTzSetCollapsed(collapsed, persist) {
    fbTz.collapsed = collapsed;
    const card = fbTz$('fb-tz-card');
    if (card) card.classList.toggle('collapsed', collapsed);
    if (persist) chrome.storage.local.set({ [FBTZ_STORE.collapsed]: collapsed });
}

function fbTzInit() {
    const card = fbTz$('fb-tz-card');
    if (!card) return;

    fbTzBuildSelects();
    fbTzBuildDatalist();

    // meowI18n 每次 updatePage() 都会写 <html lang>，用它作为「语言已就绪/已切换」的信号，
    // 比抢注 storage.onChanged 更可靠（init 里的首次应用不会触发 storage 事件）
    new MutationObserver(() => fbTzRefreshLabels())
        .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    card.addEventListener('input', e => {
        const id = e.target.id;
        if (id === 'fb-tz-fb-custom') fbTz.fb.custom = e.target.value;
        else if (id === 'fb-tz-target-custom') fbTz.target.custom = e.target.value;
        else if (id === 'fb-tz-fb-date') fbTz.fbDate = e.target.value;
        else if (id === 'fb-tz-fb-time') fbTz.fbTime = e.target.value;
        else if (id === 'fb-tz-target-time') fbTz.targetTime = e.target.value;
        else return;
        fbTzRender();
    });

    card.addEventListener('change', e => {
        const id = e.target.id;
        // 浏览器可能把值留成 HH:MM:SS，失焦后归一化回 HH:MM，输入框里不留没用的秒格
        if (id === 'fb-tz-fb-time' || id === 'fb-tz-target-time') {
            const tp = fbTzParseTime(e.target.value);
            if (tp) {
                const norm = `${fbtzPad2(tp.h)}:${fbtzPad2(tp.mi)}`;
                if (e.target.value !== norm) e.target.value = norm;
                if (id === 'fb-tz-fb-time') fbTz.fbTime = norm; else fbTz.targetTime = norm;
                fbTzRender();
            }
        }
        if (id === 'fb-tz-fb-select' || id === 'fb-tz-target-select') {
            const slot = id === 'fb-tz-fb-select' ? fbTz.fb : fbTz.target;
            slot.zone = e.target.value;
            // 换了 FB 时区，后台此刻的默认值也要跟着换算
            if (id === 'fb-tz-fb-select') fbTzFillFbNow();
            fbTzSyncToDom();
            fbTzRender();
        }
        fbTzSaveState();
    });

    card.addEventListener('click', e => {
        if (e.target.closest('.fb-tz-head')) { fbTzSetCollapsed(!fbTz.collapsed, true); return; }
        const day = e.target.closest('[data-day]');
        if (day) { fbTz.dayOffset = +day.dataset.day; fbTzRender(); fbTzSaveState(); return; }
        if (e.target.closest('#fb-tz-refresh')) { fbTzRefreshNow(); return; }
        if (e.target.closest('#fb-tz-save')) { fbTzSavePreset(); return; }
        const copy = e.target.closest('#fb-tz-copy');
        if (copy) {
            const txt = copy.dataset.copy || '';
            if (!txt) return;
            navigator.clipboard.writeText(txt)
                .then(() => showToast(meowI18n.t('fbtz_copied')))
                .catch(() => showToast(meowI18n.t('fbtz_copy_failed')));
            return;
        }
        const use = e.target.closest('.fb-tz-scheme-use');
        if (use) { fbTzApplyPreset(fbTz.presets[+use.dataset.i]); return; }
        const del = e.target.closest('.fb-tz-scheme-del');
        if (del) {
            const s = fbTz.presets[+del.dataset.i];
            if (!s) return;
            showConfirmDialog({ message: meowI18n.t('fbtz_scheme_del_confirm', { name: s.name }), type: 'danger' }).then(ok => {
                if (!ok) return;
                fbTz.presets.splice(+del.dataset.i, 1);
                chrome.storage.local.set({ [FBTZ_STORE.presets]: fbTz.presets });
                fbTzRenderPresets();
            });
        }
    });

    chrome.storage.local.get(Object.values(FBTZ_STORE), res => {
        const st = res[FBTZ_STORE.state];
        if (st && st.fb && st.target) {
            fbTz.fb = Object.assign(fbTz.fb, st.fb);
            fbTz.target = Object.assign(fbTz.target, st.target);
            fbTz.targetTime = st.targetTime || fbTz.targetTime;
            fbTz.dayOffset = typeof st.dayOffset === 'number' ? st.dayOffset : 0;
        }
        fbTz.presets = Array.isArray(res[FBTZ_STORE.presets]) ? res[FBTZ_STORE.presets] : [];
        fbTzSetCollapsed(!!res[FBTZ_STORE.collapsed], false);

        fbTzFillFbNow();
        fbTzSyncToDom();
        fbTzRenderPresets();
        fbTzRender();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fbTzInit);
} else {
    fbTzInit();
}
