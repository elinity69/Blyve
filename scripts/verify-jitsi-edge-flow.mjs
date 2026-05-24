/**
 * Verify Jitsi joinCall is wired through all edge entry points and shared handler.
 * Run: node scripts/verify-jitsi-edge-flow.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const failures = [];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function mustInclude(relPath, needle, label) {
  const content = read(relPath);
  if (!content.includes(needle)) {
    failures.push(`${label}: ${relPath} missing "${needle}"`);
  }
}

mustInclude(
  'supabase/functions/_shared/jitsi-call-handlers.ts',
  'export async function handleJoinCall',
  'shared handler',
);

mustInclude(
  'supabase/functions/join-call/index.ts',
  'handleJoinCall(auth.supabase, auth.user, sessionId, inviteToken, body)',
  'standalone join-call',
);
mustInclude(
  'supabase/functions/blyve/index.ts',
  'handleJoinCall(auth.supabase, auth.user, sessionId, inviteToken, body)',
  'blyve join route',
);
mustInclude(
  'supabase/functions/smart-action/index.ts',
  'handleJoinCall(auth.supabase, auth.user, sessionId, inviteToken, body',
  'smart-action jitsi',
);

mustInclude('supabase/functions/_shared/jitsi-call-handlers.ts', 'get_call_session_for_join', 'join RPC session read');
mustInclude('supabase/functions/_shared/jitsi-call-handlers.ts', 'consume_call_invite_token', 'join RPC token consume');
mustInclude('supabase/functions/_shared/jitsi-call-handlers.ts', 'rejectClientRoomName', 'reject client room');

const callUtils = read('supabase/functions/_shared/call-utils.ts');
if (/meet\.jit\.si/i.test(callUtils)) failures.push('call-utils.ts still contains meet.jit.si fallback');
if (/VITE_JITSI_DOMAIN/i.test(callUtils)) failures.push('call-utils.ts still references VITE_JITSI_DOMAIN');
if (!callUtils.includes('JITSI_DOMAIN is not configured')) failures.push('call-utils.ts must require JITSI_DOMAIN');
if (!callUtils.includes('"joining"')) failures.push('expireStaleRingingCallIfNeeded must handle joining status');

mustInclude(
  'supabase/migrations/20260522180000_jitsi_call_rls_invite_and_status_hardening.sql',
  'get_call_session_for_join',
  'migration RPC session',
);
mustInclude(
  'supabase/migrations/20260522180000_jitsi_call_rls_invite_and_status_hardening.sql',
  'consume_call_invite_token',
  'migration RPC token',
);

mustInclude('supabase/functions/blyve/index.ts', '/calls/create', 'livekit create route');
mustInclude('supabase/functions/smart-action/index.ts', 'handleLiveKitToken', 'livekit smart-action');
mustInclude('supabase/config.toml', '[functions.join-call]', 'join-call function config');

if (failures.length) {
  console.error('Jitsi edge flow verification FAILED:\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('Jitsi edge flow verification OK');
console.log('  Entry points: join-call | blyve /calls/jitsi/:id/join | smart-action jitsi');
console.log('  Handler: handleJoinCall -> get_call_session_for_join + consume_call_invite_token');
console.log('  LiveKit routes preserved');
