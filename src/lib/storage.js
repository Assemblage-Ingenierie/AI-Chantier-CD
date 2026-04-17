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

function tryParseJson(val) {
  if (!val) return null;
  if (typeof val !== 'string') return val; // déjà parsé (colonne JSONB Supabase)
  try { return JSON.parse(val); } catch { return null; }
}

// Version allégée pour le cache localStorage : sans les blobs volumineux ni flags runtime
function slimLoc(l) {
  return {
    ...l,
    planBg: null,
    planData: null,
    // eslint-disable-next-line no-unused-vars
    items: (l.items || []).map(({ _photosHydrated, ...item }) => ({
      ...item,
      // eslint-disable-next-line no-unused-vars
      photos: (item.photos || []).map(({ _id, _legacy, ...ph }) => ph),
    })),
  };
}

function toSlim(ps) {
  return ps.map(p => ({
    ...p,
    planLibrary: (p.planLibrary || []).map(pl => ({ ...pl, bg: null, data: null })),
    visites: (p.visites || []).map(v => ({
      ...v,
      localisations: (v.localisations || []).map(slimLoc),
    })),
  }));
}

// --- Lecture depuis les tables normalisées ---

function buildLocFromRow(loc, itemsByLoc) {
  return {
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
      photos:          [],
      _photosHydrated: false,
    })),
  };
}

async function loadRemote() {
  const sb = await getSupabase();
  const [r1, r2, r3, r4] = await Promise.all([
    sb.from('chantiers').select('*'),
    sb.from('chantier_plans')
      .select('id,chantier_id,nom,bg,data,sort_order')
      .order('sort_order'),
    sb.from('chantier_localisations')
      .select('id,chantier_id,nom,plan_bg,plan_data,plan_annotations,sort_order,visite_id')
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

  return (r1.data ?? []).map(c => {
    const allLocs      = locsByChantier[c.id] ?? [];
    const storedVisites = c.visites ?? [];

    let visites;
    if (storedVisites.length === 0) {
      // Ancien projet sans visites → créer une visite synthétique
      const visitId = `v1_${c.id}`;
      visites = [{
        id:              visitId,
        label:           'Visite 1',
        dateVisite:      c.date_visite ?? null,
        participants:    c.participants ?? [],
        tableauRecap:    c.tableau_recap ?? [],
        photosParLigne:  c.photos_par_ligne ?? 2,
        plansEnFin:      false,
        rapportPageBreaks: [],
        localisations:   allLocs.map(loc => buildLocFromRow(loc, itemsByLoc)),
      }];
    } else {
      // Nouveau format : visites définies en DB
      visites = storedVisites.map(rv => ({
        ...rv,
        localisations: allLocs
          .filter(loc => loc.visite_id === rv.id)
          .map(loc => buildLocFromRow(loc, itemsByLoc)),
      }));
      // Localisations orphelines (visite_id null = legacy) → première visite
      const orphans = allLocs.filter(loc => !loc.visite_id);
      if (orphans.length > 0 && visites.length > 0) {
        visites[0] = {
          ...visites[0],
          localisations: [
            ...(visites[0].localisations || []),
            ...orphans.map(loc => buildLocFromRow(loc, itemsByLoc)),
          ],
        };
      }
    }

    return {
      id:            c.id,
      nom:           c.nom ?? '',
      statut:        c.statut ?? 'en_cours',
      adresse:       c.adresse ?? '',
      maitreOuvrage: c.maitre_ouvrage ?? '',
      photo:         c.photo ?? null,
      updatedAt:     c.updated_at,
      planLibrary:   (plansByChantier[c.id] ?? []).map(pl => ({
        id: pl.id, nom: pl.nom ?? '', bg: pl.bg ?? null, data: pl.data ?? null,
      })),
      visites,
    };
  });
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

async function processPhotosForItem(sb, item, itemId, fetchedPhotosByItem) {
  const hasLocalPhotos = (item.photos || []).some(ph => ph.data || ph.storage_url);
  const rawPhotos = (!item._photosHydrated && !hasLocalPhotos)
    ? (fetchedPhotosByItem[item.id] ?? [])
    : (item.photos || []);

  const result = [];
  for (let pi = 0; pi < rawPhotos.length; pi++) {
    const ph = rawPhotos[pi];
    let storageUrl = ph.storage_url ?? null;
    if (storageUrl) {
      // Already in Storage — reuse
    } else if (ph.data?.startsWith('data:')) {
      storageUrl = await uploadPhotoToStorage(sb, itemId, pi, ph.name, ph.data);
      if (!storageUrl) continue;
    } else if (ph.data?.startsWith('http')) {
      storageUrl = ph.data;
    } else {
      const legacyId = ph._id || ph.id;
      if (!legacyId) continue;
      const { data: legRow } = await sb.from('item_photos').select('data').eq('id', legacyId).maybeSingle();
      if (!legRow?.data) continue;
      storageUrl = await uploadPhotoToStorage(sb, itemId, pi, ph.name, legRow.data);
      if (!storageUrl) continue;
      await sb.from('item_photos').update({ storage_url: storageUrl, data: null }).eq('id', legacyId);
    }
    result.push({ item_id: itemId, name: ph.name ?? '', storage_url: storageUrl, data: null, sort_order: pi });
  }
  return result;
}

async function saveRemote(ps) {
  const sb = await getSupabase();
  const now = new Date().toISOString();
  const errors = [];

  const memIds = new Set(ps.map(p => p.id));
  if (_lastRemoteIds !== null) {
    const toDelete = [..._lastRemoteIds].filter(id => !memIds.has(id));
    if (toDelete.length > 0) {
      const { error } = await sb.from('chantiers').delete().in('id', toDelete);
      if (error) errors.push(error);
    }
  }
  _lastRemoteIds = new Set(ps.map(p => p.id));

  for (const p of ps) {
    // Métadonnées visites (sans localisations)
    const visitesMetadata = (p.visites || []).map(v => ({
      id:               v.id,
      label:            v.label ?? 'Visite 1',
      dateVisite:       v.dateVisite ?? null,
      participants:     v.participants ?? [],
      tableauRecap:     v.tableauRecap ?? [],
      photosParLigne:   v.photosParLigne ?? 2,
      plansEnFin:       v.plansEnFin ?? false,
      rapportPageBreaks: v.rapportPageBreaks ?? [],
    }));

    const firstVisit = p.visites?.[0];
    const { error: ce } = await sb.from('chantiers').upsert({
      id:              p.id,
      nom:             p.nom ?? '',
      statut:          p.statut ?? 'en_cours',
      adresse:         p.adresse ?? '',
      maitre_ouvrage:  p.maitreOuvrage ?? '',
      photo:           p.photo ?? null,
      // colonnes legacy (rétrocompatibilité) — prises de la première visite
      date_visite:     firstVisit?.dateVisite ?? null,
      photos_par_ligne: firstVisit?.photosParLigne ?? 2,
      participants:    firstVisit?.participants ?? [],
      tableau_recap:   firstVisit?.tableauRecap ?? [],
      visites:         visitesMetadata,
      updated_at:      now,
    }, { onConflict: 'id' });
    if (ce) { errors.push(ce); continue; }

    // Plans
    await sb.from('chantier_plans').delete().eq('chantier_id', p.id);
    const planRows = (p.planLibrary || []).map((pl, i) => ({
      id: pl.id || crypto.randomUUID(), chantier_id: p.id,
      nom: pl.nom ?? '', bg: pl.bg ?? null, data: pl.data ?? null, sort_order: i,
    }));
    if (planRows.length > 0) {
      const { error } = await sb.from('chantier_plans').insert(planRows);
      if (error) errors.push(error);
    }

    // Toutes les localisations de toutes les visites
    const allLocsFlat = (p.visites || []).flatMap(v =>
      (v.localisations || []).map(l => ({ ...l, _visiteId: v.id }))
    );

    // ── LOCALISATIONS : UPSERT + DELETE ciblé ──────────────────────────────────

    // Lire les IDs existants en DB (une requête)
    const { data: dbLocsData } = await sb.from('chantier_localisations')
      .select('id').eq('chantier_id', p.id);
    const dbLocIds   = new Set((dbLocsData || []).map(l => l.id));
    const currLocIds = new Set(allLocsFlat.map(l => l.id).filter(Boolean));

    // Garde de sécurité : refuser d'effacer si l'état local est vide alors que la DB ne l'est pas.
    // Évite la perte totale en cas de bug d'état ou race condition.
    if (allLocsFlat.length === 0 && dbLocIds.size > 0) {
      errors.push({ message: 'Sync interrompu : état local vide alors que la DB contient des données. Rechargez la page.', code: 'SAFETY_EMPTY' });
      continue;
    }

    // Supprimer uniquement les locs retirées explicitement par l'utilisateur
    const removedLocIds = [...dbLocIds].filter(id => !currLocIds.has(id));
    if (removedLocIds.length > 0) {
      await sb.from('localisation_items').delete().in('localisation_id', removedLocIds);
      await sb.from('chantier_localisations').delete().in('id', removedLocIds);
    }

    // UPSERT des locs courantes (insert si nouvelle, update si existante)
    const locRows = allLocsFlat.map((l, i) => ({
      id:               l.id || crypto.randomUUID(),
      chantier_id:      p.id,
      nom:              l.nom ?? '',
      plan_bg:          l.planBg ?? null,
      plan_data:        l.planData ?? null,
      plan_annotations: l.planAnnotations ? JSON.stringify(l.planAnnotations) : null,
      sort_order:       i,
      visite_id:        l._visiteId,
    }));
    if (locRows.length > 0) {
      const { error: le } = await sb.from('chantier_localisations')
        .upsert(locRows, { onConflict: 'id' });
      if (le) { errors.push(le); continue; }
    }

    // ── ITEMS : UPSERT + DELETE ciblé ─────────────────────────────────────────

    // Lire les items existants pour toutes les locs du projet (une seule requête)
    const locIdsToFetch = locRows.map(l => l.id).filter(Boolean);
    const { data: dbItemsData } = locIdsToFetch.length > 0
      ? await sb.from('localisation_items').select('id,localisation_id').in('localisation_id', locIdsToFetch)
      : { data: [] };
    const dbItemsByLoc = groupBy(dbItemsData || [], 'localisation_id');

    // Pré-fetch des photos pour items non-hydratés (utile pour les anciennes photos Storage)
    const unloadedItemIds = [];
    allLocsFlat.forEach(l => {
      (l.items || []).forEach(item => {
        const hasLocal = (item.photos || []).some(ph => ph.data || ph.storage_url);
        if (!item._photosHydrated && !hasLocal && item.id) unloadedItemIds.push(item.id);
      });
    });
    const fetchedPhotosByItem = {};
    if (unloadedItemIds.length > 0) {
      const { data: pData, error: pErr } = await sb.from('item_photos')
        .select('id,item_id,name,storage_url,sort_order').in('item_id', unloadedItemIds).order('sort_order');
      if (!pErr) Object.assign(fetchedPhotosByItem, groupBy(pData ?? [], 'item_id'));
    }

    // Construire les items à upsert + savoir lesquels ont des photos locales
    const allItems = [];
    const itemRecords = []; // { itemId, item } pour le traitement photos
    const itemsWithLocalPhotos = new Set();

    for (let li = 0; li < allLocsFlat.length; li++) {
      const l   = allLocsFlat[li];
      const locId = locRows[li]?.id;
      if (!locId) continue;

      const dbLocItemIds  = new Set((dbItemsByLoc[locId] || []).map(i => i.id));
      const currItemIds   = new Set((l.items || []).map(i => i.id).filter(Boolean));

      // Supprimer uniquement les items retirés par l'utilisateur
      const removedItemIds = [...dbLocItemIds].filter(id => !currItemIds.has(id));
      if (removedItemIds.length > 0) {
        await sb.from('item_photos').delete().in('item_id', removedItemIds);
        await sb.from('localisation_items').delete().in('id', removedItemIds);
      }

      for (let ii = 0; ii < (l.items || []).length; ii++) {
        const item   = l.items[ii];
        const itemId = item.id || crypto.randomUUID();
        allItems.push({
          id: itemId, localisation_id: locId,
          titre: item.titre ?? '', suivi: item.suivi ?? 'rien',
          urgence: item.urgence ?? 'basse', commentaire: item.commentaire ?? '',
          plan_annotations: item.planAnnotations ? JSON.stringify(item.planAnnotations) : null,
          sort_order: ii,
        });
        const hasLocal = (item.photos || []).some(ph => ph.data || ph.storage_url);
        if (item._photosHydrated || hasLocal) itemsWithLocalPhotos.add(itemId);
        itemRecords.push({ itemId, item });
      }
    }

    // UPSERT des items
    if (allItems.length > 0) {
      const { error } = await sb.from('localisation_items').upsert(allItems, { onConflict: 'id' });
      if (error) { errors.push(error); }
    }

    // ── PHOTOS : delete + re-insert uniquement pour items avec données locales ──

    // Supprimer les anciennes photos des items à resynchroniser
    if (itemsWithLocalPhotos.size > 0) {
      await sb.from('item_photos').delete().in('item_id', [...itemsWithLocalPhotos]);
    }

    // Re-insérer les photos pour ces items
    for (const { itemId, item } of itemRecords) {
      if (!itemsWithLocalPhotos.has(itemId)) continue; // garder les photos DB existantes
      const photos = await processPhotosForItem(sb, item, itemId, {});
      for (const photo of photos) {
        const { error } = await sb.from('item_photos').insert([photo]);
        if (error) errors.push(error);
      }
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
  const existing = document.getElementById(id);
  if (existing) existing.remove(); // refresh message si nouvelle erreur
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;background:#7f1d1d;color:#fff;padding:12px 18px;border-radius:10px;font-size:12px;font-family:inherit;box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:92vw;text-align:center;display:flex;flex-direction:column;gap:6px;align-items:center;';

  const code = firstError?.code ?? '';
  const msg  = firstError?.message ?? 'erreur inconnue';

  let hint = '';
  if (code === '42501' || msg.includes('row-level security') || msg.includes('violates row-level')) {
    hint = 'Vérifier les politiques RLS Supabase (table item_photos ou storage.objects).';
  } else if (code === '23503') {
    hint = 'Erreur de clé étrangère — rechargez la page.';
  } else if (msg.includes('timeout') || msg.includes('57014')) {
    hint = 'Timeout Supabase — connexion lente ou table trop volumineuse.';
  }

  const line1 = document.createElement('div');
  line1.style.cssText = 'font-weight:700;font-size:13px;';
  line1.textContent = `⚠ Sync échoué${code ? ` (${code})` : ''}`;

  const line2 = document.createElement('div');
  line2.style.cssText = 'opacity:0.8;font-size:11px;max-width:400px;';
  line2.textContent = msg.slice(0, 120);

  el.appendChild(line1);
  el.appendChild(line2);

  if (hint) {
    const line3 = document.createElement('div');
    line3.style.cssText = 'opacity:0.7;font-size:10px;font-style:italic;max-width:400px;';
    line3.textContent = hint;
    el.appendChild(line3);
  }

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px;margin-top:2px;';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×  Fermer';
  closeBtn.style.cssText = 'background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:11px;padding:4px 10px;border-radius:6px;cursor:pointer;';
  closeBtn.onclick = () => el.remove();

  const consoleBtn = document.createElement('button');
  consoleBtn.textContent = 'Détails console';
  consoleBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:11px;padding:4px 10px;border-radius:6px;cursor:pointer;';
  consoleBtn.onclick = () => { console.error('Sync error details:', firstError); el.remove(); };

  btns.appendChild(closeBtn);
  btns.appendChild(consoleBtn);
  el.appendChild(btns);
  document.body.appendChild(el);

  // Auto-dismiss après 15s
  setTimeout(() => { if (document.getElementById(id)) el.remove(); }, 15000);
}
