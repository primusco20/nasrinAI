import { redactForProvider } from '../ai/redact.js';

// This is a fail-closed gate for a future, separately approved capture flow.
// It is intentionally not called by chat routes and does not store or transmit data.
export const IMPROVEMENT_EXAMPLE_CONSENT_VERSION = '2026-10-10-example-v1';
export const MAX_IMPROVEMENT_EXAMPLE_CHARS = 6000;

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{12,}|rk_live_[A-Za-z0-9]{12,})\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}\b/i,
  /\b(?:password|passwd|passcode|api[_ -]?key|secret[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+/i,
  /\b(?:otp|one[- ]time code|verification code)\s*[:=]?\s*\d{4,8}\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/
];

const DIRECT_IDENTITY_PATTERNS = [
  /\b(?:my name is|full name|customer name|patient name)\s*[:=]?\s*[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,3}/iu,
  /\b(?:home address|street address|residential address|date of birth|\bDOB\b|passport number|national ID|government ID|SSS number|TIN number|PhilHealth number)\s*[:=]/i,
];

const SENSITIVE_CONTENT_PATTERNS = [
  /\b(?:my|the patient's?|their)\s+(?:diagnosis|medical record|lab results|prescription|therapy notes?)\b/i,
  /\b(?:HIV status|mental health diagnosis|suicidal thoughts|sexual assault|domestic violence|immigration case|criminal case|bank account details|credit card statement|political affiliation|religious conversion)\b/i,
  /\b(?:minor|underage|my child|my son|my daughter|student under 18)\b/i
];

const normalize = (value) => String(value ?? '').normalize('NFKC').replace(/\r\n?/g, '\n').trim();

export function prepareImprovementExample({ text, consent, subjectType, purpose = 'nasrinai_quality' } = {}) {
  if (!consent || consent.decision !== 'granted' || consent.version !== IMPROVEMENT_EXAMPLE_CONSENT_VERSION) {
    return { eligible: false, reason: 'valid_consent_required' };
  }
  if (!['user', 'guest'].includes(subjectType)) {
    return { eligible: false, reason: 'invalid_subject' };
  }
  if (purpose !== 'nasrinai_quality') {
    return { eligible: false, reason: 'unsupported_purpose' };
  }

  const source = normalize(text);
  if (source.length < 20) return { eligible: false, reason: 'too_short' };
  if (source.length > MAX_IMPROVEMENT_EXAMPLE_CHARS) return { eligible: false, reason: 'too_long' };

  if (SECRET_PATTERNS.some((pattern) => pattern.test(source))) {
    return { eligible: false, reason: 'possible_secret_or_credential' };
  }
  if (DIRECT_IDENTITY_PATTERNS.some((pattern) => pattern.test(source))) {
    return { eligible: false, reason: 'possible_direct_identifier' };
  }
  if (SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(source))) {
    return { eligible: false, reason: 'sensitive_content' };
  }

  // Reuse the audited provider redactor for emails, phone numbers, and valid
  // payment-card numbers. This changes only the candidate copy, never chat history.
  const redacted = redactForProvider(source).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/[ \t]+/g, ' ').trim();
  if (redacted.length < 20 || SECRET_PATTERNS.some((pattern) => pattern.test(redacted))) {
    return { eligible: false, reason: 'redaction_failed' };
  }

  return {
    eligible: true,
    consentVersion: IMPROVEMENT_EXAMPLE_CONSENT_VERSION,
    subjectType,
    purpose,
    text: redacted,
    requiresHumanReview: true
  };
}
