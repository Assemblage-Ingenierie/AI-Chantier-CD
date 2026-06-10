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
//   • vxxPhotoMap : badge affiché SUR la photo — clé `${locId}_${photoIdx}` → numéro.
//   • vpNumByPath : label du marqueur (clé : ref objet ET _vpId).
export function computeVpNumbering(localisations) {
  const vxxPhotoMap = new Map();
  const vpNumByPath = new Map();
  const groupNum    = new Map(); // groupKey → numéro
  const usedNums    = new Set();
  let g = 0;
  const nextFree = () => { do { g++; } while (usedNums.has(g)); usedNums.add(g); return g; };

  const fp = (vp) => `${Math.round(vp.x ?? -1)}|${Math.round(vp.y ?? -1)}|${vp.photoIdx ?? '_'}`;
  const groupKey = (vp) =>
    (vp.originLocId != null && vp.photoIdx != null) ? `O:${vp.originLocId}_${vp.photoIdx}`
    : vp._vpId ? `I:${vp._vpId}`
    : `F:${fp(vp)}`;

  for (const loc of (localisations || [])) {
    const planPaths = [
      ...((loc.planAnnotations?.paths || [])),
      ...((loc.extraPlans || []).flatMap(ep => ep.planAnnotations?.paths || [])),
    ];
    for (const vp of planPaths) {
      if (vp.type !== 'viewpoint') continue;
      const key = groupKey(vp);
      let num = groupNum.get(key);
      if (num == null) {
        // Conserve le numéro figé s'il est libre (stabilité) ; sinon prend le prochain libre.
        if (vp.vpNum != null && !usedNums.has(vp.vpNum)) { num = vp.vpNum; usedNums.add(num); g = Math.max(g, num); }
        else num = nextFree();
        groupNum.set(key, num);
      }
      vpNumByPath.set(vp, num);
      if (vp._vpId) vpNumByPath.set(vp._vpId, num);
      // Badge photo de la zone HÔTE : seulement pour les marqueurs qui lui appartiennent
      // (origine = hôte, ou ancien marqueur sans origine) → un marqueur propagé d'une autre
      // zone n'écrase pas le badge de la photo locale de même index.
      if (vp.photoIdx != null && (vp.originLocId == null || vp.originLocId === loc.id)) {
        const k = `${loc.id}_${vp.photoIdx}`;
        if (!vxxPhotoMap.has(k)) vxxPhotoMap.set(k, num);
      }
    }
  }
  return { vxxPhotoMap, vpNumByPath, max: g };
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
