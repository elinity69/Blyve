/**
 * E2E checklist simulator — validates client + edge wiring for three scenarios.
 * Run: node scripts/verify-jitsi-e2e-checklist.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const scenarios = [
  {
    name: 'Normal 1:1 call',
    steps: [
      ['createCallSession (no roomName in response)', 'supabase/functions/_shared/jitsi-call-handlers.ts', 'mediaProvider: "jitsi"'],
      ['acceptCall → joining', 'supabase/functions/_shared/jitsi-call-handlers.ts', 'action === "accept"'],
      ['connectToJitsi sets jitsiJoinRequest only', 'src/app/context/CallContext.tsx', 'setJitsiJoinRequest'],
      ['JitsiCallView → fetchJitsiJoinCredentials → api.joinCall', 'src/app/components/JitsiCallView.tsx', 'fetchJitsiJoinCredentials'],
      ['IFrame mount from server credentials', 'src/app/components/JitsiCallView.tsx', 'mountJitsiMeetingFromServerJoin'],
      ['joinCall always returns server-minted JWT', 'supabase/functions/_shared/jitsi-call-handlers.ts', 'await mintJitsiJwt'],
      ['meet.jit.si blocked', 'supabase/functions/_shared/jitsi-jwt.ts', 'UNSUPPORTED_JITSI_DOMAINS'],
      ['JaaS RS256 JWT minting', 'supabase/functions/_shared/jitsi-jwt.ts', 'signJwtRs256'],
    ],
  },
  {
    name: 'Invite link join',
    steps: [
      ['Route /call/join parsed', 'src/app/lib/callJoinRoute.ts', '/call/join'],
      ['CallJoinScreen → joinCallViaInvite', 'src/app/components/CallJoinScreen.tsx', 'joinCallViaInvite'],
      ['Same joinCall path with inviteToken', 'src/app/lib/api.ts', 'inviteToken'],
      ['RLS RPC get_call_session_for_join', 'supabase/migrations/20260522180000_jitsi_call_rls_invite_and_status_hardening.sql', 'get_call_session_for_join'],
      ['RLS RPC consume_call_invite_token', 'supabase/migrations/20260522180000_jitsi_call_rls_invite_and_status_hardening.sql', 'consume_call_invite_token'],
    ],
  },
  {
    name: 'Parallel second call blocked (same conversation)',
    steps: [
      ['createCallSession checks active ringing/joining/active', 'supabase/functions/_shared/jitsi-call-handlers.ts', '.in("status", ["ringing", "joining", "active"])'],
      ['409 existingSessionId returned', 'supabase/functions/_shared/jitsi-call-handlers.ts', 'existingSessionId'],
      ['Independent room per session via generate_call_room_name', 'supabase/migrations/20260522120000_jitsi_call_sessions_foundation.sql', 'generate_call_room_name'],
    ],
  },
];

const failures = [];

for (const scenario of scenarios) {
  console.log(`\nScenario: ${scenario.name}`);
  for (const [label, relPath, needle] of scenario.steps) {
    const full = path.join(root, relPath);
    if (!fs.existsSync(full)) {
      failures.push(`${scenario.name}: missing file ${relPath}`);
      console.log(`  ✗ ${label} — file missing`);
      continue;
    }
    const ok = fs.readFileSync(full, 'utf8').includes(needle);
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failures.push(`${scenario.name}: ${label} (${relPath})`);
  }
}

console.log('');
if (failures.length) {
  console.error('E2E checklist FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('E2E wiring checklist OK (static).');
console.log('Manual smoke test after deploy:');
console.log('  1) VITE_CALL_PROVIDER=jitsi — configure JITSI_DOMAIN + JWT secrets (8x8 JaaS or self-hosted).');
console.log('  2) User A calls User B — host JWT starts room, participant joins via joinCall.');
console.log('  3) createCallSession with generateInviteLink — open /call/join?session=&token= as User C.');
console.log('  4) While call 1 active on conversation X, start call 2 on X → expect 409.');
