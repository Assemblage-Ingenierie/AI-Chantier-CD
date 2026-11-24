// PHOTOS JAMAIS RELIÉES (retour Thomas 10/11, Grasse : 10-20 % des photos prises sur site
// absentes du PC). Sur un réseau de chantier, l'envoi d'une photo échouait pendant la sauvegarde :
// la photo était sautée MAIS la sauvegarde se déclarait réussie → le projet n'était plus « à
// synchroniser », et plus aucune sauvegarde ne venait écrire sa ligne (même après que la file
// d'envoi avait fini de pousser le fichier). Vrai chemin loadData → saveData, faux Supabase.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

vi.mock('../supabase.js', () => ({ getSupabase: async () => globalThis.__fakeSb }));
vi.mock('./logger.js', () => ({ logEvent: () => {}, logWarn: () => {}, logError: () => {} }));
vi.mock('./pdfUtils.js', () => ({ renderPdfPage: vi.fn() }));

let db;
function seed() {
  db = createFakeSupabase();
  globalThis.__fakeSb = db.client;
  db.T.aichantier_chantiers = [{ id: 'P', nom: 'Grasse', statut: 'en_cours', visites: [{ id: 'V', label: 'DET 6' }], updated_at: '2026-11-09T08:00:00.000Z' }];
  db.T.aichantier_chantier_plans = [];
  db.T.aichantier_chantier_localisations = [{ id: 'rdc', chantier_id: 'P', visite_id: 'V', nom: 'RDC', sort_order: 0, plan_annotations: null }];
  db.T.aichantier_localisation_items = [{ id: 'a', localisation_id: 'rdc', titre: 'Voile', sort_order: 0 }];
  db.T.aichantier_item_photos = [];
  db.T.aichantier_deleted_chantiers = [];
}
const JPG = 'data:image/jpeg;base64,' + 'A'.repeat(400);
const withPhotos = (ps, photos) => ps.map(p => ({ ...p, visites: p.visites.map(v => ({ ...v, localisations: v.localisations.map(l => ({
  ...l, items: l.items.map(it => ({ ...it, _photosHydrated: true, photos })) })) })) }));
const photoRows = () => db.rows('aichantier_item_photos').map(r => r.id).sort();

beforeEach(() => { seed(); localStorage.clear(); vi.resetModules(); });

describe('photos prises sur site : jamais perdues en route', () => {
  it('envoi d\'une photo KO → sauvegarde NON réussie (projet reste à synchroniser), puis reliée au retour du réseau', async () => {
    const storage = await import('./storage.js');
    const ps = await storage.loadData();
    const local = withPhotos(ps, [{ _id: 'p1', name: 'a.jpg', data: JPG }, { _id: 'p2', name: 'b.jpg', data: JPG }]);
    // Réseau de chantier : le 2e envoi échoue.
    const st = db.client.storage.from();
    let n = 0;
    db.client.storage.from = () => ({ ...st, upload: async (path) => (++n === 2 ? { data: null, error: { message: 'network' } } : { data: { path }, error: null }) });
    const ok1 = await storage.saveData(local, null, new Set(['P']));
    expect(ok1).toBe(false);               // AVANT le correctif : true → photo p2 abandonnée
    expect(photoRows()).toEqual(['p1']);   // la photo envoyée est bien reliée
    // Réseau revenu : la sauvegarde suivante relie la photo manquante.
    db.client.storage.from = () => st;
    const ok2 = await storage.saveData(local, null, new Set(['P']));
    expect(ok2).toBe(true);
    expect(photoRows()).toEqual(['p1', 'p2']);
  });

  it('une ligne en défaut ne bloque plus les photos des autres observations', async () => {
    db.T.aichantier_localisation_items.push({ id: 'b', localisation_id: 'rdc', titre: 'Dalle', sort_order: 1 });
    const storage = await import('./storage.js');
    const ps = await storage.loadData();
    const local = ps.map(p => ({ ...p, visites: p.visites.map(v => ({ ...v, localisations: v.localisations.map(l => ({
      ...l, items: l.items.map(it => ({ ...it, _photosHydrated: true, photos: [{ _id: `ph_${it.id}`, name: 'x.jpg', data: JPG }] })) })) })) }));
    // Le lot complet est refusé (comme une contrainte violée par UNE ligne) ; les lots par observation
    // passent, sauf celui de « a ».
    const realFrom = db.client.from;
    db.client.from = (t) => {
      const api = realFrom(t);
      if (t !== 'aichantier_item_photos') return api;
      const up = api.upsert;
      api.upsert = (rows) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        if (arr.length > 1 || arr.some(r => r.item_id === 'a')) return { then: (res) => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }).then(res) };
        return up(rows);
      };
      return api;
    };
    const ok = await storage.saveData(local, null, new Set(['P']));
    expect(ok).toBe(false);                 // l'erreur reste signalée → re-tentée
    expect(photoRows()).toEqual(['ph_b']);  // AVANT : aucune photo reliée
  });
});

describe('photo en double dans l\'état local (incident 23/11, code 21000)', () => {
  it('même id deux fois → une seule ligne envoyée, sauvegarde réussie, rien purgé', async () => {
    db.T.aichantier_localisation_items.push({ id: 'b', localisation_id: 'rdc', titre: 'Dalle', sort_order: 1 });
    db.T.aichantier_item_photos = [{ id: 'dup', item_id: 'b', name: 'x.jpg', storage_url: 'p/b/dup.jpg', sort_order: 0 }];
    const storage = await import('./storage.js');
    const ps = await storage.loadData();
    // Vrai Postgres : un lot contenant 2 fois le même id est refusé (21000).
    const realFrom = db.client.from;
    db.client.from = (t) => {
      const api = realFrom(t);
      if (t !== 'aichantier_item_photos') return api;
      const up = api.upsert;
      api.upsert = (rows) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        if (new Set(arr.map(r => r.id)).size !== arr.length) return { then: (res) => Promise.resolve({ data: null, error: { code: '21000', message: 'ON CONFLICT DO UPDATE command cannot affect row a second time' } }).then(res) };
        return up(rows);
      };
      return api;
    };
    const ph = { _id: 'dup', name: 'x.jpg', storage_url: 'p/b/dup.jpg', data: 'https://x/p/b/dup.jpg' };
    const local = ps.map(p => ({ ...p, visites: p.visites.map(v => ({ ...v, localisations: v.localisations.map(l => ({
      ...l, items: l.items.map(it => ({ ...it, _photosHydrated: true, photos: it.id === 'b' ? [ph, { ...ph }] : [] })) })) })) }));
    const ok = await storage.saveData(local, null, new Set(['P']));
    expect(ok).toBe(true);
    expect(photoRows()).toEqual(['dup']);
  });
});

describe('photo pivotée / ré-annotée : jamais l\'ancienne image (incident 23/11)', () => {
  it('nouvelle image annotée → NOUVEAU fichier (pas d\'écrasement servi depuis le cache)', async () => {
    db.T.aichantier_item_photos = [{ id: 'ph', item_id: 'a', name: 'x.webp', storage_url: 'P/a/ph.webp', annotated_storage_url: null, sort_order: 0 }];
    const storage = await import('./storage.js');
    const ps = await storage.loadData();
    const base = { _id: 'ph', name: 'x.webp', storage_url: 'P/a/ph.webp', data: 'https://x/P/a/ph.webp' };
    const v1 = withPhotos(ps, [{ ...base, annotated: 'data:image/webp;base64,' + 'A'.repeat(300) }]);
    await storage.saveData(v1, null, new Set(['P']));
    const p1 = db.rows('aichantier_item_photos').find(r => r.id === 'ph').annotated_storage_url;
    const v2 = withPhotos(ps, [{ ...base, annotated: 'data:image/webp;base64,' + 'B'.repeat(300) }]);
    await storage.saveData(v2, null, new Set(['P']));
    const p2 = db.rows('aichantier_item_photos').find(r => r.id === 'ph').annotated_storage_url;
    expect(p1).toBeTruthy();
    expect(p2).toBeTruthy();
    expect(p2).not.toBe(p1);
  });
  it('photo pivotée sans image annotée connue ici → l\'ancienne image annotée est effacée en base', async () => {
    db.T.aichantier_item_photos = [{ id: 'ph', item_id: 'a', name: 'x.webp', storage_url: 'P/a/ph.webp', annotated_storage_url: 'P/a/ph_annot.webp', sort_order: 0 }];
    const storage = await import('./storage.js');
    const ps = await storage.loadData();
    const rotated = withPhotos(ps, [{ _id: 'ph', name: 'x.webp', storage_url: 'P/a/ph2.webp', data: 'https://x/P/a/ph2.webp', annotated: null, _annotReset: true }]);
    await storage.saveData(rotated, null, new Set(['P']));
    const row = db.rows('aichantier_item_photos').find(r => r.id === 'ph');
    expect(row.storage_url).toBe('P/a/ph2.webp');
    expect(row.annotated_storage_url).toBeNull();
  });
});
