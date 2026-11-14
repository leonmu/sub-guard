import { analyze, mergeTransactions, dueSoon, daysBetween } from './analyze.js';

const BOA_START = 'https://www.bankofamerica.com/';
const FLOW_TIMEOUT_MS = 20 * 60 * 1000;

const today = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD

async function get(keys) { return chrome.storage.local.get(keys); }
async function set(obj) { return chrome.storage.local.set(obj); }

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('daily-check', { periodInMinutes: 6 * 60, delayInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('daily-check', { periodInMinutes: 6 * 60, delayInMinutes: 1 });
});

async function recompute() {
  const { txns = [] } = await get('txns');
  const subs = analyze(txns, { today: today() });
  await set({ subs, analyzedAt: Date.now() });
  return subs;
}

async function addRows(rows, source) {
  const { txns = [] } = await get('txns');
  const { all, added } = mergeTransactions(txns, rows);
  await set({ txns: all, lastScanAt: Date.now(), lastScanSource: source });
  const subs = await recompute();
  return { added, total: all.length, subs: subs.length };
}

async function getFlow() {
  const { flow } = await get('flow');
  if (flow?.active && Date.now() - flow.startedAt > FLOW_TIMEOUT_MS) {
    await set({ flow: { active: false } });
    return { active: false };
  }
  return flow || { active: false };
}

async function finishFlow(summary) {
  const flow = await getFlow();
  await set({ flow: { active: false, lastSummary: summary || null } });
  if (flow.active) chrome.tabs.create({ url: chrome.runtime.getURL('results.html?fresh=1') });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'start-flow': {
        const tab = await chrome.tabs.create({ url: BOA_START });
        await set({ flow: { active: true, startedAt: Date.now(), tabId: tab.id, queue: null, scanned: [] } });
        return { ok: true };
      }
      case 'get-flow': {
        const flow = await getFlow();
        // Only drive the tab the flow opened, so other BofA tabs are left alone.
        const mine = flow.active && (!flow.tabId || flow.tabId === sender.tab?.id);
        return mine ? flow : { active: false };
      }
      case 'update-flow': {
        const flow = await getFlow();
        if (!flow.active) return { active: false };
        const next = { ...flow, ...msg.patch };
        await set({ flow: next });
        return next;
      }
      case 'stop-flow':
        await set({ flow: { active: false } });
        return { ok: true };
      case 'finish-flow':
        await finishFlow(msg.summary);
        return { ok: true };
      case 'add-rows':
        return addRows(msg.rows || [], msg.source || 'page');
      case 'recompute':
        return { subs: (await recompute()).length };
      case 'save-snapshots': {
        if (!msg.snaps?.length) return { ok: true };
        const { snapshots = [] } = await get('snapshots');
        const at = Date.now();
        msg.snaps.forEach((sn, i) => snapshots.push({ id: `${at}-${i}`, at, ...sn }));
        await set({ snapshots: snapshots.slice(-60) });
        return { ok: true, saved: msg.snaps.length };
      }
      case 'save-csv-import': {
        const { csvImports = [] } = await get('csvImports');
        csvImports.push({ id: String(Date.now()), at: Date.now(), name: msg.name, rows: msg.rows });
        await set({ csvImports });
        return { ok: true };
      }
      case 'delete-source': {
        const key = msg.kind === 'csv' ? 'csvImports' : 'snapshots';
        const { [key]: list = [] } = await get(key);
        await set({ [key]: list.filter((x) => x.id !== msg.id) });
        return { ok: true };
      }
      case 'replace-rows': {
        // Rebuild: the Details page re-read every saved page and CSV; this becomes the full transaction list.
        const { all } = mergeTransactions([], msg.rows || []);
        await set({ txns: all, rebuiltAt: Date.now() });
        return { total: all.length, subs: (await recompute()).length };
      }
      case 'debug-log': {
        const { debugLog = [] } = await get('debugLog');
        debugLog.push(msg.entry);
        await set({ debugLog: debugLog.slice(-25) });
        return { ok: true };
      }
      case 'clear-data':
        await chrome.storage.local.clear();
        return { ok: true };
      default:
        return { error: 'unknown message' };
    }
  })().then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'daily-check') return;
  const subs = await recompute();
  const { notified = {}, ignored = [], confirmed = [], remarks = {}, lastScanAt, scanNudgedAt } =
    await get(['notified', 'ignored', 'confirmed', 'remarks', 'lastScanAt', 'scanNudgedAt']);

  for (const s of dueSoon(subs, { today: today(), notified, ignored, confirmed })) {
    const d = daysBetween(today(), s.nextDate);
    const when = d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
    chrome.notifications.create(`due:${s.merchant}:${s.nextDate}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${s.merchant} renews ${when}`,
      message: `Expected ${s.nextDate}, about $${s.lastAmount.toFixed(2)}${s.priceJump ? ' — last charge jumped' : s.amountVaries ? ' (amount varies)' : ''}. Cancel now if you don't need it.${remarks[s.merchant] ? ` Note: ${remarks[s.merchant]}` : ''}`,
      priority: 2,
      requireInteraction: true,
    });
    notified[s.merchant] = s.nextDate;
  }
  await set({ notified });

  // Monthly reminder: no scan yet this calendar month → remind, then again every 3 days until scanned.
  const thisMonth = today().slice(0, 7);
  const lastMonth = lastScanAt ? new Date(lastScanAt).toLocaleDateString('en-CA').slice(0, 7) : null;
  if (lastMonth !== thisMonth && (!scanNudgedAt || Date.now() - scanNudgedAt > 3 * 86400000)) {
    chrome.notifications.create('rescan', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Sub Guard: monthly subscription check',
      message: lastScanAt
        ? `No Bank of America scan yet this month (last one ${new Date(lastScanAt).toLocaleDateString()}). Click to scan now.`
        : 'You haven\'t scanned Bank of America yet. Click to scan now.',
      requireInteraction: true,
    });
    await set({ scanNudgedAt: Date.now() });
  }
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (id === 'rescan') {
    const tab = await chrome.tabs.create({ url: BOA_START });
    await set({ flow: { active: true, startedAt: Date.now(), tabId: tab.id, queue: null, scanned: [] } });
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
  }
  chrome.notifications.clear(id);
});
