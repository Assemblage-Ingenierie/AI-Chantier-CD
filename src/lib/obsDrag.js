// Observation en cours de glisser-déposer (PC) — partagée entre les listes d'observations de
// chaque zone (une SortList par zone) et les cartes de zone (VueProjet), comme planDrag.js.
// Demande Thomas 16/11 : « déplacer une observation dans une autre zone (même vide) en
// glisser-déposer ». payload : { fromLocId, itemId, dropped }
let _payload = null;
export const getObsDrag = () => _payload;
export function startObsDrag(p) {
  _payload = { ...p, dropped: false };
  try { window.dispatchEvent(new Event('ai-obs-drag-start')); } catch { /* hors navigateur */ }
}
// Déposée ailleurs que dans sa liste d'origine → la liste d'origine ne réordonne pas au dragend.
export function markObsDropped() { if (_payload) _payload.dropped = true; }
export function endObsDrag() {
  _payload = null;
  try { window.dispatchEvent(new Event('ai-obs-drag-end')); } catch { /* hors navigateur */ }
}
