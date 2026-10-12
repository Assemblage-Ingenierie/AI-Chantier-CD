// VIGNETTES ALLÉGÉES des photos (demande Thomas : « accélère le chargement des photos »).
//
// Pourquoi : les listes (observations, couvertures, bandeaux de miniatures) affichaient chaque
// photo en PLEINE résolution (~1600 px, 200-400 Ko) alors qu'elle occupe 150-350 px à l'écran.
// Une visite de 60 photos = ~15 Mo à télécharger → cases grises interminables sur 4G.
// Supabase (plan Pro) sait servir une version redimensionnée à la volée (Image Transformations) :
// ~30-50 Ko au lieu de ~300 Ko → 6 à 10× moins de données pour les listes.
//
// Périmètre : AFFICHAGE uniquement. Rien n'est écrit dans les projets, la sauvegarde, ni le
// bucket. Le visualiseur plein écran, l'annotateur et l'export PDF gardent l'original.
//
// Robustesse (zéro régression) :
//   - seules les URL signées du bucket `photos` sont concernées ; data:/blob:/autres → inchangées ;
//   - échec de signature ou de chargement de la vignette → repli sur l'ORIGINAL (comme avant) ;
//   - si les transformations sont indisponibles (désactivées, quota…) : après quelques échecs
//     d'affilée, on coupe pour la session → retour au comportement d'avant ;
//   - les URL signées des vignettes sont mémorisées 30 jours (IndexedDB, hors quota
//     localStorage) → même URL d'une session à l'autre = cache navigateur = affichage instantané.

import { getSupabase } from '../supabase.js';

const TTL_SEC = 2592000;                     // 30 jours, comme les photos (SIGNED_URL_TTL)
const SAFETY_MS = 24 * 60 * 60 * 1000;       // re-signe 24 h avant expiration
const QUALITY = 70;
const MAX_CONCURRENT = 8;                    // signatures en parallèle
const MAX_ENTRIES = 5000;
const OFF_AFTER_FAILS = 4;                   // échecs d'affilée → transformations coupées (session)
const DB_NAME = 'chantierai_thumbs';
const STORE = 'urls';

const SIGN_RE = /\/storage\/v1\/object\/sign\/photos\/([^?]+)/;

// Chemin Storage d'une URL signée du bucket photos, ou null si non éligible.
export function photoPathFromUrl(src) {
  if (typeof src !== 'string' || !src.startsWith('http')) return null;
  const m = src.match(SIGN_RE);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

export function thumbKey(src, width) {
  const path = photoPathFromUrl(src);
  return path && width ? `${path}@w${width}` : null;
}

// ── Cache mémoire + persistance IndexedDB ──
const _mem = new Map();      // key → { url, exp }
const _pending = new Map();  // key → Promise<url|null>
const _bad = new Set();      // vignettes en échec cette session → original
let _fails = 0, _off = false; // _fails = échecs CONSÉCUTIFS (remis à 0 à chaque succès)
let _dbPromise = null, _loadPromise = null, _loaded = false;

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
    } catch { resolve(null); }
  });
  return _dbPromise;
}

// Charge le cache persistant UNE fois (une seule lecture getAll) et purge l'expiré / le surplus.
export function loadThumbCache() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const db = await openDb();
    if (!db) { _loaded = true; return; }
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const now = Date.now();
          const rows = (req.result || []).filter(r => r && r.k && r.url);
          const alive = rows.filter(r => r.exp > now).sort((a, b) => b.exp - a.exp);
          alive.slice(0, MAX_ENTRIES).forEach(r => { if (!_mem.has(r.k)) _mem.set(r.k, { url: r.url, exp: r.exp }); });
          const keep = new Set(alive.slice(0, MAX_ENTRIES).map(r => r.k));
          rows.forEach(r => { if (!keep.has(r.k)) store.delete(r.k); });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch { resolve(); }
    });
    _loaded = true;
  })();
  return _loadPromise;
}

function persist(key, entry) {
  openDb().then((db) => {
    if (!db) return;
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).put({ k: key, ...entry }); } catch { /* ignoré */ }
  });
}

function forget(key) {
  _mem.delete(key);
  openDb().then((db) => {
    if (!db) return;
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key); } catch { /* ignoré */ }
  });
}

export function thumbsDisabled() { return _off; }
export function isCacheLoaded() { return _loaded; }

// Lecture SYNCHRONE : URL de vignette valide déjà connue, sinon null.
export function peekThumb(key) {
  if (!key || _off || _bad.has(key)) return null;
  const e = _mem.get(key);
  return e && e.exp - SAFETY_MS > Date.now() ? e.url : null;
}

// ── File de signatures (limite le nombre de requêtes simultanées) ──
let _active = 0;
const _queue = [];
function runQueued(fn) {
  return new Promise((resolve) => {
    const start = () => {
      _active++;
      Promise.resolve().then(fn).then(resolve, () => resolve(null)).finally(() => {
        _active--;
        const next = _queue.shift();
        if (next) next();
      });
    };
    if (_active < MAX_CONCURRENT) start(); else _queue.push(start);
  });
}

function noteFail() {
  _fails++;
  if (_fails >= OFF_AFTER_FAILS) _off = true;
}

// URL signée de la vignette (width px, ratio conservé) — null si indisponible (→ original).
export async function getThumbUrl(src, width) {
  const key = thumbKey(src, width);
  if (!key || _off || _bad.has(key)) return null;
  await loadThumbCache();
  const hit = peekThumb(key);
  if (hit) return hit;
  if (_pending.has(key)) return _pending.get(key);
  const path = photoPathFromUrl(src);
  const p = runQueued(async () => {
    if (_off) return null;
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.storage.from('photos')
        .createSignedUrl(path, TTL_SEC, { transform: { width, quality: QUALITY } });
      if (error || !data?.signedUrl) { noteFail(); return null; }
      const entry = { url: data.signedUrl, exp: Date.now() + TTL_SEC * 1000 };
      _mem.set(key, entry);
      persist(key, entry);
      return entry.url;
    } catch { noteFail(); return null; }
  }).finally(() => _pending.delete(key));
  _pending.set(key, p);
  return p;
}

// Retours d'affichage du composant <img> : succès (la vignette s'est chargée) / échec.
export function reportThumbOk() { _fails = 0; }
export function reportThumbError(key) {
  if (!key) return;
  _bad.add(key);
  forget(key);
  noteFail();
}

// Tests uniquement.
export function _resetThumbsForTests() {
  _mem.clear(); _pending.clear(); _bad.clear();
  _fails = 0; _off = false;
  _loadPromise = null; _loaded = false; _dbPromise = null;
  _active = 0; _queue.length = 0;
}
