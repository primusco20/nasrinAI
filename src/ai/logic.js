// Tier 0: questions plain code can answer, so no model is called.
// Deliberately small and exact: if a question is not clearly one of these,
// it returns null and the model handles it.
//   - arithmetic: "what is (12.5 + 3) * 4", "calculate 2^10", "= 7/8"
//   - percentages: "20% of 500", "what's 15 percent of 80"
//   - email check: "is ana@example.com a valid email?"

const MAX_LEN = 160;

// Safe arithmetic: numbers, + - * / ^ %, parentheses. No eval.
function evaluate(src) {
  const tokens = src.match(/\d+(?:\.\d+)?|[-+*/^()]/g);
  if (!tokens || tokens.join('') !== src.replace(/\s+/g, '')) return null;
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function primary() {
    const t = next();
    if (t === '(') { const v = sum(); if (next() !== ')') throw new Error('paren'); return v; }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (t !== undefined && /^\d/.test(t)) return Number(t);
    throw new Error('token');
  }
  function power() { const b = primary(); if (peek() === '^') { next(); return b ** power(); } return b; }
  function product() {
    let v = power();
    while (peek() === '*' || peek() === '/') { const op = next(); const r = power(); v = op === '*' ? v * r : v / r; }
    return v;
  }
  function sum() {
    let v = product();
    while (peek() === '+' || peek() === '-') { const op = next(); const r = product(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  try {
    const v = sum();
    if (i !== tokens.length || !Number.isFinite(v)) return null;
    return v;
  } catch { return null; }
}

const fmt = (n) => {
  const r = Math.round(n * 1e10) / 1e10;
  return Math.abs(r) >= 1e15 ? r.toExponential(6) : r.toLocaleString('en-US', { maximumFractionDigits: 10 });
};

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$/;

// Returns { text, kind } or null.
export function answerWithLogic(message) {
  const q = String(message || '').trim();
  if (!q || q.length > MAX_LEN) return null;
  const lower = q.toLowerCase().replace(/[?!.]+$/, '').trim();

  // "20% of 500" / "15 percent of 80"
  let m = /^(?:(?:what(?:'s| is)|calculate|compute)\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(\d+(?:\.\d+)?)$/.exec(lower);
  if (m) {
    const v = (Number(m[1]) / 100) * Number(m[2]);
    return { kind: 'percent', text: `${fmt(Number(m[1]))}% of ${fmt(Number(m[2]))} is ${fmt(v)}.` };
  }

  // Arithmetic, with an optional lead-in.
  m = /^(?:(?:what(?:'s| is)|calculate|compute|solve)\s+|=\s*)?([\d\s.+\-*/^()x×÷]+?)\s*(?:=\s*)?$/.exec(lower);
  if (m && /\d\s*[-+*/^x×÷]\s*[\d(]/.test(m[1])) {
    const expr = m[1].replace(/[x×]/g, '*').replace(/÷/g, '/').trim();
    const v = evaluate(expr);
    if (v !== null) return { kind: 'arithmetic', text: `${expr.replace(/\s+/g, ' ')} = ${fmt(v)}` };
  }

  // "is X a valid email (address)?"
  m = /^is\s+(\S+)\s+(?:a\s+)?valid\s+(?:e-?mail)(?:\s+address)?$/.exec(lower);
  if (m) {
    const ok = EMAIL.test(m[1]);
    return { kind: 'email', text: ok
      ? `Yes, ${m[1]} is written like a valid email address. (Whether the inbox exists can only be checked by sending to it.)`
      : `No, ${m[1]} is not a valid email address format.` };
  }
  return null;
}
