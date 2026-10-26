import { describe, it, expect, vi } from 'vitest';

// Faux canal Supabase Realtime : on pilote la présence et la diffusion à la main.
const ch = { handlers: {}, tracked: [], sent: [], state: {} };
const channel = {
  on(type, filter, fn) { ch.handlers[`${type}:${filter.event}`] = fn; return channel; },
  subscribe(cb) { setTimeout(() => cb('SUBSCRIBED'), 0); return channel; },
  track: async (m) => { ch.tracked.push(m); },
  untrack: async () => {},
  send: async (msg) => { ch.sent.push(msg); },
  presenceState: () => ch.state,
};
vi.mock('../supabase.js', () => ({ getSupabase: async () => ({ channel: () => channel, removeChannel: async () => {} }) }));
vi.mock('./logger.js', () => ({ logWarn: () => {}, logEvent: () => {}, logError: () => {} }));
const P = await import('./presence.js');

describe('présence (travail à plusieurs)', () => {
  it('suit ma position, liste les AUTRES, relaie les sauvegardes des autres', async () => {
    vi.useFakeTimers();
    await P.startPresence({ first_name: 'Thomas', last_name: 'C', initials: 'TCM' }, 'u-thomas');
    await vi.advanceTimersByTimeAsync(300);
    expect(ch.tracked.at(-1)).toMatchObject({ userId: 'u-thomas', initials: 'TCM', name: 'Thomas C', projectId: null });
    const myTab = ch.tracked.at(-1).tab;

    P.setPresenceLocation({ projectId: 'P' });
    P.setPresenceLocation({ itemId: 'a' });
    await vi.advanceTimersByTimeAsync(300);
    expect(ch.tracked.at(-1)).toMatchObject({ projectId: 'P', itemId: 'a' });
    expect(P.getMyProjectId()).toBe('P');

    let seen = [];
    P.subscribePresence(o => { seen = o; });
    ch.state = {
      [myTab]: [{ tab: myTab, userId: 'u-thomas' }],
      t2: [{ tab: 't2', userId: 'u-malo', name: 'Malo', initials: 'MV', device: 'pc', projectId: 'P', itemId: 'a', at: 2 }],
      t3: [{ tab: 't3', userId: 'u-malo', name: 'Malo', initials: 'MV', device: 'pc', projectId: 'Q', at: 1 }],
      t4: [{ tab: 't4', userId: 'u-thomas', name: 'Thomas C', initials: 'TCM', device: 'mobile', projectId: null, at: 1 }],
    };
    ch.handlers['presence:sync']();
    expect(seen.map(o => o.tab).sort()).toEqual(['t2', 't3', 't4']); // jamais mon propre onglet
    const grouped = P.groupPresence(seen);
    expect(grouped.map(o => `${o.initials}/${o.device}/${o.projectId}`)).toEqual(['MV/pc/P', 'TCM/mobile/null']); // 1 bulle par personne+appareil, la plus récente

    const got = [];
    P.onRemoteSaved(p => got.push(p));
    ch.handlers['broadcast:saved']({ payload: { tab: 't2', projectIds: ['P'] } });
    ch.handlers['broadcast:saved']({ payload: { tab: myTab, projectIds: ['P'] } }); // écho de moi-même ignoré
    expect(got).toHaveLength(1);

    P.broadcastSaved(new Set(['P']));
    expect(ch.sent.at(-1)).toMatchObject({ type: 'broadcast', event: 'saved', payload: { projectIds: ['P'], userId: 'u-thomas' } });
    expect(P.colorFor('u-malo')).toMatch(/^#[0-9A-F]{6}$/i);
    vi.useRealTimers();
  });
});

describe('frappe en direct (comme Google Sheets)', () => {
  it('envoi regroupé (≈3/s), réception chez les autres, fin d\'édition', async () => {
    vi.useFakeTimers();
    ch.sent.length = 0;
    // (présence démarrée par le test précédent : même module)
    P.broadcastDraft('P', 'a', { titre: 'Coffrage', commentaire: 'T', field: 'commentaire' });
    P.broadcastDraft('P', 'a', { titre: 'Coffrage', commentaire: 'Te', field: 'commentaire' });
    P.broadcastDraft('P', 'a', { titre: 'Coffrage', commentaire: 'Tex', field: 'commentaire' });
    await vi.advanceTimersByTimeAsync(400);
    const drafts = ch.sent.filter(m => m.event === 'draft');
    expect(drafts).toHaveLength(1);                                    // 3 frappes → 1 message
    expect(drafts[0].payload).toMatchObject({ projectId: 'P', itemId: 'a', commentaire: 'Tex', field: 'commentaire', name: 'Thomas C' });

    let got = [];
    P.subscribeDrafts(l => { got = l; });
    ch.handlers['broadcast:draft']({ payload: { tab: 't9', userId: 'u-stas', name: 'Stas K', projectId: 'P', itemId: 'a', commentaire: 'Fissure V3', field: 'commentaire' } });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ name: 'Stas K', commentaire: 'Fissure V3' });
    expect(P.firstName(got[0].name)).toBe('Stas');
    ch.handlers['broadcast:draft-end']({ payload: { tab: 't9', projectId: 'P', itemId: 'a' } });
    expect(got).toHaveLength(0);                                       // fenêtre fermée → plus d'indication

    P.broadcastDraftEnd('P', 'a');
    expect(ch.sent.at(-1)).toMatchObject({ event: 'draft-end', payload: { itemId: 'a' } });
    vi.useRealTimers();
  });
});

