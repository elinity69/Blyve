/**
 * MessageReactionBar — Discord-style reaction pills rendered below the bubble.
 *
 * Features:
 * - Radix Tooltip on hover showing reactor names (desktop).
 * - framer-motion AnimatePresence scale-in for new pills.
 * - Floating "+" add-reaction button visible on group-hover/bubble (desktop).
 * - Current user's reactions highlighted with blyve accent.
 */
import { forwardRef, useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import { SmilePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReactionSummary } from '../../hooks/useMessageReactions';
import { EmojiPickerPopover } from './EmojiPickerPopover';

interface MessageReactionBarProps {
  summaries: ReactionSummary[];
  isMe: boolean;
  onToggle: (emoji: string) => void;
}

export function MessageReactionBar({ summaries, isMe, onToggle }: MessageReactionBarProps) {
  const { t } = useTranslation();
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);

  const handleOpenPicker = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPickerAnchor({ x: rect.left, y: rect.bottom + 4 });
  }, []);

  const picker = pickerAnchor ? (
    <EmojiPickerPopover
      x={pickerAnchor.x}
      y={pickerAnchor.y}
      onEmojiSelect={(emoji) => { onToggle(emoji); setPickerAnchor(null); }}
      onClose={() => setPickerAnchor(null)}
    />
  ) : null;

  // When there are no reactions yet — only show the floating + button on hover
  if (summaries.length === 0) {
    return (
      <>
        <div className={`mt-0.5 flex ${isMe ? 'justify-end' : 'justify-start'}`}>
          <AddReactionButton label={t('chat.addEmoji')} onClick={handleOpenPicker} />
        </div>
        {picker}
      </>
    );
  }

  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={150}>
      <div
        className={`mt-0.5 flex flex-wrap items-center gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}
        role="group"
        aria-label={t('chat.reactions')}
      >
        <AnimatePresence initial={false}>
          {summaries.map((s) => (
            <motion.div
              key={s.emoji}
              layout
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            >
              <ReactionPill summary={s} onToggle={onToggle} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Floating "+emoji" button — shown on group-hover/bubble */}
        <AddReactionButton label={t('chat.addEmoji')} onClick={handleOpenPicker} />
      </div>
      {picker}
    </Tooltip.Provider>
  );
}

// ---------------------------------------------------------------------------
// Reaction pill with Radix Tooltip
// ---------------------------------------------------------------------------

interface ReactionPillProps {
  summary: ReactionSummary;
  onToggle: (emoji: string) => void;
}

function ReactionPill({ summary, onToggle }: ReactionPillProps) {
  const { t } = useTranslation();
  const inFlightRef = useRef(false);

  const handleClick = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    onToggle(summary.emoji);
    setTimeout(() => { inFlightRef.current = false; }, 400);
  }, [summary.emoji, onToggle]);

  const ariaLabel = summary.reactedByMe
    ? t('chat.removeReaction', { emoji: summary.emoji, count: summary.count })
    : t('chat.addReactionEmoji', { emoji: summary.emoji, count: summary.count });

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-pressed={summary.reactedByMe}
          onClick={handleClick}
          className={[
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
            'text-sm leading-none select-none transition-all active:scale-95',
            'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blyve/60',
            summary.reactedByMe
              ? 'border-blyve/70 bg-blyve/15 text-blyve dark:bg-blyve/20 dark:border-blyve/50'
              : 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 dark:border-white/8 dark:bg-white/[0.06]',
          ].join(' ')}
        >
          <span aria-hidden className="text-[15px] leading-none">{summary.emoji}</span>
          <span className="min-w-[1ch] tabular-nums text-[12px] font-medium">{summary.count}</span>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={5}
          className="z-[500] max-w-[220px] rounded-lg bg-[#18191c] px-2.5 py-1.5 text-center text-[12px] leading-snug text-gray-100 shadow-xl border border-white/10 select-none"
        >
          {buildTooltipText(summary)}
          <Tooltip.Arrow className="fill-[#18191c]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Localised "Alice, Bob and 2 others reacted 👍" */
function buildTooltipText(s: ReactionSummary): string {
  const names = s.reactorNames.filter(Boolean);
  const emoji = s.emoji;
  if (names.length === 0) return emoji;
  // Keep simple — tooltip is desktop only; English phrasing is broadly understood.
  if (names.length <= 2) return `${names.join(' & ')} ${emoji}`;
  const shown = names.slice(0, 2).join(', ');
  const rest = names.length - 2;
  return `${shown} +${rest} ${emoji}`;
}

// ---------------------------------------------------------------------------
// Floating add-reaction button (desktop hover via parent group-hover/bubble)
// ---------------------------------------------------------------------------

interface AddReactionButtonProps {
  label: string;
  onClick: (e: React.MouseEvent) => void;
}

const AddReactionButton = forwardRef<HTMLButtonElement, AddReactionButtonProps>(
  ({ label, onClick }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={[
        'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full',
        'border border-white/10 bg-white/5 text-gray-400',
        'transition-all hover:bg-white/10 hover:text-gray-100 active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blyve/60',
        // Desktop: only show on group-hover/bubble; mobile: hidden (use long-press menu)
        'hidden group-hover/bubble:flex md:hidden md:group-hover/bubble:flex',
      ].join(' ')}
    >
      <SmilePlus className="h-3.5 w-3.5" aria-hidden />
    </button>
  )
);
AddReactionButton.displayName = 'AddReactionButton';
