// big-calendar-shell.js — 顶级液态玻璃 TAB、时钟、关闭
// 负责视图切换与滑动玻璃指示块，SSH / 日历各自独立初始化。

(function () {
    'use strict';

    var TAB_KEY = 'meow_big_calendar_tab';

    var tabs = Array.prototype.slice.call(document.querySelectorAll('.glass-tab'));
    var tabNav = document.getElementById('main-tabs');
    var glider = document.getElementById('tab-glider');
    var views = Array.prototype.slice.call(document.querySelectorAll('.tab-view'));
    var closeBtn = document.getElementById('btn-close');

    if (!tabs.length || !tabNav) return;

    var activeTab = 'ssh';

    function readSavedTab() {
        try {
            var v = localStorage.getItem(TAB_KEY);
            if (v === 'ssh' || v === 'calendar') return v;
        } catch (e) { /* ignore */ }
        return null;
    }

    function saveTab(tab) {
        try {
            localStorage.setItem(TAB_KEY, tab);
        } catch (e) { /* ignore */ }
    }

    function findTab(name) {
        for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].dataset.tab === name) return tabs[i];
        }
        return null;
    }

    function positionGlider(tabEl, animate) {
        if (!glider || !tabEl) return;
        if (!animate) glider.style.transition = 'none';
        var left = tabEl.offsetLeft;
        var width = tabEl.offsetWidth;
        glider.style.transform = 'translateX(' + left + 'px)';
        glider.style.width = width + 'px';
        if (!animate) {
            // 强制回流后恢复过渡，避免初始定位出现滑动动画
            void glider.offsetWidth;
            glider.style.transition = '';
        }
        tabNav.classList.add('ready');
    }

    function switchTab(name, animate) {
        var tabEl = findTab(name);
        if (!tabEl) return;

        activeTab = name;

        tabs.forEach(function (tab) {
            var on = tab === tabEl;
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
            tab.tabIndex = on ? 0 : -1;
        });

        views.forEach(function (view) {
            view.classList.toggle('active', view.id === 'view-' + name);
        });

        positionGlider(tabEl, animate !== false);
        saveTab(name);

        document.dispatchEvent(new CustomEvent('meow:tabchange', { detail: { tab: name } }));
    }

    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            switchTab(tab.dataset.tab);
        });

        tab.addEventListener('keydown', function (e) {
            var index = tabs.indexOf(tab);
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                var dir = e.key === 'ArrowRight' ? 1 : -1;
                var next = tabs[(index + dir + tabs.length) % tabs.length];
                switchTab(next.dataset.tab);
                next.focus();
            } else if (e.key === 'Home') {
                e.preventDefault();
                switchTab(tabs[0].dataset.tab);
                tabs[0].focus();
            } else if (e.key === 'End') {
                e.preventDefault();
                switchTab(tabs[tabs.length - 1].dataset.tab);
                tabs[tabs.length - 1].focus();
            }
        });
    });

    // 关闭页面
    if (closeBtn) {
        closeBtn.addEventListener('click', function (e) {
            e.preventDefault();
            window.close();
        });
    }

    // 顶部 / 终端时钟
    var topClock = document.getElementById('topbar-clock');
    var termClock = document.getElementById('term-clock');

    function two(n) {
        return n < 10 ? '0' + n : String(n);
    }

    function tickClock() {
        var d = new Date();
        if (topClock) topClock.textContent = two(d.getHours()) + ':' + two(d.getMinutes());
        if (termClock) termClock.textContent = two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
    }

    tickClock();
    setInterval(tickClock, 1000);

    // 指示块定位：字体/图标加载、窗口尺寸变化后都要重算
    function refreshGlider() {
        positionGlider(findTab(activeTab), false);
    }

    if (typeof ResizeObserver === 'function') {
        var ro = new ResizeObserver(function () { refreshGlider(); });
        ro.observe(tabNav);
    }

    window.addEventListener('resize', refreshGlider);
    window.addEventListener('load', function () {
        refreshGlider();
        setTimeout(refreshGlider, 120);
        setTimeout(refreshGlider, 600);
    });

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(refreshGlider).catch(function () { });
    }

    // 初始 TAB：URL hash 优先，其次上次选择
    var initial = 'ssh';
    var hash = (location.hash || '').replace('#', '');
    if (hash === 'ssh' || hash === 'calendar') {
        initial = hash;
    } else {
        var saved = readSavedTab();
        if (saved) initial = saved;
    }

    switchTab(initial, false);
    refreshGlider();
    setTimeout(refreshGlider, 80);

    // 暴露给其他模块（例如 SSH 空状态跳转）
    window.meowSwitchTab = switchTab;
    window.meowGetActiveTab = function () { return activeTab; };
})();
