import { useState, useEffect, useRef } from 'react';
import { loadData, saveData } from '../lib/storage.js';

export function useProjets(onSyncStatus) {
  const [projets, setProjets] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const debounceRef = useRef(null);
  const projetsRef = useRef(projets);

  // Garde projetsRef à jour pour le handler beforeunload
  useEffect(() => { projetsRef.current = projets; }, [projets]);

  // Chargement initial
  useEffect(() => {
    loadData()
      .then((d) => { if (d.length) setProjets(d); })
      .catch(() => {})
      .finally(() => setHydrated(true));
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

  // Flush immédiat avant fermeture de l'onglet (évite la perte sur debounce en cours)
  useEffect(() => {
    const handleBeforeUnload = () => {
      clearTimeout(debounceRef.current);
      saveData(projetsRef.current, onSyncStatus);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const updateProjet = (id, upd) => {
    setProjets((ps) => ps.map((p) => p.id === id ? { ...p, ...upd, updatedAt: new Date().toISOString() } : p));
  };

  const deleteProjet = (id) => {
    setProjets((ps) => ps.filter((p) => p.id !== id));
  };

  const addProjet = (data) => {
    const projet = {
      id: crypto.randomUUID(),
      nom: data.nom,
      adresse: data.adresse ?? '',
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
