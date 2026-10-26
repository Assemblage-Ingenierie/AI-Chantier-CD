// ALERTE CORBEILLE (demande Thomas 26/10) : l'icône Corbeille du projet s'anime (rouge, secousse,
// halo) dès qu'il y a du NOUVEAU à restaurer depuis la dernière ouverture de la corbeille :
//   • zones / observations supprimées sur cet appareil (corbeille locale, recoveryBin) ;
//   • observations supprimées et photos détachées enregistrées par l'historique serveur
//     (n'importe quel appareil / utilisateur — c'est le cas de l'incident 26/10).
// Ouvrir la corbeille = « vu » → l'alerte s'éteint jusqu'à la prochaine nouveauté.
// Lecture seule, best-effort : en cas d'erreur, pas d'alerte (comportement d'avant).

import { listDeletedItems } from './recoveryBin.js';
import { listServerDeletionsSince } from './storage.js';

const KEY = '_chantierai_trash_seen_v1';
export const TRASH_EVENT = 'chantierai:recovery-bin';

function readSeen() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

// Dernière ouverture de la corbeille du projet. Jamais ouverte → maintenant (pas d'alerte pour
// l'existant au premier lancement : seule une NOUVELLE suppression allume l'icône).
export function getTrashSeen(projectId) {
  const m = readSeen();
  if (m[projectId]) return m[projectId];
  markTrashSeen(projectId);
  return Date.now();
}

export function markTrashSeen(projectId) {
  if (!projectId) return;
  try { const m = readSeen(); m[projectId] = Date.now(); localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* mode privé */ }
}

// Nombre d'éléments restaurables apparus depuis la dernière ouverture de la corbeille.
export async function countNewTrash(projet) {
  if (!projet?.id) return 0;
  const since = getTrashSeen(projet.id);
  const locs = new Set(), items = new Set();
  for (const v of (projet.visites || [])) for (const l of (v.localisations || [])) {
    if (!l._mergedInto) locs.add(l.id);
    for (const it of (l.items || [])) items.add(it.id);
  }
  const keys = new Set();
  try {
    for (const e of await listDeletedItems()) {
      if (e.projectId !== projet.id || !(e.ts > since)) continue;
      if (e.kind === 'loc') { if (e.locId && !locs.has(e.locId)) keys.add(`l:${e.locId}`); }
      else if (e.item?.id && !items.has(e.item.id)) keys.add(`i:${e.item.id}`);
    }
  } catch { /* corbeille locale indisponible */ }
  try {
    for (const d of await listServerDeletionsSince(projet.id, new Date(since).toISOString())) {
      if (d.table_name === 'aichantier_item_photos') keys.add(`p:${d.row_id}`);
      else if (!items.has(d.row_id)) keys.add(`i:${d.row_id}`);
    }
  } catch { /* historique serveur absent */ }
  return keys.size;
}
