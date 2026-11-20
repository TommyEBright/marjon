// Runs the built app on the synthetic demo runner and checks every output against the known true values.
// Fails (exit code 1) if any measure is outside its accuracy target, so a broken update never goes live.
import { chromium } from 'playwright';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
await page.goto('file://' + app);

const out = await page.evaluate(async () => {
  const G = window.GaitApp, rows = [], t0 = performance.now();
  G.loadDemoAll();
  // auto-labelling against the true marker positions on the first frame
  for (const v of ['left', 'right', 'rear']) {
    G.setActive(v); await G.goto(v, 0); await G.autoLabel(v);
    const st = G.S.views[v], truth = G.Synth.imgPos(v, 0);
    const worst = Math.max(...Object.keys(truth).map(k => Math.hypot(st.tr[k].x[0] - truth[k][0], st.tr[k].y[0] - truth[k][1])));
    rows.push({ group: 'Auto-label', name: `${v} (worst marker)`, app: worst, truth: 0, err: worst, tol: 2, unit: 'px' });
  }
  await G.processAll();
  const secs = (performance.now() - t0) / 1000;
  for (const v of ['left', 'right']) {
    const st = G.S.views[v], p = st.truth.p, fps = st.capFps;
    for (const m of METRICS_SIDE) { const a = st.res.sum[m.id].mean, t = st.truth[m.id]; rows.push({ group: `${VIEWS[v].label}`, name: m.label, app: a, truth: t, err: a - t, tol: tolOf(m), unit: m.unit }); }
    for (const [k, off, tol] of [['IC', 0, 5], ['TO', p.tc, 15]]) {
      const e = st.ev[k].map(f => { const tt = f / fps, n = Math.round((tt - p.t0 - off) / p.T); return (tt - (p.t0 + off + n * p.T)) * 1000; });
      rows.push({ group: `${VIEWS[v].label}`, name: k === 'IC' ? 'Initial contact timing (mean)' : 'Toe-off timing (mean)', app: mean(e), truth: 0, err: mean(e), tol, unit: 'ms' });
      rows.push({ group: `${VIEWS[v].label}`, name: k === 'IC' ? 'Contacts detected' : 'Toe-offs detected', app: e.length, truth: 11, err: e.length - 11, tol: 0, unit: 'n' });
    }
  }
  const r = G.S.views.rear.res, t = G.S.views.rear.truth;
  for (const s of ['L', 'R']) for (const id of ['pelvicDrop', 'hipAdd']) { const a = r.sum[s][id].mean, b = t[s][id]; rows.push({ group: 'Rear', name: `${id === 'pelvicDrop' ? 'Pelvic drop' : 'Hip adduction'} (${s})`, app: a, truth: b, err: a - b, tol: 1, unit: '°' }); }
  rows.push({ group: 'Rear', name: 'Step width', app: r.sum.stepWidth.mean, truth: t.stepWidth, err: r.sum.stepWidth.mean - t.stepWidth, tol: 0.5, unit: 'cm' });
  // the report must build
  G.openReport(); await G.buildReport();
  const pages = document.querySelectorAll('#report .rpage').length;
  rows.push({ group: 'Report', name: 'Pages built', app: pages, truth: 4, err: pages - 4, tol: 0, unit: 'n' });
  // ---- reliability statistics ----
  const R = G.Rel;
  // Shrout and Fleiss (1979) Table 2: 6 targets x 4 judges. Published ICC(2,1) = 0.29, ICC(3,1) = 0.71
  const sf = R.icc([[9, 2, 5, 8], [6, 1, 3, 2], [8, 4, 6, 8], [7, 1, 2, 6], [10, 5, 6, 9], [6, 2, 4, 7]]);
  rows.push({ group: 'Reliability', name: 'ICC(2,1) v Shrout & Fleiss', app: sf.icc21, truth: 0.29, err: sf.icc21 - 0.29, tol: 0.005, unit: '' });
  rows.push({ group: 'Reliability', name: 'ICC(3,1) v Shrout & Fleiss', app: sf.icc31, truth: 0.71, err: sf.icc31 - 0.71, tol: 0.005, unit: '' });
  // large synthetic sample with known between-runner SD 5 and within-runner (session) SD 2
  let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }, nrm = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  const A = [], B = []; for (let i = 0; i < 6000; i++) { const tr = 40 + 5 * nrm(); A.push(tr + 2 * nrm()); B.push(tr + 0.5 + 2 * nrm()); }
  const ps = R.pairStats(A, B);
  rows.push({ group: 'Reliability', name: 'SEM recovers true 2.0 (n=6000)', app: ps.sem, truth: 2, err: ps.sem - 2, tol: 0.06, unit: '' });
  rows.push({ group: 'Reliability', name: 'MDC95 recovers true 5.54', app: ps.mdc, truth: 1.96 * Math.SQRT2 * 2, err: ps.mdc - 1.96 * Math.SQRT2 * 2, tol: 0.17, unit: '' });
  rows.push({ group: 'Reliability', name: 'ICC(3,1) recovers true 0.862', app: ps.icc31, truth: 25 / 29, err: ps.icc31 - 25 / 29, tol: 0.01, unit: '' });
  rows.push({ group: 'Reliability', name: 'Bias recovers true 0.5', app: ps.bias, truth: 0.5, err: ps.bias - 0.5, tol: 0.06, unit: '' });
  // end to end: 20 runners, sessions built from this demo session with known perturbations, given out of order,
  // plus one runner with a third session and one with only one session
  const base = JSON.parse(JSON.stringify(G.sessionObject())), sess = [], known = { a: [], b: [] };
  for (let r = 0; r < 20; r++) for (const k of [1, 0]) {
    const o = JSON.parse(JSON.stringify(base)); o.client.cName = `Runner ${String(r + 1).padStart(2, '0')}`; o.client.cDate = k ? '2026-12-08' : '2026-12-01';
    const off = (r - 10) * 0.7, noise = Math.sin(r * 3.1 + k * 1.7) * 1.2; o.views.left.sum.kneeIC.mean += off + noise; (k ? known.b : known.a).push(o.views.left.sum.kneeIC.mean);
    sess.push(o);
  }
  const extra = JSON.parse(JSON.stringify(sess[0])); extra.client.cDate = '2026-12-20'; extra.views.left.sum.kneeIC.mean += 50; sess.push(extra);
  const lone = JSON.parse(JSON.stringify(base)); lone.client.cName = 'Single Session'; sess.push(lone);
  const res = G.loadRelSessions(sess), row = res.rows.find(x => x.id === 'kneeIC' && x.side === 'L'), direct = R.pairStats(known.a, known.b);
  rows.push({ group: 'Reliability', name: 'Runners paired (of 20)', app: res.pairs, truth: 20, err: res.pairs - 20, tol: 0, unit: 'n' });
  rows.push({ group: 'Reliability', name: 'Measures analysed', app: res.rows.length, truth: 33, err: res.rows.length - 33, tol: 0, unit: 'n' });
  rows.push({ group: 'Reliability', name: 'Pairing and ordering (SEM match)', app: row.sem, truth: direct.sem, err: row.sem - direct.sem, tol: 1e-9, unit: '' });
  rows.push({ group: 'Reliability', name: 'Bootstrap CI brackets ICC', app: +(row.iccLo <= row.icc21 && row.icc21 <= row.iccHi), truth: 1, err: +(row.iccLo <= row.icc21 && row.icc21 <= row.iccHi) - 1, tol: 0, unit: '' });
  rows.push({ group: 'Reliability', name: 'Unchanged measures give SEM 0', app: res.rows.find(x => x.id === 'cadence' && x.side === 'L').sem, truth: 0, err: res.rows.find(x => x.id === 'cadence' && x.side === 'L').sem, tol: 1e-9, unit: '' });
  return { rows, secs };
});
await browser.close();

const fmt = x => Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)) : 'NaN';
let failed = 0, md = `## Marjon Gait validation\n\nDemo runner processed in ${out.secs.toFixed(1)} s.\n\n| | Measure | App | True | Error | Target | |\n|---|---|---:|---:|---:|---:|---|\n`;
for (const r of out.rows) {
  const ok = Number.isFinite(r.err) && Math.abs(r.err) <= r.tol + 1e-9; if (!ok) failed++;
  md += `| ${r.group} | ${r.name} | ${fmt(r.app)} | ${fmt(r.truth)} | ${fmt(r.err)} ${r.unit} | ±${r.tol} | ${ok ? 'pass' : '**FAIL**'} |\n`;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${r.group.padEnd(11)} ${r.name.padEnd(36)} err ${fmt(r.err).padStart(7)} ${r.unit} (±${r.tol})`);
}
if (pageErrors.length) { failed++; md += `\nPage errors:\n${pageErrors.map(e => `- ${e}`).join('\n')}\n`; console.log('Page errors:', pageErrors); }
md += `\n**${failed ? `${failed} check(s) failed` : 'All checks passed'}**\n`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
