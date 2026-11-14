import { parseBankCsv } from './analyze.js';

const E = globalThis.SubGuardExtract;
const $ = (id) => document.getElementById(id);
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const stamp = () => new Date().toISOString().slice(0, 10);
const say = (t) => { $('msg').textContent = t; };

function td(text, cls) {
  const e = document.createElement('td');
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function readSnapshot(sn) {
  const doc = new DOMParser().parseFromString(sn.html, 'text/html');
  return E.extractRows(doc).map((r) => ({ ...r, account: sn.account }));
}

let txns = [];

function fillSelect(sel, values) {
  const cur = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  for (const v of values) sel.add(new Option(v, v));
  sel.value = values.includes(cur) ? cur : '';
}

function renderTxns() {
  const acc = $('fAccount').value, month = $('fMonth').value, q = $('fText').value.trim().toLowerCase();
  const list = txns
    .filter((t) => (!acc || t.account === acc) && (!month || t.date.startsWith(month)) && (!q || t.desc.toLowerCase().includes(q)))
    .slice()
    .reverse();
  const tbody = $('rows');
  tbody.textContent = '';
  for (const t of list) {
    const tr = document.createElement('tr');
    tr.append(td(t.date, 'date'), td(t.desc), td(money(t.amount), 'num'), td(t.account));
    tbody.appendChild(tr);
  }
  const sum = list.reduce((a, t) => a + t.amount, 0);
  $('count').textContent = `${list.length} of ${txns.length} transactions · total ${money(sum)}`;
}

async function renderSources() {
  const { snapshots = [], csvImports = [] } = await chrome.storage.local.get(['snapshots', 'csvImports']);
  const tbody = $('sources');
  tbody.textContent = '';
  const items = [
    ...snapshots.map((s) => ({ kind: 'page', id: s.id, at: s.at, label: s.account, size: s.html.length, rows: () => readSnapshot(s).length })),
    ...csvImports.map((c) => ({ kind: 'csv', id: c.id, at: c.at, label: c.name, size: JSON.stringify(c.rows).length, rows: () => c.rows.length })),
  ].sort((a, b) => b.at - a.at);
  for (const it of items) {
    const tr = document.createElement('tr');
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = async () => { await chrome.runtime.sendMessage({ type: 'delete-source', kind: it.kind, id: it.id }); renderSources(); };
    const cell = document.createElement('td');
    cell.appendChild(del);
    tr.append(td(new Date(it.at).toLocaleString(), 'date'), td(it.kind === 'page' ? 'Saved page' : 'CSV'), td(it.label),
      td(`${Math.round(it.size / 1024)} KB`, 'num'), td(String(it.rows()), 'num'), cell);
    tbody.appendChild(tr);
  }
  if (!items.length) {
    const tr = document.createElement('tr');
    const c = td('Nothing saved yet. Run a scan or import a CSV.', 'muted');
    c.colSpan = 6;
    tr.appendChild(c);
    tbody.appendChild(tr);
  }
}

async function render() {
  ({ txns = [] } = await chrome.storage.local.get('txns'));
  fillSelect($('fAccount'), [...new Set(txns.map((t) => t.account).filter(Boolean))].sort());
  fillSelect($('fMonth'), [...new Set(txns.map((t) => t.date.slice(0, 7)))].sort().reverse());
  renderTxns();
  renderSources();
}

$('fAccount').onchange = renderTxns;
$('fMonth').onchange = renderTxns;
$('fText').oninput = renderTxns;

$('rebuild').onclick = async () => {
  const { snapshots = [], csvImports = [] } = await chrome.storage.local.get(['snapshots', 'csvImports']);
  if (!snapshots.length && !csvImports.length) { say('Nothing saved to rebuild from yet. Run a scan first.'); return; }
  if (!confirm('Replace all transactions with what the current code reads from the saved pages and CSV imports?')) return;
  const rows = snapshots.flatMap(readSnapshot).concat(csvImports.flatMap((c) => c.rows));
  const res = await chrome.runtime.sendMessage({ type: 'replace-rows', rows });
  say(`Rebuilt from ${snapshots.length} saved pages and ${csvImports.length} CSV files: ${res.total} transactions, ${res.subs} subscriptions.`);
};

$('importBtn').onclick = () => $('csv').click();
$('csv').onchange = async (e) => {
  let total = 0, added = 0;
  for (const f of e.target.files) {
    const rows = parseBankCsv(await f.text(), f.name.replace(/\.csv$/i, ''));
    if (!rows.length) { say(`${f.name}: no Date / Description / Amount columns found.`); continue; }
    await chrome.runtime.sendMessage({ type: 'save-csv-import', name: f.name, rows });
    const res = await chrome.runtime.sendMessage({ type: 'add-rows', rows, source: 'csv' });
    total += rows.length;
    added += res.added;
  }
  if (total) say(`Imported ${total} rows (${added} new).`);
  e.target.value = '';
};

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

$('exportTxns').onclick = () => {
  const lines = ['date,description,amount,account']
    .concat(txns.map((t) => [t.date, t.desc, t.amount.toFixed(2), t.account].map(csvCell).join(',')));
  download(`sub-guard-transactions-${stamp()}.csv`, lines.join('\n'), 'text/csv');
  say(`Exported ${txns.length} transactions.`);
};

$('exportDebug').onclick = async () => {
  const { debugLog = [], snapshots = [], subs = [], lastScanAt } = await chrome.storage.local.get(['debugLog', 'snapshots', 'subs', 'lastScanAt']);
  const info = {
    exportedAt: new Date().toISOString(),
    version: chrome.runtime.getManifest().version,
    transactionCount: txns.length,
    subscriptionCount: subs.length,
    lastScanAt: lastScanAt ? new Date(lastScanAt).toISOString() : null,
    scanLog: debugLog,
    // Layout of each saved page with all text masked (letters → a, digits → 9).
    savedPages: snapshots.map((s) => {
      const doc = new DOMParser().parseFromString(s.html, 'text/html');
      return { at: new Date(s.at).toISOString(), path: s.path, rowsFound: E.extractRows(doc).length, skeleton: E.skeleton(doc) };
    }),
  };
  download(`sub-guard-debug-${stamp()}.json`, JSON.stringify(info, null, 2), 'application/json');
  say(`Exported debug info: ${debugLog.length} scan steps, ${snapshots.length} saved pages (text masked).`);
};

$('clear').onclick = async () => {
  if (!confirm('Delete all stored transactions, saved pages and settings?')) return;
  await chrome.runtime.sendMessage({ type: 'clear-data' });
};

chrome.storage.onChanged.addListener(() => render());
render();
