import { useState } from 'react';

// Taille d'interface UNIQUE (demande Thomas : les 3 modes Compact/Normal/Grand créaient de
// la confusion, et seul un rendu « un cran plus grand » était pertinent — mais le 1.12 du
// mode Grand faisait déborder les cases). Une seule échelle calibrée (1.08), appliquée aux
// écrans de listes/fiches via `.ui-scale-app` — JAMAIS à l'Annotator (canvas calibré au
// pixel) ni à l'aperçu Rapport (format A4). Implémentée via `zoom` CSS : texte, boutons et
// espacements grandissent ensemble.
// L'API (getUiScale/setUiScale/useUiScale/uiScaleClass) est conservée pour ne pas casser
// les composants appelants — elle renvoie désormais toujours l'échelle unique.

export function getUiScale() { return 'app'; }

export function setUiScale() { /* taille unique — réglage supprimé */ }

// Classe CSS à poser sur un conteneur de liste/fiche scalable.
export function uiScaleClass() {
  return 'ui-scale-app';
}

// Hook réactif conservé pour compatibilité — l'échelle ne change plus.
export function useUiScale() {
  const [scale] = useState('app');
  return scale;
}

// ── Qualité photo à la capture (optionnel, défaut = normale) ─────────────────────
// Règle le compromis netteté / poids AU MOMENT de la prise. Le budget d'export PDF
// (< 5 Mo) recompresse de toute façon les photos → « max » reste envoyable, il donne
// juste des photos plus nettes dans l'app et un point de départ de meilleure qualité.
const PHOTO_QUALITY_KEY = 'chantierai_photo_quality';
const PHOTO_QUALITY = {
  light:  { max: 1200, q: 0.72 }, // plus léger (cache/envoi plus rapides)
  normal: { max: 1600, q: 0.82 }, // défaut (comportement historique)
  max:    { max: 2200, q: 0.90 }, // plus net (photos plus lourdes)
};
export function getPhotoQuality() {
  try { const v = localStorage.getItem(PHOTO_QUALITY_KEY); return PHOTO_QUALITY[v] ? v : 'normal'; }
  catch { return 'normal'; }
}
export function setPhotoQuality(v) {
  try { localStorage.setItem(PHOTO_QUALITY_KEY, PHOTO_QUALITY[v] ? v : 'normal'); } catch { /* mode privé */ }
}
export function getPhotoQualityParams() {
  return PHOTO_QUALITY[getPhotoQuality()] || PHOTO_QUALITY.normal;
}
