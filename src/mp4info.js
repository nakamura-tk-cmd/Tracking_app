/*
 * mp4info.js
 * MP4 / MOV（QuickTime）ファイルのヘッダを読み，映像トラックの fps とフレーム数を取得する。
 * 動画全体を読み込まず，必要な部分（moov ボックス）だけを読むので大きな動画でも高速。
 *
 *   const info = await readVideoInfo(file);
 *   // => { fps: 30, frames: 312, duration: 10.4, variable: false } または null
 */
(function (global) {
    'use strict';

    async function readBytes(file, start, end) {
        const blob = file.slice(start, end);
        if (blob.arrayBuffer) return new Uint8Array(await blob.arrayBuffer());
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(new Uint8Array(r.result));
            r.onerror = reject;
            r.readAsArrayBuffer(blob);
        });
    }

    function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
    function u64(b, o) { return u32(b, o) * 4294967296 + u32(b, o + 4); }
    function fourcc(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

    // buf[start, end) にある子ボックスを列挙
    function children(buf, start, end) {
        const list = [];
        let o = start;
        while (o + 8 <= end) {
            let size = u32(buf, o);
            const type = fourcc(buf, o + 4);
            let header = 8;
            if (size === 1) { size = u64(buf, o + 8); header = 16; }
            else if (size === 0) { size = end - o; }
            if (size < header || o + size > end) break;
            list.push({ type, start: o + header, end: o + size });
            o += size;
        }
        return list;
    }

    function find(buf, box, type) {
        return children(buf, box.start, box.end).find(c => c.type === type) || null;
    }

    function parseTrak(buf, trak) {
        const mdia = find(buf, trak, 'mdia');
        if (!mdia) return null;
        const hdlr = find(buf, mdia, 'hdlr');
        if (!hdlr || fourcc(buf, hdlr.start + 8) !== 'vide') return null;

        const mdhd = find(buf, mdia, 'mdhd');
        if (!mdhd) return null;
        const version = buf[mdhd.start];
        const timescale = version === 1 ? u32(buf, mdhd.start + 20) : u32(buf, mdhd.start + 12);
        if (!timescale) return null;

        const minf = find(buf, mdia, 'minf');
        const stbl = minf && find(buf, minf, 'stbl');
        const stts = stbl && find(buf, stbl, 'stts');
        if (!stts) return null;

        const count = u32(buf, stts.start + 4);
        let frames = 0, total = 0, domCount = 0, domDelta = 0;
        for (let i = 0; i < count; i++) {
            const p = stts.start + 8 + i * 8;
            if (p + 8 > stts.end) break;
            const n = u32(buf, p), d = u32(buf, p + 4);
            frames += n;
            total += n * d;
            if (n > domCount && d > 0) { domCount = n; domDelta = d; }
        }
        if (!frames || !total) return null;

        // 大部分のコマが同じ間隔なら，その間隔から正確な fps を求める
        const variable = domCount < frames * 0.9;
        const fps = variable ? frames * timescale / total : timescale / domDelta;
        return { fps, frames, duration: total / timescale, variable };
    }

    async function readVideoInfo(file) {
        try {
            let offset = 0, guard = 0;
            while (offset + 8 <= file.size && guard++ < 64) {
                const h = await readBytes(file, offset, offset + 16);
                let size = u32(h, 0);
                const type = fourcc(h, 4);
                if (size === 1) size = u64(h, 8);
                else if (size === 0) size = file.size - offset;
                if (size < 8) return null;

                if (type === 'moov') {
                    if (size > 200 * 1024 * 1024) return null;
                    const buf = await readBytes(file, offset, offset + size);
                    const moov = children(buf, 0, buf.length)[0];
                    if (!moov) return null;
                    for (const c of children(buf, moov.start, moov.end)) {
                        if (c.type !== 'trak') continue;
                        const info = parseTrak(buf, c);
                        if (info) return info;
                    }
                    return null;
                }
                offset += size;
            }
        } catch (e) {
            console.warn('mp4info: 読み取り失敗', e);
        }
        return null;
    }

    global.readVideoInfo = readVideoInfo;
})(window);
