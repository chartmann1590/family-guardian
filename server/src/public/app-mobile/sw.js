const CACHE = 'family-guardian-pwa-v3';
const SHELL = [
  '/app',
  '/public/app-mobile/app.css',
  '/public/app-mobile/app.js',
  '/public/app-mobile/manifest.webmanifest',
  '/public/app-mobile/icon.svg',
  '/public/app-mobile/icon-180.png',
  '/public/units.js'
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  event.respondWith(fetch(event.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return res;
  }).catch(() => caches.match(event.request)));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.type === 'sos_active' ? 'SOS Alert'
    : data.type === 'crash_pending' ? 'Crash Detected'
    : data.type === 'geofence_enter' ? 'Geofence Alert'
    : data.type === 'geofence_exit' ? 'Geofence Alert'
    : data.type === 'chat_message' ? 'New Message'
    : data.type === 'low_battery' ? 'Low Battery'
    : data.type === 'routine_deviation' ? 'Routine Alert'
    : data.type === 'weekly_digest' ? 'Weekly Digest'
    : data.type === 'break_suggested' ? 'Break Reminder'
    : data.type === 'arrived_safely' ? 'Arrived Safely'
    : data.type === 'eta_updated' ? 'ETA Update'
    : 'Family Guardian';

  const body = data.displayName
    ? `${data.displayName}: ${data.type.replace(/_/g, ' ')}`
    : data.type?.replace(/_/g, ' ') || 'New notification';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/public/app-mobile/icon-180.png',
      tag: data.type || 'default',
      data: { url: '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.navigate(url).then(() => client.focus());
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
