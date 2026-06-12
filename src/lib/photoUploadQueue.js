// File d'attente d'upload des photos — fiabilise la synchro téléphone → Supabase Storage.
//
// PROBLÈME RÉSOLU : sur site, les photos n'étaient uploadées que pendant la sauvegarde
// différée, une par une. Dès que l'app passait en arrière-plan (téléphone en poche), iOS
// tuait les uploads en cours → les photos restaient coincées dans le téléphone et
// n'apparaissaient sur le PC qu'après une longue réouverture de l'app mobile.
//
// PRINCIPE :
//   1. Dès la prise de photo, l'image (déjà compressée) est inscrite dans une file
//      IndexedDB ET son upload démarre immédiatement (pool de 3 en parallèle).
//   2. La file SURVIT à la fermeture de l'app : à chaque retour au premier plan,
//      reconnexion réseau ou démarrage, elle se vide automatiquement.
//   3. Une fois le fichier dans Storage, le chemin est mémorisé (store `done`) ;
//      saveRemote le réutilise tel quel au lieu de re-uploader → la sauvegarde
//      normale ne pousse plus que des métadonnées légères.
//   4. Bonus Android : un Background Sync (sw.js) vide la file même app fermée.
//
// SÉCURITÉ : purement additif. Si IndexedDB est indisponible (navigation privée iOS),
// toutes les fonctions sont des no-op silencieux → le flux d'upload existant dans
// saveRemote reste le filet de sécurité. Aucune donnée n'est retirée du téléphone
// tant que l'upload n'a pas réussi.

import { getSupabase } from '../supabase.js';

const DB_NAME = 'chantierai_uploads';
const Q_STORE = 'queue'; // photoUploadId → { id, path, dataUrl, contentType, tries, createdAt }
const D_STORE = 'done';  // photoUploadId → path (uploads confirmés)
const C_STORE = 'cfg';   // '_cfg' → { url, anonKey, accessToken } (pour le Background Sync SW)
const VERSION = 1;
const CONCURRENCY = 3;

let _dbPromise = null;
function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(Q_STORE)) db.createObjectStore(Q_STORE);
        if (!db.objectStoreNames.contains(D_STORE)) db.createObjectStore(D_STORE);
        if (!db.objectStoreNames.contains(C_STORE)) db.createObjectStore(C_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return _dbPromise;
}

function idbReq(store, mode, fn) {
  return openDb().then(db => new Promise((resolve) => {
    if (!db) { resolve(undefined); return; }
    try {
      const tx = db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  }));
}

// Même logique de slug que storage.js (dossier projet : `{slug_nom}_{8chars_id}`).
function slugify(nom) {
  return (nom || 'projet')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'projet';
}

// ── Abonnement au compteur (badge « X photos en attente ») ───────────────────────────
const _subs = new Set();
let _pendingCount = 0;
async function refreshCount() {
  const n = (await idbReq(Q_STORE, 'readonly', s => s.count())) ?? 0;
  if (n !== _pendingCount) {
    _pendingCount = n;
    _subs.forEach(cb => { try { cb(n); } catch {} });
  }
}
export function subscribePendingUploads(cb) {
  _subs.add(cb);
  cb(_pendingCount);
  refreshCount();
  return () => _subs.delete(cb);
}

// ── Enfilage ─────────────────────────────────────────────────────────────────────────
// Appelé à la prise de photo. Calcule le chemin Storage définitif, persiste l'entrée,
// déclenche le drain immédiat et arme le Background Sync (Android).
export function enqueuePhotoUpload({ uploadId, projetNom, projetId, itemId, name, dataUrl }) {
  if (!uploadId || !dataUrl?.startsWith('data:')) return;
  const slug = `${slugify(projetNom)}_${String(projetId || '').slice(0, 8)}`;
  const ext = /^data:image\/webp/.test(dataUrl) ? 'webp' : /^data:image\/png/.test(dataUrl) ? 'png' : 'jpg';
  const contentType = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
  const path = `${slug}/${itemId}/${Date.now()}_q${String(uploadId).slice(0, 8)}.${ext}`;
  const entry = { id: uploadId, path, dataUrl, contentType, name: name || '', tries: 0, createdAt: Date.now() };
  idbReq(Q_STORE, 'readwrite', s => s.put(entry, uploadId)).then(() => {
    refreshCount();
    drainPhotoQueue();
    // Background Sync (Chrome Android) : l'upload pourra se terminer même app fermée.
    try {
      navigator.serviceWorker?.ready?.then(reg => reg.sync?.register('photo-upload')).catch(() => {});
    } catch {}
  });
}

// ── Lecture du résultat (utilisé par saveRemote) ─────────────────────────────────────
// Retourne le chemin Storage si la photo a déjà été uploadée par la file, sinon null.
export function getQueuedUploadPath(uploadId) {
  if (!uploadId) return Promise.resolve(null);
  return idbReq(D_STORE, 'readonly', s => s.get(uploadId)).then(v => v ?? null);
}

// Retire une entrée de la file (ex : saveRemote a uploadé la photo lui-même → éviter
// un second upload concurrent vers un autre chemin).
export function removeQueuedUpload(uploadId) {
  if (!uploadId) return Promise.resolve();
  return idbReq(Q_STORE, 'readwrite', s => s.delete(uploadId)).then(refreshCount);
}

// ── Drain : vide la file avec un pool de 3 uploads parallèles ────────────────────────
let _draining = false;
export async function drainPhotoQueue() {
  if (_draining) return;
  _draining = true;
  try {
    const sb = await getSupabase();
    await persistSwConfig(sb); // toujours rafraîchir le token pour le Background Sync
    const keys = (await idbReq(Q_STORE, 'readonly', s => s.getAllKeys())) || [];
    if (!keys.length) return;

    let idx = 0;
    const worker = async () => {
      while (idx < keys.length) {
        const key = keys[idx++];
        const entry = await idbReq(Q_STORE, 'readonly', s => s.get(key));
        if (!entry) continue;
        // Déjà confirmé (ex : Background Sync passé entre-temps) → juste nettoyer.
        const done = await idbReq(D_STORE, 'readonly', s => s.get(key));
        if (done) { await idbReq(Q_STORE, 'readwrite', s => s.delete(key)); continue; }
        try {
          const blob = await (await fetch(entry.dataUrl)).blob();
          const { error } = await sb.storage.from('photos').upload(entry.path, blob, {
            contentType: entry.contentType, upsert: true, cacheControl: '31536000',
          });
          if (error) throw error;
          await idbReq(D_STORE, 'readwrite', s => s.put(entry.path, key));
          await idbReq(Q_STORE, 'readwrite', s => s.delete(key));
        } catch {
          // Échec (réseau…) : l'entrée reste en file, re-tentée au prochain drain.
          await idbReq(Q_STORE, 'readwrite', s => s.put({ ...entry, tries: (entry.tries || 0) + 1 }, key));
        }
        refreshCount();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch { /* getSupabase indisponible (hors-ligne) → re-tenté plus tard */ }
  finally {
    _draining = false;
    refreshCount();
  }
}

// Config pour le service worker (Background Sync Android) : URL projet + clés.
// Le token d'accès expire (~1h) — on le rafraîchit à chaque drain ; le SW fait de
// son mieux avec le dernier token connu.
async function persistSwConfig(sb) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    let url = null, anonKey = null;
    try { const c = JSON.parse(localStorage.getItem('_sb_cfg') || 'null'); url = c?.url; anonKey = c?.key; } catch {}
    if (!url || !session?.access_token) return;
    await idbReq(C_STORE, 'readwrite', s => s.put({ url, anonKey, accessToken: session.access_token }, '_cfg'));
  } catch {}
}

// Purge des chemins confirmés trop anciens (déjà consommés par saveRemote depuis longtemps).
async function pruneDone() {
  try {
    const keys = (await idbReq(D_STORE, 'readonly', s => s.getAllKeys())) || [];
    if (keys.length <= 500) return;
    for (const k of keys.slice(0, keys.length - 500)) {
      await idbReq(D_STORE, 'readwrite', s => s.delete(k));
    }
  } catch {}
}

// ── Initialisation (appelée une fois au démarrage de l'app) ──────────────────────────
let _inited = false;
export function initPhotoUploadQueue() {
  if (_inited) return;
  _inited = true;
  drainPhotoQueue();
  pruneDone();
  window.addEventListener('online', () => drainPhotoQueue());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') drainPhotoQueue();
  });
}
