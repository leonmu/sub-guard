# Chrome Web Store submission

Everything needed for the Chrome Web Store developer dashboard, field by field.

## Package
`npm run package` → `dist/sub-guard-<version>.zip`. Upload that file.

## Store listing

**Name:** Sub Guard

**Summary (≤132 chars):** Finds subscriptions in your Bank of America transactions and reminds you before they renew. Your data never leaves your browser.

**Category:** Productivity → Tools (or Lifestyle → Shopping if Tools is unavailable)

**Language:** English

**Description:**

> Forgot to cancel a subscription again? Sub Guard finds every recurring charge on your Bank of America
> cards and accounts, and reminds you before each one renews.
>
> HOW IT WORKS
> • Click "Analyze Bank of America". A Bank of America tab opens and you log in as usual. Sub Guard never touches the login form.
> • Sub Guard reads your account activity, up to about a year back, across the accounts you choose.
> • You get a report of this month's subscriptions, plus a "suspicious" list: repeat charges that might be subscriptions.
> • Three days before a subscription renews, you get a notification. If you haven't scanned in a month, it reminds you to.
>
> YOUR DATA STAYS ON YOUR COMPUTER
> • No server, no account, no analytics. Nothing is sent anywhere.
> • The extension can only access bankofamerica.com, and its pages are blocked from making network requests.
> • Delete everything with one click, or by removing the extension.
>
> ALSO
> • Mark charges as "not a subscription" or add your own notes.
> • Import a CSV exported from Bank of America instead of scanning.
> • Browse and filter every transaction it read, and export them as CSV.
>
> Sub Guard is open source: https://github.com/leonmu/sub-guard
> Not affiliated with or endorsed by Bank of America.

**Screenshots (1280×800):** `store/screenshot-report.png`, `store/screenshot-details.png` (made-up demo data)

**Icon (128×128):** `icons/icon128.png`

**Homepage / support URL:** https://github.com/leonmu/sub-guard

**Privacy policy URL:** https://github.com/leonmu/sub-guard/blob/main/PRIVACY.md

## Privacy practices tab

**Single purpose:** Find recurring charges (subscriptions) in the user's Bank of America transactions and remind
the user before they renew.

**Permission justifications:**
- `host_permissions: https://*.bankofamerica.com/*`: reads the transaction list on Bank of America activity pages,
  only during a scan the user starts, only in the tab that scan opened.
- `storage`: keeps the user's transactions, detected subscriptions, notes and settings locally.
- `unlimitedStorage`: stores copies of the activity pages read during a scan, so results can be rebuilt without
  logging in again. These can exceed the default 10 MB quota.
- `alarms`: checks a few times a day for subscriptions renewing within 3 days, and for a missing monthly scan.
- `notifications`: shows those renewal and monthly-scan reminders.

**Remote code:** No, I am not using remote code.

**Data usage:** tick **Financial and payment information** (transactions are read and stored locally). Leave
everything else unticked. Then certify all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

## Distribution
- **Visibility:** Public, or Unlisted (only people with the link can install it).
- **Regions:** All regions (it only works with US Bank of America accounts, so United States only also makes sense).

## Notes for review (optional field)
The extension only activates on bankofamerica.com after the user clicks "Analyze Bank of America", and only in
the tab it opened. It never reads or fills login fields. All data stays in chrome.storage.local, and extension
pages use `connect-src 'none'`. Source code: https://github.com/leonmu/sub-guard
