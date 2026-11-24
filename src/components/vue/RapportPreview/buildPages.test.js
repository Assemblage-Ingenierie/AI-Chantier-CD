import { describe, it, expect } from 'vitest';
import { buildPages } from './layout.js';

const AVAIL = 769;
const row = (id, itemId = 'it') => ({ type: 'item', id, mode: 'photos', item: { id: itemId } });
const pagesOf = (blocks, heights, gridH = {}, breaks = new Set()) =>
  buildPages(blocks, 2, breaks, heights, { avail: AVAIL, gridH, minFit: 0.85 }).map(p => p.map(b => b.id));

describe('Pagination automatique du rapport', () => {
  it('4 rangées de photos tiennent sur une page (léger resserrement), la 5e passe à la suivante', () => {
    const blocks = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(id => row(id));
    const heights = Object.fromEntries(blocks.map(b => [b.id, 205]));
    const gridH = Object.fromEntries(blocks.map(b => [b.id, 190]));
    expect(pagesOf(blocks, heights, gridH)).toEqual([['r1', 'r2', 'r3', 'r4'], ['r5', 'r6']]);
  });
  it('sans photos à resserrer : coupe dès que la page est pleine', () => {
    const blocks = ['a', 'b', 'c'].map(id => ({ type: 'item', id, mode: 'text', item: { id } }));
    expect(pagesOf(blocks, { a: 400, b: 300, c: 200 })).toEqual([['a', 'b'], ['c']]);
  });
  it('un ✂ manuel reste une coupe forcée', () => {
    const blocks = ['a', 'b'].map(id => ({ type: 'item', id, mode: 'text', item: { id } }));
    expect(pagesOf(blocks, { a: 100, b: 100 }, {}, new Set(['b']))).toEqual([['a'], ['b']]);
  });
  it('un titre de zone n\'est jamais laissé seul en bas de page', () => {
    const blocks = [{ type: 'item', id: 'a', mode: 'text', item: { id: 'a' } }, { type: 'zone', id: 'z' }, { type: 'item', id: 'b', mode: 'text', item: { id: 'b' } }];
    expect(pagesOf(blocks, { a: 700, z: 40, b: 300 })).toEqual([['a'], ['z', 'b']]);
  });
  it('l\'en-tête court d\'une observation suit ses photos', () => {
    const blocks = [{ type: 'item', id: 'x', mode: 'text', item: { id: 'x' } }, { type: 'item', id: 'h', mode: 'full', item: { id: 'p' } }, row('p1', 'p')];
    expect(pagesOf(blocks, { x: 650, h: 60, p1: 205 }, { p1: 190 })).toEqual([['x'], ['h', 'p1']]);
  });
  it('un bloc plus grand qu\'une page reste seul sur sa page', () => {
    const blocks = ['a', 'big', 'c'].map(id => ({ type: 'item', id, mode: 'text', item: { id } }));
    expect(pagesOf(blocks, { a: 100, big: 1200, c: 100 })).toEqual([['a'], ['big'], ['c']]);
  });
});

describe('Saut automatique annulé à la main (retour Thomas 24/11)', () => {
  it('le bloc « remonté » reste sur la page précédente, la suite continue normalement', () => {
    const blocks = ['a', 'b', 'c'].map(id => ({ type: 'item', id, mode: 'text', item: { id } }));
    const heights = { a: 400, b: 300, c: 200 };
    const run = (noBreak) => buildPages(blocks, 2, new Set(), heights, { avail: AVAIL, minFit: 0.85, noBreak }).map(p => p.map(b => b.id));
    expect(run(new Set())).toEqual([['a', 'b'], ['c']]);
    expect(run(new Set(['c']))).toEqual([['a', 'b', 'c']]);
  });
  it('trace quand un saut automatique laisse beaucoup de vide', () => {
    const seen = [];
    const blocks = [{ type: 'item', id: 'a', mode: 'text', item: { id: 'a' } }, row('big')];
    buildPages(blocks, 2, new Set(), { a: 200, big: 700 }, { avail: AVAIL, minFit: 0.85, onLooseBreak: (i) => seen.push(i) });
    expect(seen[0]).toMatchObject({ id: 'big', H: 200, h: 700, measured: true });
  });
});

describe('Sauts automatiques mal placés (retour Gab 24/11)', () => {
  const zone = { type: 'zone', id: 'z' };
  const txt = (id, itemId = id) => ({ type: 'item', id, mode: 'text', item: { id: itemId } });
  const run = (blocks, heights, opts = {}) => buildPages(blocks, 2, new Set(), heights, { avail: AVAIL, minFit: 0.85, ...opts }).map(p => p.map(b => b.id));
  it('jamais un titre de zone seul sur une page', () => {
    expect(run([zone, txt('t')], { z: 42, t: 819 })).toEqual([['z', 't']]);
  });
  it('« remonter » sur le titre de zone (1er bloc de la page) annule bien le saut', () => {
    const blocks = [txt('a'), zone, txt('t')];
    const heights = { a: 500, z: 42, t: 400 };
    expect(run(blocks, heights)).toEqual([['a'], ['z', 't']]);
    expect(run(blocks, heights, { noBreak: new Set(['z']) })).toEqual([['a', 'z', 't']]);
  });
});
