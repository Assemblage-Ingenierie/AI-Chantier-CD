import { describe, it, expect } from 'vitest';
import { packPhotoRows } from './layout.js';
import { activeRowCols, setRowColsFor, photoListSig } from './layout.js';

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

import { packPhotoRowsBig } from './layout.js';
describe('Photo « en grand » (demande Thomas 24/11)', () => {
  it('la photo en grand prend sa rangée, les autres gardent ordre et mise en page', () => {
    const rows = packPhotoRowsBig([false, false, false, false, false], [false, false, true, false, false], 2);
    expect(rows).toEqual([
      { kind: 'landscape', idxs: [0, 1] },
      { kind: 'big', idxs: [2], portrait: false, w: 1 },
      { kind: 'landscape', idxs: [3, 4] },
    ]);
  });
  it('sans photo en grand : identique à packPhotoRows ; 3 par ligne pour une observation', () => {
    expect(packPhotoRowsBig([false, false, false], [false, false, false], 3)).toEqual([{ kind: 'landscape', idxs: [0, 1, 2] }]);
  });
});

describe('Photos par LIGNE et taille « en grand » (retour Thomas 24/11)', () => {
  it('3 photos sur une ligne choisie, le reste en automatique', () => {
    const rows = packPhotoRowsBig([false, false, false, false, false], [0, 0, 0, 0, 0], 2, [3, 0, 0, 0, 0]);
    expect(rows).toEqual([
      { kind: 'custom', idxs: [0, 1, 2], cols: 3, portrait: false },
      { kind: 'landscape', idxs: [3, 4] },
    ]);
  });
  it('1 photo seule sur sa ligne au milieu de l\'observation', () => {
    const rows = packPhotoRowsBig([false, false, false, false], [0, 0, 0, 0], 2, [0, 0, 1, 0]);
    expect(rows).toEqual([
      { kind: 'landscape', idxs: [0, 1] },
      { kind: 'custom', idxs: [2], cols: 1, portrait: false },
      { kind: 'landscape', idxs: [3] },
    ]);
  });
  it('photo en grand à 50 % (centrée au rendu)', () => {
    expect(packPhotoRowsBig([false, false], [0.5, 0], 2)).toEqual([
      { kind: 'big', idxs: [0], portrait: false, w: 0.5 },
      { kind: 'landscape', idxs: [1] },
    ]);
  });
});

describe('réglage « photos sur la ligne » lié à l\'ordre des photos (27/11)', () => {
  const K = ['a', 'b', 'c', 'd'];
  it('posé sur l\'ordre actuel → actif', () => {
    const rc = setRowColsFor({}, K, 'b', 2);
    expect(activeRowCols(rc, K)).toEqual([0, 2, 0, 0]);
  });
  it('photos ajoutées / retirées / réordonnées → ignoré (mise en page automatique)', () => {
    const rc = setRowColsFor({}, K, 'b', 2);
    expect(activeRowCols(rc, ['a', 'b', 'c', 'd', 'e'])).toEqual([0, 0, 0, 0, 0]);
    expect(activeRowCols(rc, ['a', 'b', 'd'])).toEqual([0, 0, 0]);
    expect(activeRowCols(rc, ['b', 'a', 'c', 'd'])).toEqual([0, 0, 0, 0]);
  });
  it('ancien réglage sans empreinte : toujours valable', () => {
    expect(activeRowCols({ c: 3 }, K)).toEqual([0, 0, 3, 0]);
  });
  it('re-cliquer remplace / retire le réglage et purge les réglages périmés', () => {
    const old = setRowColsFor({}, ['x', 'a'], 'a', 3);            // réglage d'une ancienne liste
    let rc = setRowColsFor({ ...old, b: 1 }, K, 'b', 2);           // ancien réglage sans empreinte de b remplacé
    expect(Object.keys(rc)).toEqual([`b~${photoListSig(K)}`]);
    rc = setRowColsFor(rc, K, 'b', null);
    expect(rc).toEqual({});
  });
});
