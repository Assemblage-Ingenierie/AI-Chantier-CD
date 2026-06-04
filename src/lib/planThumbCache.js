// Cache IndexedDB des vignettes de plans (bg).
//
// Pourquoi : les vignettes de plans sont volumineuses (data URL base64). Le cache
// localStorage (quota ~5 Mo) débordait silencieusement pour les projets à gros plans
// (ex: OGEC) — `localStorage.setItem` échoue sans erreur visible → les vignettes
// n'étaient jamais persistées → re-fetch réseau à CHAQUE session (lenteur + egress).
//
// IndexedDB offre un quota en centaines de Mo / Go selon le navigateur. Les vignettes
// y survivent entre sessions → chargement instantané dès la 2e ouverture, et egress
// fortement réduit. La clé est le planId (UUID, unique tous projets confondus).
//
// Sécurité : purement additif. En cas d'absence d'IndexedDB (mode privé iOS, etc.)
// toutes les fonctions retombent silencieusement sur un no-op → le flux réseau
// existant reste le filet de sécurité.

const DB_NAME = 'chantierai_plans';
const STORE   = 'thumbs';
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
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
  return _dbPromise;
}

// Retourne { planId: bg } pour les ids présents en cache (les absents sont omis).
export async function getPlanThumbs(planIds) {
  if (!planIds?.length) return {};
  const db = await openDb();
  if (!db) return {};
  return new Promise((resolve) => {
    const out = {};
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      let pending = planIds.length;
      planIds.forEach((id) => {
        const r = store.get(id);
        r.onsuccess = () => { if (r.result != null) out[id] = r.result; if (--pending === 0) resolve(out); };
        r.onerror   = () => { if (--pending === 0) resolve(out); };
      });
      tx.onerror = () => resolve(out);
    } catch { resolve(out); }
  });
}

// Écrit { planId: bg } dans le cache (ignore null/vide). Ne rejette jamais.
export async function setPlanThumbs(map) {
  if (!map) return;
  const entries = Object.entries(map).filter(([, bg]) => typeof bg === 'string' && bg);
  if (!entries.length) return;
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [id, bg] of entries) store.put(bg, id);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
      tx.onabort    = () => resolve();
    } catch { resolve(); }
  });
}
