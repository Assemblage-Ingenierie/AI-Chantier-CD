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

export const MERGE_SEP = ' · ';

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

  // Plans de la zone d'origine → plans supplémentaires de la cible (sans doublon de planId).
  const tgtPlanIds = new Set([tgt.planId, ...(tgt.extraPlans || []).map(ep => ep.planId)].filter(Boolean));
  const srcPlans = [];
  if (src.planId || src.planBg) {
    srcPlans.push({ id: crypto.randomUUID(), planId: src.planId || null, planBg: src.planBg || null, planData: src.planData || null, planAnnotations: src.planAnnotations || null, reportHidden: !!src.planReportHidden });
  }
  for (const ep of (src.extraPlans || [])) srcPlans.push({ ...ep });
  const addPlans = srcPlans.filter(p => p.planId ? !tgtPlanIds.has(p.planId) : !!p.planBg);

  return locs.map(l => {
    if (l.id === tgt.id) {
      return {
        ...l,
        items: [...(l.items || []), ...moved],
        ...(addPlans.length ? { extraPlans: [...(l.extraPlans || []), ...addPlans] } : {}),
      };
    }
    if (l.id === src.id) {
      return { ...l, items: [], planId: null, planBg: null, planData: null, planAnnotations: null, extraPlans: [], _mergedInto: tgt.id };
    }
    // Zones rangées dans la zone d'origine (groupes) : elles redeviennent des zones normales.
    if (l.parentId === src.id) return { ...l, parentId: null };
    return l;
  });
}
