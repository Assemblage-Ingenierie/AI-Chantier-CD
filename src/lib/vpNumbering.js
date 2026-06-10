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
      // Un même marqueur peut apparaître dans PLUSIEURS zones partageant le plan (propagation).
      // Sans dédoublonnage il était recompté à chaque zone → V1 devenait V3, V4…
      // 1) _vpId (UUID stable) : dédoublonnage prioritaire quand présent.
      // 2) empreinte contenu : filet de sécurité pour les marqueurs anciens SANS _vpId.
      // IMPORTANT : photoKey-dedup (branche 3) est réservé aux anciens marqueurs sans _vpId.
      // Les marqueurs avec _vpId ont chacun leur propre numéro — grouper par photoIdx des
      // marqueurs avec _vpId provoque des doublons V1 quand des annotations propagées entre
      // zones ont le même photoIdx local (ex. zone A et zone B ayant chacune leur photo 0).
      if (vp._vpId && numByVpId.has(vp._vpId)) {
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

// Lookup helper : préfère _vpId (stable), bascule sur ref objet (compat ancien code).
export function getVpNum(vpNumByPath, vp) {
  if (!vpNumByPath) return null;
  const n = vp._vpId ? vpNumByPath.get(vp._vpId) : undefined;
  return n != null ? n : vpNumByPath.get(vp) ?? null;
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
