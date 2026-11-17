// Guards the privacy promise: "Your data never leaves your browser."
// Fails if any change adds a way to send data off the device. Change PRIVACY.md before changing this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const shipped = readdirSync(root).filter((f) => /\.(js|html)$/.test(f)); // exactly what scripts/package.sh ships
const source = (f) => readFileSync(join(root, f), 'utf8');

test('extension pages and the background worker cannot make network requests', () => {
  const csp = manifest.content_security_policy?.extension_pages || '';
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/); // no remote scripts
});

test('the only site the extension can touch is bankofamerica.com', () => {
  assert.deepEqual(manifest.host_permissions, ['https://*.bankofamerica.com/*']);
  for (const cs of manifest.content_scripts) assert.deepEqual(cs.matches, ['https://*.bankofamerica.com/*']);
  assert.ok(!manifest.externally_connectable, 'no other site or extension may message it');
});

test('no permission that could move data elsewhere', () => {
  const risky = ['webRequest', 'declarativeNetRequest', 'identity', 'cookies', 'history', 'tabs', 'downloads', 'nativeMessaging', 'management'];
  assert.deepEqual(manifest.permissions.filter((p) => risky.includes(p)), []);
});

test('no code sends data anywhere', () => {
  const senders = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|RTCPeerConnection|importScripts\s*\(|navigator\.share|storage\.sync/;
  for (const f of shipped) {
    const hit = source(f).match(senders);
    assert.equal(hit, null, `${f} contains "${hit?.[0]}"`);
  }
});

test('pages load nothing from the internet', () => {
  for (const f of shipped.filter((x) => x.endsWith('.html'))) {
    assert.doesNotMatch(source(f), /(src|href)\s*=\s*["']?(https?:)?\/\//i, `${f} loads a remote resource`);
  }
});
