import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

function keyFromEnv(env = process.env) {
  const encoded = env.NASRINAI_INTEGRATION_ENCRYPTION_KEY;
  if (typeof encoded !== 'string' || !encoded) {
    throw new Error('NASRINAI_INTEGRATION_ENCRYPTION_KEY is required to store provider credentials');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new Error('NASRINAI_INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

// Authenticated encryption. The key is server-only and must not be a provider
// token. The returned envelope is safe to persist, but must never be returned
// to a client. Bind ciphertext to its row/provider with the optional AAD.
export function encryptIntegrationSecret(plaintext, { env = process.env, aad = '' } = {}) {
  if (typeof plaintext !== 'string' || !plaintext) throw new TypeError('secret must be a non-empty string');
  const key = keyFromEnv(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptIntegrationSecret(envelope, { env = process.env, aad = '' } = {}) {
  if (typeof envelope !== 'string') throw new TypeError('encrypted secret is required');
  const [version, ivText, tagText, ciphertextText, extra] = envelope.split('.');
  if (version !== VERSION || !ivText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error('invalid encrypted integration secret');
  }
  const decipher = createDecipheriv(ALGORITHM, keyFromEnv(env), Buffer.from(ivText, 'base64url'));
  decipher.setAAD(Buffer.from(String(aad), 'utf8'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}
