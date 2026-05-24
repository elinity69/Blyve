import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKeys?: Array<string | number>;
  resetOnPropsChange?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

/**
 * Global Error Boundary Component
 * 
 * Fängt JavaScript-Fehler in der Komponenten-Baum ab und zeigt
 * statt eines Absturzes eine benutzerfreundliche Fehlerseite.
 * 
 * Features:
 * - Fängt alle Fehler in Kind-Komponenten ab
 * - Zeigt benutzerfreundliche Fehlermeldung
 * - "Neu versuchen" Button zum Reload
 * - Automatisches Reset bei Prop-Änderungen (optional)
 * - Error Logging für Debugging
 */
export class ErrorBoundary extends Component<Props, State> {
  private resetTimeoutId: NodeJS.Timeout | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
  }

  /**
   * Wird aufgerufen, wenn ein Fehler in einer Kind-Komponente auftritt
   * Aktualisiert den State, sodass das Fallback UI gerendert wird
   */
  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * Wird aufgerufen, nachdem ein Fehler in einer Kind-Komponente aufgetreten ist
   * Loggt den Fehler für Debugging-Zwecke
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('🚨 ErrorBoundary: Fehler abgefangen:', error);
    console.error('🚨 ErrorBoundary: Error Info:', errorInfo);
    console.error('🚨 ErrorBoundary: Component Stack:', errorInfo.componentStack);

    // Update state with error info
    this.setState((prevState) => ({
      error,
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }));

    // Call optional error callback
    if (this.props.onError) {
      try {
        this.props.onError(error, errorInfo);
      } catch (callbackError) {
        console.error('🚨 ErrorBoundary: Fehler im onError Callback:', callbackError);
      }
    }

    // TODO: Hier könnte später Sentry oder ein anderer Error Tracking Service integriert werden
    // Beispiel: Sentry.captureException(error, { contexts: { react: errorInfo } });
  }

  /**
   * Reset Error Boundary wenn sich bestimmte Props ändern
   */
  componentDidUpdate(prevProps: Props) {
    const { resetKeys, resetOnPropsChange } = this.props;
    const { hasError } = this.state;

    // Reset wenn sich resetKeys ändern
    if (hasError && resetKeys && prevProps.resetKeys) {
      const hasResetKeyChanged = resetKeys.some(
        (key, index) => key !== prevProps.resetKeys?.[index]
      );
      if (hasResetKeyChanged) {
        this.resetErrorBoundary();
      }
    }

    // Reset wenn resetOnPropsChange aktiviert ist und sich Props ändern
    if (hasError && resetOnPropsChange && prevProps.children !== this.props.children) {
      this.resetErrorBoundary();
    }
  }

  componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
  }

  /**
   * Setzt den Error Boundary zurück
   */
  resetErrorBoundary = () => {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  /**
   * Lädt die App komplett neu
   */
  handleReload = () => {
    // Für Web: window.location.reload()
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  /**
   * Navigiert zur Startseite (falls Router verfügbar)
   */
  handleGoHome = () => {
    // Reset error boundary first
    this.resetErrorBoundary();
    
    // Try to navigate to home if router is available
    if (typeof window !== 'undefined') {
      // Remove any error state from URL
      const url = new URL(window.location.href);
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
      
      // Reload to start fresh
      window.location.href = '/';
    }
  };

  render() {
    const { hasError, error, errorInfo, errorCount } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      // Custom Fallback UI
      if (fallback) {
        return fallback;
      }

      // Default Fallback UI
      return (
        <div className="h-screen w-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-black dark:to-black flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#0A0A0A] dark:border dark:border-white/5 rounded-2xl shadow-2xl p-8 text-center">
            {/* Error Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
              </div>
            </div>

            {/* Error Message */}
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Hoppla! 😅
            </h1>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Es ist etwas schiefgelaufen. Keine Sorge, das passiert manchmal.
            </p>

            {/* Error Details (nur in Development) */}
            {process.env.NODE_ENV === 'development' && error && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-left">
                <p className="text-xs font-mono text-red-800 dark:text-red-200 mb-2">
                  <strong>Fehler:</strong> {error.name}
                </p>
                <p className="text-xs font-mono text-red-700 dark:text-red-300 mb-2 break-words">
                  <strong>Nachricht:</strong> {error.message}
                </p>
                {errorInfo && (
                  <details className="text-xs font-mono text-red-600 dark:text-red-400">
                    <summary className="cursor-pointer mb-2">Stack Trace anzeigen</summary>
                    <pre className="whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                      {errorInfo.componentStack}
                    </pre>
                  </details>
                )}
                {errorCount > 1 && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                    ⚠️ Dieser Fehler ist bereits {errorCount} mal aufgetreten.
                  </p>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              <button
                onClick={this.resetErrorBoundary}
                className="w-full px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg"
              >
                <RefreshCw className="w-5 h-5" />
                Neu versuchen
              </button>
              
              <button
                onClick={this.handleGoHome}
                className="w-full px-6 py-3 bg-gray-200 dark:bg-[#0A0A0A] hover:bg-gray-300 dark:hover:bg-[#0A0A0A]/80 text-gray-900 dark:text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Home className="w-5 h-5" />
                Zur Startseite
              </button>

              <button
                onClick={this.handleReload}
                className="w-full px-6 py-3 bg-gray-100 dark:bg-[#0A0A0A]/50 hover:bg-gray-200 dark:hover:bg-[#0A0A0A]/80 text-gray-700 dark:text-gray-300 text-sm rounded-xl transition-colors"
              >
                App neu laden
              </button>
            </div>

            {/* Help Text */}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-6">
              Wenn das Problem weiterhin besteht, kontaktiere bitte den Support.
            </p>
          </div>
        </div>
      );
    }

    return children;
  }
}

/**
 * Hook für Funktionskomponenten, um Error Boundary zu resetten
 * (Wird von der ErrorBoundary selbst verwendet)
 */
export function useErrorHandler() {
  return (error: Error, errorInfo?: ErrorInfo) => {
    console.error('🚨 useErrorHandler: Fehler:', error, errorInfo);
    // In einer echten App könnte man hier Sentry o.ä. aufrufen
    throw error; // Re-throw um Error Boundary zu triggern
  };
}
