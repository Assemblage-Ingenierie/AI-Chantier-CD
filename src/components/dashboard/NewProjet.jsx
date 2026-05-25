import React, { useState, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

const FIELDS = [
  { k: 'nom',          l: 'Nom du projet *',  ph: 'Ex: Résidence Les Acacias'     },
  { k: 'maitreOuvrage',l: "Maître d'ouvrage", ph: 'Ex: Ville de Lyon, M. Dupont…' },
  { k: 'adresse',      l: 'Adresse',          ph: 'Ex: 12 rue des Acacias, Lyon'  },
];

// ─── CropTool ─────────────────────────────────────────────────────────────────
function CropTool({ src, onDone, onCancel }) {
  const containerRef = useRef(null);
  const imgRef       = useRef(null);
  const stRef        = useRef({ dx: 0, dy: 0, s: 1 });
  const natRef       = useRef(null); // { w, h }
  const dragRef      = useRef(null);
  const pinchRef     = useRef(null);
  const [ready, setReady] = useState(false);
  const [, forceRender]   = useState(0);
  const refresh = () => forceRender(n => n + 1);

  const getCW = () => containerRef.current?.clientWidth  || 320;
  const getCH = () => containerRef.current?.clientHeight || Math.round(getCW() * 9 / 16);

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
    const cw = getCW(), ch = getCH();
    const fitS = Math.max(cw / w, ch / h);
    natRef.current  = { w, h };
    stRef.current   = { dx: 0, dy: 0, s: fitS };
    setReady(true);
  };

  /* ── Touch ──────────────────────────────────────────────── */
  const onTouchStart = (e) => {
    e.preventDefault();
    if (e.touches.length >= 2) {
      dragRef.current = null;
      const [a, b] = e.touches;
      pinchRef.current = {
        dist0: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        s0: stRef.current.s,
      };
    } else {
      pinchRef.current = null;
      dragRef.current = {
        x0: e.touches[0].clientX, y0: e.touches[0].clientY,
        dx0: stRef.current.dx,    dy0: stRef.current.dy,
      };
    }
  };

  const onTouchMove = (e) => {
    e.preventDefault();
    const st = stRef.current;
    if (e.touches.length >= 2 && pinchRef.current) {
      const [a, b] = e.touches;
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      st.s = pinchRef.current.s0 * dist / pinchRef.current.dist0;
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

  /* ── Mouse ──────────────────────────────────────────────── */
  const onMouseDown = (e) => {
    e.preventDefault();
    dragRef.current = {
      x0: e.clientX, y0: e.clientY,
      dx0: stRef.current.dx, dy0: stRef.current.dy,
    };
  };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    const st = stRef.current;
    st.dx = dragRef.current.dx0 + e.clientX - dragRef.current.x0;
    st.dy = dragRef.current.dy0 + e.clientY - dragRef.current.y0;
    clamp(st); refresh();
  };
  const stopDrag = () => { dragRef.current = null; };

  const onWheel = (e) => {
    e.preventDefault();
    stRef.current.s *= e.deltaY > 0 ? 0.92 : 1.09;
    clamp(stRef.current); refresh();
  };

  /* ── Validate ───────────────────────────────────────────── */
  const validate = () => {
    const img = imgRef.current;
    const nat = natRef.current;
    if (!img || !nat) return;
    const cw = getCW(), ch = getCH();
    const { dx, dy, s } = stRef.current;
    const iLeft  = cw / 2 + dx - nat.w * s / 2;
    const iTop   = ch / 2 + dy - nat.h * s / 2;
    const cropX  = -iLeft / s,  cropY  = -iTop / s;
    const cropW  = cw    / s,   cropH  = ch    / s;
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 675;
    canvas.getContext('2d').drawImage(img, cropX, cropY, cropW, cropH, 0, 0, 1200, 675);
    onDone(canvas.toDataURL('image/webp', 0.85));
  };

  /* ── Render ─────────────────────────────────────────────── */
  const nat = natRef.current;
  const { dx, dy, s } = stRef.current;

  return (
    <div>
      <p style={{ fontSize:11, color:'#999', textAlign:'center', margin:'0 0 10px' }}>
        Glissez pour cadrer · Pincez ou molette pour zoomer
      </p>

      {/* Crop frame */}
      <div ref={containerRef}
        style={{ width:'100%', paddingTop:'56.25%', position:'relative', borderRadius:10,
          overflow:'hidden', background:'#111', cursor:'grab', userSelect:'none', touchAction:'none' }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={stopDrag} onMouseLeave={stopDrag}
        onWheel={onWheel}>

        {/* Event catcher (inset:0 layer) */}
        <div style={{ position:'absolute', inset:0 }}>
          {ready && nat && (
            <img ref={imgRef} src={src} alt="" draggable={false}
              style={{
                position:'absolute', maxWidth:'none', pointerEvents:'none',
                width:  nat.w * s,
                height: nat.h * s,
                left: getCW() / 2 + dx - nat.w * s / 2,
                top:  getCH() / 2 + dy - nat.h * s / 2,
              }}
            />
          )}
          {/* Hidden img for loading when not yet ready */}
          {!ready && (
            <img ref={imgRef} src={src} alt="" onLoad={handleLoad}
              style={{ position:'absolute', opacity:0, pointerEvents:'none' }}/>
          )}
          {/* White border + rule-of-thirds */}
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
          Annuler
        </button>
        <button onClick={validate} disabled={!ready}
          style={{ flex:2, padding:'10px 0', background: ready ? DA.black : '#ccc', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor: ready ? 'pointer' : 'default', color:'white' }}>
          ✓ Valider le cadrage
        </button>
      </div>
    </div>
  );
}

// ─── NewProjet ────────────────────────────────────────────────────────────────
export default function NewProjet({ onClose, onSave }) {
  const [f,        setF]        = useState({ nom:'', adresse:'', photo:null, maitreOuvrage:'' });
  const [rawPhoto, setRawPhoto] = useState(null);
  const fileRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert('Image trop grande (max 25 Mo)'); return; }
    setRawPhoto(URL.createObjectURL(file));
  };

  const handleCropDone = (dataUrl) => {
    if (rawPhoto?.startsWith('blob:')) URL.revokeObjectURL(rawPhoto);
    setRawPhoto(null);
    setF(p => ({ ...p, photo: dataUrl }));
  };

  const handleCropCancel = () => {
    if (rawPhoto?.startsWith('blob:')) URL.revokeObjectURL(rawPhoto);
    setRawPhoto(null);
  };

  /* ── Crop screen ────────────────────────────────────────── */
  if (rawPhoto) return (
    <div className="modal-overlay">
      <div className="modal-sheet" style={{ padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:14 }}>
          <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:0 }}>Cadrer la photo</p>
          <button onClick={handleCropCancel} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL }}>
            <Ic n="x" s={20}/>
          </button>
        </div>
        <CropTool src={rawPhoto} onDone={handleCropDone} onCancel={handleCropCancel}/>
      </div>
    </div>
  );

  /* ── Form screen ────────────────────────────────────────── */
  return (
    <div className="modal-overlay">
      <div className="modal-sheet" style={{ padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
          <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:0 }}>Nouveau projet</p>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL }}>
            <Ic n="x" s={20}/>
          </button>
        </div>

        {/* Zone photo cliquable */}
        <div onClick={() => fileRef.current?.click()}
          style={{ position:'relative', width:'100%', paddingTop:'56.25%', borderRadius:12,
            border:`2px dashed ${f.photo ? 'transparent' : DA.border}`,
            overflow:'hidden', background: f.photo ? 'transparent' : DA.grayXL,
            marginBottom:8, cursor:'pointer', boxSizing:'border-box' }}>
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
            {f.photo ? (
              <>
                <img src={f.photo} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
                <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.28)', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                  <span style={{ fontSize:11, color:'white', fontWeight:700, background:'rgba(0,0,0,0.45)', padding:'4px 10px', borderRadius:6 }}>
                    Changer
                  </span>
                </div>
              </>
            ) : (
              <div style={{ textAlign:'center', pointerEvents:'none' }}>
                <Ic n="cam" s={28}/>
                <p style={{ fontSize:11, color:DA.grayL, marginTop:6, marginBottom:0 }}>
                  Appuyer pour prendre une photo
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Boutons sous la zone */}
        <div style={{ display:'flex', gap:6, marginBottom:16, justifyContent: f.photo ? 'center' : 'flex-start' }}>
          <button onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
            style={{ border:`1px solid ${DA.border}`, background:'white', borderRadius:7, padding:'5px 12px', fontSize:11, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:4, color:DA.gray }}>
            <Ic n="img" s={11}/> Galerie
          </button>
          {f.photo && (
            <button onClick={(e) => { e.stopPropagation(); setRawPhoto(f.photo); }}
              style={{ border:`1px solid ${DA.border}`, background:'white', borderRadius:7, padding:'5px 12px', fontSize:11, fontWeight:600, cursor:'pointer', color:DA.gray }}>
              ✂ Recadrer
            </button>
          )}
        </div>

        <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }}
          onChange={e => { const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = ''; }}/>

        {/* Champs texte */}
        {FIELDS.map(({ k, l, ph }) => (
          <div key={k} style={{ marginBottom:12 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:DA.gray, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>{l}</label>
            <input value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} placeholder={ph}
              style={{ width:'100%', border:`1px solid ${DA.border}`, borderRadius:8, padding:'10px 12px', fontSize:13, outline:'none', boxSizing:'border-box' }}
              onFocus={e  => e.target.style.borderColor = DA.red}
              onBlur={e   => e.target.style.borderColor = DA.border}/>
          </div>
        ))}

        <button onClick={() => { onSave(f); onClose(); }} disabled={!f.nom}
          style={{ width:'100%', background: f.nom ? DA.black : '#ccc', color:'white', border:'none', borderRadius:12, padding:13, fontSize:14, fontWeight:800, cursor: f.nom ? 'pointer' : 'not-allowed', marginTop:4 }}>
          Créer le projet
        </button>
      </div>
    </div>
  );
}
