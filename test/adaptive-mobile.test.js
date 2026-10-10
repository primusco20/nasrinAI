import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile layout respects safe areas and compact landscape height', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 47\.99rem\)/);
  assert.match(css, /padding-left: max\(\.75rem, env\(safe-area-inset-left\)\)/);
  assert.match(css, /padding-right: max\(\.75rem, env\(safe-area-inset-right\)\)/);
  assert.match(css, /max-height: 30rem\) and \(orientation: landscape\)/);
  assert.match(css, /overflow-x: clip/);
});
