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
import { invalidateUrls, setCachedUrls } from './urlCache.js';
import { logWarn } from './logger.js';

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

// allowPath (couvertures de l'accueil uniquement) : accepte aussi un SIMPLE chemin du bucket
// (« affaire_ab12/cover/c123.webp »). La carte signe alors elle-même sa vignette, sans attendre
// la signature groupée des couvertures (retour Thomas 20/10 : « Rue de Cléry / Pouvelle ne
// chargent même plus » — si cette signature groupée échoue, la carte restait sur l'icône).
function photoPathOf(src, allowPath = false) {
  const p = photoPathFromUrl(src);
  if (p || !allowPath) return p;
  if (typeof src !== 'string' || !src || /^(data:|blob:|https?:|\/)/i.test(src)) return null;
  return src.split('?')[0];
}

export function thumbKey(src, width, allowPath = false) {
  const path = photoPathOf(src, allowPath);
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
export async function getThumbUrl(src, width, allowPath = false) {
  const key = thumbKey(src, width, allowPath);
  if (!key || _off || _bad.has(key)) return null;
  await loadThumbCache();
  const hit = peekThumb(key);
  if (hit) return hit;
  if (_pending.has(key)) return _pending.get(key);
  const path = photoPathOf(src, allowPath);
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

// Simple chemin du bucket (pas une URL) : le navigateur ne sait pas l'afficher tel quel.
export function isPlainPath(src) {
  return typeof src === 'string' && !!src && !/^(data:|blob:|https?:|\/)/i.test(src);
}

// URL signée de l'ORIGINAL (sans transformation) d'un simple chemin — repli des couvertures quand
// la vignette échoue alors que l'URL signée groupée n'est pas (encore) arrivée : avant, la carte
// restait sur l'icône pour toujours (retour Thomas 21/10, Rue de Cléry / Pouvelle). Indépendant
// de la coupure des transformations (_off) : c'est une signature classique.
export async function getSignedOriginal(src) {
  if (!isPlainPath(src)) return null;
  const path = src.split('?')[0];
  const key = `${path}@orig`;
  await loadThumbCache();
  const e = _mem.get(key);
  if (e && e.exp - SAFETY_MS > Date.now()) return e.url;
  if (_pending.has(key)) return _pending.get(key);
  const p = runQueued(async () => {
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.storage.from('photos').createSignedUrl(path, TTL_SEC);
      if (error || !data?.signedUrl) { console.warn('[cover] signature de l\'original impossible', path, error?.message || ''); return null; }
      const entry = { url: data.signedUrl, exp: Date.now() + TTL_SEC * 1000 };
      _mem.set(key, entry);
      persist(key, entry);
      return entry.url;
    } catch { return null; }
  }).finally(() => _pending.delete(key));
  _pending.set(key, p);
  return p;
}

// ── AUTO-RÉPARATION d'une image qui ne charge plus (retour Thomas 26/10 : « ça marche, puis ça finit
// toujours par ne plus marcher », couvertures puis photos) ──────────────────────────────────────
// Un échec de chargement laissait l'icône pour toute la session, et les liens signés gardés en
// cache (30 j : urlCache, vignettes, original) étaient resservis tels quels au démarrage suivant.
// Désormais : on JETTE tous les liens en cache de ce fichier, on en redemande un NEUF à Supabase et
// on réessaie (3 fois max par fichier et par session, en espaçant). Rien n'est écrit en base.
export function healPathOf(src) { return photoPathOf(src, true); }

export async function resignFresh(path) {
  if (!path) return null;
  try {
    for (const k of [..._mem.keys()]) if (k.startsWith(`${path}@`)) forget(k);
    for (const k of [..._bad]) if (k.startsWith(`${path}@`)) _bad.delete(k);
    invalidateUrls([path]);
    const sb = await getSupabase();
    const { data, error } = await sb.storage.from('photos').createSignedUrl(path, TTL_SEC);
    if (error || !data?.signedUrl) {
      console.warn('[photo] nouvelle signature impossible', path, error?.message || '');
      logWarn('photo.resignFailed', { path, error: error?.message || null });
      return null;
    }
    const entry = { url: data.signedUrl, exp: Date.now() + TTL_SEC * 1000 };
    _mem.set(`${path}@orig`, entry);
    persist(`${path}@orig`, entry);
    setCachedUrls({ [path]: data.signedUrl }, TTL_SEC);
    return data.signedUrl;
  } catch (e) { console.warn('[photo] nouvelle signature impossible', path, e?.message || e); return null; }
}

// Diagnostic : code HTTP réel de l'image en échec (console F12 + logs serveur).
export function probeFailedUrl(url, path) {
  if (typeof url !== 'string' || !/^https?:/i.test(url)) return;
  fetch(url, { headers: { Range: 'bytes=0-0' } }).then(async (r) => {
    if (r.ok) return; // passager (l'image se recharge bien maintenant)
    const body = (await r.text().catch(() => '')).slice(0, 200);
    console.warn('[photo] chargement refusé par le serveur', r.status, path, body);
    logWarn('photo.loadFailed', { status: r.status, path, body });
  }).catch((e) => {
    console.warn('[photo] chargement impossible (réseau)', path, e?.message || e);
    logWarn('photo.loadFailed', { status: 0, path, error: String(e?.message || e) });
  });
}

const _healCount = new Map(); // chemin → tentatives cette session
export const HEAL_DELAYS = [1000, 3000, 10000];
// → délai avant la tentative suivante, ou null si plus de tentative pour ce fichier.
export function nextHealDelay(path) {
  const n = _healCount.get(path) || 0;
  if (n >= HEAL_DELAYS.length) return null;
  _healCount.set(path, n + 1);
  return HEAL_DELAYS[n];
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
  _mem.clear(); _pending.clear(); _bad.clear(); _healCount.clear();
  _fails = 0; _off = false;
  _loadPromise = null; _loaded = false; _dbPromise = null;
  _active = 0; _queue.length = 0;
}
