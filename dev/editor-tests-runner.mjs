import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9441;
const URL = process.argv[2];
const SHOT = process.argv[3];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'edrun-'));
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--window-size=420,900', 'about:blank'], { stdio: 'ignore' });
let id = 0; const pending = new Map(); let ws;
const send = (m, p = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + m)); } }, 40000);
});
const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'EXCEPTION: ' + r.result.exceptionDetails.text;
    return r.result && r.result.result ? r.result.result.value : undefined;
};
try {
    let url;
    for (let i = 0; i < 60 && !url; i++) {
        try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p) url = p.webSocketDebuggerUrl; } catch (e) { }
        if (!url) await sleep(200);
    }
    ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.res(m); } };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    let t = '';
    for (let i = 0; i < 80; i++) { await sleep(400); t = await ev('document.title') || ''; if (t.indexOf('DONE') === 0) break; }
    console.log('TITLE: ' + t);
    console.log(await ev('document.getElementById("OUT").textContent'));
    console.log('PAGE ERRORS: ' + ((await ev('window.__errs.join("\\n")')) || '(none)'));
    if (SHOT) {
        const s = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(SHOT, Buffer.from(s.result.data, 'base64'));
        console.log('SHOT: ' + SHOT);
    }
} catch (e) { console.error('RUNNER ERR ' + (e.stack || e)); process.exitCode = 1; }
finally { try { ws.close(); } catch (e) { } try { proc.kill(); } catch (e) { } await sleep(300); }
