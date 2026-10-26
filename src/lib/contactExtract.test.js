import { describe, it, expect } from 'vitest';
import { parseContactsJson, mergeDuplicates, fillBlanks, statusOf } from './contactExtract.js';

describe('import intervenants — lecture de la réponse IA', () => {
  it('JSON propre, avec texte autour', () => {
    const r = parseContactsJson('Voici : {"contacts":[{"nom":"M. Jean Dupont","metier":"Architecte","entreprise":"Atelier X","email":"JEAN@X.FR","tel":"06 12 34 56 78","presence":"Excusé"}]} fin');
    expect(r).toEqual([{ nom: 'Jean Dupont', poste: 'Architecte', entreprise: 'Atelier X', email: 'jean@x.fr', tel: '06 12 34 56 78', presence: 'absent' }]);
  });
  it('réponse COUPÉE (longue liste) : les fiches complètes sont récupérées', () => {
    const raw = '{"contacts":[{"nom":"A Un","metier":"","entreprise":"S1","email":"","tel":"","presence":"present"},{"nom":"B Deux","metier":"OPC","entreprise":"S2","email":"","tel":"","presence":""},{"nom":"C Tr';
    const r = parseContactsJson(raw);
    expect(r.map(c => c.nom)).toEqual(['A Un', 'B Deux']);
    expect(r[0].presence).toBe('present');
  });
  it('lignes sans nom ignorées', () => {
    expect(parseContactsJson('{"contacts":[{"nom":"","entreprise":"Société seule"}]}')).toEqual([]);
  });
});

describe('import intervenants — doublons', () => {
  it('même personne citée deux fois dans l\'import → une seule fiche complétée', () => {
    const r = mergeDuplicates([
      { nom: 'Jean DUPONT', poste: '', entreprise: 'X', email: '', tel: '', presence: '' },
      { nom: 'Dupont Jean', poste: 'Architecte', entreprise: '', email: 'jean@x.fr', tel: '', presence: 'present' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ entreprise: 'X', poste: 'Architecte', email: 'jean@x.fr', presence: 'present' });
  });
  it('déjà au carnet (même nom, accents/casse/ordre différents) → pas ajouté', () => {
    const carnet = [{ id: '1', nom: 'Hélène Martin', poste: '', entreprise: 'BET Y', email: '', tel: '' }];
    expect(statusOf({ nom: 'MARTIN Helene' }, carnet).status).toBe('present');
    expect(statusOf({ nom: 'Autre Personne', email: '' }, carnet).status).toBe('new');
  });
  it('déjà au carnet par e-mail même si le nom diffère', () => {
    const carnet = [{ id: '1', nom: 'H. Martin', email: 'h.martin@bety.fr' }];
    expect(statusOf({ nom: 'Hélène Martin', email: 'h.martin@bety.fr' }, carnet)).toMatchObject({ status: 'present' });
  });
  it('nom proche (faute de frappe) → à confirmer', () => {
    const carnet = [{ id: '1', nom: 'Stanislav Varvarici', email: '' }];
    expect(statusOf({ nom: 'Stanislav Varvarisi', email: '' }, carnet).status).toBe('near');
  });
  it('compléter une fiche existante : seulement les champs vides', () => {
    expect(fillBlanks({ poste: 'Archi', entreprise: '', email: 'a@b.fr', tel: '' }, { poste: 'Autre', entreprise: 'Atelier', email: 'z@z.fr', tel: '06' }))
      .toEqual({ entreprise: 'Atelier', tel: '06' });
  });
});
