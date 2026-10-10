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

test('Help & Support shows the email action without duplicating the support address', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /class="btn wide support-email" href="mailto:support@nasrinai\.com/);
  assert.doesNotMatch(html, /class="support-email-address"/);
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /The FAQ could not be loaded right now\. Email support@nasrinai\.com/);
});

test('creator attribution is only provided when the user explicitly asks', () => {
  const prompt = buildSystemPrompt();
  assert.doesNotMatch(prompt, /assistant created by Nasrin Abubakar/);
  assert.match(prompt, /Do not volunteer or spontaneously mention who created NasrinAI/);
  assert.match(prompt, /If the user explicitly asks who created or made NasrinAI, answer that NasrinAI was created by Nasrin Abubakar/);
});


test('every assistant reply shows a small muted AI disclaimer below reply actions', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(app, /className = 'reply-disclaimer'/);
  assert.match(app, /disclaimer\.textContent = 'NasrinAI is AI and can make mistakes\.'/);
  assert.match(app, /el\.appendChild\(replyActions\(text, id\)\);[\s\S]*?el\.appendChild\(disclaimer\);/);
  assert.match(css, /\.reply-disclaimer\s*\{[^}]*color:\s*var\(--ink-3\);[^}]*font-size:\s*0\.75rem;/);
  assert.doesNotMatch(css, /\.ai-accuracy-note/);
});
