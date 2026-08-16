// panel.js - 注入式面板控制器

(function() {
    'use strict';

    let panelIframe = null;
    let isMinimized = false;
    let originalDimensions = null; // { width, height, top, left, transform }
    let dragState = null; // { startMouseX, startMouseY, startTop, startLeft }

    // 监听来自后台的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'toggle-panel') {
            togglePanel();
        } 
        else if (message.action === 'open-scratchpad') {
            // 场景 1: 面板尚未创建
            if (!panelIframe) {
                createIframe();
                // 显示面板
                requestAnimationFrame(() => {
                    panelIframe.style.opacity = '1';
                    panelIframe.style.pointerEvents = 'auto';
                });
                // 首次加载需要一点时间，延时发送切换指令
                setTimeout(() => {
                    sendSwitchTabMessage('scratchpad');
                    panelIframe.focus();
                }, 300);
            }
            // 场景 2: 面板已存在但被隐藏
            else if (panelIframe.style.opacity === '0') {
                panelIframe.style.opacity = '1';
                panelIframe.style.pointerEvents = 'auto';
                // 如果处于最小化状态，先恢复
                if (isMinimized) {
                    restorePanel();
                }
                // 短暂延时等待 CSS 过渡
                setTimeout(() => {
                    sendSwitchTabMessage('scratchpad');
                    panelIframe.focus();
                }, 50);
            }
            // 场景 3: 面板已经是打开状态
            else {
                // 如果处于最小化状态，先恢复
                if (isMinimized) {
                    restorePanel();
                }
                sendSwitchTabMessage('scratchpad');
                panelIframe.focus();
            }
        }
    });

    // 辅助：发送切换 Tab 消息给 iframe
    function sendSwitchTabMessage(targetTab) {
        if (panelIframe && panelIframe.contentWindow) {
            panelIframe.contentWindow.postMessage({ 
                action: 'switch-tab', 
                target: targetTab 
            }, '*');
        }
    }

    // 监听来自 Iframe 内部的消息
    window.addEventListener('message', (event) => {
        const action = event.data && event.data.action;

        if (action === 'close-meow-panel') {
            closePanel();
        } else if (action === 'panel-minimize') {
            minimizePanel();
        } else if (action === 'panel-restore') {
            restorePanel();
        } else if (action === 'panel-drag-start') {
            dragStart(event.data.clientX, event.data.clientY);
        } else if (action === 'panel-drag-move') {
            dragMove(event.data.clientX, event.data.clientY);
        } else if (action === 'panel-drag-end') {
            dragEnd();
        } else if (action === 'panel-ready') {
            // iframe 已加载完成，无需额外操作
        }
    });

    // 监听键盘事件
    document.addEventListener('keydown', (e) => {
        // Esc 关闭面板
        if (e.key === 'Escape') {
            if (panelIframe && panelIframe.style.opacity === '1') {
                closePanel();
            }
        }

        // Alt+S 稍后阅读 (互斥逻辑：如果网页备注模式开启，则不触发此功能)
        if (e.altKey && (e.key === 's' || e.key === 'S')) {
            // 检查是否存在备注 Canvas (ID: meow-annotation-canvas)
            // 如果存在，说明 annotation.js 正在工作，这里就不处理，交给 annotation.js 保存截图
            if (!document.getElementById('meow-annotation-canvas')) {
                e.preventDefault(); // 阻止浏览器默认行为(如保存网页)
                
                // 发送消息给后台进行保存
                chrome.runtime.sendMessage({ 
                    action: 'save-read-later' 
                    // 不需要传 URL，后台可以直接从 sender.tab 获取，更安全准确
                });
            }
        }
    });

    function togglePanel() {
        if (panelIframe && panelIframe.style.opacity === '1') {
            closePanel();
        } else {
            openPanel();
        }
    }

    function openPanel() {
        if (!panelIframe) {
            createIframe();
        }
        requestAnimationFrame(() => {
            panelIframe.style.opacity = '1';
            panelIframe.style.pointerEvents = 'auto';
        });
        panelIframe.focus();
    }

    function createIframe() {
        panelIframe = document.createElement('iframe');
        panelIframe.id = 'meow-panel-iframe';
        panelIframe.src = chrome.runtime.getURL('popup.html');
        
        Object.assign(panelIframe.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '800px',
            height: '600px',
            border: 'none',
            borderRadius: '16px',
            background: 'transparent',
            zIndex: '2147483647',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.3)',
            opacity: '0',
            transition: 'opacity 0.2s ease-out',
            pointerEvents: 'none' // 初始不可点击，防止遮挡
        });

        document.body.appendChild(panelIframe);
    }

    function closePanel() {
        if (!panelIframe) return;
        panelIframe.style.opacity = '0';
        panelIframe.style.pointerEvents = 'none'; // 避免隐藏时挡住点击
        
        // 保持 iframe 实例，不销毁 DOM，以便下次快速打开保留状态
    }

    // === 面板最小化/还原 ===
    function minimizePanel() {
        if (!panelIframe || isMinimized) return;
        isMinimized = true;

        // 保存原始尺寸和位置
        const rect = panelIframe.getBoundingClientRect();
        originalDimensions = {
            width: panelIframe.style.width,
            height: panelIframe.style.height,
            top: panelIframe.style.top,
            left: panelIframe.style.left,
            transform: panelIframe.style.transform
        };

        // 如果面板是用 transform 居中定位，转换为像素坐标
        if (originalDimensions.top === '50%' && originalDimensions.left === '50%') {
            panelIframe.style.top = rect.top + 'px';
            panelIframe.style.left = rect.left + 'px';
            panelIframe.style.transform = 'none';
            originalDimensions.top = rect.top + 'px';
            originalDimensions.left = rect.left + 'px';
            originalDimensions.transform = 'none';
        }

        // 缩小为仅标题栏高度，并移动到网页底部中央
        const miniW = 200;
        const miniH = 36;
        panelIframe.style.width = miniW + 'px';
        panelIframe.style.height = miniH + 'px';
        panelIframe.style.left = ((window.innerWidth - miniW) / 2) + 'px';
        panelIframe.style.top = (window.innerHeight - miniH) + 'px';
        panelIframe.style.transform = 'none';
        panelIframe.style.borderRadius = '8px';
        panelIframe.style.overflow = 'hidden';
        
        // 发送消息给 iframe 让其在内部显示最小化栏
        if (panelIframe.contentWindow) {
            panelIframe.contentWindow.postMessage({ action: 'show-minimized' }, '*');
        }
    }

    function restorePanel() {
        if (!panelIframe || !isMinimized) return;
        isMinimized = false;

        if (originalDimensions) {
            panelIframe.style.width = originalDimensions.width;
            panelIframe.style.height = originalDimensions.height;
            panelIframe.style.top = originalDimensions.top;
            panelIframe.style.left = originalDimensions.left;
            panelIframe.style.transform = originalDimensions.transform;
        }
        panelIframe.style.borderRadius = '16px';
        panelIframe.style.overflow = '';

        originalDimensions = null;
        
        // 通知 iframe 恢复
        if (panelIframe.contentWindow) {
            panelIframe.contentWindow.postMessage({ action: 'restore-view' }, '*');
        }
    }

    // === 面板拖拽 ===
    let dragOverlay = null;
    let dragStartData = null; // { iframeTop, iframeLeft, startPageX, startPageY }

    function dragStart(clientX, clientY) {
        if (!panelIframe) return;
        // 将 iframe 从 transform 居中转换为像素定位
        const rect = panelIframe.getBoundingClientRect();
        panelIframe.style.top = rect.top + 'px';
        panelIframe.style.left = rect.left + 'px';
        panelIframe.style.transform = 'none';

        // 如果已有遮罩，先移除
        if (dragOverlay) {
            dragOverlay.remove();
            dragOverlay = null;
        }

        // 创建全屏透明遮罩（z-index 高于 iframe，确保鼠标离开 iframe 后仍能捕获事件）
        dragOverlay = document.createElement('div');
        dragOverlay.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;' +
            'z-index:2147483648;cursor:grabbing;background:transparent;';
        document.body.appendChild(dragOverlay);

        // 将 iframe 内坐标转换为页面坐标（iframe 左上角 + 相对于 iframe 的偏移）
        const startPageX = rect.left + clientX;
        const startPageY = rect.top + clientY;
        const startTop = parseFloat(panelIframe.style.top) || 0;
        const startLeft = parseFloat(panelIframe.style.left) || 0;

        dragStartData = { startTop, startLeft, startPageX, startPageY };

        // 在遮罩上直接监听移动和释放（坐标系为父页面，不随 iframe 变化）
        function onPointerMove(e) {
            if (!panelIframe || !dragStartData) return;
            const dx = e.clientX - dragStartData.startPageX;
            const dy = e.clientY - dragStartData.startPageY;
            panelIframe.style.top = (dragStartData.startTop + dy) + 'px';
            panelIframe.style.left = (dragStartData.startLeft + dx) + 'px';
            e.preventDefault();
        }

        function onPointerUp() {
            if (dragOverlay) {
                dragOverlay.remove();
                dragOverlay = null;
            }
            dragStartData = null;
            dragOverlay = null;
        }

        dragOverlay.addEventListener('pointermove', onPointerMove);
        dragOverlay.addEventListener('pointerup', onPointerUp, { once: true });
    }

    function dragMove(clientX, clientY) {
        // 不再由 iframe 的 pointermove 驱动，全部由遮罩层处理
    }

    function dragEnd() {
        // 由遮罩层的 pointerup 自动清理
    }

})();