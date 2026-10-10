import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVideos } from '../src/videos.js';

function service(plan, open = false) {
  const created = [];
  const videos = createVideos({
    store: { async addVideo(row) { created.push(row); return 'video-id'; } },
    plans: { async current() { return { plan, open }; } },
    provider: { id: 'fake-video', async create() { return { operation: 'fake-op' }; } },
    limiter: { async signIn() {} },
    config: { video: { perHour: 2 } },
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
