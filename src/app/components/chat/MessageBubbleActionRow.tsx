import React, { useState } from 'react';
import { Reply } from 'lucide-react';
import { useSwipeToReply } from '../../hooks/useSwipeToReply';
import { useIsMdUp } from '../ui/use-mobile';
import { MessageContextMenu, MessageContextMenuWrapper } from './MessageContextMenu';
import { MessageRowReplyButton } from './MessageRowReplyButton';
import { useLongPress } from '../../hooks/useLongPress';

interface MessageBubbleActionRowProps {
  isMe: boolean;
  onReply: () => void;
  canDelete?: boolean;
  onDelete?: () => void;
  onReact?: (emoji: string) => void;
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
  onReact,
  children,
}: MessageBubbleActionRowProps) {
  const isMdUp = useIsMdUp();
  const { offsetX, swipeProgress, swipeHandlers, callbackRef } = useSwipeToReply(onReply, !isMdUp);
  const [mobileMenu, setMobileMenu] = useState<{ x: number; y: number } | null>(null);

  const { bind: longPressBind } = useLongPress(
    (event: React.PointerEvent) => {
      if (isMdUp) return;
      setMobileMenu({ x: event.clientX, y: event.clientY });
    }
  );

  const bubble = (
    <div
      ref={!isMdUp ? callbackRef : undefined}
      className="relative w-max min-w-0 shrink touch-pan-y"
      style={{
        transform: offsetX < 0 ? `translateX(${offsetX}px)` : undefined,
        transition: offsetX < 0 ? 'none' : 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      onContextMenu={!isMdUp ? (e) => e.preventDefault() : undefined}
      {...(!isMdUp ? swipeHandlers : {})}
      {...(!isMdUp ? longPressBind : {})}
    >
      {!isMdUp && swipeProgress > 0.08 ? (
        <div
          className="pointer-events-none absolute inset-y-0 right-2 z-0 flex items-center"
          style={{ opacity: Math.min(swipeProgress * 1.4, 1) }}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blyve/15 text-blyve dark:bg-blyve/20">
            <Reply className="h-3.5 w-3.5" aria-hidden />
          </div>
        </div>
      ) : null}
      {isMdUp ? (
        <MessageContextMenuWrapper
          canDelete={canDelete}
          onReply={onReply}
          onDelete={onDelete ?? onReply}
          onReact={onReact}
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
      {mobileMenu ? (
        <MessageContextMenu
          x={mobileMenu.x}
          y={mobileMenu.y}
          canDelete={canDelete}
          onReply={() => { onReply(); setMobileMenu(null); }}
          onDelete={() => { onDelete?.(); setMobileMenu(null); }}
          onReact={onReact ? (emoji) => { onReact(emoji); setMobileMenu(null); } : undefined}
          onClose={() => setMobileMenu(null)}
        />
      ) : null}
    </div>
  );
}
