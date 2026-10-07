import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConnectUrl } from '../src/connect/index.js';

test('Connect URL normalization accepts HTTPS origins only', () => {
  assert.deepEqual(normalizeConnectUrl('https://Example.com'), { origin: 'https://example.com', host: 'example.com' });
  assert.throws(() => normalizeConnectUrl('http://example.com'), /HTTPS/);
  assert.throws(() => normalizeConnectUrl('https://example.com/path'), /HTTPS|origin/i);
  assert.throws(() => normalizeConnectUrl('https://127.0.0.1'), /supported|local/i);
  assert.throws(() => normalizeConnectUrl('https://user:pass@example.com'), /HTTPS/);
  assert.throws(() => normalizeConnectUrl('https://example.com:444'), /HTTPS/);
});


test('Connect URL normalization rejects non-origin paths and unsafe hosts', () => {
  assert.throws(() => normalizeConnectUrl('https://example.com/?x=1'), /HTTPS|origin/i);
  assert.throws(() => normalizeConnectUrl('https://[::1]'), /supported|local/i);
  assert.throws(() => normalizeConnectUrl('https://foo.local'), /supported|local/i);
});
