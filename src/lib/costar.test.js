import { describe, it, expect } from 'vitest';
import { buildReportDigest, parseCostarReply, scoreLabel, plainText, reportItems } from './costar.js';

const projet = {
  nom: '503_SDC_86RDCLERY', adresse: '86 rue de Cléry', maitreOuvrage: 'SDC 86', dateVisite: '2026-10-06',
  participants: [{ nom: 'Pierre', poste: 'Président', presence: 'present' }, { nom: 'Gaël', presence: 'absent' }],
  includeConclusion: true, conclusion: 'Travaux à **planifier**.',
  localisations: [
    { nom: 'Cage d\'escalier', planId: 'p1', items: [
      { id: 'a', titre: 'Fissure limon', commentaire: '<p>Fissure <b>traversante</b>&nbsp;au 2e.</p><ul><li>surveiller</li></ul>', urgence: 'haute', suivi: 'a_faire', photos: [{ data: 'https://x/1' }, { data: 'https://x/2' }] },
      { id: 'b', titre: 'Brouillon caché', commentaire: 'ne doit pas apparaître', statut: 'brouillon' },
    ] },
    { nom: 'Cave', items: [{ id: 'c', titre: '', commentaire: '', photos: [] }] },
  ],
};

describe('Costar — lecture du rapport', () => {
  it('le digest contient TOUT le rapport (hors brouillons)', () => {
    const d = buildReportDigest(projet);
    expect(d.observations).toBe(2);
    expect(d.zones).toBe(2);
    expect(d.text).toContain('503_SDC_86RDCLERY');
    expect(d.text).toContain('Pierre · Président (présent)');
    expect(d.text).toContain('Gaël (absent)');
    expect(d.text).toContain('Fissure traversante au 2e.');
    expect(d.text).toContain('• surveiller');
    expect(d.text).toContain('urgence : Urgent | suivi : À faire | 2 photo(s)');
    expect(d.text).toContain('plan de repérage joint');
    expect(d.text).toContain('(sans titre)');
    expect(d.text).toContain('urgence : non renseignée');
    expect(d.text).toContain('CONCLUSION : Travaux à planifier.');
    expect(d.text).not.toContain('ne doit pas apparaître');
    expect(reportItems(projet)).toHaveLength(2);
  });

  it('plafond : seuls les commentaires démesurés sont raccourcis', () => {
    const big = { localisations: [{ nom: 'Z', items: [{ titre: 'long', commentaire: 'a'.repeat(5000) }, { titre: 'court', commentaire: 'ok' }] }] };
    const d = buildReportDigest(big, { maxChars: 3000 });
    expect(d.text.length).toBeLessThanOrEqual(3000);
    expect(d.text).toContain('[suite raccourcie]');
    expect(d.text).toContain('Titre : court');
  });

  it('plainText retire le HTML et le markdown', () => {
    expect(plainText('<p>a&amp;b</p><br>*c* <img src="x">')).toBe('a&b\nc [image]');
  });
});

describe('Costar — réponse IA', () => {
  it('JSON pur', () => {
    const r = parseCostarReply('{"note":7,"verdict":"Tiguidou","bien":["a"],"ameliorer":["b","c"],"coince":[]}');
    expect(r).toEqual({ note: 7, verdict: 'Tiguidou', bien: ['a'], ameliorer: ['b', 'c'], coince: [] });
  });

  it('JSON entouré de texte / balises, note bornée', () => {
    const r = parseCostarReply('Voilà :\n```json\n{"note": 14, "verdict": "x — y", "bien": "seul point"}\n```');
    expect(r.note).toBe(10);
    expect(r.verdict).toBe('x, y');
    expect(r.bien).toEqual(['seul point']);
    expect(r.coince).toEqual([]);
  });

  it('réponse illisible → null', () => {
    expect(parseCostarReply('pas de json')).toBeNull();
    expect(parseCostarReply('{"verdict":"sans note"}')).toBeNull();
  });

  it('libellés de note', () => {
    expect(scoreLabel(2).label).toBe('Pas fameux');
    expect(scoreLabel(5).label).toBe('Peut mieux faire');
    expect(scoreLabel(7).label).toBe('Correct');
    expect(scoreLabel(8).label).toBe('Très bien');
    expect(scoreLabel(10).label).toBe('Parfait');
  });
});
