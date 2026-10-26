// ÉDITION À PLUSIEURS — incident 26/10 (Amaury + Malo sur la même visite : observations et photos
// disparues, Pavillons-sous-Bois 15 → 14 obs).
//
// On rejoue le vrai chemin (loadData → mergeWithLocal → saveData) contre le faux Supabase en
// mémoire (clés étrangères + cascades). Chaque appareil a son propre module storage.js et son
// propre localStorage. Scénario : A a des modifs en attente (ou une horloge en avance) pendant
// que B ajoute des observations / une zone ; A actualise, la fusion garde la version locale de A,
// puis A sauvegarde.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

vi.mock('../supabase.js', () => ({ getSupabase: async () => globalThis.__fakeSb }));
vi.mock('./logger.js', () => ({ logEvent: () => {}, logWarn: () => {}, logError: () => {} }));
vi.mock('./pdfUtils.js', () => ({ renderPdfPage: vi.fn() }));

let db;
const lsByDevice = new Map();
let currentDevice = null;
function switchDevice(name) {
  if (currentDevice) lsByDevice.set(currentDevice, { ...localStorage });
  localStorage.clear();
  for (const [k, v] of Object.entries(lsByDevice.get(name) || {})) localStorage.setItem(k, v);
  currentDevice = name;
}
async function device(name) {
  switchDevice(name);
  vi.resetModules();
  const storage = await import('./storage.js');
  const { mergeWithLocal } = await import('../hooks/useProjets.js');
  const tomb = await import('./tombstones.js');
  return { name, storage, mergeWithLocal, tomb };
}

function seed() {
  db = createFakeSupabase();
  globalThis.__fakeSb = db.client;
  db.T.aichantier_chantiers = [{ id: 'P', nom: 'Pavillons', statut: 'en_cours', visites: [{ id: 'V', label: 'Visite 1' }], updated_at: '2026-10-26T08:00:00.000Z' }];
  db.T.aichantier_chantier_plans = [];
  db.T.aichantier_chantier_localisations = [
    { id: 'rdc', chantier_id: 'P', visite_id: 'V', nom: 'RDC', sort_order: 0, plan_annotations: null },
    { id: 'cave', chantier_id: 'P', visite_id: 'V', nom: 'Cave', sort_order: 1, plan_annotations: null },
  ];
  db.T.aichantier_localisation_items = [
    { id: 'a', localisation_id: 'rdc', titre: 'Fissure', sort_order: 0 },
    { id: 'c', localisation_id: 'cave', titre: 'Humidité', sort_order: 0 },
  ];
  db.T.aichantier_item_photos = [
    { id: 'pa', item_id: 'a', name: '', storage_url: 'pav_P/a/pa.webp', sort_order: 0 },
  ];
}

function hydrate(ps) {
  return ps.map(p => ({ ...p, visites: p.visites.map(v => ({ ...v, localisations: v.localisations.map(l => ({
    ...l, items: l.items.map(it => ({ ...it, _photosHydrated: true, photos: db.rows('aichantier_item_photos').filter(r => r.item_id === it.id)
      .map(r => ({ _id: r.id, id: r.id, name: r.name, storage_url: r.storage_url })) })),
  })) })) }));
}
const locsOf = (ps) => ps[0].visites[0].localisations;
const withLocs = (ps, locs, extra = {}) => [{ ...ps[0], ...extra, visites: [{ ...ps[0].visites[0], localisations: locs }] }];
const DIRTY = () => new Set(['P']);
const itemIds = () => db.rows('aichantier_localisation_items').map(r => r.id).sort();
const photoIds = () => db.rows('aichantier_item_photos').map(r => r.id).sort();
const locIds = () => db.rows('aichantier_chantier_localisations').map(r => r.id).sort();

// B (collègue) ajoute une observation avec photo dans la Cave ET une nouvelle zone « Combles ».
async function colleagueAdds(B) {
  const ps = hydrate(await B.storage.loadData());
  const locs = locsOf(ps).map(l => l.id === 'cave'
    ? { ...l, items: [...l.items, { id: 'j', titre: 'Linteau buché', _photosHydrated: true, photos: [{ _id: 'pj', storage_url: 'pav_P/j/pj.webp', name: '' }] }] }
    : l);
  locs.push({ id: 'combles', nom: 'Combles', items: [{ id: 'k', titre: 'Charpente', _photosHydrated: true, photos: [{ _id: 'pk', storage_url: 'pav_P/k/pk.webp', name: '' }] }] });
  expect(await B.storage.saveData(withLocs(ps, locs), null, DIRTY())).toBe(true);
  expect(itemIds()).toEqual(['a', 'c', 'j', 'k']);
}

beforeEach(() => { seed(); lsByDevice.clear(); currentDevice = null; });

describe('édition à plusieurs — les ajouts d\'un collègue ne sont jamais effacés', () => {
  it('A a des modifs en attente, actualise, puis sauvegarde : observation + photo + zone du collègue intactes', async () => {
    const A = await device('A');
    let aLocal = hydrate(await A.storage.loadData());
    // A modifie un texte (pas encore synchronisé → dirty).
    aLocal = withLocs(aLocal, locsOf(aLocal).map(l => l.id === 'rdc' ? { ...l, items: l.items.map(i => ({ ...i, titre: 'Fissure en escalier' })) } : l), { updatedAt: '2026-10-26T09:00:00.000Z' });

    const B = await device('B');
    await colleagueAdds(B);

    // Retour sur A : actualisation (comme au retour sur l'app) → fusion « chemin dirty ».
    switchDevice('A');
    const remote = await A.storage.loadData();
    const { allMerged } = A.mergeWithLocal(remote, aLocal, DIRTY());
    expect(locsOf(allMerged).find(l => l.id === 'cave').items.map(i => i.id)).toEqual(['c']); // l'ajout de B n'est pas dans l'état de A
    A.storage.restrictKnownToState(allMerged);
    expect(await A.storage.saveData(allMerged, null, DIRTY())).toBe(true);

    expect(itemIds()).toEqual(['a', 'c', 'j', 'k']);
    expect(photoIds()).toEqual(['pa', 'pj', 'pk']);
    expect(locIds()).toEqual(['cave', 'combles', 'rdc']);
    expect(db.rows('aichantier_localisation_items').find(r => r.id === 'a').titre).toBe('Fissure en escalier'); // la modif de A passe
  });

  it('horloge de A en avance (sans modif en attente) : même protection', async () => {
    const A = await device('A');
    const aLocal = hydrate(await A.storage.loadData()).map(p => ({ ...p, updatedAt: '2099-01-01T00:00:00.000Z' }));
    const B = await device('B');
    await colleagueAdds(B);
    switchDevice('A');
    const remote = await A.storage.loadData();
    const { allMerged, keptLocalIds } = A.mergeWithLocal(remote, aLocal, new Set());
    expect(keptLocalIds.has('P')).toBe(true); // version locale gardée → sauvegarde ciblée immédiate
    A.storage.restrictKnownToState(allMerged);
    expect(await A.storage.saveData(allMerged, null, DIRTY())).toBe(true);
    expect(itemIds()).toEqual(['a', 'c', 'j', 'k']);
    expect(photoIds()).toEqual(['pa', 'pj', 'pk']);
  });

  it('couverture : un appareil au cache périmé ne ré-écrit plus l\'ANCIEN chemin ; une nouvelle photo, si', async () => {
    db.T.aichantier_chantiers[0].photo = 'pav_P/cover/P/cNEW.webp';
    const A = await device('A');
    const ps = hydrate(await A.storage.loadData());
    // Cache périmé de A : ancienne couverture (URL signée d'un fichier depuis remplacé).
    const stale = withLocs(ps, locsOf(ps), { photo: 'https://x.supabase.co/storage/v1/object/sign/photos/pav_P/cover/P/cOLD.png?token=t' });
    expect(await A.storage.saveData(stale, null, DIRTY())).toBe(true);
    expect(db.rows('aichantier_chantiers')[0].photo).toBe('pav_P/cover/P/cNEW.webp');
    // Fiche SANS couverture (colonne vidée) : le chemin local la répare, comme avant.
    db.T.aichantier_chantiers[0].photo = null;
    expect(await A.storage.saveData(stale, null, DIRTY())).toBe(true);
    expect(db.rows('aichantier_chantiers')[0].photo).toBe('pav_P/cover/P/cOLD.png');
    // Vraie nouvelle couverture (image choisie) : toujours écrite.
    const fresh = withLocs(ps, locsOf(ps), { photo: 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAAfQ//73vw==' });
    expect(await A.storage.saveData(fresh, null, DIRTY())).toBe(true);
    expect(db.rows('aichantier_chantiers')[0].photo).toMatch(/\/cover\/P\/c[\w-]+\.webp$/);
  });

  it('couverture qui pointe vers un fichier ABSENT : retrouvée dans le stockage et fiche réparée', async () => {
    db.T.aichantier_chantiers[0].photo = 'pav_P/cover/P/cGONE.png';
    db.missing.add('pav_P/cover/P/cGONE.png');
    const A = await device('A');
    const map = await A.storage.hydrateChantierPhotos(['P']);
    expect(map.P).toMatch(/\/storage\/v1\/object\/sign\/photos\/.+\/cover\/P\.webp/); // candidat le plus probable existant
    await new Promise(r => setTimeout(r, 0));
    expect(db.rows('aichantier_chantiers')[0].photo).toMatch(/\/cover\/P\.webp$/);
  });

  it('les suppressions VOLONTAIRES de A restent effectives (pierre tombale, ou retrait après la fusion)', async () => {
    const A = await device('A');
    const remote = await A.storage.loadData();
    const { allMerged } = A.mergeWithLocal(remote, hydrate(remote), new Set());
    A.storage.restrictKnownToState(allMerged);
    // A supprime l'observation « a » APRÈS la fusion (présente dans son état → bien connue).
    const ps = withLocs(allMerged, locsOf(allMerged).map(l => l.id === 'rdc' ? { ...l, items: [] } : l));
    expect(await A.storage.saveData(ps, null, DIRTY())).toBe(true);
    expect(itemIds()).toEqual(['c']);
    // Et via pierre tombale (chemin normal de VueProjet).
    A.tomb.addTombstone('item', 'c', 'P');
    const ps2 = withLocs(ps, locsOf(ps).map(l => l.id === 'cave' ? { ...l, items: [] } : l));
    expect(await A.storage.saveData(ps2, null, DIRTY())).toBe(true);
    expect(itemIds()).toEqual([]);
  });
});
