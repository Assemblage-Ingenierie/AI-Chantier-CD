// Aperçu du rapport — contrôles de saut de page et de découpe.
// Extrait tel quel de RapportPreview.jsx (découpage du 02/11/2026, aucun changement de logique).
import { useState } from 'react';
import { DA } from '../../../lib/constants.js';
import { PW } from './layout.js';

// BreakControl — shown at zone boundaries WITHIN a page (suggestions + active removals)
export function BreakControl({ id, active, onToggle, zoneName }) {
  const [hover, setHover] = useState(false);

  if (active) {
    return (
      <div onClick={() => onToggle(id)}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ margin:'6px -9px', display:'flex', alignItems:'center', gap:10, padding:'8px 14px',
          background: hover ? '#c00010' : DA.red, cursor:'pointer', userSelect:'none',
          borderTop:'2px solid rgba(255,255,255,0.2)', borderBottom:'2px solid rgba(255,255,255,0.2)' }}>
        <span style={{ fontSize:12, lineHeight:1 }}>✂</span>
        <span style={{ fontSize:9, fontWeight:800, color:'white', flex:1, letterSpacing:0.3 }}>
          Saut de page actif{zoneName ? ` avant « ${zoneName} »` : ''} — cliquer pour annuler
        </span>
        <span style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,0.7)',
          background:'rgba(0,0,0,0.2)', borderRadius:3, padding:'2px 7px' }}>
          × Supprimer
        </span>
      </div>
    );
  }

  return (
    <div onClick={() => onToggle(id)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ margin:'4px -9px', display:'flex', alignItems:'center', gap:10, padding:'7px 14px',
        background: hover ? '#fff0f0' : '#fffafa',
        border: `1.5px dashed ${hover ? DA.red : '#f0b8b8'}`,
        borderLeft: 'none', borderRight: 'none',
        cursor:'pointer', userSelect:'none', transition:'background 0.1s' }}>
      <span style={{ fontSize:12, color: hover ? DA.red : '#d08080', lineHeight:1 }}>✂</span>
      <span style={{ fontSize:9, fontWeight:700, color: hover ? DA.red : '#c08080', flex:1 }}>
        {zoneName ? `Forcer une nouvelle page avant « ${zoneName} »` : 'Couper ici — insérer un saut de page'}
      </span>
      <span style={{ fontSize:8, color: hover ? DA.red : '#d0a0a0',
        background: hover ? '#ffe0e0' : '#fdf0f0', border:`1px solid ${hover ? '#fca5a5' : '#f0d0d0'}`,
        borderRadius:3, padding:'1px 6px', whiteSpace:'nowrap' }}>
        ⊕ Nouvelle page
      </span>
    </div>
  );
}

// TopBreakControl — shown at the TOP of a page when its first block has a forced break
// Allows users to remove the break directly from within the page
// Rendu hors flux (position:absolute) pour ne pas fausser la pagination visuelle.
export function TopBreakControl({ id, zoneName, onToggle }) {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ position:'relative', height:0, overflow:'visible' }}>
      <div onClick={() => onToggle(id)}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        title="Cliquer pour retirer ce saut de page"
        style={{ position:'absolute', top:-20, left:-9, right:-9, display:'flex', alignItems:'center', gap:6, padding:'3px 8px',
          background: hover ? '#c00010' : DA.red, cursor:'pointer', userSelect:'none',
          zIndex:40 }}>
        <span style={{ fontSize:9, lineHeight:1 }}>✂</span>
        <span style={{ fontSize:8, fontWeight:700, color:'white', flex:1, letterSpacing:0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          Saut forcé{zoneName ? ` · ${zoneName}` : ''}
        </span>
        <span style={{ fontSize:8, fontWeight:700, color:'rgba(255,255,255,0.85)' }}>
          × Retirer
        </span>
      </div>
    </div>
  );
}

// CutZone — séparateur interactif entre blocs (visible uniquement en mode coupe)
// Rendu hors flux (height:0) pour ne pas fausser la pagination visuelle.
export function CutZone({ blockId, active, onCut }) {
  const [hov, setHov] = useState(false);
  if (!active) return null;
  return (
    <div data-print="hide" style={{ position:'relative', height:0, overflow:'visible' }}>
      <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        onClick={(e) => { e.stopPropagation(); onCut(blockId); }}
        style={{ position:'absolute', top:-11, left:0, right:0, height:22, cursor:'crosshair', flexShrink:0, zIndex:50 }}>
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', opacity: hov ? 1 : 0.5, transition:'opacity 0.12s', background: hov ? 'rgba(227,5,19,0.07)' : 'transparent' }}>
          <div style={{ background:'#E30513', color:'white', padding:'2px 8px', fontSize:13, flexShrink:0, lineHeight:1 }}>✂</div>
          <div style={{ flex:1, height:2, background:'repeating-linear-gradient(90deg,#E30513 0,#E30513 8px,transparent 8px,transparent 14px)' }}/>
          {hov && <div style={{ background:'#E30513', color:'white', fontSize:8, fontWeight:800, padding:'2px 9px', flexShrink:0, whiteSpace:'nowrap' }}>Couper ici</div>}
        </div>
      </div>
    </div>
  );
}

// ParaCutZone — séparateur de segments texte dans un bloc (mode coupe)
// Rendu hors flux (height:0) pour ne pas fausser la pagination visuelle.
export function ParaCutZone({ paraId, onCut }) {
  const [hov, setHov] = useState(false);
  return (
    <div data-print="hide" style={{ position:'relative', height:0, overflow:'visible' }}>
      <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        onClick={(e) => { e.stopPropagation(); onCut(paraId); }}
        style={{ position:'absolute', top:-9, left:-9, right:-9, height:18, cursor:'crosshair', zIndex:50 }}>
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', opacity: hov ? 1 : 0.5, transition:'opacity 0.12s', background: hov ? 'rgba(227,5,19,0.07)' : 'transparent' }}>
          <div style={{ background:'#E30513', color:'white', padding:'1px 6px', fontSize:11, flexShrink:0, lineHeight:1 }}>✂</div>
          <div style={{ flex:1, height:1.5, background:'repeating-linear-gradient(90deg,#E30513 0,#E30513 6px,transparent 6px,transparent 10px)' }}/>
          {hov && <div style={{ background:'#E30513', color:'white', fontSize:7, fontWeight:800, padding:'1px 8px', flexShrink:0, whiteSpace:'nowrap' }}>Couper le texte ici</div>}
        </div>
      </div>
    </div>
  );
}

export function PlanCutBar({ breakId, forced, onCut }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      data-print="hide"
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={() => onCut && onCut(breakId)}
      style={{ cursor:'pointer', display:'flex', alignItems:'center', gap:0,
        background: forced ? DA.red : hov ? '#fff0f0' : '#fffafa',
        borderTop: `2px ${forced ? 'solid' : 'dashed'} ${forced ? DA.red : hov ? DA.red : '#f0b8b8'}`,
        borderBottom: `2px ${forced ? 'solid' : 'dashed'} ${forced ? DA.red : hov ? DA.red : '#f0b8b8'}`,
        padding:'5px 10px', userSelect:'none' }}>
      <span style={{ fontSize:13, lineHeight:1, color: forced || hov ? 'white' : '#c08080',
        background: forced ? 'transparent' : hov ? DA.red : 'none',
        padding: hov && !forced ? '0 4px' : 0, borderRadius:2 }}>✂</span>
      <span style={{ fontSize:8, fontWeight:700, flex:1, marginLeft:6,
        color: forced ? 'white' : hov ? DA.red : '#c08080', letterSpacing:0.2 }}>
        {forced ? 'Saut de page ici — cliquer pour annuler' : 'Couper ici — nouvelle page avant ce plan'}
      </span>
      {!forced && (
        <span style={{ fontSize:7, color: hov ? DA.red : '#d0a0a0',
          background: hov ? '#ffe0e0' : '#fdf0f0', border:`1px solid ${hov ? '#fca5a5' : '#f0d0d0'}`,
          borderRadius:3, padding:'1px 6px', whiteSpace:'nowrap' }}>
          ⊕ Nouvelle page
        </span>
      )}
      {forced && (
        <span style={{ fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.85)' }}>× Retirer</span>
      )}
    </div>
  );
}

export function PageSepBanner({ pageNum, totalPages, firstBlockId, isForced, onToggle }) {
  return (
    <div style={{ width:PW, background:'#1a1a1a', padding:'8px 14px', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
      {/* Indicateur page */}
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <div style={{ width:3, height:18, background:DA.red, borderRadius:2, flexShrink:0 }}/>
        <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
          <span style={{ fontSize:10, fontWeight:800, color:'white', lineHeight:1 }}>
            Page {pageNum}
          </span>
          <span style={{ fontSize:8, color:'rgba(255,255,255,0.3)', lineHeight:1 }}>
            sur {totalPages} au total
          </span>
        </div>
      </div>

      <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.07)' }}/>

      {/* Contrôle saut forcé */}
      {isForced && firstBlockId ? (
        <div onClick={() => onToggle(firstBlockId)}
          style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:5,
            background:'rgba(227,5,19,0.18)', border:`1px solid rgba(227,5,19,0.5)`, cursor:'pointer' }}>
          <span style={{ fontSize:10, lineHeight:1 }}>✂</span>
          <span style={{ fontSize:9, fontWeight:700, color:DA.red, whiteSpace:'nowrap' }}>Saut forcé</span>
          <span style={{ fontSize:9, color:'rgba(255,255,255,0.45)',
            background:'rgba(255,255,255,0.08)', borderRadius:3, padding:'1px 6px' }}>
            × Supprimer
          </span>
        </div>
      ) : (
        <span style={{ fontSize:8, color:'rgba(255,255,255,0.2)', fontStyle:'italic' }}>
          séparateur automatique
        </span>
      )}
    </div>
  );
}

// Bouton (aperçu PC uniquement, jamais imprimé) posé sur un plan : le sortir sur une page à part.
export function PlanPageButton({ onClick }) {
  if (!onClick) return null;
  return (
    <button data-print="hide" onClick={onClick} title="Mettre ce plan en grand sur une page à part (fin du rapport)"
      style={{ position:'absolute', top:6, right:6, zIndex:3, padding:'3px 9px', borderRadius:6, border:`1px solid ${DA.border}`, background:'rgba(255,255,255,0.94)', color:DA.gray, fontSize:9, fontWeight:700, cursor:'pointer', boxShadow:'0 1px 4px rgba(0,0,0,0.12)' }}>
      ⤢ Page à part
    </button>
  );
}
