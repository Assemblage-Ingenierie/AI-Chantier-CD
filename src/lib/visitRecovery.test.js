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
    const sameA = projetNow([{ ...full, localisations: [{ id: 'z1', nom: 'RDC', items: [full.localisations[0].items[0]] }] }]);
    const b2 = collectCandidates(new Map(), snap(200, [full]), sameA, { tombItems: new Set(['b', 'c']) });
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

  it('observations encore là mais ANCIEN texte et photos disparues (cas Pavillons) → proposée', () => {
    const abimee = { ...full, localisations: [
      { id: 'z1', nom: 'RDC', items: [
        { id: 'a', titre: 'Fissure', commentaire: 'A voir', _photosHydrated: true, photos: [] },
        { id: 'b', titre: 'Humidité', commentaire: 'Remontées capillaires', _photosHydrated: true, photos: [] } ] },
      { id: 'z2', nom: 'Cave', parentId: 'z1', items: [{ id: 'c', titre: 'Poutre', commentaire: 'Poutre bois attaquée' }] } ] };
    const c = collectCandidates(new Map(), snap(200, [full]), projetNow([abimee])).get('V');
    expect(c.missing).toBe(0);
    expect(c.textItems).toBe(1);
    expect(c.photoGain).toBe(1);   // pa a disparu (pb n'a pas de source connue → pas comptée)
    // Et la copie restaurée ramène le texte complet + la photo, sans toucher à l'actuelle.
    const { visit } = buildRestoredVisit(c.visit, projetNow([abimee]), uuid);
    const a = visit.localisations[0].items[0];
    expect(a.commentaire).toBe('Fissure en escalier au droit du linteau');
    expect(a.photos.map(p => p.storage_url)).toEqual(['pav/a/pa.webp']);
    // Version identique à aujourd'hui → rien à proposer.
    expect(collectCandidates(new Map(), snap(300, [full]), projetNow([full])).has('V')).toBe(false);
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

describe('versions d\'une visite (choix manuel)', () => {
  it('liste les versions de la plus récente à la plus ancienne, sans doublons identiques', async () => {
    const { addVersions } = await import('./visitRecovery.js');
    const acc = new Map();
    const v1 = { id: 'V', label: 'Visite', localisations: [{ id: 'z', items: [{ id: 'a', titre: 'Fissure', commentaire: 'court', photos: [] }] }] };
    const v2 = { ...v1, localisations: [{ id: 'z', items: [{ id: 'a', titre: 'Fissure', commentaire: 'texte bien plus complet', photos: [{ _id: 'p' }] }] }] };
    for (const [ts, v] of [[300, v2], [200, v2], [100, v1]]) addVersions(acc, { ts, data: [{ id: 'P', visites: [v] }] }, 'P');
    const vs = acc.get('V').versions;
    expect(vs.map(x => x.ts)).toEqual([300, 100]);
    expect(vs[0]).toMatchObject({ items: 1, photos: 1 });
    expect(addVersions(new Map(), { ts: 1, data: [{ id: 'X', visites: [v1] }] }, 'P').size).toBe(0);
  });
});
