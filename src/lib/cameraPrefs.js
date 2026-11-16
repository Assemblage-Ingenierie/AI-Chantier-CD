// RÉGLAGES PHOTO DU TÉLÉPHONE (retours terrain Thomas 16/11) — mémorisés sur l'appareil, jamais
// redemandés. Rien à remplir : les valeurs par défaut donnent le comportement voulu.
//   • cameraMode   : 'phone' (DÉFAUT — l'appareil photo du téléphone : grand angle, zoom, flash…)
//                    ou 'app' (viseur intégré : rafale sans quitter l'app) ;
//   • placeAfterPhoto : après une photo, ouvrir le plan pour la repérer (DÉFAUT : oui) ;
//   • galleryCopy  : Android — copie automatique de chaque photo dans la galerie (DÉFAUT : oui).
//     Le navigateur affiche alors son message « téléchargement » : impossible de le masquer depuis
//     une app web. Désactiver la copie = plus de message (les photos restent sur le serveur/Drive).

const K = { mode: 'chantierai_camera_mode', place: 'chantierai_place_after_photo', gallery: 'chantierai_gallery_copy' };
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* mode privé */ } };

export const getCameraMode = () => (get(K.mode) === 'app' ? 'app' : 'phone');
export const setCameraMode = (m) => set(K.mode, m === 'app' ? 'app' : 'phone');
export const getPlaceAfterPhoto = () => get(K.place) !== '0';
export const setPlaceAfterPhoto = (on) => set(K.place, on ? '1' : '0');
export const getGalleryCopy = () => get(K.gallery) !== '0';
export const setGalleryCopy = (on) => set(K.gallery, on ? '1' : '0');
