import { describe, it, expect } from 'vitest';
import { splitComment } from '../components/vue/RapportPreview/layout.js';

// Retour Gab/Thomas 20/11 : un long commentaire mis en forme était coupé en pleine phrase
// (« … de remplacer les bacs | acier déformés. »), gras perdu, nouvelle « section ».
describe('Découpe des longs commentaires du rapport', () => {
  const para = (t) => `<div><b>${t}</b></div>`;
  const long = (n) => 'Lorem ipsum dolor sit amet consectetur. '.repeat(n);

  it('court : jamais découpé', () => {
    expect(splitComment('<div>Court</div>')).toEqual(['<div>Court</div>']);
  });
  it('HTML : coupé seulement ENTRE paragraphes, sans perdre une balise ni une lettre', () => {
    const html = [para(long(30)), para('Il faut remplacer les bacs acier déformés.'), para(long(30)), para(long(30))].join('');
    const chunks = splitComment(html, 2500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(html);                       // rien de perdu, ordre intact
    for (const c of chunks) {
      expect(c.startsWith('<div>')).toBe(true);              // chaque morceau commence par un paragraphe
      expect(c.endsWith('</div>')).toBe(true);               // … et se termine par un paragraphe complet
    }
    expect(chunks.some(c => c.includes('remplacer les bacs acier déformés.'))).toBe(true); // phrase entière
  });
  it('HTML : la longueur compte le texte VISIBLE (les balises ne déclenchent pas de découpe)', () => {
    const html = Array.from({ length: 40 }, (_, i) => `<div><span style="font-weight:bold;color:#000">Ligne ${i}</span></div>`).join('');
    expect(html.length).toBeGreaterThan(2500);
    expect(splitComment(html, 2500)).toEqual([html]);
  });
  it('HTML : un seul énorme paragraphe → pas coupé au milieu', () => {
    const html = para(long(120));
    expect(splitComment(html, 2500)).toEqual([html]);
  });
  it('texte brut sans paragraphe : coupé à une fin de phrase', () => {
    const txt = long(120);
    const chunks = splitComment(txt, 2500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].endsWith('.')).toBe(true);
  });
});

describe('Texte avec image collée (retour Gab 24/11)', () => {
  it('une image compte dans la hauteur : le texte est coupé ENTRE deux paragraphes', () => {
    const p = (n) => `<div>${'Constat détaillé de la fissure. '.repeat(n)}</div>`;
    const html = p(30) + '<div><img data-cimg="x.webp" src="data:image/webp;base64,AAA"></div>' + p(30);
    const chunks = splitComment(html, 2500);
    expect(chunks.length).toBe(2);
    expect(chunks.join('')).toBe(html);
    expect(chunks.every(c => !/<div>[^<]*$/.test(c))).toBe(true); // jamais au milieu d'un paragraphe
  });
});
