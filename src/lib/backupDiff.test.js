import { describe, it, expect } from 'vitest';
import { diffBackup, applyBackup } from './backupDiff.js';

const long = 'Fissure traversante en sous-face de la dalle, ouverture 0,3 mm, à surveiller avec témoins.';
const snap = {
  id: 'P', nom: 'Grasse',
  visites: [
    { id: 'V1', label: 'DET 4', localisations: [
      { id: 'z1', nom: 'RDC', items: [
        { id: 'a', titre: 'Fissure', commentaire: long, photos: [{ _id: 'ph1', storage_url: 'x/a/1.jpg' }] },
        { id: 'b', titre: 'Humidité', commentaire: 'Traces en pied de mur' },
        { id: 'del', titre: 'Supprimée exprès', commentaire: '' },
      ] },
      { id: 'z2', nom: 'R+1', items: [{ id: 'c', titre: 'Garde-corps', commentaire: 'Hauteur insuffisante' }] },
    ] },
    { id: 'V2', label: 'DET 5', localisations: [{ id: 'z3', nom: 'Toiture', items: [{ id: 'd', titre: 'Tuiles', commentaire: '' }] }] },
  ],
};
const cur = {
  id: 'P', nom: 'Grasse',
  visites: [
    { id: 'V1', label: 'DET 4', localisations: [
      { id: 'z1', nom: 'RDC', items: [
        { id: 'a', titre: 'Fissure', commentaire: 'Fissure', photos: [], _photosHydrated: true },
        { id: 'new', titre: 'Écrite ailleurs depuis', commentaire: 'à garder' },
      ] },
    ] },
  ],
};
const tomb = { item: new Set(['del']), loc: new Set() };

describe('sauvegarde ↔ projet : voir ce qui change', () => {
  const d = diffBackup(snap, cur, tomb);
  const by = (k) => d.find(e => e.key === k);

  it('liste visite, zone et observation absentes ; jamais ce qui a été supprimé exprès', () => {
    expect(by('v|V2')).toMatchObject({ kind: 'visit', on: true });
    expect(by('z|z2')).toMatchObject({ kind: 'zone', locNom: 'R+1', on: true });
    expect(by('i|b')).toMatchObject({ kind: 'item', title: 'Humidité', on: true });
    expect(by('i|del')).toBeUndefined();
  });

  it('texte nettement plus complet : proposé mais NON coché ; photos : information seulement', () => {
    expect(by('t|a')).toMatchObject({ kind: 'text', on: false, after: 'Fissure' });
    expect(by('ph|a')).toMatchObject({ kind: 'photos', info: true });
  });

  it('projet disparu : proposé non coché', () => {
    expect(diffBackup(snap, null, tomb)[0]).toMatchObject({ kind: 'project', on: false });
  });

  it('remettre la sélection : AJOUTE sans rien effacer de ce qui a été écrit depuis', () => {
    const { patch } = applyBackup(cur, d.filter(e => e.on), tomb);
    const v1 = patch.visites.find(v => v.id === 'V1');
    const ids = v1.localisations.flatMap(l => l.items.map(i => i.id)).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'new']);
    expect(v1.localisations.find(l => l.id === 'z1').items.find(i => i.id === 'a').commentaire).toBe('Fissure'); // texte non coché : inchangé
    expect(patch.visites.map(v => v.id)).toEqual(['V1', 'V2']);
  });

  it('texte coché : remplacé, l\'ancien texte actuel est rendu pour la corbeille', () => {
    const { patch, previousTexts } = applyBackup(cur, [by('t|a')], tomb);
    expect(patch.visites[0].localisations[0].items.find(i => i.id === 'a').commentaire).toBe(long);
    expect(previousTexts[0].item.commentaire).toBe('Fissure');
  });

  it('rien coché : rien ne change', () => {
    expect(applyBackup(cur, [], tomb).patch.visites).toBe(cur.visites);
  });
});
