import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildSystemPrompt } from '../src/ai/prompt.js';

test('NasrinAI gives people the in-app FAQ deep link, not the raw Markdown URL', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /https:\/\/nasrinai\.com\/\?faq=1/);
  assert.match(prompt, /Never expose the raw \/faq\.md source URL/);
});

test('FAQ deep link opens the existing Help & Support settings page', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /params\.get\('faq'\) !== '1'/);
  assert.match(app, /openSettings\(\);\s*showPage\('helpSupport'\);/);
  assert.match(app, /net\('\/faq\.md'\)/);
});
