// Bump this on every release that must reach installed clients: the byte
// change is what makes browsers install the new SW and fire the update flow,
// and the activate handler below deletes every older cache bucket.
const CACHE_NAME = 'nexus-crm-v5';
const STATIC_SHELL = ['/', '/login'];

// Listen for the client asking the new SW to take over immediately
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ── Web Push ─────────────────────────────────────────────────────────────────
// The server sends one push per thing worth knowing about (already grouped and
// written in this device's language). Shown with the system sound, vibration on
// Android, and the unread count on the app icon — even when the app is closed.

function isAppleDevice() {
  return /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent) && !/Chrome|CriOS|Android/.test(self.navigator.userAgent);
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

  event.waitUntil((async () => {
    if (typeof data.badge === 'number' && self.navigator.setAppBadge) {
      try {
        if (data.badge > 0) await self.navigator.setAppBadge(data.badge);
        else await self.navigator.clearAppBadge();
      } catch (e) { /* badging unsupported */ }
    }

    // App open and in front: the in-app banner already shows it. Safari counts
    // a push without a notification against the site, so Apple always shows one.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const inFront = windows.some((c) => c.visibilityState === 'visible' && c.focused);
    if (inFront && !isAppleDevice()) return;

    const title = data.title || 'Nexus CRM';
    await self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      tag: data.tag || undefined,
      // A newer push for the same chat replaces the old one but still sounds.
      renotify: !!data.tag,
      silent: false,
      vibrate: [120, 60, 120],
      lang: data.lang || 'en',
      dir: data.dir || 'auto',
      timestamp: Date.now(),
      data: { url: data.url || '/dashboard', nid: data.nid || null },
    });
  })());
});

// Tapping a notification opens the app on that screen. If the app is already
// open (even in the background) that window switches there — no second copy.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/dashboard';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = all.filter((c) => new URL(c.url).origin === self.location.origin);
    const target = same.find((c) => c.focused) || same.find((c) => c.visibilityState === 'visible') || same[0];
    if (target) {
      try { await target.focus(); } catch (e) {}
      // The page routes client-side (keeps its state); navigate() is the fallback
      // for a page that is not running the app shell (e.g. the login screen).
      const path = new URL(target.url).pathname;
      if ((path === '/' || path.startsWith('/login')) && 'navigate' in target) {
        try { await target.navigate(url); } catch (e) {}
      } else {
        target.postMessage({ type: 'OPEN_URL', url });
      }
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin and non-GET
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-only for API calls (never serve stale data)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/data/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Stale-while-revalidate for Next.js built assets (hashed, safe to cache long)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  // Network-first for page navigations — fall back to cache on offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request) || caches.match('/'))
    );
    return;
  }

  // Cache-first, but ONLY for real static assets (images/fonts/icons).
  // Anything else falls through untouched — critically, this includes
  // Next.js's RSC/flight fetches issued during client-side <Link>/router.push
  // navigation (same page URL, plain fetch(), so mode !== 'navigate' and it's
  // not under /_next/static/). Those must always hit the network: caching
  // them by URL alone serves stale/mismatched flight payloads on the next
  // transition and silently breaks client-side routing until a hard refresh.
  if (request.destination === 'image' || request.destination === 'font') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
  }
});
