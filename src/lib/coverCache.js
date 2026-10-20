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
// Projet → chemin de SA dernière couverture gardée (retour Thomas 20/10, « deux vignettes toujours
// lentes ») : la carte affiche sa copie locale DÈS LE DÉMARRAGE, même quand le chemin de la
// couverture n'est pas encore connu (affaire absente du cache local, couverture pas encore
// relue du serveur) ou qu'il vient de changer (couverture allégée/modifiée ailleurs : l'ancienne
// reste affichée jusqu'à l'arrivée de la nouvelle, au lieu de l'icône grise).
const _byPid = new Map();
let _photosSettled = false;      // couvertures relues du serveur (cf. markCoverPhotosSettled)
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
          rows.forEach((r, i) => {
            if (i >= MAX_ENTRIES) { store.delete(r.k); return; }
            _mem.set(r.k, r.d);
            if (r.pid && !_byPid.has(r.pid)) _byPid.set(r.pid, r.k); // tri récent d'abord → la plus récente gagne
          });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch { resolve(); }
    });
  }
  _loaded = true;
  notify();
})();

function notify() { _listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } }); }
function persist(key, pid) {
  const d = _mem.get(key);
  if (!d) return;
  openDb().then((db) => { if (db) { try { db.transaction(STORE, 'readwrite').objectStore(STORE).put({ k: key, d, t: Date.now(), ...(pid ? { pid } : {}) }); } catch { /* ignoré */ } } });
}

// Clé = chemin Storage, que la couverture soit une URL signée/publique OU un simple chemin (cas
// des affaires créées sur un autre appareil : le cache local ne garde que le chemin, l'URL signée
// n'arrive qu'après le serveur → c'étaient « les deux dernières affaires » qui chargeaient après).
const OBJ_RE = /\/storage\/v1\/object\/(?:sign|public)\/photos\/([^?]+)/;
export function coverCacheKey(photo) {
  if (typeof photo !== 'string' || !photo) return null;
  const signed = photoPathFromUrl(photo);
  if (signed) return signed;
  const m = photo.match(OBJ_RE);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return null; } }
  if (isStoragePath(photo)) return photo.replace(/^\/+/, '').split('?')[0];
  return null;
}
// Simple chemin du bucket (ni URL, ni data:/blob:) : pas affichable tel quel par le navigateur.
export function isStoragePath(photo) {
  return typeof photo === 'string' && !!photo && !/^(data:|blob:|https?:|\/\/)/i.test(photo);
}
export function coverCacheReady() { return _loaded; }
export function whenCoverCacheReady() { return _loadPromise; }
export function peekCover(key) { return key ? (_mem.get(key) || null) : null; }
export function onCoverCache(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

// Dernière couverture connue d'un projet (copie locale), ou null.
export function peekProjectCover(pid) {
  const k = pid ? _byPid.get(pid) : null;
  return k ? (_mem.get(k) || null) : null;
}
// Une couverture déjà gardée s'affiche pour ce projet → on mémorise le lien (une fois).
export function linkCoverToProject(key, pid) {
  if (!key || !pid || !_mem.has(key) || _byPid.get(pid) === key) return;
  _byPid.set(pid, key);
  persist(key, pid);
}
// Couvertures relues du serveur : une affaire SANS couverture ne doit plus montrer d'ancienne copie.
export function markCoverPhotosSettled() {
  if (_photosSettled) return;
  _photosSettled = true;
  notify();
}
export function coverPhotosSettled() { return _photosSettled; }

// MÉMOIRE (incident 20/10 : page blanche juste après la 1re mise en ligne) : chaque copie demande
// de décoder l'image. Faites TOUTES EN MÊME TEMPS (une par carte, archives comprises) et sur des
// couvertures lourdes (PNG iPhone, photos 12 Mpx), ça pouvait représenter des centaines de Mo d'un
// coup → iOS tue la page. Désormais : UNE copie à la fois, après le démarrage.
// Retour Thomas 20/10 : Rue de Cléry / Pouvelle toujours lentes — leurs couvertures (PNG iPhone de
// plusieurs Mo) dépassaient l'ancien plafond de 2 Mo → jamais gardées → réseau à CHAQUE ouverture.
// Plafond relevé (toujours une seule image à la fois) ; les gros fichiers sont décodés directement
// en petit quand le navigateur sait le faire (createImageBitmap + resizeWidth) → mémoire contenue.
const MAX_BLOB_BYTES = 30 * 1024 * 1024;
const BIG_BLOB_BYTES = 1.5 * 1024 * 1024;
const _queue = [];
let _running = false;
function pump() {
  if (_running) return;
  const job = _queue.shift();
  if (!job) return;
  _running = true;
  setTimeout(() => { job().finally(() => { _running = false; pump(); }); }, 250);
}

// Image chargée avec succès à l'écran → on en garde une petite copie locale (une fois par fichier).
export function rememberCover(key, url, pid = null) {
  if (_mem.has(key)) { linkCoverToProject(key, pid); return; }
  if (!key || !url || _mem.has(key) || _inflight.has(key) || typeof url !== 'string' || url.startsWith('data:')) return;
  _inflight.add(key);
  _queue.push(async () => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const len = Number(resp.headers.get('content-length')) || 0;
      if (len > MAX_BLOB_BYTES) return;
      const blob = await resp.blob();
      if (blob.size > MAX_BLOB_BYTES) return;
      let src = null, w = 0, h = 0, close = () => {};
      if (typeof createImageBitmap === 'function') {
        const tries = blob.size > BIG_BLOB_BYTES ? [{ resizeWidth: WIDTH, resizeQuality: 'medium' }, undefined] : [undefined];
        for (const opt of tries) {
          try {
            const bm = opt ? await createImageBitmap(blob, opt) : await createImageBitmap(blob);
            src = bm; w = bm.width; h = bm.height; close = () => { try { bm.close(); } catch { /* ignore */ } };
            break;
          } catch { /* option non gérée / format → essai suivant, puis repli <img> */ }
        }
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
      if (pid) _byPid.set(pid, key);
      persist(key, pid);
      notify(); // les cartes qui attendaient cette copie (même projet) la prennent tout de suite
    } catch { /* ignoré : affichage réseau comme avant */ }
    finally { _inflight.delete(key); }
  });
  pump();
}

// Copie locale illisible → on l'oublie (la carte repasse sur le réseau, comme avant).
export function forgetCover(key) {
  if (!key) return;
  _mem.delete(key);
  for (const [pid, k] of _byPid) if (k === key) _byPid.delete(pid);
  openDb().then((db) => { if (db) { try { db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key); } catch { /* ignoré */ } } });
}

// Déconnexion : rien ne doit rester d'un compte à l'autre.
export function clearCoverCache() {
  _mem.clear();
  _byPid.clear();
  openDb().then((db) => { if (db) { try { db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch { /* ignoré */ } } });
}
