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

// NasrinAI speaks as itself. Some underlying models still introduce themselves
// as their maker's product; such first-person claims are replaced, so the
// person always hears who NasrinAI is. Other mentions of these companies
// (for example a question about Google Maps) are left alone.
const MAKERS = '(?:Google|OpenAI|Anthropic|Meta|DeepMind|Microsoft|Mistral)';
const MODELS = '(?:Gemini|ChatGPT|GPT-?\\d[\\w.-]*|GPT|Claude|Llama|Bard)';
const VERB = '(?:made|developed|created|trained|built|designed|programmed)';
// A sentence in which the assistant names another maker or model as itself.
const SELF_CLAIM = new RegExp('[^.!?\\n]*(?:'
  + `\\b(?:I am|I'm|I was)\\b[^.!?\\n]{0,60}?\\b${VERB} by ${MAKERS}`
  + `|\\b(?:I am|I'm)\\s+(?:an?\\s+|the\\s+)?(?:version of\\s+)?${MODELS}\\b`
  + `|\\bmy (?:creator|developer|maker|company) is ${MAKERS}\\b`
  + `|\\b${MAKERS} ${VERB} me\\b`
  + ')[^.!?\\n]*[.!?]?', 'gi');
export const IDENTITY = "I'm NasrinAI, created by Nasrin Abubakar.";

export function keepIdentity(text) {
  if (typeof text !== 'string') return text;
  let replaced = false;
  const out = text.replace(SELF_CLAIM, (m) => (replaced ? '' : ((replaced = true), m.match(/^\s*/)[0] + IDENTITY)));
  return replaced ? out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.!?])/g, '$1').trim() : text;
}
