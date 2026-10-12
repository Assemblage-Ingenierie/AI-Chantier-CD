// GROUPES DE ZONES (demande Thomas) : ranger après coup des zones dans une zone « parente ».
// Ex. créer « R+4 » (avec le plan du R+4) puis y glisser « M. Albert Thomas » et « Mme Scapollo ».
//
// Modèle : la liste des zones d'une visite reste PLATE (aucune migration). Une sous-zone porte
// simplement `parentId` = id de sa zone parente. UN SEUL niveau : une zone qui a des sous-zones
// ne peut pas elle-même être rangée ailleurs. Ordre canonique : chaque parent est suivi
// immédiatement de ses sous-zones → l'ordre du tableau = l'ordre d'affichage et du rapport.
// Sans aucun parentId (cas de toutes les données existantes) : tout est strictement inchangé.

// Parent EFFECTIF d'une zone : seulement s'il existe dans la liste et n'est pas lui-même rangé
// (un lien orphelin ou à 2 niveaux est ignoré → la zone redevient une zone normale).
export function effectiveParentId(locs, loc) {
  const pid = loc?.parentId;
  if (!pid || pid === loc.id) return null;
  const parent = (locs || []).find(l => l.id === pid);
  if (!parent || parent.parentId) return null;
  return pid;
}

export function childrenOf(locs, id) {
  if (!id) return [];
  return (locs || []).filter(l => l.id !== id && effectiveParentId(locs, l) === id);
}

export function hasChildren(locs, id) {
  return childrenOf(locs, id).length > 0;
}

// Ordre canonique : zones de 1er niveau dans leur ordre, chacune suivie de ses sous-zones.
// Renvoie le MÊME tableau s'il est déjà dans l'ordre (aucun re-rendu / aucune sauvegarde).
export function orderZones(locs) {
  if (!Array.isArray(locs) || !locs.some(l => l?.parentId)) return locs;
  const out = [];
  for (const l of locs) {
    if (effectiveParentId(locs, l)) continue;
    out.push(l);
    for (const c of locs) if (c !== l && effectiveParentId(locs, c) === l.id) out.push(c);
  }
  return out.every((l, i) => l === locs[i]) ? locs : out;
}

// Une zone peut-elle être rangée DANS `targetId` ?
export function canNestInto(locs, zoneId, targetId) {
  if (!zoneId || !targetId || zoneId === targetId) return false;
  const target = (locs || []).find(l => l.id === targetId);
  const zone = (locs || []).find(l => l.id === zoneId);
  if (!target || !zone) return false;
  if (effectiveParentId(locs, target)) return false; // un seul niveau
  if (hasChildren(locs, zoneId)) return false;        // un groupe ne se range pas dans un autre
  return true;
}

// Range `zoneId` dans `parentId` (en dernière sous-zone).
export function nestZone(locs, zoneId, parentId) {
  if (!canNestInto(locs, zoneId, parentId)) return locs;
  const zone = locs.find(l => l.id === zoneId);
  const rest = locs.filter(l => l.id !== zoneId);
  const moved = { ...zone, parentId };
  // Insère après la dernière sous-zone actuelle du parent (ou juste après le parent).
  const pIdx = rest.findIndex(l => l.id === parentId);
  let at = pIdx + 1;
  while (at < rest.length && effectiveParentId(rest, rest[at]) === parentId) at++;
  rest.splice(at, 0, moved);
  return orderZones(rest);
}

// Déplace `zoneId` À LA PLACE de `targetId` (même logique qu'avant : la zone prend la position
// de la cible parmi SES voisines). La zone adopte le niveau de la cible : déposée sur une
// sous-zone → elle entre dans ce groupe ; déposée sur une zone de 1er niveau → elle en sort.
export function placeZone(locs, zoneId, targetId) {
  if (!zoneId || !targetId || zoneId === targetId) return locs;
  const zone = locs.find(l => l.id === zoneId);
  const target = locs.find(l => l.id === targetId);
  if (!zone || !target) return locs;
  let targetParent = effectiveParentId(locs, target);
  // Un groupe (zone avec sous-zones) reste au 1er niveau : il prend la place du PARENT de la cible.
  if (targetParent && hasChildren(locs, zoneId)) {
    return targetParent === zoneId ? locs : placeZone(locs, zoneId, targetParent);
  }
  const fromIdx = locs.indexOf(zone);
  const toIdx = locs.indexOf(target);
  const moving = targetParent ? [{ ...zone, parentId: targetParent }]
    : [zone.parentId ? { ...zone, parentId: null } : zone];
  // Un groupe se déplace AVEC ses sous-zones.
  const kids = targetParent ? [] : childrenOf(locs, zoneId);
  const kidSet = new Set(kids.map(k => k.id));
  const rest = locs.filter(l => l.id !== zoneId && !kidSet.has(l.id));
  let at = rest.indexOf(target);
  if (fromIdx < toIdx) {
    // Vers le bas : après la cible (et après ses sous-zones si c'est un groupe de 1er niveau).
    at += 1;
    if (!targetParent) while (at < rest.length && effectiveParentId(rest, rest[at]) === target.id) at++;
  }
  rest.splice(at, 0, ...moving, ...kids);
  return orderZones(rest);
}

// Sort une sous-zone de son groupe (elle se place juste après le groupe).
export function unnestZone(locs, zoneId) {
  const zone = locs.find(l => l.id === zoneId);
  const pid = zone && effectiveParentId(locs, zone);
  if (!pid) return locs;
  const rest = locs.filter(l => l.id !== zoneId);
  const pIdx = rest.findIndex(l => l.id === pid);
  let at = pIdx + 1;
  while (at < rest.length && effectiveParentId(rest, rest[at]) === pid) at++;
  rest.splice(at, 0, { ...zone, parentId: null });
  return orderZones(rest);
}

// Observations dont les PHOTOS alimentent les plans d'une zone : celles de la zone, puis celles
// de ses sous-zones (le plan du R+4 peut recevoir les repères des appartements). Même ordre
// partout (modal plan, numérotation Vxx) → les photoIdx restent cohérents.
export function zonePlanItems(locs, loc) {
  if (!loc) return [];
  const own = loc.items || [];
  const kids = childrenOf(locs, loc.id);
  return kids.length ? [...own, ...kids.flatMap(k => k.items || [])] : own;
}

// Libellé complet d'une zone : « R+4 › M. Albert Thomas » pour une sous-zone.
export function zoneLabel(locs, loc) {
  const nom = loc?.nom || '';
  const pid = effectiveParentId(locs, loc);
  if (!pid) return nom;
  const parent = locs.find(l => l.id === pid);
  return parent?.nom ? `${parent.nom} › ${nom}` : nom;
}

// Recopie de zones avec de NOUVEAUX id (duplication de visite) : les liens parentId suivent.
export function remapParentIds(newLocs, idMap) {
  return newLocs.map(l => (l.parentId ? { ...l, parentId: idMap.get(l.parentId) || null } : l));
}
