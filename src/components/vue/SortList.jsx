import React, { useState } from 'react';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { Ic, Badge, BadgeSuivi } from '../ui/Icons.jsx';

export default function SortList({ items, onReorder, onEdit, onDelete }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [sortMode, setSortMode] = useState(false);
  const [confirmDelId, setConfirmDelId] = useState(null);

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
    <div>
      {items.length === 0 && (
        <div style={{ padding:'20px 16px',textAlign:'center',borderBottom:`1px solid ${DA.border}` }}>
          <p style={{ fontSize:12,color:DA.grayL,margin:'0 0 10px' }}>Aucune observation dans cette zone</p>
          <button onClick={() => onEdit(null)} style={{ display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',background:DA.red,color:'white',borderRadius:20,border:'none',fontSize:12,fontWeight:700,cursor:'pointer' }}>
            <Ic n="plus" s={13}/> Ajouter la 1ère observation
          </button>
        </div>
      )}

      {sortMode && (
        <div style={{ padding:'6px 16px',background:DA.redL,fontSize:11,color:DA.red,fontWeight:600 }}>
          Mode tri actif — glissez pour réordonner
        </div>
      )}

      {items.map((item, i) => (
        <div key={item.id}
          draggable={sortMode}
          onDragStart={() => setDrag(i)}
          onDragEnter={() => setOver(i)}
          onDragEnd={onDE}
          onDragOver={e => e.preventDefault()}
          onClick={() => !sortMode && onEdit(item)}
          style={{ display:'flex',alignItems:'flex-start',gap:10,padding:'12px 16px',borderBottom:`1px solid ${DA.border}`,transition:'all 0.1s',cursor:sortMode?'grab':'pointer',background:over===i&&drag!==i?DA.redL:'white',borderTop:over===i&&drag!==i?`2px solid ${DA.red}`:'none' }}>

          {sortMode
            ? <span style={{ marginTop:2,color:DA.grayL,flexShrink:0 }}><Ic n="grp" s={16}/></span>
            : <span style={{ marginTop:6,width:8,height:8,borderRadius:'50%',background:URGENCE[item.urgence]?.dot,flexShrink:0 }}/>
          }

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
                <div style={{ display:'flex',gap:4,marginTop:6,flexWrap:'wrap' }}>
                  {validPhotos.slice(0,5).map((ph,pi) => (
                    <img key={pi} src={ph.data} alt="" style={{ width:44,height:44,objectFit:'cover',borderRadius:6,border:`1px solid ${DA.border}`,flexShrink:0 }}/>
                  ))}
                  {validPhotos.length > 5 && (
                    <div style={{ width:44,height:44,borderRadius:6,background:DA.grayXL,border:`1px solid ${DA.border}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:DA.gray,flexShrink:0 }}>
                      +{validPhotos.length - 5}
                    </div>
                  )}
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
        <button onClick={() => !sortMode && onEdit(null)} style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:4,padding:10,fontSize:13,fontWeight:600,color:DA.red,background:'none',border:'none',cursor:'pointer' }}>
          <Ic n="plus" s={14}/> Ajouter
        </button>
        {items.length > 1 && (
          <button onClick={() => setSortMode(v => !v)} style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:4,padding:'10px 14px',fontSize:12,color:sortMode?DA.red:DA.gray,background:sortMode?DA.redL:'none',border:'none',borderLeft:`1px solid ${DA.border}`,cursor:'pointer' }}>
            <Ic n="srt" s={14}/>{sortMode ? 'Terminer' : 'Trier'}
          </button>
        )}
      </div>
    </div>
  );
}
