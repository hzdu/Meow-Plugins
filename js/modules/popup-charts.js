// popup-charts.js - Big Calendar + 折线图报表 + 趋势Modal + 设置折叠
// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js

// === Big Calendar ===
const btnOpenBigCalendar = document.getElementById('btn-open-big-calendar');
if (btnOpenBigCalendar) {
    btnOpenBigCalendar.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('views/big-calendar.html') });
    });
}

// === 预支出摘要区域点击事件 ===
const peLeftSummaryClickable = document.getElementById('pre-expense-left-summary');
if (peLeftSummaryClickable) {
    peLeftSummaryClickable.style.cursor = 'pointer';
    peLeftSummaryClickable.addEventListener('click', () => {
        // 切换到财务规划功能面板
        const preExpensesBtn = document.querySelector('.tab-btn[data-tab="pre-expenses"]');
        if (preExpensesBtn) {
            preExpensesBtn.click();
        }
    });
}

// === 倒数日摘要区域点击事件 ===
const countdownSummaryClickable = document.getElementById('countdown-summary-card');
if (countdownSummaryClickable) {
    countdownSummaryClickable.style.cursor = 'pointer';
    countdownSummaryClickable.addEventListener('click', () => {
        // 切换到倒数日功能面板
        const countdownsBtn = document.querySelector('.tab-btn[data-tab="countdowns"]');
        if (countdownsBtn) {
            countdownsBtn.click();
        }
    });
}

// === 待办事项过滤按钮点击事件 ===
document.querySelectorAll('.task-stats .stat-badge').forEach(badge => {
    badge.style.cursor = 'pointer';
    badge.addEventListener('click', () => {
        const filter = badge.dataset.filter;
        if (filter) {
            todoFilter = filter;
            // 更新激活状态
            document.querySelectorAll('.task-stats .stat-badge').forEach(b => b.classList.remove('active'));
            badge.classList.add('active');
            renderListView();
        }
    });
});

// === 日期详情弹窗 ===
let dateDetailCurrentKey = ''; // 当前弹窗显示的日期
const dateDetailModal = document.getElementById('date-detail-modal');
const dateDetailClose = document.getElementById('date-detail-close');
const dateDetailTitle = document.getElementById('date-detail-title-text');
const dateDetailTodoList = document.getElementById('date-detail-todo-list');
const dateDetailFinanceList = document.getElementById('date-detail-finance-list');
const dateDetailPreExpenseList = document.getElementById('date-detail-pre-expense-list');

const openDateDetail = async (dateKey) => {
    if (!dateDetailModal) return;
    dateDetailCurrentKey = dateKey;

    // 停止上一次的语音朗读
    stopDateDetailTTS();

    // 清空 AI 总结内容
    const aiContent = document.getElementById('date-detail-ai-content');
    if (aiContent) {
        aiContent.innerHTML = '<div class="date-detail-ai-placeholder">点击✨按钮，由 AI 分析当日概况</div>';
    }
    
    // 解析日期
    const parts = dateKey.split('-');
    const y = parseInt(parts[0]), m = parseInt(parts[1]), d = parseInt(parts[2]);
    dateDetailTitle.textContent = `${y}年${m}月${d}日 详情`;
    
    // 加载待办事项
    const todoData = await getStorageData(dateKey);
    const todoItems = Array.isArray(todoData) ? todoData : [];
    dateDetailTodoList.innerHTML = '';
    if (todoItems.length === 0) {
        dateDetailTodoList.innerHTML = '<div class="date-detail-empty" data-i18n="todo_empty">无安排，享受生活！</div>';
    } else {
        todoItems.forEach(item => {
            const div = document.createElement('div');
            div.className = 'date-detail-item';
            const name = typeof item === 'string' ? item : (item.text || item.content || '');
            const done = item.done || item.completed || false;
            div.innerHTML = `<span class="item-name" style="${done ? 'text-decoration:line-through;color:#94a3b8;' : ''}">${done ? '✓ ' : ''}${escapeHtml(name)}</span>`;
            dateDetailTodoList.appendChild(div);
        });
    }
    
    // 加载财务数据
    const finData = await getStorageData(`fin_${dateKey}`);
    const finItems = Array.isArray(finData) ? finData : [];
    dateDetailFinanceList.innerHTML = '';
    if (finItems.length === 0) {
        dateDetailFinanceList.innerHTML = '<div class="date-detail-empty" data-i18n="finance_empty">暂无收支记录</div>';
    } else {
        finItems.forEach(item => {
            const val = parseFloat(item.amount) || 0;
            const isInc = item.type === 'income';
            const div = document.createElement('div');
            div.className = 'date-detail-item';
            const tagsHtml = item.tags ? item.tags.map(t => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.color};margin-right:4px;"></span>`).join('') : '';
            div.innerHTML = `
                <span class="item-name">${tagsHtml}${escapeHtml(item.note || '')}</span>
                <span class="item-amount ${isInc ? 'income' : 'expense'}">${isInc ? '+' : '-'}${val.toFixed(2)}</span>
            `;
            dateDetailFinanceList.appendChild(div);
        });
    }
    
    // 加载财务规划（每月重复项：当日的 recurDay 等于该日期；非重复项：全部展示）
    if (dateDetailPreExpenseList) {
        dateDetailPreExpenseList.innerHTML = '';
        const peItems = (Array.isArray(preExpensesList) ? preExpensesList : [])
            .filter(item => {
                if (!item.recurring) return false;
                const effectiveDay = getEffectiveRecurDay(item, y, m - 1);
                return effectiveDay === d;
            });
        if (peItems.length === 0) {
            dateDetailPreExpenseList.innerHTML = '<div class="date-detail-empty" data-i18n="pe_empty">该日暂无财务规划</div>';
        } else {
            peItems.forEach(item => {
                const val = parseFloat(item.amount) || 0;
                const isInc = item.type === 'income';
                const typeLabel = item.type === 'necessary' ? meowI18n.t('pre_necessary') : item.type === 'income' ? meowI18n.t('pre_income') : meowI18n.t('pre_unnecessary');
                const done = item.completed === true;
                const monthDone = item.enabled !== false;
                const doneBadge = monthDone ? '<span style="font-size:0.7rem;color:#16a34a;margin-left:4px;font-weight:600;">本月已完成</span>' : '';
                const div = document.createElement('div');
                div.className = 'date-detail-item';
                div.innerHTML = `
                    <span class="item-name" style="${done ? 'text-decoration:line-through;color:#94a3b8;' : ''}">
                        <span class="material-icons" style="font-size:12px;vertical-align:middle;color:#6366f1;margin-right:2px;">repeat</span>
                        ${escapeHtml(item.name || '')}
                        <span style="font-size:0.7rem;color:#94a3b8;margin-left:4px;">${typeLabel}</span>
                        ${doneBadge}
                    </span>
                    <span class="item-amount ${isInc ? 'income' : 'expense'}">${isInc ? '+' : '-'}${val.toFixed(2)}</span>
                `;
                dateDetailPreExpenseList.appendChild(div);
            });
        }
    }
    
    // 显示弹窗
    dateDetailModal.classList.remove('hidden');
    dateDetailModal.classList.add('visible');
};

const closeDateDetail = () => {
    if (!dateDetailModal) return;
    dateDetailModal.classList.remove('visible');
    dateDetailModal.classList.add('hidden');
    // 关闭弹窗时停止语音朗读
    stopDateDetailTTS();
};

// 日期详情右侧 section 折叠/展开
document.addEventListener('click', (e) => {
    const header = e.target.closest('.date-detail-section-header');
    if (!header) return;
    const section = header.closest('.date-detail-section');
    if (!section) return;
    section.classList.toggle('collapsed');
});

if (dateDetailClose) {
    dateDetailClose.addEventListener('click', closeDateDetail);
}
if (dateDetailModal) {
    dateDetailModal.addEventListener('click', (e) => {
        if (e.target === dateDetailModal) closeDateDetail();
    });
}

// 左侧栏展开收起
const dateDetailLeftToggle = document.getElementById('date-detail-left-toggle');
const dateDetailLeft = document.getElementById('date-detail-left');
if (dateDetailLeftToggle && dateDetailLeft) {
    dateDetailLeftToggle.addEventListener('click', () => {
        const isCollapsed = dateDetailLeft.classList.toggle('collapsed');
        dateDetailLeftToggle.textContent = isCollapsed ? 'chevron_right' : 'chevron_left';
    });
}

// === 语音朗读（TTS）===
const dateDetailTtsToggle = document.getElementById('date-detail-tts-toggle');
const dateDetailTtsBar = document.getElementById('date-detail-tts-bar');
let dateDetailTtsEnabled = true; // 默认开启
let dateDetailTtsVoices = [];
let dateDetailTtsSelectedVoice = null;

/** 加载并缓存可用的语音列表，优先选择台湾女声 */
function loadDateDetailTtsVoices() {
    if (!('speechSynthesis' in window)) return;
    dateDetailTtsVoices = window.speechSynthesis.getVoices();
    if (dateDetailTtsVoices.length === 0) return;

    // 优先选择台湾女声：lang=zh-TW 且名字含女性特征
    const femaleNameHints = ['chen', 'hsiao', 'yaoyao', 'yating', 'female', 'wan', 'mei', 'ling', 'han', 'jia', 'su'];
    const twFemale = dateDetailTtsVoices.find(v =>
        /zh-TW/i.test(v.lang) &&
        femaleNameHints.some(h => v.name.toLowerCase().includes(h))
    );
    if (twFemale) {
        dateDetailTtsSelectedVoice = twFemale;
        return;
    }

    // 其次：任意台湾中文女声
    const twFemaleAny = dateDetailTtsVoices.find(v =>
        /zh-TW/i.test(v.lang)
    );
    if (twFemaleAny) {
        dateDetailTtsSelectedVoice = twFemaleAny;
        return;
    }

    // 再次：台湾繁体女声（部分浏览器 lang 可能是 zh_TW）
    const twAlt = dateDetailTtsVoices.find(v => /zh[-_]TW/i.test(v.lang));
    if (twAlt) {
        dateDetailTtsSelectedVoice = twAlt;
        return;
    }

    // 最后兜底：任意中文女声
    const anyZhFemale = dateDetailTtsVoices.find(v =>
        /^zh/i.test(v.lang) &&
        femaleNameHints.some(h => v.name.toLowerCase().includes(h))
    );
    if (anyZhFemale) {
        dateDetailTtsSelectedVoice = anyZhFemale;
        return;
    }

    // 最终兜底：任意中文语音
    const anyZh = dateDetailTtsVoices.find(v => /^zh/i.test(v.lang));
    if (anyZh) {
        dateDetailTtsSelectedVoice = anyZh;
    }
}

/** 使用台湾女声朗读文本 */
function speakDateDetailTTS(text) {
    if (!('speechSynthesis' in window)) return;
    // 先取消正在进行的朗读
    window.speechSynthesis.cancel();

    if (!dateDetailTtsEnabled || !text || !text.trim()) return;

    // 如果语音列表还未加载，尝试加载
    if (dateDetailTtsVoices.length === 0) {
        loadDateDetailTtsVoices();
    }

    const utter = new SpeechSynthesisUtterance(text);
    if (dateDetailTtsSelectedVoice) {
        utter.voice = dateDetailTtsSelectedVoice;
        utter.lang = dateDetailTtsSelectedVoice.lang;
    } else {
        utter.lang = 'zh-TW';
    }
    // 温柔语调：稍慢语速、略高音调
    utter.rate = 0.9;
    utter.pitch = 1.15;
    utter.volume = 1;

    utter.onstart = () => {
        if (dateDetailTtsBar) dateDetailTtsBar.classList.add('speaking');
    };
    utter.onend = () => {
        if (dateDetailTtsBar) dateDetailTtsBar.classList.remove('speaking');
    };
    utter.onerror = () => {
        if (dateDetailTtsBar) dateDetailTtsBar.classList.remove('speaking');
    };

    window.speechSynthesis.speak(utter);
}

/** 停止语音朗读 */
function stopDateDetailTTS() {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    if (dateDetailTtsBar) dateDetailTtsBar.classList.remove('speaking');
}

// 语音列表可能在页面加载后异步加载
if ('speechSynthesis' in window) {
    loadDateDetailTtsVoices();
    window.speechSynthesis.onvoiceschanged = loadDateDetailTtsVoices;
}

// 开关事件
if (dateDetailTtsToggle) {
    dateDetailTtsToggle.addEventListener('change', () => {
        dateDetailTtsEnabled = dateDetailTtsToggle.checked;
        if (!dateDetailTtsEnabled) {
            stopDateDetailTTS();
        }
    });
}

// AI 总结按钮
const dateDetailAiBtn = document.getElementById('date-detail-ai-btn');
const dateDetailAiContent = document.getElementById('date-detail-ai-content');

async function fetchDateDetailAISummary() {
    // 从 AI Setting 获取配置
    let baseUrl = '', modelId = '', apiKey = '';

    const aiConfig = await chrome.storage.local.get(['meow_ai_setting']);
    const setting = aiConfig.meow_ai_setting || {};
    baseUrl = (setting.baseUrl || '').replace(/\/+$/, '');
    modelId = setting.modelId || '';
    apiKey = setting.apiKey || '';

    // 自动补充协议地址
    if (setting.autoProtocol !== false && !baseUrl) {
        baseUrl = 'https://api.openai.com';
    }

    if (!baseUrl || !apiKey) {
        throw new Error('请先在「设置-AI Setting」中配置接口信息');
    }
    if (!modelId) {
        throw new Error('请先在「设置-AI Setting」中配置 Model ID');
    }

    // 收集当天数据
    const todoData = await getStorageData(dateDetailCurrentKey);
    const todoItems = Array.isArray(todoData) ? todoData : [];
    const finData = await getStorageData(`fin_${dateDetailCurrentKey}`);
    const finItems = Array.isArray(finData) ? finData : [];

    // 收集当天财务规划（每月重复项）
    const peParts = dateDetailCurrentKey.split('-');
    const peDay = parseInt(peParts[2]);
    const peYear = parseInt(peParts[0]);
    const peMonth = parseInt(peParts[1]) - 1;
    const peItems = (Array.isArray(preExpensesList) ? preExpensesList : [])
        .filter(item => {
            if (!item.recurring || item.enabled === false) return false;
            const effectiveDay = getEffectiveRecurDay(item, peYear, peMonth);
            return effectiveDay === peDay;
        });

    // 读取固定资产 AI 开关，开启时收集固定资产数据
    let assetsData = null;
    const aiAssetsFlag = await getStorageData('meow_assets_ai_enabled');
    if (aiAssetsFlag === true) {
        assetsData = await getStorageData('meow_assets');
        if (!Array.isArray(assetsData) || assetsData.length === 0) {
            assetsData = null;
        }
    }

    const lang = window.meowI18n ? (meowI18n.lang || 'zh-CN') : 'zh-CN';
    const prompt = dateDetailPrompt(dateDetailCurrentKey, todoItems, finItems, lang, peItems, assetsData);

    let apiUrl;
    const trimmedUrl = baseUrl.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(trimmedUrl)) {
        apiUrl = trimmedUrl;
    } else if (/\/v1$/i.test(trimmedUrl)) {
        apiUrl = `${trimmedUrl}/chat/completions`;
    } else {
        apiUrl = `${trimmedUrl}/v1/chat/completions`;
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1024,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`API 请求失败 (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'AI 返回内容为空';
}

if (dateDetailAiBtn && dateDetailAiContent) {
    dateDetailAiBtn.addEventListener('click', async () => {
        if (!dateDetailCurrentKey) return;
        dateDetailAiBtn.classList.add('loading');
        // 开始新的 AI 请求时停止正在进行的朗读
        stopDateDetailTTS();
        dateDetailAiContent.innerHTML = '<div style="text-align:center;padding:20px 0;color:#94a3b8;">AI 分析中...</div>';
        try {
            const result = await fetchDateDetailAISummary();
            dateDetailAiContent.innerHTML = '';
            const textDiv = document.createElement('div');
            textDiv.style.whiteSpace = 'pre-wrap';
            textDiv.textContent = result;
            dateDetailAiContent.appendChild(textDiv);
            // AI 分析结果返回后，触发语音朗读
            speakDateDetailTTS(result);
        } catch (e) {
            dateDetailAiContent.innerHTML = `<div style="color:#ef4444;padding:8px;">${escapeHtml(e.message || '请求失败')}</div>`;
            // AI 未配置时弹出漂亮的配置提示
            if (e.message && (e.message.includes('AI Setting') || e.message.includes('请先'))) {
                showAIConfigPrompt();
            }
        } finally {
            dateDetailAiBtn.classList.remove('loading');
        }
    });
}

// === 本月收支折线图报表 ===
const financeChartModal = document.getElementById('finance-chart-modal');
const openFinanceChartBtn = document.getElementById('open-finance-chart-btn');
const chartCloseX = document.getElementById('chart-close-x');
// 详情侧边栏相关元素
const chartDetailPanel = document.getElementById('chart-detail-panel');
const detailPanelDate = document.getElementById('detail-panel-date');
const detailPanelClose = document.getElementById('detail-panel-close');
const detailListContainer = document.getElementById('detail-list-container');

// 图表状态
let chartState = {
    data: null, // { days: [], income: [], expense: [] }
    scale: 1,   // 缩放比例
    offsetX: 0, // X轴偏移
    isDragging: false,
    isRightDragging: false,
    lastX: 0,
    hoverIndex: -1, // 当前悬停的数据索引
    width: 0,
    height: 0,
    ctx: null,
    canvas: null,
    padLeft: 50,
    padRight: 20,
    padTop: 40, // 增加顶部空间给 Tooltip
    padBottom: 30
};

const initChartData = async () => {
    const allData = await new Promise(r => chrome.storage.sync.get(null, items => r(items || {})));
    const lastDateOfMonth = new Date(currYear, currMonth + 1, 0).getDate();

    const dailyIncome = new Array(lastDateOfMonth).fill(0);
    const dailyExpense = new Array(lastDateOfMonth).fill(0);
    const days = Array.from({length: lastDateOfMonth}, (_, i) => i + 1);
    let totalIncome = 0, totalExpense = 0;

    for (let i = 1; i <= lastDateOfMonth; i++) {
        const dateKey = `fin_${currYear}-${currMonth + 1}-${i}`;
        const finData = allData[dateKey];
        if (Array.isArray(finData)) {
            finData.forEach(item => {
                const val = parseFloat(item.amount) || 0;
                if (item.type === 'income') {
                    dailyIncome[i - 1] += val;
                    totalIncome += val;
                } else {
                    dailyExpense[i - 1] += val;
                    totalExpense += val;
                }
            });
        }
    }

    return {
        days,
        income: dailyIncome,
        expense: dailyExpense,
        totalIncome,
        totalExpense
    };
};

// 显示侧边详情栏
const showDetailPanel = async (dayIndex) => {
    if (!chartDetailPanel || !detailListContainer) return;
    
    // 1. 获取该日详细数据
    const dateKey = `fin_${currYear}-${currMonth + 1}-${dayIndex + 1}`;
    const data = await getStorageData(dateKey);
    const finList = Array.isArray(data) ? data : [];

    // 2. 更新标题和列表
    detailPanelDate.innerText = `${currMonth + 1}月${dayIndex + 1}日 账本`;
    detailListContainer.innerHTML = "";

    if (finList.length === 0) {
        detailListContainer.innerHTML = `<div class="empty-detail-tip">暂无收支记录</div>`;
    } else {
        finList.forEach(item => {
            const val = parseFloat(item.amount).toFixed(2);
            const isInc = item.type === 'income';
            
            const div = document.createElement('div');
            div.className = 'detail-item';
            div.innerHTML = `
                <div class="detail-row-top">
                    <span class="detail-note" title="${escapeHtml(item.note)}">${escapeHtml(item.note || '无备注')}</span>
                    <span class="detail-amount ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}${val}</span>
                </div>
                <div class="detail-row-bottom">
                    ${isInc ? '收入' : '支出'}
                </div>
            `;
            detailListContainer.appendChild(div);
        });
    }

    chartDetailPanel.classList.remove('hidden');
    chartDetailPanel.classList.add('visible');
};

// 隐藏侧边详情栏
const hideDetailPanel = () => {
    if (!chartDetailPanel) return;
    chartDetailPanel.classList.remove('visible');
    chartDetailPanel.classList.add('hidden');
};

const renderChart = () => {
    const { ctx, width, height, data, scale, offsetX, padLeft, padRight, padTop, padBottom, hoverIndex } = chartState;
    if (!ctx || !data) return;

    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;
    const totalDays = data.days.length;

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    // 计算 Y 轴范围
    const allValues = [...data.income, ...data.expense];
    let maxVal = Math.max(...allValues, 1);
    const niceStep = (v) => { // 辅助函数：计算合适的刻度步长
        const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
        const d = v / p;
        if (d < 1.5) return p / 5; // e.g. 12 -> 2
        if (d < 3.5) return p / 2; // e.g. 30 -> 10
        return p;                // e.g. 80 -> 10
    };
    // 简化的步长计算
    let step = niceStep(maxVal);
    if (step < 1) step = 1;
    // 调整 step 以保证刻度数量适中 (3-6个)
    if (maxVal / step > 6) step *= 2;
    if (maxVal / step < 3) step /= 2;
    
    // 重新计算精确的最大值
    maxVal = Math.ceil(maxVal / step) * step;
    if (maxVal === 0) maxVal = 10;

    // 坐标转换函数
    // 基础间距：在 scale=1 时，正好放满
    // zoomCenter 逻辑：缩放时基于当前可视中心或鼠标位置（简化起见，这里实现基于中心缩放或左侧）
    // 这里实现简单的线性映射：x = padLeft + offsetX + (i * stepX * scale)
    const baseStepX = chartW / (totalDays - 1 > 0 ? totalDays - 1 : 1);
    const toX = (i) => padLeft + offsetX + (i * baseStepX * scale);
    const toY = (v) => padTop + chartH - (v / maxVal) * chartH;

    // 绘制裁剪区域 (用于曲线和X轴)
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, 0, chartW, height);
    ctx.clip();

    // 绘制网格线 (水平) - 不受 X 轴缩放影响，全宽绘制
    ctx.restore(); // 恢复裁剪，因为网格线要画全
    ctx.save();
    
    // Y 轴网格和标签
    const gridCount = Math.floor(maxVal / step);
    for (let i = 0; i <= gridCount; i++) {
        const val = i * step;
        const y = toY(val);
        
        ctx.strokeStyle = '#f3f4f6';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();

        ctx.fillStyle = '#9ca3af';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(Number(val).toLocaleString(), padLeft - 8, y);
    }

    // 重新应用裁剪区域绘制折线和X轴
    ctx.beginPath();
    ctx.rect(padLeft, 0, chartW, height);
    ctx.clip();

    // X 轴标签
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // 动态计算标签间隔：防止文字重叠
    // 每个标签大约占 20px 宽
    const checkStepX = baseStepX * scale;
    const labelInterval = Math.ceil(20 / checkStepX);

    for (let i = 0; i < totalDays; i++) {
        const x = toX(i);
        // 只绘制在视图内的标签
        if (x < padLeft - 10 || x > width - padRight + 10) continue;

        if (i === 0 || i === totalDays - 1 || (i + 1) % labelInterval === 0) {
            ctx.fillText(`${i + 1}`, x, height - padBottom + 8);
        }
    }

    // 绘制曲线函数
    const drawCurve = (dataArr, color, bgTop, bgBottom) => {
        if (totalDays < 1) return;
        ctx.save();
        
        // 1. 填充区域
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(dataArr[0]));
        for (let i = 0; i < totalDays - 1; i++) {
            const xCurrent = toX(i);
            const yCurrent = toY(dataArr[i]);
            const xNext = toX(i + 1);
            const yNext = toY(dataArr[i+1]);
            const cpX = (xCurrent + xNext) / 2;
            
            // 简单的贝塞尔插值
            ctx.bezierCurveTo(cpX, yCurrent, cpX, yNext, xNext, yNext);
        }
        ctx.lineTo(toX(totalDays - 1), toY(0)); // 下右角
        ctx.lineTo(toX(0), toY(0)); // 下左角
        ctx.closePath();
        
        const grad = ctx.createLinearGradient(0, padTop, 0, height - padBottom);
        grad.addColorStop(0, bgTop);
        grad.addColorStop(1, bgBottom);
        ctx.fillStyle = grad;
        ctx.fill();

        // 2. 线条
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(dataArr[0]));
        for (let i = 0; i < totalDays - 1; i++) {
            const xCurrent = toX(i);
            const yCurrent = toY(dataArr[i]);
            const xNext = toX(i + 1);
            const yNext = toY(dataArr[i+1]);
            const cpX = (xCurrent + xNext) / 2;
            ctx.bezierCurveTo(cpX, yCurrent, cpX, yNext, xNext, yNext);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.restore();
    };

    drawCurve(data.income, '#10b981', 'rgba(16,185,129,0.2)', 'rgba(16,185,129,0.0)');
    drawCurve(data.expense, '#ef4444', 'rgba(239,68,68,0.2)', 'rgba(239,68,68,0.0)');

    // 绘制数据点 (仅在点较少或 Hover 时)
    // 如果点太密，就不画圆点了，除非 hover
    const showPoints = checkStepX > 10;
    
    const drawPoints = (dataArr, color) => {
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        
        for (let i = 0; i < totalDays; i++) {
            const x = toX(i);
            if (x < padLeft || x > width - padRight) continue;
            
            // 只有每隔一定间隔才画点，或者全部画
            // 这里简单处理：如果间距够大或者是 hover点
            if (showPoints || i === hoverIndex) {
                 // 不画 0 值点，除非是 hover
                if (dataArr[i] === 0 && i !== hoverIndex) continue;

                const y = toY(dataArr[i]);
                ctx.beginPath();
                // Hover 的点画大一点
                const radius = (i === hoverIndex) ? 5 : 3;
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }
        ctx.restore();
    };

    drawPoints(data.income, '#10b981');
    drawPoints(data.expense, '#ef4444');

    ctx.restore(); // 结束裁剪区域

    // 绘制 Hover Tooltip
    if (hoverIndex >= 0 && hoverIndex < totalDays) {
        const x = toX(hoverIndex);
        // 确保 tooltip 在视图内
        if (x >= padLeft && x <= width - padRight) {
            // 绘制垂直指示线
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, padTop);
            ctx.lineTo(x, height - padBottom);
            ctx.strokeStyle = 'rgba(156, 163, 175, 0.4)';
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.restore();

            // Tooltip 框
            const incVal = data.income[hoverIndex];
            const expVal = data.expense[hoverIndex];
            const dayStr = `${hoverIndex + 1}日`;

            // Tooltip 内容
            const textPadding = 8;
            const lineHeight = 16;
            ctx.font = 'bold 12px system-ui';
            const titleWidth = ctx.measureText(dayStr).width;
            ctx.font = '12px system-ui';
            const incText = `收: +${incVal.toFixed(2)}`;
            const expText = `支: -${expVal.toFixed(2)}`;
            const incWidth = ctx.measureText(incText).width;
            const expWidth = ctx.measureText(expText).width;
            
            const boxWidth = Math.max(titleWidth, incWidth, expWidth) + textPadding * 2;
            const boxHeight = textPadding * 2 + lineHeight * 3 + 4; // 3 lines

            // 智能定位：尽量不遮挡数据，优先在上部，偏左或偏右
            let boxX = x + 10; 
            let boxY = padTop + 10;
            // 边界检查
            if (boxX + boxWidth > width - padRight) {
                boxX = x - 10 - boxWidth;
            }

            // 画背景
            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 6);
            ctx.fill();
            
            // 画文字
            ctx.fillStyle = '#374151'; // Title color
            ctx.font = 'bold 12px system-ui';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(dayStr, boxX + textPadding, boxY + textPadding);

            ctx.font = '12px system-ui'; // Reset font
            // Income
            ctx.fillStyle = '#10b981';
            ctx.fillText(incText, boxX + textPadding, boxY + textPadding + lineHeight + 2);
            // Expense
            ctx.fillStyle = '#ef4444';
            ctx.fillText(expText, boxX + textPadding, boxY + textPadding + lineHeight * 2 + 4);

            ctx.restore();
        }
    }
};

const openFinanceChart = async () => {
    if (!financeChartModal) return;

    // 1. 获取并处理数据
    chartState.data = await initChartData();

    // 更新标题
    const titleText = document.getElementById('chart-modal-title-text');
    if (titleText) titleText.textContent = `${currYear}年${currMonth + 1}月 每日收支报表`;

    // 更新汇总栏
    const summaryBar = document.getElementById('chart-summary-bar');
    if (summaryBar) {
        const { totalIncome, totalExpense } = chartState.data;
        const balance = totalIncome - totalExpense;
        summaryBar.innerHTML = `
            <div class="chart-summary-item"><span class="label">总收入</span><span class="value inc">¥${totalIncome.toFixed(2)}</span></div>
            <div class="chart-summary-item"><span class="label">总支出</span><span class="value exp">¥${totalExpense.toFixed(2)}</span></div>
            <div class="chart-summary-item"><span class="label">结余</span><span class="value bal">¥${balance.toFixed(2)}</span></div>
        `;
    }

    // 2. 初始化 Canvas
    const canvas = document.getElementById('finance-chart-canvas');
    if (!canvas) return;
    chartState.canvas = canvas;
    chartState.ctx = canvas.getContext('2d');

    // 动态调整画布尺寸以填充容器（定义在外部作用域，便于按钮回调用）
    function resizeFinanceChart() {
        // 先让 CSS 渲染好实际显示尺寸
        const dpr = window.devicePixelRatio || 1;
        // 读取 CSS 渲染后的实际显示宽高（由 CSS width:100% 控制，不含 padding 干扰）
        const displayW = canvas.clientWidth;
        const displayH = canvas.clientHeight;
        if (displayW < 100 || displayH < 50) return;
        const logicW = Math.floor(displayW);
        const logicH = Math.floor(displayH);
        
        // 仅更新绘图缓冲区尺寸，不修改 style.width/style.height（由 CSS 控制）
        canvas.width = logicW * dpr;
        canvas.height = logicH * dpr;
        
        chartState.width = logicW;
        chartState.height = logicH;
        chartState.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        
        clampOffset();
        renderChart();
    }
    
    // 监听器只需绑定一次，这里做一个标记防止重复绑定
    if (!canvas.dataset.hasListeners) {
        // 滚轮缩放
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = -Math.sign(e.deltaY) * 0.1;
            const newScale = Math.max(1, Math.min(10, chartState.scale + delta));
            
            // 以鼠标位置为中心缩放
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const chartW = chartState.width - chartState.padLeft - chartState.padRight;
            const totalDays = chartState.data ? chartState.data.days.length : 1;
            const baseStepX = chartW / (totalDays - 1 > 0 ? totalDays - 1 : 1);
            // 鼠标所在数据索引
            const ratio = (mouseX - chartState.padLeft - chartState.offsetX) / (baseStepX * chartState.scale * (totalDays - 1 > 0 ? totalDays - 1 : 1));
            
            chartState.scale = newScale;
            // 缩放后调整 offsetX 使鼠标所在位置尽量不变
            const newChartW = chartState.width - chartState.padLeft - chartState.padRight;
            const newBaseStepX = newChartW / (totalDays - 1 > 0 ? totalDays - 1 : 1);
            chartState.offsetX = mouseX - chartState.padLeft - ratio * newBaseStepX * chartState.scale * (totalDays - 1 > 0 ? totalDays - 1 : 1);
            clampOffset();
            renderChart();
        }, { passive: false });

        // 鼠标移动 (Hover + Drag)
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const { padLeft, padRight, width, scale, offsetX } = chartState;
            const totalDays = chartState.data.days.length;
            // 使用 canvas 当前实际渲染宽度计算，避免 chartState.width 因过渡动画未完成而过期
            const actualWidth = canvas.clientWidth || width;
            const actualChartW = actualWidth - padLeft - padRight;
            const baseStepX = actualChartW / (totalDays - 1 > 0 ? totalDays - 1 : 1);
            
            // 遍历所有天数，找到离鼠标最近的 toX 位置 (与 renderChart 公式一致)
            let bestIndex = 0;
            let bestDist = Infinity;
            for (let i = 0; i < totalDays; i++) {
                const px = padLeft + offsetX + i * baseStepX * scale;
                const dist = Math.abs(x - px);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIndex = i;
                }
            }
            let index = bestIndex;
            
            // 检查鼠标是否在有效绘制区内
            if (x >= padLeft && x <= actualWidth - padRight && y >= chartState.padTop && y <= chartState.height - chartState.padBottom) {
                 chartState.hoverIndex = index;
                 canvas.style.cursor = chartState.isRightDragging ? 'grabbing' : 'pointer';
            } else {
                 chartState.hoverIndex = -1;
                 canvas.style.cursor = chartState.isRightDragging ? 'grabbing' : 'default';
            }
            
            // 右键拖拽逻辑 (当 Scale > 1 时)
            if (chartState.isRightDragging && chartState.scale > 1) {
                const dx = x - chartState.lastX;
                chartState.offsetX += dx;
                clampOffset();
                canvas.style.cursor = 'grabbing';
            }
            
            chartState.lastX = x;
            renderChart();
        });

        canvas.addEventListener('mousedown', (e) => {
            // 右键按下开始拖拽
            if (e.button === 2 && chartState.scale > 1) {
                chartState.isRightDragging = true;
                const rect = canvas.getBoundingClientRect();
                chartState.lastX = e.clientX - rect.left;
                canvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });

        canvas.addEventListener('mouseup', (e) => {
            if (e.button === 2) {
                chartState.isRightDragging = false;
                canvas.style.cursor = 'default';
            }
        });

        canvas.addEventListener('mouseleave', () => {
             chartState.isRightDragging = false;
             chartState.hoverIndex = -1;
             renderChart();
        });
        
        // 点击事件：展示详情（仅左键，且非拖拽）
        canvas.addEventListener('click', (e) => {
            if (chartState.isRightDragging) return;
            if (chartState.hoverIndex >= 0) {
                 showDetailPanel(chartState.hoverIndex);
            } else {
                 hideDetailPanel();
            }
        });

        // 阻止右键菜单
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        canvas.dataset.hasListeners = "true";
    }

    // 重置视图
    chartState.scale = 1;
    chartState.offsetX = 0;
    hideDetailPanel();

    // 清空 AI 总结内容区
    const summaryContent = document.getElementById('finance-ai-summary-content');
    if (summaryContent) {
        summaryContent.innerHTML = '<div class="finance-ai-summary-placeholder">点击「总结」按钮，由 AI 分析本月财务状况</div>';
    }
    
    // 显示 Modal（必须在 resize 之前，确保容器可见以获取正确尺寸）
    financeChartModal.classList.remove('hidden');
    financeChartModal.classList.add('visible');

    // 动态调整画布尺寸以填充容器
    resizeFinanceChart();

    // 绑定 AI 总结按钮（防止重复绑定）
    const summaryBtn = document.getElementById('finance-ai-summary-btn');
    if (summaryBtn && !summaryBtn.dataset.hasListener) {
        summaryBtn.dataset.hasListener = 'true';
        summaryBtn.addEventListener('click', async function() {
            if (this.classList.contains('loading')) return;
            const contentEl = document.getElementById('finance-ai-summary-content');
            if (!contentEl) return;

            // 显示加载状态
            contentEl.innerHTML = '<div class="finance-ai-summary-loading"><span class="material-icons">autorenew</span> AI 分析中...</div>';
            this.classList.add('loading');

            try {
                const result = await fetchFinanceAISummary();
                contentEl.innerHTML = '';
                const textDiv = document.createElement('div');
                textDiv.style.whiteSpace = 'pre-wrap';
                textDiv.style.wordBreak = 'break-word';
                textDiv.textContent = result;
                contentEl.appendChild(textDiv);
            } catch (e) {
                contentEl.innerHTML = `<div class="finance-ai-summary-error">${escapeHtml(e.message || '请求失败')}</div>`;
                // AI 未配置时弹出漂亮的配置提示
                if (e.message && (e.message.includes('AI Setting') || e.message.includes('请先'))) {
                    showAIConfigPrompt();
                }
            } finally {
                this.classList.remove('loading');
            }
        });
    }

    // 绑定左栏收起/展开按钮
    const toggleBtn = document.getElementById('finance-chart-left-toggle');
    const leftPanel = document.getElementById('finance-chart-left-panel');
    if (toggleBtn && leftPanel && !toggleBtn.dataset.hasListener) {
        toggleBtn.dataset.hasListener = 'true';
        toggleBtn.addEventListener('click', function() {
            leftPanel.classList.toggle('collapsed');
            const isCollapsed = leftPanel.classList.contains('collapsed');
            this.textContent = isCollapsed ? 'chevron_right' : 'chevron_left';
            // 等待 CSS 过渡动画完成后自适应图表宽度
            setTimeout(function() {
                if (typeof resizeFinanceChart === 'function') {
                    resizeFinanceChart();
                }
            }, 350);
        });
    }
};

// 获取本月财务数据（含备注）并调用 AI 总结
async function fetchFinanceAISummary() {
    // 1. 从 AI Setting 获取配置
    let baseUrl = '', modelId = '', apiKey = '';

    const aiConfig = await chrome.storage.local.get(['meow_ai_setting']);
    const setting = aiConfig.meow_ai_setting || {};
    baseUrl = (setting.baseUrl || '').replace(/\/+$/, '');
    modelId = setting.modelId || '';
    apiKey = setting.apiKey || '';

    // 自动补充协议地址
    if (setting.autoProtocol !== false && !baseUrl) {
        baseUrl = 'https://api.openai.com';
    }

    if (!baseUrl || !apiKey) {
        throw new Error('请先在「设置-AI Setting」中配置接口信息');
    }
    if (!modelId) {
        throw new Error('请先在「设置-AI Setting」中配置 Model ID');
    }

    // 2. 收集本月财务数据
    const lastDate = new Date(currYear, currMonth + 1, 0).getDate();
    const allItems = [];

    const allData = await new Promise(r => chrome.storage.sync.get(null, items => r(items || {})));
    for (let d = 1; d <= lastDate; d++) {
        const dateKey = `fin_${currYear}-${currMonth + 1}-${d}`;
        const dayData = allData[dateKey];
        if (Array.isArray(dayData) && dayData.length > 0) {
            dayData.forEach(item => {
                if (item.amount && parseFloat(item.amount) !== 0) {
                    allItems.push({
                        date: `${currYear}-${currMonth + 1}-${d}`,
                        type: item.type || 'expense',
                        amount: parseFloat(item.amount),
                        note: item.note || ''
                    });
                }
            });
        }
    }

    const totalIncome = allItems.filter(i => i.type === 'income').reduce((s, i) => s + i.amount, 0);
    const totalExpense = allItems.filter(i => i.type === 'expense').reduce((s, i) => s + i.amount, 0);

    // 读取固定资产 AI 开关，开启时收集固定资产数据
    let assetsData = null;
    if (allData['meow_assets_ai_enabled'] === true) {
        const rawAssets = allData['meow_assets'];
        if (Array.isArray(rawAssets) && rawAssets.length > 0) {
            assetsData = rawAssets;
        }
    }

    // 3. 构造请求
    const lang = window.meowI18n ? (meowI18n.lang || 'zh-CN') : 'zh-CN';

    const prompt = AI_PROMPTS.financeSummary(currYear, currMonth, allItems, totalIncome, totalExpense, lang, assetsData);

    let apiUrl;
    const trimmedUrl = baseUrl.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(trimmedUrl)) {
        apiUrl = trimmedUrl;
    } else if (/\/v1$/i.test(trimmedUrl)) {
        apiUrl = `${trimmedUrl}/chat/completions`;
    } else {
        apiUrl = `${trimmedUrl}/v1/chat/completions`;
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: modelId,
            messages: [
                { role: 'user', content: prompt }
            ],
            max_tokens: 2048,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`API 请求失败 (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || 'AI 返回内容为空';
    return content;
}

// 限制 OffsetX 范围，不让图表移出视野太远
const clampOffset = () => {
    const { width, padLeft, padRight, scale, data } = chartState;
    if (!data) return;
    const chartW = width - padLeft - padRight;
    const totalDays = data.days.length;
    const baseStepX = chartW / (totalDays - 1 > 0 ? totalDays - 1 : 1);
    const contentWidth = baseStepX * scale * (totalDays - 1);
    
    // 内容比视图窄，居中或靠左
    if (contentWidth <= chartW) {
        chartState.offsetX = 0; // 简单处理：不许动
    } else {
        // 内容比视图宽
        // minOffset: 让最右边只能到达右边界
        // maxOffset: 0 (让最左边只能到达左边界)
        const minOffset = chartW - contentWidth;
        const maxOffset = 0;
        
        if (chartState.offsetX > maxOffset) chartState.offsetX = maxOffset;
        if (chartState.offsetX < minOffset) chartState.offsetX = minOffset;
    }
};

// 关闭图表 Modal
const closeFinanceChart = () => {
    if (!financeChartModal) return;
    financeChartModal.classList.remove('visible');
    financeChartModal.classList.add('hidden');
    chartState.data = null; // 清理数据
};

if (openFinanceChartBtn) {
    openFinanceChartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFinanceChart();
    });
}
if (chartCloseX) {
    chartCloseX.addEventListener('click', closeFinanceChart);
}
if (financeChartModal) {
    financeChartModal.addEventListener('click', (e) => {
    if (e.target === financeChartModal) closeFinanceChart();
    });
}
if (detailPanelClose) {
    detailPanelClose.addEventListener('click', hideDetailPanel);
}

// === 本月戒烟折线图报表逻辑 ===
const smokingChartModal = document.getElementById('smoking-chart-modal');
const openSmokingChartBtn = document.getElementById('btn-open-smoking-chart');
const smokingChartCloseX = document.getElementById('smoking-chart-close-x');
// 详情侧边栏相关元素
const smokingDetailPanel = document.getElementById('smoking-detail-panel');
const smokingDetailDate = document.getElementById('smoking-detail-date');
const smokingDetailClose = document.getElementById('smoking-detail-close');
const smokingDetailListContainer = document.getElementById('smoking-detail-list');

// 图表状态
let smokingChartState = {
    data: null, // { days: [], counts: [] }
    scale: 1,   // 缩放比例
    offsetX: 0, // X轴偏移
    isDragging: false,
    lastX: 0,
    hoverIndex: -1, // 当前悬停的数据索引
    width: 0,
    height: 0,
    ctx: null,
    canvas: null,
    padLeft: 40,
    padRight: 20,
    padTop: 40,
    padBottom: 30
};

const initSmokingChartData = async () => {
    const allData = await new Promise(r => chrome.storage.sync.get(null, items => r(items || {})));
    const lastDateOfMonth = new Date(currYear, currMonth + 1, 0).getDate();

    const dailyCounts = new Array(lastDateOfMonth).fill(0);
    const days = Array.from({length: lastDateOfMonth}, (_, i) => i + 1);
    let totalCount = 0;

    for (let i = 1; i <= lastDateOfMonth; i++) {
        const dateKey = `smoking_records_${currYear}-${currMonth + 1}-${i}`;
        const records = allData[dateKey];
        if (Array.isArray(records)) {
            dailyCounts[i - 1] = records.length;
            totalCount += records.length;
        }
    }

    return {
        days,
        counts: dailyCounts,
        totalCount
    };
};

// 显示侧边详情栏
const showSmokingDetailPanel = async (dayIndex) => {
    if (!smokingDetailPanel || !smokingDetailListContainer) return;
    
    // 1. 获取该日详细数据
    const dateKey = `smoking_records_${currYear}-${currMonth + 1}-${dayIndex + 1}`;
    const data = await getStorageData(dateKey);
    const records = Array.isArray(data) ? data : [];

    // 2. 更新标题和列表
    smokingDetailDate.innerText = `${currMonth + 1}月${dayIndex + 1}日 抽烟记录`;
    smokingDetailListContainer.innerHTML = "";

    if (records.length === 0) {
        smokingDetailListContainer.innerHTML = `<div class="empty-detail-tip">暂无抽烟记录</div>`;
    } else {
        records.forEach((record, index) => {
            const div = document.createElement('div');
            div.className = 'detail-item';
            
            let extraInfo = '';
            if (record.delayed) {
                let text = '成功延迟';
                if (record.duration) {
                     const d = record.duration;
                     if (d < 60) text += `${d}秒`;
                     else text += `${Math.floor(d/60)}分${d%60}秒`;
                }
                extraInfo += `<span style="background:${record.tagColor||'#10b981'};color:#fff;padding:1px 4px;border-radius:4px;font-size:10px;margin-left:5px;">${text}</span>`;
            }

            // 简单估算间隔
            let intervalInfo = '';
            if (index > 0) {
                 const prev = records[index-1];
                 const intervalVal = calculateInterval(prev.time, record.time);
                 intervalInfo = `<span style="color:#9ca3af;font-size:11px;margin-left:auto;">+${formatInterval(intervalVal)}</span>`;
            }

            div.innerHTML = `
                <div class="detail-row-top" style="align-items:center;">
                    <span class="detail-note" style="font-weight:bold; color:#374151;">${index + 1}. ${record.time}</span>
                    ${extraInfo}
                    ${intervalInfo}
                </div>
            `;
            smokingDetailListContainer.appendChild(div);
        });
    }

    smokingDetailPanel.classList.remove('hidden');
    smokingDetailPanel.classList.add('visible');
};

// 隐藏侧边详情栏
const hideSmokingDetailPanel = () => {
    if (!smokingDetailPanel) return;
    smokingDetailPanel.classList.remove('visible');
    smokingDetailPanel.classList.add('hidden');
};

const renderSmokingChart = () => {
    const { ctx, width, height, data, scale, offsetX, padLeft, padRight, padTop, padBottom, hoverIndex } = smokingChartState;
    if (!ctx || !data) return;

    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;
    const totalDays = data.days.length;

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    // 计算 Y 轴范围
    let maxVal = Math.max(...data.counts, 5); // 至少 5
    // 向上取整到 5 的倍数
    maxVal = Math.ceil(maxVal / 5) * 5;

    const toX = (i) => {
        const baseStepX = chartW / (totalDays - 1 > 0 ? totalDays - 1 : 1);
        return padLeft + offsetX + (i * baseStepX * scale);
    };
    const toY = (v) => padTop + chartH - (v / maxVal) * chartH;

    // 绘制裁剪区域 (用于曲线和X轴)
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, 0, chartW, height);
    ctx.clip();

    ctx.restore(); 
    ctx.save();
    
    // Y 轴网格和标签
    const step = Math.ceil(maxVal / 5);
    for (let val = 0; val <= maxVal; val += step) {
        const y = toY(val);
        
        ctx.strokeStyle = '#f3f4f6';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();

        ctx.fillStyle = '#9ca3af';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(val, padLeft - 8, y);
    }

    // 重新应用裁剪区域绘制折线和X轴
    ctx.beginPath();
    ctx.rect(padLeft, 0, chartW, height);
    ctx.clip();

    // X 轴标签
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const baseStepX = chartW / (totalDays - 1 > 0 ? totalDays - 1 : 1);
    const checkStepX = baseStepX * scale;
    const labelInterval = Math.ceil(20 / checkStepX);

    for (let i = 0; i < totalDays; i++) {
        const x = toX(i);
        if (x < padLeft - 10 || x > width - padRight + 10) continue;

        if (i === 0 || i === totalDays - 1 || (i + 1) % labelInterval === 0) {
            ctx.fillText(`${i + 1}`, x, height - padBottom + 8);
        }
    }

    // 绘制曲线
    const drawCurve = (dataArr, color, bgTop, bgBottom) => {
        if (totalDays < 1) return;
        ctx.save();
        
        // 1. 填充区域
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(dataArr[0]));
        for (let i = 0; i < totalDays - 1; i++) {
            const xCurrent = toX(i);
            const yCurrent = toY(dataArr[i]);
            const xNext = toX(i + 1);
            const yNext = toY(dataArr[i+1]);
            const cpX = (xCurrent + xNext) / 2;
            ctx.bezierCurveTo(cpX, yCurrent, cpX, yNext, xNext, yNext);
        }
        ctx.lineTo(toX(totalDays - 1), toY(0)); 
        ctx.lineTo(toX(0), toY(0));
        ctx.closePath();
        
        const grad = ctx.createLinearGradient(0, padTop, 0, height - padBottom);
        grad.addColorStop(0, bgTop);
        grad.addColorStop(1, bgBottom);
        ctx.fillStyle = grad;
        ctx.fill();

        // 2. 线条
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(dataArr[0]));
        for (let i = 0; i < totalDays - 1; i++) {
            const xCurrent = toX(i);
            const yCurrent = toY(dataArr[i]);
            const xNext = toX(i + 1);
            const yNext = toY(dataArr[i+1]);
            const cpX = (xCurrent + xNext) / 2;
            ctx.bezierCurveTo(cpX, yCurrent, cpX, yNext, xNext, yNext);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.restore();
    };

    drawCurve(data.counts, '#f97316', 'rgba(249,115,22,0.2)', 'rgba(249,115,22,0.0)');

    // 绘制数据点
    const showPoints = checkStepX > 10;
    
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 1.5;
    
    for (let i = 0; i < totalDays; i++) {
        const x = toX(i);
        if (x < padLeft || x > width - padRight) continue;
        
        if (showPoints || i === hoverIndex) {
            // 不画 0 值点，除非是 hover
            if (data.counts[i] === 0 && i !== hoverIndex) continue;

            const y = toY(data.counts[i]);
            ctx.beginPath();
            const radius = (i === hoverIndex) ? 5 : 3;
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    }
    ctx.restore();

    // 绘制数值标签 (Display values on nodes)
    if (showPoints) {
        ctx.save();
        ctx.fillStyle = '#f97316';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        
        for (let i = 0; i < totalDays; i++) {
            const x = toX(i);
            if (x < padLeft || x > width - padRight) continue;
            
            const count = data.counts[i];
            if (count > 0) {
                const y = toY(count);
                ctx.fillText(count, x, y - 6);
            }
        }
        ctx.restore();
    }

    ctx.restore(); // 结束裁剪区域

    // Hover Tooltip
    if (hoverIndex >= 0 && hoverIndex < totalDays) {
        const x = toX(hoverIndex);
        if (x >= padLeft && x <= width - padRight) {
            // 垂直指示线
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, padTop);
            ctx.lineTo(x, height - padBottom);
            ctx.strokeStyle = 'rgba(156, 163, 175, 0.4)';
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.restore();

            // Tooltip 框
            const countVal = data.counts[hoverIndex];
            const dayStr = `${hoverIndex + 1}日`;

            const textPadding = 8;
            const lineHeight = 16;
            ctx.font = 'bold 12px system-ui';
            const titleWidth = ctx.measureText(dayStr).width;
            ctx.font = '12px system-ui';
            const countText = `数量: ${countVal}`;
            const countWidth = ctx.measureText(countText).width;
            
            const boxWidth = Math.max(titleWidth, countWidth) + textPadding * 2;
            const boxHeight = textPadding * 2 + lineHeight * 2; 

            let boxX = x + 10; 
            let boxY = padTop + 10;
            if (boxX + boxWidth > width - padRight) {
                boxX = x - 10 - boxWidth;
            }

            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 6);
            ctx.fill();
            
            ctx.fillStyle = '#374151';
            ctx.font = 'bold 12px system-ui';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(dayStr, boxX + textPadding, boxY + textPadding);

            ctx.font = '12px system-ui';
            ctx.fillStyle = '#f97316';
            ctx.fillText(countText, boxX + textPadding, boxY + textPadding + lineHeight + 2);

            ctx.restore();
        }
    }
};

const clampSmokingOffset = () => {
    const { width, padLeft, padRight, scale, data } = smokingChartState;
    if (!data) return;
    const chartW = width - padLeft - padRight;
    const totalDays = data.days.length;
    const baseStepX = chartW / (totalDays - 1 > 0 ? totalDays - 1 : 1);
    const contentWidth = baseStepX * scale * (totalDays - 1);
    
    if (contentWidth <= chartW) {
        smokingChartState.offsetX = 0; 
    } else {
        const minOffset = chartW - contentWidth;
        const maxOffset = 0;
        if (smokingChartState.offsetX > maxOffset) smokingChartState.offsetX = maxOffset;
        if (smokingChartState.offsetX < minOffset) smokingChartState.offsetX = minOffset;
    }
};

const openSmokingChart = async () => {
    if (!smokingChartModal) return;

    // 1. 获取数据
    smokingChartState.data = await initSmokingChartData();

    // 更新标题
    const titleText = document.getElementById('smoking-chart-title-text');
    if (titleText) titleText.textContent = `${currYear}年${currMonth + 1}月 抽烟记录`;

    // 更新汇总
    const summaryBar = document.getElementById('smoking-chart-summary');
    if (summaryBar) {
        // 默认范围：本月1号 到 今天(如果是本月) 或 月末
        const now = new Date();
        const y = currYear;
        const m = currMonth + 1;
        
        const formatYMD = (year, month, day) => {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        };
        
        let defaultStartData = formatYMD(y, m, 1);
        let defaultEndDate;
        
        if (y === now.getFullYear() && (m - 1) === now.getMonth()) {
            defaultEndDate = formatYMD(y, m, now.getDate());
        } else {
             // 其它月份，默认选中最后一天
             const lastDay = new Date(y, m, 0).getDate();
             defaultEndDate = formatYMD(y, m, lastDay);
        }

        // 渲染 HTML，包含日期输入框
        summaryBar.innerHTML = `
            <style>
                .chart-summary-inputs { display:flex; align-items:center; gap:4px; font-size:12px; color:#374151; }
                .chart-summary-input-date { width: 95px; text-align:center; border:1px solid #e5e7eb; border-radius:4px; padding:2px 0; outline:none; color:#374151; font-family: inherit; font-size: 11px; }
                .chart-summary-input-date:focus { border-color:#8b5cf6; }
            </style>
            <div class="chart-summary-item" style="justify-content:center; width:40%;">
                <span class="label">本月总计</span>
                <span class="value" style="color:#f97316; font-size:16px; margin-left:8px;">${smokingChartState.data.totalCount} 支</span>
            </div>
            <div class="chart-summary-item" style="justify-content:center; width:60%; border-left: 1px solid #e5e7eb; flex-direction:column; gap:2px;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="label">平均每天</span>
                    <span class="value" id="avg-val-display" style="color:#6b7280; font-size:16px;">--</span>
                </div>
                <div class="chart-summary-inputs">
                    <input type="date" id="avg-start-date" class="chart-summary-input-date" value="${defaultStartData}">
                    <span>-</span>
                    <input type="date" id="avg-end-date" class="chart-summary-input-date" value="${defaultEndDate}">
                    <span id="avg-formula-display" style="font-size:11px; color:#9ca3af; margin-left:2px;">(...)</span>
                </div>
            </div>
        `;

        // 异步计算逻辑函数 (支持跨月)
        const updateAvgDisplay = async () => {
             const startInput = document.getElementById('avg-start-date');
             const endInput = document.getElementById('avg-end-date');
             const valDisplay = document.getElementById('avg-val-display');
             const formulaDisplay = document.getElementById('avg-formula-display');
             
             if (!startInput || !endInput) return;
             
             // 显示加载状态
             valDisplay.innerHTML = '<span class="material-icons spin" style="font-size:14px;">autorenew</span>';
             
             const sDateStr = startInput.value;
             const eDateStr = endInput.value;
             
             if (!sDateStr || !eDateStr) {
                 valDisplay.innerText = '--';
                 return;
             }
             
             const sDate = new Date(sDateStr);
             const eDate = new Date(eDateStr);
             
             if (sDate > eDate) {
                 valDisplay.innerText = '日期无效'; // Start > End
                 formulaDisplay.innerText = '';
                 return;
             }
             
             // 遍历每一天，收集 key
             const keys = [];
             let current = new Date(sDate);
             while (current <= eDate) {
                 // Format key: smoking_records_YYYY-M-D (注意 Month 是 1-based, Day 是 1-based, 没有 padding 0 ? 检查前面的代码)
                 // 前面的代码: const dateKey = `smoking_records_${currYear}-${currMonth + 1}-${i}`;
                 // 没有 padding !  e.g. 2026-2-1
                 const y = current.getFullYear();
                 const m = current.getMonth() + 1;
                 const d = current.getDate();
                 
                 // 注意：存储的key格式在前面代码里是 `${currYear}-${currMonth + 1}-${i}`
                 // 如果 getStorageData 用的是 keys，需要匹配格式
                 // 前面 view_file 看不到 save 的地方，但看 initSmokingChartData 是 `${currYear}-${currMonth + 1}-${i}`
                 keys.push(`smoking_records_${y}-${m}-${d}`);
                 
                 current.setDate(current.getDate() + 1);
             }
             
             // 批量获取
             const result = await new Promise(resolve => {
                 chrome.storage.sync.get(keys, (items) => resolve(items));
             });
             
             let rangeTotal = 0;
             keys.forEach(key => {
                 if (result[key] && Array.isArray(result[key])) {
                     rangeTotal += result[key].length;
                 }
             });
             
             // 计算天数
             const diffTime = Math.abs(eDate - sDate);
             const daysCount = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
             
             const avg = (rangeTotal / daysCount).toFixed(1);
             
             valDisplay.innerText = `${avg} 支`;
             formulaDisplay.innerText = `(${rangeTotal}÷${daysCount})`;
        };

        // 绑定事件
        const sInput = document.getElementById('avg-start-date');
        const eInput = document.getElementById('avg-end-date');
        
        [sInput, eInput].forEach(inp => {
            if (inp) {
                inp.addEventListener('change', updateAvgDisplay);
            }
        });
        
        // 初始化计算一次
        updateAvgDisplay();
    }

    // 2. 初始化 Canvas
    const canvas = document.getElementById('smoking-chart-canvas');
    if (canvas) {
        smokingChartState.canvas = canvas;
        smokingChartState.ctx = canvas.getContext('2d');
        
        if (!canvas.dataset.hasListeners) {
            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const delta = -Math.sign(e.deltaY) * 0.1;
                smokingChartState.scale = Math.max(1, Math.min(10, smokingChartState.scale + delta));
                clampSmokingOffset();
                renderSmokingChart();
            }, { passive: false });
    
            canvas.addEventListener('mousemove', (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                const { padLeft, padRight, width, scale, offsetX, data } = smokingChartState;
                const chartW = width - padLeft - padRight;
                const totalDays = data.days.length;
                const baseStepX = chartW / (totalDays - 1 > 0 ? totalDays - 1 : 1);
                
                let index = Math.round((x - padLeft - offsetX) / (baseStepX * scale));
                if (index < 0) index = 0;
                if (index >= totalDays) index = totalDays - 1;
                
                if (x >= padLeft && x <= width - padRight && y >= smokingChartState.padTop && y <= smokingChartState.height - smokingChartState.padBottom) {
                     smokingChartState.hoverIndex = index;
                     canvas.style.cursor = 'pointer';
                } else {
                     smokingChartState.hoverIndex = -1;
                     canvas.style.cursor = 'default';
                }
                
                if (smokingChartState.isDragging && smokingChartState.scale > 1) {
                    const dx = x - smokingChartState.lastX;
                    smokingChartState.offsetX += dx;
                    clampSmokingOffset();
                    canvas.style.cursor = 'grabbing';
                }
                
                smokingChartState.lastX = x;
                renderSmokingChart();
            });
    
            canvas.addEventListener('mousedown', (e) => {
                if (smokingChartState.scale > 1) {
                    smokingChartState.isDragging = true;
                    const rect = canvas.getBoundingClientRect();
                    smokingChartState.lastX = e.clientX - rect.left;
                    canvas.style.cursor = 'grabbing';
                }
            });
    
            canvas.addEventListener('mouseup', () => {
                smokingChartState.isDragging = false;
                canvas.style.cursor = 'default';
            });
    
            canvas.addEventListener('mouseleave', () => {
                 smokingChartState.isDragging = false;
                 smokingChartState.hoverIndex = -1;
                 renderSmokingChart();
            });
            
            canvas.addEventListener('click', (e) => {
                if (smokingChartState.isDragging) return;
                if (smokingChartState.hoverIndex >= 0) {
                     showSmokingDetailPanel(smokingChartState.hoverIndex);
                } else {
                     hideSmokingDetailPanel();
                }
            });
    
            canvas.dataset.hasListeners = "true";
        }
    
        const dpr = window.devicePixelRatio || 1;
        const logicW = 560;
        const logicH = 280;
        
        canvas.width = logicW * dpr;
        canvas.height = logicH * dpr;
        canvas.style.width = `${logicW}px`;
        canvas.style.height = `${logicH}px`;
        
        smokingChartState.width = logicW;
        smokingChartState.height = logicH;
        smokingChartState.ctx.scale(dpr, dpr);
        
        smokingChartState.scale = 1;
        smokingChartState.offsetX = 0;
        hideSmokingDetailPanel();
        
        renderSmokingChart();
    
        smokingChartModal.classList.remove('hidden');
        smokingChartModal.classList.add('visible');
    }
};

const closeSmokingChart = () => {
    if (!smokingChartModal) return;
    smokingChartModal.classList.remove('visible');
    smokingChartModal.classList.add('hidden');
    smokingChartState.data = null; 
};

if (openSmokingChartBtn) {
    openSmokingChartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSmokingChart();
    });
}
if (smokingChartCloseX) {
    smokingChartCloseX.addEventListener('click', closeSmokingChart);
}
if (smokingChartModal) {
    smokingChartModal.addEventListener('click', (e) => {
        if (e.target === smokingChartModal) closeSmokingChart();
    });
}
if (smokingDetailClose) {
    smokingDetailClose.addEventListener('click', hideSmokingDetailPanel);
}

// === 今日抽烟趋势 Modal 逻辑 ===
const dailySmokingChartModal = document.getElementById('daily-smoking-chart-modal');
const openDailySmokingChartBtn = document.getElementById('btn-open-daily-smoking-chart');
const dailySmokingChartCloseX = document.getElementById('daily-smoking-chart-close-x');

// 图表状态
let dailySmokingChartState = {
    data: null, // { labels: [], intervals: [], times: [] }
    scale: 1,
    offsetX: 0,
    isDragging: false,
    lastX: 0,
    hoverIndex: -1,
    width: 0,
    height: 0,
    ctx: null,
    canvas: null,
    padLeft: 40,
    padRight: 20,
    padTop: 40,
    padBottom: 30
};

const initDailySmokingChartData = () => {
    // 使用全局变量 smokingRecords
    const records = smokingRecords || [];
    const labels = [];
    const intervals = [];
    const times = [];
    
    // 计算间隔
    // 逻辑：
    // 第1支：距离本日开始（00:00）的分钟数？或者距离起床时间？
    // 简单起见，第1支如果是在 00:00 之后，算作 "距离0点"？不，这会导致数值很大。
    // 第1支通常作为基准点，间隔设为 0 或者设为 "距离上一支(昨天最后)" 如果有数据？
    // 为了展示"趋势"，我们关注的是"抽烟频率"。
    // 方案：
    // Point 1: Interval = 0 (Base)
    // Point N: Interval = Time(N) - Time(N-1)
    
    if (records.length > 0) {
        labels.push('1');
        intervals.push(0); // 第一支默认间隔平稳，或者可以不显示点，或者显示为0
        times.push(records[0].time);
        
        for (let i = 1; i < records.length; i++) {
            const prev = records[i-1];
            const curr = records[i];
            const interval = calculateInterval(prev.time, curr.time);
            
            labels.push(String(i + 1));
            intervals.push(interval);
            times.push(curr.time);
        }
    }
    
    return { labels, intervals, times };
};

const renderDailySmokingChart = () => {
    const { ctx, width, height, data, scale, offsetX, padLeft, padRight, padTop, padBottom, hoverIndex } = dailySmokingChartState;
    if (!ctx || !data || data.labels.length === 0) {
        // Empty state render
        if (ctx) {
             ctx.clearRect(0, 0, width, height);
             ctx.fillStyle = '#9ca3af';
             ctx.font = '14px system-ui';
             ctx.textAlign = 'center';
             ctx.textBaseline = 'middle';
             ctx.fillText('今日暂无抽烟记录', width/2, height/2);
        }
        return;
    }

    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;
    const totalPoints = data.labels.length;

    ctx.clearRect(0, 0, width, height);

    // 计算 Y 轴范围 (Interval 分钟)
    let maxVal = Math.max(...data.intervals, 60); // 至少 60分钟
    maxVal = Math.ceil(maxVal / 30) * 30; // 30的倍数

    const toX = (i) => {
        const baseStepX = chartW / (totalPoints - 1 > 0 ? totalPoints - 1 : 1);
        if (totalPoints === 1) return padLeft + chartW / 2; // 只有一个点居中
        return padLeft + offsetX + (i * baseStepX * scale);
    };
    const toY = (v) => padTop + chartH - (v / maxVal) * chartH;

    // 裁剪
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, 0, chartW, height);
    ctx.clip();
    
    ctx.restore();
    ctx.save();

    // Y 轴 (分钟)
    const step = Math.ceil(maxVal / 5 / 10) * 10; // 近似整10
    for (let val = 0; val <= maxVal; val += step) {
        if (val === 0) continue; // 0线可能有X轴
        const y = toY(val);
        ctx.strokeStyle = '#f3f4f6';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();

        ctx.fillStyle = '#9ca3af';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(val, padLeft - 6, y);
    }
    // 0 label
    ctx.fillText('0', padLeft - 6, toY(0));

    // X 轴
    ctx.beginPath();
    ctx.rect(padLeft, 0, chartW, height);
    ctx.clip();
    
    // Labels
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    const baseStepX = chartW / (totalPoints - 1 > 0 ? totalPoints - 1 : 1);
    const checkStepX = (totalPoints === 1) ? chartW : (baseStepX * scale);
    const labelInterval = Math.ceil(30 / checkStepX); // 间距

    for (let i = 0; i < totalPoints; i++) {
        const x = toX(i);
        if (x < padLeft - 10 || x > width - padRight + 10) continue;
        
        if (i === 0 || i === totalPoints - 1 || (i + 1) % labelInterval === 0) {
            ctx.fillText(data.labels[i], x, height - padBottom + 8);
        }
    }

    // 绘制曲线 (Purple #8b5cf6)
    if (totalPoints > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(data.intervals[0]));
        for (let i = 0; i < totalPoints - 1; i++) {
            const xCurrent = toX(i);
            const yCurrent = toY(data.intervals[i]);
            const xNext = toX(i + 1);
            const yNext = toY(data.intervals[i+1]);
            const cpX = (xCurrent + xNext) / 2;
            ctx.bezierCurveTo(cpX, yCurrent, cpX, yNext, xNext, yNext);
        }
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
        
        // Fill area
        ctx.lineTo(toX(totalPoints - 1), toY(0));
        ctx.lineTo(toX(0), toY(0));
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, padTop, 0, height - padBottom);
        grad.addColorStop(0, 'rgba(139, 92, 246, 0.2)');
        grad.addColorStop(1, 'rgba(139, 92, 246, 0.0)');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
    }

    // Nodes & Values
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 1.5;
    
    // Config for text
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    
    const showValues = checkStepX > 20;

    for (let i = 0; i < totalPoints; i++) {
        const x = toX(i);
        if (x < padLeft || x > width - padRight) continue;

        // Draw point
        const y = toY(data.intervals[i]);
        
        // Skip drawing point/value for the first one if it's 0 and meaningless, but let's keep it for consistency
        
        ctx.beginPath();
        const radius = (i === hoverIndex) ? 5 : 3;
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.stroke();
        
        // Draw Value
        if (showValues) {
            // 1. Time (Top)
            ctx.fillStyle = '#6b7280'; // Gray
            ctx.fillText(data.times[i], x, y - 18);
            
            // 2. Interval (Bottom of Time)
            if (i > 0) { 
                ctx.fillStyle = '#8b5cf6'; // Purple
                ctx.fillText(`+${data.intervals[i]}m`, x, y - 6);
            } else {
                ctx.fillStyle = '#8b5cf6';
                ctx.fillText('Start', x, y - 6);
            }
        }
    }
    ctx.restore();
    ctx.restore(); // clip end

    // Tooltip
    if (hoverIndex >= 0 && hoverIndex < totalPoints) {
        const x = toX(hoverIndex);
        if (x >= padLeft && x <= width - padRight) {
            // Line
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, padTop);
            ctx.lineTo(x, height - padBottom);
            ctx.strokeStyle = 'rgba(156, 163, 175, 0.4)';
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.restore();

            // Box
            const intervalVal = data.intervals[hoverIndex];
            const timeStr = data.times[hoverIndex];
            const numStr = `第${data.labels[hoverIndex]}支`;
            
            const textPadding = 8;
            const lineHeight = 16;
            ctx.font = 'bold 12px system-ui';
            const t1W = ctx.measureText(numStr).width;
            ctx.font = '12px system-ui';
            const t2W = ctx.measureText(`时间: ${timeStr}`).width;
            const t3W = ctx.measureText(`间隔: ${intervalVal}分`).width;
            
            const boxWidth = Math.max(t1W, t2W, t3W) + textPadding * 2;
            const boxHeight = textPadding * 2 + lineHeight * 3 + 2;

            let boxX = x + 10;
            let boxY = padTop + 10;
            if (boxX + boxWidth > width - padRight) boxX = x - 10 - boxWidth;

            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 6);
            ctx.fill();

            // Text
            ctx.fillStyle = '#374151';
            ctx.font = 'bold 12px system-ui';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(numStr, boxX + textPadding, boxY + textPadding);
            
            ctx.font = '12px system-ui';
            ctx.fillStyle = '#6b7280';
            ctx.fillText(`时间: ${timeStr}`, boxX + textPadding, boxY + textPadding + lineHeight + 2);
            
            ctx.fillStyle = '#8b5cf6';
            ctx.fillText(`间隔: ${intervalVal}分`, boxX + textPadding, boxY + textPadding + lineHeight * 2 + 4);

            ctx.restore();
        }
    }
};

const clampDailySmokingOffset = () => {
    const { width, padLeft, padRight, scale, data } = dailySmokingChartState;
    if (!data) return;
    const chartW = width - padLeft - padRight;
    const totalPoints = data.labels.length;
    const baseStepX = chartW / (totalPoints - 1 > 0 ? totalPoints - 1 : 1);
    const contentWidth = baseStepX * scale * (totalPoints - 1);
    
    if (contentWidth <= chartW) {
        dailySmokingChartState.offsetX = 0; 
    } else {
        const minOffset = chartW - contentWidth;
        const maxOffset = 0;
        if (dailySmokingChartState.offsetX > maxOffset) dailySmokingChartState.offsetX = maxOffset;
        if (dailySmokingChartState.offsetX < minOffset) dailySmokingChartState.offsetX = minOffset;
    }
};

const openDailySmokingChart = () => {
    if (!dailySmokingChartModal) return;
    
    // Init Data
    dailySmokingChartState.data = initDailySmokingChartData();
    
    // Summary
    const summaryBar = document.getElementById('daily-smoking-chart-summary');
    if (summaryBar) {
        // Calculate Avg Interval (exclude first 0)
        const intervals = dailySmokingChartState.data.intervals.slice(1);
        let avg = 0;
        if (intervals.length > 0) {
            avg = Math.round(intervals.reduce((a,b)=>a+b,0) / intervals.length);
        }
        const total = dailySmokingChartState.data.intervals.length;

        summaryBar.innerHTML = `
            <div class="chart-summary-item" style="justify-content:center; width:50%;">
                <span class="label">今日总计</span>
                <span class="value" style="color:#8b5cf6; font-size:16px; margin-left:8px;">${total} 支</span>
            </div>
            <div class="chart-summary-item" style="justify-content:center; width:50%; border-left: 1px solid #e5e7eb;">
                <span class="label">平均间隔</span>
                <span class="value" style="color:#6b7280; font-size:16px; margin-left:8px;">${avg} 分钟</span>
            </div>
        `;
    }

    // Init Canvas
    const canvas = document.getElementById('daily-smoking-chart-canvas');
    if (!canvas) return;
    dailySmokingChartState.canvas = canvas;
    dailySmokingChartState.ctx = canvas.getContext('2d');
    
    if (!canvas.dataset.hasListeners) {
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = -Math.sign(e.deltaY) * 0.1;
            dailySmokingChartState.scale = Math.max(1, Math.min(10, dailySmokingChartState.scale + delta));
            clampDailySmokingOffset();
            renderDailySmokingChart();
        }, { passive: false });
        
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const { padLeft, padRight, width, scale, offsetX, data } = dailySmokingChartState;
            const chartW = width - padLeft - padRight;
            const totalPoints = data.labels.length;
            const baseStepX = chartW / (totalPoints - 1 > 0 ? totalPoints - 1 : 1);
            
            let index = Math.round((x - padLeft - offsetX) / (baseStepX * scale));
            if (index < 0) index = 0;
            if (index >= totalPoints) index = totalPoints - 1;
            
            if (x >= padLeft && x <= width - padRight && y >= dailySmokingChartState.padTop && y <= dailySmokingChartState.height - dailySmokingChartState.padBottom) {
                 dailySmokingChartState.hoverIndex = index;
                 canvas.style.cursor = 'pointer';
            } else {
                 dailySmokingChartState.hoverIndex = -1;
                 canvas.style.cursor = 'default';
            }
            
            if (dailySmokingChartState.isDragging && dailySmokingChartState.scale > 1) {
                const dx = x - dailySmokingChartState.lastX;
                dailySmokingChartState.offsetX += dx;
                clampDailySmokingOffset();
                canvas.style.cursor = 'grabbing';
            }
            
            dailySmokingChartState.lastX = x;
            renderDailySmokingChart();
        });
        
        canvas.addEventListener('mousedown', (e) => {
            if (dailySmokingChartState.scale > 1) {
                dailySmokingChartState.isDragging = true;
                const rect = canvas.getBoundingClientRect();
                dailySmokingChartState.lastX = e.clientX - rect.left;
                canvas.style.cursor = 'grabbing';
            }
        });
        
        canvas.addEventListener('mouseup', () => {
            dailySmokingChartState.isDragging = false;
            canvas.style.cursor = 'default';
        });

        canvas.addEventListener('mouseleave', () => {
             dailySmokingChartState.isDragging = false;
             dailySmokingChartState.hoverIndex = -1;
             renderDailySmokingChart();
        });
        
        canvas.dataset.hasListeners = "true";
    }
    
    const dpr = window.devicePixelRatio || 1;
    const logicW = 560;
    const logicH = 280;
    
    canvas.width = logicW * dpr;
    canvas.height = logicH * dpr;
    canvas.style.width = `${logicW}px`;
    canvas.style.height = `${logicH}px`;
    
    dailySmokingChartState.width = logicW;
    dailySmokingChartState.height = logicH;
    dailySmokingChartState.ctx.scale(dpr, dpr);
    
    dailySmokingChartState.scale = 1;
    dailySmokingChartState.offsetX = 0;
    
    renderDailySmokingChart();
    
    dailySmokingChartModal.classList.remove('hidden');
    dailySmokingChartModal.classList.add('visible');
};

const closeDailySmokingChart = () => {
    if (!dailySmokingChartModal) return;
    dailySmokingChartModal.classList.remove('visible');
    dailySmokingChartModal.classList.add('hidden');
    dailySmokingChartState.data = null; 
};

if (openDailySmokingChartBtn) {
    openDailySmokingChartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDailySmokingChart();
    });
}
if (dailySmokingChartCloseX) {
    dailySmokingChartCloseX.addEventListener('click', closeDailySmokingChart);
}
if (dailySmokingChartModal) {
    dailySmokingChartModal.addEventListener('click', (e) => {
        if (e.target === dailySmokingChartModal) closeDailySmokingChart();
    });
}

// === WebDAV Accordion Logic ===
const webdavHeader = document.getElementById('webdav-accordion-header');
const webdavContent = document.getElementById('webdav-accordion-content');
if (webdavHeader && webdavContent) {
    webdavHeader.addEventListener('click', () => {
        webdavContent.classList.toggle('hidden');
        webdavHeader.classList.toggle('active');
    });
}

// === 设置卡片折叠/展开 ===
document.querySelectorAll('#view-settings .settings-section-header').forEach(header => {
    header.addEventListener('click', () => {
        const section = header.closest('.settings-section');
        if (section) {
            section.classList.toggle('collapsed');
        }
    });
});

// === WebDAV Copy Buttons Logic ===
document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (input) {
            input.select();
            document.execCommand('copy');
            
            // Visual feedback
            const originalIcon = btn.innerHTML;
            btn.innerHTML = '<span class="material-icons" style="color: var(--mark-green); font-size: 16px;">check</span>';
            setTimeout(() => {
                btn.innerHTML = originalIcon;
            }, 1000);
        }
    });
});

