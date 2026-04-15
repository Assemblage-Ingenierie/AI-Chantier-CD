import { getSupabase } from '../supabase.js';

// v12 = format normalisé (tables séparées, sans placeholders __img__/__pdf__)
const SK = 'chantierai_v12';
const _mem = {};

// IDs connus depuis le dernier loadData() — seuls ces IDs peuvent être supprimés de Supabase.
// Null = loadData() pas encore terminé → on ne supprime rien (évite de détruire
// des projets ajoutés depuis un autre appareil non encore chargés localement).
let _lastRemoteIds = null;

function canLS() {
  try { localStorage.setItem('__probe__', '1'); localStorage.removeItem('__probe__'); return true; } catch { return false; }
}
const _hasLS = canLS();

export const stor = {
  get: async (k) => {
    if (window.storage) {
      try { const r = await window.storage.get(k); if (r?.value != null) return r.value; } catch {}
    }
    if (_hasLS) return localStorage.getItem(k) ?? null;
    return _mem[k] ?? null;
  },
  set: async (k, v) => {
    _mem[k] = v;
    if (window.storage) {
      try { await window.storage.set(k, v); return; } catch {}
    }
    if (_hasLS) try { localStorage.setItem(k, v); } catch {}
  },
};

// --- Utilitaires ---

function groupBy(arr, key) {
  return arr.reduce((acc, row) => {
    const k = row[key];
    if (!acc[k]) acc[k] = [];
    acc[k].push(row);
    return acc;
  }, {});
}

function tryParseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

// Version allégée pour le cache localStorage : sans les blobs volumineux
function toSlim(ps) {
  return ps.map(p => ({
    ...p,
    planLibrary: (p.planLibrary || []).map(pl => ({ ...pl, bg: null, data: null })),
    localisations: (p.localisations || []).map(l => ({
      ...l,
      planBg: null,
      planData: null,
      items: (l.items || []).map(item => ({
        ...item,
        photos: (item.photos || []).map(ph => ({ ...ph, data: null })),
      })),
    })),
  }));
}

// --- Lecture depuis les tables normalisées ---

async function loadRemote() {
  const sb = await getSupabase();
  const [r1, r2, r3, r4, r5] = await Promise.all([
    sb.from('chantiers').select('*'),
    sb.from('chantier_plans')
      .select('id,chantier_id,nom,bg,data,sort_order')
      .order('sort_order'),
    sb.from('chantier_localisations')
      .select('id,chantier_id,nom,plan_bg,plan_data,plan_annotations,sort_order')
      .order('sort_order'),
    sb.from('localisation_items')
      .select('id,localisation_id,titre,suivi,urgence,commentaire,plan_annotations,sort_order')
      .order('sort_order'),
    sb.from('item_photos')
      .select('id,item_id,name,sort_order')
      .order('sort_order'),
  ]);

  if (r1.error) throw r1.error;
  if (r2.error) throw r2.error;
  if (r3.error) throw r3.error;
  if (r4.error) throw r4.error;
  // item_photos peut échouer (500) si le volume de données est trop grand —
  // on log et on continue sans photos plutôt que de perdre tous les projets.
  if (r5.error) console.warn('item_photos load error (photos ignorées):', r5.error);

  const plansByChantier = groupBy(r2.data ?? [], 'chantier_id');
  const locsByChantier  = groupBy(r3.data ?? [], 'chantier_id');
  const itemsByLoc      = groupBy(r4.data ?? [], 'localisation_id');
  const photosByItem    = r5.error ? {} : groupBy(r5.data ?? [], 'item_id');

  return (r1.data ?? []).map(c => ({
    id:            c.id,
    nom:           c.nom ?? '',
    statut:        c.statut ?? 'en_cours',
    adresse:       c.adresse ?? '',
    dateVisite:    c.date_visite ?? null,
    maitreOuvrage: c.maitre_ouvrage ?? '',
    photo:         c.photo ?? null,
    photosParLigne: c.photos_par_ligne ?? 2,
    participants:  c.participants ?? [],
    tableauRecap:  c.tableau_recap ?? [],
    updatedAt:     c.updated_at,
    planLibrary: (plansByChantier[c.id] ?? []).map(pl => ({
      id:   pl.id,
      nom:  pl.nom ?? '',
      bg:   pl.bg ?? null,
      data: pl.data ?? null,
    })),
    localisations: (locsByChantier[c.id] ?? []).map(loc => ({
      id:              loc.id,
      nom:             loc.nom ?? '',
      planBg:          loc.plan_bg ?? null,
      planData:        loc.plan_data ?? null,
      planAnnotations: tryParseJson(loc.plan_annotations),
      items: (itemsByLoc[loc.id] ?? []).map(item => ({
        id:              item.id,
        titre:           item.titre ?? '',
        suivi:           item.suivi ?? 'rien',
        urgence:         item.urgence ?? 'basse',
        commentaire:     item.commentaire ?? '',
        planAnnotations: tryParseJson(item.plan_annotations),
        photos: (photosByItem[item.id] ?? []).map(ph => ({
          name: ph.name ?? '',
          data: null,
        })),
      })),
    })),
  }));
}

// Charge les photos (avec données complètes) pour un ensemble d'items — appelé à l'ouverture d'un projet
export async function loadProjectPhotos(itemIds) {
  if (!itemIds.length) return {};
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.from('item_photos')
      .select('item_id,name,data,sort_order').in('item_id', itemIds).order('sort_order');
    if (error) { console.warn('loadProjectPhotos error:', error); return {}; }
    return groupBy(data ?? [], 'item_id');
  } catch (e) { console.warn('loadProjectPhotos error:', e); return {}; }
}

// --- Écriture dans les tables normalisées ---

async function saveRemote(ps) {
  const sb = await getSupabase();
  const now = new Date().toISOString();
  const errors = [];

  // Supprimer uniquement les chantiers CONNUS de ce client qui ont été supprimés localement.
  // On n'utilise PAS une requête Supabase pour lister les chantiers existants car ça
  // supprimerait les projets ajoutés depuis un autre appareil non encore chargés ici.
  const memIds = new Set(ps.map(p => p.id));
  if (_lastRemoteIds !== null) {
    const toDelete = [..._lastRemoteIds].filter(id => !memIds.has(id));
    if (toDelete.length > 0) {
      const { error } = await sb.from('chantiers').delete().in('id', toDelete);
      if (error) errors.push(error);
    }
  }
  // Mettre à jour _lastRemoteIds pour refléter l'état après cette sauvegarde
  _lastRemoteIds = new Set(ps.map(p => p.id));

  // Upsert chaque chantier et synchroniser ses enfants
  for (const p of ps) {
    const { error: ce } = await sb.from('chantiers').upsert({
      id:             p.id,
      nom:            p.nom ?? '',
      statut:         p.statut ?? 'en_cours',
      adresse:        p.adresse ?? '',
      date_visite:    p.dateVisite ?? null,
      maitre_ouvrage: p.maitreOuvrage ?? '',
      photo:          p.photo ?? null,
      photos_par_ligne: p.photosParLigne ?? 2,
      participants:   p.participants ?? [],
      tableau_recap:  p.tableauRecap ?? [],
      updated_at:     now,
    }, { onConflict: 'id' });
    if (ce) { errors.push(ce); continue; }

    // Plans : supprimer tous puis réinsérer (gère suppressions + réordonnancement)
    await sb.from('chantier_plans').delete().eq('chantier_id', p.id);
    const planRows = (p.planLibrary || []).map((pl, i) => ({
      id:          pl.id || crypto.randomUUID(),
      chantier_id: p.id,
      nom:         pl.nom ?? '',
      bg:          pl.bg ?? null,
      data:        pl.data ?? null,
      sort_order:  i,
    }));
    if (planRows.length > 0) {
      const { error } = await sb.from('chantier_plans').insert(planRows);
      if (error) errors.push(error);
    }

    // Récupérer les photos non encore chargées (data: null) avant le CASCADE delete
    const unloadedItemIds = [];
    (p.localisations || []).forEach(l => {
      (l.items || []).forEach(item => {
        if ((item.photos || []).some(ph => ph.name && ph.data === null)) {
          unloadedItemIds.push(item.id);
        }
      });
    });
    const fetchedPhotosByItem = {};
    if (unloadedItemIds.length > 0) {
      const { data: pData, error: pErr } = await sb.from('item_photos')
        .select('item_id,name,data,sort_order').in('item_id', unloadedItemIds).order('sort_order');
      if (!pErr && pData) Object.assign(fetchedPhotosByItem, groupBy(pData, 'item_id'));
    }

    // Localisations : supprimer toutes (CASCADE → items + photos), puis réinsérer
    await sb.from('chantier_localisations').delete().eq('chantier_id', p.id);
    const locs = p.localisations || [];
    const locRows = locs.map((l, i) => ({
      id:              l.id || crypto.randomUUID(),
      chantier_id:     p.id,
      nom:             l.nom ?? '',
      plan_bg:         l.planBg ?? null,
      plan_data:       l.planData ?? null,
      plan_annotations: l.planAnnotations ? JSON.stringify(l.planAnnotations) : null,
      sort_order:      i,
    }));
    if (locRows.length > 0) {
      const { error: le } = await sb.from('chantier_localisations').insert(locRows);
      if (le) { errors.push(le); continue; }
    }

    // Items et photos (les localisations viennent d'être réinsérées)
    const allItems  = [];
    const allPhotos = [];
    locs.forEach((l, li) => {
      const locId = locRows[li]?.id;
      if (!locId) return;
      (l.items || []).forEach((item, ii) => {
        const itemId = item.id || crypto.randomUUID();
        allItems.push({
          id:              itemId,
          localisation_id: locId,
          titre:           item.titre ?? '',
          suivi:           item.suivi ?? 'rien',
          urgence:         item.urgence ?? 'basse',
          commentaire:     item.commentaire ?? '',
          plan_annotations: item.planAnnotations ? JSON.stringify(item.planAnnotations) : null,
          sort_order:      ii,
        });
        // Si les photos ne sont pas encore chargées (lazy), utiliser celles récupérées depuis Supabase
        const rawPhotos = (item.photos || []).some(ph => ph.name && ph.data === null)
          ? (fetchedPhotosByItem[item.id] ?? [])
          : (item.photos || []);
        rawPhotos.forEach((ph, pi) => {
          if (!ph.data) return;
          allPhotos.push({
            item_id:    itemId,
            name:       ph.name ?? '',
            data:       ph.data,
            sort_order: pi,
          });
        });
      });
    });

    if (allItems.length > 0) {
      const { error } = await sb.from('localisation_items').insert(allItems);
      if (error) errors.push(error);
    }
    if (allPhotos.length > 0) {
      const { error } = await sb.from('item_photos').insert(allPhotos);
      if (error) errors.push(error);
    }
  }

  if (errors.length > 0) {
    console.warn('saveRemote errors:', errors.map(e => ({ msg: e.message, code: e.code, details: e.details, hint: e.hint })));
  }
  return errors;
}

// --- API publique (inchangée) ---

// Charge uniquement depuis le cache local (sans réseau ni blobs)
// Utilisé pour l'affichage instantané des cartes projet au démarrage
export function loadLocalData() {
  try {
    const raw = _hasLS ? localStorage.getItem(SK) : (_mem[SK] ?? null);
    if (!raw) return Promise.resolve([]);
    return Promise.resolve(JSON.parse(raw));
  } catch {
    return Promise.resolve([]);
  }
}

export async function loadData() {
  try {
    const ps = await loadRemote();
    // Mémoriser les IDs Supabase pour que saveRemote() sache quoi supprimer
    _lastRemoteIds = new Set(ps.map(p => p.id));
    // NE PAS mettre à jour le cache local ici : seul saveData() écrit dans
    // localStorage. Cela évite que loadData() n'écrase des modifications
    // locales non encore synchronisées (race condition beforeunload vs microtask).
    return ps;
  } catch (e) {
    console.warn('Supabase load error:', e);
    // Fallback sur le cache local (version allégée, sans blobs)
    try {
      const raw = await stor.get(SK);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}

// Mise à jour du cache local UNIQUEMENT (sans écriture Supabase).
// Utilisé quand on accepte des données fraîches de Supabase sans modification utilisateur.
export function saveLocalCache(ps) {
  try {
    const slim = JSON.stringify(toSlim(ps));
    if (_hasLS) localStorage.setItem(SK, slim);
    _mem[SK] = slim;
  } catch {}
}

export async function saveData(ps, onStatus) {
  try {
    // Sauvegarder localement en premier (résilience hors-ligne)
    await stor.set(SK, JSON.stringify(toSlim(ps)));
    const errors = await saveRemote(ps);
    const ok = errors.length === 0;
    onStatus?.(ok ? 'ok' : 'error');
    if (!ok) showSyncWarning(errors[0]);
  } catch (e) {
    console.warn('Save error:', e);
    onStatus?.('error');
  }
}

function showSyncWarning(firstError) {
  const id = '__sync_warn__';
  if (document.getElementById(id)) return;
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;background:#7f1d1d;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-family:inherit;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:90vw;text-align:center;';
  const errMsg = firstError?.message ? ` — ${firstError.message.slice(0, 100)}` : '';
  el.textContent = `Sync échoué${errMsg}`;
  const btn = document.createElement('button');
  btn.textContent = '×';
  btn.style.cssText = 'margin-left:12px;background:none;border:none;color:#fff;font-size:16px;cursor:pointer;vertical-align:middle;';
  btn.onclick = () => el.remove();
  el.appendChild(btn);
  document.body.appendChild(el);
}
