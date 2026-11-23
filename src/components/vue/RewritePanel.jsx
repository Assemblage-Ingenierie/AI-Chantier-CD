import React from 'react';

// Volet « Version reformulée » de « Améliorer avec l'IA » (demande Thomas 23/11). Même lecture que
// la correction d'orthographe : passage barré (rouge) → passage proposé (vert). Clic sur un passage
// = le GARDER tel quel. Aucune logique ici : tout est piloté par ItemModal (lib/rewriteDiff.js).
export default function RewritePanel({ segments, onToggle, onAll, onApply, onClose }) {
  const fixes = segments.filter(s => s.type === 'fix');
  const on = fixes.filter(s => s.active !== false).length;
  const btn = { background:'white', color:'#374151', border:'1px solid #D1D5DB', borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer' };
  return (
    <div style={{ marginTop:8, border:'1px solid #BFDBFE', borderRadius:10, overflow:'hidden', fontSize:12 }}>
      <div style={{ background:'#EFF6FF', padding:'8px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #BFDBFE', gap:8, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontWeight:700, color:'#1D4ED8', fontSize:11, textTransform:'uppercase', letterSpacing:0.5 }}>Version reformulée</span>
          <span style={{ fontSize:11, color:'#6B7280' }}>{on}/{fixes.length} phrase{fixes.length > 1 ? 's' : ''}</span>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={() => onAll(true)} style={btn}>Tout</button>
          <button onClick={() => onAll(false)} style={{ ...btn, color:'#6B7280' }}>Aucun</button>
          <button onClick={onApply} disabled={on === 0}
            style={{ background: on > 0 ? '#059669' : '#9CA3AF', color:'white', border:'none', borderRadius:6, padding:'4px 12px', fontSize:11, fontWeight:700, cursor: on > 0 ? 'pointer' : 'default' }}>
            ✓ Appliquer ({on})
          </button>
          <button onClick={onClose} aria-label="Fermer" style={{ ...btn, color:'#6B7280' }}>✕</button>
        </div>
      </div>
      <div style={{ background:'#F8FAFC', padding:'5px 12px', borderBottom:'1px solid #E5E7EB', fontSize:10, color:'#475569' }}>
        Clique sur une phrase proposée pour reprendre la tienne
      </div>
      <div style={{ padding:'10px 12px', lineHeight:1.9, color:'#1F2937', background:'white', whiteSpace:'pre-wrap' }}>
        {segments.map((seg, i) => {
          if (seg.type === 'eq') return <span key={i}>{seg.text}</span>;
          const active = seg.active !== false;
          return (
            <span key={i} onClick={() => onToggle(seg.id)}
              title={active ? 'Cliquer pour garder ta phrase' : 'Cliquer pour reprendre la phrase proposée'}
              style={{ cursor:'pointer', borderRadius:3, padding:'1px 2px', border: active ? '1px solid transparent' : '1px dashed #D1D5DB', background: active ? 'transparent' : '#F9FAFB' }}>
              {active ? (
                <>
                  {seg.del && <span style={{ background:'#FEE2E2', color:'#991B1B', textDecoration:'line-through', borderRadius:2, padding:'0 2px', marginRight:1 }}>{seg.del}</span>}
                  {seg.add && <span style={{ background:'#DCFCE7', color:'#166534', fontWeight:600, borderRadius:2, padding:'0 2px' }}>{seg.add}</span>}
                </>
              ) : (
                <span style={{ color:'#374151' }}>{seg.del}</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
