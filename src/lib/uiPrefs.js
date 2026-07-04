import { useEffect, useState } from 'react';

// Préférence de taille d'interface — appliquée UNIQUEMENT aux écrans de listes/fiches
// (dashboard, liste des visites, contenu d'une visite) via la classe `.ui-scale-*`.
// JAMAIS sur l'Annotator (canvas calibré au pixel) ni sur l'aperçu Rapport (format A4).
// Implémentée via `zoom` CSS : texte, boutons et espacements grandissent ensemble, donc
// aucun risque de casser une mise en page (contrairement à un simple font-size).

const KEY = '_ui_scale_v1';
const VALID = ['compact', 'normal', 'large'];
const EVT = '_ui_scale_change';

export function getUiScale() {
  try { const v = localStorage.getItem(KEY); return VALID.includes(v) ? v : 'normal'; }
  catch { return 'normal'; }
}

export function setUiScale(v) {
  if (!VALID.includes(v)) return;
  try { localStorage.setItem(KEY, v); } catch {}
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: v })); } catch {}
}

// Classe CSS à poser sur un conteneur de liste/fiche scalable.
export function uiScaleClass(scale) {
  return scale === 'compact' ? 'ui-scale-compact' : scale === 'large' ? 'ui-scale-large' : '';
}

// Hook réactif : renvoie l'échelle courante et se met à jour au changement (même onglet).
export function useUiScale() {
  const [scale, setScale] = useState(getUiScale);
  useEffect(() => {
    const onChange = () => setScale(getUiScale());
    window.addEventListener(EVT, onChange);
    window.addEventListener('storage', onChange); // autre onglet
    return () => { window.removeEventListener(EVT, onChange); window.removeEventListener('storage', onChange); };
  }, []);
  return scale;
}
