import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN } from './helpers.js';

const OTHER_USER_TOKEN = 'other.header.signature';

async function app() {
  const calls = [];
  const videos = {
    async create(caller, body) {
      calls.push({ caller, body });
      return { video_id: 'video-job-1', status: 'in_progress', progress: 0, target_seconds: 60 };
    }
  };
  const built = buildTestApp({
    videos,
    verifyUser: async (token) => {
      if (token === USER_TOKEN) return { id: 'user-1' };
      if (token === OTHER_USER_TOKEN) return { id: 'user-2' };
      return null;
    }
  });
  const srv = await serve(built.app);
  return { ...built, ...srv, calls };
}

async function createConversation(a, token) {
  const response = await postJson(a.url + '/v1/conversations', {}, bearer(token));
  assert.equal(response.status, 201);
  return (await response.json()).conversation.id;
}

test('video creation accepts an owned conversation and rejects invalid or foreign conversations', async () => {
  const a = await app();
  try {
    const ownedId = await createConversation(a, USER_TOKEN);
    const foreignId = await createConversation(a, OTHER_USER_TOKEN);

    const owned = await postJson(a.url + '/v1/videos', {
      prompt: 'A calm ocean at sunrise',
      conversation_id: ownedId
    }, bearer(USER_TOKEN));
    assert.equal(owned.status, 202);
    assert.equal(a.calls.length, 1, 'owned conversation reaches video creation');
    assert.equal(a.calls[0].body.conversation_id, ownedId);

    const foreign = await postJson(a.url + '/v1/videos', {
      prompt: 'A calm ocean at sunrise',
      conversation_id: foreignId
    }, bearer(USER_TOKEN));
    assert.equal(foreign.status, 404);
    assert.equal((await foreign.json()).error.code, 'not_found');

    const malformed = await postJson(a.url + '/v1/videos', {
      prompt: 'A calm ocean at sunrise',
      conversation_id: 'not-a-uuid'
    }, bearer(USER_TOKEN));
    assert.equal(malformed.status, 404);
    assert.equal((await malformed.json()).error.code, 'not_found');

    const missing = await postJson(a.url + '/v1/videos', {
      prompt: 'A calm ocean at sunrise',
      conversation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    }, bearer(USER_TOKEN));
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'not_found');

    assert.equal(a.calls.length, 1, 'invalid or foreign conversation never reaches video provider/service');
  } finally {
    await a.close();
  }
});
