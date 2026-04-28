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

    // 精密な時刻管理用変数
    let exactMediaTime = 0;
    
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
    
    // ▼ iPad対応用に追加したボタン ▼
    const intervalMinusBtn = document.getElementById('interval-minus-btn');
    const intervalPlusBtn = document.getElementById('interval-plus-btn');

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
    
    // ========= 表示中フレームの正確な時刻の監視 =========
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        const updateFrameMetadata = (now, metadata) => {
            exactMediaTime = metadata.mediaTime;
            videoPlayer.requestVideoFrameCallback(updateFrameMetadata);
        };
        videoPlayer.requestVideoFrameCallback(updateFrameMetadata);
    }

    // ========= イベントリスナーの設定 =========

    // ▼ iPad対応用の「-」「+」ボタンの処理 ▼
    if (intervalMinusBtn) {
        intervalMinusBtn.addEventListener('click', function() {
            let val = parseInt(intervalInput.value, 10) || 1;
            if (val > 1) {
                intervalInput.value = val - 1;
            }
        });
    }

    if (intervalPlusBtn) {
        intervalPlusBtn.addEventListener('click', function() {
            let val = parseInt(intervalInput.value, 10) || 1;
            intervalInput.value = val + 1;
        });
    }

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
                videoWarning.textContent = '警告: 動画のサイズが大きいため，処理が遅くなる可能性があります。';
            } else {
                videoWarning.textContent = '';
            }
        }
        measureFps();
    });

    videoPlayer.addEventListener('timeupdate', function() {
        const currentTime = videoPlayer.currentTime;
        timeDisplay.textContent = `時間: ${currentTime.toFixed(4)} s / フレーム(推定): ${Math.floor(currentTime * (measuredFps || FRAME_RATE))}`;
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
            if (confirm("データを更新しました。最新の計測時間に戻りますか？")) {
                if (trackingData.length > 0) {
                    videoPlayer.currentTime = trackingData[trackingData.length - 1].t;
                }
            }
        } else {
            const time = (exactMediaTime > 0 && Math.abs(exactMediaTime - videoPlayer.currentTime) < 0.1) 
                         ? exactMediaTime 
                         : videoPlayer.currentTime;
            
            const point = { t: time, id: activeObjectId, x: clickedX, y: clickedY };
            
            if (dataMode === 'overwrite') {
                const existingIndex = trackingData.findIndex(p => Math.abs(p.t - time) < 0.001 && p.id === activeObjectId);
                if (existingIndex !== -1) {
                    trackingData[existingIndex] = point;
                } else {
                    trackingData.push(point);
                }
            } else {
                trackingData.push(point);
            }
            trackingData.sort((a, b) => a.t - b.t);
            updateDataTable();
            
            const framesToAdvance = parseInt(intervalInput.value, 10) || 1;
            videoPlayer.currentTime += framesToAdvance / (measuredFps || FRAME_RATE);
        }
    });

    eventShield.addEventListener('mousedown', function(event) { event.preventDefault(); isDragging = true; hasDragged = false; videoContainer.classList.add('dragging'); lastMouseX = event.clientX; lastMouseY = event.clientY; startMouseX = event.clientX; startMouseY = event.clientY; });
    eventShield.addEventListener('mousemove', function(event) { if (isScalingMode && scalePoints.length === 1) { const p1 = scalePoints[0]; const rect = videoContainer.getBoundingClientRect(); const currentMousePoint = { x: (event.clientX - rect.left - translateX) / scale, y: (event.clientY - rect.top - translateY) / scale }; drawScaleLine(p1, currentMousePoint); } if (!isDragging) return; if (Math.abs(event.clientX - startMouseX) > DRAG_THRESHOLD || Math.abs(event.clientY - startMouseY) > DRAG_THRESHOLD) { hasDragged = true; } const dx = event.clientX - lastMouseX; const dy = event.clientY - lastMouseY; translateX += dx; translateY += dy; lastMouseX = event.clientX; lastMouseY = event.clientY; applyZoomPan(); });
    eventShield.addEventListener('wheel', function(event) { event.preventDefault(); const rect = videoContainer.getBoundingClientRect(); const mouseX = event.clientX - rect.left; const mouseY = event.clientY - rect.top; const oldScale = scale; scale *= (event.deltaY < 0 ? 1.1 : 0.9); scale = Math.max(0.1, Math.min(scale, 10)); translateX = mouseX - (mouseX - translateX) * (scale / oldScale); translateY = mouseY - (mouseY - translateY) * (scale / oldScale); applyZoomPan(); }, { passive: false });
    
    downloadCsvBtn.addEventListener('click', function() {
        if (trackingData.length === 0) return;
        let csv = "Time (s),Object ID,X (m),Y (m),Delta T (s),Velocity (m/s)\n";
        for (let id = 1; id <= objectCount; id++) {
            const objPoints = trackingData.filter(p => p.id === id).sort((a, b) => a.t - b.t);
            objPoints.forEach((p, index) => {
                const cx = p.x - origin.x;
                const cy = origin.y - p.y;
                let dt = "", vel = "";
                if (index > 0) {
                    const prev = objPoints[index - 1];
                    dt = (p.t - prev.t).toFixed(6);
                    if (scaleRatio && parseFloat(dt) > 0) {
                        const d = Math.sqrt(Math.pow(p.x - prev.x, 2) + Math.pow(p.y - prev.y, 2)) / scaleRatio;
                        vel = (d / parseFloat(dt)).toFixed(4);
                    }
                }
                const xm = scaleRatio ? (cx / scaleRatio).toFixed(6) : cx.toFixed(1);
                const ym = scaleRatio ? (cy / scaleRatio).toFixed(6) : cy.toFixed(1);
                csv += `${p.t.toFixed(6)},${p.id},${xm},${ym},${dt},${vel}\n`;
            });
        }
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "analysis_data.csv";
        a.click();
    });

    clearDataBtn.addEventListener('click', function() { if (confirm("全データを消去しますか？")) { trackingData = []; updateDataTable(); } });

    // ========= 関数定義 =========
    function applyZoomPan() { videoPlayer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`; updateDebugOverlay(); clearScaleOverlay(); scalePoints.forEach(p => drawScalePoint(p)); }
    function resetZoomPan() { scale = 1; translateX = 0; translateY = 0; applyZoomPan(); }
    function updateDebugOverlay() { debugOverlay.textContent = `Zoom: ${scale.toFixed(2)}`; }
    function drawScalePoint(p) { const svgP = { x: p.x * scale + translateX, y: p.y * scale + translateY }; const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('cx', svgP.x); c.setAttribute('cy', svgP.y); c.setAttribute('r', 5); c.setAttribute('fill', 'red'); scaleOverlay.appendChild(c); }
    function drawScaleLine(p1, p2) { const svgP1 = { x: p1.x * scale + translateX, y: p1.y * scale + translateY }; const svgP2 = { x: p2.x * scale + translateX, y: p2.y * scale + translateY }; const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('x1', svgP1.x); l.setAttribute('y1', svgP1.y); l.setAttribute('x2', svgP2.x); l.setAttribute('y2', svgP2.y); l.setAttribute('stroke', 'yellow'); l.setAttribute('stroke-width', 2); scaleOverlay.appendChild(l); }
    function clearScaleOverlay() { scaleOverlay.innerHTML = ''; }
    
    function updateDataTable() {
        dataTableHead.innerHTML = '<tr><th>時間(s)</th><th>ID</th><th>座標(m)</th><th>Δt(s)</th><th>速度(m/s)</th><th>操作</th></tr>';
        dataTableBody.innerHTML = '';
        for (let id = 1; id <= objectCount; id++) {
            const objPoints = trackingData.filter(p => p.id === id).sort((a, b) => a.t - b.t);
            objPoints.forEach((p, index) => {
                let dt = "---", vel = "---";
                if (index > 0) {
                    const prev = objPoints[index - 1];
                    const diffT = p.t - prev.t;
                    dt = diffT.toFixed(4);
                    if (scaleRatio && diffT > 0) {
                        const d = Math.sqrt(Math.pow(p.x - prev.x, 2) + Math.pow(p.y - prev.y, 2)) / scaleRatio;
                        vel = (d / diffT).toFixed(3);
                    }
                }
                const row = dataTableBody.insertRow();
                row.insertCell().textContent = p.t.toFixed(4);
                row.insertCell().textContent = p.id;
                const x = scaleRatio ? ((p.x - origin.x)/scaleRatio).toFixed(4) : (p.x - origin.x).toFixed(1);
                const y = scaleRatio ? ((origin.y - p.y)/scaleRatio).toFixed(4) : (origin.y - p.y).toFixed(1);
                row.insertCell().textContent = `(${x}, ${y})`;
                row.insertCell().textContent = dt;
                row.insertCell().textContent = vel;
                const opt = row.insertCell();
                opt.innerHTML = `<button class="cell-remeasure-btn" data-time="${p.t}" data-id="${p.id}">🎯</button><button class="cell-delete-btn" data-time="${p.t}" data-id="${p.id}">🗑️</button>`;
            });
        }
    }

    function updateObjectTabs() {
        objectTabsContainer.innerHTML = '';
        for (let i = 1; i <= objectCount; i++) {
            const btn = document.createElement('button');
            btn.className = `object-tab ${i === activeObjectId ? 'active' : ''}`;
            btn.textContent = `物体 ${i}`;
            btn.style.borderBottom = `4px solid ${OBJECT_COLORS[i-1]}`;
            btn.onclick = () => { activeObjectId = i; updateObjectTabs(); };
            objectTabsContainer.appendChild(btn);
        }
    }

    function measureFps() {
        if (!videoPlayer.requestVideoFrameCallback) { fpsDisplay.textContent = "(fps計測非対応ブラウザ)"; return; }
        const timestamps = [];
        const callback = (now, metadata) => {
            timestamps.push(metadata.mediaTime);
            if (timestamps.length < 60) videoPlayer.requestVideoFrameCallback(callback);
            else {
                const avg = (timestamps[timestamps.length-1] - timestamps[0]) / (timestamps.length-1);
                measuredFps = 1 / avg;
                updateFpsDisplay();
            }
        };
        videoPlayer.requestVideoFrameCallback(callback);
    }
    function updateFpsDisplay() {
        fpsDisplay.textContent = `(実測fps: ${measuredFps.toFixed(1)}   ,   1フレーム: ${(1/measuredFps).toFixed(4)}s   ,   0.1s ≈ ${(0.1*measuredFps).toFixed(1)}フレーム)`;
    }

    updateObjectTabs();
    updateDataTable();
});