import http from 'node:http';
import { loadConfig, ConfigError } from './src/config.js';
import { createLogger } from './src/log.js';
import { buildApp } from './src/main.js';

const logger = createLogger();

let config;
try {
  config = loadConfig();
} catch (err) {
  logger.error('invalid configuration', { error: err instanceof ConfigError ? err.message : String(err) });
  process.exit(1);
}

const app = buildApp({ config, logger });
const server = http.createServer(app);
server.headersTimeout = 15_000;   // slow-header clients are dropped
server.requestTimeout = 90_000;   // a model reply can take a while; nothing longer
server.keepAliveTimeout = 5_000;

server.listen(config.port, () => logger.info('NasrinAI listening', { port: config.port, env: config.nodeEnv }));

const stop = () => {
  logger.info('shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', { error: String(reason?.stack || reason) }));
