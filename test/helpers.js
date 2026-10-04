import http from 'node:http';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';

export const testConfig = (env = {}) => loadConfig({ NODE_ENV: 'test', ...env });

// A logger that keeps lines in memory, so tests can check what was logged.
export function memoryLogger() {
  const lines = [];
  const logger = createLogger({ write: (l) => lines.push(JSON.parse(l)) });
  logger.lines = lines;
  return logger;
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
