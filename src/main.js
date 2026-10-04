import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './http/app.js';
import { createStatic } from './http/static.js';
import { createClosedGateway } from './gateway/index.js';
import { buildRoutes } from './routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(here, '..', 'public');

// Wires the real dependencies together. Tests call createApp with fakes instead.
export function buildApp({ config, logger }) {
  return createApp({
    config,
    logger,
    gateway: createClosedGateway(),
    routes: buildRoutes(),
    serveStatic: createStatic(PUBLIC_DIR)
  });
}
