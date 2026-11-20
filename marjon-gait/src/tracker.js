/* ======================= marker tracking ======================= */
// Each frame: find every bright blob, ignore static reflections, then assign blobs to tracks
// (nearest to the predicted position, one blob per track, similar size). Gates grow with marker speed.

// brightness threshold for markers, from one frame
function markerThreshold(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data, hist = new Uint32Array(256), n = w * h;
  for (let i = 0; i < n; i += 3) hist[(77 * d[4 * i] + 150 * d[4 * i + 1] + 29 * d[4 * i + 2]) >> 8]++;
  const tot = Math.ceil(n / 3); let acc = 0, p995 = 255, mx = 0;
  for (let i = 0; i < 256; i++) { if (hist[i]) mx = i; acc += hist[i]; if (acc >= tot * 0.995 && p995 === 255) p995 = i; }
  return SET.thr > 0 ? SET.thr : Math.min(250, Math.max(p995 + 25, p995 + 0.5 * (mx - p995)));
}

// pixels that are bright in most sampled frames (console lights, belt glare) are ignored
async function buildStaticMask(v) {
  const st = S.views[v], K = Math.min(40, st.nFrames), sc = 2, W = Math.ceil(st.w / sc), H = Math.ceil(st.h / sc);
  await st.src.draw(st.range[0], st.offCtx); st.drawn = st.range[0];
  const thr = markerThreshold(st.offCtx, st.w, st.h), cnt = new Uint8Array(W * H);
  for (let k = 0; k < K; k++) {
    const f = Math.round(st.range[0] + k * (st.range[1] - st.range[0]) / Math.max(1, K - 1));
    await st.src.draw(f, st.offCtx); st.drawn = f;
    const d = st.offCtx.getImageData(0, 0, st.w, st.h).data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = 4 * ((y * sc) * st.w + x * sc); if ((77 * d[i] + 150 * d[i + 1] + 29 * d[i + 2]) >> 8 >= thr) cnt[y * W + x]++; }
    if (k % 8 === 0) { ui.busy(true, `Finding static reflections · ${VIEWS[v].label.toLowerCase()}`, k / K); await sleep(0); }
  }
  const m = new Uint8Array(W * H), lim = Math.max(3, Math.round(0.5 * K));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cnt[y * W + x] >= lim)   // dilate by 3 cells
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) m[yy * W + xx] = 1; }
  st.mask = { m, W, H, sc, thr, key: `${st.name}|${st.range.join('-')}` };
  return st.mask;
}
const isStatic = (st, x, y) => { const M = st.mask; if (!M) return false; const i = Math.floor(y / M.sc) * M.W + Math.floor(x / M.sc); return M.m[i] === 1; };

// connected bright blobs inside a region of interest
function blobsIn(st, x0, y0, x1, y1, thrOver, keepStatic) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(st.w, Math.ceil(x1)); y1 = Math.min(st.h, Math.ceil(y1));
  const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return [];
  const d = st.offCtx.getImageData(x0, y0, w, h).data, thr = thrOver || (st.mask ? st.mask.thr : 160), n = w * h, L = new Uint8Array(n), lab = new Int32Array(n), stack = new Int32Array(n), out = [];
  for (let i = 0; i < n; i++) L[i] = (77 * d[4 * i] + 150 * d[4 * i + 1] + 29 * d[4 * i + 2]) >> 8;
  const lo = thr - 1; let id = 0;
  for (let i = 0; i < n; i++) {
    if (L[i] < thr || lab[i]) continue; id++; let sp = 0, area = 0, sx = 0, sy = 0, sw = 0; stack[sp++] = i; lab[i] = id;
    while (sp) { const j = stack[--sp], x = j % w, y = (j / w) | 0, wt = L[j] - lo; area++; sx += wt * x; sy += wt * y; sw += wt;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) if (k >= 0 && !lab[k] && L[k] >= lo) { lab[k] = id; stack[sp++] = k; } }
    if (area < 3 || !sw) continue;
    const b = { x: x0 + sx / sw + 0.5, y: y0 + sy / sw + 0.5, area };
    if (keepStatic || !isStatic(st, b.x, b.y)) out.push(b);
  }
  return out;
}

// snap a click to the nearest marker centre
function snapToMarker(st, x, y, r) {
  if (st.drawn !== st.frame) return [x, y];
  const bl = blobsIn(st, x - r, y - r, x + r, y + r).filter(b => b.area <= 2000);
  let best = null, bd = r; for (const b of bl) { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
  return best ? [best.x, best.y] : [x, y];
}

async function trackForward(v) {
  const st = S.views[v]; if (!st.src || st.tracking) return [];
  const f0 = st.frame, end = st.range[1], set = settings();
  const act = MARKERS[st.type].map(m => m.id).filter(id => Number.isFinite(st.tr[id].x[f0]));
  if (!act.length) { ui.status('Label or place markers on this frame first.', 'warn'); return []; }
  st.tracking = true; st.stop = false; updateToolbar();
  const msgs = [];
  try {
    if (!st.mask || st.mask.key !== `${st.name}|${st.range.join('-')}`) await buildStaticMask(v);
    await st.src.draw(f0, st.offCtx); st.drawn = f0;
    const T = {};
    for (const id of act) {
      const t = st.tr[id], b = blobsIn(st, t.x[f0] - 12, t.y[f0] - 12, t.x[f0] + 12, t.y[f0] + 12).sort((p, q) => Math.hypot(p.x - t.x[f0], p.y - t.y[f0]) - Math.hypot(q.x - t.x[f0], q.y - t.y[f0]))[0];
      T[id] = { x: t.x[f0], y: t.y[f0], vx: Number.isFinite(t.x[f0 - 1]) ? t.x[f0] - t.x[f0 - 1] : 0, vy: Number.isFinite(t.y[f0 - 1]) ? t.y[f0] - t.y[f0 - 1] : 0, fresh: !Number.isFinite(t.x[f0 - 1]), area: b ? b.area : 40, miss: 0, live: true };
    }
    const base = set.radius, hi = Math.min(254, st.mask.thr + 0.7 * (255 - st.mask.thr));
    // heel and toe sit on a rigid shoe: once the ankle is found, predict them from their offset to it
    const ANCHOR = { heel: 'ankle', toe: 'ankle' }, anch = id => ANCHOR[id] && T[ANCHOR[id]] ? ANCHOR[id] : null;
    for (const id of act) { const a = anch(id); if (a) { T[id].off = [T[id].x - T[a].x, T[id].y - T[a].y]; T[id].len = Math.hypot(...T[id].off); } }
    // the shoe is rigid: a heel or toe candidate must stay about the same distance from the ankle
    const rigidOK = (id, b, found) => { const a = anch(id); if (!a || !found.has(a)) return true; const q = T[id], ox = b.x - T[a].x, oy = b.y - T[a].y, d = Math.hypot(ox, oy); if (Math.abs(d - q.len) > Math.max(5, 0.2 * q.len)) return false;
      let da = Math.abs(Math.atan2(oy, ox) - Math.atan2(q.off[1], q.off[0])); if (da > Math.PI) da = 2 * Math.PI - da;   // and can only rotate so far per frame
      return da <= (0.2 + Math.hypot(...(q.dOff || [0, 0])) / Math.max(1, q.len)) * Math.min(2, 1 + 0.5 * q.miss); };
    const take = (id, x, y, f, area) => { const q = T[id], k = q.miss + 1, nvx = (x - q.x) / k, nvy = (y - q.y) / k;
      q.vx = q.miss ? nvx : 0.7 * nvx + 0.3 * q.vx; q.vy = q.miss ? nvy : 0.7 * nvy + 0.3 * q.vy;
      q.fresh = false; q.x = x; q.y = y; if (area) q.area = 0.85 * q.area + 0.15 * area; q.miss = 0; st.tr[id].x[f] = x; st.tr[id].y[f] = y;
      const a = anch(id); if (a && T[a].miss === 0) { const no = [x - T[a].x, y - T[a].y], d = [(no[0] - q.off[0]) / k, (no[1] - q.off[1]) / k]; q.dOff = q.dOff ? [0.7 * d[0] + 0.3 * q.dOff[0], 0.7 * d[1] + 0.3 * q.dOff[1]] : d; q.off = no; } };
    const assign = (ids, f, usedB, found) => {
      const pred = {}; let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const id of ids) { const q = T[id], k = q.miss + 1, a = anch(id), sp = Math.hypot(q.vx, q.vy); let p, gate;
        if (a && found.has(a)) { const dO = q.dOff || [0, 0]; p = [T[a].x + q.off[0] + dO[0] * Math.min(k, 3), T[a].y + q.off[1] + dO[1] * Math.min(k, 3)]; gate = base * Math.min(3, 1 + 0.5 * q.miss) + 1.2 * Math.hypot(dO[0], dO[1]); }   // foot rotation only
        else { p = [q.x + q.vx * k, q.y + q.vy * k]; gate = base * (q.fresh ? 3 : 1) * (1 + 0.5 * q.miss) + 1.2 * sp; }   // speed unknown on the first step: search wider
        pred[id] = { p, gate }; bx0 = Math.min(bx0, p[0] - gate); by0 = Math.min(by0, p[1] - gate); bx1 = Math.max(bx1, p[0] + gate); by1 = Math.max(by1, p[1] + gate); }
      if (!ids.length) return;
      const blobs = blobsIn(st, bx0, by0, bx1, by1).filter(b => !usedB.some(u => Math.hypot(u.x - b.x, u.y - b.y) < 2)), pairs = [];
      for (const id of ids) { const { p, gate } = pred[id], A = T[id].area;
        blobs.forEach((b, j) => { const d = Math.hypot(b.x - p[0], b.y - p[1]), ar = b.area / A; if (d > gate || ar > 3.5 || ar < 0.25 || !rigidOK(id, b, found)) return;
          pairs.push({ id, j, c: d / gate + 0.35 * Math.abs(Math.log(ar)) }); }); }
      pairs.sort((a, b) => a.c - b.c); const usedJ = new Set();
      for (const pr of pairs) { if (found.has(pr.id) || usedJ.has(pr.j)) continue; found.add(pr.id); usedJ.add(pr.j); const b = blobs[pr.j]; usedB.push(b); take(pr.id, b.x, b.y, f, b.area); }
      // a marker touching belt glare merges into one big blob: look again, close by, for its saturated core
      for (const id of ids) if (!found.has(id)) { const { p } = pred[id], r = Math.min(pred[id].gate, base * (1.5 + 0.5 * T[id].miss));
        const c = blobsIn(st, p[0] - r, p[1] - r, p[0] + r, p[1] + r, hi, true).filter(b => b.area <= 3.5 * T[id].area && Math.hypot(b.x - p[0], b.y - p[1]) <= r && rigidOK(id, b, found) && !usedB.some(u => Math.hypot(u.x - b.x, u.y - b.y) < 4))
          .sort((a, b) => Math.hypot(a.x - p[0], a.y - p[1]) - Math.hypot(b.x - p[0], b.y - p[1]))[0];
        if (c) { found.add(id); usedB.push(c); take(id, c.x, c.y, f, 0); } }
    };
    for (let f = f0 + 1; f <= end && !st.stop; f++) {
      await st.src.draw(f, st.offCtx); st.drawn = f;
      const live = act.filter(id => T[id].live); if (!live.length) break;
      const found = new Set(), usedB = [];
      assign(live.filter(id => !anch(id)), f, usedB, found);
      assign(live.filter(id => anch(id)), f, usedB, found);
      for (const id of live) if (!found.has(id)) { const q = T[id]; st.tr[id].x[f] = NaN; st.tr[id].y[f] = NaN;
        const lim = anch(id) && T[anch(id)].live ? 40 : 8;   // heel and toe can be re-found from the ankle after a longer gap
        if (++q.miss > lim) { q.live = false; msgs.push(`${SHORT[id]} (frame ${f - lim})`); } }
      if (f % 12 === 0 || f === end) { st.frame = f; ui.busy(true, `Tracking ${VIEWS[v].label.toLowerCase()} · frame ${f}`, (f - f0) / Math.max(1, end - f0)); if (v === active) { drawVP(); drawTL(); updateTransport(); } await sleep(0); }
    }
  } finally { st.tracking = false; ui.busy(false); dataChanged(v); updateToolbar(); }
  ui.status(msgs.length ? `${VIEWS[v].label}: tracking lost ${msgs.join(', ')}. Go to that frame, click the marker and track again.` : `${VIEWS[v].label}: tracking complete. Scrub through to check.`, msgs.length ? 'warn' : 'ok');
  ui.refresh(); return msgs;
}
