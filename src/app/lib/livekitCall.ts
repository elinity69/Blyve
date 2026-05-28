import { Room, type LocalParticipant, type RemoteParticipant } from 'livekit-client';
import { resolveAuthUser } from './authSession';
import { api } from './api';
import i18n from '../../lib/i18n';

export interface LiveKitConnectResult {
  room: Room;
  serverUrl: string;
  localIdentity: string;
  remoteCount: number;
}

function normalizeLiveKitServerUrl(rawUrl: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && parsed.protocol === 'ws:') {
      parsed.protocol = 'wss:';
      return parsed.toString();
    }
  } catch {
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && trimmed.startsWith('ws://')) {
      return `wss://${trimmed.slice('ws://'.length)}`;
    }
  }
  return trimmed;
}

export async function connectLiveKitRoom(callSessionId: string): Promise<LiveKitConnectResult> {
  const user = await resolveAuthUser();
  if (!user?.id) {
    throw new Error('Missing user identity for LiveKit token request');
  }

  const roomName = `call_${callSessionId}`;
  const livekitTokenResponse = await api.getLivekitToken({
    identity: user.id,
    room: roomName,
  });

  const participantToken =
    livekitTokenResponse?.token ||
    livekitTokenResponse?.participant_token ||
    livekitTokenResponse?.access_token;
  const serverUrlRaw =
    livekitTokenResponse?.url || livekitTokenResponse?.server_url || livekitTokenResponse?.serverUrl;
  const serverUrl = serverUrlRaw ? normalizeLiveKitServerUrl(serverUrlRaw) : serverUrlRaw;

  if (!serverUrl || !participantToken) {
    throw new Error('Missing LiveKit connection payload');
  }

  const room = new Room();
  await room.connect(serverUrl, participantToken);

  if (navigator?.mediaDevices?.getUserMedia) {
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch {
      // caller handles UI message
    }
  }

  return {
    room,
    serverUrl,
    localIdentity: room.localParticipant.identity || user.id,
    remoteCount: room.remoteParticipants.size,
  };
}

export function toLiveKitCallError(error: unknown): string {
  const message = String((error as { message?: string })?.message || '');
  const lower = message.toLowerCase();
  if (
    lower.includes('livekit backend config is missing') ||
    lower.includes('livekit is not configured')
  ) {
    return i18n.t('call.livekitConfigMissing');
  }
  return message || i18n.t('call.genericError');
}

export type { LocalParticipant, RemoteParticipant };
