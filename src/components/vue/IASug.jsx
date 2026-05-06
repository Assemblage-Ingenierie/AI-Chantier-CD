import React, { useState, useRef, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { callAIProxy } from '../../lib/aiProxy.js';

function parseSuggestions(text) {
  const lines = text.split('\n');
  const items = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^(\d+)[.)]\s+(.+)/);
    if (m) {
      if (current !== null) items.push(current.trim());
      current = m[2];
    } else if (current !== null && line.trim()) {
      current += ' ' + line.trim();
    }
  }
  if (current !== null) items.push(current.trim());
  if (items.length === 0) return [text.trim()];
  return items;
}

export default function IASug({ content, commentaire, onApply }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState(null);
  const [applied, setApplied] = useState(new Set());
  const abortRef = useRef(null);

  // Sécurité : si le loading dure plus de 35s, on force l'arrêt
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      abortRef.current?.abort();
      abortRef.current = null;
      setLoading(false);
      setError('Délai dépassé — vérifie ta connexion et réessaie');
    }, 35000);
    return () => clearTimeout(t);
  }, [loading]);

  const reset = () => {
    setSuggestions([]);
    setError(null);
    setApplied(new Set());
    setLoading(false);
  };

  const handleClose = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    reset();
  };

  const ask = async () => {
    if (loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setOpen(true);
    setError(null);
    setSuggestions([]);
    setApplied(new Set());

    try {
      const titre   = (content    || '').slice(0, 300);
      const texte   = (commentaire || '').slice(0, 2000);
      const hasText = texte.trim().length > 20;
      const prompt  = hasText
        ? `Observation de chantier :
Titre : "${titre}"
Commentaire déjà rédigé : "${texte}"

Tu es un expert MOE/BET. Génère TOUTES les suggestions pertinentes pour COMPLÉTER ce commentaire (entre 3 et 10 selon la richesse du sujet) :
- préconisations techniques précises (DTU, normes, tolérances chiffrées si applicables)
- réserves formelles à notifier à l'entreprise
- points de vigilance pour la prochaine visite
- actions correctives concrètes
- essais ou contrôles à demander

Règles absolues :
- Ne répète JAMAIS ce qui est déjà écrit dans le commentaire
- Chaque suggestion doit apporter une information nouvelle et utile
- Sois direct, précis, technique — jamais générique
- Si le sujet est riche (fissure, infiltration, structure…) génère jusqu'à 10 suggestions
- Si le sujet est simple, génère seulement ce qui est réellement pertinent (3-5 max)
Format strict : "1. texte", "2. texte", etc. Sans intro ni conclusion.`
        : `Observation de chantier : "${titre}"

Tu es un expert MOE/BET. Génère TOUTES les suggestions pertinentes liées à ce désordre spécifique (entre 3 et 10 selon la richesse du sujet) :
- actions correctives précises avec références DTU/normes si applicable
- réserves formelles à notifier à l'entreprise
- points de vigilance et contrôles à effectuer
- tolérances chiffrées si le désordre le permet
- essais ou investigations complémentaires éventuels

Règles absolues :
- Chaque suggestion doit être directement liée au désordre décrit, jamais générique
- Sois précis et technique — cite des références si pertinent
- Si le désordre est grave ou complexe, génère jusqu'à 10 suggestions
- Si simple, génère seulement ce qui est utile (3-5)
Format strict : "1. texte", "2. texte", etc. Sans intro ni conclusion.`;

      const d = await callAIProxy({
        feature: 'observation-suggestion',
        model: 'gemini-2.0-flash-lite',
        max_tokens: 2000,
        system: 'Tu es expert MOE/BET bâtiment senior, spécialiste des comptes-rendus de visite chantier et de la maîtrise d\'œuvre d\'exécution. Tu connais parfaitement les DTU, NF EN, règles professionnelles et tolérances de mise en œuvre. Tu génères des suggestions ultra-précises et contextuelles, jamais vagues ni génériques.',
        messages: [{ role: 'user', content: prompt }],
        _signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const rawText = d.content?.[0]?.text || '';
      if (!rawText) throw new Error('Réponse vide du modèle');
      setSuggestions(parseSuggestions(rawText));
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e.message || 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = (sug, i) => {
    onApply(sug);
    setApplied(prev => new Set([...prev, i]));
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={open ? handleClose : ask}
        disabled={loading && !open}
        style={{ fontSize: 11, border: `1px solid ${open ? '#059669' : DA.border}`, borderRadius: 20, padding: '3px 10px', background: open ? '#ECFDF5' : 'white', color: open ? '#059669' : DA.gray, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Ic n="spk" s={10}/> {open ? 'Fermer IA' : 'Suggestions IA'}
      </button>

      {open && (
        <div style={{ marginTop: 8, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: 12 }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#059669' }}>
                <Ic n="spn" s={12}/> Analyse en cours…
              </div>
              <button onClick={handleClose} style={{ fontSize: 11, color: '#059669', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Annuler</button>
            </div>
          ) : error ? (
            <div style={{ fontSize: 12, color: '#B91C1C' }}>
              {error}
              <button onClick={ask} style={{ marginLeft: 8, fontSize: 11, color: '#059669', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Réessayer</button>
            </div>
          ) : suggestions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#059669', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Suggestions techniques — ajoute ce qui te convient</p>
              {suggestions.map((sug, i) => (
                <div key={i} style={{ background: applied.has(i) ? '#D1FAE5' : 'white', border: `1px solid ${applied.has(i) ? '#059669' : '#A7F3D0'}`, borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 12, color: '#1e1e2e', lineHeight: 1.5 }}>{sug}</span>
                  <button
                    onClick={() => handleApply(sug, i)}
                    disabled={applied.has(i)}
                    style={{ flexShrink: 0, background: '#059669', color: 'white', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: applied.has(i) ? 'default' : 'pointer', opacity: applied.has(i) ? 0.5 : 1, minWidth: 60 }}>
                    {applied.has(i) ? '✓' : 'Ajouter'}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
