const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// 用法：bun dev/_run_drag_test.js [预览页路径] [状态表达式]
const pageArg = process.argv[2] || 'dev/server-drag-preview.html';
const stateExpr = process.argv[3] || 'typeof setupSrvCardDrag + " | " + (window.__done?1:0) + " | " + (window.__failed||0)';
const fileUrl = 'file:///' + path.resolve(pageArg).replace(/\\/g, '/');
const port = 9334;

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'edgeprof-')),
  '--allow-file-access-from-files',
  'about:blank'
], { stdio: 'ignore' });

function getJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
async function waitFor(fn, ms = 20000) {
  const s = Date.now();
  for (;;) {
    try { const r = await fn(); if (r) return r; } catch (_) {}
    if (Date.now() - s > ms) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 250));
  }
}

(async () => {
  const ver = await waitFor(() => getJson('/json/version'));
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push('CONSOLE ' + m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}, sessionId) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); });

  const { result: t } = await send('Target.createTarget', { url: fileUrl });
  const { result: att } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = att.sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await new Promise(r => setTimeout(r, 2500));

  const { result: r1 } = await send('Runtime.evaluate', { expression: stateExpr, returnByValue: true }, sid);
  const { result: r2 } = await send('Runtime.evaluate', { expression: 'document.getElementById("test-log").textContent', returnByValue: true }, sid);
  console.log('STATE:', r1.result.value);
  console.log(r2.result.value || '(空 log)');
  if (logs.length) console.log('\n--- 控制台 ---\n' + logs.join('\n'));
  ws.close(); child.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); child.kill(); process.exit(2); });
