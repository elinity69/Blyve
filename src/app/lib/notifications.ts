/**
 * Web Push Notification System
 * Handles browser notifications when app is in background
 */

const MUTE_SOUND_IN_CHAT_KEY = 'mute_notification_sound_in_chat_conversations';
const MUTE_NOTIFICATIONS_IN_GROUP_KEY = 'mute_notifications_in_group_servers';

export class NotificationManager {
  private static permission: NotificationPermission = 'default';
  private static lastSoundTime: number = 0;
  private static readonly SOUND_THROTTLE_MS = 2000; // 2 seconds between sounds
  private static notificationAudio: HTMLAudioElement | null = null;
  private static audioUnlocked = false;
  private static activeConversationId: string | null = null;
  private static activeGroupChannelId: string | null = null;
  private static activeGroupId: string | null = null;

  /**
   * Track which conversation is currently open in the UI.
   * Used to suppress in-app toasts for the active chat (not sounds by default).
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

  static setActiveGroupChannelId(channelId: string | null) {
    this.activeGroupChannelId = channelId;
  }

  static getActiveGroupChannelId(): string | null {
    return this.activeGroupChannelId;
  }

  static setActiveGroupId(groupId: string | null) {
    this.activeGroupId = groupId;
  }

  static getActiveGroupId(): string | null {
    return this.activeGroupId;
  }

  /**
   * Clear stale persisted conversation state on cold start.
   * ChatScreen sets the active conversation again when actually mounted.
   */
  static resetActiveConversationTracking() {
    this.activeConversationId = null;
    this.activeGroupChannelId = null;
    this.activeGroupId = null;
    localStorage.removeItem('currentConversationId');
  }

  private static getMuteNotificationsInGroupIds(): Set<string> {
    try {
      const raw = localStorage.getItem(MUTE_NOTIFICATIONS_IN_GROUP_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  }

  static isGroupNotificationsMutedWhenActive(groupId: string): boolean {
    return this.getMuteNotificationsInGroupIds().has(groupId);
  }

  static setGroupNotificationsMutedWhenActive(groupId: string, muted: boolean) {
    const ids = this.getMuteNotificationsInGroupIds();
    if (muted) {
      ids.add(groupId);
    } else {
      ids.delete(groupId);
    }
    localStorage.setItem(MUTE_NOTIFICATIONS_IN_GROUP_KEY, JSON.stringify([...ids]));
  }

  static shouldNotifyForGroup(groupId: string): boolean {
    if (!this.isGroupNotificationsMutedWhenActive(groupId)) {
      return true;
    }
    return this.getActiveGroupId() !== groupId;
  }

  private static getMuteSoundInChatConversationIds(): Set<string> {
    try {
      const raw = localStorage.getItem(MUTE_SOUND_IN_CHAT_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  }

  static isConversationSoundMutedWhenInChat(conversationId: string): boolean {
    return this.getMuteSoundInChatConversationIds().has(conversationId);
  }

  static setConversationSoundMutedWhenInChat(conversationId: string, muted: boolean) {
    const ids = this.getMuteSoundInChatConversationIds();
    if (muted) {
      ids.add(conversationId);
    } else {
      ids.delete(conversationId);
    }
    localStorage.setItem(MUTE_SOUND_IN_CHAT_KEY, JSON.stringify([...ids]));
  }

  static shouldPlaySoundForConversation(conversationId: string): boolean {
    if (!this.isConversationSoundMutedWhenInChat(conversationId)) {
      return true;
    }
    return this.getActiveConversationId() !== conversationId;
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
  static unlockAudio(): boolean {
    if (this.audioUnlocked) return true;

    void this.ensureAudioUnlocked();
    return this.audioUnlocked;
  }

  private static ensureAudioUnlocked(): Promise<boolean> {
    if (this.audioUnlocked) return Promise.resolve(true);

    return new Promise((resolve) => {
      try {
        const audio = this.getNotificationAudio();
        const playPromise = audio.play();
        if (!playPromise) {
          this.audioUnlocked = true;
          resolve(true);
          return;
        }
        void playPromise
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
            this.audioUnlocked = true;
            resolve(true);
          })
          .catch(() => resolve(false));
      } catch {
        resolve(false);
      }
    });
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
  static playNotificationSound(options?: { conversationId?: string; groupId?: string }) {
    if (options?.conversationId && !this.shouldPlaySoundForConversation(options.conversationId)) {
      return;
    }
    if (options?.groupId && !this.shouldNotifyForGroup(options.groupId)) {
      return;
    }

    const now = Date.now();
    const timeSinceLastSound = now - this.lastSoundTime;

    if (timeSinceLastSound < this.SOUND_THROTTLE_MS) {
      return;
    }

    void this.ensureAudioUnlocked().then((unlocked) => {
      if (!unlocked) return;

      try {
        this.lastSoundTime = Date.now();
        const audio = this.getNotificationAudio();
        audio.currentTime = 0;
        void audio.play().catch((err) => {
          console.warn('Could not play notification sound:', err);
          this.audioUnlocked = false;
        });
      } catch (error) {
        console.warn('Notification sound not supported:', error);
      }
    });
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
   * Tab is visible (user can see the app), even if another window has focus.
   */
  static isAppVisible(): boolean {
    return document.visibilityState === 'visible';
  }

  /**
   * Tab is visible and the window has focus.
   */
  static isAppActive(): boolean {
    return this.isAppVisible() && document.hasFocus();
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
