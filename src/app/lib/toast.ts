/**
 * Toast utility — thin wrapper over ToastContext.
 * title   → bold heading line
 * message → smaller description line (optional)
 */

let toastContext: {
  showToast: (toast: {
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    message: string;
    duration?: number;
  }) => void;
} | null = null;

export const setToastContext = (context: typeof toastContext) => {
  toastContext = context;
};

export const toast = {
  success: (title: string, description?: string) => {
    if (toastContext) {
      toastContext.showToast({ type: 'success', title, message: description ?? '', duration: 3000 });
    } else {
      console.log('✅', title, description);
    }
  },

  error: (title: string, description?: string) => {
    if (toastContext) {
      toastContext.showToast({ type: 'error', title, message: description ?? '', duration: 5000 });
    } else {
      console.error('❌', title, description);
    }
  },

  info: (title: string, description?: string) => {
    if (toastContext) {
      toastContext.showToast({ type: 'info', title, message: description ?? '', duration: 4000 });
    } else {
      console.info('ℹ️', title, description);
    }
  },

  warning: (title: string, description?: string) => {
    if (toastContext) {
      toastContext.showToast({ type: 'warning', title, message: description ?? '', duration: 4500 });
    } else {
      console.warn('⚠️', title, description);
    }
  },

  show: (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    toast[type](message);
  },
};
