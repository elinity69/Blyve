/**
 * Static verification: Jitsi iframe mount only via joinCall credentials.
 * Run: node scripts/verify-jitsi-client-flow.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcApp = path.join(root, 'src', 'app');

const failures = [];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

const files = walk(srcApp);
const byRel = Object.fromEntries(files.map((f) => [rel(f), f]));

// 1) No hardcoded public Jitsi hosts in client src/app
for (const file of files) {
  const content = read(file);
  if (/meet\.jit\.si/i.test(content)) {
    failures.push(`${rel(file)}: contains hardcoded meet.jit.si`);
  }
  if (/VITE_JITSI_DOMAIN/i.test(content)) {
    failures.push(`${rel(file)}: references VITE_JITSI_DOMAIN`);
  }
}

// 2) mountJitsiMeetingFromServerJoin only used from JitsiCallView (+ definition in jitsi.ts)
for (const file of files) {
  const content = read(file);
  if (!content.includes('mountJitsiMeetingFromServerJoin')) continue;
  const r = rel(file);
  if (r !== 'src/app/lib/jitsi.ts' && r !== 'src/app/components/JitsiCallView.tsx') {
    failures.push(`${r}: unexpected mountJitsiMeetingFromServerJoin usage`);
  }
}

// 3) Legacy direct mount export must not exist
for (const file of files) {
  const content = read(file);
  if (/export async function mountJitsiMeeting\b/.test(content)) {
    failures.push(`${rel(file)}: exports mountJitsiMeeting directly`);
  }
}

// 4) fetchJitsiJoinCredentials only in JitsiCallView + jitsiCall
for (const file of files) {
  const content = read(file);
  if (!content.includes('fetchJitsiJoinCredentials')) continue;
  const r = rel(file);
  if (r !== 'src/app/lib/jitsiCall.ts' && r !== 'src/app/components/JitsiCallView.tsx') {
    failures.push(`${r}: unexpected fetchJitsiJoinCredentials usage`);
  }
}

// 5) Invite route chain files exist and reference joinCallViaInvite
const chainChecks = [
  ['src/app/lib/callJoinRoute.ts', '/call/join'],
  ['src/app/components/CallJoinScreen.tsx', 'joinCallViaInvite'],
  ['src/app/context/CallStateContext.tsx', 'JitsiCallView'],
  ['src/app/lib/jitsiCall.ts', 'api.joinCall'],
];

for (const [relPath, needle] of chainChecks) {
  const file = byRel[relPath];
  if (!file) {
    failures.push(`missing ${relPath}`);
    continue;
  }
  if (!read(file).includes(needle)) {
    failures.push(`${relPath}: expected "${needle}"`);
  }
}

// 6) livekitCall client room pattern isolated to livekitCall.ts
for (const file of files) {
  const content = read(file);
  if (/`call_\$\{/.test(content) && rel(file) !== 'src/app/lib/livekitCall.ts') {
    failures.push(`${rel(file)}: client LiveKit room pattern outside livekitCall.ts`);
  }
}

if (failures.length) {
  console.error('Jitsi client flow verification FAILED:\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('Jitsi client flow verification OK');
console.log('  Invite: /call/join -> CallJoinScreen -> joinCallViaInvite -> JitsiCallView -> joinCall -> IFrame');
