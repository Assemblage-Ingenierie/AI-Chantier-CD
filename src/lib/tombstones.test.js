import { describe, it, expect, vi, beforeEach } from 'vitest';

// Faux serveur Supabase en mémoire pour la table aichantier_deleted_entities.
const server = { rows: new Map(), fail: false };
const fakeClient = {
  from: () => ({
    upsert: async (rows) => {
      if (server.fail) return { error: { message: 'relation does not exist' } };
      rows.forEach(r => server.rows.set(r.id, r));
      return { error: null };
    },
    delete: () => ({
      in: async (_col, ids) => {
        if (server.fail) return { error: { message: 'relation does not exist' } };
        ids.forEach(id => server.rows.delete(id));
        return { error: null };
      },
    }),
    select: () => ({
      range: async (from, to) => {
        if (server.fail) return { data: null, error: { message: 'relation does not exist' } };
        return { data: [...server.rows.values()].slice(from, to + 1), error: null };
      },
    }),
  }),
};
vi.mock('../supabase.js', () => ({ getSupabase: async () => fakeClient }));

const T = await import('./tombstones.js');
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  server.rows.clear();
  server.fail = false;
});

describe('pierres tombales zones / observations', () => {
  it('suppression : mémo local immédiat + envoi au serveur', async () => {
    T.addTombstone('loc', 'zone-1', 'proj-1');
    expect(T.getDeletedIds('loc').has('zone-1')).toBe(true);
    await flush();
    expect(server.rows.get('zone-1')).toMatchObject({ kind: 'loc', chantier_id: 'proj-1' });
  });

  it('suppression faite sur un AUTRE appareil : récupérée au chargement', async () => {
    server.rows.set('obs-x', { id: 'obs-x', kind: 'item' });
    server.rows.set('zone-y', { id: 'zone-y', kind: 'loc' });
    const res = await T.syncTombstones();
    expect(res.item.has('obs-x')).toBe(true);
    expect(res.loc.has('zone-y')).toBe(true);
  });

  it('restauration faite ailleurs (ligne retirée du serveur) : plus filtrée ici', async () => {
    server.rows.set('obs-r', { id: 'obs-r', kind: 'item' });
    await T.syncTombstones();
    expect(T.getDeletedIds('item').has('obs-r')).toBe(true);
    server.rows.delete('obs-r'); // restaurée sur un autre appareil
    await T.syncTombstones();
    expect(T.getDeletedIds('item').has('obs-r')).toBe(false);
  });

  it('Annuler / Restaurer : levée locale immédiate + retrait serveur', async () => {
    T.addTombstone('item', 'obs-u', 'p');
    await flush();
    T.liftTombstone('obs-u');
    expect(T.getDeletedIds('item').has('obs-u')).toBe(false);
    await flush();
    expect(server.rows.has('obs-u')).toBe(false);
  });

  it('hors ligne / table absente : le mémo local est conservé et renvoyé plus tard', async () => {
    server.fail = true;
    T.addTombstone('loc', 'zone-off', 'p');
    await flush();
    expect(await T.syncTombstones()).toBeNull();
    expect(T.getDeletedIds('loc').has('zone-off')).toBe(true); // jamais perdu
    server.fail = false;
    await T.syncTombstones(); // retour du réseau → la file part
    expect(server.rows.has('zone-off')).toBe(true);
    expect(T.getDeletedIds('loc').has('zone-off')).toBe(true);
  });

  it('suppressions d\'observations mémorisées avant la table (v108-v111) : partagées au 1er chargement', async () => {
    localStorage.setItem('_chantierai_deleted_items_v1', JSON.stringify(['ancienne-obs']));
    await T.syncTombstones();
    expect(server.rows.get('ancienne-obs')).toMatchObject({ kind: 'item' });
    expect(T.getDeletedIds('item').has('ancienne-obs')).toBe(true);
  });
});
