// SÉLECTION MULTIPLE DE PHOTOS (onglet Visite, PC — demande Thomas 27/11 : « Ctrl + clic pour
// sélectionner plusieurs photos ; Suppr en supprime plusieurs, un glisser en déplace plusieurs »).
//
// Une sélection = liste de { locId, itemId, key } (key = identité stable de la photo). Les photos
// gardent leur OBJET lors d'un déplacement (donc leur _id) → côté Supabase, comme pour le
// déplacement d'une seule photo (movePhoto de VueProjet), la ligne item_photos est simplement
// rattachée à la nouvelle observation.

import { photoKey } from './photoMerge.js';

export const selKey = (ph) => photoKey(ph) || ph?.name || null;

export const isSelected = (sel, itemId, ph) => {
  const k = selKey(ph);
  return !!k && (sel || []).some(s => s.itemId === itemId && s.key === k);
};

// Ajoute / retire une photo de la sélection.
export function toggleSel(sel, locId, itemId, ph) {
  const k = selKey(ph);
  if (!k) return sel || [];
  const cur = sel || [];
  return cur.some(s => s.itemId === itemId && s.key === k)
    ? cur.filter(s => !(s.itemId === itemId && s.key === k))
    : [...cur, { locId, itemId, key: k }];
}

const itemsOf = (l) => l.items || [];

// Photos sélectionnées dans l'ORDRE du document (zones, observations, photos) — c'est l'ordre
// dans lequel elles sont déposées. Les entrées devenues introuvables sont ignorées.
export function collectSelected(localisations, sel) {
  const want = new Set((sel || []).map(s => `${s.itemId}\u0000${s.key}`));
  const out = [];
  for (const l of localisations || []) for (const it of itemsOf(l)) for (const ph of it.photos || []) {
    const k = selKey(ph);
    if (k && want.has(`${it.id}\u0000${k}`)) out.push({ locId: l.id, itemId: it.id, photo: ph });
  }
  return out;
}

// Retire les photos sélectionnées. Renvoie { locs, count } (locs inchangé si rien à faire).
export function deleteSelected(localisations, sel) {
  const picked = collectSelected(localisations, sel);
  if (!picked.length) return { locs: localisations, count: 0 };
  const drop = new Set(picked.map(p => p.photo));
  const touched = new Set(picked.map(p => p.itemId));
  const locs = (localisations || []).map(l => {
    if (!itemsOf(l).some(it => touched.has(it.id))) return l;
    return { ...l, items: itemsOf(l).map(it => (touched.has(it.id)
      ? { ...it, _photosHydrated: true, photos: (it.photos || []).filter(ph => !drop.has(ph)) }
      : it)) };
  });
  return { locs, count: picked.length };
}

// Déplace les photos sélectionnées dans l'observation (toLocId, toItemId), insérées à la
// position `toIdx` (index dans la liste ACTUELLE de la cible, photos sélectionnées comprises ;
// défaut : à la fin). Renvoie { locs, count }.
export function moveSelected(localisations, sel, toLocId, toItemId, toIdx) {
  const picked = collectSelected(localisations, sel);
  const target = (localisations || []).find(l => l.id === toLocId)?.items?.find(i => i.id === toItemId);
  if (!picked.length || !target) return { locs: localisations, count: 0 };
  const moving = picked.map(p => p.photo);
  const drop = new Set(moving);
  const touched = new Set([...picked.map(p => p.itemId), toItemId]);
  const tPhotos = target.photos || [];
  const at = Number.isInteger(toIdx) ? Math.max(0, Math.min(toIdx, tPhotos.length)) : tPhotos.length;
  // Position d'insertion une fois les photos déplacées retirées de la cible.
  const ins = at - tPhotos.slice(0, at).filter(ph => drop.has(ph)).length;
  const locs = (localisations || []).map(l => {
    if (!itemsOf(l).some(it => touched.has(it.id))) return l;
    return { ...l, items: itemsOf(l).map(it => {
      if (!touched.has(it.id)) return it;
      const kept = (it.photos || []).filter(ph => !drop.has(ph));
      if (it.id === toItemId && l.id === toLocId) kept.splice(ins, 0, ...moving);
      return { ...it, _photosHydrated: true, photos: kept };
    }) };
  });
  return { locs, count: moving.length };
}
