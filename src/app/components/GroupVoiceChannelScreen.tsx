import React from 'react';
import { ArrowLeft, PictureInPicture2, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCall } from '../context/CallContext';
import { getOptimizedImageUrl } from '../lib/images';
import { ChatEmbeddedCallBar } from './ChatEmbeddedCallBar';

function groupAccentHue(groupId: string): number {
  let h = 0;
  for (let i = 0; i < groupId.length; i += 1) h += groupId.charCodeAt(i);
  return 200 + (h % 140);
}

interface GroupVoiceChannelScreenProps {
  groupId: string;
  groupName: string;
  channelId: string;
  channelName: string;
  channelIconUrl?: string | null;
  groupIconUrl?: string | null;
  currentUserId: string;
  onBack: () => void;
  onMinimizeToPip?: () => void;
}

export function GroupVoiceChannelScreen({
  groupId,
  groupName,
  channelId,
  channelName,
  channelIconUrl,
  groupIconUrl,
  currentUserId,
  onBack,
  onMinimizeToPip,
}: GroupVoiceChannelScreenProps) {
  const { t } = useTranslation();
  const { hangUp, enterCallPip } = useCall();

  const handleMinimizeToPip = () => {
    enterCallPip();
    onMinimizeToPip?.();
  };
  const hue = groupAccentHue(groupId);
  const groupInitial = groupName.trim().charAt(0).toUpperCase() || '?';
  const channelIconSrc = channelIconUrl
    ? getOptimizedImageUrl(channelIconUrl, 80)
    : groupIconUrl
      ? getOptimizedImageUrl(groupIconUrl, 80)
      : null;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white dark:bg-[#0d0d0d] md:dark:bg-[#0e0e0e]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#0d0d0d] md:dark:bg-[#0e0e0e] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full shrink-0 md:hidden"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
          >
            <ArrowLeft className="w-6 h-6 text-gray-900 dark:text-white" />
          </button>
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 overflow-hidden"
            style={
              channelIconSrc
                ? undefined
                : { background: `linear-gradient(145deg, hsl(${hue}, 42%, 42%), hsl(${hue}, 45%, 32%))` }
            }
            aria-hidden
          >
            {channelIconSrc ? (
              <img src={channelIconSrc} alt="" className="w-full h-full object-cover" />
            ) : (
              groupInitial
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">{groupName}</h2>
            <p className="text-xs text-[#23a559] truncate flex items-center gap-1">
              <Volume2 className="w-3 h-3 shrink-0" />
              {channelName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleMinimizeToPip}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
            aria-label={t('call.minimizeToPip')}
          >
            <PictureInPicture2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void hangUp()}
            className="text-xs font-medium text-red-600 dark:text-red-400 px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
          >
            {t('groups.voiceDisconnect')}
          </button>
        </div>
      </div>

      <ChatEmbeddedCallBar
        currentUserId={currentUserId}
        voiceGroupId={groupId}
        voiceChannelId={channelId}
      />

      <div className="flex flex-1 min-h-0 items-center justify-center px-6 pb-8">
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          {t('groups.voiceConnected', { channel: channelName })}
        </p>
      </div>
    </div>
  );
}
