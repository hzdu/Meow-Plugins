// AI 提示词配置文件
// 集中管理所有 AI 相关提示词，便于修改和维护

const AI_PROMPTS = {

    /**
     * 月度财务分析提示词
     * @param {number} year - 年份
     * @param {number} month - 月份 (0-11)
     * @param {Array} items - 收支数据数组 [{date, type, amount, note}]
     * @param {number} totalIncome - 总收入
     * @param {number} totalExpense - 总支出
     * @param {string} lang - 语言代码 (如 'zh-CN', 'en')
     * @param {Array} [assets] - 固定资产数组 [{name, type, quantity, payment, note}]
     * @returns {string} 完整的 prompt
     */
    financeSummary: (year, month, items, totalIncome, totalExpense, lang, assets) => {
        const langHint = (lang || '').startsWith('zh') ? '请用中文回答' : 'Please answer in English';
        let assetsText = '';
        if (Array.isArray(assets) && assets.length > 0) {
            const typeMap = { property: '房产', shop: '门店', vehicle: '车辆', other: '其他' };
            const payMap = { full: '全款', installment: '分期' };
            const usageMap = { 'self-use': '自用', 'rental': '出租' };
            assetsText = '\n\n【固定资产】\n' + assets.map((item, i) => {
                const typeLabel = typeMap[item.type] || '其他';
                const payLabel = payMap[item.payment] || '全款';
                const usageLabel = usageMap[item.usage] || '自用';
                const qty = parseInt(item.quantity) || 1;
                const rent = (item.usage === 'rental' && item.rent) ? ` [月租¥${parseFloat(item.rent).toFixed(2)}]` : '';
                const note = item.note ? `（${item.note}）` : '';
                return `${i + 1}. ${typeLabel}: ${item.name || ''} ×${qty} [${payLabel}] [${usageLabel}]${rent}${note}`;
            }).join('\n');
        }
        return `你是专业的财务分析师。以下是我 ${year}年${month + 1}月 的收支数据（JSON格式）。` +
            `请分析我的月度财务状况，包括：总收入、总支出、结余、消费特点、是否有异常支出，` +
            `并给出合理的财务建议。${langHint}\n\n数据：\`\`\`json\n${JSON.stringify(items, null, 2)}\n\`\`\`` +
            `\n\n月度汇总：总收入 ¥${totalIncome.toFixed(2)}，总支出 ¥${totalExpense.toFixed(2)}，结余 ¥${(totalIncome - totalExpense).toFixed(2)}。` +
            assetsText +
			`\n说明：** 不用告诉我你是谁，我不感兴趣\n`+
			`** 使用可爱、粘人的女朋友角度回答\n` + 
			`** 数据返回的格式清晰，排版易于阅读`;
    }

};

/**
 * 日期详情 AI 总结提示词
 * @param {string} dateKey - 日期 YYYY-M-D
 * @param {Array} todos - 待办事项数组
 * @param {Array} financeItems - 财务记录数组 [{type, amount, note}]
 * @param {string} lang - 语言代码
 * @param {Array} [preExpenses] - 财务规划（每月重复项）数组 [{name, amount, type, completed, recurDay}]
 * @param {Array} [assets] - 固定资产数组 [{name, type, quantity, payment, note}]
 * @returns {string} 完整的 prompt
 */
function dateDetailPrompt(dateKey, todos, financeItems, lang, preExpenses, assets) {
    const langHint = (lang || '').startsWith('zh') ? '请用中文回答' : 'Please answer in English';
    const parts = dateKey.split('-');
    const dateStr = `${parts[0]}年${parts[1]}月${parts[2]}日`;
    
    let todoText = '无';
    if (todos.length > 0) {
        todoText = todos.map((t, i) => {
            const name = typeof t === 'string' ? t : (t.text || t.content || '');
            const done = t.done || t.completed || false;
            return `${i + 1}. ${done ? '[已完成]' : '[未完成]'} ${name}`;
        }).join('\n');
    }
    
    let financeText = '无';
    if (financeItems.length > 0) {
        financeText = financeItems.map((item, i) => {
            const val = parseFloat(item.amount) || 0;
            const type = item.type === 'income' ? '收入' : '支出';
            return `${i + 1}. ${type}: ${item.note || ''} ¥${val.toFixed(2)}`;
        }).join('\n');
    }
    
    let preExpenseText = '无';
    if (Array.isArray(preExpenses) && preExpenses.length > 0) {
        preExpenseText = preExpenses.map((item, i) => {
            const val = parseFloat(item.amount) || 0;
            const typeMap = { necessary: '必要支出', unnecessary: '非必要支出', income: '预期收入' };
            const typeLabel = typeMap[item.type] || '支出';
            const status = item.completed ? '[已完成]' : '[未完成]';
            return `${i + 1}. ${status} ${typeLabel}: ${item.name || ''} ¥${val.toFixed(2)}（每月${item.recurDay || 1}号重复）`;
        }).join('\n');
    }
    
    let assetsText = '';
    if (Array.isArray(assets) && assets.length > 0) {
        const typeMap = { property: '房产', shop: '门店', vehicle: '车辆', other: '其他' };
        const payMap = { full: '全款', installment: '分期' };
        const usageMap = { 'self-use': '自用', 'rental': '出租' };
        assetsText = '\n\n【固定资产】\n' + assets.map((item, i) => {
            const typeLabel = typeMap[item.type] || '其他';
            const payLabel = payMap[item.payment] || '全款';
            const usageLabel = usageMap[item.usage] || '自用';
            const qty = parseInt(item.quantity) || 1;
            const rent = (item.usage === 'rental' && item.rent) ? ` [月租¥${parseFloat(item.rent).toFixed(2)}]` : '';
            const note = item.note ? `（${item.note}）` : '';
            return `${i + 1}. ${typeLabel}: ${item.name || ''} ×${qty} [${payLabel}] [${usageLabel}]${rent}${note}`;
        }).join('\n');
    }
    
    return `请分析 ${dateStr} 的日程和财务状况。${langHint}\n\n` +
        `【待办事项】\n${todoText}\n\n` +
        `【财务记录】\n${financeText}\n\n` +
        `【财务规划（每月重复）】\n${preExpenseText}` +
        assetsText + `\n\n` +
        `请给出简要总结：当天任务完成情况、收支概况、财务规划执行情况，以及简要建议。回答不要太长，控制在 200 字以内。\n` + 
		`说明：** 数据返回的格式清晰，排版易于阅读\n` + 
		`** 使用可爱、粘人的女朋友角度回答`;
}
