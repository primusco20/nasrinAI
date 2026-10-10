import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Settings appearance spacing stays compact in iOS Home Screen display modes', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width:700px\)\s*\{\s*\.appearance-control\{max-width:32rem\}\s*\}/);
  assert.match(css, /@media \(display-mode: standalone\), \(display-mode: fullscreen\)\s*\{\s*\.settings-sheet \.settings-appearance\{margin-top:\.75rem\}\s*\}/);
});
