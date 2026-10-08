import https from 'node:https';
import { safeLookup } from '../web/read-link.js';

// One call to a business's API, with the same SSRF rules as the link reader:
// https only, the address checked at connect time (public hosts only, so a
// name cannot switch to an internal address), the host fixed by the
// connector's base_url, redirects not followed, 8 s, 256 KB.

const MAX_BYTES = 256 * 1024;

export function callApi({ url, method, headers = {}, body = null, form = null, timeoutMs = 8000, lookup = safeLookup, request = https.request }) {
  return new Promise((resolve, reject) => {
    // form: an application/x-www-form-urlencoded string (OAuth token requests).
    const payload = form !== null ? Buffer.from(form) : body === null ? null : Buffer.from(JSON.stringify(body));
    const req = request(url, {
      method,
      lookup,
      headers: {
        Accept: 'application/json, text/plain;q=0.5',
        'User-Agent': 'NasrinAI-Connector/1.0 (+https://nasrinai.com)',
        ...(payload ? { 'Content-Type': form !== null ? 'application/x-www-form-urlencoded' : 'application/json', 'Content-Length': payload.length } : {}),
        ...headers
      },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { res.destroy(); reject(Object.assign(new Error('response too large'), { code: 'ETOOBIG' })); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
