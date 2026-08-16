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
            li.innerHTML = '<div class="scratch-meta"><span>' + formatTime(item.time) + '</span></div><div class="scratch-content">' + item.content + '</div><div class="scratch-actions"><div class="action-group"><span class="material-icons delete-btn" style="color:#cbd5e1;cursor:pointer;font-size:16px;">delete</span></div></div>';
            li.addEventListener('click', function(e) { if (e.target.closest('.action-group')) return; openScratchEditModal(item); });
            li.querySelector('.delete-btn').addEventListener('click', async function(e) { e.stopPropagation(); if(await showConfirmDialog({ message: meowI18n.t('msg_confirm_del'), type: 'danger' })) { myScratchList = myScratchList.filter(s => s.id !== item.id); saveData(); renderScratchList(); } });
            scratchList.appendChild(li);
        });
    }
}

function openScratchEditModal(item) {
    currentScratchEditId = item.id;
    scratchModalInput.innerHTML = item.content;
    scratchEditModal.classList.remove('hidden');
    setTimeout(() => { scratchModalInput.focus(); updateScratchImgSelection(); }, 100);
}

function closeScratchEditModal() {
    scratchEditModal.classList.add('hidden');
    currentScratchEditId = null;
}

if (scratchModalSaveBtn) {
    scratchModalSaveBtn.addEventListener('click', function() {
        const newContent = scratchModalInput.innerHTML.trim(); if (!newContent) { showToast(meowI18n.t('msg_empty')); return; }
        const index = myScratchList.findIndex(s => s.id === currentScratchEditId);
        if (index !== -1) { myScratchList[index].content = newContent; myScratchList[index].time = Date.now(); saveData(); renderScratchList(); showToast(meowI18n.t('msg_saved')); closeScratchEditModal(); }
    });
}

if (scratchModalCancelBtn) scratchModalCancelBtn.addEventListener('click', closeScratchEditModal);
if (closeScratchModalBtn) closeScratchModalBtn.addEventListener('click', closeScratchEditModal);
// 点击遮罩层不关闭弹窗且不丢失焦点（与服务器弹窗行为一致）
scratchEditModal.addEventListener('mousedown', function(e) { if (e.target === scratchEditModal) e.preventDefault(); });

if (scratchModalSelectAllBtn) {
    scratchModalSelectAllBtn.addEventListener('click', function() {
        scratchModalInput.focus();
        const range = document.createRange();
        range.selectNodeContents(scratchModalInput);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        updateScratchImgSelection();
    });
}

// 监听选区变化，为选中的图片添加高亮边框
function updateScratchImgSelection() {
    const imgs = scratchModalInput.querySelectorAll('img');
    imgs.forEach(img => img.classList.remove('selected'));
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        imgs.forEach(img => {
            if (range.intersectsNode(img) && sel.containsNode(img, true)) {
                img.classList.add('selected');
            }
        });
    }
}

scratchModalInput.addEventListener('click', function() { setTimeout(updateScratchImgSelection, 0); });
scratchModalInput.addEventListener('keyup', function() { setTimeout(updateScratchImgSelection, 0); });
document.addEventListener('selectionchange', function() {
    if (!scratchEditModal.classList.contains('hidden')) {
        const activeEl = document.activeElement;
        if (activeEl === scratchModalInput || (activeEl && scratchModalInput.contains(activeEl))) {
            updateScratchImgSelection();
        }
    }
});

if (scratchModalCopyBtn) {
    scratchModalCopyBtn.addEventListener('click', function() {
        const text = scratchModalInput.innerText || scratchModalInput.textContent;
        if (!text.trim()) { showToast(meowI18n.t('msg_empty')); return; }
        copyToClipboard(text, scratchModalCopyBtn);
    });
}

closeTextViewModal.addEventListener('click', function() { textViewModal.classList.add('hidden'); textViewContent.innerHTML = ''; });

scratchAddBtn.addEventListener('click', function() {
    const html = scratchInput.innerHTML.trim(), text = scratchInput.innerText.trim();
    if (!text && html.indexOf('<img') === -1) { showToast(meowI18n.t('msg_empty')); return; }
    myScratchList.push({ id: Date.now(), content: html, time: Date.now() });
    scratchInput.innerHTML = ''; saveData(); renderScratchList(); showToast(meowI18n.t('msg_saved'));
});

scratchClearBtn.addEventListener('click', async function() { if (myScratchList.length === 0) return; if (await showConfirmDialog({ message: meowI18n.t('msg_confirm_clear'), type: 'warning' })) { myScratchList = []; saveData(); renderScratchList(); showToast(meowI18n.t('msg_deleted')); } });
