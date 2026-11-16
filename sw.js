/* CP NEXUS - background alerts (service worker). Scope: the whole /CP-NEXUS/ site. */
const ICON = new URL('icon-192.png', self.location).href;
const HOME = new URL('NEXUS/', self.location).href;
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'CP NEXUS', body: e.data ? e.data.text() : '' }; }
  const opts = {
    body: d.body || '',
    icon: ICON, badge: ICON,
    tag: 'nx-' + (d.id || Date.now()),
    renotify: true,
    requireInteraction: true,           /* stays on screen until the person swipes or taps it */
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
    data: { url: d.url || HOME, id: d.id || null }
  };
  e.waitUntil(self.registration.showNotification(d.title || 'CP NEXUS', opts));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || HOME, self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.indexOf('/CP-NEXUS/') > -1 && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
