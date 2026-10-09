import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, ASK_RULE, FILE_RULE, VOICE_RULE } from '../src/ai/prompt.js';
import { plainForSpeech } from '../src/ai/speech-text.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { buildTestApp, serve, bearer, postJson } from './helpers.js';

test('prompt: questions, files and spoken style are added only when asked for', () => {
  const plain = buildSystemPrompt({});
  assert.ok(!plain.includes('[[ask]]') && !plain.includes('[[file'), 'other callers never get the page markup');
  const page = buildSystemPrompt({ blocks: true });
  assert.ok(page.includes(ASK_RULE) && page.includes(FILE_RULE));
  assert.match(FILE_RULE, /same deliverable in multiple formats/i);
  assert.match(FILE_RULE, /one complete file block for each requested supported format/i);
  assert.match(FILE_RULE, /Do not claim a downloadable file exists unless you provide its file block/i);
  assert.match(FILE_RULE, /requested format is not supported/i);
  const spoken = buildSystemPrompt({ blocks: true, voice: true });
  assert.ok(spoken.includes(VOICE_RULE) && spoken.includes(FILE_RULE) && !spoken.includes(ASK_RULE), 'spoken: files yes, tap-questions no');
  const only = buildSystemPrompt({ blocks: true, knowledgeOnly: true });
  assert.ok(!only.includes('[[ask]]') && !only.includes('[[file'), 'knowledge-only businesses keep plain answers');
});

test('speech: question and file blocks are never read aloud', () => {
  const said = plainForSpeech('Here you go.\n[[file name="plan.md"]]\n# Plan\nsecret body\n[[/file]]\nAny changes?\n[[ask]]\nWhich colour? | Red | Blue\n[[/ask]]');
  assert.doesNotMatch(said, /secret body|Which colour|\[\[/);
  assert.match(said, /Here you go\./);
  assert.match(said, /file is ready/);
  // Cut off in the middle of a block (a long reply stopped early).
  assert.doesNotMatch(plainForSpeech('Done.\n[[file name="a.txt"]]\nhalf of a fi'), /half of a fi/);
});

async function withApp(provider, fn) {
  const built = buildTestApp({ provider });
  const srv = await serve(built.app);
  try {
    const g = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    await fn({ url: srv.url, g });
  } finally { await srv.close(); }
}

test('chat: blocks and voice reach the prompt; they must be true or false; long file replies are kept whole', async () => {
  const longFile = '[[file name="big.md"]]\n' + 'line of the report\n'.repeat(700) + '[[/file]]\nDone.';
  const provider = createFakeProvider({ reply: ({ messages }) => (/make a report/.test(messages.at(-1).content) ? longFile : 'Hello there.') });
  await withApp(provider, async ({ url, g }) => {
    const plain = await postJson(url + '/v1/chat', { message: 'hi' }, bearer(g));
    assert.equal(plain.status, 200);
    assert.doesNotMatch(provider.calls.at(-1).system, /\[\[ask\]\]/);

    const page = await postJson(url + '/v1/chat', { message: 'hello again', blocks: true }, bearer(g));
    assert.equal(page.status, 200);
    assert.match(provider.calls.at(-1).system, /\[\[ask\]\]/);

    const talk = await postJson(url + '/v1/chat', { message: 'say hi', blocks: true, voice: true }, bearer(g));
    assert.equal(talk.status, 200);
    assert.match(provider.calls.at(-1).system, /spoken conversation/);

    const bad = await postJson(url + '/v1/chat', { message: 'hi', blocks: 'yes' }, bearer(g));
    assert.equal(bad.status, 400);

    const file = await postJson(url + '/v1/chat', { message: 'please make a report', blocks: true }, bearer(g));
    assert.equal(file.status, 200);
    const reply = (await file.json()).message.content;
    assert.ok(reply.length > 8000 && reply.includes('[[/file]]'), 'a reply holding a file is not cut at 8,000 characters');

    const noPage = await postJson(url + '/v1/chat', { message: 'please make a report' }, bearer(g));
    assert.ok((await noPage.json()).message.content.length <= 8001, 'without the page flag the usual cap holds');
  });
});

test('prompt: Nasrin Abubakar is referred to as he/him/his', () => {
  assert.match(buildSystemPrompt({}), /Nasrin Abubakar, your creator, is a man[^\n]*he, him and his/);
});
