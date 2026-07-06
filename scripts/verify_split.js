/**
 * verify_split.js - 验证拆分后的模块拼接是否与原文件一致
 */
const fs = require('fs');
const path = require('path');

const dir = 'f:/Mycode/jsproject/Meow/js/modules';
const origFile = 'f:/Mycode/jsproject/Meow/js/popup.js';

const files = [
    'popup-core.js', 'popup-weather.js', 'popup-calendar.js', 'popup-habits.js',
    'popup-alarms.js', 'popup-finance.js', 'popup-smoking.js', 'popup-events.js',
    'popup-webdav.js', 'popup-charts.js', 'popup-exchange.js', 'popup-2fa.js',
    'popup-ai.js', 'popup-batch.js', 'popup-titlebar.js'
];

// 读取原文件
const orig = fs.readFileSync(origFile, 'utf8');
const origLines = orig.split('\n');

// 拼接所有模块（去掉每个文件头部的 3 行注释）
let combined = '';
for (let i = 0; i < files.length; i++) {
    const content = fs.readFileSync(path.join(dir, files[i]), 'utf8');
    const lines = content.split('\n');
    // 每个文件头部有 2 行注释 + 1 行空行 = 3 行 header
    // 但文件写入时末尾加了 '\n'，会导致多一个空行
    // slice(3) 去掉 header，然后 join
    let body = lines.slice(3).join('\n');
    // 去掉末尾的多余空行（写入时加的）
    if (body.endsWith('\n')) {
        body = body.slice(0, -1);
    }
    combined += body;
    // 如果不是最后一个文件，且 body 不以换行结尾，加一个换行
    if (i < files.length - 1) {
        combined += '\n';
    }
}

const combinedLines = combined.split('\n');

// 比较
let mismatches = 0;
const maxCheck = Math.max(origLines.length, combinedLines.length);
for (let i = 0; i < maxCheck; i++) {
    const o = origLines[i] !== undefined ? origLines[i] : '<undefined>';
    const c = combinedLines[i] !== undefined ? combinedLines[i] : '<undefined>';
    if (o !== c) {
        if (mismatches < 10) {
            console.log(`行 ${i + 1} 不匹配:`);
            console.log(`  原文件: ${JSON.stringify(o)}`);
            console.log(`  拼接后: ${JSON.stringify(c)}`);
        }
        mismatches++;
    }
}

console.log(`\n原文件行数: ${origLines.length}`);
console.log(`拼接后行数: ${combinedLines.length}`);
console.log(`不匹配行数: ${mismatches}`);

if (mismatches === 0) {
    console.log('\n✅ 验证通过！拼接内容与原文件完全一致。');
} else {
    console.log('\n❌ 验证失败！存在不一致。');
}
