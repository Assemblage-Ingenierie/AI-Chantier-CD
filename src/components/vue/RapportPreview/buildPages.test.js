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
