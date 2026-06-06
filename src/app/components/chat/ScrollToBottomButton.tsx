/**
 * ScrollToBottomButton — appears when the user scrolls up far enough in a chat.
 *
 * Usage:
 *   const { show, handleScroll } = useScrollToBottom(scrollRef);
 *   <ScrollToBottomButton show={show} onClick={() => scrollContainerToBottomStable(scrollRef.current!)} />
 *
 * The button is absolutely positioned relative to the nearest `relative` ancestor,
 * so the parent chat wrapper must have `relative` on it (both ChatScreen and
 * GroupThreadScreen already do).
 */
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { scrollContainerToBottomStable } from '../../lib/chatScroll';

/** How many pixels of upward scroll shows the button (≈ 2.5 viewport heights). */
const SHOW_THRESHOLD_MULTIPLIER = 2.5;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useScrollToBottom(
  scrollRef: React.RefObject<HTMLDivElement | null>
): {
  show: boolean;
  handleScroll: () => void;
  scrollToBottom: () => void;
} {
  const [show, setShow] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const threshold = el.clientHeight * SHOW_THRESHOLD_MULTIPLIER;
    setShow(distanceFromBottom > threshold);
  }, [scrollRef]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    scrollContainerToBottomStable(el, 12, { smooth: true });
  }, [scrollRef]);

  // Reset when the ref target changes (e.g. conversation switch).
  useEffect(() => {
    setShow(false);
  }, [scrollRef]);

  return { show, handleScroll, scrollToBottom };
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

interface ScrollToBottomButtonProps {
  show: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({ show, onClick }: ScrollToBottomButtonProps) {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          key="scroll-to-bottom"
          type="button"
          aria-label={t('chat.scrollToBottom', 'Scroll to bottom')}
          onClick={onClick}
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.9 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={[
            'pointer-events-auto absolute bottom-3 left-1/2 z-30',
            '-translate-x-1/2',
            'flex h-8 w-8 items-center justify-center rounded-full',
            'bg-[#1e1f22]/80 backdrop-blur-sm',
            'border border-white/10 shadow-lg',
            'text-gray-200 hover:text-white hover:bg-[#1e1f22]',
            'transition-colors active:scale-95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blyve/60',
          ].join(' ')}
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
        >
          <ArrowDown className="h-4 w-4" aria-hidden />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
