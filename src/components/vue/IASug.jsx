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

// Pour les URLs Supabase (cross-origin), toDataURL() sur canvas est bloqué par le navigateur.
// On fetch le blob directement pour obtenir un data URL local sans taint canvas.
const toDataUrlSafe = async (url) => {
  if (!url) return null;
  if (url.startsWith('data:')) {
    // data URL locale — resize via canvas normalement
    return new Promise((res) => {
      const img = new window.Image();
      img.onload = () => {
        const MAX = 800;
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        try { res(cv.toDataURL('image/jpeg', 0.75)); } catch { res(url); }
      };
      img.onerror = () => res(url);
      img.src = url;
    });
  }
  // URL externe (Supabase signed URL) — fetch blob pour éviter le taint canvas
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const blob = await resp.blob();
  const base = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  // Resize depuis le data URL local (pas de taint)
  return new Promise((res) => {
    const img = new window.Image();
    img.onload = () => {
      const MAX = 800;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      try { res(cv.toDataURL('image/jpeg', 0.75)); } catch { res(base); }
    };
    img.onerror = () => res(base);
    img.src = base;
  });
};

export default function IASug({ content, commentaire, photos = [], onApply, onApplyTitle, onApplyUrgence }) {
  const [open, setOpen]             = useState(false);
  const [step, setStep]             = useState('idle'); // idle | photos | suggest | done | error
  const [photoResult, setPhotoResult] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError]           = useState(null);
  const [applied, setApplied]       = useState(new Set());
  const abortRef = useRef(null);

  const hasPhotos = photos.filter(ph => ph.data).length > 0;

  useEffect(() => {
    if (step !== 'photos' && step !== 'suggest') return;
    const t = setTimeout(() => {
      abortRef.current?.abort();
      setStep('error');
      setError('Délai dépassé — réessaie');
    }, 55000);
    return () => clearTimeout(t);
  }, [step]);

  const handleClose = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    setStep('idle');
    setPhotoResult(null);
    setSuggestions([]);
    setError(null);
    setApplied(new Set());
  };

  const ask = async () => {
    if (step === 'photos' || step === 'suggest') return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setOpen(true);
    setError(null);
    setPhotoResult(null);
    setSuggestions([]);
    setApplied(new Set());

    let photoCtx = null;

    // Step 1: analyze photos if any
    if (hasPhotos) {
      setStep('photos');
      try {
        const valid = photos.filter(ph => ph.data).slice(0, 3);
        const imgs = (await Promise.all(valid.map(async ph => {
          const dataUrl = await toDataUrlSafe(ph.data);
          if (!dataUrl) return null;
          const [hdr, b64] = dataUrl.split(',');
          const mt = hdr.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
          return { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } };
        }))).filter(Boolean);
        const r = await callAIProxy({
          feature: 'photoAnalysis',
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: `Tu es un ingénieur bâtiment. Sois très synthétique (2-3 phrases max). N'utilise jamais le tiret médiant (—). Réponds UNIQUEMENT avec un JSON valide :\n{"titre":"5-7 mots décrivant le désordre","urgence":"haute"|"moyenne"|"basse","commentaire":"1-2 phrases: désordre constaté et action à mener"}`,
          messages: [{ role: 'user', content: [...imgs, { type: 'text', text: 'Analyse ces photos de chantier.' }] }],
          _signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        const raw = r.content?.[0]?.text || '';
        photoCtx = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim());
        setPhotoResult(photoCtx);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        // photo analysis failed silently — continue with suggestions only
      }
    }

    // Step 2: generate technical suggestions
    setStep('suggest');
    try {
      const titre  = (content || photoCtx?.titre || '').slice(0, 300);
      const texte  = (commentaire || '').slice(0, 2000);
      const photo  = photoCtx?.commentaire ? `Analyse photos: "${photoCtx.commentaire}"` : '';
      const hasCtx = texte.trim().length > 20 || photo;

      const prompt = hasCtx
        ? `Observation de chantier :\nTitre : "${titre}"\n${photo}\n${texte ? `Commentaire rédigé : "${texte}"` : ''}\n\nTu es un expert MOE/BET. Génère TOUTES les suggestions pertinentes pour COMPLÉTER (3 à 10) :\n- préconisations techniques (DTU, normes, tolérances)\n- réserves formelles à notifier\n- points de vigilance pour la prochaine visite\n- actions correctives concrètes\n- essais ou contrôles à demander\nNe répète JAMAIS ce qui est déjà écrit. Sois direct, précis, technique.\nFormat strict : "1. texte", "2. texte". Sans intro ni conclusion.`
        : `Observation de chantier : "${titre}"\nTu es un expert MOE/BET. Génère 3 à 10 suggestions techniques liées à ce désordre.\nFormat strict : "1. texte", "2. texte". Sans intro ni conclusion.`;

      const d = await callAIProxy({
        feature: 'observation-suggestion',
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: `Tu es expert MOE/BET bâtiment senior. Suggestions ultra-précises et contextuelles, jamais vagues. N'utilise jamais le tiret médiant (—) ni les tirets longs.`,
        messages: [{ role: 'user', content: prompt }],
        _signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      const raw = d.content?.[0]?.text || '';
      if (!raw) throw new Error('Réponse vide');
      setSuggestions(parseSuggestions(raw));
      setStep('done');
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e.message || 'Erreur de connexion');
      setStep('error');
    }
  };

  const addApplied = (key) => setApplied(prev => new Set([...prev, key]));

  const loading = step === 'photos' || step === 'suggest';

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={loading ? handleClose : (open ? handleClose : ask)}
        style={{
          fontSize: 12,
          fontWeight: 700,
          border: `1.5px solid ${open ? DA.black : DA.border}`,
          borderRadius: 8,
          padding: '7px 13px',
          background: open ? DA.black : 'white',
          color: open ? 'white' : DA.black,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          transition: 'background 0.15s, color 0.15s, border-color 0.15s',
        }}>
        <span style={{ color: open ? 'white' : DA.red, lineHeight: 0, display: 'inline-flex' }}>
          <Ic n={loading ? 'spn' : 'spk'} s={13}/>
        </span>
        {loading ? 'Annuler' : (open ? 'Fermer IA' : 'Générer avec IA')}
      </button>

      {open && (
        <div style={{ marginTop: 8, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: 12 }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#059669' }}>
                <Ic n="spn" s={12}/> {step === 'photos' ? 'Analyse des photos…' : 'Génération des suggestions…'}
              </div>
              <button onClick={handleClose} style={{ fontSize: 11, color: '#059669', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Annuler</button>
            </div>
          )}

          {step === 'error' && (
            <div style={{ fontSize: 12, color: '#B91C1C' }}>
              {error}
              <button onClick={ask} style={{ marginLeft: 8, fontSize: 11, color: '#059669', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Réessayer</button>
            </div>
          )}

          {step === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

              {/* Photo analysis block */}
              {photoResult && (
                <>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#059669', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Analyse des photos</p>

                  {photoResult.titre && onApplyTitle && (
                    <div style={{ background: applied.has('ph_t') ? '#D1FAE5' : 'white', border: `1px solid ${applied.has('ph_t') ? '#059669' : '#A7F3D0'}`, borderRadius: 8, padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 1 }}>Titre</div>
                        <span style={{ fontSize: 12, color: '#1e1e2e' }}>{photoResult.titre}</span>
                      </div>
                      <button onClick={() => { onApplyTitle(photoResult.titre); addApplied('ph_t'); }} disabled={applied.has('ph_t')}
                        style={{ flexShrink: 0, background: '#059669', color: 'white', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: applied.has('ph_t') ? 'default' : 'pointer', opacity: applied.has('ph_t') ? 0.5 : 1 }}>
                        {applied.has('ph_t') ? '✓' : 'Appliquer'}
                      </button>
                    </div>
                  )}

                  {photoResult.commentaire && (
                    <div style={{ background: applied.has('ph_c') ? '#D1FAE5' : 'white', border: `1px solid ${applied.has('ph_c') ? '#059669' : '#A7F3D0'}`, borderRadius: 8, padding: '7px 10px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 1 }}>Description</div>
                        <span style={{ fontSize: 12, color: '#1e1e2e', lineHeight: 1.5 }}>{photoResult.commentaire}</span>
                      </div>
                      <button onClick={() => { onApply(photoResult.commentaire); addApplied('ph_c'); }} disabled={applied.has('ph_c')}
                        style={{ flexShrink: 0, background: '#059669', color: 'white', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: applied.has('ph_c') ? 'default' : 'pointer', opacity: applied.has('ph_c') ? 0.5 : 1 }}>
                        {applied.has('ph_c') ? '✓' : 'Ajouter'}
                      </button>
                    </div>
                  )}

                  {photoResult.urgence && onApplyUrgence && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#059669' }}>Urgence suggérée :</span>
                      <button onClick={() => { onApplyUrgence(photoResult.urgence); addApplied('ph_u'); }} disabled={applied.has('ph_u')}
                        style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: 'none',
                          background: photoResult.urgence === 'haute' ? '#FEE2E2' : photoResult.urgence === 'moyenne' ? '#FEF3C7' : '#ECFDF5',
                          color: photoResult.urgence === 'haute' ? '#991B1B' : photoResult.urgence === 'moyenne' ? '#92400E' : '#065F46',
                          cursor: applied.has('ph_u') ? 'default' : 'pointer', opacity: applied.has('ph_u') ? 0.5 : 1 }}>
                        {photoResult.urgence}{applied.has('ph_u') ? ' ✓' : ''}
                      </button>
                    </div>
                  )}

                  {suggestions.length > 0 && <div style={{ height: 1, background: '#A7F3D0', margin: '4px 0' }}/>}
                </>
              )}

              {/* Technical suggestions */}
              {suggestions.length > 0 && (
                <>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#059669', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Suggestions techniques — ajoute ce qui te convient</p>
                  {suggestions.map((sug, i) => (
                    <div key={i} style={{ background: applied.has(i) ? '#D1FAE5' : 'white', border: `1px solid ${applied.has(i) ? '#059669' : '#A7F3D0'}`, borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 12, color: '#1e1e2e', lineHeight: 1.5 }}>{sug}</span>
                      <button onClick={() => { onApply(sug); addApplied(i); }} disabled={applied.has(i)}
                        style={{ flexShrink: 0, background: '#059669', color: 'white', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: applied.has(i) ? 'default' : 'pointer', opacity: applied.has(i) ? 0.5 : 1, minWidth: 60 }}>
                        {applied.has(i) ? '✓' : 'Ajouter'}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
