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
// Deux marqueurs visant la même photo (même photoIdx dans la même zone) partagent le numéro.
// Un marqueur non lié à une photo (photoIdx null, ancien) reçoit quand même un numéro unique.
export function computeVpNumbering(localisations) {
  const vxxPhotoMap = new Map();
  const vpNumByPath = new Map(); // double-keyed: object ref ET _vpId (si présent)
  const numByVpId   = new Map(); // _vpId → numéro : DÉDOUBLONNAGE cross-zone/plan (cf. ci-dessous)
  let g = 0;
  for (const loc of (localisations || [])) {
    const planPaths = [
      ...(loc.planAnnotations?.paths || []),
      ...((loc.extraPlans || []).flatMap(ep => ep.planAnnotations?.paths || [])),
    ];
    for (const vp of planPaths) {
      if (vp.type !== 'viewpoint') continue;
      let num;
      // Un même marqueur (même _vpId) peut apparaître dans PLUSIEURS zones partageant le plan
      // (propagation des annotations). Sans dédoublonnage il était recompté à chaque zone →
      // V1 devenait V3, V4… Ici on lui réattribue TOUJOURS son premier numéro.
      if (vp._vpId && numByVpId.has(vp._vpId)) {
        num = numByVpId.get(vp._vpId);
      } else if (vp.photoIdx != null) {
        const key = `${loc.id}_${vp.photoIdx}`;
        if (vxxPhotoMap.has(key)) num = vxxPhotoMap.get(key);
        else { num = ++g; vxxPhotoMap.set(key, num); }
      } else {
        num = ++g;
      }
      if (vp._vpId && !numByVpId.has(vp._vpId)) numByVpId.set(vp._vpId, num);
      vpNumByPath.set(vp, num);             // rétrocompat : objet ref
      if (vp._vpId) vpNumByPath.set(vp._vpId, num); // stable UUID → survit JSON round-trip
    }
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
