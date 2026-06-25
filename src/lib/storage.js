import { getSupabase } from '../supabase.js';
import { getCachedUrls, setCachedUrls } from './urlCache.js';
import { clearSnapshots } from './backupVault.js';
import { getQueuedUploadPath, removeQueuedUpload } from './photoUploadQueue.js';

// 30 jours (au lieu de 7) : à chaque expiration, l'URL signée change → le cache HTTP du
// navigateur est invalidé et TOUTES les photos sont re-téléchargées depuis Supabase.
// Allonger le TTL divise d'autant l'egress photos récurrent par appareil.
const SIGNED_URL_TTL = 2592000;

// v12 = format normalisé (tables séparées, sans placeholders __img__/__pdf__)
const SK = 'chantierai_v12';
const _mem = {};

// IDs connus depuis le dernier loadData() — seuls ces IDs peuvent être supprimés de Supabase.
// Null = loadData() pas encore terminé → on ne supprime rien (évite de détruire
// des projets ajoutés depuis un autre appareil non encore chargés localement).
let _lastRemoteIds = null;

// Maps remplies au chargement (loadRemote) et mises à jour après chaque save réussi.
// Permettent de distinguer "supprimé par cet utilisateur" (connu au chargement, plus en local)
// de "ajouté par un autre utilisateur après notre chargement" (jamais connu → ne pas supprimer).
// Si null/absent pour un projet (ex : offline au chargement), fallback vers l'ancien comportement.
let _knownVisitIdsByProject = new Map(); // projectId → Set<visitId>
let _knownLocIdsByProject   = new Map(); // projectId → Set<locId>
let _knownItemIdsByProject  = new Map(); // projectId → Set<itemId>
// itemId → Set<photoId> connus au CHARGEMENT. Sert à la purge des photos orphelines :
// on ne supprime QUE les photos connues au chargement et que l'utilisateur a depuis retirées.
// Une photo absente de cet ensemble (ajoutée en parallèle par un AUTRE appareil) n'est jamais
// supprimée → corrige la perte de lignes photos en édition concurrente PC + téléphone.
let _knownPhotoIdsByItem    = new Map();

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
    // extraPlans : planBg/planData non stockés (trop lourd) — reconstruits depuis planLibrary au chargement
    extraPlans: (l.extraPlans || []).map(ep => ({ id: ep.id, planId: ep.planId || null, planAnnotations: slimAnnot(ep.planAnnotations) ?? null, reportHidden: ep.reportHidden ?? false })),
    // eslint-disable-next-line no-unused-vars
    items: (l.items || []).map(({ _photosHydrated, ...item }) => ({
      ...item,
      planAnnotations: slimAnnot(item.planAnnotations),
      // eslint-disable-next-line no-unused-vars
      // _id (id de ligne DB) CONSERVÉ dans le cache : c'est lui qui rend l'upsert photo stable
      // à travers les rechargements de page. Sans lui, une sauvegarde avant ré-hydratation
      // attribuait un id aléatoire → ligne dupliquée en DB (visible depuis que la purge des
      // orphelins est conservatrice). ~36 octets par photo, négligeable.
      photos: (item.photos || []).map(({ _legacy, ...ph }) => ph),
    })),
  };
}

function toSlim(ps) {
  return ps.map(p => ({
    ...p,
    photo: p.photo ?? null, // garder la signed URL en cache — affichage immédiat, rafraîchie en arrière-plan
    planLibrary: (p.planLibrary || []).map(pl => ({ ...pl, data: null, hd: null })), // garder bg (miniature) pour affichage immédiat — data (PDF brut) et hd (image HD) trop lourds pour le cache
    visites: (p.visites || []).map(v => ({
      ...v,
      localisations: (v.localisations || []).map(slimLoc),
    })),
  }));
}

// --- Lecture depuis les tables normalisées ---

function buildLocFromRow(loc, itemsByLoc) {
  // planId et extraPlans sont encodés dans plan_annotations (évite des colonnes dédiées)
  const parsedAnnot = tryParseJson(loc.plan_annotations);
  const planId = parsedAnnot?._planId ?? null;
  const planReportHidden = parsedAnnot?._planReportHidden ?? false;
  const extraPlans = (parsedAnnot?._extraPlans || []).map(ep => ({
    id: crypto.randomUUID(),
    planId: ep.planId || null,
    planBg: null,
    planData: null,
    planAnnotations: ep.paths?.length ? { paths: ep.paths } : null,
    reportHidden: ep.reportHidden ?? false,
  }));
  const planAnnotations = parsedAnnot
    ? (({ _planId, _extraPlans, _planReportHidden, ...rest }) => Object.keys(rest).length ? rest : null)(parsedAnnot)
    : null;
  return {
    id:              loc.id,
    nom:             loc.nom ?? '',
    planId,
    planBg:          null,
    planData:        null,
    planAnnotations,
    planReportHidden,
    extraPlans,
    items: (itemsByLoc[loc.id] ?? []).map(item => {
      const parsedAnnot = tryParseJson(item.plan_annotations);
      // Plans de bibliothèque attachés à l'item — encodés dans _plans pour éviter une colonne dédiée
      const plans = (parsedAnnot?._plans || []).map(pl => ({
        id: pl.id || crypto.randomUUID(),
        planId: pl.planId,
        planBg: null,  // hydraté depuis planLibrary à l'affichage
        planAnnotations: pl.paths?.length ? { paths: pl.paths } : null,
      }));
      const planAnnotations = parsedAnnot?._plans
        ? (({ _plans, ...rest }) => Object.keys(rest).length ? rest : null)(parsedAnnot)
        : parsedAnnot;
      return {
        id:              item.id,
        titre:           item.titre ?? '',
        suivi:           item.suivi ?? 'rien',
        urgence:         item.urgence ?? 'basse',
        commentaire:     item.commentaire ?? '',
        commentaireAlign: item.commentaire_align ?? 'left',
        planAnnotations,
        plans,
        photos:          [],
        _photosHydrated: false,
      };
    }),
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
    // commentaire_align : colonne récente → tentative avec, repli sans si migration pas encore
    // appliquée (sinon tout le chargement échouerait). Aucune perte : alignement non persisté.
    (async () => {
      const withAlign = await sb.from('aichantier_localisation_items')
        .select('id,localisation_id,titre,suivi,urgence,commentaire,commentaire_align,plan_annotations,sort_order')
        .order('sort_order');
      const isColErr = (e) => e?.code === '42703' || e?.code === 'PGRST204' || /commentaire_align|schema cache/i.test(e?.message || '');
      if (withAlign.error && isColErr(withAlign.error)) {
        return sb.from('aichantier_localisation_items')
          .select('id,localisation_id,titre,suivi,urgence,commentaire,plan_annotations,sort_order')
          .order('sort_order');
      }
      return withAlign;
    })(),
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

    // Mémoriser les IDs connus à ce chargement — utilisés dans saveRemote pour ne pas supprimer
    // les locs/items/visites ajoutés par un autre utilisateur après notre chargement.
    _knownVisitIdsByProject.set(c.id, new Set(visites.map(v => v.id)));
    _knownLocIdsByProject.set(c.id, new Set(allLocs.map(l => l.id)));
    const _allKnownItemIds = new Set();
    allLocs.forEach(l => { (itemsByLoc[l.id] ?? []).forEach(it => _allKnownItemIds.add(it.id)); });
    _knownItemIdsByProject.set(c.id, _allKnownItemIds);

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
    const grouped = groupBy(mapped, 'item_id');
    // Mémorise TOUS les ids bruts (AVANT dédoublonnage) → la purge conservatrice de saveRemote
    // (delete known-not-kept) pourra ainsi nettoyer en base les lignes en double héritées du
    // bug d'historique (id régénéré à chaque save → des dizaines de lignes pour la même photo).
    for (const [itemId, list] of Object.entries(grouped)) {
      _knownPhotoIdsByItem.set(itemId, new Set(list.map(ph => ph.id).filter(Boolean)));
    }
    // Dédoublonnage AFFICHAGE : une même photo (même item + storage_url) a pu être upsertée
    // des dizaines de fois (ancien bug d'id non stable, corrigé depuis). On n'en garde qu'UNE
    // par storage_url, en préférant la version annotée. Conséquence immédiate : Stas ne voit
    // plus les doublons (plus besoin de supprimer à la main) ; la base se nettoie au prochain
    // enregistrement via la purge. Les photos legacy sans storage_url sont toutes conservées.
    const deduped = {};
    for (const [itemId, list] of Object.entries(grouped)) {
      const keptByUrl = new Map(); // storage_url → photo gardée
      const out = [];
      for (const ph of list) {
        if (!ph.storage_url) { out.push(ph); continue; }
        const prev = keptByUrl.get(ph.storage_url);
        if (!prev) { keptByUrl.set(ph.storage_url, ph); out.push(ph); continue; }
        // Doublon : si la nouvelle porte des annotations et pas la gardée, on la substitue.
        const phAnnot   = !!(ph.annotated || ph.annotations?.length);
        const prevAnnot = !!(prev.annotated || prev.annotations?.length);
        if (phAnnot && !prevAnnot) {
          const i = out.indexOf(prev);
          if (i >= 0) out[i] = ph;
          keptByUrl.set(ph.storage_url, ph);
        }
        // sinon : doublon ignoré (pas affiché)
      }
      deduped[itemId] = out;
    }
    return deduped;
  } catch (e) { console.warn('loadProjectPhotos error:', e); return null; }
}

// Charge la photo de couverture pour une liste de projets — séparée du SELECT principal
// pour éviter le HTTP 500 causé par de gros base64.
// Requêtes par batch de 10 pour éviter des réponses trop volumineuses (base64 covers).
export async function hydrateChantierPhotos(chantierIds) {
  if (!chantierIds.length) return {};
  try {
    const sb = await getSupabase();
    const BATCH = 10;
    const rows = [];
    for (let i = 0; i < chantierIds.length; i += BATCH) {
      const batch = chantierIds.slice(i, i + BATCH);
      const { data, error: dbErr } = await sb.from('aichantier_chantiers').select('id,photo').in('id', batch);
      if (dbErr) { console.warn('hydrateChantierPhotos DB error:', dbErr); continue; }
      if (data) rows.push(...data);
    }
    const data = rows;

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
      .select('id,bg').eq('chantier_id', projectId);
    if (error) { console.warn('hydratePlanLibrary error:', error); return null; }
    const map = {};
    for (const row of (data ?? [])) {
      if (row.bg) map[row.id] = { bg: row.bg, data: null };
    }
    return map; // { planId: { bg, data } }
  } catch (e) { console.warn('hydratePlanLibrary error:', e); return null; }
}

// Récupère les bg de plans en une seule requête — utilisé pour préchauffer le cache
// au démarrage. { projectId: { planId: bg } }
// `ids` (optionnel) : limite la requête aux seuls plans manquants — sans ce filtre, une seule
// vignette absente du cache déclenchait le téléchargement de TOUS les bg de TOUS les projets
// (des dizaines de Mo d'egress Supabase à chaque nouvel appareil ou cache vidé).
export async function loadAllPlanBgs(ids = null) {
  try {
    const sb = await getSupabase();
    let q = sb.from('aichantier_chantier_plans')
      .select('id,chantier_id,bg')
      .not('bg', 'is', null);
    if (ids?.length) q = q.in('id', ids);
    const { data, error } = await q;
    if (error || !data) return {};
    const byProject = {};
    for (const row of data) {
      if (!row.bg) continue;
      if (!byProject[row.chantier_id]) byProject[row.chantier_id] = {};
      byProject[row.chantier_id][row.id] = row.bg;
    }
    return byProject;
  } catch { return {}; }
}

// Charge bg + data d'un seul plan — fallback quand la miniature n'est pas encore hydratée
const _planDataCache = new Map(); // planId → { bg, data }

export async function fetchPlanData(planId) {
  if (_planDataCache.has(planId)) return _planDataCache.get(planId);
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.from('aichantier_chantier_plans')
      .select('id,bg,data').eq('id', planId).single();
    if (error || !data) return null;
    const result = { bg: data.bg ?? null, data: data.data ?? null };
    _planDataCache.set(planId, result);
    return result;
  } catch (e) { console.warn('fetchPlanData error:', e); return null; }
}

// hydratePlans : plan_bg n'est plus stocké dans les locs (timeout 57014).
// planId est désormais dans plan_annotations._planId, lu par buildLocFromRow/loadRemote.
// Cette fonction est conservée pour compatibilité mais retourne toujours un map vide.
export async function hydratePlans(_projectId) {
  return {};
}

// Supprime immédiatement un projet de Supabase (contourne la garde anti-mass-delete).
// Appelé au moment où l'utilisateur confirme la suppression, en complément du filtre local.
export async function deleteRemoteProjet(id) {
  addPersistedDeletedId(id); // persisté immédiatement — survit à un rechargement avant confirmation
  try {
    const sb = await getSupabase();
    // .select('id') retourne les lignes supprimées — permet de détecter un silence RLS
    // (0 rows retournées sans erreur = RLS a bloqué la suppression silencieusement).
    const { data, error } = await sb.from('aichantier_chantiers').delete().eq('id', id).select('id');
    if (error) { console.warn('deleteRemoteProjet error:', error); return false; }
    // Vérifier que la ligne a bien été supprimée (pas de silence RLS)
    const deleted = Array.isArray(data) && data.length > 0;
    if (!deleted) {
      // Ligne introuvable (déjà supprimée) ou RLS — tombstone conservé pour sécurité
      console.warn('deleteRemoteProjet: row not found or RLS prevented deletion for', id);
      if (_lastRemoteIds) _lastRemoteIds.delete(id);
      return false;
    }
    if (_lastRemoteIds) _lastRemoteIds.delete(id);
    removePersistedDeletedId(id); // suppression confirmée — plus besoin de bloquer les polls
    return true;
  } catch (e) { console.warn('deleteRemoteProjet error:', e); return false; }
}

// Suppression immédiate d'un plan depuis Supabase — contourne la sauvegarde différée (debounce 2s).
// Utilisé quand l'utilisateur supprime un plan de la bibliothèque : garantit la suppression même
// si l'app est fermée avant que la sauvegarde générale ne s'exécute.
export async function deleteRemotePlan(chantierId, planId) {
  try {
    const sb = await getSupabase();
    const { error } = await sb.from('aichantier_chantier_plans').delete().eq('id', planId).eq('chantier_id', chantierId);
    if (error) console.warn('deleteRemotePlan error:', error);
  } catch (e) { console.warn('deleteRemotePlan error:', e); }
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
// Convertit un base64 data URL en blob et l'upload dans le bucket Storage `photos`.
// `key` = identifiant STABLE de la photo (id de ligne) → le chemin est DÉTERMINISTE
// (`{slug}/{itemId}/{key}.{ext}`), donc ré-uploader la même photo écrase le même fichier
// (upsert) au lieu de créer un nouveau chemin à chaque save (ancien `Date.now()` → fichiers
// orphelins + storage_url différents indétectables par le dédoublonnage). Retourne le chemin.
async function uploadPhotoToStorage(sb, projectSlug, itemId, key, name, base64) {
  try {
    const resp = await fetch(base64);
    const blob = await resp.blob();
    const rawExt = (name || 'photo').replace(/.*\./, '') || 'webp';
    const ext = rawExt === 'webp' ? 'webp' : rawExt === 'jpg' || rawExt === 'jpeg' ? 'jpg' : rawExt;
    const contentType = blob.type || (ext === 'webp' ? 'image/webp' : 'image/jpeg');
    const safeKey = String(key).replace(/[^\w-]/g, '');
    const path = `${projectSlug}/${itemId}/${safeKey}.${ext}`;
    const { error } = await sb.storage.from('photos').upload(path, blob, { contentType, upsert: true, cacheControl: '31536000' });
    if (error) { console.warn('Storage upload error:', error); return null; }
    return path;
  } catch (e) { console.warn('Storage upload error:', e); return null; }
}

// ── Images COLLÉES dans les commentaires (feature « comme Word ») ───────────────────────────
// Stockées dans le bucket photos sous comments/<itemId>/<uuid>.<ext> (pas de base64 en base).
// Le HTML du commentaire garde l'URL signée (src) + le chemin stable (data-cimg) pour re-signer.
export async function uploadCommentImage(dataUrl, itemId) {
  try {
    if (!dataUrl?.startsWith('data:')) return null;
    const sb = await getSupabase();
    const m = /^data:image\/([a-z0-9.+-]+)/i.exec(dataUrl);
    const ext = m ? (m[1] === 'jpeg' ? 'jpg' : m[1].replace(/[^a-z0-9]/gi, '') || 'png') : 'png';
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const path = `comments/${itemId || 'misc'}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: blob.type || `image/${ext}`, upsert: true, cacheControl: '31536000' });
    if (error) { console.warn('uploadCommentImage error:', error); return null; }
    return path;
  } catch (e) { console.warn('uploadCommentImage error:', e); return null; }
}

// Signe un lot de chemins d'images de commentaire (réutilise le cache d'URL signées).
export async function signCommentPaths(paths) {
  const uniq = [...new Set((paths || []).filter(Boolean))];
  if (!uniq.length) return {};
  const out = {};
  try {
    const { cached, missing } = getCachedUrls(uniq);
    Object.assign(out, cached);
    if (missing.length) {
      const sb = await getSupabase();
      const { data: signed } = await sb.storage.from('photos').createSignedUrls(missing, SIGNED_URL_TTL);
      const fresh = {};
      for (const s of (signed ?? [])) if (s.signedUrl) { out[s.path] = s.signedUrl; fresh[s.path] = s.signedUrl; }
      setCachedUrls(fresh, SIGNED_URL_TTL);
    }
  } catch (e) { console.warn('signCommentPaths error:', e); }
  return out;
}

// Re-signe les <img data-cimg> d'un HTML de commentaire (src à jour). Affichage uniquement.
// Sert à garder l'éditeur fonctionnel même si l'URL signée stockée a expiré.
export async function resolveCommentHtml(html) {
  if (!html || !html.includes('data-cimg')) return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const imgs = Array.from(doc.querySelectorAll('img[data-cimg]'));
    if (!imgs.length) return html;
    const map = await signCommentPaths(imgs.map(i => i.getAttribute('data-cimg')));
    let changed = false;
    for (const img of imgs) {
      const p = img.getAttribute('data-cimg');
      if (map[p] && img.getAttribute('src') !== map[p]) { img.setAttribute('src', map[p]); changed = true; }
    }
    return changed ? doc.body.innerHTML : html;
  } catch { return html; }
}

// Upload de l'image HD d'un plan (WebP haute résolution) dans le bucket `photos`.
// Retourne le chemin relatif (stocké dans la colonne `data` du plan) ou null.
async function uploadPlanHd(sb, chantierId, planId, base64) {
  const path = `plans/${chantierId}/${planId}.webp`;
  // Une tentative + un retry : l'upload HD est la source de qualité du rapport ; un échec
  // silencieux (réseau lent, blob volumineux) condamnait le plan à rester en 2500px pixelisé.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(base64);
      const blob = await resp.blob();
      const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
      if (!error) return path;
      console.warn(`uploadPlanHd error (try ${attempt + 1}):`, error);
    } catch (e) {
      console.warn(`uploadPlanHd error (try ${attempt + 1}):`, e);
    }
  }
  return null;
}

// Cache mémoire session pour les images HD — évite de re-télécharger à chaque ouverture
// du rapport (les HD font 2-5 MB chacune, source principale d'egress Storage non caché).
const _hdCache = new Map(); // planId → dataUrl | Promise<dataUrl|null>

// Récupère l'image HD d'un plan sous forme de data URL (évite le canvas "tainted" à l'export).
// Lit le chemin Storage dans la colonne `data`, génère une signed URL, puis la convertit.
export async function fetchPlanHdDataUrl(planId) {
  if (_hdCache.has(planId)) return _hdCache.get(planId);
  const promise = (async () => {
    try {
      const sb = await getSupabase();
      const { data: row, error } = await sb.from('aichantier_chantier_plans')
        .select('data').eq('id', planId).single();
      if (error || !row?.data) return null;
      const path = row.data;
      // Rejeter les PDF stockés dans data (ancienne pratique) — ils ne sont pas des images
      if (path.startsWith('data:application/pdf') || path.startsWith('data:application/octet')) return null;
      if (path.startsWith('data:image/')) return path; // image déjà encodée (rare)
      const { data: signed } = await sb.storage.from('photos').createSignedUrl(path, SIGNED_URL_TTL);
      if (!signed?.signedUrl) return null;
      const resp = await fetch(signed.signedUrl);
      const blob = await resp.blob();
      return await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
    } catch (e) { console.warn('fetchPlanHdDataUrl error:', e); return null; }
  })();
  _hdCache.set(planId, promise);
  return promise;
}

async function processPhotosForItem(sb, item, itemId, fetchedPhotosByItem, projectSlug) {
  const hasLocalPhotos = (item.photos || []).some(ph => ph.data || ph.storage_url);
  const rawPhotos = (!item._photosHydrated && !hasLocalPhotos)
    ? (fetchedPhotosByItem[item.id] ?? [])
    : (item.photos || []);

  const result = [];
  // incomplete = au moins une photo n'a pas pu être traitée (upload réseau KO, legacy
  // illisible…). Dans ce cas l'appelant SAUTE la purge des orphelins pour cet item → on ne
  // supprime jamais une photo existante à cause d'un échec transitoire (perte silencieuse).
  let incomplete = false;
  for (let pi = 0; pi < rawPhotos.length; pi++) {
    const ph = rawPhotos[pi];
    // ID de ligne STABLE pour la photo. Ordre des fallbacks : _id (assigné à la création depuis
    // dd24b00) → id → _uploadId (handle de la file d'upload, stable, présent sur les clients de
    // l'ère "upload queue" mais sans _id) → dernier recours random. CRUCIAL : sans token stable,
    // chaque save régénérait un UUID → une nouvelle ligne à chaque cycle → doublons à l'infini.
    const rowId = ph._id ?? ph.id ?? ph._uploadId ?? crypto.randomUUID();
    let storageUrl = ph.storage_url
      ? (extractPhotoPath(ph.storage_url) ?? ph.storage_url)
      : null;
    // Upload anticipé : la photo a pu être poussée vers Storage dès sa prise (file
    // photoUploadQueue) — on réutilise ce chemin au lieu de re-uploader les octets.
    if (!storageUrl && ph._uploadId) {
      storageUrl = await getQueuedUploadPath(ph._uploadId);
    }
    if (storageUrl) {
      // path normalisé — réutiliser
    } else if (ph.data?.startsWith('data:')) {
      // Chemin déterministe (clé = rowId) → ré-upload écrase le même fichier, pas de doublon.
      storageUrl = await uploadPhotoToStorage(sb, projectSlug, itemId, rowId, ph.name, ph.data);
      if (!storageUrl) { incomplete = true; continue; }
      // La file n'a pas encore traité cette photo mais saveRemote vient de l'uploader →
      // retirer l'entrée pour éviter un second upload concurrent vers un autre chemin.
      if (ph._uploadId) removeQueuedUpload(ph._uploadId);
    } else if (ph.data?.startsWith('http')) {
      storageUrl = extractPhotoPath(ph.data) ?? ph.data;
    } else {
      const legacyId = ph._id || ph.id;
      if (!legacyId) { incomplete = true; continue; }
      const { data: legRow } = await sb.from('aichantier_item_photos').select('data').eq('id', legacyId).maybeSingle();
      if (!legRow?.data) { incomplete = true; continue; }
      storageUrl = await uploadPhotoToStorage(sb, projectSlug, itemId, rowId, ph.name, legRow.data);
      if (!storageUrl) { incomplete = true; continue; }
      await sb.from('aichantier_item_photos').update({ storage_url: storageUrl, data: null }).eq('id', legacyId);
    }
    // Sauvegarder le composite annoté dans Storage si présent
    let annotatedUrl = ph.annotated_storage_url
      ? (extractPhotoPath(ph.annotated_storage_url) ?? ph.annotated_storage_url)
      : null;
    if (!annotatedUrl && ph.annotated?.startsWith('data:')) {
      annotatedUrl = await uploadPhotoToStorage(sb, projectSlug, itemId, `${rowId}_annot`, ph.name, ph.annotated);
    } else if (!annotatedUrl && ph.annotated?.startsWith('http')) {
      annotatedUrl = extractPhotoPath(ph.annotated) ?? null;
    }

    const photoRow = {
      id: rowId, // ID stable → upsert idempotent, jamais de ligne dupliquée
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
  return { rows: result, incomplete };
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
      // Garde anti-catastrophe : on SAUTE uniquement l'étape de suppression (les projets
      // « supprimés » seront simplement re-résolus au prochain chargement), mais on NE bloque
      // PAS le reste du save — les upserts (éditions de texte, photos, etc.) doivent passer.
      // Avant, un `return errors` ici interrompait toute la sauvegarde et coinçait les éditions.
      // Les suppressions explicites utilisateur passent de toute façon par deleteRemoteProjet().
      console.error('saveRemote: skipping suspicious mass-delete of', toDelete.length, 'projets (cap=', safeCap, ') — upserts continue');
    } else if (toDelete.length > 0) {
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
      ingenieur: v.ingenieur ?? '',
      participants: v.participants ?? [], tableauRecap: v.tableauRecap ?? [],
      photosParLigne: v.photosParLigne ?? 2, plansEnFin: v.plansEnFin ?? false,
      rapportPageBreaks: v.rapportPageBreaks ?? [],
      includeTableauRecap: v.includeTableauRecap ?? true,
      includeConclusion: v.includeConclusion ?? false,
      conclusion: v.conclusion ?? '',
      conclusionAlign: v.conclusionAlign ?? 'left',
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

    // ── Lecture des locs DB actuelles (pour détection des locs orphelines à supprimer) ──
    const dbLocsRes = await sb.from('aichantier_chantier_localisations').select('id,visite_id').eq('chantier_id', p.id);

    // Visites : base = état local (l'utilisateur fait autorité sur SES visites).
    // On fusionne en plus les visites créées par un autre utilisateur après notre chargement :
    //   - visite absente du local ET absente de _knownVisitIdsByProject → créée par quelqu'un d'autre → on la conserve
    //   - visite absente du local ET dans _knownVisitIdsByProject → supprimée par cet utilisateur → on ne la ré-injecte pas
    // (évite le bug précédent : "merger ici ramenait les visites supprimées")
    let mergedVisitesMetadata = visitesMetadata;
    try {
      const { data: dbMeta } = await sb.from('aichantier_chantiers').select('visites').eq('id', p.id).single();
      if (dbMeta?.visites?.length) {
        const localVisitIdSet = new Set(visitesMetadata.map(v => v.id));
        const knownVisitIds   = _knownVisitIdsByProject.get(p.id);
        const dbOnlyVisits    = dbMeta.visites.filter(v =>
          !localVisitIdSet.has(v.id) && knownVisitIds != null && !knownVisitIds.has(v.id)
        );
        if (dbOnlyVisits.length > 0) mergedVisitesMetadata = [...visitesMetadata, ...dbOnlyVisits];
      }
    } catch {}
    // Mettre à jour les IDs de visites connus après l'écriture (pour pouvoir supprimer une visite créée en session)
    const _knownVisitSet = _knownVisitIdsByProject.get(p.id) ?? new Set();
    mergedVisitesMetadata.forEach(v => _knownVisitSet.add(v.id));
    _knownVisitIdsByProject.set(p.id, _knownVisitSet);

    // ── Upsert chantier avec visites fusionnées ────────────────────────────────
    const chantierRes = await sb.from('aichantier_chantiers').upsert({
      id: p.id, nom: p.nom ?? '', statut: p.statut ?? 'en_cours',
      adresse: p.adresse ?? '', maitre_ouvrage: p.maitreOuvrage ?? '',
      photo: coverPhotoUrl, date_visite: firstVisit?.dateVisite ?? null,
      photos_par_ligne: firstVisit?.photosParLigne ?? 2,
      participants: firstVisit?.participants ?? [], tableau_recap: firstVisit?.tableauRecap ?? [],
      visites: mergedVisitesMetadata, updated_at: now,
    }, { onConflict: 'id' });
    if (chantierRes.error) {
      // Si le projet n'existe plus en DB (FK ou 404), ne pas essayer de sauvegarder ses locs
      if (chantierRes.error.code === '23503' || chantierRes.error.code === 'PGRST116') {
        console.warn('saveRemote: projet introuvable, skip locs pour', p.id);
        continue;
      }
      errors.push(chantierRes.error); continue;
    }

    const dbLocIds  = new Set((dbLocsRes.data || []).map(l => l.id));
    const currLocIds = new Set(allLocsFlat.map(l => l.id).filter(Boolean));

    // Garde de sécurité : jamais effacer si l'état local est vide
    if (allLocsFlat.length === 0 && dbLocIds.size > 0) {
      errors.push({ message: 'Sync interrompu : état local vide alors que la DB contient des données. Rechargez la page.', code: 'SAFETY_EMPTY' });
      continue;
    }

    // Loc rows — plan_bg/plan_data jamais envoyés dans les locs (timeout 57014).
    // planId est encodé dans plan_annotations._planId pour éviter une colonne dédiée.
    const locRows = allLocsFlat.map((l, i) => {
      // Construire l'objet plan_annotations : paths existants + _planId + _extraPlans si définis
      const extraPlansToStore = (l.extraPlans || [])
        .map(ep => ({ ...(ep.planId ? { planId: ep.planId } : {}), ...(ep.planAnnotations?.paths?.length ? { paths: ep.planAnnotations.paths } : {}), ...(ep.reportHidden ? { reportHidden: true } : {}) }))
        .filter(ep => ep.planId);
      let annotObj = null;
      if (l.planId || l.planAnnotations?.paths?.length || extraPlansToStore.length || l.planReportHidden) {
        annotObj = {};
        if (l.planId) annotObj._planId = l.planId;
        if (l.planReportHidden) annotObj._planReportHidden = true;
        if (l.planAnnotations?.paths?.length) annotObj.paths = l.planAnnotations.paths;
        if (extraPlansToStore.length) annotObj._extraPlans = extraPlansToStore;
      }
      return {
        id: l.id || crypto.randomUUID(), chantier_id: p.id, nom: l.nom ?? '',
        plan_annotations: annotObj ? JSON.stringify(annotObj) : null,
        sort_order: i, visite_id: l._visiteId,
      };
    });

    // Supprimer uniquement les locs que cet utilisateur connaissait au chargement ET qui ont disparu
    // de son état local (= il les a explicitement supprimées).
    // Jamais supprimer une loc inconnue au chargement (ajoutée par un autre utilisateur entre-temps).
    // Fallback : si les known IDs ne sont pas disponibles (offline au démarrage), on retombe sur
    // l'ancien garde par visite (comportement pré-fix).
    const localVisitIds = new Set((p.visites || []).map(v => v.id));
    const knownLocIds   = _knownLocIdsByProject.get(p.id);
    const removedLocIds = (dbLocsRes.data || [])
      .filter(l => !currLocIds.has(l.id) && (knownLocIds != null ? knownLocIds.has(l.id) : localVisitIds.has(l.visite_id)))
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

    const locUpsertRes = locRows.length
      ? await sb.from('aichantier_chantier_localisations').upsert(locRows, { onConflict: 'id' })
      : { error: null };
    if (locUpsertRes.error) {
      // FK violation : le projet a été supprimé entre temps (race condition) — pas critique
      if (locUpsertRes.error.code === '23503') { console.warn('saveRemote: FK loc skip', p.id); continue; }
      errors.push(locUpsertRes.error); continue;
    }
    // Mettre à jour les IDs de locs connus (pour qu'une loc créée en session soit supprimable plus tard)
    { const _s = _knownLocIdsByProject.get(p.id) ?? new Set(); locRows.forEach(l => { if (l.id) _s.add(l.id); }); _knownLocIdsByProject.set(p.id, _s); }

    // Plans (fire-and-forget) — UPSERT + DELETE ciblé (évite perte si insert échoue)
    const plansPromise = (async () => {
      // Two parallel tiny queries (id only — never select bg here, it's a large blob)
      const [dbPlansRes, dbPlansNoBgRes, dbPlansNoDataRes] = await Promise.all([
        sb.from('aichantier_chantier_plans').select('id').eq('chantier_id', p.id),
        sb.from('aichantier_chantier_plans').select('id').eq('chantier_id', p.id).is('bg', null),
        sb.from('aichantier_chantier_plans').select('id').eq('chantier_id', p.id).is('data', null),
      ]);
      const dbPlanIds  = new Set((dbPlansRes.data || []).map(pl => pl.id));
      const dbPlansNoBg = new Set((dbPlansNoBgRes.data || []).map(pl => pl.id));
      const dbPlansNoData = new Set((dbPlansNoDataRes.data || []).map(pl => pl.id));
      const currPlanIds = new Set((p.planLibrary || []).map(pl => pl.id).filter(Boolean));
      const removedPlanIds = [...dbPlanIds].filter(id => !currPlanIds.has(id));
      // CRITIQUE — deux upserts séparés et HOMOGÈNES (mêmes clés sur toutes les lignes).
      // PostgREST normalise un upsert batch sur l'UNION des clés : mélanger des lignes
      // avec et sans `bg` écrase bg=NULL sur celles qui ne le portent pas → plans fantômes
      // (cartes "Plan" vides) car toute sauvegarde effaçait le bg des autres plans.
      // 1) Métadonnées de TOUS les plans, sans jamais inclure `bg` → bg jamais touché.
      const metaRows = (p.planLibrary || []).map((pl, i) => ({
        id: pl.id || crypto.randomUUID(),
        chantier_id: p.id, nom: pl.nom ?? '', sort_order: i,
      }));
      // 2) bg uniquement pour les nouveaux plans ou ceux dont le bg manque en base
      //    (réparation après timeout). Batch homogène : toutes les lignes portent bg.
      const bgRows = (p.planLibrary || [])
        .filter(pl => pl.bg != null && (!dbPlanIds.has(pl.id) || dbPlansNoBg.has(pl.id)))
        .map(pl => ({ id: pl.id, chantier_id: p.id, bg: pl.bg }));
      // Safety guard: if local plan list is empty but DB has plans, skip deletion.
      // Local can be empty because plans weren't hydrated yet (bg/data loaded lazily).
      if (metaRows.length === 0 && dbPlanIds.size > 0) return;
      await Promise.all([
        removedPlanIds.length ? sb.from('aichantier_chantier_plans').delete().in('id', removedPlanIds) : Promise.resolve(),
        metaRows.length       ? sb.from('aichantier_chantier_plans').upsert(metaRows, { onConflict: 'id' }).then(r => { if (r.error) errors.push(r.error); }) : Promise.resolve(),
      ]);
      // bg en second (les lignes méta existent désormais) — batch homogène, n'écrase aucun bg existant.
      if (bgRows.length) {
        await sb.from('aichantier_chantier_plans').upsert(bgRows, { onConflict: 'id' }).then(r => { if (r.error) errors.push(r.error); });
      }
      // Image HD (colonne `data` = chemin Storage) : SECONDE CHANCE de persistance.
      // savePlanBgNow l'upload à l'import en fire-and-forget — s'il échoue (réseau, onglet fermé),
      // le plan restait bloqué en bg 2500px (pixelisé). Tant que `pl.hd` est en mémoire (session
      // d'import), on (ré)uploade pour les plans dont la colonne data est absente en base.
      // Batch homogène {id, data} → n'écrase ni bg ni nom (cf. gotcha PostgREST ci-dessus).
      const hdCandidates = (p.planLibrary || [])
        .filter(pl => typeof pl.hd === 'string' && pl.hd.startsWith('data:')
                   && (!dbPlanIds.has(pl.id) || dbPlansNoData.has(pl.id)));
      if (hdCandidates.length) {
        const dataRows = (await Promise.all(hdCandidates.map(async pl => {
          const path = await uploadPlanHd(sb, p.id, pl.id, pl.hd);
          return path ? { id: pl.id, data: path } : null;
        }))).filter(Boolean);
        if (dataRows.length) {
          await sb.from('aichantier_chantier_plans').upsert(dataRows, { onConflict: 'id' }).then(r => { if (r.error) errors.push(r.error); });
        }
      }
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

      const dbLocItemIds  = new Set((dbItemsByLoc[locId] || []).map(i => i.id));
      const currItemIds   = new Set((l.items || []).map(i => i.id).filter(Boolean));
      const knownItemIds  = _knownItemIdsByProject.get(p.id);
      // Ne supprimer que les items connus au chargement (et plus en local = supprimés par l'utilisateur).
      // Les items inconnus au chargement ont été ajoutés par un autre utilisateur → ne pas les supprimer.
      const removedItemIds = [...dbLocItemIds].filter(id => !currItemIds.has(id) && (knownItemIds != null ? knownItemIds.has(id) : true));
      allRemovedItemIds.push(...removedItemIds);

      for (let ii = 0; ii < (l.items || []).length; ii++) {
        const item = l.items[ii];
        const itemId = item.id || crypto.randomUUID();
        allItems.push({
          id: itemId, localisation_id: locId,
          titre: item.titre ?? '', suivi: item.suivi ?? 'rien',
          urgence: item.urgence ?? 'basse', commentaire: item.commentaire ?? '',
          commentaire_align: item.commentaireAlign ?? 'left',
          plan_annotations: (() => {
            const ann = item.planAnnotations ? { ...slimAnnot(item.planAnnotations) } : {};
            // Plans bibliothèque de l'item encodés dans _plans (même colonne, pas de colonne dédiée)
            if (item.plans?.length) {
              const slimPlans = item.plans
                .filter(pl => pl.planId)
                .map(pl => ({
                  id: pl.id,
                  planId: pl.planId,
                  ...(pl.planAnnotations?.paths?.length ? { paths: pl.planAnnotations.paths } : {}),
                }));
              if (slimPlans.length) ann._plans = slimPlans;
            }
            return Object.keys(ann).length ? JSON.stringify(ann) : null;
          })(),
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
    // commentaire_align : si la colonne n'existe pas encore (migration non appliquée), on rejoue
    // l'upsert SANS ce champ → la sauvegarde n'échoue jamais (zéro perte de données).
    const isAlignColErr = (e) => e?.code === '42703' || e?.code === 'PGRST204' || /commentaire_align|schema cache/i.test(e?.message || '');
    if (upsertItemsRes?.error && isAlignColErr(upsertItemsRes.error) && allItems.length > 0) {
      const stripped = allItems.map(({ commentaire_align, ...row }) => row); // eslint-disable-line no-unused-vars
      const retry = await sb.from('aichantier_localisation_items').upsert(stripped, { onConflict: 'id' });
      upsertItemsRes.error = retry.error ?? null;
    }
    if (upsertItemsRes?.error) errors.push(upsertItemsRes.error);
    // Mettre à jour les IDs d'items connus (pour qu'un item créé en session soit supprimable plus tard)
    if (!upsertItemsRes?.error) {
      const _si = _knownItemIdsByProject.get(p.id) ?? new Set();
      allItems.forEach(it => { if (it.id) _si.add(it.id); });
      _knownItemIdsByProject.set(p.id, _si);
    }

    const fetchedPhotosByItem = groupBy(photosRes?.data || [], 'item_id');

    // Photos : UPSERT par ID stable puis delete-orphans (jamais de perte si l'upsert échoue)
    const allPhotoRows = [];
    const incompleteItems = new Set(); // items dont une photo n'a pas pu être traitée → pas de purge
    for (const { itemId, item } of itemRecords) {
      if (!itemsWithLocalPhotos.has(itemId)) continue;
      const { rows, incomplete } = await processPhotosForItem(sb, item, itemId, fetchedPhotosByItem, slug);
      allPhotoRows.push(...rows);
      if (incomplete) incompleteItems.add(itemId);
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

    // Purge des photos orphelines — UNIQUEMENT si l'upsert a réussi, et de façon CONSERVATRICE :
    // on ne supprime QUE les photos connues au chargement (_knownPhotoIdsByItem) que l'utilisateur
    // a depuis retirées. Une photo ajoutée en parallèle par un AUTRE appareil (absente de
    // l'ensemble connu) n'est JAMAIS supprimée → fini la perte de lignes photos en édition
    // concurrente PC + téléphone. Les items dont une photo a échoué sont entièrement épargnés.
    if (photoUpsertOk) {
      const keptIdsByItem = new Map();
      for (const row of allPhotoRows) {
        if (!keptIdsByItem.has(row.item_id)) keptIdsByItem.set(row.item_id, new Set());
        keptIdsByItem.get(row.item_id).add(row.id);
      }
      await Promise.all([...itemsWithLocalPhotos].map(itemId => {
        if (incompleteItems.has(itemId)) return Promise.resolve(); // échec transitoire → on ne supprime rien
        const known = _knownPhotoIdsByItem.get(itemId);
        if (!known) return Promise.resolve(); // état chargé inconnu → on ne supprime rien (prudence)
        const keptSet = keptIdsByItem.get(itemId) ?? new Set();
        // À supprimer = photos connues au chargement que l'utilisateur a retirées (plus dans kept).
        const toDelete = [...known].filter(id => !keptSet.has(id) && typeof id === 'string' && /^[\w-]+$/.test(id));
        const p = toDelete.length
          ? sb.from('aichantier_item_photos').delete().eq('item_id', itemId).in('id', toDelete)
          : Promise.resolve();
        // L'état connu de référence devient l'état sauvegardé (les ajouts concurrents seront
        // découverts au prochain chargement) → cohérence pour les sauvegardes suivantes.
        _knownPhotoIdsByItem.set(itemId, new Set(keptSet));
        return p;
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
// IDs supprimés localement — persistés pour survivre aux rechargements de page.
// Empêche mergeWithLocal de restaurer un projet supprimé si la suppression Supabase est encore en cours.
const PERSISTED_DELETED_IDS_KEY = '_chantierai_deleted_ids_v1';

export function getPersistedDeletedIds() {
  try {
    const raw = localStorage.getItem(PERSISTED_DELETED_IDS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch { return new Set(); }
}

function addPersistedDeletedId(id) {
  try {
    const ids = getPersistedDeletedIds();
    ids.add(id);
    localStorage.setItem(PERSISTED_DELETED_IDS_KEY, JSON.stringify([...ids]));
  } catch {}
}

function removePersistedDeletedId(id) {
  try {
    const ids = getPersistedDeletedIds();
    ids.delete(id);
    localStorage.setItem(PERSISTED_DELETED_IDS_KEY, JSON.stringify([...ids]));
  } catch {}
}

// IDs des projets avec des modifications locales NON synchronisées vers Supabase.
// Persistés pour survivre à un rechargement/fermeture : sans ça, dirtyIds repart vide
// au démarrage et mergeWithLocal peut écraser le travail local non sauvé avec le remote
// (cause de l'incident "travail PC disparu à la réouverture").
const PERSISTED_DIRTY_IDS_KEY = '_chantierai_dirty_ids_v1';

export function getPersistedDirtyIds() {
  try {
    const raw = localStorage.getItem(PERSISTED_DIRTY_IDS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch { return new Set(); }
}

export function setPersistedDirtyIds(ids) {
  try {
    localStorage.setItem(PERSISTED_DIRTY_IDS_KEY, JSON.stringify([...(ids || [])]));
  } catch {}
}

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

// Efface le cache local des projets — appelé à la déconnexion pour éviter qu'un autre
// utilisateur sur le même appareil ne voie (ou ne re-uploade) les données du précédent.
export function clearLocalData() {
  try {
    if (_hasLS) {
      localStorage.removeItem(SK);
      localStorage.removeItem(PERSISTED_REMOTE_IDS_KEY);
      localStorage.removeItem(PERSISTED_DELETED_IDS_KEY);
      localStorage.removeItem(PERSISTED_DIRTY_IDS_KEY);
    }
    delete _mem[SK];
    clearSnapshots(); // purge la boîte noire (évite de proposer les données d'un autre utilisateur)
  } catch {}
  _lastRemoteIds = null;
  _knownVisitIdsByProject = new Map();
  _knownLocIdsByProject   = new Map();
  _knownItemIdsByProject  = new Map();
}

// Récupère uniquement id + updated_at depuis Supabase — poll léger pour détecter les MàJ distantes
export async function fetchRemoteTimestamps() {
  const sb = await getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from('aichantier_chantiers').select('id,updated_at');
  if (error || !data) return [];
  return data; // [{ id, updated_at }]
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

// Sauvegarde immédiate du bg d'un plan en DB — appelée dès l'import ou la réparation,
// sans attendre le cycle de sauvegarde différée (2 s). Prévient la perte si rechargement rapide.
export async function savePlanBgNow(chantierId, plans) {
  if (!chantierId || !plans?.length) return;
  try {
    const sb = await getSupabase();
    const rows = await Promise.all(plans
      .filter(pl => pl.id && pl.bg)
      .map(async (pl, i) => {
        const row = { id: pl.id, chantier_id: chantierId, nom: pl.nom ?? '', bg: pl.bg, sort_order: i };
        // Image HD → Supabase Storage (bucket photos), chemin stocké dans la colonne `data`
        if (typeof pl.hd === 'string' && pl.hd.startsWith('data:')) {
          const path = await uploadPlanHd(sb, chantierId, pl.id, pl.hd);
          if (path) row.data = path;
        }
        return row;
      }));
    if (!rows.length) return;
    await sb.from('aichantier_chantier_plans').upsert(rows, { onConflict: 'id' });
  } catch (e) { console.warn('savePlanBgNow:', e); }
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
