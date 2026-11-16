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
