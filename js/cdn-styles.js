// cdn-styles.js - 远程图标 / 字体样式统一异步注入
//
// 【为什么必须异步注入，而不能写成 <head> 里的 <link rel="stylesheet">】
// <head> 中由解析器插入的 <link rel="stylesheet"> 是「渲染阻塞 (render-blocking)」资源：
// 在它加载完成（或连接失败）之前，浏览器不会进行首次绘制，页面整片空白。
//
// 而这里的远程样式来自 fonts.googleapis.com / cdn.jsdmirror.com，在部分网络环境下
// 连接会长时间挂起。长时间没有打开过侧边栏时（缓存已失效 / DNS 与连接都需要重新建立），
// 第一次打开就会卡在这些请求上白屏；第二次、第三次打开时浏览器已经缓存了结果
// （成功的缓存或快速失败的负缓存），于是又能正常显示。
//
// 由 JS 动态创建并插入的 <link>（且 media="print"）不参与渲染阻塞判定，
// 因此面板可以立即完成首次绘制，图标字体在下载完成后自动生效。
//
// 图标体系已统一为 Font Awesome Pro（线框 fa-regular），不再依赖 Google Material Icons。
// 加载失败时会做有限次退避重试，避免因为一次冷启动网络抖动导致图标一直缺失。
// 其它页面（如 popup.html）如需使用，直接引入本文件即可，无需重复配置。

(function () {
    'use strict';

    var CDN_STYLES = [
        // 正文字体（原 css/sidepanel.css 顶部的 @import，@import 同样会阻塞 CSSOM 与渲染）
        'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
        // Font Awesome Pro 7.3.0 (github.com/hzdu/fontawesome-pro)
        'https://cdn.jsdmirror.com/cnb/ifoyar/fontawesome-pro@main/releases/v7.3.0/css/fontawesome.css',
        'https://cdn.jsdmirror.com/cnb/ifoyar/fontawesome-pro@main/releases/v7.3.0/css/regular.css',
        'https://cdn.jsdmirror.com/cnb/ifoyar/fontawesome-pro@main/releases/v7.3.0/css/solid.css',
        'https://cdn.jsdmirror.com/cnb/ifoyar/fontawesome-pro@main/releases/v7.3.0/css/brands.css'
    ];

    var MAX_RETRY = 2;                  // 首次 + 最多 2 次重试
    var loadedHrefs = Object.create(null);

    function injectStylesheet(href, attempt) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        // 双保险：动态插入本身已不算渲染阻塞资源，再加 media="print" 确保任何情况下
        // 都不会拖住首屏绘制；下载完成后在 load 里切成 all 使其生效。
        // （这是 Filament Group 的 loadCSS 推荐做法。）
        link.media = 'print';
        link.setAttribute('data-meow-async-css', '1');

        link.addEventListener('load', function () {
            // 切换回 all 使样式真正生效
            if (link.media !== 'all') link.media = 'all';
            loadedHrefs[href] = true;
        });

        link.addEventListener('error', function () {
            if (attempt >= MAX_RETRY) {
                console.warn('Meow: 远程样式最终加载失败，将使用系统字体/图标缺省（不影响面板功能）:', href);
                return;
            }
            // 退避重试：1s、2s
            setTimeout(function () {
                injectStylesheet(href, attempt + 1);
            }, 1000 * Math.pow(2, attempt));
        });

        (document.head || document.documentElement).appendChild(link);
    }

    function loadAll() {
        CDN_STYLES.forEach(function (href) {
            if (loadedHrefs[href]) return;
            injectStylesheet(href, 0);
        });
    }

    // 在 <head> 中同步执行：本地文件，开销极小，且能尽早开始下载。
    loadAll();

    // 暴露给外部，可在网络恢复（如 window focus）时手动重试。
    window.meowLoadCdnStyles = loadAll;
})();
