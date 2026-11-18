/* ApexOS shell service worker.
 *
 * Caches only the shell itself. Anything under /apps/ is passed straight
 * through so each sub-app keeps its own worker, scope and cache.
 */
const VERSION = 'apex-shell-v3';
const SHELL = ['./', './index.html', './styles.css', './app.js', './registry.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('apex-shell-') && key !== VERSION)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* Sub-apps own their own scope, so this worker only steps in for them when
     the network is gone - and only from the Apex Store install cache. */
  if (url.pathname.startsWith('/apps/')) {
    const match = url.pathname.match(/^\/apps\/([^/]+)\//);
    if (!match) return;
    const cacheName = 'apex-app-' + match[1];
    event.respondWith(
      fetch(request).catch(async () => {
        if (!(await caches.has(cacheName))) throw new Error('not installed');
        const hit = await caches.match(request, { cacheName, ignoreSearch: true });
        if (hit) return hit;
        const dir = '/apps/' + match[1] + '/';
        return (
          (await caches.match(dir, { cacheName, ignoreSearch: true })) ||
          (await caches.match(dir + 'index.html', { cacheName })) ||
          Response.error()
        );
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
