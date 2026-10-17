import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Redesign R1 (docs/redesign.md): one set of design tokens, an adaptive
// background for light and dark, and one press/focus style for every control.
test('design tokens, adaptive background and shared press/focus states', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const root = /:root \{([\s\S]*?)\n\}/.exec(css)[1];
  for (const t of ['--space-1', '--space-8', '--tap: 2.75rem', '--radius-md', '--text-base', '--icon', '--dur', '--ease-spring', '--bg-glow', '--elev-1', '--elev-2', '--press']) {
    assert.ok(root.includes(t), `${t} is a token`);
  }
  // Both dark-mode blocks (system dark and the Dark setting) adapt the background.
  assert.equal((css.match(/--bg-glow: rgba\(255, 255, 255, 0\.035\);/g) || []).length, 2);
  assert.match(css, /body \{[\s\S]*?background: radial-gradient\([^;]*var\(--bg-glow\)[^;]*\) var\(--paper\);/);
  assert.match(css, /:where\(button, a\[href\], \[role="button"\], input, select, textarea\):focus-visible \{ outline: 2px solid var\(--ink\);/);
  assert.match(css, /:where\(\.icon-btn, \.text-btn, \.act\):active \{ transform: scale\(0\.94\); background: var\(--press\); \}/);
  assert.match(css, /\.menu-row:active \{ background: var\(--press\); \}/);
  assert.match(css, /:root\[data-motion="reduce"\] :where\([^)]*\):active \{ transform: none; \}/, 'Reduce motion turns the press scale off');
});
