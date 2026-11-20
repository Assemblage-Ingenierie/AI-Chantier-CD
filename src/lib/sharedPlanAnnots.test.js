import { describe, it, expect } from 'vitest';
import { unionPaths, propagatePaths, sameFps } from './sharedPlanAnnots.js';

const vp = (id, x = 10) => ({ type: 'viewpoint', _vpId: id, x, y: 10, photoIdx: 0 });
const txt = (t) => ({ type: 'text', text: t, x: 5, y: 5 });

describe('Annotations d\'un plan partagé entre zones (incident Voltaire 20/11)', () => {
  it('à l\'ouverture : union des annotations des zones qui partagent le plan, sans doublon', () => {
    expect(unionPaths([vp('c1')], [vp('r1'), vp('r2')], [vp('r1')]).map(p => p._vpId)).toEqual(['c1', 'r1', 'r2']);
  });
  it('LE BUG : la zone « cour » enregistre un plan sans y toucher → « rue » garde TOUT', () => {
    const rue = [vp('r1'), vp('r2'), txt('Façade')];
    const opened = unionPaths([], rue);           // ce que « cour » a vu à l'ouverture
    expect(sameFps(opened, opened)).toBe(true);   // rien changé → rien n'est répercuté
    expect(propagatePaths(rue, opened, opened)).toEqual(rue);
  });
  it('même si « cour » n\'avait RIEN vu (plan ajouté en séance), « rue » ne perd rien', () => {
    const rue = [vp('r1'), vp('r2')];
    expect(propagatePaths(rue, [], [vp('c1')]).map(p => p._vpId)).toEqual(['r1', 'r2', 'c1']);
    expect(propagatePaths(rue, [], []).map(p => p._vpId)).toEqual(['r1', 'r2']);
  });
  it('ajout depuis « cour » → visible aussi depuis « rue » (coexistence)', () => {
    const rue = [vp('r1')];
    const opened = unionPaths([], rue);
    const saved = [...opened, vp('c1')];
    expect(propagatePaths(rue, opened, saved).map(p => p._vpId)).toEqual(['r1', 'c1']);
  });
  it('suppression volontaire d\'un repère → retiré partout ; déplacement → mis à jour', () => {
    const rue = [vp('r1', 10), vp('r2', 50)];
    const opened = unionPaths([], rue);
    const saved = [vp('r2', 80)]; // r1 supprimé, r2 déplacé
    const out = propagatePaths(rue, opened, saved);
    expect(out.map(p => p._vpId)).toEqual(['r2']);
    expect(out[0].x).toBe(80);
  });
});

import { historySnapshots, createLostAnnotScanner, applyLostAnnots } from './annotRecovery.js';
describe('Récupération des annotations écrasées depuis l\'historique du serveur', () => {
  it('« Bâtiment sur rue » : les repères du plan supplémentaire (page 26) sont retrouvés et remis', () => {
    const projet = { id: 'P', visites: [{ id: 'V', localisations: [
      { id: 'rue', nom: 'Bâtiment sur rue', planId: 'p25', planAnnotations: null, extraPlans: [{ planId: 'p26', planAnnotations: null }] },
      { id: 'cour', nom: 'Bâtiment sur cour', planId: 'p25', planAnnotations: null, extraPlans: [{ planId: 'p26', planAnnotations: null }] },
    ] }] };
    // Version précédente de « rue » gardée par le serveur, AVANT l'écrasement.
    const hist = [{ changed_at: '2026-11-20T10:00:00Z', old_row: { id: 'rue', visite_id: 'V', nom: 'Bâtiment sur rue',
      plan_annotations: JSON.stringify({ paths: [vp('a')], _planId: 'p25', _extraPlans: [{ planId: 'p26', paths: [vp('b'), vp('c'), txt('Cage')] }] }) } }];
    const scan = createLostAnnotScanner(projet);
    for (const s of historySnapshots(projet, hist)) scan.add(s);
    const entries = scan.entries();
    expect(entries.map(e => `${e.locId}:${e.planId}:${e.count}`).sort()).toEqual(['rue:p25:1', 'rue:p26:3']);
    const e26 = entries.find(e => e.planId === 'p26');
    const { locs, added } = applyLostAnnots(projet.visites[0].localisations, e26);
    expect(added).toBe(3);
    expect(locs.find(l => l.id === 'rue').extraPlans[0].planAnnotations.paths.map(p => p._vpId || p.text)).toEqual(['b', 'c', 'Cage']);
  });
});
