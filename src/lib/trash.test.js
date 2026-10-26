import { describe, it, expect } from 'vitest';
import { restoreItemInLocs, restoreZoneInLocs, restoreItemTextInLocs } from './trash.js';
import { mergeZones } from './zoneMerge.js';
import { createLostAnnotScanner, applyLostAnnots } from './annotRecovery.js';

const ph = (id) => ({ _id: id, data: `https://x/${id}` });
const base = () => [
  { id: 'r4', nom: 'R+4', planId: 'P4', planAnnotations: { paths: [{ type: 'text', text: 'Palier', x: 1, y: 1 }] }, items: [{ id: 'a', titre: 'Couloir' }] },
  { id: 'scap', nom: 'Mme Scapolo', planId: 'P4', planAnnotations: { paths: [{ type: 'text', text: 'WC', x: 5, y: 5 }] }, items: [{ id: 'b', titre: 'Toilette', photos: [ph(1)] }] },
  { id: 'cave', nom: 'Cave', items: [{ id: 'c' }] },
];

describe('corbeille : restaurer une observation', () => {
  it('dans sa zone si elle existe, sinon dans une zone recréée du même nom ; jamais en double', () => {
    const locs = base();
    const e = { item: { id: 'z', titre: 'Fissure' }, locId: 'cave', locNom: 'Cave' };
    expect(restoreItemInLocs(locs, e).locs.find(l => l.id === 'cave').items.map(i => i.id)).toEqual(['c', 'z']);
    const gone = restoreItemInLocs(locs, { ...e, locId: 'old', locNom: 'Grenier' });
    expect(gone.locs.at(-1)).toMatchObject({ nom: 'Grenier', items: [{ id: 'z' }] });
    expect(restoreItemInLocs(locs, { item: { id: 'a' }, locId: 'r4' })).toMatchObject({ ok: true, already: true });
  });
});

describe('corbeille : restaurer une zone', () => {
  it('zone supprimée : revient à sa place avec plans, annotations, observations et photos', () => {
    const locs = base();
    const entry = { reason: 'suppression', loc: locs[1], index: 1 };
    const out = restoreZoneInLocs(locs.filter(l => l.id !== 'scap'), entry);
    expect(out.locs.map(l => l.id)).toEqual(['r4', 'scap', 'cave']);
    const scap = out.locs[1];
    expect(scap.planAnnotations.paths).toHaveLength(1);
    expect(scap.items[0].photos).toHaveLength(1);
    expect(out.liftIds).toEqual(['scap', 'b']);
  });

  it('annuler une fusion : les observations REVIENNENT (sans doublon, sans préfixe), modifs conservées', () => {
    const locs = base();
    const entry = { reason: 'fusion', loc: locs[1], mergedInto: { id: 'r4', nom: 'R+4' }, index: 1 };
    let merged = mergeZones(locs, 'scap', 'r4').filter(l => l.id !== 'scap');
    // modification après fusion
    merged = merged.map(l => l.id === 'r4' ? { ...l, items: l.items.map(i => i.id === 'b' ? { ...i, commentaire: 'vu' } : i) } : l);
    const out = restoreZoneInLocs(merged, entry);
    expect(out.locs.map(l => l.id)).toEqual(['r4', 'scap', 'cave']);
    expect(out.locs[0].items.map(i => i.id)).toEqual(['a']);
    expect(out.locs[1].items).toEqual([{ id: 'b', titre: 'Toilette', photos: [ph(1)], commentaire: 'vu' }]);
    const allIds = out.locs.flatMap(l => l.items.map(i => i.id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('zone déjà revenue (Annuler) → rien ne bouge', () => {
    const locs = base();
    expect(restoreZoneInLocs(locs, { loc: locs[1] })).toMatchObject({ ok: true, already: true, locs });
  });
});

describe('corbeille : annotations effacées d\'une zone existante', () => {
  const snap = (ts, paths) => ({ ts, data: [{ id: 'P', visites: [{ id: 'V', localisations: [{ id: 'r4', nom: 'R+4', planId: 'P4', planAnnotations: { paths } }] }] }] });
  const projet = (paths) => ({ id: 'P', visites: [{ id: 'V', localisations: [{ id: 'r4', nom: 'R+4', planId: 'P4', planAnnotations: { paths }, items: [] }] }] });
  const T = (text, x = 0) => ({ type: 'text', text, x, y: 0 });

  it('retrouve la version avec le plus d\'annotations disparues et les remet (sans rien retirer)', () => {
    const now = projet([T('Palier'), T('Nouveau')]);
    const scan = createLostAnnotScanner(now);
    scan.add(snap(5, [T('Palier'), T('A')]));
    scan.add(snap(4, [T('Palier'), T('A'), T('B'), { type: 'stroke', points: [{ x: 1, y: 1 }] }]));
    scan.add(snap(1, [T('A')]));
    const [e] = scan.entries();
    expect(e).toMatchObject({ locId: 'r4', planId: 'P4', count: 3, ts: 4 });
    const r = applyLostAnnots(now.visites[0].localisations, e);
    expect(r.added).toBe(3);
    expect(r.locs[0].planAnnotations.paths.map(p => p.text ?? p.type)).toEqual(['Palier', 'Nouveau', 'A', 'B', 'stroke']);
    expect(applyLostAnnots(r.locs, e).added).toBe(0); // idempotent
  });

  it('une annotation simplement DÉPLACÉE n\'est pas « disparue »', () => {
    const scan = createLostAnnotScanner(projet([T('Palier', 100)]));
    scan.add(snap(3, [T('Palier', 2)]));
    expect(scan.entries()).toEqual([]);
  });
});

describe('restoreItemTextInLocs (historique serveur)', () => {
  const locs = [{ id: 'z', nom: 'RDC', items: [{ id: 'a', titre: 'Coffrage', commentaire: 'ancien', photos: [{ _id: 'p' }], sort: 1 }] }];
  it('remplace seulement le texte d\'une observation présente', () => {
    const r = restoreItemTextInLocs(locs, { item: { id: 'a', titre: 'Coffrage voiles', commentaire: 'texte DET 5' }, locId: 'z' });
    expect(r.ok && r.replaced).toBe(true);
    const it = r.locs[0].items[0];
    expect(it.commentaire).toBe('texte DET 5');
    expect(it.titre).toBe('Coffrage voiles');
    expect(it.photos).toEqual([{ _id: 'p' }]);
    expect(r.previous.commentaire).toBe('ancien');
  });
  it('déjà identique → rien', () => {
    const r = restoreItemTextInLocs(locs, { item: { id: 'a', titre: 'Coffrage', commentaire: 'ancien' }, locId: 'z' });
    expect(r.already).toBe(true);
    expect(r.locs).toBe(locs);
  });
  it('observation absente → remise dans sa zone', () => {
    const r = restoreItemTextInLocs(locs, { item: { id: 'b', titre: 'Supprimée', photos: [] }, locId: 'z' });
    expect(r.ok).toBe(true);
    expect(r.locs[0].items.map(i => i.id)).toEqual(['a', 'b']);
  });
});
