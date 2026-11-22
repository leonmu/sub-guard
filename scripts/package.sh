#!/bin/sh
# Builds the Chrome Web Store upload: only the files the extension needs (no tests, store assets or docs).
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/bank-charge-subscription-finder-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"
zip -q -X "$OUT" manifest.json analyze.js background.js content.js details.js extract.js popup.js results.js \
  details.html popup.html results.html style.css icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png
echo "$OUT"
unzip -l "$OUT" | tail -1
