import { useState, useEffect, useRef } from 'react';
import { loadData, loadLocalData, saveData, saveLocalCache, loadProjectPhotos, migratePhotosToStorage } from '../lib/storage.js';

export function useProjets(onSyncStatus) {
  const [projets, setProjets] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const debounceRef = useRef(null);
  const projetsRef = useRef(projets);
  const userModified = useRef(false);

  useEffect(() => { projetsRef.current = projets; }, [projets]);

  useEffect(() => {
    loadLocalData()
      .then((d) => { if (d.length) setProjets(d); })
      .catch(() => {})
      .finally(() => setHydrated(true));

    loadData()
      .then((remotePs) => {
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
            return lp;
          }
          // Préserver les photos déjà hydratées (évite la race condition loadData ↔ hydratePhotos)
          if (!lp) return rp;
          return {
            ...rp,
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
      })
      .catch(() => {})
      .finally(() => setRemoteLoaded(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!userModified.current) return;
    onSyncStatus?.('saving');
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveData(projets, onSyncStatus);
    }, 2000);
    return () => clearTimeout(debounceRef.current);
  }, [hydrated, projets]);

  useEffect(() => {
    const flush = () => {
      if (!userModified.current) return;
      clearTimeout(debounceRef.current);
      saveData(projetsRef.current, onSyncStatus);
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  const updateProjet = (id, upd) => {
    userModified.current = true;
    setProjets((ps) => ps.map((p) => p.id === id ? { ...p, ...upd, updatedAt: new Date().toISOString() } : p));
  };

  const deleteProjet = (id) => {
    userModified.current = true;
    setProjets((ps) => ps.filter((p) => p.id !== id));
  };

  const addProjet = (data) => {
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

  return { projets, setProjets, updateProjet, deleteProjet, addProjet, hydrated, remoteLoaded, hydratePhotos };
}
