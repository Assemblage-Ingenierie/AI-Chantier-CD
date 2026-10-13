// VÉRIFICATION DE BOUT EN BOUT : la fusion de zones ne supprime RIEN (demande Thomas, 13/10/2026).
//
// On rejoue le vrai chemin de sauvegarde (loadData → mergeZones → saveData → suppression différée
// → saveData) contre un faux Supabase en mémoire qui reproduit les clés étrangères et les
// suppressions EN CASCADE (zone → observations → photos). Chaque appareil a son propre module
// storage.js (état « connu au chargement ») et son propre localStorage.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';
import { mergeZones } from './zoneMerge.js';

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

const ann = (o) => JSON.stringify(o);
const VP = { type: 'viewpoint', x: 10, y: 10, photoIdx: 1, _vpId: 'v1' };
function seed() {
  db = createFakeSupabase();
  globalThis.__fakeSb = db.client;
  db.T.aichantier_chantiers = [{ id: 'P', nom: 'Projet', statut: 'en_cours', visites: [{ id: 'V', label: 'Visite 1' }], updated_at: '2026-10-13T08:00:00.000Z' }];
  db.T.aichantier_chantier_plans = [{ id: 'P4', chantier_id: 'P', nom: 'R+4', sort_order: 0 }, { id: 'COUPE', chantier_id: 'P', nom: 'Coupe', sort_order: 1 }];
  db.T.aichantier_chantier_localisations = [
    { id: 'r4', chantier_id: 'P', visite_id: 'V', nom: 'R+4', sort_order: 0, plan_annotations: ann({ _planId: 'P4', paths: [{ type: 'text', text: 'Palier', x: 5, y: 5 }] }) },
    { id: 'scap', chantier_id: 'P', visite_id: 'V', nom: 'Mme Scapolo', sort_order: 1, plan_annotations: ann({ _planId: 'P4', paths: [{ type: 'stroke', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }, VP] }) },
    { id: 'cave', chantier_id: 'P', visite_id: 'V', nom: 'Cave', sort_order: 2, plan_annotations: null },
  ];
  db.T.aichantier_localisation_items = [
    { id: 'a', localisation_id: 'r4', titre: 'Couloir', sort_order: 0 },
    { id: 'b', localisation_id: 'scap', titre: 'Toilette', sort_order: 0 },
    { id: 'c', localisation_id: 'cave', titre: 'Humidité', sort_order: 0 },
  ];
  db.T.aichantier_item_photos = [
    { id: 'pa', item_id: 'a', name: '', storage_url: 'projet_P/a/pa.webp', sort_order: 0 },
    { id: 'pb1', item_id: 'b', name: '', storage_url: 'projet_P/b/pb1.webp', sort_order: 0 },
    { id: 'pb2', item_id: 'b', name: '', storage_url: 'projet_P/b/pb2.webp', sort_order: 1 },
  ];
}

// Photos chargées comme dans l'app (URL signée dans data, _id = id de ligne).
function hydrate(ps) {
  return ps.map(p => ({ ...p, visites: p.visites.map(v => ({ ...v, localisations: v.localisations.map(l => ({
    ...l, items: l.items.map(it => ({ ...it, _photosHydrated: true, photos: db.rows('aichantier_item_photos').filter(r => r.item_id === it.id)
      .map(r => ({ _id: r.id, id: r.id, name: r.name, storage_url: r.storage_url, data: `https://x.supabase.co/storage/v1/object/sign/photos/${r.storage_url}?token=t` })) })),
  })) })) }));
}
const locsOf = (ps) => ps[0].visites[0].localisations;
const withLocs = (ps, locs) => [{ ...ps[0], visites: [{ ...ps[0].visites[0], localisations: locs }] }];
const DIRTY = () => new Set(['P']);
const itemIds = () => db.rows('aichantier_localisation_items').map(r => r.id).sort();
const photoIds = () => db.rows('aichantier_item_photos').map(r => r.id).sort();
const lostData = () => db.deleted.filter(d => d.table === 'aichantier_localisation_items' || d.table === 'aichantier_item_photos');
const dbAnnot = (id) => JSON.parse(db.rows('aichantier_chantier_localisations').find(r => r.id === id)?.plan_annotations || 'null');

beforeEach(() => { seed(); lsByDevice.clear(); currentDevice = null; });

describe('fusion de zones — rien n\'est supprimé (simulation complète)', () => {
  it('fusion → sauvegarde → suppression différée → sauvegarde : observations, photos et annotations intactes', async () => {
    const A = await device('A');
    let ps = hydrate(await A.storage.loadData());
    const merged = mergeZones(locsOf(ps), 'scap', 'r4');
    ps = withLocs(ps, merged);
    expect(await A.storage.saveData(ps, null, DIRTY())).toBe(true);
    expect(db.rows('aichantier_localisation_items').find(r => r.id === 'b').localisation_id).toBe('r4');
    expect(db.rows('aichantier_chantier_localisations').some(r => r.id === 'scap')).toBe(true); // pas encore supprimée

    // Suppression différée (VueProjet) : la zone vidée disparaît à la sauvegarde suivante.
    ps = withLocs(ps, merged.filter(l => l.id !== 'scap'));
    expect(await A.storage.saveData(ps, null, DIRTY())).toBe(true);
    expect(db.rows('aichantier_chantier_localisations').some(r => r.id === 'scap')).toBe(false);

    expect(itemIds()).toEqual(['a', 'b', 'c']);
    expect(photoIds()).toEqual(['pa', 'pb1', 'pb2']);
    expect(lostData()).toEqual([]);
    // Les annotations du plan partagé (R+4) de la zone fusionnée sont sur R+4.
    const r4 = dbAnnot('r4');
    expect(r4.paths.map(p => p.type)).toEqual(['text', 'stroke', 'viewpoint']);

    // Relecture par un autre appareil : tout est là.
    const C = await device('C');
    const back = await C.storage.loadData();
    const r4Back = locsOf(back).find(l => l.id === 'r4');
    expect(r4Back.items.map(i => i.id)).toEqual(['a', 'b']);
    expect(r4Back.planAnnotations.paths).toHaveLength(3);
  });

  it('même si la zone d\'origine est retirée DANS la même sauvegarde que le déplacement : rien n\'est perdu', async () => {
    const A = await device('A');
    let ps = hydrate(await A.storage.loadData());
    ps = withLocs(ps, mergeZones(locsOf(ps), 'scap', 'r4').filter(l => l.id !== 'scap'));
    expect(await A.storage.saveData(ps, null, DIRTY())).toBe(true);
    expect(lostData()).toEqual([]);
    expect(db.rows('aichantier_chantier_localisations').some(r => r.id === 'scap')).toBe(true); // reportée (garde)
    expect(await A.storage.saveData(ps, null, DIRTY())).toBe(true);
    expect(db.rows('aichantier_chantier_localisations').some(r => r.id === 'scap')).toBe(false);
    expect(itemIds()).toEqual(['a', 'b', 'c']);
    expect(photoIds()).toEqual(['pa', 'pb1', 'pb2']);
    expect(lostData()).toEqual([]);
  });

  it('photos pas encore chargées (téléphone, réseau lent) : aucune photo supprimée', async () => {
    const A = await device('A');
    let ps = await A.storage.loadData(); // photos: [] non hydratées
    const merged = mergeZones(locsOf(ps), 'scap', 'r4');
    ps = withLocs(ps, merged);
    expect(await A.storage.saveData(ps, null, DIRTY())).toBe(true);
    ps = withLocs(ps, merged.filter(l => l.id !== 'scap'));
    expect(await A.storage.saveData(ps, null, DIRTY())).toBe(true);
    expect(photoIds()).toEqual(['pa', 'pb1', 'pb2']);
    expect(lostData()).toEqual([]);
  });

  it('deuxième appareil au cache périmé (sans les pierres tombales) : pas de doublon, pas d\'erreur, rien de perdu', async () => {
    const B = await device('B');
    const bLocal = hydrate(await B.storage.loadData()); // B a chargé AVANT la fusion

    const A = await device('A');
    let ps = hydrate(await A.storage.loadData());
    const merged = mergeZones(locsOf(ps), 'scap', 'r4');
    ps = withLocs(ps, merged);
    await A.storage.saveData(ps, null, DIRTY());
    ps = withLocs(ps, merged.filter(l => l.id !== 'scap'));
    await A.storage.saveData(ps, null, DIRTY());

    // B se rouvre : sa zone « Mme Scapolo » (périmée) est locale-seulement.
    switchDevice('B');
    const remote = await B.storage.loadData();
    const { allMerged } = B.mergeWithLocal(remote, bLocal, new Set(), new Set(['P']), new Set(), new Set(), new Set());
    const all = locsOf(allMerged).flatMap(l => l.items.map(i => i.id));
    expect(all.filter(id => id === 'b')).toHaveLength(1); // jamais en double
    // B sauvegarde ce qu'il a : aucune erreur, rien de supprimé.
    expect(await B.storage.saveData(allMerged, null, DIRTY())).toBe(true);
    expect(itemIds()).toEqual(['a', 'b', 'c']);
    expect(photoIds()).toEqual(['pa', 'pb1', 'pb2']);
    expect(lostData()).toEqual([]);
    expect(db.rows('aichantier_localisation_items').find(r => r.id === 'b').localisation_id).toBe('r4');
  });
});

describe('annotations de zone : un appareil périmé n\'efface plus celles ajoutées ailleurs', () => {
  it('le téléphone (modif en attente) ne fait plus disparaître les annotations ajoutées sur le PC', async () => {
    const tel = await device('tel');
    const telState = await tel.storage.loadData(); // chargé AVANT les annotations du PC

    const pc = await device('pc');
    let ps = await pc.storage.loadData();
    const added = [{ type: 'text', text: 'Fissure', x: 40, y: 40 }, { type: 'stroke', points: [{ x: 9, y: 9 }] }];
    ps = withLocs(ps, locsOf(ps).map(l => l.id === 'r4' ? { ...l, planAnnotations: { paths: [...l.planAnnotations.paths, ...added] },
      extraPlans: [{ id: 'e1', planId: 'COUPE', planAnnotations: { paths: [{ type: 'text', text: 'Coupe AA' }] } }] } : l));
    expect(await pc.storage.saveData(ps, null, DIRTY())).toBe(true);
    expect(dbAnnot('r4').paths).toHaveLength(3);

    // Le téléphone modifie autre chose (titre en Cave) et sauvegarde SA version périmée de R+4.
    switchDevice('tel');
    const telEdited = withLocs(telState, locsOf(telState).map(l => l.id === 'cave' ? { ...l, items: l.items.map(i => ({ ...i, titre: 'Humidité forte' })) } : l));
    expect(await tel.storage.saveData(telEdited, null, DIRTY())).toBe(true);

    const r4 = dbAnnot('r4');
    expect(r4.paths.map(p => p.text ?? p.type)).toEqual(['Palier', 'Fissure', 'stroke']); // rien de perdu
    expect(r4._extraPlans.map(e => e.planId)).toEqual(['COUPE']);                          // plan ajouté conservé
    expect(db.rows('aichantier_localisation_items').find(r => r.id === 'c').titre).toBe('Humidité forte');

    // Et une 2e sauvegarde du téléphone ne les efface toujours pas.
    expect(await tel.storage.saveData(telEdited, null, DIRTY())).toBe(true);
    expect(dbAnnot('r4').paths).toHaveLength(3);
  });

  it('une annotation effacée VOLONTAIREMENT reste effacée', async () => {
    const pc = await device('pc');
    let ps = await pc.storage.loadData();
    ps = withLocs(ps, locsOf(ps).map(l => l.id === 'r4' ? { ...l, planAnnotations: null } : l)); // « Palier » effacé
    expect(await pc.storage.saveData(ps, null, DIRTY())).toBe(true);
    expect(dbAnnot('r4').paths).toBeUndefined();
    expect(await pc.storage.saveData(ps, null, DIRTY())).toBe(true);
    expect(dbAnnot('r4').paths).toBeUndefined();
  });

  it('démarrage hors ligne (rien chargé du serveur) : comportement d\'avant, inchangé', async () => {
    const pc = await device('pc');
    const ps = await pc.storage.loadData();
    const pc2 = await device('pc2'); // module neuf : n'a jamais chargé → aucune mémoire
    const edited = withLocs(ps, locsOf(ps).map(l => l.id === 'r4' ? { ...l, planAnnotations: null } : l));
    expect(await pc2.storage.saveData(edited, null, DIRTY())).toBe(true);
    expect(dbAnnot('r4').paths).toBeUndefined();
  });
});
