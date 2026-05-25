import React, { useState, useRef, useEffect } from 'react';
import { DA } from '../../lib/constants.js';

export default function CropTool({ src, ratio = 16/9, outputWidth = 1200, outputHeight = 675, cancelLabel = 'Annuler', onDone, onCancel }) {
  const containerRef = useRef(null);
  const imgRef       = useRef(null);
  const stRef        = useRef({ dx: 0, dy: 0, s: 1 });
  const natRef       = useRef(null);
  const dragRef      = useRef(null);
  const pinchRef     = useRef(null);
  const [ready, setReady] = useState(false);
  const [, forceRender]   = useState(0);
  const refresh = () => forceRender(n => n + 1);

  const getCW = () => containerRef.current?.clientWidth  || 320;
  const getCH = () => containerRef.current?.clientHeight || Math.round(getCW() / ratio);

  const clamp = (st) => {
    const nat = natRef.current;
    if (!nat) return;
    const cw = getCW(), ch = getCH();
    const fitS = Math.max(cw / nat.w, ch / nat.h);
    st.s  = Math.max(fitS, Math.min(st.s, fitS * 6));
    const dw = nat.w * st.s, dh = nat.h * st.s;
    st.dx = Math.max(-(dw - cw) / 2, Math.min((dw - cw) / 2, st.dx));
    st.dy = Math.max(-(dh - ch) / 2, Math.min((dh - ch) / 2, st.dy));
  };

  const handleLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    const cw = getCW(), ch = getCH();
    const fitS = Math.max(cw / w, ch / h);
    natRef.current = { w, h };
    stRef.current  = { dx: 0, dy: 0, s: fitS };
    setReady(true);
  };

  // Handle images that load synchronously (data URLs) before onLoad fires
  useEffect(() => {
    if (ready) return;
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) handleLoad();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onTouchStart = (e) => {
    e.preventDefault();
    if (e.touches.length >= 2) {
      dragRef.current = null;
      const [a, b] = e.touches;
      pinchRef.current = { dist0: Math.hypot(b.clientX-a.clientX, b.clientY-a.clientY), s0: stRef.current.s };
    } else {
      pinchRef.current = null;
      dragRef.current = { x0:e.touches[0].clientX, y0:e.touches[0].clientY, dx0:stRef.current.dx, dy0:stRef.current.dy };
    }
  };
  const onTouchMove = (e) => {
    e.preventDefault();
    const st = stRef.current;
    if (e.touches.length >= 2 && pinchRef.current) {
      const [a, b] = e.touches;
      st.s = pinchRef.current.s0 * Math.hypot(b.clientX-a.clientX, b.clientY-a.clientY) / pinchRef.current.dist0;
      clamp(st); refresh();
    } else if (e.touches.length === 1 && dragRef.current) {
      st.dx = dragRef.current.dx0 + e.touches[0].clientX - dragRef.current.x0;
      st.dy = dragRef.current.dy0 + e.touches[0].clientY - dragRef.current.y0;
      clamp(st); refresh();
    }
  };
  const onTouchEnd = (e) => {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) dragRef.current = null;
  };

  const onMouseDown = (e) => {
    e.preventDefault();
    dragRef.current = { x0:e.clientX, y0:e.clientY, dx0:stRef.current.dx, dy0:stRef.current.dy };
  };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    const st = stRef.current;
    st.dx = dragRef.current.dx0 + e.clientX - dragRef.current.x0;
    st.dy = dragRef.current.dy0 + e.clientY - dragRef.current.y0;
    clamp(st); refresh();
  };
  const stopDrag = () => { dragRef.current = null; };
  const onWheel  = (e) => { e.preventDefault(); stRef.current.s *= e.deltaY > 0 ? 0.92 : 1.09; clamp(stRef.current); refresh(); };

  const validate = () => {
    const img = imgRef.current, nat = natRef.current;
    if (!img || !nat) return;
    const cw = getCW(), ch = getCH();
    const { dx, dy, s } = stRef.current;
    const iLeft = cw/2 + dx - nat.w*s/2, iTop = ch/2 + dy - nat.h*s/2;
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth; canvas.height = outputHeight;
    canvas.getContext('2d').drawImage(img, -iLeft/s, -iTop/s, cw/s, ch/s, 0, 0, outputWidth, outputHeight);
    onDone(canvas.toDataURL('image/webp', 0.85));
  };

  const nat = natRef.current;
  const { dx, dy, s } = stRef.current;
  const pt = `${(100 / ratio).toFixed(4)}%`;

  return (
    <div>
      <p style={{ fontSize:11, color:'#999', textAlign:'center', margin:'0 0 10px' }}>
        Glissez pour cadrer · Pincez ou molette pour zoomer
      </p>
      <div ref={containerRef}
        style={{ width:'100%', paddingTop:pt, position:'relative', borderRadius:10,
          overflow:'hidden', background:'#111', cursor:'grab', userSelect:'none', touchAction:'none' }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={stopDrag} onMouseLeave={stopDrag}
        onWheel={onWheel}>
        <div style={{ position:'absolute', inset:0 }}>
          {ready && nat && (
            <img ref={imgRef} src={src} alt="" draggable={false}
              style={{ position:'absolute', maxWidth:'none', pointerEvents:'none',
                width: nat.w*s, height: nat.h*s,
                left: getCW()/2 + dx - nat.w*s/2,
                top:  getCH()/2 + dy - nat.h*s/2 }}/>
          )}
          {!ready && <img ref={imgRef} src={src} alt="" onLoad={handleLoad} style={{ position:'absolute', opacity:0, pointerEvents:'none' }}/>}
          <div style={{ position:'absolute', inset:0, boxShadow:'inset 0 0 0 2px rgba(255,255,255,0.7)', borderRadius:10, pointerEvents:'none' }}/>
          {[33.33, 66.66].map(p => (
            <React.Fragment key={p}>
              <div style={{ position:'absolute', left:`${p}%`, top:0, bottom:0, borderLeft:'1px solid rgba(255,255,255,0.18)', pointerEvents:'none' }}/>
              <div style={{ position:'absolute', top:`${p}%`, left:0, right:0, borderTop:'1px solid rgba(255,255,255,0.18)', pointerEvents:'none' }}/>
            </React.Fragment>
          ))}
        </div>
      </div>
      <div style={{ display:'flex', gap:8, marginTop:12 }}>
        <button onClick={onCancel}
          style={{ flex:1, padding:'10px 0', border:`1px solid ${DA.border}`, background:'white', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', color:DA.gray }}>
          {cancelLabel}
        </button>
        <button onClick={validate} disabled={!ready}
          style={{ flex:2, padding:'10px 0', background: ready ? DA.black : '#ccc', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor: ready ? 'pointer' : 'default', color:'white' }}>
          ✓ Valider le cadrage
        </button>
      </div>
    </div>
  );
}
