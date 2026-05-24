/**
 * Supabase deploy bundles only each function folder — parent ../_shared is not included.
 * Copies canonical shared modules into every function that imports them.
 *
 * Run before deploy: node scripts/sync-edge-shared.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'supabase', 'functions', '_shared');
const targets = [
  'blyve',
  'create-call-session',
  'accept-call',
  'join-call',
  'invite-participant',
  'end-call',
  'smart-action',
];

if (!fs.existsSync(src)) {
  console.error('Missing source:', src);
  process.exit(1);
}

for (const fn of targets) {
  const dest = path.join(root, 'supabase', 'functions', fn, '_shared');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`synced _shared -> ${fn}/_shared`);
}

console.log('Done. Deploy functions after sync.');
