import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Toast } from '../components/Toast';
import { setToastContext } from '../lib/toast';

interface ToastData {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  duration?: number;
  imageUrl?: string; // Optional: Profilbild für Chat-Notifications
  conversationId?: string; // Optional: Conversation-ID für Chat-Notifications (öffnet Chat beim Klick)
  onClick?: () => void; // Optional: Custom onClick Handler
}

interface ToastContextType {
  showToast: (toast: Omit<ToastData, 'id'>) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const showToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast = { ...toast, id };

    setToasts((prev) => {
      // Max 3 Toasts gleichzeitig
      const updated = [...prev, newToast];
      return updated.slice(-3);
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  // Expose toast context to the toast utility
  useEffect(() => {
    setToastContext({ showToast });
    return () => setToastContext(null);
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* Toast Container */}
      <AnimatePresence mode="sync">
        {toasts.map((toast, index) => (
          <Toast
            key={toast.id}
            {...toast}
            index={index}
            onClose={removeToast}
          />
        ))}
      </AnimatePresence>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};
