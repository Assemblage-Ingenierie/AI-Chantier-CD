import { useState, useEffect, useRef } from 'react';
import { loadData, saveData } from '../lib/storage.js';

export function useProjets(onSyncStatus) {
  const [projets, setProjets] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const debounceRef = useRef(null);

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

  const updateProjet = (id, upd) => {
    setProjets((ps) => ps.map((p) => p.id === id ? { ...p, ...upd } : p));
  };

  const deleteProjet = (id) => {
    setProjets((ps) => ps.filter((p) => p.id !== id));
  };

  const addProjet = (data) => {
    const projet = {
      id: Date.now(),
      nom: data.nom,
      adresse: data.adresse ?? '',
      maitreOuvrage: data.maitreOuvrage ?? '',
      photo: data.photo ?? null,
      participants: [],
      statut: 'en_cours',
      tableauRecap: [],
      planLibrary: [],
      localisations: [],
    };
    setProjets((ps) => [...ps, projet]);
    return projet;
  };

  return { projets, setProjets, updateProjet, deleteProjet, addProjet, hydrated };
}
