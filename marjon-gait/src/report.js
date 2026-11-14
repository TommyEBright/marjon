/* ======================= report ======================= */
const SCALE = { '°': 3, cm: 2, ms: 10, '%': 2, m: 0.05, 'steps/min': 3 };
const KF_SKIP = ['strideTime', 'cadence', 'strideLength', 'dutyFactor', 'kneeExc'];
const FRAME_FOR = { footAngle: 'ic', shankAngle: 'ic', overstride: 'ic', kneeIC: 'ic', contactTime: 'ic', kneePeak: 'kneePeakFrame', kneeExc: 'kneePeakFrame', trunk: 'kneePeakFrame', vertOsc: 'kneePeakFrame', thighTO: 'to', pelvicDrop: 'peakFrame', hipAdd: 'addFrame' };
let repTok = 0, repTimer = null;
const shotCache = new Map();
const prevVal = (v, id, side) => { const s = S.prev && S.prev.sums[v]; if (!s) return NaN; const o = side ? s[side] && s[side][id] : s[id]; return o ? o.mean : NaN; };
const mdcOf = id => lsGet(MDCKEY)[id];
const dmy = d => { const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

function candidates() {
  const L = S.views.left.res, R = S.views.right.res, B = S.views.rear.res, out = [];
  const score = (m, a, b, pa, pb) => { const sc = mdcOf(m.id) || SCALE[m.unit] || 1; let s = Number.isFinite(a) && Number.isFinite(b) ? Math.abs(b - a) / sc : 0;
    for (const [x, p] of [[a, pa], [b, pb]]) if (Number.isFinite(x) && Number.isFinite(p)) s = Math.max(s, Math.abs(x - p) / sc); return s; };
  if (L || R) for (const m of METRICS_SIDE) { if (KF_SKIP.includes(m.id)) continue; const a = L ? L.sum[m.id].mean : NaN, b = R ? R.sum[m.id].mean : NaN;
    const pa = prevVal('left', m.id), pb = prevVal('right', m.id); out.push({ key: 'side.' + m.id, m, kind: 'side', L: a, R: b, pL: pa, pR: pb, score: score(m, a, b, pa, pb) }); }
  if (B) for (const m of METRICS_REAR) { const a = B.sum.L[m.id].mean, b = B.sum.R[m.id].mean, pa = prevVal('rear', m.id, 'L'), pb = prevVal('rear', m.id, 'R');
    out.push({ key: 'rear.' + m.id, m, kind: 'rear', L: a, R: b, pL: pa, pR: pb, score: score(m, a, b, pa, pb) }); }
  return out.sort((x, y) => y.score - x.score);
}
function openReport() {
  for (const v of VKEYS) if (S.views[v].src && !S.views[v].res) calcView(v, true);
  if (!VKEYS.some(v => S.views[v].res)) { ui.status('Calculate at least one view before building the report.', 'warn'); return; }
  const c = candidates(); if (!S.kf) S.kf = c.filter(x => x.score > 0).slice(0, 3).map(x => x.key); S.kfNotes = S.kfNotes || {};
  $('#rOverlay').hidden = false; renderKF(); scheduleReport(0);
}
function renderKF() {
  const c = candidates(), unit = m => m.unit === '°' ? '°' : ' ' + m.unit;
  $('#kfList').innerHTML = c.map(x => { const on = S.kf.includes(x.key);
    return `<div class="kf"><label><input type="checkbox" data-kf="${x.key}" ${on ? 'checked' : ''} ${!on && S.kf.length >= 3 ? 'disabled' : ''}>${x.m.label.replace(' (peak in stance)', '')}<span class="val">L ${fmt(x.L, x.m.d)} · R ${fmt(x.R, x.m.d)}${unit(x.m)}</span></label>
      ${on ? `<textarea rows="2" data-note="${x.key}" placeholder="What this means for the client (optional)">${esc(S.kfNotes[x.key] || '')}</textarea>` : ''}</div>`; }).join('');
  $('#kfList').querySelectorAll('[data-kf]').forEach(cb => cb.onchange = () => { const k = cb.dataset.kf; S.kf = cb.checked ? [...S.kf, k] : S.kf.filter(x => x !== k); renderKF(); scheduleReport(); });
  $('#kfList').querySelectorAll('[data-note]').forEach(t => t.oninput = () => { S.kfNotes[t.dataset.note] = t.value; scheduleReport(400); });
  $('#rCompare').innerHTML = S.prev ? `Comparing with the session of <b>${esc(dmy(S.prev.date))}</b>. Change columns appear in the report${Object.keys(lsGet(MDCKEY)).length ? ', and changes at or beyond the MDC are marked ●' : '. Set MDC values to mark meaningful change'}.` : `No previous session loaded. <button class="tlink" id="rLoadPrev">Load previous session…</button>`;
  if ($('#rLoadPrev')) $('#rLoadPrev').onclick = () => { $('#fPrev').value = ''; $('#fPrev').click(); };
}
function scheduleReport(ms = 250) { clearTimeout(repTimer); repTimer = setTimeout(buildReport, ms); }
$('#practSummary').addEventListener('input', () => scheduleReport(500));
$('#rClose').onclick = () => { $('#rOverlay').hidden = true; for (const v of VKEYS) { const st = S.views[v]; if (st.src) { st.drawn = -1; goto(v, st.frame); } } ui.refresh(); };
$('#rPrint').onclick = () => { $('#rStatus').textContent = 'If nothing happens, open the app as a file in Chrome or Edge; printing is blocked inside the Claude viewer.'; window.print(); };
$('#rCSV').onclick = downloadCSV;

/* ---------- stills ---------- */
const P2 = (st, id, f) => { const t = st.tr[id]; return t && Number.isFinite(t.x[f]) ? [t.x[f], t.y[f]] : null; };
async function shot(v, frame, opt = {}) {
  const st = S.views[v], { crop = 'leg', overlay = null, value = NaN, w = 420, h = 520 } = opt;
  if (!st.src || !Number.isFinite(frame)) return null;
  const key = [v, frame, crop, overlay, fmt(value, 2), w, h, st.ver].join('|'); if (shotCache.has(key)) return shotCache.get(key);
  await st.src.draw(frame, st.offCtx); st.drawn = frame;
  const ids = crop === 'leg' ? ['hip', 'knee', 'ankle', 'heel', 'toe'] : MARKERS[st.type].map(m => m.id);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) { const p = P2(st, id, frame); if (!p) continue; x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = st.w; y1 = st.h; }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, bh = Math.max((y1 - y0) * 1.3, (x1 - x0) * 1.3 * h / w, 60), bw = bh * w / h, sx = cx - bw / 2, sy = cy - bh / 2;
  const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const ctx = c.getContext('2d'), k = c.width / bw;
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(st.off, sx, sy, bw, bh, 0, 0, c.width, c.height);
  const T = p => [(p[0] - sx) * k, (p[1] - sy) * k];
  drawSkeleton(ctx, st, frame, T, 2, false);
  if (overlay && calibOK(st)) drawMetric(ctx, st, frame, overlay, value, T);
  const url = c.toDataURL('image/jpeg', 0.86); shotCache.set(key, url); return url;
}
function drawAngle(ctx, V, dRef, dSeg, segLen, label) {
  const a0 = Math.atan2(dRef[1], dRef[0]), a1 = Math.atan2(dSeg[1], dSeg[0]); let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const r = Math.max(60, segLen * 0.35), L = Math.max(segLen * 0.85, 110);
  ctx.save(); ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 4; ctx.setLineDash([14, 10]); ctx.beginPath(); ctx.moveTo(V[0], V[1]); ctx.lineTo(V[0] + dRef[0] * L, V[1] + dRef[1] * L); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(V[0], V[1]); ctx.lineTo(V[0] + dSeg[0] * segLen, V[1] + dSeg[1] * segLen); ctx.stroke();
  ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(V[0], V[1], r, a0, a1, d < 0); ctx.stroke();
  const am = a0 + d / 2; label3(ctx, [V[0] + Math.cos(am) * (r + 62), V[1] + Math.sin(am) * (r + 62)], label);
  ctx.restore();
}
function label3(ctx, p, t) { ctx.font = '600 46px Segoe UI, system-ui, sans-serif'; const w = ctx.measureText(t).width; ctx.fillStyle = 'rgba(12,13,14,.88)'; ctx.fillRect(p[0] - w / 2 - 12, p[1] - 34, w + 24, 62); ctx.fillStyle = '#ffd23f'; ctx.textAlign = 'center'; ctx.fillText(t, p[0], p[1] + 14); }
function drawMetric(ctx, st, f, id, val, T) {
  const g = n => { const p = P2(st, n, f); return p ? T(p) : null; }, norm = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }, sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const { ex, up } = upDir(st), dir = st.type === 'side' ? sideDirection(st) : 1, fwd = [ex[0] * dir, ex[1] * dir], down = [-up[0], -up[1]];
  const deg = `${fmt(val, 1)}°`, ang = (V, ref, P) => { if (!V || !P) return; const s = sub(P, V); drawAngle(ctx, V, ref, norm(s), Math.hypot(...s), deg); };
  const hip = g('hip'), knee = g('knee'), ankle = g('ankle'), heel = g('heel'), toe = g('toe'), sh = g('shoulder');
  if (id === 'footAngle') ang(heel, fwd, toe);
  else if (id === 'shankAngle') ang(ankle, up, knee);
  else if (['kneeIC', 'kneePeak', 'kneeExc'].includes(id) && hip && knee) ang(knee, norm(sub(knee, hip)), ankle);
  else if (id === 'thighTO') ang(hip, down, knee);
  else if (id === 'trunk') ang(hip, up, sh);
  else if (id === 'overstride' && hip && ankle) {
    const proj = (a, b) => (b[0] - a[0]) * down[0] + (b[1] - a[1]) * down[1], dd = proj(hip, ankle), foot = [hip[0] + down[0] * dd, hip[1] + down[1] * dd];
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2.5; ctx.setLineDash([9, 7]); ctx.beginPath(); ctx.moveTo(...hip); ctx.lineTo(...foot); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(...foot); ctx.lineTo(...ankle); ctx.stroke();
    for (const p of [foot, ankle]) { ctx.beginPath(); ctx.moveTo(p[0] + up[0] * 14, p[1] + up[1] * 14); ctx.lineTo(p[0] - up[0] * 14, p[1] - up[1] * 14); ctx.stroke(); }
    label3(ctx, [(foot[0] + ankle[0]) / 2 + up[0] * 70, (foot[1] + ankle[1]) / 2 + up[1] * 70], `${fmt(val, 1)} cm`); ctx.restore();
  } else if (id === 'pelvicDrop') { const l = g('lPSIS'), r = g('rPSIS'); if (l && r) ang(l, ex, r); }
  else if (id.startsWith('hipAdd')) { const s = id.endsWith('L') ? 'l' : 'r', th = g(s + 'Thigh'), kn = g(s + 'Knee'), l = g('lPSIS'), r = g('rPSIS');
    if (th && kn && l && r) { const u = norm(sub(r, l)); ang(th, [-u[1], u[0]], kn); } }
}
async function findingShots(x) {
  const id = x.m.id, out = [];
  if (x.kind === 'side') for (const [v, lab] of [['left', 'Left'], ['right', 'Right']]) {
    const res = S.views[v].res; if (!res) { out.push(null); continue; } const r = medianRow(res.rows, id); if (!r) { out.push(null); continue; }
    const f = r[FRAME_FOR[id]]; out.push({ src: await shot(v, f, { crop: 'leg', overlay: id, value: r[id], w: 400, h: 400 }), cap: `${lab} · frame ${f}` }); }
  else { const B = S.views.rear.res; for (const [s, lab] of [['L', 'Left stance'], ['R', 'Right stance']]) {
    const r = medianRow(B.rows.filter(q => q.side === s), id); if (!r) { out.push(null); continue; } const f = r[FRAME_FOR[id]];
    out.push({ src: await shot('rear', f, { crop: 'body', overlay: id === 'hipAdd' ? 'hipAdd' + s : id, value: r[id], w: 400, h: 400 }), cap: `${lab} · frame ${f}` }); } }
  return out;
}

/* ---------- report document ---------- */
async function buildReport() {
  const tok = ++repTok; $('#rStatus').textContent = 'Building…';
  const L = S.views.left.res, R = S.views.right.res, B = S.views.rear.res, val = id => $('#' + id).value.trim();
  const client = val('cName') || 'Client', date = val('cDate'), dateTxt = date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not recorded';
  const sp = num('#speed'), unitTxt = $('#speedUnit').selectedOptions[0].text, logo = $('#titlebar .logo').src, mdc = lsGet(MDCKEY), u = m => m.unit === '°' ? '°' : ` ${m.unit}`;
  const pages = []; let pg = 0;
  const head = (title) => `<div class="rp-top"><img src="${logo}" alt="Plymouth Marjon University"><div class="rp-tt"><div class="rp-k">Running Gait Assessment</div><div class="rp-t">${title}</div></div><div class="rp-who"><b>${esc(client)}</b><span>${esc(dateTxt)}</span></div></div>`;
  const foot = () => `<div class="rp-foot"><span>Plymouth Marjon University · Marjon Gait v${APP_VERSION}</span><span>${esc(client)} · ${esc(dateTxt)}</span><span class="pn"></span></div>`;
  // page 1: overview and key findings
  const tile = (k, v, s = '') => `<div class="tile"><div class="tk">${k}</div><div class="tv">${v}</div>${s ? `<div class="ts">${s}</div>` : ''}</div>`;
  const lr = (a, b, d, un = '') => `<span class="lrv"><i>L</i>${fmt(a, d)}${un}</span><span class="lrv"><i>R</i>${fmt(b, d)}${un}</span>`;
  const cad = mean([L?.sum.cadence.mean, R?.sum.cadence.mean]);
  let p1 = head('Summary') + `<table class="rp-meta"><tr><td><span>Speed</span>${sp ? `${sp} ${unitTxt}` : '–'}</td><td><span>Gradient</span>${val('gradient') ? val('gradient') + '%' : '–'}</td><td><span>Footwear</span>${esc(val('footwear')) || '–'}</td><td><span>Practitioner</span>${esc(val('cAssessor')) || '–'}</td></tr>
    <tr><td colspan="2"><span>Reason for assessment</span>${esc(val('cReason')) || '–'}</td><td colspan="2"><span>Running background</span>${esc(val('cBackground')) || '–'}</td></tr></table>`;
  p1 += `<div class="tiles">${tile('Cadence', Number.isFinite(cad) ? `${fmt(cad, 0)}<small> steps/min</small>` : '–')}${tile('Contact time', L || R ? lr(L?.sum.contactTime.mean, R?.sum.contactTime.mean, 0) : '–', 'milliseconds')}${tile('Foot strike', L || R ? `<span class="lrv"><i>L</i>${L?.strike || '–'}</span><span class="lrv"><i>R</i>${R?.strike || '–'}</span>` : '–')}${B ? tile('Pelvic drop', lr(B.sum.L.pelvicDrop.mean, B.sum.R.pelvicDrop.mean, 1, '°'), 'opposite side, in stance') + tile('Step width', `${fmt(B.sum.stepWidth.mean, 1)}<small> cm</small>`) : ''}</div>`;
  p1 += `<h3 class="rp-h">Key findings</h3>`;
  const cands = candidates(), chosen = S.kf.map(k => cands.find(c => c.key === k)).filter(Boolean);
  if (!chosen.length) p1 += `<p class="rp-muted">No key findings selected.</p>`;
  for (const x of chosen) {
    const imgs = await findingShots(x); if (tok !== repTok) return;
    const d = x.R - x.L, chg = S.prev ? [x.L - x.pL, x.R - x.pR] : null, md = mdc[x.m.id], flag = c => md && Number.isFinite(c) && Math.abs(c) >= md ? ' <b class="mdc">●</b>' : '';
    p1 += `<div class="kfb"><div class="kfimgs">${imgs.map(im => im ? `<figure><img src="${im.src}" alt=""><figcaption>${esc(im.cap)}</figcaption></figure>` : '<figure class="none"></figure>').join('')}</div>
      <div class="kftx"><div class="kft">${x.m.label}</div><div class="kfv">${lr(x.L, x.R, x.m.d, u(x.m))}</div><div class="kfd">Right minus left: <b>${fmt(d, x.m.d)}${u(x.m)}</b>${chg ? `<br>Since ${esc(dmy(S.prev.date))}: L ${fmt(chg[0], x.m.d)}${flag(chg[0])}, R ${fmt(chg[1], x.m.d)}${flag(chg[1])}` : ''}</div>
      <p class="kfdesc">${x.m.desc}</p>${S.kfNotes[x.key] ? `<p class="kfnote">${esc(S.kfNotes[x.key])}</p>` : ''}</div></div>`;
  }
  pages.push(p1);
  // page 2: stance sequence
  let p2 = head('Stance sequence');
  for (const [v, lab] of [['left', 'Left'], ['right', 'Right']]) { const res = S.views[v].res; if (!res) continue; const r = medianRow(res.rows, 'kneeIC'); if (!r) continue;
    const fr = [[r.ic, 'Initial contact'], [r.kneePeakFrame, 'Mid-stance (peak knee flexion)'], [r.to, 'Toe-off']], ims = [];
    for (const [f, t] of fr) ims.push([await shot(v, f, { crop: 'leg', w: 360, h: 340 }), t, f]); if (tok !== repTok) return;
    p2 += `<h3 class="rp-h">${lab} side</h3><div class="seq">${ims.map(([s, t, f]) => `<figure>${s ? `<img src="${s}" alt="">` : ''}<figcaption><b>${t}</b> · frame ${f}</figcaption></figure>`).join('')}</div>`; }
  if (B) { const ims = [];
    for (const [s, t] of [['L', 'Left stance'], ['R', 'Right stance']]) { const r = medianRow(B.rows.filter(q => q.side === s), 'pelvicDrop'); if (r) ims.push([await shot('rear', r.peakFrame, { crop: 'body', overlay: 'pelvicDrop', value: r.pelvicDrop, w: 360, h: 340 }), t, r.peakFrame]); }
    if (tok !== repTok) return;
    p2 += `<h3 class="rp-h">Rear view at peak pelvic drop</h3><div class="seq two">${ims.map(([s, t, f]) => `<figure>${s ? `<img src="${s}" alt="">` : ''}<figcaption><b>${t}</b> · frame ${f}</figcaption></figure>`).join('')}</div>`; }
  p2 += `<p class="rp-muted">Images are from the stride closest to the average. Yellow lines show how each angle is measured.</p>`;
  pages.push(p2);
  // page 3: full results
  const hasPrev = !!S.prev, chgCell = (now, prev, m) => { if (!hasPrev) return ''; const c = now - prev, md = mdc[m.id]; return `<td class="n chg">${Number.isFinite(c) ? (c > 0 ? '+' : '') + fmt(c, m.d) : '–'}${md && Number.isFinite(c) && Math.abs(c) >= md ? ' <b class="mdc">●</b>' : ''}</td>`; };
  let p3 = head('Results');
  if (L || R) {
    p3 += `<h3 class="rp-h">Side view</h3><table class="rt"><tr><th>Measure</th><th class="n">Left</th>${hasPrev ? '<th class="n">Change</th>' : ''}<th class="n">Right</th>${hasPrev ? '<th class="n">Change</th>' : ''}<th class="n">R − L</th></tr>`;
    METRICS_SIDE.forEach((m, i) => { if (i === 0) p3 += `<tr class="grp"><td colspan="6">Timing</td></tr>`; if (i === 5) p3 += `<tr class="grp"><td colspan="6">Landing and stance</td></tr>`;
      const a = L ? L.sum[m.id] : null, b = R ? R.sum[m.id] : null;
      p3 += `<tr><td>${m.label}<span class="un">${m.unit}</span><div class="ds">${m.desc}</div></td><td class="n">${a ? `${fmt(a.mean, m.d)}<span class="sd">±${fmt(a.sd, m.d)}</span>` : '–'}</td>${chgCell(a?.mean, prevVal('left', m.id), m)}<td class="n">${b ? `${fmt(b.mean, m.d)}<span class="sd">±${fmt(b.sd, m.d)}</span>` : '–'}</td>${chgCell(b?.mean, prevVal('right', m.id), m)}<td class="n">${a && b ? fmt(b.mean - a.mean, m.d) : '–'}</td></tr>`; });
    p3 += `<tr><td>Foot strike pattern<div class="ds">Standing-referenced foot angle, Altman and Davis (2012) cut-offs.</div></td><td class="n">${L?.strike || '–'}</td>${hasPrev ? '<td></td>' : ''}<td class="n">${R?.strike || '–'}</td>${hasPrev ? '<td></td>' : ''}<td></td></tr></table>`;
  }
  if (B) {
    p3 += `<h3 class="rp-h">Rear view</h3><table class="rt"><tr><th>Measure</th><th class="n">Left stance</th>${hasPrev ? '<th class="n">Change</th>' : ''}<th class="n">Right stance</th>${hasPrev ? '<th class="n">Change</th>' : ''}<th class="n">R − L</th></tr>`;
    for (const m of METRICS_REAR) { const a = B.sum.L[m.id], b = B.sum.R[m.id];
      p3 += `<tr><td>${m.label}<span class="un">${m.unit}</span><div class="ds">${m.desc}</div></td><td class="n">${fmt(a.mean, m.d)}<span class="sd">±${fmt(a.sd, m.d)}</span></td>${chgCell(a.mean, prevVal('rear', m.id, 'L'), m)}<td class="n">${fmt(b.mean, m.d)}<span class="sd">±${fmt(b.sd, m.d)}</span></td>${chgCell(b.mean, prevVal('rear', m.id, 'R'), m)}<td class="n">${fmt(b.mean - a.mean, m.d)}</td></tr>`; }
    const sw = B.sum.stepWidth, psw = S.prev && S.prev.sums.rear ? S.prev.sums.rear.stepWidth?.mean : NaN;
    p3 += `<tr><td>Step width<span class="un">cm</span><div class="ds">Side-to-side distance between the feet at contact. Negative means the feet cross the midline.</div></td><td class="n" colspan="${hasPrev ? 4 : 2}">${fmt(sw.mean, 1)}<span class="sd">±${fmt(sw.sd, 1)}</span>${hasPrev ? ` &nbsp; change ${fmt(sw.mean - psw, 1)}` : ''}</td><td></td></tr></table>`;
  }
  p3 += `<p class="rp-muted">Values are means ± stride-to-stride SD (left ${L ? L.n : 0} strides, right ${R ? R.n : 0} strides${B ? `, rear ${B.rows.length} stances` : ''}).${hasPrev ? ` Change is this session minus ${esc(dmy(S.prev.date))}.${Object.keys(mdc).length ? ' ● marks a change at or beyond the minimal detectable change.' : ' Minimal detectable change values are not yet set, so small changes may be measurement noise.'}` : ''}</p>`;
  pages.push(p3);
  // page 4: summary and method
  const fpsTxt = VKEYS.filter(v => S.views[v].res).map(v => `${VIEWS[v].label.toLowerCase()} ${S.views[v].capFps} fps`).join(', ');
  let p4 = head('Summary and actions') + `<h3 class="rp-h">Practitioner summary and agreed actions</h3><div class="summ">${esc(val('practSummary')) || '<span class="rp-muted">To be completed by the practitioner.</span>'}</div>`;
  p4 += `<h3 class="rp-h">Session notes</h3><table class="rp-meta"><tr><td><span>Injury history</span>${esc(val('cInjury')) || '–'}</td><td><span>Current symptoms</span>${esc(val('cSymptoms')) || '–'}</td></tr><tr><td><span>Familiarisation</span>${esc(val('familiar')) || '–'}</td><td><span>Notes</span>${esc(val('sessionNotes')) || '–'}</td></tr></table>`;
  p4 += `<h3 class="rp-h">How these values were measured</h3><p class="meth">Treadmill running was filmed in 2D (${esc(fpsTxt)}) with reflective markers on standard landmarks. Each camera was calibrated on the treadmill belt, which also defines horizontal. Markers were tracked automatically and checked by the practitioner, and every initial contact and toe-off was confirmed frame by frame. Angles were filtered at ${SET.cutoff} Hz. Values are image-plane measures, so they depend on camera position and marker placement and are not 3D joint angles. Treadmill running differs slightly from running over ground.</p>
    <p class="meth">These results describe how you ran at this speed on this day. They are a starting point for discussion and do not diagnose or predict injury. There is no single correct way to run.</p>`;
  pages.push(p4);
  if (tok !== repTok) return;
  $('#report').innerHTML = pages.map((p, i) => `<section class="rpage">${p}${foot()}</section>`).join('');
  $('#report').querySelectorAll('.pn').forEach((e, i) => e.textContent = `${i + 1} / ${pages.length}`);
  $('#rStatus').textContent = `${pages.length} pages · updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
function downloadCSV() {
  const rows = []; for (const v of VKEYS) if (S.views[v].res) rows.push(...S.views[v].res.rows);
  if (!rows.length) return;
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const csv = [keys.join(','), ...rows.map(r => keys.map(k => { const x = r[k]; return typeof x === 'number' ? (Number.isFinite(x) ? +x.toFixed(4) : '') : JSON.stringify(x ?? ''); }).join(','))].join('\n');
  download(`gait-strides-${slug($('#cName').value)}.csv`, csv, 'text/csv');
}

/* ---------- boot ---------- */
$('#cDate').valueAsDate = new Date();
setActive('left');
ui.status('Ready. Open a video for each view, or load the demo runner to try the workflow.');
window.GaitApp = { S, SET, Synth, loadDemo, loadDemoAll, autoLabel, trackForward, detectEvents, calcView, processAll, openReport, buildReport, setStanding, sessionObject, loadPrevious, restoreSession, goto, setActive, candidates };
