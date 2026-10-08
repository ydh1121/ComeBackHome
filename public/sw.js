const CACHE_PREFIX = 'cbh-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v3';
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put('/', response.clone());
    return response;
  } catch {
    return (await cache.match(request))
      || (await cache.match('/'))
      || new Response('ComeBackHome is offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
  }
}

async function handleStaticAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // API responses are runtime data/config and must never be pinned by the
  // shell cache. This also prevents static-map fallback images from surviving
  // a later interactive-map activation.
  if (url.pathname.startsWith('/api/')) return;

  if (['script', 'style', 'font', 'image'].includes(request.destination)) {
    event.respondWith(handleStaticAsset(request));
  }
});


function safeNotificationPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search : '/';
  } catch {
    return '/';
  }
}

function parsePushPayload(event) {
  const fallback = {
    title: 'ComeBackHome',
    body: '새로운 알림이 있습니다.',
    tag: 'comebackhome',
    path: '/',
  };

  if (!event.data) return fallback;

  try {
    const raw = event.data.json();
    return {
      title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : fallback.title,
      body: typeof raw?.body === 'string' ? raw.body : fallback.body,
      tag: typeof raw?.tag === 'string' && raw.tag.trim() ? raw.tag.trim() : fallback.tag,
      path: safeNotificationPath(raw?.path),
    };
  } catch {
    const body = event.data.text();
    return { ...fallback, body: body || fallback.body };
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/icons/icon-192.png',
      data: { path: payload.path },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safeNotificationPath(event.notification.data?.path);
  const targetUrl = new URL(path, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const exact = windows.find((client) => client.url === targetUrl);
    if (exact) return exact.focus();

    const existing = windows[0];
    if (existing) {
      if ('navigate' in existing) await existing.navigate(targetUrl);
      return existing.focus();
    }

    return self.clients.openWindow(path);
  })());
});
