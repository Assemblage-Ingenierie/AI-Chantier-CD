import React, { useState, useRef, useEffect, useCallback } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

const ANNOT_COLORS = ['#E30513','#E67E22','#F1C40F','#2980B9','#27AE60','#8E44AD','#222222','#FFFFFF'];

// ── Viewpoint (œil + cône de vue) ────────────────────────────────────────────
export function drawVP(ctx, { x, y, angle = 0, label = '', size = 3, color = '#E30513' }) {
  const r  = 10 + size;
  const L  = 40 + size * 4;
  const sp = 0.62; // demi-angle du cône (~35°)
  ctx.save();
  // Cône rempli semi-transparent
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle - sp) * L, y + Math.sin(angle - sp) * L);
  ctx.arc(x, y, L, angle - sp, angle + sp);
  ctx.closePath();
  ctx.fillStyle = color; ctx.globalAlpha = 0.15; ctx.fill();
  // Contour cône
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = color; ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle - sp) * L, y + Math.sin(angle - sp) * L);
  ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle + sp) * L, y + Math.sin(angle + sp) * L);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, L, angle - sp, angle + sp); ctx.stroke();
  // Cercle œil
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  // Pupille
  ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  // Étiquette
  if (label) {
    ctx.font = `bold ${8 + size}px Arial`;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.strokeText(label, x + r + 3, y - r + 4);
    ctx.fillStyle = color;
    ctx.fillText(label, x + r + 3, y - r + 4);
  }
  ctx.restore();
}

// Dessine un tableau de paths annotateur sur un contexte canvas existant.
// sizeScale > 1 agrandit les annotations proportionnellement (utile pour les rendus PDF/rapport
// où l'image est réduite par rapport à sa taille naturelle).
export function drawAnnotationPaths(ctx, paths, sizeScale = 1) {
  (paths || []).forEach(p => {
    if (p.type === 'viewpoint') {
      ctx.save();
      if (sizeScale !== 1 && p.x != null) {
        ctx.translate(p.x, p.y); ctx.scale(sizeScale, sizeScale); ctx.translate(-p.x, -p.y);
      }
      drawVP(ctx, p);
      ctx.restore();
    } else if (p.type === 'symbol') {
      const sm = SYMBOLS.find(x => x.id === p.symbolId);
      if (sm) {
        ctx.save();
        if (sizeScale !== 1 && p.x != null) {
          ctx.translate(p.x, p.y); ctx.scale(sizeScale, sizeScale); ctx.translate(-p.x, -p.y);
        }
        sm.draw(ctx, p.x, p.y, p.size, p.color);
        ctx.restore();
      }
    } else if (p.type === 'text') {
      ctx.save();
      if (sizeScale !== 1 && p.x != null) {
        ctx.translate(p.x, p.y); ctx.scale(sizeScale, sizeScale); ctx.translate(-p.x, -p.y);
      }
      ctx.font = `bold ${12 + p.size * 2}px Arial`;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    } else if (p.points?.length) {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = (p.tool === 'eraser' ? p.size * 6 : p.size) * sizeScale;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = p.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.moveTo(p.points[0].x, p.points[0].y);
      p.points.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
      ctx.restore();
    }
  });
}

export const SYMBOLS = [
  { id:'fissure_plafond', label:'Fissure plafond', short:'↑PL', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.moveTo(x-14,y-5); ctx.lineTo(x-6,y); ctx.lineTo(x+2,y-6); ctx.lineTo(x+8,y+1); ctx.lineTo(x+14,y-3); ctx.stroke(); ctx.font=`bold ${8+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('↑PL',x-8,y+15); ctx.fillText('↑PL',x-8,y+15); ctx.restore(); } },
  { id:'fissure_mur', label:'Fissure mur', short:'MUR', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.moveTo(x-8,y-15); ctx.lineTo(x-3,y-6); ctx.lineTo(x+4,y-10); ctx.lineTo(x+7,y+3); ctx.lineTo(x+10,y+15); ctx.stroke(); ctx.font=`bold ${8+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('MUR',x-10,y+27); ctx.fillText('MUR',x-10,y+27); ctx.restore(); } },
  { id:'humidite', label:'Humidité', short:'~H~', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.setLineDash([5,3]); ctx.beginPath(); ctx.ellipse(x,y,22,13,0,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]); ctx.font=`bold ${12+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('~H~',x-12,y+5); ctx.fillText('~H~',x-12,y+5); ctx.restore(); } },
  { id:'decollement', label:'Décollement', short:'DÉC', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.rect(x-16,y-10,32,20); ctx.stroke(); ctx.setLineDash([3,3]); ctx.beginPath(); ctx.rect(x-11,y-6,22,12); ctx.stroke(); ctx.setLineDash([]); ctx.font=`bold ${8+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('DÉC',x-9,y+4); ctx.fillText('DÉC',x-9,y+4); ctx.restore(); } },
  { id:'danger', label:'Danger', short:'!', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.moveTo(x,y-18); ctx.lineTo(x+16,y+12); ctx.lineTo(x-16,y+12); ctx.closePath(); ctx.stroke(); ctx.font=`bold ${14+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('!',x-3.5,y+9); ctx.fillText('!',x-3.5,y+9); ctx.restore(); } },
  { id:'fleche', label:'Flèche', short:'→', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.fillStyle=c; ctx.lineWidth=s+2; ctx.beginPath(); ctx.moveTo(x-20,y); ctx.lineTo(x+4,y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x+4,y); ctx.lineTo(x-5,y-8); ctx.lineTo(x-5,y+8); ctx.closePath(); ctx.fill(); ctx.restore(); } },
  { id:'eclat', label:'Éclatement', short:'ÉCL', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); for(let i=0;i<8;i++){const a=i*Math.PI/4,r=i%2===0?18:10; i===0?ctx.moveTo(x,y):null; ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);} ctx.closePath(); ctx.stroke(); ctx.font=`bold ${7+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('ÉCL',x-9,y+28); ctx.fillText('ÉCL',x-9,y+28); ctx.restore(); } },
  { id:'nc', label:'Non-conformité', short:'NC', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.arc(x,y,14,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x-8,y-8); ctx.lineTo(x+8,y+8); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x+8,y-8); ctx.lineTo(x-8,y+8); ctx.stroke(); ctx.font=`bold ${7+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('NC',x-7,y+26); ctx.fillText('NC',x-7,y+26); ctx.restore(); } },
  { id:'rouille', label:'Corrosion', short:'Fe', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.arc(x,y,14,0,Math.PI*2); ctx.stroke(); ctx.font=`bold ${12+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('Fe',x-7,y+4); ctx.fillText('Fe',x-7,y+4); ctx.restore(); } },
];

export default function Annotator({ bgImage, savedPaths, onSave, onClose, photos }) {
  const cvRef    = useRef();
  const bgRef    = useRef(null);
  const vpStart  = useRef(null);

  const [tool,      setTool]      = useState('pen');
  const [color,     setColor]     = useState(DA.red);
  const [size,      setSize]      = useState(3);
  const [sym,       setSym]       = useState(SYMBOLS[0]);
  const [paths,     setPaths]     = useState(savedPaths || []);
  const [cur,       setCur]       = useState([]);
  const [drawing,   setDrawing]   = useState(false);
  const [bgOk,      setBgOk]      = useState(false);
  const [showSyms,  setShowSyms]  = useState(false);
  const [textPt,    setTextPt]    = useState(null);
  const [textV,     setTextV]     = useState('');
  const [activePh,  setActivePh]  = useState(null); // { label, src } photo sélectionnée
  const [pendingVP, setPendingVP] = useState(null); // { x, y, angle } vue en cours de tracé
  const [vt,        setVt]        = useState({ z: 1, px: 0, py: 0 }); // pinch zoom/pan
  const vtRef     = useRef({ z: 1, px: 0, py: 0 });
  const gestureRef = useRef(null); // active pinch gesture state

  // Global annotation size multiplier — persisted in localStorage across all plans
  const [annotScale, setAnnotScale] = useState(() => {
    const v = parseFloat(localStorage.getItem('chantierai_annot_scale') ?? '1');
    return isNaN(v) ? 1 : Math.max(0.3, Math.min(2, v));
  });

  useEffect(() => { vtRef.current = vt; }, [vt]);
  // Reset zoom/pan when a new plan is loaded
  useEffect(() => { setVt({ z: 1, px: 0, py: 0 }); vtRef.current = { z: 1, px: 0, py: 0 }; }, [bgImage]);

  const vpCount = paths.filter(p => p.type === 'viewpoint').length;

  const redraw = useCallback(() => {
    const cv = cvRef.current;
    if (!cv || !bgOk) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (bgRef.current) ctx.drawImage(bgRef.current, 0, 0, cv.width, cv.height);

    // Scale annotations so they appear at a consistent visual size on screen,
    // regardless of the image's native resolution (photos are often 3000+ px wide
    // but displayed at ~350px on mobile, which makes unscaled annotations invisible).
    const displayScale = cv.clientWidth > 0 ? (cv.width / cv.clientWidth) * 0.5 * annotScale : 1;

    const all = [...paths, ...(cur.length > 1 && (tool === 'pen' || tool === 'eraser') ? [{ type:'stroke', tool, points:cur, color, size }] : [])];
    drawAnnotationPaths(ctx, all, displayScale);

    // Vue en cours de tracé
    if (pendingVP) {
      ctx.save();
      if (displayScale > 1) {
        ctx.translate(pendingVP.x, pendingVP.y);
        ctx.scale(displayScale, displayScale);
        ctx.translate(-pendingVP.x, -pendingVP.y);
      }
      drawVP(ctx, { ...pendingVP, label: activePh?.label || `V${vpCount + 1}`, color, size });
      ctx.restore();
    }
  }, [paths, cur, color, size, tool, bgOk, pendingVP, activePh, vpCount, annotScale]);

  useEffect(() => { redraw(); }, [redraw]);

  useEffect(() => {
    if (!bgImage) return;
    const img = new window.Image();
    img.onload = () => {
      const cv = cvRef.current;
      if (!cv) return;
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      bgRef.current = img;
      setBgOk(true);
    };
    img.onerror = () => setBgOk(true);
    img.src = bgImage;
  }, [bgImage]);

  const getXY = (e, cv) => {
    const r = cv.getBoundingClientRect(), sx = cv.width / r.width, sy = cv.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * sx, y: (src.clientY - r.top) * sy };
  };

  const onStart = e => {
    e.preventDefault();
    // Two-finger pinch/pan gesture
    if (e.touches?.length >= 2) {
      if (drawing) { setCur([]); setDrawing(false); }
      const [t1, t2] = e.touches;
      const cur = vtRef.current;
      const r = cvRef.current?.getBoundingClientRect();
      gestureRef.current = {
        startDist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
        startZ: cur.z, startPx: cur.px, startPy: cur.py,
        midX: (t1.clientX + t2.clientX) / 2,
        midY: (t1.clientY + t2.clientY) / 2,
        // Natural center = visual canvas center minus the pan offset
        ncX: r ? r.left + r.width / 2 - cur.px : 0,
        ncY: r ? r.top + r.height / 2 - cur.py : 0,
      };
      return;
    }
    if (gestureRef.current) return; // gesture in progress — ignore stray single touch
    const pos = getXY(e, cvRef.current);
    if (tool === 'viewpoint') {
      vpStart.current = pos;
      setPendingVP({ x: pos.x, y: pos.y, angle: 0 });
      setDrawing(true);
      return;
    }
    if (tool === 'symbol') { setPaths(prev => [...prev, { type:'symbol', symbolId:sym.id, x:pos.x, y:pos.y, color, size }]); return; }
    if (tool === 'text') { setTextPt(pos); setTextV(''); return; }
    setDrawing(true); setCur([pos]);
  };

  const onMove = e => {
    e.preventDefault();
    if (e.touches?.length >= 2 && gestureRef.current) {
      const [t1, t2] = e.touches;
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      const g = gestureRef.current;
      const newZ = Math.min(6, Math.max(1, g.startZ * dist / g.startDist));
      const ratio = newZ / g.startZ;
      // Zoom around initial pinch midpoint + follow midpoint translation
      const newPx = midX - g.ncX - (g.midX - g.ncX - g.startPx) * ratio;
      const newPy = midY - g.ncY - (g.midY - g.ncY - g.startPy) * ratio;
      // Clamp so canvas never leaves the viewport entirely
      const cv = cvRef.current;
      const maxPx = cv ? cv.clientWidth  * (newZ - 1) / 2 : 9999;
      const maxPy = cv ? cv.clientHeight * (newZ - 1) / 2 : 9999;
      setVt({ z: newZ, px: Math.max(-maxPx, Math.min(maxPx, newPx)), py: Math.max(-maxPy, Math.min(maxPy, newPy)) });
      return;
    }
    if (!drawing) return;
    if (tool === 'viewpoint' && vpStart.current) {
      const pos = getXY(e, cvRef.current);
      const dx = pos.x - vpStart.current.x;
      const dy = pos.y - vpStart.current.y;
      setPendingVP({ x: vpStart.current.x, y: vpStart.current.y, angle: Math.atan2(dy, dx) });
      return;
    }
    setCur(prev => [...prev, getXY(e, cvRef.current)]);
  };

  const onEnd = e => {
    e.preventDefault();
    if (gestureRef.current) {
      if (e.touches.length < 2) gestureRef.current = null;
      return;
    }
    if (!drawing) return;
    if (tool === 'viewpoint' && vpStart.current) {
      const label = activePh?.label || `V${vpCount + 1}`;
      setPaths(prev => [...prev, {
        type: 'viewpoint',
        x: pendingVP?.x ?? vpStart.current.x,
        y: pendingVP?.y ?? vpStart.current.y,
        angle: pendingVP?.angle ?? 0,
        label, color, size,
      }]);
      setPendingVP(null);
      vpStart.current = null;
      setDrawing(false);
      setActivePh(null);
      return;
    }
    if (cur.length >= 2) setPaths(prev => [...prev, { type:'stroke', tool, points:cur, color, size }]);
    setCur([]); setDrawing(false);
  };

  const addText = () => {
    if (!textV.trim() || !textPt) { setTextPt(null); return; }
    setPaths(prev => [...prev, { type:'text', text:textV.trim(), x:textPt.x, y:textPt.y, color, size }]);
    setTextPt(null); setTextV('');
  };

  const validPhotos = (photos || []).filter(ph => ph.data).slice(0, 12);

  const selectPhoto = (ph, i) => {
    const label = `V${i + 1}`;
    const isActive = activePh?.label === label;
    setActivePh(isActive ? null : { label, src: ph.data });
    setTool('viewpoint');
    setShowSyms(false);
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'#111',zIndex:50,display:'flex',flexDirection:'column' }}>

      {/* ── Toolbar ── */}
      <div style={{ background:DA.black,padding:'8px 12px',display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,flexShrink:0 }}>
        <button onClick={onClose} style={{ color:DA.grayL }}><Ic n="x" s={18}/></button>
        <div style={{ display:'flex',gap:4,background:'#333',padding:4,borderRadius:8 }}>
          {[
            { k:'pen', n:'pen' },
            { k:'eraser', n:'eras' },
            { k:'text', n:'txt' },
            { k:'symbol', n:'sym' },
            { k:'viewpoint', n:'eye' },
          ].map(t => (
            <button key={t.k}
              onClick={() => {
                setTool(t.k);
                if (t.k === 'symbol') setShowSyms(v => !v); else setShowSyms(false);
                if (t.k !== 'viewpoint') setActivePh(null);
              }}
              title={t.k === 'viewpoint' ? 'Vue photo — cliquer-glisser pour placer et orienter' : undefined}
              style={{ padding:6,borderRadius:6,background:tool===t.k?DA.red:'transparent',color:tool===t.k?'white':'#aaa',transition:'all 0.15s' }}>
              <Ic n={t.n} s={14}/>
            </button>
          ))}
        </div>
        <div style={{ display:'flex',gap:6,flexWrap:'wrap' }}>
          {ANNOT_COLORS.map(cl => (
            <button key={cl} onClick={() => setColor(cl)}
              style={{ width:20,height:20,borderRadius:'50%',background:cl,border:`2.5px solid ${color===cl?'white':'transparent'}`,cursor:'pointer',flexShrink:0 }}/>
          ))}
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:6 }}>
          {[1,3,6].map(sz => (
            <button key={sz} onClick={() => setSize(sz)}
              style={{ width:sz*2+8,height:sz*2+8,borderRadius:'50%',background:size===sz?'white':'#555',cursor:'pointer',flexShrink:0 }}/>
          ))}
        </div>
        <div style={{ marginLeft:'auto',display:'flex',gap:6 }}>
          <button onClick={() => setPaths(p => p.slice(0,-1))} style={{ padding:6,borderRadius:8,background:'#333',color:DA.grayL }}><Ic n="und" s={15}/></button>
          <button onClick={() => { const cv = cvRef.current; onSave(paths, cv ? cv.toDataURL('image/png') : null); onClose(); }}
            style={{ padding:'6px 12px',borderRadius:8,background:DA.red,color:'white',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:4 }}>
            <Ic n="chk" s={13}/> Sauvegarder
          </button>
        </div>
      </div>

      {/* ── Taille globale des logos ── */}
      <div style={{ background:'#1a1a1a',padding:'5px 12px',display:'flex',alignItems:'center',gap:10,flexShrink:0,borderBottom:'1px solid #222' }}>
        <span style={{ color:'#888',fontSize:10,fontWeight:600,whiteSpace:'nowrap',letterSpacing:0.3 }}>LOGOS</span>
        <input type="range" min="0.3" max="2" step="0.1" value={annotScale}
          onChange={e => {
            const v = parseFloat(e.target.value);
            setAnnotScale(v);
            localStorage.setItem('chantierai_annot_scale', String(v));
          }}
          style={{ flex:1,accentColor:DA.red,cursor:'pointer' }}/>
        <span style={{ color:'#ccc',fontSize:11,fontWeight:700,minWidth:30,textAlign:'right' }}>{annotScale.toFixed(1)}×</span>
      </div>

      {/* ── Symbol picker ── */}
      {showSyms && tool === 'symbol' && (
        <div style={{ background:'#1a1a1a',padding:'8px 12px',display:'flex',gap:8,overflowX:'auto',flexShrink:0,borderBottom:'1px solid #333' }}>
          {SYMBOLS.map(sm => (
            <button key={sm.id} onClick={() => setSym(sm)}
              style={{ flexShrink:0,padding:'4px 10px',borderRadius:8,background:sym.id===sm.id?DA.red:'#333',color:sym.id===sm.id?'white':'#ccc',fontSize:11,fontWeight:500,whiteSpace:'nowrap',cursor:'pointer' }}>
              {sm.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Aide viewpoint ── */}
      {tool === 'viewpoint' && (
        <div style={{ background:'#1a1a1a',padding:'5px 14px',borderBottom:'1px solid #333',flexShrink:0,display:'flex',alignItems:'center',gap:8 }}>
          <Ic n="eye" s={12}/>
          <span style={{ fontSize:11,color:'#888' }}>
            {activePh
              ? <><span style={{ color:DA.red,fontWeight:700 }}>{activePh.label}</span> sélectionnée — cliquer-glisser sur le plan pour placer et orienter</>
              : 'Cliquer-glisser sur le plan pour placer un œil de vue. Sélectionnez une photo en bas pour la numéroter.'}
          </span>
        </div>
      )}

      {/* ── Canvas ── */}
      <div style={{ flex:1,overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',background:'#1a1a1a',padding:8,minHeight:0 }}>
        {bgImage ? (
          <div style={{ position:'relative',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center' }}>
            <canvas ref={cvRef}
              style={{ maxWidth:'100%',maxHeight:'100%',display:'block',touchAction:'none',boxShadow:'0 0 40px rgba(0,0,0,0.5)',cursor:tool==='text'?'text':'crosshair',transform:`translate(${vt.px}px,${vt.py}px) scale(${vt.z})`,transformOrigin:'50% 50%' }}
              onMouseDown={onStart} onMouseMove={onMove} onMouseUp={onEnd} onMouseLeave={onEnd}
              onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}/>
            {vt.z > 1.05 && (
              <button
                onTouchStart={e => { e.stopPropagation(); setVt({ z:1, px:0, py:0 }); }}
                onClick={() => setVt({ z:1, px:0, py:0 })}
                style={{ position:'absolute',top:8,right:8,background:'rgba(0,0,0,0.72)',border:'none',color:'white',borderRadius:8,padding:'5px 11px',fontSize:11,fontWeight:700,cursor:'pointer',zIndex:5,letterSpacing:0.3 }}>
                ×{vt.z.toFixed(1)} ↺
              </button>
            )}
            {textPt && (
              <div style={{ position:'absolute',top:0,left:0,transform:`translate(${textPt.x*(cvRef.current?.clientWidth/cvRef.current?.width||1)}px,${textPt.y*(cvRef.current?.clientHeight/cvRef.current?.height||1)}px)`,zIndex:10 }}>
                <div style={{ background:'white',borderRadius:8,boxShadow:'0 4px 20px rgba(0,0,0,0.3)',padding:8,display:'flex',gap:6,minWidth:200 }}>
                  <input autoFocus value={textV} onChange={e=>setTextV(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addText()}
                    placeholder="Saisir le texte…" style={{ flex:1,fontSize:13,border:`1px solid ${DA.border}`,borderRadius:6,padding:'4px 8px',outline:'none' }}/>
                  <button onClick={addText} style={{ background:DA.red,color:'white',borderRadius:6,padding:'4px 8px',fontSize:12,fontWeight:600 }}>OK</button>
                  <button onClick={() => setTextPt(null)} style={{ color:DA.grayL }}><Ic n="x" s={14}/></button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:12,color:DA.grayL }}>
            <Ic n="spn" s={32}/><p style={{ fontSize:13 }}>Chargement du plan…</p>
          </div>
        )}
      </div>

      {/* ── Bande de photos ── */}
      {validPhotos.length > 0 && (
        <div style={{ background:'#1a1a1a',borderTop:'1px solid #333',padding:'6px 12px',display:'flex',gap:8,overflowX:'auto',flexShrink:0,alignItems:'center' }}>
          <span style={{ color:'#666',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,flexShrink:0 }}>Vues :</span>
          {validPhotos.map((ph, i) => {
            const label = `V${i + 1}`;
            const isActive = activePh?.label === label;
            return (
              <button key={i} onClick={() => selectPhoto(ph, i)}
                title={ph.name || `Photo ${i + 1}`}
                style={{ flexShrink:0,padding:0,background:'none',border:`2.5px solid ${isActive ? DA.red : 'transparent'}`,borderRadius:8,overflow:'hidden',cursor:'pointer',outline:'none',transition:'border-color 0.15s' }}>
                <div style={{ position:'relative' }}>
                  <img src={ph.data} alt="" style={{ width:48,height:48,objectFit:'cover',display:'block' }}/>
                  <div style={{ position:'absolute',bottom:0,left:0,right:0,background:isActive?DA.red:'rgba(0,0,0,0.65)',color:'white',fontSize:9,fontWeight:800,textAlign:'center',padding:'2px 0',transition:'background 0.15s' }}>
                    {label}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
