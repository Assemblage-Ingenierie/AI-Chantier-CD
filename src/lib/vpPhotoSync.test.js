import { describe, it, expect } from 'vitest';
import { syncViewpointsToPhotos } from './vpPhotoSync.js';

const ph = (id) => ({ _id: id, data: `https://x/${id}` });
const vp = (idx, extra = {}) => ({ type: 'viewpoint', _vpId: `v${idx}`, x: idx, y: idx, photoIdx: idx, ...extra });
const visit = (photosA, photosB, zonePaths, itemPaths = []) => [{
  id: 'Z', nom: 'Zone', planId: 'P',
  planAnnotations: { paths: zonePaths },
  items: [
    { id: 'A', photos: photosA, _photosHydrated: true, plans: [{ id: 'pl', planId: 'Q', planAnnotations: { paths: itemPaths } }] },
    { id: 'B', photos: photosB, _photosHydrated: true },
  ],
}];
const withPhotos = (locs, itemId, photos) => locs.map(l => ({ ...l, items: l.items.map(i => i.id === itemId ? { ...i, photos } : i) }));
const zp = (locs) => locs[0].planAnnotations.paths;

describe('repères photo ↔ photos supprimées / déplacées', () => {
  it('aucune photo changée → même référence (rien touché)', () => {
    const prev = visit([ph(1), ph(2)], [ph(3)], [vp(0), vp(1), vp(2)]);
    const next = prev.map(l => ({ ...l, nom: 'Renommée' }));
    expect(syncViewpointsToPhotos(prev, next)).toBe(next);
  });

  it('photo supprimée → son repère disparaît, les suivants sont recalés (zone, sans photoId)', () => {
    const prev = visit([ph(1), ph(2)], [ph(3)], [vp(0), vp(1), vp(2), { type: 'text', text: 'garde' }]);
    const out = syncViewpointsToPhotos(prev, withPhotos(prev, 'A', [ph(1)]));
    const paths = zp(out);
    expect(paths.filter(p => p.type === 'viewpoint').map(p => [p._vpId, p.photoIdx, p.photoId])).toEqual([['v0', 0, 1], ['v2', 1, 3]]);
    expect(paths.some(p => p.type === 'text')).toBe(true);
  });

  it('identité par photoId : réordonner ne casse rien, supprimer retire le bon repère', () => {
    const prev = visit([ph(1), ph(2)], [], [vp(0, { photoId: 1 }), vp(1, { photoId: 2 })]);
    const re = syncViewpointsToPhotos(prev, withPhotos(prev, 'A', [ph(2), ph(1)]));
    expect(zp(re).map(p => [p.photoId, p.photoIdx])).toEqual([[1, 1], [2, 0]]);
    const del = syncViewpointsToPhotos(prev, withPhotos(prev, 'A', [ph(1)]));
    expect(zp(del).map(p => p.photoId)).toEqual([1]);
  });

  it('plan d\'observation : repère de la photo supprimée retiré', () => {
    const prev = visit([ph(1), ph(2), ph(3)], [], [], [vp(0), vp(1), vp(2)]);
    const out = syncViewpointsToPhotos(prev, withPhotos(prev, 'A', [ph(1), ph(3)]));
    expect(out[0].items[0].plans[0].planAnnotations.paths.map(p => [p._vpId, p.photoIdx])).toEqual([['v0', 0], ['v2', 1]]);
  });

  it('photo déplacée vers une autre observation de la zone → repère conservé et recalé', () => {
    const prev = visit([ph(1), ph(2)], [ph(3)], [vp(0), vp(1), vp(2)]);
    let next = withPhotos(prev, 'A', [ph(2)]);
    next = withPhotos(next, 'B', [ph(3), ph(1)]);
    expect(zp(syncViewpointsToPhotos(prev, next)).map(p => [p._vpId, p.photoId, p.photoIdx])).toEqual([['v0', 1, 2], ['v1', 2, 0], ['v2', 3, 1]]);
  });

  it('observation supprimée → les repères de ses photos disparaissent', () => {
    const prev = visit([ph(1)], [ph(2)], [vp(0), vp(1)]);
    const next = prev.map(l => ({ ...l, items: l.items.filter(i => i.id !== 'A') }));
    expect(zp(syncViewpointsToPhotos(prev, next)).map(p => [p._vpId, p.photoIdx])).toEqual([['v1', 0]]);
  });

  it('PRUDENCE : liste pas encore chargée → repères sans photoId laissés intacts', () => {
    const prev = visit([ph(1), { _id: 2 }], [], [vp(0), vp(1)]); // photo 2 sans octets
    const out = syncViewpointsToPhotos(prev, withPhotos(prev, 'A', [{ _id: 2 }]));
    expect(zp(out).map(p => p._vpId)).toEqual(['v0', 'v1']);
  });

  it('PRUDENCE : observation non hydratée (photos vides côté next) ≠ suppression', () => {
    const prev = visit([ph(1)], [ph(2)], [vp(0, { photoId: 1 }), vp(1, { photoId: 2 })]);
    const next = prev.map(l => ({ ...l, items: l.items.map(i => i.id === 'B' ? { ...i, photos: [], _photosHydrated: false } : i) }));
    expect(zp(syncViewpointsToPhotos(prev, next)).map(p => p.photoId)).toEqual([1, 2]);
  });

  it('« Annuler » (instantané restauré) : repères restaurés tels quels, pas recalés', () => {
    const before = visit([ph(1)], [ph(2)], [vp(0), vp(1)]);
    const after = syncViewpointsToPhotos(before, before.map(l => ({ ...l, items: l.items.filter(i => i.id !== 'A') })));
    expect(zp(after).map(p => p._vpId)).toEqual(['v1']);
    const undone = syncViewpointsToPhotos(after, before);
    expect(zp(undone).map(p => [p._vpId, p.photoIdx])).toEqual([['v0', 0], ['v1', 1]]);
  });

  it('photoId inconnu de la visite (visite dupliquée / ancienne suppression) → intact', () => {
    const prev = visit([ph(1), ph(2)], [], [vp(0, { photoId: 'vieux' }), vp(1)]);
    const out = syncViewpointsToPhotos(prev, withPhotos(prev, 'A', [ph(2)]));
    expect(zp(out).map(p => [p._vpId, p.photoIdx, p.photoId])).toEqual([['v0', 0, 'vieux'], ['v1', 0, 2]]);
  });

  it('origine hors de la visite (repère venu d\'une autre visite) → intact', () => {
    const prev = visit([ph(1), ph(2)], [], [vp(0, { originLocId: 'ailleurs' }), vp(1)]);
    const out = syncViewpointsToPhotos(prev, withPhotos(prev, 'A', [ph(2)]));
    expect(zp(out).map(p => [p._vpId, p.photoIdx])).toEqual([['v0', 0], ['v1', 0]]);
  });
});
