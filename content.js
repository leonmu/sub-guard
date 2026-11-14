// Runs on bankofamerica.com pages. Only acts while a scan started from the extension is active, and only in that tab.
// It never reads, fills or submits login fields: you log in yourself.
(() => {
  if (window.top !== window) return;

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => globalThis.SubGuardExtract.visible(el);
  const LOAD_MORE_RE = /^(view|show|load|see) (more|older)|more transactions|previous transactions/i;

  // ---------- banner (shadow DOM so the bank's CSS can't break it) ----------
  let bannerText, bannerActions;
  function banner(text, actions = []) {
    if (!bannerText) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>
          .b{font:14px/1.4 -apple-system,system-ui,sans-serif;background:#0f3d2a;color:#fff;border-radius:10px;
             padding:12px 14px;max-width:340px;box-shadow:0 6px 24px rgba(0,0,0,.3)}
          .t{font-weight:600;margin-bottom:4px} .m{opacity:.95} .a{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}
          button{font:inherit;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;background:#fff;color:#0f3d2a}
          button.s{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5)}
          label{display:block;margin:3px 0}
        </style>
        <div class="b"><div class="t">Sub Guard</div><div class="m"></div><div class="a"></div></div>`;
      bannerText = root.querySelector('.m');
      bannerActions = root.querySelector('.a');
      document.documentElement.appendChild(host);
    }
    if (typeof text === 'string') bannerText.textContent = text;
    else { bannerText.textContent = ''; bannerText.appendChild(text); }
    bannerActions.textContent = '';
    for (const [label, fn, secondary] of [...actions, ['Stop', stop, true]]) {
      const b = document.createElement('button');
      b.textContent = label;
      if (secondary) b.className = 's';
      b.onclick = fn;
      bannerActions.appendChild(b);
    }
  }

  let stopped = false;
  let handled = false; // a manual button took over from the wait loop
  async function stop() {
    stopped = true;
    await send({ type: 'stop-flow' });
    banner('Stopped. Nothing else will happen on this page.', []);
    bannerActions.textContent = '';
  }

  // ---------- page understanding (shared with the Details page, see extract.js) ----------
  const E = globalThis.SubGuardExtract;
  const extractRows = () => E.extractRows(document);
  const accountLinks = () => E.accountLinks(document);

  function isLoginPage() {
    const pw = [...document.querySelectorAll('input[type="password"]')].some(visible);
    return pw || /sign-?in|signon|login/i.test(location.pathname) && !/myaccounts\/(brain|details)/i.test(location.pathname);
  }

  function logPage(kind, extra = {}) {
    const entry = {
      time: new Date().toISOString(),
      path: location.hostname + location.pathname,
      kind,
      rowsFound: kind === 'login' ? null : extractRows().length,
      accountLinks: kind === 'login' ? null : accountLinks().map((l) => E.mask(l.label)),
      ...extra,
    };
    if (kind !== 'login') entry.skeleton = E.skeleton(document);
    send({ type: 'debug-log', entry });
  }

  function classify() {
    if (isLoginPage()) return 'login';
    if (extractRows().length >= 3) return 'activity';
    if (accountLinks().length) return 'overview';
    return 'unknown';
  }

  const findMoreButton = () => [...document.querySelectorAll('button, a, [role="button"]')]
    .find((b) => visible(b) && LOAD_MORE_RE.test((b.innerText || '').trim()));
  const findOverviewLink = () => [...document.querySelectorAll('a[href]')]
    .find((a) => visible(a) && (/^(accounts overview|accounts|all accounts|my accounts|back to accounts)$/i.test((a.innerText || '').trim())
      || /accountsoverview/i.test(a.href)));
  const last4 = (label) => (String(label).match(/\d{4}(?!.*\d{4})/) || [String(label)])[0];
  const MAX_PAGES_PER_ACCOUNT = 13; // about a year of statements, enough to see yearly renewals

  // ---------- steps ----------
  async function goNextOrFinish(flow, scannedNow) {
    const queue = flow.queue || [];
    if (queue.length) {
      const [next, ...rest] = queue;
      await send({ type: 'update-flow', patch: { queue: rest, current: next, pagesRead: 0 } });
      banner(`Opening ${next.label}…`);
      location.href = next.href;
    } else {
      const total = (flow.scanned || []).concat(scannedNow || []);
      banner('Done. Opening your results…');
      await send({ type: 'finish-flow', summary: total });
    }
  }

  async function scanActivity(flow) {
    const account = flow.current?.label || document.title.replace(/\s*\|.*$/, '').trim() || 'Bank of America';
    let pages = flow.pagesRead || 0;
    let lastSig = '';
    const sigOf = (rows) => rows.map((r) => r.date + r.amount + r.desc).join('|');
    while (!stopped) {
      const rows = extractRows();
      const sig = sigOf(rows);
      if (rows.length && sig !== lastSig) {
        lastSig = sig;
        pages++;
        banner(`Reading ${account}: page ${pages} of up to ${MAX_PAGES_PER_ACCOUNT} (${rows.length} transactions)…`);
        // Save before clicking anything: "Previous transactions" may load a new page and end this script.
        await send({ type: 'save-snapshots', snaps: [{ account, path: location.pathname, html: E.snapshot(document) }] });
        const res = await send({ type: 'add-rows', rows: rows.map((r) => ({ ...r, account })), source: location.pathname });
        const scanned = [...(flow.scanned || [])];
        const item = scanned.find((x) => x.account === account) || scanned[scanned.push({ account, rows: 0, added: 0, pages: 0 }) - 1];
        item.rows += rows.length; item.added += res?.added ?? 0; item.pages = pages;
        flow = (await send({ type: 'update-flow', patch: { pagesRead: pages, scanned } })) || flow;
        logPage('activity-scanned', { rowsRead: rows.length, page: pages });
      }
      if (pages >= MAX_PAGES_PER_ACCOUNT) break;
      const btn = findMoreButton();
      if (!btn) break;
      btn.click();
      let changed = false;
      for (let t = 0; t < 16 && !changed; t++) { await sleep(500); changed = sigOf(extractRows()) !== lastSig; }
      if (!changed) break; // click did nothing in this page (a full page load would have ended this script)
    }
    if (!stopped) await afterAccount(flow, account);
  }

  // After one account: next queued account, else offer the other accounts once, else finish.
  async function afterAccount(flow, account) {
    const doneAccounts = [...new Set([...(flow.doneAccounts || []), last4(account)])];
    if ((flow.queue || []).length) {
      await send({ type: 'update-flow', patch: { doneAccounts } });
      return goNextOrFinish({ ...flow, doneAccounts });
    }
    if (!flow.overviewVisited) {
      const link = findOverviewLink();
      if (link) {
        await send({ type: 'update-flow', patch: { doneAccounts, overviewVisited: true, queue: null, pagesRead: 0 } });
        banner('Done with this account. Opening your accounts page to check the others…');
        location.href = link.href;
        return;
      }
    }
    return goNextOrFinish({ ...flow, queue: [] });
  }

  async function chooseAccounts(flow) {
    const links = accountLinks();
    if (links.length === 1) {
      await send({ type: 'update-flow', patch: { queue: links } });
      return goNextOrFinish({ ...flow, queue: links });
    }
    const { accountPrefs = {} } = await chrome.storage.local.get('accountPrefs');
    const box = document.createElement('div');
    box.appendChild(document.createTextNode('Which accounts should I scan?'));
    const inputs = links.map((l) => {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      const key = l.label.match(/\d{4}(?!.*\d{4})/)?.[0] || l.label;
      const done = (flow.doneAccounts || []).includes(last4(l.label));
      cb.checked = !done && (accountPrefs[key] ?? /card|rewards|visa|mastercard|checking/i.test(l.label));
      if (done) l.label += ' (already scanned)';
      lab.append(cb, ' ', l.label);
      box.appendChild(lab);
      return { cb, l, key };
    });
    banner(box, [['Scan selected', async () => {
      const prefs = {};
      inputs.forEach(({ cb, key }) => { prefs[key] = cb.checked; });
      await chrome.storage.local.set({ accountPrefs: prefs });
      const queue = inputs.filter((i) => i.cb.checked).map((i) => i.l);
      if (!queue.length) return goNextOrFinish({ ...flow, queue: [] });
      await send({ type: 'update-flow', patch: { queue, overviewVisited: true } });
      goNextOrFinish({ ...flow, queue });
    }], ['Finish', () => goNextOrFinish({ ...flow, queue: [] })]]);
  }

  async function run() {
    let flow = await send({ type: 'get-flow' });
    if (!flow?.active) return;

    const deadline = Date.now() + 10 * 60 * 1000;
    let lastKind = null;
    while (!stopped && !handled && Date.now() < deadline) {
      const kind = classify();
      if (kind !== lastKind) {
        lastKind = kind;
        logPage(kind);
        if (kind === 'login') {
          banner('Please log in. I never touch the login form — I will continue once you are signed in.');
        } else if (kind === 'activity') {
          return scanActivity(flow);
        } else if (kind === 'overview') {
          flow = await send({ type: 'get-flow' });
          if (!flow?.active) return;
          if (flow.queue === null || flow.queue === undefined) return chooseAccounts(flow);
          return goNextOrFinish(flow);
        } else {
          banner('Waiting for your accounts page… If you are on a security check, finish it first.',
            [['Scan this page', () => { handled = true; scanActivity(flow); }],
             ['Finish', () => { handled = true; goNextOrFinish({ ...flow, queue: [] }); }]]);
        }
      }
      await sleep(1500);
    }
  }

  run();
})();
