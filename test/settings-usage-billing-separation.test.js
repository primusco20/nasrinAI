import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, js, css] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.css', import.meta.url), 'utf8')
]);

test('Usage and Billing are distinct settings pages with independent navigation', () => {
  assert.match(html, /data-page="usage"[\s\S]*?<span>Usage<\/span>/);
  assert.match(html, /data-page="billing"[\s\S]*?<span>Billing<\/span>/);
  assert.match(html, /id="pageUsage"/);
  assert.match(html, /id="pageBilling"/);

  const usagePage = html.match(/<div class="settings-page" id="pageUsage"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  assert.ok(usagePage, 'Usage page markup exists');
  assert.match(usagePage, /id="usageList"/);
  assert.match(usagePage, /id="usageLoading"/);
  assert.doesNotMatch(usagePage, /billingCurrent|billingHistory|billingPlans/);

  const billingPage = html.match(/<div class="settings-page" id="pageBilling"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  assert.ok(billingPage, 'Billing page markup exists');
  assert.match(billingPage, /id="billingCurrent"/);
  assert.match(billingPage, /id="billingHistory"/);
  assert.match(billingPage, /id="billingPlans"/);
  assert.doesNotMatch(billingPage, /usageList|usageLoading/);
});

test('Usage refresh indicator is inline with the Usage heading and refreshes only on Usage page', () => {
  assert.match(html, /class="usage-section-heading"[\s\S]*?<p class="menu-label">Usage<\/p>[\s\S]*?id="usageLoading"/);
  assert.match(js, /usage: \['pageUsage', 'Usage'\]/);
  assert.match(js, /if \(name === 'usage'\) loadUsage\(\);/);
  assert.match(js, /if \(name === 'billing'\) loadBilling\(\);/);
  assert.match(js, /const usagePage = \$\('pageUsage'\);[\s\S]*?usagePage\.hidden/);
  assert.match(css, /\.usage-section-heading\s*\{[^}]*align-items:\s*center/);
  assert.match(css, /\.usage-loading\[hidden\]\s*\{\s*display:\s*none !important;/);
});
