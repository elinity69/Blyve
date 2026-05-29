import React from 'react';
import { Volume2 } from 'lucide-react';

interface NotificationBadgeProps {
  count: number;
  className?: string;
  /** Border color matching the parent surface (Discord rail uses #1e1f22). */
  borderClassName?: string;
}

export function NotificationBadge({
  count,
  className = '',
  borderClassName = 'border-[#1e1f22]',
}: NotificationBadgeProps) {
  if (count <= 0) return null;

  const label = count > 99 ? '99+' : String(count);

  return (
    <span
      className={`pointer-events-none absolute -top-1.5 -right-1.5 z-20 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 bg-red-600 px-1 text-[11px] font-bold leading-none text-white shadow-sm ${borderClassName} ${className}`}
      aria-label={`${label} unread`}
    >
      {label}
    </span>
  );
}

/** Top-left rail indicator: someone is in a group voice channel (same shell as NotificationBadge). */
export function VoiceActiveBadge({
  ariaLabel,
  className = '',
  borderClassName = 'border-[#1e1f22]',
}: {
  ariaLabel: string;
  className?: string;
  borderClassName?: string;
}) {
  return (
    <span
      className={`pointer-events-none absolute -top-1.5 -left-1.5 z-20 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 bg-[#23a559] px-1 text-[11px] font-bold leading-none text-white shadow-sm ${borderClassName} ${className}`}
      aria-label={ariaLabel}
    >
      <Volume2 className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
    </span>
  );
}

export function NotificationBadgeInline({ count }: { count: number }) {
  if (count <= 0) return null;

  const label = count > 99 ? '99+' : String(count);

  return (
    <span className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold leading-none text-white">
      {label}
    </span>
  );
}
