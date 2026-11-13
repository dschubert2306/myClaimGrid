// The CSP allows inline scripts only by hash (no 'unsafe-inline'). The only inline script is the
// theme script in index.html. This script computes its hash from the BUILT index.html (the build
// may rewrite the file) and keeps infra/csp-script-hashes.json in sync.
//   node scripts/csp-hash.mjs --check   fails when the committed hashes do not match the build
//   node scripts/csp-hash.mjs --write   updates the committed file
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const built = new URL('../dist/frontend/browser/index.html', import.meta.url);
const target = new URL('../../infra/csp-script-hashes.json', import.meta.url);
const mode = process.argv[2];

if (!existsSync(built)) {
  console.error('dist/frontend/browser/index.html not found. Run the production build first.');
  process.exit(1);
}

const html = readFileSync(built, 'utf8');
const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => `sha256-${createHash('sha256').update(m[1]).digest('base64')}`)
  .sort();

if (/<script[^>]*\bon\w+=/i.test(html) || /\sonload=/i.test(html)) {
  console.error('index.html contains inline event handlers, which the CSP blocks.');
  process.exit(1);
}

if (mode === '--write') {
  writeFileSync(target, `${JSON.stringify(hashes, null, 2)}\n`);
  console.log(`wrote ${hashes.length} hash(es) to infra/csp-script-hashes.json`);
} else if (mode === '--check') {
  const committed = JSON.parse(readFileSync(target, 'utf8')).sort();
  if (JSON.stringify(committed) !== JSON.stringify(hashes)) {
    console.error(
      `CSP script hashes are out of date.\n  built:     ${JSON.stringify(hashes)}\n  committed: ${JSON.stringify(committed)}\nRun: npm run csp:write -w frontend`,
    );
    process.exit(1);
  }
  console.log('CSP script hashes match the build.');
} else {
  console.error('Use --check or --write');
  process.exit(2);
}
