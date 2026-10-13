import { describe, it, expect } from 'vitest';
import { createAnnotScanner, applyAnnotRecovery } from './annotRecovery.js';
import { snapshotsToDelete } from './backupVault.js';

const proj = (locs) => [{ id: 'P', nom: 'Projet', visites: [{ id: 'V', localisations: locs }] }];
const snap = (ts, locs) => ({ ts, data: proj(locs) });

// État actuel (après l'ancienne fusion buggée) : « scap » a disparu, son observation est dans R+4,
// mais ses annotations du plan P4 ont été perdues.
const now = () => proj([
  { id: 'r4', nom: 'R+4', planId: 'P4', planAnnotations: { paths: [{ type: 'text', text: 'Palier' }, { type: 'text', text: 'Ajout après' }] },
    items: [{ id: 'a', photos: [] }, { id: 'b', titre: 'Mme Scapolo', photos: [] }] },
  { id: 'cave', nom: 'Cave', items: [{ id: 'c' }] },
]);
const before = (paths) => [
  { id: 'r4', nom: 'R+4', planId: 'P4', planAnnotations: { paths: [{ type: 'text', text: 'Palier' }] }, items: [{ id: 'a' }] },
  { id: 'scap', nom: 'Mme Scapolo', planId: 'P4', planAnnotations: paths ? { paths } : null, items: [{ id: 'b' }] },
  { id: 'cave', nom: 'Cave', items: [{ id: 'c' }] },
];

describe('récupération des annotations perdues lors d\'une fusion', () => {
  it('retrouve les annotations dans la boîte noire et les AJOUTE à la zone qui a reçu les observations', () => {
    const scan = createAnnotScanner(now());
    scan.add(snap(3, before([{ type: 'stroke', points: [] }, { type: 'text', text: 'Fissure' }])));
    const entries = scan.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ srcNom: 'Mme Scapolo', dstNom: 'R+4', count: 2 });
    const { projets, added } = applyAnnotRecovery(now(), entries);
    expect(added).toBe(2);
    const r4 = projets[0].visites[0].localisations[0];
    // rien de retiré : ce qui a été fait depuis (« Ajout après ») est conservé
    expect(r4.planAnnotations.paths.map(p => p.text ?? p.type)).toEqual(['Palier', 'Ajout après', 'stroke', 'Fissure']);
    // idempotent : une 2e application n'ajoute rien
    expect(applyAnnotRecovery(projets, entries).added).toBe(0);
  });

  it('prend l\'état LE PLUS RÉCENT : annotations effacées volontairement avant la fusion → rien ressuscité', () => {
    const scan = createAnnotScanner(now());
    scan.add(snap(5, before(null)));                                  // plus récent : plus d'annotations
    scan.add(snap(2, before([{ type: 'text', text: 'Vieux' }])));     // plus ancien
    expect(scan.entries()).toEqual([]);
  });

  it('ignore une zone supprimée AVEC ses observations (suppression volontaire) et les zones toujours présentes', () => {
    const scan = createAnnotScanner(proj([{ id: 'r4', nom: 'R+4', planId: 'P4', items: [{ id: 'a' }] }]));
    scan.add(snap(1, [
      { id: 'r4', nom: 'R+4', planId: 'P4', planAnnotations: { paths: [{ type: 'text', text: 'x' }] }, items: [{ id: 'a' }] },
      { id: 'gone', nom: 'Supprimée', planId: 'P4', planAnnotations: { paths: [{ type: 'text', text: 'y' }] }, items: [{ id: 'z' }] },
    ]));
    expect(scan.entries()).toEqual([]);
  });

  it('l\'état « vidé » après fusion (_mergedInto) est ignoré : on remonte à l\'état d\'avant', () => {
    const scan = createAnnotScanner(now());
    scan.add(snap(4, [{ id: 'scap', nom: 'Mme Scapolo', _mergedInto: 'r4', items: [] }]));
    scan.add(snap(3, before([{ type: 'text', text: 'Fissure' }])));
    expect(scan.entries().map(e => e.count)).toEqual([1]);
  });
});

describe('boîte noire : rotation', () => {
  it('garde les 60 plus récents puis un instantané par heure', () => {
    const H = 3600000;
    const recent = Array.from({ length: 60 }, (_, i) => 1000 * H + i * 3000);
    const old = [10 * H + 1, 10 * H + 2, 11 * H + 5, 12 * H + 9];
    const del = snapshotsToDelete([...recent, ...old]);
    expect(del.sort()).toEqual([10 * H + 1]); // heure 10 : on garde le plus récent (10H+2)
    expect(snapshotsToDelete(recent)).toEqual([]);
  });
});
