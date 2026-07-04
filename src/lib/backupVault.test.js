import { describe, it, expect } from 'vitest';
import { contentWeight, detectLoss } from './backupVault.js';

// Fonctions pures : filet de sécurité pour la détection de perte (boîte noire).
const proj = (id, opts = {}) => ({
  id,
  nom: opts.nom ?? 'P',
  visites: [{
    id: `${id}-v1`,
    conclusion: opts.conclusion ?? '',
    localisations: (opts.locs ?? []).map((l, i) => ({
      id: `${id}-l${i}`, nom: l.nom ?? 'loc',
      items: (l.items ?? []).map((it, j) => ({ id: `${id}-i${j}`, titre: it.titre ?? 't', commentaire: it.commentaire ?? '' })),
    })),
  }],
});

describe('contentWeight', () => {
  it('pondère items > locs > visites et additionne le texte', () => {
    const { byId, total } = contentWeight([proj('a', { locs: [{ items: [{}, {}] }] })]);
    // 2 items*100 + 1 loc*50 + 1 visite*20 + texte
    expect(byId['a'].items).toBe(2);
    expect(byId['a'].locs).toBe(1);
    expect(byId['a'].visites).toBe(1);
    expect(byId['a'].score).toBeGreaterThanOrEqual(2 * 100 + 50 + 20);
    expect(total).toBe(byId['a'].score);
  });

  it('ignore les projets sans id', () => {
    const { byId } = contentWeight([{ nom: 'sans id' }]);
    expect(Object.keys(byId)).toHaveLength(0);
  });
});

describe('detectLoss', () => {
  it('ne signale rien quand le contenu est stable', () => {
    const snap = [proj('a', { locs: [{ items: [{}, {}] }] })];
    expect(detectLoss(snap, snap)).toEqual([]);
  });

  it('signale un projet entièrement disparu (kind: missing)', () => {
    const snap = [proj('a', { locs: [{ items: [{}, {}] }] })];
    const lost = detectLoss(snap, []);
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ id: 'a', kind: 'missing' });
  });

  it('signale une régression marquée (item perdu, kind: shrunk)', () => {
    const before = [proj('a', { locs: [{ items: [{}, {}, {}] }] })];
    const after = [proj('a', { locs: [{ items: [{}] }] })];
    const lost = detectLoss(before, after);
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ id: 'a', kind: 'shrunk' });
  });

  it('ne signale pas une micro-modification de texte', () => {
    const before = [proj('a', { conclusion: 'texte original', locs: [{ items: [{ commentaire: 'abc' }] }] })];
    const after = [proj('a', { conclusion: 'texte modifie', locs: [{ items: [{ commentaire: 'abd' }] }] })];
    expect(detectLoss(before, after)).toEqual([]);
  });
});
