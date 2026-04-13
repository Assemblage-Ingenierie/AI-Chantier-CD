import { useState, useEffect, useRef } from 'react';
import { loadData, loadLocalData, saveData } from '../lib/storage.js';

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
        if (userModified.current) {
          // L'utilisateur a déjà modifié → on ne touche pas l'état,
          // mais on re-tente la synchro Supabase des données locales
          saveData(projetsRef.current, onSyncStatus);
          return;
        }
        // Fusionner : garder les projets locaux absents de Supabase (non encore synchronisés)
        const remoteIds = new Set(remotePs.map(p => p.id));
        const unsynced = projetsRef.current.filter(p => !remoteIds.has(p.id));
        if (unsynced.length > 0) {
          const merged = [...remotePs, ...unsynced]
            .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
          setProjets(merged);
          // Déclencher une sauvegarde pour pousser les projets non synchronisés vers Supabase
          userModified.current = true;
        } else {
          setProjets(remotePs);
        }
      })
      .catch(() => {});
  }, []);

  // Sauvegarde avec debounce 2s
  useEffect(() => {
    if (!hydrated) return;
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
