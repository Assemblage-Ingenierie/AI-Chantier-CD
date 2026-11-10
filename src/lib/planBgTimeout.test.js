// Incident 10/11/2026 : « ⚠ Sync échoué (57014) canceling statement due to statement timeout ».
// Après une restauration de plans (Corbeille) ou un gros import, tous les fonds de plans (base64
// lourds) partaient dans UNE requête → délai de la base dépassé → échec à chaque sauvegarde.
// Le faux Supabase reproduit la base : un envoi de plusieurs fonds d'un coup = timeout.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

vi.mock('../supabase.js', () => ({ getSupabase: async () => globalThis.__fakeSb }));
vi.mock('./logger.js', () => ({ logEvent: () => {}, logWarn: () => {}, logError: () => {} }));
vi.mock('./pdfUtils.js', () => ({ renderPdfPage: vi.fn() }));

let db, calls;
beforeEach(() => {
  db = createFakeSupabase();
  calls = [];
  const from0 = db.client.from;
  db.client.from = (t) => {
    const api = from0(t);
    const up0 = api.upsert;
    api.upsert = (rows, o) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      if (t === 'aichantier_chantier_plans' && arr.some(r => 'bg' in r)) {
        calls.push(arr.length);
        if (arr.length > 1) {
          return { then: (res) => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }).then(res) };
        }
      }
      return up0(rows, o);
    };
    return api;
  };
  globalThis.__fakeSb = db.client;
  db.T.aichantier_chantiers = [{ id: 'P1', nom: 'Grasse', statut: 'en_cours', visites: [], updated_at: '2026-11-10T08:00:00.000Z' }];
  db.T.aichantier_chantier_plans = [];
  db.T.aichantier_chantier_localisations = [];
  db.T.aichantier_localisation_items = [];
  db.T.aichantier_item_photos = [];
  db.T.aichantier_deleted_chantiers = [];
});

const bg = (i) => `data:image/jpeg;base64,${'A'.repeat(50)}${i}`;

describe('fonds de plans lourds → un plan par requête (plus de timeout 57014)', () => {
  it('sauvegarde de 6 nouveaux plans : tous les fonds enregistrés, aucune erreur', async () => {
    localStorage.clear(); vi.resetModules();
    const storage = await import('./storage.js');
    const ps = await storage.loadData();
    const planLibrary = Array.from({ length: 6 }, (_, i) => ({ id: `pl${i}`, nom: `DET ${i}`, bg: bg(i) }));
    const edited = ps.map(p => ({ ...p, planLibrary }));
    const ok = await storage.saveData(edited, null, new Set(['P1']));
    expect(ok).toBe(true);
    expect(calls.every(n => n === 1)).toBe(true);
    const rows = db.rows('aichantier_chantier_plans');
    expect(rows.map(r => r.id).sort()).toEqual(planLibrary.map(p => p.id));
    expect(rows.every(r => typeof r.bg === 'string' && r.bg.startsWith('data:'))).toBe(true);
  });

  it('restauration Corbeille de 5 plans : réussit (avant : timeout → « 0 restauré »)', async () => {
    localStorage.clear(); vi.resetModules();
    const storage = await import('./storage.js');
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, nom: `DET 2 — Page ${i + 1}`, bg: bg(i), sort_order: i }));
    expect(await storage.restorePlanRows('P1', rows)).toBe(true);
    expect(db.rows('aichantier_chantier_plans').filter(r => r.bg).length).toBe(5);
  });

  it('un plan en échec n\'empêche pas les autres de passer (erreur remontée)', async () => {
    localStorage.clear(); vi.resetModules();
    const storage = await import('./storage.js');
    const from1 = db.client.from;
    db.client.from = (t) => {
      const api = from1(t); const up = api.upsert;
      api.upsert = (r, o) => (Array.isArray(r) && r[0]?.id === 'r1' && 'bg' in r[0])
        ? { then: (res) => Promise.resolve({ data: null, error: { code: '57014', message: 'timeout' } }).then(res) } : up(r, o);
      return api;
    };
    const rows = [0, 1, 2].map(i => ({ id: `r${i}`, nom: `p${i}`, bg: bg(i) }));
    expect(await storage.restorePlanRows('P1', rows)).toBe(false);
    expect(db.rows('aichantier_chantier_plans').map(r => r.id).sort()).toEqual(['r0', 'r2']);
  });
});
