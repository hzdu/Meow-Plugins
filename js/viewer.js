document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('id');

    if (!key) {
        showError('无效的备注 ID');
        return;
    }

    try {
        // Try local storage first (where we save now)
        let data = await new Promise(resolve => chrome.storage.local.get([key], resolve));
        if (!data[key]) {
            // Try sync storage (legacy support)
            data = await new Promise(resolve => chrome.storage.sync.get([key], resolve));
        }

        const note = data[key];
        if (!note) {
            showError('找不到该备注，可能已被删除。');
            return;
        }

        renderNote(note);
    } catch (e) {
        console.error(e);
        showError('读取数据出错: ' + e.message);
    }
});

function renderNote(note) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('image-wrapper').style.display = 'block';

    // Set title and meta
    document.title = `${note.title} - Meow 备注`;
    document.getElementById('note-title').textContent = note.title || '无标题';
    document.getElementById('note-meta').textContent = `${note.date} · ${note.url}`;

    // Set Image
    const img = document.getElementById('screenshot-img');
    // Prefer fullImage (screenshot + annotations), fallback to canvasData (just annotations)
    img.src = note.fullImage || note.canvasData;

    // Set Actions
    const visitBtn = document.getElementById('visit-btn');
    visitBtn.href = note.url;
}

function showError(msg) {
    document.getElementById('loading').style.display = 'none';
    const errDiv = document.getElementById('error');
    errDiv.textContent = msg;
    errDiv.style.display = 'block';
}
