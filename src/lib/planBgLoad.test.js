// Retour Thomas 16/11 (Voltaire) : « les plans ne s'affichent plus en miniature ». Lire tous les
// fonds d'un projet en une requête dépassait le délai de la base → aucune miniature.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

vi.mock('../supabase.js', () => ({ getSupabase: async () => globalThis.__fakeSb }));
vi.mock('./logger.js', () => ({ logEvent: () => {}, logWarn: () => {}, logError: () => {} }));
vi.mock('./pdfUtils.js', () => ({ renderPdfPage: vi.fn() }));

let db, maxBgPerRequest, failIds;
beforeEach(() => {
  db = createFakeSupabase();
  maxBgPerRequest = 0; failIds = new Set();
  const from0 = db.client.from;
  db.client.from = (t) => {
    const api = from0(t);
    if (t !== 'aichantier_chantier_plans') return api;
    let wantsBg = false, ids = null;
    const sel0 = api.select, in0 = api.in, then0 = api.then;
    api.select = (cols, ...r) => { wantsBg = /\bbg\b/.test(cols); return sel0(cols, ...r); };
    api.in = (c, vs) => { ids = vs; return in0(c, vs); };
    api.then = (res, rej) => then0((out) => {
      const n = wantsBg ? (out.data || []).length : 0;
      maxBgPerRequest = Math.max(maxBgPerRequest, n);
      // Base : au-delà de 4 fonds dans une réponse → délai dépassé (comme en production).
      if (n > 4 || (ids && ids.some(id => failIds.has(id)))) return res({ data: null, error: { code: '57014', message: 'statement timeout' } });
      return res(out);
    }, rej);
    return api;
  };
  globalThis.__fakeSb = db.client;
  db.T.aichantier_chantier_plans = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, chantier_id: 'V', nom: `Page ${i}`, bg: `data:image/webp;base64,BG${i}` }))
    .concat([{ id: 'nobg', chantier_id: 'V', nom: 'Sans fond', bg: null }, { id: 'x1', chantier_id: 'AUTRE', nom: 'X', bg: 'data:x' }]);
});

describe('fonds de plans chargés par petits paquets', () => {
  it('projet de 30 plans : toutes les miniatures arrivent (avant : délai dépassé → aucune)', async () => {
    const { hydratePlanLibrary } = await import('./storage.js');
    const map = await hydratePlanLibrary('V');
    expect(Object.keys(map).length).toBe(30);
    expect(maxBgPerRequest).toBeLessThanOrEqual(3);
  });
  it('un paquet en échec n\'empêche pas les autres', async () => {
    failIds.add('p4');
    const { hydratePlanLibrary } = await import('./storage.js');
    const map = await hydratePlanLibrary('V');
    expect(Object.keys(map).length).toBe(27); // le paquet p3-p5 manque, le reste est là
    expect(map.p0.bg).toBe('data:image/webp;base64,BG0');
  });
  it('préchauffage multi-projets par ids : par paquets, rangé par projet', async () => {
    const { loadAllPlanBgs } = await import('./storage.js');
    const by = await loadAllPlanBgs(['p1', 'p2', 'p3', 'p4', 'p5', 'x1', 'nobg']);
    expect(Object.keys(by.V).sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(by.AUTRE.x1).toBe('data:x');
    expect(maxBgPerRequest).toBeLessThanOrEqual(3);
  });
});
