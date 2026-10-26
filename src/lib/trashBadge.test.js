import { describe, it, expect, vi, beforeEach } from 'vitest';

let bin = [];
let server = [];
vi.mock('./recoveryBin.js', () => ({ listDeletedItems: async () => bin }));
vi.mock('./storage.js', () => ({ listServerDeletionsSince: async () => server }));
const { countNewTrash, markTrashSeen, getTrashSeen } = await import('./trashBadge.js');

const projet = { id: 'P', visites: [{ id: 'V', localisations: [{ id: 'z', items: [{ id: 'a' }] }] }] };

beforeEach(() => { bin = []; server = []; });

describe('alerte corbeille', () => {
  it('premier lancement : l\'existant ne déclenche rien', async () => {
    bin = [{ projectId: 'P', ts: 1, item: { id: 'old' } }];
    expect(await countNewTrash(projet)).toBe(0);
  });
  it('nouvelles suppressions (ici + serveur, sans doublon) → compteur ; ouverture → 0', async () => {
    const seen = getTrashSeen('P');
    bin = [
      { projectId: 'P', ts: seen + 10, item: { id: 'b' } },
      { projectId: 'P', ts: seen + 10, kind: 'loc', locId: 'zz' },
      { projectId: 'X', ts: seen + 10, item: { id: 'c' } }, // autre projet
      { projectId: 'P', ts: seen + 10, item: { id: 'a' } }, // déjà restaurée (présente)
    ];
    server = [
      { table_name: 'aichantier_localisation_items', row_id: 'b' }, // même obs que la corbeille locale
      { table_name: 'aichantier_item_photos', row_id: 'p1' },
      { table_name: 'aichantier_item_photos', row_id: 'p2' },
    ];
    expect(await countNewTrash(projet)).toBe(4);
    await new Promise(r => setTimeout(r, 5));
    markTrashSeen('P');
    bin = bin.map(e => ({ ...e, ts: 0 }));
    server = [];
    expect(await countNewTrash(projet)).toBe(0);
  });
});
