/**
 * Toast utility for showing beautiful, non-blocking glassmorphic notifications
 * Uses the new ToastContext system with Apple Vision Pro / 2026 style design
 */

// We'll use a singleton pattern to access the toast context
let toastContext: { showToast: (toast: { type: 'success' | 'error' | 'info' | 'warning'; title: string; message: string; duration?: number }) => void } | null = null;

export const setToastContext = (context: typeof toastContext) => {
  toastContext = context;
};

const formatMessage = (message: string, description?: string): string => {
  if (description) {
    return `${message}<br/><span class="text-gray-400 text-[11px]">${description}</span>`;
  }
  return message;
};

export const toast = {
  success: (message: string, description?: string) => {
    if (toastContext) {
      toastContext.showToast({
        type: 'success',
        title: 'Success',
        message: formatMessage(message, description),
        duration: 3000,
      });
    } else {
      // Fallback to console if context not available
      console.log('✅', message, description);
    }
  },
  
  error: (message: string, description?: string) => {
    if (toastContext) {
      toastContext.showToast({
        type: 'error',
        title: 'Error',
        message: formatMessage(message, description),
        duration: 5000,
      });
    } else {
      console.error('❌', message, description);
    }
  },
  
  info: (message: string, description?: string) => {
    if (toastContext) {
      toastContext.showToast({
        type: 'info',
        title: message,
        message: description || '',
        duration: 4000,
      });
    } else {
      console.info('ℹ️', message, description);
    }
  },
  
  warning: (message: string, description?: string) => {
    if (toastContext) {
      toastContext.showToast({
        type: 'warning',
        title: 'Warning',
        message: formatMessage(message, description),
        duration: 4500,
      });
    } else {
      console.warn('⚠️', message, description);
    }
  },
  
  // Generic toast for compatibility
  show: (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    switch (type) {
      case 'success':
        toast.success(message);
        break;
      case 'error':
        toast.error(message);
        break;
      case 'warning':
        toast.warning(message);
        break;
      default:
        toast.info(message);
    }
  },
};
