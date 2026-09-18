// ============================================================
// SERVICE WORKER — PWA offline support for BLOCK OUT
// Caches the application shell and static assets.
// ============================================================

var CACHE_NAME = 'blockout-v1';
var ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/manifest.json',
  '/js/config.js',
  '/js/difficulty.js',
  '/js/util.js',
  '/js/audio.js',
  '/js/progression.js',
  '/js/input.js',
  '/js/particles.js',
  '/js/models.js',
  '/js/ball.js',
  '/js/player.js',
  '/js/arena.js',
  '/js/abilities.js',
  '/js/ai.js',
  '/js/keeper.js',
  '/js/camera.js',
  '/js/match.js',
  '/js/hud.js',
  '/js/main.js',
  '/lib/three.min.js'
];

// Install: pre-cache the application shell
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (name) {
          return name !== CACHE_NAME;
        }).map(function (name) {
          return caches.delete(name);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Fetch: cache-first strategy for static assets, network-first for others
self.addEventListener('fetch', function (event) {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;

      return fetch(event.request).then(function (response) {
        // Don't cache bad responses
        if (!response || response.status !== 200) return response;

        // Only cache same-origin requests
        if (event.request.url.indexOf(self.location.origin) !== 0) return response;

        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(function () {
        // Offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('', { status: 503 });
      });
    })
  );
});
