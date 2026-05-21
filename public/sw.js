// Service Worker minimal — requis pour que Chrome Android propose l'installation PWA
const CACHE = 'aichantier-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Stratégie network-first : on ne bloque pas les requêtes réseau,
// on met juste en cache les ressources statiques pour le mode hors-ligne basique.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Ne pas intercepter les requêtes Supabase ou l'API IA
  if (url.hostname.includes('supabase') || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
