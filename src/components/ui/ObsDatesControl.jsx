import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DA, SUIVI } from '../../lib/constants.js';
import { obsDatesInfo, todayIso } from '../../lib/obsDates.js';
import ObsDatesChip from './ObsDatesChip.jsx';

// Dates de suivi d'UNE observation, à droite de son bandeau (onglet Visite) — choix Thomas 20/10 :
// rien tant qu'on n'y touche pas. Non datée → petit bouton discret « Dater ». Un clic la date (date
// de la visite) et ouvre un mini-panneau pour ajuster ou retirer. Datée → la pastille, cliquable.
// onChange(item) reçoit l'observation complète mise à jour (dates ajoutées / modifiées / retirées).
export default function ObsDatesControl({ item, visitDate, onChange }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);
  const info = obsDatesInfo(item, visitDate);
  const ref = visitDate || todayIso();
  const done = item.suivi === 'fait';

  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const w = 248;
      setPos({ top: Math.min(r.bottom + 6, window.innerHeight - 170), left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)), w });
    };
    place();
    const onDown = (e) => { if (!panelRef.current?.contains(e.target) && !anchorRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const set = (patch) => {
    const next = { ...item, ...patch };
    Object.keys(patch).forEach(k => { if (patch[k] == null) delete next[k]; });
    onChange(next);
  };
  const stop = (e) => e.stopPropagation();

  const onAnchor = (e) => {
    e.stopPropagation();
    if (!info) set({ dateOuverture: ref, ...(done ? { dateCloture: ref } : {}) });
    setOpen(o => !o);
  };

  const field = { fontSize: 13, fontWeight: 600, color: DA.black, border: `1px solid ${DA.border}`, borderRadius: 7, padding: '5px 8px', fontFamily: 'inherit', background: 'white', minWidth: 0, width: '100%', boxSizing: 'border-box' };
  const lbl = { fontSize: 10, fontWeight: 800, color: DA.gray, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3, display: 'block' };

  return (
    <span ref={anchorRef} onClick={stop} style={{ display: 'inline-flex', flexShrink: 0 }}>
      {info ? (
        <button type="button" onClick={onAnchor} title="Modifier les dates de suivi"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex' }}>
          <ObsDatesChip info={info}/>
        </button>
      ) : (
        <button type="button" onClick={onAnchor} title="Dater cette observation (suivi d'une visite à l'autre)"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: DA.grayL,
            background: 'transparent', border: `1px dashed ${DA.border}`, borderRadius: 6, padding: '2px 7px', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.3 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>
          </svg>
          Dater
        </button>
      )}
      {open && pos && createPortal(
        <div ref={panelRef} onClick={stop} onPointerDown={stop} onMouseDown={stop} onTouchStart={stop}
          draggable={false} onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.w, zIndex: 9000, background: 'white', borderRadius: 12,
            border: `1px solid ${DA.border}`, boxShadow: '0 10px 30px rgba(0,0,0,0.18)', padding: 12, display: 'flex', flexDirection: 'column', gap: 9, boxSizing: 'border-box' }}>
          <label>
            <span style={lbl}>Ouverte le</span>
            <input type="date" value={item.dateOuverture || ''} max={done && item.dateCloture ? item.dateCloture : undefined}
              onChange={e => e.target.value && set({ dateOuverture: e.target.value })} style={field}/>
          </label>
          {done ? (
            <label>
              <span style={{ ...lbl, color: SUIVI.fait.text }}>Levée le</span>
              <input type="date" value={item.dateCloture || ''} min={item.dateOuverture || undefined}
                onChange={e => e.target.value && set({ dateCloture: e.target.value })} style={{ ...field, color: SUIVI.fait.text }}/>
            </label>
          ) : (
            <p style={{ margin: 0, fontSize: 11, color: DA.grayL, lineHeight: 1.35 }}>La date de levée se met toute seule quand l'observation passe « Fait ».</p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => { set({ dateOuverture: null, dateCloture: null }); setOpen(false); }}
              style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: `1px solid ${DA.border}`, background: 'white', color: DA.gray, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Retirer
            </button>
            <button type="button" onClick={() => setOpen(false)}
              style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', background: DA.red, color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              OK
            </button>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}
