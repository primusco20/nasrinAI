import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('usage meters render only the label, percentage, and progress bar', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = js.indexOf('  function meter(label, used, limit)');
  const end = js.indexOf('  async function loadUsage()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const meter = js.slice(start, end);
  assert.match(meter, /row\\.append\\(top, bar\\)/);
  assert.doesNotMatch(meter, /setting-hint|foot/);
  const usage = js.slice(end, js.indexOf('  // Keep the usage display current', end));
  assert.doesNotMatch(usage, /tokens remaining|made, .*left|Resets Monday|Resets at midnight|Sign in for your own allowance/);
  assert.match(usage, /Weekly token usage/);
  assert.match(usage, /Pictures \\${per}/);
});
