// Bibliothèque de RÉCUPÉRATION des observations supprimées (demande Thomas).
//
// Pourquoi : une observation supprimée (par erreur, ou « ressuscitée » puis re-supprimée)
// doit pouvoir être RÉCUPÉRÉE. On copie donc chaque observation supprimée — AVEC ses photos,
// son texte et son contexte (projet / visite / zone) — dans une base IndexedDB DÉDIÉE. Un
// panneau « Récupération » permet de la restaurer en 1 clic, ou de vider la liste à la main.
//
// 100 % ADDITIF : rien dans le flux de sync ne lit ni n'écrit cette base. En l'absence
// d'IndexedDB (navigation privée iOS…), toutes les fonctions retombent sur un no-op silencieux
// — zéro impact sur l'existant.

const DB_NAME = 'chantierai_recovery';
const STORE   = 'deleted_items';
const VERSION = 1;
const MAX_ENTRIES = 300; // rotation : garde les 300 suppressions les plus récentes (vidage manuel sinon)
// Signal « du nouveau dans la corbeille » (alerte de l'icône, cf. trashBadge.js).
const notifyChanged = () => { try { window.dispatchEvent(new Event('chantierai:recovery-bin')); } catch { /* hors navigateur */ } };

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'recId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
  return _dbPromise;
}

// Enregistre une observation supprimée. `ctx` = { projectId, projectNom, visiteId, locId, locNom }.
// L'item COMPLET (texte + photos + annotations) est conservé tel quel pour une restauration fidèle.
// Ne rejette jamais. Effectue la rotation (garde les MAX_ENTRIES plus récents).
export async function addDeletedItem(item, ctx = {}) {
  if (!item) return;
  const db = await openDb();
  if (!db) return;
  const ts = Date.now();
  const entry = {
    recId: `${ts}_${Math.random().toString(36).slice(2, 8)}`,
    ts,
    deletedAt: new Date(ts).toISOString(),
    projectId: ctx.projectId ?? null,
    projectNom: ctx.projectNom ?? '',
    visiteId: ctx.visiteId ?? null,
    locId: ctx.locId ?? null,
    locNom: ctx.locNom ?? '',
    item,
  };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(entry);
      // Rotation : au-delà de MAX_ENTRIES, supprimer les plus anciens (recId commence par le ts).
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = keysReq.result || [];
        if (keys.length > MAX_ENTRIES) {
          keys.sort(); // recId = `${ts}_...` → ordre lexicographique ≈ chronologique
          const toDelete = keys.slice(0, keys.length - MAX_ENTRIES);
          for (const k of toDelete) store.delete(k);
        }
      };
      tx.oncomplete = () => { notifyChanged(); resolve(); };
      tx.onerror    = () => resolve();
      tx.onabort    = () => resolve();
    } catch { resolve(); }
  });
}

// ZONE supprimée (ou fusionnée dans une autre) : copie COMPLÈTE de la zone — observations, photos,
// plans et annotations — pour pouvoir la remettre telle quelle (corbeille par projet, Thomas
// 13/10/2026). `ctx` = { projectId, projectNom, visiteId, reason: 'suppression'|'fusion',
// mergedInto: { id, nom }, index }. Même base que les observations (champ kind: 'loc').
export async function addDeletedZone(loc, ctx = {}) {
  if (!loc?.id) return;
  const db = await openDb();
  if (!db) return;
  const ts = Date.now();
  const entry = {
    recId: `${ts}_${Math.random().toString(36).slice(2, 8)}`,
    ts,
    deletedAt: new Date(ts).toISOString(),
    kind: 'loc',
    reason: ctx.reason === 'fusion' ? 'fusion' : 'suppression',
    projectId: ctx.projectId ?? null,
    projectNom: ctx.projectNom ?? '',
    visiteId: ctx.visiteId ?? null,
    locId: loc.id,
    locNom: loc.nom ?? '',
    mergedInto: ctx.mergedInto ?? null,
    index: ctx.index ?? null,
    loc,
  };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => { notifyChanged(); resolve(); };
      tx.onerror    = () => resolve();
      tx.onabort    = () => resolve();
    } catch { resolve(); }
  });
}

// Liste toutes les observations supprimées, la plus récente d'abord.
export async function listDeletedItems() {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.ts - a.ts));
      req.onerror   = () => resolve([]);
      tx.onerror    = () => resolve([]);
    } catch { resolve([]); }
  });
}

// Nombre d'observations récupérables (pour le badge Paramètres).
export async function countDeletedItems() {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror   = () => resolve(0);
    } catch { resolve(0); }
  });
}

// Retire une entrée (après restauration réussie, ou suppression définitive d'une seule).
export async function removeDeletedItem(recId) {
  if (!recId) return;
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(recId);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
      tx.onabort    = () => resolve();
    } catch { resolve(); }
  });
}

// Vide TOUTE la bibliothèque de récupération (action manuelle « Vider »).
export async function clearDeletedItems() {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
      tx.onabort    = () => resolve();
    } catch { resolve(); }
  });
}
