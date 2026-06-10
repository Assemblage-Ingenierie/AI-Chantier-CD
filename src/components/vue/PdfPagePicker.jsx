import React, { useState, useEffect, useRef, useMemo } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { ensurePdfJs, pdfDataToBuffer } from '../../lib/pdfUtils.js';

// Rendu en pool : CONCURRENCY workers tournent en parallèle, chaque page s'affiche
// dès qu'elle est prête — plus d'attente de lot (l'ancien batch de 6 faisait tout apparaître
// d'un bloc puis grande pause avant le lot suivant).
const CONCURRENCY = 8;
const LONG_PRESS_MS = 280;

// Sélecteur de pages PDF. Deux modes :
//   • LEGACY (prop `pdfData`) : un seul PDF, `onSelectMany` reçoit un tableau de numéros de pages.
//   • MULTI  (prop `pdfs` = [{ pdf, nom }]) : plusieurs PDF affichés dans le MÊME écran, validés
//     d'un coup. `onSelectMany` reçoit [{ nom, pdf, nums:[...] }] (docs ayant ≥1 page cochée).
// Les pages sont identifiées par une clé `${docIdx}:${num}` dans les deux modes.
export default function PdfPagePicker({ pdfData, pdfs, label, onSelectMany, onClose }) {
  const docs = useMemo(
    () => (pdfs && pdfs.length ? pdfs : (pdfData ? [{ pdf: pdfData, nom: label || '' }] : [])),
    [pdfs, pdfData, label]
  );
  const multi = !!(pdfs && pdfs.length);

  const [pages, setPages]       = useState([]);   // [{ key, docIdx, num, thumb }]
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [zoom, setZoom] = useState(null); // page affichée en grand pendant l'appui long
  const lpTimer = useRef(null);
  const lpFired = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const pdfRefs = [];
    (async () => {
      try {
        await ensurePdfJs();
        const collected = [];
        const allSel = new Set();
        const pushPage = (p) => {
          collected.push(p);
          if (!cancelled) setPages([...collected].sort((a, b) => a.docIdx - b.docIdx || a.num - b.num));
        };

        for (let di = 0; di < docs.length; di++) {
          if (cancelled) break;
          const buf = pdfDataToBuffer(docs[di].pdf);
          const pdf = await window.pdfjsLib.getDocument({
            data: buf, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true,
          }).promise;
          pdfRefs.push(pdf);
          const count = pdf.numPages;
          for (let i = 1; i <= count; i++) allSel.add(`${di}:${i}`);
          if (!cancelled) setSelected(new Set(allSel));

          const renderPage = async (i) => {
            const pg = await pdf.getPage(i);
            const vp = pg.getViewport({ scale: 0.7 });
            const cv = document.createElement('canvas');
            cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
            await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
            const thumb = cv.toDataURL('image/webp', 0.75);
            cv.width = 0; cv.height = 0;
            return { key: `${di}:${i}`, docIdx: di, num: i, thumb };
          };

          // Pool concurrent : chaque page s'affiche dès qu'elle est prête.
          let nextIdx = 0;
          const worker = async () => {
            while (true) {
              const k = nextIdx++;
              if (k >= count || cancelled) return;
              try { pushPage(await renderPage(k + 1)); } catch { /* page isolée → on continue */ }
            }
          };
          await Promise.all(Array.from({ length: Math.min(CONCURRENCY, count) }, worker));
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; pdfRefs.forEach(p => p?.destroy()); };
  }, [docs]);

  useEffect(() => () => clearTimeout(lpTimer.current), []);

  const toggle = (key) => setSelected(s => {
    const n = new Set(s);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  const handleConfirm = async () => {
    if (selected.size === 0 || confirming) return;
    setConfirming(true);
    if (multi) {
      const result = docs.map((d, di) => ({
        nom: d.nom,
        pdf: d.pdf,
        nums: [...selected].filter(k => k.startsWith(`${di}:`)).map(k => +k.split(':')[1]).sort((a, b) => a - b),
      })).filter(d => d.nums.length);
      await onSelectMany(result);
    } else {
      await onSelectMany([...selected].map(k => +String(k).split(':').pop()).sort((a, b) => a - b));
    }
  };

  const totalDocs = docs.length;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:70, display:'flex', flexDirection:'column' }}>
      <div style={{ background:DA.black, padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ minWidth:0 }}>
          <p style={{ color:'white', fontWeight:700, fontSize:14, margin:0 }}>Choisir les pages à importer</p>
          {label && <p style={{ color:'rgba(255,255,255,0.7)', fontSize:12, margin:'1px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</p>}
          {multi && totalDocs > 1 && !label && (
            <p style={{ color:'rgba(255,255,255,0.7)', fontSize:12, margin:'1px 0 0' }}>{totalDocs} documents</p>
          )}
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
            const { key, num, thumb, docIdx } = pg;
            const sel = selected.has(key);
            const docNom = multi && totalDocs > 1 ? docs[docIdx]?.nom : null;
            const startPress = () => {
              lpFired.current = false;
              clearTimeout(lpTimer.current);
              lpTimer.current = setTimeout(() => { lpFired.current = true; setZoom(pg); }, LONG_PRESS_MS);
            };
            const endPress = () => { clearTimeout(lpTimer.current); setZoom(null); };
            return (
              <div key={key}
                onClick={() => { if (lpFired.current) { lpFired.current = false; return; } toggle(key); }}
                onPointerDown={startPress}
                onPointerUp={endPress}
                onPointerLeave={endPress}
                onPointerCancel={endPress}
                onContextMenu={(e) => e.preventDefault()}
                style={{ cursor:'pointer', borderRadius:8, overflow:'hidden', border:`3px solid ${sel ? DA.red : 'rgba(255,255,255,0.1)'}`, position:'relative', background:'#2a2a2a', transition:'border-color 0.1s', touchAction:'none', userSelect:'none' }}>
                <img src={thumb} alt={`Page ${num}`} draggable={false} style={{ width:'100%', display:'block', pointerEvents:'none' }}/>
                {docNom && (
                  <div style={{ position:'absolute', top:0, left:0, right:0, background:'rgba(0,0,0,0.6)', padding:'3px 8px', color:'rgba(255,255,255,0.9)', fontSize:10, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{docNom}</div>
                )}
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
