// Retour Thomas 16/11 « ça rame » : les fonds de plans (base64 lourds) ne vont plus dans le cache
// localStorage (sérialisé toutes les 500 ms, au-delà du quota) mais dans IndexedDB.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const idb = {};
vi.mock('./planThumbCache.js', () => ({
  setPlanThumbs: vi.fn(async (m) => { Object.assign(idb, m); }),
  getPlanHd: vi.fn(async () => null), setPlanHd: vi.fn(), getPlanPdf: vi.fn(async () => null), setPlanPdf: vi.fn(), delPlanPdf: vi.fn(),
}));
vi.mock('../supabase.js', () => ({ getSupabase: async () => { throw new Error('hors ligne'); } }));
vi.mock('./logger.js', () => ({ logEvent: () => {}, logWarn: () => {}, logError: () => {} }));
vi.mock('./pdfUtils.js', () => ({ renderPdfPage: vi.fn() }));

const BG = (n) => 'data:image/webp;base64,' + 'A'.repeat(200000) + n;
const projet = () => ({
  id: 'V', nom: 'Voltaire', planLibrary: [{ id: 'P1', nom: 'Page 1', bg: BG(1) }, { id: 'P2', nom: 'Page 2', bg: BG(2) }, { nom: 'ancien sans id', bg: 'data:old' }],
  visites: [{ id: 'v1', localisations: [
    { id: 'Z1', nom: 'Bât', planId: 'P1', planBg: BG(1), extraPlans: [{ planId: 'P2', planBg: BG(2) }], items: [{ id: 'O1', titre: 'Fissure', commentaire: 'texte', photos: [], plans: [{ id: 'e', planId: 'P2', planBg: BG(2), planAnnotations: { paths: [{ t: 1 }] } }] }] },
    { id: 'Z2', nom: 'Ancien', planId: null, planBg: 'data:legacy', items: [] },
  ] }],
});

beforeEach(() => { localStorage.clear(); for (const k of Object.keys(idb)) delete idb[k]; });

describe('cache local léger', () => {
  it('le cache ne contient plus les fonds de plans, IndexedDB les a', async () => {
    const { saveLocalCache } = await import('./storage.js');
    saveLocalCache([projet()]);
    await new Promise(r => setTimeout(r, 0));
    const raw = localStorage.getItem('chantierai_v12');
    expect(raw.length).toBeLessThan(20000); // avant : > 1 Mo pour 2 plans
    const c = JSON.parse(raw)[0];
    expect(c.planLibrary.map(p => p.bg)).toEqual([null, null, 'data:old']);
    expect(c.visites[0].localisations[0].planBg).toBeNull();
    expect(c.visites[0].localisations[0].items[0].plans[0].planBg).toBeNull();
    expect(c.visites[0].localisations[1].planBg).toBe('data:legacy'); // sans planId : gardé
    expect(Object.keys(idb).sort()).toEqual(['P1', 'P2']);
    expect(idb.P1).toBe(BG(1));
  });
  it('texte, repères et structure intacts', async () => {
    const { saveLocalCache } = await import('./storage.js');
    saveLocalCache([projet()]);
    const c = JSON.parse(localStorage.getItem('chantierai_v12'))[0];
    const it0 = c.visites[0].localisations[0].items[0];
    expect(it0.commentaire).toBe('texte');
    expect(it0.plans[0].planAnnotations.paths.length).toBe(1);
    expect(c.visites[0].localisations[0].planId).toBe('P1');
  });
});
