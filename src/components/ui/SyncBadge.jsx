import React from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from './Icons.jsx';

// Badge d'état de synchronisation — best practices :
//  - SILENCE quand tout va bien : l'état « synced » ne rend RIEN (pas de bruit visuel permanent).
//  - Jamais la couleur seule : chaque état a une FORME/icône distincte (daltonisme, plein soleil chantier).
//  - Compact par défaut ; le détail humain passe par l'attribut title (tooltip) au survol/tap.
//
// États : 'synced' | 'pending' | 'syncing' | 'stale' | 'error' | 'pinned' | 'notloaded'
const STYLES = {
  pending:   { bg:'#FFF7ED', fg:'#C2410C', bd:'#FED7AA', label:'Non synchronisé' },
  syncing:   { bg:'#EFF6FF', fg:'#1D4ED8', bd:'#BFDBFE', label:'Synchronisation…' },
  stale:     { bg:'#EFF6FF', fg:'#1D4ED8', bd:'#BFDBFE', label:'Mise à jour dispo' },
  error:     { bg:'#FEE2E2', fg:'#B91C1C', bd:'#FCA5A5', label:'Erreur de sync' },
  pinned:    { bg:'#ECFDF5', fg:'#047857', bd:'#A7F3D0', label:'Hors ligne prêt' },
  notloaded: { bg:DA.grayXL, fg:DA.grayL, bd:DA.border, label:'À télécharger' },
};

function Glyph({ state, size }) {
  if (state === 'syncing') return <Ic n="spn" s={size} />;
  if (state === 'stale')   return <Ic n="rld" s={size} />;
  if (state === 'pending') return <span style={{ width:size, height:size, borderRadius:'50%', background:'#C2410C', display:'inline-block' }} />;
  if (state === 'error')   return <span style={{ fontSize:size, lineHeight:1, fontWeight:900 }}>!</span>;
  if (state === 'pinned')  return <span style={{ fontSize:size, lineHeight:1 }}>📌</span>;
  if (state === 'notloaded') return <span style={{ fontSize:size + 1, lineHeight:1 }}>↓</span>;
  return null;
}

export default function SyncBadge({ state = 'synced', label, compact = false, size = 10, onClick, title, style }) {
  if (state === 'synced' || !STYLES[state]) return null;
  const s = STYLES[state];
  const text = label ?? s.label;
  const clickable = typeof onClick === 'function';
  return (
    <span
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(e); } : undefined}
      title={title ?? text}
      role={clickable ? 'button' : undefined}
      style={{
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: compact ? 0 : 4,
        fontSize: 10, fontWeight: 800, color: s.fg, background: s.bg,
        border: `1px solid ${s.bd}`, borderRadius: 20,
        padding: compact ? '3px' : '2px 8px', whiteSpace: 'nowrap',
        cursor: clickable ? 'pointer' : 'default', lineHeight: 1,
        minWidth: compact ? 18 : undefined, minHeight: compact ? 18 : undefined,
        justifyContent: 'center', ...style,
      }}
    >
      <Glyph state={state} size={size} />
      {!compact && <span>{text}</span>}
    </span>
  );
}

// Dérive l'état de sync d'un projet à partir des signaux disponibles.
// Ordre de priorité : erreur > sync en cours > modifs locales en attente > remote plus récent > à jour.
export function projectSyncState({ dirty, syncing, stale, error }) {
  if (error) return 'error';
  if (syncing && dirty) return 'syncing';
  if (dirty) return 'pending';
  if (stale) return 'stale';
  return 'synced';
}
