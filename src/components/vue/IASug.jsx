import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { callAIProxy } from '../../lib/aiProxy.js';

function parseSuggestions(text) {
  // Parse numbered suggestions: "1. ...\n2. ...\n3. ..."
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
  return items.length > 0 ? items : [text.trim()];
}

export default function IASug({ content, onApply }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState(null);
  const [applied, setApplied] = useState(new Set());

  const ask = async () => {
    setLoading(true);
    setOpen(true);
    setError(null);
    setSuggestions([]);
    setApplied(new Set());
    try {
      const texte = (content || '').slice(0, 2000);
      const d = await callAIProxy({
        feature: 'observation-suggestion',
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system: 'Expert MOE/BET bâtiment. Tu rédiges des comptes-rendus de visite chantier. Français, concis, professionnel.',
        messages: [{
          role: 'user',
          content: `Observation de chantier :\n\n"${texte}"\n\nPropose 3 reformulations professionnelles améliorées. Numérote-les 1. 2. 3. Une par ligne. Uniquement les suggestions, sans introduction ni explication.`,
        }],
      });
      const rawText = d.content?.[0]?.text || '';
      if (!rawText) throw new Error('Réponse vide');
      setSuggestions(parseSuggestions(rawText));
    } catch (e) {
      setError(e.message || 'Erreur de connexion');
    }
    setLoading(false);
  };

  const handleClose = () => {
    setOpen(false);
    setSuggestions([]);
    setError(null);
    setApplied(new Set());
  };

  const handleApply = (sug, i) => {
    onApply(sug);
    setApplied(prev => new Set([...prev, i]));
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={open ? handleClose : ask}
        style={{ fontSize: 11, border: `1px solid ${open ? '#8B5CF6' : DA.border}`, borderRadius: 20, padding: '3px 10px', background: open ? '#F5F3FF' : 'white', color: open ? '#7C3AED' : DA.gray, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Ic n="spk" s={10}/> {open ? 'Fermer IA' : 'Suggestions IA'}
      </button>

      {open && (
        <div style={{ marginTop: 8, background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, padding: 12 }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#7C3AED' }}>
              <Ic n="spn" s={12}/> Analyse en cours…
            </div>
          ) : error ? (
            <div style={{ fontSize: 12, color: '#B91C1C' }}>
              Erreur : {error}
              <button onClick={ask} style={{ marginLeft: 8, fontSize: 11, color: '#7C3AED', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Réessayer</button>
            </div>
          ) : suggestions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#7C3AED', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Suggestions IA — valide ce qui te convient</p>
              {suggestions.map((sug, i) => (
                <div key={i} style={{ background: applied.has(i) ? '#EDE9FE' : 'white', border: `1px solid ${applied.has(i) ? '#8B5CF6' : '#DDD6FE'}`, borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 12, color: '#4C1D95', lineHeight: 1.5 }}>{sug}</div>
                  <button
                    onClick={() => handleApply(sug, i)}
                    disabled={applied.has(i)}
                    style={{ flexShrink: 0, background: applied.has(i) ? '#8B5CF6' : '#7C3AED', color: 'white', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: applied.has(i) ? 'default' : 'pointer', opacity: applied.has(i) ? 0.7 : 1, minWidth: 60 }}>
                    {applied.has(i) ? '✓' : 'Valider'}
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
