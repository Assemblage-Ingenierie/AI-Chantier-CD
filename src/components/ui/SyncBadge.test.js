import { describe, it, expect } from 'vitest';
import { projectSyncState } from './SyncBadge.jsx';

describe('projectSyncState — priorité des états', () => {
  it('erreur prime sur tout', () => {
    expect(projectSyncState({ error: true, dirty: true, syncing: true, stale: true })).toBe('error');
  });
  it('sync en cours quand dirty ET saving', () => {
    expect(projectSyncState({ dirty: true, syncing: true })).toBe('syncing');
  });
  it('modifs locales en attente (dirty, pas de save en cours)', () => {
    expect(projectSyncState({ dirty: true, syncing: false })).toBe('pending');
  });
  it('mise à jour distante dispo (stale) quand rien de local', () => {
    expect(projectSyncState({ dirty: false, stale: true })).toBe('stale');
  });
  it('à jour → synced (badge silencieux)', () => {
    expect(projectSyncState({})).toBe('synced');
  });
  it('dirty prime sur stale', () => {
    expect(projectSyncState({ dirty: true, stale: true })).toBe('pending');
  });
});
