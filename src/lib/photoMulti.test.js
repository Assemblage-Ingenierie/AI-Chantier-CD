import { describe, it, expect } from 'vitest';
import { toggleSel, isSelected, collectSelected, deleteSelected, moveSelected } from './photoMulti.js';

const P = (id) => ({ _id: id, data: `d${id}` });
const mk = () => [
  { id: 'L1', items: [
    { id: 'A', photos: [P('a1'), P('a2'), P('a3'), P('a4')] },
    { id: 'B', photos: [P('b1'), P('b2')] },
  ] },
  { id: 'L2', items: [{ id: 'C', photos: [] }, { id: 'D', photos: [P('d1')] }] },
];
const ids = (locs, li, ii) => locs[li].items[ii].photos.map(p => p._id);
const sel = (...pairs) => pairs.map(([locId, itemId, key]) => ({ locId, itemId, key }));

describe('sélection multiple de photos', () => {
  it('Ctrl+clic ajoute puis retire', () => {
    const ph = P('a1');
    let s = toggleSel([], 'L1', 'A', ph);
    expect(isSelected(s, 'A', ph)).toBe(true);
    s = toggleSel(s, 'L1', 'A', ph);
    expect(s).toEqual([]);
  });

  it('ordre du document, entrées disparues ignorées', () => {
    const got = collectSelected(mk(), sel(['L2', 'D', 'd1'], ['L1', 'A', 'a3'], ['L1', 'A', 'zz']));
    expect(got.map(g => g.photo._id)).toEqual(['a3', 'd1']);
  });

  it('supprime plusieurs photos de plusieurs observations, rien d\'autre', () => {
    const locs = mk();
    const { locs: out, count } = deleteSelected(locs, sel(['L1', 'A', 'a2'], ['L1', 'B', 'b1'], ['L2', 'D', 'd1']));
    expect(count).toBe(3);
    expect(ids(out, 0, 0)).toEqual(['a1', 'a3', 'a4']);
    expect(ids(out, 0, 1)).toEqual(['b2']);
    expect(ids(out, 1, 1)).toEqual([]);
    expect(out[0].items[0]._photosHydrated).toBe(true);
    expect(out[1].items[0]).toBe(locs[1].items[0]); // observation non touchée : même objet
  });

  it('déplace vers une autre observation (autre zone), à la position visée', () => {
    const { locs: out, count } = moveSelected(mk(), sel(['L1', 'A', 'a1'], ['L1', 'A', 'a3']), 'L2', 'D', 0);
    expect(count).toBe(2);
    expect(ids(out, 0, 0)).toEqual(['a2', 'a4']);
    expect(ids(out, 1, 1)).toEqual(['a1', 'a3', 'd1']);
  });

  it('déplace vers une observation vide (à la fin par défaut)', () => {
    const { locs: out } = moveSelected(mk(), sel(['L1', 'B', 'b2'], ['L1', 'A', 'a4']), 'L2', 'C');
    expect(ids(out, 1, 0)).toEqual(['a4', 'b2']);
    expect(ids(out, 0, 1)).toEqual(['b1']);
  });

  it('réordonne dans la même observation (index compté avant retrait)', () => {
    // a1 et a2 déposées après a4 (index 4 = fin)
    expect(ids(moveSelected(mk(), sel(['L1', 'A', 'a1'], ['L1', 'A', 'a2']), 'L1', 'A', 4).locs, 0, 0)).toEqual(['a3', 'a4', 'a1', 'a2']);
    // a1 et a4 déposées devant a3 (index 2)
    expect(ids(moveSelected(mk(), sel(['L1', 'A', 'a1'], ['L1', 'A', 'a4']), 'L1', 'A', 2).locs, 0, 0)).toEqual(['a2', 'a1', 'a4', 'a3']);
  });

  it('les photos déplacées gardent leur objet (même _id → ligne Supabase rattachée)', () => {
    const locs = mk();
    const a2 = locs[0].items[0].photos[1];
    const { locs: out } = moveSelected(locs, sel(['L1', 'A', 'a2']), 'L1', 'B', 1);
    expect(out[0].items[1].photos[1]).toBe(a2);
  });

  it('cible introuvable ou sélection vide : rien ne change', () => {
    const locs = mk();
    expect(moveSelected(locs, sel(['L1', 'A', 'a1']), 'L1', 'ZZ').locs).toBe(locs);
    expect(deleteSelected(locs, []).locs).toBe(locs);
  });
});
