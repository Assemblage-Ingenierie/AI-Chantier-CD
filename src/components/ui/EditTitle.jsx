import React, { useState, useRef, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from './Icons.jsx';

export default function EditTitle({ value, onSave, onDelete, style = {}, inputStyle = {} }) {
  const [ed, setEd] = useState(false);
  const [v, setV] = useState(value);
  const ref = useRef();

  useEffect(() => { if (ed) ref.current?.select(); }, [ed]);

  const commit = () => {
    const t = v.trim();
    if (t) { onSave(t); setEd(false); }
  };

  if (ed) return (
    <div style={{ display:'flex',alignItems:'center',gap:4,flex:1,minWidth:0 }} onClick={e => e.stopPropagation()}>
      <input ref={ref} value={v} onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key==='Enter') commit(); if (e.key==='Escape') { setV(value); setEd(false); } }}
        style={{ flex:1,borderBottom:`2px solid ${DA.red}`,outline:'none',background:'transparent',...inputStyle }}/>
      <button onClick={commit} style={{ color:DA.red,padding:2,flexShrink:0 }}><Ic n="chk" s={13}/></button>
      {onDelete && <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ color:'#E30513',padding:2,flexShrink:0 }}><Ic n="del" s={13}/></button>}
      <button onClick={() => { setV(value); setEd(false); }} style={{ color:DA.grayL,padding:2,flexShrink:0 }}><Ic n="x" s={13}/></button>
    </div>
  );

  return (
    <span style={{ display:'flex',alignItems:'center',gap:4,cursor:'pointer',flex:1,minWidth:0,...style }} onDoubleClick={() => setEd(true)}>
      <span style={{ flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{value}</span>
      <button onClick={e => { e.stopPropagation(); setEd(true); }} style={{ color:DA.grayL,padding:2,flexShrink:0,opacity:0.4 }}><Ic n="edt" s={11}/></button>
    </span>
  );
}
