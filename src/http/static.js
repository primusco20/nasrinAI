import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PAGE_CSP } from './headers.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

// Serves files from one folder only. Returns false when nothing matched so the
// caller can answer 404. Paths that try to leave the folder never match.
export function createStatic(rootDir) {
  const root = path.resolve(rootDir);

  return async function serveStatic(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return false; }
    if (rel.includes('\0') || rel.includes('\\')) return false;
    if (rel === '/' || rel === '') rel = '/index.html';

    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) return false;
    if (path.basename(file).startsWith('.')) return false;

    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) return false;

    let data;
    try { data = await readFile(file); } catch { return false; }

    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', data.length);
    res.setHeader('Cache-Control', type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600');
    if (type.startsWith('text/html')) res.setHeader('Content-Security-Policy', PAGE_CSP);
    res.end(req.method === 'HEAD' ? undefined : data);
    return true;
  };
}
