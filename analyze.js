// Pure analysis code: no chrome.* calls, so it runs in the extension and in node tests.

export const PERIODS = [
  { name: 'weekly', days: 7, min: 5, max: 9 },
  { name: 'monthly', days: 30, min: 26, max: 35 },
  { name: 'quarterly', days: 91, min: 84, max: 98 },
  { name: 'yearly', days: 365, min: 350, max: 380 },
];

// Merchants that are almost always subscriptions: one charge is enough to flag them as "possible".
const KNOWN_SUBSCRIPTIONS = [
  'CURSOR', 'ANYSPHERE', 'OPENAI', 'CHATGPT', 'ANTHROPIC', 'CLAUDE', 'GITHUB', 'COPILOT', 'NETFLIX', 'SPOTIFY',
  'HULU', 'DISNEY', 'YOUTUBE', 'GOOGLE ONE', 'GOOGLE *', 'APPLE.COM/BILL', 'APPLE COM BILL', 'ADOBE', 'MICROSOFT',
  'MSFT', 'DROPBOX', 'NOTION', 'AMAZON PRIME', 'AMZN PRIME', 'PRIME VIDEO', 'AUDIBLE', 'ICLOUD', 'MIDJOURNEY',
  'PERPLEXITY', 'LINKEDIN', 'PATREON', 'SUBSTACK', 'NYTIMES', 'NYT ', 'WSJ', 'ZOOM', 'SLACK', 'FIGMA', 'CANVA',
  'GRAMMARLY', '1PASSWORD', 'LASTPASS', 'NORDVPN', 'EXPRESSVPN', 'PARAMOUNT', 'PEACOCK', 'HBO', 'MAX.COM',
  'DUOLINGO', 'HEADSPACE', 'CALM.COM', 'PLANET FITNESS', 'VERCEL', 'HEROKU', 'DIGITALOCEAN', 'AWS', 'JETBRAINS',
  'REPLIT', 'X CORP', 'TWITTER', 'SIRIUSXM', 'MEDIUM', 'CHEGG', 'EQUINOX', 'PELOTON', 'HELLOFRESH',
  // phone, internet, utilities, learning and gaming: billed monthly by nature
  'XFINITY', 'COMCAST', 'T-MOBILE', 'VERIZON', 'AT&T', 'CONSERVICE', 'PG&E', 'LEETCODE', 'BLIZZARD', 'BATTLENET', 'BATTLE.NET', 'PLAYSTATION',
  'XBOX', 'NINTENDO', 'STEAMGAMES', 'COURSERA', 'UDEMY', 'MASTERCLASS',
];

// Rows that are money in, or movements between accounts, never subscriptions.
const NOT_A_CHARGE = /\b(PAYMENT|THANK YOU|DEPOSIT|TRANSFER|ZELLE|INTEREST|REFUND|PAYROLL|ATM|CASH ADVANCE|DIRECT DEP|REVERSAL|ADJUSTMENT)\b/i;

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function pad(n) { return String(n).padStart(2, '0'); }
function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return iso(y, +m[1], +m[2]);
  }
  m = s.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}

export function parseAmount(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  let t = String(s).trim().replace(/−/g, '-');
  const negParen = /^\(.*\)$/.test(t);
  t = t.replace(/[()$,\s]/g, '');
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return null;
  const v = parseFloat(t);
  return negParen ? -Math.abs(v) : v;
}

export function normalizeMerchant(desc) {
  let s = String(desc || '').toUpperCase();
  s = s.replace(/^(CHECKCARD|PURCHASE|DEBIT CARD PURCHASE|POS PURCHASE|RECURRING|PREAUTHORIZED DEBIT)\s+\d{0,4}\s*/, '');
  s = s.replace(/^(SQ|TST|SP|PP|PAYPAL|IC|DD|BT)\s?\*\s?/, '');
  s = s.replace(/\*[A-Z0-9]*\d[A-Z0-9]*/g, ' '); // order/reference codes like AMAZON PRIME*XD3CH79G3
  s = s.replace(/#\S*/g, ' ').replace(/\b\S*\d{3,}\S*\b/g, ' ');
  s = s.replace(/[^A-Z0-9&./* ]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+[A-Z]{2}$/, ''); // trailing state code
  return s.split(' ').filter(Boolean).slice(0, 3).join(' ') || 'UNKNOWN';
}

export function isKnownSubscription(desc) {
  const u = String(desc || '').toUpperCase();
  return KNOWN_SUBSCRIPTIONS.some((k) => u.includes(k));
}

export function txnKey(t) {
  return `${t.account || ''}|${t.date}|${t.amount.toFixed(2)}|${t.desc}`;
}

// Text that is never a merchant: screen-reader button labels and balance lines picked up by page scans.
const JUNK_DESC = /expand transaction|collapse transaction|transaction date:|\b(beginning|ending|opening|closing) balance\b|balance as of/i;

export function normalizeRow(r) {
  const date = parseDate(r.date);
  const amount = parseAmount(r.amount);
  const desc = String(r.desc || '').replace(/\s+/g, ' ').trim();
  if (!date || amount === null || amount === 0 || !desc || JUNK_DESC.test(desc)) return null;
  return { date, amount, desc, account: r.account || '' };
}

export function mergeTransactions(existing, incoming) {
  const map = new Map(existing.filter((t) => !JUNK_DESC.test(t.desc)).map((t) => [txnKey(t), t]));
  let added = 0;
  for (const r of incoming) {
    const t = normalizeRow(r);
    if (!t) continue;
    const k = txnKey(t);
    if (!map.has(k)) { map.set(k, t); added++; }
  }
  const all = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { all, added };
}

// ---------- CSV ----------

export function parseCsvLines(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Handles BofA checking ("Date,Description,Amount,Running Bal.") and card ("Posted Date,Reference Number,Payee,Address,Amount")
// exports, plus most other bank CSVs with a date, description and amount column.
export function parseBankCsv(text, account = '') {
  const lines = parseCsvLines(text);
  const hi = lines.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /^\s*amount\s*$/i.test(c)));
  if (hi < 0) return [];
  const h = lines[hi].map((c) => c.trim().toLowerCase());
  const di = h.findIndex((c) => c.includes('date'));
  const ai = h.findIndex((c) => c === 'amount');
  let ci = h.findIndex((c) => /payee|description|merchant|name/.test(c));
  if (ci < 0) ci = h.findIndex((_, i) => i !== di && i !== ai);
  const acc = h.indexOf('account'); // present in this extension's own export
  return lines.slice(hi + 1).map((r) => ({ date: r[di], desc: r[ci], amount: r[ai], account: (acc >= 0 && r[acc]) || account }));
}

// ---------- recurrence detection ----------

function dayNum(isoDate) { return Date.parse(isoDate + 'T00:00:00Z') / 86400000; }
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function addPeriod(isoDate, period) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[period.name];
  if (!months) {
    const dt = new Date(Date.UTC(y, m - 1, d + period.days));
    return dt.toISOString().slice(0, 10);
  }
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}

export function daysBetween(a, b) { return Math.round(dayNum(b) - dayNum(a)); }

export function chargesOnly(txns) {
  // Per account, charges carry the majority sign (negative in BofA exports; some card pages show purchases positive).
  const byAcct = new Map();
  for (const t of txns) {
    if (!byAcct.has(t.account)) byAcct.set(t.account, []);
    byAcct.get(t.account).push(t);
  }
  const out = [];
  for (const list of byAcct.values()) {
    const neg = list.filter((t) => t.amount < 0).length;
    const sign = neg >= list.length - neg ? -1 : 1;
    for (const t of list) {
      if (Math.sign(t.amount) === sign && !NOT_A_CHARGE.test(t.desc)) out.push({ ...t, cost: Math.abs(t.amount) });
    }
  }
  return out;
}

export function analyze(txns, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const groups = new Map();
  for (const c of chargesOnly(txns)) {
    const k = normalizeMerchant(c.desc);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }

  const subs = [];
  for (const [merchant, list] of groups) {
    const whole = detect(merchant, list, today);
    if (whole && whole.confidence !== 'possible') { subs.push(whole); continue; }
    // No clear pattern as one group: one biller can carry several subscriptions (APPLE.COM/BILL $2.99 and $5.00).
    const byAmount = new Map();
    for (const c of list) {
      const k = c.cost.toFixed(2);
      if (!byAmount.has(k)) byAmount.set(k, []);
      byAmount.get(k).push(c);
    }
    const parts = byAmount.size < 2 ? [] : [...byAmount].map(([amt, l]) => detect(`${merchant} $${amt}`, l, today)).filter(Boolean);
    if (parts.length) subs.push(...parts);
    else if (whole) subs.push(whole);
    else subs.push(...suspicious(merchant, list, today));
  }
  subs.sort((a, b) => (a.maybeStopped - b.maybeStopped) || b.yearlyCost - a.yearlyCost);
  return subs;
}

// Same merchant, similar amount (within $1 or 5%), on 2+ different days, but no regular schedule:
// not proof of a subscription, worth a look.
function suspicious(merchant, list, today) {
  const clusters = [];
  for (const c of [...list].sort((a, b) => a.cost - b.cost)) {
    const cl = clusters.find((k) => Math.abs(k.center - c.cost) <= Math.max(1, 0.05 * k.center));
    if (cl) { cl.items.push(c); cl.center = median(cl.items.map((x) => x.cost)); }
    else clusters.push({ center: c.cost, items: [c] });
  }
  const repeats = clusters.filter((k) => new Set(k.items.map((c) => c.date)).size >= 2);
  return repeats.map((k) => {
    const items = k.items.sort((a, b) => a.date.localeCompare(b.date));
    const dates = [...new Set(items.map((c) => c.date))];
    const gap = median(dates.slice(1).map((d, i) => daysBetween(dates[i], d)));
    const period = PERIODS.find((p) => gap >= p.min && gap <= p.max);
    const last = items[items.length - 1];
    return {
      merchant: repeats.length > 1 ? `${merchant} ~$${k.center.toFixed(2)}` : merchant,
      sample: last.desc,
      period: period ? period.name : `every ~${Math.round(gap)} days`,
      confidence: 'suspicious',
      count: items.length,
      lastDate: last.date,
      lastAmount: last.cost,
      amountVaries: false,
      priceJump: false,
      nextDate: period ? addPeriod(last.date, period) : null,
      maybeStopped: false,
      yearlyCost: period ? Math.round(k.center * (365 / period.days) * 100) / 100 : 0,
      accounts: [...new Set(items.map((c) => c.account).filter(Boolean))],
      charges: items.map((c) => ({ date: c.date, amount: c.cost })),
    };
  });
}

function detect(merchant, list, today) {
  {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const known = list.some((c) => isKnownSubscription(c.desc));
    const dates = [...new Set(list.map((c) => c.date))];
    const costs = list.map((c) => c.cost);
    const medCost = median(costs);
    const steadyAmount = costs.filter((x) => Math.abs(x - medCost) <= 0.25 * medCost).length / costs.length >= 0.6;

    let period = null, confidence = null;
    if (dates.length >= 2) {
      const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
      const g = median(gaps);
      const p = PERIODS.find((pp) => g >= pp.min && g <= pp.max);
      if (p) {
        const regular = gaps.filter((x) => x >= p.min && x <= p.max).length / gaps.length >= 0.6;
        // Weekly needs a steady amount even for known merchants: Apple/Amazon bill several things in one week.
        // Weekly only for known merchants with a steady amount: otherwise it's a favorite restaurant.
        const ok = p.name === 'weekly' ? known && steadyAmount : steadyAmount || known;
        if (regular && ok) {
          period = p;
          confidence = dates.length >= 3 || known ? 'high' : 'medium';
        }
      }
    }
    if (!period && known) {
      period = PERIODS[1];
      confidence = 'possible';
    }
    if (!period) return null;

    const last = list[list.length - 1];
    let next = addPeriod(last.date, period);
    // If the expected date passed more than half a period ago, it probably stopped (or was cancelled).
    const overdue = daysBetween(next, today);
    const maybeStopped = overdue > Math.max(5, period.days / 2);

    return {
      merchant,
      sample: last.desc,
      period: period.name,
      confidence,
      count: list.length,
      lastDate: last.date,
      lastAmount: last.cost,
      amountVaries: !steadyAmount,
      // Last charge much higher than usual: the kind of surprise worth an alert even mid-cycle.
      priceJump: list.length >= 2 && last.cost > 1.5 * median(costs.slice(0, -1)),
      nextDate: next,
      maybeStopped,
      yearlyCost: Math.round(Math.max(medCost, last.cost) * (365 / period.days) * 100) / 100,
      accounts: [...new Set(list.map((c) => c.account).filter(Boolean))],
      charges: list.map((c) => ({ date: c.date, amount: c.cost })),
    };
  }
}

// Subscriptions whose next charge is within `days` days and not yet notified for that date.
export function dueSoon(subs, { today, days = 3, notified = {}, ignored = [], confirmed = [] }) {
  return subs.filter((s) => {
    if (s.maybeStopped || !s.nextDate || ignored.includes(s.merchant)) return false;
    if (s.confidence === 'suspicious' && !confirmed.includes(s.merchant)) return false;
    const d = daysBetween(today, s.nextDate);
    return d >= 0 && d <= days && notified[s.merchant] !== s.nextDate;
  });
}
