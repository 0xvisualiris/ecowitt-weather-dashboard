// The service worker: shows alert notifications (push.js on the server sends them) and keeps
// the last copy of the page and its data, so a home-screen app still opens without a connection.
//
// Everything goes to the network first, so a new release and fresh readings always win; the
// cache only answers when the network can't. The radar, map tiles and the admin and push
// paths are never cached.

const CACHE = 'wetterstation-v1';
const SHELL = ['/', '/styles.css', '/i18n.js', '/lib.js', '/app.js', '/main.js', '/manifest.webmanifest',
  '/fonts/bricolage-latin.woff2', '/favicon.svg', '/icon-192.png'];
const NEVER = /^\/api\/(radar|tiles|admin|push)\b/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || NEVER.test(url.pathname)) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy)).catch(() => {});
    }
    return res;
  }).catch(async () => (await caches.match(req.mode === 'navigate' ? '/' : req)) ?? Response.error()));
});

self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data?.json() ?? {}; } catch { msg = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(msg.title || location.hostname, {
    body: msg.body || '',
    tag: msg.tag,            // a newer message for the same rule replaces the older one
    renotify: !!msg.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: msg.url || '/' },
  }));
});

// Tapping the notification opens the Alerts page, in an open tab if there is one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
    const tab = tabs.find((t) => new URL(t.url).origin === location.origin);
    if (tab) return tab.navigate(url).then((t) => (t ?? tab).focus()).catch(() => tab.focus());
    return self.clients.openWindow(url);
  }));
});
