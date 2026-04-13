import { useState, useEffect, useRef } from 'react';
import { loadData, loadLocalData, saveData, saveLocalCache } from '../lib/storage.js';

export function useProjets(onSyncStatus) {
  const [projets, setProjets] = useState([]);
  const [hydrated, setHydrated] = useState(false);
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
        // (cas typique : save Supabase avait échoué, le local est plus à jour)
        let keptLocal = false;
        const merged = remotePs.map(rp => {
          const lp = localById.get(rp.id);
          if (lp?.updatedAt && rp.updatedAt && lp.updatedAt > rp.updatedAt) {
            keptLocal = true;
            return lp;
          }
          return rp;
        });

        const allMerged = [...merged, ...unsynced]
          .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));

        setProjets(allMerged);
        saveLocalCache(allMerged);

        // Pousser vers Supabase uniquement si on a réellement des données locales plus récentes
        const hasLocalChanges = unsynced.length > 0 || keptLocal;
        if (hasLocalChanges) userModified.current = true;
      })
      .catch(() => {});
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

  return { projets, setProjets, updateProjet, deleteProjet, addProjet, hydrated };
}
