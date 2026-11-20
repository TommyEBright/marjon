/* ======================= reliability study ======================= */
// Test-retest reliability from paired session files: bias, ICC, SEM and MDC95 for every measure.
const RELKEY = 'marjonGait.mdcSource.v1';
const Rel = (() => {
  // ICC from an n x k matrix (rows = runners, columns = sessions), two-way ANOVA (Shrout and Fleiss 1979; McGraw and Wong 1996)
  function icc(X) {
    const n = X.length, k = X[0].length; if (n < 2) return { icc21: NaN, icc31: NaN };
    const gm = X.flat().reduce((s, x) => s + x, 0) / (n * k);
    const rm = X.map(r => r.reduce((s, x) => s + x, 0) / k), cm = Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[j], 0) / n);
    const sst = X.flat().reduce((s, x) => s + (x - gm) ** 2, 0), ssr = k * rm.reduce((s, x) => s + (x - gm) ** 2, 0), ssc = n * cm.reduce((s, x) => s + (x - gm) ** 2, 0);
    const msr = ssr / (n - 1), msc = ssc / (k - 1), mse = (sst - ssr - ssc) / ((n - 1) * (k - 1));
    return { icc21: (msr - mse) / (msr + (k - 1) * mse + k * (msc - mse) / n), icc31: (msr - mse) / (msr + (k - 1) * mse), msr, msc, mse };
  }
  const T975 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  const tcrit = df => df <= 30 ? T975[df] : 1.96 + 2.5 / df;
  // paired statistics for one measure
  const RATIO = ['contactTime', 'strideTime', 'cadence', 'dutyFactor', 'strideLength', 'vertOsc'];
  function pairStats(a, b, ratio = true) {
    const n = a.length, d = a.map((x, i) => b[i] - x), md = mean(d), sdd = sd(d);
    const sem = sdd / Math.SQRT2, gm = mean([...a, ...b]), I = icc(a.map((x, i) => [x, b[i]]));
    const allPos = ratio && [...a, ...b].every(x => x > 0);
    return { n, m1: mean(a), m2: mean(b), bias: md, biasLo: md - tcrit(n - 1) * sdd / Math.sqrt(n), biasHi: md + tcrit(n - 1) * sdd / Math.sqrt(n),
      sem, semPct: allPos ? 100 * sem / gm : NaN, mdc: 1.96 * Math.SQRT2 * sem, icc21: I.icc21, icc31: I.icc31 };
  }
  // percentile bootstrap over runners (seeded, so results are reproducible)
  function bootstrap(a, b, reps = 2000, seed = 20261115) {
    let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const n = a.length, ic = [], se = [];
    for (let r = 0; r < reps; r++) { const A = [], B = []; for (let i = 0; i < n; i++) { const j = Math.floor(rnd() * n); A.push(a[j]); B.push(b[j]); }
      const v = icc(A.map((x, i) => [x, B[i]])).icc21; if (Number.isFinite(v)) ic.push(v); se.push(sd(B.map((x, i) => x - A[i])) / Math.SQRT2); }
    return { iccLo: pct(ic, 2.5), iccHi: pct(ic, 97.5), semLo: pct(se, 2.5), semHi: pct(se, 97.5) };
  }
  function measures() {
    const out = [];
    for (const m of METRICS_SIDE) for (const [v, side] of [['left', 'L'], ['right', 'R']]) out.push({ id: m.id, label: m.label, unit: m.unit, d: m.d, side, get: o => o.views[v]?.sum?.[m.id]?.mean });
    for (const m of METRICS_REAR) for (const side of ['L', 'R']) out.push({ id: m.id, label: m.label.replace(' (peak in stance)', ''), unit: m.unit, d: m.d, side, get: o => o.views.rear?.sum?.[side]?.[m.id]?.mean });
    out.push({ id: 'stepWidth', label: 'Step width', unit: 'cm', d: 1, side: '–', get: o => o.views.rear?.sum?.stepWidth?.mean });
    return out;
  }
  // group sessions by client name, order by date, keep the first two
  function pairUp(sessions) {
    const by = new Map(), warn = [];
    for (const o of sessions) { const nm = (o.client?.cName || o._file || '').trim(); if (!nm) { warn.push(`${o._file || 'A file'} has no client name and was skipped.`); continue; }
      const k = nm.toLowerCase(); if (!by.has(k)) by.set(k, { name: nm, list: [] }); by.get(k).list.push(o); }
    const runners = [];
    for (const { name, list } of by.values()) {
      list.sort((x, y) => String(x.client?.cDate || x.saved).localeCompare(String(y.client?.cDate || y.saved)));
      const r = { name, n: list.length, s1: list[0], s2: list[1] || null, note: '' };
      if (list.length > 2) r.note = `${list.length} sessions; first two used`;
      if (r.s2) { const sp = o => `${o.client?.speed} ${o.client?.speedUnit}`; if (sp(r.s1) !== sp(r.s2)) r.note = (r.note ? r.note + '; ' : '') + `speed differs (${sp(r.s1)} v ${sp(r.s2)})`; }
      runners.push(r);
    }
    return { runners: runners.sort((a, b) => a.name.localeCompare(b.name)), warn };
  }
  function analyse(sessions, reps = 2000) {
    const { runners, warn } = pairUp(sessions), pairs = runners.filter(r => r.s2), rows = [];
    for (const m of measures()) {
      const a = [], b = []; for (const r of pairs) { const x = m.get(r.s1), y = m.get(r.s2); if (Number.isFinite(x) && Number.isFinite(y)) { a.push(x); b.push(y); } }
      if (a.length < 3) { rows.push({ ...m, n: a.length }); continue; }
      rows.push({ ...m, ...pairStats(a, b, RATIO.includes(m.id)), ...(reps ? bootstrap(a, b, reps) : {}) });
    }
    const mdc = {}; for (const r of rows) if (Number.isFinite(r.mdc)) mdc[r.id] = Math.max(mdc[r.id] || 0, r.mdc);
    return { runners, pairs: pairs.length, warn, rows, mdc };
  }
  return { icc, pairStats, bootstrap, analyse, measures };
})();

/* ---------- UI ---------- */
let relFiles = [], relResult = null;
const relFmt = (x, d) => Number.isFinite(x) ? fmt(x, d) : '–';
function renderRel() {
  const R = relResult, sum = $('#relSummary'), tab = $('#relTable');
  $('#relUse').disabled = !R || !Object.keys(R.mdc).length; $('#relCSV').disabled = !R;
  if (!R) { sum.innerHTML = relFiles.length ? '' : '<div class="dim small">No files loaded.</div>'; tab.innerHTML = ''; return; }
  const unpaired = R.runners.filter(r => !r.s2), notes = R.runners.filter(r => r.note);
  sum.innerHTML = `<div class="relsum"><b>${relFiles.length}</b> files · <b>${R.pairs}</b> runners with two sessions${unpaired.length ? ` · <span class="warn">${unpaired.length} with only one (${unpaired.map(r => esc(r.name)).join(', ')})</span>` : ''}</div>
    ${R.pairs < 10 ? `<div class="warn small">Fewer than 10 runners: estimates will be imprecise. Aim for 15–20.</div>` : ''}
    ${[...R.warn, ...notes.map(r => `${esc(r.name)}: ${r.note}`)].map(w => `<div class="warn small">${w}</div>`).join('')}`;
  const icCls = v => !Number.isFinite(v) ? '' : v >= 0.9 ? 'ex' : v >= 0.75 ? 'gd' : v >= 0.5 ? 'md' : 'pr';
  tab.innerHTML = `<table class="grid rel"><tr><th>Measure</th><th>Side</th><th class="n">n</th><th class="n">MDC95</th><th class="n">ICC(2,1) (95% CI)</th><th class="n">SEM (95% CI)</th><th class="n">SEM %</th><th class="n">Bias (95% CI)</th><th class="n">S1 mean</th><th class="n">S2 mean</th></tr>
    ${R.rows.map(r => r.n < 3 ? `<tr><td>${r.label} <span class="dim">${r.unit}</span></td><td>${r.side}</td><td class="n">${r.n}</td><td class="n dim" colspan="7" style="text-align:left">too few pairs</td></tr>` :
    `<tr><td>${r.label} <span class="dim">${r.unit}</span></td><td>${r.side}</td><td class="n">${r.n}</td><td class="n mdcv">${relFmt(r.mdc, r.d + 1)}</td>
      <td class="n"><span class="icc ${icCls(r.icc21)}">${relFmt(r.icc21, 2)}</span> <span class="dim">(${relFmt(r.iccLo, 2)}, ${relFmt(r.iccHi, 2)})</span></td>
      <td class="n">${relFmt(r.sem, r.d + 1)} <span class="dim">(${relFmt(r.semLo, r.d + 1)}, ${relFmt(r.semHi, r.d + 1)})</span></td><td class="n">${relFmt(r.semPct, 1)}</td>
      <td class="n">${relFmt(r.bias, r.d + 1)} <span class="dim">(${relFmt(r.biasLo, r.d + 1)}, ${relFmt(r.biasHi, r.d + 1)})</span></td><td class="n">${relFmt(r.m1, r.d)}</td><td class="n">${relFmt(r.m2, r.d)}</td></tr>`).join('')}</table>
    <div class="dim small relnote">Bias is session 2 minus session 1. ICC(2,1) is two-way random, absolute agreement, single measures; bands follow Koo and Li (2016): <span class="icc ex">≥0.90 excellent</span> <span class="icc gd">0.75–0.89 good</span> <span class="icc md">0.50–0.74 moderate</span> <span class="icc pr">&lt;0.50 poor</span>. SEM % is given for ratio-scale measures only. SEM = SD of differences / √2. MDC95 = 1.96 × √2 × SEM. Confidence intervals for ICC and SEM are percentile bootstrap (2000 resamples of runners). Where left and right differ, the larger MDC is used in reports.</div>`;
}
async function loadRelFiles(files) {
  const add = [];
  for (const f of files) { try { const o = JSON.parse(await f.text()); if (o.app !== 'marjon-gait') throw new Error('not a session file'); o._file = f.name; add.push(o); } catch (e) { ui.status(`${f.name}: ${e.message}`, 'warn'); } }
  relFiles = [...relFiles, ...add]; relResult = relFiles.length ? Rel.analyse(relFiles) : null; renderRel();
}
function relCSV() {
  if (!relResult) return;
  const cols = ['label', 'unit', 'side', 'n', 'm1', 'm2', 'bias', 'biasLo', 'biasHi', 'icc21', 'iccLo', 'iccHi', 'icc31', 'sem', 'semLo', 'semHi', 'semPct', 'mdc'];
  const head = ['measure', 'unit', 'side', 'n', 'session1_mean', 'session2_mean', 'bias', 'bias_ci_low', 'bias_ci_high', 'icc21', 'icc21_ci_low', 'icc21_ci_high', 'icc31', 'sem', 'sem_ci_low', 'sem_ci_high', 'sem_pct', 'mdc95'];
  const csv = [head.join(','), ...relResult.rows.map(r => cols.map(c => typeof r[c] === 'number' ? (Number.isFinite(r[c]) ? +r[c].toFixed(4) : '') : JSON.stringify(r[c] ?? '')).join(','))].join('\n');
  download(`marjon-gait-reliability-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
}
$('#relLoad').onclick = () => { $('#fRel').value = ''; $('#fRel').click(); };
$('#fRel').onchange = e => loadRelFiles([...e.target.files]);
$('#relClear').onclick = () => { relFiles = []; relResult = null; renderRel(); };
$('#relCSV').onclick = relCSV;
$('#relUse').onclick = () => {
  for (const [id, v] of Object.entries(relResult.mdc)) { const i = document.querySelector(`[data-mdc="${id}"]`); if (i) i.value = +v.toFixed(3); }
  lsSet(RELKEY, { date: new Date().toISOString(), runners: relResult.pairs });
  ui.status(`MDC values filled from the reliability study (${relResult.pairs} runners). Click Done to save them.`, 'ok');
};

window.GaitApp.Rel = Rel; window.GaitApp.AVI = AVI; window.GaitApp.openFile = async (v, f) => { pendingVideo = v; const dt = new DataTransfer(); dt.items.add(f); $('#fVideo').files = dt.files; await $('#fVideo').onchange({ target: $('#fVideo') }); }; window.GaitApp.loadRelSessions = objs => { relFiles = objs; relResult = Rel.analyse(objs); renderRel(); return relResult; };
