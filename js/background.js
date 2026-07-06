// js/background.js - 后台服务脚本 (修正右键菜单版)

// === 变量：跟踪当前窗口 ID ===
let currentWindowId = chrome.windows.WINDOW_ID_NONE;

// === 变量：跟踪侧边栏连接状态 (WindowId -> Port) ===
const sidePanelPorts = {};

// 监听窗口焦点变化
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    currentWindowId = windowId;
  }
});

// 获取当前窗口
chrome.windows.getCurrent((window) => {
  if (window) {
    currentWindowId = window.id;
  }
});

// === 初始化与安装事件 (修改菜单结构) ===
chrome.runtime.onInstalled.addListener(() => {
  // 清除旧的菜单（防止重复ID报错），然后重新创建
  chrome.contextMenus.removeAll(() => {
    
    // 1. Meow 父菜单 (出现在所有上下文中)
    chrome.contextMenus.create({
      id: "meowRoot",
      title: "Meow",
      contexts: ["all"]
    });

    // 2. 子菜单：工具集 (原 "Meow 侧边栏工具集")
    chrome.contextMenus.create({
      id: "openSidePanel",
      parentId: "meowRoot",
      title: "工具集",
      contexts: ["all"]
    });

    // 3. 子菜单：稍后阅读 (新增，保存当前网页)
    chrome.contextMenus.create({
      id: "saveReadLater",
      parentId: "meowRoot",
      title: "稍后阅读",
      contexts: ["all"]
    });

    // 4. 子菜单：保存进暂存板 (仅选中内容时显示，支持图文)
    chrome.contextMenus.create({
      id: "meowSaveText",
      parentId: "meowRoot",
      title: "保存进暂存板",
      contexts: ["selection"]
    });

    // 5. 子菜单：收藏到图集 (仅点击图片时显示)
    chrome.contextMenus.create({
      id: "meowSaveImg",
      parentId: "meowRoot",
      title: "收藏到图集",
      contexts: ["image"]
    });

  });
});

// === 监听侧边栏的长连接 (用于实现 Toggle 关闭功能) ===
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'meow-sidepanel-connection') {
    let portWindowId = null;

    // 监听侧边栏发来的初始化消息（包含它的 windowId）
    port.onMessage.addListener((msg) => {
      if (msg.type === 'init' && msg.windowId) {
        portWindowId = msg.windowId;
        sidePanelPorts[portWindowId] = port;
      }
    });

    // 断开连接时清理记录
    port.onDisconnect.addListener(() => {
      if (portWindowId && sidePanelPorts[portWindowId]) {
        delete sidePanelPorts[portWindowId];
      }
    });
  }
});

// === 右键菜单点击事件 ===
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  
  // 1. 打开侧边栏 (工具集)
  if (info.menuItemId === "openSidePanel") {
    if (tab && tab.windowId) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    }
  }

  // 2. 稍后阅读 (保存当前网页)
  else if (info.menuItemId === "saveReadLater") {
    if (tab && tab.url) {
        handleSaveReadLater(tab);
    }
  }

  // 3. 保存进暂存板 (支持图文混编)
  else if (info.menuItemId === "meowSaveText") {
    let content = null;
    let isHtml = false;

    // 尝试通过脚本注入获取选区的 HTML (支持图文)
    // 只有在普通网页(http/https/file)才能注入脚本
    if (tab && tab.id && tab.url && (tab.url.startsWith('http') || tab.url.startsWith('file'))) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const sel = window.getSelection();
                    if (!sel || sel.rangeCount === 0) return null;
                    
                    const div = document.createElement('div');
                    const range = sel.getRangeAt(0);
                    div.appendChild(range.cloneContents());
                    
                    // 关键：将相对路径转换为绝对路径，否则在侧边栏无法显示
                    div.querySelectorAll('img').forEach(img => img.src = img.src);
                    div.querySelectorAll('a').forEach(a => a.href = a.href);
                    
                    return div.innerHTML;
                }
            });
            
            if (results && results[0] && results[0].result) {
                content = results[0].result;
                // 简单的检查：如果包含标签，则视为 HTML
                if (content.includes('<') && content.includes('>')) {
                    isHtml = true;
                }
            }
        } catch (e) {
            console.warn("Meow: Failed to retrieve HTML selection, falling back to plain text.", e);
        }
    }

    // 如果获取 HTML 失败（例如在 chrome:// 页面），回退到 info.selectionText
    if (!content) {
        content = info.selectionText;
        isHtml = false;
    }

    if (content) {
      handleSaveToScratchpad(content, isHtml);
    }
  }

  // 4. 收藏到图集
  else if (info.menuItemId === "meowSaveImg") {
    const srcUrl = info.srcUrl;
    if (srcUrl) {
      handleSaveImageToGallery(srcUrl);
    }
  }
});

// === 业务逻辑：保存内容到暂存板 (支持 HTML 或 纯文本) ===
async function handleSaveToScratchpad(content, isHtml) {
  try {
    // 1. 读取 local 存储 (使用 local 以支持更大的图文数据)
    const data = await chrome.storage.local.get(['meow_scratchpad_list_local']);
    let list = data.meow_scratchpad_list_local || [];
    
    // 如果 local 为空，检查是否有 sync 旧数据需要迁移
    if (list.length === 0) {
        const syncData = await chrome.storage.sync.get(['meow_scratchpad_list']);
        if (syncData.meow_scratchpad_list) {
            list = syncData.meow_scratchpad_list;
        }
    }

    // 2. 构造新条目
    let finalContent = content;
    
    if (!isHtml) {
        // 如果是纯文本，手动转义并处理换行
        finalContent = content.replace(/&/g, "&amp;")
                              .replace(/</g, "&lt;")
                              .replace(/>/g, "&gt;")
                              .replace(/"/g, "&quot;")
                              .replace(/\n/g, "<br>");
    }
    // 如果是 HTML，直接保存 (注意：这里假设内容是安全的或只在本地沙箱运行)

    const newItem = {
      id: Date.now(),
      content: finalContent,
      time: Date.now()
    };
    
    // 3. 追加并保存到 local
    list.push(newItem);
    await chrome.storage.local.set({ 'meow_scratchpad_list_local': list });
    
    // 通知用户
    showNotification('Meow 暂存板', isHtml ? '图文内容已保存' : '文本已保存');
    
  } catch (err) {
    console.error('Save content failed:', err);
    showNotification('Meow 错误', '保存失败: ' + err.message);
  }
}

// === 业务逻辑：保存图片到图集 ===
async function handleSaveImageToGallery(url) {
  try {
    // 1. Fetch 图片数据
    const response = await fetch(url);
    const blob = await response.blob();
    
    // 2. 转换为 Base64
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // 3. 获取现有图集 (图片存储在 local)
    const data = await chrome.storage.local.get(['meow_gallery']);
    let gallery = data.meow_gallery || [];

    // 4. 构造新条目
    const newItem = {
      id: Date.now() + Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
      dataUrl: base64Data
    };

    // 5. 添加到头部
    gallery.unshift(newItem);

    // 6. 限制数量 (保持最近 50 张)
    if (gallery.length > 50) {
      gallery = gallery.slice(0, 50);
    }

    // 7. 保存
    await chrome.storage.local.set({ 'meow_gallery': gallery });
    
    showNotification('Meow 图集', '图片已收藏');

  } catch (err) {
    console.error('Save image failed:', err);
    showNotification('Meow 错误', '图片保存失败 (可能是跨域限制)');
  }
}

// === 业务逻辑：保存稍后阅读 ===
async function handleSaveReadLater(tab) {
    try {
        if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
            showNotification('Meow 提示', '当前页面无法添加');
            return;
        }

        const data = await chrome.storage.sync.get(['meow_read_later']);
        let list = data.meow_read_later || [];

        // 查重：如果URL已存在，将其移到最前并更新时间
        const existingIndex = list.findIndex(item => item.url === tab.url);
        if (existingIndex !== -1) {
            list.splice(existingIndex, 1);
        }

        const newItem = {
            id: Date.now(),
            url: tab.url,
            title: tab.title || '无标题页面',
            favIconUrl: tab.favIconUrl || '',
            time: Date.now()
        };

        list.unshift(newItem);

        // 限制数量，比如 100 条
        if (list.length > 100) list = list.slice(0, 100);

        await chrome.storage.sync.set({ 'meow_read_later': list });
        showNotification('Meow 阅读', '已加入稍后阅读列表');

    } catch (err) {
        console.error('Save read later failed:', err);
        showNotification('Meow 错误', '保存失败: ' + err.message);
    }
}

// === 辅助：显示系统通知 ===
function showNotification(title, message) {
  const notificationId = 'meow_' + Date.now();
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: '../images/icon.png', // 请确保该路径下有图标
    title: title,
    message: message,
    priority: 1
  }, () => {
    // 2秒后自动关闭通知
    setTimeout(() => {
      chrome.notifications.clear(notificationId);
    }, 2000);
  });
}

// === 快捷键监听 ===
chrome.commands.onCommand.addListener(async (command) => {
  // 处理侧边栏切换 (Alt+C)
  if (command === "open-side-panel") {
    let targetWinId = currentWindowId;

    // 如果当前没有焦点窗口 ID，尝试获取最后一个焦点窗口
    if (targetWinId === chrome.windows.WINDOW_ID_NONE) {
      try {
        const win = await chrome.windows.getLastFocused();
        if (win) targetWinId = win.id;
      } catch (e) {
          console.error(e);
      }
    }

    if (targetWinId !== chrome.windows.WINDOW_ID_NONE) {
      // 核心逻辑：检查该窗口是否已打开侧边栏
      if (sidePanelPorts[targetWinId]) {
        // 已打开 -> 发送消息通知其关闭
        try {
          sidePanelPorts[targetWinId].postMessage({ action: 'close-panel' });
        } catch (err) {
          // 如果发送失败，尝试打开作为容错
          chrome.sidePanel.open({ windowId: targetWinId }).catch(console.error);
        }
      } else {
        // 未打开 -> 执行打开
        chrome.sidePanel.open({ windowId: targetWinId }).catch(console.error);
      }
    }
    return;
  }

  // 处理 IP 工具快捷键 (用户可在 chrome://extensions/shortcuts 设置)
  if (command === "open-ip-tools") {
    let targetWinId = currentWindowId;

    if (targetWinId === chrome.windows.WINDOW_ID_NONE) {
      try {
        const win = await chrome.windows.getLastFocused();
        if (win) targetWinId = win.id;
      } catch (e) {
        console.error(e);
      }
    }

    if (targetWinId !== chrome.windows.WINDOW_ID_NONE) {
      // 如果侧边栏已打开，发送消息切换到 IP 工具
      if (sidePanelPorts[targetWinId]) {
        try {
          sidePanelPorts[targetWinId].postMessage({ action: 'open-ip-tools' });
        } catch (err) {
          chrome.sidePanel.open({ windowId: targetWinId }).catch(console.error);
        }
      } else {
        // 侧边栏未打开，设置标记后打开
        chrome.storage.local.set({ 'meow_open_ip_tools': true }, () => {
          chrome.sidePanel.open({ windowId: targetWinId }).catch(console.error);
        });
      }
    }
    return;
  }

  // 处理大日历快捷键 (Alt+R)
  if (command === "open-big-calendar") {
    chrome.tabs.create({ url: 'views/big-calendar.html' });
    return;
  }

  // 处理AI合集快捷键 (Alt+1)
  if (command === "open-ai-collection") {
    let targetWinId = currentWindowId;

    if (targetWinId === chrome.windows.WINDOW_ID_NONE) {
      try {
        const win = await chrome.windows.getLastFocused();
        if (win) targetWinId = win.id;
      } catch (e) {
        console.error(e);
      }
    }

    if (targetWinId !== chrome.windows.WINDOW_ID_NONE) {
      if (sidePanelPorts[targetWinId]) {
        try {
          sidePanelPorts[targetWinId].postMessage({ action: 'open-ai-collection' });
        } catch (err) {
          chrome.sidePanel.open({ windowId: targetWinId }).catch(console.error);
        }
      } else {
        chrome.storage.local.set({ 'meow_open_ai_collection': true }, () => {
          chrome.sidePanel.open({ windowId: targetWinId }).catch(console.error);
        });
      }
    }
    return;
  }

  // 处理其他异步命令
  handleAsyncCommand(command);
});

async function handleAsyncCommand(command) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    
    if (!tab || !tab.id) return;
    
    // 检查页面 URL 是否支持注入脚本 (http/https/file)
    const isSupportedProtocol = tab.url && (tab.url.startsWith('http') || tab.url.startsWith('file'));

    if (isSupportedProtocol) {
      if (command === "toggle-annotation") {
        sendMessageToActiveTab(tab.id, { action: "toggle-annotation" });
      } 
      else if (command === "open-scratchpad") {
        sendMessageToActiveTab(tab.id, { action: "toggle-panel" });
      }
    }
  } catch (error) {
    console.error("Meow Command Error:", error);
  }
}

function sendMessageToActiveTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch((err) => {
    // 忽略无法连接到标签页的错误（例如标签页正在加载中）
    if (chrome.runtime.lastError) {} 
  });
}

// === 消息监听 (截图、代理请求、稍后阅读、备份设置、批量定时) ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. 截图功能
  if (message.action === 'capture-visible-tab') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' })
      .then(dataUrl => sendResponse({ dataUrl: dataUrl }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // 保持异步响应通道开启
  }
  
  // 2. 通用代理请求
  if (message.action === 'proxy-fetch') {
    const { url, encoding = 'utf-8' } = message;
    
    fetch(url)
      .then(res => res.arrayBuffer())
      .then(buffer => {
        const decoder = new TextDecoder(encoding);
        const text = decoder.decode(buffer);
        sendResponse({ success: true, data: text });
      })
      .catch(err => {
        console.error('Proxy Fetch Error:', url, err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // 保持异步响应通道开启
  }

  // 3. 稍后阅读保存 (从 panel.js 发来)
  if (message.action === 'save-read-later') {
      if (sender.tab) {
          handleSaveReadLater(sender.tab);
          sendResponse({ success: true });
      } else {
          // sender.tab 不存在时，尝试获取当前活动标签
          chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
              if (tabs[0]) {
                  handleSaveReadLater(tabs[0]);
              }
          });
          sendResponse({ success: true });
      }
      return true; // 保持异步响应通道开启
  }

  // 4. 更新自动备份闹钟设置 (从设置页发来)
  if (message.action === 'update-backup-alarm') {
      setupAutoBackupAlarm();
      sendResponse({ success: true });
      return;
  }

  // 5. 批量定时任务手动执行 (从 popup 发来)
  if (message.type === 'execute_batch_timer') {
      (async () => {
          try {
              const urls = message.urls || [];
              const openedTabIds = [];
              for (const url of urls) {
                  try {
                      const tab = await chrome.tabs.create({ url: url, active: false });
                      if (tab && tab.id) openedTabIds.push(tab.id);
                  } catch (tabErr) {
                      console.error('Batch timer execute failed:', url, tabErr);
                  }
              }
              const name = message.name || '批量定时';
              chrome.notifications.create(`batch_exec_${Date.now()}`, {
                  type: 'basic',
                  iconUrl: '../images/icon.png',
                  title: 'Meow 批量定时',
                  message: `已打开 ${urls.length} 个标签页：${name}`,
                  priority: 1
              });
              sendResponse({ success: true });
              // 记录运行日志（手动执行）
              try {
                  const logData = await chrome.storage.local.get(['meow_batch_logs']);
                  let logs = Array.isArray(logData.meow_batch_logs) ? logData.meow_batch_logs : [];
                  logs.unshift({
                      id: Date.now(),
                      name: name,
                      urlCount: urls.length,
                      success: true,
                      time: new Date().toLocaleString('zh-CN', { hour12: false })
                  });
                  if (logs.length > 100) logs = logs.slice(0, 100);
                  await chrome.storage.local.set({ 'meow_batch_logs': logs });
              } catch (logErr) {
                  console.error('Batch log save error:', logErr);
              }
              // 30秒后自动关闭打开的标签页（Chrome alarm 最小间隔30s）
              if (openedTabIds.length > 0 && message.autoClose !== false) {
                  const closeKey = `close_batch_exec_${Date.now()}`;
                  chrome.storage.session.set({ [closeKey]: openedTabIds }).catch(() => {});
                  chrome.alarms.create(closeKey, { delayInMinutes: 0.5 });
              }
          } catch (err) {
              console.error('Batch timer execute error:', err);
              sendResponse({ success: false, error: err.message });
          }
      })();
      return true; // 保持异步响应通道开启
  }
});

// === 闹钟与通知逻辑 ===
// 注意：MV3 中事件监听器必须返回 Promise 以保持 Service Worker 存活
chrome.alarms.onAlarm.addListener(async (alarm) => {
    try {
        if (alarm.name.startsWith('alarm_')) {
            const alarmId = parseInt(alarm.name.replace('alarm_', ''), 10);
            let label = '时间到了！';
            if (alarmId) {
                const data = await chrome.storage.sync.get(['alarms_config']);
                const alarms = Array.isArray(data.alarms_config) ? data.alarms_config : [];
                const found = alarms.find(a => a.id === alarmId);
                if (found) label = found.label || '时间到了！';
            }

            // 先播放声音（await 保证 SW 存活，这是之前确认能发声的关键）
            await playAlarmSound();

            // 再创建通知
            chrome.notifications.create(alarm.name, {
                type: 'basic',
                iconUrl: chrome.runtime.getURL('images/icon.png'),
                title: 'Meow 提醒',
                message: label,
                priority: 2,
                requireInteraction: true,
                buttons: [{ title: '停止响铃' }]
            });

            // 通知 popup（如果打开）显示停止响铃栏，同时存 session 标记响铃状态
            chrome.storage.session.set({ ringingAlarmId: alarmId }).catch(() => {});
            chrome.runtime.sendMessage({ action: 'alarm-ringing', alarmId }).catch(() => {});
        } else if (alarm.name.startsWith('batch_timer_')) {
            // 批量定时任务触发 - 打开所有预定网址
            const timerId = parseInt(alarm.name.replace('batch_timer_', ''), 10);
            if (isNaN(timerId)) return;
            const data = await chrome.storage.local.get(['meow_batch_timers']);
            const timers = Array.isArray(data.meow_batch_timers) ? data.meow_batch_timers : [];
            const timer = timers.find(t => t.id === timerId);
            if (timer && timer.enabled && Array.isArray(timer.urls)) {
                const validUrls = timer.urls
                    .filter(u => u && u.trim().length > 0)
                    .map(u => {
                        let url = u.trim();
                        // 自动补全协议头
                        if (!/^https?:\/\//i.test(url)) {
                            url = 'https://' + url;
                        }
                        return url;
                    });
                // 逐个打开标签页，带错误捕获
                const openedTabIds = [];
                for (const url of validUrls) {
                    try {
                        const tab = await chrome.tabs.create({ url: url, active: false });
                        if (tab && tab.id) openedTabIds.push(tab.id);
                    } catch (tabErr) {
                        console.error('Batch timer tab create failed:', url, tabErr);
                    }
                }
                // 显示通知
                const title = timer.name || '批量定时';
                chrome.notifications.create(`batch_notify_${timerId}`, {
                    type: 'basic',
                    iconUrl: '../images/icon.png',
                    title: 'Meow 批量定时',
                    message: `已打开 ${validUrls.length} 个标签页：${title}`,
                    priority: 1
                });
                setTimeout(() => {
                    chrome.notifications.clear(`batch_notify_${timerId}`);
                }, 5000);
                // 记录运行日志（自动触发）
                try {
                    const logData = await chrome.storage.local.get(['meow_batch_logs']);
                    let logs = Array.isArray(logData.meow_batch_logs) ? logData.meow_batch_logs : [];
                    logs.unshift({
                        id: Date.now(),
                        name: timer.name || '未命名任务',
                        urlCount: validUrls.length,
                        success: true,
                        time: new Date().toLocaleString('zh-CN', { hour12: false })
                    });
                    if (logs.length > 100) logs = logs.slice(0, 100);
                    await chrome.storage.local.set({ 'meow_batch_logs': logs });
                } catch (logErr) {
                    console.error('Batch log save error:', logErr);
                }
                // 30秒后自动关闭打开的标签页（Chrome alarm 最小间隔30s）
                if (openedTabIds.length > 0 && timer.autoClose !== false) {
                    const closeKey = `close_batch_${timerId}`;
                    chrome.storage.session.set({ [closeKey]: openedTabIds }).catch(() => {});
                    chrome.alarms.create(closeKey, { delayInMinutes: 0.5 });
                }
            }
        } else if (alarm.name.startsWith('close_batch_')) {
            // 批量定时 - 自动关闭之前打开的标签页
            const closeKey = alarm.name;
            const data = await chrome.storage.session.get([closeKey]);
            const tabIds = data[closeKey];
            if (tabIds && tabIds.length > 0) {
                chrome.tabs.remove(tabIds, () => { chrome.runtime.lastError; });
                chrome.storage.session.remove(closeKey).catch(() => {});
            }
        } else if (alarm.name === 'auto_backup') {
            // 自动 WebDAV 备份
            console.log('Auto backup alarm fired.');
            await performWebDAVBackup();
        }
    } catch (err) {
        console.error('Alarm handler error:', err);
    }
});

// 处理通知按钮点击
chrome.notifications.onButtonClicked.addListener((nid) => {
    if (nid.startsWith('alarm_')) {
        const alarmId = parseInt(nid.replace('alarm_', ''), 10);
        stopAlarmSound();
        chrome.notifications.clear(nid);
        chrome.storage.session.remove('ringingAlarmId').catch(() => {});
        chrome.runtime.sendMessage({ action: 'alarm-stopped', alarmId }).catch(() => {});
    }
});

// 处理通知本体点击
chrome.notifications.onClicked.addListener((nid) => {
    if (nid.startsWith('alarm_')) {
        const alarmId = parseInt(nid.replace('alarm_', ''), 10);
        stopAlarmSound();
        chrome.notifications.clear(nid);
        chrome.storage.session.remove('ringingAlarmId').catch(() => {});
        chrome.runtime.sendMessage({ action: 'alarm-stopped', alarmId }).catch(() => {});
    }
});

// 注：不注册 onClosed，避免 5 秒兜底清理误触发 stopAlarmSound 导致闹钟响铃被中断。
// 声音停止仅由用户主动操作（点击通知本体或"停止响铃"按钮）触发。

// === Offscreen 音频播放 (用于 Service Worker 播放声音) ===
async function createOffscreen() {
    const hasDoc = await chrome.offscreen.hasDocument().catch(() => false);
    if (hasDoc) return;
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: '播放闹钟铃声',
    });
}

async function playAlarmSound() {
    try {
        await createOffscreen();
        // 等待 offscreen 文档完全加载，避免 MV3 Service Worker 提前终止
        await new Promise(resolve => setTimeout(resolve, 500));
        await chrome.runtime.sendMessage({ action: 'play-alarm' }).catch(e => {
            console.error('Send play-alarm failed:', e);
        });
    } catch (e) {
        console.error("Play sound failed:", e);
    }
}

async function stopAlarmSound() {
    try {
        chrome.runtime.sendMessage({ action: 'stop-alarm' }).catch(() => {});
        chrome.storage.session.remove('ringingAlarmId').catch(() => {});
    } catch (e) {
        // Ignore errors if offscreen is closed
    }
}

// === Automatic WebDAV Backup ===

// Helper: Basic Auth
const getAuthFixed = (user, pass) => 'Basic ' + btoa(user + ':' + pass);

// 1. Setup Alarm based on settings
async function setupAutoBackupAlarm() {
    const data = await chrome.storage.sync.get(['webdav_auto_backup']);
    const frequency = data.webdav_auto_backup || 'off';

    // Clear existing alarm first
    await chrome.alarms.clear('auto_backup');

    if (frequency === 'off') {
        console.log('Auto backup disabled.');
        return;
    }

    let periodInMinutes = 0;
    if (frequency === '6h') periodInMinutes = 60 * 6;
    else if (frequency === 'daily') periodInMinutes = 60 * 24;
    else if (frequency === 'weekly') periodInMinutes = 60 * 24 * 7;

    if (periodInMinutes > 0) {
        chrome.alarms.create('auto_backup', { periodInMinutes: periodInMinutes });
        console.log(`Auto backup scheduled every ${periodInMinutes} minutes.`);
    }
}

// 2. Perform Backup
async function performWebDAVBackup() {
    try {
        // Get Config
        const data = await chrome.storage.sync.get(['webdav_config']);
        const config = data.webdav_config;
        
        if (!config || !config.url || !config.user || !config.pass) {
            console.warn('Auto backup skipped: Missing WebDAV config.');
            return;
        }

        const { url, user, pass } = config;
        
        // Prepare Data
        const syncData = await new Promise(r => chrome.storage.sync.get(null, r));
        const localData = await new Promise(r => chrome.storage.local.get(null, r));
        
        const backupPayload = {
            version: '2.7',
            timestamp: Date.now(),
            sync: syncData,
            local: localData,
            auto: true
        };
        const jsonStr = JSON.stringify(backupPayload, null, 2);
        
        // Prepare Connection
        let normalizedUrl = url.trim();
        if (!normalizedUrl.endsWith('/')) normalizedUrl += '/';
        
        const authHeader = getAuthFixed(user, pass);
        let targetFolder = normalizedUrl;
        if (!targetFolder.endsWith('Meow/')) targetFolder += 'Meow/';
        
        // Generate Filename: Meow_AutoBackup_YYYY-MM-DD.json
        // We might want to keep history? Let's use timestamp.
        const now = new Date();
        const dateStr = now.getFullYear() + '-' + 
                       String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                       String(now.getDate()).padStart(2, '0') + '_' + 
                       String(now.getHours()).padStart(2, '0') + '-' + 
                       String(now.getMinutes()).padStart(2, '0');
        const filename = `Meow_AutoBackup_${dateStr}.json`;
        
        // Ensure folder exists
        const propRes = await fetch(targetFolder, {
            method: 'PROPFIND',
            headers: { 'Authorization': authHeader, 'Depth': '0' }
        });

        if (propRes.status === 404) {
             await fetch(targetFolder, {
                 method: 'MKCOL',
                 headers: { 'Authorization': authHeader }
             });
        } else if (propRes.status === 401) {
             console.error('Auto backup failed: Auth failed.');
             showNotification('Meow Backup', '自动备份失败：WebDAV 认证错误');
             return;
        }

        // Upload
        const targetUrl = targetFolder + filename;
        const blob = new Blob([jsonStr], { type: 'application/json' });

        const response = await fetch(targetUrl, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
                'Overwrite': 'T'
            },
            body: blob
        });

        if (response.ok || response.status === 201 || response.status === 204) {
            console.log('Auto backup success:', filename);
            // Optional: Show notification only on failure? Or success too?
            // showNotification('Meow Backup', '自动备份成功'); 
        } else {
            console.error('Auto backup failed:', response.status);
            showNotification('Meow Backup', `自动备份失败: HTTP ${response.status}`);
        }

    } catch (e) {
        console.error('Auto backup error:', e);
        showNotification('Meow Backup', `自动备份出错: ${e.message}`);
    }
}

// Initialize alarm on startup
setupAutoBackupAlarm();