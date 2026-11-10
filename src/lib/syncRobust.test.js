// Incident 10/11/2026 (console de Thomas : rafales de 500 sur les plans, puis « SAFETY_EMPTY »).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

vi.mock('../supabase.js', () => ({ getSupabase: async () => globalThis.__fakeSb }));
vi.mock('./logger.js', () => ({ logEvent: () => {}, logWarn: () => {}, logError: () => {} }));
vi.mock('./pdfUtils.js', () => ({ renderPdfPage: vi.fn() }));

let db;
function seed(opts) {
  db = createFakeSupabase(opts);
  globalThis.__fakeSb = db.client;
  db.T.aichantier_chantiers = [];
  db.T.aichantier_chantier_plans = [];
  db.T.aichantier_chantier_localisations = [];
  db.T.aichantier_localisation_items = [];
  db.T.aichantier_item_photos = [];
  db.T.aichantier_deleted_chantiers = [];
}
async function openApp() {
  localStorage.clear(); vi.resetModules();
  const storage = await import('./storage.js');
  return { storage, ps: await storage.loadData() };
}

describe('chargement par pages (plafond de lignes Supabase)', () => {
  beforeEach(() => {
    seed({ maxRows: 1000 });
    // 30 projets × 40 zones × 2 observations = 1200 zones, 2400 observations (> 1000).
    for (let c = 0; c < 30; c++) {
      db.T.aichantier_chantiers.push({ id: `C${c}`, nom: `Projet ${c}`, statut: 'en_cours', visites: [{ id: `v${c}`, label: 'Visite 1' }], updated_at: '2026-11-10T08:00:00.000Z' });
      for (let z = 0; z < 40; z++) {
        db.T.aichantier_chantier_localisations.push({ id: `L${c}_${z}`, chantier_id: `C${c}`, nom: `Zone ${z}`, sort_order: z, visite_id: `v${c}` });
        for (let i = 0; i < 2; i++) db.T.aichantier_localisation_items.push({ id: `I${c}_${z}_${i}`, localisation_id: `L${c}_${z}`, titre: `Obs ${i}`, sort_order: i });
      }
    }
  });
  it('tous les projets ont toutes leurs zones et observations (avant : coupées à 1000 lignes)', async () => {
    const { ps } = await openApp();
    expect(ps.length).toBe(30);
    for (const p of ps) {
      const locs = p.visites.flatMap(v => v.localisations);
      expect(locs.length).toBe(40);
      expect(locs.flatMap(l => l.items).length).toBe(80);
    }
  });
  it('… donc plus de « SAFETY_EMPTY » à la sauvegarde du dernier projet', async () => {
    const { storage, ps } = await openApp();
    const last = ps.find(p => p.id === 'C29');
    const ok = await storage.saveData(ps.map(p => (p.id === 'C29' ? { ...p, nom: 'Renommé' } : p)), null, new Set(['C29']));
    expect(ok).toBe(true);
    expect(last.visites[0].localisations.length).toBe(40);
  });
});

describe('plans : base surchargée → on ne la martèle plus', () => {
  let bgCalls, failPlanRead, failBg;
  beforeEach(() => {
    seed();
    bgCalls = 0; failPlanRead = false; failBg = false;
    const from0 = db.client.from;
    db.client.from = (t) => {
      const api = from0(t);
      if (t !== 'aichantier_chantier_plans') return api;
      const err = new Proxy({}, { get: (_, k) => (k === 'then'
        ? (res) => Promise.resolve({ data: null, error: { code: '57014', message: 'statement timeout' } }).then(res)
        : () => err) });
      const sel0 = api.select, up0 = api.upsert;
      api.select = (...a) => (failPlanRead ? err : sel0(...a));
      api.upsert = (rows, o) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        if (arr.some(r => 'bg' in r)) { bgCalls++; if (failBg) return err; }
        return up0(rows, o);
      };
      return api;
    };
    db.T.aichantier_chantiers = [{ id: 'P1', nom: 'Grasse', statut: 'en_cours', visites: [], updated_at: '2026-11-10T08:00:00.000Z' }];
  });
  const withPlans = (ps) => ps.map(p => ({ ...p, planLibrary: [0, 1, 2].map(i => ({ id: `pl${i}`, nom: `DET ${i}`, bg: `data:image/jpeg;base64,AAAA${i}` })) }));

  it('lecture des plans en échec → AUCUN fond renvoyé, pas de bandeau, projet gardé à synchroniser', async () => {
    const { storage, ps } = await openApp();
    failPlanRead = true;
    const statuses = [];
    const ok = await storage.saveData(withPlans(ps), s => statuses.push(s), new Set(['P1']));
    expect(bgCalls).toBe(0);
    expect(ok).toBe(false);
    expect(statuses.at(-1)).not.toBe('error');
    expect(document.getElementById('__sync_warn__')).toBeNull();
  });

  it('fond refusé → pas renvoyé à la sauvegarde suivante (pause), et pas de bandeau', async () => {
    const { storage, ps } = await openApp();
    failBg = true;
    const ed = withPlans(ps);
    await storage.saveData(ed, null, new Set(['P1']));
    const first = bgCalls;
    expect(first).toBe(3);
    await storage.saveData(ed, null, new Set(['P1']));
    expect(bgCalls).toBe(first);
    expect(document.getElementById('__sync_warn__')).toBeNull();
  });
});
