import React, { useState, useRef, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

// Barre de plans réordonnables par glisser-déposer.
// Desktop : drag HTML5. Mobile : appui long sur la poignée + glisser.
export default function PlanDragBar({ plans, locId, onReorder }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const dragDidMoveRef       = useRef(false);
  const listRef              = useRef();
  const touchDragRef         = useRef(null);
  const ghostRef             = useRef(null);
  const wrapperRef           = useRef(null);
  const onMoveRef            = useRef(null);
  const onEndRef             = useRef(null);

  // HTML5 drag (desktop)
  const onDragStart = (i) => { setDragIdx(i); dragDidMoveRef.current = false; };
  const onDragEnter = (i) => { setOverIdx(i); dragDidMoveRef.current = true; };
  const onDragEnd   = ()  => {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx)
      onReorder(locId, dragIdx, overIdx);
    setDragIdx(null); setOverIdx(null); dragDidMoveRef.current = false;
  };

  // Touch drag (mobile) — passive:false sur touchmove pour pouvoir preventDefault
  useEffect(() => {
    onMoveRef.current = onTouchMove;
    onEndRef.current  = onTouchEnd;
  });
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const mv = (e) => onMoveRef.current(e);
    const en = (e) => onEndRef.current(e);
    el.addEventListener('touchmove',   mv, { passive: false });
    el.addEventListener('touchend',    en);
    el.addEventListener('touchcancel', en);
    return () => {
      el.removeEventListener('touchmove',   mv);
      el.removeEventListener('touchend',    en);
      el.removeEventListener('touchcancel', en);
    };
  }, []);

  useEffect(() => () => { ghostRef.current?.remove(); }, []);

  const onGripTouchStart = (e, idx) => {
    e.stopPropagation();
    const touch = e.touches[0];
    dragDidMoveRef.current = false;
    touchDragRef.current = { idx, curOverIdx: idx };
    setDragIdx(idx);
    const chip = listRef.current?.children[idx];
    if (chip) {
      const r = chip.getBoundingClientRect();
      const clone = chip.cloneNode(true);
      clone.style.cssText = `position:fixed;left:${touch.clientX - r.width/2}px;top:${r.top}px;height:${r.height}px;width:${r.width}px;opacity:0.85;background:white;box-shadow:0 4px 16px rgba(0,0,0,0.25);border-radius:8px;z-index:9998;pointer-events:none;border:2px solid ${DA.red};`;
      document.body.appendChild(clone);
      ghostRef.current = clone;
    }
  };

  const onTouchMove = (e) => {
    if (!touchDragRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    dragDidMoveRef.current = true;
    if (ghostRef.current) {
      const w = parseFloat(ghostRef.current.style.width) || 60;
      ghostRef.current.style.left = `${touch.clientX - w / 2}px`;
    }
    if (!listRef.current) return;
    const chips = listRef.current.children;
    let newOver = plans.length - 1;
    for (let j = 0; j < chips.length; j++) {
      const r = chips[j].getBoundingClientRect();
      if (touch.clientX < r.left + r.width / 2) { newOver = j; break; }
    }
    touchDragRef.current.curOverIdx = newOver;
    setOverIdx(newOver);
  };

  const onTouchEnd = () => {
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
    if (!touchDragRef.current) return;
    const { idx, curOverIdx } = touchDragRef.current;
    touchDragRef.current = null;
    if (dragDidMoveRef.current && idx !== curOverIdx) onReorder(locId, idx, curOverIdx);
    setDragIdx(null); setOverIdx(null); dragDidMoveRef.current = false;
  };

  return (
    <div ref={wrapperRef}>
      <div ref={listRef}
        style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 8px',
          background:DA.grayXL, borderBottom:`1px solid ${DA.border}`,
          overflowX:'auto', flexWrap:'nowrap' }}>
        {plans.map((pt, pi) => {
          const isDragging = dragIdx === pi;
          const isOver     = overIdx === pi && dragIdx !== pi;
          return (
            <div key={pi}
              draggable
              onDragStart={() => onDragStart(pi)}
              onDragEnter={() => onDragEnter(pi)}
              onDragEnd={onDragEnd}
              onDragOver={e => e.preventDefault()}
              style={{ display:'flex', alignItems:'center', gap:3,
                padding:'4px 8px 4px 4px',
                background: isDragging ? '#e8e8e8' : isOver ? DA.redL : 'white',
                borderRadius:7, border:`1.5px solid ${isOver ? DA.red : DA.border}`,
                opacity: isDragging ? 0.4 : 1, cursor:'grab', userSelect:'none', flexShrink:0 }}>
              <div
                onTouchStart={e => onGripTouchStart(e, pi)}
                style={{ touchAction:'none', color:'#ccc', display:'flex', alignItems:'center', cursor:'grab' }}>
                <Ic n="grp" s={13}/>
              </div>
              <span style={{ fontSize:10, fontWeight:700, color:DA.gray,
                maxWidth:72, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {pt.nom}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
