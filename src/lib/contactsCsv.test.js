import { describe, it, expect } from 'vitest';
import { contactsToCsv, parseContactsCsv, previewImport } from './contacts.js';

describe('contacts CSV', () => {
  it('exporte avec BOM, entête et séparateur ;', () => {
    const csv = contactsToCsv([{ nom: 'Dupont', poste: 'MOA', email: 'a@b.fr', tel: '06', isAssemblage: false }]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF); // BOM
    expect(csv).toContain('Nom;Poste;Email;Téléphone;Type');
    expect(csv).toContain('Dupont;MOA;a@b.fr;06;Externe');
  });

  it('échappe les valeurs contenant le séparateur ou des guillemets', () => {
    const csv = contactsToCsv([{ nom: 'Durand; SARL', poste: 'Dir "gé"', email: '', tel: '', isAssemblage: true }]);
    expect(csv).toContain('"Durand; SARL"');
    expect(csv).toContain('"Dir ""gé"""');
    expect(csv).toContain(';Assemblage');
  });

  it('round-trip export → parse préserve les champs', () => {
    const orig = [{ nom: 'Marie Curie', poste: 'Ingénieur', email: 'm@c.fr', tel: '0611', isAssemblage: true }];
    const parsed = parseContactsCsv(contactsToCsv(orig));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ nom: 'Marie Curie', poste: 'Ingénieur', email: 'm@c.fr', tel: '0611', isAssemblage: true });
  });

  it('parse un CSV à séparateur virgule sans entête', () => {
    const parsed = parseContactsCsv('Jean,Chef,j@x.fr,07,Externe');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].nom).toBe('Jean');
    expect(parsed[0].isAssemblage).toBe(false);
  });

  it('ignore les lignes sans nom', () => {
    const parsed = parseContactsCsv('Nom;Poste;Email;Téléphone;Type\n;;vide@x.fr;;\nOK;;;;');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].nom).toBe('OK');
  });

  it('previewImport compte créations vs mises à jour (clé email puis nom)', () => {
    const existing = [{ id: '1', nom: 'Dupont', email: 'dup@x.fr', poste: '', tel: '', isAssemblage: false }];
    const parsed = [
      { nom: 'Dupont MAJ', email: 'dup@x.fr' },   // même email → update
      { nom: 'Nouveau', email: 'new@x.fr' },        // nouvel email → create
    ];
    expect(previewImport(parsed, existing)).toEqual({ total: 2, created: 1, updated: 1 });
  });

  it('previewImport ne supprime jamais (contacts absents du fichier ignorés)', () => {
    const existing = [{ id: '1', nom: 'A', email: 'a@x.fr' }, { id: '2', nom: 'B', email: 'b@x.fr' }];
    const parsed = [{ nom: 'A', email: 'a@x.fr' }];
    const r = previewImport(parsed, existing);
    expect(r.total).toBe(1); // seul A traité, B intact
    expect(r.updated).toBe(1);
    expect(r.created).toBe(0);
  });
});
