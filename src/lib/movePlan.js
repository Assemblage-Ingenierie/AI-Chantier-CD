// Déplace un PLAN d'observation (entrée de item.plans, avec ses repères) d'une observation vers
// une autre — glisser-déposer dans la liste (demande Thomas 16/11). Logique PURE (testée).
// Si la cible a déjà ce plan (même planId), les repères y sont AJOUTÉS : pas de plan en double.
// → { locs, entry } ou null si rien à faire.
export function movePlanBetweenItems(locs, fromLocId, fromItemId, entryId, toLocId, toItemId) {
  if (fromLocId === toLocId && fromItemId === toItemId) return null;
  const fromItem = (locs || []).find(l => l.id === fromLocId)?.items?.find(i => i.id === fromItemId);
  const toItem = (locs || []).find(l => l.id === toLocId)?.items?.find(i => i.id === toItemId);
  const plans = fromItem?.plans || [];
  const k = plans.findIndex((pl, idx) => (pl.id ?? idx) === entryId);
  if (k < 0 || !toItem) return null;
  const entry = plans[k];
  const next = locs.map(l => {
    if (l.id !== fromLocId && l.id !== toLocId) return l;
    const items = (l.items || []).map(i => {
      if (l.id === fromLocId && i.id === fromItemId) return { ...i, plans: plans.filter((_, idx) => idx !== k) };
      if (l.id === toLocId && i.id === toItemId) {
        const cur = i.plans || [];
        const same = cur.findIndex(p => p.planId && p.planId === entry.planId);
        if (same < 0) return { ...i, plans: [...cur, entry] };
        const paths = [...(cur[same].planAnnotations?.paths || []), ...(entry.planAnnotations?.paths || [])];
        return { ...i, plans: cur.map((p, idx) => (idx === same ? { ...p, planAnnotations: paths.length ? { ...(p.planAnnotations || {}), paths } : p.planAnnotations } : p)) };
      }
      return i;
    });
    return { ...l, items };
  });
  return { locs: next, entry };
}

// ── Plans de ZONE ↔ plans d'OBSERVATION (retour Thomas 16/11 : « les mêmes trucs que les photos,
//    en haut à droite de chaque plan, je clique-dépose ») ──
// Plans d'une zone à plat, dans l'ordre affiché : plan principal (planId/planBg/planData…) puis
// extraPlans. Même normalisation que l'ancien reorderZonePlan.
export function zonePlansOf(loc) {
  const all = [];
  if (loc?.planId || loc?.planBg) all.push({ planId: loc.planId || null, planBg: loc.planBg || null, planData: loc.planData || null, planAnnotations: loc.planAnnotations || null, reportHidden: !!loc.planReportHidden });
  for (const ep of (loc?.extraPlans || [])) all.push({ planId: ep.planId || null, planBg: ep.planBg || null, planData: null, planAnnotations: ep.planAnnotations || null, reportHidden: !!ep.reportHidden });
  return all;
}
export function zonePatchFrom(all) {
  const [p, ...extras] = all;
  return {
    planId: p?.planId || null, planBg: p?.planBg || null, planData: p?.planData || null, planAnnotations: p?.planAnnotations || null,
    planReportHidden: !!p?.reportHidden,
    extraPlans: extras.map(e => ({ planId: e.planId, planBg: e.planBg, planAnnotations: e.planAnnotations, reportHidden: !!e.reportHidden })),
  };
}
const mergePaths = (a, b) => {
  const paths = [...(a?.paths || []), ...(b?.paths || [])];
  return paths.length ? { ...(a || {}), paths } : (a || b || null);
};

// src : { kind:'zone', locId, idx } | { kind:'item', locId, itemId, entryId }
// dst : { kind:'zone', locId, idx? (position d'insertion, défaut : à la fin) } | { kind:'item', locId, itemId }
// Le plan part avec ses repères. Si la destination a déjà ce plan, les repères y sont ajoutés.
// → { locs, planId } ou null si rien à faire. newId : générateur d'id pour une entrée d'observation.
export function movePlanAny(locs, src, dst, newId = () => (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2))) {
  if (!src || !dst) return null;
  if (src.kind === 'item' && dst.kind === 'item') {
    const r = movePlanBetweenItems(locs, src.locId, src.itemId, src.entryId, dst.locId, dst.itemId);
    return r ? { locs: r.locs, planId: r.entry.planId } : null;
  }
  const findLoc = (id) => (locs || []).find(l => l.id === id);
  // 1) Retirer le plan de sa source.
  let entry, patchSrc;
  if (src.kind === 'zone') {
    const loc = findLoc(src.locId); if (!loc) return null;
    const all = zonePlansOf(loc);
    if (!(src.idx >= 0 && src.idx < all.length)) return null;
    // Réordonnancement dans la même zone.
    if (dst.kind === 'zone' && dst.locId === src.locId) {
      let to = Number.isInteger(dst.idx) ? dst.idx : all.length;
      if (to > src.idx) to -= 1;
      if (to === src.idx) return null;
      const [m] = all.splice(src.idx, 1);
      all.splice(Math.max(0, Math.min(to, all.length)), 0, m);
      return { locs: locs.map(l => (l.id === loc.id ? { ...l, ...zonePatchFrom(all) } : l)), planId: m.planId };
    }
    entry = all[src.idx];
    patchSrc = (l) => ({ ...l, ...zonePatchFrom(all.filter((_, i) => i !== src.idx)) });
  } else {
    const it = findLoc(src.locId)?.items?.find(i => i.id === src.itemId);
    const plans = it?.plans || [];
    const k = plans.findIndex((pl, idx) => (pl.id ?? idx) === src.entryId);
    if (k < 0) return null;
    const e = plans[k];
    entry = { planId: e.planId || null, planBg: e.planBg || null, planData: null, planAnnotations: e.planAnnotations || null, reportHidden: false };
    patchSrc = (l) => ({ ...l, items: (l.items || []).map(i => (i.id === src.itemId ? { ...i, plans: plans.filter((_, idx) => idx !== k) } : i)) });
  }
  // 2) Le poser à la destination.
  let patchDst;
  if (dst.kind === 'zone') {
    if (!findLoc(dst.locId)) return null;
    patchDst = (l) => {
      const all = zonePlansOf(l);
      const same = all.findIndex(p => p.planId && p.planId === entry.planId);
      if (same >= 0) all[same] = { ...all[same], planAnnotations: mergePaths(all[same].planAnnotations, entry.planAnnotations) };
      else all.splice(Number.isInteger(dst.idx) ? Math.max(0, Math.min(dst.idx, all.length)) : all.length, 0, entry);
      return { ...l, ...zonePatchFrom(all) };
    };
  } else {
    if (!findLoc(dst.locId)?.items?.some(i => i.id === dst.itemId)) return null;
    patchDst = (l) => ({ ...l, items: (l.items || []).map(i => {
      if (i.id !== dst.itemId) return i;
      const cur = i.plans || [];
      const same = cur.findIndex(p => p.planId && p.planId === entry.planId);
      if (same >= 0) return { ...i, plans: cur.map((p, x) => (x === same ? { ...p, planAnnotations: mergePaths(p.planAnnotations, entry.planAnnotations) } : p)) };
      return { ...i, plans: [...cur, { id: newId(), planId: entry.planId, planBg: entry.planBg, planAnnotations: entry.planAnnotations }] };
    }) });
  }
  const next = locs.map(l => {
    let x = l;
    if (l.id === src.locId) x = patchSrc(x);
    if (l.id === dst.locId) x = patchDst(x);
    return x;
  });
  return { locs: next, planId: entry.planId };
}
