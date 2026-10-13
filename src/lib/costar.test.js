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

  it('contrôles automatiques : chiffres fiables et observations citées', () => {
    const d = buildReportDigest({ localisations: [{ nom: 'Z', items: [
      { titre: 'Fissure', commentaire: 'ok', urgence: 'haute', suivi: 'a_faire', photos: [{ data: 'x' }] },
      { titre: ' fissure ', commentaire: '', photos: [] },
      { titre: '', commentaire: 'Un commentaire assez long pour ne pas être considéré comme court du tout.', urgence: 'basse' },
    ] }] });
    expect(d.text).toContain('Observations sans titre : 1 (Obs 3)');
    expect(d.text).toContain('Sans commentaire : 1 (Obs 2) ; commentaire très court (< 40 caractères) : 1 (Obs 1)');
    expect(d.text).toContain('Urgence non renseignée : 1 (Obs 2) ; suivi non renseigné : 2 (Obs 2, 3)');
    expect(d.text).toContain('Sans photo : 2 (Obs 2, 3)');
    expect(d.text).toContain('Classées « Urgent » : 1 (Obs 1)');
    expect(d.text).toContain('Titres en double : Obs 1 = 2');
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
    expect(r).toEqual({ note: 7, verdict: 'Tiguidou', bien: ['a'], ameliorer: ['b', 'c'], coince: [], priorite: '', reecriture: null, blague: '' });
  });

  it('JSON entouré de texte / balises, note bornée', () => {
    const r = parseCostarReply('Voilà :\n```json\n{"note": 14, "verdict": "x — y", "bien": "seul point"}\n```');
    expect(r.note).toBe(10);
    expect(r.verdict).toBe('x, y');
    expect(r.bien).toEqual(['seul point']);
    expect(r.coince).toEqual([]);
  });

  it('priorité + réécriture proposée', () => {
    const r = parseCostarReply(JSON.stringify({ note: 5, priorite: 'Classer Obs 2 en Urgent — vite', reecriture: { obs: 'Obs 2', avant: 'fissure', apres: 'Fissure traversante de [à compléter] mm' } }));
    expect(r.priorite).toBe('Classer Obs 2 en Urgent, vite');
    expect(r.reecriture).toEqual({ obs: 'Obs 2', avant: 'fissure', apres: 'Fissure traversante de [à compléter] mm' });
    expect(parseCostarReply('{"note":5,"reecriture":null}').reecriture).toBeNull();
    expect(parseCostarReply('{"note":5,"reecriture":{"avant":"x"}}').reecriture).toBeNull(); // sans version réécrite → rien
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
