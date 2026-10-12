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
