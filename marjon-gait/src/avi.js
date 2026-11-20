/* ======================= AVI reader ======================= */
// Browsers cannot play AVI, so frames are read straight from the file.
// Supports MJPEG (with or without Huffman tables) and uncompressed 8/24/32-bit and greyscale video,
// including OpenDML files over 1 GB. Other codecs are converted to MP4 in the browser with ffmpeg.wasm.
const AVI = (() => {
  const fcc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  const read = async (file, pos, len) => new DataView(await file.slice(pos, pos + len).arrayBuffer());

  async function parse(file) {
    const h = await read(file, 0, 12);
    if (fcc(h, 0) !== 'RIFF' || fcc(h, 8) !== 'AVI ') throw new Error('Not an AVI file.');
    const info = { frames: [], vidStream: -1 }; let pos = 0;
    while (pos + 12 <= file.size) {                       // RIFF 'AVI ' then any RIFF 'AVIX' extensions
      const r = await read(file, pos, 12); if (fcc(r, 0) !== 'RIFF') break;
      const rEnd = Math.min(file.size, pos + 8 + r.getUint32(4, true)); let p = pos + 12;
      while (p + 8 <= rEnd) {
        const c = await read(file, p, 12), id = fcc(c, 0), size = c.getUint32(4, true);
        if (id === 'LIST' && fcc(c, 8) === 'hdrl') parseHeaders(new DataView(await file.slice(p + 12, p + 8 + size).arrayBuffer()), info);
        else if (id === 'LIST' && fcc(c, 8) === 'movi') await scanMovi(file, p + 12, p + 8 + size, info);
        p += 8 + size + (size & 1);
      }
      pos = rEnd + (rEnd & 1);
    }
    if (info.vidStream < 0) throw new Error('No video stream found in this AVI.');
    if (!info.frames.length) throw new Error('No video frames found in this AVI.');
    return info;
  }
  function parseHeaders(dv, info) {
    let p = 0, stream = -1;
    const walk = (s, e) => { let q = s;
      while (q + 8 <= e) { const id = fcc(dv, q), size = dv.getUint32(q + 4, true);
        if (id === 'avih') { info.usPerFrame = dv.getUint32(q + 8, true); info.width = dv.getUint32(q + 40, true); info.height = dv.getUint32(q + 44, true); }
        else if (id === 'LIST' && fcc(dv, q + 8) === 'strl') { stream++; walk(q + 12, q + 8 + size); }
        else if (id === 'strh' && info.vidStream < 0 && fcc(dv, q + 8) === 'vids') { info.vidStream = stream; info.handler = fcc(dv, q + 12); info.scale = dv.getUint32(q + 28, true); info.rate = dv.getUint32(q + 32, true); info._take = true; }
        else if (id === 'strf' && info._take) { info._take = false;
          const b = q + 8; info.bw = dv.getInt32(b + 4, true); info.bh = dv.getInt32(b + 8, true); info.bits = dv.getUint16(b + 14, true);
          info.compression = dv.getUint32(b + 16, true) === 0 ? 'RGB' : fcc(dv, b + 16); const hsz = dv.getUint32(b, true), nPal = dv.getUint32(b + 32, true) || (info.bits <= 8 ? 1 << info.bits : 0);
          if (info.bits <= 8 && nPal) { info.palette = new Uint8Array(nPal * 4); for (let i = 0; i < nPal * 4 && b + hsz + i < q + 8 + size; i++) info.palette[i] = dv.getUint8(b + hsz + i); } }
        else if (id === 'strh') info._take = false;
        q += 8 + size + (size & 1); } };
    walk(p, dv.byteLength);
  }
  async function scanMovi(file, s, e, info) {
    const tag = String(Math.max(0, info.vidStream)).padStart(2, '0');
    let p = s, buf = null, bufPos = 0;
    const hdr = async q => { if (!buf || q < bufPos || q + 12 > bufPos + buf.byteLength) { bufPos = q; buf = await read(file, q, Math.min(1 << 20, e - q + 12)); } return q - bufPos; };
    while (p + 8 <= e) {
      const o = await hdr(p), id = fcc(buf, o), size = buf.getUint32(o + 4, true);
      if (id === 'LIST') { p += 12; continue; }                 // 'rec ' groups: step inside
      if (id.startsWith(tag) && (id.endsWith('dc') || id.endsWith('db'))) {
        if (size === 0 && info.frames.length) info.frames.push(info.frames[info.frames.length - 1]); // dropped frame repeats the previous one
        else if (size > 0) info.frames.push({ pos: p + 8, size });
      }
      p += 8 + size + (size & 1);
    }
  }

  // standard JPEG Huffman tables (ITU T.81 Annex K), added to MJPEG frames that leave them out
  const DHT = (() => {
    const t = (cls, bits, vals) => [cls, ...bits, ...vals];
    const dcL = t(0x00, [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const dcC = t(0x01, [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const acLv = [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a];
    const acCv = [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a];
    const tail = rows => rows.flatMap(([a, b]) => { const o = []; for (let v = a; v <= b; v++) o.push(v); return o; });
    acLv.push(...tail([[0x34, 0x3a], [0x43, 0x4a], [0x53, 0x5a], [0x63, 0x6a], [0x73, 0x7a], [0x83, 0x8a], [0x92, 0x9a], [0xa2, 0xaa], [0xb2, 0xba], [0xc2, 0xca], [0xd2, 0xda], [0xe1, 0xea], [0xf1, 0xfa]]));
    acCv.push(...tail([[0x35, 0x3a], [0x43, 0x4a], [0x53, 0x5a], [0x63, 0x6a], [0x73, 0x7a], [0x82, 0x8a], [0x92, 0x9a], [0xa2, 0xaa], [0xb2, 0xba], [0xc2, 0xca], [0xd2, 0xda], [0xe2, 0xea], [0xf2, 0xfa]]));
    const acL = t(0x10, [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], acLv);
    const acC = t(0x11, [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], acCv);
    const body = [...dcL, ...dcC, ...acL, ...acC], len = body.length + 2;
    return new Uint8Array([0xff, 0xc4, len >> 8, len & 255, ...body]);
  })();
  function withHuffman(bytes) {
    for (let i = 2; i + 3 < bytes.length;) {                  // walk JPEG markers up to start of scan
      if (bytes[i] !== 0xff) break; const m = bytes[i + 1];
      if (m === 0xc4) return bytes;                           // has its own tables
      if (m === 0xda) break;
      i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    }
    const out = new Uint8Array(bytes.length + DHT.length); out.set(bytes.subarray(0, 2)); out.set(DHT, 2); out.set(bytes.subarray(2), 2 + DHT.length); return out;
  }

  async function source(file) {
    const info = await parse(file), w = Math.abs(info.bw || info.width), h = Math.abs(info.bh || info.height);
    const fps = info.rate && info.scale ? info.rate / info.scale : 1e6 / info.usPerFrame;
    const comp = (info.compression || '').trim().toUpperCase(), n = info.frames.length;
    const mj = ['MJPG', 'AVRN', 'DMB1', 'AVDJ', 'JPEG', 'MJLS'].includes(comp);
    const raw = comp === 'RGB' || ['Y800', 'GREY', 'Y8', 'RAW'].includes(comp);
    if (!mj && !raw) { const e = new Error(`AVI codec ${info.compression || info.handler} needs converting`); e.codec = info.compression || info.handler; throw e; }
    const img = raw ? new ImageData(w, h) : null, tmp = raw ? document.createElement('canvas') : null;
    if (tmp) { tmp.width = w; tmp.height = h; }
    return { kind: 'video', avi: true, codec: mj ? 'MJPEG' : comp === 'RGB' ? `uncompressed ${info.bits}-bit` : 'greyscale', w, h, fps, nFrames: n, duration: n / fps,
      draw: async (i, ctx) => {
        const f = info.frames[clamp(i, 0, n - 1)], bytes = new Uint8Array(await file.slice(f.pos, f.pos + f.size).arrayBuffer());
        if (mj) { const bmp = await createImageBitmap(new Blob([withHuffman(bytes)], { type: 'image/jpeg' })); ctx.drawImage(bmp, 0, 0, w, h); bmp.close(); return; }
        const bits = comp === 'RGB' ? info.bits : 8, stride = Math.ceil(w * bits / 32) * 4, bottomUp = comp === 'RGB' && (info.bh || info.height) > 0, d = img.data, pal = info.palette;
        for (let y = 0; y < h; y++) { const src = (bottomUp ? h - 1 - y : y) * stride; let o = y * w * 4;
          for (let x = 0; x < w; x++, o += 4) {
            if (bits === 24) { d[o] = bytes[src + 3 * x + 2]; d[o + 1] = bytes[src + 3 * x + 1]; d[o + 2] = bytes[src + 3 * x]; }
            else if (bits === 32) { d[o] = bytes[src + 4 * x + 2]; d[o + 1] = bytes[src + 4 * x + 1]; d[o + 2] = bytes[src + 4 * x]; }
            else { const v = bytes[src + x]; if (pal && comp === 'RGB') { d[o] = pal[4 * v + 2]; d[o + 1] = pal[4 * v + 1]; d[o + 2] = pal[4 * v]; } else d[o] = d[o + 1] = d[o + 2] = v; }
            d[o + 3] = 255; } }
        tmp.getContext('2d').putImageData(img, 0, 0); ctx.drawImage(tmp, 0, 0);
      } };
  }

  // other codecs (e.g. Xvid, H.264 in AVI): convert to MP4 in the browser, loading ffmpeg.wasm on first use
  let ff = null;
  async function convert(file, onProgress) {
    const BASE = 'https://cdn.jsdelivr.net/npm/', V = { ffmpeg: '@ffmpeg/ffmpeg@0.12.10', util: '@ffmpeg/util@0.12.1', core: '@ffmpeg/core@0.12.6' };
    if (!ff) {
      const { FFmpeg } = await import(BASE + V.ffmpeg + '/dist/esm/index.js'), { toBlobURL } = await import(BASE + V.util + '/dist/esm/index.js');
      ff = new FFmpeg();
      const classWorkerURL = URL.createObjectURL(new Blob([`import '${BASE + V.ffmpeg}/dist/esm/worker.js';`], { type: 'text/javascript' })); // keeps the worker's own relative imports working
      await ff.load({ classWorkerURL, coreURL: await toBlobURL(BASE + V.core + '/dist/esm/ffmpeg-core.js', 'text/javascript'), wasmURL: await toBlobURL(BASE + V.core + '/dist/esm/ffmpeg-core.wasm', 'application/wasm') });
    }
    const prog = ({ progress }) => onProgress && onProgress(progress); ff.on('progress', prog);
    try {
      await ff.writeFile('in.avi', new Uint8Array(await file.arrayBuffer()));
      // every frame kept as a high-quality keyframe (all-intra H.264), so frame stepping stays exact
      const rc = await ff.exec(['-i', 'in.avi', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-g', '1', '-pix_fmt', 'yuv420p', 'out.mp4']);
      if (rc !== 0) throw new Error('conversion failed');
      const data = await ff.readFile('out.mp4'); await ff.deleteFile('in.avi'); await ff.deleteFile('out.mp4');
      return new File([data], file.name.replace(/\.avi$/i, '') + ' (converted).mp4', { type: 'video/mp4' });
    } finally { ff.off('progress', prog); }
  }
  const isAVI = f => /\.avi$/i.test(f.name) || /avi|msvideo/i.test(f.type);
  return { parse, source, convert, isAVI, withHuffman, DHT };
})();
