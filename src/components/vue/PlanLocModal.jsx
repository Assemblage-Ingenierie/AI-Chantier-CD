import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { renderPdfPage } from '../../lib/pdfUtils.js';
import { fetchPlanData } from '../../lib/storage.js';
import Annotator from './Annotator.jsx';
import PdfPagePicker from './PdfPagePicker.jsx';

export default function PlanLocModal({ loc, planLibrary, onClose, onSave, onDeletePlan, onRenamePlan, items, autoAnnot }) {
  const [planId, setPlanId] = useState(loc.planId || null);
  const [planBg, setPlanBg] = useState(loc.planBg || null);
  const [planData, setPlanData] = useState(loc.planData || null);
  const [annot, setAnnot] = useState(loc.planAnnotations || null);
  const [extraPlans, setExtraPlans] = useState(loc.extraPlans || []);
  const [annotatingExtraIdx, setAnnotatingExtraIdx] = useState(null);
  const [showExtraPicker, setShowExtraPicker] = useState(false);
  const [showAnnot, setShowAnnot] = useState(!!autoAnnot);
  const [showPicker, setShowPicker] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderErr, setRenderErr] = useState(null);
  const [pendingPdf, setPendingPdf] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingNom, setEditingNom] = useState('');
  const [confirmDelId, setConfirmDelId] = useState(null);

  const zonePhotos = (items || []).flatMap(it => (it.photos || []).filter(ph => ph.data));
  const currentPlan = planLibrary?.find(p => p.bg === planBg);
  const annotTitle = currentPlan ? `${loc.nom} — ${currentPlan.nom}` : loc.nom;

  const buildSave = (overrides = {}) => ({
    planId: planId||null, planBg, planData, planAnnotations: annot, extraPlans,
    ...overrides,
  });

  if (annotatingExtraIdx !== null) {
    const ep = extraPlans[annotatingExtraIdx];
    const epNom = planLibrary?.find(p => p.id === ep?.planId)?.nom || 'Plan';
    return (
      <Annotator
        bgImage={ep?.planBg || null}
        savedPaths={ep?.planAnnotations?.paths || []}
        photos={zonePhotos}
        exportSizeMultiplier={2}
        title={`${loc.nom} — ${epNom}`}
        onSave={(p, e) => {
          const updated = extraPlans.map((x, i) => i === annotatingExtraIdx ? { ...x, planAnnotations: { paths: p, exported: e } } : x);
          setExtraPlans(updated);
          onSave(buildSave({ extraPlans: updated }));
          onClose();
        }}
        onClose={() => setAnnotatingExtraIdx(null)}
      />
    );
  }

  if (showAnnot) return (
    <Annotator bgImage={planBg} savedPaths={annot?.paths || []}
      photos={zonePhotos}
      exportSizeMultiplier={2}
      title={annotTitle}
      onSave={(p, e) => {
        const newAnnot = { paths: p, exported: e };
        onSave(buildSave({ planAnnotations: newAnnot }));
        onClose();
      }}
      onClose={() => setShowAnnot(false)}/>
  );

  if (showExtraPicker) return (
    <div className="modal-overlay">
      <div className="modal-sheet" style={{ padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
          <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:0 }}>Ajouter un plan à la zone</p>
          <button onClick={() => setShowExtraPicker(false)} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL }}><Ic n="x" s={20}/></button>
        </div>
        {(planLibrary || []).length === 0 ? (
          <p style={{ color:DA.grayL, textAlign:'center', padding:24, fontSize:13 }}>Aucun plan dans la bibliothèque</p>
        ) : (planLibrary || []).map(pl => (
          <button key={pl.id} onClick={() => {
            setExtraPlans(prev => [...prev, { id: crypto.randomUUID(), planId: pl.id, planBg: pl.bg || null, planAnnotations: null }]);
            setShowExtraPicker(false);
          }} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 12px', border:`1px solid ${DA.border}`, borderRadius:10, background:'white', marginBottom:8, cursor:'pointer', textAlign:'left' }}>
            {pl.bg && <img src={pl.bg} alt="" style={{ width:56, height:36, objectFit:'cover', borderRadius:4, flexShrink:0 }}/>}
            <p style={{ fontSize:13, fontWeight:600, color:DA.black, margin:0 }}>{pl.nom || 'Plan sans nom'}</p>
          </button>
        ))}
      </div>
    </div>
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
                  const sel = planId === pl.id;
                  return (
                    <div key={pl.id} style={{ display:'flex',alignItems:'center',gap:8,borderRadius:12,border:`2.5px solid ${sel?DA.red:DA.border}`,background:sel?DA.redL:DA.white,transition:'all 0.15s',overflow:'hidden' }}>
                      <button onClick={() => { if(sel){setPlanId(null);setPlanBg(null);setPlanData(null);return;} setPlanId(pl.id); setPlanBg(pl.bg||null); setPlanData(pl.data||null); setConfirmDelId(null); }}
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
                            <button onClick={() => { if (sel) { setPlanId(null); setPlanBg(null); setPlanData(null); } onDeletePlan(pl.id); setConfirmDelId(null); }}
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
            <div style={{ borderTop:`1px solid ${DA.border}`,paddingTop:14,marginBottom:14 }}>
              <p style={{ fontSize:11,fontWeight:700,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,margin:'0 0 8px' }}>Plan principal</p>
              <div style={{ position:'relative',borderRadius:10,overflow:'hidden',border:`1px solid ${DA.border}`,background:'#f5f5f5',marginBottom:10 }}>
                <img src={annot?.exported || planBg} alt="plan" style={{ width:'100%',maxHeight:200,objectFit:'contain',display:'block' }}/>
                {annot?.paths?.length > 0 && (
                  <div style={{ position:'absolute',top:8,right:8,background:'rgba(0,0,0,0.65)',color:'white',fontSize:10,padding:'3px 9px',borderRadius:10 }}>
                    {annot.paths.length} annotation{annot.paths.length>1?'s':''}
                  </div>
                )}
              </div>
              <button onClick={() => setShowAnnot(true)}
                style={{ width:'100%',background:DA.black,color:'white',border:'none',borderRadius:10,padding:10,fontSize:13,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:6,cursor:'pointer' }}>
                <Ic n="pen" s={14}/> Annoter ce plan
              </button>
            </div>
          )}

          {/* Plans supplémentaires */}
          <div style={{ borderTop:`1px solid ${DA.border}`,paddingTop:14 }}>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
              <p style={{ fontSize:11,fontWeight:700,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,margin:0 }}>
                Plans supplémentaires
              </p>
              <button onClick={() => setShowExtraPicker(true)}
                style={{ fontSize:11,fontWeight:600,color:DA.red,background:DA.redL,border:`1px solid #FECACA`,borderRadius:8,padding:'4px 10px',cursor:'pointer',display:'flex',alignItems:'center',gap:4 }}>
                <Ic n="plus" s={11}/> Ajouter
              </button>
            </div>
            {extraPlans.map((ep, idx) => {
              const libPlan = planLibrary?.find(p => p.id === ep.planId);
              const bg = ep.planBg || libPlan?.bg || null;
              const exported = ep.planAnnotations?.exported || bg;
              const annotCount = ep.planAnnotations?.paths?.length || 0;
              return (
                <div key={ep.id} style={{ display:'flex',alignItems:'stretch',marginBottom:8,border:`1px solid ${DA.border}`,borderRadius:10,overflow:'hidden',background:'white' }}>
                  <div onClick={() => setAnnotatingExtraIdx(idx)}
                    style={{ position:'relative',width:72,height:48,background:'#1a1a1a',flexShrink:0,cursor:'pointer' }}>
                    {exported && <img src={exported} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }}/>}
                    <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.35)' }}>
                      <Ic n="pen" s={13}/>
                    </div>
                  </div>
                  <div style={{ flex:1,minWidth:0,padding:'6px 10px',display:'flex',flexDirection:'column',justifyContent:'center' }}>
                    <p style={{ fontSize:12,fontWeight:600,color:DA.black,margin:'0 0 2px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                      {libPlan?.nom || 'Plan'}
                    </p>
                    {annotCount > 0
                      ? <span style={{ fontSize:10,color:DA.red,fontWeight:600 }}>{annotCount} annotation{annotCount>1?'s':''}</span>
                      : <span style={{ fontSize:10,color:DA.grayL }}>Non annoté · hors rapport</span>
                    }
                  </div>
                  <button onClick={() => setExtraPlans(prev => prev.filter((_,i) => i !== idx))}
                    style={{ padding:'0 12px',border:'none',borderLeft:`1px solid ${DA.border}`,background:'white',cursor:'pointer',color:'#B91C1C',display:'flex',alignItems:'center' }}>
                    <Ic n="del" s={14}/>
                  </button>
                </div>
              );
            })}
            {extraPlans.length === 0 && (
              <p style={{ fontSize:11,color:DA.grayL,margin:0 }}>Aucun — cliquez sur Ajouter pour joindre d'autres plans</p>
            )}
          </div>
        </div>

        <div style={{ padding:'12px 14px 20px',borderTop:`1px solid ${DA.border}`,flexShrink:0,display:'flex',gap:8 }}>
          {(planBg || planId) && (
            <button onClick={() => { setPlanId(null); setPlanBg(null); setPlanData(null); }}
              style={{ padding:'12px 16px',background:'white',color:DA.red,border:'1px solid #FCA5A5',borderRadius:12,fontSize:12,fontWeight:600,cursor:'pointer' }}>
              <Ic n="del" s={14}/>
            </button>
          )}
          <button onClick={async () => {
            let bg = planBg;
            let data = planData;
            if (planId && !bg) {
              const live = planLibrary?.find(p => p.id === planId);
              if (live?.bg) { bg = live.bg; data = live.data || null; }
              else {
                const fetched = await fetchPlanData(planId);
                if (fetched) { bg = fetched.bg; data = fetched.data; }
              }
            }
            onSave({ planId: planId||null, planBg: bg||null, planData: data||null, planAnnotations: annot||null, extraPlans });
            onClose();
          }}
            style={{ flex:1,background:(planBg||planId)?DA.red:DA.black,color:'white',border:'none',borderRadius:12,padding:12,fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
            <Ic n="chk" s={15}/> Terminer
          </button>
        </div>
      </div>
    </div>
  );
}
