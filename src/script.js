// ========= グローバル変数・定数定義 =========
const FRAME_RATE = 30;
const DRAG_THRESHOLD = 5;
let trackingData = [];
let scale = 1.0, translateX = 0, translateY = 0, isDragging = false, lastMouseX = 0, lastMouseY = 0;
let hasDragged = false, startMouseX = 0, startMouseY = 0;
let isUpdateMode = false;
let updateIndex = null;
let dataMode = 'overwrite';
let scaleRatio = null;
let isScalingMode = false;
let scalePoints = [];

// ========= HTML要素の取得 =========
const fileInput = document.getElementById('video-input');
const videoPlayer = document.getElementById('video-player');
const playPauseBtn = document.getElementById('play-pause-btn');
const frameBackBtn = document.getElementById('frame-back-btn');
const frameForwardBtn = document.getElementById('frame-forward-btn');
const timeDisplay = document.getElementById('time-display');
const dataTableBody = document.getElementById('data-table-body');
const videoContainer = document.getElementById('video-container');
const debugOverlay = document.getElementById('debug-overlay');
const intervalInput = document.getElementById('interval-input');
const downloadCsvBtn = document.getElementById('download-csv-btn');
const clearDataBtn = document.getElementById('clear-data-btn');
const dataModeRadios = document.querySelectorAll('input[name="data-mode"]');
const setScaleBtn = document.getElementById('set-scale-btn');
const scaleDisplay = document.getElementById('scale-display');
const scaleOverlay = document.getElementById('scale-overlay');
// OpenCV関連の要素取得を削除

// ========= イベントリスナーの設定 =========

setScaleBtn.addEventListener('click', function() {
    isScalingMode = true;
    scalePoints = [];
    clearScaleOverlay();
    alert("スケール設定モードを開始します。\n基準となる物体の「始点」をクリックしてください。");
});

videoContainer.addEventListener('mouseup', function(event) {
    isDragging = false;
    videoContainer.classList.remove('dragging');

    if (hasDragged || !videoPlayer.paused) {
        return;
    }

    if (isScalingMode) {
        const rect = videoContainer.getBoundingClientRect();
        const containerX = event.clientX - rect.left;
        const containerY = event.clientY - rect.top;
        const point = { x: (containerX - translateX) / scale, y: (containerY - translateY) / scale };

        scalePoints.push(point);
        drawScalePoint(point);

        if (scalePoints.length === 1) {
            alert("始点を設定しました。次に「終点」をクリックしてください。");
        } else if (scalePoints.length === 2) {
            drawScaleLine(scalePoints[0], scalePoints[1]);
            const realDistanceStr = prompt("今クリックした2点間の実際の距離を「メートル(m)」単位で入力してください。", "1.0");

            if (realDistanceStr !== null && !isNaN(realDistanceStr) && Number(realDistanceStr) > 0) {
                const realDistance = Number(realDistanceStr);
                const p1 = scalePoints[0];
                const p2 = scalePoints[1];
                const pixelDistance = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
                scaleRatio = pixelDistance / realDistance;
                scaleDisplay.textContent = `スケール: ${scaleRatio.toFixed(2)} px/m`;
                alert(`スケールを設定しました: ${scaleRatio.toFixed(2)} px/m`);
                updateDataTable();
            } else {
                alert("無効な値です。スケール設定をキャンセルしました。");
            }

            isScalingMode = false;
            scalePoints = [];
            setTimeout(clearScaleOverlay, 100);
        }
        return;
    }

    if (isUpdateMode) {
        const rect = videoContainer.getBoundingClientRect();
        const containerX = event.clientX - rect.left;
        const containerY = event.clientY - rect.top;
        const newX = (containerX - translateX) / scale;
        const newY = (containerY - translateY) / scale;
        trackingData[updateIndex].x = newX;
        trackingData[updateIndex].y = newY;
        isUpdateMode = false;
        updateIndex = null;
        updateDataTable();
        const message = "データを更新しました。\n\n[OK] を押すと、最新の計測時間に戻ります。\n[キャンセル] を押すと、この時間から続けて計測します。";
        if (confirm(message)) {
            if (trackingData.length > 0) {
                const lastTime = trackingData[trackingData.length - 1].t;
                videoPlayer.currentTime = lastTime;
            }
        }
    } else {
        const rect = videoContainer.getBoundingClientRect();
        const containerX = event.clientX - rect.left;
        const containerY = event.clientY - rect.top;
        const originalX = (containerX - translateX) / scale;
        const originalY = (containerY - translateY) / scale;
        if (originalX < 0 || originalY < 0 || originalX > videoPlayer.videoWidth || originalY > videoPlayer.videoHeight) { return; }
        const time = videoPlayer.currentTime;
        if (dataMode === 'overwrite') {
            const existingIndex = trackingData.findIndex(p => p.t === time);
            if (existingIndex !== -1) {
                trackingData[existingIndex].x = originalX;
                trackingData[existingIndex].y = originalY;
            } else {
                trackingData.push({ t: time, x: originalX, y: originalY });
            }
        } else {
            trackingData.push({ t: time, x: originalX, y: originalY });
        }
        trackingData.sort((a, b) => a.t - b.t);
        updateDataTable();
        const framesToAdvance = parseInt(intervalInput.value, 10) || 1;
        videoPlayer.currentTime += framesToAdvance / FRAME_RATE;
    }
});

videoContainer.addEventListener('mousemove', function(event) {
    if (isScalingMode && scalePoints.length === 1) {
        const p1 = scalePoints[0];
        const rect = videoContainer.getBoundingClientRect();
        const containerX = event.clientX - rect.left;
        const containerY = event.clientY - rect.top;
        const currentMousePoint = { x: (containerX - translateX) / scale, y: (containerY - translateY) / scale };
        drawScaleLine(p1, currentMousePoint);
    }
    if (!isDragging) return;
    const dxFromStart = Math.abs(event.clientX - startMouseX);
    const dyFromStart = Math.abs(event.clientY - startMouseY);
    if (dxFromStart > DRAG_THRESHOLD || dyFromStart > DRAG_THRESHOLD) { hasDragged = true; }
    const dx = event.clientX - lastMouseX;
    const dy = event.clientY - lastMouseY;
    translateX += dx;
    translateY += dy;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    applyZoomPan();
});

dataModeRadios.forEach(radio => { radio.addEventListener('change', function(event) { dataMode = event.target.value; }); });
dataTableBody.addEventListener('click', function(event) { const target = event.target; if (target.classList.contains('delete-row-btn')) { const indexToDelete = parseInt(target.dataset.index, 10); if (confirm(`${trackingData[indexToDelete].t.toFixed(3)}秒のデータを本当に削除しますか？`)) { trackingData.splice(indexToDelete, 1); updateDataTable(); } } if (target.classList.contains('remeasure-row-btn')) { const indexToUpdate = parseInt(target.dataset.index, 10); const pointToUpdate = trackingData[indexToUpdate]; isUpdateMode = true; updateIndex = indexToUpdate; videoPlayer.currentTime = pointToUpdate.t; videoPlayer.pause(); playPauseBtn.textContent = '▶'; updateDataTable(); alert(`再計測モード：時間 ${pointToUpdate.t.toFixed(3)} 秒\n動画上の正しい位置をクリックしてください。`); } });
clearDataBtn.addEventListener('click', function() { if (trackingData.length === 0) { return; } if (confirm("本当にすべてのデータを消去しますか？\nこの操作は元に戻せません。")) { trackingData = []; updateDataTable(); } });
downloadCsvBtn.addEventListener('click', function() { if (trackingData.length === 0) { alert('記録されたデータがありません。'); return; } const header = scaleRatio ? "Time (s),X (m),Y (m)\n" : "Time (s),X (px),Y (px)\n"; let csvContent = header; trackingData.forEach(point => { let valX, valY; if (scaleRatio) { valX = (point.x / scaleRatio).toFixed(5); valY = (point.y / scaleRatio).toFixed(5); } else { valX = point.x.toFixed(0); valY = point.y.toFixed(0); } const row = `${point.t.toFixed(3)},${valX},${valY}`; csvContent += row + "\n"; }); const bom = new Uint8Array([0xEF, 0xBB, 0xBF]); const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); const url = URL.createObjectURL(blob); link.setAttribute("href", url); link.setAttribute("download", "tracking_data.csv"); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); });
fileInput.addEventListener('change', function(event) { const file = event.target.files[0]; if (file) { const fileURL = URL.createObjectURL(file); videoPlayer.src = fileURL; trackingData = []; updateDataTable(); resetZoomPan(); } });
videoPlayer.addEventListener('loadedmetadata', function() { resetZoomPan(); scaleRatio = null; scaleDisplay.textContent = 'スケール: 未設定'; });
playPauseBtn.addEventListener('click', function() { if (videoPlayer.paused) { videoPlayer.play(); playPauseBtn.textContent = '⏸'; } else { videoPlayer.pause(); playPauseBtn.textContent = '▶'; } });
frameForwardBtn.addEventListener('click', function() { videoPlayer.pause(); playPauseBtn.textContent = '▶'; videoPlayer.currentTime += 1 / FRAME_RATE; });
frameBackBtn.addEventListener('click', function() { videoPlayer.pause(); playPauseBtn.textContent = '▶'; videoPlayer.currentTime -= 1 / FRAME_RATE; });
videoPlayer.addEventListener('timeupdate', function() { const currentTime = videoPlayer.currentTime; const currentFrame = Math.floor(currentTime * FRAME_RATE); timeDisplay.textContent = `時間: ${currentTime.toFixed(3)} s / フレーム: ${currentFrame}`; });
videoContainer.addEventListener('wheel', function(event) { event.preventDefault(); const rect = videoContainer.getBoundingClientRect(); const mouseX = event.clientX - rect.left; const mouseY = event.clientY - rect.top; const oldScale = scale; const zoomIntensity = 0.1; const delta = event.deltaY < 0 ? 1 : -1; scale *= (1 + delta * zoomIntensity); scale = Math.max(0.1, Math.min(scale, 10)); translateX = mouseX - (mouseX - translateX) * (scale / oldScale); translateY = mouseY - (mouseY - translateY) * (scale / oldScale); applyZoomPan(); }, { passive: false });
videoContainer.addEventListener('mousedown', function(event) { event.preventDefault(); isDragging = true; hasDragged = false; videoContainer.classList.add('dragging'); startMouseX = event.clientX; startMouseY = event.clientY; lastMouseX = event.clientX; lastMouseY = event.clientY; });
videoContainer.addEventListener('mousemove', function(event) {if (isScalingMode && scalePoints.length === 1) {const p1 = scalePoints[0];const rect = videoContainer.getBoundingClientRect();const containerX = event.clientX - rect.left;const containerY = event.clientY - rect.top;const currentMousePoint = { x: (containerX - translateX) / scale, y: (containerY - translateY) / scale };drawScaleLine(p1, currentMousePoint);}if (!isDragging) return;const dxFromStart = Math.abs(event.clientX - startMouseX);const dyFromStart = Math.abs(event.clientY - startMouseY);if (dxFromStart > DRAG_THRESHOLD || dyFromStart > DRAG_THRESHOLD) { hasDragged = true; }const dx = event.clientX - lastMouseX;const dy = event.clientY - lastMouseY;translateX += dx;translateY += dy;lastMouseX = event.clientX;lastMouseY = event.clientY;applyZoomPan();});
videoContainer.addEventListener('mouseleave', function() { isDragging = false; videoContainer.classList.remove('dragging'); });
videoContainer.addEventListener('click', function(event) { event.preventDefault(); event.stopPropagation(); }, true);

// ========= 関数定義 =========
function applyZoomPan() {videoPlayer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;updateDebugOverlay();}
function resetZoomPan() {scale = 1;translateX = 0;translateY = 0;applyZoomPan();clearScaleOverlay();}
function updateDebugOverlay() {debugOverlay.textContent = `Scale: ${scale.toFixed(2)}, Translate: (${translateX.toFixed(0)}px, ${translateY.toFixed(0)}px)`;}
function updateDataTable() {dataTableBody.innerHTML = '';for (let i = trackingData.length - 1; i >= 0; i--) {const point = trackingData[i];const row = dataTableBody.insertRow();if (isUpdateMode && i === updateIndex) { row.classList.add('updating-row'); }let displayX, displayY;if (scaleRatio) {displayX = (point.x / scaleRatio).toFixed(3);displayY = (point.y / scaleRatio).toFixed(3);} else {displayX = point.x.toFixed(0);displayY = point.y.toFixed(0);}row.insertCell().textContent = point.t.toFixed(3);row.insertCell().textContent = displayX;row.insertCell().textContent = displayY;const actionCell = row.insertCell();const remeasureBtn = document.createElement('button');remeasureBtn.textContent = '再計測';remeasureBtn.className = 'remeasure-row-btn';remeasureBtn.dataset.index = i;actionCell.appendChild(remeasureBtn);const deleteBtn = document.createElement('button');deleteBtn.textContent = '削除';deleteBtn.className = 'delete-row-btn';deleteBtn.dataset.index = i;actionCell.appendChild(deleteBtn);}}
function drawScalePoint(videoPoint) {const svgX = videoPoint.x * scale + translateX;const svgY = videoPoint.y * scale + translateY;const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');circle.setAttribute('cx', svgX);circle.setAttribute('cy', svgY);circle.setAttribute('r', 5);circle.setAttribute('fill', 'red');circle.setAttribute('stroke', 'white');circle.setAttribute('stroke-width', 1);scaleOverlay.appendChild(circle);}
function drawScaleLine(videoP1, videoP2) {const svgP1_x = videoP1.x * scale + translateX;const svgP1_y = videoP1.y * scale + translateY;const svgP2_x = videoP2.x * scale + translateX;const svgP2_y = videoP2.y * scale + translateY;const existingLine = scaleOverlay.querySelector('line');if (existingLine) { existingLine.remove(); }const line = document.createElementNS('http://www.w.org/2000/svg', 'line');line.setAttribute('x1', svgP1_x);line.setAttribute('y1', svgP1_y);line.setAttribute('x2', svgP2_x);line.setAttribute('y2', svgP2_y);line.setAttribute('stroke', 'yellow');line.setAttribute('stroke-width', 2);line.setAttribute('stroke-dasharray', '5 5');scaleOverlay.appendChild(line);}
function clearScaleOverlay() {scaleOverlay.innerHTML = '';}

// ========= 初期化処理 =========
updateDebugOverlay();