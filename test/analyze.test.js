import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate, parseAmount, normalizeMerchant, parseBankCsv, mergeTransactions, analyze, dueSoon, addPeriod,
} from '../analyze.js';

const TODAY = '2026-11-14';

function rows(list, account = 'Card - 1234') {
  return list.map(([date, desc, amount]) => ({ date, desc, amount, account }));
}

test('parses the date formats BofA pages and exports use', () => {
  assert.equal(parseDate('11/03/2026'), '2026-11-03');
  assert.equal(parseDate('11/03/26'), '2026-11-03');
  assert.equal(parseDate('Nov 03, 2026'), '2026-11-03');
  assert.equal(parseDate('November 3, 2026'), '2026-11-03');
  assert.equal(parseDate('2026-11-03'), '2026-11-03');
  assert.equal(parseDate('02/30/2026'), null);
  assert.equal(parseDate('Pending'), null);
});

test('parses amounts with $, commas, minus signs and parentheses', () => {
  assert.equal(parseAmount('-$1,234.50'), -1234.5);
  assert.equal(parseAmount('−$20.00'), -20);
  assert.equal(parseAmount('($20.00)'), -20);
  assert.equal(parseAmount('200.00'), 200);
  assert.equal(parseAmount('abc'), null);
});

test('same merchant with different reference numbers groups together', () => {
  const a = normalizeMerchant('CHECKCARD 1003 CURSOR, AI POWERED IDE NEW YORK NY 24692164306123456');
  const b = normalizeMerchant('CHECKCARD 1203 CURSOR, AI POWERED IDE NEW YORK NY 24692164399999999');
  assert.equal(a, b);
  assert.equal(normalizeMerchant('SQ *BLUE BOTTLE #123 OAKLAND CA'), normalizeMerchant('SQ *BLUE BOTTLE #456 OAKLAND CA'));
});

test('reads a BofA checking CSV export (summary block, then transactions)', () => {
  const csv = [
    'Description,,Summary Amt.',
    'Beginning balance as of 10/01/2026,,"5,000.00"',
    'Total credits,,"3,000.00"',
    '',
    'Date,Description,Amount,Running Bal.',
    '10/01/2026,Beginning balance as of 10/01/2026,,"5,000.00"',
    '10/03/2026,"CHECKCARD 1003 CURSOR, AI POWERED IDE NEW YORK NY 2469","-200.00","4,800.00"',
    '10/15/2026,"PAYROLL ACME DES:DIR DEP","3,000.00","7,800.00"',
  ].join('\n');
  const r = parseBankCsv(csv, 'Checking');
  const { all } = mergeTransactions([], r);
  assert.equal(all.length, 2); // balance row has no amount and is dropped
  assert.equal(all[0].amount, -200);
});

test('reads a BofA credit card CSV export', () => {
  const csv = [
    'Posted Date,Reference Number,Payee,Address,Amount',
    '11/03/2026,24692164306,"CURSOR USAGE  MID OCT","NEW YORK NY ",-1850.00',
    '11/05/2026,24692164307,"PAYMENT - THANK YOU","",2000.00',
  ].join('\n');
  const { all } = mergeTransactions([], parseBankCsv(csv, 'Card'));
  assert.equal(all.length, 2);
  assert.equal(all[0].desc, 'CURSOR USAGE MID OCT');
});

test('merging the same rows twice does not duplicate them', () => {
  const r = rows([['10/03/2026', 'NETFLIX.COM', '-15.49']]);
  const first = mergeTransactions([], r);
  const second = mergeTransactions(first.all, r);
  assert.equal(second.all.length, 1);
  assert.equal(second.added, 0);
});

test('finds monthly subscriptions and ignores irregular spending and payments', () => {
  const { all } = mergeTransactions([], rows([
    ['08/03/2026', 'CHECKCARD 0803 CURSOR, AI POWERED IDE NEW YORK NY 111111', '-200.00'],
    ['09/03/2026', 'CHECKCARD 0903 CURSOR, AI POWERED IDE NEW YORK NY 222222', '-200.00'],
    ['10/03/2026', 'CHECKCARD 1003 CURSOR, AI POWERED IDE NEW YORK NY 333333', '-200.00'],
    ['11/03/2026', 'CHECKCARD 1103 CURSOR, AI POWERED IDE NEW YORK NY 444444', '-200.00'],
    ['09/12/2026', 'GYM CLUB DUES', '-49.00'],
    ['10/12/2026', 'GYM CLUB DUES', '-49.00'],
    ['11/12/2026', 'GYM CLUB DUES', '-49.00'],
    ['09/02/2026', 'SAFEWAY #1234', '-82.11'],
    ['09/09/2026', 'SAFEWAY #1234', '-12.40'],
    ['09/30/2026', 'SAFEWAY #1234', '-140.02'],
    ['10/21/2026', 'SAFEWAY #1234', '-33.00'],
    ['10/25/2026', 'PAYMENT - THANK YOU', '500.00'],
    ['10/26/2026', 'ONLINE BANKING TRANSFER TO SAV', '-500.00'],
  ]));
  const subs = analyze(all, { today: TODAY });
  const names = subs.map((s) => s.merchant);
  assert.ok(names.some((n) => n.startsWith('CURSOR')), names.join(','));
  assert.ok(names.includes('GYM CLUB DUES'));
  assert.ok(!names.some((n) => n.startsWith('SAFEWAY')));
  assert.ok(!names.some((n) => n.includes('TRANSFER')));
  const cursor = subs.find((s) => s.merchant.startsWith('CURSOR'));
  assert.equal(cursor.period, 'monthly');
  assert.equal(cursor.confidence, 'high');
  assert.equal(cursor.nextDate, '2026-12-03');
  assert.equal(cursor.yearlyCost, 2433.33);
  assert.equal(cursor.priceJump, false);
});

test('one charge from a known subscription merchant is flagged as possible', () => {
  const { all } = mergeTransactions([], rows([['11/01/2026', 'OPENAI *CHATGPT SUBSCR', '-20.00']]));
  const [s] = analyze(all, { today: TODAY });
  assert.equal(s.confidence, 'possible');
  assert.equal(s.nextDate, '2026-12-01');
});

test('usage-based charges with changing amounts still count for known merchants', () => {
  const { all } = mergeTransactions([], rows([
    ['09/03/2026', 'CURSOR USAGE', '-40.00'],
    ['10/03/2026', 'CURSOR USAGE', '-900.00'],
    ['11/03/2026', 'CURSOR USAGE', '-1850.00'],
  ]));
  const [s] = analyze(all, { today: TODAY });
  assert.equal(s.period, 'monthly');
  assert.equal(s.amountVaries, true);
});

test('purchases shown as positive amounts (card activity page) are still detected', () => {
  const { all } = mergeTransactions([], rows([
    ['09/05/2026', 'SPOTIFY USA', '11.99'],
    ['10/05/2026', 'SPOTIFY USA', '11.99'],
    ['11/05/2026', 'SPOTIFY USA', '11.99'],
    ['10/20/2026', 'PAYMENT RECEIVED', '-100.00'],
  ]));
  const subs = analyze(all, { today: TODAY });
  assert.equal(subs.length, 1);
  assert.equal(subs[0].merchant, 'SPOTIFY USA');
});

test('a subscription whose expected charge is long overdue is marked as maybe stopped', () => {
  const { all } = mergeTransactions([], rows([
    ['05/01/2026', 'NETFLIX.COM', '-15.49'],
    ['06/01/2026', 'NETFLIX.COM', '-15.49'],
    ['07/01/2026', 'NETFLIX.COM', '-15.49'],
  ]));
  const [s] = analyze(all, { today: TODAY });
  assert.equal(s.maybeStopped, true);
});

test('yearly renewals are detected', () => {
  const { all } = mergeTransactions([], rows([
    ['12/01/2024', 'JETBRAINS ALL PRODUCTS', '-289.00'],
    ['12/01/2025', 'JETBRAINS ALL PRODUCTS', '-289.00'],
  ]));
  const [s] = analyze(all, { today: TODAY });
  assert.equal(s.period, 'yearly');
  assert.equal(s.nextDate, '2026-12-01');
});

test('reminders fire within 3 days, once per renewal, and skip ignored ones', () => {
  const subs = [
    { merchant: 'A', nextDate: '2026-11-16', maybeStopped: false },
    { merchant: 'B', nextDate: '2026-11-30', maybeStopped: false },
    { merchant: 'C', nextDate: '2026-11-15', maybeStopped: false },
    { merchant: 'D', nextDate: '2026-11-15', maybeStopped: false },
  ];
  const due = dueSoon(subs, { today: TODAY, notified: { C: '2026-11-15' }, ignored: ['D'] });
  assert.deepEqual(due.map((s) => s.merchant), ['A']);
});

test('monthly renewal on the 31st clamps to the end of shorter months', () => {
  assert.equal(addPeriod('2026-01-31', { name: 'monthly', days: 30 }), '2026-02-28');
});

test('a big jump on the latest charge is flagged and counted at the new price', () => {
  const { all } = mergeTransactions([], rows([
    ['08/03/2026', 'CURSOR USAGE', '-200.00'],
    ['09/03/2026', 'CURSOR USAGE', '-200.00'],
    ['10/03/2026', 'CURSOR USAGE', '-200.00'],
    ['11/03/2026', 'CURSOR USAGE', '-1850.00'],
  ]));
  const [s] = analyze(all, { today: TODAY });
  assert.equal(s.priceJump, true);
  assert.equal(s.yearlyCost, 22508.33);
});

test('rows with screen-reader button text or balance lines are dropped, including ones already stored', () => {
  const stored = [{ date: '2025-11-03', amount: 12.5, desc: 'Expand transaction for Transaction date:', account: 'Visa' }];
  const { all } = mergeTransactions(stored, rows([
    ['10/29/2025', 'Beginning balance as of', '1500.00'],
    ['11/03/2025', 'NETFLIX.COM', '15.49'],
  ]));
  assert.deepEqual(all.map((t) => t.desc), ['NETFLIX.COM']);
});

test("re-importing the extension's own CSV export keeps each row's account", () => {
  const csv = 'date,description,amount,account\n"2026-11-03","NETFLIX.COM","15.49","Visa - 0000"\n';
  const [r] = parseBankCsv(csv, 'file-name');
  assert.equal(r.account, 'Visa - 0000');
  assert.equal(mergeTransactions([], [r]).all[0].date, '2026-11-03');
});

test('one month of real-looking card data: billers split by amount, bills flagged, restaurants ignored', () => {
  const { all } = mergeTransactions([], rows([
    ['10/30/2025', 'GITHUB, INC. GITHUB.COM CA', '39.00'],
    ['11/03/2025', 'APPLE.COM/BILL 866-712-7753 CA', '2.99'],
    ['11/10/2025', 'APPLE.COM/BILL 866-712-7753 CA', '5.00'],
    ['11/05/2025', 'VERIZON WRLS 800-555-0101 NJ', '42.58'],
    ['11/12/2025', 'AT&T U-VERSE 800-555-0102 TX', '33.00'],
    ['11/26/2025', 'AMAZON PRIME*AB1CD23E4 Amzn.com/billWA', '16.36'],
    ['11/28/2025', 'PAYPAL *STEAMGAMES 800-555-0103 WA', '14.99'],
    ['11/10/2025', 'BURGER PLACE #12 SPRINGFIELD IL', '16.14'],
    ['11/12/2025', 'BURGER PLACE #12 SPRINGFIELD IL', '12.00'],
    ['11/17/2025', 'BURGER PLACE #12 SPRINGFIELD IL', '17.32'],
    ['11/01/2025', 'PAYMENT FROM CHK 0000 CONF#abc123', '-1500.00'],
  ], 'Visa - 0000'));
  const subs = analyze(all, { today: '2025-11-30' });
  const names = subs.map((s) => s.merchant).sort();
  assert.equal(subs.length, 7, names.join(', '));
  assert.ok(subs.every((s) => s.period === 'monthly'), subs.map((s) => `${s.merchant}:${s.period}`).join(', '));
  assert.ok(names.some((n) => n.startsWith('APPLE.COM/BILL') && n.endsWith('$2.99')));
  assert.ok(names.some((n) => n.startsWith('APPLE.COM/BILL') && n.endsWith('$5.00')));
  for (const k of ['GITHUB', 'VERIZON', 'AT&T', 'AMAZON PRIME', 'STEAMGAMES']) assert.ok(names.some((n) => n.includes(k)), `${k} in ${names}`);
  assert.ok(!names.some((n) => n.includes('BURGER') || n.includes('PAYMENT')));
});

test('a favorite restaurant visited weekly is not a subscription', () => {
  const { all } = mergeTransactions([], rows([
    ['11/04/2025', 'PAR*NOODLE HOUSE SPRINGFIELD IL', '27.49'],
    ['11/11/2025', 'PAR*NOODLE HOUSE SPRINGFIELD IL', '26.17'],
    ['11/18/2025', 'PAR*NOODLE HOUSE SPRINGFIELD IL', '28.08'],
    ['11/26/2025', 'PAR*NOODLE HOUSE SPRINGFIELD IL', '30.58'],
  ]));
  const subs = analyze(all, { today: '2025-11-30' });
  assert.ok(subs.every((s) => s.confidence === 'suspicious'), subs.map((s) => `${s.merchant}:${s.confidence}`).join(', '));
});

test('repeat charges with a similar amount but no schedule are listed as suspicious', () => {
  const { all } = mergeTransactions([], rows([
    ['11/01/2025', 'UEP*DUMPLING SHOP SPRINGFIELD IL', '41.18'],
    ['11/17/2025', 'UEP*DUMPLING SHOP SPRINGFIELD IL', '46.85'],
    ['11/24/2025', 'UEP*DUMPLING SHOP SPRINGFIELD IL', '46.85'],
    ['11/03/2025', 'BURGER STAND SPRINGFIELD IL', '16.91'],
    ['11/21/2025', 'BURGER STAND SPRINGFIELD IL', '6.82'],
    ['11/20/2025', 'AIRLINE 0000000000001800-555-0104 TX', '650.00'],
    ['11/20/2025', 'AIRLINE 0000000000002800-555-0104 TX', '650.00'],
  ]));
  const subs = analyze(all, { today: '2025-11-30' });
  assert.equal(subs.length, 1, subs.map((s) => s.merchant).join(', '));
  const [s] = subs;
  assert.equal(s.confidence, 'suspicious');
  assert.ok(s.merchant.includes('DUMPLING'));
  assert.equal(s.count, 2);
  assert.deepEqual(dueSoon(subs, { today: '2025-11-30', days: 365 }), []); // no reminders for suspicious ones
});

test('reminders: removed merchants never remind, suspicious ones remind only once you mark them', () => {
  const subs = [
    { merchant: 'NETFLIX', nextDate: '2026-11-16', maybeStopped: false, confidence: 'high' },
    { merchant: 'GAME STUDIO', nextDate: '2026-11-16', maybeStopped: false, confidence: 'suspicious' },
    { merchant: 'UNMARKED', nextDate: '2026-11-16', maybeStopped: false, confidence: 'suspicious' },
  ];
  const due = dueSoon(subs, { today: '2026-11-14', ignored: ['NETFLIX'], confirmed: ['GAME STUDIO'] });
  assert.deepEqual(due.map((s) => s.merchant), ['GAME STUDIO']);
});
