// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { readDraft } from './ItemModal.jsx';

const KEY = 'chantierai_draft_obs1';
const put = (d) => localStorage.setItem(KEY, JSON.stringify(d));
beforeEach(() => localStorage.clear());

describe('Brouillon d\'une observation existante (incident 24/11 : améliorations écrasées)', () => {
  const saved = { id: 'obs1', titre: 'Porche', commentaire: '<div>Texte amélioré par l\'IA</div>' };
  it('texte enregistré modifié depuis le début du brouillon → brouillon IGNORÉ et effacé', () => {
    put({ titre: 'Porche', commentaire: '<div>AU nivedésordres ancien texte</div>', _ts: Date.now(), _base: { titre: 'Porche', commentaire: '<div>ancien texte</div>' } });
    expect(readDraft('obs1', 'P', saved)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it('texte enregistré inchangé → brouillon (saisie non enregistrée) proposé', () => {
    put({ titre: 'Porche', commentaire: '<div>ma saisie en cours</div>', _ts: Date.now(), _base: { titre: saved.titre, commentaire: saved.commentaire } });
    expect(readDraft('obs1', 'P', saved)).toMatchObject({ commentaire: '<div>ma saisie en cours</div>' });
  });
  it('ancien format (sans _base) de plus de 24 h → ignoré', () => {
    put({ titre: 'Porche', commentaire: 'vieux', _ts: Date.now() - 2 * 24 * 3600 * 1000 });
    expect(readDraft('obs1', 'P', saved)).toBeNull();
  });
  it('brouillon identique au texte enregistré → rien à restaurer', () => {
    put({ titre: saved.titre, commentaire: saved.commentaire, _ts: Date.now(), _base: { titre: saved.titre, commentaire: saved.commentaire } });
    expect(readDraft('obs1', 'P', saved)).toBeNull();
  });
});
