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

// Dernière visite triée par date
function getLastVisit(p) {
  if (!p.visites?.length) return null;
  return [...p.visites].sort((a, b) => (b.dateVisite || '').localeCompare(a.dateVisite || '')).find(v => v.dateVisite || v.localisations?.length) || p.visites[0];
}

// Items de la dernière visite (avec titre)
function getLastVisitItems(p) {
  const lv = getLastVisit(p);
  const locs = lv ? (lv.localisations || []) : (p.localisations || []);
  return locs.flatMap(l => getItems(l).filter(i => i.titre));
}

function MemoStrip({ p }) {
  const items = getLastVisitItems(p);
  if (!items.length) return null;

  const lv = getLastVisit(p);
  const dateStr = lv?.dateVisite
    ? new Date(lv.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR', { day:'numeric', month:'short' })
    : null;

  // Items urgents (haute), puis à planifier (moyenne) — max 3 au total
  const urgent  = items.filter(i => i.urgence === 'haute');
  const moyen   = items.filter(i => i.urgence === 'moyenne');
  const preview = [...urgent, ...moyen].slice(0, 3);

  // Pendants = pas encore fait
  const pending = items.filter(i => i.suivi !== 'fait').length;

  return (
    <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${DA.border}` }}>
      {dateStr && (
        <p style={{ fontSize:11, color:DA.grayL, margin:'0 0 5px', fontWeight:600 }}>
          Dernière visite · {dateStr}
        </p>
      )}
      {preview.map((item, i) => {
        const isUrg = item.urgence === 'haute';
        return (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3 }}>
            <span style={{ width:5, height:5, borderRadius:'50%', flexShrink:0,
              background: isUrg ? DA.red : '#F59E0B' }}/>
            <span style={{ fontSize:11, color: isUrg ? DA.red : '#92400E', fontWeight: isUrg ? 700 : 500,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
              {item.titre}
            </span>
          </div>
        );
      })}
      {pending > 0 && (
        <p style={{ fontSize:10, color:DA.grayL, margin:'4px 0 0' }}>
          {pending} action{pending > 1 ? 's' : ''} en attente
        </p>
      )}
    </div>
  );
}

export default function ProjectCard({ p, arc, onSelect, onUpd, onArchive, onUnarchive, onDelete, onEdit, menuOpen, setMenuOpen, setPhotoTgt }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const obs = obsCount(p);
  const urg = urgCount(p);

  const toggleMenu = (e) => {
    if (menuOpen === p.id) { setMenuOpen(null); setMenuPos(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuH = 180; // hauteur approximative du menu
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    if (spaceBelow < menuH) {
      setMenuPos({ bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right });
    } else {
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
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
          {!arc && <MemoStrip p={p}/>}
        </div>

        {/* Menu — dropdown uses position:fixed to escape overflow:hidden on the card */}
        <div style={{ flexShrink:0 }}>
          <button onClick={toggleMenu} style={{ padding:10,background:'none',border:'none',cursor:'pointer',color:DA.grayL,borderRadius:8 }}>
            <Ic n="dts" s={18}/>
          </button>
          {menuOpen === p.id && menuPos && (
            <div style={{ position:'fixed',...(menuPos.top != null ? {top:menuPos.top} : {bottom:menuPos.bottom}),right:menuPos.right,background:DA.white,borderRadius:12,boxShadow:'0 8px 32px rgba(0,0,0,0.18)',zIndex:9999,minWidth:190,border:`1px solid ${DA.border}`,overflow:'hidden' }} onClick={(e) => e.stopPropagation()}>
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
