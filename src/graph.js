/*
 * graph.js
 * 記録データの散布図を SVG で描く（外部ライブラリなし）。描画だけを担当し，アプリの状態には触らない。
 *
 *   const g = createGraph(container, frame => { ... });   // 点をタップしたときに呼ばれる
 *   g.render({ series: [{ color, label, points: [{ f, t, v }] }], xLabel, yLabel, cursor, empty });
 *   g.setCursor(t);   // 縦線だけを動かす
 */
(function (global) {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const HEIGHT = 300;
    const M = { l: 70, r: 16, t: 32, b: 46 };   // 余白
    const R = 4.5;
    const PICK_RADIUS = 24;                     // タップした位置からこの距離以内の点を選ぶ

    function node(parent, tag, attrs, text) {
        const n = document.createElementNS(SVG_NS, tag);
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        if (text !== undefined) n.textContent = text;
        parent.appendChild(n);
        return n;
    }

    // 物体1: ●，物体2: ○，物体3: ■，物体4: □
    function drawMarker(parent, index, x, y, color) {
        const open = index % 2 === 1;
        const paint = { fill: open ? '#fff' : color, stroke: color, 'stroke-width': open ? 1.8 : 1 };
        if (index < 2) node(parent, 'circle', { cx: x, cy: y, r: R, ...paint });
        else node(parent, 'rect', { x: x - R, y: y - R, width: 2 * R, height: 2 * R, ...paint });
    }

    function paddedRange(lo, hi) {
        // 全部同じ値（計算の丸め誤差だけの差を含む）なら，値の大きさから範囲を決める
        const size = Math.max(Math.abs(lo), Math.abs(hi));
        if (hi - lo <= Math.max(size * 1e-9, 1e-9)) {
            const d = size > 1e-9 ? size * 0.1 : 1;
            return [lo - d, hi + d];
        }
        const d = (hi - lo) * 0.05;
        return [lo - d, hi + d];
    }

    // 1・2・5 系列のきりのよい目盛り
    function makeTicks(lo, hi, count) {
        const raw = (hi - lo) / Math.max(1, count);
        const pow = Math.pow(10, Math.floor(Math.log10(raw)));
        const n = raw / pow;
        const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
        const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
        const values = [];
        for (let i = Math.ceil(lo / step - 1e-9); i * step <= hi + step * 1e-9; i++) {
            values.push(i === 0 ? 0 : i * step);
        }
        return { values, decimals };
    }

    function createGraph(container, onPick) {
        const svg = node(container, 'svg', { class: 'graph-svg', height: HEIGHT });
        let data = null, domain = null, cursorLine = null, plotted = [], width = 0;
        let sx = t => t;

        function draw() {
            while (svg.firstChild) svg.removeChild(svg.firstChild);
            domain = null; cursorLine = null; plotted = [];
            width = container.clientWidth;
            if (!width || !data) return;
            svg.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);

            const right = width - M.r, bottom = HEIGHT - M.b;
            const pts = data.series.reduce((a, s) => a.concat(s.points), []);

            let lx = M.l;
            if (data.series.length > 1) {
                data.series.forEach((s, i) => {
                    drawMarker(svg, i, lx + R, 14, s.color);
                    node(svg, 'text', { x: lx + 2 * R + 5, y: 18, class: 'graph-text' }, s.label);
                    lx += 70;
                });
            }

            if (!pts.length) {
                node(svg, 'text', { x: width / 2, y: HEIGHT / 2, class: 'graph-text', 'text-anchor': 'middle' }, data.empty);
                return;
            }

            const ts = pts.map(p => p.t), vs = pts.map(p => p.v);
            const tLo = Math.min(...ts), tHi = Math.max(...ts);
            const cur = data.cursor;
            const [x0, x1] = paddedRange(cur === null ? tLo : Math.min(tLo, cur), cur === null ? tHi : Math.max(tHi, cur));
            const [y0, y1] = paddedRange(Math.min(...vs), Math.max(...vs));
            domain = { tLo, tHi, cursorOutside: cur !== null && (cur < tLo || cur > tHi) };

            sx = t => M.l + (t - x0) / (x1 - x0) * (right - M.l);
            const sy = v => bottom - (v - y0) / (y1 - y0) * (bottom - M.t);

            // 目盛りと格子（0 の線は太く）
            const xt = makeTicks(x0, x1, Math.max(2, Math.floor((right - M.l) / 80)));
            xt.values.forEach(t => {
                const x = sx(t);
                node(svg, 'line', { x1: x, y1: M.t, x2: x, y2: bottom, class: t === 0 ? 'graph-zero' : 'graph-grid' });
                node(svg, 'text', { x, y: bottom + 18, class: 'graph-text', 'text-anchor': 'middle' }, t.toFixed(xt.decimals));
            });
            const yt = makeTicks(y0, y1, 5);
            yt.values.forEach(v => {
                const y = sy(v);
                node(svg, 'line', { x1: M.l, y1: y, x2: right, y2: y, class: v === 0 ? 'graph-zero' : 'graph-grid' });
                node(svg, 'text', { x: M.l - 6, y: y + 4, class: 'graph-text', 'text-anchor': 'end' }, v.toFixed(yt.decimals));
            });
            node(svg, 'rect', { x: M.l, y: M.t, width: right - M.l, height: bottom - M.t, class: 'graph-frame' });

            node(svg, 'text', { x: (M.l + right) / 2, y: HEIGHT - 8, class: 'graph-text', 'text-anchor': 'middle' }, data.xLabel);
            node(svg, 'text', {
                x: 0, y: 0, class: 'graph-text', 'text-anchor': 'middle',
                transform: `translate(14 ${(M.t + bottom) / 2}) rotate(-90)`,
            }, data.yLabel);

            if (cur !== null) {
                cursorLine = node(svg, 'line', { x1: sx(cur), y1: M.t, x2: sx(cur), y2: bottom, class: 'graph-cursor' });
            }

            data.series.forEach((s, i) => {
                s.points.forEach(p => {
                    const x = sx(p.t), y = sy(p.v);
                    drawMarker(svg, i, x, y, s.color);
                    plotted.push({ x, y, f: p.f });
                });
            });
        }

        function setCursor(t) {
            if (!data) return;
            data.cursor = t;
            if (!domain) return;
            // 記録した点の範囲の外にある（または外から戻った）ときは，横軸を合わせて描き直す
            const outside = t < domain.tLo || t > domain.tHi;
            if (outside || domain.cursorOutside || !cursorLine) {
                draw();
                return;
            }
            cursorLine.setAttribute('x1', sx(t));
            cursorLine.setAttribute('x2', sx(t));
        }

        svg.addEventListener('click', e => {
            const r = svg.getBoundingClientRect();
            const x = e.clientX - r.left, y = e.clientY - r.top;
            let best = null, bestD = PICK_RADIUS;
            plotted.forEach(p => {
                const d = Math.hypot(p.x - x, p.y - y);
                if (d <= bestD) { best = p; bestD = d; }
            });
            if (best) onPick(best.f);
        });

        if ('ResizeObserver' in window) {
            new ResizeObserver(() => { if (container.clientWidth !== width) draw(); }).observe(container);
        }

        return {
            render(d) {
                data = d;
                draw();
            },
            setCursor,
        };
    }

    global.createGraph = createGraph;
})(window);
