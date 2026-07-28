/* Hemut Cockpit service worker.
   Phase 1: offline shell cache. Phase 3 fills in push (handlers stubbed below). */
const CACHE = 'cockpit-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network-first for the app shell so live edits show; cache is the offline fallback.
   NEVER cache Linear API or the Cockpit service calls. */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'api.linear.app') return;          // always live
  if (url.pathname.startsWith('/data/') || url.pathname.startsWith('/notify')) return; // service, always live

  // The app is one HTML document that is REPUBLISHED with fresh baked data. If the
  // document is served from any cache (SW or HTTP), the installed app silently pins to
  // an old build. So documents always go to the network with the HTTP cache bypassed;
  // the cached copy is strictly an offline fallback.
  const isDoc = e.request.mode === 'navigate' ||
                (e.request.destination === 'document') ||
                url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isDoc) {
    e.respondWith(
      fetch(url.href, { cache: 'no-store' }).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
        return r;
      }).catch(() => caches.match('./index.html').then(m => m || Response.error()))
    );
    return;
  }

  // Static companions (icons, manifest, sw assets): cache-first is fine, they rarely change.
  e.respondWith(
    caches.match(e.request).then(m => m || fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return r;
    }))
  );
});

/* ---- Phase 3: Web Push (wired when the Worker + VAPID land) ---- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Hemut Cockpit';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || 'cockpit',
    data: { tab: d.tab || 'board', url: d.url || './index.html' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const tab = (e.notification.data && e.notification.data.tab) || 'board';
  const target = './index.html?tab=' + tab;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.postMessage({ goto: tab }); return c.focus(); } }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});
