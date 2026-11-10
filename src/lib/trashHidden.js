// CORBEILLE : « je veux pouvoir supprimer pour alléger » (Thomas 10/11).
// Deux natures d'éléments dans la corbeille :
//   • zones / observations supprimées : copies gardées SUR L'APPAREIL (recoveryBin) → supprimées
//     pour de bon (place libérée) ;
//   • le reste (versions du texte gardées par le serveur, éléments retrouvés dans les sauvegardes
//     de l'appareil, plans supprimés, photos détachées) : sources de sécurité qu'on ne détruit PAS
//     (historique serveur = filet ultime, cf. CLAUDE.md) → simplement MASQUÉES de la corbeille.
// Masquage mémorisé par projet sur cet appareil ; un élément NOUVEAU (autre clé) réapparaît.

const KEY = 'chantierai_trash_hidden';
const MAX_PER_PROJECT = 3000;

function readAll() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

export function getHiddenTrashKeys(projectId) {
  const arr = readAll()[projectId];
  return new Set(Array.isArray(arr) ? arr : []);
}

export function hideTrashKeys(projectId, keys) {
  if (!projectId || !keys?.length) return getHiddenTrashKeys(projectId);
  const all = readAll();
  const cur = Array.isArray(all[projectId]) ? all[projectId] : [];
  const set = new Set(cur);
  const next = [...cur, ...keys.filter(k => k && !set.has(k))].slice(-MAX_PER_PROJECT);
  all[projectId] = next;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* quota / mode privé : masquage pour cette session seulement */ }
  return new Set(next);
}
