// Numérotation Vxx des viewpoints — basée sur l'IDENTITÉ STABLE de la photo (et non sur un
// index positionnel fragile).
//
// Règles métier (cf. demandes utilisateur) :
//   1. Une photo = un seul angle par plan → jamais deux fois le même Vxx sur un même plan.
//   2. La MÊME photo annotée sur DEUX plans différents porte le MÊME Vxx.
//   3. Deux photos DIFFÉRENTES ont des Vxx différents.
//
// Chaque photo possède un `id` stable (id de ligne Supabase, ou UUID attribué à la création).
// On numérote chaque photo unique référencée par au moins un marqueur viewpoint :
//   • numByPhotoId : id photo → numéro (cœur de la logique, garantit les 3 règles).
//   • vpNumByPath  : marqueur (ref objet OU _vpId) → numéro, pour dessiner le label sur le plan.
//   • vxxPhotoMap  : `${locId}_${indexPhotoDansZone}` → numéro, pour le badge affiché SUR la photo.
//
// Les anciens marqueurs sans `photoId` sont rattachés à la photo via leur `photoIdx` positionnel
// (résolu sur la liste de photos courante de la zone) ; à défaut (photos non hydratées) on retombe
// sur une clé positionnelle par zone — comportement historique, sans régression.
export function computeVpNumbering(localisations) {
  const vxxPhotoMap = new Map();
  const vpNumByPath = new Map();
  const numByPhotoId = new Map();
  let g = 0;

  // Liste ordonnée des photos par zone — MÊME filtre que l'annotateur (PlanLocModal) et le
  // rapport : items.flatMap(photos.filter(data)). L'index dans cette liste = badge photo.
  const zonePhotosByLoc = new Map();
  for (const loc of (localisations || [])) {
    zonePhotosByLoc.set(loc.id, (loc.items || []).flatMap(it => (it.photos || []).filter(ph => ph.data)));
  }

  // Identité stable de la photo visée par un marqueur.
  const resolvePhotoKey = (loc, vp) => {
    if (vp.photoId) return vp.photoId;
    const zp = zonePhotosByLoc.get(loc.id);
    if (zp && vp.photoIdx != null && zp[vp.photoIdx]?.id) return zp[vp.photoIdx].id;
    return vp.photoIdx != null ? `${loc.id}#${vp.photoIdx}` : null; // repli historique
  };

  // 1) Numérote chaque photo unique (par identité), tous plans/zones confondus.
  for (const loc of (localisations || [])) {
    const planPaths = [
      ...((loc.planAnnotations?.paths || [])),
      ...((loc.extraPlans || []).flatMap(ep => ep.planAnnotations?.paths || [])),
    ];
    for (const vp of planPaths) {
      if (vp.type !== 'viewpoint') continue;
      const key = resolvePhotoKey(loc, vp);
      let num;
      if (key != null && numByPhotoId.has(key)) num = numByPhotoId.get(key);
      else { num = ++g; if (key != null) numByPhotoId.set(key, num); }
      vpNumByPath.set(vp, num);                 // rétrocompat : ref objet
      if (vp._vpId) vpNumByPath.set(vp._vpId, num); // stable : survit au round-trip JSON
      if (key != null) vpNumByPath.set(`photo:${key}`, num); // lookup par identité photo (label live)
    }
  }

  // 2) Badges photo : la photo à l'index i d'une zone porte le numéro de son identité.
  for (const loc of (localisations || [])) {
    (zonePhotosByLoc.get(loc.id) || []).forEach((ph, i) => {
      if (ph.id && numByPhotoId.has(ph.id)) vxxPhotoMap.set(`${loc.id}_${i}`, numByPhotoId.get(ph.id));
    });
  }

  if (typeof window !== 'undefined') {
    window.__vpDebug = () => { console.table([...numByPhotoId.entries()].map(([k, v]) => ({ photoId: String(k).slice(0, 12), num: v }))); return `${g} numéros uniques`; };
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
// Les viewpoints connus de la map reçoivent leur numéro ; ceux créés dans la session courante
// (absents de la map) sont numérotés à la suite, à partir de `base` (max global).
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
