const CACHE = 'omd-shell-__OMD_BUILD__';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icons/icon-192.png', './icons/icon-512.png', './src/styles.css', './src/model.js', './src/store.js', './src/reminders.js', './src/app.js', './src/webmcp.js', './src/pwa.js', './src/integrations.js'];
const paths = new Set(SHELL.map(path => new URL(path, self.registration.scope).pathname));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('omd-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !paths.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) { await cache.put(event.request, response.clone()); return response; }
      return await cache.match(event.request) ?? response;
    } catch {
      const cached = await cache.match(event.request) ?? (event.request.mode === 'navigate' ? await cache.match(new URL('./index.html', self.registration.scope)) : null);
      return cached ?? Response.error();
    }
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Keep notification destinations on this app's own origin and scope.
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = all.find(client => client.url.startsWith(self.registration.scope));
    if (page) return page.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
