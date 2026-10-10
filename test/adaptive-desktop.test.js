import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('desktop navigation is accessible and delegates to existing controls', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const id of ['desktopNewChat', 'desktopHistoryBtn', 'desktopSettingsBtn']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /class="desktop-rail" aria-label="NasrinAI desktop navigation"/);
  assert.match(css, /@media \(min-width: 70rem\)/);
  assert.match(css, /max-aspect-ratio: 4\/3/);
  assert.match(js, /desktopNewChat'\)\?\.addEventListener\('click', \(\) => \$\('newChat'\)\?\.click\(\)/);
  assert.match(js, /desktopHistoryBtn'\)\?\.addEventListener\('click', \(\) => \$\('historyBtn'\)\?\.click\(\)/);
  assert.match(js, /desktopSettingsBtn'\)\?\.addEventListener\('click', \(\) => \$\('settingsBtn'\)\?\.click\(\)/);
  assert.doesNotMatch(html, /\son(?:click|load|error)\s*=/i);
});
