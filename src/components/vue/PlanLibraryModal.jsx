import React, { useState, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { ensurePdfJs, renderPdfPage } from '../../lib/pdfUtils.js';
import PdfPagePicker from './PdfPagePicker.jsx';

export default function PlanLibraryModal({ planLibrary, onAdd, onDelete, onClose }) {
  const [rendering, setRendering] = useState(false);
  const [renderErr, setRenderErr] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pendingPdf, setPendingPdf] = useState(null);
  const [pendingName, setPendingName] = useState('');
  const fileRef = useRef();

  const handleFile = e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setRenderErr('Fichier trop volumineux (max 20 Mo)'); e.target.value = ''; return; }
    setRenderErr(null);
    const nom = f.name.replace(/\.[^.]+$/, '');
    if (f.type === 'application/pdf') {
      const r = new FileReader();
      r.onload = ev => {
        setPendingPdf(ev.target.result);
        setPendingName(nom);
        handlePdfAllPages(ev.target.result, nom);
      };
      r.readAsDataURL(f);
    } else if (f.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = ev => { onAdd({ id: crypto.randomUUID(), nom, bg: ev.target.result, data: null }); };
      r.readAsDataURL(f);
    } else {
      setRenderErr('Format non supporté. Utilisez PDF, JPG ou PNG.');
    }
    e.target.value = '';
  };

  const handlePdfAllPages = async (pdfDataParam, nomParam) => {
    const pdfToUse = pdfDataParam || pendingPdf;
    const nomToUse = nomParam || pendingName;
    setShowPicker(false);
    setRendering(true);
    setRenderErr(null);
    try {
      await ensurePdfJs();
      const pdfjsLib = window.pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
      const pdf = await pdfjsLib.getDocument({ data: atob(pdfToUse.split(',')[1]) }).promise;
      const total = pdf.numPages;
      for (let i = 1; i <= total; i++) {
        const img = await renderPdfPage(pdfToUse, i);
        if (img) {
          const nom = total === 1 ? nomToUse : `${nomToUse} — Page ${i}`;
          onAdd({ id: crypto.randomUUID(), nom, bg: img, data: pdfToUse });
          await new Promise(r => setTimeout(r, 30));
        }
      }
    } catch (e) {
      setRenderErr('Erreur lecture PDF: ' + e.message);
    }
    setPendingPdf(null);
    setPendingName('');
    setRendering(false);
  };

  const handlePageSelect = async pageNum => {
    setShowPicker(false);
    setRendering(true);
    setRenderErr(null);
    const img = await renderPdfPage(pendingPdf, pageNum);
    if (img) { onAdd({ id: crypto.randomUUID(), nom: pendingName, bg: img, data: pendingPdf }); }
    else { setRenderErr('Impossible de rendre cette page PDF.'); }
    setPendingPdf(null);
    setRendering(false);
  };

  if (showPicker && pendingPdf) return (
    <PdfPagePicker pdfData={pendingPdf} onSelect={handlePageSelect} onSelectAll={handlePdfAllPages} onClose={() => setShowPicker(false)}/>
  );

  return (
    <div className="modal-overlay" style={{ zIndex:60 }}>
      <div className="modal-sheet-flex">
        <div style={{ padding:'16px 18px 14px',borderBottom:`1px solid ${DA.border}`,flexShrink:0 }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8 }}>
              <Ic n="lib" s={18}/>
              <p style={{ fontWeight:800,fontSize:15,color:DA.black,margin:0 }}>Bibliothèque de plans</p>
            </div>
            <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL }}><Ic n="x" s={20}/></button>
          </div>
          <p style={{ fontSize:12,color:DA.gray,margin:0 }}>Importez votre PDF une seule fois → toutes les pages sont importées automatiquement.</p>
        </div>

        <div style={{ flex:1,overflowY:'auto',padding:14 }}>
          {renderErr && <div style={{ background:'#FFF0F0',border:'1px solid #FCA5A5',borderRadius:8,padding:'10px 12px',marginBottom:12,fontSize:12,color:'#B91C1C' }}>⚠️ {renderErr}</div>}
          {rendering && (
            <div style={{ display:'flex',alignItems:'center',gap:8,padding:'16px 0',color:DA.gray,justifyContent:'center' }}>
              <Ic n="spn" s={20}/><span style={{ fontSize:13 }}>Rendu en cours…</span>
            </div>
          )}
          {planLibrary.length === 0 && !rendering && (
            <div style={{ textAlign:'center',padding:'32px 0',color:DA.grayL }}>
              <Ic n="map" s={40}/>
              <p style={{ fontSize:13,fontWeight:600,color:DA.gray,margin:0 }}>Aucun plan dans la bibliothèque</p>
              <p style={{ fontSize:11,color:DA.grayL,marginTop:4 }}>Importez vos PDF ou images de plans</p>
            </div>
          )}
          <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
            {planLibrary.map(pl => (
              <div key={pl.id} style={{ display:'flex',alignItems:'center',gap:12,padding:'10px 12px',borderRadius:12,border:`1px solid ${DA.border}`,background:DA.white }}>
                {pl.bg && <img src={pl.bg} alt="" style={{ width:64,height:44,objectFit:'cover',borderRadius:6,border:`1px solid ${DA.border}`,flexShrink:0 }}/>}
                <div style={{ flex:1,minWidth:0 }}>
                  <p style={{ fontWeight:700,fontSize:13,color:DA.black,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{pl.nom}</p>
                  <p style={{ fontSize:10,color:DA.grayL,margin:'2px 0 0' }}>{pl.data ? 'Document PDF' : 'Image'}</p>
                </div>
                <button onClick={() => onDelete(pl.id)} style={{ padding:6,color:'#ccc',background:'none',border:'none',cursor:'pointer',flexShrink:0 }}
                  onMouseEnter={e=>e.currentTarget.style.color=DA.red} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
                  <Ic n="del" s={15}/>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding:'12px 14px 20px',borderTop:`1px solid ${DA.border}`,flexShrink:0 }}>
          <button onClick={() => fileRef.current.click()} style={{ width:'100%',background:DA.black,color:'white',border:'none',borderRadius:12,padding:14,fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8 }}>
            <Ic n="plus" s={16}/> Ajouter un plan (PDF, JPG, PNG)
          </button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display:'none' }} onChange={handleFile}/>
        </div>
      </div>
    </div>
  );
}
