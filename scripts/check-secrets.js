#!/usr/bin/env node
// Fails when a committed file looks like it holds a real key, token or
// password (Phase 10). Runs in CI and with `npm run check:secrets`.
// Tests are skipped (they use made-up keys on purpose), and so is the file
// that defines the patterns.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sensitive } from './teacher/pipeline.js';

const SKIP = [/^test\//, /^scripts\/teacher\/pipeline\.js$/, /^reference\//, /\.(png|ico|jpg|jpeg|webp|gif|pdf)$/i];

export function scan(files, read) {
  const found = [];
  for (const f of files) {
    if (SKIP.some((re) => re.test(f))) continue;
    let text;
    try { text = read(f); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      const hits = sensitive(line).filter((r) => !/personal details/.test(r));
      if (hits.length) found.push(`${f}:${i + 1}: looks like ${hits.join(', ')}`);
    });
  }
  return found;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const found = scan(files, (f) => readFileSync(f, 'utf8'));
  for (const f of found) console.error(f);
  console.log(found.length ? `${found.length} possible secret(s) found` : `no secrets found in ${files.length} files`);
  process.exit(found.length ? 1 : 0);
}
