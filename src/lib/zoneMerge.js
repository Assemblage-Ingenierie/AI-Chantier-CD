// FUSION DE ZONES (demande Thomas) : glisser « Appartement Mme Scapolo » sur « R+4 » =
// comme si on avait recréé ses observations dans R+4 avec « Ajouter », sans rien réécrire.
//
// • Les observations (texte, photos, plans, urgence, suivi…) sont DÉPLACÉES telles quelles
//   (mêmes id → côté Supabase un simple changement de zone, photos intactes), à la suite de
//   celles de la zone cible. Le nom de la zone d'origine est ajouté DEVANT leur titre pour ne
//   pas perdre l'information (« Appartement Mme Scapolo · Toilette… »).
// • Les plans de la zone d'origine absents de la cible lui sont ajoutés (plans supplémentaires).
// • La zone d'origine n'est PAS supprimée ici : elle est vidée et marquée `_mergedInto`. Elle
//   n'est supprimée qu'APRÈS qu'une sauvegarde a enregistré le déplacement — en base, supprimer
//   une zone supprime EN CASCADE ses observations et leurs photos (FK ON DELETE CASCADE).

import { zonePlanItems } from './zoneGroups.js';

export const MERGE_SEP = ' · ';

// ── Annotations de plan lors d'une fusion (incident 13/10/2026 : annotations du R+4 perdues) ──
// Une zone fusionnée dont le plan est DÉJÀ celui de la cible (cas typique : « Mme Scapolo » avec
// le plan du R+4, fusionnée dans « R+4 ») voyait ses annotations JETÉES (plan ignoré « sans
// doublon »). Désormais ses annotations sont AJOUTÉES à ce plan de la cible (jamais rien retiré).

const photoKey = (ph) => (ph ? (ph._id ?? ph.id ?? null) : null);
// Photos aplaties d'une liste d'observations, même filtre que l'annotateur des plans de zone.
export const flatZonePhotos = (items, keep = (p) => p && p.data) =>
  (items || []).flatMap(it => (it.photos || []).filter(keep));

// Repères photo (viewpoint) d'une zone d'origine : leur photoIdx indexe les photos de la zone
// d'ORIGINE → on les relie aux mêmes photos dans la zone cible (par identité _id), sinon le repère
// pointerait sur une autre photo. Introuvable → repère conservé tel quel (+ photoId si connu).
export function remapViewpoints(paths, { srcId, srcKeys, dstFlat, owned }) {
  return (paths || []).map(p => {
    if (p?.type !== 'viewpoint' || p.photoIdx == null) return p;
    const mine = p.originLocId === srcId || (owned && p.originLocId == null);
    if (!mine) return p;
    const pid = p.photoId ?? srcKeys[p.photoIdx] ?? null;
    if (pid == null) return p;
    const idx = dstFlat.findIndex(ph => photoKey(ph) === pid);
    if (idx < 0) return p.photoId === pid ? p : { ...p, photoId: pid };
    // eslint-disable-next-line no-unused-vars
    const { originLocId, ...rest } = p;
    return { ...rest, photoIdx: idx, photoId: pid };
  });
}

const pathKey = (p) => (p?.type === 'viewpoint' && p._vpId ? `vp:${p._vpId}` : JSON.stringify(p));
function unionPaths(base, extra) {
  const seen = new Set((base || []).map(pathKey));
  const add = (extra || []).filter(p => { const k = pathKey(p); if (seen.has(k)) return false; seen.add(k); return true; });
  return { paths: add.length ? [...(base || []), ...add] : (base || []), added: add.length };
}

// Ajoute des plans { planId, planBg?, planData?, paths, reportHidden? } à une zone : plan déjà
// présent (principal ou supplémentaire) → annotations FUSIONNÉES (sans doublon) ; sinon → nouveau
// plan supplémentaire. Purement additif. Renvoie { loc, added } (nombre d'annotations ajoutées).
export function addPlansToZone(loc, plans) {
  let out = loc;
  let added = 0;
  for (const pl of (plans || [])) {
    const paths = pl.paths || [];
    if (pl.planId && out.planId === pl.planId) {
      const u = unionPaths(out.planAnnotations?.paths, paths);
      if (u.added) { out = { ...out, planAnnotations: { ...(out.planAnnotations || {}), paths: u.paths } }; added += u.added; }
      continue;
    }
    const eps = out.extraPlans || [];
    const i = pl.planId ? eps.findIndex(ep => ep.planId === pl.planId) : -1;
    if (i >= 0) {
      const u = unionPaths(eps[i].planAnnotations?.paths, paths);
      if (u.added) {
        out = { ...out, extraPlans: eps.map((ep, j) => j === i ? { ...ep, planAnnotations: { ...(ep.planAnnotations || {}), paths: u.paths } } : ep) };
        added += u.added;
      }
      continue;
    }
    if (!pl.planId && !pl.planBg) continue;
    out = { ...out, extraPlans: [...eps, {
      id: crypto.randomUUID(), planId: pl.planId || null, planBg: pl.planBg || null, planData: pl.planData || null,
      planAnnotations: paths.length ? { paths } : null, reportHidden: !!pl.reportHidden,
    }] };
    added += paths.length;
  }
  return { loc: out, added };
}

// Plans d'une zone (principal + supplémentaires) sous forme { planId, planBg, planData, paths, reportHidden }.
export function zonePlansOf(l) {
  const out = [];
  if (l?.planId || l?.planBg) {
    out.push({ planId: l.planId || null, planBg: l.planBg || null, planData: l.planData || null, paths: l.planAnnotations?.paths || [], reportHidden: !!l.planReportHidden });
  }
  for (const ep of (l?.extraPlans || [])) {
    out.push({ planId: ep.planId || null, planBg: ep.planBg || null, planData: ep.planData || null, paths: ep.planAnnotations?.paths || [], reportHidden: !!ep.reportHidden });
  }
  return out;
}

export function mergedTitle(zoneNom, titre) {
  const z = (zoneNom || '').trim();
  const t = (titre || '').trim();
  if (!z) return titre || '';
  if (!t) return z;
  if (t.toLowerCase().startsWith(z.toLowerCase())) return titre; // déjà préfixé (re-fusion)
  return `${z}${MERGE_SEP}${t}`;
}

export function canMergeZones(locs, srcId, tgtId) {
  if (!srcId || !tgtId || srcId === tgtId) return false;
  const src = (locs || []).find(l => l.id === srcId);
  const tgt = (locs || []).find(l => l.id === tgtId);
  return !!(src && tgt && !src._mergedInto && !tgt._mergedInto);
}

// Renvoie la nouvelle liste de zones (ou la même si fusion impossible).
export function mergeZones(locs, srcId, tgtId) {
  if (!canMergeZones(locs, srcId, tgtId)) return locs;
  const src = locs.find(l => l.id === srcId);
  const tgt = locs.find(l => l.id === tgtId);
  const moved = (src.items || []).map(it => ({ ...it, titre: mergedTitle(src.nom, it.titre) }));
  const srcKeys = flatZonePhotos(zonePlanItems(locs, src)).map(photoKey);

  const next = locs.map(l => {
    if (l.id === tgt.id) return { ...l, items: [...(l.items || []), ...moved] };
    if (l.id === src.id) {
      return { ...l, items: [], planId: null, planBg: null, planData: null, planAnnotations: null, extraPlans: [], _mergedInto: tgt.id };
    }
    // Zones rangées dans la zone d'origine (groupes) : elles redeviennent des zones normales.
    if (l.parentId === src.id) return { ...l, parentId: null };
    return l;
  });

  // Plans + annotations de la zone d'origine → cible : plan déjà présent = annotations ajoutées
  // à ce plan ; plan absent = nouveau plan supplémentaire. Repères photo reliés aux bonnes photos.
  const tgtNext = next.find(l => l.id === tgt.id);
  const dstFlat = flatZonePhotos(zonePlanItems(next, tgtNext));
  const remap = (paths, owned) => remapViewpoints(paths, { srcId: src.id, srcKeys, dstFlat, owned });
  // Repères déjà recopiés (propagation) dans les plans de la cible avec pour origine la zone fusionnée.
  const tgtRemapped = {
    ...tgtNext,
    planAnnotations: tgtNext.planAnnotations?.paths ? { ...tgtNext.planAnnotations, paths: remap(tgtNext.planAnnotations.paths, false) } : tgtNext.planAnnotations,
    ...(tgtNext.extraPlans ? { extraPlans: tgtNext.extraPlans.map(ep => ep.planAnnotations?.paths ? { ...ep, planAnnotations: { ...ep.planAnnotations, paths: remap(ep.planAnnotations.paths, false) } } : ep) } : {}),
  };
  const { loc: tgtFinal } = addPlansToZone(tgtRemapped, zonePlansOf(src).map(pl => ({ ...pl, paths: remap(pl.paths, true) })));
  return next.map(l => (l.id === tgt.id ? tgtFinal : l));
}

// SORTIR une observation fusionnée (ou en déplacer une) : si son titre porte le préfixe de la
// zone qu'elle rejoint (« Appartement Mme Scapolo · Toilette »), on le retire — elle retrouve
// son titre d'origine. Titre égal au nom de la zone (observation sans titre fusionnée) → vide.
export function unmergedTitle(titre, zoneNom) {
  const t = titre || '';
  const z = (zoneNom || '').trim();
  if (!z) return t;
  if (t.trim().toLowerCase() === z.toLowerCase()) return '';
  const pre = `${z}${MERGE_SEP}`;
  return t.toLowerCase().startsWith(pre.toLowerCase()) ? t.slice(pre.length) : t;
}

// Nom de zone suggéré pour ressortir une observation fusionnée : la partie avant « · ».
export function mergePrefix(titre) {
  const t = titre || '';
  const i = t.indexOf(MERGE_SEP);
  return i > 0 ? t.slice(0, i).trim() : '';
}

// Déplace l'observation `item` de `fromId` vers `toId` (zone existante) ou vers une NOUVELLE
// zone `{ nom }` insérée juste après la zone d'origine. Même id → photos et plans intacts.
export function moveItemToZone(locs, fromId, item, to) {
  const from = locs.find(l => l.id === fromId);
  if (!from || !item?.id) return locs;
  let target = typeof to === 'string' ? locs.find(l => l.id === to) : null;
  let created = null;
  if (!target) {
    if (!to || typeof to !== 'object') return locs;
    created = { id: crypto.randomUUID(), nom: (to.nom || '').trim() || 'Nouvelle zone', items: [], planBg: null, planData: null, planAnnotations: null };
    target = created;
  }
  if (target.id === fromId) return locs;
  const moved = { ...item, titre: unmergedTitle(item.titre, target.nom) };
  const out = [];
  for (const l of locs) {
    if (l.id === fromId) {
      out.push({ ...l, items: (l.items || []).filter(i => i.id !== item.id) });
      if (created) out.push({ ...created, items: [moved] });
    } else if (l.id === target.id) {
      out.push({ ...l, items: [...(l.items || []).filter(i => i.id !== item.id), moved] });
    } else out.push(l);
  }
  return out;
}
