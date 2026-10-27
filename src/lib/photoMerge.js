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
