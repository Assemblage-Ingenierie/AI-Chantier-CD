import { getSupabase } from '../supabase.js';

const DRIVE_QUEUE_KEY = '_chantierai_drive_queue';
const MAX_QUEUE = 15;

// Numéro d'affaire (ex. « A696 ») utilisé pour retrouver le dossier Drive de l'affaire. Le numéro
// n'est PAS déduit du nom du projet (qui peut être renommé et perdre le « Axxx ») : on le stocke à
// part, par projet, et on l'envoie explicitement à l'API Drive. Stockage local (pas de colonne
// Supabase) → défini sur l'appareil qui prend les photos, ce qui suffit à l'upload. (Retour Bach :
// « Pavillon sous toit » renommé → l'app ne retrouvait plus le numéro → photos non uploadées.)
const AFFNUM_PREFIX = 'chantierai_affnum_';
export function getAffaireNum(projetId) {
  if (!projetId) return '';
  try { return (localStorage.getItem(AFFNUM_PREFIX + projetId) || '').trim(); } catch { return ''; }
}
export function setAffaireNum(projetId, val) {
  if (!projetId) return;
  try {
    const v = (val || '').trim();
    if (v) localStorage.setItem(AFFNUM_PREFIX + projetId, v);
    else localStorage.removeItem(AFFNUM_PREFIX + projetId);
  } catch { /* localStorage indisponible */ }
}

async function driveUploadAttempt({ data, name, projetNom, projetNum, visiteLabel, visiteDate, ingenieur, replace }) {
  const [header, base64] = data.split(',');
  const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  // Jeton Supabase (l'endpoint exige désormais un utilisateur connecté). Récupéré à CHAQUE
  // tentative → toujours frais, y compris lors des retries de la file d'attente.
  let token = '';
  try { const sb = await getSupabase(); const { data: { session } } = await sb.auth.getSession(); token = session?.access_token || ''; } catch { /* pas de session → 401 côté serveur, remis en file */ }
  const res = await fetch('/api/drive-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ base64, mimeType, fileName: name, projetNom, projetNum, visiteLabel, visiteDate, ingenieur, ...(replace ? { replace: true } : {}) }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── FILE D'ATTENTE DRIVE (retour Thomas 26/11 : « ça n'a pas enregistré les photos dans mon
// Drive, cata ») ─────────────────────────────────────────────────────────────────────────────
// Avant : une photo qui n'arrivait pas à partir (réseau faible sur site) était mise en attente
// dans localStorage, plafonné à ~5 Mo et 15 photos → au-delà de quelques photos, les suivantes
// étaient ABANDONNÉES sans rien dire. Et une photo en cours d'envoi quand l'app passait en
// arrière-plan était perdue (rien n'était écrit avant l'envoi).
// Désormais : chaque envoi est d'abord INSCRIT dans IndexedDB (pas de limite pratique), puis
// tenté ; il n'est retiré qu'une fois réussi. La file est vidée au démarrage, au retour du réseau
// et à chaque retour au premier plan. IndexedDB indisponible (navigation privée) → ancienne
// méthode (localStorage), inchangée.
const IDB_NAME = 'chantierai_drive';
const IDB_STORE = 'queue';
const MAX_IDB = 500;
let _db = null;
function openIdb() {
  if (_db) return _db;
  _db = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return _db;
}
function idb(mode, fn) {
  return openIdb().then(d => new Promise((resolve) => {
    if (!d) { resolve(undefined); return; }
    try {
      const r = fn(d.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
      r.onsuccess = () => resolve(r.result === undefined ? true : r.result);
      r.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  }));
}
const _inflight = new Set(); // envois en cours dans uploadToDrive : la file ne les renvoie pas (pas de doublon)
const newKey = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function legacyQueue(item) {
  try {
    const stored = localStorage.getItem(DRIVE_QUEUE_KEY);
    const queue = stored ? JSON.parse(stored) : [];
    if (queue.length < MAX_QUEUE) {
      queue.push({ ...item, _ts: Date.now() });
      localStorage.setItem(DRIVE_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch { /* localStorage plein ou indisponible */ }
}

export async function uploadToDrive(item) {
  // 1) Inscrit AVANT d'envoyer : si l'app est fermée ou mise en arrière-plan pendant l'envoi, la
  //    photo repartira au prochain lancement.
  const key = newKey();
  const count = await idb('readonly', st => st.count());
  const saved = typeof count === 'number' && count < MAX_IDB
    ? await idb('readwrite', st => st.put({ ...item, _ts: Date.now() }, key))
    : undefined;
  // 2) Envoi immédiat (3 essais rapprochés).
  _inflight.add(key);
  try {
    for (const delay of [0, 2000, 5000]) {
      try {
        if (delay) await new Promise(r => setTimeout(r, delay));
        await driveUploadAttempt(item);
        if (saved) await idb('readwrite', st => st.delete(key));
        return;
      } catch { /* essai suivant */ }
    }
  } finally { _inflight.delete(key); }
  // 3) Échec : la photo reste dans la file IndexedDB (ou, sans IndexedDB, ancienne file).
  if (!saved) legacyQueue(item);
}

let _draining = false;
export async function processDriveQueue() {
  if (_draining) return;
  _draining = true;
  try {
    // Ancienne file (localStorage) : reprise dans IndexedDB si possible.
    try {
      const stored = localStorage.getItem(DRIVE_QUEUE_KEY);
      const queue = stored ? JSON.parse(stored) : [];
      if (queue.length && await openIdb()) {
        for (const it of queue) await idb('readwrite', st => st.put(it, newKey()));
        localStorage.removeItem(DRIVE_QUEUE_KEY);
      } else if (queue.length) {
        const remaining = [];
        for (const it of queue) { try { await driveUploadAttempt(it); } catch { remaining.push(it); } }
        localStorage.setItem(DRIVE_QUEUE_KEY, JSON.stringify(remaining));
      }
    } catch { /* ignore */ }
    const keys = (await idb('readonly', st => st.getAllKeys())) || [];
    let fails = 0;
    for (const k of keys) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
      if (_inflight.has(k)) continue;
      const it = await idb('readonly', st => st.get(k));
      if (!it || it === true) { await idb('readwrite', st => st.delete(k)); continue; }
      try { await driveUploadAttempt(it); await idb('readwrite', st => st.delete(k)); fails = 0; }
      catch { if (++fails >= 3) break; } // réseau encore mauvais : on réessaiera plus tard
    }
  } finally { _draining = false; }
}

// Nombre de fichiers en attente d'envoi vers le Drive (affichage).
export async function pendingDriveCount() {
  const n = await idb('readonly', st => st.count());
  return typeof n === 'number' ? n : 0;
}
