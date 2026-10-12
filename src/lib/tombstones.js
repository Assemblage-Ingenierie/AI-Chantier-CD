// Pierres tombales des ZONES et OBSERVATIONS supprimées — locales ET serveur.
//
// Pourquoi (retour Thomas, 12/10/2026 : « plein de choses que j'ai supprimées sont réapparues ») :
// une suppression n'était mémorisée que sur l'appareil où elle avait été faite. Un autre appareil
// (téléphone, PC, collègue) au cache périmé pouvait renvoyer la zone / l'observation au serveur à
// sa prochaine sauvegarde → résurrection. On partage donc la liste des suppressions via la table
// `aichantier_deleted_entities` (migration 20261012000000), visible de tous les appareils.
//
// Fonctionnement :
//   - addTombstone(kind, id)  : mémo local IMMÉDIAT + file d'envoi au serveur (rejouée si hors ligne).
//   - liftTombstone(id)       : « Annuler » / « Restaurer » → retire le mémo partout (local + serveur).
//   - syncTombstones()        : au chargement → envoie la file, puis aligne le mémo local sur le
//                               serveur (les restaurations faites ailleurs sont donc prises en compte).
//   - getDeletedIds(kind)     : ids à retirer à l'affichage (utilisé par mergeWithLocal / saveRemote).
//
// Sûreté : si la table n'existe pas encore (migration non appliquée) ou si le réseau échoue, tout
// retombe sur le mémo LOCAL — comportement identique à avant, aucune perte. Les ids sont des UUID
// jamais réutilisés : une pierre tombale ne peut viser qu'un élément explicitement supprimé.

import { getSupabase } from '../supabase.js';

const TABLE = 'aichantier_deleted_entities';
// Clé items INCHANGÉE (déjà utilisée depuis la v108) : les suppressions déjà mémorisées sont conservées.
const SET_KEYS = { item: '_chantierai_deleted_items_v1', loc: '_chantierai_deleted_locs_v1' };
const QUEUE_KEY = '_chantierai_tomb_queue_v1';   // [{ kind, id, chantierId }] à envoyer au serveur
const LIFT_KEY = '_chantierai_tomb_lift_v1';     // [id] levées à retirer du serveur
const MIGRATED_KEY = '_chantierai_tomb_migrated_v1';
const CAP = 5000;

export const TOMBSTONE_KEYS = [SET_KEYS.item, SET_KEYS.loc, QUEUE_KEY, LIFT_KEY, MIGRATED_KEY];

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
}

export function getDeletedIds(kind) {
  const arr = readJSON(SET_KEYS[kind], []);
  return new Set(Array.isArray(arr) ? arr : []);
}
function writeDeletedIds(kind, set) {
  let arr = [...set];
  if (arr.length > CAP) arr = arr.slice(arr.length - CAP); // garde les plus récents
  writeJSON(SET_KEYS[kind], arr);
}
const readQueue = () => { const q = readJSON(QUEUE_KEY, []); return Array.isArray(q) ? q : []; };
const readLifts = () => { const l = readJSON(LIFT_KEY, []); return new Set(Array.isArray(l) ? l : []); };

/** Mémorise une suppression (local immédiat + envoi serveur, rejoué tant qu'il n'a pas abouti). */
export function addTombstone(kind, id, chantierId = null) {
  if (!id || !SET_KEYS[kind]) return;
  const set = getDeletedIds(kind);
  set.add(id);
  writeDeletedIds(kind, set);
  const queue = readQueue().filter(t => t.id !== id);
  queue.push({ kind, id, chantierId: chantierId ?? null });
  writeJSON(QUEUE_KEY, queue);
  const lifts = readLifts();
  if (lifts.delete(id)) writeJSON(LIFT_KEY, [...lifts]);
  flushTombstones().catch(() => {});
}

/** Lève une suppression (Annuler / Restaurer) : l'élément ne sera plus filtré, nulle part. */
export function liftTombstone(id) {
  if (!id) return;
  for (const kind of Object.keys(SET_KEYS)) {
    const set = getDeletedIds(kind);
    if (set.delete(id)) writeDeletedIds(kind, set);
  }
  writeJSON(QUEUE_KEY, readQueue().filter(t => t.id !== id));
  const lifts = readLifts();
  lifts.add(id);
  writeJSON(LIFT_KEY, [...lifts]);
  flushTombstones().catch(() => {});
}

/** Envoie au serveur les suppressions et levées en attente. Jamais d'exception. */
export async function flushTombstones() {
  let sb;
  try { sb = await getSupabase(); } catch { return false; }
  if (!sb) return false;
  let ok = true;
  const queue = readQueue();
  if (queue.length) {
    const rows = queue.map(t => ({ id: String(t.id), kind: t.kind, chantier_id: t.chantierId != null ? String(t.chantierId) : null }));
    try {
      const { error } = await sb.from(TABLE).upsert(rows, { onConflict: 'id' });
      if (error) ok = false;
      else {
        const sent = new Set(rows.map(r => r.id));
        writeJSON(QUEUE_KEY, readQueue().filter(t => !sent.has(String(t.id))));
      }
    } catch { ok = false; }
  }
  const lifts = [...readLifts()];
  if (lifts.length) {
    try {
      const { error } = await sb.from(TABLE).delete().in('id', lifts.map(String));
      if (error) ok = false;
      else {
        const done = new Set(lifts.map(String));
        writeJSON(LIFT_KEY, [...readLifts()].filter(id => !done.has(String(id))));
      }
    } catch { ok = false; }
  }
  return ok;
}

async function fetchServerTombstones(sb) {
  const out = { item: new Set(), loc: new Set() };
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(TABLE).select('id,kind').range(from, from + PAGE - 1);
    if (error) return null; // table absente / réseau → on garde le mémo local tel quel
    for (const r of (data || [])) if (out[r.kind]) out[r.kind].add(String(r.id));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/**
 * Au chargement : envoie la file locale, puis aligne le mémo local sur le serveur.
 * Renvoie { item, loc } (Sets) ou null si le serveur est indisponible (mémo local conservé).
 */
export async function syncTombstones() {
  // Migration unique : les suppressions d'observations mémorisées AVANT l'existence de la table
  // (v108→v111) sont mises en file pour être partagées avec les autres appareils.
  if (!readJSON(MIGRATED_KEY, false)) {
    const queue = readQueue();
    const queued = new Set(queue.map(t => String(t.id)));
    for (const kind of Object.keys(SET_KEYS))
      for (const id of getDeletedIds(kind)) if (!queued.has(String(id))) queue.push({ kind, id, chantierId: null });
    writeJSON(QUEUE_KEY, queue);
    writeJSON(MIGRATED_KEY, true);
  }

  await flushTombstones();
  let sb;
  try { sb = await getSupabase(); } catch { return null; }
  if (!sb) return null;
  let server;
  try { server = await fetchServerTombstones(sb); } catch { return null; }
  if (!server) return null;

  // Mémo local = serveur + suppressions locales pas encore envoyées − levées pas encore envoyées.
  const queue = readQueue();
  const lifts = readLifts();
  for (const kind of Object.keys(SET_KEYS)) {
    const set = new Set(server[kind]);
    for (const t of queue) if (t.kind === kind) set.add(String(t.id));
    for (const id of lifts) set.delete(String(id));
    writeDeletedIds(kind, set);
  }
  return { item: getDeletedIds('item'), loc: getDeletedIds('loc') };
}
