// cdn-styles.js - 远程图标 / 字体样式统一异步注入
//
// 【为什么要这么绕：三件事必须同时成立】
// 1) 不能写成 <head> 里的 <link rel="stylesheet">：解析器插入的样式表是渲染阻塞资源，
//    在 CDN 连接成功或超时之前浏览器不会绘制，面板会白屏。
// 2) 也不能只是“异步插 <link>”：<link> 虽然不阻塞绘制，但它（以及它触发的字体下载）
//    会拖住 window 的 load 事件。实测冷启动时 Font Awesome 的 regular 字体 357KB，
//    load 从 ~230ms 被拖到 ~750ms；网络挂起时更久。侧边栏是独立 WebContents，
//    首屏展示对 load 敏感，这正是“有时候白屏、等一会儿才出来”的来源。
// 3) 图标 CDN 偶发失败/网络切换后要能自愈，不能一次失败就整场空白。
//
// 做法：用 fetch 预先取回 CSS 文本（fetch 不参与 load 事件等待），等 window load
// 之后再注入 <style>。load 只等本地文件，面板立即可见；CSS 到达后图标字体才开始下载，
// 不会再拖慢首屏。失败会退避重试，并在网络恢复/页面重新可见时补一次。
//
// 图标体系：Font Awesome Pro 7.3.0（github.com/hzdu/fontawesome-pro）
// Roboto 正文字体也在同一套流程里，失败时回退到系统字体。

(function () {
    'use strict';

    var SHEETS = [
        // 正文字体（原 css/sidepanel.css 顶部的 @import，@import 同样会阻塞 CSSOM 与渲染）
        { key: 'roboto', href: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap' },
        // Font Awesome Pro 7.3.0：core 必须排在前面
        { key: 'fa-core', href: 'https://cdn.jsdmirror.com/cnb/ifoyar/fontawesome-pro@main/releases/v7.3.0/css/fontawesome.css' },
        { key: 'fa-regular', href: 'https://cdn.jsdmirror.com/cnb/ifoyar/fontawesome-pro@main/releases/v7.3.0/css/regular.css' },
        { key: 'fa-solid', href: 'https://cdn.jsdmirror.com/cnb/ifoyar/fontawesome-pro@main/releases/v7.3.0/css/solid.css' },
        { key: 'fa-brands', href: 'https://cdn.jsdmirror.com/cnb/ifoyar/fontawesome-pro@main/releases/v7.3.0/css/brands.css' }
    ];

    var MAX_ATTEMPTS = 4;          // 单次打开内每个样式表最多尝试次数
    var REQUEST_TIMEOUT = 8000;    // 单次请求超时，避免挂起的连接长期占用

    var texts = Object.create(null);      // key -> 已取回并改写好的 CSS 文本
    var state = Object.create(null);      // key -> loading | ready | failed
    var injecting = false;
    var pageLoaded = document.readyState === 'complete';

    // CSS 里的字体路径是相对 CDN 目录的（../webfonts/...），注入到页面后必须改成绝对地址
    function absolutize(cssText, baseHref) {
        return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (match, quote, url) {
            if (/^(data:|blob:|https?:|\/)/i.test(url)) return match;
            try {
                return 'url("' + new URL(url, baseHref).href + '")';
            } catch (e) {
                return match;
            }
        });
    }

    function injectReady() {
        if (!pageLoaded) return;
        if (injecting) return;
        injecting = true;
        try {
            for (var i = 0; i < SHEETS.length; i++) {
                var sheet = SHEETS[i];
                var css = texts[sheet.key];
                if (!css) continue;
                delete texts[sheet.key]; // 每份只注入一次
                var style = document.createElement('style');
                style.setAttribute('data-meow-cdn', sheet.key);
                style.textContent = css;
                (document.head || document.documentElement).appendChild(style);
            }
        } finally {
            injecting = false;
        }
    }

    function fetchSheet(sheet, attempt) {
        state[sheet.key] = 'loading';
        var controller = (typeof AbortController === 'function') ? new AbortController() : null;
        var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT) : null;

        var options = controller ? { signal: controller.signal } : undefined;
        fetch(sheet.href, options)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            })
            .then(function (text) {
                if (timer) clearTimeout(timer);
                texts[sheet.key] = absolutize(text, sheet.href);
                state[sheet.key] = 'ready';
                injectReady();
            })
            .catch(function (err) {
                if (timer) clearTimeout(timer);
                state[sheet.key] = 'failed';
                if (attempt + 1 < MAX_ATTEMPTS) {
                    // 1s、2s、4s 退避，交给浏览器缓存，避免并发重试风暴
                    setTimeout(function () { fetchSheet(sheet, attempt + 1); }, 1000 * Math.pow(2, attempt));
                } else {
                    console.warn('Meow: 远程样式最终加载失败，尝试 <link> 兜底（不影响功能）:', sheet.href, err);
                    injectLinkFallback(sheet);
                }
            });
    }

    // fetch 受 CORS 约束，<link> 不受；极端情况下用 <link> 再试一次。
    // 只在 page load 之后插入，避免又把 load 拖住。
    function injectLinkFallback(sheet) {
        if (!pageLoaded) {
            window.addEventListener('load', function () { injectLinkFallback(sheet); }, { once: true });
            return;
        }
        if (document.querySelector('link[data-meow-cdn-fallback="' + sheet.key + '"]')) return;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        link.setAttribute('data-meow-cdn-fallback', sheet.key);
        link.addEventListener('load', function () {
            state[sheet.key] = 'ready';
        });
        (document.head || document.documentElement).appendChild(link);
    }

    function loadAll() {
        SHEETS.forEach(function (sheet) {
            if (state[sheet.key] === 'ready' || state[sheet.key] === 'loading') return;
            fetchSheet(sheet, 0);
        });
    }

    // 立即开始取 CSS 文本：fetch 不参与 load 事件等待，冷启动时首屏不会等它
    loadAll();

    function onPageLoad() {
        pageLoaded = true;
        injectReady();
    }
    if (pageLoaded) {
        onPageLoad();
    } else {
        window.addEventListener('load', onPageLoad, { once: true });
        // 兜底：如果 load 被其它资源（远程图片/接口）拖住，也不能让图标一直不出现。
        // 首屏此时早已绘制完成，800ms 后直接注入样式。
        setTimeout(onPageLoad, 800);
    }

    // 网络恢复 / 面板重新可见时，补一次失败的样式表
    function retryFailed() {
        SHEETS.forEach(function (sheet) {
            if (state[sheet.key] === 'failed') fetchSheet(sheet, 0);
        });
    }
    window.addEventListener('online', retryFailed);
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') retryFailed();
    });

    // 暴露给外部，可在需要时手动重试
    window.meowLoadCdnStyles = function () {
        pageLoaded = true;
        loadAll();
        injectReady();
    };
})();
