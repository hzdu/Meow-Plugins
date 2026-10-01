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
