import React, { useState, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { renderPdfPage, renderPdfPages } from '../../lib/pdfUtils.js';
import PdfPagePicker from './PdfPagePicker.jsx';

export default function PlanLibraryModal({ planLibrary, onAdd, onDelete, onRename, onRepairBg, onClose }) {
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState('');
  const [renderErr, setRenderErr] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pdfQueue, setPdfQueue] = useState([]); // [{pdf, nom}]
  const [pdfQueueIdx, setPdfQueueIdx] = useState(0);
  const [pdfQueueResults, setPdfQueueResults] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingNom, setEditingNom] = useState('');
  const [previewBg, setPreviewBg] = useState(null);
  const [repairTargetId, setRepairTargetId] = useState(null);
  const [repairPdfData, setRepairPdfData] = useState(null);
  const [showRepairPicker, setShowRepairPicker] = useState(false);
  const [repairingId, setRepairingId] = useState(null);
  const fileRef = useRef();
  const repairFileRef = useRef();

  const handleFile = e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setRenderErr(null);

    const pdfs = [], images = [], bad = [];
    for (const f of files) {
      if (f.size > 20 * 1024 * 1024) { bad.push(f.name); continue; }
      if (f.type === 'application/pdf') pdfs.push(f);
      else if (f.type.startsWith('image/')) images.push(f);
      else bad.push(f.name);
    }
    if (bad.length) setRenderErr(`Ignoré(s) — trop volumineux ou format non supporté : ${bad.join(', ')}`);

    images.forEach(f => {
      const nom = f.name.replace(/\.[^.]+$/, '');
      const r = new FileReader();
      r.onload = ev => onAdd([{ id: crypto.randomUUID(), nom, bg: ev.target.result, data: null }]);
      r.readAsDataURL(f);
    });

    if (pdfs.length > 0) {
      Promise.all(pdfs.map(f => new Promise(res => {
        const nom = f.name.replace(/\.[^.]+$/, '');
        const r = new FileReader();
        r.onload = ev => res({ pdf: ev.target.result, nom });
        r.readAsDataURL(f);
      }))).then(queue => {
        setPdfQueue(queue);
        setPdfQueueIdx(0);
        setPdfQueueResults([]);
        setShowPicker(true);
      });
    }
    e.target.value = '';
  };

  // Appelé par le picker avec les numéros de pages sélectionnées
  const handlePagesSelected = async selectedNums => {
    const { pdf: pdfData, nom: baseName } = pdfQueue[pdfQueueIdx];
    setShowPicker(false);
    setRendering(true);
    setRenderErr(null);
    const newResults = [];
    try {
      // Parse le PDF UNE fois + rendu parallèle (au lieu d'un parse séquentiel par page).
      const rendered = await renderPdfPages(pdfData, selectedNums, {
        onProgress: (d, t) => setRenderProgress(pdfQueue.length > 1
          ? `PDF ${pdfQueueIdx + 1}/${pdfQueue.length} — ${d}/${t} pages…`
          : `Rendu ${d} / ${t} pages…`),
      });
      for (const { num, img } of rendered) {
        if (!img) continue;
        const nom = selectedNums.length === 1 ? baseName : `${baseName} — Page ${num}`;
        newResults.push({ id: crypto.randomUUID(), nom, bg: img, data: pdfData });
      }
    } catch (e) {
      setRenderErr('Erreur rendu PDF : ' + e.message);
    }
    setRenderProgress('');
    setRendering(false);

    const allResults = [...pdfQueueResults, ...newResults];
    const nextIdx = pdfQueueIdx + 1;
    if (nextIdx < pdfQueue.length) {
      setPdfQueueResults(allResults);
      setPdfQueueIdx(nextIdx);
      setShowPicker(true);
    } else {
      if (allResults.length > 0) onAdd(allResults);
      else setRenderErr("Aucune page n'a pu être rendue.");
      setPdfQueue([]);
      setPdfQueueIdx(0);
      setPdfQueueResults([]);
    }
  };

  const startRename = (pl) => {
    setEditingId(pl.id);
    setEditingNom(pl.nom);
  };

  const confirmRename = () => {
    if (editingNom.trim() && onRename) onRename(editingId, editingNom.trim());
    setEditingId(null);
    setEditingNom('');
  };

  const handleRepairFile = e => {
    const f = e.target.files?.[0];
    if (!f || !repairTargetId) return;
    e.target.value = '';
    setRenderErr(null);
    if (f.type === 'application/pdf') {
      const r = new FileReader();
      r.onload = ev => { setRepairPdfData(ev.target.result); setShowRepairPicker(true); };
      r.readAsDataURL(f);
    } else if (f.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = ev => { onRepairBg(repairTargetId, ev.target.result); setRepairTargetId(null); };
      r.readAsDataURL(f);
    } else {
      setRenderErr('Format non supporté. Utilisez PDF, JPG ou PNG.');
      setRepairTargetId(null);
    }
  };

  const handleRepairPageSelected = async selectedNums => {
    setShowRepairPicker(false);
    const pageNum = selectedNums[0];
    if (!pageNum || !repairPdfData || !repairTargetId) return;
    setRepairingId(repairTargetId);
    try {
      const img = await renderPdfPage(repairPdfData, pageNum);
      if (img) onRepairBg(repairTargetId, img);
      else setRenderErr("Impossible de rendre cette page.");
    } catch (err) {
      setRenderErr('Erreur rendu : ' + err.message);
    }
    setRepairingId(null);
    setRepairTargetId(null);
    setRepairPdfData(null);
  };

  if (showRepairPicker && repairPdfData) return (
    <PdfPagePicker
      pdfData={repairPdfData}
      label="Choisir la page du plan"
      onSelectMany={handleRepairPageSelected}
      onClose={() => { setShowRepairPicker(false); setRepairTargetId(null); setRepairPdfData(null); }}
    />
  );

  if (showPicker && pdfQueue.length > 0) return (
    <PdfPagePicker
      pdfData={pdfQueue[pdfQueueIdx].pdf}
      label={pdfQueue.length > 1 ? `${pdfQueue[pdfQueueIdx].nom} (${pdfQueueIdx + 1}/${pdfQueue.length})` : pdfQueue[pdfQueueIdx].nom}
      onSelectMany={handlePagesSelected}
      onClose={() => {
        setShowPicker(false);
        if (pdfQueueResults.length > 0) onAdd(pdfQueueResults);
        setPdfQueue([]);
        setPdfQueueIdx(0);
        setPdfQueueResults([]);
      }}
    />
  );

  if (previewBg) return (
    <div onClick={() => setPreviewBg(null)} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:80,display:'flex',alignItems:'center',justifyContent:'center',cursor:'zoom-out' }}>
      <img src={previewBg} alt="" style={{ maxWidth:'92vw',maxHeight:'92vh',objectFit:'contain',borderRadius:8,boxShadow:'0 8px 40px rgba(0,0,0,0.6)' }}/>
      <button onClick={() => setPreviewBg(null)} style={{ position:'absolute',top:16,right:16,background:'rgba(255,255,255,0.12)',border:'none',color:'white',borderRadius:'50%',width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' }}>
        <Ic n="x" s={16}/>
      </button>
    </div>
  );

  return (
    <div className="modal-overlay" style={{ zIndex:60 }}>
      <div className="modal-sheet-flex">
        {/* Header */}
        <div style={{ padding:'16px 18px 14px',borderBottom:`1px solid ${DA.border}`,flexShrink:0 }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8 }}>
              <Ic n="lib" s={18}/>
              <p style={{ fontWeight:800,fontSize:15,color:DA.black,margin:0 }}>Bibliothèque de plans</p>
            </div>
            <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL }}><Ic n="x" s={20}/></button>
          </div>
          <p style={{ fontSize:12,color:DA.gray,margin:0 }}>Importez votre PDF — choisissez les pages à garder.</p>
        </div>

        {/* Corps */}
        <div style={{ flex:1,overflowY:'auto',padding:14 }}>
          {renderErr && (
            <div style={{ background:'#FFF0F0',border:'1px solid #FCA5A5',borderRadius:8,padding:'10px 12px',marginBottom:12,fontSize:12,color:'#B91C1C' }}>
              ⚠️ {renderErr}
            </div>
          )}
          {rendering && (
            <div style={{ display:'flex',alignItems:'center',gap:8,padding:'16px 0',color:DA.gray,justifyContent:'center' }}>
              <Ic n="spn" s={20}/><span style={{ fontSize:13 }}>{renderProgress || 'Rendu en cours…'}</span>
            </div>
          )}
          {planLibrary.length === 0 && !rendering && (
            <div style={{ textAlign:'center',padding:'32px 0',color:DA.grayL }}>
              <Ic n="map" s={40}/>
              <p style={{ fontSize:13,fontWeight:600,color:DA.gray,margin:'8px 0 4px' }}>Aucun plan dans la bibliothèque</p>
              <p style={{ fontSize:11,color:DA.grayL,margin:0 }}>Importez vos PDF ou images de plans</p>
            </div>
          )}
          <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
            {planLibrary.map(pl => (
              <div key={pl.id} style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:12,border:`1px solid ${pl.bg ? DA.border : '#FCA5A5'}`,background:DA.white }}>
                {pl.bg
                  ? <img src={pl.bg} alt="" onClick={() => setPreviewBg(pl.bg)} style={{ width:64,height:44,objectFit:'cover',borderRadius:6,border:`1px solid ${DA.border}`,flexShrink:0,cursor:'zoom-in' }}/>
                  : <div style={{ width:64,height:44,borderRadius:6,border:`1px dashed #FCA5A5`,flexShrink:0,background:'#FFF8F8',display:'flex',alignItems:'center',justifyContent:'center' }}><Ic n="img" s={18}/></div>
                }
                <div style={{ flex:1,minWidth:0 }}>
                  {editingId === pl.id ? (
                    <input
                      autoFocus
                      value={editingNom}
                      onChange={e => setEditingNom(e.target.value)}
                      onBlur={confirmRename}
                      onKeyDown={e => { if (e.key==='Enter') confirmRename(); if (e.key==='Escape') setEditingId(null); }}
                      style={{ width:'100%',fontSize:13,fontWeight:700,border:`1px solid ${DA.red}`,borderRadius:6,padding:'3px 6px',outline:'none',boxSizing:'border-box' }}
                    />
                  ) : (
                    <p style={{ fontWeight:700,fontSize:13,color:DA.black,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{pl.nom}</p>
                  )}
                  <p style={{ fontSize:10,color:DA.grayL,margin:'2px 0 0' }}>{pl.data ? 'Document PDF' : 'Image'}</p>
                </div>
                <div style={{ display:'flex',gap:4,flexShrink:0,alignItems:'center' }}>
                  {!pl.bg && onRepairBg && (
                    <button
                      onClick={() => { setRepairTargetId(pl.id); repairFileRef.current.click(); }}
                      disabled={repairingId === pl.id}
                      title="Réimporter l'image de ce plan (sans perdre les zones)"
                      style={{ padding:'4px 7px',color:'#B91C1C',background:'#FFF0F0',border:'1px solid #FCA5A5',borderRadius:6,cursor:'pointer',display:'flex',alignItems:'center',gap:3,fontSize:10,fontWeight:700,whiteSpace:'nowrap' }}>
                      {repairingId === pl.id ? <Ic n="spn" s={12}/> : <Ic n="und" s={12}/>}
                      Réimporter
                    </button>
                  )}
                  {onRename && (
                    <button onClick={() => startRename(pl)}
                      style={{ padding:6,color:'#ccc',background:'none',border:'none',cursor:'pointer' }}
                      onMouseEnter={e=>e.currentTarget.style.color=DA.black} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
                      <Ic n="pen" s={14}/>
                    </button>
                  )}
                  <button onClick={() => onDelete(pl.id)}
                    style={{ padding:6,color:'#ccc',background:'none',border:'none',cursor:'pointer' }}
                    onMouseEnter={e=>e.currentTarget.style.color=DA.red} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
                    <Ic n="del" s={15}/>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 14px 20px',borderTop:`1px solid ${DA.border}`,flexShrink:0,display:'flex',flexDirection:'column',gap:8 }}>
          <button onClick={() => fileRef.current.click()} disabled={rendering}
            style={{ width:'100%',background:rendering ? DA.grayL : DA.black,color:'white',border:'none',borderRadius:12,padding:14,fontSize:14,fontWeight:700,cursor:rendering?'default':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8 }}>
            <Ic n="plus" s={16}/> Ajouter un plan (PDF, JPG, PNG)
          </button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display:'none' }} onChange={handleFile}/>
          <input ref={repairFileRef} type="file" accept="image/*,application/pdf" style={{ display:'none' }} onChange={handleRepairFile}/>
          <button onClick={onClose}
            style={{ width:'100%',background:DA.red,color:'white',border:'none',borderRadius:12,padding:12,fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
            <Ic n="chk" s={15}/> Terminer
          </button>
        </div>
      </div>
    </div>
  );
}
