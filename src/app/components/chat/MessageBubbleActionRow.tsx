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
  onCopy?: () => void;
  onDownload?: () => void;
  onEdit?: () => void;
  onReact?: (emoji: string) => void;
  /** True while this message is the active reply target in the composer. */
  isReplyTarget?: boolean;
  children: React.ReactNode;
}

/**
 * Full-width swipe row — swipe handlers live on a `w-full` container so the
 * user can initiate a swipe-left-to-reply from anywhere on the message row.
 * The reply icon is pinned to the right edge of the screen and slides in as
 * the bubble drags left, giving the iMessage / Discord feel.
 */
export function MessageBubbleActionRow({
  isMe,
  onReply,
  canDelete = false,
  onDelete,
  onCopy,
  onDownload,
  onEdit,
  onReact,
  isReplyTarget = false,
  children,
}: MessageBubbleActionRowProps) {
  const isMdUp = useIsMdUp();
  const { offsetX, swipeProgress, armed, fired, swipeHandlers, callbackRef } =
    useSwipeToReply(onReply, !isMdUp);
  const [mobileMenu, setMobileMenu] = useState<{ x: number; y: number } | null>(null);

  const { bind: longPressBind } = useLongPress(
    (event: React.PointerEvent) => {
      if (isMdUp) return;
      setMobileMenu({ x: event.clientX, y: event.clientY });
    }
  );

  // ── derived animation values ───────────────────────────────────────────────
  const active = swipeProgress > 0;

  // Icon slides in from the right: starts 22 px off-screen-right, arrives at 0
  // as swipe progresses. Fired: stays in place briefly then resets with the row.
  const iconTranslateX = fired ? 0 : (1 - swipeProgress) * 22;

  // Scale: 0.7 → 1.0 during drag, pops to 1.12 when armed, settles to 1.0 on fire
  const iconScale = fired
    ? 1.0
    : armed
    ? 1.12
    : 0.7 + swipeProgress * 0.3;

  // Opacity: 0 → 1 over the first 65% of swipe progress
  const iconOpacity = fired ? 0.5 : Math.min(swipeProgress / 0.65, 1);

  // Ring bg: subtle tint → brighter when armed
  const ringOpacity = fired ? 0 : armed ? 0.28 : 0.1 + swipeProgress * 0.1;

  // Transitions — no transition while finger is tracking (every frame manual),
  // smooth ease when releasing or pop-arming.
  const iconTransition = active
    ? 'opacity 50ms linear, transform 50ms linear'
    : 'opacity 300ms cubic-bezier(0.25,0.46,0.45,0.94), transform 300ms cubic-bezier(0.25,0.46,0.45,0.94)';

  const scaleTransition = armed || fired
    ? 'transform 160ms cubic-bezier(0.34,1.36,0.64,1), background-color 120ms ease'
    : iconTransition;

  const bubbleTransition = offsetX < 0
    ? 'none'
    : fired
    ? 'transform 280ms cubic-bezier(0.25,0.46,0.45,0.94)'
    : 'transform 320ms cubic-bezier(0.25,0.46,0.45,0.94)';

  // Row highlight — fades in when armed
  const rowHighlightOpacity = armed ? 1 : 0;

  const bubble = (
    <div
      className="relative w-max min-w-0 shrink touch-pan-y"
      style={{
        transform: offsetX < 0 ? `translateX(${offsetX}px)` : undefined,
        transition: bubbleTransition,
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      onContextMenu={!isMdUp ? (e) => e.preventDefault() : undefined}
      {...(!isMdUp ? longPressBind : {})}
    >
      {isMdUp ? (
        <MessageContextMenuWrapper
          canDelete={canDelete}
          onReply={onReply}
          onDelete={onDelete ?? onReply}
          onCopy={onCopy}
          onDownload={onDownload}
          onEdit={onEdit}
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
    <div
      ref={!isMdUp ? callbackRef : undefined}
      className={`relative w-full min-w-0 flex items-center ${isMe ? 'justify-end' : 'justify-start'}`}
      {...(!isMdUp ? swipeHandlers : {})}
    >
      {/* Full-row armed highlight */}
      {!isMdUp && (active || fired) ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md"
          style={{
            backgroundColor: 'rgba(63, 175, 149, 0.07)',
            opacity: rowHighlightOpacity,
            transition: armed
              ? 'opacity 120ms ease'
              : 'opacity 280ms cubic-bezier(0.25,0.46,0.45,0.94)',
          }}
        />
      ) : null}

      {/* Persistent reply-target highlight — shown while this message is selected in the composer */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-sm"
        style={{
          backgroundColor: 'rgba(63, 175, 149, 0.08)',
          borderLeft: isReplyTarget ? '2px solid rgba(63, 175, 149, 0.7)' : '2px solid transparent',
          opacity: isReplyTarget ? 1 : 0,
          transition: 'opacity 200ms ease, border-color 200ms ease',
        }}
      />

      <div className="flex w-max min-w-0 items-center gap-1.5 group/bubble">
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

      {/* Reply icon — pinned to the right edge of the full-width row, slides in
          from the right as the bubble drags left. Sits outside the bubble so it
          never moves with it — only the bubble translates left. */}
      {!isMdUp && (active || fired) ? (
        <div
          aria-hidden
          className="pointer-events-none absolute right-1 flex items-center justify-center"
          style={{
            transform: `translateX(${iconTranslateX}px)`,
            opacity: iconOpacity,
            transition: iconTransition,
          }}
        >
          <div
            className="flex items-center justify-center rounded-full"
            style={{
              width: 30,
              height: 30,
              backgroundColor: `rgba(63, 175, 149, ${ringOpacity})`,
              transform: `scale(${iconScale})`,
              transition: scaleTransition,
              color: armed || fired
                ? 'var(--blyve-highlight, #3faf95)'
                : 'rgba(63, 175, 149, 0.65)',
            }}
          >
            <Reply
              style={{
                width: 14,
                height: 14,
                transform: 'scaleX(-1)',
                strokeWidth: 2.3,
                transition: 'color 120ms ease',
              }}
            />
          </div>
        </div>
      ) : null}

      {mobileMenu ? (
        <MessageContextMenu
          x={mobileMenu.x}
          y={mobileMenu.y}
          canDelete={canDelete}
          onReply={() => { onReply(); setMobileMenu(null); }}
          onDelete={() => { onDelete?.(); setMobileMenu(null); }}
          onCopy={onCopy ? () => { onCopy(); setMobileMenu(null); } : undefined}
          onDownload={onDownload ? () => { onDownload(); setMobileMenu(null); } : undefined}
          onEdit={onEdit ? () => { onEdit(); setMobileMenu(null); } : undefined}
          onReact={onReact ? (emoji) => { onReact(emoji); setMobileMenu(null); } : undefined}
          onClose={() => setMobileMenu(null)}
        />
      ) : null}
    </div>
  );
}
