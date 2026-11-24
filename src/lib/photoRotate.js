// ROTATION D'UNE PHOTO (demande Thomas 16/11 : « photo prise en paysage affichée en portrait,
// pouvoir la tourner depuis le PC »).
//
// Principe — ZÉRO PERTE :
//   • l'image tournée devient une NOUVELLE version de la photo (nouveau fichier dans Storage,
//     via la file d'upload habituelle) ; la ligne photo garde son ID stable (_id) → aucune
//     ligne créée ni supprimée, seul son chemin de fichier change ;
//   • l'ancien fichier n'est jamais supprimé (il reste dans Storage) ;
//   • uniquement sur une photo SANS annotation (tourner des annotations existantes risquerait
//     de les décaler : on ne le fait pas, le bouton l'explique).

import { enqueuePhotoUpload } from './photoUploadQueue.js';
import { setPhotoPref } from './photoPrefs.js';
import { getPhotoQualityParams } from './uiPrefs.js';

// Angle normalisé (90 = sens horaire, -90 = antihoraire) → 0 / 90 / 180 / 270.
export const normDeg = (deg) => ((Math.round(Number(deg) / 90) * 90) % 360 + 360) % 360;
export const rotatedSize = (w, h, deg) => (normDeg(deg) % 180 === 0 ? { w, h } : { w: h, h: w });
export const canRotatePhoto = (ph) => !!ph?.data && !(ph.annotations && ph.annotations.length);

// src (data URL ou URL signée) → { dataUrl, w, h } tournée, ou null si impossible.
// Passe par fetch → blob → objectURL : jamais de canvas « contaminé » par une URL distante.
export async function rotateImageSrc(src, deg) {
  const d = normDeg(deg);
  let objUrl = null;
  try {
    const blob = await (await fetch(src)).blob();
    objUrl = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = objUrl; });
    const { w, h } = rotatedSize(img.naturalWidth, img.naturalHeight, d);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.translate(w / 2, h / 2);
    ctx.rotate((d * Math.PI) / 180);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    const { q } = getPhotoQualityParams();
    let dataUrl = cv.toDataURL('image/webp', Math.max(q, 0.85));
    if (!dataUrl.startsWith('data:image/webp')) dataUrl = cv.toDataURL('image/jpeg', Math.max(q, 0.85));
    return { dataUrl, w, h };
  } catch { return null; }
  finally { if (objUrl) URL.revokeObjectURL(objUrl); }
}

// Photo (objet de l'app) → nouvelle photo tournée + envoi du nouveau fichier. null si impossible.
// ctx = { projetNom, projetId, itemId } (pour le chemin Storage).
export async function rotatePhoto(ph, deg, { projetNom, projetId, itemId } = {}) {
  if (!canRotatePhoto(ph)) return null;
  const out = await rotateImageSrc(ph.data, deg);
  if (!out) return null;
  const ext = out.dataUrl.startsWith('data:image/webp') ? 'webp' : 'jpg';
  const name = String(ph.name || 'photo').replace(/\.[^.]+$/, '') + '.' + ext;
  const uploadId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  // Cadre du rapport : suit la nouvelle forme de la photo (paysage ↔ portrait), recentré.
  const frame = { orient: out.w >= out.h ? 'landscape' : 'portrait', cropX: 50, cropY: 50, cropFit: false };
  if (ph._id) setPhotoPref(ph._id, frame);
  if (projetId && itemId) enqueuePhotoUpload({ uploadId, projetNom, projetId, itemId, name, dataUrl: out.dataUrl });
  // storage_url retiré : la sauvegarde reprend le chemin du NOUVEAU fichier (file d'upload, ou
  // envoi direct de data si la file n'est pas encore passée).
  // Image « annotée » déjà enregistrée (photo passée par l'éditeur, même sans trait) : on la
  // REMPLACE par la photo tournée (sans annotation, c'est la même image). La laisser à null
  // ne l'effacerait pas en base → l'ancienne version non tournée reviendrait au rechargement.
  const hadComposite = !!(ph.annotated || ph.annotated_storage_url);
  // _annotReset : si aucune image annotée n'est connue ICI, la base peut quand même en avoir une
  // (ancienne, non tournée) → la sauvegarde l'efface (storage.js), sinon elle revenait au rechargement.
  return { ...ph, data: out.dataUrl, name, storage_url: null, _uploadId: uploadId,
    annotated: hadComposite ? out.dataUrl : null, annotated_storage_url: null, _annotReset: !hadComposite, ...frame };
}
