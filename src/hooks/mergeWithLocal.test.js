import { describe, it, expect, vi } from 'vitest';

// pdfUtils importe pdfjs (worker) — inutile et fragile en test : on le neutralise.
vi.mock('../lib/pdfUtils.js', () => ({ renderPdfPage: vi.fn() }));
vi.mock('../lib/planThumbCache.js', () => ({ getPlanThumbs: vi.fn(), setPlanThumbs: vi.fn() }));
vi.mock('../lib/photoPrefs.js', () => ({ getPhotoPref: vi.fn(() => ({})), setPhotoAnnotPref: vi.fn() }));

import { mergeWithLocal } from './useProjets.js';

// Fabriques minimales conformes à la forme attendue par mergeWithLocal.
const loc = (id, items = []) => ({ id, nom: 'loc', items, extraPlans: [] });
const visite = (id, locs = []) => ({ id, localisations: locs });
const proj = (id, opts = {}) => ({
  id,
  nom: opts.nom ?? id,
  statut: opts.statut ?? 'en_cours',
  updatedAt: opts.updatedAt ?? '2026-06-01T00:00:00.000Z',
  photo: opts.photo ?? null,
  planLibrary: opts.planLibrary ?? [],
  visites: opts.visites ?? [visite(`${id}-v1`, opts.locs ?? [])],
});

describe('mergeWithLocal — résolution local/remote', () => {
  it('non-dirty : le remote fait autorité quand il est plus récent', () => {
    const remote = [proj('a', { nom: 'REMOTE', updatedAt: '2026-06-10T00:00:00.000Z' })];
    const local  = [proj('a', { nom: 'LOCAL',  updatedAt: '2026-06-01T00:00:00.000Z' })];
    const { allMerged, keptLocal } = mergeWithLocal(remote, local, new Set(), new Set(['a']), new Set());
    expect(allMerged.find(p => p.id === 'a').nom).toBe('REMOTE');
    expect(keptLocal).toBe(false);
  });

  it('local plus récent (updatedAt) : le local est conservé et marqué keptLocal', () => {
    const remote = [proj('a', { nom: 'REMOTE', updatedAt: '2026-06-01T00:00:00.000Z' })];
    const local  = [proj('a', { nom: 'LOCAL',  updatedAt: '2026-06-10T00:00:00.000Z' })];
    const { allMerged, keptLocal, keptLocalIds } = mergeWithLocal(remote, local, new Set(), new Set(['a']), new Set());
    expect(allMerged.find(p => p.id === 'a').nom).toBe('LOCAL');
    expect(keptLocal).toBe(true);
    expect(keptLocalIds.has('a')).toBe(true);
  });

  it('dirty : le local gagne même si le remote est plus récent', () => {
    const remote = [proj('a', { nom: 'REMOTE', updatedAt: '2026-06-30T00:00:00.000Z' })];
    const local  = [proj('a', { nom: 'LOCAL',  updatedAt: '2026-06-01T00:00:00.000Z' })];
    const { allMerged } = mergeWithLocal(remote, local, new Set(['a']), new Set(['a']), new Set());
    expect(allMerged.find(p => p.id === 'a').nom).toBe('LOCAL');
  });

  it('unsynced : un projet local jamais vu sur le remote est repoussé', () => {
    const remote = [];
    const local  = [proj('new', { nom: 'NOUVEAU' })];
    const { allMerged, unsynced } = mergeWithLocal(remote, local, new Set(), new Set(), new Set());
    expect(unsynced.map(p => p.id)).toContain('new');
    expect(allMerged.find(p => p.id === 'new')).toBeTruthy();
  });

  it('supprimé ailleurs : un projet local déjà vu sur le remote (previousRemoteIds) est abandonné', () => {
    const remote = [];
    const local  = [proj('gone')];
    const { allMerged, unsynced } = mergeWithLocal(remote, local, new Set(), new Set(['gone']), new Set());
    expect(unsynced).toHaveLength(0);
    expect(allMerged.find(p => p.id === 'gone')).toBeFalsy();
  });

  it('tombstone : un projet supprimé (deletedIds) n\'est jamais repoussé', () => {
    const remote = [];
    const local  = [proj('dead')];
    const { allMerged, unsynced } = mergeWithLocal(remote, local, new Set(['dead']), null, new Set(['dead']));
    expect(unsynced).toHaveLength(0);
    expect(allMerged.find(p => p.id === 'dead')).toBeFalsy();
  });

  it('non-dirty : une localisation locale absente du remote (zone ajoutée) est préservée', () => {
    const remote = [proj('a', { updatedAt: '2026-06-10T00:00:00.000Z', locs: [loc('l1')] })];
    const local  = [proj('a', { updatedAt: '2026-06-01T00:00:00.000Z', locs: [loc('l1'), loc('l2-local')] })];
    const { allMerged, keptLocalIds } = mergeWithLocal(remote, local, new Set(), new Set(['a']), new Set());
    const locs = allMerged.find(p => p.id === 'a').visites[0].localisations.map(l => l.id);
    expect(locs).toContain('l2-local');
    expect(keptLocalIds.has('a')).toBe(true);
  });

  it('tombstone observation : une obs supprimée (deletedItemIds) est retirée même si le remote la renvoie', () => {
    const remote = [proj('a', { updatedAt: '2026-06-10T00:00:00.000Z',
      locs: [loc('l1', [{ id: 'itVivante', titre: 'vivante' }, { id: 'itMorte', titre: 'morte' }])] })];
    const local  = [proj('a', { updatedAt: '2026-06-01T00:00:00.000Z',
      locs: [loc('l1', [{ id: 'itVivante', titre: 'vivante' }])] })];
    // deletedItemIds = { itMorte } → l'obj ressuscité par le remote doit disparaître du résultat.
    const { allMerged } = mergeWithLocal(remote, local, new Set(), new Set(['a']), new Set(), new Set(['itMorte']));
    const items = allMerged.find(p => p.id === 'a').visites[0].localisations[0].items.map(i => i.id);
    expect(items).toContain('itVivante');
    expect(items).not.toContain('itMorte');
  });

  it('tombstone zone : une zone supprimée (deletedLocIds) disparaît avec ses observations, même renvoyée par le remote', () => {
    const remote = [proj('a', { updatedAt: '2026-06-10T00:00:00.000Z',
      locs: [loc('lGarde', [{ id: 'o1', titre: 'x' }]), loc('lMorte', [{ id: 'o2', titre: 'y' }])] })];
    const local  = [proj('a', { updatedAt: '2026-06-01T00:00:00.000Z', locs: [loc('lGarde', [{ id: 'o1', titre: 'x' }])] })];
    const { allMerged } = mergeWithLocal(remote, local, new Set(), new Set(['a']), new Set(), null, new Set(['lMorte']));
    const locs = allMerged.find(p => p.id === 'a').visites[0].localisations;
    expect(locs.map(l => l.id)).toEqual(['lGarde']);
    expect(locs[0].items.map(i => i.id)).toEqual(['o1']);
  });

  it('tombstone zone en chemin dirty : la zone supprimée reste retirée', () => {
    const remote = [proj('a', { locs: [loc('lMorte')] })];
    const local  = [proj('a', { locs: [loc('lMorte'), loc('lVivante')] })];
    const { allMerged } = mergeWithLocal(remote, local, new Set(['a']), new Set(['a']), new Set(), null, new Set(['lMorte']));
    expect(allMerged.find(p => p.id === 'a').visites[0].localisations.map(l => l.id)).toEqual(['lVivante']);
  });

  it('groupes de zones : le lien parentId (R+4 › appartement) survit à la fusion, dirty comme non-dirty', () => {
    const remote = [proj('a', { updatedAt: '2026-06-10T00:00:00.000Z', locs: [loc('r4'), { ...loc('alb'), parentId: 'r4' }] })];
    const local  = [proj('a', { updatedAt: '2026-06-01T00:00:00.000Z', locs: [loc('r4'), { ...loc('alb'), parentId: 'r4' }] })];
    const nonDirty = mergeWithLocal(remote, local, new Set(), new Set(['a']), new Set()).allMerged;
    expect(nonDirty.find(p => p.id === 'a').visites[0].localisations.find(l => l.id === 'alb').parentId).toBe('r4');
    const dirty = mergeWithLocal(remote, local, new Set(['a']), new Set(['a']), new Set()).allMerged;
    expect(dirty.find(p => p.id === 'a').visites[0].localisations.find(l => l.id === 'alb').parentId).toBe('r4');
  });

  it('sans tombstone observation : comportement inchangé (le remote garde ses items)', () => {
    const remote = [proj('a', { updatedAt: '2026-06-10T00:00:00.000Z',
      locs: [loc('l1', [{ id: 'it1', titre: 'un' }, { id: 'it2', titre: 'deux' }])] })];
    const local  = [proj('a', { updatedAt: '2026-06-01T00:00:00.000Z', locs: [loc('l1', [])] })];
    const { allMerged } = mergeWithLocal(remote, local, new Set(), new Set(['a']), new Set(), null);
    const items = allMerged.find(p => p.id === 'a').visites[0].localisations[0].items.map(i => i.id);
    expect(items).toEqual(['it1', 'it2']);
  });
});

describe('mergeWithLocal — observation déplacée ailleurs (fusion de zones)', () => {
  it('une zone locale-seulement ne garde pas en double une observation que le serveur a dans une autre zone', () => {
    const remote = [proj('p', { locs: [loc('r4', [{ id: 'a' }, { id: 'b' }])] })];
    const local  = [proj('p', { locs: [loc('r4', [{ id: 'a' }]), loc('scap', [{ id: 'b' }, { id: 'n' }])] })];
    const { allMerged } = mergeWithLocal(remote, local, new Set(), new Set(['p']), new Set());
    const locs = allMerged[0].visites[0].localisations;
    expect(locs.map(l => l.id)).toEqual(['r4', 'scap']);
    expect(locs[1].items.map(i => i.id)).toEqual(['n']); // b est dans R+4 (serveur), n (non synchro) est gardée
  });
});
