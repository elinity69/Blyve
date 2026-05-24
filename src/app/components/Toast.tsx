import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';

interface ToastProps {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  duration?: number;
  onClose: (id: string) => void;
  index?: number;
  imageUrl?: string; // Optional: Profilbild für Chat-Notifications
  conversationId?: string; // Optional: Conversation-ID für Chat-Notifications (öffnet Chat beim Klick)
  onClick?: () => void; // Optional: Custom onClick Handler
}

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const ICON_COLORS = {
  success: 'bg-emerald-500/20 text-emerald-400',
  error: 'bg-red-500/20 text-red-400',
  info: 'bg-blue-500/20 text-blue-400',
  warning: 'bg-yellow-500/20 text-yellow-400',
};

const DURATIONS = {
  success: 3000,
  error: 5000,
  info: 4000,
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
  onClick
}: ToastProps) => {
  const Icon = ICONS[type];
  const toastDuration = duration || DURATIONS[type];
  const [isPaused, setIsPaused] = useState(false);
  const [remainingTime, setRemainingTime] = useState(toastDuration);
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isPaused) {
      // Pause: Save remaining time
      if (startTimeRef.current !== null && timerRef.current) {
        const elapsed = Date.now() - startTimeRef.current;
        setRemainingTime((prev) => Math.max(0, prev - elapsed));
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Resume or start: Begin countdown
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

  const toastVariants = {
    hidden: {
      y: -100,
      opacity: 0,
      scale: 0.95,
    },
    visible: {
      y: 0,
      opacity: 1,
      scale: 1,
      transition: {
        type: "spring",
        stiffness: 400,
        damping: 30,
        mass: 0.8,
      }
    },
    exit: {
      opacity: 0,
      scale: 0.98,
      transition: {
        duration: 0.2,
        ease: "easeIn"
      }
    }
  };

  // Calculate top position with safe area support
  const topPosition = `calc(16px + env(safe-area-inset-top, 0px) + ${index * 80}px)`;

  return (
    <motion.div
      variants={toastVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      whileHover={{ scale: 1.02, filter: "brightness(1.1)" }}
      onHoverStart={() => setIsPaused(true)}
      onHoverEnd={() => setIsPaused(false)}
      drag="y"
      dragConstraints={{ top: -120, bottom: 0 }}
      dragElastic={0}
      onDragStart={() => setIsPaused(true)}
      onDragEnd={(_, info) => {
        if (info.offset.y <= -120) {
          onClose(id);
          return;
        }
        setIsPaused(false);
      }}
      className="fixed left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[420px] z-[9999]"
      style={{ 
        top: topPosition,
        transition: 'top 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      {/* Glassmorphic Container */}
      <div 
        className={`relative rounded-[20px] p-4 flex items-start gap-3 ${conversationId || onClick ? 'cursor-pointer hover:brightness-110 transition-all' : ''}`}
        style={{
          background: 'rgba(26, 26, 26, 0.85)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        }}
        onClick={() => {
          if (onClick) {
            onClick();
          } else if (conversationId) {
            // Emit event to open conversation
            window.dispatchEvent(new CustomEvent('toast-conversation-click', {
              detail: { conversationId }
            }));
          }
          // Close toast after click
          onClose(id);
        }}
      >
        {/* Icon or Profile Image */}
        {imageUrl ? (
          <div className="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden border-2 border-white/20 bg-gray-800">
            <img 
              src={imageUrl} 
              alt={title}
              className="w-full h-full object-cover"
              onError={(e) => {
                // Fallback to icon if image fails to load
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent) {
                  parent.className = `flex-shrink-0 w-10 h-10 rounded-full ${ICON_COLORS[type]} flex items-center justify-center`;
                  parent.innerHTML = '';
                  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                  iconSvg.setAttribute('class', 'w-5 h-5');
                  iconSvg.setAttribute('fill', 'none');
                  iconSvg.setAttribute('viewBox', '0 0 24 24');
                  iconSvg.setAttribute('stroke', 'currentColor');
                  iconSvg.setAttribute('stroke-width', '2');
                  iconSvg.setAttribute('stroke-linecap', 'round');
                  iconSvg.setAttribute('stroke-linejoin', 'round');
                  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                  path.setAttribute('d', 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z');
                  iconSvg.appendChild(path);
                  parent.appendChild(iconSvg);
                }
              }}
            />
          </div>
        ) : (
          <div className={`flex-shrink-0 w-10 h-10 rounded-full ${ICON_COLORS[type]} flex items-center justify-center`}>
            <Icon className="w-5 h-5" />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-semibold text-sm mb-1 leading-tight">
            {title}
          </h4>
          <div 
            className="text-gray-300 text-xs leading-relaxed break-words [&_span.text-gray-400]:text-gray-400 [&_span.text-\\[11px\\]]:text-[11px] [&_a]:text-blue-400 [&_a]:underline [&_a:hover]:text-blue-300"
            dangerouslySetInnerHTML={{
              __html: (() => {
                // Convert URLs to clickable links (only if not already inside HTML tags)
                // Split by HTML tags to process text nodes separately
                const parts = message.split(/(<[^>]+>)/g);
                return parts.map((part, i) => {
                  // If it's an HTML tag, return as-is
                  if (part.startsWith('<') && part.endsWith('>')) {
                    return part;
                  }
                  // Otherwise, convert URLs to links
                  return part.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline hover:text-blue-300 transition-colors" onclick="event.stopPropagation(); return false;">$1</a>');
                }).join('');
              })()
            }}
          />
        </div>

        {/* Close Button */}
        <button
          onClick={() => onClose(id)}
          className="flex-shrink-0 w-6 h-6 rounded-full hover:bg-white/10 transition-colors flex items-center justify-center"
          aria-label="Close notification"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>

        {/* Progress Bar */}
        <motion.div
          className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 rounded-b-[20px] origin-left"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: isPaused ? (remainingTime / toastDuration) : 0 }}
          transition={{ 
            duration: isPaused ? 0 : (remainingTime / 1000), 
            ease: "linear" 
          }}
        />
      </div>
    </motion.div>
  );
};
