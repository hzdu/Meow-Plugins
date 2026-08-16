// popup-webdav.js - WebDAV功能 + 初始化调用(renderApp)
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === WebDAV 功能 ===
const webdavUrlInput = document.getElementById('webdav-url');
const webdavUserInput = document.getElementById('webdav-user');
const webdavPassInput = document.getElementById('webdav-pass');
const webdavSaveBtn = document.getElementById('webdav-save-btn');
const webdavBackupBtn = document.getElementById('webdav-backup-btn');
const webdavRestoreBtn = document.getElementById('webdav-restore-btn');
const webdavStatus = document.getElementById('webdav-status');

// 加载 WebDAV 设置
const loadWebDAVSettings = async () => {
    const data = await new Promise(r => chrome.storage.sync.get(['webdav_config', 'webdav_auto_backup'], r));
    if (data.webdav_config) {
        if (webdavUrlInput) webdavUrlInput.value = data.webdav_config.url || '';
        if (webdavUserInput) webdavUserInput.value = data.webdav_config.user || '';
        if (webdavPassInput) webdavPassInput.value = data.webdav_config.pass || '';
    }
    const autoBackupSelect = document.getElementById('webdav-auto-backup');
    if (autoBackupSelect) {
        autoBackupSelect.value = data.webdav_auto_backup || 'off';
        
        // Add change listener
        autoBackupSelect.addEventListener('change', async () => {
            const val = autoBackupSelect.value;
            await chrome.storage.sync.set({ 'webdav_auto_backup': val });
            // Notify background to update alarm
            chrome.runtime.sendMessage({ action: 'update-backup-alarm' });
        });
    }
};

// 保存 WebDAV 设置
if (webdavSaveBtn) {
// 保存配置并测试连接
// 保存配置并运行完整诊断
    webdavSaveBtn.addEventListener('click', async () => {
        const url = webdavUrlInput.value.trim();
        const user = webdavUserInput.value.trim();
        const pass = webdavPassInput.value.trim();
        
        const config = { url, user, pass };
        
        // Save first
        chrome.storage.sync.set({ 'webdav_config': config });
        
        if (!url || !user || !pass) {
            showStatus(webdavStatus, meowI18n.t('webdav_missing_config'), 'error');
            return;
        }

        showStatus(webdavStatus, meowI18n.t('webdav_diagnosing'), 'success');
        
        const authHeader = getAuthFixed(user, pass);
        let report = `Diagnostic Report for: ${url}\n\n`;
        let success = false;

        try {
            let normalizedUrl = url;
            if (!normalizedUrl.endsWith('/')) {
                normalizedUrl += '/';
            }
            
            // 1. Check Root of URL (The configured path)
            report += `1. Checking ${normalizedUrl} ... `;
            const res1 = await fetch(normalizedUrl, {
                method: 'PROPFIND',
                headers: { 'Authorization': authHeader, 'Depth': '0', 'Cache-Control': 'no-cache' }
            });
            report += `[${res1.status} ${res1.statusText}]\n`;
            
            if (res1.ok || res1.status === 207) {
                showStatus(webdavStatus, meowI18n.t('webdav_conn_success'), 'success');
                report += `   ✅ Success! The folder exists and is accessible.\n`;
                success = true;
            } else if (res1.status === 401) {
                showStatus(webdavStatus, meowI18n.t('webdav_auth_failed'), 'error');
                report += `   ❌ Auth Failed. Please check username/password.\n`;
            } else if (res1.status === 404) {
                // 2. Check ROOT listing to see what DOES exist
                const urlObj = new URL(normalizedUrl);
                const rootUrl = urlObj.origin + '/';
                
                report += `2. Checking Root Listing: ${rootUrl} ... `;
                
                try {
                    const listRes = await fetch(rootUrl, {
                         method: 'PROPFIND',
                         headers: { 'Authorization': authHeader, 'Depth': '1', 'Cache-Control': 'no-cache' }
                    });
                     
                     report += `[${listRes.status}]\n`;
                     
                     if (listRes.ok || listRes.status === 207) {
                         const text = await listRes.text();
                         const folderName = urlObj.pathname.replace(/^\/|\/$/g, ''); // 'dav'
                         
                         // Simple check against the XML body
                         if (text.includes(`>${folderName}/<`) || text.includes(`/${folderName}/`)) {
                             report += `   ⚠️ Weird: Root lists '${folderName}' but direct access failed.\n`;
                         } else {
                             report += `   ❌ Root accessible, but '${folderName}' NOT found in listing.\n`;
                             // Extract first few hrefs to show user what IS there
                             const matches = text.match(/<d:href>(.*?)<\/d:href>/g);
                             if (matches) {
                                 const simpleList = matches.slice(0, 3).map(m => m.replace(/<\/?d:href>/g, '')).join(', ');
                                 report += `   Found: ${simpleList}...\n`;
                             }
                         }
                     } else {
                         report += `   ❌ Root access also failed (${listRes.status}).\n`;
                     }
                } catch (rootErr) {
                    report += `   (Root check error: ${rootErr.message})\n`;
                }

                showStatus(webdavStatus, meowI18n.t('webdav_path_not_found'), 'error');
            } else {
                showStatus(webdavStatus, meowI18n.t('webdav_error') + res1.status, 'error');
                report += `   ❌ Unexpected Error.\n`;
            }

        } catch (e) {
            console.error(e);
            showStatus(webdavStatus, meowI18n.t('webdav_network_error'), 'error');
            report += `\n❌ Network/CORS Error: ${e.message}\n`;
        }
        
        if (!success) {
            setTimeout(() => alert(report), 100);
        }
    });
}

// WebDAV Helper: Basic Auth Header
const getAuthFixed = (user, pass) => 'Basic ' + btoa(user + ':' + pass);

// WebDAV 备份
// WebDAV 备份
// WebDAV 备份
if (webdavBackupBtn) {
    webdavBackupBtn.addEventListener('click', async () => {
        // Clean inputs
        const urlRaw = webdavUrlInput.value.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
        const user = webdavUserInput.value.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
        const pass = webdavPassInput.value.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');

        if (!urlRaw || !user || !pass) {
            showStatus(webdavStatus, meowI18n.t('webdav_missing_config'), 'error');
            return;
        }

        showStatus(webdavStatus, meowI18n.t('webdav_preparing'), 'success');

        try {
            // 1. Prepare Data
            const syncData = await new Promise(r => chrome.storage.sync.get(null, r));
            const localData = await new Promise(r => chrome.storage.local.get(null, r));
            
            const backupPayload = {
                version: '2.7',
                timestamp: Date.now(),
                sync: syncData,
                local: localData
            };
            const jsonStr = JSON.stringify(backupPayload, null, 2);
            
            // Normalize URL
            let normalizedUrl = urlRaw;
            if (!normalizedUrl.endsWith('/')) {
                normalizedUrl += '/';
            }
            
            const authHeader = getAuthFixed(user, pass);
            
            // Ensure target folder is .../Meow/
            let targetFolder = normalizedUrl;
            if (!targetFolder.endsWith('Meow/')) {
                targetFolder += 'Meow/';
            }
            
            // Generate Date-based Filename: Meow_Backup_YYYY-MM-DD_HH-mm-ss.json
            const now = new Date();
            const dateStr = now.getFullYear() + '-' + 
                           String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                           String(now.getDate()).padStart(2, '0') + '_' + 
                           String(now.getHours()).padStart(2, '0') + '-' + 
                           String(now.getMinutes()).padStart(2, '0') + '-' + 
                           String(now.getSeconds()).padStart(2, '0');
            const filename = `Meow_Backup_${dateStr}.json`;
            
            // Step 1: Check/Create Folder
            const propRes = await fetch(targetFolder, {
                method: 'PROPFIND',
                headers: { 
                    'Authorization': authHeader, 
                    'Depth': '0', 
                    'Cache-Control': 'no-cache' 
                },
                referrerPolicy: 'no-referrer'
            });

            if (propRes.status === 404) {
                 showStatus(webdavStatus, meowI18n.t('webdav_create_folder'), 'success');
                 const mkcolRes = await fetch(targetFolder, {
                     method: 'MKCOL',
                     headers: { 'Authorization': authHeader },
                     referrerPolicy: 'no-referrer'
                 });
                 if (!mkcolRes.ok && mkcolRes.status !== 201) {
                     throw new Error(`Failed to create 'Meow' folder (${mkcolRes.status})`);
                 }
            } else if (propRes.status === 401) {
                 showStatus(webdavStatus, meowI18n.t('webdav_auth_failed'), 'error');
                 return;
            }

            // Step 2: Upload Backup
            showStatus(webdavStatus, meowI18n.t('webdav_uploading', {file: filename}), 'success');
            
            const targetUrl = targetFolder + filename;
            const blob = new Blob([jsonStr], { type: 'application/json' });

            const response = await fetch(targetUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json',
                    'Overwrite': 'T',
                    'Cache-Control': 'no-cache'
                },
                body: blob,
                referrerPolicy: 'no-referrer'
            });

            if (response.ok || response.status === 201 || response.status === 204) {
                showStatus(webdavStatus, meowI18n.t('webdav_backup_success'), 'success');
                setTimeout(() => showStatus(webdavStatus, meowI18n.t('webdav_backup_saved', {file: filename}), 'success'), 2000);
            } else {
                const errorText = await response.text();
                showStatus(webdavStatus, meowI18n.t('webdav_backup_fail') + ' (' + response.status + ')', 'error');
                alert(`Backup Failed (${response.status})\n\nServer Response:\n${errorText.substring(0, 300)}`);
            }

        } catch (e) {
            console.error('WebDAV Backup Error:', e);
            showStatus(webdavStatus, meowI18n.t('webdav_error') + e.message, 'error');
        }
    });
}

// WebDAV 恢复 (自动寻找最新)
if (webdavRestoreBtn) {
    webdavRestoreBtn.addEventListener('click', async () => {
        const urlRaw = webdavUrlInput.value.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
        const user = webdavUserInput.value.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
        const pass = webdavPassInput.value.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');

        if (!urlRaw || !user || !pass) {
            showStatus(webdavStatus, meowI18n.t('webdav_missing_config'), 'error');
            return;
        }
        
        // i18n support check (simple fallback)
        const confirmMsg = meowI18n.t('webdav_restore_confirm');
            
        if (!(await showConfirmDialog({ message: confirmMsg, type: 'warning' }))) {
            return;
        }

        showStatus(webdavStatus, meowI18n.t('webdav_searching'), 'success');

        try {
            let normalizedUrl = urlRaw;
            if (!normalizedUrl.endsWith('/')) {
                normalizedUrl += '/';
            }
            
             // Ensure target folder is .../Meow/
            let targetFolder = normalizedUrl;
            if (!targetFolder.endsWith('Meow/')) {
                targetFolder += 'Meow/';
            }
            
            const authHeader = getAuthFixed(user, pass);

            // Step 1: List files in folder
            const listRes = await fetch(targetFolder, {
                method: 'PROPFIND',
                headers: { 
                    'Authorization': authHeader, 
                    'Depth': '1', 
                    'Cache-Control': 'no-cache' 
                },
                referrerPolicy: 'no-referrer'
            });

            if (!listRes.ok) {
                if (listRes.status === 404) {
                    throw new Error("'Meow' folder not found. No backups?");
                }
                throw new Error(`List failed: ${listRes.status}`);
            }

            const listText = await listRes.text();
            
            // Parse XML to find backup files
            // Pattern: Meow_Backup_YYYY-MM-DD_HH-mm-ss.json or just Meow_Backup.json (legacy)
            const matches = listText.match(/<d:href>(.*?)<\/d:href>/g);
            let backupFiles = [];
            
            if (matches) {
                backupFiles = matches.map(m => {
                    const raw = m.replace(/<\/?d:href>/g, '');
                    // Decode URL parts to handle spaces/special chars if any
                    try { return decodeURIComponent(raw); } catch(e) { return raw; }
                }).filter(path => {
                    // Check if filename contains Meow_Backup and ends in .json
                    return path.includes('Meow_Backup') && path.endsWith('.json');
                });
            }

            if (backupFiles.length === 0) {
                showStatus(webdavStatus, meowI18n.t('webdav_no_backups'), 'error');
                alert(meowI18n.t('webdav_no_backups_msg'));
                return;
            }

            // Sort by string comparison (works for ISO-like dates) descending
            backupFiles.sort((a, b) => {
                return b.localeCompare(a);
            });

            const latestBackupUrl = backupFiles[0];
            // Extract filename for display
            const latestFilename = latestBackupUrl.split('/').pop();

            showStatus(webdavStatus, meowI18n.t('webdav_downloading', {file: latestFilename}), 'success');

            // Step 2: Download the latest file
            // Note: latestBackupUrl is usually a full path like /dav/Meow/file.json
            // We need to construct the full fetch URL carefully.
            // PROPFIND returns paths relative to server root or full paths. 
            // Usually it's /dav/Meow/....
            // We can construct it by taking the origin + latestBackupUrl if it starts with /
            
            // However, `normalizedUrl` is something like `https://dav.jianguoyun.com/dav/`
            // `targetFolder` is `https://dav.jianguoyun.com/dav/Meow/`
            // `latestBackupUrl` is likely `/dav/Meow/Meow_Backup_...`
            
            const u = new URL(normalizedUrl);
            let fetchUrl = latestBackupUrl;
            if (latestBackupUrl.startsWith('/')) {
                fetchUrl = u.origin + latestBackupUrl;
            } else if (!latestBackupUrl.startsWith('http')) {
                // If relative path without /, append to origin? Or is it relative to folder?
                // Safest to rely on absolute paths from PROPFIND usually starting with /
                fetchUrl = u.origin + '/' + latestBackupUrl; 
            }

            const response = await fetch(fetchUrl, {
                method: 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Cache-Control': 'no-cache'
                },
                referrerPolicy: 'no-referrer'
            });

            if (response.ok) {
                const data = await response.json();
                if (data && (data.sync || data.local)) {
                    showStatus(webdavStatus, meowI18n.t('webdav_restoring'), 'success');
                    
                    // Clear and Set
                    await chrome.storage.sync.clear();
                    await chrome.storage.local.clear();
                    
                    if (data.sync) await chrome.storage.sync.set(data.sync);
                    if (data.local) await chrome.storage.local.set(data.local);
                    
                    // Preserve WebDAV Config
                    const currentConfig = { url: urlRaw, user: user, pass: pass };
                    await chrome.storage.sync.set({ 'webdav_config': currentConfig });

                    showStatus(webdavStatus, meowI18n.t('webdav_restore_success'), 'success');
                    setTimeout(() => {
                        alert(meowI18n.t('webdav_restore_success_msg', {file: latestFilename}));
                        chrome.runtime.reload();
                    }, 500);
                } else {
                    throw new Error('Invalid Backup File Format');
                }
            } else {
                showStatus(webdavStatus, meowI18n.t('webdav_backup_fail') + ' (' + response.status + ')', 'error');
                const errText = await response.text();
                console.error(errText);
                if (response.status === 404) {
                     alert(`Backup file not found at:\n${fetchUrl}`);
                }
            }

        } catch (e) {
            console.error('WebDAV Restore Error:', e);
            showStatus(webdavStatus, meowI18n.t('webdav_error') + e.message, 'error');
        }
    });

}

// 初始化加载
loadWebDAVSettings();
renderApp();

