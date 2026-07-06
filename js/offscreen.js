// js/offscreen.js - 模拟下课铃声 (威斯敏斯特钟声)

let audioCtx = null;
let isPlaying = false;
let loopTimeoutId = null;

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'play-alarm') {
        if (!isPlaying) {
            isPlaying = true;
            startMelodyLoop();
        }
    } else if (msg.action === 'stop-alarm') {
        stopAlarm();
    }
});

async function startMelodyLoop() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // 确保 AudioContext 处于 running 状态，否则 oscillator.start() 会静默失败
    if (audioCtx.state === 'suspended') {
        try {
            await audioCtx.resume();
        } catch (e) {
            console.error('AudioContext resume failed:', e);
        }
    }

    // 立即播放一次
    playWestminsterChime();

    // 每 9 秒循环一次 (旋律大概持续 8 秒)
    loopTimeoutId = setTimeout(startMelodyLoop, 9000);
}

function stopAlarm() {
    isPlaying = false;
    if (loopTimeoutId) {
        clearTimeout(loopTimeoutId);
        loopTimeoutId = null;
    }
    // 停止所有正在发声的振荡器（如果有必要，可以关闭 context，但在 offscreen 中保持开启通常没问题）
    if (audioCtx) {
        audioCtx.suspend();
    }
}

// 播放单个音符
function playNote(freq, startTime, duration = 1.0) {
    if (!audioCtx) return;

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // 使用正弦波或三角形波模拟钟声，比方波更柔和
    oscillator.type = 'triangle'; 
    oscillator.frequency.value = freq;

    // 音量包络：类似钟声的打击感 (瞬间达到音量，然后缓慢衰减)
    const now = audioCtx.currentTime + startTime;
    
    // 初始静音
    gainNode.gain.setValueAtTime(0, now);
    // 0.05秒达到峰值 (0.3 音量)
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.05);
    // 并在 duration 时间内指数衰减到近乎静音
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

    oscillator.start(now);
    oscillator.stop(now + duration);
}

// 播放威斯敏斯特旋律
function playWestminsterChime() {
    if (!audioCtx) return;
    
    // 基础频率 (E大调)
    const E4 = 329.63;
    const D4 = 293.66;
    const C4 = 261.63; // 这里用 C# 实际上更准，但在 Web Audio 简单模拟用 C 听起来也可以，这里微调成接近学校铃声的调子
    const G3 = 196.00;

    // 修正为更像学校广播的音高 (稍微高一点，更清脆)
    const note_E = 659.25; // E5
    const note_C = 523.25; // C5
    const note_D = 587.33; // D5
    const note_G = 392.00; // G4

    // 经典的 8 音符旋律
    // 第一句: Mi - Do - Re - So (低)
    // 第二句: So (低) - Re - Mi - Do
    
    const now = 0; // 相对当前时间的偏移
    const step = 0.6; // 每个音符的间隔时间

    // 第一小节
    playNote(note_E, now + step * 0, 2.0);
    playNote(note_C, now + step * 1, 2.0);
    playNote(note_D, now + step * 2, 2.0);
    playNote(note_G, now + step * 3, 2.5); // 稍微长一点

    // 停顿一下
    const pause = step * 5;

    // 第二小节
    playNote(note_G, now + pause + step * 0, 2.0);
    playNote(note_D, now + pause + step * 1, 2.0);
    playNote(note_E, now + pause + step * 2, 2.0);
    playNote(note_C, now + pause + step * 3, 3.0); // 尾音拖长
}