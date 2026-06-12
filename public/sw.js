const CACHE = 'aichantier-v5';

// Ressources connues à pré-cacher au premier install
const PRECACHE = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Permet à la page de demander l'activation immédiate du nouveau SW (cf. main.jsx).
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// Nettoie les anciens caches à l'activation
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Ne jamais intercepter : Supabase, API proxy IA, requêtes cross-origin autres que fonts
  const isSameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!isSameOrigin && !isFont) return;
  if (url.pathname.startsWith('/api/')) return;

  // Assets immutables (hashes Vite) → cache-first : si en cache, on sert directement
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
          return res;
        });
      })
    );
    return;
  }

  // Fonts Google → cache-first (évite le rechargement réseau répété)
  if (isFont) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
          return res;
        });
      })
    );
    return;
  }

  // Navigation HTML et autres ressources statiques → network-first (reçoit les mises à jour),
  // fallback sur le cache si hors ligne
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/')))
  );
});

// ── Background Sync : vide la file d'upload photos même app fermée (Chrome Android) ──
// La page inscrit chaque photo dans IndexedDB (chantierai_uploads/queue) avec la config
// Supabase (cfg/_cfg : url + clés + token). Quand la connectivité revient, l'événement
// 'sync' se déclenche — même sans onglet ouvert — et on pousse les fichiers vers Storage.
// Best effort : si le token a expiré (>1h), l'upload échoue silencieusement et la page
// reprendra la file à sa prochaine ouverture (le filet de sécurité reste côté page).
const UP_DB = 'chantierai_uploads';

function upOpenDb() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(UP_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue');
        if (!db.objectStoreNames.contains('done'))  db.createObjectStore('done');
        if (!db.objectStoreNames.contains('cfg'))   db.createObjectStore('cfg');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function upReq(db, store, mode, fn) {
  return new Promise(resolve => {
    if (!db) { resolve(undefined); return; }
    try {
      const r = fn(db.transaction(store, mode).objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

async function drainUploadQueueSW() {
  const db = await upOpenDb();
  if (!db) return;
  const cfg = await upReq(db, 'cfg', 'readonly', s => s.get('_cfg'));
  if (!cfg?.url || !cfg?.accessToken) return;
  const keys = (await upReq(db, 'queue', 'readonly', s => s.getAllKeys())) || [];
  for (const key of keys) {
    const entry = await upReq(db, 'queue', 'readonly', s => s.get(key));
    if (!entry) continue;
    try {
      const blob = await (await fetch(entry.dataUrl)).blob();
      const res = await fetch(`${cfg.url}/storage/v1/object/photos/${entry.path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.accessToken}`,
          'apikey': cfg.anonKey || '',
          'x-upsert': 'true',
          'cache-control': 'max-age=31536000',
          'content-type': entry.contentType || 'image/jpeg',
        },
        body: blob,
      });
      if (!res.ok && res.status !== 409) continue; // 409 = déjà uploadé → on confirme
      await upReq(db, 'done',  'readwrite', s => s.put(entry.path, key));
      await upReq(db, 'queue', 'readwrite', s => s.delete(key));
    } catch { /* réseau/token KO → la page reprendra la file */ }
  }
}

self.addEventListener('sync', e => {
  if (e.tag === 'photo-upload') e.waitUntil(drainUploadQueueSW());
});
