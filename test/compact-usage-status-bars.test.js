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
  assert.ok(meter.includes('row.append(top, bar)'));
  assert.ok(!meter.includes('setting-hint'));
  assert.ok(!meter.includes('foot'));
  const usage = js.slice(end, js.indexOf('  // Keep the usage display current', end));
  for (const text of ['tokens remaining', 'made, ', 'Resets Monday', 'Resets at midnight', 'Sign in for your own allowance']) {
    assert.ok(!usage.includes(text), 'unexpected usage disclaimer: ' + text);
  }
  assert.ok(usage.includes('Weekly token usage'));
  assert.ok(usage.includes('Pictures ${per}'));
});
