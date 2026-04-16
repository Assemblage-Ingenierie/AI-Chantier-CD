import { useState, useEffect, useRef } from 'react';
import { loadData, loadLocalData, saveData, saveLocalCache, loadProjectPhotos, migratePhotosToStorage } from '../lib/storage.js';

export function useProjets(onSyncStatus) {
  const [projets, setProjets] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const debounceRef = useRef(null);
  const projetsRef = useRef(projets);
  const userModified = useRef(false);

  // Garde projetsRef à jour pour les handlers flush
  useEffect(() => { projetsRef.current = projets; }, [projets]);

  // Chargement en deux phases :
  // 1. Cache local → affichage instantané
  // 2. Supabase en arrière-plan → mise à jour si l'utilisateur n'a pas encore modifié
  useEffect(() => {
    loadLocalData()
      .then((d) => { if (d.length) setProjets(d); })
      .catch(() => {})
      .finally(() => setHydrated(true));

    loadData()
      .then((remotePs) => {
        if (!remotePs.length) return;
        if (userModified.current) return; // l'utilisateur édite déjà, on ne touche pas

        const localPs = projetsRef.current;
        const localById = new Map(localPs.map(p => [p.id, p]));
        const remoteIds = new Set(remotePs.map(p => p.id));

        // Projets locaux absents de Supabase (jamais synchronisés)
        const unsynced = localPs.filter(p => !remoteIds.has(p.id));

        // Pour chaque projet remote, préférer la version locale si elle est plus récente
        // ET préserver les photos déjà hydratées (évite que loadData n'écrase l'état
        // après que hydratePhotos() a déjà chargé les photos — race condition classique)
        let keptLocal = false;
        const merged = remotePs.map(rp => {
          const lp = localById.get(rp.id);
          if (lp?.updatedAt && rp.updatedAt && lp.updatedAt > rp.updatedAt) {
            keptLocal = true;
            return lp;
          }
          // Même si on prend la version remote, on préserve les photos déjà hydratées
          if (!lp) return rp;
          return {
            ...rp,
            localisations: (rp.localisations || []).map(loc => {
              const localLoc = lp.localisations?.find(l => l.id === loc.id);
              if (!localLoc) return loc;
              return {
                ...loc,
                items: (loc.items || []).map(item => {
                  const localItem = localLoc.items?.find(i => i.id === item.id);
                  if (localItem?._photosHydrated) {
                    // Garder les photos déjà chargées — ne pas les écraser avec []
                    return { ...item, photos: localItem.photos, _photosHydrated: true };
                  }
                  return item;
                }),
              };
            }),
          };
        });

        const allMerged = [...merged, ...unsynced]
          .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));

        setProjets(allMerged);
        saveLocalCache(allMerged);

        // Pousser vers Supabase uniquement si on a réellement des données locales plus récentes
        const hasLocalChanges = unsynced.length > 0 || keptLocal;
        if (hasLocalChanges) userModified.current = true;
      })
      .catch(() => {})
      .finally(() => setRemoteLoaded(true));
  }, []);

  // Sauvegarde avec debounce 2s — uniquement si l'utilisateur a modifié quelque chose
  useEffect(() => {
    if (!hydrated) return;
    if (!userModified.current) return; // pas de sauvegarde Supabase sur le chargement initial
    onSyncStatus?.('saving');
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveData(projets, onSyncStatus);
    }, 2000);
    return () => clearTimeout(debounceRef.current);
  }, [hydrated, projets]);

  // Flush immédiat avant fermeture/reload de l'onglet
  // pagehide est plus fiable que beforeunload sur iOS/mobile
  useEffect(() => {
    const flush = () => {
      if (!userModified.current) return; // rien à sauvegarder
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
    const projet = {
      id: crypto.randomUUID(),
      nom: data.nom,
      adresse: data.adresse ?? '',
      dateVisite: null,
      maitreOuvrage: data.maitreOuvrage ?? '',
      photo: data.photo ?? null,
      participants: [],
      statut: 'en_cours',
      tableauRecap: [],
      planLibrary: [],
      localisations: [],
      updatedAt: new Date().toISOString(),
    };
    setProjets((ps) => [...ps, projet]);
    return projet;
  };

  // Charge les photos complètes pour un projet sans déclencher de sauvegarde.
  // Positionne _photosHydrated:true sur tous les items (même ceux sans photos).
  const hydratePhotos = async (projectId) => {
    const projet = projetsRef.current.find(p => p.id === projectId);
    if (!projet) return;
    const itemIds = (projet.localisations || []).flatMap(l => (l.items || []).map(i => i.id));
    // Fetch même si certains items ont déjà des photos (cas rechargement).
    // null = erreur réseau/timeout → on ne touche pas l'état (évite d'écraser des photos valides)
    const photosMap = itemIds.length ? await loadProjectPhotos(itemIds) : {};
    if (photosMap === null) return;
    // Met à jour les photos dans le state SANS marquer userModified → pas de sauvegarde déclenchée
    // Inclut _id et _legacy pour la migration background ; ils seront strippés par toSlim() lors de la sauvegarde.
    setProjets(ps => ps.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        localisations: (p.localisations || []).map(loc => ({
          ...loc,
          items: (loc.items || []).map(item => ({
            ...item,
            _photosHydrated: true,
            photos: photosMap[item.id]
              ? photosMap[item.id].map(ph => ({ name: ph.name ?? '', data: ph.data ?? null, _id: ph.id, _legacy: ph._legacy ?? false }))
              : [],
          })),
        })),
      };
    }));

    // Migration background : photos legacy (base64 en DB) → Supabase Storage, une à la fois
    const legacyPhotoIds = [];
    Object.values(photosMap).forEach(photos => {
      photos.forEach(ph => { if (ph._legacy && ph.id) legacyPhotoIds.push(ph.id); });
    });
    if (legacyPhotoIds.length > 0) {
      migratePhotosToStorage(legacyPhotoIds).then(migrated => {
        if (!Object.keys(migrated).length) return;
        // Mettre à jour le state : remplacer null data par les URLs migrées
        setProjets(ps => ps.map(p => {
          if (p.id !== projectId) return p;
          return {
            ...p,
            localisations: (p.localisations || []).map(loc => ({
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
          };
        }));
      }).catch(e => console.warn('Background migration error:', e));
    }
  };

  return { projets, setProjets, updateProjet, deleteProjet, addProjet, hydrated, remoteLoaded, hydratePhotos };
}
