import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelCatalog } from '../src/ai/models.js';
import { memoryLogger, testConfig } from './helpers.js';

const guest = { tenantId: 't', actor: { type: 'guest', id: 'g' } };
const user = { tenantId: 't', actor: { type: 'user', id: 'u' } };

test('configured AI tiers remain visible when provider is temporarily unavailable', async () => {
  const catalog = createModelCatalog({
    provider: null,
    config: testConfig({}),
    logger: memoryLogger()
  });

  assert.deepEqual(await catalog.listFor(guest), {
    models: [{ id: 'nasrinai', name: 'Quick' }, { id: 'pro', name: 'Pro' }],
    default: 'nasrinai'
  });
  assert.deepEqual((await catalog.listFor(user)).models.map((model) => model.name), [
    'Quick', 'Pro', 'Max', 'Ultra'
  ]);
});
