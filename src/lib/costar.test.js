import { describe, it, expect } from 'vitest';
import { buildReportDigest, parseCostarReply, scoreLabel, plainText, reportItems, costarCacheKey, COSTAR_SYSTEM } from './costar.js';

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
    expect(r).toEqual({ note: 7, pertes: [], plafond: null, verdict: 'Tiguidou', bien: ['a'], manques: [], ameliorer: ['b', 'c'], coince: [], priorite: '', reecriture: null, blague: '' });
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
    const r = parseCostarReply(JSON.stringify({ note: 9, points_perdus: [{ type: 'erreur', points: 2, raison: 'Obs 3 : cause non argumentée' }, { type: 'flou', points: 1, raison: 'Obs 5 : « à surveiller » flou' }, { points: 2, raison: '' }] }));
    expect(r.note).toBe(7); // 10 − 2 − 1 (la ligne sans raison est ignorée), pas le 9 annoncé
    expect(r.pertes).toEqual([{ type: 'erreur', points: 2, raison: 'Obs 3 : cause non argumentée', citation: '' }, { type: 'flou', points: 1, raison: 'Obs 5 : « à surveiller » flou', citation: '' }]);
    expect(parseCostarReply('{"points_perdus":[]}').note).toBe(10);
  });

  it('garde-fou : un point retiré sans citation EXACTE du rapport est annulé', () => {
    const src = "[Obs 1] Fissure limon\n  Fisure traversante au 2e, à surveiller.\n[Obs 2] Plancher\n  Flèche visible, l’étaiement est à prévoir.";
    const reply = JSON.stringify({ points_perdus: [
      { type: 'fautes', points: 1, raison: 'Faute', citation: 'Fisure traversante' },                 // présent → compte
      { points: 2, raison: 'Sur-interprétation', citation: 'risque d’effondrement' }, // inventé → annulé
      { points: 1, raison: 'Flou', citation: '« à surveiller. »' },                  // guillemets/ponctuation tolérés
      { type: 'erreur', points: 1, raison: 'Apostrophe', citation: "l'étaiement est … prévoir" },     // ’ vs ' et morceaux « … »
      { points: 1, raison: 'Sans citation' },                                         // pas de preuve → annulé
    ] });
    const r = parseCostarReply(reply, src);
    expect(r.pertes.map(x => x.raison)).toEqual(['Faute', 'Flou', 'Apostrophe']);
    expect(r.note).toBe(7);
    // Fautes corrigées : la citation n'existe plus → plus de pénalité (retour Thomas : 9 → 5).
    expect(parseCostarReply(reply, src.replace('Fisure', 'Fissure')).note).toBe(8);
  });

  it('retraits plafonnés PAR TYPE (retour Thomas 21/10 : 3/10 sur un « bon diagnostic », -1 « flou » par observation)', () => {
    const flous = Array.from({ length: 7 }, (_, i) => ({ type: 'flou', points: 1, raison: `Obs ${i + 1} : trop vague` }));
    const r = parseCostarReply(JSON.stringify({ points_perdus: flous }));
    expect(r.note).toBe(8);               // « flou » : 2 points au plus, quel que soit le nombre d'observations
    expect(r.pertes).toHaveLength(2);     // le total affiché = le total retiré
    const sansType = parseCostarReply(JSON.stringify({ points_perdus: [{ points: 3, raison: 'a' }, { points: 1, raison: 'b' }] }));
    expect(sansType.note).toBe(8);        // type absent/inconnu → compté comme « flou »
    const danger = parseCostarReply(JSON.stringify({ points_perdus: [
      { type: 'danger', points: 2, raison: 'Obs 1 : plancher sans étaiement' }, { type: 'danger', points: 2, raison: 'Obs 2 : garde-corps' },
      { type: 'action', points: 1, raison: 'x' }, { type: 'action', points: 1, raison: 'y' }, { type: 'action', points: 1, raison: 'z' }, { type: 'action', points: 1, raison: 'w' },
    ] }));
    expect(danger.note).toBe(3);          // un vrai danger pèse toujours lourd : 10 − 4 − 3
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

describe('Costar — économie de tokens', () => {
  it('clé de cache : même texte + même moteur → même clé ; sinon différente', () => {
    const a = costarCacheKey('rapport A', 'mistral');
    expect(costarCacheKey('rapport A', 'mistral')).toBe(a);
    expect(costarCacheKey('rapport A ', 'mistral')).not.toBe(a);
    expect(costarCacheKey('rapport A', 'gemini-flash')).not.toBe(a);
  });
  it('ne demande ni localisation (plans de repérage) ni estimation chiffrée (retour Thomas 24/11)', () => {
    expect(COSTAR_SYSTEM).toMatch(/plans de repérage/);
    expect(COSTAR_SYSTEM).toMatch(/estimation \(coût, charge, quantité, surface, linéaire\)/);
    expect(COSTAR_SYSTEM).toMatch(/« toute la zone »/);
    expect(COSTAR_SYSTEM).not.toMatch(/dimension, localisation, cause probable/);
  });
  it('préconisation donnée ailleurs dans le rapport = pas de retrait ; « flou » expliqué (retour Thomas 24/11)', () => {
    expect(COSTAR_SYSTEM).toMatch(/NULLE PART dans le rapport/);
    expect(COSTAR_SYSTEM).toMatch(/travaux à prévoir/);
    expect(COSTAR_SYSTEM).toMatch(/deux lectures possibles/);
  });
  it('consigne compacte mais complète (barème, interdits, preuve, format JSON)', () => {
    expect(COSTAR_SYSTEM.length).toBeLessThan(6500); // v1 : 7 547 caractères
    for (const k of ['-2', '"type"', 'EST une préconisation', 'INTERDIT', 'MOT POUR MOT', '"points_perdus"', '"reecriture"', '"blague"']) expect(COSTAR_SYSTEM).toContain(k);
  });
});

describe('Costar — barème exigeant (retour Amaury : 9/10 pour 9 lignes)', () => {
  it('plafond de volume : un rapport mince ne peut pas avoir une bonne note, même sans faute', () => {
    const r = parseCostarReply('{"points_perdus":[],"plafond":10}', null, { words: 40 });
    expect(r.note).toBe(4);
    expect(r.plafond.value).toBe(4);
    expect(r.plafond.raison).toMatch(/40 mots/);
    expect(parseCostarReply('{"points_perdus":[]}', null, { words: 5 }).note).toBe(0); // « 5 mots → 0 »
    // « Ce n'est pas plus c'est long plus c'est bon » : un petit rapport dense n'est pas plafonné par sa longueur.
    expect(parseCostarReply('{"points_perdus":[],"plafond":9}', null, { words: 120 }).note).toBe(9);
    expect(parseCostarReply('{"points_perdus":[],"plafond":4}', null, { words: 2000 }).note).toBe(4); // long mais creux
    expect(parseCostarReply('{"points_perdus":[],"plafond":0}', null, { words: 950 }).note).toBe(0);
  });
  it('plafond de valeur jugé par l\'IA, justifié ; le plus bas des plafonds l\'emporte', () => {
    const r = parseCostarReply('{"points_perdus":[],"plafond":7,"raison_plafond":"Pas de cause probable ni de délai"}', null, { words: 500 });
    expect(r.note).toBe(7);
    expect(r.plafond).toEqual({ value: 7, raison: 'Pas de cause probable ni de délai' });
    const r2 = parseCostarReply('{"points_perdus":[{"type":"action","points":3,"raison":"Obs 1 : x"}],"plafond":8}', null, { words: 500 });
    expect(r2.note).toBe(7); // les points perdus font déjà plus bas que le plafond
    expect(r2.plafond).toBeNull();
  });
  it('le digest compte les mots réellement écrits', () => {
    const d = buildReportDigest({ localisations: [{ nom: 'Cave', items: [{ titre: 'Fissure mur', commentaire: 'Fissure verticale à reprendre' }] }] });
    expect(d.words).toBe(6);
  });
  it('consigne : exigeante, avec plafond justifié', () => {
    expect(COSTAR_SYSTEM).toContain('"plafond"');
    expect(COSTAR_SYSTEM).toContain('EXIGEANT');
  });
});

import { reportObsIndex, splitObsRefs } from './costar.js';
describe('Costar : « Obs N » → titre + lien (demande Thomas 24/11)', () => {
  const projet = { nom: 'P', localisations: [
    { id: 'z1', nom: 'RDC', items: [
      { id: 'a', titre: 'Fissure poutre', commentaire: 'x' },
      { id: 'vide', titre: '', commentaire: '' },           // vide : pas numérotée
      { id: 'b', titre: '', commentaire: 'texte seul' },
      { id: 'br', titre: 'Brouillon', commentaire: 'y', statut: 'brouillon' },
    ] },
    { id: 'z2', nom: 'R+1', items: [{ id: 'c', titre: 'Linteau', commentaire: '' }] },
  ] };
  it('même numérotation que le texte envoyé à Costar', () => {
    const idx = reportObsIndex(projet);
    const digest = buildReportDigest(projet).text;
    for (const o of idx) expect(digest).toContain(`[Obs ${o.n}]${o.titre ? ` ${o.titre}` : ''}`);
    expect(idx.map(o => [o.n, o.itemId, o.locId])).toEqual([[1, 'a', 'z1'], [2, 'b', 'z1'], [3, 'c', 'z2']]);
  });
  it('repère « Obs 7 », « obs. 3 », « Obs n° 2 »', () => {
    expect(splitObsRefs('Obs 7 : flou, voir aussi obs. 3 et Obs n° 2.').filter(p => typeof p === 'object').map(p => p.obs)).toEqual([7, 3, 2]);
    expect(splitObsRefs('rien ici')).toEqual(['rien ici']);
  });
});

import { obsFingerprints, changedObs, stabilizeReview } from './costar.js';
describe('Costar — note stable après correction (retour Thomas 24/11 : 7 → 4 → 6)', () => {
  const projet = (t2) => ({ localisations: [{ id: 'l1', nom: 'RDC', items: [
    { id: 'a', titre: 'Porche', commentaire: 'Revêtement combustible à déposer.' },
    { id: 'b', titre: 'Façade', commentaire: t2 },
  ] }] });
  it('repère les observations modifiées', () => {
    const fp = obsFingerprints(projet('Fissure horizontale.'));
    const c = changedObs(projet('Fissure horizontale, à surveiller.'), fp);
    expect(c.nums).toEqual([2]);
    expect(c.text).toContain('à surveiller');
  });
  it('baisse sans lien avec ce qui a changé → note précédente conservée', () => {
    const next = { note: 4, pertes: [{ type: 'flou', points: 1, raison: 'Obs 1', citation: 'Revêtement combustible à déposer' }], plafond: { value: 4, raison: 'x' } };
    const r = stabilizeReview({ note: 7 }, next, { changedText: 'Façade\nFissure horizontale, à surveiller.', words: 200 });
    expect(r.note).toBe(7);
    expect(r.plafond).toBeNull();
    expect(r.stabilized).toEqual({ prev: 7, raw: 4 });
  });
  it('baisse justifiée par un passage MODIFIÉ → acceptée', () => {
    const next = { note: 5, pertes: [{ type: 'erreur', points: 2, raison: 'Obs 2', citation: 'à surveiller' }] };
    expect(stabilizeReview({ note: 7 }, next, { changedText: 'Fissure horizontale, à surveiller.', words: 200 }).note).toBe(5);
  });
  it('hausse : inchangée ; rapport vidé : le plafond de volume s\'applique quand même', () => {
    expect(stabilizeReview({ note: 6 }, { note: 8, pertes: [] }, { words: 200 }).note).toBe(8);
    expect(stabilizeReview({ note: 7 }, { note: 1, pertes: [] }, { words: 10 }).note).toBe(1);
  });
});
