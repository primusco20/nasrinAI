import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/ai/prompt.js';

test('benign questions about NasrinAI professional roles receive a useful public explanation', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /“professionals”/);
  assert.match(prompt, /Business Analyst, Operations Manager, Sales Manager, Finance, Software Developer, Data Analyst, HR, or Content Writer/);
  assert.match(prompt, /Never answer a question about professionals with a generic refusal/);
});

test('professional-role explanations preserve boundaries around private technical details', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /foundation model powers you/);
  assert.match(prompt, /credentials, API keys, environment variables/);
  assert.match(prompt, /Do not reveal operational secrets/);
});
