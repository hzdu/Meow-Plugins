// sp-ai-collection.js - AI 合集模块（标签管理、iframe加载、全部服务弹窗、拖拽排序）
// 此文件由 sidepanel.js 拆分而来

// ================== AI合集逻辑 ==================
function getFaviconUrl(url) {
    try {
        const u = new URL(url);
        return u.origin + '/favicon.ico';
    } catch (e) {
        return '';
    }
}

function renderAiTags() {
    aiTagsContainer.innerHTML = '';
    if (myAiTags.length === 0) {
        aiEmpty.classList.remove('hidden');
        aiIframeWrapper.classList.add('hidden');
        aiTagAllBtn.style.display = 'none';
        return;
    }

    aiEmpty.classList.add('hidden');
    // 标签 >= 3 时显示ALL按钮
    aiTagAllBtn.style.display = myAiTags.length >= 3 ? 'flex' : 'none';

    myAiTags.forEach(tag => {
        const div = document.createElement('div');
        div.className = 'ai-tag-item' + (currentAiTagId === tag.id ? ' active' : '');

        const nameSpan = document.createElement('span');
        nameSpan.textContent = tag.name;

        div.appendChild(nameSpan);
        if (tag.openInNewTab) {
            const newtabIcon = document.createElement('span');
            newtabIcon.className = 'material-icons';
            newtabIcon.textContent = 'open_in_new';
            newtabIcon.style.cssText = 'font-size:12px; opacity:0.5; margin-left:1px;';
            div.appendChild(newtabIcon);
        }

        div.addEventListener('click', function() {
            handleAiTagClick(tag);
        });

        // 右键菜单：在标签页打开
        div.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            // 移除已有的右键菜单
            document.querySelectorAll('.ai-tag-ctx-menu').forEach(m => m.remove());
            const menu = document.createElement('div');
            menu.className = 'ai-tag-ctx-menu';
            menu.innerHTML = '<span class="material-icons" style="font-size:14px;">open_in_new</span> 在标签页打开';
            menu.style.left = e.pageX + 'px';
            menu.style.top = e.pageY + 'px';
            menu.addEventListener('click', function(ev) {
                ev.stopPropagation();
                chrome.tabs.create({ url: tag.url });
                menu.remove();
            });
            document.body.appendChild(menu);
            // 点击其他地方关闭菜单
            setTimeout(() => {
                document.addEventListener('click', function handler() {
                    menu.remove();
                    document.removeEventListener('click', handler);
                });
            }, 0);
        });

        aiTagsContainer.appendChild(div);
    });

    // 鼠标滚轮横向滚动标签
    aiTagsContainer.addEventListener('wheel', function(e) {
        if (e.deltaY !== 0) {
            e.preventDefault();
            this.scrollLeft += e.deltaY;
        }
    }, { passive: false });

    // 如果当前没有选中的标签且有标签存在，但不自动打开
    if (currentAiTagId && !myAiTags.find(t => t.id === currentAiTagId)) {
        currentAiTagId = null;
        aiIframe.src = '';
        aiIframeWrapper.classList.add('hidden');
    }
}

function handleAiTagClick(tag) {
    if (tag.openInNewTab) {
        chrome.tabs.create({ url: tag.url });
    } else {
        currentAiTagId = tag.id;
        aiIframe.src = tag.url;
        aiIframeWrapper.classList.remove('hidden');
        aiEmpty.classList.add('hidden');
        renderAiTags(); // 重新渲染以更新active状态
    }
}

// 加载默认AI标签
function loadDefaultAiTag() {
    // 如果已经有选中的标签，不覆盖
    if (currentAiTagId) return;
    const defaultTag = myAiTags.find(t => t.isDefault && !t.openInNewTab);
    if (defaultTag) {
        handleAiTagClick(defaultTag);
    }
}

// 勾选"新标签页打开"时隐藏"设为默认"
aiTagNewtabCheckbox.addEventListener('change', function() {
    if (this.checked) {
        aiTagDefaultCheckbox.checked = false;
        aiTagDefaultLabel.style.display = 'none';
    } else {
        aiTagDefaultLabel.style.display = 'flex';
    }
});

// === 全部AI服务弹窗 ===
function renderAiAllGrid() {
    aiAllGrid.innerHTML = '';
    myAiTags.forEach((tag, index) => {
        const item = document.createElement('div');
        const isActive = (currentAiTagId === tag.id);
        item.className = 'full-cat-item' + (isActive ? ' active' : '');
        item.dataset.index = index;

        // Enforce row layout + position relative for drag handle
        item.style.flexDirection = 'row';
        item.style.justifyContent = 'flex-start';
        item.style.gap = '6px';
        item.style.padding = '8px 10px';
        item.style.position = 'relative';

        // 0. Drag Handle - 右上角拖拽排序图标
        const dragHandle = document.createElement('span');
        dragHandle.className = 'material-icons ai-drag-handle';
        dragHandle.textContent = 'drag_indicator';
        dragHandle.title = '按住拖动排序';
        dragHandle.setAttribute('draggable', 'true');
        dragHandle.addEventListener('dragstart', function(e) {
            e.stopPropagation();
            aiDragSrcIndex = index;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
        });
        dragHandle.addEventListener('mousedown', function(e) {
            // 阻止触发item的点击事件
            e.stopPropagation();
        });
        item.appendChild(dragHandle);

        // Drag events on item (drop target)
        item.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.classList.add('drag-over');
        });
        item.addEventListener('dragleave', function() {
            item.classList.remove('drag-over');
        });
        item.addEventListener('drop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            item.classList.remove('drag-over');
            const dragDestIndex = index;
            if (aiDragSrcIndex !== null && aiDragSrcIndex !== dragDestIndex) {
                const movedItem = myAiTags.splice(aiDragSrcIndex, 1)[0];
                myAiTags.splice(dragDestIndex, 0, movedItem);
                saveData();
                renderAiAllGrid();
                renderAiTags();
            }
            aiDragSrcIndex = null;
        });
        item.addEventListener('dragend', function() {
            item.classList.remove('dragging');
            document.querySelectorAll('#ai-all-grid .full-cat-item').forEach(el => el.classList.remove('drag-over'));
            aiDragSrcIndex = null;
        });

        // 1. Check Icon (Default/Active) - Placed BEFORE text
        if (isActive) {
            const checkIcon = document.createElement('span');
            checkIcon.className = 'material-icons';
            checkIcon.textContent = 'check_circle';
            checkIcon.style.cssText = 'font-size:16px;color:#6366f1;flex-shrink:0;';
            item.appendChild(checkIcon);
        }

        // 2. Name
        const nameSpan = document.createElement('span');
        nameSpan.textContent = tag.name;
        nameSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;text-align:left;';
        item.appendChild(nameSpan); // Takes up remaining space

        // 4. New Tab Icon
        if (tag.openInNewTab) {
            const ntIcon = document.createElement('span');
            ntIcon.className = 'material-icons';
            ntIcon.textContent = 'open_in_new';
            ntIcon.style.cssText = 'font-size:13px;opacity:0.5;flex-shrink:0;';
            item.appendChild(ntIcon);
        }

        // 5. Edit Icon - Placed AFTER text (at the end)
        const editBtn = document.createElement('span');
        editBtn.className = 'material-icons';
        editBtn.textContent = 'edit';
        editBtn.style.cssText = 'font-size:14px;color:#94a3b8;cursor:pointer;flex-shrink:0;';
        editBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            aiAllModal.classList.add('hidden');
            openAiTagModal(tag);
        });
        item.appendChild(editBtn);

        item.addEventListener('click', function() {
            aiAllModal.classList.add('hidden');
            handleAiTagClick(tag);
        });
        aiAllGrid.appendChild(item);
    });
}

aiTagAllBtn.addEventListener('click', function() {
    renderAiAllGrid();
    aiAllModal.classList.remove('hidden');
});
closeAiAllModal.addEventListener('click', function() { aiAllModal.classList.add('hidden'); });
aiAllModal.addEventListener('click', function(e) { if (e.target === aiAllModal) aiAllModal.classList.add('hidden'); });

function openAiTagModal(tag) {
    if (tag) {
        editingAiTagId = tag.id;
        aiModalTitle.textContent = '编辑AI服务';
        aiTagNameInput.value = tag.name;
        aiTagUrlInput.value = tag.url;
        aiTagNewtabCheckbox.checked = !!tag.openInNewTab;
        aiTagDefaultCheckbox.checked = !!tag.isDefault;
        aiTagDefaultLabel.style.display = tag.openInNewTab ? 'none' : 'flex';
        aiTagDeleteBtn.classList.remove('hidden');
    } else {
        editingAiTagId = null;
        aiModalTitle.textContent = '添加AI服务';
        aiTagNameInput.value = '';
        aiTagUrlInput.value = '';
        aiTagNewtabCheckbox.checked = false;
        aiTagDefaultCheckbox.checked = false;
        aiTagDefaultLabel.style.display = 'flex';
        aiTagDeleteBtn.classList.add('hidden');
    }
    aiTagModal.classList.remove('hidden');
    setTimeout(() => aiTagNameInput.focus(), 100);
}

function closeAiTagModal() {
    aiTagModal.classList.add('hidden');
    editingAiTagId = null;
}

aiTagAddBtn.addEventListener('click', function() {
    openAiTagModal(null);
});

closeAiModal.addEventListener('click', closeAiTagModal);
aiTagModal.addEventListener('click', function(e) {
    if (e.target === aiTagModal) closeAiTagModal();
});

aiTagSaveBtn.addEventListener('click', function() {
    const name = aiTagNameInput.value.trim();
    let url = aiTagUrlInput.value.trim();
    if (!name || !url) {
        showToast('请填写名称和URL');
        return;
    }
    // 自动补全 https://
    if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
    }
    if (editingAiTagId) {
        const index = myAiTags.findIndex(t => t.id === editingAiTagId);
        if (index !== -1) {
            myAiTags[index].name = name;
            myAiTags[index].url = url;
            myAiTags[index].openInNewTab = aiTagNewtabCheckbox.checked;
            if (aiTagNewtabCheckbox.checked) {
                myAiTags[index].isDefault = false;
            } else if (aiTagDefaultCheckbox.checked) {
                myAiTags.forEach(t => t.isDefault = false);
                myAiTags[index].isDefault = true;
            } else {
                myAiTags[index].isDefault = false;
            }
        }
        // 如果正在查看这个标签，刷新iframe
        if (currentAiTagId === editingAiTagId) {
            aiIframe.src = url;
        }
        showToast('已更新');
    } else {
        const isDefault = !aiTagNewtabCheckbox.checked && aiTagDefaultCheckbox.checked;
        if (isDefault) {
            myAiTags.forEach(t => t.isDefault = false);
        }
        myAiTags.push({ id: Date.now(), name: name, url: url, openInNewTab: aiTagNewtabCheckbox.checked, isDefault: isDefault });
        showToast('已添加');
    }
    saveData();
    renderAiTags();
    closeAiTagModal();
});

aiTagDeleteBtn.addEventListener('click', async function() {
    if (!editingAiTagId) return;
    if (await showConfirmDialog({ message: '确定删除此AI服务？', type: 'danger' })) {
        myAiTags = myAiTags.filter(t => t.id !== editingAiTagId);
        if (currentAiTagId === editingAiTagId) {
            currentAiTagId = null;
            aiIframe.src = '';
            aiIframeWrapper.classList.add('hidden');
        }
        saveData();
        renderAiTags();
        closeAiTagModal();
        showToast('已删除');
    }
});

// 回车键快速保存
aiTagUrlInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        aiTagSaveBtn.click();
    }
});
