import { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getAppDateLocale } from '../../lib/i18n';

const HIDE_DELAY_MS = 2000;

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Returns the JS getDay() value (0=Sun … 6=Sat) for the first day of the week
 * in the given locale. Uses Intl.Locale.weekInfo where available (Chrome 99+,
 * Safari 15.4+, Firefox 116+); falls back to a per-locale heuristic for the
 * three supported app locales so older runtimes still get correct behaviour.
 *
 * weekInfo.firstDay follows ISO 8601 weekday numbering: 1=Mon … 7=Sun.
 */
function getLocaleWeekStart(locale: string): number {
  try {
    const firstDay = (new Intl.Locale(locale) as any).weekInfo?.firstDay;
    if (typeof firstDay === 'number') {
      return firstDay === 7 ? 0 : firstDay; // ISO 7 (Sun) → JS 0
    }
  } catch { /* unsupported runtime */ }
  // Fallback for the three active app locales
  if (locale.startsWith('de') || locale.startsWith('es')) return 1; // Monday
  return 0; // Sunday (en-US default)
}

/**
 * Formats a message timestamp for the sticky date overlay.
 *
 * Priority (matches WhatsApp behaviour):
 *   1. Same calendar day           → translated "Today"
 *   2. Previous calendar day       → translated "Yesterday"
 *   3. Within the current locale   → localized weekday name ("Freitag", "Friday", "viernes")
 *      calendar week (before       (uses locale's week-start day via Intl.Locale.weekInfo)
 *      yesterday, on/after start)
 *   4. Older                       → short localized date ("Fr. 4. Juni" / "Fri, June 4")
 *
 * All weekday and month names come from Intl and are locale-sensitive.
 */
function formatStickyDate(
  isoDate: string,
  locale: string,
  today: string,
  yesterday: string
): string {
  const msgDate = new Date(isoDate);
  const now = new Date();

  if (isSameCalendarDay(msgDate, now)) return today;

  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  if (isSameCalendarDay(msgDate, yesterdayDate)) return yesterday;

  // Compute the start of the current locale week (midnight local time).
  const weekStart = getLocaleWeekStart(locale);
  const todayDow = now.getDay(); // 0=Sun … 6=Sat
  const daysFromStart = (todayDow - weekStart + 7) % 7;
  const weekStartMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysFromStart
  );
  const msgMidnight = new Date(
    msgDate.getFullYear(),
    msgDate.getMonth(),
    msgDate.getDate()
  );

  if (msgMidnight >= weekStartMidnight) {
    // Within the current locale week → localized weekday name
    return msgDate.toLocaleDateString(locale, { weekday: 'long' });
  }

  // Older → short date: "Fr. 4. Juni" / "Fri, June 4" / "vie., 4 de junio"
  return msgDate.toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * Returns the `data-message-id` element at the container's top edge using a
 * single browser hit-test (elementsFromPoint). This is O(1) regardless of how
 * many messages are in the DOM — no querySelectorAll scan needed.
 *
 * `elementsFromPoint` returns elements in z-order (front first). We walk the
 * list until we find one that carries or is inside a [data-message-id] node.
 * Absolutely-positioned overlays (like the date pill) are naturally skipped
 * because they don't have the attribute and their `.closest()` call returns
 * null, so the loop continues to the underlying message content.
 */
function findTopMessageDate(
  container: HTMLElement,
  messageMap: Map<string, string>
): string | null {
  const rect = container.getBoundingClientRect();
  // Sample a point near the container's top, offset by pt-2 (8px) padding plus
  // a small buffer so we land on real content rather than whitespace.
  const hits = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + 16);

  for (const el of hits) {
    // Guard: ignore elements that live outside this container (e.g. a fixed header).
    if (!container.contains(el)) continue;

    const msgEl = el.hasAttribute('data-message-id')
      ? el
      : (el.closest?.('[data-message-id]') ?? null);

    if (msgEl) {
      const id = msgEl.getAttribute('data-message-id');
      if (id) return messageMap.get(id) ?? null;
    }
  }

  return null;
}

export function useStickyDateOverlay(
  containerRef: React.RefObject<HTMLDivElement | null>,
  messages: Array<{ id: string; created_at: string }>
): { label: string; visible: boolean } {
  const { t, i18n } = useTranslation();
  const [label, setLabel] = useState('');
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  // id→created_at lookup rebuilt only when the messages array changes
  const messageMapRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const map = new Map<string, string>();
    for (const m of messages) map.set(m.id, m.created_at);
    messageMapRef.current = map;
  }, [messages]);

  const updateLabel = useCallback(() => {
    const container = containerRef.current;
    if (!container || messageMapRef.current.size === 0) return;

    const closestDate = findTopMessageDate(container, messageMapRef.current);
    if (closestDate) {
      const locale = getAppDateLocale(i18n.language);
      setLabel(formatStickyDate(closestDate, locale, t('chat.today'), t('chat.yesterday')));
    }
  }, [containerRef, t, i18n.language]);

  const handleScroll = useCallback(() => {
    // Show immediately and reset the hide timer on every scroll event (cheap).
    setVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setVisible(false), HIDE_DELAY_MS);

    // Gate the DOM hit-test behind rAF so it runs at most once per paint frame,
    // not on every raw scroll event (which fires 60+ times/s on some devices).
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        updateLabel();
      });
    }
  }, [updateLabel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, handleScroll]);

  return { label, visible };
}
