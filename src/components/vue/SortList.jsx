import React, { useState } from 'react';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { Ic, Badge, BadgeSuivi } from '../ui/Icons.jsx';

export default function SortList({ items, onReorder, onEdit, onDelete }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [confirmDelId, setConfirmDelId] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { photos:[...], idx:0 }

  const moveItem = (idx, delta) => {
    const n = [...items];
    const ni = idx + delta;
    if (ni < 0 || ni >= n.length) return;
    [n[idx], n[ni]] = [n[ni], n[idx]];
    onReorder(n);
  };

  const onDE = () => {
    if (drag !== null && over !== null && drag !== over) {
      const n = [...items];
      const [m] = n.splice(drag, 1);
      n.splice(over, 0, m);
      onReorder(n);
    }
    setDrag(null); setOver(null);
  };

  return (
    <>
    {lightbox && (
      <div onClick={() => setLightbox(null)}
        style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.96)',zIndex:9999,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12 }}>
        <img src={lightbox.photos[lightbox.idx].data} alt=""
          style={{ maxWidth:'100%',maxHeight:'80vh',objectFit:'contain',borderRadius:6 }}/>
        {lightbox.photos.length > 1 && (
          <div style={{ display:'flex',gap:6,flexWrap:'wrap',justifyContent:'center',padding:'0 16px' }}
            onClick={e => e.stopPropagation()}>
            {lightbox.photos.map((ph, pi) => (
              <img key={pi} src={ph.data} alt=""
                onClick={() => setLightbox(v => ({ ...v, idx: pi }))}
                style={{ width:44,height:44,objectFit:'cover',borderRadius:5,cursor:'pointer',border:`2px solid ${lightbox.idx===pi ? 'white' : 'transparent'}`,opacity:lightbox.idx===pi ? 1 : 0.5,transition:'all 0.1s' }}/>
            ))}
          </div>
        )}
        <p style={{ color:'rgba(255,255,255,0.35)',fontSize:11,margin:0 }}>Toucher pour fermer</p>
      </div>
    )}
    <div>
      {items.length === 0 && (
        <div style={{ padding:'20px 16px',textAlign:'center',borderBottom:`1px solid ${DA.border}` }}>
          <p style={{ fontSize:12,color:DA.grayL,margin:'0 0 10px' }}>Aucune observation dans cette zone</p>
          <button onClick={() => onEdit(null)} style={{ display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',background:DA.red,color:'white',borderRadius:20,border:'none',fontSize:12,fontWeight:700,cursor:'pointer' }}>
            <Ic n="plus" s={13}/> Ajouter la 1ère observation
          </button>
        </div>
      )}

      {items.map((item, i) => (
        <div key={item.id}
          draggable
          onDragStart={() => setDrag(i)}
          onDragEnter={() => setOver(i)}
          onDragEnd={onDE}
          onDragOver={e => e.preventDefault()}
          onClick={() => onEdit(item)}
          style={{ display:'flex',alignItems:'flex-start',gap:8,padding:'10px 12px 10px 8px',borderBottom:`1px solid ${DA.border}`,transition:'background 0.1s',cursor:'pointer',background:over===i&&drag!==i?DA.redL:'white',borderTop:over===i&&drag!==i?`2px solid ${DA.red}`:'none' }}>

          {/* Boutons ▲▼ + poignée drag */}
          <div style={{ display:'flex', flexDirection:'column', gap:2, flexShrink:0, alignSelf:'center' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => moveItem(i, -1)} disabled={i===0}
              style={{ border:'none', borderRadius:5, padding:'5px 6px', cursor:i===0?'default':'pointer', background:i===0?'#f5f5f5':'#eee', color:i===0?'#ccc':'#555', fontSize:10, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center' }}>▲</button>
            <button onClick={() => moveItem(i, 1)} disabled={i===items.length-1}
              style={{ border:'none', borderRadius:5, padding:'5px 6px', cursor:i===items.length-1?'default':'pointer', background:i===items.length-1?'#f5f5f5':'#eee', color:i===items.length-1?'#ccc':'#555', fontSize:10, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center' }}>▼</button>
          </div>
          <span style={{ marginTop:7,width:8,height:8,borderRadius:'50%',background:URGENCE[item.urgence]?.dot,flexShrink:0 }}/>

          <div style={{ flex:1,minWidth:0 }}>
            <p style={{ fontSize:13,fontWeight:600,color:DA.black,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',margin:0 }}>{item.titre}</p>
            {item.commentaire && (
              <p style={{ fontSize:11,color:DA.gray,marginTop:2,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',margin:'2px 0 0' }}>{item.commentaire}</p>
            )}
            <div style={{ display:'flex',alignItems:'center',gap:6,marginTop:6,flexWrap:'wrap' }}>
              <Badge level={item.urgence}/>
              <span style={{ display:'flex',alignItems:'center',gap:3 }}>
                <BadgeSuivi suivi={item.suivi||'rien'} small onClick={e => {
                  e.stopPropagation();
                  const keys = Object.keys(SUIVI);
                  const next = keys[(keys.indexOf(item.suivi||'rien')+1)%keys.length];
                  onEdit({ ...item, suivi: next, _quickSuivi: true });
                }}/>
                <span style={{ fontSize:9,color:DA.grayL,fontStyle:'italic' }}>↺</span>
              </span>
            </div>
            {(() => {
              const validPhotos = (item.photos || []).filter(ph => ph.data);
              if (!validPhotos.length) return null;
              return (
                <div style={{ display:'flex',gap:4,marginTop:8,flexWrap:'wrap' }}>
                  {validPhotos.map((ph, pi) => (
                    <img key={pi} src={ph.data} alt=""
                      onClick={e => { e.stopPropagation(); setLightbox({ photos: validPhotos, idx: pi }); }}
                      style={{ width:'clamp(72px, 10vw, 200px)',height:'clamp(72px, 10vw, 200px)',objectFit:'cover',borderRadius:8,border:`1px solid ${DA.border}`,flexShrink:0,cursor:'pointer' }}/>
                  ))}
                </div>
              );
            })()}
          </div>

          {!sortMode && (confirmDelId === item.id
            ? <div style={{ display:'flex',alignItems:'center',gap:4,flexShrink:0 }} onClick={e => e.stopPropagation()}>
                <span style={{ fontSize:10,fontWeight:700,color:'#B91C1C',whiteSpace:'nowrap' }}>Supprimer ?</span>
                <button onClick={e => { e.stopPropagation(); onDelete(item.id); setConfirmDelId(null); }} style={{ padding:'3px 7px',background:'#B91C1C',color:'white',border:'none',borderRadius:5,fontSize:11,fontWeight:700,cursor:'pointer' }}>Oui</button>
                <button onClick={e => { e.stopPropagation(); setConfirmDelId(null); }} style={{ padding:'3px 6px',background:'white',color:'#555',border:'1px solid #E5E5E5',borderRadius:5,fontSize:11,cursor:'pointer' }}>Non</button>
              </div>
            : <button onClick={e => { e.stopPropagation(); setConfirmDelId(item.id); }} style={{ color:DA.red,padding:'3px 6px',cursor:'pointer',flexShrink:0,background:'#FFF0F0',border:'1px solid #FECACA',borderRadius:6,display:'flex',alignItems:'center' }}>
                <Ic n="del" s={13}/>
              </button>
          )}
        </div>
      ))}

      <div style={{ display:'flex',borderTop:`1px solid ${DA.border}` }}>
        <button onClick={() => onEdit(null)} style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:4,padding:10,fontSize:13,fontWeight:600,color:DA.red,background:'none',border:'none',cursor:'pointer' }}>
          <Ic n="plus" s={14}/> Ajouter
        </button>
      </div>
    </div>
    </>
  );
}
