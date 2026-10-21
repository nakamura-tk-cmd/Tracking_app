/*
 * 動画解析ツール（手動） v2.0
 *
 * 設計の要点
 *  - 時刻は「フレーム番号（整数）」で管理し，t = フレーム番号 / fps で求める。
 *    → Δt が完全に等間隔になり，誤差が蓄積しない。
 *  - 座標は「動画本来のピクセル（videoWidth 基準）」で保存する。
 *    → iPad の回転や画面サイズの変化で値が変わらない。
 *  - データはブラウザ（localStorage）に自動保存し，同じ動画を開くと復元できる。
 */
document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // ===================== 定数 =====================
    const APP_VERSION = '2.0.6';   // index.html の ?v= と合わせる
    const COLORS = ['#e8445a', '#2f8fe0', '#e0a400', '#1fa89a'];
    const DEFAULT_FPS = 30;
    // よく使われる fps（23.976, 29.97, 59.94 などは 24, 30, 60fps 撮影の実際の値）
    const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 119.88, 120, 239.76, 240];
    const TAP_SLOP = 8;          // これ以上動いたらタップではなくドラッグ
    const MAX_ZOOM = 20;
    const STORE_PREFIX = 'tracking-v2:';
    const STORE_INDEX = 'tracking-v2-index';
    const STORE_KEEP = 10;       // 保存しておく動画の数

    // ===================== 要素 =====================
    const $ = id => document.getElementById(id);
    const el = {
        fileInput: $('video-input'), info: $('video-info'), infoName: $('info-name'), infoRes: $('info-res'),
        infoSize: $('info-size'), infoFrames: $('info-frames'), fpsInput: $('fps-input'), fpsSource: $('fps-source'), fpsNominal: $('fps-nominal'),
        warning: $('video-warning'),
        restoreBanner: $('restore-banner'), restoreText: $('restore-text'), restoreYes: $('restore-yes'), restoreNo: $('restore-no'),
        workspace: $('workspace'), originBtn: $('origin-btn'), scaleBtn: $('scale-btn'), fitBtn: $('fit-btn'), trailCheck: $('trail-check'),
        statusBar: $('status-bar'), statusText: $('status-text'), statusCancel: $('status-cancel'),
        stageWrap: $('stage-wrap'), stage: $('stage'), layer: $('layer'), video: $('video'), overlay: $('overlay'),
        shield: $('shield'), zoomLabel: $('zoom-label'), toast: $('toast'),
        scalePanel: $('scale-panel'), scaleLength: $('scale-length'), scaleUnit: $('scale-unit'), scaleOk: $('scale-ok'), scaleRedo: $('scale-redo'),
        frameDisplay: $('frame-display'), timeDisplay: $('time-display'), seekBar: $('seek-bar'),
        firstBtn: $('first-btn'), backNBtn: $('back-n-btn'), back1Btn: $('back-1-btn'), playBtn: $('play-btn'),
        fwd1Btn: $('fwd-1-btn'), fwdNBtn: $('fwd-n-btn'), lastBtn: $('last-btn'),
        intervalInput: $('interval-input'), intervalMinus: $('interval-minus'), intervalPlus: $('interval-plus'), intervalTime: $('interval-time'),
        objectCount: $('object-count'), objectTabs: $('object-tabs'), undoBtn: $('undo-btn'),
        scaleDisplay: $('scale-display'), originDisplay: $('origin-display'),
        dataCount: $('data-count'), tzeroCheck: $('tzero-check'), velocityCheck: $('velocity-check'), velocityNote: $('velocity-note'), clearBtn: $('clear-btn'), csvBtn: $('csv-btn'),
        dataHead: $('data-head'), dataBody: $('data-body'),
    };
    const video = el.video;
    const HAS_RVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

    // ===================== 状態 =====================
    const S = {
        loaded: false,
        file: null, fileKey: null, url: null,
        vw: 0, vh: 0,
        fps: DEFAULT_FPS, fileFps: null, fileFpsLabel: '', totalFrames: 0,
        frame: 0,                 // 現在表示しているフレーム
        pendingFrame: null,       // シーク中に次に行きたいフレーム
        interval: 1,
        objectCount: 1, activeId: 1,
        points: new Map(),        // key "frame:id" -> {f, id, x, y}（x, y は動画ピクセル）
        origin: null,             // {x, y} 動画ピクセル。null なら左下
        scale: null,              // {p1, p2, meters, pxPerM}
        mode: 'track',            // track | origin | scale | scale-input | remeasure
        scaleTmp: [],
        remeasure: null,          // {f, id, returnFrame}
        undo: [],
        view: { s: 1, tx: 0, ty: 0 },
        disp: { w: 0, h: 0 },
        showTrail: true, tZero: false, showVelocity: false,
        lastMediaTime: null,
    };

    const key = (f, id) => `${f}:${id}`;

    // ===================== 表示ユーティリティ =====================
    let toastTimer = null;
    function toast(msg, ms = 1600) {
        el.toast.textContent = msg;
        el.toast.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.toast.classList.add('hidden'), ms);
    }

    function setStatus() {
        let text = '', cancel = false, cls = '';
        if (!S.loaded) text = '動画を選んでください';
        else if (S.mode === 'origin') { text = '原点にしたい点をタップしてください'; cancel = true; cls = 'mode'; }
        else if (S.mode === 'scale') {
            text = S.scaleTmp.length === 0 ? 'スケール: 長さがわかっている物体の「始点」をタップ' : 'スケール: 次に「終点」をタップ';
            cancel = true; cls = 'mode';
        }
        else if (S.mode === 'scale-input') { text = 'スケール: 下の欄に実際の長さを入力してください'; cancel = true; cls = 'mode'; }
        else if (S.mode === 'remeasure') { text = `再計測: 物体${S.remeasure.id} の正しい位置をタップ（フレーム ${S.remeasure.f}）`; cancel = true; cls = 'remeasure'; }
        else if (!video.paused) text = '再生中 — 停止してから記録します';
        else text = `物体${S.activeId} を記録: 物体をタップ → 記録して ${S.interval} コマ進みます`;
        el.statusText.textContent = text;
        el.statusCancel.classList.toggle('hidden', !cancel);
        el.statusBar.className = 'status-bar ' + cls;
        el.statusBar.style.borderLeftColor = (S.mode === 'track' && S.loaded) ? COLORS[S.activeId - 1] : '';
    }

    function fmt(v, d) { return Number.isFinite(v) ? v.toFixed(d) : ''; }

    // ===================== 時刻・座標の変換 =====================
    const lastFrame = () => Math.max(0, S.totalFrames - 1);

    function t0Frame() {
        if (!S.tZero || S.points.size === 0) return 0;
        let m = Infinity;
        for (const p of S.points.values()) m = Math.min(m, p.f);
        return m;
    }
    const timeOf = f => (f - t0Frame()) / S.fps;

    function originPx() { return S.origin || { x: 0, y: S.vh }; }

    // 動画ピクセル → 物理座標（m または px，y 上向き）
    function toPhys(p) {
        const o = originPx();
        const x = p.x - o.x, y = o.y - p.y;
        return S.scale ? { x: x / S.scale.pxPerM, y: y / S.scale.pxPerM } : { x, y };
    }
    const unit = () => S.scale ? 'm' : 'px';

    // 画面上の座標(clientX/Y) → 動画ピクセル
    function clientToVideo(cx, cy) {
        const r = el.stage.getBoundingClientRect();
        const lx = (cx - r.left - S.view.tx) / S.view.s;
        const ly = (cy - r.top - S.view.ty) / S.view.s;
        return { x: lx * S.vw / S.disp.w, y: ly * S.vh / S.disp.h };
    }

    // ===================== 動画の読み込み =====================
    el.fileInput.addEventListener('change', async () => {
        const file = el.fileInput.files[0];
        if (!file) return;
        el.fileInput.value = '';   // 同じファイルを選び直しても反応するように

        if (S.url) URL.revokeObjectURL(S.url);
        S.loaded = false;
        S.file = file;
        S.fileKey = `${file.name}|${file.size}`;
        S.url = URL.createObjectURL(file);
        S.points = new Map(); S.undo = []; S.origin = null; S.scale = null;
        S.frame = 0; S.pendingFrame = null; S.lastMediaTime = null;
        cancelMode(true);
        el.restoreBanner.classList.add('hidden');

        el.infoName.textContent = file.name;
        el.infoSize.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB`;
        el.infoRes.textContent = '';
        el.infoFrames.textContent = '';
        el.fpsSource.textContent = '読み取り中…';
        el.fpsNominal.textContent = '';
        el.info.classList.remove('hidden');
        el.statusText.textContent = '読み込み中…';

        // fps はヘッダから読む（動画の読み込みと並行）
        const infoPromise = window.readVideoInfo ? window.readVideoInfo(file) : Promise.resolve(null);

        video.src = S.url;
        video.load();
        await new Promise((resolve, reject) => {
            const ok = () => { cleanup(); resolve(); };
            const ng = () => { cleanup(); reject(); };
            const cleanup = () => { video.removeEventListener('loadedmetadata', ok); video.removeEventListener('error', ng); };
            video.addEventListener('loadedmetadata', ok);
            video.addEventListener('error', ng);
        }).catch(() => null);

        if (!video.videoWidth) {
            el.statusText.textContent = 'この動画は読み込めませんでした（形式を確認してください）';
            el.fpsSource.textContent = '';
            return;
        }

        S.vw = video.videoWidth; S.vh = video.videoHeight;
        el.infoRes.textContent = `${S.vw} × ${S.vh}`;
        el.overlay.setAttribute('viewBox', `0 0 ${S.vw} ${S.vh}`);
        el.workspace.classList.toggle('portrait', S.vh > S.vw);

        const big = S.vw > 1920 || file.size > 300 * 1024 * 1024;
        el.warning.textContent = big ? '動画が大きいため，コマ送りが遅くなることがあります。写真アプリで不要部分をトリミングすると快適になります。' : '';
        el.warning.classList.toggle('hidden', !big);

        const info = await infoPromise;
        if (info && info.fps > 1 && info.fps < 1000) {
            S.fileFps = info.fps;
            S.fps = info.fps;
            S.totalFrames = info.frames;
            S.fileFpsLabel = info.variable ? '（ファイルから取得・平均値）' : '（ファイルから取得）';
            el.fpsSource.textContent = S.fileFpsLabel;
        } else {
            S.fileFps = null;
            const measured = await measureFps();
            S.fps = measured ? snapFps(measured) : DEFAULT_FPS;
            S.totalFrames = 0;
            el.fpsSource.textContent = measured ? '（再生して推定・要確認）' : '（取得できず・要確認）';
        }
        if (!S.totalFrames) S.totalFrames = Math.max(1, Math.floor(video.duration * S.fps + 1e-6));
        el.fpsInput.value = roundFps(S.fps);
        updateFpsNominal();

        // iPad の Safari では一度再生しないと最初のコマが描画されないことがあるため
        await primeVideo();

        S.loaded = true;
        layout();
        updateFrameInfo();
        gotoFrame(0);
        renderTabs();
        renderAll();
        offerRestore();
    });

    function roundFps(f) { return Math.round(f * 1000) / 1000; }

    // 推定値は誤差を含むので，よく使われる fps に近ければそれに合わせる
    function nearestCommonFps(f, tolerance) {
        let best = null;
        for (const c of COMMON_FPS) if (Math.abs(f - c) / c < tolerance && (best === null || Math.abs(f - c) < Math.abs(f - best))) best = c;
        return best;
    }

    function snapFps(f) {
        const best = nearestCommonFps(f, 0.03);
        return best !== null ? best : Math.round(f * 100) / 100;
    }

    // 実測値の横に近い規格値を表示する（計算には使わない）
    function updateFpsNominal() {
        const c = nearestCommonFps(S.fps, 0.01);
        if (c === null || Math.abs(S.fps - c) < 0.0005) { el.fpsNominal.textContent = ''; return; }
        el.fpsNominal.textContent = Number.isInteger(c) ? `規格値 ${c}` : `規格値 ${c}（${Math.round(c)}fps 撮影）`;
    }

    async function primeVideo() {
        try {
            await video.play();
            await new Promise(r => setTimeout(r, 60));
        } catch (e) { /* 自動再生できなくても問題なし */ }
        video.pause();
    }

    // ヘッダから fps が取れないとき：少し再生してコマの間隔を測る
    function measureFps() {
        if (!HAS_RVFC) return Promise.resolve(null);
        return new Promise(resolve => {
            const times = [];
            let done = false;
            const finish = () => {
                if (done) return; done = true;
                video.pause();
                const d = [];
                for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
                d.sort((a, b) => a - b);
                const med = d.length ? d[Math.floor(d.length / 2)] : 0;
                resolve(med > 0 ? 1 / med : null);
            };
            const cb = (now, meta) => {
                if (done) return;
                times.push(meta.mediaTime);
                if (times.length >= 15) finish(); else video.requestVideoFrameCallback(cb);
            };
            video.requestVideoFrameCallback(cb);
            video.play().catch(finish);
            setTimeout(finish, 3000);
        });
    }

    function updateFrameInfo() {
        el.infoFrames.textContent = `${S.totalFrames} コマ / ${video.duration.toFixed(2)} s`;
        el.seekBar.max = lastFrame();
        updateIntervalTime();
    }

    el.fpsInput.addEventListener('change', () => {
        const v = parseFloat(el.fpsInput.value);
        if (!(v > 0 && v < 1000) || !S.loaded) { el.fpsInput.value = roundFps(S.fps); return; }
        S.fps = v;
        S.totalFrames = Math.max(1, Math.floor(video.duration * S.fps + 1e-6));
        el.fpsSource.textContent = S.fileFps && Math.abs(v - roundFps(S.fileFps)) < 1e-6 ? S.fileFpsLabel : '（手動設定）';
        updateFpsNominal();
        updateFrameInfo();
        gotoFrame(Math.min(S.frame, lastFrame()));
        renderAll();
        save();
    });

    // ===================== 表示サイズとズーム =====================
    function layout() {
        if (!S.vw) return;
        const availW = el.stageWrap.clientWidth;
        if (!availW) return;
        const maxH = window.innerHeight * (S.vh > S.vw ? 0.78 : 0.66);
        const aspect = S.vw / S.vh;
        let w = Math.min(availW, maxH * aspect);
        w = Math.max(120, Math.floor(w));
        const h = Math.round(w / aspect);
        const ratio = S.disp.w ? w / S.disp.w : 1;
        S.disp = { w, h };
        el.stage.style.width = w + 'px';
        el.stage.style.height = h + 'px';
        el.layer.style.width = w + 'px';
        el.layer.style.height = h + 'px';
        S.view.tx *= ratio; S.view.ty *= ratio;
        applyView();
    }

    function clampView() {
        const v = S.view;
        v.s = Math.min(MAX_ZOOM, Math.max(1, v.s));
        const minX = S.disp.w - S.disp.w * v.s, minY = S.disp.h - S.disp.h * v.s;
        v.tx = Math.min(0, Math.max(minX, v.tx));
        v.ty = Math.min(0, Math.max(minY, v.ty));
    }

    function applyView() {
        clampView();
        const v = S.view;
        el.layer.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`;
        el.zoomLabel.textContent = `×${v.s.toFixed(1)}`;
        el.zoomLabel.classList.toggle('hidden', v.s <= 1.001);
        renderOverlay();
    }

    function zoomAt(sx, sy, factor) {
        const v = S.view;
        const old = v.s;
        v.s = Math.min(MAX_ZOOM, Math.max(1, v.s * factor));
        v.tx = sx - (sx - v.tx) * (v.s / old);
        v.ty = sy - (sy - v.ty) * (v.s / old);
        applyView();
    }

    function resetView() { S.view = { s: 1, tx: 0, ty: 0 }; applyView(); }
    el.fitBtn.addEventListener('click', resetView);

    if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(el.stageWrap);
    window.addEventListener('resize', layout);

    // ===================== フレーム移動 =====================
    // シーク先はコマの中央 (f + 0.5) / fps にする → ブラウザ差による前後ずれを防ぐ
    function seekTimeOf(f) {
        const t = (f + 0.5) / S.fps;
        return Math.min(t, Math.max(0, video.duration - 0.0005));
    }

    function gotoFrame(f) {
        if (!video.duration) return;
        f = Math.max(0, Math.min(lastFrame(), Math.round(f)));
        if (!video.paused) video.pause();
        S.frame = f;
        if (video.seeking) {
            S.pendingFrame = f;       // シーク完了後にまとめて移動
        } else {
            S.pendingFrame = null;
            video.currentTime = seekTimeOf(f);
        }
        updateReadout();
        renderOverlay();
        highlightRow();
    }

    video.addEventListener('seeked', () => {
        if (S.pendingFrame !== null) {
            const f = S.pendingFrame;
            S.pendingFrame = null;
            video.currentTime = seekTimeOf(f);
        }
        updateReadout();
    });

    const busy = () => video.seeking || S.pendingFrame !== null;

    function step(n) { if (S.loaded) gotoFrame(S.frame + n); }
    el.firstBtn.addEventListener('click', () => step(-Infinity));
    el.lastBtn.addEventListener('click', () => step(Infinity));
    el.back1Btn.addEventListener('click', () => step(-1));
    el.fwd1Btn.addEventListener('click', () => step(1));
    el.backNBtn.addEventListener('click', () => step(-S.interval));
    el.fwdNBtn.addEventListener('click', () => step(S.interval));
    el.seekBar.addEventListener('input', () => { if (S.loaded) gotoFrame(parseInt(el.seekBar.value, 10)); });

    el.playBtn.addEventListener('click', () => {
        if (!S.loaded) return;
        if (video.paused) {
            if (S.frame >= lastFrame()) gotoFrame(0);
            video.play();
        } else {
            video.pause();
        }
    });

    // 再生中のフレーム番号の追跡
    function frameFromPlayback() {
        if (S.lastMediaTime !== null) return Math.round(S.lastMediaTime * S.fps);
        return Math.floor(video.currentTime * S.fps + 1e-3);
    }
    if (HAS_RVFC) {
        const onFrame = (now, meta) => {
            if (!video.paused && S.loaded) {
                S.lastMediaTime = meta.mediaTime;
                S.frame = Math.min(lastFrame(), frameFromPlayback());
                updateReadout();
            }
            video.requestVideoFrameCallback(onFrame);
        };
        video.requestVideoFrameCallback(onFrame);
    }
    video.addEventListener('timeupdate', () => {
        if (!video.paused && S.loaded && !HAS_RVFC) {
            S.frame = Math.min(lastFrame(), frameFromPlayback());
            updateReadout();
        }
    });
    video.addEventListener('play', () => { el.playBtn.textContent = '⏸'; S.lastMediaTime = null; setStatus(); });
    video.addEventListener('pause', () => {
        el.playBtn.textContent = '▶';
        if (S.loaded && !video.seeking && S.pendingFrame === null) {
            // 停止した位置をコマの中央にそろえる
            const f = Math.min(lastFrame(), frameFromPlayback());
            if (Math.abs(video.currentTime - seekTimeOf(f)) > 0.25 / S.fps) gotoFrame(f);
            else { S.frame = f; updateReadout(); renderOverlay(); highlightRow(); }
        }
        setStatus();
    });
    video.addEventListener('ended', () => { if (S.loaded) gotoFrame(lastFrame()); });

    function updateReadout() {
        if (!S.loaded) return;
        el.frameDisplay.textContent = `フレーム ${S.frame} / ${lastFrame()}`;
        el.timeDisplay.textContent = `t = ${timeOf(S.frame).toFixed(4)} s`;
        el.seekBar.value = S.frame;
    }

    // ===================== コマ数 N =====================
    function setIntervalN(n) {
        n = Math.max(1, Math.min(1000, parseInt(n, 10) || 1));
        S.interval = n;
        el.intervalInput.value = n;
        updateIntervalTime();
        setStatus();
        save();
    }
    function updateIntervalTime() {
        el.intervalTime.textContent = `Δt = ${(S.interval / S.fps).toFixed(4)} s`;
    }
    el.intervalMinus.addEventListener('click', () => setIntervalN(S.interval - 1));
    el.intervalPlus.addEventListener('click', () => setIntervalN(S.interval + 1));
    el.intervalInput.addEventListener('change', () => setIntervalN(el.intervalInput.value));

    // ===================== 物体 =====================
    el.objectCount.addEventListener('change', () => {
        S.objectCount = parseInt(el.objectCount.value, 10);
        if (S.activeId > S.objectCount) S.activeId = 1;
        renderTabs(); renderAll(); save();
    });

    function renderTabs() {
        el.objectTabs.innerHTML = '';
        for (let i = 1; i <= S.objectCount; i++) {
            const b = document.createElement('button');
            b.className = 'object-tab' + (i === S.activeId ? ' active' : '');
            b.style.setProperty('--c', COLORS[i - 1]);
            b.textContent = `物体 ${i}`;
            b.addEventListener('click', () => { S.activeId = i; renderTabs(); renderOverlay(); });
            el.objectTabs.appendChild(b);
        }
        setStatus();
    }

    // ===================== モード（原点・スケール・再計測） =====================
    el.originBtn.addEventListener('click', () => {
        if (!S.loaded) return;
        cancelMode(true);
        S.mode = 'origin';
        video.pause();
        setStatus(); renderOverlay();
    });

    el.scaleBtn.addEventListener('click', () => {
        if (!S.loaded) return;
        cancelMode(true);
        S.mode = 'scale';
        S.scaleTmp = [];
        video.pause();
        setStatus(); renderOverlay();
    });

    el.statusCancel.addEventListener('click', () => cancelMode());

    function cancelMode(silent) {
        const back = (S.mode === 'remeasure' && S.remeasure && !silent) ? S.remeasure.returnFrame : null;
        S.mode = 'track';
        S.scaleTmp = [];
        S.remeasure = null;
        el.scalePanel.classList.add('hidden');
        if (back !== null) gotoFrame(back);
        setStatus(); renderOverlay(); highlightRow();
    }

    el.scaleOk.addEventListener('click', () => {
        const len = parseFloat(el.scaleLength.value) * parseFloat(el.scaleUnit.value);
        if (!(len > 0) || S.scaleTmp.length !== 2) { toast('長さを正しく入力してください'); return; }
        const [p1, p2] = S.scaleTmp;
        const px = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (px < 2) { toast('2点が近すぎます。やり直してください'); return; }
        pushUndo();
        S.scale = { p1, p2, meters: len, pxPerM: px / len };
        el.scaleLength.blur();
        cancelMode(true);
        renderAll(); save();
        toast(`スケールを設定しました（${S.scale.pxPerM.toFixed(1)} px/m）`);
    });
    el.scaleLength.addEventListener('keydown', e => { if (e.key === 'Enter') el.scaleOk.click(); });
    el.scaleRedo.addEventListener('click', () => {
        S.mode = 'scale'; S.scaleTmp = [];
        el.scalePanel.classList.add('hidden');
        setStatus(); renderOverlay();
    });

    // ===================== タップ時の処理 =====================
    function handleTap(cx, cy) {
        if (!S.loaded) return;
        if (!video.paused) {
            video.pause();
            toast('停止しました。もう一度タップすると記録します');
            return;
        }
        if (busy()) { toast('読み込み中… もう一度タップしてください', 1000); return; }

        const p = clientToVideo(cx, cy);
        if (p.x < 0 || p.y < 0 || p.x > S.vw || p.y > S.vh) return;

        switch (S.mode) {
            case 'origin':
                pushUndo();
                S.origin = p;
                cancelMode(true);
                renderAll(); save();
                toast('原点を設定しました');
                return;

            case 'scale':
                S.scaleTmp.push(p);
                if (S.scaleTmp.length === 2) {
                    S.mode = 'scale-input';
                    el.scalePanel.classList.remove('hidden');
                    el.scaleLength.focus();
                    el.scaleLength.select();
                }
                setStatus(); renderOverlay();
                return;

            case 'scale-input':
                return;

            case 'remeasure': {
                const r = S.remeasure;
                pushUndo();
                S.points.set(key(r.f, r.id), { f: r.f, id: r.id, x: p.x, y: p.y });
                const back = r.returnFrame;
                cancelMode(true);
                renderAll(); save();
                gotoFrame(back);
                toast('再計測しました');
                return;
            }

            default: {
                pushUndo();
                S.points.set(key(S.frame, S.activeId), { f: S.frame, id: S.activeId, x: p.x, y: p.y });
                renderAll(); save();
                if (S.frame + S.interval <= lastFrame()) gotoFrame(S.frame + S.interval);
                else toast('最後のコマに到達しました');
            }
        }
    }

    // ===================== ポインタ操作（タッチ・ペン・マウス共通） =====================
    const pointers = new Map();
    let gesture = null;

    el.shield.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        try { el.shield.setPointerCapture(e.pointerId); } catch (_) { /* 無視 */ }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 1) {
            gesture = { type: 'tap', sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY };
        } else if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        } else {
            gesture = { type: 'none' };
        }
    });

    el.shield.addEventListener('pointermove', e => {
        if (!pointers.has(e.pointerId)) return;
        e.preventDefault();
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!gesture) return;

        if (gesture.type === 'tap' || gesture.type === 'pan') {
            if (gesture.type === 'tap' && Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > TAP_SLOP) gesture.type = 'pan';
            if (gesture.type === 'pan') {
                S.view.tx += e.clientX - gesture.lx;
                S.view.ty += e.clientY - gesture.ly;
                applyView();
            }
            gesture.lx = e.clientX; gesture.ly = e.clientY;
        } else if (gesture.type === 'pinch' && pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
            const r = el.stage.getBoundingClientRect();
            S.view.tx += cx - gesture.cx;
            S.view.ty += cy - gesture.cy;
            if (gesture.dist > 0) zoomAt(cx - r.left, cy - r.top, dist / gesture.dist);
            else applyView();
            gesture.dist = dist; gesture.cx = cx; gesture.cy = cy;
        }
    });

    function endPointer(e, cancelled) {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (gesture && gesture.type === 'tap' && pointers.size === 0 && !cancelled) {
            handleTap(e.clientX, e.clientY);
        }
        if (pointers.size === 1) {
            // ピンチ後に指が1本残った → そのままドラッグ移動（タップにはしない）
            const p = [...pointers.values()][0];
            gesture = { type: 'pan', lx: p.x, ly: p.y };
        } else if (pointers.size === 0) {
            gesture = null;
        }
    }
    el.shield.addEventListener('pointerup', e => endPointer(e, false));
    el.shield.addEventListener('pointercancel', e => endPointer(e, true));

    el.shield.addEventListener('wheel', e => {
        e.preventDefault();
        const r = el.stage.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    // iOS Safari のページ拡大（ジェスチャー）を抑止
    ['gesturestart', 'gesturechange'].forEach(t => el.shield.addEventListener(t, e => e.preventDefault()));

    // キーボード（PC 用）
    document.addEventListener('keydown', e => {
        if (!S.loaded) return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? S.interval : 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -S.interval : -1); }
        else if (e.key === ' ') { e.preventDefault(); el.playBtn.click(); }
        else if (e.key === 'Escape') cancelMode();
    });

    // ===================== 元に戻す =====================
    function pushUndo() {
        S.undo.push({ points: new Map(S.points), origin: S.origin, scale: S.scale, frame: S.frame });
        if (S.undo.length > 200) S.undo.shift();
        el.undoBtn.disabled = false;
    }
    function doUndo() {
        const s = S.undo.pop();
        el.undoBtn.disabled = S.undo.length === 0;
        if (!s) return;
        S.points = s.points; S.origin = s.origin; S.scale = s.scale;
        cancelMode(true);
        renderAll(); save();
        gotoFrame(s.frame);
        toast('元に戻しました', 1000);
    }
    el.undoBtn.addEventListener('click', doUndo);

    // ===================== オーバーレイ描画 =====================
    const SVG_NS = 'http://www.w3.org/2000/svg';
    function svg(tag, attrs) {
        const n = document.createElementNS(SVG_NS, tag);
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        return n;
    }

    function renderOverlay() {
        const g = el.overlay;
        while (g.firstChild) g.removeChild(g.firstChild);
        if (!S.loaded || !S.disp.w) return;

        // 画面上で一定の大きさに見えるよう，動画ピクセル単位に換算
        const k = S.vw / (S.disp.w * S.view.s);
        const R = 4.5 * k, Rcur = 9 * k;
        const NS = { 'vector-effect': 'non-scaling-stroke' };

        // 座標軸
        const o = originPx();
        const axes = svg('g', { class: 'axes' });
        axes.appendChild(svg('line', { x1: 0, y1: o.y, x2: S.vw, y2: o.y, ...NS }));
        axes.appendChild(svg('line', { x1: o.x, y1: 0, x2: o.x, y2: S.vh, ...NS }));
        g.appendChild(axes);
        if (S.origin) {
            const t = svg('text', { x: o.x + 6 * k, y: o.y - 6 * k, 'font-size': 14 * k, class: 'axis-label' });
            t.textContent = 'O';
            g.appendChild(t);
        }

        // スケール線
        const drawScale = (p1, p2, cls) => {
            if (p1 && p2) g.appendChild(svg('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: cls, ...NS }));
            [p1, p2].forEach(p => { if (p) g.appendChild(svg('circle', { cx: p.x, cy: p.y, r: R, class: 'scale-pt' })); });
        };
        if (S.mode === 'scale' || S.mode === 'scale-input') drawScale(S.scaleTmp[0], S.scaleTmp[1], 'scale-line active');
        else if (S.scale) drawScale(S.scale.p1, S.scale.p2, 'scale-line');

        // 軌跡
        for (let id = 1; id <= S.objectCount; id++) {
            const pts = [...S.points.values()].filter(p => p.id === id).sort((a, b) => a.f - b.f);
            if (!pts.length) continue;
            const color = COLORS[id - 1];
            if (S.showTrail) {
                if (pts.length > 1) {
                    g.appendChild(svg('polyline', {
                        points: pts.map(p => `${p.x},${p.y}`).join(' '),
                        fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-opacity': 0.7, ...NS,
                    }));
                }
                pts.forEach(p => {
                    if (p.f === S.frame) return;
                    g.appendChild(svg('circle', { cx: p.x, cy: p.y, r: R, fill: color, 'fill-opacity': 0.85, stroke: '#fff', 'stroke-width': 1, ...NS }));
                });
            }
            // 現在のコマで記録済みの点は大きく表示
            const cur = S.points.get(key(S.frame, id));
            if (cur) {
                g.appendChild(svg('circle', { cx: cur.x, cy: cur.y, r: Rcur, fill: 'none', stroke: color, 'stroke-width': 3, ...NS }));
                g.appendChild(svg('circle', { cx: cur.x, cy: cur.y, r: R * 0.6, fill: color }));
            }
        }

        // 再計測対象
        if (S.mode === 'remeasure' && S.remeasure) {
            const p = S.points.get(key(S.remeasure.f, S.remeasure.id));
            if (p) g.appendChild(svg('circle', { cx: p.x, cy: p.y, r: Rcur * 1.4, class: 'remeasure-ring', ...NS }));
        }
    }

    el.trailCheck.addEventListener('change', () => { S.showTrail = el.trailCheck.checked; renderOverlay(); });

    // ===================== 表 =====================
    function frameRows() {
        const rows = new Map();
        for (const p of S.points.values()) {
            if (p.id > S.objectCount) continue;
            if (!rows.has(p.f)) rows.set(p.f, {});
            rows.get(p.f)[p.id] = p;
        }
        return [...rows.entries()].sort((a, b) => a[0] - b[0]);
    }

    function renderTable() {
        const u = unit();
        const d = S.scale ? 4 : 1;
        let head = '<tr><th>フレーム</th><th>t (s)</th>';
        for (let i = 1; i <= S.objectCount; i++) {
            head += `<th style="border-bottom-color:${COLORS[i - 1]}">物体${i} (x, y) [${u}]</th>`;
            if (S.showVelocity) head += `<th class="vel" style="border-bottom-color:${COLORS[i - 1]}">物体${i} (vx, vy) [${u}/s]</th>`;
        }
        const vel = {};
        if (S.showVelocity) for (let i = 1; i <= S.objectCount; i++) vel[i] = velocities(i);
        const dv = S.scale ? 3 : 1;
        el.dataHead.innerHTML = head + '</tr>';

        let html = '';
        for (const [f, objs] of frameRows()) {
            html += `<tr data-frame="${f}"><td class="goto" data-frame="${f}">${f}</td><td class="goto" data-frame="${f}">${timeOf(f).toFixed(4)}</td>`;
            for (let i = 1; i <= S.objectCount; i++) {
                const p = objs[i];
                if (p) {
                    const q = toPhys(p);
                    html += `<td><div class="cell"><span>(${q.x.toFixed(d)}, ${q.y.toFixed(d)})</span>` +
                        `<span class="cell-btns"><button class="re" data-f="${f}" data-id="${i}">再計測</button>` +
                        `<button class="del" data-f="${f}" data-id="${i}" aria-label="削除">🗑</button></span></div></td>`;
                } else html += '<td class="empty">—</td>';
                if (S.showVelocity) {
                    const v = p && vel[i].get(f);
                    html += v ? `<td class="vel">(${fmt(v.vx, dv)}, ${fmt(v.vy, dv)})</td>` : '<td class="vel empty">—</td>';
                }
            }
            html += '</tr>';
        }
        el.dataBody.innerHTML = html || `<tr><td colspan="${S.objectCount * (S.showVelocity ? 2 : 1) + 2}" class="empty">まだ記録がありません</td></tr>`;
        el.dataCount.textContent = S.points.size ? `（${S.points.size} 点）` : '';
        el.velocityNote.classList.toggle('hidden', !S.showVelocity);
        highlightRow();
    }

    function highlightRow() {
        el.dataBody.querySelectorAll('tr.current, tr.updating').forEach(r => r.classList.remove('current', 'updating'));
        const f = S.mode === 'remeasure' && S.remeasure ? S.remeasure.f : S.frame;
        const r = el.dataBody.querySelector(`tr[data-frame="${f}"]`);
        if (r) r.classList.add(S.mode === 'remeasure' ? 'updating' : 'current');
    }

    el.dataBody.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b) {
            const f = parseInt(b.dataset.f, 10), id = parseInt(b.dataset.id, 10);
            if (b.classList.contains('del')) {
                pushUndo();
                S.points.delete(key(f, id));
                renderAll(); save();
                toast('削除しました（元に戻せます）', 1200);
            } else if (b.classList.contains('re') && S.loaded) {
                const back = S.mode === 'remeasure' && S.remeasure ? S.remeasure.returnFrame : S.frame;
                cancelMode(true);
                S.mode = 'remeasure';
                S.remeasure = { f, id, returnFrame: back };
                S.activeId = id;
                renderTabs();
                gotoFrame(f);
                setStatus(); renderOverlay(); highlightRow();
                el.stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }
        const td = e.target.closest('td.goto');
        if (td && S.loaded) {
            gotoFrame(parseInt(td.dataset.frame, 10));
            el.stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    el.clearBtn.addEventListener('click', () => {
        if (!S.points.size) return;
        if (!confirm('記録したデータをすべて消去しますか？\n（「元に戻す」で取り消せます）')) return;
        pushUndo();
        S.points = new Map();
        renderAll(); save();
    });

    el.velocityCheck.addEventListener('change', () => { S.showVelocity = el.velocityCheck.checked; renderTable(); save(); });
    el.tzeroCheck.addEventListener('change', () => { S.tZero = el.tzeroCheck.checked; renderAll(); save(); });

    function renderCalib() {
        el.scaleDisplay.textContent = S.scale
            ? `スケール: ${S.scale.meters} m = ${Math.hypot(S.scale.p2.x - S.scale.p1.x, S.scale.p2.y - S.scale.p1.y).toFixed(1)} px（${S.scale.pxPerM.toFixed(1)} px/m）`
            : 'スケール: 未設定（単位 px）';
        el.originDisplay.textContent = S.origin
            ? `原点: (${S.origin.x.toFixed(0)}, ${S.origin.y.toFixed(0)}) px`
            : '原点: 動画の左下';
    }

    function renderAll() {
        renderTable();
        renderOverlay();
        renderCalib();
        updateReadout();
        setStatus();
        el.undoBtn.disabled = S.undo.length === 0;
    }

    // ===================== CSV =====================
    // 速度は中心差分 v_i = (x_{i+1} - x_{i-1}) / (t_{i+1} - t_{i-1})。両端は空欄。
    function velocities(id) {
        const pts = [...S.points.values()].filter(p => p.id === id).sort((a, b) => a.f - b.f);
        const v = new Map();
        for (let i = 1; i < pts.length - 1; i++) {
            const a = toPhys(pts[i - 1]), b = toPhys(pts[i + 1]);
            const dt = (pts[i + 1].f - pts[i - 1].f) / S.fps;
            v.set(pts[i].f, { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt });
        }
        return v;
    }

    function buildCsv() {
        const u = unit();
        const dPos = S.scale ? 5 : 2, dVel = S.scale ? 4 : 1;
        const cols = ['frame', 't (s)'];
        const V = S.showVelocity;
        for (let i = 1; i <= S.objectCount; i++) {
            cols.push(`x${i} (${u})`, `y${i} (${u})`);
            if (V) cols.push(`vx${i} (${u}/s)`, `vy${i} (${u}/s)`);
        }
        const lines = [cols.join(',')];
        const vel = {};
        for (let i = 1; i <= S.objectCount; i++) vel[i] = velocities(i);

        for (const [f, objs] of frameRows()) {
            const row = [f, timeOf(f).toFixed(5)];
            for (let i = 1; i <= S.objectCount; i++) {
                const p = objs[i];
                if (p) {
                    const q = toPhys(p), v = vel[i].get(f);
                    row.push(q.x.toFixed(dPos), q.y.toFixed(dPos));
                    if (V) row.push(v ? fmt(v.vx, dVel) : '', v ? fmt(v.vy, dVel) : '');
                } else {
                    row.push('', '');
                    if (V) row.push('', '');
                }
            }
            lines.push(row.join(','));
        }
        return lines.join('\r\n') + '\r\n';
    }

    el.csvBtn.addEventListener('click', () => {
        if (!S.points.size) { toast('記録されたデータがありません'); return; }
        const base = S.file ? S.file.name.replace(/\.[^.]+$/, '') : 'tracking';
        const blob = new Blob(['﻿' + buildCsv()], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${base}_Manual_Tracking.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    });

    // ===================== 自動保存と復元 =====================
    let saveTimer = null;
    function save() {
        if (!S.fileKey || !S.loaded) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                const data = {
                    v: 2, savedAt: Date.now(),
                    points: [...S.points.values()],
                    origin: S.origin, scale: S.scale,
                    objectCount: S.objectCount, interval: S.interval, tZero: S.tZero, showVelocity: S.showVelocity,
                    fps: S.fps, vw: S.vw, vh: S.vh,
                };
                localStorage.setItem(STORE_PREFIX + S.fileKey, JSON.stringify(data));
                const idx = JSON.parse(localStorage.getItem(STORE_INDEX) || '[]').filter(k => k !== S.fileKey);
                idx.unshift(S.fileKey);
                idx.slice(STORE_KEEP).forEach(k => localStorage.removeItem(STORE_PREFIX + k));
                localStorage.setItem(STORE_INDEX, JSON.stringify(idx.slice(0, STORE_KEEP)));
            } catch (e) { console.warn('保存できませんでした', e); }
        }, 300);
    }

    let restoreData = null;
    function offerRestore() {
        restoreData = null;
        try {
            const raw = localStorage.getItem(STORE_PREFIX + S.fileKey);
            if (!raw) return;
            const d = JSON.parse(raw);
            if (!d || d.vw !== S.vw || d.vh !== S.vh) return;
            if (!(d.points && d.points.length) && !d.scale && !d.origin) return;
            restoreData = d;
            const when = new Date(d.savedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            el.restoreText.textContent = `この動画の前回のデータ（${d.points.length} 点，${when} 保存）があります。`;
            el.restoreBanner.classList.remove('hidden');
        } catch (e) { /* 壊れたデータは無視 */ }
    }

    el.restoreYes.addEventListener('click', () => {
        const d = restoreData;
        el.restoreBanner.classList.add('hidden');
        if (!d) return;
        S.points = new Map(d.points.map(p => [key(p.f, p.id), p]));
        S.origin = d.origin || null;
        S.scale = d.scale || null;
        S.objectCount = d.objectCount || 1;
        el.objectCount.value = S.objectCount;
        S.tZero = !!d.tZero; el.tzeroCheck.checked = S.tZero;
        S.showVelocity = !!d.showVelocity; el.velocityCheck.checked = S.showVelocity;
        if (d.fps && Math.abs(d.fps - S.fps) > 1e-6) {
            S.fps = d.fps; el.fpsInput.value = roundFps(S.fps);
            el.fpsSource.textContent = '（手動設定・復元）';
            updateFpsNominal();
            S.totalFrames = Math.max(1, Math.floor(video.duration * S.fps + 1e-6));
            updateFrameInfo();
        }
        setIntervalN(d.interval || 1);
        S.undo = [];
        renderTabs(); renderAll();
        const last = d.points.reduce((m, p) => Math.max(m, p.f), -1);
        if (last >= 0) gotoFrame(Math.min(lastFrame(), last + S.interval));
        toast('前回のデータを復元しました');
    });
    el.restoreNo.addEventListener('click', () => {
        el.restoreBanner.classList.add('hidden');
        restoreData = null;
        save();
    });

    // 誤ってページを閉じそうになったとき
    window.addEventListener('beforeunload', e => {
        if (S.points.size) { e.preventDefault(); e.returnValue = ''; }
    });

    // テスト用（ブラウザのコンソールから状態を確認できる）
    window.__tracker = { S, buildCsv, gotoFrame };

    // ===================== 初期化 =====================
    // 実際に読み込まれた script.js の版を表示（古いファイルが残っていればここでわかる）
    $('app-version').textContent = `v${APP_VERSION}`;
    renderTabs();
    renderAll();
});
