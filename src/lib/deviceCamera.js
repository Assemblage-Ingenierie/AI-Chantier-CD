// PHOTOS : même comportement sur tous les téléphones (retour Thomas 10/11 — Pierre sur Samsung,
// Thibaud sur un vieux Pixel). Logique PURE (testée) + petits accès navigateur isolés.
//
// 1) Copie dans le téléphone : APRÈS chaque photo prise, une copie part dans le téléphone.
//    • Android : téléchargement automatique (dossier Téléchargements, visible dans la Galerie).
//      Le nom est UNIQUE à chaque photo → plus de « Télécharger à nouveau ? » (avant, toutes les
//      photos s'appelaient « image.webp » : Chrome redemandait à chaque fois). On copie la photo
//      D'ORIGINE en JPG (avant : la version compressée WebP).
//    • iPhone : Apple interdit à une app web d'écrire dans Photos sans geste de l'utilisateur →
//      pas de copie automatique ; bouton « Enreg. » (feuille de partage → « Enregistrer N images »).
//    • PC : rien (pas de téléchargement surprise).
// 2) Viseur intégré (CameraCapture) : orientation des photos prises téléphone à l'horizontale
//    quand l'écran est verrouillé en portrait (app installée) → captureRotation().

export function platformOf(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : ''), maxTouch = (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0)) {
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1); // iPadOS se dit « Mac »
  const isAndroid = /Android/i.test(ua);
  return { isIOS, isAndroid, isMobile: isIOS || isAndroid || /Mobi/i.test(ua) };
}

const slug = (s) => String(s || 'chantier').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'chantier';
const pad = (n) => String(n).padStart(2, '0');

// Nom UNIQUE et lisible dans la Galerie : AIChantier_Grasse_20261110-143512_7f3a.jpg
export function photoCopyName(projetNom, date = new Date(), rand = Math.random) {
  const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const r = Math.floor(rand() * 0xffff).toString(16).padStart(4, '0');
  return `AIChantier_${slug(projetNom)}_${d}_${r}.jpg`;
}

// Copie automatique dans le téléphone — ANDROID uniquement (cf. en-tête). Ne rejette jamais.
// → true si une copie a été lancée.
export function autoCopyToPhone(fileOrBlob, projetNom, plat = platformOf()) {
  if (!plat.isAndroid || !fileOrBlob) return false;
  try {
    const url = URL.createObjectURL(fileOrBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = photoCopyName(projetNom);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  } catch { return false; }
}

// Viseur intégré : de combien tourner l'image capturée (degrés, sens horaire) pour qu'elle soit
// à l'endroit. uiAngle = rotation actuelle de l'ÉCRAN (screen.orientation.angle) ; beta / gamma =
// inclinaison physique (DeviceOrientationEvent : beta avant/arrière, gamma gauche/droite).
//   • écran déjà tourné (paysage affiché) → les images de la caméra suivent l'écran → 0 ;
//   • écran verrouillé en portrait, téléphone tenu à l'horizontale :
//       côté droit vers le bas (gamma > 0) → +90 ; côté gauche vers le bas (gamma < 0) → -90 ;
//   • à plat ou inconnu → 0 (on ne devine pas).
export function captureRotation({ uiAngle = 0, beta = null, gamma = null } = {}) {
  const ui = ((Number(uiAngle) || 0) % 360 + 360) % 360;
  if (ui !== 0) return 0;
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return 0;
  if (Math.abs(gamma) >= 55 && Math.abs(beta) <= 50) return gamma > 0 ? 90 : -90;
  if (beta <= -55) return 180; // tête en bas
  return 0;
}

// iPhone : la lecture de l'orientation (pour redresser les photos prises à l'horizontale) exige
// une autorisation demandée PENDANT un geste (appui sur « Photo »). Demandée une fois ; un refus
// ne bloque rien (les photos restent dans le sens de l'écran). Android / PC : rien à demander.
let _motionAsked = false;
export function requestOrientationAccess() {
  try {
    const D = typeof window !== 'undefined' ? window.DeviceOrientationEvent : null;
    if (_motionAsked || !D || typeof D.requestPermission !== 'function') return;
    _motionAsked = true;
    D.requestPermission().catch(() => {});
  } catch { /* ignore */ }
}
