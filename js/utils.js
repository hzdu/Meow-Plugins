// utils.js - popup.html / sidepanel.html / views 共用的转义与校验工具
// 这里放的是"渲染前必须有"的函数，任何一侧都能调用，避免出现平行实现。

function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 相对路径不带协议，在扩展页里只会 404 不会外联；带协议的只放行这几个，data: 只认图片
function isSafeHtmlUrl(value) {
    const s = String(value || '').trim().toLowerCase();
    if (s.startsWith('data:image/')) return true;
    if (!/^[a-z][a-z0-9+.-]*:/.test(s)) return true;
    return /^(https?:|mailto:|tel:|blob:)/.test(s);
}

// 备份会上传到 WebDAV 或落成 JSON 文件。注册码的 API 配置（含 Token、地址、字段映射）
// 按需求随备份一起走，换机恢复后直接可用，不必重配。
// 只有"从各家授权服务器拉下来的客户数据缓存"剔除掉：它随时能重新读，
// 在备份里多留一份等于把客户隐私多复制一处。
const MEOW_BACKUP_DROP_KEYS = ['meow_regcode_api_cache'];

function scrubBackupLocal(localData) {
    const src = localData && typeof localData === 'object' ? localData : {};
    const out = Object.assign({}, src);
    MEOW_BACKUP_DROP_KEYS.forEach(k => { delete out[k]; });
    return out;
}
