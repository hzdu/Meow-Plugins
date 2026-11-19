// card-drag.js - 卡片拖拽排序（侧边栏「AI提示词」「暂存板」与弹出窗口「2FA验证」共用）
// 交互与侧边栏「服务器管理」卡片完全一致：
//   · 只有标题行是拖拽手柄，卡片内容区不参与拖拽，
//     内容里的文本/图片仍可用鼠标正常拖选；
//   · 拖拽期间被拖卡片脱离文档流、紧贴指针移动，它原来的位置由一个等高的
//     占位块顶替，占位块随指针逐格移动，实时指示「松手后落到哪」；
//   · 其它卡片通过 FLIP 位移补间滑向新位置，形成平滑让位的观感；
//   · 松手后由 onReorder 回调按新的 DOM 顺序落盘。
// 事件用委托只绑一次：列表每次重渲染都会调用本函数，逐卡绑定会重复注册。

function setupCardDragSort(opts) {
    const container = opts && opts.container;
    if (!container) return;

    const cardSelector = opts.cardSelector;
    const headerSelector = opts.headerSelector;
    const placeholderClass = opts.placeholderClass || 'card-drop-placeholder';
    const placeholderTag = opts.placeholderTag || 'div';
    const handleClass = opts.handleClass || '';
    const handleIconClass = opts.handleIconClass || 'mi fa-regular fa-grip-dots-vertical';
    const handleText = opts.handleText || '';
    const ignoreSelector = opts.ignoreSelector || '';
    const boundKey = opts.boundKey || 'cardDragBound';
    // list：单列列表，按相邻卡片中线逐格换位；grid：多列网格，按最近槽位落点
    const layout = opts.layout === 'grid' ? 'grid' : 'list';
    // 可拖拽判定：列表里混有只读卡片（如服务器下发的记录）时，
    // 这些卡片不补手柄、不参与拖拽，也不作为让位/落点参照。
    const canDrag = typeof opts.canDrag === 'function' ? opts.canDrag : null;
    // 排序分组：同一列表里可能并存互不相通的几段（如本地记录 / 服务器记录），
    // 拖拽只能在本组内换位，避免松手后跳回原位。
    const sortGroup = typeof opts.sortGroup === 'function' ? opts.sortGroup : null;
    const onReorder = typeof opts.onReorder === 'function' ? opts.onReorder : null;

    // 每次重建卡片后都要刷新：确保标题行 draggable、补齐拖拽手柄、重排索引。
    // 注意：只有标题行是拖拽手柄，卡片本体绝不设置 draggable，
    // 否则在内容区按住鼠标会被浏览器当成拖拽，导致无法拖选文字。
    function refreshIndices() {
        container.querySelectorAll(cardSelector).forEach(function (card, i) {
            card.dataset.index = i;
            card.removeAttribute('draggable');
            // 有些列表（如热门榜单左侧 TAB）卡片本身就是手柄，没有独立的标题行元素
            const header = card.matches(headerSelector) ? card : card.querySelector(headerSelector);
            if (!header) return;
            if (canDrag && !canDrag(card)) {
                // 只读卡片：不设 draggable，也不插手柄
                header.removeAttribute('draggable');
                return;
            }
            header.setAttribute('draggable', 'true');
            // 标题行里的链接、图片自带原生拖拽（拖动会变成拖链接/拖图片，而不是拖卡片），统一关掉
            header.querySelectorAll('a[href], img').forEach(function (el) { el.setAttribute('draggable', 'false'); });
            if (handleClass && !header.querySelector('.' + handleClass)) {
                const handle = document.createElement('span');
                handle.className = handleIconClass + (handleClass ? ' ' + handleClass : '');
                // 图标字体不同：侧边栏用 Font Awesome 图标类，弹出窗口用 Material Icons 文字
                if (handleText) handle.textContent = handleText;
                header.insertBefore(handle, header.firstChild);
            }
        });
    }

    refreshIndices();

    if (container.dataset[boundKey] === '1') return;
    container.dataset[boundKey] = '1';

    let dragCard = null;      // 正在拖拽的卡片
    let placeholder = null;   // 撑开空位的占位块
    let srcIndex = null;      // 拖拽起点索引
    let grabOffsetX = 0;      // 按下点相对卡片左上角的偏移
    let grabOffsetY = 0;

    // 被筛选隐藏的卡片仍留在 DOM 里（display:none），既不占位也不参与
    // 落点判断；offsetParent 为 null 也一并兜底。
    function isActiveCard(card) {
        if (!card || card === dragCard) return false;
        if (card.style.display === 'none' || card.offsetParent === null) return false;
        if (canDrag && !canDrag(card)) return false;
        if (sortGroup && dragCard && sortGroup(card) !== sortGroup(dragCard)) return false;
        return true;
    }

    // 让跟随卡片贴在指针位置
    function followPointer(x, y) {
        if (!dragCard) return;
        dragCard.style.left = (x - grabOffsetX) + 'px';
        dragCard.style.top = (y - grabOffsetY) + 'px';
    }

    // 记录除被拖卡片外的布局位置。
    // 这里刻意用 offsetTop/offsetLeft 而非 getBoundingClientRect：它们反映的是
    // 布局位置，不受 transform 影响，让位动画未结束时再次测量也不会累加误差。
    function snapshotPositions() {
        const positions = new Map();
        container.querySelectorAll(cardSelector).forEach(function (card) {
            if (!isActiveCard(card)) return;
            positions.set(card, { left: card.offsetLeft, top: card.offsetTop });
        });
        return positions;
    }

    // FLIP：先让卡片瞬移到新布局位置并施加反向位移，再过渡回 0，形成滑入效果。
    // 网格布局需要同时补间横向位移，纵向列表里的 dx 自然为 0。
    function animateLetWay(prevPositions) {
        container.querySelectorAll(cardSelector).forEach(function (card) {
            if (!isActiveCard(card)) return;
            const before = prevPositions.get(card);
            if (!before) return;
            const dx = before.left - card.offsetLeft;
            const dy = before.top - card.offsetTop;
            if (!dx && !dy) return;
            card.style.transition = 'none';
            card.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
            void card.offsetWidth; // 强制重排，确保反向位移先生效
            card.style.transition = 'transform .18s cubic-bezier(.2, .8, .2, 1)';
            card.style.transform = '';
        });
    }

    // 取占位块前后真正参与排序的卡片。
    // 必须跳过被拖卡片：它已改为 fixed，offsetTop 变成视口坐标（与其它卡片
    // 相对容器的 offsetTop 不同基准），且视觉上不占位，不能作为落点参照。
    function siblingCard(dir) {
        let node = placeholder;
        if (!node) return null;
        while ((node = dir > 0 ? node.nextElementSibling : node.previousElementSibling)) {
            if (node.nodeType === 1 && node.matches(cardSelector) && isActiveCard(node)) return node;
        }
        return null;
    }

    // 让占位块上移/下移一格（dir = 1 下移，-1 上移）
    function shiftPlaceholder(dir) {
        if (!placeholder || !placeholder.parentNode) return false;
        const prevPositions = snapshotPositions();
        if (dir > 0) {
            const next = siblingCard(1);
            if (!next) return false;
            container.insertBefore(placeholder, next.nextElementSibling);
        } else {
            const prev = siblingCard(-1);
            if (!prev) return false;
            container.insertBefore(placeholder, prev);
        }
        animateLetWay(prevPositions);
        return true;
    }

    // 布局矩形（不受 FLIP 动画的 transform 影响，拖拽过程中测量稳定）。
    // 单元格视口位置 = 容器视口位置 + 元素相对容器的布局偏移；
    // 前提是容器自身是定位元素（offsetParent），网格/列表都已在 CSS 里保证。
    function layoutRect(el) {
        const cr = container.getBoundingClientRect();
        return {
            left: cr.left + el.offsetLeft,
            top: cr.top + el.offsetTop,
            right: cr.left + el.offsetLeft + el.offsetWidth,
            bottom: cr.top + el.offsetTop + el.offsetHeight
        };
    }

    // 网格布局（如侧边栏图集 4 列）：把占位块移动到指针最近的槽位。
    // 槽位 = 在流项目（活动卡片 + 占位块自身）按阅读顺序（先行后列）占的单元格；
    // 占位块自身槽位也参与“最近”比较，指针停在占位块上时目标不变，落点稳定不回跳。
    function placePlaceholderAt(x, y) {
        if (!placeholder) return false;
        const cards = Array.from(container.querySelectorAll(cardSelector)).filter(isActiveCard);
        if (!cards.length) return false;

        const inFlow = cards.concat([placeholder]);
        inFlow.sort(function (a, b) {
            const ra = layoutRect(a);
            const rb = layoutRect(b);
            if (Math.abs(ra.top - rb.top) > 1) return ra.top - rb.top;
            return ra.left - rb.left;
        });

        let targetIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < inFlow.length; i++) {
            const rect = layoutRect(inFlow[i]);
            const dx = Math.max(rect.left - x, 0, x - rect.right);
            const dy = Math.max(rect.top - y, 0, y - rect.bottom);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) {
                minDist = d;
                targetIdx = i;
            }
        }

        const currentIdx = inFlow.indexOf(placeholder);
        if (targetIdx === currentIdx) return false;

        // 目标在后（targetIdx > currentIdx）→ 插到“当前占目标后一槽位”的项目前（越过它一格）
        // 目标在前（targetIdx < currentIdx）→ 插到“当前占目标槽位”的项目前
        const refIdx = targetIdx > currentIdx ? targetIdx + 1 : targetIdx;
        const ref = refIdx < inFlow.length ? inFlow[refIdx] : null;

        const prevPositions = snapshotPositions();
        container.insertBefore(placeholder, ref);
        animateLetWay(prevPositions);
        return true;
    }

    // 指针是否越过了相邻卡片的中线，越过才换位。
    // 基准取「相邻卡片中线」而不是占位块中心：卡片高度差异很大，
    // 以占位块中心为基准会让高卡片的落点判断严重偏后。
    function shiftTowardsPointer(clientY) {
        if (!placeholder) return false;
        const y = clientY - container.getBoundingClientRect().top;

        const next = siblingCard(1);
        if (next && y > next.offsetTop + next.offsetHeight / 2) return shiftPlaceholder(1);

        const prev = siblingCard(-1);
        if (prev && y < prev.offsetTop + prev.offsetHeight / 2) return shiftPlaceholder(-1);

        return false;
    }

    // 结束拖拽：keepPosition 为 true 表示落到占位块处，false 表示回到起点（取消）
    function finishDrag(keepPosition) {
        if (!dragCard) return;
        const card = dragCard;
        const fromIndex = srcIndex;

        if (placeholder) {
            if (keepPosition) {
                container.insertBefore(card, placeholder);
            } else {
                // 取消时按原索引复位：先从列表里排除自己，再把原索引处的卡片当锚点
                const others = Array.from(container.querySelectorAll(cardSelector)).filter(function (c) { return c !== card; });
                const anchor = others[fromIndex] || null;
                if (anchor) container.insertBefore(card, anchor);
                else container.appendChild(card);
            }
            if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
        }
        placeholder = null;

        card.classList.remove('dragging-follow', 'dragging', 'drag-over');
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';

        // 清理让位动画的内联样式。
        // 必须先关过渡再清除位移：否则清除位移会按 CSS 的 all .2s 再滑一次，
        // 表现为 drop 后卡片额外滑行一段。归位完成后再恢复默认过渡。
        const cleanupCards = container.querySelectorAll(cardSelector);
        cleanupCards.forEach(function (c) {
            c.style.transition = 'none';
            c.style.transform = '';
        });
        void container.offsetWidth;
        cleanupCards.forEach(function (c) { c.style.transition = ''; });

        dragCard = null;

        if (!keepPosition || fromIndex === null) {
            refreshIndices();
            return;
        }

        // 只上报可见卡片的顺序：被筛选隐藏的卡片不参与让位，位置保持不变
        // 只上报本次拖拽分组内的卡片顺序（其它分组的顺序由各自的数据源决定）
        const group = sortGroup ? sortGroup(card) : null;
        const visibleIds = Array.from(container.querySelectorAll(cardSelector))
            .filter(function (c) {
                return c.style.display !== 'none' && c.offsetParent !== null &&
                    (!canDrag || canDrag(c)) &&
                    (!group || !sortGroup || sortGroup(c) === group);
            })
            .map(function (c) { return String(c.dataset.id); });

        if (onReorder) onReorder(visibleIds, card);
        refreshIndices();
    }

    // 只有拖拽源是标题行时才视为卡片排序；
    // 标题行里的下拉框、删除按钮、内容区选中文字等原生拖拽一律忽略。
    function getDragCard(e) {
        const target = e.target;
        if (!target || typeof target.closest !== 'function') return null;
        const header = target.closest(headerSelector);
        if (!header || !container.contains(header)) return null;
        if (ignoreSelector && target.closest(ignoreSelector)) return null;
        const card = header.closest(cardSelector);
        if (canDrag && !canDrag(card)) return null;
        return card;
    }

    container.addEventListener('dragstart', function (e) {
        const card = getDragCard(e);
        if (!card || !isActiveCard(card)) return;

        const rect = card.getBoundingClientRect();
        dragCard = card;
        srcIndex = Array.from(container.querySelectorAll(cardSelector)).indexOf(card);
        grabOffsetX = e.clientX - rect.left;
        grabOffsetY = e.clientY - rect.top;

        // 原生拖影是浏览器拍下的快照，会和我们 fixed 跟随的卡片叠成重影，
        // 用 1×1 透明图替换掉，只保留跟随指针的那一张。
        try {
            const blank = document.createElement('canvas');
            blank.width = 1;
            blank.height = 1;
            e.dataTransfer.setDragImage(blank, 0, 0);
        } catch (_) {}

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', String(card.dataset.id || srcIndex)); } catch (_) {}
        }

        // 占位块先顶住原位，再把卡片抽出文档流
        placeholder = document.createElement(placeholderTag);
        placeholder.className = placeholderClass;
        placeholder.style.height = rect.height + 'px';
        // 网格里每个单元宽度小于容器，占位块必须显式对齐被拖卡片的尺寸
        if (layout === 'grid') placeholder.style.width = rect.width + 'px';
        container.insertBefore(placeholder, card);

        card.style.width = rect.width + 'px';
        card.style.height = rect.height + 'px';
        card.style.left = rect.left + 'px';
        card.style.top = rect.top + 'px';
        card.classList.add('dragging-follow');
        card.classList.remove('dragging', 'drag-over');
    });

    container.addEventListener('dragover', function (e) {
        if (!dragCard || !placeholder) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        followPointer(e.clientX, e.clientY);

        if (layout === 'grid') {
            placePlaceholderAt(e.clientX, e.clientY);
            return;
        }

        // 每次 dragover 最多追 4 格：快速拖动时指针一帧能跨过好几张卡片，
        // 只移动一格会明显滞后。上限 4 次是为了避免长列表下逐帧重排过多。
        for (let i = 0; i < 4; i++) {
            if (!shiftTowardsPointer(e.clientY)) break;
        }
    });

    container.addEventListener('drop', function (e) {
        if (!dragCard) return;
        e.preventDefault();
        e.stopPropagation();
        finishDrag(true);
    });

    container.addEventListener('dragend', function () {
        // drop 分支已处理过则 dragCard 已置空；这里兜底「拖到区域外松手」的取消
        if (dragCard) finishDrag(false);
    });

    // 指针移出列表时容器收不到 dragover，卡片会滞留在原处；
    // 用 document 捕获阶段保持跟随（不调用 preventDefault，不影响原生放置判定）
    document.addEventListener('dragover', function (e) {
        if (dragCard) followPointer(e.clientX, e.clientY);
    }, true);
}
