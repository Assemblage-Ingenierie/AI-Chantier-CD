import React from 'react';
import { DA, SUIVI } from '../../lib/constants.js';
import { fmtDateFr } from '../../lib/obsDates.js';

// Pastille « dates de suivi » d'une observation ou d'une zone (cf. lib/obsDates.js), sur la ligne du titre.
//   en cours : 📅 Ouverte le 09/04/2026 · en cours depuis 5 mois
//   levée    : 📅 Ouverte le 09/04/2026 → levée le 08/09/2026 (5 mois)
// `fontSize` = taille du TITRE qu'elle accompagne (choix Thomas : « même taille que chaque titre,
// en rouge, que ce soit bien clair »). `small` = repli rapport/PDF, sinon taille écran.
export default function ObsDatesChip({ info, small = false, fontSize = null, wrap = false }) {
  if (!info) return null;
  const fs = fontSize ?? (small ? 7.5 : 11);
  const open = !info.closed;
  const tone = open ? { text: DA.red, bg: DA.redL, border: '#FCA5A5' } : { text: SUIVI.fait.text, bg: SUIVI.fait.bg, border: SUIVI.fait.border };
  const showDur = info.duree && info.duree !== 'le jour même';
  return (
    <span title={open ? 'Observation ouverte (non levée)' : 'Observation levée'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(fs * 0.35), fontSize: fs, fontFamily: "'Open Sans', sans-serif", fontWeight: 700,
        color: tone.text, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: Math.max(3, Math.round(fs * 0.45)),
        padding: `${Math.max(1, Math.round(fs * 0.12))}px ${Math.round(fs * 0.55)}px`, whiteSpace: 'nowrap', lineHeight: 1.3, flexShrink: 0,
        // wrap : écran étroit → les morceaux passent à la ligne au lieu d'être coupés.
        ...(wrap ? { flexWrap: 'wrap', maxWidth: '100%', boxSizing: 'border-box', rowGap: 1 } : {}) }}>
      <svg width={fs + 1} height={fs + 1} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>
      </svg>
      <span style={{ fontWeight: 600 }}>Ouverte le</span>
      <span>{fmtDateFr(info.ouverture)}</span>
      {open
        ? (showDur && <span style={{ fontWeight: 500 }}>· en cours depuis {info.duree}</span>)
        : (info.fin && <><span style={{ fontWeight: 500 }}>→ levée le</span><span>{fmtDateFr(info.fin)}</span>{showDur && <span style={{ fontWeight: 500 }}>({info.duree})</span>}</>)}
    </span>
  );
}
