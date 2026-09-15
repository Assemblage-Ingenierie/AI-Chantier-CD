// ── Compteur global des modifications NON SYNCHRONISÉES (projets « dirty ») ──────
// Miroir léger, en lecture seule, du nombre de projets modifiés localement mais pas
// encore enregistrés sur Supabase (dirtyIds). Publié depuis useProjets (un seul point :
// syncDirtyMirror) et consommé par le bandeau global (OfflineBanner) pour indiquer
// clairement à l'utilisateur que son travail est capturé et « en attente de synchro »
// (retour Thomas : « indique quand c'est pas à jour »). N'écrit AUCUNE donnée, ne touche
// NI saveRemote NI mergeWithLocal : purement informatif.

let _count = 0;
const _subs = new Set();

export function publishPendingCount(n) {
  const v = Number(n) || 0;
  if (v === _count) return;
  _count = v;
  for (const cb of _subs) { try { cb(_count); } catch { /* noop */ } }
}

export function getPendingCount() { return _count; }

// S'abonner au compteur. Appelle immédiatement avec la valeur courante. Renvoie un
// désabonnement.
export function subscribePendingChanges(cb) {
  _subs.add(cb);
  try { cb(_count); } catch { /* noop */ }
  return () => _subs.delete(cb);
}
