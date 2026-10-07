// Text for reading aloud: Markdown symbols removed, code replaced by a short
// note, and split into parts so the first part is short (it starts playing
// quickly) and the rest are larger (fewer requests).

export function plainForSpeech(text) {
  return String(text || '')
    .replace(/\[\[ask\]\][\s\S]*?(?:\[\[\/ask\]\]|$)/gi, ' ')
    .replace(/\[\[file\b[^\]]*\]\][\s\S]*?(?:\[\[\/file\]\]|$)/gi, ' (The file is ready to download in the chat.) ')
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

// For a reply that is spoken while it is still being written: takes the
// reply piece by piece and gives back the words to say for each piece.
// Files, tappable questions and code that span several pieces are skipped
// (a short note stands in for a file or code), the way plainForSpeech does
// for a whole reply.
export function speechFilter() {
  let skipUntil = null;   // the closing mark of a block that is being skipped
  return (piece) => {
    let rest = String(piece || '');
    let out = '';
    while (rest) {
      if (skipUntil) {
        const at = rest.toLowerCase().indexOf(skipUntil);
        if (at < 0) break;
        rest = rest.slice(at + skipUntil.length);
        skipUntil = null;
        continue;
      }
      const m = /\[\[(file|ask)\b|```/i.exec(rest);
      if (!m) { out += rest; break; }
      out += rest.slice(0, m.index);
      const open = m[0].toLowerCase();
      skipUntil = open === '```' ? '```' : '[[/' + m[1].toLowerCase() + ']]';
      out += open === '[[file' ? ' (The file is ready to download in the chat.) ' : open === '```' ? ' (The code is shown on screen.) ' : ' ';
      rest = rest.slice(m.index + m[0].length);
    }
    return plainForSpeech(out);
  };
}
