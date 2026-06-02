import React, { useState, useEffect, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { ensurePdfJs, pdfDataToBuffer } from '../../lib/pdfUtils.js';

// Rendu parallèle par lots — rend CONCURRENCY pages à la fois.
// Chaque lot met à jour l'affichage dès qu'il est terminé → les miniatures
// apparaissent par vagues plutôt qu'une par une.
const CONCURRENCY = 6;
const LONG_PRESS_MS = 280;

export default function PdfPagePicker({ pdfData, label, onSelectMany, onClose }) {
  const [pages, setPages]       = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [zoom, setZoom] = useState(null); // { num, thumb } affiché en grand pendant l'appui
  const lpTimer = useRef(null);           // timer d'appui long
  const lpFired = useRef(false);          // l'appui long s'est déclenché → ne pas (dé)sélectionner au relâchement

  useEffect(() => {
    let cancelled = false;
    let pdfRef = null;
    (async () => {
      try {
        await ensurePdfJs();
        const buf = pdfDataToBuffer(pdfData);
        const pdf = await window.pdfjsLib.getDocument({
          data: buf, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true,
        }).promise;
        pdfRef = pdf;
        const count = pdf.numPages;
        const allSel = new Set(Array.from({ length: count }, (_, i) => i + 1));
        if (!cancelled) setSelected(allSel);

        // Rendu parallèle : on prépare les tâches pour toutes les pages, puis
        // on les exécute CONCURRENCY à la fois pour ne pas saturer le thread UI.
        const renderPage = async (i) => {
          const pg = await pdf.getPage(i);
          const vp = pg.getViewport({ scale: 0.7 });
          const cv = document.createElement('canvas');
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          const thumb = cv.toDataURL('image/webp', 0.75);
          cv.width = 0; cv.height = 0;
          return { num: i, thumb };
        };

        const results = new Array(count);
        for (let start = 0; start < count; start += CONCURRENCY) {
          if (cancelled) return;
          const batch = [];
          for (let k = start; k < Math.min(start + CONCURRENCY, count); k++) {
            batch.push(renderPage(k + 1).then(r => { results[k] = r; }));
          }
          await Promise.all(batch);
          if (cancelled) return;
          // Mise à jour par lot : évite N re-renders par page
          setPages(results.slice(0, start + CONCURRENCY).filter(Boolean));
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; pdfRef?.destroy(); };
  }, [pdfData]);

  useEffect(() => () => clearTimeout(lpTimer.current), []);

  const toggle = (num) => setSelected(s => {
    const n = new Set(s);
    n.has(num) ? n.delete(num) : n.add(num);
    return n;
  });

  const handleConfirm = async () => {
    if (selected.size === 0 || confirming) return;
    setConfirming(true);
    await onSelectMany(Array.from(selected).sort((a, b) => a - b));
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:70, display:'flex', flexDirection:'column' }}>
      <div style={{ background:DA.black, padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ minWidth:0 }}>
          <p style={{ color:'white', fontWeight:700, fontSize:14, margin:0 }}>Choisir les pages à importer</p>
          {label && <p style={{ color:'rgba(255,255,255,0.7)', fontSize:12, margin:'1px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</p>}
          <p style={{ color:'rgba(255,255,255,0.45)', fontSize:11, margin:'2px 0 0' }}>
            {selected.size} / {pages.length}{loading ? '…' : ''} page{pages.length !== 1 ? 's' : ''} sélectionnée{selected.size !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose}
            style={{ background:'rgba(255,255,255,0.1)', border:'none', color:'rgba(255,255,255,0.6)', borderRadius:8, padding:'7px 12px', cursor:'pointer', fontSize:12, fontWeight:600 }}>
            Annuler
          </button>
          <button onClick={handleConfirm} disabled={selected.size === 0 || confirming}
            style={{ background: selected.size > 0 && !confirming ? DA.red : '#555', border:'none', color:'white', borderRadius:8, padding:'7px 14px', cursor: selected.size > 0 && !confirming ? 'pointer' : 'not-allowed', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', gap:6 }}>
            {confirming ? <Ic n="spn" s={12}/> : <Ic n="chk" s={12}/>}
            {confirming ? 'Import…' : 'Importer'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:16 }}>
        {error && (
          <p style={{ color:'#FCA5A5', textAlign:'center', padding:32, fontSize:13 }}>⚠️ {error}</p>
        )}
        {loading && pages.length === 0 && !error && (
          <div style={{ textAlign:'center', padding:48, color:'rgba(255,255,255,0.45)', display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
            <Ic n="spn" s={24}/>
            <span style={{ fontSize:13 }}>Chargement des pages…</span>
          </div>
        )}
        <p style={{ color:'rgba(255,255,255,0.4)', fontSize:11, margin:'0 0 10px', textAlign:'center' }}>
          Touchez pour (dé)sélectionner • appui long pour voir en grand
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:14 }}>
          {pages.map((pg) => {
            const { num, thumb } = pg;
            const sel = selected.has(num);
            const startPress = () => {
              lpFired.current = false;
              clearTimeout(lpTimer.current);
              lpTimer.current = setTimeout(() => { lpFired.current = true; setZoom(pg); }, LONG_PRESS_MS);
            };
            const endPress = () => { clearTimeout(lpTimer.current); setZoom(null); };
            return (
              <div key={num}
                onClick={() => { if (lpFired.current) { lpFired.current = false; return; } toggle(num); }}
                onPointerDown={startPress}
                onPointerUp={endPress}
                onPointerLeave={endPress}
                onPointerCancel={endPress}
                onContextMenu={(e) => e.preventDefault()}
                style={{ cursor:'pointer', borderRadius:8, overflow:'hidden', border:`3px solid ${sel ? DA.red : 'rgba(255,255,255,0.1)'}`, position:'relative', background:'#2a2a2a', transition:'border-color 0.1s', touchAction:'none', userSelect:'none' }}>
                <img src={thumb} alt={`Page ${num}`} draggable={false} style={{ width:'100%', display:'block', pointerEvents:'none' }}/>
                <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'rgba(0,0,0,0.6)', padding:'4px 8px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ color:'white', fontSize:11, fontWeight:600 }}>p. {num}</span>
                  {sel && <span style={{ color:DA.red, fontSize:13, fontWeight:700 }}>✓</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Aperçu plein écran pendant l'appui long — se ferme au relâchement */}
      {zoom && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.95)', zIndex:90, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
          <img src={zoom.thumb} alt={`Page ${zoom.num}`} style={{ maxWidth:'96vw', maxHeight:'92vh', objectFit:'contain', boxShadow:'0 8px 50px rgba(0,0,0,0.7)', borderRadius:6 }}/>
          <div style={{ position:'absolute', top:18, left:0, right:0, textAlign:'center', color:'white', fontSize:14, fontWeight:700 }}>Page {zoom.num}</div>
        </div>
      )}
    </div>
  );
}

