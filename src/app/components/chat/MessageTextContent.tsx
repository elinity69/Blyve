import React from 'react';
import {
  isUrlHiddenByEmbeds,
  splitTextByUrls,
  type ParsedEmbed,
} from '../../lib/linkEmbeds';
import { openExternalLink } from '../../lib/openExternalLink';

interface MessageTextContentProps {
  content: string;
  isMe: boolean;
  className?: string;
  suppressUrls?: Set<string>;
  embeds?: ParsedEmbed[];
}

export function MessageTextContent({
  content,
  isMe,
  className = '',
  suppressUrls = new Set(),
  embeds = [],
}: MessageTextContentProps) {
  const parts = splitTextByUrls(content);
  const linkClass = isMe
    ? 'underline decoration-white/40 underline-offset-2 hover:decoration-white/70'
    : 'text-orange-600 underline decoration-orange-400/50 underline-offset-2 hover:decoration-orange-500 dark:text-orange-400';

  const nodes: React.ReactNode[] = [];

  parts.forEach((part, index) => {
    if (part.type === 'text') {
      if (part.value) nodes.push(<React.Fragment key={`t-${index}`}>{part.value}</React.Fragment>);
      return;
    }

    if (isUrlHiddenByEmbeds(part.value, suppressUrls, embeds)) return;

    nodes.push(
      <button
        key={`u-${index}`}
        type="button"
        className={`${linkClass} inline text-left break-all`}
        onClick={(event) => openExternalLink(event, part.value)}
      >
        {part.value}
      </button>
    );
  });

  if (nodes.length === 0) return null;

  return <p className={className}>{nodes}</p>;
}

export function hasVisibleTextContent(
  content: string,
  suppressUrls: Set<string>,
  embeds: ParsedEmbed[] = []
): boolean {
  const parts = splitTextByUrls(content);
  return parts.some(
    (part) =>
      (part.type === 'text' && part.value.trim().length > 0) ||
      (part.type === 'url' && !isUrlHiddenByEmbeds(part.value, suppressUrls, embeds))
  );
}
