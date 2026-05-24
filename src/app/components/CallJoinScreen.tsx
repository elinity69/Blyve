import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCall } from '../context/CallContext';
import { isJitsiCallProvider } from '../lib/callProvider';
import { type CallJoinParams, clearCallJoinUrl } from '../lib/callJoinRoute';
import { toJitsiCallError } from '../lib/jitsiCall';

export type { CallJoinParams };
export { parseCallJoinParams, clearCallJoinUrl, isCallJoinRoute, CALL_JOIN_PATH } from '../lib/callJoinRoute';

interface CallJoinScreenProps {
  params: CallJoinParams;
  onDone?: () => void;
}

export function CallJoinScreen({ params, onDone }: CallJoinScreenProps) {
  const { t } = useTranslation();
  const { joinCallViaInvite, state, connectionState, errorMessage } = useCall();
  const [localError, setLocalError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const attemptedRef = useRef(false);

  const attemptJoin = useCallback(async () => {
    if (!isJitsiCallProvider()) {
      setLocalError(t('call.joinViaInviteProviderRequired'));
      return;
    }
    setJoining(true);
    setLocalError(null);
    try {
      await joinCallViaInvite(params.sessionId, params.token);
    } catch (error: unknown) {
      setLocalError(toJitsiCallError(error));
    } finally {
      setJoining(false);
    }
  }, [joinCallViaInvite, params.sessionId, params.token, t]);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    void attemptJoin();
  }, [attemptJoin]);

  useEffect(() => {
    if (state === 'in_call' && connectionState === 'connected') {
      clearCallJoinUrl();
      onDone?.();
    }
  }, [connectionState, onDone, state]);

  const displayError = localError || errorMessage;
  const isConnecting =
    joining ||
    (state === 'in_call' &&
      (connectionState === 'connecting' || connectionState === 'disconnected'));

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gradient-to-br from-orange-500 to-pink-600 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/20 bg-[#18191c] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-gradient-to-r from-red-600/80 via-pink-600/80 to-orange-500/80">
          <p className="text-white font-semibold">{t('call.joinViaInviteTitle')}</p>
        </div>
        <div className="p-6 space-y-4">
          {isConnecting && !displayError ? (
            <div className="flex items-center gap-3 text-white/90">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{t('call.joinViaInviteJoining')}</span>
            </div>
          ) : displayError ? (
            <>
              <p className="text-sm text-red-300">{displayError}</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    clearCallJoinUrl();
                    onDone?.();
                  }}
                  className="flex-1 rounded-xl bg-[#2f3136] hover:bg-[#3a3d44] text-white px-4 py-2.5"
                >
                  {t('call.joinViaInviteGoHome')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    attemptedRef.current = false;
                    void attemptJoin();
                  }}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#3ba55d] hover:bg-[#46be6b] text-white px-4 py-2.5"
                >
                  <Phone className="w-4 h-4" />
                  {t('call.retryConnection')}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
