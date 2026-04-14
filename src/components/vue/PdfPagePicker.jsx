import React, { useState, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { ensurePdfJs, pdfDataToBuffer } from '../../lib/pdfUtils.js';

// Props:
//   pdfData       - base64 dataURL du PDF
//   onSelect      - (pageNum) => void  — mode sélection simple
//   onSelectAll   - () => void         — importer tout (mode simple)
//   onSelectMany  - (pageNums, total) => void — mode multi-sélection (active si fourni)
//   onClose       - () => void

export default function PdfPagePicker({ pdfData, onSelect, onSelectAll, onSelectMany, onClose }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState(null);
  const [loadMsg, setLoadMsg] = useState('Chargement de PDF.js…');
  const [selected, setSelected] = useState(new Set());

  const multiSelect = !!onSelectMany;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadMsg('Chargement de PDF.js…');
        await ensurePdfJs();
        if (cancelled) return;
        if (!window.pdfjsLib) throw new Error("PDF.js n'a pas pu être chargé.");
        if (!pdfData) throw new Error('Aucune donnée PDF reçue.');
        setLoadMsg('Lecture du fichier PDF…');
        const buf = pdfDataToBuffer(pdfData);
        const loadTask = window.pdfjsLib.getDocument({ data: buf, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true });
        const pdf = await loadTask.promise;
        if (cancelled) return;
        const pageCount = pdf.numPages;
        setTotal(pageCount);
        const t = [];
        const maxPages = Math.min(pageCount, 20);
        for (let i = 1; i <= maxPages; i++) {
          if (cancelled) return;
          setLoadMsg(`Aperçu ${i} / ${maxPages}…`);
          const pg = await pdf.getPage(i);
          const vp = pg.getViewport({ scale: 0.4 });
          const cv = document.createElement('canvas');
          cv.width = Math.round(vp.width);
          cv.height = Math.round(vp.height);
          await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          t.push({ num: i, thumb: cv.toDataURL('image/jpeg', 0.65) });
          cv.width = 0; cv.height = 0;
        }
        if (!cancelled) {
          setPages(t);
          // En mode multi-sélection : toutes les pages sélectionnées par défaut
          if (multiSelect) setSelected(new Set(t.map(p => p.num)));
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          let msg = 'Impossible de lire ce PDF.';
          const em = (e.message || '').toLowerCase();
          if (em.includes('password') || e.name === 'PasswordException') msg = 'Ce PDF est protégé par un mot de passe.';
          else if (em.includes('invalid') || em.includes('corrupt') || em.includes('malform')) msg = 'Le fichier PDF semble corrompu ou invalide.';
          else if (em.includes('fetch') || em.includes('cdn') || em.includes('load')) msg = "PDF.js n'a pas pu être chargé (vérifiez votre connexion).";
          else msg = `Erreur de lecture PDF : ${e.message || e.name || 'inconnue'}.`;
          setErr(msg);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const togglePage = (num) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(num) ? next.delete(num) : next.add(num);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev => prev.size === pages.length ? new Set() : new Set(pages.map(p => p.num)));
  };

  const allSelected = pages.length > 0 && selected.size === pages.length;

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:70,display:'flex',flexDirection:'column' }}>
      {/* Header */}
      <div style={{ background:DA.black,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0 }}>
        <div>
          <p style={{ color:'white',fontWeight:700,fontSize:14,margin:0 }}>
            {multiSelect ? 'Choisir les pages à importer' : 'Choisir une page'}
          </p>
          {total > 0 && (
            <p style={{ color:DA.grayL,fontSize:11,margin:'2px 0 0' }}>
              {total} page{total > 1 ? 's' : ''}
              {multiSelect
                ? ` — ${selected.size} sélectionnée${selected.size > 1 ? 's' : ''}`
                : ' — cliquez une page ou importez tout'}
            </p>
          )}
        </div>
        <div style={{ display:'flex',gap:8,alignItems:'center' }}>
          {/* Mode multi-sélection */}
          {multiSelect && !loading && !err && (
            <>
              <button onClick={toggleAll}
                style={{ background:'rgba(255,255,255,0.12)',color:'white',border:'none',borderRadius:8,padding:'6px 12px',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap' }}>
                {allSelected ? 'Tout déséléct.' : 'Tout séléct.'}
              </button>
              <button
                onClick={() => selected.size > 0 && onSelectMany([...selected].sort((a, b) => a - b), total)}
                disabled={selected.size === 0}
                style={{ background:selected.size > 0 ? DA.red : '#555',color:'white',border:'none',borderRadius:8,padding:'6px 14px',fontSize:12,fontWeight:700,cursor:selected.size > 0 ? 'pointer' : 'default',whiteSpace:'nowrap' }}>
                ↓ Importer ({selected.size})
              </button>
            </>
          )}
          {/* Mode sélection simple */}
          {!multiSelect && onSelectAll && !loading && !err && (
            <button onClick={onSelectAll}
              style={{ background:DA.red,color:'white',border:'none',borderRadius:8,padding:'6px 12px',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap' }}>
              ↓ Tout importer ({total})
            </button>
          )}
          <button onClick={onClose} style={{ color:DA.grayL,background:'none',border:'none',cursor:'pointer' }}>
            <Ic n="x" s={20}/>
          </button>
        </div>
      </div>

      {/* Grille des pages */}
      <div style={{ flex:1,overflowY:'auto',padding:16 }}>
        {loading && (
          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:200,gap:12,color:DA.grayL }}>
            <Ic n="spn" s={32}/><p style={{ fontSize:13,textAlign:'center' }}>{loadMsg}</p>
          </div>
        )}
        {err && (
          <div style={{ background:'#FFF0F0',border:'1px solid #FCA5A5',borderRadius:10,padding:16,textAlign:'center' }}>
            <p style={{ color:DA.red,fontSize:13,fontWeight:600,margin:'0 0 10px' }}>⚠️ {err}</p>
            <button onClick={onClose} style={{ fontSize:12,padding:'6px 16px',borderRadius:8,background:DA.red,color:'white',border:'none',cursor:'pointer',fontWeight:600 }}>Fermer et réessayer</button>
          </div>
        )}
        {!loading && !err && (
          <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10 }}>
            {pages.map(pg => {
              const isSel = multiSelect && selected.has(pg.num);
              return (
                <button key={pg.num}
                  onClick={() => multiSelect ? togglePage(pg.num) : onSelect(pg.num)}
                  style={{ background:'#333',borderRadius:8,overflow:'hidden',border:`2px solid ${isSel ? DA.red : 'transparent'}`,cursor:'pointer',padding:0,position:'relative',transition:'border-color 0.1s' }}
                  onMouseEnter={e => { if (!multiSelect) e.currentTarget.style.borderColor = DA.red; }}
                  onMouseLeave={e => { if (!multiSelect) e.currentTarget.style.borderColor = 'transparent'; }}>
                  <img src={pg.thumb} alt={`p${pg.num}`} style={{ width:'100%',height:'auto',display:'block' }}/>
                  <p style={{ textAlign:'center',padding:'6px 0',fontSize:11,color:DA.grayL,margin:0 }}>Page {pg.num}</p>
                  {/* Checkbox en mode multi */}
                  {multiSelect && (
                    <div style={{ position:'absolute',top:6,right:6,width:20,height:20,borderRadius:5,border:`2.5px solid ${isSel ? DA.red : 'rgba(255,255,255,0.6)'}`,background:isSel ? DA.red : 'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.1s' }}>
                      {isSel && <span style={{ color:'white',fontSize:13,lineHeight:1,fontWeight:700 }}>✓</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
