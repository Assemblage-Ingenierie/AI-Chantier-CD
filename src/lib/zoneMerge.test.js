import { describe, it, expect } from 'vitest';
import { mergeZones, mergedTitle, canMergeZones } from './zoneMerge.js';

const ph = (id) => ({ _id: id, data: `https://x/${id}` });
const locs = () => [
  { id: 'r4', nom: 'R+4', items: [{ id: 'a', titre: 'Couloir' }], planId: 'P4', extraPlans: [] },
  { id: 'scap', nom: 'Appartement Mme Scapolo', planId: 'PS', planAnnotations: { paths: [{ type: 'text' }] }, extraPlans: [{ id: 'e', planId: 'P4' }],
    items: [{ id: 'b', titre: '', photos: [ph(1), ph(2)], urgence: 'basse' }, { id: 'c', titre: 'Toilette', photos: [ph(3)], urgence: 'moyenne' }] },
  { id: 'cave', nom: 'Cave', items: [] },
];

describe('fusion de zones', () => {
  it('les observations passent dans la cible, au même niveau, à la suite, mêmes id et photos', () => {
    const out = mergeZones(locs(), 'scap', 'r4');
    const r4 = out.find(l => l.id === 'r4');
    expect(r4.items.map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(r4.items[1].photos).toHaveLength(2);
    expect(r4.items[2].urgence).toBe('moyenne');
  });

  it('le nom de la zone d\'origine est ajouté devant le titre', () => {
    const r4 = mergeZones(locs(), 'scap', 'r4').find(l => l.id === 'r4');
    expect(r4.items[1].titre).toBe('Appartement Mme Scapolo');
    expect(r4.items[2].titre).toBe('Appartement Mme Scapolo · Toilette');
    expect(mergedTitle('Cave', 'Cave · Humidité')).toBe('Cave · Humidité');
  });

  it('la zone d\'origine est vidée et marquée (suppression différée), pas supprimée', () => {
    const src = mergeZones(locs(), 'scap', 'r4').find(l => l.id === 'scap');
    expect(src).toBeTruthy();
    expect(src.items).toEqual([]);
    expect(src._mergedInto).toBe('r4');
    expect(src.planId).toBeNull();
  });

  it('les plans de la zone d\'origine absents de la cible sont ajoutés (sans doublon)', () => {
    const r4 = mergeZones(locs(), 'scap', 'r4').find(l => l.id === 'r4');
    expect(r4.extraPlans.map(e => e.planId)).toEqual(['PS']); // P4 déjà présent → ignoré
    expect(r4.extraPlans[0].planAnnotations.paths).toHaveLength(1);
  });

  it('fusion impossible : même zone, zone inconnue ou déjà fusionnée', () => {
    const l = locs();
    expect(mergeZones(l, 'scap', 'scap')).toBe(l);
    expect(mergeZones(l, 'x', 'r4')).toBe(l);
    const once = mergeZones(l, 'scap', 'r4');
    expect(canMergeZones(once, 'scap', 'cave')).toBe(false);
  });
});

import { unmergedTitle, mergePrefix, moveItemToZone } from './zoneMerge.js';

describe('sortir une observation fusionnée', () => {
  it('le préfixe de fusion est retiré quand elle retourne dans sa zone', () => {
    expect(unmergedTitle('Appartement Mme Scapolo · Toilette', 'Appartement Mme Scapolo')).toBe('Toilette');
    expect(unmergedTitle('Appartement M.Albert Thomas - R+4', 'Appartement M.Albert Thomas - R+4')).toBe('');
    expect(unmergedTitle('Fissure', 'Cave')).toBe('Fissure');
    expect(mergePrefix('Appartement Mme Scapolo · Toilette')).toBe('Appartement Mme Scapolo');
    expect(mergePrefix('Fissure')).toBe('');
  });

  it('vers une nouvelle zone : créée juste après, observation retirée de la zone d\'origine', () => {
    const locs = [{ id: 'r4', nom: 'R+4', items: [{ id: 'a' }, { id: 'b', titre: 'Mme Scapolo · Toilette', photos: [1] }] }, { id: 'cave', nom: 'Cave', items: [] }];
    const out = moveItemToZone(locs, 'r4', locs[0].items[1], { nom: 'Mme Scapolo' });
    expect(out.map(l => l.nom)).toEqual(['R+4', 'Mme Scapolo', 'Cave']);
    expect(out[0].items.map(i => i.id)).toEqual(['a']);
    expect(out[1].items).toEqual([{ id: 'b', titre: 'Toilette', photos: [1] }]);
  });

  it('vers une zone existante', () => {
    const locs = [{ id: 'r4', nom: 'R+4', items: [{ id: 'a', titre: 'Cave · Humidité' }] }, { id: 'cave', nom: 'Cave', items: [{ id: 'z' }] }];
    const out = moveItemToZone(locs, 'r4', locs[0].items[0], 'cave');
    expect(out[0].items).toEqual([]);
    expect(out[1].items.map(i => `${i.id}:${i.titre ?? ''}`)).toEqual(['z:', 'a:Humidité']);
  });
});

describe('fusion : annotations du plan partagé (incident R+4)', () => {
  const vp = (o) => ({ type: 'viewpoint', x: 1, y: 2, ...o });
  const mk = () => [
    { id: 'r4', nom: 'R+4', planId: 'P4', planAnnotations: { paths: [{ type: 'text', text: 'Palier' }] },
      items: [{ id: 'a', photos: [{ _id: 'pa', data: 'u' }] }] },
    { id: 'scap', nom: 'Mme Scapolo', planId: 'P4',
      planAnnotations: { paths: [{ type: 'text', text: 'Palier' }, { type: 'stroke', points: [{ x: 1, y: 1 }] }, vp({ photoIdx: 1, _vpId: 'v1' })] },
      extraPlans: [{ id: 'e', planId: 'COUPE', planAnnotations: { paths: [{ type: 'text', text: 'Coupe' }] } }],
      items: [{ id: 'b', photos: [{ _id: 'pb1', data: 'u' }, { _id: 'pb2', data: 'u' }] }] },
  ];

  it('les annotations de la zone fusionnée sont AJOUTÉES au plan déjà présent dans la cible', () => {
    const r4 = mergeZones(mk(), 'scap', 'r4').find(l => l.id === 'r4');
    const types = r4.planAnnotations.paths.map(p => p.type);
    expect(types).toEqual(['text', 'stroke', 'viewpoint']); // « Palier » pas en double
    expect(r4.extraPlans.map(e => e.planId)).toEqual(['COUPE']);
    expect(r4.extraPlans[0].planAnnotations.paths).toHaveLength(1);
  });

  it('les repères photo pointent vers la même photo dans la zone cible', () => {
    const r4 = mergeZones(mk(), 'scap', 'r4').find(l => l.id === 'r4');
    const v = r4.planAnnotations.paths.find(p => p.type === 'viewpoint');
    // photos de R+4 après fusion : pa, pb1, pb2 → pb2 est à l'index 2
    expect(v.photoIdx).toBe(2);
    expect(v.photoId).toBe('pb2');
    expect(v.originLocId).toBeUndefined();
  });
});
