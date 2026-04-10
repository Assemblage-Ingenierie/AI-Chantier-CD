import { getSupabase } from '../supabase.js';

const SK = 'chantierai_v11';
const SK_OLD = 'chantierai_v10';
const _mem = {};

function canLS() {
  try { localStorage.setItem('__probe__','1'); localStorage.removeItem('__probe__'); return true; } catch { return false; }
}
const _hasLS = canLS();

export const stor = {
  get: async (k) => {
    try { const r = await window.storage?.get(k); if (r?.value != null) return r.value; } catch {}
    if (_hasLS) return localStorage.getItem(k) ?? null;
    return _mem[k] ?? null;
  },
  set: async (k, v) => {
    _mem[k] = v;
    try { await window.storage?.set(k, v); return; } catch {}
    if (_hasLS) try { localStorage.setItem(k, v); } catch {}
    _mem[k] = v;
  },
};

async function saveRemote(payload) {
  try {
    const sb = await getSupabase();
    const now = new Date().toISOString();
    const { error: se } = await sb.from('app_state_store').upsert(
      [{ id: 'default', payload: payload.payload, updated_at: now }],
      { onConflict: 'id' }
    );
    if (se) throw se;

    const blobRows = Object.entries(payload.blobs).map(([id, value]) => ({ id, value, updated_at: now }));
    if (blobRows.length > 0) {
      const { error: be } = await sb.from('app_blob_store').upsert(blobRows, { onConflict: 'id' });
      if (be) throw be;
    }
    return true;
  } catch (e) {
    console.warn('Supabase save error:', e);
    return false;
  }
}

async function loadRemote() {
  try {
    const sb = await getSupabase();
    const { data: stateRows, error: se } = await sb.from('app_state_store').select('payload').eq('id', 'default');
    if (se) throw se;
    const { data: blobRows, error: be } = await sb.from('app_blob_store').select('id,value');
    if (be) throw be;
    const blobs = (blobRows || []).reduce((acc, r) => { acc[r.id] = r.value; return acc; }, {});
    return { payload: stateRows?.[0]?.payload ?? null, blobs };
  } catch (e) {
    console.warn('Supabase load error:', e);
    return null;
  }
}

async function resolveBlobs(ps, remoteBlobs) {
  const getBlob = async (key) => remoteBlobs[key] ?? await stor.get(key) ?? null;
  return Promise.all(ps.map(async (p) => ({
    ...p,
    planLibrary: await Promise.all((p.planLibrary || []).map(async (pl) => ({
      ...pl,
      bg: pl.bg === '__img__' ? await getBlob(`plb_${p.id}_${pl.id}`) : pl.bg ?? null,
      data: pl.data === '__pdf__' ? await getBlob(`pld_${p.id}_${pl.id}`) : pl.data ?? null,
    }))),
    localisations: await Promise.all((p.localisations || []).map(async (l) => ({
      ...l,
      planBg: l.planBg === '__img__' ? await getBlob(`pb_${p.id}_${l.id}`) : l.planBg ?? null,
      planData: l.planData === '__pdf__' ? await getBlob(`pd_${p.id}_${l.id}`) : l.planData ?? null,
    }))),
  })));
}

// Charge uniquement depuis le cache local (synchrone, sans réseau ni blobs)
// Les blobs (plans) ne sont pas nécessaires sur les cartes projet — ils chargent via loadData()
export function loadLocalData() {
  try {
    const raw = _hasLS ? (localStorage.getItem(SK) || localStorage.getItem(SK_OLD)) : (_mem[SK] || _mem[SK_OLD] || null);
    if (!raw) return Promise.resolve([]);
    return Promise.resolve(JSON.parse(raw).map(p => ({
      ...p,
      planLibrary: (p.planLibrary || []).map(pl => ({ ...pl, bg: pl.bg === '__img__' ? null : (pl.bg ?? null), data: pl.data === '__pdf__' ? null : (pl.data ?? null) })),
      localisations: (p.localisations || []).map(l => ({ ...l, planBg: l.planBg === '__img__' ? null : (l.planBg ?? null), planData: l.planData === '__pdf__' ? null : (l.planData ?? null) })),
    })));
  } catch {
    return Promise.resolve([]);
  }
}

export async function loadData() {
  const remote = await loadRemote();
  const remoteBlobs = remote?.blobs ?? {};

  let raw = remote?.payload ? JSON.stringify(remote.payload) : null;
  if (raw) {
    await stor.set(SK, raw);
  } else {
    raw = await stor.get(SK) ?? await stor.get(SK_OLD);
  }
  if (!raw) return [];

  return resolveBlobs(JSON.parse(raw), remoteBlobs);
}

export async function saveData(ps, onStatus) {
  try {
    const remoteBlobs = {};
    const slim = ps.map((p) => ({
      ...p,
      planLibrary: (p.planLibrary || []).map((pl) => {
        if (pl.bg) remoteBlobs[`plb_${p.id}_${pl.id}`] = pl.bg;
        if (pl.data) remoteBlobs[`pld_${p.id}_${pl.id}`] = pl.data;
        return { ...pl, bg: pl.bg ? '__img__' : null, data: pl.data ? '__pdf__' : null };
      }),
      localisations: (p.localisations || []).map((l) => {
        if (l.planBg) remoteBlobs[`pb_${p.id}_${l.id}`] = l.planBg;
        if (l.planData) remoteBlobs[`pd_${p.id}_${l.id}`] = l.planData;
        return { ...l, planBg: l.planBg ? '__img__' : null, planData: l.planData ? '__pdf__' : null };
      }),
    }));

    await stor.set(SK, JSON.stringify(slim));
    for (const [k, v] of Object.entries(remoteBlobs)) await stor.set(k, v);

    const ok = await saveRemote({ payload: slim, blobs: remoteBlobs });
    onStatus?.(ok ? 'ok' : 'error');
    if (!ok) showSyncWarning();
  } catch (e) {
    console.warn('Save error:', e);
    onStatus?.('error');
  }
}

function showSyncWarning() {
  const id = '__sync_warn__';
  if (document.getElementById(id)) return;
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;background:#7f1d1d;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-family:inherit;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:90vw;text-align:center;';
  el.textContent = 'Sauvegarde distante échouée — données conservées localement.';
  const btn = document.createElement('button');
  btn.textContent = '×';
  btn.style.cssText = 'margin-left:12px;background:none;border:none;color:#fff;font-size:16px;cursor:pointer;vertical-align:middle;';
  btn.onclick = () => el.remove();
  el.appendChild(btn);
  document.body.appendChild(el);
}
