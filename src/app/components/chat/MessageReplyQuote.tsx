import type { ReplyQuoteData } from '../../lib/messageReply';
import { scrollToMessage } from '../../lib/messageReply';
import { useTranslation } from 'react-i18next';

interface MessageReplyQuoteProps {
  quote: ReplyQuoteData;
  isMe: boolean;
}

export function MessageReplyQuote({ quote, isMe }: MessageReplyQuoteProps) {
  const { t } = useTranslation();
  const preview = quote.content || t('chat.originalMessageUnavailable');

  return (
    <button
      type="button"
      onClick={() => scrollToMessage(quote.messageId)}
      className={`mb-1 w-full rounded-md border-l-2 px-1.5 py-0.5 text-left transition-opacity hover:opacity-80 ${
        isMe
          ? 'border-white/50 bg-white/10'
          : 'border-orange-500/80 bg-black/[0.04] dark:border-orange-400/70 dark:bg-black/20'
      }`}
    >
      <p className={`text-[10px] font-medium leading-tight ${isMe ? 'text-white/90' : 'text-orange-600 dark:text-orange-400'}`}>
        {quote.senderLabel}
      </p>
      <p className={`truncate text-[11px] leading-tight ${isMe ? 'text-white/75' : 'text-gray-600 dark:text-gray-300'}`}>
        {preview}
      </p>
    </button>
  );
}
