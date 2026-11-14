'use strict';
const APP_VERSION = '__VERSION__';
/* ---------- utilities ---------- */
const $ = s => document.querySelector(s);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fin = a => a.filter(Number.isFinite);
const mean = a => { a = fin(a); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN; };
const sd = a => { a = fin(a); if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const median = a => pct(a, 50);
function pct(a, p) { a = fin(a).sort((x, y) => x - y); if (!a.length) return NaN; const i = (a.length - 1) * p / 100, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); }
const fmt = (x, d = 1) => { if (!Number.isFinite(x)) return '–'; const t = x.toFixed(d); return /^-0(\.0+)?$/.test(t) ? t.slice(1) : t; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = id => Number($(id).value);

/* ---------- definitions ---------- */
const VIEWS = {
  left: { label: 'Left side', type: 'side', side: 'L' },
  right: { label: 'Right side', type: 'side', side: 'R' },
  rear: { label: 'Rear', type: 'rear' }
};
const MARKERS = {
  side: [
    { id: 'shoulder', label: 'Shoulder (acromion)', c: '#f2c94c' },
    { id: 'hip', label: 'Hip (greater trochanter)', c: '#56ccf2' },
    { id: 'knee', label: 'Knee (lateral femoral condyle)', c: '#6fcf97' },
    { id: 'ankle', label: 'Ankle (lateral malleolus)', c: '#bb6bd9' },
    { id: 'heel', label: 'Heel (rear of shoe)', c: '#f2994a' },
    { id: 'toe', label: 'Forefoot (5th metatarsal head)', c: '#eb5757' }],
  rear: [
    { id: 'lPSIS', label: 'Left PSIS', c: '#56ccf2' }, { id: 'rPSIS', label: 'Right PSIS', c: '#2f80ed' },
    { id: 'lThigh', label: 'Left mid-thigh', c: '#6fcf97' }, { id: 'rThigh', label: 'Right mid-thigh', c: '#219653' },
    { id: 'lKnee', label: 'Left knee (posterior)', c: '#bb6bd9' }, { id: 'rKnee', label: 'Right knee (posterior)', c: '#9b51e0' },
    { id: 'lHeel', label: 'Left heel', c: '#f2994a' }, { id: 'rHeel', label: 'Right heel', c: '#eb5757' }]
};
const SEGS = {
  side: [['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'heel'], ['heel', 'toe'], ['ankle', 'toe']],
  rear: [['lPSIS', 'rPSIS'], ['lThigh', 'lKnee'], ['rThigh', 'rKnee'], ['lKnee', 'lHeel'], ['rKnee', 'rHeel']]
};
const METRICS_SIDE = [
  { id: 'contactTime', label: 'Contact time', unit: 'ms', d: 0, desc: 'Time the foot is on the belt each step.' },
  { id: 'strideTime', label: 'Stride time', unit: 'ms', d: 0, desc: 'Time from one contact to the next contact of the same foot.' },
  { id: 'cadence', label: 'Cadence', unit: 'steps/min', d: 0, desc: 'Steps per minute, from stride time.' },
  { id: 'dutyFactor', label: 'Duty factor', unit: '%', d: 1, desc: 'Share of the stride spent in contact.' },
  { id: 'strideLength', label: 'Stride length', unit: 'm', d: 2, desc: 'Belt speed × stride time (treadmill estimate).' },
  { id: 'footAngle', label: 'Foot angle at contact', unit: '°', d: 1, desc: 'Shoe angle to the belt at first contact. Positive = toes up (heel first).' },
  { id: 'shankAngle', label: 'Shank angle at contact', unit: '°', d: 1, desc: 'Lower leg to vertical at contact. Positive = ankle ahead of knee.' },
  { id: 'overstride', label: 'Ankle ahead of hip at contact', unit: 'cm', d: 1, desc: 'How far in front of the hip the foot lands.' },
  { id: 'kneeIC', label: 'Knee flexion at contact', unit: '°', d: 1, desc: 'Knee bend as the foot lands.' },
  { id: 'kneePeak', label: 'Peak knee flexion in stance', unit: '°', d: 1, desc: 'Greatest knee bend while the foot is on the belt.' },
  { id: 'kneeExc', label: 'Knee flexion excursion', unit: '°', d: 1, desc: 'Extra knee bend from contact to peak.' },
  { id: 'thighTO', label: 'Thigh extension at toe-off', unit: '°', d: 1, desc: 'Thigh behind vertical as the foot leaves the belt.' },
  { id: 'trunk', label: 'Trunk lean (stance mean)', unit: '°', d: 1, desc: 'Forward lean of the hip–shoulder line.' },
  { id: 'vertOsc', label: 'Vertical oscillation (hip marker)', unit: 'cm', d: 1, desc: 'Up-and-down range of the hip over the stride.' }
];
const METRICS_REAR = [
  { id: 'pelvicDrop', label: 'Contralateral pelvic drop (peak in stance)', unit: '°', d: 1, desc: 'Drop of the opposite side of the pelvis while this leg is in stance.' },
  { id: 'hipAdd', label: 'Hip adduction (peak in stance)', unit: '°', d: 1, desc: 'Thigh angled towards the midline while this leg is in stance.' }
];

/* ---------- state ---------- */
const S = { views: {} };
function newView(v) {
  return { v, type: VIEWS[v].type, src: null, name: '', capFps: 200, fileFps: 200, nFrames: 0, w: 0, h: 0, frame: 0,
    range: [0, 0], calib: { p: [], cm: VIEWS[v].type === 'side' ? 100 : 50 }, tr: {}, sel: MARKERS[VIEWS[v].type][0].id,
    ev: VIEWS[v].type === 'side' ? { IC: [], TO: [] } : { L: [], R: [] }, selEv: null, standing: null, truth: null, res: null,
    mode: 'place', zoom: 1, centre: null, tracking: false, stop: false, off: null, offCtx: null, drawn: -1, want: -1, busy: false };
}
for (const v in VIEWS) S.views[v] = newView(v);
const SET = { cutoff: 12, tol: 0.5, fill: 5, radius: 16, contrast: 40, thr: 0 };
const settings = () => ({ cutoff: SET.cutoff, tol: SET.tol / 100, fill: SET.fill, radius: SET.radius, contrast: SET.contrast });
function speedMS() { const x = num('#speed'), u = $('#speedUnit').value; if (!(x > 0)) return NaN; return u === 'kmh' ? x / 3.6 : u === 'mph' ? x * 0.44704 : x; }

/* ---------- signal processing ---------- */
function butterFiltfilt(x, fc, fs) {
  const n = x.length; if (n < 12 || !(fc > 0) || fc >= fs / 2) return Float64Array.from(x);
  const fcAdj = fc / 0.802, wc = Math.tan(Math.PI * fcAdj / fs), k1 = Math.SQRT2 * wc, k2 = wc * wc, a0 = 1 + k1 + k2;
  const b0 = k2 / a0, b1 = 2 * b0, b2 = b0, a1 = 2 * (k2 - 1) / a0, a2 = (1 - k1 + k2) / a0;
  const pad = Math.min(n - 1, Math.max(12, Math.round(fs / fc)));
  const ext = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) { ext[i] = 2 * x[0] - x[pad - i]; ext[n + pad + i] = 2 * x[n - 1] - x[n - 2 - i]; }
  for (let i = 0; i < n; i++) ext[pad + i] = x[i];
  const run = a => { const y = new Float64Array(a.length); y[0] = a[0]; y[1] = a[1];
    for (let i = 2; i < a.length; i++) y[i] = b0 * a[i] + b1 * a[i - 1] + b2 * a[i - 2] - a1 * y[i - 1] - a2 * y[i - 2]; return y; };
  let y = run(ext); y.reverse(); y = run(y); y.reverse();
  return y.slice(pad, pad + n);
}
function fillGaps(a, maxGap) {
  const y = Float64Array.from(a); let i = 0;
  while (i < y.length) {
    if (Number.isFinite(y[i])) { i++; continue; }
    const s = i; while (i < y.length && !Number.isFinite(y[i])) i++;
    const len = i - s;
    if (s > 0 && i < y.length && len <= maxGap) for (let k = 0; k < len; k++) y[s + k] = y[s - 1] + (y[i] - y[s - 1]) * (k + 1) / (len + 1);
  }
  return y;
}
function filterSegments(a, fc, fs) {
  const y = Float64Array.from(a); let i = 0;
  while (i < y.length) {
    if (!Number.isFinite(y[i])) { i++; continue; }
    const s = i; while (i < y.length && Number.isFinite(y[i])) i++;
    if (i - s >= 12) y.set(butterFiltfilt(y.subarray(s, i), fc, fs), s);
  }
  return y;
}
/* pixel -> world (metres, x along belt, y up) */
function calibOK(st) { return st.calib.p.length === 2 && st.calib.cm > 0; }
function toWorld(st) {
  const [p1, p2] = st.calib.p, dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.hypot(dx, dy), s = st.calib.cm / 100 / L;
  const ex = [dx / L, dy / L], ey = [ex[1], -ex[0]];
  return (x, y) => [s * ((x - p1[0]) * ex[0] + (y - p1[1]) * ex[1]), s * ((x - p1[0]) * ey[0] + (y - p1[1]) * ey[1])];
}
function series(st, m, filtered, fcOverride) {
  const t = st.tr[m], n = st.nFrames, X = new Float64Array(n).fill(NaN), Y = new Float64Array(n).fill(NaN);
  if (!t || !calibOK(st)) return { X, Y };
  const w = toWorld(st);
  for (let i = 0; i < n; i++) if (Number.isFinite(t.x[i])) { const p = w(t.x[i], t.y[i]); X[i] = p[0]; Y[i] = p[1]; }
  const set = settings(); let fx = fillGaps(X, set.fill), fy = fillGaps(Y, set.fill);
  if (filtered) { const fc = fcOverride || set.cutoff; fx = filterSegments(fx, fc, st.capFps); fy = filterSegments(fy, fc, st.capFps); }
  return { X: fx, Y: fy };
}
const P = (s, i) => [s.X[i], s.Y[i]];
function inclAngle(a, b, c) { const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]], n = Math.hypot(...u) * Math.hypot(...v); return n ? Math.acos(clamp((u[0] * v[0] + u[1] * v[1]) / n, -1, 1)) * R2D : NaN; }

/* ---------- synthetic runner (known truth) ---------- */
const Synth = (() => {
  const rot = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const heelC = [-0.07, -0.08], mtC = [0.13, -0.08], heelM = [-0.07, -0.05], mtM = [0.13, -0.05];
  function leg(p) {
    const pA = p.phiIC >= 0 ? heelC : mtC, t1 = p.s1 * p.tc, t2 = p.s2 * p.tc;
    const phi = s => s < p.s1 ? p.phiIC * D2R * 0.5 * (1 + Math.cos(Math.PI * s / p.s1)) : s <= p.s2 ? 0 : -p.phiTO * D2R * ((s - p.s2) / (1 - p.s2)) ** 2;
    const xP0 = p.over + rot(pA, p.phiIC * D2R)[0];
    const a1x = xP0 - p.v * t1 - pA[0], a2x = a1x - p.v * (t2 - t1);
    function stance(tau) {
      const s = tau / p.tc, f = phi(s);
      if (s < p.s1) { const rc = rot(pA, f); return [xP0 - p.v * tau - rc[0], -rc[1]]; }
      if (s <= p.s2) return [a1x - p.v * (tau - t1), 0.08];
      const rc = rot(mtC, f); return [a2x + mtC[0] - p.v * (tau - t2) - rc[0], -rc[1]];
    }
    const h = 1e-5, D = p.T - p.tc;
    const A0 = stance(p.tc), A1 = stance(0);
    const m0 = [(A0[0] - stance(p.tc - h)[0]) / h, (A0[1] - stance(p.tc - h)[1]) / h];
    const m1 = [(stance(h)[0] - A1[0]) / h + p.impX, (stance(h)[1] - A1[1]) / h - p.impY];
    const f0 = phi(1), f1 = phi(0), df0 = (phi(1) - phi(1 - h / p.tc)) / h, df1 = (phi(h / p.tc) - phi(0)) / h;
    const herm = (u, a, ma, b, mb) => { const u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * D * ma + (-2 * u3 + 3 * u2) * b + (u3 - u2) * D * mb; };
    return function state(t) {
      const tau = (((t - p.t0) % p.T) + p.T) % p.T;
      if (tau <= p.tc) return { a: stance(tau), f: phi(tau / p.tc), contact: true, s: tau / p.tc, tau };
      const u = (tau - p.tc) / D;
      const a = [herm(u, A0[0], m0[0], A1[0], m1[0]), herm(u, A0[1], m0[1], A1[1], m1[1]) + p.H * u * u * (1 - u) ** 3 / 0.03456];
      return { a, f: herm(u, f0, df0, f1, df1), contact: false, u, tau };
    };
  }
  function hipAt(p, t) { return [0.008 * Math.sin(2 * Math.PI * (t - p.t0) / p.T), p.hipMean - p.osc * Math.cos(4 * Math.PI * (t - p.t0 - p.tc / 2) / p.T)]; }
  function ik(H, A, Lt, Ls) {
    let dx = A[0] - H[0], dy = A[1] - H[1], d = Math.hypot(dx, dy);
    if (d > Lt + Ls - 1e-4) { const k = (Lt + Ls - 1e-4) / d; A = [H[0] + dx * k, H[1] + dy * k]; dx *= k; dy *= k; d = Lt + Ls - 1e-4; }
    const a = (Lt * Lt - Ls * Ls + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, Lt * Lt - a * a));
    const px = H[0] + a * dx / d, py = H[1] + a * dy / d, nx = -dy / d, ny = dx / d;
    const k1 = [px + hh * nx, py + hh * ny], k2 = [px - hh * nx, py - hh * ny];
    return { knee: k1[0] > k2[0] ? k1 : k2, ankle: A };
  }
  function sideFigure(p, t) {
    const st = leg(p)(t), H = hipAt(p, t), { knee, ankle } = ik(H, st.a, p.Lt, p.Ls);
    const lean = (p.trunk + 1.5 * Math.sin(4 * Math.PI * t / p.T)) * D2R;
    return { hip: H, knee, ankle, heel: add(ankle, rot(heelM, st.f)), toe: add(ankle, rot(mtM, st.f)),
      heelC: add(ankle, rot(heelC, st.f)), mtC: add(ankle, rot(mtC, st.f)), shoulder: [H[0] + 0.5 * Math.sin(lean), H[1] + 0.5 * Math.cos(lean)], contact: st.contact, s: st.s, u: st.u };
  }
  const base = { impX: 1.0, impY: 0.7, T: 0.72, v: 10 / 3.6, s1: 0.15, s2: 0.6, phiTO: 30, H: 0.22, hipMean: 1.01, osc: 0.03, Lt: 0.49, Ls: 0.49, trunk: 8 };
  const PARAMS = {
    L: { ...base, tc: 0.22, phiIC: 12, over: 0.25, t0: 0.1 },
    R: { ...base, tc: 0.235, phiIC: 7, over: 0.28, t0: 0.1 + 0.36, trunk: 8 }
  };
  const REAR = { W: 0.05, D: { L: 4, R: 6 }, B: { L: 6, R: 8 }, base: 2 };
  function rearFigure(t) {
    const L = sideFigure(PARAMS.L, t), R = sideFigure(PARAMS.R, t), H = hipAt(PARAMS.L, t);
    let alpha = 0; const beta = { L: REAR.base, R: REAR.base };
    if (R.contact) { alpha += REAR.D.R * Math.sin(Math.PI * R.s); beta.R += REAR.B.R * Math.sin(Math.PI * R.s); }
    if (L.contact) { alpha -= REAR.D.L * Math.sin(Math.PI * L.s); beta.L += REAR.B.L * Math.sin(Math.PI * L.s); }
    const a = alpha * D2R, u = [Math.cos(a), Math.sin(a)], nUp = [-Math.sin(a), Math.cos(a)], down = [Math.sin(a), -Math.cos(a)];
    const C = [H[0], H[1] + 0.10];
    const out = { lPSIS: [C[0] - 0.05 * u[0], C[1] - 0.05 * u[1]], rPSIS: [C[0] + 0.05 * u[0], C[1] + 0.05 * u[1]] };
    for (const sd of ['L', 'R']) {
      const sg = sd === 'R' ? 1 : -1, hj = [C[0] + sg * 0.09 * u[0] - 0.10 * nUp[0], C[1] + sg * 0.09 * u[1] - 0.10 * nUp[1]];
      const th = (sd === 'R' ? -1 : 1) * beta[sd] * D2R, dir = rot(down, th), Lf = 0.42;
      const fig = sd === 'R' ? R : L, sw = fig.contact ? 0 : 0.025 * Math.sin(Math.PI * fig.u);
      out[sd.toLowerCase() + 'Thigh'] = [hj[0] + 0.5 * Lf * dir[0], hj[1] + 0.5 * Lf * dir[1]];
      out[sd.toLowerCase() + 'Knee'] = [hj[0] + Lf * dir[0], hj[1] + Lf * dir[1]];
      out[sd.toLowerCase() + 'Heel'] = [sg * (REAR.W / 2 + sw), fig.heel[1]];
      out[sd.toLowerCase() + 'HJ'] = hj;
    }
    return out;
  }
  /* rendering */
  const W = 960, Hh = 540, G = 500;
  function drawBack(ctx) { ctx.fillStyle = '#1b1f24'; ctx.fillRect(0, 0, W, Hh); ctx.fillStyle = '#2b3036'; ctx.fillRect(0, G, W, Hh - G); ctx.strokeStyle = '#4a525b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, G); ctx.lineTo(W, G); ctx.stroke(); }
  function line(ctx, pts, col, w) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke(); }
  function dot(ctx, q) { ctx.save(); if (opts.blur) ctx.filter = `blur(${opts.blur}px)`; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(q[0], q[1], 4.5, 0, 2 * Math.PI); ctx.fill(); ctx.restore(); }
  function drawSide(ctx, side, t) {
    const p = PARAMS[side], dir = side === 'L' ? 1 : -1, sc = 300, im = q => [480 + dir * q[0] * sc, G - q[1] * sc];
    const f = sideFigure(p, t), ff = sideFigure({ ...p, t0: p.t0 + p.T / 2 }, t);
    drawBack(ctx);
    line(ctx, [ff.hip, ff.knee, ff.ankle, ff.heelC, ff.mtC, ff.ankle].map(im), '#3c434b', 16);
    line(ctx, [f.hip, f.shoulder].map(im), '#59626c', 30);
    ctx.fillStyle = '#59626c'; const hd = im([f.shoulder[0] + 0.05, f.shoulder[1] + 0.2]); ctx.beginPath(); ctx.arc(hd[0], hd[1], 26, 0, 2 * Math.PI); ctx.fill();
    line(ctx, [f.hip, f.knee, f.ankle].map(im), '#77818c', 18);
    line(ctx, [f.ankle, f.heelC, f.mtC, f.ankle].map(im), '#8b95a0', 10);
    ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'].forEach(k => dot(ctx, im(f[k])));
    degrade(ctx);
  }
  function drawRear(ctx, t) {
    const sc = 420, im = q => [480 + q[0] * sc, G - q[1] * sc], f = rearFigure(t);
    drawBack(ctx);
    line(ctx, [[f.lPSIS[0], f.lPSIS[1] + 0.45], [f.rPSIS[0], f.rPSIS[1] + 0.45]].map(im), '#59626c', 60);
    line(ctx, [f.lPSIS, f.rPSIS].map(im), '#69737e', 34);
    for (const s of ['l', 'r']) line(ctx, [f[s + 'HJ'], f[s + 'Knee'], f[s + 'Heel']].map(im), '#77818c', 20);
    ['lPSIS', 'rPSIS', 'lThigh', 'rThigh', 'lKnee', 'rKnee', 'lHeel', 'rHeel'].forEach(k => dot(ctx, im(f[k])));
    degrade(ctx);
  }
  const opts = { noise: 0, blur: 0 };
  function degrade(ctx) {
    if (!opts.noise) return; const d = ctx.getImageData(0, 0, W, Hh), a = d.data;
    for (let i = 0; i < a.length; i += 4) { const n = (Math.random() + Math.random() + Math.random() - 1.5) * opts.noise; a[i] += n; a[i + 1] += n; a[i + 2] += n; }
    ctx.putImageData(d, 0, 0);
  }
  function imgPos(view, t) {
    if (view === 'rear') { const f = rearFigure(t); const o = {}; for (const m of MARKERS.rear) o[m.id] = [480 + f[m.id][0] * 420, G - f[m.id][1] * 420]; return o; }
    const side = view === 'left' ? 'L' : 'R', dir = side === 'L' ? 1 : -1, f = sideFigure(PARAMS[side], t), o = {};
    for (const m of MARKERS.side) o[m.id] = [480 + dir * f[m.id][0] * 300, G - f[m.id][1] * 300]; return o;
  }
  function calib(view) { return view === 'rear' ? { p: [[480 - 0.25 * 420, G], [480 + 0.25 * 420, G]], cm: 50 } : { p: [[480 - 0.8 * 300, G], [480 + 0.8 * 300, G]], cm: 160 }; }
  /* truth values, computed from the model geometry with the same definitions as the app */
  function truth(view) {
    if (view === 'rear') {
      const tr = {}; for (const s of ['L', 'R']) tr[s] = { pelvicDrop: REAR.D[s], hipAdd: REAR.base + REAR.B[s] };
      tr.stepWidth = REAR.W * 100; tr.IC = { L: PARAMS.L, R: PARAMS.R }; return tr;
    }
    const side = view === 'left' ? 'L' : 'R', p = PARAMS[side], f = t => sideFigure(p, t);
    const t0 = p.t0 + p.T, ic = f(t0), to = f(t0 + p.tc - 1e-9);
    const knee = g => 180 - inclAngle(g.hip, g.knee, g.ankle);
    let peak = -1e9, tr = [], vmin = 1e9, vmax = -1e9, clearance = 1e9;
    for (let t = t0; t <= t0 + p.tc; t += 1e-4) { const g = f(t); peak = Math.max(peak, knee(g)); tr.push(Math.atan2(g.shoulder[0] - g.hip[0], g.shoulder[1] - g.hip[1]) * R2D); }
    for (let t = t0; t < t0 + p.T; t += 1e-4) { const g = f(t); vmin = Math.min(vmin, g.hip[1]); vmax = Math.max(vmax, g.hip[1]); if (!g.contact) clearance = Math.min(clearance, g.heelC[1], g.mtC[1]); }
    return { p, clearance, contactTime: p.tc * 1000, strideTime: p.T * 1000, cadence: 120 / p.T, dutyFactor: 100 * p.tc / p.T, strideLength: p.v * p.T,
      footAngle: p.phiIC, shankAngle: Math.atan2(ic.ankle[0] - ic.knee[0], ic.knee[1] - ic.ankle[1]) * R2D, overstride: (ic.ankle[0] - ic.hip[0]) * 100,
      kneeIC: knee(ic), kneePeak: peak, kneeExc: peak - knee(ic), thighTO: Math.atan2(to.hip[0] - to.knee[0], to.hip[1] - to.knee[1]) * R2D,
      trunk: mean(tr), vertOsc: (vmax - vmin) * 100 };
  }
  return { opts, W, H: Hh, drawSide, drawRear, imgPos, calib, truth, PARAMS, REAR, sideFigure };
})();

/* ---------- frame sources ---------- */
function demoSource(v) {
  return { kind: 'demo', w: Synth.W, h: Synth.H, duration: 8,
    draw: async (i, ctx) => { const t = i / S.views[v].capFps; if (v === 'rear') Synth.drawRear(ctx, t); else Synth.drawSide(ctx, v === 'left' ? 'L' : 'R', t); } };
}
async function videoSource(v, file) {
  const vid = document.createElement('video'); vid.muted = true; vid.playsInline = true; vid.preload = 'auto';
  vid.src = URL.createObjectURL(file);
  await new Promise((res, rej) => { vid.onloadeddata = res; vid.onerror = () => rej(new Error('This browser could not open the video. Try MP4 (H.264).')); });
  const st = S.views[v];
  return { kind: 'video', vid, w: vid.videoWidth, h: vid.videoHeight, duration: vid.duration,
    draw: async (i, ctx) => {
      const t = (i + 0.5) / st.fileFps;
      if (Math.abs(vid.currentTime - t) > 0.2 / st.fileFps) await new Promise(r => { const done = () => { vid.removeEventListener('seeked', done); r(); }; vid.addEventListener('seeked', done); vid.currentTime = t; });
      ctx.drawImage(vid, 0, 0);
    } };
}

/* ---------- tracking core ---------- */
function findMarker(ctx, pred, R, minContrast) {
  const x0 = Math.max(0, Math.round(pred[0] - R)), y0 = Math.max(0, Math.round(pred[1] - R));
  const x1 = Math.min(ctx.canvas.width, Math.round(pred[0] + R) + 1), y1 = Math.min(ctx.canvas.height, Math.round(pred[1] + R) + 1);
  const w = x1 - x0, h = y1 - y0; if (w < 3 || h < 3) return null;
  const d = ctx.getImageData(x0, y0, w, h).data, L = new Float32Array(w * h);
  let best = -1, bi = -1, sum = 0;
  for (let i = 0; i < w * h; i++) { const l = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]; L[i] = l; sum += l;
    const px = x0 + i % w, py = y0 + (i / w | 0), dist = Math.hypot(px - pred[0], py - pred[1]); if (dist > R) continue;
    const sc = l * (1 - 0.35 * dist / R); if (sc > best) { best = sc; bi = i; } }
  if (bi < 0) return null;
  const sorted = Array.from(L).sort((a, b) => a - b), bg = sorted[Math.floor(sorted.length * 0.3)], peak = L[bi];
  if (peak - bg < minContrast) return null;
  const thr = bg + 0.5 * (peak - bg), bx = bi % w, by = bi / w | 0, rb = Math.max(3, R * 0.45);
  let sw = 0, sx = 0, sy = 0;
  for (let yy = Math.max(0, Math.floor(by - rb)); yy <= Math.min(h - 1, Math.ceil(by + rb)); yy++)
    for (let xx = Math.max(0, Math.floor(bx - rb)); xx <= Math.min(w - 1, Math.ceil(bx + rb)); xx++) {
      if ((xx - bx) ** 2 + (yy - by) ** 2 > rb * rb) continue; const l = L[yy * w + xx]; if (l <= thr) continue; const wt = l - thr; sw += wt; sx += wt * xx; sy += wt * yy; }
  return sw ? [x0 + sx / sw + 0.5, y0 + sy / sw + 0.5] : null;
}

/* ---------- events core ---------- */
function runs(bool, a, b, minLen, mergeGap) {
  const out = []; let i = a;
  while (i <= b) { if (!bool[i]) { i++; continue; } const s = i; while (i <= b && bool[i]) i++; out.push([s, i - 1]); }
  const merged = []; for (const r of out) { const p = merged[merged.length - 1]; if (p && r[0] - p[1] - 1 <= mergeGap) p[1] = r[1]; else merged.push([...r]); }
  return merged.filter(r => r[1] - r[0] + 1 >= minLen);
}
function sideDirection(st) { const h = series(st, 'heel', false), t = series(st, 'toe', false), d = []; for (let i = st.range[0]; i <= st.range[1]; i++) d.push(t.X[i] - h.X[i]); return Math.sign(median(d)) || 1; }
function detectEvents(v) {
  const st = S.views[v], set = settings(); if (!calibOK(st)) { ui.status('Calibrate this view first.', 'warn'); return; }
  const [a, b] = st.range, fps = st.capFps, minC = Math.round((st.type === 'side' ? 0.08 : 0.04) * fps), gap = Math.max(1, Math.round(0.01 * fps));
  if (st.type === 'side') {
    const H = series(st, 'heel', false), T = series(st, 'toe', false), dir = sideDirection(st);
    const bh = pct(Array.from(H.Y.slice(a, b + 1)), 5), bt = pct(Array.from(T.Y.slice(a, b + 1)), 5);
    const c = new Array(st.nFrames).fill(false); for (let i = a; i <= b; i++) c[i] = H.Y[i] < bh + set.tol || T.Y[i] < bt + set.tol;
    const Tf = { X: filterSegments(T.X, 25, fps) }, vb = speedMS();
    const IC = [], TO = [], Ty = filterSegments(T.Y, 25, fps);
    for (const [s0, e] of runs(c, a, b, minC, gap)) {
      if (s0 === a || e >= b) continue;
      // contact: step forward while the triggering marker is still descending
      let s = s0; const trig = H.Y[s0] < bh + set.tol ? H.Y : T.Y;
      for (let k = 0; k < 3 && trig[s + 1] < trig[s] - 0.0005; k++) s++;
      // toe-off: toe rises off its stance plateau, then step back to where the rise began
      let pl = Infinity; for (let i = s; i <= e; i++) if (Ty[i] < pl) pl = Ty[i];
      let to = e + 1;
      for (let i = s + minC; i <= e + 1; i++) if (Ty[i] > pl + set.tol) { to = i; break; }
      while (to > s + minC && Ty[to - 1] > pl + 0.1 * set.tol) to--;
      if (vb > 0) for (let i = s + minC; i < to; i++) { const vx = (Tf.X[i + 1] - Tf.X[i - 1]) * dir * fps / 2; if (vx > -0.5 * vb) { to = i; break; } }
      IC.push(s); TO.push(to);
    }
    st.ev = { IC, TO };
  } else {
    const out = {};
    for (const [k, id] of [['L', 'lHeel'], ['R', 'rHeel']]) {
      const H = series(st, id, false), bh = pct(Array.from(H.Y.slice(a, b + 1)), 5), c = new Array(st.nFrames).fill(false);
      for (let i = a; i <= b; i++) c[i] = H.Y[i] < bh + set.tol;
      out[k] = runs(c, a, b, minC, gap).filter(r => r[0] !== a).map(r => { let s = r[0]; for (let j = 0; j < 3 && H.Y[s + 1] < H.Y[s] - 0.0005; j++) s++; return s; });
    }
    st.ev = out;
  }
  st.selEv = null; st.res = null;
  const n = st.type === 'side' ? `${st.ev.IC.length} contacts, ${st.ev.TO.length} toe-offs` : `${st.ev.L.length} left and ${st.ev.R.length} right contacts`;
  ui.status(`${VIEWS[v].label}: ${n} detected. Check each event frame by frame.`); ui.refresh();
}


/* ---------- metrics ---------- */
function summarise(rows, ids) { const o = {}; for (const id of ids) { const a = rows.map(r => r[id]); o[id] = { mean: mean(a), sd: sd(a), n: fin(a).length }; } return o; }
function computeSide(v) {
  const st = S.views[v], fps = st.capFps, g = id => series(st, id, true);
  const Hp = g('hip'), K = g('knee'), A = g('ankle'), He = g('heel'), T = g('toe'), Sh = g('shoulder'), dir = sideDirection(st), vb = speedMS();
  const fcFoot = Math.max(settings().cutoff, 25), He2 = series(st, 'heel', true, fcFoot), T2 = series(st, 'toe', true, fcFoot);
  const IC = [...st.ev.IC].sort((x, y) => x - y), TO = [...st.ev.TO].sort((x, y) => x - y), rows = [];
  const knee = i => 180 - inclAngle(P(Hp, i), P(K, i), P(A, i));
  const ang = (dx, dy) => Math.atan2(dx * dir, dy) * R2D;
  for (let i = 0; i < IC.length - 1; i++) {
    const a = IC[i], b = IC[i + 1], to = TO.find(t => t > a && t < b), r = { view: v, stride: i + 1, ic: a, to: to ?? NaN, next: b };
    const sT = (b - a) / fps; r.strideTime = sT * 1000; r.cadence = 120 / sT; r.strideLength = vb > 0 ? vb * sT : NaN;
    if (to !== undefined) { r.contactTime = (to - a) / fps * 1000; r.dutyFactor = 100 * r.contactTime / r.strideTime; }
    r.footAngle = Math.atan2(T2.Y[a] - He2.Y[a], (T2.X[a] - He2.X[a]) * dir) * R2D - (st.standing ? st.standing.foot : 0);
    r.shankAngle = ang(A.X[a] - K.X[a], K.Y[a] - A.Y[a]);
    r.overstride = (A.X[a] - Hp.X[a]) * dir * 100;
    r.kneeIC = knee(a);
    if (to !== undefined) {
      let pk = -Infinity, pf = NaN; for (let f = a; f <= to; f++) { const kf = knee(f); if (kf > pk) { pk = kf; pf = f; } }
      r.kneePeak = Number.isFinite(pk) ? pk : NaN; r.kneePeakFrame = pf; r.kneeExc = r.kneePeak - r.kneeIC;
      r.thighTO = ang(Hp.X[to] - K.X[to], Hp.Y[to] - K.Y[to]);
      const tl = []; for (let f = a; f <= to; f++) tl.push(ang(Sh.X[f] - Hp.X[f], Sh.Y[f] - Hp.Y[f])); r.trunk = mean(tl);
    }
    let lo = Infinity, hi = -Infinity, ok = true; for (let f = a; f <= b; f++) { if (!Number.isFinite(Hp.Y[f])) { ok = false; break; } lo = Math.min(lo, Hp.Y[f]); hi = Math.max(hi, Hp.Y[f]); }
    r.vertOsc = ok ? (hi - lo) * 100 : NaN;
    // exclude stride if any marker missing inside it
    for (const s of [Hp, K, A, He, T, Sh]) for (let f = a; f <= b; f++) if (!Number.isFinite(s.X[f])) { r.excluded = 'tracking gap'; break; }
    if (r.excluded) for (const m of METRICS_SIDE) if (!['strideTime', 'cadence', 'strideLength', 'contactTime', 'dutyFactor'].includes(m.id)) r[m.id] = NaN;
    rows.push(r);
  }
  const sum = summarise(rows.filter(r => !r.excluded || true), METRICS_SIDE.map(m => m.id));
  let strike = null;
  if (st.standing && Number.isFinite(sum.footAngle.mean)) { const fa = sum.footAngle.mean; strike = fa > 8 ? 'Rearfoot' : fa >= -1.6 ? 'Midfoot' : 'Forefoot'; }
  return { rows, sum, strike, dir, n: rows.length, excluded: rows.filter(r => r.excluded).length, standing: st.standing };
}
function computeRear() {
  const st = S.views.rear, fps = st.capFps, g = id => series(st, id, true);
  const lP = g('lPSIS'), rP = g('rPSIS'), lT = g('lThigh'), rT = g('rThigh'), lK = g('lKnee'), rK = g('rKnee'), lH = series(st, 'lHeel', false), rH = series(st, 'rHeel', false);
  const ct = {}, warn = [];
  for (const [s, v] of [['L', 'left'], ['R', 'right']]) { const r = S.views[v].res; ct[s] = r && Number.isFinite(r.sum.contactTime.mean) ? r.sum.contactTime.mean / 1000 : NaN;
    if (!Number.isFinite(ct[s])) { ct[s] = 0.25; warn.push(`${s === 'L' ? 'Left' : 'Right'} side view not calculated, so a 0.25 s stance window was assumed.`); } }
  const tilt = i => Math.atan2(rP.Y[i] - lP.Y[i], rP.X[i] - lP.X[i]) * R2D;
  const add = (i, s) => { const ux = rP.X[i] - lP.X[i], uy = rP.Y[i] - lP.Y[i], ul = Math.hypot(ux, uy), n = [uy / ul, -ux / ul];
    const Tm = s === 'L' ? lT : rT, Km = s === 'L' ? lK : rK, fx = Km.X[i] - Tm.X[i], fy = Km.Y[i] - Tm.Y[i], fl = Math.hypot(fx, fy);
    const a = Math.atan2(n[0] * fy / fl - n[1] * fx / fl, n[0] * fx / fl + n[1] * fy / fl) * R2D; return s === 'L' ? a : -a; };
  const rows = [];
  for (const s of ['L', 'R']) {
    const ev = [...st.ev[s]].sort((x, y) => x - y);
    ev.forEach((ic, j) => {
      const end = Math.min(st.nFrames - 1, ic + Math.round(ct[s] * fps)); let pd = -Infinity, pdf = NaN, pa = -Infinity, paf = NaN, gapF = false;
      for (let f = ic; f <= end; f++) { const tl = s === 'R' ? tilt(f) : -tilt(f), ad = add(f, s); if (!Number.isFinite(tl) || !Number.isFinite(ad)) { gapF = true; continue; } if (tl > pd) { pd = tl; pdf = f; } if (ad > pa) { pa = ad; paf = f; } }
      rows.push({ view: 'rear', side: s, stride: j + 1, ic, pelvicDrop: gapF ? NaN : pd, peakFrame: pdf, hipAdd: gapF ? NaN : pa, addFrame: paf, excluded: gapF ? 'tracking gap' : '' });
    });
  }
  const heelX = (H, f) => mean([H.X[f], H.X[f + 1], H.X[f + 2]]);
  const all = [...st.ev.L.map(f => ['L', f]), ...st.ev.R.map(f => ['R', f])].sort((a, b) => a[1] - b[1]), sw = [];
  for (let i = 1; i < all.length; i++) { const [s0, f0] = all[i - 1], [s1, f1] = all[i]; if (s0 === s1) continue; const xl = s0 === 'L' ? heelX(lH, f0) : heelX(lH, f1), xr = s0 === 'R' ? heelX(rH, f0) : heelX(rH, f1); sw.push((xr - xl) * 100); }
  const sum = { L: summarise(rows.filter(r => r.side === 'L'), ['pelvicDrop', 'hipAdd']), R: summarise(rows.filter(r => r.side === 'R'), ['pelvicDrop', 'hipAdd']), stepWidth: { mean: mean(sw), sd: sd(sw), n: fin(sw).length } };
  return { rows, sum, warn, ct };
}
// accuracy targets used by the demo check and the automated tests
const ACCURACY = { ms: 15, 'steps/min': 1, '%': 2, m: 0.03, '°': 2, cm: 1 };
function tolOf(m) { return ACCURACY[m.unit] ?? 1; }
function medianRow(rows, key) { const ok = rows.filter(r => Number.isFinite(r[key]) && !r.excluded); if (!ok.length) return null; const m = median(ok.map(r => r[key])); return ok.reduce((a, b) => Math.abs(b[key] - m) < Math.abs(a[key] - m) ? b : a); }
