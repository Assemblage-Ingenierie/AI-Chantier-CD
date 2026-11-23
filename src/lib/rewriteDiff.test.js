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
