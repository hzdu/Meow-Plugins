// popup-titlebar.js - TitleBar初始化
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === Title Bar Initialization (Panel Integration) ===

/**
 * 关闭面板：在 iframe 嵌入模式通过 postMessage 通知父页面关闭；
 * 在浏览器弹出窗口模式直接调用 window.close()。
 */
function closePanel() {
    if (window.self !== window.top) {
        // 嵌入 iframe 模式
        window.parent.postMessage({ action: 'close-meow-panel' }, '*');
    } else {
        // 浏览器弹出窗口模式（点击扩展图标或 ALT+Q）
        window.close();
    }
}

(function initTitleBar() {
    console.log('[Meow TitleBar] initTitleBar running');
    const dragHandle = document.getElementById('titlebar-drag-handle');
    const minimizeBtn = document.getElementById('titlebar-minimize');
    const closeBtn = document.getElementById('titlebar-close');
    console.log('[Meow TitleBar] Found elements:', { dragHandle: !!dragHandle, minimizeBtn: !!minimizeBtn, closeBtn: !!closeBtn });

    // Notify parent that panel is loaded and ready
    window.parent.postMessage({ action: 'panel-ready' }, '*');

    // Minimize
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            window.parent.postMessage({ action: 'panel-minimize' }, '*');
        });
    }

    // Close
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closePanel();
        });
    }

    // Listen for messages from parent (restore-view, show-minimized)
    window.addEventListener('message', (event) => {
        const action = event.data && event.data.action;
        if (action === 'restore-view') {
            document.body.classList.remove('panel-minimized');
        } else if (action === 'show-minimized') {
            document.body.classList.add('panel-minimized');
        }
    });

    // Restore from minimized bar click
    const miniBar = document.getElementById('panel-titlebar-mini');
    if (miniBar) {
        miniBar.addEventListener('click', () => {
            window.parent.postMessage({ action: 'panel-restore' }, '*');
        });
    }

    // Drag - track pointer deltas inside iframe, send to parent via postMessage
    if (dragHandle) {
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;

        dragHandle.addEventListener('pointerdown', (e) => {
            isDragging = true;
            // 只发送初始坐标给父页面，后续由父页面的遮罩层跟踪鼠标
            window.parent.postMessage({ action: 'panel-drag-start', clientX: e.clientX, clientY: e.clientY }, '*');
            e.preventDefault();
        });

        dragHandle.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
        });

        dragHandle.addEventListener('pointerup', (e) => {
            if (!isDragging) return;
            isDragging = false;
            window.parent.postMessage({ action: 'panel-drag-end' }, '*');
            e.preventDefault();
        });

        dragHandle.addEventListener('pointercancel', (e) => {
            if (!isDragging) return;
            isDragging = false;
            window.parent.postMessage({ action: 'panel-drag-end' }, '*');
        });
    }
})();

