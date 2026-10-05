// A small, strict JSON-schema subset for tool arguments (Phase 5). Model
// output is untrusted, so arguments must match exactly: known keys only,
// right types, bounded lengths and ranges, required keys present.
//
//   { type: 'object', properties: { name: spec }, required: [names] }
//   spec: { type: 'string', maxLength, enum, pattern }
//       | { type: 'number' | 'integer', minimum, maximum }
//       | { type: 'boolean' }
// Returns null when valid, else a short reason (safe to log, no values).

export function checkArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  const props = schema.properties || {};
  for (const key of Object.keys(args)) if (!Object.hasOwn(props, key)) return `unknown argument ${key.slice(0, 40)}`;
  for (const key of schema.required || []) if (!Object.hasOwn(args, key)) return `missing argument ${key}`;
  for (const [key, spec] of Object.entries(props)) {
    if (!Object.hasOwn(args, key)) continue;
    const v = args[key];
    if (spec.type === 'string') {
      if (typeof v !== 'string') return `${key} must be text`;
      if (v.length > (spec.maxLength ?? 200)) return `${key} is too long`;
      if (spec.enum && !spec.enum.includes(v)) return `${key} is not one of the allowed values`;
      if (spec.pattern && !new RegExp(spec.pattern).test(v)) return `${key} has the wrong format`;
    } else if (spec.type === 'number' || spec.type === 'integer') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return `${key} must be a number`;
      if (spec.type === 'integer' && !Number.isInteger(v)) return `${key} must be a whole number`;
      if (spec.minimum !== undefined && v < spec.minimum) return `${key} is too small`;
      if (spec.maximum !== undefined && v > spec.maximum) return `${key} is too large`;
    } else if (spec.type === 'boolean') {
      if (typeof v !== 'boolean') return `${key} must be true or false`;
    } else {
      return `${key} has an unsupported type`;
    }
  }
  return null;
}
