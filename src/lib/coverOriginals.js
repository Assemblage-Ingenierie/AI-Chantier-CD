// Originaux des photos de couverture de projet (IndexedDB, clé = id projet).
//
// Pourquoi : le recadrage de la tuile/page de garde produit des images CROPPÉES ;
// sans l'original, « Recadrer » plus tard ne peut que re-couper dans le crop —
// impossible de « dé-recadrer » (demande Thomas). On conserve donc l'image source
// (compressée raisonnablement) en local, par projet.
//
// Défensif : sans IndexedDB (mode privé iOS…), toutes les fonctions sont des no-op —
// le recadrage retombe alors sur l'image croppée courante, comme avant.

const DB_NAME = 'chantierai_covers';
const STORE   = 'originals';

let _dbPromise = null;
function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
  return _dbPromise;
}

export async function getCoverOriginal(projectId) {
  if (!projectId) return null;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(projectId);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function setCoverOriginal(projectId, dataUrl) {
  if (!projectId || typeof dataUrl !== 'string' || !dataUrl) return;
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(dataUrl, projectId);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
      tx.onabort    = () => resolve();
    } catch { resolve(); }
  });
}

// Compresse un fichier image en data URL (côté long ≤ maxDim, JPEG q). Pour stocker
// l'original sans exploser le quota (une photo 12 Mpx ≈ 1-2 Mo après compression).
export function fileToCompressedDataUrl(file, maxDim = 2400, quality = 0.88) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
          const cv = document.createElement('canvas');
          cv.width  = Math.round(img.naturalWidth * scale);
          cv.height = Math.round(img.naturalHeight * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', quality));
        } catch { resolve(null); }
        URL.revokeObjectURL(url);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch { resolve(null); }
  });
}
