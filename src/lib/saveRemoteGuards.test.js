// FILETS DE SÉCURITÉ DE LA SAUVEGARDE — saveRemote (garde anti-suppression massive) et
// deleteRemoteProjet (suppression explicite). Check-up du 02/11/2026 : ces deux fonctions, les plus
// sensibles de l'app, n'avaient aucun test → une régression passait la CI sans alerte.
// Tests SEULEMENT : le code de storage.js n'est pas modifié.
//
// Même banc que concurrentEdit.test.js : vrai chemin loadData → saveData contre le faux Supabase.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';

vi.mock('../supabase.js', () => ({ getSupabase: async () => globalThis.__fakeSb }));
vi.mock('./logger.js', () => ({ logEvent: () => {}, logWarn: () => {}, logError: () => {} }));
vi.mock('./pdfUtils.js', () => ({ renderPdfPage: vi.fn() }));

let db;
const IDS = ['P1', 'P2', 'P3', 'P4'];

function seed() {
  db = createFakeSupabase();
  globalThis.__fakeSb = db.client;
  db.T.aichantier_chantiers = IDS.map((id, i) => ({ id, nom: `Chantier ${i + 1}`, statut: 'en_cours', visites: [], updated_at: '2026-10-30T08:00:00.000Z' }));
  db.T.aichantier_chantier_plans = [];
  db.T.aichantier_chantier_localisations = [];
  db.T.aichantier_localisation_items = [];
  db.T.aichantier_item_photos = [];
  db.T.aichantier_deleted_chantiers = [];
}

// Nouvelle session de l'app (module neuf, localStorage vierge).
async function openApp() {
  localStorage.clear();
  vi.resetModules();
  const storage = await import('./storage.js');
  const ps = await storage.loadData();
  return { storage, ps };
}
const remoteIds = () => db.rows('aichantier_chantiers').map(r => r.id).sort();
const keep = (ps, ids) => ps.filter(p => ids.includes(p.id));

beforeEach(() => { seed(); });

describe('saveRemote — garde anti-suppression massive (incident 13/05/2026)', () => {
  it('chargement : les 4 chantiers du serveur sont présents', async () => {
    const { ps } = await openApp();
    expect(ps.map(p => p.id).sort()).toEqual(IDS);
  });

  it('cache corrompu (3 chantiers sur 4 disparus) → AUCUNE suppression sur le serveur', async () => {
    const { storage, ps } = await openApp();
    await storage.saveData(keep(ps, ['P1']), null, new Set(['P1']));
    expect(remoteIds()).toEqual(IDS);
    expect(db.deleted.filter(d => d.table === 'aichantier_chantiers')).toEqual([]);
  });

  it('… et les modifications des chantiers restants passent quand même', async () => {
    const { storage, ps } = await openApp();
    const edited = keep(ps, ['P1']).map(p => ({ ...p, nom: 'Chantier 1 renommé' }));
    await storage.saveData(edited, null, new Set(['P1']));
    expect(db.rows('aichantier_chantiers').find(r => r.id === 'P1').nom).toBe('Chantier 1 renommé');
    expect(remoteIds()).toEqual(IDS);
  });

  it('suppression raisonnable (1 sur 4, sous le plafond de 50 %) → appliquée', async () => {
    const { storage, ps } = await openApp();
    await storage.saveData(keep(ps, ['P1', 'P2', 'P3']), null, new Set());
    expect(remoteIds()).toEqual(['P1', 'P2', 'P3']);
  });

  it('pile au plafond (2 sur 4 = 50 %) → appliquée ; au-delà → bloquée', async () => {
    const a = await openApp();
    await a.storage.saveData(keep(a.ps, ['P1', 'P2']), null, new Set());
    expect(remoteIds()).toEqual(['P1', 'P2']);
    seed();
    const b = await openApp();
    await b.storage.saveData(keep(b.ps, ['P1']), null, new Set());
    expect(remoteIds()).toEqual(IDS);
  });

  it('chantier sans id (orphelin, cache corrompu) → étape de suppression entièrement sautée', async () => {
    const { storage, ps } = await openApp();
    const corrupted = [...keep(ps, ['P1', 'P2', 'P3']), { nom: 'Orphelin sans id', visites: [] }];
    await storage.saveData(corrupted, null, new Set());
    expect(remoteIds()).toEqual(IDS); // P4 n'est PAS supprimé : impossible de savoir si l'orphelin est P4
  });
});

describe('deleteRemoteProjet — suppression explicite (contourne la garde, incident 21/05/2026)', () => {
  it('supprime la ligne, pose une pierre tombale serveur et vide la file de rejeu', async () => {
    const { storage } = await openApp();
    expect(await storage.deleteRemoteProjet('P2')).toBe(true);
    expect(remoteIds()).toEqual(['P1', 'P3', 'P4']);
    await new Promise(r => setTimeout(r, 0)); // la pierre tombale serveur part en tâche de fond
    expect(db.rows('aichantier_deleted_chantiers').map(r => r.id)).toContain('P2');
    expect(localStorage.getItem('_chantierai_pending_deletes_v1') || '[]').not.toContain('P2');
  });

  it('suppressions explicites de 3 chantiers sur 4 : passent malgré la garde des 50 %', async () => {
    const { storage } = await openApp();
    for (const id of ['P2', 'P3', 'P4']) expect(await storage.deleteRemoteProjet(id)).toBe(true);
    expect(remoteIds()).toEqual(['P1']);
  });

  it('_lastRemoteIds tenu à jour : après 2 suppressions explicites, une 3e suppression normale passe', async () => {
    const { storage, ps } = await openApp();
    await storage.deleteRemoteProjet('P2');
    await storage.deleteRemoteProjet('P3');
    // Sans mise à jour, la sauvegarde verrait P2, P3, P4 « à supprimer » (3 > plafond 2) → bloquée.
    await storage.saveData(keep(ps, ['P1']), null, new Set(['P1']));
    expect(remoteIds()).toEqual(['P1']);
  });

  it('un chantier supprimé ne ressuscite pas au rechargement', async () => {
    const a = await openApp();
    await a.storage.deleteRemoteProjet('P3');
    const b = await openApp();
    expect(b.ps.map(p => p.id)).not.toContain('P3');
  });

  it('serveur injoignable → false, la suppression reste en file de rejeu (rien de perdu)', async () => {
    const { storage } = await openApp();
    const real = db.client.from.bind(db.client);
    globalThis.__fakeSb = { ...db.client, from: (t) => {
      if (t !== 'aichantier_chantiers') return real(t);
      const api = real(t);
      return { ...api, delete: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: 'network down' } }) }) }) };
    } };
    expect(await storage.deleteRemoteProjet('P4')).toBe(false);
    expect(remoteIds()).toEqual(IDS);
    expect(localStorage.getItem('_chantierai_pending_deletes_v1')).toContain('P4');
  });

  it('ligne déjà absente (supprimée ailleurs) → false mais file de rejeu vidée', async () => {
    const { storage } = await openApp();
    db.T.aichantier_chantiers = db.T.aichantier_chantiers.filter(r => r.id !== 'P1');
    expect(await storage.deleteRemoteProjet('P1')).toBe(false);
    expect(localStorage.getItem('_chantierai_pending_deletes_v1') || '[]').not.toContain('P1');
  });
});
