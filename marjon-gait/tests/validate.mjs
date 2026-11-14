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
