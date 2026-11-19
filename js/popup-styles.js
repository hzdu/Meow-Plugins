// popup-styles.js - 弹出窗口远程正文样式（Roboto）异步注入
//
// 【为什么不能写成 <head> 里的 <link>】
// 解析器插入的 <link rel="stylesheet"> 会阻塞首次绘制：在样式表下载完成（或连接失败）
// 之前，浏览器不会绘制任何内容。fonts.googleapis.com 在部分网络环境下连接会长时间挂起，
// 弹窗就会白屏数秒；第二次打开时因为已有缓存/负缓存才恢复正常。
//
// 由 JS 动态创建、且 media="print" 的 <link> 不参与渲染阻塞判定，下载完成后切换成 all，
// 面板可以立即完成首次绘制，字体就绪后再应用（与 js/cdn-styles.js 同一套做法）。
// 图标字体已本地化到 css/material-icons.css，不依赖网络；这里只处理正文字体，
// 加载失败就直接用系统 sans-serif，不影响任何功能。

(function () {
    'use strict';

    var ROBOTO_HREF = 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap';
    var MAX_RETRY = 1;

    function injectStylesheet(href, attempt) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.media = 'print';
        link.setAttribute('data-meow-async-css', '1');

        link.addEventListener('load', function () {
            if (link.media !== 'all') link.media = 'all';
        });

        link.addEventListener('error', function () {
            if (attempt >= MAX_RETRY) return; // 静默降级为系统字体
            setTimeout(function () {
                injectStylesheet(href, attempt + 1);
            }, 1000 * Math.pow(2, attempt));
        });

        (document.head || document.documentElement).appendChild(link);
    }

    injectStylesheet(ROBOTO_HREF, 0);
})();
