import React from 'react';
import { Reply } from 'lucide-react';
import { useSwipeToReply } from '../../hooks/useSwipeToReply';
import { useIsMdUp } from '../ui/use-mobile';
import { MessageContextMenuWrapper } from './MessageContextMenu';
import { MessageRowReplyButton } from './MessageRowReplyButton';

interface MessageBubbleActionRowProps {
  isMe: boolean;
  onReply: () => void;
  canDelete?: boolean;
  onDelete?: () => void;
  children: React.ReactNode;
}

/**
 * Reply control sits in the same inline row as the message bubble (width: max-content),
 * so the button always hugs the bubble regardless of line count or parent column width.
 */
export function MessageBubbleActionRow({
  isMe,
  onReply,
  canDelete = false,
  onDelete,
  children,
}: MessageBubbleActionRowProps) {
  const isMdUp = useIsMdUp();
  const { offsetX, swipeProgress, swipeHandlers } = useSwipeToReply(onReply, !isMdUp);

  const bubble = (
    <div
      className="relative w-max min-w-0 shrink touch-pan-y"
      style={{
        transform: offsetX < 0 ? `translateX(${offsetX}px)` : undefined,
        transition: offsetX < 0 ? 'none' : 'transform 0.2s ease-out',
      }}
      {...(!isMdUp ? swipeHandlers : {})}
    >
      {!isMdUp && swipeProgress > 0.08 ? (
        <div
          className="pointer-events-none absolute inset-y-0 right-2 z-0 flex items-center"
          style={{ opacity: Math.min(swipeProgress * 1.4, 1) }}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500/15 text-orange-500 dark:bg-orange-500/20">
            <Reply className="h-3.5 w-3.5" aria-hidden />
          </div>
        </div>
      ) : null}
      {isMdUp ? (
        <MessageContextMenuWrapper
          canDelete={canDelete}
          onReply={onReply}
          onDelete={onDelete ?? onReply}
        >
          {children}
        </MessageContextMenuWrapper>
      ) : (
        children
      )}
    </div>
  );

  return (
    <div className="group/bubble flex w-max min-w-0 items-center gap-1.5">
      {isMe ? (
        <>
          <MessageRowReplyButton onReply={onReply} />
          {bubble}
        </>
      ) : (
        <>
          {bubble}
          <MessageRowReplyButton onReply={onReply} />
        </>
      )}
    </div>
  );
}
