// VERROU D'ÉDITION — empêche le rechargement automatique de mise à jour (service worker, cf.
// main.jsx) pendant qu'un éditeur est ouvert (annotateur, fiche observation).
//
// INCIDENT 2026-10-15 (Thomas) : « en faisant des MAJ tu as supprimé un de mes plans avec tout ce
// que j'avais écrit dessus ». Chaque mise en production rechargeait l'app IMMÉDIATEMENT, y compris
// au milieu d'une annotation non enregistrée. Désormais la mise à jour attend que l'éditeur soit
// fermé (enregistré) ; elle s'applique juste après.
import { useEffect } from 'react';

export function editLockCount() {
  try { return Number(window.__chantieraiEditLocks) || 0; } catch { return 0; }
}

export function useEditLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    window.__chantieraiEditLocks = editLockCount() + 1;
    return () => {
      window.__chantieraiEditLocks = Math.max(0, editLockCount() - 1);
      try { window.dispatchEvent(new Event('chantierai:editlock')); } catch { /* ignore */ }
    };
  }, [active]);
}
