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
    let exactMediaTime = 0;
    let isCallbackRegistered = false;
    
    // ========= HTML要素の取得 =========
    const fileInput = document.getElementById('video-input');
    const videoPlayer = document.getElementById('video-player');
    const timeDisplay = document.getElementById('time-display');
    const dataTableBody = document.getElementById('data-table-body');
    const dataTableHead = document.getElementById('data-table-head');
    const videoContainer = document.getElementById('video-container');
    const eventShield = document.getElementById('event-shield');
    const debugOverlay = document.getElementById('debug-overlay');
    const intervalInput = document.getElementById('interval-input');
    
    // 新しい2段ボタンの取得
    const rewindBtn = document.getElementById('rewind-btn');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const goEndBtn = document.getElementById('go-end-btn');
    const stepBackNBtn = document.getElementById('step-back-n-btn');
    const frameBackBtn = document.getElementById('frame-back-btn');
    const frameForwardBtn = document.getElementById('frame-forward-btn');
    const stepForwardNBtn = document.getElementById('step-forward-n-btn');

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

    // ========= イベントリスナーの設定 =========

    if (intervalMinusBtn && intervalInput) {
        intervalMinusBtn.addEventListener('click', function(e) {
            e.preventDefault();
            let val = parseInt(intervalInput.value, 10);
            if (isNaN(val)) val = 1;
            if (val > 1) intervalInput.value = val - 1;
        });
    }

    if (intervalPlusBtn && intervalInput) {
        intervalPlusBtn.addEventListener('click', function(e) {
            e.preventDefault();
            let val = parseInt(intervalInput.value, 10);
            if (isNaN(val)) val = 1;
            intervalInput.value = val + 1;
        });
    }

    fileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (!file) return;
        currentFile = file;
        videoPlayer.src = URL.createObjectURL(file);
        videoSize.textContent = `ファイルサイズ: ${(file.size / 1024 / 1024).toFixed(2)} MB`;
        videoInfoPanel.classList.remove('hidden');
        trackingData = [];
        updateObjectTabs();
        updateDataTable();
        resetZoomPan();
    });

    // ▼ 新しい操作ボタンの処理 ▼
    rewindBtn.addEventListener('click', () => {
        videoPlayer.pause();
        videoPlayer.currentTime = 0;
    });

    playBtn.addEventListener('click', () => {
        videoPlayer.play();
    });

    pauseBtn.addEventListener('click', () => {
        videoPlayer.pause();
    });

    goEndBtn.addEventListener('click', () => {
        videoPlayer.pause();
        videoPlayer.currentTime = videoPlayer.duration;
    });

    stepBackNBtn.addEventListener('click', () => {
        videoPlayer.pause();
        let n = parseInt(intervalInput.value, 10) || 1;
        videoPlayer.currentTime -= n / (measuredFps || FRAME_RATE);
    });

    frameBackBtn.addEventListener('click', () => {
        videoPlayer.pause();
        videoPlayer.currentTime -= 1 / (measuredFps || FRAME_RATE);
    });

    frameForwardBtn.addEventListener('click', () => {
        videoPlayer.pause();
        videoPlayer.currentTime += 1 / (measuredFps || FRAME_RATE);
    });

    stepForwardNBtn.addEventListener('click', () => {
        videoPlayer.pause();
        let n = parseInt(intervalInput.value, 10) || 1;
        videoPlayer.currentTime += n / (measuredFps || FRAME_RATE);
    });
    // ▲ ここまで ▲

    dataModeRadios.forEach(radio => { 
        radio.addEventListener('change', function(event) { 
            dataMode = event.target.value; 
        }); 
    });

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

        if ('requestVideoFrameCallback' in HTMLVideoElement.prototype && !isCallbackRegistered) {
            const updateFrameMetadata = (now, metadata) => {
                exactMediaTime = metadata.mediaTime;
                videoPlayer.requestVideoFrameCallback(updateFrameMetadata);
            };
            videoPlayer.requestVideoFrameCallback(updateFrameMetadata);
            isCallbackRegistered = true;
        }
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
    
    // ▼ CSV出力の修正：生徒に不要な列を削除し、時間・X・Yのみを出力 ▼
    downloadCsvBtn.addEventListener('click', function() {
        if (trackingData.length === 0) return;
        
        let csv = "Time (s)";
        if (objectCount === 1) {
            csv += `,X ${scaleRatio ? '(m)' : '(px)'},Y ${scaleRatio ? '(m)' : '(px)'}\n`;
        } else {
            for (let i = 1; i <= objectCount; i++) {
                csv += `,X${i} ${scaleRatio ? '(m)' : '(px)'},Y${i} ${scaleRatio ? '(m)' : '(px)'}`;
            }
            csv += "\n";
        }

        let timeMap = new Map();
        trackingData.forEach(p => {
            let tStr = p.t.toFixed(4);
            if (!timeMap.has(tStr)) timeMap.set(tStr, { time: p.t });
            timeMap.get(tStr)[`obj${p.id}`] = p;
        });
        
        let sortedTimes = Array.from(timeMap.values()).sort((a, b) => a.time - b.time);

        sortedTimes.forEach(rowObj => {
            csv += `${rowObj.time.toFixed(4)}`;
            for (let i = 1; i <= objectCount; i++) {
                let p = rowObj[`obj${i}`];
                if (p) {
                    const cx = p.x - origin.x;
                    const cy = origin.y - p.y;
                    const xm = scaleRatio ? (cx / scaleRatio).toFixed(5) : cx.toFixed(1);
                    const ym = scaleRatio ? (cy / scaleRatio).toFixed(5) : cy.toFixed(1);
                    csv += `,${xm},${ym}`;
                } else {
                    csv += `,,`;
                }
            }
            csv += "\n";
        });

        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "tracking_data.csv";
        a.click();
    });

    clearDataBtn.addEventListener('click', function() { if (confirm("全データを消去しますか？")) { trackingData = []; updateDataTable(); } });

    dataTableBody.addEventListener('click', function(event) {
        const target = event.target.closest('button');
        if (!target) return;
        const time = parseFloat(target.dataset.time);
        const id = parseInt(target.dataset.id, 10);
        const index = trackingData.findIndex(p => Math.abs(p.t - time) < 0.001 && p.id === id);
        if (index === -1) return;
        
        if (target.classList.contains('cell-delete-btn')) {
            if (confirm("削除しますか？")) {
                trackingData.splice(index, 1);
                updateDataTable();
            }
        } else if (target.classList.contains('cell-remeasure-btn')) {
            isUpdateMode = true;
            updateIndex = index;
            videoPlayer.currentTime = time;
            videoPlayer.pause();
            activeObjectId = id;
            updateObjectTabs();
            updateDataTable();
            alert("再計測モードです。\n動画上の正しい位置をクリックしてください。");
        }
    });

    // ========= 関数定義 =========
    function applyZoomPan() { videoPlayer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`; updateDebugOverlay(); clearScaleOverlay(); scalePoints.forEach(p => drawScalePoint(p)); }
    function resetZoomPan() { scale = 1; translateX = 0; translateY = 0; applyZoomPan(); }
    function updateDebugOverlay() { debugOverlay.textContent = `Zoom: ${scale.toFixed(2)}`; }
    function drawScalePoint(p) { const svgP = { x: p.x * scale + translateX, y: p.y * scale + translateY }; const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('cx', svgP.x); c.setAttribute('cy', svgP.y); c.setAttribute('r', 5); c.setAttribute('fill', 'red'); scaleOverlay.appendChild(c); }
    function drawScaleLine(p1, p2) { const svgP1 = { x: p1.x * scale + translateX, y: p1.y * scale + translateY }; const svgP2 = { x: p2.x * scale + translateX, y: p2.y * scale + translateY }; const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('x1', svgP1.x); l.setAttribute('y1', svgP1.y); l.setAttribute('x2', svgP2.x); l.setAttribute('y2', svgP2.y); l.setAttribute('stroke', 'yellow'); l.setAttribute('stroke-width', 2); scaleOverlay.appendChild(l); }
    function clearScaleOverlay() { scaleOverlay.innerHTML = ''; }
    
    // ▼ データテーブルの修正：不要な情報を削り、時間・座標・操作のみにする ▼
    function updateDataTable() {
        dataTableHead.innerHTML = `<tr><th>時間(s)</th><th>座標 ${scaleRatio ? '(m)' : '(px)'}</th><th>操作</th></tr>`;
        dataTableBody.innerHTML = '';
        for (let id = 1; id <= objectCount; id++) {
            const objPoints = trackingData.filter(p => p.id === id).sort((a, b) => a.t - b.t);
            objPoints.forEach((p) => {
                const row = dataTableBody.insertRow();
                if (isUpdateMode && updateIndex !== null && trackingData[updateIndex] === p) {
                    row.classList.add('updating-row');
                }
                
                // 複数物体をトラッキングした際に見分けがつくよう、行の左端に細い色線を入れます
                row.style.borderLeft = `5px solid ${OBJECT_COLORS[id-1]}`;
                
                row.insertCell().textContent = p.t.toFixed(4);
                const x = scaleRatio ? ((p.x - origin.x)/scaleRatio).toFixed(4) : (p.x - origin.x).toFixed(1);
                const y = scaleRatio ? ((origin.y - p.y)/scaleRatio).toFixed(4) : (origin.y - p.y).toFixed(1);
                row.insertCell().textContent = `(${x}, ${y})`;
                
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

    // 初期化処理
    updateObjectTabs();
    updateDataTable();
});