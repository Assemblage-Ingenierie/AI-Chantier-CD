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

// Version allégée pour le cache localStorage : sans les blobs volumineux ni flags runtime
function toSlim(ps) {
  return ps.map(p => ({
    ...p,
    planLibrary: (p.planLibrary || []).map(pl => ({ ...pl, bg: null, data: null })),
    localisations: (p.localisations || []).map(l => ({
      ...l,
      planBg: null,
      planData: null,
      // eslint-disable-next-line no-unused-vars
      items: (l.items || []).map(({ _photosHydrated, ...item }) => ({
        ...item,
        // eslint-disable-next-line no-unused-vars
        photos: (item.photos || []).map(({ _id, _legacy, ...ph }) => ph),
      })),
    })),
  }));
}

// --- Lecture depuis les tables normalisées ---

async function loadRemote() {
  const sb = await getSupabase();
  // NE PAS charger item_photos globalement : la table est trop volumineuse → timeout 57014.
  // Les photos sont chargées à la demande par loadProjectPhotos() à l'ouverture d'un projet.
  const [r1, r2, r3, r4] = await Promise.all([
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
  ]);

  if (r1.error) throw r1.error;
  if (r2.error) throw r2.error;
  if (r3.error) throw r3.error;
  if (r4.error) throw r4.error;

  const plansByChantier = groupBy(r2.data ?? [], 'chantier_id');
  const locsByChantier  = groupBy(r3.data ?? [], 'chantier_id');
  const itemsByLoc      = groupBy(r4.data ?? [], 'localisation_id');

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
        id:               item.id,
        titre:            item.titre ?? '',
        suivi:            item.suivi ?? 'rien',
        urgence:          item.urgence ?? 'basse',
        commentaire:      item.commentaire ?? '',
        planAnnotations:  tryParseJson(item.plan_annotations),
        photos:           [],
        _photosHydrated:  false, // flag runtime : photos pas encore chargées pour cet item
      })),
    })),
  }));
}

// Charge les photos pour un ensemble d'items — sans la colonne `data` (évite timeout 57014)
// Les photos avec storage_url ont leur URL renvoyée dans le champ `data` pour compatibilité frontend.
// Les photos legacy (data en DB, pas de storage_url) sont marquées _legacy:true pour migration background.
export async function loadProjectPhotos(itemIds) {
  if (!itemIds.length) return {};
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.from('item_photos')
      .select('id,item_id,name,storage_url,sort_order').in('item_id', itemIds).order('sort_order');
    if (error) { console.warn('loadProjectPhotos error:', error); return null; }
    // Map storage_url → data field so frontend works unchanged
    const mapped = (data ?? []).map(ph => ({
      id:         ph.id,
      item_id:    ph.item_id,
      name:       ph.name,
      data:       ph.storage_url ?? null,  // URL or null (legacy without storage_url)
      sort_order: ph.sort_order,
      _legacy:    !ph.storage_url,  // true = old base64 in DB, needs migration
    }));
    return groupBy(mapped, 'item_id');
  } catch (e) { console.warn('loadProjectPhotos error:', e); return null; }
}

// Migre les photos legacy (base64 en DB) vers Supabase Storage — une à la fois pour éviter les timeouts.
// Retourne un objet { [photoId]: storageUrl } pour les photos migrées avec succès.
export async function migratePhotosToStorage(legacyPhotoIds) {
  if (!legacyPhotoIds.length) return {};
  const sb = await getSupabase();
  const result = {};  // photoId → storage_url
  for (const id of legacyPhotoIds) {
    try {
      // Fetch one photo's data (by PK = fast even with large TOAST)
      const { data: row, error } = await sb.from('item_photos')
        .select('id,item_id,name,data').eq('id', id).maybeSingle();
      if (error || !row?.data) continue;
      // Upload to Storage
      const resp = await fetch(row.data);
      const blob = await resp.blob();
      const ext = (row.name || 'photo').replace(/.*\./, '') || 'jpg';
      const path = `${row.item_id}/${id}.${ext}`;
      const { error: upErr } = await sb.storage.from('photos').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
      if (upErr) { console.warn('Storage upload error:', upErr); continue; }
      const { data: urlData } = sb.storage.from('photos').getPublicUrl(path);
      const url = urlData.publicUrl;
      // Update DB: set storage_url, clear data
      await sb.from('item_photos').update({ storage_url: url, data: null }).eq('id', id);
      result[id] = url;
    } catch (e) { console.warn('migratePhotosToStorage error for', id, e); }
  }
  return result;
}

// --- Écriture dans les tables normalisées ---

// Convertit un base64 data URL en blob et l'upload dans le bucket Storage `photos`.
// Retourne l'URL publique ou null en cas d'erreur.
async function uploadPhotoToStorage(sb, itemId, photoIndex, name, base64) {
  try {
    const resp = await fetch(base64);
    const blob = await resp.blob();
    const ext = (name || 'photo').replace(/.*\./, '') || 'jpg';
    const path = `${itemId}/${Date.now()}_${photoIndex}.${ext}`;
    const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
    if (error) { console.warn('Storage upload error:', error); return null; }
    const { data } = sb.storage.from('photos').getPublicUrl(path);
    return data.publicUrl;
  } catch (e) { console.warn('Storage upload error:', e); return null; }
}

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

    const locs = p.localisations || [];

    // Pour les items dont les photos n'ont pas encore été hydratées ET dont l'état local
    // ne contient aucune photo avec data (= pas de modification utilisateur), il faut
    // récupérer les photos existantes dans Supabase avant le CASCADE delete,
    // sinon elles seraient perdues.
    const unloadedItemIds = [];
    locs.forEach(l => {
      (l.items || []).forEach(item => {
        const hasLocalPhotos = (item.photos || []).some(ph => ph.data || ph.storage_url);
        if (!item._photosHydrated && !hasLocalPhotos && item.id) {
          unloadedItemIds.push(item.id);
        }
      });
    });
    const fetchedPhotosByItem = {};
    if (unloadedItemIds.length > 0) {
      const { data: pData, error: pErr } = await sb.from('item_photos')
        .select('id,item_id,name,storage_url,sort_order').in('item_id', unloadedItemIds).order('sort_order');
      if (pErr) {
        // Pré-fetch échoué (ex: timeout) : risqué de faire le CASCADE delete
        // → on saute la sync localisations/items/photos pour ce projet pour ne pas perdre les photos.
        console.warn('Photo pre-fetch failed, skipping localisation sync for safety:', pErr);
        errors.push(pErr);
        continue;
      }
      Object.assign(fetchedPhotosByItem, groupBy(pData ?? [], 'item_id'));
    }

    // Localisations : supprimer toutes (CASCADE → items + photos), puis réinsérer
    await sb.from('chantier_localisations').delete().eq('chantier_id', p.id);
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
    for (let li = 0; li < locs.length; li++) {
      const l = locs[li];
      const locId = locRows[li]?.id;
      if (!locId) continue;
      for (let ii = 0; ii < (l.items || []).length; ii++) {
        const item = l.items[ii];
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
        // Photos : utiliser les données Supabase pré-fetchées pour les items non hydratés,
        // les données locales pour les items hydratés (y compris photos supprimées = [])
        const hasLocalPhotos = (item.photos || []).some(ph => ph.data || ph.storage_url);
        const rawPhotos = (!item._photosHydrated && !hasLocalPhotos)
          ? (fetchedPhotosByItem[item.id] ?? [])
          : (item.photos || []);
        for (let pi = 0; pi < rawPhotos.length; pi++) {
          const ph = rawPhotos[pi];
          let storageUrl = ph.storage_url ?? null;
          if (storageUrl) {
            // Already in Storage (pre-fetched migrated photo or previously saved URL) — reuse as-is
          } else if (ph.data?.startsWith('data:')) {
            // New base64 photo (just taken) — upload to Storage
            storageUrl = await uploadPhotoToStorage(sb, itemId, pi, ph.name, ph.data);
            if (!storageUrl) continue;
          } else if (ph.data?.startsWith('http')) {
            // data field contains the URL directly (older interim format)
            storageUrl = ph.data;
          } else {
            // Legacy photo: base64 is in the DB `data` column — fetch by PK and migrate to Storage
            const legacyId = ph._id || ph.id;
            if (!legacyId) continue;
            const { data: legRow } = await sb.from('item_photos')
              .select('data').eq('id', legacyId).maybeSingle();
            if (!legRow?.data) continue;
            storageUrl = await uploadPhotoToStorage(sb, itemId, pi, ph.name, legRow.data);
            if (!storageUrl) continue;
            await sb.from('item_photos').update({ storage_url: storageUrl, data: null }).eq('id', legacyId);
          }
          allPhotos.push({ item_id: itemId, name: ph.name ?? '', storage_url: storageUrl, data: null, sort_order: pi });
        }
      }
    }

    if (allItems.length > 0) {
      const { error } = await sb.from('localisation_items').insert(allItems);
      if (error) { errors.push(error); continue; } // si items échouent, photos aussi (FK) → skip
    }
    for (const photo of allPhotos) {
      const { error } = await sb.from('item_photos').insert([photo]);
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
