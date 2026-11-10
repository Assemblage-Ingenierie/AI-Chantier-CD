import { describe, it, expect } from 'vitest';
import { parseLooseJson } from './aiJson.js';

const KEYS = ['corrections', 'reformulations', 'ajouts'];

describe('réponse IA : rien de jeté si elle est coupée', () => {
  it('JSON complet : lu tel quel', () => {
    const r = parseLooseJson('{"corrections":[],"reformulations":[{"extrait":"a","propositions":["b"]}],"ajouts":[]}', KEYS);
    expect(r.partial).toBe(false);
    expect(r.obj.reformulations).toHaveLength(1);
  });

  it('texte autour du JSON (Gemini) : toléré', () => {
    const r = parseLooseJson('Voici :\n```json\n{"corrections":[],"reformulations":[],"ajouts":[]}\n```', KEYS);
    expect(r.obj).toEqual({ corrections: [], reformulations: [], ajouts: [] });
  });

  it('réponse COUPÉE au milieu : les objets complets sont récupérés, le dernier tronqué ignoré', () => {
    const raw = '{"corrections":[{"extrait":"coulé","correction":"coulés"}],"reformulations":[{"extrait":"Montage des élévations en brique presque terminé","propositions":["Le montage des élévations en brique est presque achevé."],"raison":"clarté"},{"extrait":"les linteaux bétons sont presque tous coulé {en périphérie}","propositions":["Les linteaux en béton sont presque tous coul';
    const r = parseLooseJson(raw, KEYS);
    expect(r.partial).toBe(true);
    expect(r.obj.corrections).toEqual([{ extrait: 'coulé', correction: 'coulés' }]);
    expect(r.obj.reformulations).toHaveLength(1);
    expect(r.obj.reformulations[0].propositions[0]).toMatch(/presque achevé/);
    expect(r.obj.ajouts).toBeUndefined();
  });

  it('accolades et guillemets échappés DANS les textes : pas de confusion', () => {
    const raw = '{"reformulations":[{"extrait":"cote \\"{H}\\" à reprendre","propositions":["La cote « H } » est à reprendre."]}],"ajouts":[{"apres":"","texte":"À vérifier : ferraillage';
    const r = parseLooseJson(raw, KEYS);
    expect(r.obj.reformulations[0].extrait).toBe('cote "{H}" à reprendre');
    expect(r.obj.ajouts).toEqual([]);
  });

  it('rien d\'exploitable : obj null', () => {
    expect(parseLooseJson('Désolé, je ne peux pas.', KEYS).obj).toBeNull();
    expect(parseLooseJson('', KEYS).obj).toBeNull();
  });
});
