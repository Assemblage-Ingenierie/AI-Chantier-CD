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
  it('le digest contient le FOND du rapport (textes), sans les champs de formulaire', () => {
    const d = buildReportDigest(projet);
    expect(d.observations).toBe(1); // l'obs totalement vide de la Cave n'est pas envoyée
    expect(d.zones).toBe(2);
    expect(d.text).toContain('503_SDC_86RDCLERY');
    expect(d.text).toContain('[Obs 1] Fissure limon');
    expect(d.text).toContain('Fissure traversante au 2e.');
    expect(d.text).toContain('• surveiller');
    // Rien à reprocher sur la forme : pas de « (sans titre) » / « (pas de texte) », obs vide non envoyée.
    expect(d.text).not.toContain('sans titre');
    expect(d.text).not.toContain('pas de texte');
    expect(d.text).toContain('CONCLUSION : Travaux à planifier.');
    expect(d.text).not.toContain('ne doit pas apparaître');
    // Costar juge le fond : ni présences, ni urgence/suivi, ni photos, ni date (demande Thomas).
    for (const form of ['Pierre', 'Gaël', 'absent', 'urgence', 'Urgent', 'suivi', 'photo', 'Date de visite', 'plan de repérage', 'CONTRÔLES']) expect(d.text).not.toContain(form);
    expect(reportItems(projet)).toHaveLength(2);
  });

  it('pas de conclusion → aucune ligne CONCLUSION (pas de reproche sur la forme)', () => {
    expect(buildReportDigest({ ...projet, includeConclusion: false }).text).not.toContain('CONCLUSION');
  });

  it('plafond : seuls les commentaires démesurés sont raccourcis', () => {
    const big = { localisations: [{ nom: 'Z', items: [{ titre: 'long', commentaire: 'a'.repeat(5000) }, { titre: 'court', commentaire: 'ok' }] }] };
    const d = buildReportDigest(big, { maxChars: 3000 });
    expect(d.text.length).toBeLessThanOrEqual(3000);
    expect(d.text).toContain('[suite raccourcie]');
    expect(d.text).toContain('[Obs 2] court');
  });

  it('plainText retire le HTML et le markdown', () => {
    expect(plainText('<p>a&amp;b</p><br>*c* <img src="x">')).toBe('a&b\nc [image]');
  });
});

describe('Costar — réponse IA', () => {
  it('JSON pur', () => {
    const r = parseCostarReply('{"note":7,"verdict":"Tiguidou","bien":["a"],"ameliorer":["b","c"],"coince":[]}');
    expect(r).toEqual({ note: 7, pertes: [], verdict: 'Tiguidou', bien: ['a'], ameliorer: ['b', 'c'], coince: [], priorite: '', reecriture: null, blague: '' });
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

  it('points perdus : la note = 10 − total, chaque retrait justifié', () => {
    const r = parseCostarReply(JSON.stringify({ note: 9, points_perdus: [{ points: 2, raison: 'Obs 3 : cause non argumentée' }, { points: 1, raison: 'Obs 5 : « à surveiller » flou' }, { points: 2, raison: '' }] }));
    expect(r.note).toBe(7); // 10 − 2 − 1 (la ligne sans raison est ignorée), pas le 9 annoncé
    expect(r.pertes).toEqual([{ points: 2, raison: 'Obs 3 : cause non argumentée', citation: '' }, { points: 1, raison: 'Obs 5 : « à surveiller » flou', citation: '' }]);
    expect(parseCostarReply('{"points_perdus":[]}').note).toBe(10);
  });

  it('garde-fou : un point retiré sans citation EXACTE du rapport est annulé', () => {
    const src = "[Obs 1] Fissure limon\n  Fisure traversante au 2e, à surveiller.\n[Obs 2] Plancher\n  Flèche visible, l’étaiement est à prévoir.";
    const reply = JSON.stringify({ points_perdus: [
      { points: 1, raison: 'Faute', citation: 'Fisure traversante' },                 // présent → compte
      { points: 2, raison: 'Sur-interprétation', citation: 'risque d’effondrement' }, // inventé → annulé
      { points: 1, raison: 'Flou', citation: '« à surveiller. »' },                  // guillemets/ponctuation tolérés
      { points: 1, raison: 'Apostrophe', citation: "l'étaiement est … prévoir" },     // ’ vs ' et morceaux « … »
      { points: 1, raison: 'Sans citation' },                                         // pas de preuve → annulé
    ] });
    const r = parseCostarReply(reply, src);
    expect(r.pertes.map(x => x.raison)).toEqual(['Faute', 'Flou', 'Apostrophe']);
    expect(r.note).toBe(7);
    // Fautes corrigées : la citation n'existe plus → plus de pénalité (retour Thomas : 9 → 5).
    expect(parseCostarReply(reply, src.replace('Fisure', 'Fissure')).note).toBe(8);
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
