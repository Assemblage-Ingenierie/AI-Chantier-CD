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
