/**
 * Web Push Notification System
 * Handles browser notifications when app is in background
 */

export class NotificationManager {
  private static permission: NotificationPermission = 'default';
  private static lastSoundTime: number = 0;
  private static readonly SOUND_THROTTLE_MS = 2000; // 2 seconds between sounds
  private static notificationAudio: HTMLAudioElement | null = null;
  private static audioUnlocked = false;
  private static activeConversationId: string | null = null;

  /**
   * Track which conversation is currently open in the UI.
   * Used to suppress notification sounds/toasts for the active chat.
   */
  static setActiveConversationId(conversationId: string | null) {
    this.activeConversationId = conversationId;
    if (conversationId) {
      localStorage.setItem('currentConversationId', conversationId);
    } else {
      localStorage.removeItem('currentConversationId');
    }
  }

  static getActiveConversationId(): string | null {
    return this.activeConversationId;
  }

  private static getNotificationAudio(): HTMLAudioElement {
    if (!this.notificationAudio) {
      this.notificationAudio = new Audio('/notification-sound.mp3');
      this.notificationAudio.preload = 'auto';
      this.notificationAudio.volume = 0.5;
    }
    return this.notificationAudio;
  }

  /**
   * Browsers block audio until the user interacts with the page once.
   * Call this on first click/keypress to unlock playback.
   */
  static unlockAudio() {
    if (this.audioUnlocked) return;

    try {
      const audio = this.getNotificationAudio();
      const playPromise = audio.play();
      if (!playPromise) {
        this.audioUnlocked = true;
        return;
      }
      void playPromise
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          this.audioUnlocked = true;
        })
        .catch(() => {
          // Still locked — will retry on next interaction.
        });
    } catch {
      // ignore
    }
  }

  /**
   * Request notification permission from user
   */
  static async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('Browser does not support notifications');
      return false;
    }

    // Check if already granted
    if (Notification.permission === 'granted') {
      this.permission = 'granted';
      return true;
    }

    // Check if denied - silently return false (user has already denied, can't request again)
    if (Notification.permission === 'denied') {
      // Permission was previously denied - user must enable it manually in browser settings
      // Don't log as warning since this is expected behavior
      this.permission = 'denied';
      return false;
    }

    // Request permission (only if status is 'default')
    try {
      const permission = await Notification.requestPermission();
      this.permission = permission;
      
      if (permission === 'granted') {
        console.log('✅ Notification permission granted');
        return true;
      } else if (permission === 'denied') {
        // User just denied the permission request
        console.info('ℹ️ Notification permission denied by user');
        return false;
      } else {
        // Permission is still 'default' (shouldn't happen after requestPermission, but handle it)
        return false;
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }

  /**
   * Play notification sound (throttled to prevent multiple sounds)
   * Can be called from outside the class for chat notifications
   */
  static playNotificationSound() {
    const now = Date.now();
    const timeSinceLastSound = now - this.lastSoundTime;
    
    // Throttle: Only play sound if at least SOUND_THROTTLE_MS have passed since last sound
    if (timeSinceLastSound < this.SOUND_THROTTLE_MS) {
      console.log(`🔇 Sound throttled (${timeSinceLastSound}ms since last sound, need ${this.SOUND_THROTTLE_MS}ms)`);
      return;
    }
    
    try {
      this.lastSoundTime = now;
      const audio = this.getNotificationAudio();
      audio.currentTime = 0;
      void audio.play().catch((err) => {
        console.warn('Could not play notification sound:', err);
      });
    } catch (error) {
      console.warn('Notification sound not supported:', error);
    }
  }

  /**
   * Show a web push notification
   * @param playSound - Whether to play notification sound (default: false - only chat notifications play sound)
   */
  static showNotification(title: string, options?: NotificationOptions & { playSound?: boolean }) {
    if (this.permission !== 'granted') {
      // Update permission status
      this.permission = Notification.permission;
      if (this.permission !== 'granted') {
        // Silently return null - caller should handle fallback (e.g., show toast)
        return null;
      }
    }

    try {
      // Play notification sound ONLY if explicitly requested (for chat notifications)
      // Default: NO sound (prevents sound on success/error toasts)
      if (options?.playSound === true) {
        this.playNotificationSound();
      }

      // Remove playSound from options before passing to Notification API
      const { playSound, ...notificationOptions } = options || {};

      const notification = new Notification(title, {
        icon: notificationOptions?.icon || '/icon.png', // Use provided icon (profile image) or fallback
        badge: '/icon.png', // Badge Icon
        vibrate: [200, 100, 200], // Vibration Pattern (Mobile)
        silent: options?.silent || false,
        ...notificationOptions,
      });

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);

      // Handle notification click
      notification.onclick = (event) => {
        event.preventDefault();
        window.focus(); // Focus app window
        notification.close();
        
        // Navigate to conversation if data provided
        if (options?.data && typeof options.data === 'object' && 'conversationId' in options.data) {
          // Emit custom event to navigate
          window.dispatchEvent(new CustomEvent('notification-click', {
            detail: { conversationId: (options.data as any).conversationId }
          }));
        }
      };

      return notification;
    } catch (error) {
      console.error('Error showing notification:', error);
      return null;
    }
  }

  /**
   * Check if user is currently focused on the app
   */
  static isAppActive(): boolean {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  /**
   * Update badge counter (unread messages)
   */
  static updateBadge(count: number) {
    // Update document title with unread count
    if (count > 0) {
      document.title = `(${count}) Blyve`;
    } else {
      document.title = 'Blyve';
    }
  }

  /**
   * Get current permission status
   */
  static getPermission(): NotificationPermission {
    if ('Notification' in window) {
      return Notification.permission;
    }
    return 'denied';
  }
}
