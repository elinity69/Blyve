import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Info, AlertTriangle, X, MessageCircle } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsMdUp } from './ui/use-mobile';

interface ToastProps {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  duration?: number;
  onClose: (id: string) => void;
  index?: number;
  imageUrl?: string;
  conversationId?: string;
  variant?: 'default' | 'message';
  onClick?: () => void;
}

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const ICON_COLORS = {
  success: 'bg-emerald-500/20 text-emerald-400 ring-emerald-400/30',
  error: 'bg-red-500/20 text-red-400 ring-red-400/30',
  info: 'bg-sky-500/20 text-sky-300 ring-sky-400/30',
  warning: 'bg-amber-500/20 text-amber-300 ring-amber-400/30',
};

const DURATIONS = {
  success: 3000,
  error: 5000,
  info: 5000,
  warning: 4500,
};

export const Toast = ({
  id,
  type,
  title,
  message,
  duration,
  onClose,
  index = 0,
  imageUrl,
  conversationId,
  variant = 'default',
  onClick,
}: ToastProps) => {
  const { t } = useTranslation();
  const isDesktop = useIsMdUp();
  const Icon = ICONS[type];
  const isMessage = variant === 'message' || !!conversationId;
  const toastDuration = duration || (isMessage ? 6000 : DURATIONS[type]);
  const [isPaused, setIsPaused] = useState(false);
  const [remainingTime, setRemainingTime] = useState(toastDuration);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isPaused) {
      if (startTimeRef.current !== null && timerRef.current) {
        const elapsed = Date.now() - startTimeRef.current;
        setRemainingTime((prev) => Math.max(0, prev - elapsed));
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onClose(id);
    }, remainingTime);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [id, remainingTime, isPaused, onClose]);

  const stackOffset = index * 92;
  const positionStyle: React.CSSProperties = isDesktop
    ? {
        bottom: `calc(16px + env(safe-area-inset-bottom, 0px) + ${stackOffset}px)`,
        top: 'auto',
      }
    : {
        top: `calc(12px + env(safe-area-inset-top, 0px) + ${stackOffset}px)`,
        bottom: 'auto',
      };
  const isInteractive = Boolean(conversationId || onClick);

  const glassStyle: React.CSSProperties = isDark
    ? {
        background: 'linear-gradient(135deg, rgba(30, 31, 34, 0.82) 0%, rgba(18, 18, 20, 0.78) 100%)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow:
          '0 16px 48px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(255, 255, 255, 0.04)',
      }
    : {
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.88) 0%, rgba(248, 250, 252, 0.82) 100%)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.65)',
        boxShadow:
          '0 16px 48px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(255, 255, 255, 0.35)',
      };

  return (
    <motion.div
      initial={{
        y: isDesktop ? 24 : -24,
        opacity: 0,
        scale: 0.96,
        filter: 'blur(8px)',
      }}
      animate={{ y: 0, opacity: 1, scale: 1, filter: 'blur(0px)' }}
      exit={{
        opacity: 0,
        scale: 0.98,
        y: isDesktop ? 8 : -8,
        filter: 'blur(4px)',
      }}
      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.75 }}
      whileHover={{ scale: 1.015 }}
      onHoverStart={() => setIsPaused(true)}
      onHoverEnd={() => setIsPaused(false)}
      drag="y"
      dragConstraints={isDesktop ? { top: 0, bottom: 140 } : { top: -140, bottom: 0 }}
      dragElastic={0.08}
      onDragStart={() => setIsPaused(true)}
      onDragEnd={(_, info) => {
        const dismissThreshold = isDesktop ? 100 : -100;
        if (isDesktop ? info.offset.y >= dismissThreshold : info.offset.y <= dismissThreshold) {
          onClose(id);
          return;
        }
        setIsPaused(false);
      }}
      className="fixed z-[10050] w-[calc(100%-24px)] max-w-[420px] left-1/2 -translate-x-1/2 md:left-auto md:right-4 md:translate-x-0 pointer-events-auto"
      style={{
        ...positionStyle,
        transition: isDesktop
          ? 'bottom 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          : 'top 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <div
        className={`relative overflow-hidden rounded-[22px] p-4 flex items-start gap-3 ${
          isInteractive ? 'cursor-pointer active:scale-[0.99] transition-transform' : ''
        }`}
        style={glassStyle}
        onClick={() => {
          if (onClick) {
            onClick();
          } else if (conversationId) {
            window.dispatchEvent(
              new CustomEvent('toast-conversation-click', {
                detail: { conversationId },
              })
            );
          }
          onClose(id);
        }}
      >
        {isMessage ? (
          <div
            className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-gradient-to-b from-orange-400 via-red-500 to-pink-500"
            aria-hidden
          />
        ) : null}

        {imageUrl ? (
          <div
            className={`relative flex-shrink-0 rounded-full overflow-hidden ring-2 ${
              isMessage ? 'w-11 h-11 ring-orange-400/40' : 'w-10 h-10 ring-white/20'
            }`}
          >
            <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div
            className={`flex-shrink-0 w-10 h-10 rounded-full ring-1 flex items-center justify-center ${ICON_COLORS[type]}`}
          >
            {isMessage ? <MessageCircle className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
          </div>
        )}

        <div className="flex-1 min-w-0 pl-0.5">
          <p
            className={`text-[11px] font-semibold uppercase tracking-wide mb-0.5 ${
              isDark ? 'text-orange-300/90' : 'text-orange-600'
            } ${isMessage ? 'block' : 'hidden'}`}
          >
            {t('chat.newMessageToast')}
          </p>
          <h4
            className={`font-semibold text-sm mb-1 leading-tight truncate ${
              isDark ? 'text-white' : 'text-slate-900'
            }`}
          >
            {title}
          </h4>
          <p
            className={`text-xs leading-relaxed line-clamp-2 break-words whitespace-pre-line ${
              isDark ? 'text-gray-300/95' : 'text-slate-600'
            }`}
          >
            {message}
          </p>
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose(id);
          }}
          className={`flex-shrink-0 w-7 h-7 rounded-full transition-colors flex items-center justify-center ${
            isDark ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-black/5 text-slate-500'
          }`}
          aria-label="Close notification"
        >
          <X className="w-4 h-4" />
        </button>

        <motion.div
          className="absolute bottom-0 left-0 right-0 h-[2px] origin-left bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 opacity-80"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: isPaused ? remainingTime / toastDuration : 0 }}
          transition={{
            duration: isPaused ? 0 : remainingTime / 1000,
            ease: 'linear',
          }}
        />
      </div>
    </motion.div>
  );
};
