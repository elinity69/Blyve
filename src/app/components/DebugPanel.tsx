import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bug, X, Bell, MessageSquare, Heart, Volume2 } from 'lucide-react';
import { NotificationManager } from '../lib/notifications';
import { useToast } from '../context/ToastContext';

export const DebugPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { showToast } = useToast();
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');

  // Listen for Ctrl+Shift+D (or Cmd+Shift+D on Mac)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  // Update permission status
  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, [isOpen]);

  // Test Functions
  const testInAppToast = () => {
    showToast({
      type: 'info',
      title: '💬 Test User',
      message: 'Dies ist eine Test-Nachricht! Link: https://example.com/test',
      duration: 5000,
    });
  };

  const testWebPushNotification = async () => {
    if (Notification.permission !== 'granted') {
      alert('Bitte erlaube zuerst Benachrichtigungen!');
      return;
    }

    NotificationManager.showNotification('💬 Test User', {
      body: 'Dies ist eine Test Web Push Notification!',
      icon: '/logo.png',
      tag: 'test-notification',
      data: { conversationId: 'test-123' },
    });
  };

  const testSuccessToast = () => {
    showToast({
      type: 'success',
      title: 'Erledigt',
      message: 'Beispiel-Erfolgsmeldung.',
      duration: 3000,
    });
  };

  const testErrorToast = () => {
    showToast({
      type: 'error',
      title: '❌ Fehler',
      message: 'Netzwerk-Verbindung fehlgeschlagen. Bitte versuche es erneut.',
      duration: 5000,
    });
  };

  const testWarningToast = () => {
    showToast({
      type: 'warning',
      title: 'Hinweis',
      message: 'Beispiel-Warnung ohne Gamification.',
      duration: 4500,
    });
  };

  const testBadgeCounter = (count: number) => {
    NotificationManager.updateBadge(count);
  };

  const testNotificationSound = () => {
    try {
      const audio = new Audio('/notification-sound.mp3');
      audio.volume = 0.5;
      audio.play().then(() => {
        showToast({
          type: 'success',
          title: '🔊 Sound Test',
          message: 'Notification Sound wurde abgespielt!',
          duration: 2000,
        });
      }).catch(err => {
        showToast({
          type: 'error',
          title: '🔇 Sound Fehler',
          message: `Sound konnte nicht abgespielt werden: ${err.message}`,
          duration: 3000,
        });
      });
    } catch (error) {
      showToast({
        type: 'error',
        title: '🔇 Sound Fehler',
        message: 'Sound-Datei nicht gefunden!',
        duration: 3000,
      });
    }
  };

  const requestPermission = async () => {
    // Check current permission status before requesting
    const currentPermission = NotificationManager.getPermission();
    
    if (currentPermission === 'denied') {
      showToast({
        type: 'warning',
        title: '⚠️ Permission bereits verweigert',
        message: 'Bitte aktiviere Benachrichtigungen in den Browser-Einstellungen.',
        duration: 4000,
      });
      setNotificationPermission('denied');
      return;
    }
    
    try {
      const granted = await NotificationManager.requestPermission();
      setNotificationPermission(Notification.permission);
      
      if (granted) {
        showToast({
          type: 'success',
          title: '✅ Permission erteilt',
          message: 'Web Push Notifications aktiviert!',
          duration: 3000,
        });
      } else {
        // Permission was denied by user during the request
        showToast({
          type: 'info',
          title: 'ℹ️ Permission verweigert',
          message: 'Du kannst Benachrichtigungen später in den Browser-Einstellungen aktivieren.',
          duration: 4000,
        });
      }
    } catch (error) {
      console.error('Error in requestPermission:', error);
      showToast({
        type: 'error',
        title: '❌ Fehler',
        message: 'Fehler beim Anfordern der Notification Permission.',
        duration: 3000,
      });
    }
  };

  return (
    <>
      {/* Floating Bug Button (immer sichtbar in Development) */}
      {process.env.NODE_ENV === 'development' && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-24 right-6 w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full shadow-lg flex items-center justify-center z-[10000] hover:scale-110 transition-transform"
          title="Debug Panel (Ctrl+Shift+D)"
        >
          <Bug className="w-6 h-6 text-white" />
        </button>
      )}

      {/* Debug Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[10000]"
              onClick={() => setIsOpen(false)}
            />

            {/* Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-[#1A1A1A]/95 backdrop-blur-[40px] border-l border-white/12 shadow-2xl z-[10001] overflow-y-auto"
              style={{
                background: 'rgba(26, 26, 26, 0.95)',
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
              }}
            >
              {/* Header */}
              <div 
                className="sticky top-0 border-b border-white/12 p-6 flex items-center justify-between"
                style={{
                  background: 'rgba(26, 26, 26, 0.95)',
                  backdropFilter: 'blur(40px)',
                  WebkitBackdropFilter: 'blur(40px)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                    <Bug className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-lg">Debug Panel</h2>
                    <p className="text-gray-400 text-xs">Notification Tests</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 rounded-full hover:bg-white/10 transition-colors flex items-center justify-center"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                {/* Permission Status */}
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Bell className="w-4 h-4" />
                    Permission Status
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-300 text-sm">Browser Support:</span>
                      <span className={`text-sm font-medium ${
                        'Notification' in window ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {'Notification' in window ? '✅ Supported' : '❌ Not Supported'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-300 text-sm">Permission:</span>
                      <span className={`text-sm font-medium ${
                        notificationPermission === 'granted' ? 'text-green-400' :
                        notificationPermission === 'denied' ? 'text-red-400' : 'text-yellow-400'
                      }`}>
                        {notificationPermission === 'granted' ? '✅ Granted' :
                         notificationPermission === 'denied' ? '❌ Denied' : '⚠️ Default'}
                      </span>
                    </div>
                  </div>
                  {notificationPermission !== 'granted' && (
                    <button
                      onClick={requestPermission}
                      className="w-full mt-3 bg-gradient-to-r from-orange-500 to-pink-500 text-white font-semibold py-2 px-4 rounded-lg hover:brightness-110 transition-all active:scale-95"
                    >
                      Request Permission
                    </button>
                  )}
                </div>

                {/* In-App Toasts */}
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    In-App Toasts
                  </h3>
                  <div className="space-y-2">
                    <button
                      onClick={testInAppToast}
                      className="w-full bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-medium py-2.5 px-4 rounded-lg transition-colors border border-blue-500/30"
                    >
                      Test Info Toast
                    </button>
                    <button
                      onClick={testSuccessToast}
                      className="w-full bg-green-500/20 hover:bg-green-500/30 text-green-400 font-medium py-2.5 px-4 rounded-lg transition-colors border border-green-500/30"
                    >
                      Test Success Toast
                    </button>
                    <button
                      onClick={testWarningToast}
                      className="w-full bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 font-medium py-2.5 px-4 rounded-lg transition-colors border border-yellow-500/30"
                    >
                      Test Warning Toast
                    </button>
                    <button
                      onClick={testErrorToast}
                      className="w-full bg-red-500/20 hover:bg-red-500/30 text-red-400 font-medium py-2.5 px-4 rounded-lg transition-colors border border-red-500/30"
                    >
                      Test Error Toast
                    </button>
                  </div>
                </div>

                {/* Web Push Notifications */}
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Bell className="w-4 h-4" />
                    Web Push Notifications
                  </h3>
                  <button
                    onClick={testWebPushNotification}
                    disabled={notificationPermission !== 'granted'}
                    className="w-full bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 font-medium py-2.5 px-4 rounded-lg transition-colors border border-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Test Web Push Notification
                  </button>
                  {notificationPermission !== 'granted' && (
                    <p className="text-gray-400 text-xs mt-2">
                      ⚠️ Permission erforderlich
                    </p>
                  )}
                </div>

                {/* Badge Counter */}
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Heart className="w-4 h-4" />
                    Badge Counter
                  </h3>
                  <div className="grid grid-cols-4 gap-2">
                    {[0, 1, 3, 5, 10, 99].map(count => (
                      <button
                        key={count}
                        onClick={() => testBadgeCounter(count)}
                        className="bg-white/10 hover:bg-white/20 text-white font-medium py-2 px-3 rounded-lg transition-colors"
                      >
                        {count === 0 ? 'Reset' : count}
                      </button>
                    ))}
                  </div>
                  <p className="text-gray-400 text-xs mt-2">
                    Updates Tab Title: "(X) Blyve"
                  </p>
                </div>

                {/* Sound Test */}
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Volume2 className="w-4 h-4" />
                    Notification Sound
                  </h3>
                  <button
                    onClick={testNotificationSound}
                    className="w-full bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 font-medium py-2.5 px-4 rounded-lg transition-colors border border-orange-500/30"
                  >
                    🔊 Test Sound
                  </button>
                  <p className="text-gray-400 text-xs mt-2">
                    Spielt: /notification-sound.mp3 (50% Volume)
                  </p>
                </div>

                {/* Keyboard Shortcut Hint */}
                <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-xl p-4 border border-purple-500/20">
                  <p className="text-gray-300 text-sm text-center">
                    💡 <span className="font-semibold">Tipp:</span> Drücke <kbd className="px-2 py-1 bg-white/10 rounded">Ctrl</kbd> + <kbd className="px-2 py-1 bg-white/10 rounded">Shift</kbd> + <kbd className="px-2 py-1 bg-white/10 rounded">D</kbd> um dieses Panel zu öffnen/schließen
                  </p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};
