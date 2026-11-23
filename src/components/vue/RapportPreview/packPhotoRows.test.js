import { describe, it, expect } from 'vitest';
import { packPhotoRows } from './layout.js';

const order = (rows) => rows.flatMap(r => (r.kind === 'mosaic'
  ? (r.side === 'right' ? [...r.stackIdxs, r.portraitIdx] : [r.portraitIdx, ...r.stackIdxs])
  : r.idxs));
const P = true, L = false;

describe('Photos du rapport : ordre respecté (retour Thomas 23/11)', () => {
  it('le dernier portrait ne remonte JAMAIS en tête', () => {
    // Cas du rapport A743 : paysages puis un portrait en dernier.
    const rows = packPhotoRows([L, L, L, L, L, P], 2);
    expect(order(rows)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows[0]).toEqual({ kind: 'landscape', idxs: [0, 1] });
    // Le paysage restant + le portrait final : mosaïque portrait À DROITE (pas de blanc).
    // Le paysage restant + le portrait final : rangée MIXTE (même hauteur, pas de trou).
    expect(rows[rows.length - 1]).toEqual({ kind: 'mixed', idxs: [4, 5], ars: [4 / 3, 3 / 4] });
  });
  it('ordre conservé quels que soient les formats', () => {
    for (const seq of [[P, L, L, P, P, L], [L, P, L, L, L, P, L], [P, P, P], [L, L, L], [P]])
      expect(order(packPhotoRows(seq, 2))).toEqual(seq.map((_, i) => i));
    expect(order(packPhotoRows([L, L, L, L, P, L], 3))).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('2 portraits consécutifs côte à côte, portrait suivi de paysages = mosaïque à gauche', () => {
    expect(packPhotoRows([P, P], 2)).toEqual([{ kind: 'portraits', idxs: [0, 1] }]);
    expect(packPhotoRows([P, L, L], 2)).toEqual([{ kind: 'mosaic', portraitIdx: 0, stackIdxs: [1, 2], side: 'left' }]);
  });
});

describe('Rangées mixtes (retour Thomas 23/11 : plus de trou sous un paysage seul)', () => {
  it('paysage, portrait, paysage, portrait → 2 rangées mixtes, ordre conservé', () => {
    expect(packPhotoRows([L, P, L, P], 2)).toEqual([
      { kind: 'mixed', idxs: [0, 1], ars: [4 / 3, 3 / 4] },
      { kind: 'mixed', idxs: [2, 3], ars: [4 / 3, 3 / 4] },
    ]);
  });
  it('portrait suivi d\'un seul paysage → mixte ; suivi de 2 paysages → mosaïque', () => {
    expect(packPhotoRows([P, L], 2)).toEqual([{ kind: 'mixed', idxs: [0, 1], ars: [3 / 4, 4 / 3] }]);
    expect(packPhotoRows([P, L, L], 2)[0].kind).toBe('mosaic');
  });
});
