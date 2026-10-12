import { describe, it, expect } from 'vitest';
import { buildDiffSegments, applyFixesAtPositions } from './applyTextFixes.js';

// Texte brut tel que produit par htmlToPlain pour un HTML simple (une ligne par <div>).
const plainOf = (html) => {
  const d = new DOMParser().parseFromString(html, 'text/html');
  return [...d.body.childNodes].map(n => n.textContent).join('\n');
};
const textOf = (html) => new DOMParser().parseFromString(html, 'text/html').body.textContent;

describe('applyFixesAtPositions — corrections appliquées à leur position exacte', () => {
  it('cas réel Thomas : insertion, mot en trop et fautes, sans abîmer le reste', () => {
    const html = "<div>Dans l'appartement ddu M. Lesterlin, nous notons la présence  plusieurs fissurent au niveau de la chambre.</div>"
      + '<div>Fissurations au niveau de du plafond dans les coin côté cour.</div>';
    const plain = plainOf(html);
    const corrected = "Dans l'appartement du M. Lesterlin, nous notons la présence de plusieurs fissures au niveau de la chambre.\n"
      + 'Fissurations au niveau du plafond dans les coins côté cour.';
    const out = applyFixesAtPositions(html, plain, buildDiffSegments(plain, corrected));
    expect(out).not.toBeNull();
    expect(textOf(out)).toBe(corrected.replace('\n', ''));
    // la phrase correcte « au niveau de la chambre » n'est PAS touchée
    expect(textOf(out)).toContain('au niveau de la chambre');
  });

  it('conserve la mise en forme (gras) autour des corrections', () => {
    const html = '<div><b>Fissurent</b> au niveau du linteau.</div>';
    const plain = plainOf(html);
    const out = applyFixesAtPositions(html, plain, buildDiffSegments(plain, 'Fissures au niveau du linteau.'));
    expect(out).toContain('<b>Fissures</b>');
  });

  it('une correction désactivée n\'est pas appliquée', () => {
    const html = '<div>les coin et ddu plafond</div>';
    const plain = plainOf(html);
    const segs = buildDiffSegments(plain, 'les coins et du plafond');
    segs.find(s => s.type === 'fix' && s.del === 'coin').active = false;
    expect(textOf(applyFixesAtPositions(html, plain, segs))).toBe('les coin et du plafond');
  });

  it('apostrophes/espaces insécables différents ne sont PAS des fautes (pas de fausse correction)', () => {
    const curly = String.fromCharCode(0x2019), nbsp = String.fromCharCode(0x00a0);
    const orig = `Dans l${curly}appartement${nbsp}: la cage d${curly}escalier`;
    const corr = "Dans l'appartement : la cage d'escalier";
    const segs = buildDiffSegments(orig, corr);
    expect(segs.some(s => s.type === 'fix')).toBe(false);
    // le diff recompose exactement l'ORIGINAL (typographie d'origine conservée)
    expect(segs.map(s => (s.type === 'eq' ? s.text : s.del)).join('')).toBe(orig);
  });

  it('vraie faute à côté d\'une différence typographique : seule la faute est proposée', () => {
    const curly = String.fromCharCode(0x2019);
    const orig = `la cage d${curly}escalier ddu batiment`;
    const segs = buildDiffSegments(orig, "la cage d'escalier du batiment");
    const fixes = segs.filter(s => s.type === 'fix');
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ del: 'ddu', add: 'du' });
  });

  it('texte modifié entre-temps → null (l\'app garde l\'ancienne méthode, aucune perte)', () => {
    const segs = buildDiffSegments('un texte ancien', 'un texte corrigé');
    expect(applyFixesAtPositions('<div>autre chose</div>', 'un texte ancien', segs)).toBeNull();
  });
});
