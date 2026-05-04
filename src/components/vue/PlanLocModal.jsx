import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { renderPdfPage } from '../../lib/pdfUtils.js';
import Annotator from './Annotator.jsx';
import PdfPagePicker from './PdfPagePicker.jsx';

export default function PlanLocModal({ loc, planLibrary, onClose, onSave, onDeletePlan, onRenamePlan, items, autoAnnot }) {
  const [planBg, setPlanBg] = useState(loc.planBg || null);
  const [planData, setPlanData] = useState(loc.planData || null);
  const [annot, setAnnot] = useState(loc.planAnnotations || null);
  const [showAnnot, setShowAnnot] = useState(!!autoAnnot);
  const [showPicker, setShowPicker] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderErr, setRenderErr] = useState(null);
  const [pendingPdf, setPendingPdf] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingNom, setEditingNom] = useState('');
  const [confirmDelId, setConfirmDelId] = useState(null);

  const zonePhotos = (items || []).flatMap(it => (it.photos || []).filter(ph => ph.data));

  if (showAnnot) return (
    <Annotator bgImage={planBg} savedPaths={annot?.paths || []}
      photos={zonePhotos}
      onSave={(p, e) => {
        const newAnnot = { paths: p, exported: e };
        onSave({ planBg, planData, planAnnotations: newAnnot });
        onClose();
      }}
      onClose={() => setShowAnnot(false)}/>
  );

  if (showPicker && pendingPdf) return (
    <PdfPagePicker pdfData={pendingPdf} onSelect={async pageNum => {
      setShowPicker(false); setRendering(true); setRenderErr(null);
      const img = await renderPdfPage(pendingPdf, pageNum);
      if (img) { setPlanBg(img); setPlanData(pendingPdf); setAnnot(null); }
      else setRenderErr('Impossible de rendre cette page.');
      setPendingPdf(null); setRendering(false);
    }} onClose={() => { setShowPicker(false); setPendingPdf(null); }}/>
  );

  return (
    <div className="modal-overlay">
      <div className="modal-sheet-flex">
        <div style={{ padding:'16px 18px 12px',borderBottom:`1px solid ${DA.border}`,flexShrink:0 }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between' }}>
            <div>
              <p style={{ fontWeight:700,fontSize:14,color:DA.black,margin:0 }}>Plan — {loc.nom}</p>
              <p style={{ fontSize:11,color:DA.gray,margin:'3px 0 0' }}>
                {planLibrary?.length > 0 ? `${planLibrary.length} plan${planLibrary.length>1?'s':''} disponible${planLibrary.length>1?'s':''} dans la bibliothèque` : 'Aucun plan dans la bibliothèque — importez d\'abord via le bouton 📋 en haut'}
              </p>
            </div>
            <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL }}><Ic n="x" s={20}/></button>
          </div>
        </div>

        <div style={{ flex:1,overflowY:'auto',padding:14 }}>
          {renderErr && <div style={{ background:'#FFF0F0',border:'1px solid #FCA5A5',borderRadius:8,padding:'10px 12px',marginBottom:12,fontSize:12,color:'#B91C1C' }}>⚠️ {renderErr}</div>}
          {rendering && (
            <div style={{ display:'flex',alignItems:'center',gap:8,padding:'16px 0',color:DA.gray,justifyContent:'center' }}>
              <Ic n="spn" s={20}/><span>Rendu en cours…</span>
            </div>
          )}

          {planLibrary?.length > 0 && (
            <div style={{ marginBottom:16 }}>
              <p style={{ fontSize:11,fontWeight:700,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,margin:'0 0 10px',display:'flex',alignItems:'center',gap:6 }}>
                <Ic n="lib" s={12}/> Choisir dans la bibliothèque
              </p>
              <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                {planLibrary.map(pl => {
                  const sel = planBg === pl.bg;
                  return (
                    <div key={pl.id} style={{ display:'flex',alignItems:'center',gap:8,borderRadius:12,border:`2.5px solid ${sel?DA.red:DA.border}`,background:sel?DA.redL:DA.white,transition:'all 0.15s',overflow:'hidden' }}>
                      {/* Zone cliquable = sélection */}
                      <button onClick={() => { if(sel){setPlanBg(null);setPlanData(null);return;} setPlanBg(pl.bg); setPlanData(pl.data||null); setAnnot(null); setConfirmDelId(null); }}
                        style={{ flex:1,display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:'none',border:'none',cursor:'pointer',textAlign:'left',minWidth:0 }}>
                        {pl.bg && <img src={pl.bg} alt="" style={{ width:58,height:40,objectFit:'cover',borderRadius:6,border:`1px solid ${DA.border}`,flexShrink:0 }}/>}
                        <div style={{ flex:1,minWidth:0 }}>
                          {editingId === pl.id ? (
                            <input autoFocus value={editingNom}
                              onChange={e => setEditingNom(e.target.value)}
                              onClick={e => e.stopPropagation()}
                              onBlur={() => { if (editingNom.trim() && onRenamePlan) onRenamePlan(pl.id, editingNom.trim()); setEditingId(null); }}
                              onKeyDown={e => { e.stopPropagation(); if (e.key==='Enter') { if (editingNom.trim() && onRenamePlan) onRenamePlan(pl.id, editingNom.trim()); setEditingId(null); } if (e.key==='Escape') setEditingId(null); }}
                              style={{ width:'100%',fontSize:13,fontWeight:700,border:`1px solid ${DA.red}`,borderRadius:5,padding:'2px 6px',outline:'none',boxSizing:'border-box' }}/>
                          ) : (
                            <p style={{ fontWeight:700,fontSize:13,color:sel?DA.red:DA.black,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{pl.nom}</p>
                          )}
                          <p style={{ fontSize:10,color:DA.grayL,margin:'2px 0 0' }}>{pl.data?'PDF':'Image'}</p>
                        </div>
                        {sel && editingId !== pl.id && <Ic n="chk" s={18}/>}
                      </button>
                      {/* Actions renommer / supprimer */}
                      <div style={{ display:'flex',gap:2,paddingRight:8,flexShrink:0 }} onClick={e=>e.stopPropagation()}>
                        {onRenamePlan && (
                          <button onClick={() => { setEditingId(pl.id); setEditingNom(pl.nom); setConfirmDelId(null); }}
                            style={{ padding:'5px 7px',color:'#ccc',background:'none',border:'none',cursor:'pointer',borderRadius:6 }}
                            onMouseEnter={e=>e.currentTarget.style.color=DA.black} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
                            <Ic n="pen" s={13}/>
                          </button>
                        )}
                        {onDeletePlan && (confirmDelId === pl.id ? (
                          <>
                            <button onClick={() => { if (sel) { setPlanBg(null); setPlanData(null); setAnnot(null); } onDeletePlan(pl.id); setConfirmDelId(null); }}
                              style={{ padding:'4px 8px',background:'#B91C1C',color:'white',border:'none',borderRadius:5,fontSize:11,fontWeight:700,cursor:'pointer' }}>Oui</button>
                            <button onClick={() => setConfirmDelId(null)}
                              style={{ padding:'4px 6px',background:'white',color:'#555',border:'1px solid #E5E5E5',borderRadius:5,fontSize:11,cursor:'pointer' }}>Non</button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDelId(pl.id)}
                            style={{ padding:'5px 7px',color:'#ccc',background:'none',border:'none',cursor:'pointer',borderRadius:6 }}
                            onMouseEnter={e=>e.currentTarget.style.color=DA.red} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
                            <Ic n="del" s={13}/>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {planLibrary?.length === 0 && (
            <div style={{ background:'#FFFBEB',border:'1px solid #FCD34D',borderRadius:10,padding:'12px 14px',marginBottom:14 }}>
              <p style={{ fontSize:12,fontWeight:600,color:'#92400E',margin:'0 0 4px' }}>📋 Bibliothèque vide</p>
              <p style={{ fontSize:11,color:'#92400E',margin:0 }}>Appuyez sur le bouton <strong>📋</strong> en haut à droite du projet pour importer vos plans une fois.</p>
            </div>
          )}

          {planBg && !rendering && (
            <div style={{ borderTop:`1px solid ${DA.border}`,paddingTop:14 }}>
              <p style={{ fontSize:11,fontWeight:700,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,margin:'0 0 8px' }}>Plan sélectionné</p>
              <div style={{ position:'relative',borderRadius:10,overflow:'hidden',border:`1px solid ${DA.border}`,background:'#f5f5f5',marginBottom:10 }}>
                <img src={annot?.exported || planBg} alt="plan" style={{ width:'100%',maxHeight:200,objectFit:'contain',display:'block' }}/>
                {annot?.paths?.length > 0 && (
                  <div style={{ position:'absolute',top:8,right:8,background:'rgba(0,0,0,0.65)',color:'white',fontSize:10,padding:'3px 9px',borderRadius:10 }}>
                    {annot.paths.length} annotation{annot.paths.length>1?'s':''}
                  </div>
                )}
              </div>
              <button onClick={() => setShowAnnot(true)}
                style={{ width:'100%',background:DA.black,color:'white',border:'none',borderRadius:10,padding:10,fontSize:13,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:6,cursor:'pointer',marginBottom:8 }}>
                <Ic n="pen" s={14}/> Annoter ce plan
              </button>
            </div>
          )}
        </div>

        <div style={{ padding:'12px 14px 20px',borderTop:`1px solid ${DA.border}`,flexShrink:0,display:'flex',gap:8 }}>
          {planBg && (
            <button onClick={() => { setPlanBg(null); setPlanData(null); }}
              style={{ padding:'12px 16px',background:'white',color:DA.red,border:'1px solid #FCA5A5',borderRadius:12,fontSize:12,fontWeight:600,cursor:'pointer' }}>
              <Ic n="del" s={14}/>
            </button>
          )}
          <button onClick={() => { onSave({ planBg: planBg||null, planData: planData||null, planAnnotations: annot||null }); onClose(); }}
            style={{ flex:1,background:planBg?DA.red:DA.black,color:'white',border:'none',borderRadius:12,padding:12,fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
            <Ic n="chk" s={15}/> Terminer
          </button>
        </div>
      </div>
    </div>
  );
}
