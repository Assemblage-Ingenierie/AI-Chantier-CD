import { describe, it, expect, beforeEach } from 'vitest';
import { collectCandidates, buildRestoredVisit, markVisitRecovery, loadRecoveryMemo } from './visitRecovery.js';

// Visite complète dans une ancienne sauvegarde ; aujourd'hui il n'en reste que des vestiges.
const full = {
  id: 'V', label: 'Visite 2', dateVisite: '2026-10-26',
  localisations: [
    { id: 'z1', nom: 'RDC', items: [
      { id: 'a', titre: 'Fissure', commentaire: 'Fissure en escalier au droit du linteau', _photosHydrated: true, photos: [{ _id: 'pa', storage_url: 'pav/a/pa.webp', data: null }] },
      { id: 'b', titre: 'Humidité', commentaire: 'Remontées capillaires', photos: [{ _id: 'pb', data: null }] }, // octets perdus
    ] },
    { id: 'z2', nom: 'Cave', parentId: 'z1', items: [{ id: 'c', titre: 'Poutre', commentaire: 'Poutre bois attaquée' }] },
  ],
};
const projetNow = (visites) => ({ id: 'P', nom: 'Pavillons', visites });
const snap = (ts, visites) => ({ ts, data: [{ id: 'P', nom: 'Pavillons', visites }] });
let n;
const uuid = () => `new${++n}`;

beforeEach(() => { n = 0; localStorage.clear(); });

describe('restauration d\'une visite depuis les sauvegardes de l\'appareil', () => {
  it('trouve la version la plus complète, ignore les suppressions volontaires', () => {
    const vestiges = { ...full, localisations: [{ id: 'z1', nom: 'RDC', items: [{ id: 'a', titre: 'Fissure', commentaire: '' }] }] };
    const now = projetNow([vestiges]);
    const best = new Map();
    collectCandidates(best, snap(100, [{ ...full, localisations: [full.localisations[0]] }]), now); // partielle
    collectCandidates(best, snap(200, [full]), now);                                               // complète
    collectCandidates(best, snap(300, [vestiges]), now);                                           // déjà abîmée
    const c = best.get('V');
    expect(c.ts).toBe(200);
    expect(c.missing).toBe(2);
    expect(c.exists).toBe(true);
    // « c » supprimée volontairement → jamais proposée.
    const b2 = collectCandidates(new Map(), snap(200, [full]), now, { tombItems: new Set(['b', 'c']) });
    expect(b2.has('V')).toBe(false);
  });

  it('visite encore présente (vestiges) → restaurée EN COPIE, rien d\'écrasé ; observations absentes gardent leur id', () => {
    const vestiges = { ...full, localisations: [{ id: 'z1', nom: 'RDC', items: [{ id: 'a', titre: 'Fissure', commentaire: '' }] }] };
    const { visit, asCopy, droppedPhotos } = buildRestoredVisit(full, projetNow([vestiges]), uuid);
    expect(asCopy).toBe(true);
    expect(visit.id).not.toBe('V');
    expect(visit.label).toBe('Visite 2 (restaurée)');
    const [z1, z2] = visit.localisations;
    expect(z1.id).not.toBe('z1');                 // zone encore présente → copie
    expect(z2.id).toBe('z2');                     // zone absente → id d'origine
    expect(z2.parentId).toBe(z1.id);              // groupe de zones suivi dans la copie
    const [a, b] = z1.items;
    expect(a.id).not.toBe('a');                   // observation encore présente → copie…
    expect(a.photos[0]._id).not.toBe('pa');       // …avec photo re-référencée (même fichier)
    expect(a.photos[0].storage_url).toBe('pav/a/pa.webp');
    expect(a.commentaire).toBe('Fissure en escalier au droit du linteau'); // le texte complet revient
    expect(b.id).toBe('b');                       // observation absente → id d'origine
    expect(b.photos).toEqual([]);                 // photo sans source connue : pas de lien cassé
    expect(droppedPhotos).toBe(1);
    expect(z2.items[0].id).toBe('c');
  });

  it('ce qui a été supprimé volontairement ne revient pas', () => {
    const { visit } = buildRestoredVisit(full, projetNow([]), uuid, { item: new Set(['b']), loc: new Set(['z2']) });
    expect(visit.localisations.map(l => l.id)).toEqual(['z1']);
    expect(visit.localisations[0].items.map(i => i.id)).toEqual(['a']);
  });

  it('visite disparue → remise avec son identifiant et son nom d\'origine', () => {
    const { visit, asCopy } = buildRestoredVisit(full, projetNow([]), uuid);
    expect(asCopy).toBe(false);
    expect(visit.id).toBe('V');
    expect(visit.label).toBe('Visite 2');
    expect(visit.localisations.map(l => l.id)).toEqual(['z1', 'z2']);
    expect(visit.localisations[0].items[0].photos[0]._id).toBe('pa');
  });

  it('restaurée ou ignorée → plus proposée (sauf sauvegarde plus récente)', () => {
    const now = projetNow([]);
    markVisitRecovery('V', 200);
    expect(loadRecoveryMemo().V).toBe(200);
    expect(collectCandidates(new Map(), snap(200, [full]), now, { memo: loadRecoveryMemo() }).has('V')).toBe(false);
    expect(collectCandidates(new Map(), snap(250, [full]), now, { memo: loadRecoveryMemo() }).has('V')).toBe(true);
  });
});
