import { describe, it, expect } from 'vitest';
import { orientOfSize, photosToMeasure, applyAutoOrient } from './photoAutoOrient.js';

const locs = () => [{ id: 'L', items: [{ id: 'A', photos: [
  { _id: 'p1', data: 'u1' },                       // jamais réglée → à mesurer
  { _id: 'p2', data: 'u2', orient: 'landscape' },  // choisie à la main → intouchable
  { _id: 'p3', data: 'u3', orient: 'portrait' },
  { _id: 'p4', data: 'u4' },
] }, { id: 'B', photos: [{ _id: 'p5', data: 'u5' }] }] }];

describe('format automatique des photos du rapport', () => {
  it('portrait seulement si nettement plus haute que large', () => {
    expect(orientOfSize(3000, 4000)).toBe('portrait');
    expect(orientOfSize(4000, 3000)).toBe('landscape');
    expect(orientOfSize(1000, 1020)).toBe('landscape'); // quasi carrée
    expect(orientOfSize(0, 0)).toBe('landscape');
  });
  it('ne mesure que les photos sans format choisi, une fois', () => {
    expect(photosToMeasure(locs(), {}).map(x => x.key)).toEqual(['p1', 'p4', 'p5']);
    expect(photosToMeasure(locs(), { p1: 'portrait', p4: 'landscape' }).map(x => x.key)).toEqual(['p5']);
  });
  it('applique le portrait détecté, sans toucher aux choix manuels', () => {
    const src = locs();
    const out = applyAutoOrient(src, { p1: 'portrait', p2: 'portrait', p4: 'landscape' });
    expect(out[0].items[0].photos.map(p => p.orient)).toEqual(['portrait', 'landscape', 'portrait', undefined]);
    expect(out[0].items[1]).toBe(src[0].items[1]); // observation sans changement : même objet
    expect(src[0].items[0].photos[0].orient).toBeUndefined(); // pas de mutation
  });
  it('rien détecté en portrait → zones identiques (pas de re-calcul)', () => {
    const src = locs();
    expect(applyAutoOrient(src, { p1: 'landscape' })).toEqual(src);
    expect(applyAutoOrient(src, {})).toBe(src);
  });
});
