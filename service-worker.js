// ============================================================
// SERVICE WORKER — PWA offline support for BLACKOUT
// Caches the application shell, static assets and the street-art backgrounds.
//
// Network-first: while the phone is online it always gets the current build,
// with the cache used only as an offline fallback. The previous cache-first
// version pinned every phone that had already loaded once to the code in its
// cache, so a shipped fix never reached mobile at all. Bump CACHE_NAME with
// every release — that is what makes installed clients pick the new files up.
// ============================================================

var CACHE_NAME = 'blackout-v5';
var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './manifest.json',
  './art/wall.jpg',
  './art/mural.jpg',
  './art/court.jpg',
  './art/posters.jpg',
  './art/stencil.jpg',
  './art/asphalt.jpg',
  './js/config.js',
  './js/difficulty.js',
  './js/util.js',
  './js/audio.js',
  './js/challenges.js',
  './js/progression.js',
  './js/modes.js',
  './js/tournament.js',
  './js/settings.js',
  './js/menu-music.js',
  './js/input.js',
  './js/particles.js',
  './js/courts.js',
  './js/models.js',
  './js/ball.js',
  './js/player.js',
  './js/arena.js',
  './js/abilities.js',
  './js/ai.js',
  './js/keeper.js',
  './js/camera.js',
  './js/lighting.js',
  './js/match.js',
  './js/celebration.js',
  './js/hud.js',
  './js/main.js',
  './js/living.js',
  './lib/three.min.js',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
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

// Fetch: network-first, falling back to the cache when offline
self.addEventListener('fetch', function (event) {
  var req = event.request;

  // Skip non-GET requests and anything cross-origin
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req).then(function (response) {
      if (response && response.status === 200 && response.type === 'basic') {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(req, clone);
        });
      }
      return response;
    }).catch(function () {
      // Offline: serve the cached copy, or the shell for a navigation
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 503, statusText: 'offline' });
      });
    })
  );
});
