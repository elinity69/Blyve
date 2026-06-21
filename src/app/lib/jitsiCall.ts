import { api } from './api';
import type { CallMediaType } from './jitsi';
import i18n from '../../lib/i18n';

/** LiveKit client pattern — must never be used for Jitsi rooms. */
const LIVEKIT_CLIENT_ROOM_PATTERN = /^call_[0-9a-f-]{36}$/i;

/** Public meet . jit . si moderated embed — not supported for Blyve. */
const UNSUPPORTED_JITSI_DOMAINS = new Set(['meet.' + 'jit.si']);

export interface JitsiJoinCredentials {
  sessionId: string;
  roomName: string;
  jitsiDomain: string;
  jitsiAppId?: string;
  displayName: string;
  callType: CallMediaType;
  status?: string;
  jwt: string;
  isModerator?: boolean;
}

/**
 * Fetch Jitsi join credentials from the server — mirrors LiveKit token fetch.
 * Never constructs or guesses roomName on the client.
 */
export async function fetchJitsiJoinCredentials(
  sessionId: string,
  inviteToken?: string,
): Promise<JitsiJoinCredentials> {
  let payload: Record<string, unknown> | null | undefined;
  try {
    payload = await api.joinCall(sessionId, inviteToken);
  } catch (error) {
    const err = error as { statusCode?: number; responsePayload?: Record<string, unknown>; message?: string };
    if (err?.statusCode === 409) {
      // If the server returned join credentials inside the 409 payload, use them directly.
      if (err?.responsePayload?.jwt) {
        payload = err.responsePayload;
      } else {
        // "Accept the call before joining" — auto-accept then retry once.
        const msg = String(err?.responsePayload?.error || err?.message || '').toLowerCase();
        if (msg.includes('accept') || msg.includes('pending')) {
          try {
            await api.acceptCall(sessionId, 'accept');
          } catch {
            // best-effort; if accept fails (e.g. already accepted) proceed anyway
          }
          payload = await api.joinCall(sessionId, inviteToken);
        } else {
          throw error;
        }
      }
    } else {
      throw error;
    }
  }
  return parseJitsiJoinPayload(payload, sessionId);
}

/** Reject room names that look client-derived instead of server-issued. */
export function assertServerAuthorizedRoom(roomName: string, sessionId: string): void {
  const normalized = roomName.trim();
  if (!normalized) {
    throw new Error('Missing Jitsi room name from authorized join response');
  }
  if (normalized === sessionId.trim()) {
    throw new Error('Invalid join response: room name must not equal session id');
  }
  const roomSlug = normalized.includes('/') ? normalized.split('/').pop() ?? normalized : normalized;
  if (LIVEKIT_CLIENT_ROOM_PATTERN.test(roomSlug)) {
    throw new Error('Invalid join response: client-derived room name rejected');
  }
  if (!roomSlug.startsWith('blyve_')) {
    throw new Error('Invalid join response: room slug must be server-issued');
  }
}

/**
 * For JaaS (8x8.vc), the roomName passed to JitsiMeetExternalAPI MUST be
 * `{appId}/{slug}` — JaaS uses the appId prefix to derive the tenant and
 * match it against the `kid` in the JWT. Stripping it causes:
 *   "kid and jwt tenant do not match or wrong tenant in URL"
 *
 * The external_api.js script is loaded from a separate URL that already
 * includes the appId, so the roomName itself must still carry the prefix.
 */
export function resolveJitsiExternalRoomName(roomName: string, jitsiAppId?: string): string {
  const normalized = roomName.trim();
  const appId = jitsiAppId?.trim();
  if (!appId) return normalized;

  const prefix = `${appId}/`;
  if (normalized.startsWith(prefix)) return normalized;
  return `${prefix}${normalized}`;
}

function parseJitsiJoinPayload(
  payload: Record<string, unknown> | null | undefined,
  sessionId: string,
): JitsiJoinCredentials {
  const roomName = String(payload?.roomName || payload?.room_name || '').trim();
  const jitsiDomain = String(payload?.jitsiDomain || payload?.jitsi_domain || '').trim();

  if (!roomName) {
    throw new Error('Missing Jitsi room name from authorized join response');
  }
  if (!jitsiDomain) {
    throw new Error('Missing Jitsi domain from authorized join response');
  }
  if (UNSUPPORTED_JITSI_DOMAINS.has(jitsiDomain.toLowerCase())) {
    throw new Error(
      'Public meet.' + 'jit.si is not supported for Blyve calls. Configure 8x8 JaaS or a self-hosted Jitsi server.',
    );
  }

  const jwt = String(payload?.jwt || '').trim();
  if (!jwt) {
    throw new Error(
      'Missing Jitsi JWT from authorized join response. Set JITSI_APP_ID and JITSI_APP_SECRET on the server.',
    );
  }

  assertServerAuthorizedRoom(roomName, sessionId);

  return {
    sessionId: String(payload?.sessionId || payload?.callSessionId || sessionId),
    roomName,
    jitsiDomain,
    jitsiAppId: payload?.jitsiAppId ? String(payload.jitsiAppId) : undefined,
    displayName: String(payload?.displayName || 'Participant'),
    callType: (payload?.callType || 'audio') as CallMediaType,
    status: payload?.status ? String(payload.status) : undefined,
    jwt,
    isModerator: payload?.isModerator === true || payload?.isModerator === 'true',
  };
}

/** smart-action parallel to getLivekitToken — action=jitsi */
export async function fetchJitsiJoinViaSmartAction(
  sessionId: string,
  inviteToken?: string,
): Promise<JitsiJoinCredentials> {
  const payload = await api.getJitsiJoinViaSmartAction(sessionId, inviteToken);
  return parseJitsiJoinPayload(payload, sessionId);
}

export function toJitsiCallError(error: unknown): string {
  const message = String((error as { message?: string })?.message || '');
  const lower = message.toLowerCase();
  if (lower.includes('jitsi') && lower.includes('config')) {
    return i18n.t('call.backendConfigMissing');
  }
  if (
    lower.includes('meet.' + 'jit.si') ||
    lower.includes('jitsi jwt') ||
    lower.includes('jwt auth') ||
    lower.includes('jitsi_app_id')
  ) {
    return i18n.t('call.jitsiJwtRequired');
  }
  if (lower.includes('accept the call before joining')) {
    return i18n.t('call.acceptBeforeJoin');
  }
  if (lower.includes('invalid invite token') || lower.includes('invite token expired')) {
    return i18n.t('call.invalidInviteLink');
  }
  if (
    lower.includes('conference not found') ||
    lower.includes('room does not exist') ||
    lower.includes('not allowed to join')
  ) {
    return i18n.t('call.roomUnavailable');
  }
  if (lower.includes('unauthorized') || lower.includes('authentication')) {
    return i18n.t('call.joinUnauthorized');
  }
  return message || i18n.t('call.genericError');
}
