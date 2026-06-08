/**
 * MessageWithReactions — composes MessageBubbleActionRow + ChatMessageBody
 * sharing the single useMessageReactions hook instance between them.
 *
 * This avoids duplication of hook calls and lets the context menu's onReact
 * use the same toggleReaction as the reaction bar pills.
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageBubbleActionRow } from './MessageBubbleActionRow';
import { ChatMessageBody } from './ChatMessageBody';
import { useMessageReactions } from '../../hooks/useMessageReactions';
import type { ReplyQuoteData } from '../../lib/messageReply';
import type { MessageGroupPosition } from '../../lib/messageGrouping';
import { toast } from '../../lib/toast';
import { parseMessageEmbeds } from '../../lib/linkEmbeds';

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

  // Derive a downloadable media URL from the first image/video embed in the message.
  const downloadUrl = useMemo(() => {
    const embeds = parseMessageEmbeds(content);
    const media = embeds.find((e) => e.kind === 'image' || e.kind === 'video');
    if (!media) return null;
    return media.kind === 'image' ? (media.imageUrl || media.url) : media.url;
  }, [content]);

  const handleReact = useCallback(
    (emoji: string) => {
      toggleReaction(emoji).catch(() => {
        toast.error(t('chat.reactionFailedTitle'));
      });
    },
    [toggleReaction, t]
  );

  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content).catch(() => {
      toast.error(t('chat.copyMessage', 'Copy message'));
    });
  }, [content, t]);

  const handleDownload = useCallback(() => {
    if (!downloadUrl) return;
    // Derive a filename from the URL path, falling back to a timestamped name.
    let filename = 'media';
    try {
      const pathname = new URL(downloadUrl).pathname;
      filename = pathname.split('/').pop() || filename;
    } catch {
      // keep default
    }
    // Fetch as blob so the browser forces a download even for cross-origin R2 URLs.
    fetch(downloadUrl)
      .then((res) => res.blob())
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        // Fallback: open in new tab if fetch is blocked (e.g. no CORS).
        window.open(downloadUrl, '_blank', 'noopener');
      });
  }, [downloadUrl]);

  return (
    <MessageBubbleActionRow
      isMe={isMe}
      canDelete={canDelete}
      onReply={onReply}
      onDelete={onDelete}
      onCopy={handleCopy}
      onDownload={downloadUrl ? handleDownload : undefined}
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
