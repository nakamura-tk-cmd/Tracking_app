document.addEventListener('DOMContentLoaded', function() {

    // ========= グローバル変数・定数定義 =========
    const FRAME_RATE = 30;
    const DRAG_THRESHOLD = 5;
    let trackingData = [];
    let scale = 1.0, translateX = 0, translateY = 0;
    let isDragging = false, lastMouseX = 0, lastMouseY = 0;
    let hasDragged = false, startMouseX = 0, startMouseY = 0;
    let isUpdateMode = false, updateIndex = null;
    let dataMode = 'overwrite';
    let scaleRatio = null, isScalingMode = false, scalePoints = [];
    let objectCount = 1, activeObjectId = 1;
    const OBJECT_COLORS = ['#ff6384', '#36a2eb', '#ffce56', '#4bc0c0'];
    let origin = { x: 0, y: 0 }, isOriginMode = false;
    let currentFile = null, measuredFps = null;
    let exactMediaTime = 0, isCallbackRegistered = false;

    // タッチズーム用変数
    let initialPinchDist = null;
    let initialPinchScale = 1;
    
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
    const workspace = document.getElementById('workspace');

    // ========= イベントリスナーの設定 =========

    // iPad対応用の「-」「+」ボタン
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

    // 2段ボタン処理
    rewindBtn.addEventListener('click', () => { videoPlayer.pause(); videoPlayer.currentTime = 0; });
    playBtn.addEventListener('click', () => { videoPlayer.play(); });
    pauseBtn.addEventListener('click', () => { videoPlayer.pause(); });
    goEndBtn.addEventListener('click', () => { videoPlayer.pause(); videoPlayer.currentTime = videoPlayer.duration; });
    stepBackNBtn.addEventListener('click', () => { videoPlayer.pause(); let n = parseInt(intervalInput.value, 10) || 1; videoPlayer.currentTime -= n / (measuredFps || FRAME_RATE); });
    frameBackBtn.addEventListener('click', () => { videoPlayer.pause(); videoPlayer.currentTime -= 1 / (measuredFps || FRAME_RATE); });
    frameForwardBtn.addEventListener('click', () => { videoPlayer.pause(); videoPlayer.currentTime += 1 / (measuredFps || FRAME_RATE); });
    stepForwardNBtn.addEventListener('click', () => { videoPlayer.pause(); let n = parseInt(intervalInput.value, 10) || 1; videoPlayer.currentTime += n / (measuredFps || FRAME_RATE); });

    dataModeRadios.forEach(radio => { radio.addEventListener('change', function(event) { dataMode = event.target.value; }); });

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

    seekBar.addEventListener('input', function() { videoPlayer.currentTime = seekBar.value; });

    videoPlayer.addEventListener('loadedmetadata', function() {
        resetZoomPan();
        scaleRatio = null;
        scaleDisplay.textContent = 'スケール: 未設定';
        seekBar.max = videoPlayer.duration;
        const resolution = `${videoPlayer.videoWidth} x ${videoPlayer.videoHeight}`;
        videoResolution.textContent = `解像度: ${resolution}`;
        
        // ▼ 縦長動画の判定とレイアウト切替 ▼
        if (videoPlayer.videoHeight > videoPlayer.videoWidth) {
            workspace.classList.add('portrait');
        } else {
            workspace.classList.remove('portrait');
        }

        if (currentFile) {
            const sizeInMB = (currentFile.size / 1024 / 1024);
            if (videoPlayer.videoWidth > 1920 || sizeInMB > 100) {
                videoWarning.textContent = '警告: 動画のサイズが大きいため、処理が遅くなる可能性があります。';
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
        if (!isDragging) seekBar.value = currentTime;
    });
    
    // iOS Safariでchangeイベントが発火しにくい現象への対策として、inputとchange両方を監視
    ['change', 'input'].forEach(evt => {
        objectCountSelector.addEventListener(evt, function(event) {
            objectCount = parseInt(event.target.value, 10);
            if (activeObjectId > objectCount) activeObjectId = 1;
            updateObjectTabs();
            updateDataTable();
        });
    });

    // ========= マウス＆タッチの統合処理（iPadピンチズーム対応） =========

    // 実際の座標登録ロジック
    function handleInteraction(clientX, clientY) {
        if (!videoPlayer.paused) return; // 再生中は記録しない

        const rect = videoContainer.getBoundingClientRect();
        const containerX = clientX - rect.left;
        const containerY = clientY - rect.top;
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
            return;
        }

        if (isUpdateMode) {
            trackingData[updateIndex].x = clickedX;
            trackingData[updateIndex].y = clickedY;
            isUpdateMode = false;
            updateIndex = null;
            updateDataTable();
            if (confirm("データを更新しました。最新の計測時間に戻りますか？")) {
                if (trackingData.length > 0) videoPlayer.currentTime = trackingData[trackingData.length - 1].t;
            }
            return;
        }

        // 通常のデータ記録
        const time = (exactMediaTime > 0 && Math.abs(exactMediaTime - videoPlayer.currentTime) < 0.1) 
                     ? exactMediaTime : videoPlayer.currentTime;
        
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
        
        // 時間順にソート
        trackingData.sort((a, b) => a.t - b.t);
        updateDataTable();
        
        const framesToAdvance = parseInt(intervalInput.value, 10) || 1;
        videoPlayer.currentTime += framesToAdvance / (measuredFps || FRAME_RATE);
    }

    // 1. マウスイベント
    eventShield.addEventListener('mousedown', function(e) {
        e.preventDefault();
        isDragging = true; hasDragged = false;
        startMouseX = e.clientX; startMouseY = e.clientY;
        lastMouseX = e.clientX; lastMouseY = e.clientY;
    });
    eventShield.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        const dx = e.clientX - lastMouseX; const dy = e.clientY - lastMouseY;
        if (Math.abs(e.clientX - startMouseX) > DRAG_THRESHOLD || Math.abs(e.clientY - startMouseY) > DRAG_THRESHOLD) {
            hasDragged = true;
        }
        translateX += dx; translateY += dy;
        lastMouseX = e.clientX; lastMouseY = e.clientY;
        applyZoomPan();
    });
    eventShield.addEventListener('mouseup', function(e) {
        isDragging = false;
        if (!hasDragged && videoPlayer.paused) {
            handleInteraction(e.clientX, e.clientY);
        }
    });
    eventShield.addEventListener('wheel', function(e) {
        e.preventDefault();
        const rect = videoContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
        const oldScale = scale;
        scale *= (e.deltaY < 0 ? 1.1 : 0.9);
        scale = Math.max(0.1, Math.min(scale, 10));
        translateX = mouseX - (mouseX - translateX) * (scale / oldScale);
        translateY = mouseY - (mouseY - translateY) * (scale / oldScale);
        applyZoomPan();
    }, { passive: false });

    // 2. タッチイベント（iPadピンチ対応）
    eventShield.addEventListener('touchstart', function(e) {
        e.preventDefault(); // マウスイベントの重複発火を防止
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            initialPinchDist = Math.sqrt(dx*dx + dy*dy);
            initialPinchScale = scale;
            isDragging = false;
        } else if (e.touches.length === 1) {
            isDragging = true; hasDragged = false;
            startMouseX = e.touches[0].clientX; startMouseY = e.touches[0].clientY;
            lastMouseX = startMouseX; lastMouseY = startMouseY;
        }
    }, { passive: false });

    eventShield.addEventListener('touchmove', function(e) {
        e.preventDefault();
        if (e.touches.length === 2 && initialPinchDist) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            scale = initialPinchScale * (dist / initialPinchDist);
            scale = Math.max(0.1, Math.min(scale, 10));
            // 簡易的に中心点ではなく、現在のtranslateを維持したまま拡大
            applyZoomPan();
        } else if (e.touches.length === 1 && isDragging) {
            const dx = e.touches[0].clientX - lastMouseX;
            const dy = e.touches[0].clientY - lastMouseY;
            if (Math.abs(e.touches[0].clientX - startMouseX) > DRAG_THRESHOLD || 
                Math.abs(e.touches[0].clientY - startMouseY) > DRAG_THRESHOLD) {
                hasDragged = true;
            }
            translateX += dx; translateY += dy;
            lastMouseX = e.touches[0].clientX; lastMouseY = e.touches[0].clientY;
            applyZoomPan();
        }
    }, { passive: false });

    eventShield.addEventListener('touchend', function(e) {
        e.preventDefault();
        if (e.touches.length === 0) {
            if (isDragging && !hasDragged && videoPlayer.paused) {
                // タップ（クリック）と判定
                handleInteraction(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            }
            isDragging = false;
            initialPinchDist = null;
        }
    }, { passive: false });


    // ▼ CSV出力：生徒向けに時間・X・Yのみを出力するよう整理 ▼
    downloadCsvBtn.addEventListener('click', function() {
        if (trackingData.length === 0) {
            alert('記録されたデータがありません。');
            return;
        }
        
        let csv = "Time (s)";
        for (let i = 1; i <= objectCount; i++) {
            csv += `,X${i} ${scaleRatio ? '(m)' : '(px)'},Y${i} ${scaleRatio ? '(m)' : '(px)'}`;
        }
        csv += "\n";

        // 同じ時間を1行にまとめるためのマップ処理
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
                    csv += `,,`; // データがない場合は空白
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
            if (confirm("この点を削除しますか？")) {
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
    
    // ▼ データテーブル：同じ時間を横並びにし、情報をシンプルに整理 ▼
    function updateDataTable() {
        dataTableHead.innerHTML = '';
        const headRow = dataTableHead.insertRow();
        headRow.insertCell().textContent = "時間(s)";
        
        for (let i = 1; i <= objectCount; i++) {
            const th = headRow.insertCell();
            th.innerHTML = `物体${i} 座標${scaleRatio ? '(m)' : '(px)'}`;
            th.style.borderBottom = `4px solid ${OBJECT_COLORS[i-1]}`;
        }

        dataTableBody.innerHTML = '';

        let timeMap = new Map();
        trackingData.forEach(p => {
            let tStr = p.t.toFixed(4);
            if (!timeMap.has(tStr)) timeMap.set(tStr, { time: p.t });
            timeMap.get(tStr)[`obj${p.id}`] = p;
        });
        
        let sortedTimes = Array.from(timeMap.values()).sort((a, b) => a.time - b.time);

        sortedTimes.forEach(rowObj => {
            const row = dataTableBody.insertRow();
            
            // 更新中の行をハイライト
            if (isUpdateMode && updateIndex !== null && Math.abs(trackingData[updateIndex].t - rowObj.time) < 0.001) {
                row.classList.add('updating-row');
            }

            row.insertCell().textContent = rowObj.time.toFixed(4);

            for (let i = 1; i <= objectCount; i++) {
                const cell = row.insertCell();
                const p = rowObj[`obj${i}`];
                if (p) {
                    const cx = p.x - origin.x;
                    const cy = origin.y - p.y;
                    const x = scaleRatio ? (cx / scaleRatio).toFixed(4) : cx.toFixed(1);
                    const y = scaleRatio ? (cy / scaleRatio).toFixed(4) : cy.toFixed(1);
                    
                    cell.innerHTML = `
                        <div>(${x}, ${y})</div>
                        <div class="cell-actions">
                            <button class="cell-remeasure-btn" data-time="${p.t}" data-id="${p.id}">🎯</button>
                            <button class="cell-delete-btn" data-time="${p.t}" data-id="${p.id}">🗑️</button>
                        </div>
                    `;
                } else {
                    cell.textContent = "---";
                }
            }
        });
    }

    function updateObjectTabs() {
        objectTabsContainer.innerHTML = '';
        for (let i = 1; i <= objectCount; i++) {
            const btn = document.createElement('button');
            btn.className = `object-tab ${i === activeObjectId ? 'active' : ''}`;
            btn.textContent = `物体 ${i}`;
            btn.style.borderBottom = `4px solid ${OBJECT_COLORS[i-1]}`;
            // 選択されているタブの色を少し変える処理はCSSで対応
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