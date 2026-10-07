// sp-regcode.js - 注册码管理模块（软件注册码客户信息管理）
// 管理自己开发的软件所售出的注册码：软件分类、购买人联系方式、硬件码、注册码、购买/到期时间
// 每个软件可选数据源：本地（storage.local）或该软件自己的授权服务器（API 地址 + Bearer Token，
// 字段名可映射；服务器为数据真源，本地只留缓存供离线只读查看）
// 参照 sp-servers.js 的模式创建

// ================== 全局状态 ==================
let myRegCodes = [];
let editingRegRecord = null;
let regDragSrcId = null;

// 软件分类
let regCategories = []; // [{ id, name }]
let regActiveCategoryId = ''; // '' = 全部

// ================== 数据持久化 ==================
function saveRegCodes() {
    chrome.storage.local.set({ 'meow_regcodes': myRegCodes });
}

function saveRegCategories() {
    chrome.storage.local.set({ 'meow_regcode_categories': regCategories });
}

async function loadRegCategories() {
    try {
        const localData = await chrome.storage.local.get(['meow_regcode_categories']);
        regCategories = localData.meow_regcode_categories || [];
    } catch (e) {
        console.error('注册码分类加载失败:', e);
        regCategories = [];
    }
}

// 获取某分类名
function getRegCategoryName(catId) {
    const c = regCategories.find(x => x.id === catId);
    return c ? c.name : '';
}

// ================== 数据源（本地 / API）==================
// 每个软件可二选一：数据存在本地 storage.local，或由该软件的授权服务器管理。
// API 模式下服务器是数据真源，本地只保留一份缓存供请求失败时离线查看（只读）。
const REG_SRC_STORE_KEY = 'meow_regcode_sources';
const REG_CACHE_STORE_KEY = 'meow_regcode_api_cache';

// 本地字段 -> 服务器字段（映射留空即同名）
const REG_MAP_FIELDS = [
    { k: 'contact', label: '联系方式' },
    { k: 'hwid', label: '硬件码' },
    { k: 'username', label: '注册用户名' },
    { k: 'code', label: '注册码' },
    { k: 'quota', label: '授权数量' },
    { k: 'purchase', label: '购买时间', date: true },
    { k: 'expiry', label: '到期时间', date: true },
    { k: 'salePrice', label: '销售金额' },
    { k: 'note', label: '备注' }
];

// 联系方式一个输入框，类型靠这个下拉区分；contactType 只存本地（服务器没有这一列）
const REG_CONTACT_TYPES = [
    { k: 'nickname', label: '昵称' },
    { k: 'wechat', label: '微信号' },
    { k: 'phone', label: '电话' },
    { k: 'qq', label: 'QQ' },
    { k: 'email', label: '邮箱' },
    { k: 'whatsapp', label: 'WhatsApp' },
    { k: 'other', label: '其它' }
];

function regContactLabel(type) {
    const hit = REG_CONTACT_TYPES.find(t => t.k === type);
    return hit ? hit.label : '联系方式';
}

// 四个写操作的方法与路径模板；路径支持 {id}，相对 API 地址拼接
const REG_OPS = [
    { k: 'list', label: '列表', method: 'GET', path: '' },
    { k: 'create', label: '新增', method: 'POST', path: '' },
    { k: 'update', label: '修改', method: 'PUT', path: '/{id}' },
    { k: 'remove', label: '删除', method: 'DELETE', path: '/{id}' }
];

let regSources = {};        // catId -> API 配置
const REG_REQUEST_TIMEOUT = 15000;
let regApiRecords = {};     // catId -> 记录数组（最近一次成功请求，或缓存水合）
let regApiStatus = {};      // catId -> { state: 'ok'|'error'|'loading'|'cached', at, message }
let regCacheStore = {};     // catId -> { at, records }，整份驻留内存，避免读-改-写竞争
const regLoadingSources = new Set();

function defaultRegSourceConfig() {
    const ops = {};
    REG_OPS.forEach(o => { ops[o.k] = { method: o.method, path: o.path, extra: '' }; });
    return {
        type: 'api', baseUrl: '', token: '', idField: 'id', dataPath: '', fieldMap: {},
        encoding: 'json', authIn: 'header', authField: 'token', ops: ops
    };
}

// 补齐历史配置缺少的键，保证界面与请求层读到的一定是完整形状
function normalizeRegSource(raw) {
    const src = raw || {};
    const cfg = Object.assign(defaultRegSourceConfig(), src);
    cfg.fieldMap = Object.assign({}, src.fieldMap || {});
    cfg.encoding = ['json', 'form'].includes(cfg.encoding) ? cfg.encoding : 'json';
    cfg.authIn = ['header', 'body'].includes(cfg.authIn) ? cfg.authIn : 'header';
    cfg.authField = String(cfg.authField || 'token').trim() || 'token';
    cfg.ops = {};
    REG_OPS.forEach(o => {
        const op = (src.ops && src.ops[o.k]) || {};
        cfg.ops[o.k] = {
            method: String(op.method || o.method).toUpperCase(),
            path: op.path !== undefined ? String(op.path) : o.path,
            extra: op.extra !== undefined ? String(op.extra) : ''
        };
    });
    return cfg;
}

// 只有「选了 API 且填了地址」才算 API 源，配置一半的软件按本地对待
function regSourceOf(catId) {
    const cfg = catId ? regSources[catId] : null;
    if (!cfg || cfg.type !== 'api' || !String(cfg.baseUrl || '').trim()) return null;
    return cfg;
}

function isRegApiSource(catId) {
    return !!regSourceOf(catId);
}

// ---------- 服务器字段映射与日期归一化 ----------
function regServerField(cfg, key) {
    if (key === 'id') return cfg.idField || 'id';
    const mapped = (cfg.fieldMap || {})[key];
    return (mapped && String(mapped).trim()) || key;
}

function regStampToDate(sec) {
    const d = new Date(sec * 1000);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

// 各家服务器的时间字段形态不一：Unix 秒/毫秒、ISO、YYYY-MM-DD 都要能读
function regReadDate(v) {
    if (v === null || v === undefined || v === '') return { value: '', kind: 'text' };
    if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim()))) {
        let n = Number(String(v).trim());
        if (n > 1e12) n = Math.floor(n / 1000);
        if (n > 1e9) {
            const s = regStampToDate(n);
            if (s) return { value: s, kind: 'unix' };
        }
    }
    const s = String(v).trim().replace('T', ' ').replace(/\//g, '-');
    const m = s.match(/^\d{4}-\d{2}-\d{2}/);
    return { value: m ? m[0] : s, kind: 'text' };
}

// 写回时按读取时的原始形态返回，避免把服务器上的时间戳改写成字符串
function regWriteDate(value, kind) {
    if (!value) return kind === 'unix' ? 0 : '';
    if (kind !== 'unix') return value;
    const d = new Date(String(value).replace(/-/g, '/') + ' 00:00:00');
    if (isNaN(d.getTime())) return 0;
    return Math.floor(d.getTime() / 1000);
}

function regMapFromServer(raw, cfg, catId) {
    const reg = {
        origin: 'api',
        categoryId: catId,
        _sid: raw ? raw[regServerField(cfg, 'id')] : '',
        _raw: raw || {},
        _dk: {}
    };
    reg.id = 'api:' + catId + ':' + String(reg._sid === undefined ? '' : reg._sid);
    REG_MAP_FIELDS.forEach(f => {
        const v = raw ? raw[regServerField(cfg, f.k)] : undefined;
        if (f.date) {
            const parsed = regReadDate(v);
            reg[f.k] = parsed.value;
            reg._dk[f.k] = parsed.kind;
        } else if (v === null || v === undefined) {
            reg[f.k] = '';
        } else {
            reg[f.k] = String(v);
        }
    });
    return reg;
}

// 以服务器原始对象为底再覆盖已知字段：未知字段原样带回，防止 PUT 把人家数据洗掉
function regMapToServer(form, reg, cfg, withId) {
    const out = Object.assign({}, (reg && reg._raw) || {});
    if (withId) out[regServerField(cfg, 'id')] = reg ? reg._sid : '';
    REG_MAP_FIELDS.forEach(f => {
        const rawVal = (reg && reg._raw) ? reg._raw[regServerField(cfg, f.k)] : undefined;
        let val = form[f.k];
        if (f.date) val = regWriteDate(val, reg && reg._dk ? reg._dk[f.k] : 'text');
        else if (typeof rawVal === 'number') {
            const n = parseFloat(val);
            val = isNaN(n) ? 0 : n;
        }
        out[regServerField(cfg, f.k)] = val;
    });
    return out;
}

// ---------- 请求层 ----------
function regJoinUrl(base, path) {
    const b = String(base || '').trim().replace(/\/+$/, '');
    const p = String(path || '').trim();
    if (!p) return b;
    if (/^https?:\/\//i.test(p)) return p;
    return b + (p.charAt(0) === '/' ? p : '/' + p);
}

// 列表在响应里的位置各家不同：先按配置取，再探测常见包装字段
function regExtractList(json, dataPath) {
    if (Array.isArray(json)) return json;
    if (!json || typeof json !== 'object') return null;
    if (dataPath) {
        let node = json;
        String(dataPath).split('.').forEach(k => {
            if (!k || node === null || node === undefined) return;
            node = node[k];
        });
        if (Array.isArray(node)) return node;
    }
    const probes = ['data', 'list', 'rows', 'items', 'result', 'records', 'codes'];
    for (const key of probes) {
        if (Array.isArray(json[key])) return json[key];
        const inner = json[key];
        if (inner && typeof inner === 'object') {
            for (const sub of probes) if (Array.isArray(inner[sub])) return inner[sub];
        }
    }
    return null;
}

// 附加固定参数，如 PHP 侧用 del=1 表示删除
function regParseExtra(extra) {
    const out = {};
    String(extra || '').split('&').forEach(pair => {
        const i = pair.indexOf('=');
        if (!pair || i <= 0) return;
        out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    });
    return out;
}

async function regApiRequest(cfg, opKey, payload, idValue) {
    const spec = (cfg.ops && cfg.ops[opKey]) || defaultRegSourceConfig().ops[opKey];
    const path = String(spec.path || '').replace(/\{id\}/g, encodeURIComponent(idValue === undefined || idValue === null ? '' : String(idValue)));
    const url = regJoinUrl(cfg.baseUrl, path);
    if (!/^https?:\/\//i.test(url)) throw new Error('API 地址需以 http(s):// 开头');

    const method = spec.method;
    const toQuery = method === 'GET' || method === 'HEAD';
    // 请求体 = 记录字段 + 该操作的固定参数 + （可选）放体的 token
    const fields = Object.assign({}, payload || {}, regParseExtra(spec.extra));
    // 路径里没有 {id} 占位时（PHP 那种统一端点），主键必须随体提交，否则服务端不知道改哪条
    const idField = cfg.idField || 'id';
    const pathHasId = String(spec.path || '').indexOf('{id}') !== -1;
    const idStr = idValue === undefined || idValue === null ? '' : String(idValue);
    if (idStr && !pathHasId && fields[idField] === undefined) fields[idField] = idStr;
    const headers = {};
    if (cfg.token) {
        if (cfg.authIn === 'body') fields[cfg.authField || 'token'] = cfg.token;
        else headers['Authorization'] = 'Bearer ' + cfg.token;
    }

    let finalUrl = url;
    const init = { method: method, headers: headers };
    if (toQuery) {
        const qs = new URLSearchParams(fields).toString();
        if (qs) finalUrl += (finalUrl.indexOf('?') === -1 ? '?' : '&') + qs;
    } else if (Object.keys(fields).length) {
        if (cfg.encoding === 'form') {
            // PHP 的 $_POST 只解析表单编码，发 JSON 它会当成所有参数缺失
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            init.body = new URLSearchParams(fields).toString();
        } else {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(fields);
        }
    }

    // 没有超时的 fetch 会让"点保存没反应"变成无法判断的死等：15 秒没响应就报错
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REG_REQUEST_TIMEOUT);
    init.signal = ctrl.signal;
    let res;
    try {
        res = await fetch(finalUrl, init);
    } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('请求超时（' + (REG_REQUEST_TIMEOUT / 1000) + ' 秒无响应）');
        throw new Error('连不上服务器：' + (e && e.message || e));
    } finally {
        clearTimeout(timer);
    }
    const text = await res.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (e) { json = null; } }
    if (!res.ok) {
        const detail = (json && (json.message || json.msg || json.error)) || (text ? text.slice(0, 120) : '');
        let msg = 'HTTP ' + res.status + (detail ? ' · ' + detail : '');
        // 403 九成是 token 没带上或带错了地方，直接说出来，别让人去猜
        if (res.status === 403 && (!cfg.token || cfg.authIn !== 'body')) {
            msg += '（请确认 Token 已填写，且「Token 位置」与服务端读取的位置一致：PHP 的 $_POST 只认请求体字段）';
        }
        throw new Error(msg);
    }
    return json;
}

// ---------- 拉取 / 缓存 ----------
async function fetchRegSource(catId, cfg) {
    const json = await regApiRequest(cfg, 'list');
    const rows = regExtractList(json, cfg.dataPath);
    if (!rows) throw new Error('响应里没找到列表数组，可填写「数据路径」');
    return rows.map(raw => regMapFromServer(raw, cfg, catId));
}

async function ensureRegSource(catId) {
    const cfg = regSourceOf(catId);
    if (!cfg) return;
    if (regLoadingSources.has(catId)) return;
    regLoadingSources.add(catId);
    regApiStatus[catId] = { state: 'loading', at: (regApiStatus[catId] || {}).at || 0 };
    renderRegSourceBanner();
    try {
        const records = await fetchRegSource(catId, cfg);
        regApiRecords[catId] = records;
        regApiStatus[catId] = { state: 'ok', at: Date.now() };
        regStampShadows(catId);
        regCacheStore[catId] = { at: Date.now(), records: records };
        chrome.storage.local.set({ [REG_CACHE_STORE_KEY]: regCacheStore });
    } catch (e) {
        regApiStatus[catId] = {
            state: 'error',
            at: (regApiStatus[catId] || {}).at || 0,
            message: String(e && e.message || e)
        };
    } finally {
        regLoadingSources.delete(catId);
        renderRegCodes();
        renderRegSourceBanner();
    }
}

function refreshRegScope() {
    if (regActiveCategoryId) {
        ensureRegSource(regActiveCategoryId);
        return;
    }
    regCategories.forEach(cat => {
        if (regSourceOf(cat.id)) ensureRegSource(cat.id);
    });
}

// 服务器主键是否可用：不可用时删除/修改会给出明确提示而不是拼出错误 URL
function regRecordHasServerId(reg) {
    return reg && reg.origin === 'api' && reg._sid !== undefined && reg._sid !== null && reg._sid !== '';
}

// ---------- 数据源与缓存的持久化 ----------
async function loadRegSources() {
    try {
        const d = await chrome.storage.local.get([REG_SRC_STORE_KEY, REG_CACHE_STORE_KEY]);
        const raw = d[REG_SRC_STORE_KEY] || {};
        regSources = {};
        Object.keys(raw).forEach(catId => { regSources[catId] = normalizeRegSource(raw[catId]); });
        regCacheStore = d[REG_CACHE_STORE_KEY] || {};
        Object.keys(regCacheStore).forEach(catId => {
            const cfg = regSourceOf(catId);
            const entry = regCacheStore[catId];
            if (!cfg || !entry || !Array.isArray(entry.records)) return;
            // 缓存里存的是映射后的记录，直接水合，字段以当前映射为准
            regApiRecords[catId] = entry.records.map(raw2 => regMapFromServer(raw2 && raw2._raw ? raw2._raw : raw2, cfg, catId));
            regApiStatus[catId] = { state: 'cached', at: entry.at || 0 };
        });
    } catch (e) {
        console.error('注册码数据源加载失败:', e);
        regSources = {};
    }
}

function saveRegSources() {
    chrome.storage.local.set({ [REG_SRC_STORE_KEY]: regSources });
}

function removeRegSourceFor(catId) {
    delete regSources[catId];
    delete regApiRecords[catId];
    delete regApiStatus[catId];
    delete regCacheStore[catId];
    saveRegSources();
    chrome.storage.local.set({ [REG_CACHE_STORE_KEY]: regCacheStore });
}

// ---------- 记录合并视图 ----------
// 主键由哪个本地字段提交（如 硬件码 -> hardid），没映射则无法关联
function regIdLocalKey(cfg) {
    const idf = cfg.idField || 'id';
    const hit = REG_MAP_FIELDS.find(f => String((cfg.fieldMap || {})[f.k] || '').trim() === idf);
    return hit ? hit.k : '';
}

// 填了映射的字段即「服务器托管」，其余字段服务器无处存，落本地影子记录
function regHostedKeys(cfg) {
    const hosted = REG_MAP_FIELDS
        .filter(f => String((cfg.fieldMap || {})[f.k] || '').trim())
        .map(f => f.k);
    const idKey = regIdLocalKey(cfg);
    if (idKey) hosted.push(idKey);
    return Array.from(new Set(hosted));
}

function regLocalRecords(catId) {
    return myRegCodes
        .filter(r => !r.linked)
        .filter(r => !catId || r.categoryId === catId)
        .map(r => Object.assign({ origin: 'local' }, r));
}

// API 记录按主键挂上本地 CRM 字段；没配映射的软件保持原样
function regMergedApiRecords(catId) {
    const cfg = regSourceOf(catId);
    const apiList = regApiRecords[catId] || [];
    if (!cfg) return apiList.slice();

    const hosted = regHostedKeys(cfg);
    if (hosted.length === REG_MAP_FIELDS.length) return apiList.slice();
    const idKey = regIdLocalKey(cfg) || 'hwid';
    const shadows = myRegCodes.filter(r => r.categoryId === catId && r.linked);
    const used = new Set();

    // 一条影子只能属于一条服务器记录：先按上次盖好的服务器主键认，
    // 认不出再退到业务键（硬件码）。硬件码在库里没有唯一约束，
    // 允许重复，所以必须"消费"，否则同一个昵称会同时挂到两张卡片上，
    // 删其中一张还会把影子一起带走。
    function takeShadow(reg) {
        const sid = String(reg._sid === undefined ? '' : reg._sid);
        const key = String(reg[idKey] || '');
        let hit = sid ? shadows.find(s => !used.has(s.id) && s.linkedSid !== undefined && String(s.linkedSid) === sid) : null;
        if (!hit && key) hit = shadows.find(s => !used.has(s.id) && String(s[idKey] || '') === key);
        if (hit) used.add(hit.id);
        return hit || null;
    }

    const merged = apiList.map(reg => {
        const local = takeShadow(reg);
        const out = Object.assign({}, reg);
        REG_MAP_FIELDS.forEach(f => {
            if (hosted.includes(f.k)) return;
            out[f.k] = local ? (local[f.k] || '') : '';
        });
        // 类型不在映射表里（服务器没这列），跟着影子走
        out.contactType = local ? (local.contactType || 'nickname') : 'nickname';
        out._localId = local ? local.id : null;
        return out;
    });

    // 服务器还没这条（离线、或刚提交没回读）时，别把用户填的客户信息藏起来
    const orphans = shadows
        .filter(s => !used.has(s.id))
        .map(s => Object.assign({ origin: 'local' }, s));
    return merged.concat(orphans);
}

// 回读成功后，把服务器主键盖到影子上，之后就不靠硬件码猜是哪条了
function regStampShadows(catId) {
    const cfg = regSourceOf(catId);
    if (!cfg) return;
    const idKey = regIdLocalKey(cfg) || 'hwid';
    const apiList = regApiRecords[catId] || [];
    const shadows = myRegCodes.filter(r => r.categoryId === catId && r.linked);
    const used = new Set();
    let changed = false;
    apiList.forEach(reg => {
        const sid = String(reg._sid === undefined ? '' : reg._sid);
        const key = String(reg[idKey] || '');
        if (!sid || !key) return;
        let hit = shadows.find(s => !used.has(s.id) && s.linkedSid !== undefined && String(s.linkedSid) === sid);
        if (!hit) hit = shadows.find(s => !used.has(s.id) && String(s[idKey] || '') === key);
        if (!hit) return;
        used.add(hit.id);
        if (String(hit.linkedSid || '') !== sid) {
            hit.linkedSid = sid;
            changed = true;
        }
    });
    if (changed) saveRegCodes();
}

// 当前界面要渲染的记录：本地记录 +（当前或全部）API 记录
function visibleRegRecords() {
    if (regActiveCategoryId) {
        return regLocalRecords(regActiveCategoryId).concat(regMergedApiRecords(regActiveCategoryId));
    }
    let list = regLocalRecords('');
    regCategories.forEach(cat => {
        if (regSourceOf(cat.id)) list = list.concat(regMergedApiRecords(cat.id));
    });
    return list;
}

function allRegRecords() {
    let list = regLocalRecords('');
    regCategories.forEach(cat => {
        if (regSourceOf(cat.id)) list = list.concat(regMergedApiRecords(cat.id));
    });
    return list;
}

// ================== 到期状态 ==================
function getRegExpiryInfo(reg) {
    if (!reg.expiry) return { type: 'lifetime', label: '永久授权', className: 'reg-status-lifetime', critical: false };
    const exp = new Date(String(reg.expiry).replace(/-/g, '/') + ' 00:00:00');
    if (isNaN(exp.getTime())) return { type: 'lifetime', label: '永久授权', className: 'reg-status-lifetime', critical: false };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((exp.getTime() - today.getTime()) / 86400000);
    // critical：距到期 ≤ 5 天（含已到期），卡片标题显示红色
    const critical = diffDays <= 5;
    if (diffDays < 0) return { type: 'expired', label: `已到期 ${-diffDays} 天`, className: 'reg-status-expired', critical: true };
    if (diffDays === 0) return { type: 'soon', label: '今日到期', className: 'reg-status-soon', critical: true };
    if (diffDays <= 30) return { type: 'soon', label: `剩余 ${diffDays} 天`, className: 'reg-status-soon', critical };
    return { type: 'normal', label: `剩余 ${diffDays} 天`, className: 'reg-status-normal', critical: false };
}

// 卡片显示名称：昵称 > 微信
function getRegDisplayName(reg) {
    return reg.contact || '(未命名客户)';
}

// 销售金额格式化（保留最多两位小数，去掉多余的 0）
function formatRegPrice(price) {
    const n = parseFloat(price);
    if (isNaN(n)) return '';
    return (Math.round(n * 100) / 100).toString();
}

// 在日期上增加 N 个月（处理月末溢出，如 1/31 + 1 月 → 2/28）
function addRegMonths(dateStr, months) {
    const d = new Date(String(dateStr).replace(/-/g, '/') + ' 00:00:00');
    if (isNaN(d.getTime())) return '';
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() !== day) d.setDate(0); // 退回上一个月的最后一天
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

// 今天的日期字符串（YYYY-MM-DD）
function getRegToday() {
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ================== 左侧软件分类栏 ==================
function renderRegCatTabs() {
    const sidebar = document.getElementById('reg-sidebar');
    if (!sidebar) return;

    // 保留"全部"Tab，移除中间的分类 Tab
    const allTab = sidebar.querySelector('.srv-cat-tab[data-cat-id=""]');
    sidebar.querySelectorAll('.srv-cat-tab:not([data-cat-id=""])').forEach(el => el.remove());

    if (allTab) {
        const allActive = !regActiveCategoryId;
        allTab.classList.toggle('active', allActive);
        const allIcon = allTab.querySelector('i');
        if (allIcon) allIcon.className = allActive ? 'fa-regular fa-folder-open' : 'fa-regular fa-folder';
        allTab.addEventListener('click', function() {
            regActiveCategoryId = '';
            renderRegCatTabs();
            renderRegCodes();
            refreshRegScope();
        });
    }

    regCategories.forEach((cat, index) => {
        const tab = document.createElement('div');
        tab.className = 'srv-cat-tab' + (cat.id === regActiveCategoryId ? ' active' : '');
        tab.dataset.catId = cat.id;
        tab.dataset.catName = cat.name;
        tab.dataset.index = index;
        tab.title = cat.name + (regSourceOf(cat.id) ? '（通过 API 管理）' : '（本地管理）');
        tab.innerHTML = `<i class="fa-regular ${cat.id === regActiveCategoryId ? 'fa-folder-open' : 'fa-folder'}"></i><span class="srv-cat-label">${escapeHtml(cat.name)}</span>` +
            (regSourceOf(cat.id) ? '<span class="reg-cat-src-dot" title="通过 API 管理"></span>' : '');
        tab.addEventListener('click', function() {
            regActiveCategoryId = cat.id;
            renderRegCatTabs();
            renderRegCodes();
            ensureRegSource(cat.id);
        });
        // 拖拽排序
        tab.draggable = true;
        tab.addEventListener('dragstart', function(e) {
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
        });
        tab.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            sidebar.querySelectorAll('.srv-cat-tab').forEach(el => el.classList.remove('drag-over'));
        });
        tab.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.classList.add('drag-over');
        });
        tab.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
        });
        tab.addEventListener('drop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            this.classList.remove('drag-over');
            const srcIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const destIndex = index;
            if (srcIndex !== destIndex) {
                const item = regCategories.splice(srcIndex, 1)[0];
                regCategories.splice(destIndex, 0, item);
                saveRegCategories();
                renderRegCatTabs();
            }
        });
        sidebar.appendChild(tab);
    });
}

// ================== 列表渲染 ==================
function renderRegCodes() {
    const regList = document.getElementById('reg-list');
    const regEmpty = document.getElementById('reg-empty');
    const regCountBar = document.getElementById('reg-count-bar');
    if (!regList || !regEmpty) return;
    regList.innerHTML = '';

    const filterInput = document.getElementById('reg-filter-input');
    const filterText = (filterInput ? filterInput.value.trim().toLowerCase() : '');

    const records = visibleRegRecords();

    if (records.length === 0) {
        regEmpty.classList.remove('hidden');
        regEmpty.querySelector('p').innerHTML = '暂无注册码记录<br>点击上方 + 添加';
        if (regCountBar) regCountBar.textContent = '共 0 条注册码';
        renderRegStatusBar();
        renderRegSourceBanner();
        return;
    }
    regEmpty.classList.add('hidden');

    let visibleCount = 0;

    records.forEach((reg, index) => {
        // 搜索过滤
        let matchFilter = true;
        if (filterText) {
            const catName = getRegCategoryName(reg.categoryId);
            const haystack = [reg.contact, regContactLabel(reg.contactType), reg.hwid, reg.username, reg.code, reg.note, catName].join(' ').toLowerCase();
            matchFilter = haystack.includes(filterText);
        }

        if (!matchFilter) return;

        visibleCount++;
        const expiryInfo = getRegExpiryInfo(reg);
        const displayName = getRegDisplayName(reg);
        const catName = getRegCategoryName(reg.categoryId);
        const hasPrice = (reg.salePrice !== undefined && reg.salePrice !== null && reg.salePrice !== '');

        const card = document.createElement('div');
        card.className = 'srv-card reg-card';
        card.dataset.id = reg.id;

        card.innerHTML = `
            <div class="srv-card-header reg-card-header">
                <span class="mi srv-card-toggle fa-regular fa-chevron-down"></span>
                <span class="mi fa-regular fa-shield-check" style="font-size:16px;color:#8b5cf6;"></span>
                <span class="srv-card-name reg-card-name${expiryInfo.critical ? ' reg-card-name-danger' : ''}" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
                ${hasPrice ? `<span class="reg-price-badge" title="销售金额">¥${formatRegPrice(reg.salePrice)}</span>` : ''}
                <span class="reg-status-badge ${expiryInfo.className}">${expiryInfo.label}</span>
                <div class="srv-card-actions">
                    <span class="mi reg-edit-btn fa-regular fa-pen-to-square" data-id="${reg.id}" title="编辑"></span>
                    <i class="fa-regular fa-xmark reg-del-btn" data-id="${reg.id}" title="删除"></i>
                </div>
            </div>
            <div class="srv-card-body" style="display:none">
                ${catName ? `<div class="srv-info-row"><span class="srv-info-label">软件名称</span><span class="srv-info-val">${escapeHtml(catName)}</span></div>` : ''}
                ${reg.contact ? `<div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(reg.contact)}" title="点击复制"><span class="srv-info-label">联系方式(${escapeHtml(regContactLabel(reg.contactType))})</span><span class="srv-info-val">${escapeHtml(reg.contact)}</span></div>` : ''}
                ${reg.username ? `<div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(reg.username)}" title="点击复制"><span class="srv-info-label">注册用户名</span><span class="srv-info-val">${escapeHtml(reg.username)}</span></div>` : ''}
                ${reg.hwid ? `<div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(reg.hwid)}" title="点击复制"><span class="srv-info-label">硬件码</span><span class="srv-info-val reg-hw-val">${escapeHtml(reg.hwid)}</span></div>` : ''}
                <div class="srv-info-row srv-copy-row" data-copy="${escapeHtml(reg.code || '')}" title="点击复制"><span class="srv-info-label">注册码</span><span class="srv-info-val reg-code-val-inline">${escapeHtml(reg.code || '--')}</span></div>
                ${reg.quota !== undefined && reg.quota !== null && reg.quota !== '' ? `<div class="srv-info-row"><span class="srv-info-label">授权数量</span><span class="srv-info-val">${escapeHtml(String(reg.quota))}</span></div>` : ''}
                <div class="srv-info-row"><span class="srv-info-label">购买时间</span><span class="srv-info-val">${escapeHtml(reg.purchase || '--')}</span></div>
                <div class="srv-info-row"><span class="srv-info-label">到期时间</span><span class="srv-info-val">${escapeHtml(reg.expiry || '永久授权')}</span></div>
                ${reg.note ? `<div class="srv-note-box"><span class="mi fa-regular fa-file-lines" style="font-size:12px;color:#a8a29e;"></span> ${escapeHtml(reg.note)}</div>` : ''}
                <div class="reg-card-actions">
                    <button class="srv-copy-btn" data-copy-type="all" title="一键复制客户全部信息"><span class="mi fa-regular fa-copy" style="font-size:13px;"></span>复制全部信息</button>
                </div>
            </div>
        `;

        // 折叠/展开
        card.querySelector('.srv-card-header').addEventListener('click', function(e) {
            if (e.target.closest('.srv-card-actions, .reg-del-btn, .reg-edit-btn')) return;
            const body = card.querySelector('.srv-card-body');
            const isExpanded = card.classList.toggle('expanded');
            body.style.display = isExpanded ? '' : 'none';
        });

        // 单行点击复制
        card.querySelectorAll('.srv-copy-row').forEach(row => {
            row.addEventListener('click', function(e) {
                e.stopPropagation();
                const val = this.dataset.copy;
                if (val) copyToClipboard(val);
            });
        });

        // 一键复制全部信息
        const copyAllBtn = card.querySelector('[data-copy-type="all"]');
        if (copyAllBtn) {
            copyAllBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const text = [
                    `软件：${catName || '-'}`,
                    `联系方式(${regContactLabel(reg.contactType)})：${reg.contact || ''}`,
                    `注册用户名：${reg.username || ''}`,
                    `硬件码：${reg.hwid || ''}`,
                    `注册码：${reg.code || ''}`,
                    `授权数量：${reg.quota || ''}`,
                    `销售金额：¥${formatRegPrice(reg.salePrice) || '0'}`,
                    `购买时间：${reg.purchase || ''}`,
                    `到期时间：${reg.expiry || '永久'}`,
                    `备注：${reg.note || ''}`
                ].join('\n');
                copyToClipboard(text);
                showToast('已复制全部信息');
            });
        }

        // 编辑
        card.querySelector('.reg-edit-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            openRegModal(reg);
        });

        // 删除
        card.querySelector('.reg-del-btn').addEventListener('click', async function(e) {
            e.stopPropagation();
            if (await showConfirmDialog({ message: regDeleteConfirmText(reg), type: 'danger' })) {
                await deleteRegRecord(reg);
            }
        });

        // 拖拽排序：服务器记录的顺序由服务端决定，只有本地记录可排
        card.draggable = (reg.origin === 'local');
        if (reg.origin === 'local') {
            card.addEventListener('dragstart', function(e) {
                this.classList.add('dragging');
                regDragSrcId = reg.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', reg.id);
            });
            card.addEventListener('dragend', function() {
                this.classList.remove('dragging');
                document.querySelectorAll('#reg-list .reg-card').forEach(el => el.classList.remove('drag-over'));
                regDragSrcId = null;
            });
            card.addEventListener('dragover', function(e) {
                if (reg.origin !== 'local') return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                this.classList.add('drag-over');
            });
            card.addEventListener('dragleave', function() {
                this.classList.remove('drag-over');
            });
            card.addEventListener('drop', function(e) {
                e.stopPropagation();
                e.preventDefault();
                this.classList.remove('drag-over');
                if (reg.origin !== 'local' || regDragSrcId === null || regDragSrcId === reg.id) return;
                const srcIdx = myRegCodes.findIndex(r => r.id === regDragSrcId);
                const dstIdx = myRegCodes.findIndex(r => r.id === reg.id);
                if (srcIdx !== -1 && dstIdx !== -1) {
                    const item = myRegCodes.splice(srcIdx, 1)[0];
                    myRegCodes.splice(dstIdx, 0, item);
                    saveRegCodes();
                    renderRegCodes();
                }
                regDragSrcId = null;
            });
        }

        regList.appendChild(card);
    });

    if (visibleCount === 0 && records.length > 0) {
        regEmpty.classList.remove('hidden');
        regEmpty.querySelector('p').textContent = '无匹配结果';
    }

    // 更新计数栏
    if (regCountBar) {
        const totalCount = records.length;
        const remoteCount = records.filter(r => r.origin === 'api').length;
        const remoteTag = remoteCount > 0 ? ` · 服务器 ${remoteCount} 条` : '';
        if (filterText && visibleCount < totalCount) {
            regCountBar.textContent = `共 ${totalCount} 条注册码（显示 ${visibleCount} 条）${remoteTag}`;
        } else if (regActiveCategoryId) {
            const catName = getRegCategoryName(regActiveCategoryId) || '未命名';
            regCountBar.textContent = `「${catName}」下有 ${totalCount} 条注册码${remoteTag}`;
        } else {
            regCountBar.textContent = `共 ${totalCount} 条注册码${remoteTag}`;
        }
    }

    renderRegStatusBar();
    renderRegSourceBanner();
}

// 底部统计栏：销售额 + 到期状态
function renderRegStatusBar() {
    const bar = document.getElementById('reg-status-bar');
    if (!bar) return;
    const records = allRegRecords();
    if (records.length === 0) {
        bar.style.display = 'none';
        bar.innerHTML = '';
        return;
    }
    let totalSales = 0;
    let expired = 0, soon = 0;
    records.forEach(r => {
        const price = parseFloat(r.salePrice);
        if (!isNaN(price)) totalSales += price;
        const info = getRegExpiryInfo(r);
        if (info.type === 'expired') expired++;
        else if (info.type === 'soon') soon++;
    });
    const fmtMoney = n => '¥' + (Math.round(n * 100) / 100).toString();
    const parts = [];
    if (totalSales > 0) parts.push(`销售额 <span class="reg-stat-sales">${fmtMoney(totalSales)}</span>`);
    if (soon > 0) parts.push(`<span class="reg-stat-soon">即将到期 ${soon}</span>`);
    if (expired > 0) parts.push(`<span class="reg-stat-expired">已到期 ${expired}</span>`);
    if (parts.length === 0) {
        bar.style.display = 'none';
        bar.innerHTML = '';
        return;
    }
    bar.style.display = '';
    bar.innerHTML = parts.join(' · ');
}

// ================== 数据源状态横幅 ==================
function formatRegTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function renderRegSourceBanner() {
    const banner = document.getElementById('reg-source-banner');
    if (!banner) return;

    const scopeIds = regActiveCategoryId
        ? [regActiveCategoryId]
        : regCategories.map(c => c.id);
    const apiIds = scopeIds.filter(id => regSourceOf(id));
    if (apiIds.length === 0) {
        banner.style.display = 'none';
        banner.innerHTML = '';
        return;
    }

    const states = apiIds.map(id => regApiStatus[id] || {});
    const loading = states.some(s => s.state === 'loading') || apiIds.some(id => regLoadingSources.has(id));
    const failed = states.filter(s => s.state === 'error');
    const lastAt = Math.max.apply(null, [0].concat(states.map(s => s.at || 0)));

    let cls = 'reg-src-ok';
    let text;
    if (loading) {
        cls = 'reg-src-loading';
        text = '正在读取服务器数据…';
    } else if (failed.length > 0) {
        cls = 'reg-src-error';
        text = `${apiIds.length > 1 ? failed.length + ' 个软件' : '服务器'}连接失败：` + (failed[0].message || '未知错误');
        text += lastAt ? '，下方为缓存数据' : '，暂无数据';
    } else if (lastAt) {
        text = `${apiIds.length > 1 ? apiIds.length + ' 个 API 软件' : '服务器数据'} · 更新于 ${formatRegTime(lastAt)}`;
    } else {
        cls = 'reg-src-error';
        text = '尚未从服务器读取到数据';
    }

    banner.style.display = '';
    banner.className = 'reg-source-banner ' + cls;
    banner.innerHTML = `
        <span class="mi fa-regular fa-cloud" style="font-size:12px;"></span>
        <span class="reg-src-text">${escapeHtml(text)}</span>
        <button type="button" class="reg-src-refresh" title="重新从服务器拉取"><span class="mi fa-regular fa-arrows-rotate" style="font-size:11px;"></span>刷新</button>
    `;
    const btn = banner.querySelector('.reg-src-refresh');
    if (btn) btn.addEventListener('click', refreshRegScope);
}

// 删除确认文案按数据来源区分：API 记录会真删服务器上的授权
function regDeleteConfirmText(reg) {
    if (reg.origin !== 'api') return '确定删除此注册码记录？';
    return reg._localId
        ? '将删除服务器上的这条授权记录，本机保存的客户信息也一并删除，确定？'
        : '将删除服务器上的这条授权记录，确定？';
}

// ================== 写入分发（本地 / 服务器）==================
function persistRegApiRecords(catId) {
    const at = Date.now();
    regApiStatus[catId] = { state: (regApiStatus[catId] || {}).state === 'error' ? 'error' : 'ok', at: at };
    regCacheStore[catId] = { at: at, records: regApiRecords[catId] || [] };
    chrome.storage.local.set({ [REG_CACHE_STORE_KEY]: regCacheStore });
}

// 等服务器期间给出可见反馈，否则慢网络下就是"点了没反应"；返回还原函数
function regBusy(btn, label) {
    if (!btn) return function() {};
    const oldText = btn.textContent, wasDisabled = btn.disabled;
    btn.textContent = label;
    btn.disabled = true;
    return function() { btn.textContent = oldText; btn.disabled = wasDisabled; };
}

// 网络请求期间把按钮置灰并改文案，慢服务器下不至于看起来像"点了没反应"
async function regCall(btnId, label, fn) {
    const done = regBusy(document.getElementById(btnId), label);
    try {
        return await fn();
    } finally {
        done();
    }
}

// 服务器无处存放的字段落进本地影子记录。
// 关联优先用服务器主键（linkedSid），业务键（硬件码）只作为第一次对上的依据。
function regWriteShadow(cfg, catId, form, existingLocalId, sid) {
    const idKey = regIdLocalKey(cfg) || 'hwid';
    const key = String(form[idKey] || '').trim();
    const hosted = regHostedKeys(cfg);
    const crm = {};
    let hasCrm = false;
    REG_MAP_FIELDS.forEach(f => {
        if (hosted.includes(f.k)) return;
        crm[f.k] = form[f.k] || '';
        if (String(crm[f.k]).trim()) hasCrm = true;
    });
    if (!key) {
        if (hasCrm) showToast('硬件码为空，客户昵称等信息没能与服务器记录关联');
        return;
    }
    let idx = existingLocalId ? myRegCodes.findIndex(r => r.id === existingLocalId) : -1;
    if (idx === -1 && sid) {
        idx = myRegCodes.findIndex(r => r.categoryId === catId && r.linked && String(r.linkedSid || '') === String(sid));
    }
    if (idx === -1) {
        idx = myRegCodes.findIndex(r => r.categoryId === catId && r.linked && String(r[idKey] || '').trim() === key);
    }
    const fields = Object.assign({}, crm);
    fields[idKey] = key;
    fields.contactType = form.contactType || 'nickname';
    if (sid) fields.linkedSid = String(sid);
    if (idx === -1) {
        if (!hasCrm) return;
        myRegCodes.push(Object.assign({ id: Date.now(), categoryId: catId, linked: true }, fields));
    } else {
        Object.assign(myRegCodes[idx], fields);
    }
    saveRegCodes();
}

// 回读之后按业务键找回这条记录的服务器主键，用于给影子盖章
function regSidByKey(catId, idKey, key) {
    const hit = (regApiRecords[catId] || []).find(r => String(r[idKey] || '').trim() === key);
    return hit ? String(hit._sid === undefined ? '' : hit._sid) : '';
}

// 只按"这条卡片当前挂着哪条影子"来删（渲染时已确定 _localId），
// 绝不按硬件码猜：同硬件码有多条时，猜会把别人家的客户信息删掉。
function regDropShadow(catId, localId, sid) {
    const before = myRegCodes.length;
    if (localId) {
        myRegCodes = myRegCodes.filter(r => r.id !== localId);
    } else if (sid) {
        myRegCodes = myRegCodes.filter(r => !(r.categoryId === catId && r.linked && String(r.linkedSid || '') === String(sid)));
    }
    if (myRegCodes.length !== before) {
        saveRegCodes();
        return true;
    }
    return false;
}

async function deleteRegRecord(reg) {
    if (reg.origin !== 'api') {
        myRegCodes = myRegCodes.filter(r => r.id !== reg.id);
        saveRegCodes();
        renderRegCodes();
        showToast('已删除');
        return;
    }
    const cfg = regSourceOf(reg.categoryId);
    if (!cfg) { showToast('该软件的数据源配置已不存在'); return; }
    if (!regRecordHasServerId(reg)) { showToast('该记录缺少服务器主键，无法删除'); return; }
    try {
        // 删除也要带上记录字段：主键填 id 时，服务端仍需要 hardid 这类业务键才能定位记录
        await regCall('reg-delete-btn', '删除中…', () => regApiRequest(cfg, 'remove', regMapToServer(reg, reg, cfg, true), reg._sid));
    } catch (e) {
        showToast('删除失败：' + (e && e.message || e));
        return;
    }
    regApiRecords[reg.categoryId] = (regApiRecords[reg.categoryId] || []).filter(r => r.id !== reg.id);
    persistRegApiRecords(reg.categoryId);
    const cfgForShadow = regSourceOf(reg.categoryId);
    const dropped = cfgForShadow ? regDropShadow(reg.categoryId, reg._localId, reg._sid) : false;
    renderRegCodes();
    showToast(dropped ? '已从服务器删除，本地客户信息一并清除' : '已从服务器删除');
}

// origin 判定：编辑已有记录看记录本身来自哪，新增看目标软件配了哪种数据源
function regRecordOriginFor(form, existing) {
    if (existing) return existing.origin === 'api' ? 'api' : 'local';
    return regSourceOf(form.categoryId) ? 'api' : 'local';
}

async function submitRegRecord(form) {
    const existing = editingRegRecord;

    if (regRecordOriginFor(form, existing) === 'local') {
        if (existing) {
            const idx = myRegCodes.findIndex(r => r.id === existing.id);
            if (idx !== -1) Object.assign(myRegCodes[idx], form);
        } else {
            myRegCodes.push(Object.assign({ id: Date.now() }, form));
        }
        saveRegCodes();
        renderRegCodes();
        closeRegModal();
        showToast(existing ? '已更新' : '已添加');
        return;
    }

    const cfg = regSourceOf(form.categoryId);
    if (!cfg) { showToast('该软件的 API 地址未填写'); return; }

    if (existing) {
        if (!regRecordHasServerId(existing)) { showToast('该记录缺少服务器主键，无法修改'); return; }
        try {
            await regCall('reg-save-btn', '保存中…', () => regApiRequest(cfg, 'update', regMapToServer(form, existing, cfg, true), existing._sid));
        } catch (e) {
            showToast('保存失败：' + (e && e.message || e));
            return;
        }
        showToast('已写入服务器');
    } else {
        // 业务键（硬件码）在库里没有唯一约束：撞上了 register.php 会更新那条而不是新增，
        // 事先问一句，别让人以为多加了一个客户
        const idKey = regIdLocalKey(cfg) || 'hwid';
        const bizKey = String(form[idKey] || '').trim();
        if (bizKey && (regApiRecords[form.categoryId] || []).some(r => String(r[idKey] || '').trim() === bizKey)) {
            const go = await showConfirmDialog({
                message: `服务器上已存在硬件码「${bizKey}」的记录，提交会更新那一条而不是新增客户。确定继续？`,
                type: 'warning'
            });
            if (!go) return;
        }
        try {
            await regCall('reg-save-btn', '提交中…', () => regApiRequest(cfg, 'create', regMapToServer(form, null, cfg, false)));
        } catch (e) {
            showToast('添加失败：' + (e && e.message || e));
            return;
        }
        showToast('已提交到服务器');
    }
    // 写完统一以服务器为准回读，再带着服务器主键写影子，之后就不靠硬件码猜是哪条了
    await regCall('reg-save-btn', '刷新中…', () => ensureRegSource(form.categoryId));
    const sidKey = regIdLocalKey(cfg) || 'hwid';
    regWriteShadow(cfg, form.categoryId, form, existing ? existing._localId : null,
        regSidByKey(form.categoryId, sidKey, String(form[sidKey] || '').trim()));
    closeRegModal();
}

// ================== 编辑弹窗 ==================
function openRegModal(reg) {
    editingRegRecord = reg || null;

    const modalTitle = document.getElementById('reg-modal-title');
    const softwareInput = document.getElementById('reg-software-input');
    const contactTypeInput = document.getElementById('reg-contact-type-input');
    const contactInput = document.getElementById('reg-contact-input');
    const hwidInput = document.getElementById('reg-hwid-input');
    const codeInput = document.getElementById('reg-code-input');
    const usernameInput = document.getElementById('reg-username-input');
    const quotaInput = document.getElementById('reg-quota-input');
    const purchaseInput = document.getElementById('reg-purchase-input');
    const expiryInput = document.getElementById('reg-expiry-input');
    const priceInput = document.getElementById('reg-price-input');
    const noteInput = document.getElementById('reg-note-input');
    const deleteBtn = document.getElementById('reg-delete-btn');

    // 填充分类下拉
    softwareInput.innerHTML = '<option value="">未选择软件</option>';
    regCategories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        // <option> 里塞不进图标字体，用 Unicode 云字符标出「这个软件的数据在服务器上」
        opt.textContent = (regSourceOf(cat.id) ? '☁ ' : '') + cat.name;
        softwareInput.appendChild(opt);
    });

    // 重置
    softwareInput.value = '';
    contactTypeInput.value = 'nickname';
    contactInput.value = '';
    hwidInput.value = '';
    codeInput.value = '';
    usernameInput.value = '';
    quotaInput.value = '';
    purchaseInput.value = '';
    expiryInput.value = '';
    priceInput.value = '';
    noteInput.value = '';
    deleteBtn.classList.add('hidden');
    document.querySelectorAll('#reg-modal .reg-plan-btn').forEach(b => b.classList.remove('selected'));

    if (reg) {
        modalTitle.textContent = '编辑注册码';
        softwareInput.value = reg.categoryId || '';
        contactTypeInput.value = reg.contactType || 'nickname';
        contactInput.value = reg.contact || '';
        hwidInput.value = reg.hwid || '';
        codeInput.value = reg.code || '';
        usernameInput.value = reg.username || '';
        quotaInput.value = (reg.quota !== undefined && reg.quota !== null) ? reg.quota : '';
        purchaseInput.value = reg.purchase || '';
        expiryInput.value = reg.expiry || '';
        priceInput.value = (reg.salePrice !== undefined && reg.salePrice !== null && reg.salePrice !== '') ? reg.salePrice : '';
        noteInput.value = reg.note || '';
        deleteBtn.classList.remove('hidden');
    } else {
        modalTitle.textContent = '添加注册码';
        // 在某个软件页签下新增时，默认归属该软件
        softwareInput.value = regActiveCategoryId || '';
        // 新增记录时购买日期默认为当前日期
        purchaseInput.value = getRegToday();
    }

    document.getElementById('reg-modal').classList.remove('hidden');
    setTimeout(() => contactInput.focus(), 100);
}

function closeRegModal() {
    document.getElementById('reg-modal').classList.add('hidden');
    editingRegRecord = null;
}

// ================== 导出 ==================
function exportRegCodes() {
    const records = allRegRecords();
    if (records.length === 0) {
        showToast('没有可导出的注册码');
        return;
    }
    // 备份同时包含本地记录与各 API 软件的数据
    const data = records.map(r => ({
        categoryId: r.categoryId || '',
        categoryName: getRegCategoryName(r.categoryId) || '',
        contactType: r.contactType || 'nickname',
        contact: r.contact || '',
        hwid: r.hwid || '',
        username: r.username || '',
        code: r.code || '',
        quota: r.quota || '',
        purchase: r.purchase || '',
        expiry: r.expiry || '',
        salePrice: (r.salePrice !== undefined && r.salePrice !== null && r.salePrice !== '') ? r.salePrice : '',
        note: r.note || ''
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meow_regcodes_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`已导出 ${data.length} 条注册码`);
}

// ================== 导入 ==================
function importRegCodes() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                const imported = JSON.parse(ev.target.result);
                if (!Array.isArray(imported)) { showToast('文件格式错误'); return; }
                let added = 0;
                let demoted = 0;
                imported.forEach(r => {
                    let categoryId = r.categoryId || '';
                    // 带软件名称时按名称查找或创建分类，保证导入后仍可筛选
                    if (r.categoryName) {
                        let cat = regCategories.find(c => c.name === r.categoryName);
                        if (!cat) {
                            cat = { id: 'cat_' + Date.now() + '_' + Math.random(), name: r.categoryName };
                            regCategories.push(cat);
                        }
                        categoryId = cat.id;
                    }
                    // 导入只写本地；目标软件若由服务器管理，落到「未选择软件」以免与服务器数据混在一起
                    if (regSourceOf(categoryId)) { categoryId = ''; demoted++; }
                    myRegCodes.push({
                        id: Date.now() + Math.random(),
                        categoryId: categoryId,
                        contactType: r.contactType || 'nickname',
                        contact: r.contact || '',
                        hwid: r.hwid || '',
                        username: r.username || '',
                        code: r.code || '',
                        quota: r.quota || '',
                        purchase: r.purchase || '',
                        expiry: r.expiry || '',
                        salePrice: (r.salePrice !== undefined && r.salePrice !== null && r.salePrice !== '') ? r.salePrice : '',
                        note: r.note || ''
                    });
                    added++;
                });
                saveRegCodes();
                saveRegCategories();
                renderRegCatTabs();
                renderRegCodes();
                showToast(demoted > 0
                    ? `已导入 ${added} 条，其中 ${demoted} 条属于 API 软件，已归入「未选择软件」`
                    : `已导入 ${added} 条注册码`);
            } catch (err) {
                showToast('导入失败：文件格式错误');
            }
        };
        reader.readAsText(file);
    });
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
}

// ================== 软件分类管理弹窗 ==================
function openRegCatManageModal() {
    const modal = document.getElementById('reg-cat-modal');
    if (!modal) return;
    renderRegCatManageList();
    modal.classList.remove('hidden');
    setTimeout(() => {
        const input = document.getElementById('reg-cat-input');
        if (input) input.focus();
    }, 100);
}

function closeRegCatManageModal() {
    document.getElementById('reg-cat-modal').classList.add('hidden');
}

function renderRegCatManageList() {
    const container = document.getElementById('reg-cat-list');
    if (!container) return;
    container.innerHTML = '';

    regCategories.forEach((cat, index) => {
        const item = document.createElement('div');
        const isApi = isRegApiSource(cat.id);
        item.className = 'srv-cat-list-item';
        item.draggable = true;
        item.dataset.index = index;
        item.innerHTML = `
            <span class="mi srv-cat-drag-handle fa-regular fa-grip-dots-vertical"></span>
            <span class="srv-cat-list-name">${escapeHtml(cat.name)}</span>
            <span class="reg-src-chip${isApi ? ' reg-src-chip-api' : ''}" title="${isApi ? '数据存放在该软件服务器上' : '数据存放在本机'}">${isApi ? 'API' : '本地'}</span>
            <div class="srv-cat-list-actions">
                <span class="mi reg-cat-src-icon fa-regular fa-plug" title="数据源配置"></span>
                <span class="mi reg-cat-rename-icon fa-regular fa-pen-to-square" title="重命名"></span>
                <span class="mi reg-cat-del-icon fa-regular fa-trash-can" title="删除"></span>
            </div>
        `;

        // 数据源配置
        item.querySelector('.reg-cat-src-icon').addEventListener('click', function() {
            openRegSourceModal(cat.id);
        });

        // 重命名
        item.querySelector('.reg-cat-rename-icon').addEventListener('click', async function() {
            const newName = await showPromptDialog({ title: '重命名软件', defaultValue: cat.name, placeholder: '输入软件名称', confirmText: '保存' });
            if (newName && newName.trim() && newName.trim() !== cat.name) {
                cat.name = newName.trim();
                saveRegCategories();
                renderRegCatManageList();
                renderRegCatTabs();
                renderRegCodes();
            }
        });

        // 删除
        item.querySelector('.reg-cat-del-icon').addEventListener('click', async function() {
            const extra = isApi ? '（同时清除本机保存的 API 地址与 Token，服务器上的数据不受影响）' : '';
            if (await showConfirmDialog({ message: `确定删除软件「${cat.name}」？该软件下的注册码将变为「未选择软件」${extra}`, type: 'danger' })) {
                regCategories.splice(index, 1);
                myRegCodes.forEach(r => { if (r.categoryId === cat.id) r.categoryId = ''; });
                removeRegSourceFor(cat.id);
                saveRegCategories();
                saveRegCodes();
                if (regActiveCategoryId === cat.id) regActiveCategoryId = '';
                renderRegCatManageList();
                renderRegCatTabs();
                renderRegCodes();
                showToast('已删除');
            }
        });

        // 拖拽排序
        item.addEventListener('dragstart', function(e) {
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
        });
        item.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            container.querySelectorAll('.srv-cat-list-item').forEach(el => el.classList.remove('drag-over'));
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
            const srcIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const destIndex = index;
            if (srcIndex !== destIndex) {
                const item = regCategories.splice(srcIndex, 1)[0];
                regCategories.splice(destIndex, 0, item);
                saveRegCategories();
                renderRegCatManageList();
                renderRegCatTabs();
            }
        });

        container.appendChild(item);
    });
}

// ================== 数据源配置弹窗 ==================
const REG_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

let editingRegSrcCatId = null;

// Token 提示跟着「Token 位置」走：写死成 Bearer 会让人把 PHP 接口配错还查不出来
function renderRegTokenHint() {
    const hint = document.getElementById('reg-src-token-hint');
    const pos = document.getElementById('reg-src-authin-input');
    if (!hint || !pos) return;
    const field = document.getElementById('reg-src-authfield-input');
    const name = field && field.value.trim() ? field.value.trim() : 'token';
    hint.innerHTML = (pos.value === 'body'
        ? `Token 作为请求体字段 <code>${escapeHtml(name)}</code> 提交（PHP 的 <code>$_POST</code> 只认这里），不进 URL、不落访问日志。`
        : 'Token 放在请求头 <code>Authorization: Bearer &lt;token&gt;</code>。')
        + ' 存于本机 storage，并随数据备份一起导出/恢复。';
}

function setRegSourceTypeUI(type) {
    document.querySelectorAll('#reg-source-modal .reg-src-type-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.srcType === type);
    });
    const api = document.getElementById('reg-src-api-area');
    const note = document.getElementById('reg-src-local-note');
    if (api) api.classList.toggle('hidden', type !== 'api');
    if (note) note.classList.toggle('hidden', type === 'api');
    // 测试连接挪进了底部，本地管理时没有可测的地址，跟着 API 区一起隐藏
    const test = document.getElementById('reg-src-test-btn');
    if (test) test.classList.toggle('hidden', type !== 'api');
}

function currentRegSourceType() {
    const sel = document.querySelector('#reg-source-modal .reg-src-type-btn.selected');
    return sel ? sel.dataset.srcType : 'local';
}

function renderRegSourceOps(cfg) {
    const box = document.getElementById('reg-src-ops');
    if (!box) return;
    box.innerHTML = REG_OPS.map(op => {
        const spec = (cfg.ops && cfg.ops[op.k]) || { method: op.method, path: op.path };
        const opts = REG_METHODS.map(m => `<option value="${m}"${m === spec.method ? ' selected' : ''}>${m}</option>`).join('');
        return `
            <div class="reg-src-op-row">
                <span class="reg-src-op-label">${op.label}</span>
                <select class="converter-input full-border reg-src-op-method" data-op="${op.k}">${opts}</select>
                <input type="text" class="converter-input full-border reg-src-op-path" data-op="${op.k}"
                       value="${escapeHtml(spec.path)}" placeholder="${escapeHtml(op.path)}">
            </div>`;
    }).join('');
}

function renderRegSourceMap(cfg) {
    const box = document.getElementById('reg-src-map');
    if (!box) return;
    const map = (cfg && cfg.fieldMap) || {};
    box.innerHTML = REG_MAP_FIELDS.map(f => `
        <div class="reg-src-op-row">
            <span class="reg-src-op-label">${f.label}<span class="reg-src-key">${f.k}</span></span>
            <input type="text" class="converter-input full-border reg-src-map-input" data-field="${f.k}"
                   value="${escapeHtml(map[f.k] || '')}" placeholder="留空 = 存本地">
        </div>`).join('');
}

function openRegSourceModal(catId) {
    const modal = document.getElementById('reg-source-modal');
    if (!modal) return;
    editingRegSrcCatId = catId;

    const saved = regSources[catId] ? normalizeRegSource(regSources[catId]) : null;
    const isApi = !!(saved && saved.type === 'api');
    const cfg = saved || defaultRegSourceConfig();

    document.getElementById('reg-source-modal-title').textContent = '数据源 · ' + (getRegCategoryName(catId) || '未命名软件');
    document.getElementById('reg-src-base-input').value = cfg.baseUrl || '';
    document.getElementById('reg-src-token-input').value = cfg.token || '';
    document.getElementById('reg-src-id-input').value = cfg.idField || 'id';
    document.getElementById('reg-src-path-input').value = cfg.dataPath || '';
    document.getElementById('reg-src-encoding-input').value = cfg.encoding || 'json';
    document.getElementById('reg-src-authin-input').value = cfg.authIn || 'header';
    document.getElementById('reg-src-authfield-input').value = cfg.authField || 'token';
    document.getElementById('reg-src-delextra-input').value = (cfg.ops.remove && cfg.ops.remove.extra) || '';
    document.getElementById('reg-src-token-input').type = 'password';
    renderRegSourceOps(cfg);
    renderRegSourceMap(cfg);
    setRegSourceTypeUI(isApi ? 'api' : 'local');
    renderRegTokenHint();

    modal.classList.remove('hidden');
}

function closeRegSourceModal() {
    const modal = document.getElementById('reg-source-modal');
    if (modal) modal.classList.add('hidden');
    editingRegSrcCatId = null;
}

function collectRegSourceForm() {
    const cfg = defaultRegSourceConfig();
    cfg.type = currentRegSourceType();
    cfg.baseUrl = document.getElementById('reg-src-base-input').value.trim();
    cfg.token = document.getElementById('reg-src-token-input').value.trim();
    cfg.idField = document.getElementById('reg-src-id-input').value.trim() || 'id';
    cfg.dataPath = document.getElementById('reg-src-path-input').value.trim();
    cfg.encoding = document.getElementById('reg-src-encoding-input').value || 'json';
    cfg.authIn = document.getElementById('reg-src-authin-input').value || 'header';
    cfg.authField = document.getElementById('reg-src-authfield-input').value.trim() || 'token';
    document.querySelectorAll('#reg-src-ops .reg-src-op-method').forEach(sel => {
        cfg.ops[sel.dataset.op].method = sel.value;
    });
    document.querySelectorAll('#reg-src-ops .reg-src-op-path').forEach(inp => {
        const v = inp.value.trim();
        if (v) cfg.ops[inp.dataset.op].path = v;
    });
    cfg.ops.remove.extra = document.getElementById('reg-src-delextra-input').value.trim();
    document.querySelectorAll('#reg-src-map .reg-src-map-input').forEach(inp => {
        const v = inp.value.trim();
        if (v) cfg.fieldMap[inp.dataset.field] = v;
    });
    return cfg;
}

async function testRegSource() {
    const cfg = collectRegSourceForm();
    if (!cfg.baseUrl) { showToast('请先填写 API 地址'); return; }
    const btn = document.getElementById('reg-src-test-btn');
    btn.disabled = true;
    btn.textContent = '连接中…';
    try {
        const json = await regApiRequest(cfg, 'list');
        const rows = regExtractList(json, cfg.dataPath);
        if (!rows) {
            showToast('请求成功，但没找到列表数组，请填写「数据路径」');
        } else {
            const sample = rows.length ? regMapFromServer(rows[0], cfg, editingRegSrcCatId || '') : null;
            showToast(sample && sample.code !== undefined && sample.code !== ''
                ? `连接正常，读到 ${rows.length} 条（注册码字段映射有效）`
                : `连接正常，读到 ${rows.length} 条，但「注册码」为空，请检查字段映射`);
        }
    } catch (e) {
        showToast('连接失败：' + (e && e.message || e));
    } finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
    }
}

function saveRegSourceConfig() {
    const cfg = collectRegSourceForm();
    if (cfg.type === 'api' && !cfg.baseUrl) {
        showToast('通过 API 管理时必须填写 API 地址');
        document.getElementById('reg-src-base-input').focus();
        return;
    }
    regSources[editingRegSrcCatId] = cfg;
    saveRegSources();
    const catId = editingRegSrcCatId;
    closeRegSourceModal();
    renderRegCatManageList();
    renderRegCatTabs();
    renderRegCodes();
    if (cfg.type === 'api') ensureRegSource(catId);
    showToast(cfg.type === 'api' ? '已保存，改为通过 API 管理' : '已保存，改为本地管理');
}

// ================== 初始化逻辑 ==================
function setupRegCodeLogic() {
    const regList = document.getElementById('reg-list');
    if (!regList) return;

    // 加载数据：本地记录 → 软件列表 → 数据源配置与缓存，三者就绪后才能正确渲染
    (async () => {
        try {
            const localData = await chrome.storage.local.get(['meow_regcodes']);
            myRegCodes = localData.meow_regcodes || [];
        } catch (e) {
            console.error('注册码数据加载失败:', e);
            myRegCodes = [];
        }
        await loadRegCategories();
        await loadRegSources();
        renderRegCatTabs();
        renderRegCodes();
        refreshRegScope();
    })();

    // 添加按钮
    document.getElementById('reg-add-btn').addEventListener('click', function() { openRegModal(null); });
    // 导出/导入
    document.getElementById('reg-export-btn').addEventListener('click', exportRegCodes);
    document.getElementById('reg-import-btn').addEventListener('click', importRegCodes);

    // 关闭编辑弹窗（仅通过关闭按钮关闭，点击遮罩不关闭且不丢失焦点）
    document.getElementById('close-reg-modal').addEventListener('click', closeRegModal);
    const regModal = document.getElementById('reg-modal');
    regModal.addEventListener('mousedown', function(e) { if (e.target === regModal) e.preventDefault(); });

    // 保存注册码
    document.getElementById('reg-save-btn').addEventListener('click', function() {
        const categoryId = document.getElementById('reg-software-input').value;
        const contactType = document.getElementById('reg-contact-type-input').value || 'nickname';
        const contact = document.getElementById('reg-contact-input').value.trim();
        const hwid = document.getElementById('reg-hwid-input').value.trim();
        const code = document.getElementById('reg-code-input').value.trim();
        const username = document.getElementById('reg-username-input').value.trim();
        const quota = document.getElementById('reg-quota-input').value.trim();
        const purchase = document.getElementById('reg-purchase-input').value;
        const expiry = document.getElementById('reg-expiry-input').value;
        const salePrice = document.getElementById('reg-price-input').value;
        const note = document.getElementById('reg-note-input').value.trim();

        // 服务器上的记录可以本来就没有昵称（CRM 信息在本地是可选的），
        // 所以只要有任一定位手段（昵称/微信/硬件码/注册码）就该让人保存
        if (!contact && !hwid && !code) {
            showToast('请至少填写联系方式 / 硬件码 / 注册码中的一项');
            document.getElementById('reg-contact-input').focus();
            return;
        }
        if (!isRegApiSource(categoryId) && !code && !hwid) {
            // 本地软件：总得有个发出去的东西；API 软件由服务器自己判必填
            showToast('注册码与硬件码至少填写一项');
            document.getElementById('reg-code-input').focus();
            return;
        }

        const regData = { categoryId, contactType, contact, hwid, username, code, quota, purchase, expiry, salePrice, note };
        submitRegRecord(regData);
    });

    // 删除（弹窗内）
    document.getElementById('reg-delete-btn').addEventListener('click', async function() {
        if (!editingRegRecord) return;
        if (await showConfirmDialog({ message: regDeleteConfirmText(editingRegRecord), type: 'danger' })) {
            const target = editingRegRecord;
            closeRegModal();
            await deleteRegRecord(target);
        }
    });

    // 弹窗内输入框的复制按钮
    document.querySelectorAll('#reg-modal .srv-icopy-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const targetId = this.dataset.copyTarget;
            if (!targetId) return;
            const input = document.getElementById(targetId);
            if (!input) return;
            const val = input.value;
            if (!val) { showToast('内容为空'); return; }
            copyToClipboard(val);
        });
    });

    // 付款周期按钮：月付/季付/半年付/年付，自动设置到期时间
    document.querySelectorAll('#reg-modal .reg-plan-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const months = parseInt(this.dataset.months) || 1;
            const purchaseInput = document.getElementById('reg-purchase-input');
            let purchase = purchaseInput.value;
            if (!purchase) {
                purchase = getRegToday();
                purchaseInput.value = purchase;
            }
            const expiry = addRegMonths(purchase, months);
            if (!expiry) { showToast('购买时间格式错误'); return; }
            document.getElementById('reg-expiry-input').value = expiry;
            this.parentElement.querySelectorAll('.reg-plan-btn')
                .forEach(b => b.classList.toggle('selected', b === this));
        });
    });

    // === 软件分类管理弹窗 ===
    document.getElementById('reg-cat-manage-btn').addEventListener('click', openRegCatManageModal);
    document.getElementById('close-reg-cat-modal').addEventListener('click', closeRegCatManageModal);
    const regCatModal = document.getElementById('reg-cat-modal');
    regCatModal.addEventListener('mousedown', function(e) { if (e.target === regCatModal) e.preventDefault(); });

    // 添加软件分类
    document.getElementById('reg-cat-add-btn').addEventListener('click', function() {
        const input = document.getElementById('reg-cat-input');
        const name = input.value.trim();
        if (!name) return;
        if (regCategories.some(c => c.name === name)) { showToast('软件已存在'); return; }
        regCategories.push({ id: 'cat_' + Date.now(), name });
        saveRegCategories();
        renderRegCatManageList();
        renderRegCatTabs();
        input.value = '';
        input.focus();
    });
    // 按 Enter 添加
    document.getElementById('reg-cat-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('reg-cat-add-btn').click();
        }
    });

    // === 数据源配置弹窗 ===
    document.getElementById('close-reg-source-modal').addEventListener('click', closeRegSourceModal);
    const regSrcModal = document.getElementById('reg-source-modal');
    regSrcModal.addEventListener('mousedown', function(e) { if (e.target === regSrcModal) e.preventDefault(); });
    document.querySelectorAll('#reg-source-modal .reg-src-type-btn').forEach(btn => {
        btn.addEventListener('click', function() { setRegSourceTypeUI(this.dataset.srcType); });
    });
    document.getElementById('reg-src-test-btn').addEventListener('click', testRegSource);
    document.getElementById('reg-src-authin-input').addEventListener('change', renderRegTokenHint);
    document.getElementById('reg-src-authfield-input').addEventListener('input', renderRegTokenHint);
    document.getElementById('reg-src-save-btn').addEventListener('click', saveRegSourceConfig);
    document.getElementById('reg-src-token-toggle').addEventListener('click', function() {
        const inp = document.getElementById('reg-src-token-input');
        const reveal = inp.type === 'password';
        inp.type = reveal ? 'text' : 'password';
        this.className = 'mi srv-icopy-btn fa-regular ' + (reveal ? 'fa-eye-slash' : 'fa-eye');
        this.title = reveal ? '隐藏 Token' : '显示 Token';
    });

    // === 搜索栏 ===
    const filterInput = document.getElementById('reg-filter-input');
    const filterClear = document.getElementById('reg-filter-clear');
    const regControls = document.getElementById('reg-controls');
    const regSearchToggle = document.getElementById('reg-search-toggle');
    const regSearchBack = document.getElementById('reg-search-back');

    // 点击搜索图标 → 展开全宽搜索栏
    regSearchToggle.addEventListener('click', function() {
        regControls.classList.add('search-active');
        filterInput.focus();
    });

    // 点击返回箭头 → 收起搜索栏
    regSearchBack.addEventListener('click', function() {
        regControls.classList.remove('search-active');
        filterInput.value = '';
        filterClear.style.display = 'none';
        renderRegCodes();
    });

    filterInput.addEventListener('input', function() {
        filterClear.style.display = this.value ? '' : 'none';
        renderRegCodes();
    });

    filterClear.addEventListener('click', function() {
        filterInput.value = '';
        filterInput.focus();
        filterClear.style.display = 'none';
        renderRegCodes();
    });

    // Escape 键收起搜索栏
    filterInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            filterInput.value = '';
            filterClear.style.display = 'none';
            regControls.classList.remove('search-active');
            renderRegCodes();
        }
    });

    // 失焦且内容为空时自动收起
    filterInput.addEventListener('blur', function() {
        if (!filterInput.value.trim()) {
            regControls.classList.remove('search-active');
        }
    });

    // 存储变化监听
    chrome.storage.onChanged.addListener(function(changes, area) {
        if (area === 'local' && changes.meow_regcodes) {
            myRegCodes = changes.meow_regcodes.newValue || [];
            const view = document.getElementById('view-regcodes');
            if (view && !view.classList.contains('hidden')) renderRegCodes();
        }
    });
}
