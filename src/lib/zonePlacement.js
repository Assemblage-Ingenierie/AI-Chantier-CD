// REPÉRAGE EN DIRECT sur le plan de ZONE (retour Thomas 27/10 : « le plan n'était pas sur
// l'observation mais sur le titre — il y a deux niveaux »). Après une prise de vue dans une
// observation SANS plan propre, on ouvre le plan de sa zone — ou, à défaut, celui du groupe
// au-dessus (« R+4 › Appartement ») — avec la nouvelle photo pré-sélectionnée.
// Logique pure (testée) : quel plan, quelles photos, quel index.
import { effectiveParentId, zonePlanItems } from './zoneGroups.js';
import { photoKey } from './photoMerge.js';

const hasPlan = (l) => !!(l && (l.planBg || l.planId));

// Zone dont on ouvre le plan : la zone de l'observation, sinon son groupe parent.
export function planTargetLoc(locs, locId) {
  const loc = (locs || []).find(l => l.id === locId);
  if (!loc) return null;
  if (hasPlan(loc)) return loc;
  const pid = effectiveParentId(locs, loc);
  const parent = pid ? locs.find(l => l.id === pid) : null;
  return hasPlan(parent) ? parent : null;
}

// Observations montrées sur le plan de la zone cible, avec l'observation EN COURS d'édition
// (formulaire pas encore enregistré, nouvelle photo comprise) à sa place.
export function placementItems(locs, target, itemLocId, form) {
  const withForm = (locs || []).map(l => {
    if (l.id !== itemLocId) return l;
    const items = l.items || [];
    return { ...l, items: items.some(i => i.id === form.id) ? items.map(i => (i.id === form.id ? form : i)) : [...items, form] };
  });
  const t = withForm.find(l => l.id === target?.id);
  return t ? zonePlanItems(withForm, t) : [];
}

// Index de la photo dans la liste des photos du plan de zone (mêmes règles que PlanLocModal :
// photos affichables uniquement, dans l'ordre des observations).
export function placementPhotoIdx(items, key) {
  let n = 0;
  for (const it of items || []) {
    for (const ph of (it.photos || []).filter(p => p.data)) {
      if (photoKey(ph) === key) return n;
      n++;
    }
  }
  return null;
}
