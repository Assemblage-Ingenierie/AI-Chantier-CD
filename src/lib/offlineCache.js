// Cache HORS-LIGNE des photos (octets) + préférences par projet.
//
// Pourquoi : le Service Worker n'intercepte volontairement pas Supabase (les photos sont
// servies par des URLs signées, cross-origin) → sans cache dédié, AUCUNE photo n'est
// visible sans réseau. Ce module stocke les octets (data URL) en IndexedDB, clé = _id de
// la photo (id de ligne DB, stable à travers les sessions).
//
// Utilisé par le pré-téléchargement automatique des projets de l'ingénieur (« Mes projets »)
// et par le repli de chargement quand le réseau est absent.
//
// Sécurité : purement additif, ne touche jamais aux données serveur. Sans IndexedDB
// (mode privé iOS…), toutes les fonctions retombent silencieusement en no-op.

const DB_NAME = 'chantierai_offline';
const STORE   = 'photos'; // clé: photoId (_id) — valeur: { data, projectId, ts }
const VERSION = 1;

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const st = db.createObjectStore(STORE);
          st.createIndex('byProject', 'projectId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
  return _dbPromise;
}

// ── Octets photos ────────────────────────────────────────────────────────────

// Retourne { photoId: dataUrl } pour les ids présents en cache (les absents sont omis).
export async function getCachedPhotoData(photoIds) {
  if (!photoIds?.length) return {};
  const db = await openDb();
  if (!db) return {};
  return new Promise((resolve) => {
    const out = {};
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      let pending = photoIds.length;
      photoIds.forEach((id) => {
        const r = store.get(id);
        r.onsuccess = () => { if (r.result?.data) out[id] = r.result.data; if (--pending === 0) resolve(out); };
        r.onerror   = () => { if (--pending === 0) resolve(out); };
      });
      tx.onerror = () => resolve(out);
    } catch { resolve(out); }
  });
}

// Ids déjà en cache parmi ceux fournis (pour éviter les re-téléchargements).
export async function getCachedPhotoIds(photoIds) {
  const found = await getCachedPhotoData(photoIds);
  return new Set(Object.keys(found));
}

// Écrit une photo en cache. Ne rejette jamais.
export async function cachePhoto(photoId, projectId, dataUrl) {
  if (!photoId || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return;
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ data: dataUrl, projectId: projectId || null, ts: Date.now() }, photoId);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
      tx.onabort    = () => resolve();
    } catch { resolve(); }
  });
}

// Poids du cache photos par projet, en octets : { projectId: bytes }.
export async function estimateOfflineBytesByProject() {
  const db = await openDb();
  if (!db) return {};
  return new Promise((resolve) => {
    const out = {};
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        for (const v of (req.result || [])) {
          const pid = v?.projectId || '_autres';
          out[pid] = (out[pid] || 0) + (typeof v?.data === 'string' ? v.data.length : 0);
        }
        resolve(out);
      };
      req.onerror = () => resolve(out);
    } catch { resolve(out); }
  });
}

// Purge le cache photos d'UN projet (archivage, switch désactivé). SANS RISQUE : tout est
// re-téléchargeable depuis Supabase Storage — aucune donnée serveur touchée.
export async function purgeProjectOffline(projectId) {
  if (!projectId) return;
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const idx = tx.objectStore(STORE).index('byProject');
      const req = idx.openCursor(IDBKeyRange.only(projectId));
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { cur.delete(); cur.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
      tx.onabort    = () => resolve();
    } catch { resolve(); }
  });
}

// ── Préférences hors-ligne par projet ───────────────────────────────────────
// Par défaut TOUT projet « à moi » est pré-téléchargé ; on ne stocke que les OPT-OUT.

const PREFS_KEY = '_ai_offline_prefs_v1';

function readPrefs() {
  try { const o = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; }
  catch { return {}; }
}

export function isProjectOfflineEnabled(projectId) {
  return readPrefs()[projectId] !== false;
}

export function setProjectOfflineEnabled(projectId, enabled) {
  try {
    const prefs = readPrefs();
    if (enabled) delete prefs[projectId];
    else prefs[projectId] = false;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

// ── Téléchargement ───────────────────────────────────────────────────────────

// Récupère une URL (signée Supabase) et la convertit en data URL. null si échec.
export async function fetchAsDataUrl(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(typeof fr.result === 'string' ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}
