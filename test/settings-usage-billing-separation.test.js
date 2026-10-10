import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, js, css] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.css', import.meta.url), 'utf8')
]);

test('Usage and Billing are distinct settings pages with independent navigation', () => {
  assert.ok(html.includes('data-page="usage"'), 'Usage navigation exists');
  assert.ok(html.includes('<span>Usage</span>'), 'Usage navigation label exists');
  assert.ok(html.includes('data-page="billing"'), 'Billing navigation exists');
  assert.ok(html.includes('<span>Billing</span>'), 'Billing navigation label exists');
  assert.ok(html.includes('id="billingPlanLabel"'), 'Billing row has a current-plan label on the right');
  assert.ok(js.includes("const billingPlanLabel = $('billingPlanLabel');"), 'plan label is updated from current plan data');
  assert.ok(js.includes("{ free: 'Free', pro: 'Pro', max: 'Max', ultra: 'Ultra' }[current]"), 'all supported current plan names are displayed');
  assert.ok(js.includes('billingPlanLabel.hidden = !account || !billingPlanName;'), 'plan label is hidden without a signed-in account or known plan');

  const usageStart = html.indexOf('<div class="settings-page" id="pageUsage"');
  const billingStart = html.indexOf('<div class="settings-page" id="pageBilling"');
  const aboutStart = html.indexOf('<div class="settings-page" id="pageAbout"', billingStart);
  assert.ok(usageStart >= 0 && billingStart > usageStart && aboutStart > billingStart,
    'separate Usage, Billing, and About pages exist');

  const usagePage = html.slice(usageStart, billingStart);
  assert.ok(usagePage.includes('id="usageList"'), 'Usage page contains usage meters');
  assert.ok(usagePage.includes('id="usageLoading"'), 'Usage page contains its loading indicator');
  assert.ok(!usagePage.includes('billingCurrent') && !usagePage.includes('billingHistory') &&
    !usagePage.includes('billingPlans'), 'Usage page contains no billing content');

  const billingPage = html.slice(billingStart, aboutStart);
  assert.ok(billingPage.includes('id="billingCurrent"'), 'Billing page contains current plan');
  assert.ok(billingPage.includes('id="billingHistory"'), 'Billing page contains payment history');
  assert.ok(billingPage.includes('id="billingPlans"'), 'Billing page contains plan choices');
  assert.ok(!billingPage.includes('usageList') && !billingPage.includes('usageLoading'),
    'Billing page contains no usage meters or loading indicator');
});

test('Usage refresh indicator is inline with the Usage heading and refreshes only on Usage page', () => {
  const headingStart = html.indexOf('class="usage-section-heading"');
  const headingEnd = html.indexOf('</div>', headingStart);
  const usageHeading = html.slice(headingStart, headingEnd);
  assert.ok(headingStart >= 0 && headingEnd > headingStart, 'Usage heading container exists');
  assert.ok(usageHeading.includes('<p class="menu-label">Usage</p>'), 'Usage heading is present');
  assert.ok(usageHeading.includes('id="usageLoading"'), 'loading indicator is inside the heading row');

  assert.ok(js.includes("usage: ['pageUsage', 'Usage']"), 'Usage is registered as a separate page');
  assert.ok(js.includes("if (name === 'usage') loadUsage();"), 'opening Usage loads usage data');
  assert.ok(js.includes("if (name === 'billing') loadBilling();"), 'opening Billing loads billing data');
  assert.ok(js.includes("const usagePage = $('pageUsage');"), 'periodic refresh checks the Usage page');
  assert.ok(js.includes('usagePage && !usagePage.hidden && !document.hidden'),
    'periodic refresh only runs while Usage is visible');
  assert.ok(css.includes('align-items: center'), 'heading row vertically aligns its contents');
  assert.ok(css.includes('.usage-loading[hidden] { display: none !important;'),
    'hidden loading indicator stays hidden');
});
