import { MessageBubble } from './MessageBubble';
import { MessageEmbedList } from './MessageEmbedList';
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

  if (!showText && embeds.length > 0) {
    return (
      <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        <MessageEmbedList embeds={embeds} />
        {messageTime ? (
          <span
            className={`mt-0.5 text-[10px] leading-none ${
              isMe ? 'text-white/75 dark:text-[#8fa4b8]' : 'text-gray-500 dark:text-[#6b7d8f]'
            }`}
          >
            {messageTime}
          </span>
        ) : null}
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
      </MessageBubble>
      {embeds.length > 0 ? <MessageEmbedList embeds={embeds} /> : null}
    </div>
  );
}
