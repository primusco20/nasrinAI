import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('tablet layout scales workspace gutters and constrains the welcome area', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width: 48rem\) and \(max-width: 69\.99rem\)/);
  assert.match(css, /--column: 56rem/);
  assert.match(css, /padding-inline: clamp\(1\.25rem, 3vw, 2rem\)/);
  assert.match(css, /\.welcome \{ max-width: 42rem; margin-inline: auto; \}/);
});
