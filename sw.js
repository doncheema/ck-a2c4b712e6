/* Hemut Cockpit service worker.
   Offline shell cache + Web Push handlers. Documents are ALWAYS network-first with the
   HTTP cache bypassed: the app is one republished HTML document, and any cached copy
   silently pins the installed app to an old build. */
const CACHE = 'cockpit-v3';
const SHELL = ['./index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
const TABS = ['now', 'board', 'prep', 'money', 'frontier'];

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

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'api.linear.app') return;          // always live

  const isDoc = e.request.mode === 'navigate' ||
                e.request.destination === 'document' ||
                url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isDoc) {
    e.respondWith(
      fetch(url.href, { cache: 'no-store' }).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {}); }
        return r;
      }).catch(() => caches.match('./index.html').then(m => m || Response.error()))
    );
    return;
  }

  // Static companions: cache-first, but NEVER cache a non-OK response (a cached 404
  // poisoned the Frontier fetch until the cache name was bumped — keep the r.ok gate).
  e.respondWith(
    caches.match(e.request).then(m => m || fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); }
      return r;
    }))
  );
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const tab = TABS.includes(d.tab) ? d.tab : 'now';
  e.waitUntil(self.registration.showNotification(d.title || 'Hemut Cockpit', {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || 'cockpit',
    data: { tab, url: './index.html?tab=' + tab }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const tab = TABS.includes(e.notification.data && e.notification.data.tab) ? e.notification.data.tab : 'now';
  const target = './index.html?tab=' + tab;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.postMessage({ goto: tab }); return c.focus(); } }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});
