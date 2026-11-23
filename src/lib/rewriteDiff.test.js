// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { buildRewriteSegments, composeRewrite, applyRewriteToHtml } from './rewriteDiff.js';

const toPlain = (html) => {
  const s = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/li>/gi, '\n').replace(/<\/(p|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n');
  const t = document.createElement('textarea'); t.innerHTML = s; return t.value;
};
const patchLine = (html, del, add) => html.replace(del, add);

describe('Réécriture IA du texte entier', () => {
  it('refuse une réécriture qui change le nombre de lignes (mise en forme protégée)', () => {
    expect(buildRewriteSegments('a\nb', 'a b c')).toBeNull();
    expect(buildRewriteSegments('a\n\nb', 'a\nx\nb')).toBeNull(); // ligne vide remplie
    expect(buildRewriteSegments('abc', 'abc')).toBeNull(); // rien à proposer
  });
  it('tout accepté → texte réécrit', () => {
    const plain = 'fissure vu sur poutre\nil faut reparer';
    const rw = 'Fissure constatée en sous-face de poutre.\nL\'entreprise devra la réparer.';
    const segs = buildRewriteSegments(plain, rw);
    expect(segs).not.toBeNull();
    expect(composeRewrite(segs)).toBe(rw);
  });
  it('passage gardé → original MAIS avec les fautes corrigées', () => {
    const plain = 'fissure vu sur poutre\nil faut reparer';
    const segs = buildRewriteSegments(plain, 'Fissure constatée sur poutre.\nL\'entreprise devra réparer.');
    // On garde tous les passages de la 2e ligne
    let line = 0; let pos = 0;
    const kept = segs.map(s => { const txt = s.type === 'eq' ? s.text : s.del; const l = line; line += (txt.match(/\n/g) || []).length; pos += txt.length; return s.type === 'fix' && l >= 1 ? { ...s, active: false } : s; });
    const out = composeRewrite(kept, [{ extrait: 'reparer', correction: 'réparer' }]);
    expect(out.split('\n')[1]).toBe('il faut réparer');
    expect(out.split('\n')[0]).toBe('Fissure constatée sur poutre.');
  });
  it('application au HTML : puces et gras conservés', () => {
    const html = '<ul><li>fissure <b>verticale</b> vu</li><li>reprendre</li></ul>';
    const plain = toPlain(html);
    const segs = buildRewriteSegments(plain, 'Fissure verticale constatée\nReprise à prévoir');
    const final = composeRewrite(segs);
    const out = applyRewriteToHtml(html, plain, final, { toPlain, patchLine });
    expect(out).not.toBeNull();
    expect(toPlain(out).replace(/\s+/g, ' ').trim()).toBe('Fissure verticale constatée Reprise à prévoir');
    expect(out).toContain('<li>');
    expect(out).toContain('<b>verticale</b>');
  });
  it('commentaire modifié entre-temps → null, rien touché', () => {
    const plain = 'a b c';
    expect(applyRewriteToHtml('<p>autre texte</p>', plain, 'A b c', { toPlain, patchLine })).toBeNull();
  });
});

import { numberLines, parseNumbered } from './rewriteDiff.js';
describe('Échange numéroté avec l\'IA', () => {
  const plain = 'fissure vu\n\npoutre P3 a reprendre\n';
  it('numérote les lignes non vides', () => {
    expect(numberLines(plain).text).toBe('[1] fissure vu\n[2] poutre P3 a reprendre');
  });
  it('recompose le même découpage ; ligne manquante = gardée', () => {
    expect(parseNumbered('[1] Fissure constatée.', plain)).toBe('Fissure constatée.\n\npoutre P3 a reprendre\n');
    expect(parseNumbered('Voici :\n[2] La poutre P3 est à reprendre.\n[1] Fissure constatée.', plain))
      .toBe('Fissure constatée.\n\nLa poutre P3 est à reprendre.\n');
  });
  it('ligne coupée en deux par l\'IA : recollée', () => {
    expect(parseNumbered('[1] Fissure\nconstatée.\n[2] P3', plain).split('\n')[0]).toBe('Fissure constatée.');
  });
  it('bout en bout : segments toujours constructibles', () => {
    expect(buildRewriteSegments(plain, parseNumbered('[1] Fissure constatée.\n[2] La poutre P3 est à reprendre.', plain))).not.toBeNull();
  });
});

describe('Passages par PHRASE entière', () => {
  it('une phrase modifiée = un seul passage, la phrase identique reste neutre', () => {
    const plain = 'fissure vu sur poutre. Le reste est ok. il faut reparer vite';
    const rw = 'Fissure constatée sur la poutre. Le reste est ok. L\'entreprise devra réparer rapidement.';
    const segs = buildRewriteSegments(plain, rw);
    const fixes = segs.filter(s => s.type === 'fix');
    expect(fixes).toHaveLength(2);
    expect(fixes[0].del.trim()).toBe('fissure vu sur poutre.');
    expect(fixes[0].add.trim()).toBe('Fissure constatée sur la poutre.');
    expect(fixes[1].del.trim()).toBe('il faut reparer vite');
    // Recomposition exacte : tout gardé = original ; tout accepté = réécrit
    expect(segs.map(s => (s.type === 'eq' ? s.text : s.del)).join('')).toBe(plain);
    expect(composeRewrite(segs)).toBe(rw);
  });
  it('garder une phrase : elle revient en entier, les autres sont réécrites', () => {
    const plain = 'phrase un mal ecrite. phrase deux aussi';
    const segs = buildRewriteSegments(plain, 'Première phrase bien écrite. Deuxième phrase correcte.');
    const kept = segs.map((s, i) => (s.type === 'fix' && s.id === 0 ? { ...s, active: false } : s));
    expect(composeRewrite(kept)).toBe('phrase un mal ecrite. Deuxième phrase correcte.');
  });
  it('plusieurs lignes : jamais de passage à cheval sur deux lignes', () => {
    const segs = buildRewriteSegments('ligne un\nligne deux', 'Ligne une.\nLigne deux.');
    for (const s of segs.filter(x => x.type === 'fix')) expect(s.del.trim()).not.toMatch(/\n/);
  });
});
