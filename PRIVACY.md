# Bank Charge Subscription Finder privacy policy

_Last updated: November 22, 2026_

Bank Charge Subscription Finder is a Chrome extension that finds recurring charges (subscriptions) in your Bank of America
transactions and reminds you before they renew.

## Summary

**Your data never leaves your browser.** The extension has no server, no account, no analytics and no tracking.
It does not sell, share or transfer your data to anyone.

## What the extension reads

Only when you start a scan, and only in the tab that scan opens, the extension reads the Bank of America
account activity pages you're logged in to: transaction dates, descriptions, amounts and the account name.
You can also import a CSV file you downloaded from your bank.

The extension never reads, fills in or stores your login details. You log in yourself.

## What the extension stores, and where

Everything is kept in Chrome's local extension storage (`chrome.storage.local`) on your computer:

- the transactions it read, and copies of the activity pages it read (with scripts, images and form fields
  removed), so the list can be rebuilt without logging in again
- the subscriptions it found, and your own notes and choices (removed, marked as subscription)
- settings such as which accounts to scan

## What the extension sends

Nothing. The extension's pages are blocked from making network requests (`connect-src 'none'`), and the
extension can only access `bankofamerica.com`. Reminders are local Chrome notifications.

An automated test in the source code ([test/privacy.test.js](test/privacy.test.js)) fails if any change would add a way
to send data out, so this stays true in future versions.

## Permissions

- **bankofamerica.com**: to read your transaction pages during a scan you start.
- **storage, unlimitedStorage**: to keep your transactions and saved pages on your computer.
- **alarms, notifications**: to check for upcoming renewals and remind you.

## Deleting your data

Click **Delete all data** on the extension's Details page, or remove the extension. Both erase everything
it stored.

## Not affiliated with Bank of America

Bank Charge Subscription Finder is an independent project. It is not made, endorsed or supported by Bank of America.

## Contact

Questions or problems: open an issue at https://github.com/leonmu/sub-guard/issues
