import React from 'react';
import { Reply } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSwipeToReply } from '../../hooks/useSwipeToReply';
import { useIsMdUp } from '../ui/use-mobile';

interface MessageRowReplyWrapperProps {
  children: React.ReactNode;
  isMe: boolean;
  onReply: () => void;
}

/** Full-width row wrapper: mobile swipe-left-to-reply, desktop hover reply. */
export function MessageRowReplyWrapper({
  children,
  isMe,
  onReply,
}: MessageRowReplyWrapperProps) {
  const { t } = useTranslation();
  const isMdUp = useIsMdUp();
  const { offsetX, swipeProgress, swipeHandlers } = useSwipeToReply(onReply, !isMdUp);

  return (
    <div
      className="group relative w-full touch-pan-y"
      {...(!isMdUp ? swipeHandlers : {})}
    >
      {!isMdUp && swipeProgress > 0.08 ? (
        <div
          className="pointer-events-none absolute inset-y-0 right-3 z-0 flex items-center"
          style={{ opacity: Math.min(swipeProgress * 1.4, 1) }}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500/15 text-orange-500 dark:bg-orange-500/20">
            <Reply className="h-3.5 w-3.5" />
          </div>
        </div>
      ) : null}

      <div
        className="relative z-[1] w-full"
        style={{
          transform: offsetX < 0 ? `translateX(${offsetX}px)` : undefined,
          transition: offsetX < 0 ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {children}
      </div>

      <button
        type="button"
        onClick={onReply}
        className={`absolute top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white/95 p-1.5 text-gray-500 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-orange-500 dark:bg-gray-800/95 dark:text-gray-300 dark:hover:text-orange-400 md:block ${
          isMe ? 'right-1' : 'left-1'
        }`}
        aria-label={t('chat.replyToMessage')}
      >
        <Reply className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
