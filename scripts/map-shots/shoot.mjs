// path: scripts/map-shots/shoot.mjs
// shots.html-এর স্ক্রিনশট নেয় (GitHub Actions: .github/workflows/map-shots.yml)।
// চালাতে: MS_DIR=<playwright+maplibre-gl+@fontsource/hind-siliguri ইনস্টল করা ফোল্ডার> node scripts/map-shots/shoot.mjs [mode ...]
// আউটপুট: scripts/map-shots/out/<mode>.png (১০৮০×১৯২০)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const MS_DIR = process.env.MS_DIR;
if (!MS_DIR) { console.error('ERROR: MS_DIR দাও'); process.exit(1); }
const req = createRequire(path.join(MS_DIR, 'noop.js'));
let pw;
try { pw = req('playwright'); } catch (e) { pw = req('playwright-core'); }

const MODES = process.argv.slice(2).length ? process.argv.slice(2) : ['osm', 'sf'];
const OUT = path.join(ROOT, 'scripts/map-shots/out');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((rq, rs) => {
  const u = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const file = u.startsWith('/nm/') ? path.join(MS_DIR, 'node_modules', u.slice(4)) : path.join(ROOT, u);
  fs.readFile(file, (err, buf) => {
    if (err) { rs.writeHead(404); rs.end('404'); return; }
    rs.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    rs.end(buf);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await pw.chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = false;
for (const mode of MODES) {
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[' + mode + '] console:', m.text()); });
  page.on('pageerror', (e) => console.log('[' + mode + '] pageerror:', e.message));
  await page.goto('http://127.0.0.1:' + port + '/scripts/map-shots/shots.html?mode=' + mode);
  const state = await page.waitForFunction(() => window.__ready, null, { timeout: 70000 }).then((h) => h.jsonValue()).catch(() => 'fail');
  const file = path.join(OUT, mode + '.png');
  await page.screenshot({ path: file });
  console.log('OK:', mode, state, file);
  if (state === 'fail') failed = true;
  await page.close();
}
await browser.close();
server.close();
if (failed) process.exit(1);
