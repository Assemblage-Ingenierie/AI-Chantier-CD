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
  if (items.length === 0) return [{ type: 'reformulation', text: text.trim() }];

  return items.map(raw => {
    // Détecter le type selon le préfixe [R] ou [T]
    const rMatch = raw.match(/^\[R\]\s*/i);
    const tMatch = raw.match(/^\[T\]\s*/i);
    if (rMatch) return { type: 'reformulation', text: raw.slice(rMatch[0].length).trim() };
    if (tMatch) return { type: 'technique', text: raw.slice(tMatch[0].length).trim() };
    return { type: 'reformulation', text: raw };
  });
}

export default function IASug({ content, onApply }) {
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
    // Annuler la requête en cours si besoin
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    reset();
  };

  const ask = async () => {
    if (loading) return; // empêche les requêtes concurrentes
    // Annuler toute requête précédente
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

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
        max_tokens: 900,
        system: 'Tu es expert MOE/BET bâtiment et rédiges des comptes-rendus de visite chantier. Français technique, concis, professionnel.',
        messages: [{
          role: 'user',
          content: `Observation de chantier :\n\n"${texte}"\n\nGénère 4 propositions numérotées :\n1. [R] reformulation professionnelle concise\n2. [R] autre reformulation (angle différent)\n3. [T] suggestion technique : action corrective ou point de vigilance\n4. [T] suggestion technique : préconisation ou réserve formelle\n\nFormat strict : "1. [R] texte", "2. [R] texte", "3. [T] texte", "4. [T] texte". Une par ligne, sans introduction.`,
        }],
        _signal: controller.signal,
      });
      if (controller.signal.aborted) return; // fermé pendant la requête
      const rawText = d.content?.[0]?.text || '';
      if (!rawText) throw new Error('Réponse vide du modèle');
      setSuggestions(parseSuggestions(rawText));
    } catch (e) {
      if (controller.signal.aborted) return; // annulation volontaire, pas d'erreur
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
        style={{ fontSize: 11, border: `1px solid ${open ? '#8B5CF6' : DA.border}`, borderRadius: 20, padding: '3px 10px', background: open ? '#F5F3FF' : 'white', color: open ? '#7C3AED' : DA.gray, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Ic n="spk" s={10}/> {open ? 'Fermer IA' : 'Suggestions IA'}
      </button>

      {open && (
        <div style={{ marginTop: 8, background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, padding: 12 }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#7C3AED' }}>
                <Ic n="spn" s={12}/> Analyse en cours…
              </div>
              <button onClick={handleClose} style={{ fontSize: 11, color: '#7C3AED', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Annuler</button>
            </div>
          ) : error ? (
            <div style={{ fontSize: 12, color: '#B91C1C' }}>
              {error}
              <button onClick={ask} style={{ marginLeft: 8, fontSize: 11, color: '#7C3AED', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Réessayer</button>
            </div>
          ) : suggestions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#7C3AED', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Suggestions IA — valide ce qui te convient</p>
              {suggestions.map((sug, i) => {
                const isTech = sug.type === 'technique';
                const accent = isTech ? '#059669' : '#7C3AED';
                const bgActive = isTech ? '#D1FAE5' : '#EDE9FE';
                const borderActive = isTech ? '#059669' : '#8B5CF6';
                return (
                  <div key={i} style={{ background: applied.has(i) ? bgActive : 'white', border: `1px solid ${applied.has(i) ? borderActive : '#DDD6FE'}`, borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 3 }}>
                        {isTech ? 'Technique' : 'Reformulation'}
                      </span>
                      <span style={{ fontSize: 12, color: '#1e1e2e', lineHeight: 1.5 }}>{sug.text}</span>
                    </div>
                    <button
                      onClick={() => handleApply(sug.text, i)}
                      disabled={applied.has(i)}
                      style={{ flexShrink: 0, background: applied.has(i) ? accent : accent, color: 'white', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: applied.has(i) ? 'default' : 'pointer', opacity: applied.has(i) ? 0.6 : 1, minWidth: 60 }}>
                      {applied.has(i) ? '✓' : 'Valider'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
