// js/gallery_view.js

document.addEventListener('DOMContentLoaded', () => {
    const img = document.getElementById('target-img');
    const statusDiv = document.getElementById('status');

    // 1. 获取 URL 参数中的 ID
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');

    if (!id) {
        showError('错误：URL 中未指定图片 ID');
        return;
    }

    // 2. 从本地存储读取数据
    chrome.storage.local.get(['meow_gallery'], (result) => {
        // 错误检查
        if (chrome.runtime.lastError) {
            showError('读取失败: ' + chrome.runtime.lastError.message);
            return;
        }

        const gallery = result.meow_gallery || [];
        // 查找对应 ID 的图片 (转字符串比较，防止类型不匹配)
        const item = gallery.find(g => String(g.id) === id);
        
        if (item && item.dataUrl) {
            // 3. 成功找到，显示图片
            img.src = item.dataUrl;
            img.style.display = 'block';
            statusDiv.style.display = 'none'; // 隐藏加载文字
            
            // 设置网页标题
            const dateStr = new Date(item.timestamp).toLocaleString();
            document.title = `预览 - ${dateStr}`;
        } else {
            showError('未找到图片，可能已被删除或 ID 无效。');
        }
    });

    function showError(msg) {
        statusDiv.className = 'status-text error';
        statusDiv.textContent = msg;
        img.style.display = 'none';
    }
});