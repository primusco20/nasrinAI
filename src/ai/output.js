// Model output is untrusted. Before anything is stored or shown it must be
// a non-empty string, with control characters removed and a length cap.
// The page shows it as plain text (never HTML), so markup cannot run.

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;

export function cleanReply(text, maxChars = 8000) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  if (!cleaned) return null;
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars).trimEnd() + '…' : cleaned;
}

// The same rules for what a person sends, minus the cap message.
export function cleanUserText(text, maxChars) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  if (!cleaned || cleaned.length > maxChars) return null;
  return cleaned;
}
