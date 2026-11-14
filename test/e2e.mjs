// End-to-end check: loads the real extension in Chromium, serves test/fixture-activity.html as bankofamerica.com,
// runs a scan, then checks saved pages, Rebuild, Report and Details.
// Run: PLAYWRIGHT=/path/to/node_modules/playwright node test/e2e.mjs
import { createRequire } from 'module';
import { readFileSync, mkdtempSync } from 'fs';
import { createServer } from 'https';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The fixture page without its chrome.* stub and direct content.js include: the real extension provides those.
const fixture = readFileSync(join(root, 'test/fixture-activity.html'), 'utf8')
  .replace(/\s*window\.__messages[\s\S]*?(?=<\/script>)/, '\n')
  .replace('<script src="../content.js"></script>', '');

const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok  ', msg); };

// Local HTTPS server standing in for bankofamerica.com. The browser maps every *.bankofamerica.com name to it,
// so the test can never reach the real site (Playwright's route() doesn't cover tabs the extension opens).
const tmp = mkdtempSync(join(tmpdir(), 'sg-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
  '-keyout', join(tmp, 'key.pem'), '-out', join(tmp, 'cert.pem')], { stdio: 'ignore' });
const server = createServer({ key: readFileSync(join(tmp, 'key.pem')), cert: readFileSync(join(tmp, 'cert.pem')) },
  (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const ctx = await chromium.launchPersistentContext(join(tmp, 'profile'), {
  channel: 'chromium',
  headless: true,
  ignoreHTTPSErrors: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--ignore-certificate-errors',
    `--host-resolver-rules=MAP *.bankofamerica.com 127.0.0.1:${port}, MAP bankofamerica.com 127.0.0.1:${port}`],
});
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extUrl = (p) => new URL(p, sw.url()).href;

  // 1. Scan: start-flow from an extension page, wait for the results tab the flow opens at the end.
  const popup = await ctx.newPage();
  await popup.goto(extUrl('popup.html'));
  const resultsOpened = ctx.waitForEvent('page', { predicate: (p) => p.url().includes('results.html'), timeout: 30000 });
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'start-flow' }));
  const report = await resultsOpened.catch(async (e) => {
    // Show where the scan got stuck.
    const st = await popup.evaluate(() => chrome.storage.local.get(['flow', 'debugLog', 'txns', 'snapshots']));
    console.error('pages:', ctx.pages().map((p) => p.url()));
    console.error('flow:', JSON.stringify(st.flow));
    console.error('log:', (st.debugLog || []).map((x) => `${x.kind} ${x.path} rows=${x.rowsFound}`));
    console.error('txns:', (st.txns || []).length, 'snapshots:', (st.snapshots || []).length);
    throw e;
  });
  await report.waitForSelector('#rows tr');
  const merchants = await report.$$eval('#rows tr td:first-child', (tds) => tds.map((t) => t.textContent));
  ok(merchants.some((m) => m.startsWith('CURSOR')) && merchants.some((m) => m.startsWith('OPENAI')), `report lists subscriptions: ${merchants.join(', ')}`);

  // 2. Saved pages exist and Details shows every transaction from all 3 periods.
  const details = await ctx.newPage();
  details.on('dialog', (d) => d.accept());
  await details.goto(extUrl('details.html'));
  await details.waitForSelector('#sources tr td');
  const store = await details.evaluate(() => chrome.storage.local.get(['snapshots', 'txns']));
  ok(store.snapshots.length === 3, `saved ${store.snapshots.length} page snapshots (one per period)`);
  ok(store.snapshots.every((s) => !/<script|<input/i.test(s.html)), 'snapshots contain no scripts or form fields');
  ok(store.txns.length === 9, `stored ${store.txns.length} transactions`);
  ok((await details.textContent('#count')).startsWith('9 of 9'), 'details page lists all transactions');

  // 3. Rebuild: wipe transactions, rebuild from saved pages only, get the same result.
  await details.evaluate(() => chrome.storage.local.set({ txns: [], subs: [] }));
  await details.click('#rebuild');
  await details.waitForFunction(() => document.getElementById('msg').textContent.startsWith('Rebuilt'));
  const after = await details.evaluate(() => chrome.storage.local.get(['txns', 'subs']));
  ok(after.txns.length === 9 && after.subs.length === 2, `rebuild restored ${after.txns.length} transactions, ${after.subs.length} subscriptions`);

  // 4. Filters.
  await details.selectOption('#fMonth', '2026-10');
  ok((await details.textContent('#count')).startsWith('3 of 9'), 'month filter works');
} finally {
  await ctx.close();
  server.close();
}
