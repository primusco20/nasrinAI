// Does a memory note look like it holds a secret? Notes must never keep
// passwords, keys, tokens, card numbers or one-time codes, whatever the model
// or the person asks. Checked when a note is saved or edited. Errs on the
// side of refusing: the person can rephrase without the secret.

const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(sk|pk|rk)[-_](live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/,     // OpenAI/Stripe/Anthropic-style keys
  /\bns[sp]_[a-z0-9]{8,}/i,                                            // NasrinAI keys
  /\bAKIA[0-9A-Z]{16}\b/,                                              // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/,                                          // Google API key
  /\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/,                  // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,                                    // Slack tokens
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,   // JWTs
  /\b[a-f0-9]{32,}\b/i,                                                // long hex secrets
  /(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*[a-z])[A-Za-z0-9+/_-]{40,}={0,2}/, // long random tokens
  /\b(password|passwd|passcode|pass code|pwd|pin|otp|one[- ]time (code|password)|cvv|cvc|security code|secret answer|mpin|api key|secret key|access token|private key|recovery code|seed phrase)\b\s*(is|are|=|:|ko|ko ay|ay)?\s*\S{3,}/i
];

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export function looksSecret(text) {
  const s = String(text || '');
  if (PATTERNS.some((p) => p.test(s))) return true;
  // Card numbers: 13 to 19 digits (spaces or dashes allowed) that pass the Luhn check.
  for (const m of s.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}
