// One JSON object per line on stdout. Anything that looks like a credential is
// replaced before it is written, so a careless log call cannot leak a key.

const SECRET_KEY = /authorization|token|secret|password|api[_-]?key|cookie/i;
const SECRET_VALUE = [
  /\bBearer\s+[^\s"',}]+/gi,
  /\bsk-ant-[A-Za-z0-9_-]{10,}\b/gi,
  /\bsk-[A-Za-z0-9_-]{10,}\b/gi,
  /\bsb_secret_[A-Za-z0-9_-]{10,}\b/gi,
  /\bAIza[A-Za-z0-9_-]{20,}\b/gi,
  /\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password)=([^&\s"',}]+)/gi
];

function redactString(value) {
  let out = String(value);
  out = out.replace(SECRET_VALUE[0], 'Bearer [redacted]');
  for (const pattern of SECRET_VALUE.slice(1, -1)) out = out.replace(pattern, '[redacted]');
  out = out.replace(SECRET_VALUE.at(-1), (match) => match.replace(/=.*/, '=[redacted]'));
  return out;
}

function redact(value, depth = 0) {
  if (typeof value === 'string') return redactString(value);
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export function createLogger({ write = (line) => process.stdout.write(line + '\n'), silent = false } = {}) {
  const emit = (level, msg, fields) => {
    if (silent) return;
    const entry = { at: new Date().toISOString(), level, msg: redactString(msg), ...redact(fields || {}) };
    try { write(JSON.stringify(entry)); } catch { /* never let logging crash a request */ }
  };
  return {
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields)
  };
}

export { redact };
