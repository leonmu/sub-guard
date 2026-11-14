import { daysBetween } from './analyze.js';

const $ = (id) => document.getElementById(id);
const today = new Date().toLocaleDateString('en-CA');

$('analyze').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'start-flow' });
  window.close();
};
for (const [id, page] of [['results', 'results.html'], ['details', 'details.html']]) {
  $(id).onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL(page) }); window.close(); };
}

const { subs = [], ignored = [], confirmed = [], lastScanAt } = await chrome.storage.local.get(['subs', 'ignored', 'confirmed', 'lastScanAt']);
const active = subs.filter((s) => !s.maybeStopped && (s.confidence !== 'suspicious' || confirmed.includes(s.merchant)) && s.nextDate && !ignored.includes(s.merchant));
if (!lastScanAt) {
  $('summary').textContent = 'No scan yet.';
} else {
  const yearly = active.reduce((a, s) => a + s.yearlyCost, 0);
  $('summary').textContent = `${active.length} active subscriptions, about $${yearly.toFixed(0)}/year. Last scan ${new Date(lastScanAt).toLocaleDateString()}.`;
  active
    .filter((s) => daysBetween(today, s.nextDate) >= 0)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
    .slice(0, 5)
    .forEach((s) => {
      const d = document.createElement('div');
      const name = document.createElement('span');
      name.textContent = s.merchant;
      const when = document.createElement('span');
      when.className = 'muted';
      when.textContent = `${s.nextDate} · $${s.lastAmount.toFixed(2)}`;
      d.append(name, when);
      $('upcoming').appendChild(d);
    });
}
