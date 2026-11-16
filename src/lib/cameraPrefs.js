// RÉGLAGES PHOTO (retours terrain Thomas 16/11) — mémorisés sur l'appareil, JAMAIS dans les
// Paramètres : on les règle là où on en a besoin.
//   • placeAfterPhoto(visiteId) : après une photo, ouvrir le plan pour la repérer. Interrupteur sur
//     la TUILE de la visite (page des visites) — vaut pour toutes ses observations. Défaut : oui.
//   • galleryCopy : copie automatique dans la galerie (Android). DÉSACTIVÉE (retour Thomas : « je ne
//     veux pas le pop-up de téléchargement ») — une app web ne peut pas écrire dans la galerie sans
//     que le navigateur l'affiche. Les photos restent sur le serveur + Drive ; bouton « Enreg. »
//     pour une copie à la demande.

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* mode privé */ } };
const placeKey = (visiteId) => `chantierai_place_after_photo${visiteId ? `_${visiteId}` : ''}`;

export const getPlaceAfterPhoto = (visiteId = null) => {
  const v = get(placeKey(visiteId));
  if (v === '0') return false;
  if (v === '1') return true;
  return get(placeKey(null)) !== '0'; // défaut : oui
};
export const setPlaceAfterPhoto = (visiteId, on) => set(placeKey(visiteId), on ? '1' : '0');
export const getGalleryCopy = () => get('chantierai_gallery_copy') === '1';
