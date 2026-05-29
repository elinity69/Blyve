import React from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { useCall } from '../context/CallContext';
import { useTranslation } from 'react-i18next';

export function IncomingCallPopup() {
  const { t } = useTranslation();
  const { incomingCall, state, acceptIncomingCall, declineIncomingCall } = useCall();

  if (!incomingCall || state !== 'incoming') return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[140] flex justify-center p-4 pointer-events-none">
      <div className="mt-10 w-full max-w-md rounded-2xl border border-red-500/35 bg-[#18191c] shadow-2xl pointer-events-auto overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-red-600/80 via-pink-600/80 to-orange-500/80">
          <p className="text-xs tracking-wide uppercase text-white/90 font-semibold">{t('call.incoming')}</p>
        </div>
        <div className="p-5 flex items-center gap-4">
          {incomingCall.caller.avatarUrl ? (
            <img
              src={incomingCall.caller.avatarUrl}
              alt={incomingCall.caller.name}
              className="w-14 h-14 rounded-full object-cover border border-white/20"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-[#2f3136] flex items-center justify-center text-white font-bold text-lg">
              {incomingCall.caller.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm text-white/70">{t('call.title')}</p>
            <p className="text-white text-lg font-semibold truncate">{incomingCall.caller.name}</p>
          </div>
        </div>
        <div className="px-5 pb-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void declineIncomingCall()}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#ed4245] hover:bg-[#f15a5d] text-white font-medium px-3 py-2.5 transition-colors"
          >
            <PhoneOff className="w-4 h-4" />
            {t('call.decline')}
          </button>
          <button
            type="button"
            onClick={() => void acceptIncomingCall()}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#3ba55d] hover:bg-[#46be6b] text-white font-medium px-3 py-2.5 transition-colors"
          >
            <Phone className="w-4 h-4" />
            {t('call.accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
