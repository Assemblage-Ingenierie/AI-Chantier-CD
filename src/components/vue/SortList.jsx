import React, { useState, useRef, useEffect } from 'react';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { Ic, Badge, BadgeSuivi } from '../ui/Icons.jsx';

export default function SortList({ items, onReorder, onEdit, onDelete }) {
  const [confirmDelId, setConfirmDelId] = useState(null);
  const [lightbox, setLightbox]         = useState(null);

  // ── Drag state ─────────────────────────────────────────────────────────────
  const [dragIdx, setDragIdx]   = useState(null);
  const [overIdx, setOverIdx]   = useState(null);
  const dragDidMoveRef          = useRef(false); // évite onClick après drag
  const listRef                 = useRef();

  // ── HTML5 drag (desktop) ───────────────────────────────────────────────────
  const onDragStart = (i) => { setDragIdx(i); dragDidMoveRef.current = false; };
  const onDragEnter = (i) => { setOverIdx(i); dragDidMoveRef.current = true; };
  const onDragEnd   = ()  => {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const n = [...items];
      const [m] = n.splice(dragIdx, 1);
      n.splice(overIdx, 0, m);
      onReorder(n);
    }
    setDragIdx(null); setOverIdx(null);
  };

  // ── Touch drag (mobile) ────────────────────────────────────────────────────
  const touchDragRef    = useRef(null); // { idx, startY, curOverIdx }
  const ghostRef        = useRef(null);
  const wrapperRef      = useRef(null);

  useEffect(() => () => { ghostRef.current?.remove(); }, []);

  // Attache touchmove avec { passive: false } pour pouvoir appeler preventDefault sans warning
  useEffect(() => {
    onGripTouchMoveRef.current = onGripTouchMove;
    onGripTouchEndRef.current  = onGripTouchEnd;
  });
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const move   = (e) => onGripTouchMoveRef.current(e);
    const end    = (e) => onGripTouchEndRef.current(e);
    el.addEventListener('touchmove',   move, { passive: false });
    el.addEventListener('touchend',    end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchmove',   move);
      el.removeEventListener('touchend',    end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  const onGripTouchStart = (e, idx) => {
    // touchAction:'none' on the grip already prevents scroll — no preventDefault needed here
    const touch = e.touches[0];
    dragDidMoveRef.current = false;
    touchDragRef.current = { idx, startY: touch.clientY, curOverIdx: idx };
    setDragIdx(idx);

    // Créer un ghost visuel
    const row = listRef.current?.children[idx];
    if (row) {
      const clone = row.cloneNode(true);
      clone.style.cssText = `position:fixed;left:${row.getBoundingClientRect().left}px;top:${touch.clientY - row.offsetHeight/2}px;width:${row.offsetWidth}px;opacity:0.85;background:white;boxShadow:0 8px 24px rgba(0,0,0,0.25);borderRadius:8px;zIndex:9998;pointerEvents:none;border:2px solid ${DA.red};`;
      document.body.appendChild(clone);
      ghostRef.current = clone;
    }
  };

  const onGripTouchMoveRef = useRef(null);
  const onGripTouchEndRef  = useRef(null);

  const onGripTouchMove = (e) => {
    if (!touchDragRef.current) return;
    e.preventDefault(); // { passive: false } set via useEffect below
    const touch = e.touches[0];
    dragDidMoveRef.current = true;

    // Déplacer le ghost
    if (ghostRef.current) {
      const row = listRef.current?.children[touchDragRef.current.idx];
      if (row) ghostRef.current.style.top = `${touch.clientY - row.offsetHeight/2}px`;
    }

    // Trouver sur quel item on est
    if (!listRef.current) return;
    const listRect = listRef.current.getBoundingClientRect();
    const relY = touch.clientY - listRect.top;
    let cumH = 0;
    let newOver = items.length - 1;
    for (let j = 0; j < listRef.current.children.length; j++) {
      const h = listRef.current.children[j].offsetHeight;
      if (relY < cumH + h / 2) { newOver = j; break; }
      cumH += h;
    }
    touchDragRef.current.curOverIdx = newOver;
    setOverIdx(newOver);
  };

  const onGripTouchEnd = () => {
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
    if (!touchDragRef.current) return;
    const { idx, curOverIdx } = touchDragRef.current;
    touchDragRef.current = null;
    if (dragDidMoveRef.current && idx !== curOverIdx) {
      const n = [...items];
      const [m] = n.splice(idx, 1);
      n.splice(curOverIdx, 0, m);
      onReorder(n);
    }
    setDragIdx(null); setOverIdx(null);
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
                style={{ width:44,height:44,objectFit:'cover',borderRadius:5,cursor:'pointer',border:`2px solid ${lightbox.idx===pi?'white':'transparent'}`,opacity:lightbox.idx===pi?1:0.5,transition:'all 0.1s' }}/>
            ))}
          </div>
        )}
        <p style={{ color:'rgba(255,255,255,0.35)',fontSize:11,margin:0 }}>Toucher pour fermer</p>
      </div>
    )}

    <div ref={wrapperRef}>
      {items.length === 0 && (
        <div style={{ padding:'24px 16px',textAlign:'center',borderBottom:`1px solid ${DA.border}` }}>
          <p style={{ fontSize:14,color:DA.grayL,margin:'0 0 14px' }}>Aucune observation dans cette zone</p>
          <button onClick={() => onEdit(null)} style={{ display:'inline-flex',alignItems:'center',gap:6,padding:'12px 22px',background:DA.red,color:'white',borderRadius:20,border:'none',fontSize:15,fontWeight:700,cursor:'pointer' }}>
            <Ic n="plus" s={15}/> Ajouter la 1ère observation
          </button>
        </div>
      )}

      <div ref={listRef}>
        {items.map((item, i) => {
          const isDragging = dragIdx === i;
          const isOver     = overIdx === i && dragIdx !== i;
          return (
            <div key={item.id}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragEnter={() => onDragEnter(i)}
              onDragEnd={onDragEnd}
              onDragOver={e => e.preventDefault()}
              onClick={() => { if (dragDidMoveRef.current) { dragDidMoveRef.current = false; return; } onEdit(item); }}
              style={{
                display:'flex', alignItems:'flex-start', gap:8,
                padding:'14px 14px 14px 6px',
                borderBottom:`1px solid ${DA.border}`,
                borderLeft:`4px solid ${URGENCE[item.urgence]?.dot || DA.border}`,
                cursor:'pointer',
                background: isDragging ? '#f0f0f0' : isOver ? DA.redL : 'white',
                borderTop: isOver ? `2px solid ${DA.red}` : 'none',
                opacity: isDragging ? 0.45 : 1,
                transition: 'background 0.08s, opacity 0.08s',
              }}>

              {/* ── Poignée drag ── */}
              <div
                onTouchStart={e => onGripTouchStart(e, i)}
                onClick={e => e.stopPropagation()}
                style={{
                  flexShrink:0, alignSelf:'center',
                  padding:'6px 4px', cursor:'grab', touchAction:'none',
                  color:'#bbb', display:'flex', alignItems:'center',
                }}>
                <Ic n="grp" s={16}/>
              </div>

              <div style={{ flex:1,minWidth:0 }}>
                <p style={{ fontSize:15,fontWeight:700,color:DA.black,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',margin:0 }}>{item.titre}</p>
                {item.commentaire && (
                  <p style={{ fontSize:13,color:DA.gray,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',margin:'4px 0 0',lineHeight:1.4 }}>{item.commentaire}</p>
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
                  if (validPhotos.length) return (
                    <div style={{ display:'flex',gap:4,marginTop:8,flexWrap:'wrap' }}>
                      {validPhotos.map((ph, pi) => (
                        <img key={pi} src={ph.data} alt=""
                          onClick={e => { e.stopPropagation(); setLightbox({ photos: validPhotos, idx: pi }); }}
                          style={{ width:'clamp(80px,23vw,130px)',height:'clamp(80px,23vw,130px)',objectFit:'cover',borderRadius:8,border:`1px solid ${DA.border}`,flexShrink:0,cursor:'pointer' }}/>
                      ))}
                    </div>
                  );
                  if (!item._photosHydrated && (item.photos||[]).length > 0) return (
                    <div style={{ display:'flex',gap:4,marginTop:8 }}>
                      {(item.photos||[]).slice(0,3).map((_,pi) => (
                        <div key={pi} style={{ width:64,height:64,borderRadius:8,background:'linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%)',backgroundSize:'200% 100%',animation:'shimmer 1.2s infinite',flexShrink:0 }}/>
                      ))}
                    </div>
                  );
                  return null;
                })()}
              </div>

              {(confirmDelId === item.id
                ? <div style={{ display:'flex',alignItems:'center',gap:6,flexShrink:0 }} onClick={e => e.stopPropagation()}>
                    <button onClick={e => { e.stopPropagation(); onDelete(item.id); setConfirmDelId(null); }} style={{ padding:'8px 12px',background:'#B91C1C',color:'white',border:'none',borderRadius:8,fontSize:13,fontWeight:700,cursor:'pointer' }}>Oui</button>
                    <button onClick={e => { e.stopPropagation(); setConfirmDelId(null); }} style={{ padding:'8px 12px',background:'white',color:'#555',border:'1px solid #E5E5E5',borderRadius:8,fontSize:13,cursor:'pointer' }}>Non</button>
                  </div>
                : <button onClick={e => { e.stopPropagation(); setConfirmDelId(item.id); }} style={{ color:DA.red,padding:'8px 9px',cursor:'pointer',flexShrink:0,background:'#FFF0F0',border:'1px solid #FECACA',borderRadius:8,display:'flex',alignItems:'center' }}>
                    <Ic n="del" s={15}/>
                  </button>
              )}
            </div>
          );
        })}
      </div>

      {items.length > 0 && (
        <div style={{ display:'flex',borderTop:`1px solid ${DA.border}` }}>
          <button onClick={() => onEdit(null)} style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:16,fontSize:15,fontWeight:700,color:DA.red,background:DA.white,border:'none',cursor:'pointer' }}>
            <Ic n="plus" s={16}/> Ajouter
          </button>
        </div>
      )}
    </div>
    </>
  );
}
