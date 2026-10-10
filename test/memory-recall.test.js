import test from 'node:test';
import assert from 'node:assert/strict';
import { isPastIntent, isConversationMeta, recallWindowDays, recallTopicTerms } from '../src/conversations.js';
import { buildSystemPrompt } from '../src/ai/prompt.js';

test('recognizes natural-language saved-chat recall requests', () => {
  for (const text of [
    'What have we been working on lately?',
    'Summarize my recent chats',
    'What did we talk about earlier?',
    'Summarize our chats for 4 days',
    'What have we discussed this week?',
    'What did we talk about regarding Supabase?'
  ]) assert.equal(isPastIntent(text), true, text);
});

test('ordinary reminders and current-news questions are not saved-chat recall', () => {
  assert.equal(isPastIntent('Remember to check the latest iPhone prices'), false);
  assert.equal(isPastIntent('What are the current iPhone prices?'), false);
});

test('current conversation and Memory meta questions are not web research', () => {
  assert.equal(isConversationMeta('Can you summarize this conversation?'), true);
  assert.equal(isConversationMeta('How do my Memory settings work?'), true);
  assert.equal(isConversationMeta('What is the current price of an iPhone?'), false);
});

test('recall windows are bounded and recognize common periods', () => {
  assert.equal(recallWindowDays('Summarize chats for 4 days'), 4);
  assert.equal(recallWindowDays('What did we discuss last week?'), 7);
  assert.equal(recallWindowDays('What happened yesterday in our chats?'), 2);
  assert.equal(recallWindowDays('Show recent chats'), 7);
  assert.equal(recallWindowDays('Show chats for 900 days'), 365);
});

test('topic extraction removes recall filler words', () => {
  assert.deepEqual(recallTopicTerms('What did we discuss about Supabase and login?'), ['supabase', 'login']);
});

test('system prompt reflects Memory state', () => {
  assert.match(buildSystemPrompt({ memory: true }), /Memory is ON/);
  assert.match(buildSystemPrompt({ memory: false }), /Memory is OFF/);
  assert.doesNotMatch(buildSystemPrompt({ memory: null }), /Memory is (?:ON|OFF)/);
});
