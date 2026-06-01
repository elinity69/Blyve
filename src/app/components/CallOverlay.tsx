import React from 'react';
import { Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCall } from '../context/CallStateContext';
import { useTranslation } from 'react-i18next';

interface CallOverlayProps {
  conversationId: string;
}

function connectionLabel(state: string, t: (key: string) => string) {
  switch (state) {
    case 'connected':
      return t('call.connectionConnected');
    case 'connecting':
      return t('call.connectionConnecting');
    case 'reconnecting':
      return t('call.connectionReconnecting');
    default:
      return t('call.connectionDisconnected');
  }
}

export function CallOverlay({ conversationId }: CallOverlayProps) {
  const { t } = useTranslation();
  const {
    state,
    activeCall,
    connectionState,
    isMuted,
    isCameraEnabled,
    isScreenShareEnabled,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    hangUp,
    isCallForConversation,
    errorMessage,
    canRetryConnection,
    retryAttempt,
    isAutoRetrying,
    retryConnection,
    debugTrail,
    selfRole,
    localIdentity,
    remoteParticipantCount,
    mediaCaptureAvailable,
  } = useCall();

  if (!isCallForConversation(conversationId)) return null;

  const live = state === 'in_call' && connectionState === 'connected';

  const subtitle = (() => {
    if (state === 'calling') {
      return t('call.waitingForParticipant');
    }
    if (state === 'in_call') {
      return connectionLabel(connectionState, t);
    }
    return t('call.waitingForParticipant');
  })();

  return (
    <div className="absolute top-2 left-2 right-2 z-[130] pointer-events-none">
      <div className="rounded-2xl border border-white/10 bg-[#1b1d21]/95 p-3 shadow-2xl pointer-events-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-white/60">{t('call.title')}</p>
          <h3 className="text-base font-semibold text-white mt-0.5">
            {state === 'calling'
              ? t('call.calling')
              : state === 'in_call'
              ? t('call.inCall')
              : t('call.ended')}
          </h3>
          <p className="text-xs text-white/70 mt-0.5">
            {subtitle}
          </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void toggleMute()}
              disabled={!live}
              className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
                isMuted ? 'bg-yellow-500 text-black' : 'bg-[#2f3136] text-white'
              } disabled:opacity-60`}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => void toggleCamera()}
              disabled={!live}
              className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
                isCameraEnabled ? 'bg-blyve text-white' : 'bg-[#2f3136] text-white'
              } disabled:opacity-60`}
            >
              {isCameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => void toggleScreenShare()}
              disabled={!live}
              className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
                isScreenShareEnabled ? 'bg-cyan-500 text-black' : 'bg-[#2f3136] text-white'
              } disabled:opacity-60`}
            >
              <MonitorUp className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => void hangUp()}
              className="h-9 w-9 rounded-full flex items-center justify-center bg-[#ed4245] hover:bg-[#f15a5d] text-white transition-colors"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>
        </div>

          {errorMessage ? (
            <div className="mt-3 rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-2">
              <p className="text-xs text-red-100">{errorMessage}</p>
            </div>
          ) : null}
          {canRetryConnection ? (
            <div className="mt-3 rounded-lg border border-yellow-300/30 bg-yellow-500/10 px-3 py-2 flex items-center justify-between gap-2">
              <p className="text-xs text-yellow-100">
                {isAutoRetrying
                  ? t('call.reconnectAutoTrying', { attempt: retryAttempt + 1 })
                  : t('call.reconnectHint')}
              </p>
              <button
                type="button"
                onClick={() => void retryConnection()}
                className="px-2.5 py-1 rounded-md text-xs font-semibold bg-yellow-400 text-black hover:bg-yellow-300"
              >
                {t('call.retryConnection')}
              </button>
            </div>
          ) : null}
          {process.env.NODE_ENV === 'development' ? (
            <div className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-3 py-2">
              <p className="text-[11px] text-cyan-100 font-mono">
                state={state} | conn={connectionState} | retryAttempt={retryAttempt} | autoRetry=
                {isAutoRetrying ? 'on' : 'off'}
              </p>
              <p className="text-[10px] text-cyan-50/90 font-mono truncate">
                role={selfRole} | session={activeCall?.callSessionId || 'none'} | local=
                {localIdentity || 'n/a'} | remoteCount={remoteParticipantCount} | media=
                {mediaCaptureAvailable ? 'ok' : 'missing'}
              </p>
              {debugTrail.length > 0 ? (
                <div className="mt-2 space-y-0.5">
                  {debugTrail.slice(0, 4).map((line, idx) => (
                    <p key={`${line}-${idx}`} className="text-[10px] text-cyan-50/90 font-mono truncate">
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {(activeCall?.participants || []).map((p) => (
              <div key={p.id} className="px-3 py-1.5 rounded-full bg-white/10 text-white text-xs border border-white/10 flex items-center gap-2">
                {p.avatarUrl ? (
                  <img src={p.avatarUrl} alt={p.name} className="w-4 h-4 rounded-full object-cover" />
                ) : null}
                <span>{p.name}</span>
              </div>
            ))}
          </div>
        </div>
    </div>
  );
}
