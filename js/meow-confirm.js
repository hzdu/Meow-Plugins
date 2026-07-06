// js/meow-confirm.js - iOS 风格确认对话框独立模块
// 用法: const ok = await showConfirmDialog({ message: '确定删除?', type: 'danger' });
// 选项: title, message, type('danger'|'warning'|'info'), confirmText, cancelText
// 返回: Promise<boolean>  true=确认, false=取消
// 键盘: ←/→ 或 Tab 切换选中按钮，Enter 执行选中按钮，Esc 取消

(function () {
    // 内部 HTML 转义，避免依赖外部
    function _escapeHtml(text) {
        if (text == null) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // 尝试从全局获取 i18n 文本，无则回退默认值
    function _t(key, fallback) {
        try {
            if (typeof meowI18n !== 'undefined' && meowI18n.t) {
                var val = meowI18n.t(key);
                if (val && val !== key) return val;
            }
        } catch (e) { /* ignore */ }
        return fallback;
    }

    // 默认值缓存（首次调用时解析一次）
    var _defaults = null;
    function _getDefaults() {
        if (_defaults) return _defaults;
        _defaults = {
            title: _t('dialog_title_delete', '删除确认'),
            confirm: _t('dialog_confirm', '确定'),
            cancel: _t('dialog_cancel', '取消')
        };
        return _defaults;
    }

    // 监听语言变化，清空缓存
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'sync' && changes.meow_locale) {
                _defaults = null;
            }
        });
    }

    /**
     * 显示 iOS 风格确认对话框
     * @param {Object} options
     * @param {string} [options.title] - 标题
     * @param {string} [options.message] - 提示消息
     * @param {string} [options.type='danger'] - 类型: 'danger' | 'warning' | 'info'
     * @param {string} [options.confirmText] - 确认按钮文本
     * @param {string} [options.cancelText] - 取消按钮文本
     * @returns {Promise<boolean>} true=确认, false=取消
     */
    function showConfirmDialog(options) {
        options = options || {};
        var type = options.type || 'danger';
        var d = _getDefaults();
        var title = options.title || d.title;
        var message = options.message || '';
        var confirmText = options.confirmText || d.confirm;
        var cancelText = options.cancelText || d.cancel;

        return new Promise(function (resolve) {
            var overlay = document.createElement('div');
            overlay.className = 'meow-confirm-overlay';

            overlay.innerHTML =
                '<div class="meow-confirm-dialog" role="alertdialog" aria-modal="true">' +
                '   <div class="meow-confirm-body">' +
                '       <div class="meow-confirm-title">' + _escapeHtml(title) + '</div>' +
                '       <div class="meow-confirm-message">' + _escapeHtml(message) + '</div>' +
                '   </div>' +
                '   <div class="meow-confirm-actions">' +
                '       <button class="meow-confirm-btn meow-confirm-btn-cancel" data-result="false">' + _escapeHtml(cancelText) + '</button>' +
                '       <button class="meow-confirm-btn meow-confirm-btn-confirm ' + type + '" data-result="true">' + _escapeHtml(confirmText) + '</button>' +
                '   </div>' +
                '</div>';

            document.body.appendChild(overlay);
            requestAnimationFrame(function () { overlay.classList.add('visible'); });

            var btns = Array.prototype.slice.call(overlay.querySelectorAll('.meow-confirm-btn'));
            var selected = 1; // 默认选中"确认"按钮

            function updateSelection() {
                btns.forEach(function (b, i) {
                    if (i === selected) b.classList.add('selected');
                    else b.classList.remove('selected');
                });
            }
            updateSelection();

            var resolved = false;
            function finish(result) {
                if (resolved) return;
                resolved = true;
                overlay.classList.remove('visible');
                document.removeEventListener('keydown', onKeydown);
                setTimeout(function () { overlay.remove(); }, 250);
                resolve(result);
            }

            // 按钮点击 & hover
            btns.forEach(function (b) {
                b.addEventListener('click', function () {
                    finish(b.dataset.result === 'true');
                });
                b.addEventListener('mouseenter', function () {
                    var idx = btns.indexOf(b);
                    if (idx !== selected) { selected = idx; updateSelection(); }
                });
            });

            // 点击遮罩层空白处 = 取消
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) finish(false);
            });

            // 键盘导航
            function onKeydown(e) {
                if (e.key === 'Escape') { e.preventDefault(); finish(false); }
                else if (e.key === 'Enter') { e.preventDefault(); finish(btns[selected].dataset.result === 'true'); }
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab') {
                    e.preventDefault();
                    selected = (selected + 1) % btns.length;
                    updateSelection();
                }
            }
            document.addEventListener('keydown', onKeydown);
        });
    }

    // 暴露到全局
    window.showConfirmDialog = showConfirmDialog;
})();
