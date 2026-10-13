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
