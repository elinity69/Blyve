import { useMemo } from 'react';
import {
  getSuppressedUrls,
  parseMessageEmbeds,
  type ParsedEmbed,
} from '../../lib/linkEmbeds';
import { MessageEmbedList } from './MessageEmbedList';
import { MessageTextContent, hasVisibleTextContent } from './MessageTextContent';

interface MessageContentProps {
  content: string;
  isMe: boolean;
  textClassName?: string;
}

export function useMessageContentParts(content: string) {
  return useMemo(() => {
    const embeds = parseMessageEmbeds(content);
    const suppressUrls = getSuppressedUrls(content, embeds);
    const showText = hasVisibleTextContent(content, suppressUrls, embeds);
    return { embeds, suppressUrls, showText };
  }, [content]);
}

export function MessageContent({
  content,
  isMe,
  textClassName,
}: MessageContentProps) {
  const { embeds, suppressUrls, showText } = useMessageContentParts(content);

  return (
    <>
      {showText ? (
        <MessageTextContent
          content={content}
          isMe={isMe}
          className={textClassName}
          suppressUrls={suppressUrls}
        />
      ) : null}
      <MessageEmbedList embeds={embeds} />
    </>
  );
}

export type { ParsedEmbed };
