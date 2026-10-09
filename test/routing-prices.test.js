import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPrices, priceOf, costOf } from '../src/ai/pricing.js';

// Keep the models documented for current production routing billable by the
// policy. Unknown prices intentionally fail closed; a missing entry here can
// turn an otherwise healthy provider into a generic 503 for every request.
test('production routing model IDs have explicit conservative prices', () => {
  const prices = loadPrices();
  const expected = [
    ['gpt-6-luna', 0.1, 0.5],
    ['gpt-6.1-sol', 2, 10],
    ['gpt-6-astra', 10, 50],
    ['gpt-5.6-sol', 4, 20],
    ['gpt-5.4-mini', 0.75, 4.5],
    ['gpt-5.4', 2.5, 15],
    ['gpt-5.4-nano', 0.2, 1.25]
  ];
  for (const [model, input, output] of expected) {
    const price = priceOf(prices, 'openai', model);
    assert.ok(price, model + ' must not be treated as unpriced');
    assert.equal(price.input, input, model + ' input rate');
    assert.equal(price.output, output, model + ' output rate');
    assert.ok(costOf(price, { inputTokens: 1000, outputTokens: 1000 }) > 0, model + ' has a non-zero estimate');
  }
  assert.equal(priceOf(prices, 'openai', 'gpt-5.6-terra'), null,
    'unverified model names must continue to fail closed');
});
