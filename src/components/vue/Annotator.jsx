import React, { useState, useRef, useEffect, useCallback } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

const ANNOT_COLORS = ['#E30513','#E67E22','#F1C40F','#2980B9','#27AE60','#8E44AD','#222222','#FFFFFF'];

// Dessine un tableau de paths annotateur sur un contexte canvas existant.
// Utilisé pour la prévisualisation et la génération PDF.
export function drawAnnotationPaths(ctx, paths) {
  (paths || []).forEach(p => {
    if (p.type === 'symbol') {
      const sm = SYMBOLS.find(x => x.id === p.symbolId);
      if (sm) { ctx.save(); sm.draw(ctx, p.x, p.y, p.size, p.color); ctx.restore(); }
    } else if (p.type === 'text') {
      ctx.save();
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
      ctx.lineWidth = p.tool === 'eraser' ? p.size * 6 : p.size;
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

export default function Annotator({ bgImage, savedPaths, onSave, onClose }) {
  const cvRef = useRef();
  const bgRef = useRef(null);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(DA.red);
  const [size, setSize] = useState(3);
  const [sym, setSym] = useState(SYMBOLS[0]);
  const [paths, setPaths] = useState(savedPaths || []);
  const [cur, setCur] = useState([]);
  const [drawing, setDrawing] = useState(false);
  const [bgOk, setBgOk] = useState(false);
  const [showSyms, setShowSyms] = useState(false);
  const [textPt, setTextPt] = useState(null);
  const [textV, setTextV] = useState('');

  const redraw = useCallback(() => {
    const cv = cvRef.current;
    if (!cv || !bgOk) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (bgRef.current) ctx.drawImage(bgRef.current, 0, 0, cv.width, cv.height);
    const all = [...paths, ...(cur.length > 1 && (tool === 'pen' || tool === 'eraser') ? [{ type:'stroke', tool, points:cur, color, size }] : [])];
    all.forEach(p => {
      if (p.type === 'symbol') {
        ctx.save();
        const sm = SYMBOLS.find(x => x.id === p.symbolId);
        if (sm) sm.draw(ctx, p.x, p.y, p.size, p.color);
        ctx.restore();
        return;
      }
      if (p.type === 'text') {
        ctx.save();
        ctx.font = `bold ${12 + p.size * 2}px Arial`;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
        return;
      }
      if (!p.points?.length) return;
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.tool === 'eraser' ? p.size * 6 : p.size;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = p.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.moveTo(p.points[0].x, p.points[0].y);
      p.points.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
      ctx.restore();
    });
  }, [paths, cur, color, size, tool, bgOk]);

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
    img.src = bgImage;
  }, [bgImage]);

  const getXY = (e, cv) => {
    const r = cv.getBoundingClientRect(), sx = cv.width / r.width, sy = cv.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * sx, y: (src.clientY - r.top) * sy };
  };

  const onStart = e => {
    e.preventDefault();
    const pos = getXY(e, cvRef.current);
    if (tool === 'symbol') { setPaths(prev => [...prev, { type:'symbol', symbolId:sym.id, x:pos.x, y:pos.y, color, size }]); return; }
    if (tool === 'text') { setTextPt(pos); setTextV(''); return; }
    setDrawing(true); setCur([pos]);
  };
  const onMove = e => { e.preventDefault(); if (!drawing) return; setCur(prev => [...prev, getXY(e, cvRef.current)]); };
  const onEnd = e => {
    e.preventDefault();
    if (!drawing) return;
    if (cur.length >= 2) setPaths(prev => [...prev, { type:'stroke', tool, points:cur, color, size }]);
    setCur([]); setDrawing(false);
  };
  const addText = () => {
    if (!textV.trim() || !textPt) { setTextPt(null); return; }
    setPaths(prev => [...prev, { type:'text', text:textV.trim(), x:textPt.x, y:textPt.y, color, size }]);
    setTextPt(null); setTextV('');
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'#111',zIndex:50,display:'flex',flexDirection:'column' }}>
      {/* Toolbar */}
      <div style={{ background:DA.black,padding:'8px 12px',display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,flexShrink:0 }}>
        <button onClick={onClose} style={{ color:DA.grayL }}><Ic n="x" s={18}/></button>
        <div style={{ display:'flex',gap:4,background:'#333',padding:4,borderRadius:8 }}>
          {[{k:'pen',n:'pen'},{k:'eraser',n:'eras'},{k:'text',n:'txt'},{k:'symbol',n:'sym'}].map(t => (
            <button key={t.k} onClick={() => { setTool(t.k); if(t.k==='symbol') setShowSyms(v=>!v); else setShowSyms(false); }}
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

      {/* Symbol picker */}
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

      {/* Canvas area */}
      <div style={{ flex:1,overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',background:'#1a1a1a',padding:8,minHeight:0 }}>
        {bgImage ? (
          <div style={{ position:'relative',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center' }}>
            <canvas ref={cvRef}
              style={{ maxWidth:'100%',maxHeight:'100%',display:'block',touchAction:'none',boxShadow:'0 0 40px rgba(0,0,0,0.5)',cursor:tool==='text'?'text':'crosshair' }}
              onMouseDown={onStart} onMouseMove={onMove} onMouseUp={onEnd} onMouseLeave={onEnd}
              onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}/>
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
    </div>
  );
}
