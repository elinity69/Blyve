import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isWebPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY?.trim());
}

/** Web Push requires HTTPS, a service worker, and a VAPID public key (production PWA). */
export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    import.meta.env.PROD &&
    isWebPushConfigured() &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function ensureServiceWorkerReady(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function subscribeToWebPush(userId: string): Promise<boolean> {
  if (!isWebPushSupported() || !VAPID_PUBLIC_KEY) return false;
  if (Notification.permission !== 'granted') return false;

  const registration = await ensureServiceWorkerReady();
  if (!registration?.pushManager) return false;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 512),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,endpoint' },
  );

  if (error) {
    console.warn('Failed to save push subscription:', error.message);
    return false;
  }

  return true;
}

export async function unsubscribeFromWebPush(): Promise<void> {
  const registration = await ensureServiceWorkerReady();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}
