import React from 'react';
import { SUIVI } from '../../lib/constants.js';
import { fmtDateFr } from '../../lib/obsDates.js';

// Pastille « dates de suivi » d'une observation (cf. lib/obsDates.js), à droite des badges.
//   en cours : 📅 Ouverte le 09/04/2026 · en cours depuis 5 mois
//   levée    : 📅 Ouverte le 09/04/2026 → levée le 08/09/2026 (5 mois)
// `small` = taille rapport/PDF (page A4 de 630 px), sinon taille écran (onglet Visite).
export default function ObsDatesChip({ info, small = false }) {
  if (!info) return null;
  const fs = small ? 7.5 : 11;
  const open = !info.closed;
  const tone = open ? { text: '#9A3412', bg: '#FFF7ED', border: '#FED7AA' } : { text: SUIVI.fait.text, bg: SUIVI.fait.bg, border: SUIVI.fait.border };
  const showDur = info.duree && info.duree !== 'le jour même';
  return (
    <span title={open ? 'Observation ouverte (non levée)' : 'Observation levée'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: small ? 3 : 4, fontSize: fs, fontFamily: "'Open Sans', sans-serif", fontWeight: 600,
        color: tone.text, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: small ? 3 : 6,
        padding: small ? '1px 5px' : '2px 7px', whiteSpace: 'nowrap', lineHeight: 1.3, flexShrink: 0 }}>
      <svg width={fs + 1} height={fs + 1} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>
      </svg>
      <span style={{ fontWeight: 500, color: '#555' }}>Ouverte le</span>
      <span>{fmtDateFr(info.ouverture)}</span>
      {open
        ? (showDur && <span style={{ fontWeight: 500 }}>· en cours depuis {info.duree}</span>)
        : (info.fin && <><span style={{ fontWeight: 500 }}>→ levée le</span><span>{fmtDateFr(info.fin)}</span>{showDur && <span style={{ fontWeight: 500 }}>({info.duree})</span>}</>)}
    </span>
  );
}
