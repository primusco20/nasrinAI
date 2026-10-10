import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/creative-intent.js', import.meta.url), 'utf8');
const sandbox = {};
vm.runInNewContext(source, sandbox);
const detect = sandbox.NasrinCreativeIntent.detect;

test('detects common image creation prompts', () => {
  for (const prompt of [
    'Create an image',
    'Generate a picture of a cat',
    'Make me a poster',
    'I need a product photo',
    'Design a banner for my shop',
    'Please create a logo'
  ]) assert.equal(detect(prompt), 'image', prompt);
});

test('detects common video creation prompts', () => {
  for (const prompt of [
    'Create a video',
    'Generate a video for my ad',
    'Make me a promotional video',
    'Create a reel for my business',
    'Animate this picture into a video',
    'I want a short film'
  ]) assert.equal(detect(prompt), 'video', prompt);
});

test('keeps informational questions in normal chat', () => {
  for (const prompt of [
    'What is video generation?',
    'How do image models work?',
    'Can you explain how to create a video?',
    'Tell me about photo editing'
  ]) assert.equal(detect(prompt), null, prompt);
});

test('does not classify a video thumbnail as a video deliverable', () => {
  assert.equal(detect('Create a video thumbnail'), 'image');
});

test('ignores empty and unrelated prompts', () => {
  assert.equal(detect(''), null);
  assert.equal(detect('Help me plan my week'), null);
});
