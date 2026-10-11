import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVideos } from '../src/videos.js';
import { createBudget } from '../src/ai/budget.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { testConfig } from './helpers.js';

function service(plan, open = false) {
  const created = [];
  const config = testConfig({ DAILY_BUDGET_USD: '40', WEEKLY_BUDGET_USD: '100', MONTHLY_BUDGET_USD: '300', VIDEO_PER_HOUR: '10' });
  const store = createMemoryStore();
  store.addVideo = async (row) => { created.push(row); return 'video-id'; };
  store.getConversation = async (id) => {
    if (id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') {
      return { id, tenantId: 'tenant-1', ownerType: 'user', ownerId: 'user-1' };
    }
    if (id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') {
      return { id, tenantId: 'tenant-1', ownerType: 'user', ownerId: 'user-2' };
    }
    return null;
  };
  const budget = createBudget({ store, config, logger: { info() {}, warn() {}, error() {} } });
  const videos = createVideos({
    store,
    plans: { async current() { return { plan, open }; } },
    provider: { id: 'fake-video', model: 'veo-3.1-generate-preview', resolution: '1080p', async create() { return { operation: 'fake-op' }; } },
    limiter: { async signIn() {} },
    budget,
    config,
    logger: { info() {} }
  });
  return { videos, created };
}

const caller = { actor: { type: 'user', id: 'user-1' }, tenantId: 'tenant-1' };
const body = { prompt: 'A peaceful ocean at sunrise' };

for (const plan of ['max', 'ultra']) {
  test('video creation is allowed on ' + plan + ' plan', async () => {
    const { videos, created } = service(plan);
    const result = await videos.create(caller, body);
    assert.equal(result.status, 'in_progress');
    assert.equal(created.length, 1);
  });
}

for (const plan of ['quick', 'pro', 'free']) {
  test('video creation is rejected on ' + plan + ' plan', async () => {
    const { videos, created } = service(plan);
    await assert.rejects(() => videos.create(caller, body), (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'video_plan_required');
      return true;
    });
    assert.equal(created.length, 0);
  });
}

test('video creation is rejected for open/unpaid plan status', async () => {
  const { videos, created } = service('ultra', true);
  await assert.rejects(() => videos.create(caller, body), (err) => {
    assert.equal(err.status, 403);
    assert.equal(err.code, 'video_plan_required');
    return true;
  });
  assert.equal(created.length, 0);
});

test('video creation is rejected for guest callers', async () => {
  const { videos, created } = service('ultra');
  await assert.rejects(() => videos.create({ actor: { type: 'guest', id: 'guest-1' }, tenantId: 'tenant-1' }, body), (err) => {
    assert.equal(err.status, 403);
    assert.equal(err.code, 'video_plan_required');
    return true;
  });
  assert.equal(created.length, 0);
});

test('video creation accepts only a caller-owned conversation', async () => {
  const { videos, created } = service('max');
  const owned = await videos.create(caller, {
    ...body,
    conversation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  });
  assert.equal(owned.status, 'in_progress');
  assert.equal(created.length, 1);
  assert.equal(created[0].conversationId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

  for (const conversation_id of [
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'not-a-uuid',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ]) {
    await assert.rejects(
      () => videos.create(caller, { ...body, conversation_id }),
      (err) => {
        assert.equal(err.status, 404);
        assert.equal(err.code, 'not_found');
        return true;
      }
    );
  }
  assert.equal(created.length, 1, 'foreign, malformed, and missing conversations never create a video job');
});
