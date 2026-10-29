// Repères photo (marqueurs « viewpoint » Vxx) des plans ↔ photos de la visite.
//
// Un repère pointe sa photo par photoIdx (index dans la liste de photos vue par l'annotateur :
// photos AVEC data de la zone — sous-zones comprises — ou de l'observation) et, depuis le
// 13/10/2026, par photoId (_id de la photo). Supprimer / réordonner / déplacer une photo décalait
// les index : le repère d'une photo supprimée restait sur le plan et les suivants pointaient la
// mauvaise photo (retour Thomas 29/10 : « ça ne supprime pas les points quand les photos
// disparaissent »).
//
// syncViewpointsToPhotos(prev, next) est appelée à chaque mise à jour de la visite. Si aucune
// liste de photos n'a changé → `next` rendu tel quel (même référence). Sinon, pour chaque repère :
//   • sa photo est identifiée dans l'état PRÉCÉDENT (photoId s'il existe dans la visite, sinon
//     l'index dans la liste d'origine — seulement si cette liste est complète) ;
//   • photo SUPPRIMÉE de la visite → repère retiré ;
//   • sinon photoId figé + photoIdx recalé sur la nouvelle position (si la liste est complète).
// PRUDENCE (zéro perte) : photo non identifiable (liste pas encore chargée, origine hors de la
// visite…) → repère laissé tel quel. Seules les autres annotations (traits, textes…) ne sont
// jamais touchées.

import { zonePlanItems } from './zoneGroups.js';

const keyOf = (ph) => (ph ? (ph._id ?? ph.id ?? ph.data ?? null) : null);

// Liste « fiable » : toutes ses photos ont leurs octets (sinon l'index vu par l'annotateur peut
// différer) ; une observation sans photo ne compte que si elle a bien été chargée.
const itemComplete = (it) => {
  const ph = it?.photos || [];
  return ph.length ? ph.every(p => p && p.data) : it?._photosHydrated === true;
};

function indexLocs(locs) {
  const locById = new Map(), itemById = new Map();
  for (const l of (locs || [])) {
    if (l?.id != null) locById.set(l.id, l);
    for (const it of (l?.items || [])) if (it?.id != null) itemById.set(it.id, it);
  }
  return { locById, itemById };
}

// Liste de photos indexée par photoIdx pour l'origine `originId` (zone ou observation).
function originList(locs, idx, originId) {
  const loc = idx.locById.get(originId);
  const items = loc ? zonePlanItems(locs, loc) : (idx.itemById.has(originId) ? [idx.itemById.get(originId)] : null);
  if (!items) return null;
  return { photos: items.flatMap(it => (it.photos || []).filter(p => p && p.data)), complete: items.every(itemComplete) };
}

const photoSig = (it) => (it.photos || []).map(keyOf).join('|');

export function syncViewpointsToPhotos(prevLocs, nextLocs) {
  if (!Array.isArray(prevLocs) || !Array.isArray(nextLocs) || prevLocs === nextLocs) return nextLocs;
  const prevIdx = indexLocs(prevLocs), nextIdx = indexLocs(nextLocs);

  // 1) Une liste de photos a-t-elle changé ? (sinon rien à faire — cas de loin le plus fréquent)
  let changed = false;
  for (const [id, it] of prevIdx.itemById) {
    const n = nextIdx.itemById.get(id);
    if (!n ? (it.photos || []).length > 0 : (n.photos !== it.photos && photoSig(n) !== photoSig(it))) { changed = true; break; }
  }
  if (!changed) return nextLocs;

  // 2) Photos présentes après la mise à jour (une observation encore non chargée garde, par
  //    prudence, les photos qu'on lui connaissait) → photos réellement disparues de la visite.
  const nextKeys = new Set();
  for (const [id, it] of nextIdx.itemById) {
    const known = (it.photos || []).length > 0 || it._photosHydrated === true;
    const src = known ? it : (prevIdx.itemById.get(id) || it);
    for (const p of (src.photos || [])) { const k = keyOf(p); if (k != null) nextKeys.add(k); }
  }
  const prevKeys = new Set();
  for (const it of prevIdx.itemById.values()) for (const p of (it.photos || [])) { const k = keyOf(p); if (k != null) prevKeys.add(k); }
  const deleted = new Set([...prevKeys].filter(k => !nextKeys.has(k)));

  // Seuls les repères REPRIS tels quels de l'état précédent sont recalés : un repère venu d'un
  // autre instantané (ex. « Annuler » qui restaure l'état d'avant, plan qu'on vient
  // d'enregistrer) est déjà cohérent avec ses propres photos → on n'y touche pas.
  const prevVps = new Set();
  const collect = (ann) => { for (const p of (ann?.paths || [])) if (p?.type === 'viewpoint') prevVps.add(p); };
  for (const l of prevLocs) {
    collect(l?.planAnnotations);
    for (const ep of (l?.extraPlans || [])) collect(ep?.planAnnotations);
    for (const it of (l?.items || [])) for (const pl of (it?.plans || [])) collect(pl?.planAnnotations);
  }

  const listCache = new Map();
  const listOf = (locs, idx, originId, tag) => {
    const ck = `${tag}:${originId}`;
    if (!listCache.has(ck)) listCache.set(ck, originList(locs, idx, originId));
    return listCache.get(ck);
  };

  const fixPaths = (paths, ownerId) => {
    if (!Array.isArray(paths) || !paths.some(p => p?.type === 'viewpoint' && p.photoIdx != null)) return paths;
    let dirty = false;
    const out = [];
    for (const m of paths) {
      if (m?.type !== 'viewpoint' || m.photoIdx == null || !prevVps.has(m)) { out.push(m); continue; }
      const originId = m.originLocId ?? ownerId;
      // Identité de la photo AVANT la mise à jour.
      // photoId inconnu de la visite (photo supprimée AVANT ce correctif, ou visite dupliquée dont
      // les photos ont reçu de nouveaux _id) → on ne peut pas trancher : repère intact.
      if (m.photoId != null && !prevKeys.has(m.photoId)) { out.push(m); continue; }
      let key = m.photoId != null ? m.photoId : null;
      let pid = key;
      if (key == null) {
        const pl = listOf(prevLocs, prevIdx, originId, 'p');
        if (pl && pl.complete && m.photoIdx < pl.photos.length) {
          const ph = pl.photos[m.photoIdx];
          key = keyOf(ph); pid = ph._id ?? ph.id ?? null;
        }
      }
      if (key == null) { out.push(m); continue; }             // non identifiable → intact
      if (deleted.has(key)) { dirty = true; continue; }       // photo supprimée → repère retiré
      let nm = m;
      if (pid != null && pid !== m.photoId) nm = { ...nm, photoId: pid };
      const nl = listOf(nextLocs, nextIdx, originId, 'n');
      if (nl && nl.complete) {
        const ni = nl.photos.findIndex(p => keyOf(p) === key);
        if (ni >= 0 && ni !== m.photoIdx) nm = { ...nm, photoIdx: ni };
      }
      if (nm !== m) dirty = true;
      out.push(nm);
    }
    return dirty ? out : paths;
  };
  const fixAnn = (ann, ownerId) => {
    if (!ann?.paths) return ann;
    const paths = fixPaths(ann.paths, ownerId);
    return paths === ann.paths ? ann : { ...ann, paths };
  };

  let any = false;
  const result = nextLocs.map(loc => {
    let l = loc;
    const pa = fixAnn(loc.planAnnotations, loc.id);
    if (pa !== loc.planAnnotations) l = { ...l, planAnnotations: pa };
    if (Array.isArray(loc.extraPlans)) {
      let epDirty = false;
      const eps = loc.extraPlans.map(ep => {
        const a = fixAnn(ep?.planAnnotations, loc.id);
        if (a === ep?.planAnnotations) return ep;
        epDirty = true; return { ...ep, planAnnotations: a };
      });
      if (epDirty) l = { ...l, extraPlans: eps };
    }
    if (Array.isArray(loc.items)) {
      let itDirty = false;
      const items = loc.items.map(it => {
        if (!Array.isArray(it?.plans)) return it;
        let plDirty = false;
        const plans = it.plans.map(pl => {
          const a = fixAnn(pl?.planAnnotations, it.id);
          if (a === pl?.planAnnotations) return pl;
          plDirty = true; return { ...pl, planAnnotations: a };
        });
        if (!plDirty) return it;
        itDirty = true; return { ...it, plans };
      });
      if (itDirty) l = { ...l, items };
    }
    if (l !== loc) any = true;
    return l;
  });
  return any ? result : nextLocs;
}
