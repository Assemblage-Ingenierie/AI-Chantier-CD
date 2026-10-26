// TEXTE ÉCRASÉ PAR UNE VERSION PÉRIMÉE — incident 26/10 (Pavillons-sous-Bois, « Visite DET n°5 ») :
// le texte tapé sur le PC est revenu à celui de l'ANCIENNE visite (dupliquée). Un autre appareil,
// resté sur la version d'après duplication, renvoyait TOUTES les observations à chaque sauvegarde.
//
// Même banc que concurrentEdit.test.js : vrai chemin loadData → mergeWithLocal → saveData contre le
// faux Supabase ; chaque appareil a son module storage.js et son localStorage.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';
import { syncDecision, itemRowSig } from './syncBase.js';

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
// Ouvre l'app sur un appareil (module neuf = nouvelle session, localStorage de l'appareil conservé).
async function device(name) {
  switchDevice(name);
  vi.resetModules();
  const storage = await import('./storage.js');
  const { mergeWithLocal } = await import('../hooks/useProjets.js');
  return { name, storage, mergeWithLocal };
}

// Visite dupliquée : les observations portent encore le texte de l'ancienne visite.
function seed() {
  db = createFakeSupabase();
  globalThis.__fakeSb = db.client;
  db.T.aichantier_chantiers = [{ id: 'P', nom: 'Pavillons', statut: 'en_cours', visites: [{ id: 'V5', label: 'DET n°5', conclusion: 'Conclusion DET 4' }], updated_at: '2026-10-22T08:00:00.000Z' }];
  db.T.aichantier_chantier_plans = [];
  db.T.aichantier_chantier_localisations = [
    { id: 'rdc', chantier_id: 'P', visite_id: 'V5', nom: 'RDC', sort_order: 0, plan_annotations: null },
  ];
  db.T.aichantier_localisation_items = [
    { id: 'a', localisation_id: 'rdc', titre: 'Coffrage voiles', commentaire: 'Texte DET 4 (a)', sort_order: 0 },
    { id: 'b', localisation_id: 'rdc', titre: 'Ferraillage', commentaire: 'Texte DET 4 (b)', sort_order: 1 },
  ];
  db.T.aichantier_item_photos = [];
}

const locsOf = (ps) => ps[0].visites[0].localisations;
const visitOf = (ps) => ps[0].visites[0];
const withLocs = (ps, locs, extra = {}) => [{ ...ps[0], ...extra, visites: [{ ...ps[0].visites[0], localisations: locs }] }];
const editItem = (ps, id, patch) => withLocs(ps, locsOf(ps).map(l => ({ ...l, items: l.items.map(i => i.id === id ? { ...i, ...patch } : i) })));
const DIRTY = () => new Set(['P']);
const row = (id) => db.rows('aichantier_localisation_items').find(r => r.id === id);

// Le PC remplace les textes de la visite dupliquée (a et b) + la conclusion, et sauvegarde.
async function pcWritesNewText(PC) {
  let ps = await PC.storage.loadData();
  ps = editItem(ps, 'a', { commentaire: 'Nouveau texte DET 5 (a)' });
  ps = editItem(ps, 'b', { commentaire: 'Nouveau texte DET 5 (b)' });
  ps = [{ ...ps[0], visites: [{ ...visitOf(ps), conclusion: 'Conclusion DET 5' }] }];
  expect(await PC.storage.saveData(ps, null, DIRTY())).toBe(true);
  expect(row('a').commentaire).toBe('Nouveau texte DET 5 (a)');
}

beforeEach(() => { seed(); lsByDevice.clear(); currentDevice = null; });

describe('un appareil au state périmé n\'écrase plus le texte écrit ailleurs', () => {
  it('même session : le téléphone modifie UNE observation, les autres textes du PC restent', async () => {
    const TEL = await device('TEL');
    const telState = await TEL.storage.loadData(); // téléphone ouvert sur la visite d'après duplication

    const PC = await device('PC');
    await pcWritesNewText(PC);

    switchDevice('TEL');
    // Le téléphone (pas rechargé) ajoute une précision sur « b » seulement.
    const telEdit = editItem(telState, 'b', { titre: 'Ferraillage voiles' });
    expect(await TEL.storage.saveData(telEdit, null, DIRTY())).toBe(true);

    expect(row('a').commentaire).toBe('Nouveau texte DET 5 (a)'); // ← écrasé par « Texte DET 4 (a) » avant le correctif
    expect(row('b').titre).toBe('Ferraillage voiles');            // la modif du téléphone passe
    expect(db.rows('aichantier_chantiers')[0].visites[0].conclusion).toBe('Conclusion DET 5');
  });

  it('nouvelle session sur un cache périmé avec modif en attente (fusion « version locale gardée »)', async () => {
    let TEL = await device('TEL');
    const telCache = editItem(await TEL.storage.loadData(), 'b', { titre: 'Ferraillage voiles' }); // en attente (réseau coupé)

    const PC = await device('PC');
    await pcWritesNewText(PC);

    // Le téléphone est relancé plus tard : son projet est encore « dirty » → la fusion garde SA version.
    TEL = await device('TEL');
    const remote = await TEL.storage.loadData();
    const { allMerged } = TEL.mergeWithLocal(remote, telCache, DIRTY());
    // L'écran du téléphone reprend le texte du PC (non touché ici) et garde SA modif en attente.
    const telItems = locsOf(allMerged)[0].items;
    expect(telItems.find(i => i.id === 'a').commentaire).toBe('Nouveau texte DET 5 (a)');
    expect(telItems.find(i => i.id === 'b').commentaire).toBe('Nouveau texte DET 5 (b)');
    expect(telItems.find(i => i.id === 'b').titre).toBe('Ferraillage voiles');
    expect(visitOf(allMerged).conclusion).toBe('Conclusion DET 5');
    TEL.storage.restrictKnownToState(allMerged);
    expect(await TEL.storage.saveData(allMerged, null, DIRTY())).toBe(true);

    expect(row('a').commentaire).toBe('Nouveau texte DET 5 (a)');
    expect(row('b').commentaire).toBe('Nouveau texte DET 5 (b)');
    expect(row('b').titre).toBe('Ferraillage voiles');
    expect(db.rows('aichantier_chantiers')[0].visites[0].conclusion).toBe('Conclusion DET 5');

    // Sauvegardes suivantes du téléphone (state toujours périmé) : toujours rien d'écrasé.
    expect(await TEL.storage.saveData(allMerged, null, DIRTY())).toBe(true);
    TEL = await device('TEL'); // et même après un redémarrage
    expect(await TEL.storage.saveData(allMerged, null, DIRTY())).toBe(true);
    expect(row('a').commentaire).toBe('Nouveau texte DET 5 (a)');
    expect(row('b').commentaire).toBe('Nouveau texte DET 5 (b)');
    expect(row('b').titre).toBe('Ferraillage voiles');
  });

  it('visite : conclusion écrite au PC + participants ajoutés au téléphone → les deux restent', async () => {
    const TEL = await device('TEL');
    const telState = await TEL.storage.loadData();
    const PC = await device('PC');
    await pcWritesNewText(PC);
    switchDevice('TEL');
    const telEdit = [{ ...telState[0], visites: [{ ...visitOf(telState), participants: [{ nom: 'SME' }] }] }];
    expect(await TEL.storage.saveData(telEdit, null, DIRTY())).toBe(true);
    const v = db.rows('aichantier_chantiers')[0].visites[0];
    expect(v.conclusion).toBe('Conclusion DET 5');
    expect(v.participants).toEqual([{ nom: 'SME' }]);
    expect(await TEL.storage.saveData(telEdit, null, DIRTY())).toBe(true); // re-sauvegarde : idem
    expect(db.rows('aichantier_chantiers')[0].visites[0].conclusion).toBe('Conclusion DET 5');
  });

  it('horloge du téléphone en avance (sans modif) : rien n\'est écrasé', async () => {
    let TEL = await device('TEL');
    const telCache = (await TEL.storage.loadData()).map(p => ({ ...p, updatedAt: '2099-01-01T00:00:00.000Z' }));
    const PC = await device('PC');
    await pcWritesNewText(PC);
    TEL = await device('TEL');
    const remote = await TEL.storage.loadData();
    const { allMerged, keptLocalIds } = TEL.mergeWithLocal(remote, telCache, new Set());
    expect(keptLocalIds.has('P')).toBe(true);
    expect(locsOf(allMerged)[0].items.find(i => i.id === 'a').commentaire).toBe('Nouveau texte DET 5 (a)');
    expect(await TEL.storage.saveData(allMerged, null, DIRTY())).toBe(true);
    expect(row('a').commentaire).toBe('Nouveau texte DET 5 (a)');
    expect(row('b').commentaire).toBe('Nouveau texte DET 5 (b)');
    expect(db.rows('aichantier_chantiers')[0].visites[0].conclusion).toBe('Conclusion DET 5');
  });

  it('une fois la version du serveur reprise, le téléphone peut de nouveau modifier ce texte', async () => {
    const TEL = await device('TEL');
    const telState = await TEL.storage.loadData();
    const PC = await device('PC');
    await pcWritesNewText(PC);
    switchDevice('TEL');
    expect(await TEL.storage.saveData(editItem(telState, 'b', { titre: 'X' }), null, DIRTY())).toBe(true);
    // Actualisation (fusion non-dirty) → le téléphone récupère le texte du PC, puis le corrige.
    const { allMerged } = TEL.mergeWithLocal(await TEL.storage.loadData(), telState, new Set());
    expect(await TEL.storage.saveData(allMerged, null, DIRTY())).toBe(true); // « same » → base à jour
    const fixed = editItem(allMerged, 'a', { commentaire: 'Nouveau texte DET 5 (a) corrigé' });
    expect(await TEL.storage.saveData(fixed, null, DIRTY())).toBe(true);
    expect(row('a').commentaire).toBe('Nouveau texte DET 5 (a) corrigé');
  });

  it('modifiée des DEUX côtés : la dernière édition gagne (comportement d\'avant), sans erreur', async () => {
    const TEL = await device('TEL');
    const telState = await TEL.storage.loadData();
    const PC = await device('PC');
    await pcWritesNewText(PC);
    switchDevice('TEL');
    expect(await TEL.storage.saveData(editItem(telState, 'a', { commentaire: 'Version téléphone' }), null, DIRTY())).toBe(true);
    expect(row('a').commentaire).toBe('Version téléphone');
    expect(row('b').commentaire).toBe('Nouveau texte DET 5 (b)');
  });

  it('réordonner ici met à jour l\'ordre sans renvoyer le texte périmé', async () => {
    const TEL = await device('TEL');
    const telState = await TEL.storage.loadData();
    const PC = await device('PC');
    await pcWritesNewText(PC);
    switchDevice('TEL');
    const swapped = withLocs(telState, locsOf(telState).map(l => ({ ...l, items: [...l.items].reverse() })));
    expect(await TEL.storage.saveData(swapped, null, DIRTY())).toBe(true);
    expect(row('b').sort_order).toBe(0);
    expect(row('a').sort_order).toBe(1);
    expect(row('a').commentaire).toBe('Nouveau texte DET 5 (a)');
  });

  it('une nouvelle observation et un nouveau texte sur un appareil à jour passent toujours', async () => {
    const PC = await device('PC');
    let ps = await PC.storage.loadData();
    ps = withLocs(ps, locsOf(ps).map(l => ({ ...l, items: [...l.items, { id: 'n', titre: 'Nouvelle', commentaire: 'obs neuve', photos: [] }] })));
    expect(await PC.storage.saveData(ps, null, DIRTY())).toBe(true);
    expect(row('n').commentaire).toBe('obs neuve');
    expect(await PC.storage.saveData(editItem(ps, 'n', { commentaire: 'obs neuve modifiée' }), null, DIRTY())).toBe(true);
    expect(row('n').commentaire).toBe('obs neuve modifiée');
  });
});

describe('syncBase', () => {
  it('décision', () => {
    expect(syncDecision('L', null, 'B')).toBe('send');
    expect(syncDecision('S', 'S', 'B')).toBe('same');
    expect(syncDecision('L', 'S', null)).toBe('send');
    expect(syncDecision('B', 'S', 'B')).toBe('keepServer');
    expect(syncDecision('L', 'B', 'B')).toBe('send');
    expect(syncDecision('L', 'S', 'B')).toBe('conflict');
  });
  it('empreinte identique pour la ligne lue en base et la ligne reconstruite (jsonb / valeurs par défaut)', () => {
    const dbRow = { titre: 'T', commentaire: null, statut: null, commentaire_align: null, meta: { dateCloture: '2026-10-01', dateOuverture: '2026-09-01' }, plan_annotations: '{"b":1,"a":[1,2]}' };
    const built = { titre: 'T', commentaire: '', statut: 'rapport', commentaire_align: 'left', suivi: 'rien', urgence: 'basse', meta: { dateOuverture: '2026-09-01', dateCloture: '2026-10-01' }, plan_annotations: JSON.stringify({ a: [1, 2], b: 1 }) };
    expect(itemRowSig(dbRow)).toBe(itemRowSig(built));
    expect(itemRowSig({ ...built, commentaire: 'x' })).not.toBe(itemRowSig(built));
  });
});
