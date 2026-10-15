import { describe, it, expect } from 'vitest';
import { chunkForCorrection, mapLimit } from './spellChunks.js';

describe('chunkForCorrection', () => {
  it('texte court : un seul morceau, identique', () => {
    expect(chunkForCorrection('Fissure verticale.\nÀ surveiller.')).toEqual(['Fissure verticale.\nÀ surveiller.']);
  });

  it('texte long en paragraphes : coupe entre paragraphes, recollage exact', () => {
    const para = 'Le mur porteur présente une fissure verticale traversante de 2 mm. ';
    const text = Array.from({ length: 12 }, (_, i) => `${i}. ${para.repeat(5)}`).join('\n\n') + '\n';
    const chunks = chunkForCorrection(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(1000));
    // chaque morceau (sauf le dernier) se termine par un saut de ligne
    chunks.slice(0, -1).forEach(c => expect(c.endsWith('\n')).toBe(true));
  });

  it('un seul paragraphe très long : coupe en fin de phrase, jamais au milieu d’un mot', () => {
    const text = 'Le plancher fléchit nettement sous charge. '.repeat(120);
    const chunks = chunkForCorrection(text, 900);
    expect(chunks.join('')).toBe(text);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(900));
    chunks.slice(0, -1).forEach(c => expect(/\.\s$/.test(c)).toBe(true));
  });

  it('sans ponctuation : coupe sur un espace', () => {
    const text = 'mot '.repeat(1000);
    const chunks = chunkForCorrection(text, 500);
    expect(chunks.join('')).toBe(text);
    chunks.slice(0, -1).forEach(c => expect(c.endsWith(' ')).toBe(true));
  });
});

describe('mapLimit', () => {
  it('garde l’ordre et borne la concurrence', async () => {
    let live = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
      live++; peak = Math.max(peak, live);
      await new Promise(r => setTimeout(r, 5));
      live--; return x * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
