// RÉGLAGES PHOTO (retours terrain Thomas 16/11) — mémorisés sur l'appareil, réglés là où on s'en
// sert (jamais dans les Paramètres).
//   • placeAfterPhoto(visiteId) : après une photo, ouvrir le plan pour la repérer. Interrupteur sur
//     la TUILE de la visite — vaut pour toutes ses observations. Défaut : oui.
//   • useAppCamera : interrupteur « Rafale » de l'observation. Oui (défaut) = viseur de l'app
//     (rafale sans validation, zoom, bouton « Placer ») ; non = appareil photo du téléphone.
//   • galleryCopy : copie automatique dans la galerie — COUPÉE (voir getGalleryCopy).

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
export const getUseAppCamera = () => get('chantierai_app_camera') !== '0';
export const setUseAppCamera = (on) => set('chantierai_app_camera', on ? '1' : '0');
// Retour Thomas 16/11 (définitif) : « le pop-up de téléchargement ne doit ABSOLUMENT pas apparaître à
// l'écran ; le mieux est de ne rien avoir ». Une app web ne peut ni écrire dans la galerie sans ce
// message, ni le reléguer dans la barre de notifications → copie automatique COUPÉE (aucun message).
// Les photos restent sur le serveur + le Drive.
export const getGalleryCopy = () => false;

// « Placer » depuis le viseur : après le repérage sur le plan, on ROUVRE le viseur (rafale).
// Drapeau de session (le repérage sur le plan de ZONE quitte puis rouvre l'observation).
let _reopenCamera = false;
export const markReopenCamera = () => { _reopenCamera = true; };
export const consumeReopenCamera = () => { const v = _reopenCamera; _reopenCamera = false; return v; };
