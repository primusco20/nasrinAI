import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketingCacheKey } from '../src/marketing-cache.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { PLATFORM_TENANT_ID } from '../src/tenants.js';

test('marketing cache keys are deterministic fingerprints and do not expose source text', () => {
  const inputs = { prompt: 'Private campaign copy', model: 'veo-test', seconds: 15 };
  const key = marketingCacheKey('video', inputs);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, marketingCacheKey('video', inputs));
  assert.ok(!key.includes('Private campaign copy'));
});

test('marketing cache keys change when any generation input changes', () => {
  const base = { prompt: 'A blue bottle', aspectRatio: '16:9', model: 'model-a' };
  assert.notEqual(marketingCacheKey('image', base), marketingCacheKey('image', { ...base, prompt: 'A red bottle' }));
  assert.notEqual(marketingCacheKey('image', base), marketingCacheKey('image', { ...base, aspectRatio: '9:16' }));
  assert.notEqual(marketingCacheKey('image', base), marketingCacheKey('image', { ...base, model: 'model-b' }));
  assert.notEqual(marketingCacheKey('image', base), marketingCacheKey('video', base));
  assert.throws(() => marketingCacheKey('../unsafe', base), TypeError);
});

test('marketing cache storage isolates owners and expires entries', async () => {
  let now = 1_800_000_000_000;
  const store = createMemoryStore({ now: () => now });
  const key = marketingCacheKey('brief', { prompt: 'campaign brief' });
  const base = { tenantId: PLATFORM_TENANT_ID, ownerType: 'user', ownerId: 'owner-a', kind: 'brief', key };
  await store.setMarketingCache({ ...base, value: { summary: 'private result' }, ttlMs: 1000 });
  assert.deepEqual(await store.getMarketingCache(base), { summary: 'private result' });
  assert.equal(await store.getMarketingCache({ ...base, ownerId: 'owner-b' }), null);
  now += 1001;
  assert.equal(await store.getMarketingCache(base), null, 'expired entries are cache misses');
});
