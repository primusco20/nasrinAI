import http from 'node:http';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { createApp } from '../src/http/app.js';
import { createGateway } from '../src/gateway/index.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { clientIpFrom } from '../src/net.js';
import { buildRoutes } from '../src/routes.js';
import { hashSecret } from '../src/auth/keys.js';
import { createLimiter, createUsageLog } from '../src/limits.js';
import { createConversations } from '../src/conversations.js';
import { createChat } from '../src/chat.js';
import { createModelCatalog } from '../src/ai/models.js';
import { createVoice } from '../src/voice.js';

export const GUEST_SECRET = 'test-guest-secret-0123456789abcdef0123456789';
export const BIZ_TENANT = '11111111-1111-4111-8111-111111111111';
export const SUSPENDED_TENANT = '22222222-2222-4222-8222-222222222222';
export const PUB_KEY = 'nsp_aaaaaaaaaaaa';
export const SECRET = 'b'.repeat(48);
export const SECRET_KEY = `nss_cccccccccccc_${SECRET}`;
export const USER_TOKEN = 'header.payload.signature';

export const testConfig = (env = {}) => loadConfig({ NODE_ENV: 'test', GUEST_SESSION_SECRET: GUEST_SECRET, ...env });

// A logger that keeps lines in memory, so tests can check what was logged.
export function memoryLogger() {
  const lines = [];
  const logger = createLogger({ write: (l) => lines.push(JSON.parse(l)) });
  logger.lines = lines;
  return logger;
}

// A memory store with one active business, one suspended business and keys.
export function seededStore() {
  const store = createMemoryStore();
  store.addTenant({ id: BIZ_TENANT });
  store.addTenant({ id: SUSPENDED_TENANT, status: 'suspended' });
  store.addApiKey({ id: 'aaaaaaaaaaaa', tenant_id: BIZ_TENANT, kind: 'publishable', allowed_origins: ['https://shop.example.com'] });
  store.addApiKey({ id: 'cccccccccccc', tenant_id: BIZ_TENANT, kind: 'secret', secret_hash: hashSecret(SECRET) });
  store.addApiKey({ id: 'dddddddddddd', tenant_id: BIZ_TENANT, kind: 'secret', secret_hash: hashSecret('d'.repeat(48)), revoked_at: '2026-01-01' });
  store.addApiKey({ id: 'eeeeeeeeeeee', tenant_id: SUSPENDED_TENANT, kind: 'secret', secret_hash: hashSecret('e'.repeat(48)) });
  return store;
}

// The real app wiring, with in-memory storage and a fake sign-in check.
export function buildTestApp({ store = seededStore(), verifyUser, extraRoutes = [], logger = memoryLogger(), env = {}, provider = null, speechEngine = null } = {}) {
  const config = testConfig(env);
  const users = verifyUser ?? (async (t) => (t === USER_TOKEN ? { id: 'user-1' } : null));
  const gateway = createGateway({ store, guestSecret: config.guestSecret, verifyUser: users });
  const limiter = createLimiter({ store, limits: config.limits });
  const usageLog = createUsageLog({ store, logger });
  const conversations = createConversations({ store, config, logger });
  const models = createModelCatalog({ provider, config, logger });
  const chat = createChat({ conversations, limiter, usageLog, provider, models, config, logger });
  const voice = createVoice({ engine: speechEngine, conversations, limiter, usageLog, config, logger });
  const app = createApp({
    config, logger, gateway,
    routes: buildRoutes({ config, gateway, store, limiter, usageLog, conversations, chat, provider, models, voice }).concat(extraRoutes),
    clientIp: (req) => clientIpFrom(req, config.trustProxyHops)
  });
  return { app, store, logger, config, limiter, usageLog, conversations, provider, models };
}

// Starts a handler on a free local port.
export async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

export const postJson = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

export const bearer = (token) => ({ Authorization: 'Bearer ' + token });
