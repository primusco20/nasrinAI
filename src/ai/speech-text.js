// Text for reading aloud: Markdown symbols removed, code replaced by a short
// note, and split into parts so the first part is short (it starts playing
// quickly) and the rest are larger (fewer requests).

export function plainForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' (The code is shown on screen.) ')
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/https?:\/\/\S+/g, '(link)')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*(\d{1,3})[.)]\s+/gm, '$1. ')
    .replace(/^>\s?/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function splitForSpeech(text, { first = 220, rest = 900 } = {}) {
  const sentences = String(text).match(/[^.!?。！？\n]+[.!?。！？]*[\s\n]*|\n+/g) || [String(text)];
  const parts = [];
  let cur = '';
  for (const s of sentences) {
    const limit = parts.length === 0 ? first : rest;
    if (cur && (cur + s).length > limit) { parts.push(cur.trim()); cur = ''; }
    // A single very long sentence is cut at a word boundary.
    let piece = s;
    while (piece.length > rest) {
      const cut = piece.lastIndexOf(' ', rest) > 0 ? piece.lastIndexOf(' ', rest) : rest;
      parts.push((cur + piece.slice(0, cut)).trim()); cur = '';
      piece = piece.slice(cut);
    }
    cur += piece;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}
