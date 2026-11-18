import { describe, it, expect } from 'vitest';
import { normNum, numFromName, parseFolderName, titleTokens, titleScore, editDistance, matchStrict, matchNumOnly, newFolderName } from '../../api/_driveMatch.js';

// Vrais noms de dossiers des Drives « AI_3_AFFAIRES » et « AI_3_AFFAIRES ARCHIVE ».
const AFFAIRES = [
  { id: 'a743', name: '2026_A743_BOURDEL_65RVOLTAIRE' },
  { id: 'a739', name: '2026_A739_OSSANT_68AVGDEGAULLE' },
  { id: 'a734', name: '2026_A734_ORIGINE_10RAGRIPPA-DAUBIGNE' },
  { id: 'a660', name: '2025_A660_LOREAL_GRASSE' },
];
const ARCHIVES = [
  { id: 'x541', name: '2022_541_MARECHAL_VITRY' },
  { id: 'x021', name: '2016_021_MANTES_PASSERELLE' },
  { id: 'x696', name: '2026_A696_PEGUY_102RAMELOT' },
  { id: 'x572', name: '2022_572_PEGUY_64RSAINTMAUR' },
];

describe('Dossier Drive d\'une affaire — anciens codes, fautes, archives', () => {
  it('numéros normalisés : A541 = 541 = 0541 ; 021 = 21', () => {
    expect(normNum('A541')).toBe('541');
    expect(normNum('0541')).toBe('541');
    expect(normNum('a 0541')).toBe('541');
    expect(normNum('021')).toBe('21');
    expect(normNum('Voltaire')).toBe(null);
    expect(numFromName('A696 Péguy')).toBe('A696');
    expect(numFromName('504 Pavillon')).toBe('504');
    expect(numFromName('Visite 2024 Voltaire')).toBe(null);
  });
  it('lecture des noms de dossiers (ancien et nouveau format)', () => {
    expect(parseFolderName('2026_A743_BOURDEL_65RVOLTAIRE')).toEqual({ year: '2026', num: '743', title: 'BOURDEL_65RVOLTAIRE' });
    expect(parseFolderName('2022_541_MARECHAL_VITRY')).toEqual({ year: '2022', num: '541', title: 'MARECHAL_VITRY' });
    expect(parseFolderName('2016_021_MANTES_PASSERELLE').num).toBe('21');
  });
  it('ressemblance de titre : mots collés du Drive, accents, petite faute', () => {
    expect(titleScore('65 rue Voltaire', 'BOURDEL_65RVOLTAIRE')).toBe(1);
    expect(titleScore('Bourdel Voltaire', 'BOURDEL_65RVOLTAIRE')).toBe(1);
    expect(titleScore('Maréchal Vitry', 'MARECHAL_VITRY')).toBe(1);
    expect(titleScore('Marechale Vitri', 'MARECHAL_VITRY')).toBeGreaterThanOrEqual(0.5); // fautes
    expect(titleScore('Loreal Grasse', 'BOURDEL_65RVOLTAIRE')).toBe(0);
    expect(titleScore('A743', 'X')).toBe(null); // pas de mot utile
    expect(titleTokens('SDC 12 rue de la Paix')).toEqual(['paix']);
    expect(editDistance('734', '743')).toBe(1); // deux chiffres inversés = une faute
  });
  it('1. bon numéro + titre ressemblant → dossier d\'Affaires', () => {
    expect(matchStrict(AFFAIRES, { num: 'A743', nom: 'Voltaire' })?.folder.id).toBe('a743');
  });
  it('ancien code sans « A » ni zéros : « A541 » retrouve « 2022_541_… » ; « 21 » retrouve « 021 »', () => {
    expect(matchStrict(ARCHIVES, { num: 'A541', nom: 'Maréchal Vitry' })?.folder.id).toBe('x541');
    expect(matchStrict(ARCHIVES, { num: '21', nom: 'Passerelle Mantes' })?.folder.id).toBe('x021');
  });
  it('2. numéro avec une faute mais titre très ressemblant → bon dossier', () => {
    const r = matchStrict(AFFAIRES, { num: 'A734', nom: 'Bourdel 65 rue Voltaire' }); // vrai : A743
    expect(r?.folder.id).toBe('a743');
  });
  it('mauvais numéro ET titre différent → rien (pas de dossier au hasard)', () => {
    expect(matchStrict(AFFAIRES, { num: 'A999', nom: 'Pavillon sous toit' })).toBe(null);
  });
  it('bon numéro mais titre différent → pas en stricte ; retenu en dernier recours (numéro seul)', () => {
    expect(matchStrict(AFFAIRES, { num: 'A739', nom: 'Pavillon sous toit' })).toBe(null);
    expect(matchNumOnly(AFFAIRES, { num: 'A739' })?.folder.id).toBe('a739');
  });
  it('deux dossiers au même titre (Péguy) : le numéro départage ; sans numéro on ne devine pas', () => {
    expect(matchStrict(ARCHIVES, { num: 'A572', nom: 'Péguy Saint-Maur' })?.folder.id).toBe('x572');
    expect(matchStrict(ARCHIVES, { num: '', nom: 'Péguy' })).toBe(null);
  });
  it('dossier créé au format habituel', () => {
    expect(newFolderName('65 rue Voltaire', 'a743', 2026)).toBe('2026_A743_65_RUE_VOLTAIRE');
    expect(newFolderName('A743 Voltaire', 'A743', 2026)).toBe('2026_A743_VOLTAIRE');
    expect(newFolderName('Pavillon', '', 2026)).toBe('PAVILLON');
  });
});
