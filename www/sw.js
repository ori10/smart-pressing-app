// Fonctionnement hors-ligne (iPhone / navigateur) : tous les fichiers de l'appli sont gardés dans le téléphone.
const VERSION = 'sp-__BUILD__';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/charts.js', './js/cloud.js', './js/db.js', './js/export.js', './js/logic.js', './js/native.js', './js/pdf.js', './js/scan.js', './js/seed.js',
  './vendor/capacitor.js', './vendor/jspdf.umd.min.js', './vendor/xlsx.full.min.js',
  './fonts/pjs-400.woff2', './fonts/pjs-600.woff2', './fonts/pjs-700.woff2', './fonts/pjs-800.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './img/logo.jpg',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Réseau d'abord quand il y a internet (pour recevoir les mises à jour), sinon la copie gardée.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
