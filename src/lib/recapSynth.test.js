import { describe, it, expect } from 'vitest';
import { buildRecapDigest, parseRecapReply, applySynthesis, synthRows, isSynthMode, SYNTH_FLAG, recapUserPrompt } from './recapSynth.js';

const locs = [
  { id: 'l1', nom: 'Bâtiment rue', items: [
    { id: 'a', titre: 'Façade', commentaire: '<div>Bombement de la façade.</div><div>Travaux : tirants traversants.</div>', urgence: 'haute' },
    { id: 'b', titre: 'Fait', commentaire: 'déjà traité', suivi: 'fait' },
    { id: 'c', titre: 'Brouillon', commentaire: 'x', statut: 'brouillon' },
  ] },
];

describe('Synthèse du tableau récapitulatif (demande Thomas 24/11)', () => {
  it('digest : zones, observations avec urgence saisie ; ni brouillons ni points « faits »', () => {
    const d = buildRecapDigest(locs, { conclusion: 'Renforcer la façade.' });
    expect(d).toContain('ZONE : Bâtiment rue');
    expect(d).toContain('Façade [urgence saisie : Urgent]');
    expect(d).toContain('tirants traversants');
    expect(d).not.toContain('déjà traité');
    expect(d).not.toContain('Brouillon');
    expect(d).toContain('CONCLUSION : Renforcer la façade.');
  });
  it('réponse IA → lignes concises (priorité, « À définir » si pas de préconisation)', () => {
    let n = 0;
    const rows = parseRecapReply('```json\n{"points":[{"zone":"Façade rue","desordre":"Bombement de la façade.","preconisation":"Tirants traversants — ravalement","priorite":"urgent"},{"zone":"Cave","desordre":"Voûte fissurée","preconisation":"","priorite":"planifier"},{"zone":"x","desordre":"","preconisation":"y"}]}\n```', () => `s${++n}`);
    expect(rows).toEqual([
      { itemId: 's1', isCustom: true, synth: true, edited: false, zone: 'Façade rue', titre: 'Bombement de la façade', solution: 'Tirants traversants, ravalement', urgence: 'haute' },
      { itemId: 's2', isCustom: true, synth: true, edited: false, zone: 'Cave', titre: 'Voûte fissurée', solution: 'À définir', urgence: 'moyenne' },
    ]);
    expect(parseRecapReply('pas du json')).toBeNull();
  });
  it('régénérer : garde les lignes modifiées à la main, remplace les autres, garde les lignes manuelles', () => {
    const recap = [
      { itemId: SYNTH_FLAG, mode: 'synth', at: 1, ignored: ['Écarté'] },
      { itemId: 'old1', synth: true, isCustom: true, edited: false, titre: 'Ancien', urgence: 'basse' },
      { itemId: 'old2', synth: true, isCustom: true, edited: true, titre: 'Retouché', urgence: 'haute' },
      { itemId: 'custom_1', isCustom: true, titre: 'Ligne à la main', urgence: 'moyenne' },
      { itemId: 'obs-a', titre: 'surcharge ancienne version' },
    ];
    const next = applySynthesis(recap, [{ itemId: 'new1', synth: true, isCustom: true, titre: 'Nouveau', urgence: 'moyenne' }], 2);
    expect(next.map(r => r.itemId)).toEqual([SYNTH_FLAG, 'custom_1', 'obs-a', 'old2', 'new1']);
    expect(next[0]).toEqual({ itemId: SYNTH_FLAG, mode: 'synth', at: 2, ignored: ['Écarté'] });
    expect(isSynthMode(next)).toBe(true);
    expect(synthRows(next).map(r => r.titre)).toEqual(['Retouché', 'Ligne à la main', 'Nouveau']);
  });
  it('l\'IA ne répète pas les lignes gardées ni les points écartés', () => {
    const p = recapUserPrompt('RAPPORT', { keep: [{ zone: 'Cave', titre: 'Voûte' }], ignored: ['Écarté'] });
    expect(p).toContain('DÉJÀ RÉDIGÉS');
    expect(p).toContain('- Cave : Voûte');
    expect(p).toContain('ÉCARTÉS');
  });
});
