import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NotificationManager } from '../lib/notifications';

interface NotificationPromptProps {
  userId?: string | null;
}

export const NotificationPrompt = ({ userId }: NotificationPromptProps) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if permission is default (not asked yet)
    const checkPermission = () => {
      if (!('Notification' in window)) return;
      
      const permission = Notification.permission;
      const hasAsked = localStorage.getItem('notification-asked');
      
      // Show prompt if permission is default and we haven't asked yet
      if (permission === 'default' && !hasAsked) {
        setTimeout(() => setIsVisible(true), 3000); // Show after 3 seconds
      }
    };

    checkPermission();
  }, []);

  const handleEnable = async () => {
    if (userId) {
      await NotificationManager.enablePushNotifications(userId);
    } else {
      await NotificationManager.requestPermission();
    }
    localStorage.setItem('notification-asked', 'true');
    setIsVisible(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('notification-asked', 'true');
    setIsVisible(false);
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[420px] z-[10000]"
        >
          {/* Glassmorphic Container */}
          <div 
            className="relative rounded-[20px] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]"
            style={{
              background: 'rgba(26, 26, 26, 0.9)',
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
            }}
          >
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center">
                <Bell className="w-6 h-6 text-white" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <h4 className="text-white font-bold text-base mb-1">
                  {t('notifications.promptTitle')}
                </h4>
                <p className="text-gray-300 text-sm mb-4">
                  {t('notifications.promptBody')}
                </p>

                {/* Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={handleEnable}
                    className="flex-1 bg-gradient-to-r from-orange-500 to-pink-500 text-white font-semibold py-2.5 px-4 rounded-xl hover:brightness-110 transition-all active:scale-95"
                  >
                    {t('notifications.enable')}
                  </button>
                  <button
                    onClick={handleDismiss}
                    className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl transition-colors"
                  >
                    {t('notifications.later')}
                  </button>
                </div>
              </div>

              {/* Close Button */}
              <button
                onClick={handleDismiss}
                className="flex-shrink-0 w-6 h-6 rounded-full hover:bg-white/10 transition-colors flex items-center justify-center"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
