/* Quest Panel — сервис-воркер: офлайн-кэш + автообновление версии.
   Страница грузится «сначала сеть» — изменения из репо приходят сразу при наличии интернета,
   без интернета отдаётся сохранённая копия из кэша. */
const CACHE = 'quest-panel-v5';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './favicon-64.png', './notif-icon-96.png', './push-config.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  /* Навигация: сначала сеть (обновления подхватываются сразу), офлайн — из кэша */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  /* Push-конфигурация должна обновляться при каждом открытии с сетью. */
  if (new URL(req.url).pathname.endsWith('/push-config.js')) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req)));
    return;
  }

  /* Остальные ресурсы: сначала кэш */
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Панель персонажа', body: 'Открой планер, чтобы посмотреть, что дальше.' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: new URL('icon-192.png', self.registration.scope).href,
    badge: new URL('notif-icon-96.png', self.registration.scope).href,
    tag: data.tag || 'quest-panel-notification',
    renotify: true,
    vibrate: [180, 90, 180],
    lang: 'ru',
    data: { tab: data.tab || 'today', url: data.url || './?tab=today' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const tab = event.notification.data?.tab || 'today';
  const target = new URL(event.notification.data?.url || './?tab=' + encodeURIComponent(tab), self.registration.scope).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        client.postMessage({ type: 'planner-navigate', tab });
        return client.focus();
      }
    }
    return clients.openWindow(target);
  }));
});


