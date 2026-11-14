// Page reading shared by the BofA tab (content script, live page with layout) and the Details page
// (re-reading saved snapshots with DOMParser, no layout). Classic script: exposes globalThis.SubGuardExtract.
(function (g) {
  const DATE_RE = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]{2}[a-z]*\.? \d{1,2},? \d{4})\b/;
  const AMOUNT_RE = /(\(?[-−]?\s?\$\s?[\d,]+\.\d{2}\)?)/g;
  const AMOUNT_ONLY = /^\(?[-−]?\s?\$\s?[\d,]+\.\d{2}\)?$/;
  const ROW_SEL = 'tr, [role="row"], [class*="transaction" i][class*="row" i], li[class*="transaction" i]';
  // Buttons and screen-reader-only text (BofA puts "Expand transaction for Transaction date: ..." in every row).
  const HIDDEN_SEL = 'button, [role="button"], [aria-hidden="true"], .ada-hidden, .sr-only, .visually-hidden, ' +
    '.screen-reader-text, [class*="ada-hidden" i], [class*="sr-only" i], [class*="visually-hidden" i]';
  const JUNK_TEXT = /expand transaction|collapse transaction|transaction date:|^(details|view details|more)$/i;
  const BALANCE_ROW = /\b(beginning|ending|opening|closing) balance\b|\bbalance as of\b/i;

  const hasLayout = (el) => !!(el.ownerDocument || el).defaultView;

  function visible(el) {
    if (!el) return false;
    if (!hasLayout(el)) return !el.closest('[data-sg-hidden]');
    return el.offsetParent !== null && el.getClientRects().length > 0;
  }

  // Text nodes joined with spaces, so adjacent cells don't run together ("11/03/2026CURSOR").
  function joinText(el) {
    const doc = el.ownerDocument || el;
    const w = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
    const parts = [];
    let n;
    while ((n = w.nextNode())) {
      const t = n.textContent.trim();
      if (t && !(n.parentElement && n.parentElement.closest('script,style'))) parts.push(t);
    }
    return parts.join(' ');
  }

  function seenText(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll(HIDDEN_SEL).forEach((h) => h.remove());
    return joinText(c).replace(/\s+/g, ' ').trim();
  }

  function cellsOf(row) {
    let cells = [...row.querySelectorAll('td, th, [role="cell"], [role="gridcell"]')];
    if (!cells.length) cells = [...row.children];
    return cells.map(seenText).filter((t) => t && !JUNK_TEXT.test(t));
  }

  function extractRows(root) {
    const seen = new Set();
    const out = [];
    for (const row of root.querySelectorAll(ROW_SEL)) {
      if (!visible(row) || row.querySelector(ROW_SEL)) continue; // skip containers of other rows
      const text = seenText(row);
      if (!text || text.length > 600 || seen.has(text) || BALANCE_ROW.test(text)) continue;
      const dm = text.match(DATE_RE);
      const amounts = text.match(AMOUNT_RE);
      if (!dm || !amounts) continue;
      const desc = cellsOf(row)
        .filter((c) => !AMOUNT_ONLY.test(c))
        .map((c) => c.replace(DATE_RE, '').trim())
        .filter((c) => c.length > 1)
        .sort((a, b) => b.length - a.length)[0];
      if (!desc) continue;
      seen.add(text);
      // First amount is the transaction; a second one is usually the running balance.
      out.push({ date: dm[1], desc, amount: amounts[0].replace(/\s/g, '') });
    }
    return out;
  }

  function accountLinks(root) {
    const links = new Map();
    for (const a of root.querySelectorAll('a[href]')) {
      if (!visible(a)) continue;
      const href = a.href;
      const text = (hasLayout(a) ? a.innerText : joinText(a) || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
      const looksLikeDetails = /target=acctDetails|acctDetails|accountdetails|account-details|adx=/i.test(href);
      const looksLikeAccount = /(checking|savings|card|rewards|visa|mastercard|amex|advantage)/i.test(text) && /\d{4}/.test(text);
      if ((looksLikeDetails || looksLikeAccount) && text && text.length < 120 && !links.has(href)) {
        links.set(href, { href, label: text });
      }
    }
    return [...links.values()];
  }

  // Copy of the live page for offline re-reading: rows hidden at save time are marked, and scripts,
  // styles, media and every form field are dropped.
  function snapshot(doc) {
    const hidden = [...doc.querySelectorAll(ROW_SEL)].filter((r) => !visible(r));
    hidden.forEach((r) => r.setAttribute('data-sg-hidden', '1'));
    const c = doc.documentElement.cloneNode(true);
    hidden.forEach((r) => r.removeAttribute('data-sg-hidden'));
    c.querySelectorAll('script, style, link, svg, img, picture, video, iframe, noscript, canvas, input, textarea, select, form[action*="signin" i]')
      .forEach((e) => e.remove());
    return '<!doctype html>' + c.outerHTML;
  }

  // Page layout with all text masked (letters → a, digits → 9), for debugging without seeing data.
  const mask = (t) => t.replace(/[A-Za-z]/g, 'a').replace(/\d/g, '9');
  function skeleton(doc, maxNodes = 3000) {
    const out = [];
    let n = 0;
    const walk = (el, depth) => {
      if (n++ > maxNodes || /^(SCRIPT|STYLE|SVG|NOSCRIPT|LINK|META|IFRAME)$/i.test(el.tagName)) return;
      if (!visible(el) && el !== doc.body) return;
      let line = '  '.repeat(depth) + el.tagName.toLowerCase();
      if (el.id) line += '#' + el.id;
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 4) : [];
      if (cls.length) line += '.' + cls.join('.');
      for (const a of ['role', 'data-testid', 'aria-label', 'name', 'type']) {
        const v = el.getAttribute(a);
        if (v) line += `[${a}=${a === 'aria-label' ? mask(v) : v}]`;
      }
      if (el.tagName === 'A' && el.getAttribute('href')) {
        line += ` href=${mask(el.getAttribute('href').replace(/\?.*$/, '')).slice(0, 80)}`;
      }
      const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).join(' ').trim();
      if (own) line += ` "${mask(own).slice(0, 60)}"`;
      out.push(line);
      for (const c of el.children) walk(c, depth + 1);
    };
    if (doc.body) walk(doc.body, 0);
    return out.join('\n');
  }

  g.SubGuardExtract = { DATE_RE, visible, extractRows, accountLinks, snapshot, skeleton, mask };
})(globalThis);
