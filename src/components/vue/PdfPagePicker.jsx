import React, { useState, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { ensurePdfJs, pdfDataToBuffer } from '../../lib/pdfUtils.js';

export default function PdfPagePicker({ pdfData, onSelectMany, onClose }) {
  const [pages, setPages]       = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensurePdfJs();
        const buf = pdfDataToBuffer(pdfData);
        const pdf = await window.pdfjsLib.getDocument({
          data: buf, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true,
        }).promise;
        const count = pdf.numPages;
        const allSel = new Set(Array.from({ length: count }, (_, i) => i + 1));
        if (!cancelled) setSelected(allSel);

        const arr = [];
        for (let i = 1; i <= count; i++) {
          if (cancelled) return;
          const pg = await pdf.getPage(i);
          const vp = pg.getViewport({ scale: 0.4 });
          const cv = document.createElement('canvas');
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          const thumb = cv.toDataURL('image/jpeg', 0.7);
          cv.width = 0; cv.height = 0;
          if (!cancelled) { arr.push({ num: i, thumb }); setPages([...arr]); }
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [pdfData]);

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
        <div>
          <p style={{ color:'white', fontWeight:700, fontSize:14, margin:0 }}>Choisir les pages à importer</p>
          <p style={{ color:'rgba(255,255,255,0.45)', fontSize:11, margin:'2px 0 0' }}>
            {selected.size} / {pages.length} page{pages.length !== 1 ? 's' : ''} sélectionnée{selected.size !== 1 ? 's' : ''}
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
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(110px, 1fr))', gap:10 }}>
          {pages.map(({ num, thumb }) => {
            const sel = selected.has(num);
            return (
              <div key={num} onClick={() => toggle(num)} style={{ cursor:'pointer', borderRadius:8, overflow:'hidden', border:`3px solid ${sel ? DA.red : 'rgba(255,255,255,0.1)'}`, position:'relative', background:'#2a2a2a', transition:'border-color 0.1s' }}>
                <img src={thumb} alt={`Page ${num}`} style={{ width:'100%', display:'block' }}/>
                <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'rgba(0,0,0,0.6)', padding:'3px 6px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ color:'white', fontSize:10, fontWeight:600 }}>p. {num}</span>
                  {sel && <span style={{ color:DA.red, fontSize:12, fontWeight:700 }}>✓</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
