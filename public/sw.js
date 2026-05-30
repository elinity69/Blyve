const CACHE_NAME = 'blyve-v3';
const PRECACHE_URLS = ['/', '/manifest.json'];
const PUSH_PREFS_CACHE = 'blyve-push-prefs';
const PUSH_PREFS_URL = '/prefs/system-push';

async function getSystemPushEnabled() {
  try {
    const cache = await caches.open(PUSH_PREFS_CACHE);
    const res = await cache.match(PUSH_PREFS_URL);
    if (!res) return true;
    const data = await res.json();
    return data.enabled !== false;
  } catch {
    return true;
  }
}

async function setSystemPushEnabledInCache(enabled) {
  const cache = await caches.open(PUSH_PREFS_CACHE);
  await cache.put(PUSH_PREFS_URL, new Response(JSON.stringify({ enabled })));
}

function isAppClientVisible(clientList) {
  return clientList.some((client) => client.visibilityState === 'visible');
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'set-system-push-enabled') return;
  event.waitUntil(setSystemPushEnabledInCache(Boolean(event.data.enabled)));
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() ?? '' };
  }

  const title = payload.title ?? 'Blyve';
  const data = payload.data ?? {};

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      const appVisible = isAppClientVisible(clientList);

      // In-app sound/toasts are handled by the open client — only forward when app is open
      if (appVisible) {
        for (const client of clientList) {
          client.postMessage({
            type: 'play-notification-sound',
            conversationId: data.conversationId ?? null,
            groupId: data.groupId ?? null,
          });
        }
      }

      const systemPushEnabled = await getSystemPushEnabled();
      if (!systemPushEnabled || appVisible) {
        return undefined;
      }

      return self.registration.showNotification(title, {
        body: payload.body ?? '',
        icon: payload.icon ?? '/icon.png',
        badge: '/icon.png',
        tag: payload.tag,
        data,
        silent: true,
        requireInteraction: false,
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data ?? {};
  const conversationId = data.conversationId ?? null;
  const groupId = data.groupId ?? null;
  const channelId = data.channelId ?? null;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        client.postMessage({
          type: 'notification-click',
          conversationId,
          groupId,
          channelId,
        });
        if ('focus' in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        const params = new URLSearchParams();
        if (conversationId) params.set('conversation', conversationId);
        if (groupId) params.set('group', groupId);
        if (channelId) params.set('channel', channelId);
        const query = params.toString();
        return self.clients.openWindow(query ? `/?${query}` : '/');
      }

      return undefined;
    }),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const request = event.request;
  const url = new URL(request.url);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const destination = request.destination;

  if (['style', 'script', 'image', 'font'].includes(destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (!response.ok || response.type === 'opaque') return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy).catch(() => {});
          });
          return response;
        });
      }),
    );
  }
});
