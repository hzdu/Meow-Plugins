// sp-readlater.js - 稍后阅读模块
// 此文件由 sidepanel.js 拆分而来

// ================== READ LATER ==================
function renderReadLaterList() {
    readLaterList.innerHTML = '';
    let filtered = myReadLaterList.slice();
    const searchTerm = searchReadLaterInput.value.toLowerCase();
    if (searchTerm) filtered = filtered.filter(item => (item.title && item.title.toLowerCase().indexOf(searchTerm) !== -1) || (item.url && item.url.toLowerCase().indexOf(searchTerm) !== -1));
    if (filtered.length === 0) { readLaterEmpty.classList.remove('hidden'); } else {
        readLaterEmpty.classList.add('hidden');
        filtered.forEach(item => {
            const li = document.createElement('li'); li.className = 'scratch-card';
            const faviconImg = item.favIconUrl ? '<img src="' + item.favIconUrl + '" style="width:16px;height:16px;margin-right:6px;vertical-align:middle;display:inline-block;border-radius:0;">' : '<span class="material-icons" style="font-size:16px;margin-right:6px;vertical-align:middle;color:#94a3b8">public</span>';
            li.innerHTML = '<div style="font-weight:600; color:#334155; margin-bottom:4px; font-size:13px; display:flex; align-items:center;">' + faviconImg + ' ' + escapeHtml(item.title || 'No Title') + '</div><div style="font-size:11px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:6px;">' + escapeHtml(item.url) + '</div><div class="scratch-meta"><span>' + formatTime(item.time) + '</span></div><div class="scratch-actions"><span class="s-action open"><span class="material-icons" style="font-size:14px">open_in_new</span> ' + meowI18n.t('action_open') + '</span><span class="s-action copy"><span class="material-icons" style="font-size:14px">content_copy</span> ' + meowI18n.t('action_copy') + '</span><span class="s-action del"><span class="material-icons" style="font-size:14px">delete</span> ' + meowI18n.t('action_delete') + '</span></div>';
            li.querySelector('.open').addEventListener('click', function() { chrome.tabs.create({ url: item.url }); });
            li.querySelector('.copy').addEventListener('click', function() { copyToClipboard(item.url, this); });
            li.querySelector('.del').addEventListener('click', function() { myReadLaterList = myReadLaterList.filter(s => s.id !== item.id); saveData(); renderReadLaterList(); });
            readLaterList.appendChild(li);
        });
    }
}
if (readLaterClearBtn) readLaterClearBtn.addEventListener('click', async function() { if (myReadLaterList.length === 0) return; if (await showConfirmDialog({ message: meowI18n.t('msg_confirm_clear'), type: 'warning' })) { myReadLaterList = []; saveData(); renderReadLaterList(); showToast(meowI18n.t('msg_deleted')); } });
