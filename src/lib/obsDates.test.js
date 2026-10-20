import { describe, it, expect } from 'vitest';
import { applyObsDates, obsDatesInfo, zoneDatesInfo, durationFr, fmtDateFr, itemMetaToRow, itemMetaFromRow } from './obsDates.js';

describe('applyObsDates — règles automatiques (optionnel par observation)', () => {
  it('création : AUCUNE date tant qu\'on n\'a pas cliqué « Dater »', () => {
    expect(applyObsDates(null, { id: 'a', suivi: 'rien' }, '2026-04-09').dateOuverture).toBeUndefined();
  });
  it('observation non datée passée « Fait » : toujours rien (pas de levée orpheline)', () => {
    const r = applyObsDates({ id: 'a' }, { id: 'a', suivi: 'fait' }, '2026-09-08');
    expect(r.dateOuverture).toBeUndefined();
    expect('dateCloture' in r).toBe(false);
    expect('dateCloture' in applyObsDates(null, { id: 'a', suivi: 'fait', dateCloture: '2026-09-08' }, '2026-09-08')).toBe(false);
  });
  it('date saisie : jamais écrasée', () => {
    expect(applyObsDates(null, { id: 'a', dateOuverture: '2026-01-02' }, '2026-04-09').dateOuverture).toBe('2026-01-02');
  });
  it('observation datée passée « Fait » : levée = date de la visite ; retour arrière : levée retirée', () => {
    const done = applyObsDates({ id: 'a', suivi: 'a_faire', dateOuverture: '2026-04-09' }, { id: 'a', suivi: 'fait', dateOuverture: '2026-04-09' }, '2026-09-08');
    expect(done.dateCloture).toBe('2026-09-08');
    const back = applyObsDates(done, { ...done, suivi: 'en_cours' }, '2026-10-01');
    expect('dateCloture' in back).toBe(false);
    expect(back.dateOuverture).toBe('2026-04-09');
  });
  it('levée saisie à la main : conservée', () => {
    const r = applyObsDates({ id: 'a', suivi: 'fait' }, { id: 'a', suivi: 'fait', dateOuverture: '2026-04-09', dateCloture: '2026-08-01' }, '2026-09-08');
    expect(r.dateCloture).toBe('2026-08-01');
  });
});

describe('affichage', () => {
  it('en cours : la 2e date « tourne » avec la date de la visite', () => {
    const it1 = { suivi: 'a_faire', dateOuverture: '2026-04-09' };
    expect(obsDatesInfo(it1, '2026-09-08')).toMatchObject({ closed: false, fin: '2026-09-08', duree: '5 mois' });
    expect(obsDatesInfo(it1, '2026-10-20').duree).toBe('6 mois');
  });
  it('levée : figée à la date de levée', () => {
    expect(obsDatesInfo({ suivi: 'fait', dateOuverture: '2026-04-09', dateCloture: '2026-04-30' }, '2026-10-20')).toMatchObject({ closed: true, fin: '2026-04-30', duree: '3 sem.' });
  });
  it('sans date d\'ouverture : rien', () => { expect(obsDatesInfo({ suivi: 'fait' }, '2026-10-20')).toBeNull(); });
  it('durées et format', () => {
    expect(durationFr('2026-01-01', '2026-01-05')).toBe('4 j');
    expect(durationFr('2025-01-01', '2026-03-01')).toBe('1 an 2 mois');
    expect(durationFr('2026-02-01', '2026-01-01')).toBe('');
    expect(fmtDateFr('2026-04-09')).toBe('09/04/2026');
  });
});

describe('stockage (colonne meta)', () => {
  it('aller-retour, valeurs invalides ignorées', () => {
    expect(itemMetaToRow({ dateOuverture: '2026-04-09', dateCloture: 'n/a' })).toEqual({ dateOuverture: '2026-04-09' });
    expect(itemMetaToRow({})).toBeNull();
    expect(itemMetaFromRow({ dateOuverture: '2026-04-09', dateCloture: '2026-09-08' })).toEqual({ dateOuverture: '2026-04-09', dateCloture: '2026-09-08' });
    expect(itemMetaFromRow('{"dateOuverture":"2026-04-09"}')).toEqual({ dateOuverture: '2026-04-09' });
    expect(itemMetaFromRow(null)).toEqual({});
  });
});

describe('zones datées', () => {
  it('sans levée : en cours ; avec levée : figée', () => {
    expect(zoneDatesInfo({ dateOuverture: '2026-04-09' }, '2026-10-20')).toMatchObject({ closed: false, duree: '6 mois' });
    expect(zoneDatesInfo({ dateOuverture: '2026-04-09', dateCloture: '2026-05-09' }, '2026-10-20')).toMatchObject({ closed: true, fin: '2026-05-09', duree: '4 sem.' });
    expect(zoneDatesInfo({ nom: 'RDC' }, '2026-10-20')).toBeNull();
  });
});
