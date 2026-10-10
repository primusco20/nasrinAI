import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVideos } from '../src/videos.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { PLATFORM_TENANT_ID } from '../src/tenants.js';

test('completed marketing video is reused only for the same owner and exact generation inputs', async () => {
  const store = createMemoryStore();
  const calls = [];
  const provider = {
    id: 'test-veo', model: 'veo-test', resolution: '720p',
    async create(input) { calls.push(input); return 'models/job-1'; },
    async status() { return { done: true }; },
    extract() { return { done: true, failed: false, uri: 'https://provider.example/video.mp4' }; },
    async download() { return Buffer.from('small-test-video'); },
    async extend() { throw new Error('not expected for a one-step test video'); }
  };
  const videos = createVideos({
    store,
    plans: { async current() { return { plan: 'max', open: false }; } },
    provider,
    limiter: { async signIn() {} },
    config: { video: { perHour: 10 } },
    logger: { info() {}, warn() {} }
  });
  const caller = { tenantId: PLATFORM_TENANT_ID, actor: { type: 'user', id: 'marketing-owner' } };

  const first = await videos.create(caller, { prompt: 'Product launch hero video', seconds: 1, aspect_ratio: '16:9' });
  assert.equal(first.status, 'in_progress');
  const completed = await videos.status(caller, first.video_id);
  assert.equal(completed.status, 'completed');

  const repeat = await videos.create(caller, { prompt: 'Product launch hero video', seconds: 1, aspect_ratio: '16:9', reuse_cached: true });
  assert.equal(repeat.video_id, first.video_id);
  assert.equal(repeat.status, 'completed');
  assert.equal(repeat.cache_hit, true);
  assert.equal(calls.length, 1, 'cache hit must not invoke the video provider again');

  const different = await videos.create(caller, { prompt: 'Product launch hero video', seconds: 1, aspect_ratio: '9:16', reuse_cached: true });
  assert.notEqual(different.video_id, first.video_id);
  assert.equal(calls.length, 2, 'aspect ratio changes must be a cache miss');

  const otherOwner = { ...caller, actor: { type: 'user', id: 'marketing-owner-2' } };
  const privateCopy = await videos.create(otherOwner, { prompt: 'Product launch hero video', seconds: 1, aspect_ratio: '16:9', reuse_cached: true });
  assert.notEqual(privateCopy.video_id, first.video_id, 'one owner must not reuse another owner’s cache entry');
  assert.equal(calls.length, 3);
});
