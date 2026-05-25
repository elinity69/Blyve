import React from 'react';
import { Reply } from 'lucide-react';
import { useSwipeToReply } from '../../hooks/useSwipeToReply';
import { useIsMdUp } from '../ui/use-mobile';

interface MessageRowReplyWrapperProps {
  children: React.ReactNode;
  onReply: () => void;
}

/** Mobile swipe-left-to-reply. Desktop reply button lives beside the bubble in the message row. */
export function MessageRowReplyWrapper({ children, onReply }: MessageRowReplyWrapperProps) {
  const isMdUp = useIsMdUp();
  const { offsetX, swipeProgress, swipeHandlers } = useSwipeToReply(onReply, !isMdUp);

  return (
    <div
      className="relative w-full touch-pan-y"
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
    </div>
  );
}
