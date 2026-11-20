/* ======================= application ======================= */
let active = 'left', mode = 'place', pane = 'traj', playing = null;
const cur = () => S.views[active];
const ui = {};
const VKEYS = ['left', 'right', 'rear'];
const SHORT = { shoulder: 'Shoulder', hip: 'Hip', knee: 'Knee', ankle: 'Ankle', heel: 'Heel', toe: 'Forefoot',
  lPSIS: 'L PSIS', rPSIS: 'R PSIS', lThigh: 'L thigh', rThigh: 'R thigh', lKnee: 'L knee', rKnee: 'R knee', lHeel: 'L heel', rHeel: 'R heel' };
for (const v of VKEYS) { S.views[v].ver = 0; S.views[v].vt = null; }

ui.status = (msg, cls = '') => { const e = $('#statusMsg'); e.textContent = msg; e.className = cls; };
ui.busy = (on, txt = '', frac = 0) => { $('#busy').hidden = !on; $('#busyTxt').textContent = txt; $('#busyFill').style.width = (100 * frac) + '%'; };
ui.refresh = () => { renderTree(); renderPanes(); drawTL(); drawVP(); updateTransport(); updateStatusBar(); updateToolbar(); };

/* ---------- sources ---------- */
function placeholderSource(w, h, duration) {
  return { kind: 'none', w, h, duration, draw: async (i, ctx) => {
    ctx.fillStyle = '#141618'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#5b636b'; ctx.textAlign = 'center';
    ctx.font = `${Math.round(h / 26)}px Segoe UI, system-ui`; ctx.fillText('Video not linked. Open the original file to see frames.', w / 2, h / 2); } };
}
function attachSource(v, src, name, keep = false) {
  const st = S.views[v];
  if (src.fps) { st.fileFps = src.fps; if (!keep) st.capFps = src.fps; }
  const n = src.nFrames || Math.max(1, Math.floor(src.duration * st.fileFps)), sameSize = st.src && st.w === src.w && st.h === src.h && st.nFrames === n;
  st.src = src; st.name = name; st.w = src.w; st.h = src.h;
  st.off = document.createElement('canvas'); st.off.width = src.w; st.off.height = src.h;
  st.offCtx = st.off.getContext('2d', { willReadFrequently: true });
  st.drawn = -1; st.vt = null;
  if (!(keep && sameSize)) resetFrames(v); else { st.ver++; goto(v, st.frame); }
}
function resetFrames(v) {
  const st = S.views[v];
  st.nFrames = st.src.nFrames || Math.max(1, Math.floor(st.src.duration * st.fileFps));
  st.range = [0, st.nFrames - 1]; st.tr = {};
  for (const m of MARKERS[st.type]) st.tr[m.id] = { x: new Float64Array(st.nFrames).fill(NaN), y: new Float64Array(st.nFrames).fill(NaN) };
  st.ev = st.type === 'side' ? { IC: [], TO: [] } : { L: [], R: [] }; st.res = null; st.selEv = null; st.frame = 0; st.drawn = -1; st.ver++;
  goto(v, 0);
}
async function goto(v, i) {
  const st = S.views[v]; if (!st.src || st.tracking) return;
  st.frame = clamp(Math.round(i), 0, st.nFrames - 1); st.want = st.frame;
  if (v === active) { updateTransport(); drawTL(); }
  if (st.busy) return; st.busy = true;
  try { while (st.drawn !== st.want) { const f = st.want; await st.src.draw(f, st.offCtx); st.drawn = f; } } finally { st.busy = false; }
  if (v === active) { drawVP(); updateStatusBar(); renderPanes(true); }
}
const gotoA = i => goto(active, i);
function setActive(v) { active = v; ui.refresh(); }
function dataChanged(v) { const st = S.views[v]; st.ver++; st.res = null; }

/* ---------- loading ---------- */
let pendingVideo = null;
function openVideo(v) { pendingVideo = v; $('#fVideo').value = ''; $('#fVideo').click(); }
$('#fVideo').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; const v = pendingVideo || active, st = S.views[v];
  try {
    ui.status(`Opening ${f.name}…`);
    const src = AVI.isAVI(f) ? await openAVI(f) : await videoSource(v, f); if (!src) return;
    const linking = st.src && st.src.kind === 'none';
    attachSource(v, src, f.name, linking); st.truth = null;
    const applied = !calibOK(st) && applyStation(v, true);
    setActive(v);
    if (!applied) ui.status(src.avi ? `${VIEWS[v].label}: ${f.name} (${src.codec} AVI, ${src.w}×${src.h}, ${src.nFrames} frames at ${+src.fps.toFixed(2)} fps from the file). Check the capture rate in Properties, then calibrate.`
      : `${VIEWS[v].label}: ${f.name} (${src.w}×${src.h}). Check the frame rates in Properties, then calibrate.`);
  } catch (err) { ui.status(err.message, 'warn'); }
};
async function openAVI(f) {
  try { return await AVI.source(f); }
  catch (e) {
    if (!e.codec) throw e;
    ui.status(`${f.name} uses the ${e.codec} codec, which browsers cannot read. Converting it in the browser (first use downloads the converter, about 30 MB)…`);
    ui.busy(true, `Converting ${f.name}`, 0);
    try {
      const info = await AVI.parse(f), fps = info.rate && info.scale ? info.rate / info.scale : 1e6 / info.usPerFrame;
      const conv = await AVI.convert(f, p => ui.busy(true, `Converting ${f.name} · ${Math.round(100 * clamp(p, 0, 1))}%`, clamp(p, 0, 1)));
      S.views[pendingVideo || active].fileFps = fps;
      const src = await videoSource(pendingVideo || active, conv);
      return Object.assign(src, { avi: true, codec: `${e.codec} (converted)`, fps, nFrames: info.frames.length });
    }
    catch (err) { ui.status(`Could not convert ${f.name} (${e.codec}). Check the internet connection, or convert it to MP4 (H.264) or MJPEG AVI first, e.g. with HandBrake or ffmpeg.`, 'warn'); return null; }
    finally { ui.busy(false); }
  }
}
function loadDemo(v, quiet) {
  const st = S.views[v]; st.capFps = 200; st.fileFps = 200;
  attachSource(v, demoSource(v), 'Demo runner (synthetic)');
  const c = Synth.calib(v); st.calib = { p: c.p.map(p => [...p]), cm: c.cm }; st.truth = Synth.truth(v);
  if (VIEWS[v].type === 'side') st.standing = { frame: null, foot: 0, note: 'demo' };
  $('#speed').value = 10; $('#speedUnit').value = 'kmh';
  if (!quiet) { setActive(v); ui.status(`${VIEWS[v].label}: demo runner loaded and calibrated. Auto-label, then track.`, 'ok'); }
}
function loadDemoAll() { for (const v of VKEYS) loadDemo(v, true); if (!$('#cName').value) $('#cName').value = 'Demo runner'; setActive('left'); ui.status('Demo runner loaded in all three views. Press "Process all views".', 'ok'); }

/* ---------- camera stations ---------- */
const STKEY = 'marjonGait.stations.v1', MDCKEY = 'marjonGait.mdc.v1';
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
const lsSet = (k, o) => { try { localStorage.setItem(k, JSON.stringify(o)); return true; } catch { return false; } };
function saveStation(v) {
  const st = S.views[v]; if (!calibOK(st)) { ui.status('Calibrate this view before saving it as a station.', 'warn'); return; }
  const all = lsGet(STKEY); all[v] = { p: st.calib.p, cm: st.calib.cm, w: st.w, h: st.h, saved: new Date().toISOString() };
  if (lsSet(STKEY, all)) ui.status(`${VIEWS[v].label} calibration saved as this browser's camera station. It is applied automatically to new videos of the same size.`, 'ok');
  else ui.status('This browser blocked saving. Open the app as a file in Chrome or Edge.', 'warn');
  ui.refresh();
}
function applyStation(v, auto) {
  const s = lsGet(STKEY)[v], st = S.views[v]; if (!s) { if (!auto) ui.status('No saved station for this view.', 'warn'); return false; }
  if (s.w !== st.w || s.h !== st.h) { if (!auto) ui.status(`The saved station is for ${s.w}×${s.h} video; this video is ${st.w}×${st.h}.`, 'warn'); return false; }
  st.calib = { p: s.p.map(p => [...p]), cm: s.cm }; dataChanged(v);
  ui.status(`${VIEWS[v].label}: station calibration applied (saved ${new Date(s.saved).toLocaleDateString('en-GB')}). Check the yellow line sits on the belt.`, 'ok');
  ui.refresh(); return true;
}
function forgetStation(v) { const all = lsGet(STKEY); delete all[v]; lsSet(STKEY, all); ui.refresh(); }

/* ---------- auto-labelling ---------- */
function detectBlobs(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data, n = w * h, L = new Uint8Array(n), hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const l = (77 * d[4 * i] + 150 * d[4 * i + 1] + 29 * d[4 * i + 2]) >> 8; L[i] = l; hist[l]++; }
  let acc = 0, p995 = 255, mx = 0; for (let i = 0; i < 256; i++) { if (hist[i]) mx = i; acc += hist[i]; if (acc >= n * 0.995 && p995 === 255) p995 = i; }
  const thr = SET.thr > 0 ? SET.thr : Math.min(250, Math.max(p995 + 25, p995 + 0.5 * (mx - p995)));
  const lab = new Int32Array(n), stack = new Int32Array(n), blobs = []; let id = 0;
  for (let i = 0; i < n; i++) {
    if (L[i] < thr || lab[i]) continue; id++; let sp = 0, area = 0, sx = 0, sy = 0, sw = 0; stack[sp++] = i; lab[i] = id;
    while (sp) { const j = stack[--sp], x = j % w, y = (j / w) | 0, wt = L[j] - thr + 1; area++; sx += wt * x; sy += wt * y; sw += wt;
      if (x > 0 && !lab[j - 1] && L[j - 1] >= thr) { lab[j - 1] = id; stack[sp++] = j - 1; }
      if (x < w - 1 && !lab[j + 1] && L[j + 1] >= thr) { lab[j + 1] = id; stack[sp++] = j + 1; }
      if (y > 0 && !lab[j - w] && L[j - w] >= thr) { lab[j - w] = id; stack[sp++] = j - w; }
      if (y < h - 1 && !lab[j + w] && L[j + w] >= thr) { lab[j + w] = id; stack[sp++] = j + w; } }
    if (area >= 3 && area <= n * 0.003) blobs.push({ x: sx / sw + 0.5, y: sy / sw + 0.5, area });
  }
  return blobs.sort((a, b) => b.area - a.area);
}
async function autoLabel(v) {
  const st = S.views[v]; if (!st.src) return false;
  if (st.drawn !== st.frame) { await st.src.draw(st.frame, st.offCtx); st.drawn = st.frame; }
  const need = MARKERS[st.type].length, blobs = detectBlobs(st.offCtx, st.w, st.h);
  if (blobs.length < need) { ui.status(`${VIEWS[v].label}: found ${blobs.length} of ${need} markers on frame ${st.frame}. Move to a frame where every marker is visible, or place the missing ones by hand.`, 'warn'); return false; }
  const b = blobs.slice(0, need).sort((p, q) => p.y - q.y), put = (id, p) => { st.tr[id].x[st.frame] = p.x; st.tr[id].y[st.frame] = p.y; };
  if (st.type === 'side') {
    put('shoulder', b[0]); put('hip', b[1]); put('knee', b[2]);
    const foot = b.slice(3), kd = p => Math.hypot(p.x - b[2].x, p.y - b[2].y), ank = foot.reduce((p, q) => kd(q) < kd(p) ? q : p), rest = foot.filter(p => p !== ank);
    const dist = p => Math.hypot(p.x - ank.x, p.y - ank.y), toe = dist(rest[0]) > dist(rest[1]) ? rest[0] : rest[1];
    put('ankle', ank); put('toe', toe); put('heel', rest.find(p => p !== toe));
  } else {
    const pair = (a, c) => a.x < c.x ? [a, c] : [c, a];
    const [lp, rp] = pair(b[0], b[1]), [lt, rt] = pair(b[2], b[3]);
    const near = (ref, cands) => cands.reduce((p, q) => Math.abs(q.x - ref.x) < Math.abs(p.x - ref.x) ? q : p);
    const lk = near(lt, [b[4], b[5]]), rk = lk === b[4] ? b[5] : b[4], lh = near(lk, [b[6], b[7]]), rh = lh === b[6] ? b[7] : b[6];
    put('lPSIS', lp); put('rPSIS', rp); put('lThigh', lt); put('rThigh', rt); put('lKnee', lk); put('rKnee', rk); put('lHeel', lh); put('rHeel', rh);
  }
  dataChanged(v); ui.status(`${VIEWS[v].label}: ${need} markers labelled on frame ${st.frame}. Check the labels, then track.`, 'ok'); ui.refresh();
  return true;
}

/* ---------- tracking ---------- */
async function trackForward(v) {
  const st = S.views[v]; if (!st.src || st.tracking) return [];
  const f0 = st.frame, end = st.range[1], set = settings();
  const act = MARKERS[st.type].map(m => m.id).filter(id => Number.isFinite(st.tr[id].x[f0]));
  if (!act.length) { ui.status('Label or place markers on this frame first.', 'warn'); return []; }
  st.tracking = true; st.stop = false; updateToolbar();
  const lost = {}, stopped = {}, vel = {}, last = {}, msgs = [];
  for (const id of act) { const t = st.tr[id]; lost[id] = 0; last[id] = [t.x[f0], t.y[f0]]; vel[id] = Number.isFinite(t.x[f0 - 1]) ? [t.x[f0] - t.x[f0 - 1], t.y[f0] - t.y[f0 - 1]] : [0, 0]; }
  try {
    for (let f = f0 + 1; f <= end && !st.stop; f++) {
      await st.src.draw(f, st.offCtx); st.drawn = f;
      for (const id of act) {
        if (stopped[id]) continue;
        const t = st.tr[id], k = lost[id] + 1, pred = [last[id][0] + vel[id][0] * k, last[id][1] + vel[id][1] * k];
        const hit = findMarker(st.offCtx, pred, set.radius * (1 + 0.5 * lost[id]), set.contrast);
        if (hit) { vel[id] = [(hit[0] - last[id][0]) / k, (hit[1] - last[id][1]) / k]; last[id] = hit; t.x[f] = hit[0]; t.y[f] = hit[1]; lost[id] = 0; }
        else { t.x[f] = NaN; t.y[f] = NaN; if (++lost[id] > 6) { stopped[id] = true; msgs.push(`${SHORT[id]} (frame ${f - 6})`); } }
      }
      if (f % 12 === 0 || f === end) { st.frame = f; ui.busy(true, `Tracking ${VIEWS[v].label.toLowerCase()} · frame ${f}`, (f - f0) / Math.max(1, end - f0)); if (v === active) { drawVP(); drawTL(); updateTransport(); } await sleep(0); }
      if (act.every(id => stopped[id])) break;
    }
  } finally { st.tracking = false; ui.busy(false); dataChanged(v); updateToolbar(); }
  ui.status(msgs.length ? `${VIEWS[v].label}: tracking lost ${msgs.join(', ')}. Go to that frame, click the marker and track again.` : `${VIEWS[v].label}: tracking complete. Scrub through to check.`, msgs.length ? 'warn' : 'ok');
  ui.refresh(); return msgs;
}

/* ---------- calculation ---------- */
function calcView(v, quiet) {
  const st = S.views[v];
  if (!st.src || !calibOK(st)) { if (!quiet) ui.status('Load a video and calibrate first.', 'warn'); return false; }
  const ok = st.type === 'side' ? st.ev.IC.length >= 2 : st.ev.L.length >= 1 && st.ev.R.length >= 1;
  if (!ok) { if (!quiet) ui.status('Detect or add gait events first.', 'warn'); return false; }
  if (st.type === 'side') {
    st.res = computeSide(v); const IC = st.ev.IC; st.res.orderWarn = [];
    for (let i = 0; i < IC.length - 1; i++) if (st.ev.TO.filter(t => t > IC[i] && t < IC[i + 1]).length !== 1) st.res.orderWarn.push(IC[i]);
    if (S.views.rear.res) S.views.rear.res = computeRear();
  } else st.res = computeRear();
  if (!quiet) { pane = 'data'; ui.status(`${VIEWS[v].label}: calculated from ${st.type === 'side' ? st.res.n + ' strides' : st.res.rows.length + ' stances'}.`, 'ok'); }
  ui.refresh(); return true;
}
async function processAll() {
  const views = VKEYS.filter(v => S.views[v].src && calibOK(S.views[v]));
  if (!views.length) { ui.status('Load and calibrate at least one view first.', 'warn'); return; }
  const done = [];
  for (const v of views) {
    const st = S.views[v]; setActive(v);
    const placed = MARKERS[st.type].every(m => Number.isFinite(st.tr[m.id].x[st.range[0]]));
    if (!placed) { st.frame = st.range[0]; st.drawn = -1; await goto(v, st.range[0]); if (!(await autoLabel(v))) { done.push(`${VIEWS[v].label}: auto-label failed`); continue; } }
    else { st.frame = st.range[0]; await goto(v, st.range[0]); }
    const lost = await trackForward(v);
    detectEvents(v); calcView(v, true);
    done.push(`${VIEWS[v].label}${lost.length ? ' (tracking gaps)' : ''}`);
  }
  if (S.views.rear.res) S.views.rear.res = computeRear();
  pane = 'data'; ui.refresh(); ui.status(`Processed: ${done.join(' · ')}. Now check the events in each view.`, 'ok');
}
function setStanding(v) {
  const st = S.views[v], h = st.tr.heel, t = st.tr.toe, f = st.frame;
  if (!calibOK(st) || !Number.isFinite(h.x[f]) || !Number.isFinite(t.x[f])) { ui.status('Calibrate and place the heel and forefoot markers on a standing frame first.', 'warn'); return; }
  const w = toWorld(st), a = w(h.x[f], h.y[f]), b = w(t.x[f], t.y[f]), d = Math.sign(b[0] - a[0]) || 1;
  st.standing = { frame: f, foot: Math.atan2(b[1] - a[1], (b[0] - a[0]) * d) * R2D, clip: st.name }; dataChanged(v);
  ui.status(`${VIEWS[v].label}: standing foot angle ${fmt(st.standing.foot, 1)}° set. Load the running clip next; this reference is kept.`, 'ok'); ui.refresh();
}

/* ---------- viewport ---------- */
const vp = $('#vp');
function sizeCanvas(cv) { const r = cv.getBoundingClientRect(), W = Math.round(r.width * devicePixelRatio), H = Math.round(r.height * devicePixelRatio); if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; return true; } return false; }
function fitVT(st) { const s = Math.min(vp.width / st.w, vp.height / st.h) * 0.97; st.vt = { s, ox: (vp.width - st.w * s) / 2, oy: (vp.height - st.h * s) / 2 }; }
function upDir(st) { const [p1, p2] = st.calib.p, L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), ex = [(p2[0] - p1[0]) / L, (p2[1] - p1[1]) / L]; return { ex, up: [ex[1], -ex[0]], cmpx: st.calib.cm / L }; }
function drawVP() {
  const resized = sizeCanvas(vp), st = cur(), ctx = vp.getContext('2d'), dpr = devicePixelRatio;
  ctx.fillStyle = '#040b17'; ctx.fillRect(0, 0, vp.width, vp.height);
  const empty = $('#vpEmpty'); empty.hidden = !!st.src;
  if (!st.src) { empty.innerHTML = `<div class="big">${VIEWS[active].label} view</div><div>No video loaded.</div><div class="acts"><button id="eOpen">Open video…</button><button id="eDemo">Load demo runner</button><button id="eDemoAll">Demo in all views</button></div>`;
    $('#eOpen').onclick = () => openVideo(active); $('#eDemo').onclick = () => loadDemo(active); $('#eDemoAll').onclick = loadDemoAll; return; }
  if (!st.vt || resized) fitVT(st);
  const { s, ox, oy } = st.vt, T = p => [ox + p[0] * s, oy + p[1] * s];
  ctx.imageSmoothingEnabled = s < 2.5;
  if (st.drawn >= 0) ctx.drawImage(st.off, ox, oy, st.w * s, st.h * s);
  // calibration
  if (st.calib.p.length) { const a = st.calib.p.map(T); ctx.strokeStyle = '#ffd23f'; ctx.fillStyle = '#ffd23f'; ctx.lineWidth = 1.5 * dpr;
    for (const p of a) { ctx.beginPath(); ctx.moveTo(p[0] - 7 * dpr, p[1]); ctx.lineTo(p[0] + 7 * dpr, p[1]); ctx.moveTo(p[0], p[1] - 7 * dpr); ctx.lineTo(p[0], p[1] + 7 * dpr); ctx.stroke(); }
    if (a.length === 2) { ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.beginPath(); ctx.moveTo(...a[0]); ctx.lineTo(...a[1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = `${11 * dpr}px Segoe UI, system-ui`; ctx.textAlign = 'center'; ctx.fillText(`${st.calib.cm} cm`, (a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2 - 7 * dpr); } }
  // trail of the selected trajectory
  const sel = st.tr[st.sel];
  if (sel) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = dpr; ctx.beginPath(); let pen = false;
    for (let f = Math.max(0, st.frame - 20); f <= Math.min(st.nFrames - 1, st.frame + 20); f++) { if (!Number.isFinite(sel.x[f])) { pen = false; continue; } const p = T([sel.x[f], sel.y[f]]); pen ? ctx.lineTo(...p) : ctx.moveTo(...p); pen = true; } ctx.stroke(); }
  drawSkeleton(ctx, st, st.frame, T, dpr, true);
  // HUD
  ctx.font = `600 ${11 * dpr}px Segoe UI, system-ui`; ctx.textAlign = 'left';
  const hud = `${VIEWS[active].label.toUpperCase()}   ·   FRAME ${st.frame}   ·   ${(st.frame / st.capFps).toFixed(3)} s`;
  const tw = ctx.measureText(hud).width; ctx.fillStyle = 'rgba(3,21,47,.82)'; ctx.fillRect(8 * dpr, 8 * dpr, tw + 16 * dpr, 22 * dpr);
  ctx.fillStyle = '#d9dde1'; ctx.fillText(hud, 16 * dpr, 23 * dpr);
  const ev = eventsAt(st, st.frame);
  if (ev.length) { ctx.font = `700 ${11 * dpr}px Segoe UI, system-ui`; const t = ev.map(e => e.label.toUpperCase()).join('  ·  '), w2 = ctx.measureText(t).width;
    ctx.fillStyle = ev[0].col; ctx.fillRect(vp.width - w2 - 24 * dpr, 8 * dpr, w2 + 16 * dpr, 22 * dpr); ctx.fillStyle = '#0d0e0f'; ctx.fillText(t, vp.width - w2 - 16 * dpr, 23 * dpr); }
  if (mode === 'calib') { ctx.font = `600 ${11 * dpr}px Segoe UI, system-ui`; const t = st.calib.p.length === 1 ? 'CALIBRATE · click the second belt point' : 'CALIBRATE · click the first belt point';
    const w3 = ctx.measureText(t).width; ctx.fillStyle = '#ffd23f'; ctx.fillRect(8 * dpr, 34 * dpr, w3 + 16 * dpr, 22 * dpr); ctx.fillStyle = '#111'; ctx.fillText(t, 16 * dpr, 49 * dpr); }
  // scale bar
  if (calibOK(st)) { const { cmpx } = upDir(st), opts = [1, 2, 5, 10, 20, 50, 100]; let cm = opts.find(c => c / cmpx * s >= 70 * dpr) || 100; const L = cm / cmpx * s, x = 14 * dpr, y = vp.height - 16 * dpr;
    ctx.strokeStyle = '#d9dde1'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(x, y - 5 * dpr); ctx.lineTo(x, y); ctx.lineTo(x + L, y); ctx.lineTo(x + L, y - 5 * dpr); ctx.stroke();
    ctx.fillStyle = '#d9dde1'; ctx.font = `${10.5 * dpr}px Segoe UI, system-ui`; ctx.fillText(`${cm} cm`, x + L + 6 * dpr, y); }
  $('#zoomLbl').textContent = Math.round(s / Math.min(vp.width / st.w, vp.height / st.h) * 100) + '%';
}
function drawSkeleton(ctx, st, f, T, dpr, labels) {
  const pos = id => { const t = st.tr[id]; return t && Number.isFinite(t.x[f]) ? T([t.x[f], t.y[f]]) : null; };
  ctx.lineWidth = 1.6 * dpr; ctx.strokeStyle = 'rgba(80,190,255,.9)';
  for (const [a, b] of SEGS[st.type]) { const p = pos(a), q = pos(b); if (p && q) { ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke(); } }
  ctx.font = `${10 * dpr}px Segoe UI, system-ui`; ctx.textAlign = 'left';
  for (const m of MARKERS[st.type]) { const p = pos(m.id); if (!p) continue; const isSel = labels && m.id === st.sel;
    ctx.strokeStyle = m.c; ctx.lineWidth = (isSel ? 2.4 : 1.6) * dpr; ctx.beginPath(); ctx.arc(p[0], p[1], (isSel ? 8 : 5.5) * dpr, 0, 7); ctx.stroke();
    if (labels) { ctx.fillStyle = 'rgba(3,21,47,.78)'; const t = SHORT[m.id], w = ctx.measureText(t).width; ctx.fillRect(p[0] + 9 * dpr, p[1] - 7 * dpr, w + 6 * dpr, 13 * dpr); ctx.fillStyle = isSel ? '#fff' : m.c; ctx.fillText(t, p[0] + 12 * dpr, p[1] + 3 * dpr); } }
}
function eventsAt(st, f) {
  const out = []; if (st.type === 'side') { if (st.ev.IC.includes(f)) out.push({ label: 'Initial contact', col: '#86c440' }); if (st.ev.TO.includes(f)) out.push({ label: 'Toe-off', col: '#ff2d8f' }); }
  else { if (st.ev.L.includes(f)) out.push({ label: 'Left contact', col: '#86c440' }); if (st.ev.R.includes(f)) out.push({ label: 'Right contact', col: '#ff2d8f' }); }
  return out;
}
let drag = null;
vp.addEventListener('wheel', e => { const st = cur(); if (!st.src) return; e.preventDefault(); if (!st.vt) fitVT(st);
  const r = vp.getBoundingClientRect(), mx = (e.clientX - r.left) * devicePixelRatio, my = (e.clientY - r.top) * devicePixelRatio, k = Math.exp(-e.deltaY * 0.0015);
  const fit = Math.min(vp.width / st.w, vp.height / st.h) * 0.97, s2 = clamp(st.vt.s * k, fit, fit * 16), kk = s2 / st.vt.s;
  st.vt = { s: s2, ox: mx - (mx - st.vt.ox) * kk, oy: my - (my - st.vt.oy) * kk }; drawVP(); }, { passive: false });
vp.addEventListener('contextmenu', e => e.preventDefault());
vp.addEventListener('pointerdown', e => { const st = cur(); if (!st.src) return; vp.focus(); drag = { x: e.clientX, y: e.clientY, vt: { ...st.vt }, moved: false, btn: e.button }; vp.setPointerCapture(e.pointerId); });
vp.addEventListener('pointermove', e => {
  const st = cur(); if (!st.src) return; const r = vp.getBoundingClientRect(), x = ((e.clientX - r.left) * devicePixelRatio - st.vt.ox) / st.vt.s, y = ((e.clientY - r.top) * devicePixelRatio - st.vt.oy) / st.vt.s;
  let w = ''; if (calibOK(st)) { const p = toWorld(st)(x, y); w = `   ${fmt(p[0] * 100, 1)}, ${fmt(p[1] * 100, 1)} cm`; } $('#sbCursor').textContent = `${Math.round(x)}, ${Math.round(y)} px${w}`;
  if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 4) drag.moved = true;
  if (drag.moved) { st.vt = { ...drag.vt, ox: drag.vt.ox + dx * devicePixelRatio, oy: drag.vt.oy + dy * devicePixelRatio }; vp.style.cursor = 'grabbing'; drawVP(); } });
vp.addEventListener('pointerup', e => { vp.style.cursor = ''; if (drag && !drag.moved && drag.btn === 0) vpClick(e); drag = null; });
function vpClick(e) {
  const st = cur(); if (st.tracking) return; const r = vp.getBoundingClientRect(), dpr = devicePixelRatio;
  const cx = (e.clientX - r.left) * dpr, cy = (e.clientY - r.top) * dpr, x = (cx - st.vt.ox) / st.vt.s, y = (cy - st.vt.oy) / st.vt.s;
  if (mode === 'calib') {
    st.calib.p = st.calib.p.length >= 2 ? [] : st.calib.p; st.calib.p.push([x, y]);
    if (st.calib.p.length === 2) { if (st.calib.p[1][0] < st.calib.p[0][0]) st.calib.p.reverse(); setMode('place'); dataChanged(active); ui.status(`${VIEWS[active].label}: calibrated over ${st.calib.cm} cm. Save it as a station in Properties to reuse it.`, 'ok'); }
    ui.refresh(); return;
  }
  // click near another marker selects it; otherwise place the selected trajectory
  let hit = null, best = 10 * dpr;
  for (const m of MARKERS[st.type]) { const t = st.tr[m.id]; if (!Number.isFinite(t.x[st.frame])) continue; const d = Math.hypot(st.vt.ox + t.x[st.frame] * st.vt.s - cx, st.vt.oy + t.y[st.frame] * st.vt.s - cy); if (d < best) { best = d; hit = m.id; } }
  if (hit && hit !== st.sel) { st.sel = hit; ui.refresh(); return; }
  const t = st.tr[st.sel]; t.x[st.frame] = x; t.y[st.frame] = y; dataChanged(active);
  const list = MARKERS[st.type], i0 = list.findIndex(m => m.id === st.sel);
  for (let j = 1; j < list.length; j++) { const m = list[(i0 + j) % list.length]; if (!Number.isFinite(st.tr[m.id].x[st.frame])) { st.sel = m.id; break; } }
  ui.refresh();
}
function setMode(m) { mode = m; document.querySelectorAll('#modeSeg .tool').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); if (m === 'calib') cur().calib.p = []; drawVP(); }

/* ---------- timeline ---------- */
const tl = $('#tl'); let tlLayout = null, tlDrag = null;
function trackRuns(t, n) { const out = []; let i = 0; while (i < n) { if (!Number.isFinite(t.x[i])) { i++; continue; } const s = i; while (i < n && Number.isFinite(t.x[i])) i++; out.push([s, i - 1]); } return out; }
function drawTL() {
  sizeCanvas(tl); const ctx = tl.getContext('2d'), dpr = devicePixelRatio, W = tl.width, H = tl.height, st = cur();
  ctx.fillStyle = '#0a1b36'; ctx.fillRect(0, 0, W, H);
  const lx = 104 * dpr, rx = W - 10 * dpr, mk = MARKERS[st.type], laneH = 12 * dpr, yR = 0, hR = 20 * dpr, yE = hR, hE = 20 * dpr, yC = yE + hE + 4 * dpr, yT = yC + mk.length * laneH + 6 * dpr, hT = H - yT - 4 * dpr;
  tlLayout = { lx, rx, yR, hR, yE, hE, yC, laneH, yT, hT };
  ctx.fillStyle = '#0f2546'; ctx.fillRect(0, 0, lx - 4 * dpr, H);
  ctx.font = `${10 * dpr}px Segoe UI, system-ui`; ctx.fillStyle = '#93a7c1'; ctx.textAlign = 'left';
  ctx.fillText('Frames', 8 * dpr, yR + 14 * dpr); ctx.fillText('Events', 8 * dpr, yE + 14 * dpr); ctx.fillText(st.type === 'side' ? 'Foot height' : 'Heel height', 8 * dpr, yT + 12 * dpr);
  mk.forEach((m, i) => { ctx.fillStyle = m.id === st.sel ? '#fff' : '#8f979f'; ctx.fillText(SHORT[m.id], 8 * dpr, yC + i * laneH + 10 * dpr); });
  if (!st.src) return;
  const n = st.nFrames, X = f => lx + (f / Math.max(1, n - 1)) * (rx - lx);
  // ruler
  ctx.fillStyle = '#0f2546'; ctx.fillRect(lx, yR, rx - lx, hR);
  const stepF = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find(sf => (rx - lx) / (n / sf) > 60 * dpr) || 5000;
  ctx.strokeStyle = '#4a5057'; ctx.fillStyle = '#8f979f'; ctx.lineWidth = dpr;
  for (let f = 0; f < n; f += stepF) { const x = X(f); ctx.beginPath(); ctx.moveTo(x, yR + hR - 6 * dpr); ctx.lineTo(x, yR + hR); ctx.stroke(); ctx.fillText(String(f), x + 3 * dpr, yR + 12 * dpr); }
  // range shading
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(lx, 0, X(st.range[0]) - lx, H); ctx.fillRect(X(st.range[1]), 0, rx - X(st.range[1]), H);
  ctx.fillStyle = '#26aee4'; for (const f of st.range) { const x = X(f); ctx.fillRect(x - 1 * dpr, 0, 2 * dpr, H); ctx.beginPath(); ctx.moveTo(x - 5 * dpr, 0); ctx.lineTo(x + 5 * dpr, 0); ctx.lineTo(x, 7 * dpr); ctx.fill(); }
  // events
  const evCols = st.type === 'side' ? { IC: '#86c440', TO: '#ff2d8f' } : { L: '#86c440', R: '#ff2d8f' };
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.moveTo(lx, yE + hE); ctx.lineTo(rx, yE + hE); ctx.stroke();
  for (const k in st.ev) for (const f of st.ev[k]) { const x = X(f), y = yE + (k === 'IC' || k === 'L' ? 3 : 10) * dpr, isSel = st.selEv && st.selEv.k === k && st.selEv.f === f;
    ctx.fillStyle = evCols[k]; ctx.beginPath(); ctx.moveTo(x - 4.5 * dpr, y); ctx.lineTo(x + 4.5 * dpr, y); ctx.lineTo(x, y + 7 * dpr); ctx.fill();
    if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr; ctx.stroke(); }
    ctx.fillStyle = evCols[k] + '33'; ctx.fillRect(x - 0.5 * dpr, yC, dpr, yT + hT - yC); }
  // coverage
  mk.forEach((m, i) => { const y = yC + i * laneH + 1.5 * dpr; ctx.fillStyle = m.id === st.sel ? 'rgba(38,174,228,.16)' : 'rgba(255,255,255,.03)'; ctx.fillRect(lx, y - 1.5 * dpr, rx - lx, laneH);
    ctx.fillStyle = m.c; for (const [a, b] of trackRuns(st.tr[m.id], n)) ctx.fillRect(X(a), y, Math.max(dpr, X(b) - X(a) + dpr), laneH - 3 * dpr); });
  // trace
  if (calibOK(st)) {
    if (!st._trace || st._trace.ver !== st.ver) { const ids = st.type === 'side' ? ['heel', 'toe'] : ['lHeel', 'rHeel']; st._trace = { ver: st.ver, s: ids.map(id => series(st, id, false).Y) }; }
    let lo = Infinity, hi = -Infinity; for (const y of st._trace.s) for (let i = 0; i < n; i++) if (Number.isFinite(y[i])) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
    const cols = st.type === 'side' ? ['#f2994a', '#eb5757'] : ['#86c440', '#ff2d8f'], Y = v => yT + hT - (v - lo) / Math.max(1e-6, hi - lo) * (hT - 4 * dpr) - 2 * dpr;
    st._trace.s.forEach((y, j) => { ctx.strokeStyle = cols[j]; ctx.lineWidth = 1.2 * dpr; ctx.beginPath(); let pen = false; for (let i = 0; i < n; i++) { if (!Number.isFinite(y[i])) { pen = false; continue; } pen ? ctx.lineTo(X(i), Y(y[i])) : ctx.moveTo(X(i), Y(y[i])); pen = true; } ctx.stroke(); });
  }
  // playhead
  const px = X(st.frame); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  ctx.fillStyle = '#fff'; const lab = String(st.frame), lw = ctx.measureText(lab).width + 8 * dpr; ctx.fillRect(px - lw / 2, yR + 2 * dpr, lw, 15 * dpr); ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.fillText(lab, px, yR + 13 * dpr);
}
function tlFrame(e) { const st = cur(), r = tl.getBoundingClientRect(), x = (e.clientX - r.left) * devicePixelRatio, L = tlLayout; return { f: Math.round(clamp((x - L.lx) / (L.rx - L.lx), 0, 1) * (st.nFrames - 1)), x, y: (e.clientY - r.top) * devicePixelRatio }; }
tl.addEventListener('pointerdown', e => {
  const st = cur(); if (!st.src || st.tracking) return; const { f, x, y } = tlFrame(e), L = tlLayout, dpr = devicePixelRatio, X = g => L.lx + g / Math.max(1, st.nFrames - 1) * (L.rx - L.lx);
  tl.setPointerCapture(e.pointerId);
  if (x < L.lx) { const i = Math.floor((y - L.yC) / L.laneH), mk = MARKERS[st.type]; if (i >= 0 && i < mk.length) { st.sel = mk[i].id; ui.refresh(); } return; }
  for (const k of [0, 1]) if (Math.abs(x - X(st.range[k])) < 6 * dpr && y < L.yE) { tlDrag = { range: k }; return; }
  if (y >= L.yE && y < L.yE + L.hE) { let best = null, bd = 6 * dpr; for (const k in st.ev) for (const g of st.ev[k]) { const d = Math.abs(X(g) - x); if (d < bd) { bd = d; best = { k, f: g }; } }
    if (best) { st.selEv = best; pane = 'events'; gotoA(best.f); renderPanes(); drawTL(); return; } }
  tlDrag = { scrub: true }; gotoA(f);
});
tl.addEventListener('pointermove', e => { if (!tlDrag) return; const st = cur(), { f } = tlFrame(e);
  if (tlDrag.scrub) gotoA(f); else { const k = tlDrag.range; st.range[k] = k === 0 ? Math.min(f, st.range[1] - 1) : Math.max(f, st.range[0] + 1); dataChanged(active); drawTL(); updateTransport(); } });
tl.addEventListener('pointerup', () => { if (tlDrag && tlDrag.range !== undefined) ui.refresh(); tlDrag = null; });

/* ---------- transport and bars ---------- */
function updateTransport() {
  const st = cur(); $('#frameIn').value = st.frame; $('#frameIn').max = Math.max(0, st.nFrames - 1); $('#frameOf').textContent = `/ ${Math.max(0, st.nFrames - 1)}`;
  $('#timeLbl').textContent = `${(st.frame / st.capFps).toFixed(3)} s`;
  $('#lgA').textContent = st.type === 'side' ? 'Contact' : 'Left contact'; $('#lgB').textContent = st.type === 'side' ? 'Toe-off' : 'Right contact';
}
function updateStatusBar() {
  const st = cur(); $('#sbView').textContent = VIEWS[active].label;
  $('#sbScale').textContent = calibOK(st) ? `${(upDir(st).cmpx * 10).toFixed(2)} mm/px` : 'not calibrated';
  $('#sbFps').textContent = st.src ? `${st.capFps} fps` : '';
}
function updateToolbar() {
  const st = cur(), has = !!st.src, trk = st.tracking;
  $('#tLabel').disabled = !has || trk; $('#tTrack').disabled = !has || trk; $('#tStop').disabled = !trk; $('#tEvents').disabled = !has || trk || !calibOK(st); $('#tCalc').disabled = !has || trk;
  $('#tAuto').disabled = trk || !VKEYS.some(v => S.views[v].src);
  const nm = $('#cName').value.trim(); $('#sessTitle').innerHTML = nm ? `<b>${esc(nm)}</b> · ${esc($('#cDate').value)}` : 'Untitled session';
}
async function togglePlay() {
  if (playing) { playing = false; return; } playing = true; const st = cur();
  $('#bPlay').innerHTML = '<svg viewBox="0 0 16 16"><path d="M5 3v10 M11 3v10"/></svg>';
  while (playing && st.frame < st.range[1]) { await goto(active, st.frame + 1); await sleep(Math.max(0, 1000 / 60)); }
  playing = false; $('#bPlay').innerHTML = '<svg viewBox="0 0 16 16"><path d="M5 3l8 5-8 5z"/></svg>';
}

/* ---------- project tree ---------- */
const IC_CAM = '<svg class="ico" viewBox="0 0 16 16"><rect x="1.5" y="4" width="9.5" height="8" rx="1"/><path d="M11 7l3.5-2v6L11 9"/></svg>';
function renderTree() {
  const pips = st => { const cov = st.src ? Math.min(...MARKERS[st.type].map(m => { const t = st.tr[m.id]; let k = 0; for (let i = st.range[0]; i <= st.range[1]; i++) if (Number.isFinite(t.x[i])) k++; return k / (st.range[1] - st.range[0] + 1); })) : 0;
    const nev = st.type === 'side' ? st.ev.IC.length : st.ev.L.length + st.ev.R.length;
    return `<div class="pips"><span class="pip ${st.src ? (st.src.kind === 'none' ? 'part' : 'ok') : ''}">VID</span><span class="pip ${calibOK(st) ? 'ok' : ''}">CAL</span><span class="pip ${cov > 0.97 ? 'ok' : cov > 0 ? 'part' : ''}">TRK</span><span class="pip ${nev ? 'ok' : ''}">EVT</span><span class="pip ${st.res ? 'ok' : ''}">CALC</span></div>`; };
  const nm = $('#cName').value.trim(), sp = num('#speed'), u = $('#speedUnit').selectedOptions[0].text;
  const mdc = lsGet(MDCKEY), nMdc = Object.values(mdc).filter(x => x > 0).length;
  let h = `<div class="tg">Session</div><div class="ti" id="trSession"><svg class="ico" viewBox="0 0 16 16"><circle cx="8" cy="5" r="2.8"/><path d="M2.5 14.5c.6-3 2.9-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/></svg><div><div class="nm">${esc(nm) || 'Client not entered'}</div><div class="sub">${esc($('#cDate').value)}${sp ? ` · ${sp} ${u}` : ''}</div></div></div>`;
  h += `<div class="tg">Camera views</div>`;
  for (const v of VKEYS) { const st = S.views[v];
    h += `<div class="ti ${v === active ? 'on' : ''}" data-v="${v}">${IC_CAM}<div style="min-width:0"><div class="nm">${VIEWS[v].label}</div><div class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${st.src ? esc(st.name) : 'No video'}</div>${pips(st)}</div></div>`; }
  h += `<div class="tg">Comparison</div><div class="ti" style="cursor:default"><svg class="ico" viewBox="0 0 16 16"><path d="M2 12.5l3.5-4 3 2.5 5.5-7"/></svg><div><div class="nm">Previous session</div><div class="sub">${S.prev ? `${esc(S.prev.date)} · ${esc(S.prev.client)}` : 'None loaded'}</div><div style="margin-top:3px"><button class="tlink" id="trPrev">${S.prev ? 'Replace…' : 'Load…'}</button>${S.prev ? ` · <button class="tlink" id="trPrevX">Clear</button>` : ''}</div></div></div>`;
  h += `<div class="tg">Measurement error</div><div class="ti" id="trMdc"><svg class="ico" viewBox="0 0 16 16"><path d="M8 2v12 M4 5.5h8 M4 10.5h8"/></svg><div><div class="nm">MDC and reliability</div><div class="sub">${nMdc ? `${nMdc} measures set${lsGet('marjonGait.mdcSource.v1').runners ? ` · study n=${lsGet('marjonGait.mdcSource.v1').runners}` : ''}` : 'Not set yet'}</div></div></div>`;
  $('#tree').innerHTML = h;
  $('#tree').querySelectorAll('[data-v]').forEach(el => el.onclick = () => setActive(el.dataset.v));
  $('#trSession').onclick = () => $('#dlgSession').showModal();
  $('#trMdc').onclick = openMDC;
  $('#trPrev').onclick = () => { $('#fPrev').value = ''; $('#fPrev').click(); };
  if ($('#trPrevX')) $('#trPrevX').onclick = () => { S.prev = null; ui.refresh(); };
}

/* ---------- right panes ---------- */
function renderPanes(light) {
  document.querySelectorAll('#ptabs button').forEach(b => b.classList.toggle('on', b.dataset.pane === pane));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + pane));
  renderTraj(); renderEvents();
  if (!light) { renderData(); if (!$('#pane-props').contains(document.activeElement)) renderProps(); }
}
function renderTraj() {
  const st = cur(), el = $('#pane-traj'), [a, b] = st.range, has = !!st.src;
  let rows = '';
  for (const m of MARKERS[st.type]) { const t = st.tr[m.id]; let k = 0, gaps = 0, inGap = false;
    if (t) for (let i = a; i <= b; i++) { const ok = Number.isFinite(t.x[i]); if (ok) { k++; inGap = false; } else if (!inGap && k) { gaps++; inGap = true; } }
    const pc = has ? Math.round(100 * k / (b - a + 1)) : 0, here = t && Number.isFinite(t.x[st.frame]);
    rows += `<tr class="click ${m.id === st.sel ? 'sel' : ''}" data-m="${m.id}"><td><span class="sw" style="background:${m.c}"></span>${m.label}</td><td class="n"><span class="fill"><i style="width:${pc}%"></i></span>${pc}%</td><td class="n">${has ? gaps : ''}</td><td class="n">${here ? '●' : ''}</td></tr>`; }
  el.innerHTML = `<div class="pbar"><button class="pb" id="pLabel" ${has ? '' : 'disabled'}>Auto-label frame</button><button class="pb acc" id="pTrack" ${has ? '' : 'disabled'}>Track forward</button><button class="pb" id="pClear" ${has ? '' : 'disabled'}>Clear from playhead</button></div>
    <table class="grid"><tr><th>Trajectory</th><th class="n">Fill</th><th class="n">Gaps</th><th class="n" title="Present on this frame">Here</th></tr>${rows}</table>
    <div class="pnote">Fill and gaps are within the analysis range (frames ${a}–${b}). In Place mode a click on the image moves the selected trajectory to that point on this frame. Gaps up to ${SET.fill} frames are filled when calculating.</div>`;
  el.querySelectorAll('tr[data-m]').forEach(r => r.onclick = () => { st.sel = r.dataset.m; ui.refresh(); });
  if (has) { $('#pLabel').onclick = () => autoLabel(active); $('#pTrack').onclick = () => trackForward(active);
    $('#pClear').onclick = () => { const t = st.tr[st.sel]; for (let i = st.frame; i < st.nFrames; i++) { t.x[i] = NaN; t.y[i] = NaN; } dataChanged(active); ui.refresh(); }; }
}
function renderEvents() {
  const st = cur(), el = $('#pane-events'), side = st.type === 'side', fps = st.capFps;
  const cell = (k, f) => f === undefined ? '<td class="n dim">–</td>' : `<td class="n cell ${st.selEv && st.selEv.k === k && st.selEv.f === f ? 'sel' : ''}" data-k="${k}" data-f="${f}">${f}</td>`;
  let body = '';
  if (side) { const IC = st.ev.IC, TO = st.ev.TO;
    body = `<tr><th>#</th><th class="n">Contact</th><th class="n">Toe-off</th><th class="n">Contact ms</th><th class="n">Stride ms</th></tr>`;
    IC.forEach((f, i) => { const nx = IC[i + 1], to = TO.find(t => t > f && (nx === undefined || t < nx));
      body += `<tr><td>${i + 1}</td>${cell('IC', f)}${cell('TO', to)}<td class="n">${to !== undefined ? fmt((to - f) / fps * 1000, 0) : '–'}</td><td class="n">${nx !== undefined ? fmt((nx - f) / fps * 1000, 0) : '–'}</td></tr>`; }); }
  else { const n = Math.max(st.ev.L.length, st.ev.R.length); body = `<tr><th>#</th><th class="n">Left contact</th><th class="n">Right contact</th></tr>`;
    for (let i = 0; i < n; i++) body += `<tr><td>${i + 1}</td>${cell('L', st.ev.L[i])}${cell('R', st.ev.R[i])}</tr>`; }
  const has = !!st.src && calibOK(st);
  el.innerHTML = `<div class="pbar"><button class="pb acc" id="eDetect" ${has ? '' : 'disabled'}>Detect</button>
    <button class="pb" id="eAddA" ${has ? '' : 'disabled'}>+ ${side ? 'Contact' : 'Left'}</button><button class="pb" id="eAddB" ${has ? '' : 'disabled'}>+ ${side ? 'Toe-off' : 'Right'}</button>
    <button class="pb" id="eDel" ${st.selEv ? '' : 'disabled'}>Delete</button><button class="pb" id="eM" ${st.selEv ? '' : 'disabled'} title="Nudge earlier ([)">−1</button><button class="pb" id="eP" ${st.selEv ? '' : 'disabled'} title="Nudge later (])">+1</button></div>
    <table class="grid">${body}</table>
    <div class="pnote">Events are suggestions. Click a frame number, step through with ← →, then nudge with [ and ]. ${side ? 'Each stride needs one toe-off.' : 'Rear stance windows use the side-view contact times.'}</div>
    ${st.truth && side && st.ev.IC.length ? `<div class="vbox"><b>Demo check: event timing</b>${eventTruth(st)}</div>` : ''}`;
  el.querySelectorAll('td.cell').forEach(c => c.onclick = () => { st.selEv = { k: c.dataset.k, f: Number(c.dataset.f) }; gotoA(st.selEv.f); renderEvents(); drawTL(); });
  if (!has) return;
  $('#eDetect').onclick = () => detectEvents(active);
  const add = k => { const a = st.ev[k]; if (!a.includes(st.frame)) { a.push(st.frame); a.sort((x, y) => x - y); } st.selEv = { k, f: st.frame }; dataChanged(active); ui.refresh(); };
  $('#eAddA').onclick = () => add(side ? 'IC' : 'L'); $('#eAddB').onclick = () => add(side ? 'TO' : 'R');
  $('#eDel').onclick = deleteEvent; $('#eM').onclick = () => nudge(-1); $('#eP').onclick = () => nudge(1);
}
function eventTruth(st) {
  const p = st.truth.p, fps = st.capFps, e = { IC: [], TO: [] };
  for (const [k, off] of [['IC', 0], ['TO', p.tc]]) for (const f of st.ev[k]) { const t = f / fps, n = Math.round((t - p.t0 - off) / p.T); e[k].push((t - (p.t0 + off + n * p.T)) * 1000); }
  return `Contact: mean ${fmt(mean(e.IC), 1)} ms (${fmt(Math.min(...e.IC), 0)} to ${fmt(Math.max(...e.IC), 0)})<br>Toe-off: mean ${fmt(mean(e.TO), 1)} ms (${fmt(Math.min(...e.TO), 0)} to ${fmt(Math.max(...e.TO), 0)})<br><span class="dim">1 frame = ${(1000 / fps).toFixed(1)} ms</span>`;
}
function deleteEvent() { const st = cur(); if (!st.selEv) return; const a = st.ev[st.selEv.k], i = a.indexOf(st.selEv.f); if (i >= 0) a.splice(i, 1); st.selEv = null; dataChanged(active); ui.refresh(); }
function nudge(d) { const st = cur(); if (!st.selEv) return; const a = st.ev[st.selEv.k], i = a.indexOf(st.selEv.f); if (i < 0) return; a[i] = clamp(a[i] + d, 0, st.nFrames - 1); st.selEv.f = a[i]; a.sort((x, y) => x - y); dataChanged(active); gotoA(st.selEv.f); renderEvents(); drawTL(); }
const pmv = (s, d) => s && Number.isFinite(s.mean) ? fmt(s.mean, d) : '–';
function renderData() {
  const st = cur(), el = $('#pane-data'), r = st.res, side = st.type === 'side';
  let h = `<div class="pbar"><button class="pb acc" id="dCalc" ${st.src ? '' : 'disabled'}>Calculate</button><button class="pb" id="dAll">Calculate all views</button></div>`;
  if (!r) { el.innerHTML = h + `<div class="pnote">No results yet for this view.</div>`; bindData(); return; }
  if (side) {
    h += `<div class="pnote">${r.n} strides${r.excluded ? ` · ${r.excluded} with tracking gaps (angles excluded)` : ''} · running ${r.dir > 0 ? 'left to right' : 'right to left'} on screen${r.orderWarn.length ? `<br><span style="color:var(--warn)">Check strides from frame ${r.orderWarn.join(', ')}: each needs one toe-off.</span>` : ''}</div>`;
    h += `<table class="grid"><tr><th>Measure</th><th class="n">Mean</th><th class="n">SD</th>${st.truth ? '<th class="n">True</th><th class="n">Err</th>' : ''}</tr>`;
    for (const m of METRICS_SIDE) { const s = r.sum[m.id], t = st.truth ? st.truth[m.id] : null, err = s.mean - t;
      h += `<tr><td>${m.label} <span class="dim">${m.unit}</span></td><td class="n">${pmv(s, m.d)}</td><td class="n">${fmt(s.sd, m.d)}</td>${st.truth ? `<td class="n">${fmt(t, m.d)}</td><td class="n ${Math.abs(err) <= tolOf(m) ? 'pass' : 'fail'}">${fmt(err, m.d + 1)}</td>` : ''}</tr>`; }
    h += `</table><div class="pnote">Foot strike: ${r.strike ? `<b>${r.strike}</b>` : 'not classified (no standing reference)'}</div>`;
  } else {
    if (r.warn.length) h += `<div class="pnote warn">${r.warn.join(' ')}</div>`;
    h += `<table class="grid"><tr><th>Measure</th><th class="n">Left</th><th class="n">Right</th></tr>`;
    for (const m of METRICS_REAR) h += `<tr><td>${m.label.replace(' (peak in stance)', '')} <span class="dim">${m.unit}</span></td><td class="n">${pmv(r.sum.L[m.id], m.d)}</td><td class="n">${pmv(r.sum.R[m.id], m.d)}</td></tr>`;
    h += `<tr><td>Step width <span class="dim">cm</span></td><td class="n" colspan="2">${pmv(r.sum.stepWidth, 1)}</td></tr></table>`;
    if (st.truth) { const t = st.truth, c = [['Pelvic drop L', r.sum.L.pelvicDrop.mean, t.L.pelvicDrop, 1], ['Pelvic drop R', r.sum.R.pelvicDrop.mean, t.R.pelvicDrop, 1], ['Hip adduction L', r.sum.L.hipAdd.mean, t.L.hipAdd, 1], ['Hip adduction R', r.sum.R.hipAdd.mean, t.R.hipAdd, 1], ['Step width', r.sum.stepWidth.mean, t.stepWidth, 0.5]];
      h += `<div class="vbox"><b>Demo check against true values</b><table class="grid">${c.map(([n, a, b, tol]) => `<tr><td>${n}</td><td class="n">${fmt(a, 2)}</td><td class="n">${fmt(b, 2)}</td><td class="n ${Math.abs(a - b) <= tol ? 'pass' : 'fail'}">${fmt(a - b, 2)}</td></tr>`).join('')}</table></div>`; }
  }
  el.innerHTML = h; bindData();
}
function bindData() { if ($('#dCalc')) $('#dCalc').onclick = () => calcView(active); $('#dAll').onclick = () => { for (const v of ['left', 'right', 'rear']) calcView(v, true); pane = 'data'; ui.refresh(); ui.status('All views with events calculated.', 'ok'); }; }
function renderProps() {
  const st = cur(), el = $('#pane-props'), side = st.type === 'side', stn = lsGet(STKEY)[active];
  const row = (k, v) => `<div class="prow"><span class="k">${k}</span>${v}</div>`;
  let h = `<div class="psec"><h4>Video</h4>${row('Source', `<span class="v" title="${esc(st.name)}">${st.src ? esc(st.name) : '–'}</span>`)}${row('Resolution', `<span class="v">${st.src ? `${st.w} × ${st.h}` : '–'}</span>`)}${row('Frames', `<span class="v">${st.src ? st.nFrames : '–'}</span>`)}
    ${row('Capture rate (fps)', `<input type="number" id="prCap" value="${st.capFps}" min="20" max="2000">`)}${row('Stored rate (fps)', st.src && st.src.avi ? `<span class="v">${+st.fileFps.toFixed(3)} (from file)</span>` : `<input type="number" id="prFile" value="${st.fileFps}" min="1" max="2000">`)}
    <div class="pnote">${st.src && st.src.avi ? `${st.src.codec} AVI, read frame by frame. Stored rate comes from the file header; set the capture rate if the camera recorded faster than it stores.` : 'Slow-motion clips are often stored at a lower rate than they were captured at. Times use the capture rate.'}</div>
    <div class="pbar" style="border:0;padding-top:0"><button class="pb" id="prOpen">${st.src && st.src.kind === 'none' ? 'Link original video…' : 'Open video…'}</button><button class="pb" id="prDemo">Load demo runner</button></div></div>`;
  h += `<div class="psec"><h4>Calibration</h4>${row('Status', `<span class="v">${calibOK(st) ? `${(upDir(st).cmpx * 10).toFixed(2)} mm/px` : 'Not set'}</span>`)}${row('Belt distance (cm)', `<input type="number" id="prCm" value="${st.calib.cm}" min="1">`)}
    <div class="pbar" style="border:0;padding-top:0"><button class="pb" id="prCal">Set on image (C)</button><button class="pb" id="prStSave" ${calibOK(st) ? '' : 'disabled'}>Save as station</button><button class="pb" id="prStApply" ${stn && st.src ? '' : 'disabled'}>Apply station</button></div>
    <div class="pnote">${stn ? `Station saved ${new Date(stn.saved).toLocaleDateString('en-GB')} for ${stn.w}×${stn.h} video. <button class="tlink" id="prStForget">Forget</button>` : 'No station saved for this camera. Once saved, new videos of the same size are calibrated automatically.'}</div></div>`;
  h += `<div class="psec"><h4>Analysis range</h4>${row('Start frame', `<input type="number" id="prR0" value="${st.range[0]}" min="0">`)}${row('End frame', `<input type="number" id="prR1" value="${st.range[1]}" min="0">`)}
    <div class="pbar" style="border:0;padding-top:0"><button class="pb" id="prR0h">Start = playhead</button><button class="pb" id="prR1h">End = playhead</button></div><div class="pnote">Or drag the blue handles on the timeline. Aim for at least 11 contacts per side.</div></div>`;
  if (side) h += `<div class="psec"><h4>Standing reference</h4>${row('Foot angle', `<span class="v">${st.standing ? `${fmt(st.standing.foot, 1)}°${st.standing.note === 'demo' ? ' (demo)' : ` · frame ${st.standing.frame}`}` : 'Not set'}</span>`)}
    <div class="pbar" style="border:0;padding-top:0"><button class="pb" id="prStand" ${st.src ? '' : 'disabled'}>Set from this frame</button>${st.standing ? '<button class="pb" id="prStandX">Clear</button>' : ''}</div>
    <div class="pnote">Load a short standing clip from the same camera, place heel and forefoot, set the reference, then load the running clip. Needed for foot-strike classification.</div></div>`;
  h += `<div class="psec"><h4>Processing · all views</h4>${row('Angle filter (Hz)', `<input type="number" id="prCut" value="${SET.cutoff}" min="4" max="40">`)}${row('Contact threshold (cm)', `<input type="number" id="prTol" value="${SET.tol}" step="0.1" min="0.1" max="3">`)}${row('Fill gaps up to (frames)', `<input type="number" id="prFill" value="${SET.fill}" min="0" max="20">`)}${row('Search radius (px)', `<input type="number" id="prRad" value="${SET.radius}" min="4" max="80">`)}${row('Min. contrast', `<input type="number" id="prCon" value="${SET.contrast}" min="5" max="200">`)}${row('Label threshold', `<input type="number" id="prThr" value="${SET.thr}" min="0" max="255" title="0 = automatic">`)}
    <div class="pnote">Label threshold 0 = automatic. Raise it if auto-label picks up bright clothing or reflections.</div></div>`;
  el.innerHTML = h;
  const on = (id, fn) => { const e = $('#' + id); if (!e) return; if (e.tagName === 'INPUT') e.onchange = fn; else e.onclick = fn; };
  on('prCap', e => { st.capFps = Number(e.target.value) || st.capFps; dataChanged(active); ui.refresh(); });
  on('prFile', e => { const v = Number(e.target.value); if (v > 0 && v !== st.fileFps) { st.fileFps = v; if (st.src) { resetFrames(active); ui.status('Stored frame rate changed, so markers and events were reset.', 'warn'); } } ui.refresh(); });
  on('prOpen', () => openVideo(active)); on('prDemo', () => loadDemo(active));
  on('prCm', e => { st.calib.cm = Number(e.target.value) || st.calib.cm; dataChanged(active); ui.refresh(); });
  on('prCal', () => setMode('calib')); on('prStSave', () => saveStation(active)); on('prStApply', () => applyStation(active, false)); on('prStForget', () => forgetStation(active));
  on('prR0', e => { st.range[0] = clamp(Number(e.target.value), 0, st.range[1] - 1); dataChanged(active); ui.refresh(); });
  on('prR1', e => { st.range[1] = clamp(Number(e.target.value), st.range[0] + 1, st.nFrames - 1); dataChanged(active); ui.refresh(); });
  on('prR0h', () => { st.range[0] = Math.min(st.frame, st.range[1] - 1); dataChanged(active); ui.refresh(); });
  on('prR1h', () => { st.range[1] = Math.max(st.frame, st.range[0] + 1); dataChanged(active); ui.refresh(); });
  on('prStand', () => setStanding(active)); on('prStandX', () => { st.standing = null; dataChanged(active); ui.refresh(); });
  const setK = (id, k) => on(id, e => { SET[k] = Number(e.target.value); for (const v of VKEYS) dataChanged(v); ui.refresh(); });
  setK('prCut', 'cutoff'); setK('prTol', 'tol'); setK('prFill', 'fill'); setK('prRad', 'radius'); setK('prCon', 'contrast'); setK('prThr', 'thr');
}

/* ---------- sessions ---------- */
const CLIENT_IDS = ['cName', 'cDate', 'cReason', 'cBackground', 'cInjury', 'cSymptoms', 'cAssessor', 'speed', 'speedUnit', 'gradient', 'footwear', 'familiar', 'sessionNotes', 'practSummary'];
function sessionObject() {
  const r2 = a => Array.from(a, x => Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
  const views = {};
  for (const v of VKEYS) { const st = S.views[v]; if (!st.src) continue;
    views[v] = { name: st.name, kind: st.src.kind, w: st.w, h: st.h, duration: st.src.duration, capFps: st.capFps, fileFps: st.fileFps, nFrames: st.nFrames, range: st.range, calib: st.calib, standing: st.standing, ev: st.ev,
      tr: Object.fromEntries(Object.entries(st.tr).map(([k, t]) => [k, { x: r2(t.x), y: r2(t.y) }])), sum: st.res ? st.res.sum : null, strike: st.res ? st.res.strike || null : null }; }
  return { app: 'marjon-gait', version: 1, saved: new Date().toISOString(), client: Object.fromEntries(CLIENT_IDS.map(id => [id, $('#' + id).value])), settings: { ...SET }, keyFindings: S.kf || null, kfNotes: S.kfNotes || {}, views };
}
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
const slug = s => (s || 'client').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'client';
function saveSession() {
  if (!VKEYS.some(v => S.views[v].src)) { ui.status('Nothing to save yet.', 'warn'); return; }
  for (const v of VKEYS) if (S.views[v].src && !S.views[v].res) calcView(v, true);
  download(`gait-session-${slug($('#cName').value)}-${$('#cDate').value || 'undated'}.json`, JSON.stringify(sessionObject()), 'application/json');
  ui.status('Session saved. Keep this file: it is also what you load as the previous session at a retest.', 'ok');
}
function restoreSession(o) {
  if (o.app !== 'marjon-gait') throw new Error('This is not a Marjon Gait session file.');
  for (const id of CLIENT_IDS) if (o.client && o.client[id] !== undefined) $('#' + id).value = o.client[id];
  Object.assign(SET, o.settings || {}); S.kf = o.keyFindings || null; S.kfNotes = o.kfNotes || {};
  for (const v of VKEYS) {
    S.views[v] = Object.assign(newView(v), { ver: 0, vt: null }); const d = o.views[v]; if (!d) continue; const st = S.views[v];
    st.capFps = d.capFps; st.fileFps = d.fileFps;
    const src = d.kind === 'demo' ? demoSource(v) : placeholderSource(d.w, d.h, d.duration);
    attachSource(v, src, d.kind === 'demo' ? d.name : `${d.name} (not linked)`);
    st.range = d.range; st.calib = d.calib; st.standing = d.standing; st.ev = d.ev;
    for (const [k, t] of Object.entries(d.tr)) { st.tr[k] = { x: Float64Array.from(t.x, x => x ?? NaN), y: Float64Array.from(t.y, y => y ?? NaN) }; }
    if (d.kind === 'demo') st.truth = Synth.truth(v);
    st.ver++;
  }
  for (const v of VKEYS) calcView(v, true);
}
$('#fSession').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { restoreSession(JSON.parse(await f.text())); setActive('left'); ui.status(`Opened ${f.name}. Link the original videos in Properties to view frames.`, 'ok'); } catch (err) { ui.status(`Could not open the session: ${err.message}`, 'warn'); } };
$('#fPrev').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { loadPrevious(JSON.parse(await f.text())); ui.refresh(); } catch (err) { ui.status(`Could not read the previous session: ${err.message}`, 'warn'); } };
function loadPrevious(o) {
  if (o.app !== 'marjon-gait') throw new Error('not a Marjon Gait session file');
  const sums = {}; for (const v of VKEYS) if (o.views[v] && o.views[v].sum) sums[v] = o.views[v].sum;
  S.prev = { date: o.client.cDate || o.saved.slice(0, 10), client: o.client.cName || '', sums };
  ui.status(`Previous session (${S.prev.date}) loaded. The report will show the change since then.`, 'ok');
}
function newSession() {
  for (const v of VKEYS) { S.views[v] = Object.assign(newView(v), { ver: 0, vt: null }); }
  for (const id of CLIENT_IDS) { const e = $('#' + id); if (e.tagName === 'SELECT') e.selectedIndex = 0; else e.value = ''; }
  $('#speed').value = 10; $('#gradient').value = 1; $('#cDate').valueAsDate = new Date(); S.prev = null; S.kf = null; S.kfNotes = {};
  setActive('left'); ui.status('New session.');
}

/* ---------- MDC dialog ---------- */
function mdcItems() { return [...METRICS_SIDE.map(m => ({ id: m.id, label: m.label, unit: m.unit })), ...METRICS_REAR.map(m => ({ id: m.id, label: m.label, unit: m.unit })), { id: 'stepWidth', label: 'Step width', unit: 'cm' }]; }
function openMDC() {
  const mdc = lsGet(MDCKEY);
  $('#mdcGrid').innerHTML = mdcItems().map(m => `<label style="display:contents"><span>${m.label} <span class="dim">(${m.unit})</span></span><input type="number" step="any" min="0" data-mdc="${m.id}" value="${mdc[m.id] ?? ''}"></label>`).join('');
  renderRel(); $('#dlgMDC').showModal();
}
$('#dlgMDC').addEventListener('close', () => { const o = {}; document.querySelectorAll('[data-mdc]').forEach(i => { const v = parseFloat(i.value); if (v > 0) o[i.dataset.mdc] = v; }); lsSet(MDCKEY, o); ui.refresh(); });
$('#dlgSession').addEventListener('close', () => ui.refresh());

/* ---------- wiring ---------- */
document.querySelectorAll('#ptabs button').forEach(b => b.onclick = () => { pane = b.dataset.pane; renderPanes(); });
document.querySelectorAll('#modeSeg .tool').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('#tSession').onclick = () => $('#dlgSession').showModal();
$('#tLabel').onclick = () => autoLabel(active); $('#tTrack').onclick = () => trackForward(active); $('#tStop').onclick = () => { cur().stop = true; };
$('#tEvents').onclick = () => { detectEvents(active); pane = 'events'; renderPanes(); };
$('#tCalc').onclick = () => calcView(active); $('#tAuto').onclick = processAll;
$('#tFit').onclick = () => { cur().vt = null; drawVP(); };
$('#btnNew').onclick = newSession; $('#btnOpen').onclick = () => { $('#fSession').value = ''; $('#fSession').click(); }; $('#btnSave').onclick = saveSession;
$('#btnReport').onclick = () => openReport();
$('#btnHelp').onclick = () => $('#dlgHelp').showModal();
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { const st = cur(), g = b.dataset.go; gotoA(g === 'start' ? st.range[0] : g === 'end' ? st.range[1] : st.frame + Number(g)); });
$('#bPlay').onclick = togglePlay;
$('#frameIn').onchange = e => gotoA(Number(e.target.value));
window.addEventListener('resize', () => { for (const v of VKEYS) S.views[v].vt = null; drawVP(); drawTL(); });
document.addEventListener('keydown', e => {
  if (!$('#rOverlay').hidden || document.querySelector('dialog[open]')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  const st = cur(), k = e.key, ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); saveSession(); return; }
  if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); $('#btnOpen').click(); return; }
  if (ctrl && k.toLowerCase() === 'r') { e.preventDefault(); openReport(); return; }
  if (ctrl) return;
  if (k === 'F1') { e.preventDefault(); $('#dlgHelp').showModal(); return; }
  const map = { ArrowRight: () => gotoA(st.frame + (e.shiftKey ? 10 : 1)), ArrowLeft: () => gotoA(st.frame - (e.shiftKey ? 10 : 1)), Home: () => gotoA(st.range[0]), End: () => gotoA(st.range[1]),
    ' ': togglePlay, p: () => setMode('place'), c: () => setMode('calib'), a: () => autoLabel(active), t: () => trackForward(active), e: () => { detectEvents(active); pane = 'events'; renderPanes(); },
    f: () => { st.vt = null; drawVP(); }, '[': () => nudge(-1), ']': () => nudge(1), Delete: deleteEvent, Backspace: deleteEvent, Enter: () => calcView(active), Escape: () => { st.stop = true; setMode('place'); },
    1: () => setActive('left'), 2: () => setActive('right'), 3: () => setActive('rear') };
  const fn = map[k] || map[k.toLowerCase()]; if (fn) { e.preventDefault(); fn(); }
});
