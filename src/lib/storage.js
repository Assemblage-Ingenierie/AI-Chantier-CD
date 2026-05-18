import { getSupabase } from '../supabase.js';
import { getCachedUrls, setCachedUrls } from './urlCache.js';

const SIGNED_URL_TTL = 604800; // 7 jours — synchro avec urlCache.js

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

// Supprime le PNG exporté des annotations (régénéré à la demande, peut faire ~15 MB)
function slimAnnot(ann) {
  if (!ann) return ann;
  // eslint-disable-next-line no-unused-vars
  const { exported, ...rest } = ann;
  return rest;
}

function slugify(nom) {
  return (nom || 'projet')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'projet';
}

// Extrait le chemin Storage depuis une URL Supabase (formats public, authenticated, sign)
// ou retourne la valeur telle quelle si c'est déjà un chemin relatif.
function extractPhotoPath(urlOrPath) {
  if (!urlOrPath || !urlOrPath.startsWith('http')) return urlOrPath;
  const match = urlOrPath.match(/\/object\/(?:public|authenticated|sign)\/photos\/([^?]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Version allégée pour le cache localStorage : sans les blobs volumineux ni flags runtime
function slimLoc(l) {
  return {
    ...l,
    planData: null, // PDF brut trop lourd — planBg (miniature PNG) conservé pour affichage immédiat
    planAnnotations: slimAnnot(l.planAnnotations) ?? null,
    // eslint-disable-next-line no-unused-vars
    items: (l.items || []).map(({ _photosHydrated, ...item }) => ({
      ...item,
      planAnnotations: slimAnnot(item.planAnnotations),
      // eslint-disable-next-line no-unused-vars
      photos: (item.photos || []).map(({ _id, _legacy, ...ph }) => ph),
    })),
  };
}

function toSlim(ps) {
  return ps.map(p => ({
    ...p,
    photo: p.photo ?? null, // garder la signed URL en cache — affichage immédiat, rafraîchie en arrière-plan
    planLibrary: (p.planLibrary || []).map(pl => ({ ...pl, data: null })), // garder bg (miniature PNG) pour affichage immédiat
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
    planBg:          null,
    planData:        null,
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
    // photo exclu du SELECT — peut être un gros base64 qui cause HTTP 500.
    // Récupéré depuis le cache local lors du merge, ou migré vers Storage à la prochaine save.
    sb.from('aichantier_chantiers').select('id,nom,statut,adresse,maitre_ouvrage,date_visite,photos_par_ligne,participants,tableau_recap,visites,updated_at'),
    // bg/data exclus — blobs volumineux (images de plans), chargés lazily à l'ouverture du projet
    sb.from('aichantier_chantier_plans')
      .select('id,chantier_id,nom,sort_order')
      .order('sort_order'),
    sb.from('aichantier_chantier_localisations')
      .select('id,chantier_id,nom,plan_annotations,sort_order,visite_id')
      .order('sort_order'),
    sb.from('aichantier_localisation_items')
      .select('id,localisation_id,titre,suivi,urgence,commentaire,plan_annotations,sort_order')
      .order('sort_order'),
  ]);

  if (r1.error) throw r1.error;
  if (r2.error) throw r2.error;
  if (r3.error) throw r3.error;
  if (r4.error) throw r4.error;

  const plansByChantier = groupBy(r2.data ?? [], 'chantier_id');
  const locsByChantier  = groupBy(r3.data ?? [], 'chantier_id');

  // Les items des projets archivés viennent du cache local — pas de la DB.
  // On les exclut de itemsByLoc pour ne pas les stocker en mémoire inutilement.
  const archivedChantierIds = new Set(
    (r1.data ?? []).filter(c => c.statut === 'archive').map(c => c.id)
  );
  const archivedLocIds = new Set(
    (r3.data ?? []).filter(l => archivedChantierIds.has(l.chantier_id)).map(l => l.id)
  );
  const itemsByLoc = groupBy(
    (r4.data ?? []).filter(item => !archivedLocIds.has(item.localisation_id)),
    'localisation_id'
  );

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
      photo:         null, // chargé depuis le cache local (non sélectionné pour éviter HTTP 500)
      updatedAt:     c.updated_at,
      planLibrary:   (plansByChantier[c.id] ?? []).map(pl => ({
        id: pl.id, nom: pl.nom ?? '', bg: null, data: null, // bg/data chargés lazily
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

    // Try full query with annotation columns; fall back if migration not applied yet (42703)
    let data, hasAnnotCols = true;
    const full = await sb.from('aichantier_item_photos')
      .select('id,item_id,name,storage_url,annotated_storage_url,annotations,sort_order')
      .in('item_id', itemIds).order('sort_order');
    const isColErr = (e) => e?.code === '42703' || e?.code === 'PGRST204' || e?.message?.includes('annotated_storage_url') || e?.message?.includes('schema cache');
    if (isColErr(full.error)) {
      hasAnnotCols = false;
      const basic = await sb.from('aichantier_item_photos')
        .select('id,item_id,name,storage_url,sort_order')
        .in('item_id', itemIds).order('sort_order');
      if (basic.error) { console.warn('loadProjectPhotos error:', basic.error); return null; }
      data = basic.data;
    } else if (full.error) {
      console.warn('loadProjectPhotos error:', full.error); return null;
    } else {
      data = full.data;
    }

    const rows = (data ?? []).map(ph => ({
      ...ph,
      _path:          ph.storage_url                            ? extractPhotoPath(ph.storage_url)          : null,
      _annotatedPath: hasAnnotCols && ph.annotated_storage_url  ? extractPhotoPath(ph.annotated_storage_url) : null,
    }));

    // Batch generate signed URLs pour photos ET composites annotés
    // Memoize via urlCache : on ne demande à Supabase que les paths sans entrée valide.
    const allPaths = [...new Set([
      ...rows.filter(r => r._path).map(r => r._path),
      ...rows.filter(r => r._annotatedPath).map(r => r._annotatedPath),
    ])];
    const signedMap = {};
    if (allPaths.length > 0) {
      const { cached, missing } = getCachedUrls(allPaths);
      Object.assign(signedMap, cached);
      if (missing.length > 0) {
        const { data: signed } = await sb.storage.from('photos').createSignedUrls(missing, SIGNED_URL_TTL);
        const fresh = {};
        for (const s of (signed ?? [])) {
          if (s.signedUrl) { signedMap[s.path] = s.signedUrl; fresh[s.path] = s.signedUrl; }
        }
        setCachedUrls(fresh, SIGNED_URL_TTL);
      }
    }

    const mapped = rows.map(ph => ({
      id:          ph.id,
      item_id:     ph.item_id,
      name:        ph.name,
      storage_url: ph.storage_url ?? null,
      data:        ph._path          ? (signedMap[ph._path]          ?? null) : null,
      annotated:   ph._annotatedPath ? (signedMap[ph._annotatedPath] ?? null) : null,
      annotations: hasAnnotCols ? (ph.annotations ?? null) : null,
      sort_order:  ph.sort_order,
      _legacy:     !ph.storage_url,
    }));
    return groupBy(mapped, 'item_id');
  } catch (e) { console.warn('loadProjectPhotos error:', e); return null; }
}

// Charge la photo de couverture pour une liste de projets — séparée du SELECT principal
// pour éviter le HTTP 500 causé par de gros base64.
export async function hydrateChantierPhotos(chantierIds) {
  if (!chantierIds.length) return {};
  try {
    const sb = await getSupabase();
    // Fetch all photo paths from DB in one query
    const { data, error: dbErr } = await sb.from('aichantier_chantiers').select('id,photo').in('id', chantierIds);
    if (dbErr) { console.warn('hydrateChantierPhotos DB error:', dbErr); return {}; }

    const paths = [];
    const pathToId = {};
    const result = {};
    for (const row of (data ?? [])) {
      if (!row.photo) continue;
      if (row.photo.startsWith('data:')) { result[row.id] = row.photo; continue; }
      const path = extractPhotoPath(row.photo) ?? row.photo;
      if (!pathToId[path]) paths.push(path);
      pathToId[path] = row.id;
    }
    if (!paths.length) return result;

    // Memoize : on évite de redemander une signed URL pour un cover déjà en cache.
    const { cached, missing } = getCachedUrls(paths);
    for (const [path, url] of Object.entries(cached)) {
      const id = pathToId[path];
      if (id) result[id] = url;
    }
    if (missing.length === 0) return result;

    const { data: signed, error: storErr } = await sb.storage.from('photos').createSignedUrls(missing, SIGNED_URL_TTL);
    if (storErr) { console.warn('hydrateChantierPhotos storage error:', storErr); return result; }
    const fresh = {};
    (signed ?? []).forEach((s, idx) => {
      const path = missing[idx];
      const id = pathToId[path];
      if (s.signedUrl && id) { result[id] = s.signedUrl; fresh[path] = s.signedUrl; }
    });
    setCachedUrls(fresh, SIGNED_URL_TTL);
    return result;
  } catch (e) { console.warn('hydrateChantierPhotos error:', e); return {}; }
}

export async function hydratePlanLibrary(projectId) {
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.from('aichantier_chantier_plans')
      .select('id,bg,data').eq('chantier_id', projectId);
    if (error) { console.warn('hydratePlanLibrary error:', error); return null; }
    const map = {};
    for (const row of (data ?? [])) {
      if (row.bg || row.data) map[row.id] = { bg: row.bg ?? null, data: row.data ?? null };
    }
    return map; // { planId: { bg, data } }
  } catch (e) { console.warn('hydratePlanLibrary error:', e); return null; }
}

// Charge bg + data d'un seul plan — fallback quand la miniature n'est pas encore hydratée
export async function fetchPlanData(planId) {
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.from('aichantier_chantier_plans')
      .select('id,bg,data').eq('id', planId).single();
    if (error || !data) return null;
    return { bg: data.bg ?? null, data: data.data ?? null };
  } catch (e) { console.warn('fetchPlanData error:', e); return null; }
}

// Charge plan_bg/plan_data pour un projet donné — appelé paresseusement à l'ouverture du projet
// pour éviter que loadRemote() ne transmette de gros blobs pour tous les projets d'un coup.
export async function hydratePlans(projectId) {
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.from('aichantier_chantier_localisations')
      .select('id,plan_bg').eq('chantier_id', projectId);
    if (error) { console.warn('hydratePlans error:', error); return null; }
    const map = {};
    for (const row of (data ?? [])) {
      if (row.plan_bg) map[row.id] = { planBg: row.plan_bg ?? null, planData: null };
    }
    return map; // { locId: { planBg, planData } }
  } catch (e) { console.warn('hydratePlans error:', e); return null; }
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
      const { data: row, error } = await sb.from('aichantier_item_photos')
        .select('id,item_id,name,data').eq('id', id).maybeSingle();
      if (error || !row?.data) continue;
      // Upload to Storage
      const resp = await fetch(row.data);
      const blob = await resp.blob();
      const ext = (row.name || 'photo').replace(/.*\./, '') || 'jpg';
      const path = `${row.item_id}/${id}.${ext}`;
      const { error: upErr } = await sb.storage.from('photos').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true, cacheControl: '31536000' });
      if (upErr) { console.warn('Storage upload error:', upErr); continue; }
      // Store path (not public URL) + retourner signed URL pour affichage immédiat
      await sb.from('aichantier_item_photos').update({ storage_url: path, data: null }).eq('id', id);
      const { data: signed } = await sb.storage.from('photos').createSignedUrl(path, SIGNED_URL_TTL);
      if (signed?.signedUrl) {
        result[id] = signed.signedUrl;
        setCachedUrls({ [path]: signed.signedUrl }, SIGNED_URL_TTL);
      } else {
        result[id] = null;
      }
    } catch (e) { console.warn('migratePhotosToStorage error for', id, e); }
  }
  return result;
}

// --- Écriture dans les tables normalisées ---

// Convertit un base64 data URL en blob et l'upload dans le bucket Storage `photos`.
// Retourne le chemin relatif ou null en cas d'erreur.
async function uploadPhotoToStorage(sb, projectSlug, itemId, photoIndex, name, base64) {
  try {
    const resp = await fetch(base64);
    const blob = await resp.blob();
    const rawExt = (name || 'photo').replace(/.*\./, '') || 'webp';
    const ext = rawExt === 'webp' ? 'webp' : rawExt === 'jpg' || rawExt === 'jpeg' ? 'jpg' : rawExt;
    const contentType = blob.type || (ext === 'webp' ? 'image/webp' : 'image/jpeg');
    const path = `${projectSlug}/${itemId}/${Date.now()}_${photoIndex}.${ext}`;
    const { error } = await sb.storage.from('photos').upload(path, blob, { contentType, upsert: true, cacheControl: '31536000' });
    if (error) { console.warn('Storage upload error:', error); return null; }
    return path;
  } catch (e) { console.warn('Storage upload error:', e); return null; }
}

async function processPhotosForItem(sb, item, itemId, fetchedPhotosByItem, projectSlug) {
  const hasLocalPhotos = (item.photos || []).some(ph => ph.data || ph.storage_url);
  const rawPhotos = (!item._photosHydrated && !hasLocalPhotos)
    ? (fetchedPhotosByItem[item.id] ?? [])
    : (item.photos || []);

  const result = [];
  for (let pi = 0; pi < rawPhotos.length; pi++) {
    const ph = rawPhotos[pi];
    let storageUrl = ph.storage_url
      ? (extractPhotoPath(ph.storage_url) ?? ph.storage_url)
      : null;
    if (storageUrl) {
      // path normalisé — réutiliser
    } else if (ph.data?.startsWith('data:')) {
      storageUrl = await uploadPhotoToStorage(sb, projectSlug, itemId, pi, ph.name, ph.data);
      if (!storageUrl) continue;
    } else if (ph.data?.startsWith('http')) {
      storageUrl = extractPhotoPath(ph.data) ?? ph.data;
    } else {
      const legacyId = ph._id || ph.id;
      if (!legacyId) continue;
      const { data: legRow } = await sb.from('aichantier_item_photos').select('data').eq('id', legacyId).maybeSingle();
      if (!legRow?.data) continue;
      storageUrl = await uploadPhotoToStorage(sb, projectSlug, itemId, pi, ph.name, legRow.data);
      if (!storageUrl) continue;
      await sb.from('aichantier_item_photos').update({ storage_url: storageUrl, data: null }).eq('id', legacyId);
    }
    // Sauvegarder le composite annoté dans Storage si présent
    let annotatedUrl = ph.annotated_storage_url
      ? (extractPhotoPath(ph.annotated_storage_url) ?? ph.annotated_storage_url)
      : null;
    if (!annotatedUrl && ph.annotated?.startsWith('data:')) {
      annotatedUrl = await uploadPhotoToStorage(sb, projectSlug, itemId, `${pi}_annot`, ph.name, ph.annotated);
    } else if (!annotatedUrl && ph.annotated?.startsWith('http')) {
      annotatedUrl = extractPhotoPath(ph.annotated) ?? null;
    }

    const photoRow = {
      id: ph._id ?? ph.id ?? crypto.randomUUID(), // ID stable → upsert sûr, jamais de perte
      item_id: itemId,
      name: ph.name ?? '',
      storage_url: storageUrl,
      data: null,
      sort_order: pi,
    };
    // Only include annotation columns if they exist in DB (migration may not be applied yet)
    if (ph.annotations?.length || annotatedUrl) {
      photoRow.annotations = ph.annotations?.length ? ph.annotations : null;
      photoRow.annotated_storage_url = annotatedUrl ?? null;
    }
    result.push(photoRow);
  }
  return result;
}

async function saveRemote(ps, dirtyIds = null) {
  const sb = await getSupabase();
  const now = new Date().toISOString();
  const { data: { user } } = await sb.auth.getUser();
  const uid = user?.id ?? null;
  const errors = [];

  // Détecter les projets orphelins (sans id) — corruption cache locale.
  // On les ignore proprement plutôt que de planter avec 23502 ou de déclencher
  // un faux toDelete sur les vrais projets remote correspondants.
  const orphans = ps.filter(p => !p.id);
  if (orphans.length > 0) {
    console.warn('saveRemote: ignoring', orphans.length, 'orphan projet(s) without id:', orphans.map(p => ({ nom: p.nom, visites: p.visites?.length })));
  }

  const memIds = new Set(ps.map(p => p.id).filter(Boolean));
  // Skip TOTAL du delete step si des orphelins existent : impossible de savoir
  // si l'orphelin correspond à un projet remote dont l'id a été perdu localement.
  // Mieux vaut ne rien supprimer que risquer une suppression incorrecte.
  if (_lastRemoteIds !== null && orphans.length === 0) {
    const toDelete = [..._lastRemoteIds].filter(id => !memIds.has(id));
    // Garde anti-catastrophe : refuser un mass-delete (>50% du remote connu).
    // Évite que des incohérences cache local / DB ne déclenchent une suppression
    // massive accidentelle (cf. incident 2026-05-13).
    const safeCap = Math.max(1, Math.floor(_lastRemoteIds.size * 0.5));
    if (toDelete.length > safeCap) {
      console.error('saveRemote: refusing mass-delete of', toDelete.length, 'projets (cap=', safeCap, ') — local state likely stale');
      errors.push({ message: `Sync interrompu : suppression suspecte de ${toDelete.length} projet(s). Rechargez la page.`, code: 'SAFETY_MASS_DELETE' });
      return errors;
    }
    if (toDelete.length > 0) {
      const { error } = await sb.from('aichantier_chantiers').delete().in('id', toDelete);
      if (error) errors.push(error);
    }
  }
  _lastRemoteIds = new Set(ps.map(p => p.id).filter(Boolean));

  // Sauvegarder uniquement les projets modifiés (évite timeout sur gros volumes)
  // Filtre aussi les orphelins (id null/undefined) → évite 23502 sur upsert.
  const toSave = (dirtyIds && dirtyIds.size > 0 ? ps.filter(p => dirtyIds.has(p.id)) : ps)
    .filter(p => p.id);

  for (const p of toSave) {
    const visitesMetadata = (p.visites || []).map(v => ({
      id: v.id, label: v.label ?? 'Visite 1', dateVisite: v.dateVisite ?? null,
      participants: v.participants ?? [], tableauRecap: v.tableauRecap ?? [],
      photosParLigne: v.photosParLigne ?? 2, plansEnFin: v.plansEnFin ?? false,
      rapportPageBreaks: v.rapportPageBreaks ?? [],
    }));

    const firstVisit = p.visites?.[0];
    const allLocsFlat = (p.visites || []).flatMap(v =>
      (v.localisations || []).map(l => ({ ...l, _visiteId: v.id }))
    );

    const slug = `${slugify(p.nom)}_${String(p.id).slice(0, 8)}`;
    const newCoverPath = `${slug}/cover/${p.id}.webp`;

    // Migrer la photo couverture si c'est encore un base64 → Storage
    let coverPhotoUrl = p.photo ?? null;
    if (coverPhotoUrl?.startsWith('data:')) {
      const uploaded = await uploadPhotoToStorage(sb, slug, `cover/${p.id}`, 0, 'cover.webp', coverPhotoUrl);
      if (uploaded) coverPhotoUrl = uploaded;
    }

    // Toujours normaliser vers un chemin relatif (pas une signed URL) avant de sauvegarder en DB
    if (coverPhotoUrl && !coverPhotoUrl.startsWith('data:')) {
      const relPath = extractPhotoPath(coverPhotoUrl);
      if (relPath) coverPhotoUrl = relPath;
    }

    // Migrer ancien dossier cover_{id}/ → {slug}/cover/{id}.jpg via storage.move()
    if (coverPhotoUrl && !coverPhotoUrl.startsWith('data:')) {
      const oldPath = coverPhotoUrl;
      if (oldPath && /^cover_[^/]+\//.test(oldPath) && oldPath !== newCoverPath) {
        const { error: mvErr } = await sb.storage.from('photos').move(oldPath, newCoverPath);
        if (!mvErr) {
          await sb.from('aichantier_chantiers').update({ photo: newCoverPath }).eq('id', p.id);
          coverPhotoUrl = newCoverPath;
        }
      }
    }

    // ── Parallèle : lecture état DB actuel (avant upsert pour éviter d'écraser des visites créées ailleurs) ──
    const [dbLocsRes, dbChantierRes] = await Promise.all([
      sb.from('aichantier_chantier_localisations').select('id,visite_id').eq('chantier_id', p.id),
      sb.from('aichantier_chantiers').select('visites').eq('id', p.id).maybeSingle(),
    ]);

    // Fusionner les visites locales avec celles en DB non connues localement (créées sur un autre appareil).
    const localVisitIds = new Set(visitesMetadata.map(v => v.id));
    const unknownDbVisits = (dbChantierRes.data?.visites || []).filter(v => !localVisitIds.has(v.id));
    const mergedVisitesMetadata = [...visitesMetadata, ...unknownDbVisits];

    // ── Upsert chantier avec visites fusionnées ────────────────────────────────
    const chantierRes = await sb.from('aichantier_chantiers').upsert({
      id: p.id, nom: p.nom ?? '', statut: p.statut ?? 'en_cours',
      adresse: p.adresse ?? '', maitre_ouvrage: p.maitreOuvrage ?? '',
      photo: coverPhotoUrl, date_visite: firstVisit?.dateVisite ?? null,
      photos_par_ligne: firstVisit?.photosParLigne ?? 2,
      participants: firstVisit?.participants ?? [], tableau_recap: firstVisit?.tableauRecap ?? [],
      visites: mergedVisitesMetadata, updated_at: now,
    }, { onConflict: 'id' });
    if (chantierRes.error) { errors.push(chantierRes.error); continue; }

    const dbLocIds  = new Set((dbLocsRes.data || []).map(l => l.id));
    const currLocIds = new Set(allLocsFlat.map(l => l.id).filter(Boolean));

    // Garde de sécurité : jamais effacer si l'état local est vide
    if (allLocsFlat.length === 0 && dbLocIds.size > 0) {
      errors.push({ message: 'Sync interrompu : état local vide alors que la DB contient des données. Rechargez la page.', code: 'SAFETY_EMPTY' });
      continue;
    }

    // Loc rows — plan_bg/plan_data envoyés seulement pour nouvelles zones ou si _planDirty.
    // Évite de retransmettre des MB d'images à chaque save sur des zones existantes (timeout 57014).
    const locRows = allLocsFlat.map((l, i) => {
      const row = {
        id: l.id || crypto.randomUUID(), chantier_id: p.id, nom: l.nom ?? '',
        // Ne jamais persister .exported (image WebP ~400 Ko) — seuls les paths sont nécessaires en DB.
        plan_annotations: l.planAnnotations?.paths?.length
          ? JSON.stringify({ paths: l.planAnnotations.paths })
          : null,
        sort_order: i, visite_id: l._visiteId,
      };
      const isNew = !dbLocIds.has(l.id);
      // plan_data (PDF brut) n'est jamais envoyé dans les localisations — il est dans aichantier_chantier_plans.
      // Seul plan_bg (miniature PNG) est transmis pour éviter les timeouts 57014.
      if ((isNew || l._planDirty) && l.planBg != null) {
        row.plan_bg = l.planBg;
      }
      return row;
    });

    // Supprimer uniquement les locs des visites connues localement — jamais celles d'une visite
    // créée sur un autre appareil (unknownDbVisits) pour éviter la perte de données cross-device.
    const removedLocIds = (dbLocsRes.data || [])
      .filter(l => !currLocIds.has(l.id) && localVisitIds.has(l.visite_id))
      .map(l => l.id);
    const locIdsToFetch  = locRows.map(l => l.id).filter(Boolean);

    // ── Parallèle : suppr locs retirées + lecture items existants ────────────
    const [, dbItemsRes] = await Promise.all([
      removedLocIds.length > 0
        ? (async () => {
            await sb.from('aichantier_localisation_items').delete().in('localisation_id', removedLocIds);
            await sb.from('aichantier_chantier_localisations').delete().in('id', removedLocIds);
          })()
        : Promise.resolve(),
      locIdsToFetch.length > 0
        ? sb.from('aichantier_localisation_items').select('id,localisation_id').in('localisation_id', locIdsToFetch)
        : Promise.resolve({ data: [] }),
    ]);

    // UPSERT locs en deux passes séparées pour éviter que PostgREST normalise le batch
    // et écrase plan_bg/plan_data avec null pour les lignes qui ne les envoient pas.
    const locRowsWithPlan    = locRows.filter(r => 'plan_bg' in r);
    const locRowsWithoutPlan = locRows.filter(r => !('plan_bg' in r));
    const upsertResults = await Promise.all([
      locRowsWithPlan.length    ? sb.from('aichantier_chantier_localisations').upsert(locRowsWithPlan,    { onConflict: 'id' }) : Promise.resolve({}),
      locRowsWithoutPlan.length ? sb.from('aichantier_chantier_localisations').upsert(locRowsWithoutPlan, { onConflict: 'id' }) : Promise.resolve({}),
    ]);
    const locErr = upsertResults.find(r => r.error)?.error;
    if (locErr) { errors.push(locErr); continue; }

    // Plans (fire-and-forget) — UPSERT + DELETE ciblé (évite perte si insert échoue)
    const plansPromise = (async () => {
      const dbPlansRes = await sb.from('aichantier_chantier_plans').select('id').eq('chantier_id', p.id);
      const dbPlanIds  = new Set((dbPlansRes.data || []).map(pl => pl.id));
      // Plans existants sans bg (timeout lors du premier save) — à réparer si bg dispo en mémoire
      const dbPlansNoBgRes = await sb.from('aichantier_chantier_plans').select('id').eq('chantier_id', p.id).is('bg', null);
      const dbPlansNoBg = new Set((dbPlansNoBgRes.data || []).map(pl => pl.id));
      const currPlanIds = new Set((p.planLibrary || []).map(pl => pl.id).filter(Boolean));
      const removedPlanIds = [...dbPlanIds].filter(id => !currPlanIds.has(id));
      const planRows = (p.planLibrary || []).map((pl, i) => {
        const id = pl.id || crypto.randomUUID();
        const row = { id, chantier_id: p.id, nom: pl.nom ?? '', sort_order: i };
        // Send bg for new plans or plans missing bg in DB (repair after timeout) — never resend if already stored
        const isNew = !dbPlanIds.has(id);
        const missingBg = dbPlansNoBg.has(id);
        if (pl.bg != null && (isNew || missingBg)) row.bg = pl.bg;
        return row;
      });
      // Safety guard: if local plan list is empty but DB has plans, skip deletion.
      // Local can be empty because plans weren't hydrated yet (bg/data loaded lazily).
      if (planRows.length === 0 && dbPlanIds.size > 0) return;
      await Promise.all([
        removedPlanIds.length ? sb.from('aichantier_chantier_plans').delete().in('id', removedPlanIds) : Promise.resolve(),
        planRows.length       ? sb.from('aichantier_chantier_plans').upsert(planRows, { onConflict: 'id' }).then(r => { if (r.error) errors.push(r.error); }) : Promise.resolve(),
      ]);
    })();

    const dbItemsByLoc = groupBy(dbItemsRes?.data || [], 'localisation_id');

    // Construire items + collecter tous les IDs supprimés en une passe
    const allItems = [];
    const itemRecords = [];
    const itemsWithLocalPhotos = new Set();
    const allRemovedItemIds = [];
    const unloadedItemIds = [];

    for (let li = 0; li < allLocsFlat.length; li++) {
      const l = allLocsFlat[li];
      const locId = locRows[li]?.id;
      if (!locId) continue;

      const dbLocItemIds = new Set((dbItemsByLoc[locId] || []).map(i => i.id));
      const currItemIds  = new Set((l.items || []).map(i => i.id).filter(Boolean));
      const removedItemIds = [...dbLocItemIds].filter(id => !currItemIds.has(id));
      allRemovedItemIds.push(...removedItemIds);

      for (let ii = 0; ii < (l.items || []).length; ii++) {
        const item = l.items[ii];
        const itemId = item.id || crypto.randomUUID();
        allItems.push({
          id: itemId, localisation_id: locId,
          titre: item.titre ?? '', suivi: item.suivi ?? 'rien',
          urgence: item.urgence ?? 'basse', commentaire: item.commentaire ?? '',
          plan_annotations: item.planAnnotations ? JSON.stringify(slimAnnot(item.planAnnotations)) : null,
          sort_order: ii,
        });
        const hasLocal = (item.photos || []).some(ph => ph.data || ph.storage_url);
        if (item._photosHydrated || hasLocal) itemsWithLocalPhotos.add(itemId);
        else if (item.id) unloadedItemIds.push(item.id);
        itemRecords.push({ itemId, item });
      }
    }

    // ── Parallèle : suppr items retirés (batch) + upsert items + prefetch photos
    const deleteRemovedItemsPromise = allRemovedItemIds.length > 0
      ? (async () => {
          await sb.from('aichantier_item_photos').delete().in('item_id', allRemovedItemIds);
          await sb.from('aichantier_localisation_items').delete().in('id', allRemovedItemIds);
        })()
      : Promise.resolve();

    const [, upsertItemsRes, photosRes] = await Promise.all([
      deleteRemovedItemsPromise,
      allItems.length > 0
        ? sb.from('aichantier_localisation_items').upsert(allItems, { onConflict: 'id' })
        : Promise.resolve({ error: null }),
      unloadedItemIds.length > 0
        ? sb.from('aichantier_item_photos').select('id,item_id,name,storage_url,sort_order')
            .in('item_id', unloadedItemIds).order('sort_order')
        : Promise.resolve({ data: [] }),
    ]);
    if (upsertItemsRes?.error) errors.push(upsertItemsRes.error);

    const fetchedPhotosByItem = groupBy(photosRes?.data || [], 'item_id');

    // Photos : UPSERT par ID stable puis delete-orphans (jamais de perte si l'upsert échoue)
    const allPhotoRows = [];
    for (const { itemId, item } of itemRecords) {
      if (!itemsWithLocalPhotos.has(itemId)) continue;
      const photos = await processPhotosForItem(sb, item, itemId, fetchedPhotosByItem, slug);
      allPhotoRows.push(...photos);
    }
    const isAnnotColErr = (e) => e?.code === '42703' || e?.code === 'PGRST204' || e?.message?.includes('annotated_storage_url') || e?.message?.includes('schema cache');
    let photoUpsertOk = false;
    if (allPhotoRows.length > 0) {
      const { error } = await sb.from('aichantier_item_photos').upsert(allPhotoRows, { onConflict: 'id' });
      if (isAnnotColErr(error)) {
        const stripped = allPhotoRows.map(({ annotations, annotated_storage_url, ...row }) => row); // eslint-disable-line no-unused-vars
        const { error: e2 } = await sb.from('aichantier_item_photos').upsert(stripped, { onConflict: 'id' });
        if (e2) errors.push(e2); else photoUpsertOk = true;
      } else if (error) { errors.push(error); }
      else { photoUpsertOk = true; }
    } else { photoUpsertOk = true; }

    // Delete orphans uniquement si l'upsert a réussi — jamais avant (évite la perte si insert échoue)
    if (photoUpsertOk) {
      const keptIdsByItem = new Map();
      for (const row of allPhotoRows) {
        if (!keptIdsByItem.has(row.item_id)) keptIdsByItem.set(row.item_id, []);
        keptIdsByItem.get(row.item_id).push(row.id);
      }
      await Promise.all([...itemsWithLocalPhotos].map(itemId => {
        const keptIds = keptIdsByItem.get(itemId) ?? [];
        if (keptIds.length === 0) {
          return sb.from('aichantier_item_photos').delete().eq('item_id', itemId);
        }
        return sb.from('aichantier_item_photos').delete().eq('item_id', itemId).not('id', 'in', `(${keptIds.join(',')})`);
      }));
    }

    await plansPromise;
  }

  if (errors.length > 0) {
    console.warn('saveRemote errors:', errors.map(e => ({ msg: e.message, code: e.code, details: e.details, hint: e.hint })));
  }
  return errors;
}

// --- API publique (inchangée) ---

// Persistance des IDs remote connus à travers les sessions navigateur.
// Permet à mergeWithLocal() de distinguer :
//   - localOnly + dans persistedIds → projet supprimé ailleurs → drop local
//   - localOnly + jamais dans persistedIds → vraiment unsynced → push back
// Sans ça, un appareil offline ré-pousse les projets supprimés ailleurs.
const PERSISTED_REMOTE_IDS_KEY = '_chantierai_remote_ids_v1';

export function getPersistedRemoteIds() {
  try {
    const raw = localStorage.getItem(PERSISTED_REMOTE_IDS_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : null;
  } catch { return null; }
}

function writePersistedRemoteIds(ids) {
  try {
    localStorage.setItem(PERSISTED_REMOTE_IDS_KEY, JSON.stringify([...ids]));
  } catch {}
}

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
    // Persister AUSSI ces IDs pour que la prochaine session sache ce qui était sur remote.
    // Critique pour le scénario multi-device : un projet supprimé sur PC ne doit pas
    // être ré-uploadé par le tel qui chargerait son cache stale.
    writePersistedRemoteIds(_lastRemoteIds);
    // NE PAS mettre à jour le cache local ici : seul saveData() écrit dans
    // localStorage. Cela évite que loadData() n'écrase des modifications
    // locales non encore synchronisées (race condition beforeunload vs microtask).
    return ps;
  } catch (e) {
    console.warn('Supabase load error:', e);
    // Fallback sur le cache local (version allégée, sans blobs)
    try {
      const raw = await stor.get(SK);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached.length) return cached; // Cache disponible — pas d'erreur affichée
      }
    } catch {}
    // Ni Supabase ni cache — on propage l'erreur pour que l'UI puisse réagir
    throw e;
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

export async function saveData(ps, onStatus, dirtyIds = null) {
  try {
    // Sauvegarder localement en premier (résilience hors-ligne)
    await stor.set(SK, JSON.stringify(toSlim(ps)));
    const errors = await saveRemote(ps, dirtyIds);
    const ok = errors.length === 0;
    onStatus?.(ok ? 'ok' : 'error');
    if (!ok) showSyncWarning(errors[0]);
    return ok;
  } catch (e) {
    console.warn('Save error:', e);
    onStatus?.('error');
    return false;
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
    hint = 'Vérifier les politiques RLS Supabase (table aichantier_item_photos ou storage.objects).';
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

// Supprime les doublons de photos (même item_id + storage_url) — garde le plus ancien.
// Retourne le nombre de doublons supprimés.
export async function cleanupDuplicatePhotos() {
  const sb = await getSupabase();
  let deleted = 0;
  try {
    // Charger tous les ids + clés de déduplication
    const { data: rows, error } = await sb.from('aichantier_item_photos')
      .select('id,item_id,storage_url,sort_order').order('sort_order');
    if (error) throw error;
    const seen = new Map(); // "item_id|storage_url" → premier id vu
    const toDelete = [];
    for (const row of (rows ?? [])) {
      if (!row.storage_url) continue;
      const key = `${row.item_id}|${row.storage_url}`;
      if (seen.has(key)) { toDelete.push(row.id); }
      else { seen.set(key, row.id); }
    }
    if (toDelete.length > 0) {
      // Supprimer par batch de 100
      for (let i = 0; i < toDelete.length; i += 100) {
        const batch = toDelete.slice(i, i + 100);
        await sb.from('aichantier_item_photos').delete().in('id', batch);
        deleted += batch.length;
      }
    }
  } catch (e) { console.warn('cleanupDuplicatePhotos error:', e); }
  return deleted;
}

// Récupère les photos perdues : liste les fichiers existants dans Storage et recrée
// les enregistrements DB manquants. Retourne { recovered, errors }.
export async function recoverPhotosFromStorage() {
  const sb = await getSupabase();
  let recovered = 0;
  const errs = [];
  try {
    const { data: chantiers, error: cErr } = await sb.from('aichantier_chantiers').select('id,nom');
    if (cErr) throw cErr;
    const { data: allItems } = await sb.from('aichantier_localisation_items').select('id');
    const validItemIds = new Set((allItems ?? []).map(i => i.id));
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const chantier of (chantiers ?? [])) {
      const slug = `${slugify(chantier.nom)}_${String(chantier.id).slice(0, 8)}`;
      const { data: topLevel, error: listErr } = await sb.storage.from('photos').list(slug);
      if (listErr) { errs.push(`list ${slug}: ${listErr.message}`); continue; }

      for (const entry of (topLevel ?? [])) {
        const isFolder = !entry.metadata;
        if (!isFolder) continue;
        if (entry.name === 'cover') continue;
        const itemId = entry.name;
        if (!UUID_RE.test(itemId)) continue;
        if (!validItemIds.has(itemId)) continue;

        const { data: files, error: fErr } = await sb.storage.from('photos').list(`${slug}/${itemId}`);
        if (fErr) { errs.push(`list ${slug}/${itemId}: ${fErr.message}`); continue; }

        // Vérification par item pour éviter la limite PostgREST 1000 lignes du set global
        const { data: itemPhotos } = await sb.from('aichantier_item_photos')
          .select('storage_url').eq('item_id', itemId);
        const itemPaths = new Set((itemPhotos ?? []).map(p => p.storage_url));
        let si = itemPhotos?.length ?? 0;

        for (const file of (files ?? [])) {
          if (!file.name || !file.metadata) continue;
          if (file.name.includes('_annot')) continue;
          const storagePath = `${slug}/${itemId}/${file.name}`;
          if (itemPaths.has(storagePath)) { si++; continue; }
          const { error: iErr } = await sb.from('aichantier_item_photos').insert({
            item_id: itemId, name: file.name, storage_url: storagePath, sort_order: si++,
          });
          if (iErr) errs.push(`${storagePath}: ${iErr.message}`);
          else { recovered++; itemPaths.add(storagePath); }
        }
      }
    }
  } catch (e) { errs.push(e.message); }
  return { recovered, errors: errs };
}
