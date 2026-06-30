// Numérotation Vxx des viewpoints sur tout le rapport.
//
// RÈGLES MÉTIER (demandes utilisateur) :
//   R1 : jamais deux fois le même Vxx sur un même plan (une photo = un seul angle).
//   R2 : la MÊME photo d'une zone sur deux plans (plan + coupe) → le MÊME numéro.
//   R3 : deux photos différentes → deux numéros différents (nouvelle photo = numéro suivant).
//   R4 : sur un plan partagé entre zones, on voit TOUT (on ne retire rien).
//
// Principe : on regroupe les marqueurs par IDENTITÉ, et chaque groupe reçoit UN numéro unique.
//   • Groupe O:`${originLocId}_${photoIdx}` → même photo de la même zone (R2), même sur plusieurs
//     plans, et même recopiée par propagation dans une autre zone (l'origine voyage avec le marqueur).
//   • Groupe I:`${_vpId}` → ancien marqueur (sans origine) : ses copies propagées partagent le _vpId.
//   • Groupe F:empreinte → tout dernier filet (marqueur sans _vpId).
// Deux groupes distincts n'ont JAMAIS le même numéro → pas de « deux V1 », même sur un plan
// partagé qui combine plusieurs zones. Le numéro figé (vpNum) est conservé s'il ne crée pas de
// collision, sinon réattribué.
//
//   • vxxPhotoMap : badge affiché SUR la photo. DEUX clés par photo (la 1re trouvée gagne) :
//       - clé d'IDENTITÉ `pid:${_id}` (robuste : suit la photo même si l'ordre/index change) ;
//       - clé d'INDEX `${locId}_${photoIdx}` (repli historique, photos legacy sans _id).
//   • vpNumByPath : label du marqueur (clé : ref objet ET _vpId).

// Clé d'identité stable d'une photo (id de ligne DB conservé dans _id, sinon id distant).
export const photoVpKey = (ph) =>
  ph && ph._id != null ? `pid:${ph._id}` : (ph && ph.id != null ? `pid:${ph.id}` : null);

export function computeVpNumbering(localisations) {
  const vxxPhotoMap = new Map();
  const vpNumByPath = new Map();
  const groupNum    = new Map(); // groupKey → numéro
  let g = 0;

  const fp = (vp) => `${Math.round(vp.x ?? -1)}|${Math.round(vp.y ?? -1)}|${vp.photoIdx ?? '_'}`;
  const groupKey = (vp, ownerId) =>
    (vp.originLocId != null && vp.photoIdx != null) ? `O:${vp.originLocId}_${vp.photoIdx}`
    : (ownerId != null && vp.photoIdx != null && vp.originLocId == null) ? `O:${ownerId}_${vp.photoIdx}`
    : vp._vpId ? `I:${vp._vpId}`
    : `F:${fp(vp)}`;

  // Attribue le numéro d'un marqueur selon son groupe d'identité (R2 : même photo de la même
  // zone = même numéro, même sur plusieurs plans). Numérotation CONTINUE et COMPACTE : chaque
  // nouveau groupe reçoit le numéro suivant dans l'ordre d'apparition (++g). Conséquence : une
  // suppression recompacte automatiquement toute la séquence (plus de trou), sans réutiliser le
  // vpNum figé — c'est le comportement « continu, sans trou » choisi.
  const assignNum = (vp, ownerId) => {
    const key = groupKey(vp, ownerId);
    let num = groupNum.get(key);
    if (num == null) { num = ++g; groupNum.set(key, num); }
    vpNumByPath.set(vp, num);
    if (vp._vpId) vpNumByPath.set(vp._vpId, num);
    return num;
  };

  // Index globaux pour résoudre l'ORIGINE d'un marqueur (la propagation copie un marqueur sur
  // les plans d'autres zones partageant le même plan, avec originLocId = zone/observation
  // d'origine ; son photoIdx indexe alors les photos de l'ORIGINE, pas de la zone courante).
  const locById = new Map();
  const itemById = new Map();
  const zoneFlatCache = new Map();
  for (const l of (localisations || [])) {
    if (l?.id != null) locById.set(l.id, l);
    for (const it of (l.items || [])) if (it?.id != null) itemById.set(it.id, it);
  }
  // Photos APLATIES d'une zone, dans l'ORDRE EXACT vu par l'annotateur des plans de zone
  // (PlanLocModal : items.flatMap(photos avec data)) → vp.photoIdx d'un plan de zone indexe
  // cette liste.
  const zoneFlatOf = (l) => {
    if (!l) return [];
    if (!zoneFlatCache.has(l.id)) {
      zoneFlatCache.set(l.id, (l.items || []).flatMap(it => (it.photos || []).filter(p => p.data)));
    }
    return zoneFlatCache.get(l.id);
  };
  // Badge par IDENTITÉ photo (clé `pid:${_id}`), résolu GLOBALEMENT : peu importe le plan/la zone
  // qui porte le marqueur, le badge suit la photo. La clé d'INDEX (`${locId}_${idx}`) reste un
  // repli pour les photos legacy sans _id, posée uniquement pour la zone propriétaire.
  const addBadge = (photoId, idxKey, num) => {
    if (idxKey && !vxxPhotoMap.has(idxKey)) vxxPhotoMap.set(idxKey, num);
    if (photoId != null) { const pk = `pid:${photoId}`; if (!vxxPhotoMap.has(pk)) vxxPhotoMap.set(pk, num); }
  };
  const idOf = (ph) => ph ? (ph._id ?? ph.id ?? null) : null;

  for (const loc of (localisations || [])) {
    // 1) Plans de la ZONE (principal + extra) — photoIdx indexe les photos de la zone.
    const zonePaths = [
      ...((loc.planAnnotations?.paths || [])),
      ...((loc.extraPlans || []).flatMap(ep => ep.planAnnotations?.paths || [])),
    ];
    for (const vp of zonePaths) {
      if (vp.type !== 'viewpoint') continue;
      const num = assignNum(vp, loc.id);
      if (vp.photoIdx == null) continue;
      const isOwner = vp.originLocId == null || vp.originLocId === loc.id;
      // Identité : photoId figé à la pose (futur) sinon résolu via les photos de l'ORIGINE.
      const originLoc = vp.originLocId != null ? (locById.get(vp.originLocId) || loc) : loc;
      const photoId = vp.photoId ?? idOf(zoneFlatOf(originLoc)[vp.photoIdx]);
      addBadge(photoId, isOwner ? `${loc.id}_${vp.photoIdx}` : null, num);
    }
    // 2) Plans des OBSERVATIONS (item.plans) — photoIdx indexe les photos de l'observation ;
    //    le badge d'index est posé à l'index APLATI dans la zone (offset cumulé par observation)
    //    pour coïncider avec la grille photo du rapport.
    let photoOffset = 0;
    for (const item of (loc.items || [])) {
      for (const pl of (item.plans || [])) {
        for (const vp of (pl.planAnnotations?.paths || [])) {
          if (vp.type !== 'viewpoint') continue;
          const num = assignNum(vp, item.id);
          if (vp.photoIdx == null) continue;
          const isOwner = vp.originLocId == null || vp.originLocId === item.id;
          const originItem = vp.originLocId != null ? (itemById.get(vp.originLocId) || item) : item;
          // photoIdx indexe item.photos (liste NON filtrée passée à l'annotateur).
          const photoId = vp.photoId ?? idOf((originItem.photos || [])[vp.photoIdx]);
          addBadge(photoId, isOwner ? `${loc.id}_${photoOffset + vp.photoIdx}` : null, num);
        }
      }
      photoOffset += (item.photos || []).filter(p => p.data).length;
    }
  }
  return { vxxPhotoMap, vpNumByPath, max: g };
}

// DIAGNOSTIC (mode ?vxxdebug=1) : renvoie, par localisation, la liste brute des marqueurs
// viewpoint (zone + observations) avec les champs déterminants pour le badge, et la liste
// aplatie des _id de photos de la zone. Aucun effet en production normale.
export function debugVpNumbering(localisations) {
  const out = [];
  const idOf = (ph) => ph ? (ph._id ?? ph.id ?? null) : null;
  const shortId = (id) => id == null ? '∅' : String(id).slice(0, 6);
  for (const loc of (localisations || [])) {
    const zoneFlat = (loc.items || []).flatMap(it => (it.photos || []).filter(p => p.data));
    const markers = [];
    const pushVp = (vp, plan, ownerId) => {
      if (vp.type !== 'viewpoint') return;
      markers.push({
        plan, label: vp.label, vpNum: vp.vpNum,
        photoIdx: vp.photoIdx ?? null,
        originLocId: shortId(vp.originLocId),
        ownerId: shortId(ownerId),
        photoId: shortId(vp.photoId),
        resolvedId: shortId(idOf(zoneFlat[vp.photoIdx])),
      });
    };
    for (const vp of (loc.planAnnotations?.paths || [])) pushVp(vp, 'zone', loc.id);
    (loc.extraPlans || []).forEach((ep, i) => (ep.planAnnotations?.paths || []).forEach(vp => pushVp(vp, `extra${i}`, loc.id)));
    for (const item of (loc.items || []))
      for (const pl of (item.plans || []))
        for (const vp of (pl.planAnnotations?.paths || [])) pushVp(vp, `obs:${shortId(item.id)}`, item.id);
    out.push({
      locNom: loc.nom, locId: shortId(loc.id),
      zoneFlatIds: zoneFlat.map((p, i) => `${i}:${shortId(idOf(p))}`),
      markers,
    });
  }
  return out;
}

// Lookup helper : 1) vpNum figé dans le marqueur, 2) _vpId (stable), 3) ref objet.
export function getVpNum(vpNumByPath, vp) {
  if (vpNumByPath) {
    const n = vp._vpId ? vpNumByPath.get(vp._vpId) : undefined;
    if (n != null) return n;
    const r = vpNumByPath.get(vp);
    if (r != null) return r;
  }
  return vp?.vpNum != null ? vp.vpNum : null;
}

// Empreinte stable pour le DÉDOUBLONNAGE d'affichage (ignore label/_vpId/textW/vpNum…).
// Position arrondie à une grille grossière → attrape les quasi-doublons superposés (ex. deux
// « Façade Nord » décalés de quelques pixels par la propagation).
function annotFp(p) {
  const r = (v) => Math.round((v ?? 0) / 12);
  switch (p.type) {
    case 'viewpoint': return p._vpId ? `vp:${p._vpId}` : `vp|${r(p.x)}|${r(p.y)}|${p.photoIdx ?? '_'}`;
    // Texte : dédoublonné par CONTENU sur un même plan (les copies propagées d'un libellé comme
    // « Façade Nord » sont souvent légèrement décalées → la position ne suffit pas).
    case 'text':      return `txt|${(p.text || '').trim()}`;
    case 'symbol':    return `sym|${p.symbolId}|${r(p.x ?? p.x1)}|${r(p.y ?? p.y1)}`;
    case 'shape':     return `shp|${p.shape}|${r(p.x1 ?? p.pts?.[0]?.x)}|${r(p.y1 ?? p.pts?.[0]?.y)}`;
    case 'stroke':    return `str|${p.points?.length ?? 0}|${r(p.points?.[0]?.x)}|${r(p.points?.[0]?.y)}`;
    default:          return JSON.stringify(p);
  }
}

// Prépare les annotations d'UN plan pour l'affichage (rapport / aperçu / PDF) :
//   1. retire les doublons (textes, symboles, marqueurs recopiés par la propagation),
//   2. attribue à chaque marqueur viewpoint son numéro (vpNum figé ou numérotation globale),
//   3. RÉPARE R1 : si deux marqueurs DISTINCTS tombent sur le même numéro sur ce plan, le
//      second est renuméroté → jamais deux V1 sur l'image, quel que soit l'état des données.
// Display-only : ne modifie jamais les données stockées.
export function dedupPlanPaths(paths, vpNumByPath = null, base = 0) {
  if (!paths?.length) return paths;
  let maxNum = base;
  for (const p of paths) if (p.type === 'viewpoint') {
    const n = getVpNum(vpNumByPath, p);
    if (n != null) maxNum = Math.max(maxNum, n);
  }
  const seen = new Set();
  const usedNums = new Set();
  const out = [];
  for (const p of paths) {
    const f = annotFp(p);
    if (seen.has(f)) continue; // doublon → on n'affiche qu'une fois
    seen.add(f);
    if (p.type !== 'viewpoint') { out.push(p); continue; }
    let num = getVpNum(vpNumByPath, p);
    if (num == null || usedNums.has(num)) num = ++maxNum; // R1
    usedNums.add(num);
    out.push(num === p.vpNum && p.label === `V${num}` ? p : { ...p, label: `V${num}` });
  }
  return out;
}

// MIGRATION + RÉPARATION à l'ouverture du modal plan d'une zone : fige un vpNum dans chaque
// marqueur et réparti les doublons sur un même plan (persisté à l'enregistrement → données
// nettoyées définitivement). L'affichage est de toute façon protégé par dedupPlanPaths.
export function freezeVpNumsForZone(plans, vpNumByPath, vpBase = 0, locId = null) {
  if (!plans?.length) return plans;
  let maxNum = vpBase;
  for (const pl of plans) for (const a of (pl.planAnnotations?.paths || []))
    if (a.type === 'viewpoint' && a.vpNum != null) maxNum = Math.max(maxNum, a.vpNum);
  const byVpId  = new Map();
  const byPhoto = new Map();
  return plans.map(pl => {
    const paths = pl.planAnnotations?.paths;
    if (!paths?.length) return pl;
    const usedOnPlan = new Map();
    let changed = false;
    const newPaths = paths.map(a => {
      if (a.type !== 'viewpoint') return a;
      const isLocal = a.originLocId == null || a.originLocId === locId;
      let num = a.vpNum
        ?? byVpId.get(a._vpId)
        ?? (isLocal && a.photoIdx != null ? byPhoto.get(a.photoIdx) : undefined)
        ?? getVpNum(vpNumByPath, a);
      if (num == null) num = ++maxNum;
      const holder = usedOnPlan.get(num);
      const selfKey = a._vpId ?? a;
      if (holder != null && holder !== selfKey) { num = ++maxNum; }
      usedOnPlan.set(num, selfKey);
      if (a._vpId && !byVpId.has(a._vpId)) byVpId.set(a._vpId, num);
      if (isLocal && a.photoIdx != null && !byPhoto.has(a.photoIdx)) byPhoto.set(a.photoIdx, num);
      if (a.vpNum === num && a.label === `V${num}`) return a;
      changed = true;
      return { ...a, vpNum: num, label: `V${num}` };
    });
    if (!changed) return pl;
    return { ...pl, planAnnotations: { ...pl.planAnnotations, paths: newPaths } };
  });
}

// Réécrit le label de chaque marqueur viewpoint selon la numérotation GLOBALE (zéro doublon).
export function relabelViewpoints(paths, vpNumByPath, base = 0) {
  if (!paths || !vpNumByPath) return paths;
  let extra = 0;
  return paths.map(p => {
    if (p.type !== 'viewpoint') return p;
    const n = getVpNum(vpNumByPath, p);
    if (n != null) return { ...p, label: `V${n}` };
    extra += 1;
    return { ...p, label: `V${base + extra}` };
  });
}
