import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Settings appearance section does not apply the sheet bottom safe area mid-page', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.settings-appearance\{\s*margin:\.75rem \.05rem \.15rem;\s*padding:\.65rem \.05rem \.2rem;/);
  assert.doesNotMatch(css, /\.settings-appearance\{[^}]*safe-area-inset-bottom/s);
});
