// CORBEILLE par projet (Thomas, 13/10/2026) — logique PURE de restauration (testée), sans I/O.
// Règle d'or : une restauration AJOUTE, elle ne supprime ni n'écrase jamais rien.

import { orderZones } from './zoneGroups.js';
import { unmergedTitle } from './zoneMerge.js';

const findItemZone = (locs, id) => locs.find(l => (l.items || []).some(i => i.id === id));

// Remet une observation supprimée. Zone d'origine disparue → recréée (même nom) à la fin.
// → { locs, ok, already, reason, liftIds }
export function restoreItemInLocs(locs, entry) {
  const item = entry?.item;
  if (!item?.id) return { locs, ok: false, reason: 'invalid' };
  if (findItemZone(locs, item.id)) return { locs, ok: true, already: true, liftIds: [item.id] };
  if (locs.some(l => l.id === entry.locId && !l._mergedInto)) {
    return {
      locs: locs.map(l => (l.id === entry.locId ? { ...l, items: [...(l.items || []), item] } : l)),
      ok: true, liftIds: [item.id],
    };
  }
  const zone = { id: crypto.randomUUID(), nom: entry.locNom || 'Zone restaurée', items: [item], planBg: null, planData: null, planAnnotations: null };
  return { locs: [...locs, zone], ok: true, recreated: true, liftIds: [item.id] };
}

// Remet une zone supprimée (ou fusionnée) avec ses plans, annotations et observations.
//   • suppression : les observations qui n'existent plus sont remises ; celles qui vivent ailleurs
//     (déplacées AVANT la suppression) n'y sont pas reprises.
//   • fusion (« annuler la fusion ») : les observations sont RAMENÉES depuis la zone où elles sont
//     aujourd'hui (version actuelle, préfixe de fusion retiré) — rien n'est dupliqué.
// → { locs, ok, already, liftIds }
export function restoreZoneInLocs(locs, entry) {
  const z = entry?.loc;
  if (!z?.id) return { locs, ok: false, reason: 'invalid' };
  if (locs.some(l => l.id === z.id && !l._mergedInto)) return { locs, ok: true, already: true, liftIds: [z.id] };
  const fusion = entry.reason === 'fusion';
  let rest = locs.filter(l => l.id !== z.id); // coquille vide « _mergedInto » éventuelle
  const items = [];
  const liftIds = [z.id];
  for (const it of (z.items || [])) {
    const holder = findItemZone(rest, it.id);
    if (holder) {
      if (!fusion) continue;
      const cur = holder.items.find(i => i.id === it.id);
      rest = rest.map(l => (l.id === holder.id ? { ...l, items: l.items.filter(i => i.id !== it.id) } : l));
      items.push({ ...cur, titre: unmergedTitle(cur.titre, z.nom) });
    } else {
      items.push(it);
      liftIds.push(it.id);
    }
  }
  const { _mergedInto, ...clean } = z;
  const zone = { ...clean, items, parentId: z.parentId && rest.some(l => l.id === z.parentId) ? z.parentId : null };
  let at = rest.length;
  const tgtIdx = fusion && entry.mergedInto?.id ? rest.findIndex(l => l.id === entry.mergedInto.id) : -1;
  if (tgtIdx >= 0) at = tgtIdx + 1;
  else if (Number.isInteger(entry.index)) at = Math.max(0, Math.min(entry.index, rest.length));
  const next = [...rest.slice(0, at), zone, ...rest.slice(at)];
  return { locs: orderZones(next), ok: true, liftIds };
}

// Champs TEXTE d'une observation repris d'une version précédente (historique serveur).
export const ITEM_TEXT_FIELDS = ['titre', 'commentaire', 'commentaireAlign', 'suivi', 'urgence', 'statut', 'dateOuverture', 'dateCloture'];

// Rétablit le TEXTE d'une version précédente d'une observation (historique serveur, incident 26/10).
// Observation présente → seuls ses champs texte sont remplacés (photos, plans, position intacts ;
// la version remplacée reste dans l'historique serveur → réversible). Observation absente → elle est
// remise comme une observation supprimée (restoreItemInLocs). → { locs, ok, replaced?, previous?, … }
export function restoreItemTextInLocs(locs, entry) {
  const item = entry?.item;
  if (!item?.id) return { locs, ok: false, reason: 'invalid' };
  const zone = findItemZone(locs, item.id);
  if (!zone) return restoreItemInLocs(locs, entry);
  const cur = zone.items.find(i => i.id === item.id);
  if (ITEM_TEXT_FIELDS.every(f => (cur[f] ?? null) === (item[f] ?? null))) return { locs, ok: true, already: true };
  const next = { ...cur };
  for (const f of ITEM_TEXT_FIELDS) { if (item[f] === undefined) delete next[f]; else next[f] = item[f]; }
  return {
    locs: locs.map(l => (l.id === zone.id ? { ...l, items: l.items.map(i => (i.id === item.id ? next : i)) } : l)),
    ok: true, replaced: true, previous: cur, zone,
  };
}
