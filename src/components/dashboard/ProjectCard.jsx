import React, { useState } from 'react';
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
  const obs = obsCount(p);
  const urg = urgCount(p);

  return (
    <div style={{ background:DA.white,borderRadius:12,overflow:'visible',border:`1px solid ${DA.border}`,position:'relative',display:'flex',flexDirection:'column',height:'100%' }}>
      {/* Photo — paddingTop:100% works on all iOS versions (aspect-ratio not supported on iOS<15) */}
      <div style={{ position:'relative',width:'100%',paddingTop:'100%',background:DA.grayXL,cursor:'pointer',flexShrink:0,overflow:'hidden',borderRadius:'11px 11px 0 0' }} onClick={() => !arc && onSelect(p)}>
        {p.photo
          ? <img src={p.photo} alt={p.nom} style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',display:'block' }}/>
          : <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center' }}><Ic n="bld" s={28}/></div>
        }
        <button onClick={(e) => { e.stopPropagation(); setPhotoTgt(p); }} style={{ position:'absolute',bottom:6,right:6,background:'rgba(0,0,0,0.5)',border:'none',borderRadius:8,padding:6,cursor:'pointer',color:'white',display:'flex' }}>
          <Ic n="cam" s={12}/>
        </button>
        {arc && <div style={{ position:'absolute',top:6,left:6,background:'rgba(0,0,0,0.65)',color:'white',fontSize:10,padding:'2px 8px',borderRadius:20,display:'flex',alignItems:'center',gap:3 }}><Ic n="arc" s={9}/> Archivé</div>}
        <div style={{ position:'absolute',bottom:0,left:0,right:0,height:3,background:DA.red }}/>
      </div>

      {/* Infos */}
      <div style={{ padding:'10px 12px',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,flex:1 }}>
        <div style={{ flex:1,minWidth:0,cursor:'pointer' }} onClick={() => !arc && onSelect(p)}>
          <p style={{ fontWeight:800,fontSize:13,color:DA.black,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',margin:0 }}>{p.nom}</p>
          {p.maitreOuvrage && <p style={{ fontSize:11,color:DA.red,margin:'2px 0 0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>MO : {p.maitreOuvrage}</p>}
          <p style={{ fontSize:11,color:DA.grayL,margin:'2px 0 0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{p.adresse || '—'}</p>
          {p.updatedAt && <p style={{ fontSize:10,color:DA.grayL,margin:'3px 0 0' }}>Modifié le {new Date(p.updatedAt).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})}</p>}
          {!arc && <p style={{ fontSize:10,color:DA.red,margin:'4px 0 0',fontWeight:600,display:'flex',alignItems:'center',gap:3 }}>Ouvrir la visite →</p>}
          {(obs > 0 || urg > 0) && (
            <div style={{ display:'flex',gap:5,marginTop:5,flexWrap:'wrap' }}>
              {obs > 0 && (
                <span style={{ display:'inline-flex',alignItems:'center',gap:3,fontSize:10,color:DA.grayL,background:DA.grayXL,border:`1px solid ${DA.border}`,borderRadius:20,padding:'2px 7px' }}>
                  <Ic n="pin" s={9}/> {obs} obs
                </span>
              )}
              {urg > 0 && (
                <span style={{ display:'inline-flex',alignItems:'center',gap:3,fontSize:10,color:DA.red,background:DA.redL,border:`1px solid rgba(185,28,28,0.15)`,borderRadius:20,padding:'2px 7px',fontWeight:700 }}>
                  <Ic n="spk" s={9}/> {urg} urgente{urg > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Menu */}
        <div style={{ position:'relative',flexShrink:0 }}>
          <button onClick={() => setMenuOpen(menuOpen === p.id ? null : p.id)} style={{ padding:6,background:'none',border:'none',cursor:'pointer',color:DA.grayL,borderRadius:8 }}>
            <Ic n="dts" s={16}/>
          </button>
          {menuOpen === p.id && (
            <div style={{ position:'absolute',right:0,top:32,background:DA.white,borderRadius:12,boxShadow:'0 8px 32px rgba(0,0,0,0.18)',zIndex:200,minWidth:190,border:`1px solid ${DA.border}`,overflow:'hidden' }} onClick={(e) => e.stopPropagation()}>
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
