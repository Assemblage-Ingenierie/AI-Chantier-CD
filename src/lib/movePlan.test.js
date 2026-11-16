import { describe, it, expect } from 'vitest';
import { movePlanBetweenItems } from './movePlan.js';

const P = (id, planId, n = 0) => ({ id, planId, planBg: null, planAnnotations: n ? { paths: Array.from({ length: n }, (_, k) => ({ type: 'pin', k })) } : null });
const base = () => [
  { id: 'L1', items: [{ id: 'A', plans: [P('a1', 'RDC', 2), P('a2', 'R+1', 1), P('a3', 'COUPE')] }, { id: 'B', plans: [] }] },
  { id: 'L2', items: [{ id: 'C', plans: [P('c1', 'RDC', 1)] }] },
];

describe('déplacer un plan d\'observation', () => {
  it('même zone : le plan part avec ses repères, l\'ordre des autres est gardé', () => {
    const r = movePlanBetweenItems(base(), 'L1', 'A', 'a2', 'L1', 'B');
    const [A, B] = r.locs[0].items;
    expect(A.plans.map(p => p.id)).toEqual(['a1', 'a3']);
    expect(B.plans.map(p => p.id)).toEqual(['a2']);
    expect(B.plans[0].planAnnotations.paths.length).toBe(1);
  });
  it('autre zone, cible qui a déjà ce plan : repères fusionnés, pas de doublon', () => {
    const r = movePlanBetweenItems(base(), 'L1', 'A', 'a1', 'L2', 'C');
    const C = r.locs[1].items[0];
    expect(C.plans.length).toBe(1);
    expect(C.plans[0].planAnnotations.paths.length).toBe(3);
    expect(r.locs[0].items[0].plans.map(p => p.planId)).toEqual(['R+1', 'COUPE']);
  });
  it('rien ne bouge si même observation, plan ou cible introuvable', () => {
    expect(movePlanBetweenItems(base(), 'L1', 'A', 'a1', 'L1', 'A')).toBeNull();
    expect(movePlanBetweenItems(base(), 'L1', 'A', 'zz', 'L1', 'B')).toBeNull();
    expect(movePlanBetweenItems(base(), 'L1', 'A', 'a1', 'L1', 'ZZ')).toBeNull();
  });
  it('n\'altère pas l\'état d\'origine (annuler = remettre l\'ancien)', () => {
    const b = base(); const snap = JSON.stringify(b);
    movePlanBetweenItems(b, 'L1', 'A', 'a1', 'L2', 'C');
    expect(JSON.stringify(b)).toBe(snap);
  });
});

import { movePlanAny, zonePlansOf } from './movePlan.js';
const Z = () => [
  { id: 'Z1', planId: 'P26', planBg: 'bg26', planData: 'd26', planAnnotations: { paths: [{ t: 1 }] }, planReportHidden: false,
    extraPlans: [{ planId: 'P27', planBg: 'bg27', planAnnotations: null }, { planId: 'P28', planBg: 'bg28', planAnnotations: { paths: [{ t: 2 }] } }],
    items: [{ id: 'O1', plans: [] }, { id: 'O2', plans: [{ id: 'e1', planId: 'P27', planAnnotations: { paths: [{ t: 3 }] } }] }] },
  { id: 'Z2', planId: null, extraPlans: [], items: [{ id: 'O3', plans: [] }] },
];
const ids = (loc) => zonePlansOf(loc).map(p => p.planId);

describe('plans de zone ↔ observations (glisser comme les photos)', () => {
  it('réordonner dans la zone (le 3e passe en 1er → devient le plan principal)', () => {
    const r = movePlanAny(Z(), { kind: 'zone', locId: 'Z1', idx: 2 }, { kind: 'zone', locId: 'Z1', idx: 0 });
    expect(ids(r.locs[0])).toEqual(['P28', 'P26', 'P27']);
    expect(r.locs[0].planId).toBe('P28');
  });
  it('plan de zone → observation sans plan : il part avec ses repères', () => {
    const r = movePlanAny(Z(), { kind: 'zone', locId: 'Z1', idx: 0 }, { kind: 'item', locId: 'Z1', itemId: 'O1' }, () => 'new');
    expect(ids(r.locs[0])).toEqual(['P27', 'P28']);
    expect(r.locs[0].planId).toBe('P27'); // le suivant devient principal
    expect(r.locs[0].items[0].plans).toEqual([{ id: 'new', planId: 'P26', planBg: 'bg26', planAnnotations: { paths: [{ t: 1 }] } }]);
  });
  it('plan de zone → observation qui l\'a déjà : repères fusionnés', () => {
    const r = movePlanAny(Z(), { kind: 'zone', locId: 'Z1', idx: 1 }, { kind: 'item', locId: 'Z1', itemId: 'O2' });
    expect(r.locs[0].items[1].plans.length).toBe(1);
    expect(r.locs[0].items[1].plans[0].planAnnotations.paths.length).toBe(1);
  });
  it('plan de zone → zone sans plan (autre zone)', () => {
    const r = movePlanAny(Z(), { kind: 'zone', locId: 'Z1', idx: 2 }, { kind: 'zone', locId: 'Z2' });
    expect(ids(r.locs[1])).toEqual(['P28']);
    expect(r.locs[1].planAnnotations.paths.length).toBe(1);
    expect(ids(r.locs[0])).toEqual(['P26', 'P27']);
  });
  it('plan d\'observation → zone', () => {
    const r = movePlanAny(Z(), { kind: 'item', locId: 'Z1', itemId: 'O2', entryId: 'e1' }, { kind: 'zone', locId: 'Z2', idx: 0 });
    expect(r.locs[0].items[1].plans).toEqual([]);
    expect(ids(r.locs[1])).toEqual(['P27']);
  });
  it('dernier plan d\'une zone retiré → la zone n\'a plus de plan (pas de fantôme)', () => {
    const one = [{ id: 'Z', planId: 'A', planBg: 'a', extraPlans: [], items: [{ id: 'O', plans: [] }] }];
    const r = movePlanAny(one, { kind: 'zone', locId: 'Z', idx: 0 }, { kind: 'item', locId: 'Z', itemId: 'O' }, () => 'n');
    expect(r.locs[0].planId).toBeNull();
    expect(r.locs[0].planBg).toBeNull();
    expect(zonePlansOf(r.locs[0])).toEqual([]);
  });
});
