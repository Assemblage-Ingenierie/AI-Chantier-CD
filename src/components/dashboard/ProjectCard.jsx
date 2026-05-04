import React, { useState, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

function getLocs(p) {
  if (p.visites?.length) return p.visites.flatMap(v => v.localisations || []);
  return p.localisations || [];
}
function getItems(l) {
  return l.sections?.length ? l.sections.flatMap(s => s.items || []) : (l.items || []);
}
function obsCount(p) { return getLocs(p).reduce((n, l) => n + getItems(l).length, 0); }
function urgCount(p) { return getLocs(p).reduce((n, l) => n + getItems(l).filter(i => i.urgence === 'haute').length, 0); }

export default function ProjectCard({ p, arc, onSelect, onUpd, onArchive, onUnarchive, onDelete, onEdit, menuOpen, setMenuOpen, setPhotoTgt }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const obs = obsCount(p);
  const urg = urgCount(p);

  const toggleMenu = (e) => {
    if (menuOpen === p.id) { setMenuOpen(null); setMenuPos(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuOpen(p.id);
  };

  // Close menu when user scrolls
  useEffect(() => {
    if (menuOpen !== p.id) return;
    const close = () => setMenuOpen(null);
    window.addEventListener('scroll', close, { passive: true, once: true });
    return () => window.removeEventListener('scroll', close);
  }, [menuOpen, p.id, setMenuOpen]);

  return (
    <div className="proj-card" style={{ background:DA.white,borderRadius:12,overflow:'hidden',border:`1px solid ${DA.border}`,position:'relative' }}>
      {/* Photo */}
      <div className="proj-card-img" onClick={() => !arc && onSelect(p)}>
        {p.photo
          ? <img src={p.photo} alt={p.nom}/>
          : <div className="proj-card-img-placeholder"><Ic n="bld" s={32}/></div>
        }
        <button onClick={(e) => { e.stopPropagation(); setPhotoTgt(p); }} style={{ position:'absolute',bottom:6,right:6,background:'rgba(0,0,0,0.55)',border:'none',borderRadius:8,padding:10,cursor:'pointer',color:'white',display:'flex' }}>
          <Ic n="cam" s={15}/>
        </button>
        {arc && <div style={{ position:'absolute',top:6,left:6,background:'rgba(0,0,0,0.65)',color:'white',fontSize:11,padding:'3px 8px',borderRadius:20,display:'flex',alignItems:'center',gap:3 }}><Ic n="arc" s={10}/> Archivé</div>}
        <div style={{ position:'absolute',bottom:0,left:0,right:0,height:3,background:DA.red }}/>
      </div>

      {/* Infos */}
      <div className="proj-card-body" style={{ padding:'10px 12px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8 }}>
        <div style={{ flex:1,minWidth:0,cursor:'pointer' }} onClick={() => !arc && onSelect(p)}>
          <p style={{ fontWeight:800,fontSize:16,color:DA.black,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',margin:0 }}>{p.nom}</p>
          {p.maitreOuvrage && <p style={{ fontSize:13,color:DA.red,margin:'4px 0 0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:600 }}>MO : {p.maitreOuvrage}</p>}
          <p style={{ fontSize:13,color:DA.grayL,margin:'3px 0 0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{p.adresse || '—'}</p>
          {(obs > 0 || urg > 0) && (
            <div style={{ display:'flex',gap:5,marginTop:8,flexWrap:'wrap' }}>
              {obs > 0 && (
                <span style={{ display:'inline-flex',alignItems:'center',gap:3,fontSize:12,color:DA.grayL,background:DA.grayXL,border:`1px solid ${DA.border}`,borderRadius:20,padding:'3px 9px' }}>
                  <Ic n="pin" s={10}/> {obs} obs
                </span>
              )}
              {urg > 0 && (
                <span style={{ display:'inline-flex',alignItems:'center',gap:3,fontSize:12,color:DA.red,background:DA.redL,border:`1px solid rgba(185,28,28,0.15)`,borderRadius:20,padding:'3px 9px',fontWeight:700 }}>
                  <Ic n="spk" s={10}/> {urg} urgente{urg > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Menu — dropdown uses position:fixed to escape overflow:hidden on the card */}
        <div style={{ flexShrink:0 }}>
          <button onClick={toggleMenu} style={{ padding:10,background:'none',border:'none',cursor:'pointer',color:DA.grayL,borderRadius:8 }}>
            <Ic n="dts" s={18}/>
          </button>
          {menuOpen === p.id && menuPos && (
            <div style={{ position:'fixed',top:menuPos.top,right:menuPos.right,background:DA.white,borderRadius:12,boxShadow:'0 8px 32px rgba(0,0,0,0.18)',zIndex:9999,minWidth:190,border:`1px solid ${DA.border}`,overflow:'hidden' }} onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { onEdit(p); setMenuOpen(null); }} style={{ width:'100%',display:'flex',alignItems:'center',gap:10,padding:'13px 16px',fontSize:13,color:DA.gray,background:'none',border:'none',cursor:'pointer',textAlign:'left' }}><Ic n="edt" s={15}/> Modifier</button>
              <div style={{ borderTop:`1px solid ${DA.border}` }}/>
              {!arc
                ? <button onClick={() => { onArchive(p.id); setMenuOpen(null); }} style={{ width:'100%',display:'flex',alignItems:'center',gap:10,padding:'13px 16px',fontSize:13,color:DA.gray,background:'none',border:'none',cursor:'pointer',textAlign:'left' }}><Ic n="arc" s={15}/> Archiver</button>
                : <button onClick={() => { onUnarchive(p.id); setMenuOpen(null); }} style={{ width:'100%',display:'flex',alignItems:'center',gap:10,padding:'13px 16px',fontSize:13,color:DA.gray,background:'none',border:'none',cursor:'pointer',textAlign:'left' }}><Ic n="bld" s={15}/> Réactiver</button>
              }
              <div style={{ borderTop:`1px solid ${DA.border}` }}/>
              {!confirmDel
                ? <button onClick={(e) => { e.stopPropagation(); setConfirmDel(true); }} style={{ width:'100%',display:'flex',alignItems:'center',gap:10,padding:'13px 16px',fontSize:13,color:'white',background:'#B91C1C',border:'none',cursor:'pointer',textAlign:'left',fontWeight:700 }}><Ic n="del" s={15}/> Supprimer le projet</button>
                : <div style={{ background:'#FFF0F0',padding:'12px 14px' }}>
                    <p style={{ fontSize:12,fontWeight:700,color:'#B91C1C',margin:'0 0 10px',textAlign:'center' }}>Confirmer la suppression ?</p>
                    <div style={{ display:'flex',gap:8 }}>
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDel(false); }} style={{ flex:1,padding:9,borderRadius:8,border:'1px solid #E5E5E5',background:'white',color:'#555',fontSize:12,fontWeight:600,cursor:'pointer' }}>Annuler</button>
                      <button onClick={(e) => { e.stopPropagation(); onDelete(p.id); setMenuOpen(null); }} style={{ flex:1,padding:9,borderRadius:8,background:'#B91C1C',color:'white',border:'none',fontSize:12,fontWeight:800,cursor:'pointer' }}>Supprimer !</button>
                    </div>
                  </div>
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
