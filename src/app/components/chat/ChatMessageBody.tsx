import { MessageBubble } from './MessageBubble';
import { MessageEmbedList } from './MessageEmbedList';
import { MessageEmbedTimeFooter } from './MessageEmbedTimeFooter';
import { MessageReplyQuote } from './MessageReplyQuote';
import type { ReplyQuoteData } from '../../lib/messageReply';
import type { MessageGroupPosition } from '../../lib/messageGrouping';
import {
  CHAT_MESSAGE_BUBBLE_TEXT_CLASS,
  CHAT_MESSAGE_BUBBLE_TEXT_GROUPED_CLASS,
} from './chatMessageStyles';
import { MessageTextContent } from './MessageTextContent';
import { useMessageContentParts } from './MessageContent';

interface ChatMessageBodyProps {
  content: string;
  isMe: boolean;
  isBundled: boolean;
  replyQuote: ReplyQuoteData | null;
  bubblePosition: MessageGroupPosition;
  messageTime?: string;
  isRead?: boolean;
}

export function ChatMessageBody({
  content,
  isMe,
  isBundled,
  replyQuote,
  bubblePosition,
  messageTime,
  isRead,
}: ChatMessageBodyProps) {
  const { embeds, suppressUrls, showText } = useMessageContentParts(content);
  const textClassName = isBundled
    ? CHAT_MESSAGE_BUBBLE_TEXT_GROUPED_CLASS
    : CHAT_MESSAGE_BUBBLE_TEXT_CLASS;

  const mediaOnly = !showText && embeds.length > 0;
  const voiceOnly = mediaOnly && embeds.length === 1 && embeds[0]?.kind === 'audio';

  if (voiceOnly) {
    return (
      <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        {replyQuote ? (
          <div className="mb-1 max-w-full">
            <MessageReplyQuote quote={replyQuote} isMe={isMe} />
          </div>
        ) : null}
        <MessageBubble position={bubblePosition} isMe={isMe} time={messageTime} isRead={isRead}>
          <MessageEmbedList embeds={embeds} inBubble isMe={isMe} />
        </MessageBubble>
      </div>
    );
  }

  if (mediaOnly) {
    return (
      <div className={`flex max-w-full flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        {replyQuote ? (
          <div className="mb-1 max-w-full">
            <MessageReplyQuote quote={replyQuote} isMe={isMe} />
          </div>
        ) : null}
        <div className="max-w-full min-w-0 sm:max-w-[min(100%,20rem)]">
          <MessageEmbedList embeds={embeds} isMe={isMe} />
        </div>
        <MessageEmbedTimeFooter time={messageTime} isMe={isMe} isRead={isRead} />
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
      <MessageBubble position={bubblePosition} isMe={isMe} time={messageTime} isRead={isRead}>
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
    </div>
  );
}
