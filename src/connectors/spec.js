import { checkUrl } from '../web/read-link.js';

// Checks a connector definition sent by a business. Everything the model will
// later be allowed to do is fixed here, by the business, not by the model.
//
//   { name, base_url, auth: { type: 'none' | 'bearer' | 'header', header?, secret? },
//     actions: [{ name, description, method, path, parameters, risk?, who? }] }
//
// - base_url: https on port 443, a public host, no query, no credentials.
// - GRAPHQL: a fixed query or mutation written by the business (one
//   operation, no subscriptions); the model only fills its variables, which
//   are the declared parameters. Queries read; mutations write (or money).
// - path: a template under base_url, e.g. /orders/{order_id}; every {param}
//   is a required string/number parameter (URL-encoded when sent).
// - parameters: the tool schema subset (src/tools/schema.js), at most 10.
// - risk: GET is 'read'; other methods are 'write' unless marked 'money'.
//   write/money never run without the person's Confirm.
// - who: which callers of this business may use it: 'service' (its own
//   server, default) and/or 'guest' (visitors chatting on its site). Opening
//   an action to guests is the business's explicit choice.
// Returns { value } (normalised) or { error }.

const NAME = /^[a-z][a-z0-9_]{1,20}$/;
const ACTION = /^[a-z][a-z0-9_]{1,19}$/;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'GRAPHQL'];
const BLOCKED_HEADERS = /^(host|cookie|content-length|content-type|transfer-encoding|connection|user-agent|accept)$/i;

function checkParam(key, p) {
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(key)) return `parameter name ${key.slice(0, 40)} is invalid`;
  if (!p || typeof p !== 'object') return `parameter ${key} needs a type`;
  const out = { type: p.type };
  if (p.type === 'string') {
    out.maxLength = Number.isInteger(p.maxLength) && p.maxLength >= 1 && p.maxLength <= 500 ? p.maxLength : 100;
    if (p.enum !== undefined) {
      if (!Array.isArray(p.enum) || !p.enum.length || p.enum.length > 30 || !p.enum.every((x) => typeof x === 'string' && x.length <= 60)) return `parameter ${key}: enum must be up to 30 short strings`;
      out.enum = p.enum;
    }
    if (p.pattern !== undefined) {
      if (typeof p.pattern !== 'string' || p.pattern.length > 100) return `parameter ${key}: pattern too long`;
      try { new RegExp(p.pattern); } catch { return `parameter ${key}: pattern is not a valid regular expression`; }
      // No nested quantifiers, alternation inside repeats, or backreferences:
      // shapes that can make matching take very long (ReDoS).
      if (/\([^)]*[+*}][^)]*\)\s*[+*{?]|\([^)]*\|[^)]*\)\s*[+*{]|\\[1-9]/.test(p.pattern)) return `parameter ${key}: pattern is too complex`;
      out.pattern = p.pattern;
    }
  } else if (p.type === 'number' || p.type === 'integer') {
    if (p.minimum !== undefined) { if (typeof p.minimum !== 'number') return `parameter ${key}: minimum must be a number`; out.minimum = p.minimum; }
    if (p.maximum !== undefined) { if (typeof p.maximum !== 'number') return `parameter ${key}: maximum must be a number`; out.maximum = p.maximum; }
  } else if (p.type !== 'boolean') {
    return `parameter ${key}: type must be string, number, integer or boolean`;
  }
  if (p.description !== undefined) out.description = String(p.description).slice(0, 200);
  return out;
}

export function checkConnector(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'The connector must be an object.' };
  const { name, base_url: baseUrl, auth = { type: 'none' }, actions } = input;
  if (typeof name !== 'string' || !NAME.test(name)) return { error: 'name: 2-21 characters, a-z, 0-9 and _, starting with a letter.' };

  const u = typeof baseUrl === 'string' && baseUrl.length <= 300 ? checkUrl(baseUrl) : null;
  if (!u || u.protocol !== 'https:' || (u.port && u.port !== '443') || u.search || u.hash || /\.\./.test(u.pathname)) {
    return { error: 'base_url: an https address on a public host, without a port, query or credentials.' };
  }
  const base = u.origin + u.pathname.replace(/\/+$/, '');

  if (!auth || typeof auth !== 'object' || !['none', 'bearer', 'header'].includes(auth.type)) return { error: 'auth.type: none, bearer or header.' };
  if (auth.type === 'header' && (typeof auth.header !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(auth.header) || BLOCKED_HEADERS.test(auth.header))) {
    return { error: 'auth.header: a header name such as X-Api-Key.' };
  }
  if (auth.type !== 'none' && auth.secret !== undefined && (typeof auth.secret !== 'string' || !auth.secret || auth.secret.length > 2000 || /[\r\n]/.test(auth.secret))) {
    return { error: 'auth.secret: the API key or token, one line, at most 2000 characters.' };
  }

  if (!Array.isArray(actions) || !actions.length || actions.length > 20) return { error: 'actions: 1 to 20 actions.' };
  const seen = new Set();
  const out = [];
  for (const [i, a] of actions.entries()) {
    const at = `actions[${i}]`;
    if (!a || typeof a !== 'object') return { error: `${at} must be an object.` };
    if (typeof a.name !== 'string' || !ACTION.test(a.name) || seen.has(a.name)) return { error: `${at}.name: 2-20 characters, a-z, 0-9 and _, unique.` };
    seen.add(a.name);
    if (typeof a.description !== 'string' || !a.description.trim() || a.description.length > 300) return { error: `${at}.description: 1-300 characters.` };
    const method = String(a.method || '').toUpperCase();
    if (!METHODS.includes(method)) return { error: `${at}.method: ${METHODS.join(', ')}.` };
    if (typeof a.path !== 'string' || a.path.length > 200 || !/^\/[A-Za-z0-9/_\-.{}]*$/.test(a.path) || /\.\./.test(a.path) || /\/\//.test(a.path)) {
      return { error: `${at}.path: starts with /, letters, digits, / _ - . and {parameters}.` };
    }
    const params = a.parameters?.properties ?? {};
    if (typeof params !== 'object' || Array.isArray(params) || Object.keys(params).length > 10) return { error: `${at}.parameters: at most 10.` };
    const properties = {};
    for (const [k, p] of Object.entries(params)) {
      const r = checkParam(k, p);
      if (typeof r === 'string') return { error: `${at}.${r}.` };
      properties[k] = r;
    }
    const required = Array.isArray(a.parameters?.required) ? [...new Set(a.parameters.required)] : [];
    if (!required.every((k) => Object.hasOwn(properties, k))) return { error: `${at}.parameters.required names an unknown parameter.` };
    const inPath = [...a.path.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
    if (a.path.replace(/\{[a-z][a-z0-9_]{0,30}\}/g, '').includes('{') || a.path.replace(/\{[a-z][a-z0-9_]{0,30}\}/g, '').includes('}')) return { error: `${at}.path: {parameters} must be simple names.` };
    for (const k of inPath) {
      if (!required.includes(k) || !['string', 'integer', 'number'].includes(properties[k]?.type)) return { error: `${at}.path: {${k}} must be a required string or number parameter.` };
    }
    let query = null;
    let reads = method === 'GET';
    if (method === 'GRAPHQL') {
      if (typeof a.query !== 'string' || a.query.length > 5000) return { error: `${at}.query: the GraphQL document, at most 5000 characters.` };
      const doc = a.query.replace(/#[^\n]*/g, '').trim();
      const op = /^(query|mutation)\b/.exec(doc);
      if (!op || /\}\s*(query|mutation|subscription|fragment)\b/.test(doc) || /^\s*(subscription|fragment)\b/.test(doc)) return { error: `${at}.query: exactly one query or mutation.` };
      if (inPath.length) return { error: `${at}.path: GraphQL actions take no {parameters} in the path.` };
      query = a.query;
      reads = op[1] === 'query';
    }
    const risk = reads ? 'read' : a.risk === 'money' ? 'money' : 'write';
    if (reads && a.risk !== undefined && a.risk !== 'read') return { error: `${at}.risk: ${method === 'GET' ? 'GET actions' : 'GraphQL queries'} only read.` };
    const who = a.who === undefined ? ['service'] : a.who;
    if (!Array.isArray(who) || !who.length || !who.every((w) => w === 'service' || w === 'guest')) return { error: `${at}.who: "service" and/or "guest".` };
    out.push({ name: a.name, description: a.description.trim(), method, path: a.path, ...(query ? { query } : {}), parameters: { properties, required }, risk, who: [...new Set(who)] });
  }
  return {
    value: {
      name,
      base_url: base,
      auth: { type: auth.type, ...(auth.type === 'header' ? { header: auth.header } : {}) },
      secret: auth.type === 'none' ? null : (auth.secret ?? undefined),   // undefined: keep the stored one
      actions: out
    }
  };
}
