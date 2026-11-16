// Plan en cours de glisser-déposer (PC) — partagé entre la liste des observations (SortList) et
// les miniatures de plans de zone / d'observation (VueProjet). Comme pour les photos, le
// dataTransfer ne se relit pas toujours d'une zone à l'autre → charge module-level.
// payload : { kind:'zone', locId, idx } | { kind:'item', locId, itemId, entryId }
let _payload = null;
export const getPlanDrag = () => _payload;
export function startPlanDrag(p) {
  _payload = p;
  try { window.dispatchEvent(new Event('ai-plan-drag-start')); } catch { /* hors navigateur */ }
}
export function endPlanDrag() {
  _payload = null;
  try { window.dispatchEvent(new Event('ai-plan-drag-end')); } catch { /* hors navigateur */ }
}
