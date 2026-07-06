// sp-scratchpad.js - 便签模块（列表渲染、编辑、粘贴处理）
// 此文件由 sidepanel.js 拆分而来

// ================== SCRATCHPAD 逻辑 ==================
if (scratchHeader && scratchBody) {
    scratchHeader.addEventListener('click', function() {
        scratchBody.classList.toggle('expanded');
        scratchHeader.classList.toggle('active');
    });
}

function addPasteHandler(element) {
    if (!element) return;
    element.addEventListener('paste', function(e) {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") === 0) {
                e.preventDefault();
                const reader = new FileReader();
                reader.onload = function(event) { document.execCommand('insertHTML', false, '<img src="' + event.target.result + '">'); };
                reader.readAsDataURL(items[i].getAsFile());
            }
        }
    });
}

function renderScratchList() {
    scratchList.innerHTML = '';
    let sorted = myScratchList.slice().sort((a, b) => b.time - a.time);
    const searchTerm = searchScratchInput.value.toLowerCase();
    if (searchTerm) sorted = sorted.filter(s => s.content && s.content.toLowerCase().indexOf(searchTerm) !== -1);
    if (sorted.length === 0) { scratchEmpty.classList.remove('hidden'); } else {
        scratchEmpty.classList.add('hidden');
        sorted.forEach(item => {
            const li = document.createElement('li');
            li.className = 'scratch-card';
            li.innerHTML = '<div class="scratch-meta"><span>' + formatTime(item.time) + '</span></div><div class="scratch-content">' + item.content + '</div><div class="scratch-actions"><span class="s-action view"><span class="material-icons" style="font-size:14px">visibility</span> ' + meowI18n.t('action_view') + '</span><span class="s-action copy"><span class="material-icons" style="font-size:14px">content_copy</span> ' + meowI18n.t('action_copy') + '</span><span class="s-action edit"><span class="material-icons" style="font-size:14px">edit</span> ' + meowI18n.t('action_edit') + '</span><span class="s-action del"><span class="material-icons" style="font-size:14px">delete</span> ' + meowI18n.t('action_delete') + '</span></div>';
            li.querySelector('.view').addEventListener('click', function() { textViewContent.innerHTML = item.content; textViewModal.classList.remove('hidden'); });
            li.querySelector('.copy').addEventListener('click', function() { const temp = document.createElement("div"); temp.innerHTML = item.content; copyToClipboard(temp.innerText || temp.textContent, this); });
            li.querySelector('.del').addEventListener('click', async function() { if(await showConfirmDialog({ message: meowI18n.t('msg_confirm_del'), type: 'danger' })) { myScratchList = myScratchList.filter(s => s.id !== item.id); saveData(); renderScratchList(); } });
            li.querySelector('.edit').addEventListener('click', function() { currentScratchEditId = item.id; scratchModalInput.innerHTML = item.content; scratchEditModal.classList.remove('hidden'); });
            scratchList.appendChild(li);
        });
    }
}

if (scratchModalSaveBtn) {
    scratchModalSaveBtn.addEventListener('click', function() {
        const newContent = scratchModalInput.innerHTML.trim(); if (!newContent) { showToast(meowI18n.t('msg_empty')); return; }
        const index = myScratchList.findIndex(s => s.id === currentScratchEditId);
        if (index !== -1) { myScratchList[index].content = newContent; myScratchList[index].time = Date.now(); saveData(); renderScratchList(); showToast(meowI18n.t('msg_saved')); scratchEditModal.classList.add('hidden'); }
    });
}

if (scratchModalCancelBtn) scratchModalCancelBtn.addEventListener('click', function() { scratchEditModal.classList.add('hidden'); });
if (closeScratchModalBtn) closeScratchModalBtn.addEventListener('click', function() { scratchEditModal.classList.add('hidden'); });
closeTextViewModal.addEventListener('click', function() { textViewModal.classList.add('hidden'); textViewContent.innerHTML = ''; });

scratchAddBtn.addEventListener('click', function() {
    const html = scratchInput.innerHTML.trim(), text = scratchInput.innerText.trim();
    if (!text && html.indexOf('<img') === -1) { showToast(meowI18n.t('msg_empty')); return; }
    myScratchList.push({ id: Date.now(), content: html, time: Date.now() });
    scratchInput.innerHTML = ''; saveData(); renderScratchList(); showToast(meowI18n.t('msg_saved'));
});

scratchClearBtn.addEventListener('click', async function() { if (myScratchList.length === 0) return; if (await showConfirmDialog({ message: meowI18n.t('msg_confirm_clear'), type: 'warning' })) { myScratchList = []; saveData(); renderScratchList(); showToast(meowI18n.t('msg_deleted')); } });
