/**
 * split_popup.js - 将 popup.js 按功能拆分为多个模块文件
 * 
 * 拆分策略：
 * - 所有模块仍使用普通 <script> 标签加载（非 ES module）
 * - 全局变量/函数在全局作用域共享，保持与原文件完全一致的行为
 * - 按 popup.html 中的 <script> 加载顺序保证执行顺序
 * 
 * 用法：node scripts/split_popup.js
 */

const fs = require('fs');
const path = require('path');

const SOURCE_FILE = path.join(__dirname, '..', 'js', 'popup.js');
const OUTPUT_DIR = path.join(__dirname, '..', 'js', 'modules');

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 读取源文件
const content = fs.readFileSync(SOURCE_FILE, 'utf8');
const lines = content.split('\n');

// 拆分配置：[文件名, 起始行(1-based), 结束行(1-based, inclusive), 模块描述]
// 每个模块包含其尾部的空行，确保拼接后与原文件完全一致
const modules = [
    ['popup-core.js',     1,    552,  '核心：DOM元素获取、状态变量、辅助函数、Tab/UI逻辑、renderApp入口'],
    ['popup-weather.js',  553,  935,  '天气功能'],
    ['popup-calendar.js', 936,  1461, '日历逻辑 + Tooltip + 待办事项'],
    ['popup-habits.js',   1462, 1688, '习惯功能'],
    ['popup-alarms.js',   1689, 2130, '闹钟 + 倒数日 + 暂存板'],
    ['popup-finance.js',  2131, 3702, '财务 + 账本关联 + 图谱 + 备注历史 + 预支出'],
    ['popup-smoking.js',  3703, 4755, '戒烟规划 + 深呼吸 + 备注列表'],
    ['popup-events.js',   4756, 5204, '事件监听 + Tab拖放 + 财务导出 + 备份恢复'],
    ['popup-webdav.js',   5205, 5617, 'WebDAV功能 + 初始化调用(renderApp)'],
    ['popup-charts.js',   5618, 7763, 'Big Calendar + 折线图报表 + 趋势Modal + 设置折叠'],
    ['popup-exchange.js', 7764, 7944, '实时汇率换算'],
    ['popup-2fa.js',      7945, 8297, '2FA验证模块'],
    ['popup-ai.js',       8298, 8743, 'AI Provider + AI Setting'],
    ['popup-batch.js',    8744, 9427, '批量定时功能'],
    ['popup-titlebar.js', 9428, 9518, 'TitleBar初始化'],
];

console.log('=== popup.js 模块拆分工具 ===\n');
console.log(`源文件: ${SOURCE_FILE}`);
console.log(`总行数: ${lines.length}`);
console.log(`输出目录: ${OUTPUT_DIR}\n`);

let totalOutputLines = 0;

for (const [filename, startLine, endLine, description] of modules) {
    // 转换为 0-based 索引
    const startIdx = startLine - 1;
    const endIdx = endLine; // slice 不包含 endIdx，所以直接用 endLine
    
    const moduleLines = lines.slice(startIdx, endIdx);
    const moduleContent = moduleLines.join('\n');
    
    const outputPath = path.join(OUTPUT_DIR, filename);
    
    // 添加文件头注释
    const header = `// ${filename} - ${description}\n// 此文件由 popup.js 拆分而来，请勿手动修改源文件 popup.js\n\n`;
    
    fs.writeFileSync(outputPath, header + moduleContent + '\n', 'utf8');
    
    const lineCount = moduleLines.length;
    totalOutputLines += lineCount;
    console.log(`✓ ${filename.padEnd(22)} 行 ${String(startLine).padStart(4)}-${String(endLine).padEnd(4)} (${lineCount} 行) - ${description}`);
}

console.log(`\n拆分完成！共 ${modules.length} 个模块，${totalOutputLines} 行（源文件 ${lines.length} 行）`);
console.log(`\n下一步：在 popup.html 中用拆分后的模块文件替换 popup.js`);
