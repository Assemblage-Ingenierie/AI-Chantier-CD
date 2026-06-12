import { useState, useEffect, useRef, useCallback } from 'react';
import { loadData, loadLocalData, saveData, saveLocalCache, loadProjectPhotos, migratePhotosToStorage, hydratePlans as hydratePlansRemote, hydrateChantierPhotos, hydratePlanLibrary as hydratePlanLibraryRemote, loadAllPlanBgs, getPersistedRemoteIds, getPersistedDeletedIds, getPersistedDirtyIds, setPersistedDirtyIds, deleteRemoteProjet, deleteRemotePlan } from '../lib/storage.js';
import { renderPdfPage } from '../lib/pdfUtils.js';
import { getPlanThumbs, setPlanThumbs } from '../lib/planThumbCache.js';
import { saveSnapshot, getLatestSnapshot, detectLoss } from '../lib/backupVault.js';

const MAX_HISTORY = 20;

// Shared merge helper — called both on initial load and on background polls.
// Takes remote data and current local state, returns the merged array + updates cache.
//
// previousRemoteIds : Set des IDs vus sur le remote lors de la session précédente
//   (persistés en localStorage). Permet de distinguer :
//   - localOnly + dans previousRemoteIds → projet supprimé ailleurs → drop local
//   - localOnly + jamais dans previousRemoteIds → vraiment unsynced → push back
//   Si null (1ère/legacy session) : seuls les projets déjà dans dirtyIds sont traités comme unsynced.
function mergeWithLocal(remotePs, localPs, dirtyIds, previousRemoteIds = null) {
  const localById  = new Map(localPs.map(p => [p.id, p]));
  const remoteIds  = new Set(remotePs.map(p => p.id));
  // When previousRemoteIds is null (first/legacy session), only treat local-only projects
  // as unsynced if they are explicitly dirty — prevents stale deleted projects from being
  // re-pushed to Supabase by users who cleared localStorage or never ran the persisted-IDs code.
  const unsynced   = localPs.filter(p =>
    !remoteIds.has(p.id) &&
    (previousRemoteIds !== null ? !previousRemoteIds.has(p.id) : dirtyIds.has(p.id))
  );

  let keptLocal = false;
  const keptLocalIds = new Set(); // IDs kept local due to newer timestamp (not just dirtyIds)
  const merged = remotePs.map(rp => {
    const lp = localById.get(rp.id);

    // Keep local when: unsaved dirty changes OR local timestamp is newer
    const isDirty = dirtyIds.has(rp.id);
    if (isDirty || (lp?.updatedAt && rp.updatedAt && lp.updatedAt > rp.updatedAt)) {
      keptLocal = true;
      if (!isDirty) keptLocalIds.add(rp.id); // needs targeted save, not caught by existing dirtyIds
      if (!lp) return rp;
      // Restore blobs (planBg, planLibrary.bg) stripped by slimLoc in localStorage
      const localPlanById_d = new Map((lp.planLibrary || []).map(pl => [pl.id, pl]));
      // Dirty path : le serveur fait quand même autorité sur la MEMBERSHIP des plans
      // (même stratégie que le non-dirty path). L'ancienne union ressuscitait les plans
      // supprimés sur un autre appareil : mobile dirty → sauvegarde avec l'ancien plan →
      // résurrection permanente. Les plans réellement nouveaux (ajoutés en local non encore
      // synchros) sont déjà dans React state et seront envoyés par le prochain saveData.
      const mergedPlanLibrary = (rp.planLibrary || []).map(rpl => {
        const lpl = localPlanById_d.get(rpl.id);
        return lpl ? { ...rpl, bg: lpl.bg ?? rpl.bg, data: lpl.data ?? rpl.data } : rpl;
      });
      // Visites distantes inconnues localement (créées sur un autre appareil pendant qu'on était dirty).
      const localVisitIds = new Set((lp.visites || []).map(v => v.id));
      const newRemoteVisits = (rp.visites || []).filter(rv => !localVisitIds.has(rv.id));
      return {
        ...lp,
        // statut (archive/actif) : champ unique toujours sauvegardé immédiatement.
        // Si cet appareil n'a aucune modif en attente (isDirty faux) et n'est ici qu'à
        // cause d'un updatedAt local plus récent (décalage d'horloge entre appareils),
        // on ne doit PAS écraser la décision d'archivage de la DB avec un statut périmé.
        statut: isDirty ? lp.statut : (rp.statut ?? lp.statut),
        planLibrary: mergedPlanLibrary,
        visites: [
          ...(lp.visites || []).map(lv => {
            const rv = (rp.visites || []).find(v => v.id === lv.id);
            if (!rv) return lv;
            const remoteLocById = new Map((rv.localisations || []).map(l => [l.id, l]));
            return {
              ...lv,
              localisations: (lv.localisations || []).map(ll => {
                const rl = remoteLocById.get(ll.id);
                if (!rl) return ll;
                return {
                  ...ll,
                  planBg: rl.planBg ?? ll.planBg ?? (ll.planId ? localPlanById_d.get(ll.planId)?.bg : null) ?? null,
                  planData: rl.planData ?? ll.planData,
                  planId: ll.planId ?? rl.planId,
                  planAnnotations: ll.planAnnotations ?? rl.planAnnotations,
                  // dirty path: local is authoritative; union with remote-only extraPlans
                  // added from another device while this device had pending changes
                  extraPlans: (() => {
                    const localEPs = ll.extraPlans ?? [];
                    const remoteEPs = rl.extraPlans ?? [];
                    const localPlanIds = new Set(localEPs.filter(ep => ep.planId).map(ep => ep.planId));
                    const remoteOnly = remoteEPs.filter(ep => ep.planId && !localPlanIds.has(ep.planId));
                    return [...localEPs, ...remoteOnly];
                  })(),
                };
              }),
            };
          }),
          ...newRemoteVisits, // préserve les visites créées ailleurs pendant la session locale
        ],
      };
    }

    if (!lp) return rp;
    const photo = lp.photo ?? rp.photo ?? null;
    if (rp.statut === 'archive') return { ...rp, photo, visites: lp.visites ?? rp.visites };

    // Non-dirty path → le serveur fait autorité sur la MEMBERSHIP de la bibliothèque de plans
    // (cet appareil n'a aucune modif en attente et n'est pas plus récent que le remote).
    // On préserve uniquement les blobs bg/data hydratés localement pour les plans qui existent
    // ENCORE sur le serveur. Les plans présents en local mais absents du remote ont été
    // supprimés sur un autre appareil → on les abandonne.
    // ⚠️ L'ancien comportement "union" les ré-ajoutait et marquait le projet dirty, ce qui
    // (1) ressuscitait les plans supprimés à la prochaine sauvegarde ET (2) bloquait le poll
    // « Actualiser » (pollRemote skip tant que dirtyIds n'est pas vide). Les plans réellement
    // nouveaux non synchronisés passent par le chemin dirty plus haut, qui garde son union.
    const localPlanById = new Map((lp.planLibrary || []).map(pl => [pl.id, pl]));

    return {
      ...rp,
      photo,
      planLibrary: (rp.planLibrary || []).map(rpl => {
        const lpl = localPlanById.get(rpl.id);
        if (!lpl) return rpl;
        return { ...rpl, bg: lpl.bg ?? rpl.bg, data: lpl.data ?? rpl.data };
      }),
      visites: (rp.visites || []).map(rv => {
        const lv = lp.visites?.find(v => v.id === rv.id);
        if (!lv) return rv;
        // Union strategy for locs: keep local-only zones (added but not yet in DB)
        const remoteLocIds = new Set((rv.localisations || []).map(l => l.id));
        const localOnlyLocs = (lv.localisations || []).filter(ll => !remoteLocIds.has(ll.id));
        if (localOnlyLocs.length > 0) {
          keptLocalIds.add(rp.id);
          keptLocal = true;
        }
        return {
          ...rv,
          // Préserver les champs locaux enrichis que le remote peut ne pas avoir encore
          ingenieur: lv.ingenieur || rv.ingenieur || '',
          localisations: [
            ...(rv.localisations || []).map(loc => {
              const localLoc = lv.localisations?.find(l => l.id === loc.id);
              if (!localLoc) return loc;
              // Non-dirty path : le remote fait autorité sur l'affectation du plan (cet appareil
              // n'a aucune modif en attente). On garde le planId local seulement en fallback si le
              // remote n'en a pas. On ne préserve le planBg/planData hydraté localement QUE si
              // l'affectation n'a pas changé — sinon l'image de l'ancien plan resterait collée à une
              // loc qui pointe désormais vers un autre plan (cas : plan réaffecté/annoté sur PC).
              const mergedPlanId = loc.planId ?? localLoc.planId;
              const samePlanAssign = mergedPlanId != null && mergedPlanId === localLoc.planId;
              return {
                ...loc,
                planId: mergedPlanId,
                planBg: samePlanAssign
                  ? (localLoc.planBg ?? loc.planBg ?? localPlanById.get(mergedPlanId)?.bg ?? null)
                  : (loc.planBg ?? localPlanById.get(mergedPlanId)?.bg ?? null),
                planData: samePlanAssign ? (localLoc.planData ?? loc.planData) : loc.planData,
                // non-dirty path: remote is authoritative for extraPlans membership;
                // preserve locally-hydrated planBg blobs to avoid grey thumbnails.
                // [] !== null — must check length, not use ?? which would keep stale []
                extraPlans: (() => {
                  const remoteEPs = loc.extraPlans ?? [];
                  const localEPs = localLoc.extraPlans ?? [];
                  const localByPlanId = new Map(localEPs.filter(ep => ep.planId).map(ep => [ep.planId, ep]));
                  if (remoteEPs.length) {
                    return remoteEPs.map(ep => {
                      const local = ep.planId ? localByPlanId.get(ep.planId) : null;
                      return local ? { ...ep, planBg: local.planBg ?? ep.planBg, planData: local.planData ?? ep.planData } : ep;
                    });
                  }
                  return localEPs; // remote has none: keep local (not yet saved, or remote load partial)
                })(),
                items: (loc.items || []).map(item => {
                  const localItem = localLoc.items?.find(i => i.id === item.id);
                  if (localItem?._photosHydrated) return { ...item, photos: localItem.photos, _photosHydrated: true };
                  // Preserve local photos even when _photosHydrated is false (e.g. base64 just taken,
                  // upload still in progress). Without this guard, pollRemote blanks fresh photos.
                  if (localItem?.photos?.length) return { ...item, photos: localItem.photos };
                  return item;
                }),
              };
            }),
            ...localOnlyLocs,
          ],
        };
      }),
    };
  });

  const allMerged = [...merged, ...unsynced]
    .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));

  saveLocalCache(allMerged);
  return { allMerged, keptLocal, keptLocalIds, unsynced };
}

export function useProjets(onSyncStatus) {
  const [projets, setProjets] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  // Filet de sécurité : proposition de restauration si la boîte noire détecte une perte.
  const [backupRecovery, setBackupRecovery] = useState(null); // null | { snapshot, lost }
  const debounceRef = useRef(null);
  const retryRef = useRef(null);
  const projetsRef = useRef(projets);
  const userModified = useRef(false);
  const savingRef = useRef(false);
  const historyRef = useRef([]);
  const deletedIdsRef = useRef(getPersistedDeletedIds()); // IDs supprimés — survivent aux rechargements
  // dirtyIds persistés : survivent au rechargement/fermeture pour que mergeWithLocal sache
  // que ces projets ont des modifs locales non sauvées → garde le local plutôt que le remote.
  const dirtyIds = useRef(getPersistedDirtyIds());
  const cacheSaveRef = useRef(null); // debounce pour la sauvegarde localStorage rapide
  const snapshotRef = useRef(null);  // debounce pour la boîte noire IndexedDB

  useEffect(() => {
    projetsRef.current = projets;
    // Sauvegarde localStorage accélérée (500 ms) dès que l'utilisateur a modifié quelque chose.
    // Réduit la fenêtre de perte de données en cas de crash navigateur (vs. 2 s pour Supabase).
    if (!userModified.current) return;
    clearTimeout(cacheSaveRef.current);
    cacheSaveRef.current = setTimeout(() => saveLocalCache(projetsRef.current), 500);
    // Boîte noire indépendante (IndexedDB) : instantané complet horodaté, jamais écrasé
    // par le pipeline de sync. Debounce 3 s pour limiter les écritures.
    clearTimeout(snapshotRef.current);
    snapshotRef.current = setTimeout(() => saveSnapshot(projetsRef.current), 3000);
    // Persister la liste des modifs non synchronisées (survit au rechargement).
    setPersistedDirtyIds(dirtyIds.current);
  }, [projets]);

  useEffect(() => {
    // Snapshot des IDs remote connus AVANT que loadData() ne les mette à jour.
    // Critique pour distinguer "supprimé ailleurs" de "vraiment unsynced".
    const previousRemoteIds = getPersistedRemoteIds();
    // Lire la dernière sauvegarde « boîte noire » AVANT tout merge — sert à détecter
    // si le chargement aboutit à MOINS de contenu que ce qui était sauvegardé localement
    // (scénario : modif PC non synchronisée écrasée par le remote au rechargement).
    const preloadSnapshotPromise = getLatestSnapshot().catch(() => null);

    loadLocalData()
      .then((d) => { if (d.length) setProjets(d); })
      .catch(() => {})
      .finally(() => setHydrated(true));

    loadData()
      .then((remotePs) => {
        setLoadError(null);
        if (!remotePs.length) return;
        if (userModified.current) return;

        const filteredRemote = remotePs.filter(p => !deletedIdsRef.current.has(p.id));
        const { allMerged, keptLocal, keptLocalIds, unsynced } = mergeWithLocal(filteredRemote, projetsRef.current, dirtyIds.current, previousRemoteIds);
        // Mark locally-newer and unsynced projects dirty so saves are targeted.
        // Prevents the "save ALL when dirtyIds={}" path from re-inserting projects
        // that were deleted by another user between our loadData() and our save.
        keptLocalIds.forEach(id => dirtyIds.current.add(id));
        unsynced.forEach(p => dirtyIds.current.add(p.id));
        setProjets(allMerged);

        if (keptLocal || unsynced.length > 0) userModified.current = true;

        // Filet boîte noire : si la dernière sauvegarde locale contenait nettement plus
        // de contenu que ce qu'on vient de charger, c'est une perte probable → on propose
        // une restauration (non destructive : l'utilisateur décide). Aucune restauration auto.
        preloadSnapshotPromise.then(snap => {
          if (!snap?.data) return;
          // Ignorer les instantanés trop anciens (> 14 j) pour limiter les faux positifs.
          if (Date.now() - snap.ts > 14 * 24 * 3600 * 1000) return;
          const lost = detectLoss(snap.data, allMerged);
          if (lost.length > 0) setBackupRecovery({ snapshot: snap, lost });
        }).catch(() => {});

        // Tout photo non-base64 a besoin d'une signed URL (chemin relatif ou URL expirée)
        const needsSignedUrl = p => !p.photo || !p.photo.startsWith('data:');
        const missingPhotoIds = allMerged.filter(needsSignedUrl).map(p => p.id);
        if (missingPhotoIds.length) {
          hydrateChantierPhotos(missingPhotoIds).then(photoMap => {
            if (!Object.keys(photoMap).length) return;
            setProjets(ps => ps.map(p => photoMap[p.id] ? { ...p, photo: photoMap[p.id] } : p));
          });
        }

        // Préchauffage cache plans. Les vignettes (bg) sont volumineuses et débordent
        // silencieusement de localStorage pour les gros projets (ex: OGEC) → on s'appuie
        // sur IndexedDB (quota en Go) : lecture cache d'abord (instantané, zéro réseau),
        // puis fetch réseau UNIQUEMENT pour les vignettes encore absentes, qu'on persiste
        // ensuite dans IndexedDB pour les sessions suivantes.
        const missingPlanIds = [...new Set(allMerged.flatMap(p =>
          (p.planLibrary || []).filter(pl => !pl.bg).map(pl => pl.id)
        ))];
        // Applique un map plat { planId: bg } à l'état en mémoire (planLibrary + loc.planBg)
        // Utilise la forme fonctionnelle de setProjets pour garantir qu'on opère toujours
        // sur l'état le plus récent — évite d'écraser les modifications texte de l'utilisateur
        // si applyPlanBgs se déclenche pendant qu'un rendu React est en cours.
        const applyPlanBgs = (bgById) => {
          if (!bgById || !Object.keys(bgById).length) return;
          setProjets(curr => {
            const warmed = curr.map(p => {
              const updatedPlanLib = (p.planLibrary || []).map(pl => ({ ...pl, bg: pl.bg ?? bgById[pl.id] ?? null }));
              const planBgById = new Map(updatedPlanLib.filter(pl => pl.bg).map(pl => [pl.id, pl.bg]));
              return {
                ...p,
                planLibrary: updatedPlanLib,
                visites: (p.visites || []).map(v => ({
                  ...v,
                  localisations: (v.localisations || []).map(loc => {
                    if (!loc.planId || loc.planBg) return loc;
                    const bg = planBgById.get(loc.planId);
                    return bg ? { ...loc, planBg: bg } : loc;
                  }),
                })),
              };
            });
            saveLocalCache(warmed);
            return warmed;
          });
        };
        if (missingPlanIds.length) {
          getPlanThumbs(missingPlanIds).then(cached => {
            applyPlanBgs(cached);
            const stillMissing = missingPlanIds.filter(id => !cached[id]);
            if (!stillMissing.length) return;
            loadAllPlanBgs(stillMissing).then(bgsByProject => {
              const flat = {};
              for (const byPlan of Object.values(bgsByProject || {})) Object.assign(flat, byPlan);
              const fetched = {};
              for (const id of stillMissing) if (flat[id]) fetched[id] = flat[id];
              applyPlanBgs(fetched);
              setPlanThumbs(fetched); // persistance durable pour les prochaines sessions
            }).catch(() => {});
          }).catch(() => {});
        }
      })
      .catch((e) => {
        console.error('Erreur chargement projets:', e);
        setLoadError(e?.message || 'Erreur de connexion à Supabase');
      })
      .finally(() => setRemoteLoaded(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!userModified.current) return;
    onSyncStatus?.('saving');
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (savingRef.current) return;
      if (!dirtyIds.current.size) { onSyncStatus?.('ok'); return; } // nothing to save — reset spinner
      savingRef.current = true;
      const ids = new Set(dirtyIds.current);
      dirtyIds.current.clear();
      const ok = await saveData(projets, onSyncStatus, ids);
      if (!ok) {
        dirtyIds.current = new Set([...ids, ...dirtyIds.current]); // restore on failure
        // Auto-retry after 15s — covers brief mobile network drops without user action
        clearTimeout(retryRef.current);
        retryRef.current = setTimeout(async () => {
          if (savingRef.current || !dirtyIds.current.size) return;
          savingRef.current = true;
          const retryIds = new Set(dirtyIds.current);
          dirtyIds.current.clear();
          const retryOk = await saveData(projetsRef.current, onSyncStatus, retryIds);
          if (!retryOk) dirtyIds.current = new Set([...retryIds, ...dirtyIds.current]);
          setPersistedDirtyIds(dirtyIds.current); // refléter l'état après (re)tentative
          savingRef.current = false;
        }, 15000);
      }
      // Persister l'état réel des dirtyIds après la sauvegarde (vidé si succès, restauré sinon).
      setPersistedDirtyIds(dirtyIds.current);
      savingRef.current = false;
    }, 2000);
    return () => clearTimeout(debounceRef.current);
  }, [hydrated, projets]);

  // Background refresh — called by the poll interval and on tab focus restore.
  // Silently merges remote changes when there are no pending local changes.
  const pollRemote = useCallback(async () => {
    if (savingRef.current || dirtyIds.current.size > 0) return;
    try {
      const previousRemoteIds = getPersistedRemoteIds();
      const remotePs = await loadData();
      if (!remotePs.length) return;
      const filteredRemote = remotePs.filter(p => !deletedIdsRef.current.has(p.id));
      const { allMerged, keptLocalIds } = mergeWithLocal(filteredRemote, projetsRef.current, dirtyIds.current, previousRemoteIds);
      // If local-only plans/locs were found, mark dirty and trigger a save
      if (keptLocalIds.size > 0) {
        keptLocalIds.forEach(id => dirtyIds.current.add(id));
        userModified.current = true;
      }
      // Only re-render if something actually changed
      const changed = allMerged.some((rp, i) => {
        const lp = projetsRef.current[i];
        return !lp || lp.updatedAt !== rp.updatedAt || lp.id !== rp.id;
      }) || allMerged.length !== projetsRef.current.length;
      if (changed) setProjets(allMerged);
    } catch (e) {
      // Ignore background refresh errors — no banner shown
    }
  }, []);

  // Plus de poll périodique (économie egress Supabase ~90%). La synchro distante
  // se fait : au chargement de l'app, au retour sur l'app (visibilitychange ≥15s),
  // et à la demande via le bouton "Actualiser" (refreshNow). La sauvegarde locale
  // reste automatique — aucune donnée n'est mise en péril.

  useEffect(() => {
    const flush = () => {
      if (!userModified.current) return;
      if (!dirtyIds.current.size) return; // nothing unsaved — skip to avoid "save ALL" with stale state
      // Boîte noire immédiate avant fermeture (filet ultime indépendant de la sync réseau).
      clearTimeout(snapshotRef.current);
      saveSnapshot(projetsRef.current);
      clearTimeout(debounceRef.current);
      if (!savingRef.current) saveData(projetsRef.current, onSyncStatus, new Set(dirtyIds.current));
    };
    // Avertir avant de quitter S'IL RESTE des modifs non synchronisées (fenêtre debounce 2 s
    // ou sync en échec) — empêche la fermeture qui faisait perdre le travail PC non sauvé.
    const warnUnsaved = (e) => {
      if (dirtyIds.current.size > 0) { e.preventDefault(); e.returnValue = ''; return ''; }
    };
    let hiddenAt = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        flush(); // save before backgrounding (iOS reliability)
      } else if (document.visibilityState === 'visible') {
        // Refresh from server when coming back after ≥15s away (cross-device sync)
        if (hiddenAt && Date.now() - hiddenAt >= 15000) pollRemote();
        hiddenAt = null;
      }
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('beforeunload', warnUnsaved);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('beforeunload', warnUnsaved);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pollRemote]);

  const pushHistory = () => {
    historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), projetsRef.current];
  };

  const updateProjet = (id, upd) => {
    pushHistory();
    dirtyIds.current.add(id);
    userModified.current = true;
    setProjets((ps) => ps.map((p) => p.id === id ? { ...p, ...upd, updatedAt: new Date().toISOString() } : p));
  };

  const deleteProjet = (id) => {
    pushHistory();
    userModified.current = true;
    deletedIdsRef.current.add(id); // empêche pollRemote de le restaurer avant que saveRemote supprime en DB
    setProjets((ps) => ps.filter((p) => p.id !== id));
    // Suppression immédiate sur Supabase — contourne la garde anti-mass-delete
    // qui bloquerait la suppression de plusieurs projets d'affilée.
    deleteRemoteProjet(id);
  };

  // Suppression immédiate d'un plan — contourne le debounce et supprime directement en DB.
  // Évite la résurrection du plan si l'app est fermée avant la sauvegarde différée.
  const deletePlanFromLibrary = (projectId, planId) => {
    pushHistory();
    dirtyIds.current.add(projectId);
    userModified.current = true;
    // Purge la référence dans toutes les zones (plan principal + extraPlans) pour éviter
    // des onglets « Plan » fantômes qui réapparaissent à chaque rechargement.
    const scrubLoc = (l) => {
      const next = { ...l, extraPlans: (l.extraPlans || []).filter(ep => ep.planId !== planId) };
      if (l.planId === planId) { next.planId = null; next.planBg = null; next.planData = null; next.planAnnotations = null; }
      return next;
    };
    setProjets(ps => ps.map(p => p.id !== projectId ? p : {
      ...p,
      updatedAt: new Date().toISOString(),
      planLibrary: (p.planLibrary || []).filter(pl => pl.id !== planId),
      visites: (p.visites || []).map(v => ({ ...v, localisations: (v.localisations || []).map(scrubLoc) })),
    }));
    deleteRemotePlan(projectId, planId);
  };

  const addProjet = (data) => {
    pushHistory();
    userModified.current = true;
    const visitId = crypto.randomUUID();
    const projet = {
      id: crypto.randomUUID(),
      nom: data.nom,
      adresse: data.adresse ?? '',
      maitreOuvrage: data.maitreOuvrage ?? '',
      photo: data.photo ?? null,
      statut: 'en_cours',
      planLibrary: [],
      updatedAt: new Date().toISOString(),
      visites: [{
        id: visitId,
        label: 'Visite 1',
        dateVisite: null,
        participants: [],
        tableauRecap: [],
        photosParLigne: 2,
        plansEnFin: false,
        rapportPageBreaks: [],
        localisations: [],
      }],
    };
    dirtyIds.current.add(projet.id);
    setProjets((ps) => [...ps, projet]);
    return projet;
  };

  // Charge les photos d'un projet. Si visiteId fourni, charge uniquement cette visite
  // et skip les items déjà hydratés — permet le lazy loading par visite.
  const hydratePhotos = async (projectId, visiteId = null) => {
    const projet = projetsRef.current.find(p => p.id === projectId);
    if (!projet) return;

    const targetVisites = visiteId
      ? (projet.visites || []).filter(v => v.id === visiteId)
      : (projet.visites || []);

    const itemIds = targetVisites.flatMap(v =>
      (v.localisations || []).flatMap(l =>
        (l.items || []).filter(i => !i._photosHydrated).map(i => i.id)
      )
    );
    if (!itemIds.length) return; // Tout déjà hydraté

    const photosMap = await loadProjectPhotos(itemIds);
    if (photosMap === null) return;

    setProjets(ps => ps.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        visites: (p.visites || []).map(v => {
          if (visiteId && v.id !== visiteId) return v; // Skip les autres visites
          return {
            ...v,
            localisations: (v.localisations || []).map(loc => ({
              ...loc,
              items: (loc.items || []).map(item => {
                if (item._photosHydrated) return item; // Déjà hydraté
                // Preserve annotated data URL and annotSizeScale from local cache — Supabase
                // only stores annotated_storage_url (signed URL) which may be null if the
                // upload failed or if the photo predates the annotation feature. Without this,
                // a page reload before the upload completes permanently loses ph.annotated.
                const existingByName = new Map(
                  (item.photos || []).filter(p => p.name).map(p => [p.name, p])
                );
                return {
                  ...item,
                  _photosHydrated: true,
                  photos: photosMap[item.id]
                    ? photosMap[item.id].map(ph => {
                        const existing = existingByName.get(ph.name);
                        return {
                          name:           ph.name ?? '',
                          data:           ph.data ?? null,
                          storage_url:    ph.storage_url ?? null,
                          annotated:      ph.annotated ?? existing?.annotated ?? null,
                          annotations:    ph.annotations ?? null,
                          annotSizeScale: existing?.annotSizeScale ?? null,
                          _id:            ph.id,
                          _legacy:        ph._legacy ?? false,
                        };
                      })
                    : [],
                };
              }),
            })),
          };
        }),
      };
    }));

    // Preload images into browser cache so thumbnails appear instantly on next render
    Object.values(photosMap).forEach(photos => {
      photos.forEach(ph => {
        if (ph.data) { const i = new Image(); i.src = ph.data; }
        if (ph.annotated) { const i = new Image(); i.src = ph.annotated; }
      });
    });

    // Migration background : legacy base64 → Storage
    const legacyPhotoIds = [];
    Object.values(photosMap).forEach(photos => {
      photos.forEach(ph => { if (ph._legacy && ph.id) legacyPhotoIds.push(ph.id); });
    });
    if (legacyPhotoIds.length > 0) {
      migratePhotosToStorage(legacyPhotoIds).then(migrated => {
        if (!Object.keys(migrated).length) return;
        setProjets(ps => ps.map(p => {
          if (p.id !== projectId) return p;
          return {
            ...p,
            visites: (p.visites || []).map(v => ({
              ...v,
              localisations: (v.localisations || []).map(loc => ({
                ...loc,
                items: (loc.items || []).map(item => ({
                  ...item,
                  photos: (item.photos || []).map(ph => ({
                    ...ph,
                    data: (ph._id && migrated[ph._id]) ? migrated[ph._id] : ph.data,
                    _legacy: (ph._id && migrated[ph._id]) ? false : ph._legacy,
                  })),
                })),
              })),
            })),
          };
        }));
      }).catch(e => console.warn('Background migration error:', e));
    }
  };

  const hydratePlans = async (projectId, libraryMap, { force = false } = {}) => {
    const plansMap = await hydratePlansRemote(projectId);

    // First pass: apply what we have from DB and library map.
    // En mode force (bouton Actualiser) : on réapplique le bg de la bibliothèque même
    // si la loc a déjà un planBg, pour corriger les fonds de plan périmés/manquants.
    const locsNeedingPdfRender = new Map(); // planId → Set<locId>
    const resolveBg = (p, planId) =>
      libraryMap?.[planId]?.bg || (p.planLibrary || []).find(pl => pl.id === planId)?.bg || null;
    const resolveData = (p, planId) =>
      libraryMap?.[planId]?.data || (p.planLibrary || []).find(pl => pl.id === planId)?.data || null;
    const firstPass = projetsRef.current.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        visites: (p.visites || []).map(v => ({
          ...v,
          localisations: (v.localisations || []).map(loc => {
            // Rafraîchir aussi les plans additionnels (extraPlans) dont le bg est dérivé du planId
            const newEPs = (loc.extraPlans || []).map(ep => {
              if (!ep.planId || (!force && ep.planBg)) return ep;
              const epBg = resolveBg(p, ep.planId);
              return epBg ? { ...ep, planBg: epBg, planData: resolveData(p, ep.planId) } : ep;
            });
            const epsChanged = newEPs.some((ep, i) => ep !== (loc.extraPlans || [])[i]);
            const withEPs = epsChanged ? { ...loc, extraPlans: newEPs } : loc;

            const fromDb = plansMap?.[loc.id];
            if (fromDb) return { ...withEPs, planBg: fromDb.planBg ?? withEPs.planBg, planData: fromDb.planData ?? withEPs.planData };
            if (loc.planId && (force || !loc.planBg)) {
              const libBg = resolveBg(p, loc.planId);
              if (libBg) {
                // _planDirty seulement quand on remplit un bg manquant (évite un ré-upload
                // inutile lors d'un simple rafraîchissement forcé d'une loc déjà hydratée)
                return loc.planBg
                  ? { ...withEPs, planBg: libBg, planData: resolveData(p, loc.planId) }
                  : { ...withEPs, planBg: libBg, planData: resolveData(p, loc.planId), _planDirty: true };
              }
              // Queue for PDF rendering fallback
              if (!locsNeedingPdfRender.has(loc.planId)) locsNeedingPdfRender.set(loc.planId, new Set());
              locsNeedingPdfRender.get(loc.planId).add(loc.id);
            }
            return withEPs;
          }),
        })),
      };
    });
    setProjets(firstPass);
    saveLocalCache(firstPass);

    // Second pass: for plans with no bg anywhere, try fetching PDF data and rendering
    if (locsNeedingPdfRender.size === 0) return;
    const renderedBgs = new Map(); // planId → { bg, data }
    for (const planId of locsNeedingPdfRender.keys()) {
      try {
        const fetched = await fetchPlanData(planId);
        if (!fetched) continue;
        const bg = fetched.bg || (fetched.data ? await renderPdfPage(fetched.data, 1) : null);
        if (bg) renderedBgs.set(planId, { bg, data: fetched.data ?? null });
      } catch {}
    }
    if (renderedBgs.size === 0) return;

    // Compute inline so we can call saveLocalCache in the same pass — critical to persist
    // the rendered thumbnail to localStorage. Without this, the PDF re-renders from scratch
    // on every session reload (10s+ delay each time).
    const withRendered = projetsRef.current.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        planLibrary: (p.planLibrary || []).map(pl => {
          const r = renderedBgs.get(pl.id);
          return r ? { ...pl, bg: r.bg ?? pl.bg, data: r.data ?? pl.data } : pl;
        }),
        visites: (p.visites || []).map(v => ({
          ...v,
          localisations: (v.localisations || []).map(loc => {
            if (!loc.planId || loc.planBg) return loc;
            const r = renderedBgs.get(loc.planId);
            if (!r) return loc;
            return { ...loc, planBg: r.bg, planData: r.data, _planDirty: true };
          }),
        })),
      };
    });
    setProjets(withRendered);
    saveLocalCache(withRendered);
    // Persiste les vignettes re-rendues dans IndexedDB (évite un re-rendu PDF coûteux
    // à chaque session — le re-rendu pouvait prendre 10s+).
    setPlanThumbs(Object.fromEntries([...renderedBgs].map(([id, v]) => [id, v.bg])));
  };

  const hydratePlanLibrary = async (projectId, { force = false } = {}) => {
    // Skip remote fetch if every plan already has bg in memory (from localStorage or previous fetch)
    // — sauf en mode force (bouton Actualiser) : on veut alors rafraîchir depuis le serveur,
    // car projetsRef.current peut être périmé juste après un poll (mise à jour via useEffect).
    const proj = projetsRef.current.find(p => p.id === projectId);
    const plans = proj?.planLibrary || [];
    if (!force && plans.length > 0 && plans.every(pl => pl.bg != null)) {
      return Object.fromEntries(plans.map(pl => [pl.id, { bg: pl.bg, data: pl.data ?? null }]));
    }

    const plansMap = await hydratePlanLibraryRemote(projectId);
    if (!plansMap || !Object.keys(plansMap).length) return plansMap || {};
    // Build updated list inline and also fill loc.planBg in the same pass so both
    // planLibrary[].bg and loc.planBg are persisted to localStorage together.
    // Without this, loc.planBg is only set by hydratePlans (in-memory) and never reaches
    // localStorage, causing a blank thumbnail on every session open until hydratePlans fires.
    const updatedPs = projetsRef.current.map(p => {
      if (p.id !== projectId) return p;
      const updatedPlanLib = (p.planLibrary || []).map(pl => {
        const fetched = plansMap[pl.id];
        if (!fetched) return pl;
        return { ...pl, bg: fetched.bg ?? pl.bg, data: fetched.data ?? pl.data };
      });
      const planBgById = new Map(updatedPlanLib.filter(pl => pl.bg).map(pl => [pl.id, pl.bg]));
      return {
        ...p,
        planLibrary: updatedPlanLib,
        visites: (p.visites || []).map(v => ({
          ...v,
          localisations: (v.localisations || []).map(loc => {
            if (!loc.planId || (!force && loc.planBg)) return loc;
            const bg = planBgById.get(loc.planId);
            return bg ? { ...loc, planBg: bg } : loc;
          }),
        })),
      };
    });
    setProjets(updatedPs);
    saveLocalCache(updatedPs);
    // Persiste les vignettes dans IndexedDB (durable, contrairement à localStorage qui
    // déborde) → chargement instantané dès la session suivante.
    setPlanThumbs(Object.fromEntries(
      Object.entries(plansMap).filter(([, v]) => v?.bg).map(([id, v]) => [id, v.bg])
    ));
    return plansMap; // { planId: { bg, data } }
  };

  const undo = useCallback(() => {
    if (!historyRef.current.length) return false;
    const prev = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    userModified.current = true;
    // Marquer dirty les projets qui diffèrent entre l'état actuel et l'état restauré
    const currMap = new Map(projetsRef.current.map(p => [p.id, p]));
    for (const p of prev) {
      const curr = currMap.get(p.id);
      if (!curr || curr.updatedAt !== p.updatedAt) dirtyIds.current.add(p.id);
    }
    setProjets(prev);
    return true;
  }, []);

  const canUndo = () => historyRef.current.length > 0;

  // Synchro distante à la demande (bouton "Actualiser"). Renvoie une promesse
  // pour permettre l'affichage d'un spinner. Sans effet si une sauvegarde est
  // en cours ou si des modifs locales sont en attente (pollRemote s'auto-protège).
  const refreshNow = useCallback(() => pollRemote(), [pollRemote]);

  // Restauration depuis la boîte noire — déclenchée UNIQUEMENT par l'utilisateur (bandeau).
  // Restaure le texte/structure des projets détectés comme perdus, remet les items en
  // "photos non hydratées" (les photos se rechargent depuis Storage via storage_url), et
  // marque les projets dirty pour qu'ils soient re-poussés vers Supabase.
  const restoreFromBackup = useCallback(() => {
    const rec = backupRecovery;
    if (!rec?.snapshot?.data?.length) { setBackupRecovery(null); return; }
    const lostIds  = new Set(rec.lost.map(l => l.id));
    const snapById = new Map(rec.snapshot.data.filter(p => p?.id).map(p => [p.id, p]));
    const resetPhotos = (p) => ({
      ...p,
      visites: (p.visites || []).map(v => ({
        ...v,
        localisations: (v.localisations || []).map(loc => ({
          ...loc,
          items: (loc.items || []).map(it => ({ ...it, _photosHydrated: false })),
        })),
      })),
    });
    pushHistory();
    userModified.current = true;
    setProjets(curr => {
      const currIds = new Set(curr.map(p => p.id));
      const replaced = curr.map(p => {
        if (!lostIds.has(p.id) || !snapById.has(p.id)) return p;
        return { ...resetPhotos(snapById.get(p.id)), updatedAt: new Date().toISOString() };
      });
      const missing = rec.lost
        .filter(l => l.kind === 'missing' && !currIds.has(l.id) && snapById.has(l.id))
        .map(l => ({ ...resetPhotos(snapById.get(l.id)), updatedAt: new Date().toISOString() }));
      const next = [...replaced, ...missing];
      saveLocalCache(next);
      return next;
    });
    lostIds.forEach(id => dirtyIds.current.add(id));
    setBackupRecovery(null);
  }, [backupRecovery]);

  const dismissBackupRecovery = useCallback(() => setBackupRecovery(null), []);

  return { projets, setProjets, updateProjet, deleteProjet, deletePlanFromLibrary, addProjet, hydrated, remoteLoaded, loadError, hydratePhotos, hydratePlans, hydratePlanLibrary, undo, canUndo, refreshNow, backupRecovery, restoreFromBackup, dismissBackupRecovery };
}
