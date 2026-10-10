import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPROVEMENT_EXAMPLE_CONSENT_VERSION,
  MAX_IMPROVEMENT_EXAMPLE_CHARS,
  prepareImprovementExample
} from '../src/improvement/eligibility.js';

const consent = { decision: 'granted', version: IMPROVEMENT_EXAMPLE_CONSENT_VERSION };
const safeText = 'The answer skipped a key step in the explanation. Please explain the reasoning and give a clear example.';

test('improvement example gate fails closed without exact affirmative consent', () => {
  assert.deepEqual(prepareImprovementExample({ text: safeText, subjectType: 'user' }), {
    eligible: false, reason: 'valid_consent_required'
  });
  assert.equal(prepareImprovementExample({
    text: safeText, subjectType: 'user', consent: { decision: 'granted', version: '2026-10-10-preference-only' }
  }).eligible, false);
  assert.equal(prepareImprovementExample({
    text: safeText, subjectType: 'user', consent: { decision: 'withdrawn', version: IMPROVEMENT_EXAMPLE_CONSENT_VERSION }
  }).reason, 'valid_consent_required');
});

test('only the explicitly supported purpose and subject types are accepted', () => {
  assert.equal(prepareImprovementExample({ text: safeText, consent, subjectType: 'service' }).reason, 'invalid_subject');
  assert.equal(prepareImprovementExample({ text: safeText, consent, subjectType: 'user', purpose: 'marketing' }).reason, 'unsupported_purpose');
});

test('short and oversized candidates are rejected', () => {
  assert.equal(prepareImprovementExample({ text: 'Too short.', consent, subjectType: 'user' }).reason, 'too_short');
  assert.equal(prepareImprovementExample({ text: 'x'.repeat(MAX_IMPROVEMENT_EXAMPLE_CHARS + 1), consent, subjectType: 'user' }).reason, 'too_long');
});

test('credentials, tokens, and private keys are rejected instead of cached', () => {
  for (const secret of [
    'The issue is reproducible and here is the password: hunter2 to reproduce it safely.',
    'The issue is reproducible and here is the API key: sk-abcdefghijklmnopqrstuvwxyz123456.',
    'The issue is reproducible and here is the token: Bearer abcdefghijklmnopqrstuvwxyz0123456789.',
    '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----'
  ]) {
    assert.equal(prepareImprovementExample({ text: secret, consent, subjectType: 'user' }).reason, 'possible_secret_or_credential');
  }
});

test('direct identifiers and high-risk personal content are rejected', () => {
  assert.equal(prepareImprovementExample({
    text: 'Full name: Nasrin Abubakar. The explanation was confusing and should show a clearer step-by-step example.',
    consent, subjectType: 'user'
  }).reason, 'possible_direct_identifier');
  assert.equal(prepareImprovementExample({
    text: 'The patient's diagnosis details were discussed and need a clearer explanation for the next step.',
    consent, subjectType: 'user'
  }).reason, 'sensitive_content');
  assert.equal(prepareImprovementExample({
    text: 'My child was using the app and the answer needs a more detailed step-by-step explanation.',
    consent, subjectType: 'user'
  }).reason, 'sensitive_content');
});

test('eligible candidates redact email, phone, and valid card numbers and require human review', () => {
  const result = prepareImprovementExample({
    text: 'The explanation needs a clearer step-by-step example. Contact nasrin@example.com or +63 917 123 4567. Test card 4111 1111 1111 1111.',
    consent, subjectType: 'user'
  });
  assert.equal(result.eligible, true);
  assert.equal(result.consentVersion, IMPROVEMENT_EXAMPLE_CONSENT_VERSION);
  assert.equal(result.subjectType, 'user');
  assert.equal(result.requiresHumanReview, true);
  assert.match(result.text, /\[email\]/);
  assert.match(result.text, /\[phone\]/);
  assert.match(result.text, /\[card number\]/);
  assert.doesNotMatch(result.text, /nasrin@example\.com|\+63 917 123 4567|4111 1111 1111 1111/);
});

test('candidate preparation does not accept or store any content by itself', () => {
  const result = prepareImprovementExample({ text: safeText, consent, subjectType: 'guest' });
  assert.equal(result.eligible, true);
  assert.equal(result.subjectType, 'guest');
  assert.equal(Object.hasOwn(result, 'stored'), false);
  assert.equal(Object.hasOwn(result, 'id'), false);
});
