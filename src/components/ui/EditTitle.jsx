import React, { useState, useRef, useEffect } from 'react';

export default function EditTitle({ value, onSave, style = {}, inputStyle = {} }) {
  const [ed, setEd] = useState(false);
  const [v, setV] = useState(value);
  const ref = useRef();

  useEffect(() => { if (ed) { ref.current?.focus(); ref.current?.select(); } }, [ed]);
  useEffect(() => { if (!ed) setV(value); }, [value, ed]);

  const commit = () => {
    const t = v.trim();
    if (t && t !== value) onSave(t);
    else setV(value);
    setEd(false);
  };

  if (ed) return (
    <input
      ref={ref}
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setV(value); setEd(false); }
      }}
      onClick={e => e.stopPropagation()}
      style={{ flex:1, border:'none', outline:'none', background:'transparent', borderBottom:'2px solid #E30513', padding:'0 0 1px', ...inputStyle }}
    />
  );

  return (
    <span
      title="Cliquer pour renommer"
      onClick={e => { e.stopPropagation(); setEd(true); }}
      style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor:'text', ...style }}>
      {value}
    </span>
  );
}
