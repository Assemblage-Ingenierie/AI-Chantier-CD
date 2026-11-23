import { describe, it, expect } from 'vitest';
import { convertConclusion, needsConclusionConversion, conclusionZoneId } from './conclusionToObs.js';

const base = { id: 'v1', localisations: [{ id: 'l1', nom: 'RDC', items: [{ id: 'i1', titre: 'A' }] }] };

describe('Conclusion → observation', () => {
  it('rien à convertir : même objet', () => {
    expect(convertConclusion(base)).toBe(base);
    const vide = { ...base, includeConclusion: true, conclusion: '<p> </p>' };
    expect(convertConclusion(vide)).toBe(vide);
  });
  it('conclusion cochée → zone Conclusion en fin, observation incluse au rapport, texte intact', () => {
    const v = { ...base, includeConclusion: true, conclusion: '<p>Ouvrage <b>stable</b>.</p>', conclusionAlign: 'justify' };
    const out = convertConclusion(v);
    expect(out.conclusion).toBe('');
    expect(out.includeConclusion).toBe(false);
    expect(out.localisations).toHaveLength(2);
    expect(out.localisations[0]).toBe(base.localisations[0]);
    const z = out.localisations[1];
    expect(z.id).toBe(conclusionZoneId('v1'));
    expect(z.nom).toBe('Conclusion');
    expect(z.items[0]).toMatchObject({ titre: 'Conclusion', commentaire: '<p>Ouvrage <b>stable</b>.</p>', commentaireAlign: 'justify', statut: 'rapport', urgence: 'rien' });
    expect(needsConclusionConversion(out)).toBe(false);
  });
  it('texte présent mais case décochée → observation en brouillon (pas imprimée)', () => {
    const out = convertConclusion({ ...base, includeConclusion: false, conclusion: 'Brouillon de conclusion' });
    expect(out.localisations[1].items[0].statut).toBe('brouillon');
  });
  it('ids déterministes : deux conversions de la même visite donnent les mêmes ids', () => {
    const v = { ...base, includeConclusion: true, conclusion: 'X' };
    expect(convertConclusion(v).localisations[1]).toEqual(convertConclusion(v).localisations[1]);
  });
  it('zone déjà présente (autre appareil) : pas de doublon', () => {
    const v = { ...base, includeConclusion: true, conclusion: 'X' };
    const once = convertConclusion(v);
    const again = convertConclusion({ ...once, conclusion: 'X', includeConclusion: true });
    expect(again.localisations).toHaveLength(2);
    expect(again.localisations[1].items).toHaveLength(1);
  });
  it('conclusion différente réécrite ensuite : ajoutée comme 2e observation, rien écrasé', () => {
    const once = convertConclusion({ ...base, includeConclusion: true, conclusion: 'X' });
    const again = convertConclusion({ ...once, conclusion: 'Y', includeConclusion: true });
    const items = again.localisations[1].items;
    expect(items.map(i => i.commentaire)).toEqual(['X', 'Y']);
    expect(new Set(items.map(i => i.id)).size).toBe(2);
  });
});
