const $ = (id) => document.getElementById(id);
const money = (n) => `$${n.toFixed(2)}`;
const thisMonth = new Date().toLocaleDateString('en-CA').slice(0, 7);
const monthName = (ym) => new Date(ym + '-15T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

// Your decisions, kept by merchant name so they survive rescans and rebuilds:
//   ignored   – "not a subscription": hidden from both lists, no reminders
//   confirmed – suspicious ones you marked as a real subscription
//   remarks   – your note per merchant
let state = { ignored: [], confirmed: [], remarks: {} };

async function saveList(key, merchant, add) {
  const cur = (await chrome.storage.local.get(key))[key] || [];
  const next = add ? [...new Set([...cur, merchant])] : cur.filter((m) => m !== merchant);
  await chrome.storage.local.set({ [key]: next });
}
const remove = async (m) => { await saveList('confirmed', m, false); await saveList('ignored', m, true); };
const restore = (m) => saveList('ignored', m, false);
const confirmSub = async (m) => { await saveList('ignored', m, false); await saveList('confirmed', m, true); };
const unconfirm = (m) => saveList('confirmed', m, false);

let noteTimer;
function noteInput(merchant) {
  const inp = document.createElement('input');
  inp.className = 'note';
  inp.placeholder = 'add a note';
  inp.value = state.remarks[merchant] || '';
  inp.oninput = () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      const remarks = (await chrome.storage.local.get('remarks')).remarks || {};
      if (inp.value.trim()) remarks[merchant] = inp.value.trim(); else delete remarks[merchant];
      state.remarks = remarks;
      await chrome.storage.local.set({ remarks });
    }, 400);
  };
  return inp;
}

function button(label, fn, title) {
  const b = document.createElement('button');
  b.textContent = label;
  if (title) b.title = title;
  b.onclick = fn;
  return b;
}

function row(cells, merchant, actions, title) {
  const tr = document.createElement('tr');
  if (title) tr.title = title;
  for (const [text, cls] of cells) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    tr.appendChild(td);
  }
  const note = document.createElement('td');
  note.appendChild(noteInput(merchant));
  const act = document.createElement('td');
  act.className = 'act';
  act.append(...actions);
  tr.append(note, act);
  return tr;
}

// A subscription belongs to a month if it was charged in it, or its next charge is expected in it.
function inMonth(s, ym) {
  return s.charges.some((c) => c.date.startsWith(ym)) || (!s.maybeStopped && !!s.nextDate && s.nextDate.startsWith(ym));
}

function fillMonths(txns) {
  const sel = $('month');
  const months = new Set([thisMonth, ...txns.map((t) => t.date.slice(0, 7))]);
  const cur = sel.value || thisMonth;
  sel.textContent = '';
  for (const m of [...months].sort().reverse()) sel.add(new Option(m === thisMonth ? `${monthName(m)} (this month)` : monthName(m), m));
  sel.add(new Option('All months', ''));
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : thisMonth;
}

async function render() {
  const data = await chrome.storage.local.get(['subs', 'txns', 'lastScanAt', 'ignored', 'confirmed', 'remarks']);
  const { subs = [], txns = [], lastScanAt } = data;
  state = { ignored: data.ignored || [], confirmed: data.confirmed || [], remarks: data.remarks || {} };
  // Don't redraw while a note is being typed: it would steal focus.
  if (document.activeElement?.classList.contains('note')) return;

  fillMonths(txns);
  const ym = $('month').value;
  const range = txns.length ? `${txns[0].date} to ${txns[txns.length - 1].date}` : 'no data yet';
  $('info').textContent = `From ${txns.length} transactions (${range}).` +
    (lastScanAt ? ` Last scan ${new Date(lastScanAt).toLocaleDateString()}.` : '');

  const amountFor = (s) => {
    if (!ym) return s.lastAmount;
    const charged = s.charges.filter((c) => c.date.startsWith(ym)).reduce((a, c) => a + c.amount, 0);
    return charged || s.lastAmount;
  };
  const shown = subs.filter((s) => !ym || inMonth(s, ym)).sort((a, b) => a.merchant.localeCompare(b.merchant));
  const isIgnored = (s) => state.ignored.includes(s.merchant);
  const isSub = (s) => s.confidence !== 'suspicious' || state.confirmed.includes(s.merchant);
  const list = shown.filter((s) => !isIgnored(s) && isSub(s));
  const sus = shown.filter((s) => !isIgnored(s) && !isSub(s));
  const removed = subs.filter(isIgnored).sort((a, b) => a.merchant.localeCompare(b.merchant));
  const history = (s) => s.charges.map((c) => `${c.date}  ${money(c.amount)}`).join('\n');

  $('total').textContent = list.length ? `${list.length} subscriptions · ${money(list.reduce((a, s) => a + amountFor(s), 0))}` : '';

  const tbody = $('rows');
  tbody.textContent = '';
  $('empty').hidden = list.length > 0;
  for (const s of list) {
    const confirmed = s.confidence === 'suspicious';
    const actions = confirmed
      ? [button('Unmark', () => unconfirm(s.merchant), 'Move back to Suspicious'), button('Remove', () => remove(s.merchant), 'Not a subscription')]
      : [button('Remove', () => remove(s.merchant), 'Not a subscription')];
    tbody.appendChild(row([
      [s.merchant, ''], [confirmed ? `${s.period} (you marked)` : s.period, ''], [money(amountFor(s)), 'num'], [s.lastDate, ''],
      [s.maybeStopped ? 'stopped?' : s.nextDate || '—', ''],
    ], s.merchant, actions, history(s)));
  }

  const susBody = $('susRows');
  susBody.textContent = '';
  $('susEmpty').hidden = sus.length > 0;
  for (const s of sus) {
    susBody.appendChild(row([
      [s.merchant, ''], [`${s.count}×`, ''], [money(s.lastAmount), 'num'], [s.lastDate, ''], [s.period, ''],
    ], s.merchant, [
      button('Subscription', () => confirmSub(s.merchant), 'Yes, this is a subscription'),
      button('Not', () => remove(s.merchant), 'Not a subscription'),
    ], history(s)));
  }

  const remBody = $('removedRows');
  remBody.textContent = '';
  $('removedCount').textContent = removed.length;
  for (const s of removed) {
    remBody.appendChild(row([[s.merchant, ''], [money(s.lastAmount), 'num'], [s.lastDate, '']], s.merchant,
      [button('Restore', () => restore(s.merchant))], history(s)));
  }
}

$('month').onchange = render;
$('rescan').onclick = () => chrome.runtime.sendMessage({ type: 'start-flow' });
chrome.storage.onChanged.addListener((changes) => {
  if (changes.subs || changes.txns || changes.ignored || changes.confirmed) render();
});

// Recalculate from stored transactions on open, so detection changes apply without a new scan.
chrome.runtime.sendMessage({ type: 'recompute' }).finally(render);
