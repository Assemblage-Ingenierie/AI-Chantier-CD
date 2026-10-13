// RÉCUPÉRATION des annotations de plan perdues lors d'une FUSION de zones (incident 13/10/2026).
//
// Avant le correctif, fusionner une zone dont le plan était déjà celui de la cible (ex. un
// appartement avec le plan du R+4, fusionné dans « R+4 ») jetait ses annotations ; la zone
// d'origine était ensuite supprimée. Ces annotations survivent dans la BOÎTE NOIRE de l'appareil
// (lib/backupVault.js : instantanés complets, sans blobs mais avec toutes les annotations).
//
// Principe — 100 % ADDITIF, rien n'est jamais retiré ni écrasé :
//   • on cherche, dans les instantanés, les zones qui n'existent PLUS aujourd'hui (ou masquées
//     `_mergedInto`) mais dont les observations vivent maintenant dans une autre zone ;
//   • pour chacune, on prend son état le PLUS RÉCENT avant fusion (si à ce moment elle n'avait
//     plus d'annotations, on ne ressuscite rien d'antérieur) ;
//   • ses annotations sont AJOUTÉES aux plans de la zone qui a reçu ses observations (même
//     plan → ajoutées à ce plan, sans doublon ; autre plan → plan supplémentaire).
// Une zone supprimée AVEC ses observations (suppression volontaire) n'est jamais concernée.

import { zonePlanItems } from './zoneGroups.js';
import { flatZonePhotos, remapViewpoints, addPlansToZone, zonePlansOf } from './zoneMerge.js';

const photoKey = (ph) => (ph ? (ph._id ?? ph.id ?? null) : null);
// Instantanés : les photos base64 y ont data=null (blobs retirés) → filtre permissif pour garder
// les mêmes index que lors de la pose des repères.
const snapKeep = (p) => p && (p.data || p._id != null || p.id != null);

// Scanner incrémental : add(snapshot) du PLUS RÉCENT au plus ancien (un instantané à la fois
// en mémoire), puis entries(projets) → propositions encore applicables.
export function createAnnotScanner(projets) {
  const curProj = new Map((projets || []).map(p => [p.id, p]));
  const seen = new Map(); // `${pid}|${vid}|${locId}` → proposition | null (vue sans annotations)

  const add = (snapshot) => {
    for (const sp of (snapshot?.data || [])) {
      const cur = curProj.get(sp.id);
      if (!cur) continue;
      for (const sv of (sp.visites || [])) {
        const cv = (cur.visites || []).find(v => v.id === sv.id);
        if (!cv) continue;
        const curLocs = cv.localisations || [];
        for (const sl of (sv.localisations || [])) {
          if (!sl?.id || sl._mergedInto) continue; // état après fusion : vidé, on cherche l'état d'avant
          const key = `${sp.id}|${sv.id}|${sl.id}`;
          if (seen.has(key)) continue;
          const live = curLocs.find(l => l.id === sl.id);
          if (live && !live._mergedInto) continue; // zone toujours là → pas une perte de fusion
          const plans = zonePlansOf(sl).filter(pl => pl.planId && pl.paths.length);
          if (!plans.length) { seen.set(key, null); continue; }
          const ids = new Set((sl.items || []).map(i => i.id));
          if (!ids.size) { seen.set(key, null); continue; }
          seen.set(key, {
            projectId: sp.id, projectNom: cur.nom || '', visiteId: sv.id,
            srcLocId: sl.id, srcNom: sl.nom || '', itemIds: [...ids],
            srcKeys: flatZonePhotos(zonePlanItems(sv.localisations || [], sl), snapKeep).map(photoKey),
            plans: plans.map(pl => ({ planId: pl.planId, paths: pl.paths })),
            ts: snapshot.ts,
          });
        }
      }
    }
  };

  const entries = (projetsNow = projets) => {
    const out = [];
    for (const e of seen.values()) {
      if (!e) continue;
      const res = applyAnnotRecovery(projetsNow, [e]);
      if (res.added > 0) out.push({ ...e, dstNom: res.dst[0]?.nom || '', count: res.added });
    }
    return out;
  };

  return { add, entries };
}

// Zone qui contient aujourd'hui le plus d'observations de la zone d'origine.
function destinationOf(locs, itemIds) {
  const ids = new Set(itemIds);
  let best = null, n = 0;
  for (const l of (locs || [])) {
    if (l._mergedInto) continue;
    const k = (l.items || []).filter(i => ids.has(i.id)).length;
    if (k > n) { n = k; best = l; }
  }
  return best;
}

// Applique des propositions à une liste de projets → { projets, added, dst }. Additif.
export function applyAnnotRecovery(projets, entries) {
  let added = 0;
  const dst = [];
  const out = (projets || []).map(p => {
    const mine = entries.filter(e => e.projectId === p.id);
    if (!mine.length) return p;
    let changed = false;
    const visites = (p.visites || []).map(v => {
      const ev = mine.filter(e => e.visiteId === v.id);
      if (!ev.length) return v;
      let locs = v.localisations || [];
      for (const e of ev) {
        const target = destinationOf(locs, e.itemIds);
        if (!target) continue;
        const dstFlat = flatZonePhotos(zonePlanItems(locs, target));
        const plans = e.plans.map(pl => ({
          planId: pl.planId,
          paths: remapViewpoints(pl.paths, { srcId: e.srcLocId, srcKeys: e.srcKeys || [], dstFlat, owned: true }),
        }));
        const r = addPlansToZone(target, plans);
        if (!r.added) continue;
        added += r.added;
        dst.push(r.loc);
        changed = true;
        locs = locs.map(l => (l.id === target.id ? r.loc : l));
      }
      return locs === v.localisations ? v : { ...v, localisations: locs };
    });
    return changed ? { ...p, visites } : p;
  });
  return { projets: out, added, dst };
}
