/**
 * MessageWithReactions — composes MessageBubbleActionRow + ChatMessageBody
 * sharing the single useMessageReactions hook instance between them.
 *
 * This avoids duplication of hook calls and lets the context menu's onReact
 * use the same toggleReaction as the reaction bar pills.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageBubbleActionRow } from './MessageBubbleActionRow';
import { ChatMessageBody } from './ChatMessageBody';
import { useMessageReactions } from '../../hooks/useMessageReactions';
import type { ReplyQuoteData } from '../../lib/messageReply';
import type { MessageGroupPosition } from '../../lib/messageGrouping';
import { toast } from '../../lib/toast';

interface MessageWithReactionsProps {
  messageId: string;
  content: string;
  isMe: boolean;
  isBundled: boolean;
  canDelete: boolean;
  replyQuote: ReplyQuoteData | null;
  bubblePosition: MessageGroupPosition;
  messageTime?: string;
  isRead?: boolean;
  readLabel?: string;
  onReply: () => void;
  onDelete: () => void;
}

export function MessageWithReactions({
  messageId,
  content,
  isMe,
  isBundled,
  canDelete,
  replyQuote,
  bubblePosition,
  messageTime,
  isRead,
  readLabel,
  onReply,
  onDelete,
}: MessageWithReactionsProps) {
  const { t } = useTranslation();
  const { summaries, toggleReaction } = useMessageReactions(messageId, { isOwnMessage: isMe });

  const handleReact = useCallback(
    (emoji: string) => {
      toggleReaction(emoji).catch(() => {
        toast.error(t('chat.reactionFailedTitle'));
      });
    },
    [toggleReaction, t]
  );

  return (
    <MessageBubbleActionRow
      isMe={isMe}
      canDelete={canDelete}
      onReply={onReply}
      onDelete={onDelete}
      onReact={handleReact}
    >
      <ChatMessageBody
        messageId={messageId}
        content={content}
        isMe={isMe}
        isBundled={isBundled}
        replyQuote={replyQuote}
        bubblePosition={bubblePosition}
        messageTime={messageTime}
        isRead={isRead}
        readLabel={readLabel}
        summaries={summaries}
        onToggleReaction={toggleReaction}
      />
    </MessageBubbleActionRow>
  );
}
