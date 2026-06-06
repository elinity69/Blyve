import { MessageBubble } from './MessageBubble';
import { MessageEmbedList } from './MessageEmbedList';
import { MessageEmbedTimeFooter } from './MessageEmbedTimeFooter';
import { MessageReplyQuote } from './MessageReplyQuote';
import type { ReplyQuoteData } from '../../lib/messageReply';
import type { MessageGroupPosition } from '../../lib/messageGrouping';
import {
  CHAT_MESSAGE_BUBBLE_MAX_WIDTH_CLASS,
  CHAT_MESSAGE_BUBBLE_TEXT_CLASS,
  CHAT_MESSAGE_BUBBLE_TEXT_GROUPED_CLASS,
  CHAT_MESSAGE_BODY_STACK_CLASS,
} from './chatMessageStyles';
import { MessageTextContent } from './MessageTextContent';
import { useMessageContentParts } from './MessageContent';
import type { ReactionSummary } from '../../hooks/useMessageReactions';
import { MessageReactionBar } from './MessageReactionBar';

interface ChatMessageBodyProps {
  messageId: string;
  content: string;
  isMe: boolean;
  isBundled: boolean;
  replyQuote: ReplyQuoteData | null;
  bubblePosition: MessageGroupPosition;
  messageTime?: string;
  isRead?: boolean;
  readLabel?: string;
  /** Reaction summaries — provided by parent MessageWithReactions */
  summaries?: ReactionSummary[];
  /** Toggle reaction callback — provided by parent MessageWithReactions */
  onToggleReaction?: (emoji: string) => void;
}

export function ChatMessageBody({
  messageId: _messageId,
  content,
  isMe,
  isBundled,
  replyQuote,
  bubblePosition,
  messageTime,
  isRead,
  readLabel,
  summaries = [],
  onToggleReaction,
}: ChatMessageBodyProps) {
  const { embeds, suppressUrls, showText } = useMessageContentParts(content);
  const textClassName = isBundled
    ? CHAT_MESSAGE_BUBBLE_TEXT_GROUPED_CLASS
    : CHAT_MESSAGE_BUBBLE_TEXT_CLASS;

  const mediaOnly = !showText && embeds.length > 0;
  const voiceOnly = mediaOnly && embeds.length === 1 && embeds[0]?.kind === 'audio';

  const reactionBar = onToggleReaction ? (
    <MessageReactionBar summaries={summaries} isMe={isMe} onToggle={onToggleReaction} />
  ) : null;

  if (voiceOnly) {
    return (
      <div className={`${CHAT_MESSAGE_BODY_STACK_CLASS} ${isMe ? 'items-end' : 'items-start'}`}>
        {replyQuote ? (
          <div className="mb-1 max-w-full">
            <MessageReplyQuote quote={replyQuote} isMe={isMe} />
          </div>
        ) : null}
        <MessageBubble position={bubblePosition} isMe={isMe} readLabel={readLabel}>
          <MessageEmbedList embeds={embeds} inBubble isMe={isMe} />
        </MessageBubble>
        <MessageEmbedTimeFooter time={messageTime} isMe={isMe} isRead={isRead} />
        {reactionBar}
      </div>
    );
  }

  if (mediaOnly) {
    return (
      <div className={`${CHAT_MESSAGE_BODY_STACK_CLASS} ${isMe ? 'items-end' : 'items-start'}`}>
        {replyQuote ? (
          <div className="mb-1 max-w-full">
            <MessageReplyQuote quote={replyQuote} isMe={isMe} />
          </div>
        ) : null}
        <div className={`w-max min-w-0 ${CHAT_MESSAGE_BUBBLE_MAX_WIDTH_CLASS}`}>
          <MessageEmbedList embeds={embeds} isMe={isMe} />
        </div>
        <MessageEmbedTimeFooter
          time={messageTime}
          isMe={isMe}
          isRead={isRead}
          readLabel={readLabel}
        />
        {reactionBar}
      </div>
    );
  }

  return (
    <div className={`${CHAT_MESSAGE_BODY_STACK_CLASS} ${isMe ? 'items-end' : 'items-start'}`}>
      <MessageBubble
        position={bubblePosition}
        isMe={isMe}
        time={messageTime}
        isRead={isRead}
        readLabel={readLabel}
      >
        {replyQuote ? <MessageReplyQuote quote={replyQuote} isMe={isMe} /> : null}
        {showText ? (
          <MessageTextContent
            content={content}
            isMe={isMe}
            className={textClassName}
            suppressUrls={suppressUrls}
            embeds={embeds}
          />
        ) : null}
        {embeds.length > 0 ? <MessageEmbedList embeds={embeds} inBubble isMe={isMe} /> : null}
      </MessageBubble>
      {reactionBar}
    </div>
  );
}
