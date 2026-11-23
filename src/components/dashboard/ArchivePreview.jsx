import React, { useState, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { renderMarkup, stripMarkup } from '../../lib/markup.jsx';

// CONSULTATION d'un projet ARCHIVÉ (demande Thomas 23/11) : clic sur la carte → aperçu en
// LECTURE SEULE des visites et observations, pour relire / copier-coller du texte et s'en
// inspirer, SANS réactiver le projet. Aucune écriture : ce composant ne reçoit aucun callback de
// modification et ne touche ni à l'état des projets, ni au cache, ni au serveur. Le texte des
// observations est toujours lu en base, même archivé (cf. storage.js, incident 2026-10-15).
// Photos volontairement absentes : purgées du cache à l'archivage, l'aperçu reste léger.

function locItems(l) {
  return [...(l?.items || []), ...((l?.sections || []).flatMap(s => s.items || []))];
}

function visitText(v) {
  const out = [];
  for (const l of v.localisations || []) {
    const items = locItems(l).filter(i => (i.titre || '').trim() || (i.commentaire || '').trim());
    if (!items.length) continue;
    out.push(`${(l.nom || 'Zone').toUpperCase()}`);
    for (const i of items) {
      if ((i.titre || '').trim()) out.push(`- ${i.titre.trim()}`);
      const c = stripMarkup(i.commentaire || '').trim();
      if (c) out.push(c);
      out.push('');
    }
  }
  const concl = stripMarkup(v.conclusion || '').trim();
  if (concl) out.push('CONCLUSION', concl);
  return out.join('\n').trim();
}

const fmtDate = (d) => {
  if (!d) return '';
  const t = new Date(d);
  return isNaN(t) ? String(d) : t.toLocaleDateString('fr-FR');
};

export default function ArchivePreview({ projet, onClose }) {
  const visites = projet?.visites || [];
  const [vid, setVid] = useState(() => visites[visites.length - 1]?.id ?? null);
  const [copied, setCopied] = useState(false);
  const v = visites.find(x => x.id === vid) || visites[visites.length - 1] || null;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyAll = async () => {
    if (!v) return;
    const txt = visitText(v);
    try { await navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* presse-papiers refusé (ancien navigateur) : la sélection manuelle reste possible */ }
  };

  const locs = (v?.localisations || []).map(l => ({ l, items: locItems(l) })).filter(x => x.items.length > 0);
  const conclusion = v?.conclusion && stripMarkup(v.conclusion).trim() ? v.conclusion : null;

  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',padding:'env(safe-area-inset-top, 0px) 0 0' }}>
      <div onClick={e => e.stopPropagation()} style={{ background:DA.white,width:'100%',maxWidth:760,height:'100%',maxHeight:'min(100dvh, 920px)',display:'flex',flexDirection:'column',borderRadius:12,overflow:'hidden',boxShadow:'0 12px 40px rgba(0,0,0,0.25)' }}>
        {/* En-tête */}
        <div style={{ padding:'12px 14px',borderBottom:`1px solid ${DA.border}`,display:'flex',alignItems:'center',gap:10,flexShrink:0 }}>
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ display:'flex',alignItems:'center',gap:6,fontSize:11,color:DA.grayL,fontWeight:600 }}>
              <Ic n="arc" s={11}/> Archivé · lecture seule
            </div>
            <p style={{ margin:'2px 0 0',fontSize:16,fontWeight:800,color:DA.black,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{projet.nom}</p>
          </div>
          {v && (
            <button onClick={copyAll} title="Copier tout le texte de la visite" style={{ display:'flex',alignItems:'center',gap:6,padding:'8px 11px',borderRadius:8,border:`1px solid ${DA.border}`,background:copied ? '#F0FDF4' : DA.white,color:copied ? DA.urgGrn : DA.gray,fontSize:12,fontWeight:700,cursor:'pointer',flexShrink:0 }}>
              <Ic n={copied ? 'chk' : 'cpy'} s={14}/> {copied ? 'Copié' : 'Copier'}
            </button>
          )}
          <button onClick={onClose} aria-label="Fermer" style={{ padding:8,borderRadius:8,border:'none',background:'none',color:DA.gray,cursor:'pointer',flexShrink:0 }}>
            <Ic n="x" s={20}/>
          </button>
        </div>

        {/* Choix de la visite — seulement s'il y en a plusieurs */}
        {visites.length > 1 && (
          <div style={{ display:'flex',gap:6,padding:'10px 14px',overflowX:'auto',borderBottom:`1px solid ${DA.border}`,flexShrink:0 }}>
            {visites.map(x => {
              const on = x.id === v?.id;
              return (
                <button key={x.id} onClick={() => setVid(x.id)} style={{ flexShrink:0,padding:'6px 12px',borderRadius:20,border:`1px solid ${on ? DA.red : DA.border}`,background:on ? DA.redL : DA.white,color:on ? DA.red : DA.gray,fontSize:12,fontWeight:on ? 700 : 600,cursor:'pointer',whiteSpace:'nowrap' }}>
                  {x.label || 'Visite'}{x.dateVisite ? ` · ${fmtDate(x.dateVisite)}` : ''}
                </button>
              );
            })}
          </div>
        )}

        {/* Contenu sélectionnable */}
        <div style={{ flex:1,overflowY:'auto',padding:'14px 16px calc(24px + env(safe-area-inset-bottom, 0px))',userSelect:'text',WebkitUserSelect:'text',background:DA.grayXL }}>
          {!v || (locs.length === 0 && !conclusion) ? (
            <p style={{ textAlign:'center',color:DA.grayL,fontSize:13,marginTop:40 }}>Aucune observation dans cette visite.</p>
          ) : (
            <>
              {locs.map(({ l, items }) => (
                <div key={l.id} style={{ marginBottom:18 }}>
                  <h3 style={{ margin:'0 0 8px',fontSize:12,fontWeight:800,color:DA.red,textTransform:'uppercase',letterSpacing:0.4 }}>{l.nom || 'Zone'}</h3>
                  {items.map(i => (
                    <div key={i.id} style={{ background:DA.white,border:`1px solid ${DA.border}`,borderRadius:10,padding:'10px 12px',marginBottom:8 }}>
                      {(i.titre || '').trim() && <p style={{ margin:0,fontSize:14,fontWeight:700,color:DA.black }}>{i.titre}</p>}
                      {(i.commentaire || '').trim() && (
                        <div style={{ marginTop:(i.titre || '').trim() ? 4 : 0,fontSize:13.5,lineHeight:1.5,color:DA.black,overflowWrap:'anywhere' }}>{renderMarkup(i.commentaire)}</div>
                      )}
                      {i.photos?.length > 0 && (
                        <p style={{ margin:'6px 0 0',fontSize:11,color:DA.grayL,display:'flex',alignItems:'center',gap:4 }}><Ic n="cam" s={11}/> {i.photos.length} photo{i.photos.length > 1 ? 's' : ''}</p>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {conclusion && (
                <div style={{ marginBottom:18 }}>
                  <h3 style={{ margin:'0 0 8px',fontSize:12,fontWeight:800,color:DA.red,textTransform:'uppercase',letterSpacing:0.4 }}>Conclusion</h3>
                  <div style={{ background:DA.white,border:`1px solid ${DA.border}`,borderRadius:10,padding:'10px 12px',fontSize:13.5,lineHeight:1.5,color:DA.black,overflowWrap:'anywhere' }}>{renderMarkup(conclusion)}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
