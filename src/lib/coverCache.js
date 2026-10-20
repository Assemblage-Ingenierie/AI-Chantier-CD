// COUVERTURES INSTANTANÉES sur l'accueil (retour Thomas 20/10 : « 5 vignettes mettent 5 s à
// charger, puis mes deux dernières affaires encore 5 s après — je veux que ce soit instantané »).
//
// Chaque couverture affichée est gardée SUR L'APPAREIL en petite image (~480 px, quelques
// dizaines de Ko) dans IndexedDB. Au démarrage suivant, la carte l'affiche tout de suite, sans
// attendre ni le serveur, ni la signature d'URL, ni le téléchargement de la vignette.
//
// Périmètre : AFFICHAGE uniquement — rien n'est écrit dans les projets, la sauvegarde ou Supabase.
// Clé = chemin Storage de la couverture : une nouvelle couverture (nouveau fichier) a une autre clé
// → jamais d'ancienne image affichée à la place de la nouvelle. Toute erreur → comportement d'avant.
import { photoPathFromUrl } from './photoThumbs.js';

const DB_NAME = 'chantierai_covers';
const STORE = 'c';
const MAX_ENTRIES = 300;
const WIDTH = 480;

const _mem = new Map();          // chemin → data URL
const _listeners = new Set();
let _loaded = false;
let _dbPromise = null;
const _inflight = new Set();

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return _dbPromise;
}

// Lecture UNIQUE au démarrage (lancée dès l'import du module, bien avant l'affichage de l'accueil).
const _loadPromise = (async () => {
  const db = await openDb();
  if (db) {
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const rows = (req.result || []).filter(r => r && r.k && typeof r.d === 'string');
          rows.sort((a, b) => (b.t || 0) - (a.t || 0));
          rows.forEach((r, i) => { if (i < MAX_ENTRIES) _mem.set(r.k, r.d); else store.delete(r.k); });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch { resolve(); }
    });
  }
  _loaded = true;
  _listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
})();

export function coverCacheKey(photo) { return photoPathFromUrl(photo); }
export function coverCacheReady() { return _loaded; }
export function whenCoverCacheReady() { return _loadPromise; }
export function peekCover(key) { return key ? (_mem.get(key) || null) : null; }
export function onCoverCache(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

// Image chargée avec succès à l'écran → on en garde une petite copie locale (une fois par fichier).
export function rememberCover(key, url) {
  if (!key || !url || _mem.has(key) || _inflight.has(key) || typeof url !== 'string' || url.startsWith('data:')) return;
  _inflight.add(key);
  (async () => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const blob = await resp.blob();
      let src = null, w = 0, h = 0, close = () => {};
      if (typeof createImageBitmap === 'function') {
        try { const bm = await createImageBitmap(blob); src = bm; w = bm.width; h = bm.height; close = () => { try { bm.close(); } catch { /* ignore */ } }; } catch { /* repli <img> */ }
      }
      if (!src) {
        const u = URL.createObjectURL(blob);
        try {
          src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
          w = src.naturalWidth; h = src.naturalHeight;
        } finally { URL.revokeObjectURL(u); }
      }
      if (!w || !h) { close(); return; }
      const sc = Math.min(1, WIDTH / w);
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * sc)); cv.height = Math.max(1, Math.round(h * sc));
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(src, 0, 0, cv.width, cv.height);
      close();
      const d = cv.toDataURL('image/jpeg', 0.8);
      cv.width = 0; cv.height = 0;
      if (!d || d.length < 100) return;
      _mem.set(key, d);
      const db = await openDb();
      if (db) { try { db.transaction(STORE, 'readwrite').objectStore(STORE).put({ k: key, d, t: Date.now() }); } catch { /* ignoré */ } }
    } catch { /* ignoré : affichage réseau comme avant */ }
    finally { _inflight.delete(key); }
  })();
}

// Copie locale illisible → on l'oublie (la carte repasse sur le réseau, comme avant).
export function forgetCover(key) {
  if (!key) return;
  _mem.delete(key);
  openDb().then((db) => { if (db) { try { db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key); } catch { /* ignoré */ } } });
}

// Déconnexion : rien ne doit rester d'un compte à l'autre.
export function clearCoverCache() {
  _mem.clear();
  openDb().then((db) => { if (db) { try { db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch { /* ignoré */ } } });
}
