// Numérotation Vxx GLOBALE des viewpoints sur tout le rapport.
// Garantit zéro doublon (jamais deux « V1 ») même sur des plans, zones ou onglets de
// visite différents — les marqueurs étaient auparavant numérotés par plan (V${vpCount+1}).
//
//  • vxxPhotoMap : badge affiché SUR la photo — clé `${locId}_${photoIdx}` → numéro.
//  • vpNumByPath : label du marqueur dessiné SUR le plan — clé = l'objet path → numéro.
//
// Le compteur est partagé : un marqueur et la photo qu'il vise portent le même numéro.
// Deux marqueurs visant la même photo (même photoIdx dans la même zone) partagent le numéro.
// Un marqueur non lié à une photo (photoIdx null, ancien) reçoit quand même un numéro unique.
// Itère TOUTES les localisations dans l'ordre → numéros identiques en mode inline et
// en mode « plans en fin », et entre l'aperçu écran et le PDF.
export function computeVpNumbering(localisations) {
  const vxxPhotoMap = new Map();
  const vpNumByPath = new Map();
  let g = 0;
  for (const loc of (localisations || [])) {
    const planPaths = [
      ...(loc.planAnnotations?.paths || []),
      ...((loc.extraPlans || []).flatMap(ep => ep.planAnnotations?.paths || [])),
    ];
    for (const vp of planPaths) {
      if (vp.type !== 'viewpoint') continue;
      let num;
      if (vp.photoIdx != null) {
        const key = `${loc.id}_${vp.photoIdx}`;
        if (vxxPhotoMap.has(key)) num = vxxPhotoMap.get(key); // même photo → même numéro
        else { num = ++g; vxxPhotoMap.set(key, num); }
      } else {
        num = ++g; // marqueur non lié à une photo : numéro unique quand même
      }
      vpNumByPath.set(vp, num);
    }
  }
  return { vxxPhotoMap, vpNumByPath };
}
