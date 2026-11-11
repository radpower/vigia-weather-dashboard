const CACHE = 'vigia-shell-v5';
const SHELL = ['./', './index.html', './style.css', './src/app.js', './src/weather.js', './src/local-weather.js', './src/station.js', './src/news.js', './src/electricity.js', './src/map.js', './src/preparedness.js', './src/alerts.js', './src/impact-summary.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('vigia-shell-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (event) => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') { event.respondWith(fetch(request).catch(() => caches.match('./index.html'))); return; }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
