import { createHash } from 'node:crypto';

// Cache keys are deterministic fingerprints, never raw prompts or customer data.
// Include a schema version so the fingerprint can be safely changed later.
export function marketingCacheKey(kind, inputs) {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(String(kind))) throw new TypeError('invalid cache kind');
  return createHash('sha256')
    .update(JSON.stringify({ version: 1, kind, inputs }))
    .digest('hex');
}
