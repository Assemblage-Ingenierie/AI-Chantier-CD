import React, { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

const ANNOT_COLORS = ['#E30513','#E67E22','#F1C40F','#2980B9','#27AE60','#8E44AD','#222222','#FFFFFF'];

// ── Viewpoint (œil + cône de vue) ────────────────────────────────────────────
export function drawVP(ctx, { x, y, angle = 0, label = '', size = 3, color = '#E30513' }) {
  const r  = 10 + size;
  const L  = 40 + size * 4;
  const sp = 0.62; // demi-angle du cône (~35°)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle - sp) * L, y + Math.sin(angle - sp) * L);
  ctx.arc(x, y, L, angle - sp, angle + sp);
  ctx.closePath();
  ctx.fillStyle = color; ctx.globalAlpha = 0.15; ctx.fill();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = color; ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle - sp) * L, y + Math.sin(angle - sp) * L);
  ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle + sp) * L, y + Math.sin(angle + sp) * L);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, L, angle - sp, angle + sp); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  if (label) {
    ctx.font = `bold ${8 + size}px Arial`;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.strokeText(label, x + r + 3, y - r + 4);
    ctx.fillStyle = color;
    ctx.fillText(label, x + r + 3, y - r + 4);
  }
  ctx.restore();
}

// sizeScale : échelle pour symboles/textes/viewpoints (contrôlé par annotScale)
// strokeScale : échelle pour les tracés (normalisée en pixels écran, indépendante de annotScale)
export function drawAnnotationPaths(ctx, paths, sizeScale = 1, strokeScale = null) {
  const ss = strokeScale ?? sizeScale;
  (paths || []).forEach(p => {
    if (p.type === 'viewpoint') {
      ctx.save();
      if (sizeScale !== 1 && p.x != null) {
        ctx.translate(p.x, p.y); ctx.scale(sizeScale, sizeScale); ctx.translate(-p.x, -p.y);
      }
      drawVP(ctx, p);
      ctx.restore();
    } else if (p.type === 'symbol') {
      const sm = getAllSymbols().find(x => x.id === p.symbolId);
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
      const fs = 12 + p.size * 2;
      ctx.font = `bold ${fs}px Arial`;
      const tw = ctx.measureText(p.text).width;
      const pad = 5;
      if (p.textMode === 'boxed' || p.textMode === 'arrow') {
        // Fond blanc + bordure couleur
        const bx = p.x - pad, by = p.y - fs - 2, bw = tw + pad * 2, bh = fs + pad + 2;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeStyle = p.color; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3); ctx.fill(); ctx.stroke();
        if (p.textMode === 'arrow') {
          // Petite flèche vers le bas depuis le centre-bas du cadre
          const ax = p.x + tw / 2, ay = by + bh;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay + 14); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(ax - 5, ay + 9); ctx.lineTo(ax, ay + 14); ctx.lineTo(ax + 5, ay + 9); ctx.stroke();
        }
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.restore();
    } else if (p.points?.length) {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = (p.tool === 'eraser' ? p.size * 6 : p.size) * ss;
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
  { id:'fissure_mur', label:'Fissure', short:'FIS', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.moveTo(x-8,y-15); ctx.lineTo(x-3,y-6); ctx.lineTo(x+4,y-10); ctx.lineTo(x+7,y+3); ctx.lineTo(x+10,y+15); ctx.stroke(); ctx.font=`bold ${8+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('FIS',x-10,y+27); ctx.fillText('FIS',x-10,y+27); ctx.restore(); } },
  { id:'humidite', label:'Humidité', short:'~H~', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.setLineDash([5,3]); ctx.beginPath(); ctx.ellipse(x,y,22,13,0,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]); ctx.font=`bold ${12+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('~H~',x-12,y+5); ctx.fillText('~H~',x-12,y+5); ctx.restore(); } },
  { id:'danger', label:'Danger', short:'!', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.moveTo(x,y-18); ctx.lineTo(x+16,y+12); ctx.lineTo(x-16,y+12); ctx.closePath(); ctx.stroke(); ctx.font=`bold ${14+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('!',x-3.5,y+9); ctx.fillText('!',x-3.5,y+9); ctx.restore(); } },
  { id:'eclat', label:'Éclatement', short:'ÉCL', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); for(let i=0;i<8;i++){const a=i*Math.PI/4,r=i%2===0?18:10; i===0?ctx.moveTo(x,y):null; ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);} ctx.closePath(); ctx.stroke(); ctx.font=`bold ${7+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('ÉCL',x-9,y+28); ctx.fillText('ÉCL',x-9,y+28); ctx.restore(); } },
  { id:'nc', label:'Non-conformité', short:'NC', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.arc(x,y,14,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x-8,y-8); ctx.lineTo(x+8,y+8); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x+8,y-8); ctx.lineTo(x-8,y+8); ctx.stroke(); ctx.font=`bold ${7+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('NC',x-7,y+26); ctx.fillText('NC',x-7,y+26); ctx.restore(); } },
  { id:'rouille', label:'Corrosion', short:'Fe', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.arc(x,y,14,0,Math.PI*2); ctx.stroke(); ctx.font=`bold ${12+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('Fe',x-7,y+4); ctx.fillText('Fe',x-7,y+4); ctx.restore(); } },
  { id:'portee', label:'Sens portée', short:'↔', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.fillStyle=c; ctx.lineWidth=s+2; ctx.beginPath(); ctx.moveTo(x-20,y); ctx.lineTo(x+20,y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x-20,y); ctx.lineTo(x-10,y-7); ctx.lineTo(x-10,y+7); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x+20,y); ctx.lineTo(x+10,y-7); ctx.lineTo(x+10,y+7); ctx.closePath(); ctx.fill(); ctx.font=`bold ${8+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('PO',x-8,y+20); ctx.fillText('PO',x-8,y+20); ctx.restore(); } },
  { id:'fontis', label:'Fontis', short:'FT', draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.setLineDash([4,3]); ctx.beginPath(); ctx.ellipse(x,y+4,18,11,0,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]); for(const dx of [-8,0,8]){ctx.beginPath();ctx.moveTo(x+dx,y-15);ctx.lineTo(x+dx,y-6);ctx.stroke();ctx.beginPath();ctx.moveTo(x+dx-4,y-10);ctx.lineTo(x+dx,y-6);ctx.lineTo(x+dx+4,y-10);ctx.stroke();} ctx.font=`bold ${8+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('FT',x-5,y+22); ctx.fillText('FT',x-5,y+22); ctx.restore(); } },
];

// ── Symboles personnalisés (stockés en localStorage, forme auto-générée) ──────
const CUSTOM_SYMS_KEY = 'chantierai_custom_syms_v1';
const _CSHAPES = [
  (ctx,x,y) => { ctx.beginPath(); ctx.arc(x,y,16,0,Math.PI*2); ctx.stroke(); },
  (ctx,x,y) => { ctx.beginPath(); ctx.moveTo(x,y-18); ctx.lineTo(x+14,y); ctx.lineTo(x,y+18); ctx.lineTo(x-14,y); ctx.closePath(); ctx.stroke(); },
  (ctx,x,y) => { ctx.beginPath(); ctx.rect(x-14,y-14,28,28); ctx.stroke(); },
  (ctx,x,y) => { ctx.beginPath(); ctx.moveTo(x-16,y); ctx.lineTo(x+16,y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x,y-16); ctx.lineTo(x,y+16); ctx.stroke(); },
];
function _makeCustomDraw(short, shapeIdx) {
  const shapeFn = _CSHAPES[shapeIdx % _CSHAPES.length];
  return (ctx, x, y, s, c) => {
    ctx.save();
    ctx.strokeStyle = c; ctx.lineWidth = s + 1;
    shapeFn(ctx, x, y, s, c);
    ctx.font = `bold ${8 + s}px Arial`;
    ctx.fillStyle = c; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    const tw = ctx.measureText(short).width;
    ctx.strokeText(short, x - tw / 2, y + 30); ctx.fillText(short, x - tw / 2, y + 30);
    ctx.restore();
  };
}
export function loadCustomSymbols() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_SYMS_KEY) || '[]'); } catch { return []; }
}
export function getCustomSymbolDefs() {
  return loadCustomSymbols().map((s, i) => ({ ...s, isCustom: true, draw: _makeCustomDraw(s.short, i) }));
}
export function getAllSymbols() {
  return [...SYMBOLS, ...getCustomSymbolDefs()];
}

// exportSizeMultiplier : 7 pour photos (miniature ~90px), 2 pour plans (affichés ~500px)
const Annotator = forwardRef(function Annotator({ bgImage, savedPaths, onSave, onClose, photos, exportSizeMultiplier = 7, title }, ref) {
  const cvRef    = useRef();
  const bgRef    = useRef(null);
  const vpStart  = useRef(null);
  const textDragRef = useRef(null); // { origX, origY, tapX, tapY } — drag d'un texte sélectionné

  const [tool,       setTool]       = useState('pen');
  const [color,      setColor]      = useState(DA.red);
  const [size,       setSize]       = useState(3);
  const [sym,        setSym]        = useState(SYMBOLS[0]);
  const [paths,      setPaths]      = useState(savedPaths || []);
  const [cur,        setCur]        = useState([]);
  const [drawing,    setDrawing]    = useState(false);
  const [bgOk,       setBgOk]       = useState(false);
  const [showSyms,   setShowSyms]   = useState(false);
  const [textPt,     setTextPt]     = useState(null);  // placement d'un nouveau texte
  const [textV,      setTextV]      = useState('');
  const [selTextIdx, setSelTextIdx] = useState(null);  // index dans paths du texte sélectionné
  const [activePh,   setActivePh]   = useState(null);
  const [pendingVP,  setPendingVP]  = useState(null);
  const [vt,         setVt]         = useState({ z: 1, px: 0, py: 0 });
  const vtRef     = useRef({ z: 1, px: 0, py: 0 });
  const gestureRef = useRef(null);

  const [annotScale,  setAnnotScale]  = useState(() => {
    const v = parseFloat(localStorage.getItem('chantierai_annot_scale') ?? '1');
    // Réinitialiser à 1 si la valeur sauvegardée était > 1.5 (ancien bug où annotScale affectait les tracés)
    if (isNaN(v) || v > 1.5) { localStorage.setItem('chantierai_annot_scale', '1'); return 1; }
    return Math.max(0.3, Math.min(2, v));
  });
  const [customSyms,  setCustomSyms]  = useState(() => getCustomSymbolDefs());
  const [newSymName,  setNewSymName]  = useState('');
  const [showNewSym,  setShowNewSym]  = useState(false);
  // Modes de texte : 'plain' | 'boxed' | 'arrow'
  const [textMode,    setTextMode]    = useState('plain');

  const allSymbols = useMemo(() => [...SYMBOLS, ...customSyms], [customSyms]);

  useEffect(() => { vtRef.current = vt; }, [vt]);
  useEffect(() => {
    setVt({ z: 1, px: 0, py: 0 });
    vtRef.current = { z: 1, px: 0, py: 0 };
    setPaths(savedPaths || []); // reset annotations quand la photo change
    setSelTextIdx(null);
  }, [bgImage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exposer getAnnotation() pour auto-save depuis le parent (navigation entre photos)
  useImperativeHandle(ref, () => ({
    getAnnotation: () => {
      const cv = cvRef.current;
      if (!cv || !bgRef.current) return { paths, annotated: null };
      const EW = Math.min(cv.width, 1400);
      const EH = Math.round(cv.height * EW / cv.width);
      const ec = document.createElement('canvas');
      ec.width = EW; ec.height = EH;
      const ectx = ec.getContext('2d');
      ectx.drawImage(bgRef.current, 0, 0, EW, EH);
      ectx.save();
      ectx.scale(EW / cv.width, EH / cv.height);
      const ratio = cv.clientWidth > 0 ? cv.width / cv.clientWidth : exportSizeMultiplier;
      drawAnnotationPaths(ectx, paths, ratio * 0.5 * annotScale, ratio);
      ectx.restore();
      return { paths, annotated: ec.toDataURL('image/webp', 0.85), annotW: cv.width, annotH: cv.height };
    },
  }), [paths, annotScale, exportSizeMultiplier]);

  const vpCount = paths.filter(p => p.type === 'viewpoint').length;

  const redraw = useCallback(() => {
    const cv = cvRef.current;
    if (!cv || !bgOk) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (bgRef.current) ctx.drawImage(bgRef.current, 0, 0, cv.width, cv.height);

    const ratio = cv.clientWidth > 0 ? cv.width / cv.clientWidth : 1;
    const symbolScale = ratio * 0.5 * annotScale; // symboles/viewpoints/textes : contrôlés par annotScale
    const strokeScale = ratio;                     // tracés : normalisés en pixels écran, sans annotScale

    const all = [...paths, ...(cur.length > 1 && (tool === 'pen' || tool === 'eraser') ? [{ type:'stroke', tool, points:cur, color, size }] : [])];
    drawAnnotationPaths(ctx, all, symbolScale, strokeScale);

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

    // Indicateur de sélection sur le texte sélectionné
    if (selTextIdx !== null && paths[selTextIdx]?.type === 'text') {
      const tp = paths[selTextIdx];
      const fontSize = 12 + tp.size * 2;
      ctx.save();
      ctx.font = `bold ${fontSize}px Arial`;
      const tw = ctx.measureText(tp.text).width;
      ctx.strokeStyle = '#4A9EFF';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(tp.x - 4, tp.y - fontSize - 3, tw + 8, fontSize + 8);
      ctx.restore();
    }
  }, [paths, cur, color, size, tool, bgOk, pendingVP, activePh, vpCount, annotScale, selTextIdx]);

  useEffect(() => { redraw(); }, [redraw]);

  useEffect(() => {
    if (!bgImage) return;
    setBgOk(false); // masque le canvas pendant le chargement → évite l'écran noir
    const load = async () => {
      // Convertir les URLs distantes en data URL pour éviter le "tainted canvas"
      let src = bgImage;
      if (!bgImage.startsWith('data:')) {
        try {
          const resp = await fetch(bgImage);
          const blob = await resp.blob();
          src = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = rej;
            r.readAsDataURL(blob);
          });
        } catch { /* garder l'URL d'origine en fallback */ }
      }
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
      img.src = src;
    };
    load();
  }, [bgImage]);

  const getXY = (e, cv) => {
    const r = cv.getBoundingClientRect(), sx = cv.width / r.width, sy = cv.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * sx, y: (src.clientY - r.top) * sy };
  };

  const onStart = e => {
    e.preventDefault();
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
        ncX: r ? r.left + r.width / 2 - cur.px : 0,
        ncY: r ? r.top + r.height / 2 - cur.py : 0,
      };
      return;
    }
    if (gestureRef.current) return;
    const pos = getXY(e, cvRef.current);

    if (tool === 'viewpoint') {
      vpStart.current = pos;
      setPendingVP({ x: pos.x, y: pos.y, angle: 0 });
      setDrawing(true);
      return;
    }
    if (tool === 'symbol') {
      setPaths(prev => [...prev, { type:'symbol', symbolId:sym.id, x:pos.x, y:pos.y, color, size }]);
      return;
    }
    if (tool === 'text') {
      // Chercher un texte existant à proximité
      const cv = cvRef.current;
      const HIT_R = 60 * (cv.width / cv.clientWidth);
      let existIdx = -1;
      for (let i = paths.length - 1; i >= 0; i--) {
        const p = paths[i];
        if (p.type === 'text' && Math.hypot(p.x - pos.x, p.y - pos.y) < HIT_R) {
          existIdx = i;
          break;
        }
      }
      if (existIdx >= 0) {
        setSelTextIdx(existIdx);
        setDrawing(true);
        textDragRef.current = { origX: paths[existIdx].x, origY: paths[existIdx].y, tapX: pos.x, tapY: pos.y };
        return;
      }
      setSelTextIdx(null);
      setTextPt(pos);
      setTextV('');
      return;
    }
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
      const newPx = midX - g.ncX - (g.midX - g.ncX - g.startPx) * ratio;
      const newPy = midY - g.ncY - (g.midY - g.ncY - g.startPy) * ratio;
      const cv = cvRef.current;
      const maxPx = cv ? cv.clientWidth  * (newZ - 1) / 2 : 9999;
      const maxPy = cv ? cv.clientHeight * (newZ - 1) / 2 : 9999;
      setVt({ z: newZ, px: Math.max(-maxPx, Math.min(maxPx, newPx)), py: Math.max(-maxPy, Math.min(maxPy, newPy)) });
      return;
    }
    // Déplacement d'un texte sélectionné
    if (tool === 'text' && drawing && selTextIdx !== null && textDragRef.current) {
      const pos = getXY(e, cvRef.current);
      const { origX, origY, tapX, tapY } = textDragRef.current;
      setPaths(prev => prev.map((p, i) => i === selTextIdx ? { ...p, x: origX + (pos.x - tapX), y: origY + (pos.y - tapY) } : p));
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
    // Fin du déplacement de texte
    if (tool === 'text' && selTextIdx !== null && textDragRef.current) {
      textDragRef.current = null;
      setDrawing(false);
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
    setPaths(prev => [...prev, { type:'text', text:textV.trim(), x:textPt.x, y:textPt.y, color, size, textMode }]);
    setTextPt(null); setTextV('');
  };

  const addCustomSym = () => {
    const label = newSymName.trim();
    if (!label) return;
    const existing = loadCustomSymbols();
    const short = label.replace(/\s+/g, '').slice(0, 4).toUpperCase();
    const entry = { id: 'custom_' + crypto.randomUUID(), label, short, shapeIdx: existing.length };
    localStorage.setItem(CUSTOM_SYMS_KEY, JSON.stringify([...existing, entry]));
    const newDefs = getCustomSymbolDefs();
    setCustomSyms(newDefs);
    setSym(newDefs[newDefs.length - 1]);
    setNewSymName(''); setShowNewSym(false);
  };

  const delCustomSym = (id) => {
    localStorage.setItem(CUSTOM_SYMS_KEY, JSON.stringify(loadCustomSymbols().filter(s => s.id !== id)));
    const newDefs = getCustomSymbolDefs();
    setCustomSyms(newDefs);
    if (sym?.id === id) setSym(SYMBOLS[0]);
  };

  const validPhotos = (photos || []).filter(ph => ph.data).slice(0, 12);

  const selectPhoto = (ph, i) => {
    const label = `V${i + 1}`;
    const isActive = activePh?.label === label;
    setActivePh(isActive ? null : { label, src: ph.data });
    setTool('viewpoint');
    setShowSyms(false);
  };

  const selText = selTextIdx !== null ? paths[selTextIdx] : null;

  return (
    <div style={{ position:'fixed',inset:0,background:'#111',zIndex:50,display:'flex',flexDirection:'column' }}>

      {/* ── Bandeau titre (ex: nom du plan) ── */}
      {title && (
        <div style={{ background:'#1a1a1a',padding:'6px 14px',borderBottom:'1px solid #2a2a2a',display:'flex',alignItems:'center',gap:8,flexShrink:0 }}>
          <Ic n="map" s={13}/>
          <span style={{ fontSize:12,color:'#bbb',fontWeight:600 }}>{title}</span>
        </div>
      )}

      {/* ── Toolbar (2 rangées fixes) ── */}
      <div style={{ background:DA.black,padding:'7px 12px 6px',display:'flex',flexDirection:'column',gap:6,flexShrink:0 }}>

        {/* Rangée 1 : outils + undo + sauvegarder */}
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          <div style={{ display:'flex',gap:2,background:'#333',padding:3,borderRadius:10,flexShrink:0 }}>
            {[
              { k:'pen',    n:'pen',  lbl:'Dessin'  },
              { k:'text',   n:'txt',  lbl:'Texte'   },
              { k:'symbol', n:'sym',  lbl:'Symbole' },
            ].map(t => (
              <button key={t.k}
                onClick={() => {
                  setTool(t.k);
                  if (t.k === 'symbol') setShowSyms(v => !v); else setShowSyms(false);
                  if (t.k !== 'text') { setSelTextIdx(null); textDragRef.current = null; }
                  if (t.k !== 'viewpoint') setActivePh(null);
                }}
                style={{ padding:'8px 11px',borderRadius:8,background:tool===t.k?DA.red:'transparent',
                  color:tool===t.k?'white':'#aaa',transition:'all 0.15s',
                  display:'flex',flexDirection:'column',alignItems:'center',gap:4,minWidth:52 }}>
                <Ic n={t.n} s={22}/>
                <span style={{ fontSize:9,fontWeight:700,letterSpacing:0.3 }}>{t.lbl}</span>
              </button>
            ))}
          </div>
          <div style={{ marginLeft:'auto',display:'flex',gap:6,flexShrink:0 }}>
            <button onClick={onClose}
              style={{ padding:'8px 12px',borderRadius:8,background:'#333',color:'#aaa',
                display:'flex',flexDirection:'column',alignItems:'center',gap:4,minWidth:44 }}
              title="Annuler">
              <Ic n="x" s={20}/>
              <span style={{ fontSize:8,color:'#888',letterSpacing:0.3 }}>Fermer</span>
            </button>
            <button onClick={() => setPaths(p => p.slice(0,-1))}
              style={{ padding:'8px 12px',borderRadius:8,background:'#333',color:'#aaa',
                display:'flex',flexDirection:'column',alignItems:'center',gap:4,minWidth:44 }}
              title="Annuler dernière action">
              <Ic n="und" s={20}/>
              <span style={{ fontSize:8,color:'#888',letterSpacing:0.3 }}>Annuler</span>
            </button>
            <button onClick={() => {
              const cv = cvRef.current;
              if (!cv || !bgRef.current) { onSave(paths, null, null); onClose(); return; }
              // Exporter à max 1400px — scale calée sur le display réel pour cohérence visuelle
              const EW = Math.min(cv.width, 1400);
              const EH = Math.round(cv.height * EW / cv.width);
              const ec = document.createElement('canvas');
              ec.width = EW; ec.height = EH;
              const ectx = ec.getContext('2d');
              ectx.drawImage(bgRef.current, 0, 0, EW, EH);
              ectx.save();
              ectx.scale(EW / cv.width, EH / cv.height);
              const ratio = cv.clientWidth > 0 ? cv.width / cv.clientWidth : exportSizeMultiplier;
              drawAnnotationPaths(ectx, paths, ratio * 0.5 * annotScale, ratio);
              ectx.restore();
              onSave(paths, ec.toDataURL('image/webp', 0.85), { w: cv.width, h: cv.height });
              onClose();
            }}
              style={{ padding:'8px 14px',borderRadius:8,background:DA.red,color:'white',
                display:'flex',flexDirection:'column',alignItems:'center',gap:4 }}>
              <Ic n="chk" s={20}/>
              <span style={{ fontSize:9,fontWeight:800,letterSpacing:0.3,whiteSpace:'nowrap' }}>Sauvegarder</span>
            </button>
          </div>
        </div>

        {/* Rangée 2 : couleurs + tailles */}
        <div style={{ display:'flex',alignItems:'center',gap:10,flexWrap:'wrap' }}>
          <div style={{ display:'flex',gap:6,flexShrink:0 }}>
            {ANNOT_COLORS.map(cl => (
              <button key={cl} onClick={() => {
                setColor(cl);
                if (selTextIdx !== null) setPaths(prev => prev.map((p,i) => i===selTextIdx ? {...p,color:cl} : p));
              }}
                style={{ width:26,height:26,borderRadius:'50%',background:cl,
                  border:`3px solid ${color===cl?'white':'transparent'}`,
                  boxShadow:color===cl?`0 0 0 1.5px ${cl}`:'none',
                  cursor:'pointer',flexShrink:0,transition:'all 0.1s' }}/>
            ))}
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:8,flexShrink:0 }}>
            <span style={{ fontSize:9,color:'#888',fontWeight:600,letterSpacing:0.3 }}>ÉPAISSEUR</span>
            {[1,3,6].map(sz => (
              <button key={sz} onClick={() => {
                setSize(sz);
                if (selTextIdx !== null) setPaths(prev => prev.map((p,i) => i===selTextIdx ? {...p,size:sz} : p));
              }}
                style={{ width:sz*3+14,height:sz*3+14,borderRadius:'50%',
                  background:size===sz?'white':'#555',
                  border:`2px solid ${size===sz?'white':'#444'}`,
                  cursor:'pointer',flexShrink:0,transition:'background 0.1s',
                  display:'flex',alignItems:'center',justifyContent:'center' }}/>
            ))}
          </div>
        </div>
      </div>

      {/* ── Taille globale des logos ── */}
      <div style={{ background:'#1a1a1a',padding:'5px 12px',display:'flex',alignItems:'center',gap:10,flexShrink:0,borderBottom:'1px solid #222' }}>
        <span style={{ color:'#888',fontSize:10,fontWeight:600,whiteSpace:'nowrap',letterSpacing:0.3 }}>SYMBOLES</span>
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
        <div style={{ background:'#1a1a1a',padding:'8px 12px',display:'flex',gap:8,overflowX:'auto',flexShrink:0,borderBottom:'1px solid #333',alignItems:'center' }}>
          {allSymbols.map(sm => (
            <div key={sm.id} style={{ position:'relative',flexShrink:0 }}>
              <button onClick={() => setSym(sm)}
                style={{ padding:'5px 12px',borderRadius:8,background:sym.id===sm.id?DA.red:'#333',color:sym.id===sm.id?'white':'#ccc',fontSize:12,fontWeight:500,whiteSpace:'nowrap',cursor:'pointer' }}>
                {sm.label}
              </button>
              {sm.isCustom && (
                <button onClick={() => delCustomSym(sm.id)} title="Supprimer"
                  style={{ position:'absolute',top:-4,right:-5,width:15,height:15,borderRadius:'50%',background:'#B91C1C',color:'white',border:'none',fontSize:9,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0,lineHeight:1,zIndex:2 }}>
                  ×
                </button>
              )}
            </div>
          ))}
          {!showNewSym
            ? <button onClick={() => setShowNewSym(true)}
                style={{ flexShrink:0,padding:'5px 12px',borderRadius:8,background:'transparent',color:'#4A9EFF',fontSize:12,fontWeight:700,whiteSpace:'nowrap',cursor:'pointer',border:'1.5px dashed #4A9EFF' }}>
                + Créer
              </button>
            : <div style={{ display:'flex',gap:5,alignItems:'center',flexShrink:0 }}>
                <input autoFocus value={newSymName} onChange={e=>setNewSymName(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter')addCustomSym();if(e.key==='Escape'){setShowNewSym(false);setNewSymName('');}}}
                  placeholder="Nom du symbole…"
                  style={{ fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid #555',background:'#222',color:'white',outline:'none',minWidth:120,fontFamily:'inherit' }}/>
                <button onClick={addCustomSym}
                  style={{ padding:'4px 10px',background:DA.red,color:'white',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0 }}>OK</button>
                <button onClick={() => {setShowNewSym(false);setNewSymName('');}}
                  style={{ padding:'4px 7px',background:'#333',color:'#aaa',borderRadius:6,fontSize:11,cursor:'pointer',flexShrink:0 }}>✕</button>
              </div>
          }
        </div>
      )}

      {/* ── Sélecteur de mode texte (affiché quand outil texte actif) ── */}
      {tool === 'text' && !selText && (
        <div style={{ background:'#1a1a1a',padding:'6px 12px',borderBottom:'1px solid #333',display:'flex',alignItems:'center',gap:6,flexShrink:0 }}>
          <span style={{ fontSize:9,color:'#888',fontWeight:600,letterSpacing:0.3,flexShrink:0 }}>STYLE</span>
          {[
            { k:'plain', lbl:'Texte libre' },
            { k:'boxed', lbl:'Encadré' },
            { k:'arrow', lbl:'Encadré + flèche' },
          ].map(m => (
            <button key={m.k} onClick={() => setTextMode(m.k)}
              style={{ padding:'4px 10px',borderRadius:7,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,
                background:textMode===m.k?DA.red:'#333',color:textMode===m.k?'white':'#aaa',border:'none' }}>
              {m.lbl}
            </button>
          ))}
          <span style={{ fontSize:9,color:'#555',marginLeft:4 }}>Cliquez sur le plan pour placer</span>
        </div>
      )}

      {/* ── Panneau édition texte sélectionné ── */}
      {tool === 'text' && selText && (
        <div style={{ background:'#1a1a1a',padding:'7px 12px',borderBottom:'1px solid #333',display:'flex',alignItems:'center',gap:8,flexShrink:0,flexWrap:'wrap' }}>
          <span style={{ fontSize:10,color:'#4A9EFF',fontWeight:700,flexShrink:0 }}>Texte :</span>
          <input
            value={selText.text || ''}
            onChange={e => setPaths(prev => prev.map((p,i) => i===selTextIdx ? {...p,text:e.target.value} : p))}
            style={{ flex:1,minWidth:80,fontSize:12,padding:'4px 8px',borderRadius:6,border:'1px solid #555',background:'#222',color:'white',outline:'none',fontFamily:'inherit' }}
          />
          {/* Changer le style du texte sélectionné */}
          {[{ k:'plain', lbl:'Libre' },{ k:'boxed', lbl:'Cadre' },{ k:'arrow', lbl:'Flèche' }].map(m => (
            <button key={m.k} onClick={() => setPaths(prev => prev.map((p,i) => i===selTextIdx ? {...p,textMode:m.k} : p))}
              style={{ padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',flexShrink:0,
                background:(selText.textMode||'plain')===m.k?DA.red:'#333',color:(selText.textMode||'plain')===m.k?'white':'#aaa',border:'none' }}>
              {m.lbl}
            </button>
          ))}
          <button onClick={() => { setPaths(p => p.filter((_,i) => i !== selTextIdx)); setSelTextIdx(null); }}
            style={{ padding:'4px 8px',background:'#B91C1C',color:'white',border:'none',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0,lineHeight:0,display:'flex',alignItems:'center' }}>
            <Ic n="del" s={13}/>
          </button>
          <button onClick={() => setSelTextIdx(null)}
            style={{ padding:'4px 8px',background:'#333',color:'#aaa',border:'none',borderRadius:6,fontSize:11,cursor:'pointer',flexShrink:0 }}>
            ✕
          </button>
        </div>
      )}

      {/* ── Aide viewpoint ── */}
      {tool === 'viewpoint' && (
        <div style={{ background:'#1a1a1a',padding:'5px 14px',borderBottom:'1px solid #333',flexShrink:0,display:'flex',alignItems:'center',gap:8 }}>
          <Ic n="eye" s={12}/>
          <span style={{ fontSize:11,color:'#888' }}>
            {activePh
              ? <><span style={{ color:DA.red,fontWeight:700 }}>{activePh.label}</span> sélectionnée — cliquer-glisser pour placer et orienter</>
              : 'Cliquer-glisser sur le plan pour placer un œil de vue.'}
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
            {/* Popup saisie texte — ancrée au point de clic */}
            {textPt && (() => {
              const sx = cvRef.current?.clientWidth  / cvRef.current?.width  || 1;
              const sy = cvRef.current?.clientHeight / cvRef.current?.height || 1;
              const px = textPt.x * sx;
              const py = textPt.y * sy;
              return (
                <div style={{ position:'absolute',left:0,top:0,transform:`translate(${px}px,${py}px)`,zIndex:10,pointerEvents:'none' }}>
                  <div style={{ background:'#1e1e1e',borderRadius:10,boxShadow:'0 6px 28px rgba(0,0,0,0.6)',padding:'10px 12px',display:'flex',flexDirection:'column',gap:8,minWidth:230,pointerEvents:'all',border:'1px solid #333' }}>
                    {/* Sélecteur de style rapide */}
                    <div style={{ display:'flex',gap:4 }}>
                      {[{ k:'plain', lbl:'Libre' },{ k:'boxed', lbl:'Encadré' },{ k:'arrow', lbl:'↓ Flèche' }].map(m => (
                        <button key={m.k} onClick={() => setTextMode(m.k)}
                          style={{ flex:1,padding:'4px 0',borderRadius:6,fontSize:10,fontWeight:700,cursor:'pointer',
                            background:textMode===m.k?DA.red:'#333',color:textMode===m.k?'white':'#aaa',border:'none' }}>
                          {m.lbl}
                        </button>
                      ))}
                    </div>
                    <div style={{ display:'flex',gap:6 }}>
                      <input autoFocus value={textV} onChange={e=>setTextV(e.target.value)}
                        onKeyDown={e=>{ if(e.key==='Enter')addText(); if(e.key==='Escape')setTextPt(null); }}
                        placeholder="Saisir le texte…"
                        style={{ flex:1,fontSize:13,border:'1px solid #444',borderRadius:7,padding:'6px 10px',outline:'none',background:'#111',color:'white',fontFamily:'inherit' }}/>
                      <button onClick={addText}
                        style={{ background:DA.red,color:'white',borderRadius:7,padding:'6px 12px',fontSize:13,fontWeight:700,cursor:'pointer',flexShrink:0 }}>OK</button>
                      <button onClick={() => setTextPt(null)}
                        style={{ background:'#333',color:'#aaa',borderRadius:7,padding:'6px 8px',fontSize:12,cursor:'pointer',flexShrink:0,border:'none' }}>✕</button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:12,color:DA.grayL }}>
            <Ic n="spn" s={32}/><p style={{ fontSize:13 }}>Chargement du plan…</p>
          </div>
        )}
      </div>

      {/* ── Bande de photos (sans labels V1/V2) ── */}
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
                <img src={ph.data} alt="" style={{ width:48,height:48,objectFit:'cover',display:'block' }}/>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default Annotator;
