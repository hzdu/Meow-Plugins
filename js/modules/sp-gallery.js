// sp-gallery.js - 图集模块（多选、灯箱预览、拖拽上传）
// 此文件由 sidepanel.js 拆分而来

// ================== GALLERY (图集多选增强) ==================
function renderGallery() {
    galleryGrid.innerHTML = '';
    const sorted = myGalleryImages.slice().sort((a, b) => b.timestamp - a.timestamp);

    // 更新选中计数显示
    updateGallerySelectCount();

    if (sorted.length === 0) {
        galleryEmpty.classList.remove('hidden');
    } else {
        galleryEmpty.classList.add('hidden');
        sorted.forEach(img => {
            const div = document.createElement('div');
            div.className = 'gallery-item';

            // 图片
            const imageEl = document.createElement('img');
            imageEl.src = img.dataUrl;
            imageEl.loading = "lazy";

            // 复选框
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'item-check';
            checkbox.checked = selectedImageIds.has(img.id);

            // 点击复选框逻辑
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止触发大图预览
                if (checkbox.checked) {
                    selectedImageIds.add(img.id);
                } else {
                    selectedImageIds.delete(img.id);
                }
                updateGallerySelectCount();
            });

            div.appendChild(imageEl);
            div.appendChild(checkbox);

            // 点击图片触发预览
            div.addEventListener('click', function() { openLightbox(img); });
            galleryGrid.appendChild(div);
        });
    }
}

function updateGallerySelectCount() {
    gallerySelectCountLabel.textContent = selectedImageIds.size;
}

// 全选按钮逻辑
gallerySelectAllBtn.addEventListener('click', () => {
    if (selectedImageIds.size === myGalleryImages.length && myGalleryImages.length > 0) {
        selectedImageIds.clear();
    } else {
        myGalleryImages.forEach(img => selectedImageIds.add(img.id));
    }
    renderGallery();
});

// 批量删除逻辑
galleryBulkDeleteBtn.addEventListener('click', async () => {
    if (selectedImageIds.size === 0) return;
    if (await showConfirmDialog({ message: meowI18n.t('msg_confirm_del'), type: 'danger' })) {
        myGalleryImages = myGalleryImages.filter(img => !selectedImageIds.has(img.id));
        selectedImageIds.clear();
        saveData();
        renderGallery();
        showToast(meowI18n.t('msg_deleted'));
    }
});

function handleImageFile(file) {
    if (!file.type.startsWith('image/')) return; if (file.size > 5 * 1024 * 1024) { showToast(meowI18n.t('msg_img_too_large')); return; }
    const reader = new FileReader();
    reader.onload = function(e) {
        myGalleryImages.unshift({ id: Date.now() + Math.random().toString(36).substr(2, 5), timestamp: Date.now(), dataUrl: e.target.result });
        if (myGalleryImages.length > 50) myGalleryImages = myGalleryImages.slice(0, 50);
        saveData(); renderGallery(); showToast(meowI18n.t('msg_saved'));
    };
    reader.readAsDataURL(file);
}

document.addEventListener('paste', function(e) { if (viewGallery.classList.contains('hidden')) return; const items = e.clipboardData.items; for (let i = 0; i < items.length; i++) { if (items[i].type.indexOf('image') !== -1) { handleImageFile(items[i].getAsFile()); e.preventDefault(); } } });
[galleryDropZone, viewGallery].forEach(target => {
    target.addEventListener('dragover', function(e) { e.preventDefault(); galleryDropZone.classList.add('drag-over'); });
    target.addEventListener('dragleave', function() { galleryDropZone.classList.remove('drag-over'); });
    target.addEventListener('drop', function(e) { e.preventDefault(); galleryDropZone.classList.remove('drag-over'); if (viewGallery.classList.contains('hidden')) return; const files = e.dataTransfer.files; for (let i = 0; i < files.length; i++) handleImageFile(files[i]); });
});

// ================== LIGHTBOX (灯箱预览) ==================
function openLightbox(imgObj) { currentLightboxImageId = imgObj.id; lbImage.src = imgObj.dataUrl; lightbox.classList.remove('hidden'); requestAnimationFrame(() => lightbox.classList.add('show')); }
function closeLightbox() { lightbox.classList.remove('show'); setTimeout(() => { lightbox.classList.add('hidden'); lbImage.src = ''; currentLightboxImageId = null; }, 200); }
lightbox.addEventListener('click', function(e) { if (e.target === lightbox) closeLightbox(); });
lbCloseBtn.addEventListener('click', closeLightbox);
lbCopyBtn.addEventListener('click', async function() {
    if (!lbImage.src) return;
    try { const res = await fetch(lbImage.src), blob = await res.blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); showToast(meowI18n.t('msg_copied')); } catch (err) { showToast('Copy Failed'); }
});
if (lbBase64Btn) lbBase64Btn.addEventListener('click', function() { if (lbImage.src) navigator.clipboard.writeText(lbImage.src).then(() => showToast(meowI18n.t('msg_copied'))).catch(() => showToast('Copy Failed')); });
lbOpenBtn.addEventListener('click', function() { if (currentLightboxImageId) chrome.tabs.create({ url: chrome.runtime.getURL('views/gallery_view.html?id=' + currentLightboxImageId) }); });
lbDownloadBtn.addEventListener('click', function() { if (lbImage.src) { const link = document.createElement('a'); link.href = lbImage.src; link.download = 'meow_img_' + Date.now() + '.png'; document.body.appendChild(link); link.click(); document.body.removeChild(link); } });
lbDeleteBtn.addEventListener('click', async function() { if (currentLightboxImageId && await showConfirmDialog({ message: meowI18n.t('msg_confirm_del'), type: 'danger' })) { myGalleryImages = myGalleryImages.filter(img => img.id !== currentLightboxImageId); saveData(); renderGallery(); closeLightbox(); showToast(meowI18n.t('msg_deleted')); } });
