document.addEventListener('DOMContentLoaded', function() {

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
    let objectCount = 1;
    let activeObjectId = 1;
    const OBJECT_COLORS = ['#ff6384', '#36a2eb', '#ffce56', '#4bc0c0'];
    let origin = { x: 0, y: 0 };
    let isOriginMode = false;
    let currentFile = null;
    let measuredFps = null;
    
    // ========= HTML要素の取得 =========
    const fileInput = document.getElementById('video-input');
    const videoPlayer = document.getElementById('video-player');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const frameBackBtn = document.getElementById('frame-back-btn');
    const frameForwardBtn = document.getElementById('frame-forward-btn');
    const timeDisplay = document.getElementById('time-display');
    const dataTableBody = document.getElementById('data-table-body');
    const dataTableHead = document.getElementById('data-table-head');
    const videoContainer = document.getElementById('video-container');
    const eventShield = document.getElementById('event-shield');
    const debugOverlay = document.getElementById('debug-overlay');
    const intervalInput = document.getElementById('interval-input');
    const downloadCsvBtn = document.getElementById('download-csv-btn');
    const clearDataBtn = document.getElementById('clear-data-btn');
    const dataModeRadios = document.querySelectorAll('input[name="data-mode"]');
    const setScaleBtn = document.getElementById('set-scale-btn');
    const scaleDisplay = document.getElementById('scale-display');
    const scaleOverlay = document.getElementById('scale-overlay');
    const seekBar = document.getElementById('seek-bar');
    const objectCountSelector = document.getElementById('object-count');
    const objectTabsContainer = document.getElementById('object-tabs');
    const videoInfoPanel = document.getElementById('video-info-panel');
    const videoResolution = document.getElementById('video-resolution');
    const videoSize = document.getElementById('video-size');
    const videoWarning = document.getElementById('video-warning');
    const setOriginBtn = document.getElementById('set-origin-btn');
    const fpsDisplay = document.getElementById('fps-display');
    const rewindBtn = document.getElementById('rewind-btn');
    
    // ========= イベントリスナーの設定 =========
    
    setOriginBtn.addEventListener('click', function() {
        isOriginMode = true;
        alert("原点設定モードを開始します。\n座標系の原点としたい点を動画上でクリックしてください。");
    });

    setScaleBtn.addEventListener('click', function() {
        isScalingMode = true;
        scalePoints = [];
        clearScaleOverlay();
        alert("スケール設定モードを開始します。\n基準となる物体の「始点」をクリックしてください。");
    });

    rewindBtn.addEventListener('click', function() {
        videoPlayer.pause();
        playPauseBtn.textContent = '▶';
        videoPlayer.currentTime = 0;
    });

    seekBar.addEventListener('input', function() {
        videoPlayer.currentTime = seekBar.value;
    });

    videoPlayer.addEventListener('loadedmetadata', function() {
        resetZoomPan();
        scaleRatio = null;
        scaleDisplay.textContent = 'スケール: 未設定';
        seekBar.max = videoPlayer.duration;
        const resolution = `${videoPlayer.videoWidth} x ${videoPlayer.videoHeight}`;
        videoResolution.textContent = `解像度: ${resolution}`;
        if (currentFile) {
            const sizeInMB = (currentFile.size / 1024 / 1024);
            if (videoPlayer.videoWidth > 1920 || sizeInMB > 100) {
                videoWarning.textContent = '警告: 動画のサイズが大きいため、処理が遅くなる可能性があります。';
            } else {
                videoWarning.textContent = '';
            }
        }
        measureFps();
    });

    videoPlayer.addEventListener('timeupdate', function() {
        const currentTime = videoPlayer.currentTime;
        timeDisplay.textContent = `時間: ${currentTime.toFixed(3)} s / フレーム: ${Math.floor(currentTime * (measuredFps || FRAME_RATE))}`;
        if (!isDragging) {
            seekBar.value = currentTime;
        }
    });
    
    objectCountSelector.addEventListener('change', function(event) {
        objectCount = parseInt(event.target.value, 10);
        if (activeObjectId > objectCount) {
            activeObjectId = 1;
        }
        updateObjectTabs();
        updateDataTable();
    });

    eventShield.addEventListener('mouseup', function(event) {
        isDragging = false;
        videoContainer.classList.remove('dragging');
        if (hasDragged || !videoPlayer.paused) { return; }
        
        const rect = videoContainer.getBoundingClientRect();
        const containerX = event.clientX - rect.left;
        const containerY = event.clientY - rect.top;
        const clickedX = (containerX - translateX) / scale;
        const clickedY = (containerY - translateY) / scale;

        if (isOriginMode) {
            origin = { x: clickedX, y: clickedY };
            isOriginMode = false;
            alert(`新しい原点を (x: ${origin.x.toFixed(0)}, y: ${origin.y.toFixed(0)}) pxに設定しました。`);
            updateDataTable();
            return;
        }

        if (isScalingMode) {
            const point = { x: clickedX, y: clickedY };
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
        } else if (isUpdateMode) {
            const newX = clickedX;
            const newY = clickedY;
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
            const originalX = clickedX;
            const originalY = clickedY;
            if (originalX < 0 || originalY < 0 || originalX > videoPlayer.videoWidth || originalY > videoPlayer.videoHeight) { return; }
            const time = videoPlayer.currentTime;
            const point = { t: time, id: activeObjectId, x: originalX, y: originalY };
            if (dataMode === 'overwrite') {
                const existingIndex = trackingData.findIndex(p => p.t.toFixed(3) === time.toFixed(3) && p.id === activeObjectId);
                if (existingIndex !== -1) {
                    trackingData[existingIndex] = point;
                } else {
                    trackingData.push(point);
                }
            } else {
                trackingData.push(point);
            }
            updateDataTable();
            const framesToAdvance = parseInt(intervalInput.value, 10) || 1;
            videoPlayer.currentTime += framesToAdvance / (measuredFps || FRAME_RATE);
        }
    });

    eventShield.addEventListener('mousedown', function(event) { event.preventDefault(); isDragging = true; hasDragged = false; videoContainer.classList.add('dragging'); startMouseX = event.clientX; startMouseY = event.clientY; lastMouseX = event.clientX; lastMouseY = event.clientY; });
    eventShield.addEventListener('mousemove', function(event) { if (isScalingMode && scalePoints.length === 1) { const p1 = scalePoints[0]; const rect = videoContainer.getBoundingClientRect(); const containerX = event.clientX - rect.left; const containerY = event.clientY - rect.top; const currentMousePoint = { x: (containerX - translateX) / scale, y: (containerY - translateY) / scale }; drawScaleLine(p1, currentMousePoint); } if (!isDragging) return; const dxFromStart = Math.abs(event.clientX - startMouseX); const dyFromStart = Math.abs(event.clientY - startMouseY); if (dxFromStart > DRAG_THRESHOLD || dyFromStart > DRAG_THRESHOLD) { hasDragged = true; } const dx = event.clientX - lastMouseX; const dy = event.clientY - lastMouseY; translateX += dx; translateY += dy; lastMouseX = event.clientX; lastMouseY = event.clientY; applyZoomPan(); });
    eventShield.addEventListener('mouseleave', function() { isDragging = false; videoContainer.classList.remove('dragging'); });
    eventShield.addEventListener('wheel', function(event) { event.preventDefault(); const rect = videoContainer.getBoundingClientRect(); const mouseX = event.clientX - rect.left; const mouseY = event.clientY - rect.top; const oldScale = scale; const zoomIntensity = 0.1; const delta = event.deltaY < 0 ? 1 : -1; scale *= (1 + delta * zoomIntensity); scale = Math.max(0.1, Math.min(scale, 10)); translateX = mouseX - (mouseX - translateX) * (scale / oldScale); translateY = mouseY - (mouseY - translateY) * (scale / oldScale); applyZoomPan(); }, { passive: false });
    eventShield.addEventListener('click', function(event) { event.preventDefault(); event.stopPropagation(); }, true);
    dataModeRadios.forEach(radio => { radio.addEventListener('change', function(event) { dataMode = event.target.value; }); });
    clearDataBtn.addEventListener('click', function() { if (trackingData.length === 0) { return; } if (confirm("本当にすべてのデータを消去しますか？\nこの操作は元に戻せません。")) { trackingData = []; updateDataTable(); } });
    fileInput.addEventListener('change', function(event) { const file = event.target.files[0]; if (!file) return; currentFile = file; const fileURL = URL.createObjectURL(file); videoPlayer.src = fileURL; const sizeInMB = (currentFile.size / 1024 / 1024).toFixed(2); videoSize.textContent = `ファイルサイズ: ${sizeInMB} MB`; videoInfoPanel.classList.remove('hidden'); fpsDisplay.textContent = ''; measuredFps = null; trackingData = []; objectCount = 1; objectCountSelector.value = 1; activeObjectId = 1; origin = { x: 0, y: 0 }; updateObjectTabs(); updateDataTable(); resetZoomPan(); });
    playPauseBtn.addEventListener('click', function() { if (videoPlayer.paused) { videoPlayer.play(); playPauseBtn.textContent = '⏸'; } else { videoPlayer.pause(); playPauseBtn.textContent = '▶'; } });
    frameForwardBtn.addEventListener('click', function() { videoPlayer.pause(); playPauseBtn.textContent = '▶'; videoPlayer.currentTime += 1 / (measuredFps || FRAME_RATE); });
    frameBackBtn.addEventListener('click', function() { videoPlayer.pause(); playPauseBtn.textContent = '▶'; videoPlayer.currentTime -= 1 / (measuredFps || FRAME_RATE); });
    downloadCsvBtn.addEventListener('click', function() { if (trackingData.length === 0) { alert('記録されたデータがありません。'); return; } let csvHeader = "Time (s)"; for (let i = 1; i <= objectCount; i++) { csvHeader += `,X${i} (${scaleRatio ? 'm' : 'px'}),Y${i} (${scaleRatio ? 'm' : 'px'})`; } csvHeader += "\n"; const wideData = transformDataToWide(); let csvRows = wideData.map(timeData => { let row = [timeData.time.toFixed(3)]; for (let j = 1; j <= objectCount; j++) { const objData = timeData[`obj${j}`]; if (objData) { const correctedX = objData.x - origin.x; const correctedY = origin.y - objData.y; if (scaleRatio) { row.push((correctedX / scaleRatio).toFixed(5)); row.push((correctedY / scaleRatio).toFixed(5)); } else { row.push(correctedX.toFixed(0)); row.push(correctedY.toFixed(0)); } } else { row.push(''); row.push(''); } } return row.join(','); }).join('\n'); const csvContent = csvHeader + csvRows; const bom = new Uint8Array([0xEF, 0xBB, 0xBF]); const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); const url = URL.createObjectURL(blob); link.setAttribute("href", url); link.setAttribute("download", "tracking_data.csv"); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); });
    dataTableBody.addEventListener('click', function(event) { const target = event.target.closest('button'); if (!target) return; if (target.classList.contains('cell-delete-btn')) { const timeToDelete = parseFloat(target.dataset.time); const idToDelete = parseInt(target.dataset.id, 10); const indexToDelete = trackingData.findIndex(p => Math.abs(p.t - timeToDelete) < 0.0001 && p.id === idToDelete); if (indexToDelete !== -1) { if (confirm(`時刻 ${timeToDelete.toFixed(3)}s の 物体${idToDelete} のデータを削除しますか？`)) { trackingData.splice(indexToDelete, 1); updateDataTable(); } } } if (target.classList.contains('cell-remeasure-btn')) { const timeToUpdate = parseFloat(target.dataset.time); const idToUpdate = parseInt(target.dataset.id, 10); const indexToUpdate = trackingData.findIndex(p => Math.abs(p.t - timeToUpdate) < 0.0001 && p.id === idToUpdate); if (indexToUpdate === -1) return; const pointToUpdate = trackingData[indexToUpdate]; isUpdateMode = true; updateIndex = indexToUpdate; videoPlayer.currentTime = pointToUpdate.t; videoPlayer.pause(); playPauseBtn.textContent = '▶'; activeObjectId = pointToUpdate.id; updateObjectTabs(); updateDataTable(); alert(`再計測モード：物体ID ${pointToUpdate.id}（${pointToUpdate.t.toFixed(3)}秒）\n動画上の正しい位置をクリックしてください。`); } });
    
    // ========= 関数定義 =========
    function applyZoomPan() {videoPlayer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;updateDebugOverlay();clearScaleOverlay();scalePoints.forEach(point => drawScalePoint(point));}
    function resetZoomPan() {scale = 1;translateX = 0;translateY = 0;applyZoomPan();clearScaleOverlay();}
    function updateDebugOverlay() {debugOverlay.textContent = `Scale: ${scale.toFixed(2)}, Translate: (${translateX.toFixed(0)}px, ${translateY.toFixed(0)}px)`;}
    function drawScalePoint(videoPoint) {const svgX = videoPoint.x * scale + translateX;const svgY = videoPoint.y * scale + translateY;const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');circle.setAttribute('cx', svgX);circle.setAttribute('cy', svgY);circle.setAttribute('r', 5);circle.setAttribute('fill', 'red');circle.setAttribute('stroke', 'white');circle.setAttribute('stroke-width', 1);scaleOverlay.appendChild(circle);}
    function drawScaleLine(videoP1, videoP2) {const svgP1_x = videoP1.x * scale + translateX;const svgP1_y = videoP1.y * scale + translateY;const svgP2_x = videoP2.x * scale + translateX;const svgP2_y = videoP2.y * scale + translateY;const existingLine = scaleOverlay.querySelector('line');if (existingLine) { existingLine.remove(); }const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');line.setAttribute('x1', svgP1_x);line.setAttribute('y1', svgP1_y);line.setAttribute('x2', svgP2_x);line.setAttribute('y2', svgP2_y);line.setAttribute('stroke', 'yellow');line.setAttribute('stroke-width', 2);line.setAttribute('stroke-dasharray', '5 5');scaleOverlay.appendChild(line);}
    function clearScaleOverlay() {scaleOverlay.innerHTML = '';}
    function transformDataToWide() {const wideData = new Map();trackingData.forEach(point => {const timeStr = point.t.toFixed(3);if (!wideData.has(timeStr)) {wideData.set(timeStr, { time: point.t });}wideData.get(timeStr)[`obj${point.id}`] = { x: point.x, y: point.y };});return Array.from(wideData.values()).sort((a, b) => a.time - b.time);}
    function updateDataTable() {dataTableHead.innerHTML = '';const headerRow = dataTableHead.insertRow();headerRow.insertCell().textContent = '時間 (s)';for (let i = 1; i <= objectCount; i++) {const th = headerRow.insertCell();th.textContent = `物体${i} (X, Y) [${scaleRatio ? 'm' : 'px'}]`;th.classList.add(`object-${i}-col`);th.style.textAlign = 'center';}
        const wideData = transformDataToWide();dataTableBody.innerHTML = '';for (let i = wideData.length - 1; i >= 0; i--) {const timeData = wideData[i];const row = dataTableBody.insertRow();if (isUpdateMode && trackingData[updateIndex]?.t.toFixed(3) === timeData.time.toFixed(3)) {row.classList.add('updating-row');}row.insertCell().textContent = timeData.time.toFixed(3);for (let j = 1; j <= objectCount; j++) {const cell = row.insertCell();cell.classList.add(`object-${j}-col`);const objData = timeData[`obj${j}`];if (objData) {const correctedX = objData.x - origin.x;const correctedY = origin.y - objData.y;let displayX, displayY;if (scaleRatio) {displayX = (correctedX / scaleRatio).toFixed(3);displayY = (correctedY / scaleRatio).toFixed(3);} else {displayX = correctedX.toFixed(0);displayY = correctedY.toFixed(0);}const cellContent = document.createElement('div');cellContent.className = 'data-cell-content';const coordSpan = document.createElement('span');coordSpan.textContent = `${displayX}, ${displayY}`;const remeasureBtn = document.createElement('button');remeasureBtn.className = 'cell-remeasure-btn';remeasureBtn.textContent = '🎯';remeasureBtn.title = 'このデータを再計測';remeasureBtn.dataset.time = timeData.time;remeasureBtn.dataset.id = j;const deleteBtn = document.createElement('button');deleteBtn.className = 'cell-delete-btn';deleteBtn.textContent = '🗑️';deleteBtn.title = 'このデータを削除';deleteBtn.dataset.time = timeData.time;deleteBtn.dataset.id = j;cellContent.appendChild(coordSpan);cellContent.appendChild(remeasureBtn);cellContent.appendChild(deleteBtn);cell.appendChild(cellContent);} else {cell.textContent = '---';}}}}
    function updateObjectTabs() {objectTabsContainer.innerHTML = '';for (let i = 1; i <= objectCount; i++) {const tabLabel = document.createElement('label');tabLabel.className = 'object-tab';tabLabel.style.borderColor = OBJECT_COLORS[i-1];const radioInput = document.createElement('input');radioInput.type = 'radio';radioInput.name = 'object-tab';radioInput.value = i;if (i === activeObjectId) {radioInput.checked = true;tabLabel.classList.add('active');tabLabel.style.backgroundColor = OBJECT_COLORS[i-1];}
        radioInput.addEventListener('change', function() {activeObjectId = parseInt(this.value, 10);updateObjectTabs();});tabLabel.appendChild(radioInput);tabLabel.appendChild(document.createTextNode(`物体 ${i}`));objectTabsContainer.appendChild(tabLabel);}}
    function measureFps() {
        if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
            fpsDisplay.textContent = ' (fps計測: 非対応ブラウザ)';
            return;
        }
        const wasPaused = videoPlayer.paused;
        if (wasPaused) { videoPlayer.play(); }
        const timestamps = [];
        let frameCount = 0;
        const numberOfFramesToMeasure = 90;
        fpsDisplay.textContent = ' (fps計測中...)';
        const frameCallback = (now, metadata) => {
            timestamps.push(metadata.mediaTime);
            frameCount++;
            if (frameCount < numberOfFramesToMeasure && videoPlayer.currentTime < videoPlayer.duration) {
                videoPlayer.requestVideoFrameCallback(frameCallback);
            } else {
                if (wasPaused) { videoPlayer.pause(); playPauseBtn.textContent = '▶'; }
                if (timestamps.length > 1) {
                    const totalDuration = timestamps[timestamps.length - 1] - timestamps[0];
                    const avgFrameDuration = totalDuration / (timestamps.length - 1);
                    measuredFps = 1 / avgFrameDuration;
                } else {
                    measuredFps = null;
                }
                updateFpsDisplay();
                videoPlayer.currentTime = 0;
            }
        };
        videoPlayer.requestVideoFrameCallback(frameCallback);
    }
    function updateFpsDisplay() { if (measuredFps) { const timePerFrame = 1 / measuredFps; const framesInPointOneSec = 0.1 / timePerFrame; fpsDisplay.textContent = `(実測fps: ${measuredFps.toFixed(1)}    ,    1フレーム: ${timePerFrame.toFixed(3)}s    ,    0.1s≈${framesInPointOneSec.toFixed(1)}フレーム)`; } else { fpsDisplay.textContent = ' (fps計測失敗)'; } }

    // ========= 初期化処理 =========
    updateDebugOverlay();
    updateObjectTabs();
    updateDataTable();
});