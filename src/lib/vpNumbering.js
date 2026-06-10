// Numérotation Vxx GLOBALE des viewpoints sur tout le rapport.
// Garantit zéro doublon (jamais deux « V1 ») même sur des plans, zones ou onglets de
// visite différents — les marqueurs étaient auparavant numérotés par plan (V${vpCount+1}).
//
//  • vxxPhotoMap : badge affiché SUR la photo — clé `${locId}_${photoIdx}` → numéro.
//  • vpNumByPath : label du marqueur dessiné SUR le plan.
//    Lookup prioritaire : vp._vpId (string UUID stable après sérialisation JSON).
//    Fallback : référence objet (rétrocompat session courante sans rechargement).
//
// Le compteur est partagé : un marqueur et la photo qu'il vise portent le même numéro.
// Un marqueur non lié à une photo (photoIdx null) reçoit quand même un numéro unique.
export function computeVpNumbering(localisations) {
  const vxxPhotoMap = new Map();
  const vpNumByPath = new Map(); // double-keyed: object ref ET _vpId (si présent)
  const numByVpId   = new Map(); // _vpId → numéro : DÉDOUBLONNAGE cross-zone/plan (cf. ci-dessous)
  const numByFp     = new Map(); // empreinte contenu → numéro : DÉDOUBLONNAGE des marqueurs SANS _vpId
  const numByOriginPhoto = new Map(); // `${originLoc}_${photoIdx}` → numéro : rattache le Vxx à la photo de SA zone
  let g = 0;
  // Empreinte stable, INDÉPENDANTE de la zone : un même marqueur propagé sur plusieurs zones
  // partageant le plan a des coordonnées identiques → même empreinte → un seul numéro.
  // Inclut le planId pour que deux plans distincts ne collisionnent jamais.
  const fingerprint = (vp, planId) =>
    `${planId || '_'}|${Math.round(vp.x ?? -1)}|${Math.round(vp.y ?? -1)}|${vp.photoIdx ?? '_'}`;
  const _dbg = [];
  for (const loc of (localisations || [])) {
    // On garde le planId associé à chaque marqueur : plan principal = loc.planId, extra = ep.planId.
    const planPaths = [
      ...((loc.planAnnotations?.paths || []).map(vp => ({ vp, planId: loc.planId }))),
      ...((loc.extraPlans || []).flatMap(ep => (ep.planAnnotations?.paths || []).map(vp => ({ vp, planId: ep.planId })))),
    ];
    for (const { vp, planId } of planPaths) {
      if (vp.type !== 'viewpoint') continue;
      let num;
      let dedupPath = '?';
      const fp = fingerprint(vp, planId);
      // 0) vpNum FIGÉ : numéro attribué à la pose (ou migré) et stocké DANS le marqueur.
      //    C'est la source de vérité — jamais recalculé, survit à la propagation entre zones.
      // 1) _vpId (UUID stable) : dédoublonnage prioritaire des copies propagées.
      // 2) empreinte contenu : filet de sécurité pour les marqueurs anciens SANS _vpId.
      // 3) photoKey par zone d'origine : anciens marqueurs sans vpNum.
      if (vp.vpNum != null) {
        num = vp.vpNum; g = Math.max(g, num); dedupPath = 'frozen';
      } else if (vp._vpId && numByVpId.has(vp._vpId)) {
        // Priorité absolue : UUID stable → même marqueur propagé sur plusieurs zones.
        num = numByVpId.get(vp._vpId); dedupPath = 'vpId-dedup';
      } else if (numByFp.has(fp)) {
        num = numByFp.get(fp); dedupPath = 'fp-dedup';
      } else if (vp.photoIdx != null) {
        // Numéro rattaché à la photo de sa zone d'ORIGINE (originLocId voyage avec le marqueur
        // propagé) → deux marqueurs de la même photo (plan + coupe) partagent le numéro, MAIS
        // un marqueur propagé dans une autre zone ne collisionne plus avec la photo de même
        // index de la zone hôte. Repli sur loc.id pour les anciens marqueurs sans originLocId.
        const originLoc = vp.originLocId ?? loc.id;
        const key = `${originLoc}_${vp.photoIdx}`;
        if (numByOriginPhoto.has(key)) { num = numByOriginPhoto.get(key); dedupPath = 'photoKey-dedup'; }
        else { num = ++g; numByOriginPhoto.set(key, num); dedupPath = 'new-photoKey'; }
      } else {
        num = ++g; dedupPath = 'new-noPhoto';
      }
      // Badge photo de la zone HÔTE : uniquement pour les marqueurs qui appartiennent à CETTE
      // zone (origine = hôte, ou ancien marqueur sans origine) → un marqueur propagé d'une autre
      // zone ne vient pas écraser le badge de la photo locale de même index.
      if (vp.photoIdx != null && (vp.originLocId == null || vp.originLocId === loc.id)) {
        const k = `${loc.id}_${vp.photoIdx}`;
        if (!vxxPhotoMap.has(k)) vxxPhotoMap.set(k, num);
      }
      if (vp._vpId && !numByVpId.has(vp._vpId)) numByVpId.set(vp._vpId, num);
      if (!numByFp.has(fp)) numByFp.set(fp, num);
      vpNumByPath.set(vp, num);             // rétrocompat : objet ref
      if (vp._vpId) vpNumByPath.set(vp._vpId, num); // stable UUID → survit JSON round-trip
      _dbg.push({ locNom: loc.nom, locId: loc.id?.slice(0,8), planId: planId?.slice(0,8) ?? null, vpId: vp._vpId?.slice(0,8) ?? null, fp, num, dedupPath, x: Math.round(vp.x), y: Math.round(vp.y), photoIdx: vp.photoIdx });
    }
  }
  // Debug helper: window.__vpDebug() logs the full breakdown
  if (typeof window !== 'undefined') {
    window.__vpDebug = () => { console.table(_dbg); return `${g} numéros uniques attribués`; };
  }
  return { vxxPhotoMap, vpNumByPath, max: g };
}

// Lookup helper : 1) vpNum figé dans le marqueur (source de vérité),
// 2) _vpId (stable), 3) ref objet (compat ancien code).
export function getVpNum(vpNumByPath, vp) {
  if (vp?.vpNum != null) return vp.vpNum;
  if (!vpNumByPath) return null;
  const n = vp._vpId ? vpNumByPath.get(vp._vpId) : undefined;
  return n != null ? n : vpNumByPath.get(vp) ?? null;
}

// MIGRATION + RÉPARATION à l'ouverture du modal plan d'une zone.
// Fige un vpNum dans chaque marqueur viewpoint qui n'en a pas encore (numéro résolu par la
// numérotation globale, sinon numéro neuf), puis répare les violations des règles :
//   R1 : sur un MÊME plan, deux marqueurs distincts ne partagent jamais un numéro
//        → le second est renuméroté (cas des copies propagées d'une autre zone qui
//        collisionnaient avec la photo locale de même index — les « deux V1 »).
//   R2 : la même photo de la zone sur deux plans différents → même numéro
//        (clé photoIdx, marqueurs locaux uniquement).
// Les numéros figés sont persistés à l'enregistrement du plan et propagés aux zones
// partageant le plan → tout converge après un cycle ouvrir + enregistrer.
export function freezeVpNumsForZone(plans, vpNumByPath, vpBase = 0, locId = null) {
  if (!plans?.length) return plans;
  let maxNum = vpBase;
  for (const pl of plans) for (const a of (pl.planAnnotations?.paths || []))
    if (a.type === 'viewpoint' && a.vpNum != null) maxNum = Math.max(maxNum, a.vpNum);
  const byVpId  = new Map(); // _vpId → numéro : copies propagées = même marqueur = même numéro
  const byPhoto = new Map(); // photoIdx → numéro : R2, marqueurs locaux de la zone uniquement
  return plans.map(pl => {
    const paths = pl.planAnnotations?.paths;
    if (!paths?.length) return pl;
    const usedOnPlan = new Map(); // numéro → _vpId détenteur : R1 par plan
    let changed = false;
    const newPaths = paths.map(a => {
      if (a.type !== 'viewpoint') return a;
      const isLocal = a.originLocId == null || a.originLocId === locId;
      let num = a.vpNum
        ?? byVpId.get(a._vpId)
        ?? (isLocal && a.photoIdx != null ? byPhoto.get(a.photoIdx) : undefined)
        ?? (vpNumByPath ? getVpNum(vpNumByPath, a) : null);
      if (num == null) num = ++maxNum;
      // R1 : numéro déjà pris sur CE plan par un autre marqueur → renuméroter celui-ci
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
// Les viewpoints connus de la map reçoivent leur numéro global ; ceux créés dans la session
// courante (absents de la map) sont numérotés à la suite, à partir de `base` (max global).
// Surface partagée : aperçu plan (miniature), annotateur, rapport.
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
