/**
 * sw.js — service worker. The thing that makes this work in a gym basement.
 *
 * Strategy: cache-first for the app shell, with a background refresh (stale-while-revalidate).
 * Cache-first is right here because the shell is the app — there is no server data to be stale
 * about. Your training data lives in localStorage and never touches the network at all.
 *
 * BUMP `CACHE` ON EVERY DEPLOY. This is not optional bookkeeping — it is the only thing that
 * ships new code. Browsers re-run `install` when the BYTES of this file change, and `install` is
 * what re-fetches the shell with `cache: 'reload'`. Leave the version alone and install never
 * re-runs; the only refresh path left is the background revalidate in `fetch`, which updates the
 * cache AFTER serving the old copy — so every user sits exactly one reload behind forever.
 */

const CACHE = 'workout-v4';

// Relative paths: this is served from a GitHub Pages subpath (/workout/app/), not the domain
// root. Leading slashes would resolve to the wrong origin path and every precache would 404.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/program.js',
  './js/progression.js',
  './js/units.js',
  './js/cloud.js',
  './js/warmup.js',
  './js/readiness.js',
  './js/stats.js',
  './js/charts.js',
  './js/timer.js',
  './js/plates.js',
  './js/views/today.js',
  './js/views/history.js',
  './js/views/stats.js',
  './js/views/nutrition.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll is all-or-nothing: one 404 rejects the whole install and leaves the app uncached.
    // Adding individually means a missing icon can't break offline support for the JS.
    await Promise.all(SHELL.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] precache miss:', url, err);
      }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch cross-origin requests — there aren't any by design, and caching them would be
  // a way to silently introduce a network dependency.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });

    const network = fetch(request)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
        return res;
      })
      .catch(() => null);

    // Cache-first: instant load, and correct offline.
    if (cached) {
      event.waitUntil(network); // refresh in the background for next time
      return cached;
    }

    const fresh = await network;
    if (fresh) return fresh;

    // Offline, uncached, and a navigation — fall back to the shell so deep links still open.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }

    return new Response('Offline and not cached.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  })());
});
