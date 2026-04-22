import { useState, useEffect, useRef, useCallback } from 'react';
import { loadData, loadLocalData, saveData, saveLocalCache, loadProjectPhotos, migratePhotosToStorage, hydratePlans as hydratePlansRemote, hydrateChantierPhotos, hydratePlanLibrary as hydratePlanLibraryRemote } from '../lib/storage.js';

const MAX_HISTORY = 20;

export function useProjets(onSyncStatus) {
  const [projets, setProjets] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const debounceRef = useRef(null);
  const projetsRef = useRef(projets);
  const userModified = useRef(false);
  const savingRef = useRef(false);
  const historyRef = useRef([]);
  const dirtyIds = useRef(new Set());

  useEffect(() => { projetsRef.current = projets; }, [projets]);

  useEffect(() => {
    loadLocalData()
      .then((d) => { if (d.length) setProjets(d); })
      .catch(() => {})
      .finally(() => setHydrated(true));

    loadData()
      .then((remotePs) => {
        setLoadError(null);
        if (!remotePs.length) return;
        if (userModified.current) return;

        const localPs  = projetsRef.current;
        const localById = new Map(localPs.map(p => [p.id, p]));
        const remoteIds = new Set(remotePs.map(p => p.id));
        const unsynced  = localPs.filter(p => !remoteIds.has(p.id));

        let keptLocal = false;
        const merged = remotePs.map(rp => {
          const lp = localById.get(rp.id);
          if (lp?.updatedAt && rp.updatedAt && lp.updatedAt > rp.updatedAt) {
            keptLocal = true;
            // Conserver les éditions locales mais restaurer les blobs (planBg, planLibrary.bg)
            // depuis le remote — slimLoc les strip toujours dans localStorage.
            const remotePlanById = new Map((rp.planLibrary || []).map(pl => [pl.id, pl]));
            return {
              ...lp,
              planLibrary: (lp.planLibrary || []).map(pl => {
                const rpl = remotePlanById.get(pl.id);
                return rpl ? { ...pl, bg: rpl.bg ?? pl.bg, data: rpl.data ?? pl.data } : pl;
              }),
              visites: (lp.visites || []).map(lv => {
                const rv = (rp.visites || []).find(v => v.id === lv.id);
                if (!rv) return lv;
                const remoteLocById = new Map((rv.localisations || []).map(l => [l.id, l]));
                return {
                  ...lv,
                  localisations: (lv.localisations || []).map(ll => {
                    const rl = remoteLocById.get(ll.id);
                    if (!rl) return ll;
                    return { ...ll, planBg: rl.planBg ?? ll.planBg, planData: rl.planData ?? ll.planData };
                  }),
                };
              }),
            };
          }
          // Préserver les photos déjà hydratées (évite la race condition loadData ↔ hydratePhotos)
          if (!lp) return rp;

          // photo non sélectionnée depuis Supabase (évite HTTP 500) → toujours garder la valeur locale
          const photo = lp.photo ?? rp.photo ?? null;

          // Projets archivés : le remote ne charge plus leurs items (optimisation mémoire).
          // On préserve donc les localisations/items du cache local.
          if (rp.statut === 'archive') {
            return { ...rp, photo, visites: lp.visites ?? rp.visites };
          }

          return {
            ...rp,
            photo,
            visites: (rp.visites || []).map(rv => {
              const lv = lp.visites?.find(v => v.id === rv.id);
              if (!lv) return rv;
              return {
                ...rv,
                localisations: (rv.localisations || []).map(loc => {
                  const localLoc = lv.localisations?.find(l => l.id === loc.id);
                  if (!localLoc) return loc;
                  return {
                    ...loc,
                    items: (loc.items || []).map(item => {
                      const localItem = localLoc.items?.find(i => i.id === item.id);
                      if (localItem?._photosHydrated) {
                        return { ...item, photos: localItem.photos, _photosHydrated: true };
                      }
                      return item;
                    }),
                  };
                }),
              };
            }),
          };
        });

        const allMerged = [...merged, ...unsynced]
          .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));

        setProjets(allMerged);
        saveLocalCache(allMerged);

        const hasLocalChanges = unsynced.length > 0 || keptLocal;
        if (hasLocalChanges) userModified.current = true;

        // Charger les photos de couverture manquantes en arrière-plan (non incluses dans SELECT)
        const missingPhotoIds = allMerged.filter(p => !p.photo).map(p => p.id);
        if (missingPhotoIds.length) {
          hydrateChantierPhotos(missingPhotoIds).then(photoMap => {
            if (!Object.keys(photoMap).length) return;
            setProjets(ps => ps.map(p => photoMap[p.id] ? { ...p, photo: photoMap[p.id] } : p));
          });
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
      savingRef.current = true;
      const ids = new Set(dirtyIds.current);
      dirtyIds.current.clear();
      const ok = await saveData(projets, onSyncStatus, ids);
      if (!ok) dirtyIds.current = new Set([...ids, ...dirtyIds.current]); // restore on failure
      savingRef.current = false;
    }, 2000);
    return () => clearTimeout(debounceRef.current);
  }, [hydrated, projets]);

  useEffect(() => {
    const flush = () => {
      if (!userModified.current) return;
      clearTimeout(debounceRef.current);
      if (!savingRef.current) saveData(projetsRef.current, onSyncStatus, new Set(dirtyIds.current));
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

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
    // Pas de dirtyIds ici — la suppression est gérée par le diff _lastRemoteIds
    userModified.current = true;
    setProjets((ps) => ps.filter((p) => p.id !== id));
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

  // Charge les photos pour un projet (cherche dans toutes les visites)
  const hydratePhotos = async (projectId) => {
    const projet = projetsRef.current.find(p => p.id === projectId);
    if (!projet) return;

    const itemIds = (projet.visites || []).flatMap(v =>
      (v.localisations || []).flatMap(l => (l.items || []).map(i => i.id))
    );
    const photosMap = itemIds.length ? await loadProjectPhotos(itemIds) : {};
    if (photosMap === null) return;

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
              _photosHydrated: true,
              photos: photosMap[item.id]
                ? photosMap[item.id].map(ph => ({ name: ph.name ?? '', data: ph.data ?? null, _id: ph.id, _legacy: ph._legacy ?? false }))
                : [],
            })),
          })),
        })),
      };
    }));

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

  const hydratePlans = async (projectId) => {
    const plansMap = await hydratePlansRemote(projectId);
    if (!plansMap || !Object.keys(plansMap).length) return;
    setProjets(ps => ps.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        visites: (p.visites || []).map(v => ({
          ...v,
          localisations: (v.localisations || []).map(loc => {
            const plan = plansMap[loc.id];
            if (!plan) return loc;
            return { ...loc, planBg: plan.planBg, planData: plan.planData };
          }),
        })),
      };
    }));
  };

  const hydratePlanLibrary = async (projectId) => {
    const plansMap = await hydratePlanLibraryRemote(projectId);
    if (!plansMap || !Object.keys(plansMap).length) return;
    setProjets(ps => ps.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        planLibrary: (p.planLibrary || []).map(pl => {
          const fetched = plansMap[pl.id];
          if (!fetched) return pl;
          return { ...pl, bg: fetched.bg ?? pl.bg, data: fetched.data ?? pl.data };
        }),
      };
    }));
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

  return { projets, setProjets, updateProjet, deleteProjet, addProjet, hydrated, remoteLoaded, loadError, hydratePhotos, hydratePlans, hydratePlanLibrary, undo, canUndo };
}
