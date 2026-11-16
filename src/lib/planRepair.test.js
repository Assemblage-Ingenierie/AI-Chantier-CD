import { describe, it, expect } from 'vitest';
import { parsePdfPageName, repairPlanBgs } from './planRepair.js';

describe('parsePdfPageName', () => {
  it('lit le document et la page', () => {
    expect(parsePdfPageName('20260928_ VOLTAIRE_Dossier de Faisabilité réglementaire LD_compressed (1) — Page 29'))
      .toEqual({ base: '20260928_ VOLTAIRE_Dossier de Faisabilité réglementaire LD_compressed (1)', page: 29 });
    expect(parsePdfPageName('RDC')).toBeNull();
    expect(parsePdfPageName('— Page 3')).toBeNull();
  });
});

describe('repairPlanBgs', () => {
  const base = 'VOLTAIRE (1)';
  const plans = [25, 26, 27, 28, 29].map(n => ({ id: `p${n}`, nom: `${base} — Page ${n}` })).concat([{ id: 'rdc', nom: 'RDC' }]);
  it('cache → HD du stockage → page du PDF source ; un seul téléchargement du PDF', async () => {
    let pdfLoads = 0;
    const out = await repairPlanBgs(plans, {
      fromCache: async () => ({ p25: 'data:cache25' }),
      fromHd: async (id) => (id === 'p26' ? 'data:hd26' : null),
      downscale: async (d) => d + ':small',
      pdfOf: async (b) => { pdfLoads++; return b === base ? 'data:application/pdf;base64,X' : null; },
      renderPage: async (_pdf, n) => `data:page${n}`,
    });
    expect(out).toEqual({ p25: 'data:cache25', p26: 'data:hd26:small', p27: 'data:page27', p28: 'data:page28', p29: 'data:page29' });
    expect(pdfLoads).toBe(1);
  });
  it('rien de retrouvable → rien (pas d\'erreur)', async () => {
    const out = await repairPlanBgs(plans, { fromHd: async () => null, downscale: async () => null, pdfOf: async () => null, renderPage: async () => null });
    expect(out).toEqual({});
  });
  it('une erreur sur un plan n\'arrête pas les autres', async () => {
    const out = await repairPlanBgs(plans.slice(0, 3), {
      fromHd: async (id) => { if (id === 'p25') throw new Error('réseau'); return null; },
      downscale: async (d) => d, pdfOf: async () => 'pdf', renderPage: async (_p, n) => `data:${n}`,
    });
    expect(Object.keys(out).sort()).toEqual(['p26', 'p27']);
  });
});
