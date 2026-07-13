// js/annotation.js - 网页备注功能 (完整版：含国际化支持)

(async function() {
  'use strict';

  // === 0. 等待国际化初始化 ===
  if (window.meowI18n) {
      await window.meowI18n.init();
  }

  // === 状态管理 ===
  let isAnnotationMode = false;
  let canvas = null;
  let ctx = null;
  let toolbar = null;
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  let borderOverlay = null;

  // 历史记录 (用于撤销)
  let historyStack = [];
  const MAX_HISTORY = 20;

  // 工具状态
  let currentTool = 'draw'; 
  const toolCycle = ['draw', 'text', 'mosaic', 'eraser', 'highlighter'];

  // 荧光笔高亮记录
  let highlightSpans = [];

  let textAnnotations = []; 
  let stickyNotes = []; 
  
  // 绘图设置 (默认红色)
  let brushColor = '#FF0000'; 
  let brushSize = 10;

  // 常用颜色预设
  const PRESET_COLORS = [
      '#FF0000', '#FF9500', '#FFCC00', '#4CD964', '#5AC8FA', 
      '#007AFF', '#5856D6', '#FF2D55', '#000000', '#FFFFFF'
  ];

  // === 初始化检查 ===
  chrome.storage.local.get(['meow_edit_intent'], async (result) => {
    if (result.meow_edit_intent) {
        const noteId = result.meow_edit_intent;
        let data = await new Promise(r => chrome.storage.local.get([noteId], r));
        if (!data[noteId]) data = await new Promise(r => chrome.storage.sync.get([noteId], r));
        const note = data[noteId];
        if (note && window.location.href.includes(note.url)) {
            chrome.storage.local.remove('meow_edit_intent');
            enterAnnotationMode();
            restoreAnnotationState(note);
        }
    }
  });

  // === 恢复逻辑 ===
  function restoreAnnotationState(note) {
      if (note.canvasData) {
          const img = new Image();
          img.onload = () => { if (ctx) ctx.drawImage(img, 0, 0); };
          img.src = note.canvasData;
      }
      if (note.stickyNotes && Array.isArray(note.stickyNotes)) {
          note.stickyNotes.forEach(n => createStickyNote(n.x, n.y, n.text, n.color));
      }
  }

  // === 消息监听 ===
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggle-annotation') {
      toggleAnnotationMode();
      sendResponse({ success: true });
    }
    return true;
  });

  function toggleAnnotationMode() {
    if (isAnnotationMode) exitAnnotationMode();
    else enterAnnotationMode();
  }

  function enterAnnotationMode() {
    isAnnotationMode = true;
    createBorderOverlay();
    createCanvas();
    createToolbar();
    document.body.style.overflow = 'hidden';
    historyStack = [];
    document.removeEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', handleKeyDown);
    document.removeEventListener('mouseup', handleHighlightMouseup);
    document.addEventListener('mouseup', handleHighlightMouseup);
    setTool('draw'); 
  }

  function exitAnnotationMode() {
    isAnnotationMode = false;
    if (borderOverlay) { borderOverlay.remove(); borderOverlay = null; }
    if (canvas) { canvas.remove(); canvas = null; ctx = null; }
    if (toolbar) { toolbar.remove(); toolbar = null; }
    stickyNotes.forEach(note => note.remove());
    stickyNotes = [];
    clearHighlights();
    historyStack = [];
    document.body.style.overflow = '';
    isDrawing = false;
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('mouseup', handleHighlightMouseup);
  }

  // === 历史记录 (Undo) ===
  function saveState() {
      if (!ctx || !canvas) return;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      historyStack.push({ type: 'canvas', data: imageData });
      if (historyStack.length > MAX_HISTORY) historyStack.shift();
  }

  function saveHighlightState(span) {
      historyStack.push({ type: 'highlight', span: span });
      if (historyStack.length > MAX_HISTORY) historyStack.shift();
  }

  function performUndo() {
      if (historyStack.length === 0) {
          showToast(meowI18n.t('anno_msg_no_undo'), 'warning');
          return;
      }
      const action = historyStack.pop();
      if (action.type === 'canvas') {
          if (action.data && ctx) {
              ctx.putImageData(action.data, 0, 0);
          }
          showToast(meowI18n.t('anno_msg_undo'), 'info');
      } else if (action.type === 'highlight') {
          const span = action.span;
          if (span && span.parentNode) {
              const parent = span.parentNode;
              while (span.firstChild) {
                  parent.insertBefore(span.firstChild, span);
              }
              parent.removeChild(span);
              parent.normalize();
          }
          highlightSpans = highlightSpans.filter(s => s !== span);
          showToast(meowI18n.t('anno_msg_undo'), 'info');
      }
  }

  // === 工具切换 ===
  function setTool(toolName) {
      currentTool = toolName;
      if (toolbar) {
          toolbar.querySelectorAll('.meow-mode-btn').forEach(b => {
              if (b.dataset.mode === toolName) b.classList.add('active');
              else b.classList.remove('active');
          });
          const drawOptions = toolbar.querySelectorAll('.meow-draw-options');
          const textOptions = toolbar.querySelector('.meow-text-options');
          const isText = (toolName === 'text');
          const isHighlighter = (toolName === 'highlighter');
          drawOptions.forEach(opt => {
              const isBrushSize = opt.querySelector('#meow-brush-slider');
              if (isText) {
                  opt.style.setProperty('display', 'none', 'important');
              } else if (isHighlighter && isBrushSize) {
                  opt.style.setProperty('display', 'none', 'important');
              } else {
                  opt.style.setProperty('display', 'flex', 'important');
              }
          });
          if (textOptions) textOptions.style.setProperty('display', isText ? 'block' : 'none', 'important');
      }
      if (canvas) {
          if (toolName === 'highlighter') {
              canvas.style.setProperty('pointer-events', 'none', 'important');
              canvas.style.setProperty('cursor', 'text', 'important');
          } else {
              canvas.style.setProperty('pointer-events', 'auto', 'important');
              if (toolName === 'text') canvas.style.setProperty('cursor', 'text', 'important');
              else if (toolName === 'eraser') canvas.style.setProperty('cursor', 'grab', 'important');
              else canvas.style.setProperty('cursor', 'crosshair', 'important');
          }
      }
      if (ctx) {
          ctx.globalCompositeOperation = (toolName === 'eraser') ? 'destination-out' : 'source-over';
      }
      
      const toolNames = { 
          'draw': meowI18n.t('anno_tool_brush'), 
          'text': meowI18n.t('anno_tool_text'), 
          'eraser': meowI18n.t('anno_tool_eraser'), 
          'mosaic': meowI18n.t('anno_tool_mosaic'),
          'highlighter': meowI18n.t('anno_tool_highlighter') 
      };
      showToast(meowI18n.t('anno_msg_switched', {tool: toolNames[toolName]}), 'info');
  }

  // === UI 创建 ===
  function createCanvas() {
    canvas = document.createElement('canvas');
    canvas.id = 'meow-annotation-canvas';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    document.body.appendChild(canvas);

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);
    window.addEventListener('resize', handleResize);
  }

  function createBorderOverlay() {
    if (borderOverlay) return;
    borderOverlay = document.createElement('div');
    borderOverlay.className = 'meow-border-overlay';
    document.body.appendChild(borderOverlay);
  }

  // === 工具栏创建 ===
  function createToolbar() {
    toolbar = document.createElement('div');
    toolbar.id = 'meow-annotation-toolbar';
    
    const presetsHtml = PRESET_COLORS.map(c => 
        `<div class="meow-preset-color" data-color="${c}" style="background:${c}" title="${c}"></div>`
    ).join('');

    // 使用 i18n 获取文本
    const tTitle = meowI18n.t('anno_title');
    const tBrush = meowI18n.t('anno_tool_brush');
    const tText = meowI18n.t('anno_tool_text');
    const tEraser = meowI18n.t('anno_tool_eraser');
    const tMosaic = meowI18n.t('anno_tool_mosaic');
    const tSticky = meowI18n.t('anno_tool_sticky');
    const tHighlighter = meowI18n.t('anno_tool_highlighter');
    const tColorTip = meowI18n.t('anno_color_title');
    const tSizeTip = meowI18n.t('anno_size_title');
    const tConfirm = meowI18n.t('anno_hex_confirm');
    const tSave = meowI18n.t('anno_action_save');
    const tClear = meowI18n.t('anno_action_clear');
    const tExit = meowI18n.t('anno_action_exit');

    toolbar.innerHTML = `
      <style>
        #meow-annotation-toolbar { 
            width: 52px !important;
            display: flex !important;
            flex-direction: column !important;
            padding: 8px 6px !important;
            gap: 10px !important;
            top: 60px !important; 
            right: 20px !important;
            border-radius: 6px !important;
            box-shadow: 0 4px 15px rgba(0,0,0,0.4) !important;
            background: rgba(30, 30, 30, 0.95) !important;
            z-index: 2147483647 !important;
            box-sizing: border-box !important;
            position: fixed !important;
        }
        
        .meow-toolbar-title {
            font-size: 10px !important;
            font-weight: bold !important;
            text-align: center !important;
            cursor: move !important;
            padding-bottom: 6px !important;
            border-bottom: 1px solid rgba(255,255,255,0.1) !important;
            margin-bottom: 0 !important;
            color: #fbbf24 !important;
            user-select: none !important;
        }

        .meow-mode-btns, .meow-action-group {
            display: flex !important;
            flex-direction: column !important;
            gap: 6px !important;
            width: 100% !important;
        }

        .meow-mode-btn, .meow-action-btn {
            width: 100% !important;
            height: 34px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-size: 18px !important;
            border-radius: 4px !important;
            background: rgba(255,255,255,0.1) !important;
            border: none !important;
            cursor: pointer !important;
            color: rgba(255,255,255,0.8) !important;
        }
        .meow-mode-btn.active {
            background: #fbbf24 !important;
            color: #333 !important;
        }

        /* 颜色触发器 */
        .meow-color-trigger {
            width: 32px !important;
            height: 32px !important;
            border-radius: 50% !important;
            border: 2px solid #fff !important;
            margin: 0 auto !important;
            cursor: pointer !important;
            background-color: ${brushColor} !important;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3) !important;
            transition: transform 0.1s !important;
        }
        .meow-color-trigger:hover {
            transform: scale(1.1) !important;
        }

        /* 自定义调色板 */
        #meow-custom-picker {
            position: absolute !important;
            right: 60px !important; 
            top: 0 !important;      
            background: rgba(40, 40, 40, 0.98) !important;
            padding: 10px !important;
            border-radius: 8px !important;
            box-shadow: 0 5px 20px rgba(0,0,0,0.5) !important;
            display: none !important; 
            width: 130px !important;
            flex-direction: column !important;
            gap: 8px !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
            z-index: 2147483650 !important;
        }
        
        #meow-custom-picker.show {
            display: flex !important;
        }

        .meow-preset-grid {
            display: grid !important;
            grid-template-columns: repeat(5, 1fr) !important;
            gap: 5px !important;
        }
        .meow-preset-color {
            width: 20px !important;
            height: 20px !important;
            border-radius: 4px !important;
            cursor: pointer !important;
            border: 1px solid rgba(255,255,255,0.2) !important;
        }
        .meow-preset-color:hover {
            border-color: #fff !important;
            transform: scale(1.1) !important;
        }

        .meow-hex-row {
            display: flex !important;
            align-items: center !important;
            gap: 5px !important;
            margin-top: 5px !important;
            padding-top: 5px !important;
            border-top: 1px solid rgba(255,255,255,0.1) !important;
        }
        #meow-hex-input {
            width: 60px !important;
            background: rgba(0,0,0,0.3) !important;
            border: 1px solid rgba(255,255,255,0.2) !important;
            color: #fff !important;
            font-size: 11px !important;
            padding: 4px !important;
            border-radius: 4px !important;
            font-family: monospace !important;
            text-transform: uppercase !important;
            outline: none !important;
        }
        #meow-picker-confirm {
            background: #34c759 !important;
            border: none !important;
            color: white !important;
            border-radius: 4px !important;
            width: 24px !important;
            height: 24px !important;
            cursor: pointer !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-weight: bold !important;
        }

        .meow-divider {
            height: 1px !important;
            background: rgba(255,255,255,0.1) !important;
            width: 100% !important;
            margin: 2px 0 !important;
        }
        #meow-brush-slider { width: 100% !important; margin: 0 !important; height: 4px !important; }
    </style>

      <div class="meow-toolbar-title" id="meow-drag-handle">${tTitle}</div>
      
      <!-- 工具 -->
      <div class="meow-toolbar-group">
        <div class="meow-mode-btns">
          <button class="meow-mode-btn active" data-mode="draw" title="${tBrush} (Alt+F1)">🖌️</button>
          <button class="meow-mode-btn" data-mode="text" title="${tText} (Alt+F1)">📝</button>
          <button class="meow-mode-btn" data-mode="eraser" title="${tEraser} (Alt+F1)">🧹</button>
          <button class="meow-mode-btn" data-mode="mosaic" title="${tMosaic} (Alt+F1)">▒</button>
          <button class="meow-mode-btn" data-mode="highlighter" title="${tHighlighter} (Alt+F1)">🖍️</button>
          <button class="meow-mode-btn meow-sticky-btn" title="${tSticky} (Alt+F2)">🗒️</button>
        </div>
      </div>

      <div class="meow-divider"></div>

      <!-- 颜色 -->
      <div class="meow-toolbar-group meow-draw-options">
        <div class="meow-color-trigger" id="meow-color-btn" title="${tColorTip}"></div>
      </div>

      <!-- 调色板 -->
      <div id="meow-custom-picker">
         <div class="meow-preset-grid">
            ${presetsHtml}
         </div>
         <div class="meow-hex-row">
            <span style="color:#aaa; font-size:10px;">#</span>
            <input type="text" id="meow-hex-input" value="${brushColor.replace('#','')}" maxlength="6">
            <button id="meow-picker-confirm" title="${tConfirm}">✓</button>
         </div>
      </div>

      <!-- 大小 -->
      <div class="meow-toolbar-group meow-draw-options">
        <input type="range" min="2" max="50" value="${brushSize}" id="meow-brush-slider" title="${tSizeTip}">
      </div>

      <div class="meow-divider"></div>

      <!-- 底部 -->
      <div class="meow-toolbar-group meow-action-group">
        <button class="meow-action-btn meow-save-btn" style="background:#007aff; color:#fff;" title="${tSave} (Alt+S)">💾</button>
        <button class="meow-action-btn meow-clear-btn" title="${tClear}">🗑️</button>
        <button class="meow-action-btn meow-close-btn" style="background:#fbbf24; color:#000;" title="${tExit} (Esc)">✅</button>
      </div>
    `;

    document.body.appendChild(toolbar);
    makeDraggable(toolbar, document.getElementById('meow-drag-handle'));
    bindToolbarEvents();
  }

  function makeDraggable(element, handle) {
      let isDrag = false;
      let startX, startY, initialLeft, initialTop;
      handle.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation(); 
          isDrag = true; startX = e.clientX; startY = e.clientY;
          const rect = element.getBoundingClientRect();
          initialLeft = rect.left; initialTop = rect.top;
          handle.style.cursor = 'grabbing';
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
      });
      function onMouseMove(e) {
          if (!isDrag) return; e.preventDefault();
          element.style.setProperty('left', `${initialLeft + (e.clientX - startX)}px`, 'important');
          element.style.setProperty('top', `${initialTop + (e.clientY - startY)}px`, 'important');
          element.style.setProperty('right', 'auto', 'important');
          element.style.setProperty('bottom', 'auto', 'important');
      }
      function onMouseUp() {
          isDrag = false; handle.style.cursor = 'move';
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
      }
  }

  function bindToolbarEvents() {
    toolbar.querySelectorAll('.meow-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.classList.contains('meow-sticky-btn')) createStickyNote();
        else setTool(btn.dataset.mode);
      });
    });

    const colorBtn = document.getElementById('meow-color-btn');
    const picker = document.getElementById('meow-custom-picker');
    const hexInput = document.getElementById('meow-hex-input');
    const confirmBtn = document.getElementById('meow-picker-confirm');
    const presets = document.querySelectorAll('.meow-preset-color');

    colorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        picker.classList.toggle('show');
        hexInput.value = brushColor.replace('#', '');
    });

    presets.forEach(preset => {
        preset.addEventListener('click', (e) => {
            e.stopPropagation();
            const color = preset.dataset.color;
            hexInput.value = color.replace('#', '');
            updateColorFromHex();
        });
    });

    hexInput.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = e.target.value;
        if (val.length === 6 && /^[0-9A-Fa-f]{6}$/.test(val)) {
            brushColor = '#' + val.toUpperCase();
            colorBtn.style.setProperty('background-color', brushColor, 'important');
        }
    });

    const updateColorFromHex = () => {
        let val = hexInput.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
            brushColor = val.toUpperCase();
            colorBtn.style.setProperty('background-color', brushColor, 'important');
            picker.classList.remove('show');
            showToast(meowI18n.t('anno_msg_loaded'), 'info');
            if (currentTool !== 'draw') setTool('draw');
        } else {
            hexInput.style.borderColor = 'red';
            setTimeout(() => hexInput.style.borderColor = 'rgba(255,255,255,0.2)', 1000);
        }
    };

    confirmBtn.addEventListener('click', (e) => { e.stopPropagation(); updateColorFromHex(); });

    document.addEventListener('click', (e) => {
        if (picker.classList.contains('show') && !picker.contains(e.target) && e.target !== colorBtn) {
            picker.classList.remove('show');
        }
    });

    toolbar.querySelector('#meow-brush-slider').addEventListener('input', (e) => {
      brushSize = parseInt(e.target.value);
    });

    toolbar.querySelector('.meow-save-btn').addEventListener('click', (e) => { e.stopPropagation(); saveAnnotation(); });
    toolbar.querySelector('.meow-clear-btn').addEventListener('click', (e) => { e.stopPropagation(); saveState(); clearCanvas(); textAnnotations = []; redrawCanvas(); });
    toolbar.querySelector('.meow-close-btn').addEventListener('click', (e) => { e.stopPropagation(); exitAnnotationMode(); });

    toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
    toolbar.addEventListener('touchstart', (e) => e.stopPropagation());
  }

  // === 快捷键 ===
  function handleKeyDown(e) {
    if (!isAnnotationMode) return;
    
    // Ctrl+Z 撤销
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); performUndo(); return; }
    
    // Esc 退出
    if (e.key === 'Escape') { e.preventDefault(); exitAnnotationMode(); return; }
    
    // Alt+S 保存
    if (e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); saveAnnotation(() => exitAnnotationMode()); }
    // Alt+A 长截图
    if (e.altKey && (e.key.toLowerCase() === 'a' || e.code === 'KeyA')) { e.preventDefault(); e.stopPropagation(); captureFullPage(); }
    
    // Alt+F1 切换工具
    if (e.altKey && e.code === 'F1') {
        e.preventDefault(); e.stopPropagation();
        let currentIndex = toolCycle.indexOf(currentTool);
        if (currentIndex === -1) currentIndex = 0; 
        const nextIndex = (currentIndex + 1) % toolCycle.length;
        setTool(toolCycle[nextIndex]);
    }

    // Alt+F2 新建便签
    if (e.altKey && e.code === 'F2') {
        e.preventDefault(); e.stopPropagation();
        createStickyNote();
    }
  }

  // === 绘图核心 ===
  function startDrawing(e) {
    if (currentTool === 'text') {
      e.preventDefault(); e.stopPropagation();
      setTimeout(() => createTextInput(e.clientX, e.clientY), 10);
      return;
    }
    saveState(); 
    isDrawing = true; [lastX, lastY] = [e.offsetX, e.offsetY];
    if (currentTool === 'mosaic') drawMosaic(e.offsetX, e.offsetY);
  }

  function draw(e) {
    if (!isDrawing) return;
    if (currentTool === 'draw') {
        ctx.beginPath(); ctx.strokeStyle = brushColor; ctx.lineWidth = brushSize;
        ctx.moveTo(lastX, lastY); ctx.lineTo(e.offsetX, e.offsetY); ctx.stroke();
    } else if (currentTool === 'eraser') {
        ctx.beginPath(); ctx.lineWidth = brushSize * 2; 
        ctx.moveTo(lastX, lastY); ctx.lineTo(e.offsetX, e.offsetY); ctx.stroke();
    } else if (currentTool === 'mosaic') drawMosaic(e.offsetX, e.offsetY);
    [lastX, lastY] = [e.offsetX, e.offsetY];
  }

  function drawMosaic(x, y) {
      const size = brushSize * 2; const density = 4;
      const originalComposite = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < density; i++) {
          const offsetX = (Math.random() - 0.5) * size; const offsetY = (Math.random() - 0.5) * size;
          const gray = Math.floor(Math.random() * 255);
          ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray}, 0.8)`;
          ctx.fillRect(x + offsetX, y + offsetY, size/2, size/2);
      }
      ctx.globalCompositeOperation = originalComposite;
  }

  function stopDrawing() { isDrawing = false; }

  function createTextInput(x, y) {
    const existing = document.getElementById('meow-text-container'); if (existing) existing.remove();
    const container = document.createElement('div');
    container.id = 'meow-text-container';
    container.style.cssText = `position: fixed; left: ${x}px; top: ${y}px; z-index: 2147483602;`;
    const input = document.createElement('textarea');
    input.style.cssText = `font-size: 16px; color: ${brushColor}; border: 2px dashed #00aaff; background: rgba(255,255,255,0.1); outline: none; min-width: 20px;`;
    container.appendChild(input); document.body.appendChild(container); input.focus();
    
    const saveAndRemove = () => {
        const text = input.value.trim();
        if (text) {
            saveState();
            const rect = container.getBoundingClientRect();
            textAnnotations.push({ x: rect.left + 6, y: rect.top + 20, text, color: brushColor, fontSize: 16 });
            drawTextAnnotation(textAnnotations[textAnnotations.length - 1]);
        }
        container.remove();
    };
    input.addEventListener('blur', saveAndRemove);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') {
            e.stopPropagation(); 
            container.remove(); 
        }
    });
  }

  function drawTextAnnotation(annotation) {
    if (!ctx) return;
    const prevComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'source-over'; ctx.font = `${annotation.fontSize || 16}px sans-serif`;
    ctx.fillStyle = annotation.color; ctx.fillText(annotation.text, annotation.x, annotation.y);
    ctx.globalCompositeOperation = prevComposite;
  }

  function redrawCanvas() { textAnnotations.forEach(drawTextAnnotation); }

  function clearCanvas() {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    stickyNotes.forEach(note => note.remove()); stickyNotes = [];
    clearHighlights();
  }

  // === 荧光笔 ===
  function hexToRgba(hex, alpha) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function clearHighlights() {
      highlightSpans.forEach(span => {
          if (span && span.parentNode) {
              const parent = span.parentNode;
              while (span.firstChild) {
                  parent.insertBefore(span.firstChild, span);
              }
              parent.removeChild(span);
              parent.normalize();
          }
      });
      highlightSpans = [];
  }

  function highlightSelection(color) {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
      
      const range = selection.getRangeAt(0);
      const span = document.createElement('span');
      span.className = 'meow-highlight';
      span.style.backgroundColor = hexToRgba(color, 0.4);
      
      try {
          range.surroundContents(span);
      } catch (e) {
          try {
              const contents = range.extractContents();
              span.appendChild(contents);
              range.insertNode(span);
          } catch (e2) {
              showToast(meowI18n.t('anno_msg_highlight_fail'), 'error');
              return false;
          }
      }
      
      highlightSpans.push(span);
      saveHighlightState(span);
      selection.removeAllRanges();
      showToast(meowI18n.t('anno_msg_highlighted'), 'info');
      return true;
  }

  function handleHighlightMouseup(e) {
      if (currentTool !== 'highlighter') return;
      if (e.target && e.target.closest && e.target.closest('#meow-annotation-toolbar')) return;
      
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      
      const container = selection.getRangeAt(0).commonAncestorContainer;
      const toolbarEl = document.getElementById('meow-annotation-toolbar');
      if (toolbarEl && toolbarEl.contains(container)) {
          selection.removeAllRanges();
          return;
      }
      
      highlightSelection(brushColor);
  }

  function handleResize() {
    if (canvas) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      canvas.width = window.innerWidth; canvas.height = window.innerHeight;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.putImageData(imgData, 0, 0);
    }
  }

  function handleTouchStart(e) {
    e.preventDefault(); saveState();
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = e.touches[0].clientX - rect.left; lastY = e.touches[0].clientY - rect.top;
    if (currentTool === 'mosaic') drawMosaic(lastX, lastY);
  }

  function handleTouchMove(e) {
    e.preventDefault(); if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left; const y = e.touches[0].clientY - rect.top;
    if (currentTool === 'draw' || currentTool === 'eraser') {
        ctx.beginPath(); ctx.strokeStyle = brushColor; 
        ctx.lineWidth = (currentTool === 'eraser' ? brushSize * 2 : brushSize);
        ctx.moveTo(lastX, lastY); ctx.lineTo(x, y); ctx.stroke();
    } else if (currentTool === 'mosaic') drawMosaic(x, y);
    lastX = x; lastY = y;
  }

  async function captureFullPage() {
      const originalScrollY = window.scrollY; const originalOverflow = document.body.style.overflow;
      if (toolbar) toolbar.style.setProperty('display', 'none', 'important');
      if (canvas) canvas.style.setProperty('display', 'none', 'important');
      document.body.style.overflow = 'visible';
      try {
           await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ action: 'capture-visible-tab' }, (r) => {
                  if (chrome.runtime.lastError || !r || !r.dataUrl) reject(); else resolve(r.dataUrl);
              });
           });
           showToast(meowI18n.t('anno_msg_capture'), 'info');
      } catch (err) {
           showToast(meowI18n.t('anno_msg_capture_fail'), 'error');
      } 
      finally {
           window.scrollTo(0, originalScrollY); document.body.style.overflow = originalOverflow;
           if (toolbar) toolbar.style.removeProperty('display'); if (canvas) canvas.style.removeProperty('display');
      }
  }

  function saveAnnotation(callback) {
    if (!canvas) return;
    const stickyNotesData = stickyNotes.map(note => {
        const textarea = note.querySelector('textarea');
        return { x: parseInt(note.style.left), y: parseInt(note.style.top), width: parseInt(note.style.width), color: note.style.backgroundColor, text: textarea ? textarea.value : '' };
    });
    
    if (toolbar) toolbar.style.setProperty('display', 'none', 'important');
    document.body.classList.add('meow-printing');

    setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'capture-visible-tab' }, (response) => {
            if (toolbar) toolbar.style.removeProperty('display');
            document.body.classList.remove('meow-printing');
            if (!response || !response.dataUrl) { showToast(meowI18n.t('anno_msg_capture_fail'), 'error'); return; }

            const bgImage = new Image();
            bgImage.onload = () => {
                 const offCanvas = document.createElement('canvas'); offCanvas.width = canvas.width; offCanvas.height = canvas.height;
                 const offCtx = offCanvas.getContext('2d');
                 offCtx.drawImage(bgImage, 0, 0, canvas.width, canvas.height); offCtx.drawImage(canvas, 0, 0);
                 const annotationData = {
                   url: window.location.href, title: document.title || meowI18n.t('ph_title'), canvasData: canvas.toDataURL('image/png'), fullImage: offCanvas.toDataURL('image/png'),
                   textAnnotations: textAnnotations, stickyNotes: stickyNotesData, timestamp: Date.now(), date: new Date().toLocaleString()
                 };
                 const key = `annotation_${Date.now()}`; const data = {}; data[key] = annotationData;
                 chrome.storage.local.set(data, () => { showToast(meowI18n.t('anno_msg_saved'), 'success'); if (callback) callback(); });
            };
            bgImage.src = response.dataUrl;
        });
    }, 300);
  }

  function showToast(message, type = 'info') {
    const existing = document.querySelector('.meow-toast'); if (existing) existing.remove();
    const toast = document.createElement('div'); toast.className = `meow-toast meow-toast-${type}`; toast.textContent = message;
    document.body.appendChild(toast); setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2000);
  }

  function createStickyNote(x, y, text = '', color = null) {
    if (x === undefined) { x = Math.random() * (window.innerWidth - 220) + 10; y = Math.random() * (window.innerHeight - 200) + 50; }
    let bgColor = color || '#fff7b1';
    const note = document.createElement('div'); note.className = 'meow-sticky-note';
    note.style.left = x + 'px'; note.style.top = y + 'px'; note.style.backgroundColor = bgColor;
    
    const tDel = meowI18n.t('anno_sticky_del');
    const tPlace = meowI18n.t('anno_sticky_placeholder');

    note.innerHTML = `<div class="meow-sticky-note-header"><div class="meow-sticky-note-close" title="${tDel}">×</div></div><textarea class="meow-sticky-note-content" placeholder="${tPlace}">${text}</textarea>`;
    document.body.appendChild(note); stickyNotes.push(note);
    const textarea = note.querySelector('textarea'); if (!text) textarea.focus();
    note.querySelector('.meow-sticky-note-close').addEventListener('click', (e) => { e.stopPropagation(); note.remove(); stickyNotes = stickyNotes.filter(n => n !== note); });
    
    const header = note.querySelector('.meow-sticky-note-header');
    let isDragging = false; let startX, startY, initialLeft, initialTop;
    header.addEventListener('mousedown', (e) => {
        if (e.target.className.includes('close')) return;
        isDragging = true; startX = e.clientX; startY = e.clientY;
        const rect = note.getBoundingClientRect(); initialLeft = rect.left; initialTop = rect.top;
        note.style.zIndex = 2147483650;
        document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    });
    function onMove(e) { if (!isDragging) return; e.preventDefault(); note.style.left = (initialLeft + (e.clientX - startX)) + 'px'; note.style.top = (initialTop + (e.clientY - startY)) + 'px'; }
    function onUp() { if (isDragging) { isDragging = false; note.style.zIndex = ''; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); } }
  }

})();