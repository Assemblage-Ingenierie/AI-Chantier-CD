// FORMAT AUTOMATIQUE DES PHOTOS DANS LE RAPPORT (demande Thomas 27/11 : « c'est super de pouvoir
// changer portrait / paysage, mais ça ne peut pas détecter automatiquement et proposer de base le
// format de la photo ? »).
//
// Une photo dont le format n'a JAMAIS été choisi (orient absent) prend le format de l'image :
// plus haute que large → portrait, sinon paysage. Un choix fait à la main (outil Cadrer :
// orient 'portrait' OU 'landscape') reste prioritaire.
//
// Calcul d'affichage uniquement : rien n'est enregistré tant que l'utilisateur ne modifie pas la
// photo (ensuite le format affiché devient son format explicite, ce qui ne change rien à l'écran).

import { photoKey } from './photoMerge.js';

export const orientKey = (ph) => photoKey(ph) || ph?.name || null;

// Portrait si nettement plus haute que large (5 % de marge : une photo carrée reste en paysage).
export const orientOfSize = (w, h) => (w > 0 && h > 0 && h > w * 1.05 ? 'portrait' : 'landscape');

const itemsOfLoc = (l) => [...(l.items || []), ...((l.sections || []).flatMap(s => s.items || []))];

// Photos à mesurer : sans format choisi, avec une image, pas encore mesurées (`known` = objet
// clé → format, ou Set des clés déjà lancées).
export function photosToMeasure(locs, known) {
  const out = [];
  const seen = new Set();
  for (const l of locs || []) for (const it of itemsOfLoc(l)) for (const ph of it.photos || []) {
    if (!ph || ph.orient) continue;
    const k = orientKey(ph);
    const src = ph.annotated || ph.data;
    if (!k || !src || seen.has(k) || (known && (known instanceof Set ? known.has(k) : k in known))) continue;
    seen.add(k);
    out.push({ key: k, src });
  }
  return out;
}

// Zones avec le format détecté appliqué aux photos sans format choisi. Les objets ne sont
// recopiés QUE si une photo passe en portrait (sinon identiques → aucun re-calcul inutile).
export function applyAutoOrient(locs, known) {
  if (!known || !Object.keys(known).length) return locs;
  const fixItem = (it) => {
    let changed = false;
    const photos = (it.photos || []).map(ph => {
      if (!ph || ph.orient) return ph;
      if (known[orientKey(ph)] !== 'portrait') return ph;
      changed = true;
      return { ...ph, orient: 'portrait' };
    });
    return changed ? { ...it, photos } : it;
  };
  return (locs || []).map(l => {
    const items = (l.items || []).map(fixItem);
    const sections = l.sections ? l.sections.map(s => { const si = (s.items || []).map(fixItem); return si.some((x, i) => x !== s.items[i]) ? { ...s, items: si } : s; }) : l.sections;
    const itemsChanged = items.some((x, i) => x !== l.items[i]);
    const sectionsChanged = l.sections && sections.some((x, i) => x !== l.sections[i]);
    return itemsChanged || sectionsChanged ? { ...l, ...(itemsChanged ? { items } : {}), ...(sectionsChanged ? { sections } : {}) } : l;
  });
}
