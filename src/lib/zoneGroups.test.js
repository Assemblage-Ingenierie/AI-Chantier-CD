import { describe, it, expect } from 'vitest';
import { orderZones, nestZone, placeZone, unnestZone, canNestInto, childrenOf, zonePlanItems, zoneLabel, remapParentIds, effectiveParentId } from './zoneGroups.js';

const z = (id, parentId) => ({ id, nom: id.toUpperCase(), items: [{ id: `${id}-o` }], ...(parentId ? { parentId } : {}) });
const ids = (locs) => locs.map(l => (l.parentId ? `${l.parentId}>${l.id}` : l.id)).join(',');

describe('groupes de zones', () => {
  it('sans groupe : orderZones renvoie le MÊME tableau (aucun changement)', () => {
    const locs = [z('a'), z('b'), z('c')];
    expect(orderZones(locs)).toBe(locs);
  });

  it('ranger après coup : M. Albert Thomas et Mme Scapollo dans R+4', () => {
    let locs = [z('albert'), z('escalier'), z('scapollo'), z('r4')];
    locs = nestZone(locs, 'albert', 'r4');
    locs = nestZone(locs, 'scapollo', 'r4');
    expect(ids(locs)).toBe('escalier,r4,r4>albert,r4>scapollo');
    expect(childrenOf(locs, 'r4').map(l => l.id)).toEqual(['albert', 'scapollo']);
    expect(zoneLabel(locs, locs[2])).toBe('R4 › ALBERT');
  });

  it('un seul niveau : pas de groupe dans un groupe, pas de sous-zone comme parent', () => {
    const locs = [z('r4'), z('albert', 'r4'), z('r5')];
    expect(canNestInto(locs, 'r5', 'albert')).toBe(false); // albert est déjà une sous-zone
    expect(canNestInto(locs, 'r4', 'r5')).toBe(false);     // r4 a des sous-zones
    expect(canNestInto(locs, 'r5', 'r4')).toBe(true);
    expect(nestZone(locs, 'r4', 'r5')).toBe(locs);
  });

  it('réordonner sans groupe = comportement d\'avant (prend la place de la cible)', () => {
    const locs = [z('a'), z('b'), z('c'), z('d')];
    expect(ids(placeZone(locs, 'a', 'c'))).toBe('b,c,a,d');
    expect(ids(placeZone(locs, 'd', 'b'))).toBe('a,d,b,c');
  });

  it('un groupe se déplace avec ses sous-zones', () => {
    const locs = [z('r4'), z('albert', 'r4'), z('scapollo', 'r4'), z('cave'), z('toit')];
    expect(ids(placeZone(locs, 'r4', 'toit'))).toBe('cave,toit,r4,r4>albert,r4>scapollo');
    // déposé sur une sous-zone d'un autre groupe → reste au 1er niveau
    const two = [z('r4'), z('albert', 'r4'), z('r5'), z('dupont', 'r5')];
    expect(ids(placeZone(two, 'r4', 'dupont'))).toBe('r5,r5>dupont,r4,r4>albert');
  });

  it('déposer sur une sous-zone fait entrer dans le groupe ; sur une zone de 1er niveau fait sortir', () => {
    const locs = [z('r4'), z('albert', 'r4'), z('scapollo', 'r4'), z('cave')];
    expect(ids(placeZone(locs, 'cave', 'albert'))).toBe('r4,r4>cave,r4>albert,r4>scapollo');
    expect(ids(placeZone(locs, 'albert', 'cave'))).toBe('r4,r4>scapollo,cave,albert');
    expect(ids(placeZone(locs, 'scapollo', 'albert'))).toBe('r4,r4>scapollo,r4>albert,cave');
  });

  it('sortir une sous-zone du groupe', () => {
    const locs = [z('r4'), z('albert', 'r4'), z('scapollo', 'r4'), z('cave')];
    expect(ids(unnestZone(locs, 'albert'))).toBe('r4,r4>scapollo,albert,cave');
  });

  it('lien orphelin (parent supprimé) : la zone redevient normale', () => {
    const locs = [z('albert', 'disparu'), z('cave')];
    expect(effectiveParentId(locs, locs[0])).toBeNull();
    expect(ids(orderZones(locs))).toBe('disparu>albert,cave');
    expect(zoneLabel(locs, locs[0])).toBe('ALBERT');
  });

  it('remet en ordre canonique une liste désordonnée (autre appareil)', () => {
    const locs = [z('albert', 'r4'), z('cave'), z('r4')];
    expect(ids(orderZones(locs))).toBe('cave,r4,r4>albert');
  });

  it('plan du groupe : photos de la zone PUIS des sous-zones', () => {
    const locs = [z('r4'), z('albert', 'r4'), z('scapollo', 'r4')];
    expect(zonePlanItems(locs, locs[0]).map(i => i.id)).toEqual(['r4-o', 'albert-o', 'scapollo-o']);
    expect(zonePlanItems(locs, locs[1]).map(i => i.id)).toEqual(['albert-o']);
  });

  it('duplication de visite : les liens suivent les nouveaux id', () => {
    const map = new Map([['r4', 'R4b'], ['albert', 'ALb']]);
    const copied = [{ id: 'R4b' }, { id: 'ALb', parentId: 'r4' }];
    expect(remapParentIds(copied, map)).toEqual([{ id: 'R4b' }, { id: 'ALb', parentId: 'R4b' }]);
  });
});
