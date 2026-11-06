import { describe, it, expect } from 'vitest';
import { findDeletedPlans, relinkDeletedPlans, visitUsesPlan, detachPlanFromVisit, visitPlanLibrary } from './planRecovery.js';

// Grasse (06/11/2026) : DET 4 avait les plans A et B ; la DET 6 (copie) les a supprimés de la
// bibliothèque pour mettre N → A et B ont disparu de la DET 4 aussi.
const annA = { paths: [{ type: 'arrow', x1: 1, y1: 2, x2: 3, y2: 4 }] };
const projetApres = {
  id: 'P', planLibrary: [{ id: 'N', nom: 'Nouveau RDC' }],
  visites: [
    { id: 'D4', label: 'DET 4', localisations: [
      { id: 'z1', nom: 'RDC', planId: null, extraPlans: [], items: [{ id: 'i1', plans: [{ planId: 'A' }] }] },
      { id: 'z2', nom: 'R+1', planId: null, extraPlans: [], items: [] },
    ] },
    { id: 'D6', label: 'DET 6', localisations: [
      { id: 'z9', nom: 'RDC', planId: 'N', extraPlans: [], items: [] },
    ] },
  ],
};
// Historique serveur des zones : état AVANT la suppression (le plus récent) et une version plus ancienne.
const zoneHistory = [
  { row_id: 'z1', changed_at: '2026-11-05T10:00:00Z', old_row: { id: 'z1', plan_annotations: JSON.stringify({ _planId: 'A', ...annA, _extraPlans: [{ planId: 'B', paths: [{ type: 'text' }] }] }) } },
  { row_id: 'z1', changed_at: '2026-10-01T10:00:00Z', old_row: { id: 'z1', plan_annotations: JSON.stringify({ _planId: 'A', paths: [] }) } },
  { row_id: 'z9', changed_at: '2026-11-05T10:00:00Z', old_row: { id: 'z9', plan_annotations: { _planId: 'A', paths: [] } } },
  { row_id: 'zGone', changed_at: '2026-11-05T10:00:00Z', old_row: { id: 'zGone', plan_annotations: { _planId: 'A' } } },
];
const snapshots = [
  { ts: 1, data: [{ id: 'P', planLibrary: [{ id: 'A', nom: 'Ancien nom' }], visites: [] }] },
  { ts: 2, data: [{ id: 'P', planLibrary: [{ id: 'A', nom: 'DDLR - MAS - M100' }, { id: 'B', nom: 'Coupe' }, { id: 'N', nom: 'Nouveau RDC' }],
    visites: [{ id: 'D4', localisations: [{ id: 'z2', planId: 'B', planAnnotations: { paths: [{ type: 'line' }] }, extraPlans: [] }] }] }] },
];

describe('plans supprimés : retrouver', () => {
  const found = findDeletedPlans(projetApres, { zoneHistory, snapshots });
  const A = found.find(p => p.id === 'A'), B = found.find(p => p.id === 'B');

  it('retrouve les plans retirés (pas ceux encore dans la bibliothèque) avec leur dernier nom', () => {
    expect(found.map(p => p.id).sort()).toEqual(['A', 'B']);
    expect(A.nom).toBe('DDLR - MAS - M100');
    expect(B.nom).toBe('Coupe');
  });

  it('emplacements : version la plus RÉCENTE de l\'historique, zones disparues ignorées', () => {
    const z1 = A.refs.find(r => r.locId === 'z1');
    expect(z1).toMatchObject({ visiteId: 'D4', kind: 'main', planAnnotations: annA });
    expect(A.refs.some(r => r.locId === 'zGone')).toBe(false);
    expect(A.refs.find(r => r.locId === 'z9').visiteId).toBe('D6');
    expect(A.itemCount).toBe(1);
  });

  it('historique serveur + plans additionnels + sauvegardes de l\'appareil', () => {
    expect(B.refs.find(r => r.locId === 'z1')).toMatchObject({ kind: 'extra', planAnnotations: { paths: [{ type: 'text' }] } });
    expect(B.refs.find(r => r.locId === 'z2')).toMatchObject({ kind: 'main', visiteId: 'D4', planAnnotations: { paths: [{ type: 'line' }] } });
  });

  it('remettre dans la DET 4 seulement : la DET 6 garde son nouveau plan', () => {
    const { visites, relinked } = relinkDeletedPlans(projetApres.visites, found, ['A', 'B'], ['D4']);
    const [z1, z2] = visites[0].localisations;
    expect(z1.planId).toBe('A');
    expect(z1.planAnnotations).toEqual(annA);
    expect(z1.extraPlans.map(e => e.planId)).toEqual(['B']);
    expect(z2.planId).toBe('B');
    expect(visites[1]).toBe(projetApres.visites[1]); // DET 6 intacte
    expect(relinked).toBe(3);
  });

  it('additif : une zone qui a déjà un plan principal le garde ; rien de dupliqué', () => {
    const { visites } = relinkDeletedPlans(projetApres.visites, found, ['A'], ['D6']);
    expect(visites[1].localisations[0].planId).toBe('N');
    const again = relinkDeletedPlans(relinkDeletedPlans(projetApres.visites, found, ['A', 'B'], ['D4']).visites, found, ['A', 'B'], ['D4']);
    expect(again.relinked).toBe(0);
  });
});

describe('visites indépendantes', () => {
  const v4 = { id: 'D4', localisations: [{ id: 'z', planId: 'A', extraPlans: [{ planId: 'B' }], items: [{ plans: [{ planId: 'C' }] }] }] };

  it('visitUsesPlan : zone principale, additionnelle, plan d\'observation', () => {
    expect(visitUsesPlan(v4, 'A')).toBe(true);
    expect(visitUsesPlan(v4, 'B')).toBe(true);
    expect(visitUsesPlan(v4, 'C')).toBe(true);
    expect(visitUsesPlan(v4, 'X')).toBe(false);
  });

  it('detachPlanFromVisit : retire le plan de CETTE visite seulement', () => {
    const d = detachPlanFromVisit(v4, 'A');
    expect(d.localisations[0]).toMatchObject({ planId: null, planAnnotations: null, extraPlans: [{ planId: 'B' }] });
    expect(detachPlanFromVisit(v4, 'X')).toBe(v4);
  });

  it('visitPlanLibrary : masque les plans retirés de la visite', () => {
    const lib = [{ id: 'A' }, { id: 'N' }];
    expect(visitPlanLibrary(lib, { hiddenPlans: ['A'] })).toEqual([{ id: 'N' }]);
    expect(visitPlanLibrary(lib, {})).toBe(lib);
  });
});
