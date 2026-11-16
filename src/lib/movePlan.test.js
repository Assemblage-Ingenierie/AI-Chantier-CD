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
