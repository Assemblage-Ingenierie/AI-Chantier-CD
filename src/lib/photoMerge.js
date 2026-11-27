// PHOTOS À PLUSIEURS — garde-fou à l'ENREGISTREMENT d'une observation (retour Thomas 27/10 :
// « on peut être à deux à prendre des photos »).
//
// La fenêtre d'observation travaille sur une COPIE prise à l'ouverture. Si un collègue ajoute
// une photo à la même observation pendant ce temps (elle arrive dans l'état du projet par la
// synchro), « Enregistrer » renvoyait la liste de la fenêtre SANS elle → la sauvegarde la
// supprimait en base (photo connue au chargement, absente de la liste envoyée).
// Ici : toute photo présente MAINTENANT dans l'état, inconnue de la fenêtre (ni à l'ouverture,
// ni dans ce qu'elle enregistre), est CONSERVÉE (ajoutée à la fin). Une photo supprimée dans la
// fenêtre était connue à l'ouverture → elle n'est pas remise.
export const photoKey = (ph) => (ph && (ph._id || ph.id || ph._uploadId)) || null;

export function keepCollaboratorPhotos(basePhotos, savedPhotos, currentPhotos) {
  const saved = savedPhotos || [];
  const known = new Set([...(basePhotos || []), ...saved].map(photoKey).filter(Boolean));
  const extra = (currentPhotos || []).filter(ph => { const k = photoKey(ph); return k && !known.has(k); });
  return extra.length ? [...saved, ...extra] : saved;
}

// RECHARGEMENT — photos LOCALES à garder en plus de celles lues en base pour une observation
// (anti-orphelin : photo prise ici dont la ligne item_photos n'existe pas encore). Incident
// 27/11 (Thomas, ~30 photos déplacées d'une observation à l'autre puis rechargement) : une
// photo DÉPLACÉE est, selon que la sauvegarde ou le cache local était en retard, absente de
// la base pour l'une des deux observations mais présente dans son état local → elle était
// gardée des DEUX côtés → photos en double. Règle : une photo locale n'est gardée que si son
// id n'existe NULLE PART dans la lecture base (toutes observations confondues) — sinon la base
// dit déjà où elle est.
export function localOrphansToKeep(localPhotos, dbIdsAll) {
  return (localPhotos || []).filter(p => p && p._id && !dbIdsAll.has(p._id) && (p.data || p.annotated));
}
