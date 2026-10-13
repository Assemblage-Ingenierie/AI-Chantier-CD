// Faux Supabase EN MÉMOIRE pour les tests d'intégrité de la sauvegarde (saveRemote / loadRemote).
// Reproduit ce qui compte pour la perte de données :
//   • clés étrangères (insert/upsert vers un parent absent → erreur 23503, comme Postgres) ;
//   • ON DELETE CASCADE : chantier → zones → observations → photos ;
//   • upsert batch contenant deux fois le même id → erreur (comme Postgres) ;
//   • journal de toutes les lignes supprimées (pour vérifier que rien n'est perdu).
// Utilisé uniquement par les tests (jamais importé par l'application).

const FK = {
  aichantier_chantier_localisations: ['chantier_id', 'aichantier_chantiers'],
  aichantier_localisation_items: ['localisation_id', 'aichantier_chantier_localisations'],
  aichantier_item_photos: ['item_id', 'aichantier_localisation_items'],
};
const CASCADE = {
  aichantier_chantiers: [['aichantier_chantier_localisations', 'chantier_id'], ['aichantier_chantier_plans', 'chantier_id']],
  aichantier_chantier_localisations: [['aichantier_localisation_items', 'localisation_id']],
  aichantier_localisation_items: [['aichantier_item_photos', 'item_id']],
};

export function createFakeSupabase() {
  const T = {};
  const deleted = []; // { table, id }
  const table = (t) => (T[t] ??= []);

  const delRows = (t, pred) => {
    const gone = table(t).filter(pred);
    T[t] = table(t).filter(r => !pred(r));
    for (const r of gone) {
      deleted.push({ table: t, id: r.id });
      for (const [ct, col] of (CASCADE[t] || [])) delRows(ct, x => x[col] === r.id);
    }
    return gone;
  };

  const from = (t) => {
    const st = { op: 'select', filters: [], rows: null, patch: null, single: false, maybe: false };
    const match = (r) => st.filters.every(f => f(r));
    const exec = () => {
      if (st.op === 'select') {
        const d = table(t).filter(match).map(r => ({ ...r }));
        if (st.single || st.maybe) return { data: d[0] ?? null, error: st.single && !d[0] ? { code: 'PGRST116', message: 'no rows' } : null };
        return { data: d, error: null };
      }
      if (st.op === 'delete') return { data: delRows(t, match), error: null };
      if (st.op === 'update') { table(t).filter(match).forEach(r => Object.assign(r, st.patch)); return { data: null, error: null }; }
      // upsert
      const ids = st.rows.map(r => r.id);
      if (new Set(ids).size !== ids.length) {
        return { data: null, error: { code: '21000', message: 'ON CONFLICT DO UPDATE command cannot affect row a second time' } };
      }
      const fk = FK[t];
      if (fk) for (const r of st.rows) {
        if (r[fk[0]] != null && !table(fk[1]).some(x => x.id === r[fk[0]])) {
          return { data: null, error: { code: '23503', message: `insert or update on table "${t}" violates foreign key constraint` } };
        }
      }
      for (const r of st.rows) {
        const ex = table(t).find(x => x.id === r.id);
        if (ex) Object.assign(ex, r); else table(t).push({ ...r });
      }
      return { data: null, error: null };
    };
    const api = {
      select() { return api; },
      eq(c, v) { st.filters.push(r => r[c] === v); return api; },
      in(c, vs) { const s = new Set(vs); st.filters.push(r => s.has(r[c])); return api; },
      is(c, v) { st.filters.push(r => (r[c] ?? null) === v); return api; },
      order() { return api; }, range() { return api; }, limit() { return api; },
      single() { st.single = true; return api; },
      maybeSingle() { st.maybe = true; return api; },
      upsert(rows) { st.op = 'upsert'; st.rows = Array.isArray(rows) ? rows : [rows]; return api; },
      insert(rows) { st.op = 'upsert'; st.rows = Array.isArray(rows) ? rows : [rows]; return api; },
      delete() { st.op = 'delete'; return api; },
      update(p) { st.op = 'update'; st.patch = p; return api; },
      then(res, rej) { return Promise.resolve().then(exec).then(res, rej); },
    };
    return api;
  };

  const signed = (p) => `https://x.supabase.co/storage/v1/object/sign/photos/${p}?token=t`;
  const client = {
    from,
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    storage: {
      from: () => ({
        upload: async (path) => ({ data: { path }, error: null }),
        move: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        createSignedUrl: async (p) => ({ data: { signedUrl: signed(p) }, error: null }),
        createSignedUrls: async (ps) => ({ data: ps.map(p => ({ path: p, signedUrl: signed(p) })), error: null }),
      }),
    },
  };
  return { client, T, deleted, rows: table };
}
