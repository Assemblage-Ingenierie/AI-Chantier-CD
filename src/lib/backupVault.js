// Boîte noire de sauvegarde — filet de sécurité INDÉPENDANT du pipeline de sync.
//
// Pourquoi : la chaîne normale (localStorage `chantierai_v12` → Supabase) peut perdre
// des données dans deux cas réels :
//   1. localStorage déborde silencieusement (quota ~5 Mo) sur un gros projet →
//      `saveLocalCache` avale l'erreur → le cache reste périmé.
//   2. Une modif locale non synchronisée se fait écraser par `mergeWithLocal` au
//      rechargement (remote vu comme « plus récent »), qui réécrit ensuite le cache.
//   Dans les deux cas le travail tapé (titres, commentaires, structure) disparaît.
//
// Cette boîte noire écrit un instantané COMPLET horodaté dans une base IndexedDB
// DÉDIÉE (quota en Go), que rien dans le flux de sync ne touche ni n'écrase. Elle ne
// sert qu'à détecter une perte au chargement et à proposer une restauration manuelle.
//
// Sécurité : 100 % additif. En l'absence d'IndexedDB (mode privé iOS, etc.), toutes
// les fonctions retombent silencieusement sur un no-op — aucun impact sur l'existant.

const DB_NAME = 'chantierai_backup';
const STORE   = 'snapshots';
const VERSION = 1;
const MAX_SNAPSHOTS = 60; // rotation : on garde les 60 derniers instantanés

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'ts' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
  return _dbPromise;
}

// Supprime les gros blobs base64 (photos, fonds de plan, images HD) tout en conservant
// l'INTÉGRALITÉ du texte et de la structure. Les blobs sont déjà dans Supabase Storage ;
// ce qui est irremplaçable, c'est le travail tapé (titres, commentaires, localisations…).
function stripBlobs(value) {
  if (typeof value === 'string') {
    return value.startsWith('data:') && value.length > 256 ? null : value;
  }
  if (Array.isArray(value)) return value.map(stripBlobs);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = stripBlobs(value[k]);
    return out;
  }
  return value;
}

// Indicateurs de « poids de contenu » par projet — sert à détecter une perte.
// On ne compte que le travail tapé (texte + structure), jamais les blobs.
export function contentWeight(projets) {
  const byId = {};
  let total = 0;
  for (const p of (projets || [])) {
    if (!p?.id) continue;
    let items = 0, locs = 0, visites = 0, textLen = 0;
    textLen += (p.nom || '').length + (p.adresse || '').length + (p.maitreOuvrage || '').length;
    for (const v of (p.visites || [])) {
      visites++;
      textLen += (v.conclusion || '').length;
      for (const l of (v.localisations || [])) {
        locs++;
        textLen += (l.nom || '').length;
        for (const it of (l.items || [])) {
          items++;
          textLen += (it.titre || '').length + (it.commentaire || '').length;
        }
      }
    }
    // score = structure (pondérée) + longueur de texte
    const score = items * 100 + locs * 50 + visites * 20 + textLen;
    byId[p.id] = { score, items, locs, visites, textLen, nom: p.nom || '' };
    total += score;
  }
  return { byId, total };
}

// Enregistre un instantané complet (texte + structure, sans blobs) horodaté.
// Ne rejette jamais. Effectue la rotation (garde les MAX_SNAPSHOTS plus récents).
export async function saveSnapshot(projets) {
  if (!Array.isArray(projets) || projets.length === 0) return;
  const db = await openDb();
  if (!db) return;
  const ts = Date.now();
  const snapshot = {
    ts,
    savedAt: new Date(ts).toISOString(),
    weight: contentWeight(projets).total,
    data: stripBlobs(projets),
  };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(snapshot);
      // Rotation : si on dépasse le quota, supprimer les plus anciens.
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = keysReq.result || [];
        if (keys.length > MAX_SNAPSHOTS) {
          keys.sort((a, b) => a - b);
          const toDelete = keys.slice(0, keys.length - MAX_SNAPSHOTS);
          for (const k of toDelete) store.delete(k);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
      tx.onabort    = () => resolve();
    } catch { resolve(); }
  });
}

// Retourne l'instantané le plus récent ({ ts, savedAt, weight, data }) ou null.
export async function getLatestSnapshot() {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      // Curseur en ordre décroissant → première entrée = la plus récente.
      const req = store.openCursor(null, 'prev');
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror   = () => resolve(null);
      tx.onerror    = () => resolve(null);
    } catch { resolve(null); }
  });
}

// Liste légère (sans data) de tous les instantanés, plus récent d'abord.
export async function listSnapshots() {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result || [])
          .map(s => ({ ts: s.ts, savedAt: s.savedAt, weight: s.weight }))
          .sort((a, b) => b.ts - a.ts);
        resolve(all);
      };
      req.onerror = () => resolve([]);
      tx.onerror  = () => resolve([]);
    } catch { resolve([]); }
  });
}

// Récupère un instantané précis par son timestamp.
export async function getSnapshot(ts) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(ts);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
}

// Compare un instantané au state chargé. Retourne la liste des projets dont le contenu
// a NETTEMENT diminué (ou disparu) — signal d'une possible perte de données.
// Conservateur : ne signale que les régressions importantes pour éviter les faux positifs
// (un simple ajustement de texte ne déclenche rien).
export function detectLoss(snapshotData, currentProjets) {
  const snap = contentWeight(snapshotData);
  const curr = contentWeight(currentProjets);
  const lost = [];
  for (const [id, s] of Object.entries(snap.byId)) {
    const c = curr.byId[id];
    if (!c) {
      // Projet entièrement absent du state chargé alors qu'il était sauvegardé.
      if (s.score > 0) lost.push({ id, nom: s.nom, before: s, after: null, kind: 'missing' });
      continue;
    }
    // Régression marquée : on a perdu ≥1 item, ou ≥30 % du score, avec un écart absolu réel.
    const dropped = s.score - c.score;
    const lostItems = s.items - c.items;
    if ((lostItems >= 1 || dropped >= s.score * 0.3) && dropped >= 100) {
      lost.push({ id, nom: s.nom, before: s, after: c, kind: 'shrunk' });
    }
  }
  return lost; // [] si aucune perte détectée
}
