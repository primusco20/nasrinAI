// One JSON object per line on stdout. Anything that looks like a credential is
// replaced before it is written, so a careless log call cannot leak a key.

const SECRET_KEY = /authorization|token|secret|password|api[_-]?key|cookie/i;

function redact(value, depth = 0) {
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
    const entry = { at: new Date().toISOString(), level, msg, ...redact(fields || {}) };
    try { write(JSON.stringify(entry)); } catch { /* never let logging crash a request */ }
  };
  return {
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields)
  };
}

export { redact };
