// Bundles src/ into one self-contained dist/index.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const read = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const logo = 'data:image/png;base64,' + readFileSync(new URL('../src/assets/logo_white.png', import.meta.url)).toString('base64');
const js = ['core.js', 'ui.js', 'report.js'].map(read).join('\n');

const html = read('index.html')
  .replace('/*CSS*/', () => read('styles.css'))
  .replace('/*JS*/', () => js)
  .replace('__LOGO_WHITE__', logo)
  .replaceAll('__VERSION__', version);

mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/index.html', import.meta.url), html);
console.log(`Built dist/index.html (v${version}, ${Math.round(html.length / 1024)} KB)`);
