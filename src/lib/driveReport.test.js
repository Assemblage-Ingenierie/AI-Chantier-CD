import { describe, it, expect } from 'vitest';
import { pickDestFolder, bareName } from '../../api/drive-report.js';
import { reportFileName } from './driveReport.js';

describe('PDF du rapport sur le Drive (demande Thomas 24/11)', () => {
  const subs = [
    { id: '1', name: '00_GESTION' }, { id: '2', name: '02_VISITES' }, { id: '3', name: '08_DET' },
    { id: '4', name: '10_RENDUS AI' }, { id: '5', name: '10_RENDUS MOE' }, { id: '6', name: '11_PARTAGE MOE' },
  ];
  it('retrouve les sous-dossiers standard par leur nom (sans le numéro)', () => {
    expect(pickDestFolder(subs, 'visites').id).toBe('2');
    expect(pickDestFolder(subs, 'det').id).toBe('3');
    expect(pickDestFolder(subs, 'rendus').id).toBe('4');
    expect(pickDestFolder([{ id: 'x', name: '3_Visites' }], 'visites').id).toBe('x');
    expect(pickDestFolder(subs, 'inconnu')).toBeNull();
    expect(bareName('10_RENDUS_AI')).toBe('RENDUS AI');
  });
  it('nom de fichier stable par visite (même nom → mise à jour)', () => {
    expect(reportFileName({ dateVisite: '2026-11-20', code: 'A743', visiteLabel: 'DET n°5' })).toBe('2026-11-20_A743_Rapport_DET n°5.pdf');
    expect(reportFileName({ dateVisite: '2026-11-20', code: 'A743', visiteLabel: 'a/b' })).toBe('2026-11-20_A743_Rapport_a-b.pdf');
  });
});
