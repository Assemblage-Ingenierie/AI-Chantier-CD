import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { renderPdfPage } from '../../lib/pdfUtils.js';
import { fetchPlanData } from '../../lib/storage.js';
import Annotator from './Annotator.jsx';
import PdfPagePicker from './PdfPagePicker.jsx';

export default function PlanLocModal({ loc, planLibrary, onClose, onSave, onDeletePlan, onRenamePlan, items, autoAnnot, annotIdx }) {
  // Unified plans list — first = primary (planId/planBg/planAnnotations), rest = extra
  const [plans, setPlans] = useState(() => {
    const result = [];
    if (loc.planId || loc.planBg) {
      result.push({ id: loc.planId || 'main', planId: loc.planId || null, planBg: loc.planBg || null, planData: loc.planData || null, planAnnotations: loc.planAnnotations || null });
    }
    for (const ep of (loc.extraPlans || [])) result.push(ep);
    return result;
  });
  const directAnnot = annotIdx != null; // opened from thumbnail click — jump straight to annotator
  const [annotatingIdx, setAnnotatingIdx] = useState(() => {
    if (annotIdx != null) return annotIdx;
    if (autoAnnot && (loc.planBg || loc.planId)) return 0;
    return null;
  });
  const [rendering, setRendering] = useState(false);
  const [renderErr, setRenderErr] = useState(null);
  const [pendingPdf, setPendingPdf] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingNom, setEditingNom] = useState('');
  const [confirmDelId, setConfirmDelId] = useState(null);

  const zonePhotos = (items || []).flatMap(it => (it.photos || []).filter(ph => ph.data));
  const selectedIds = new Set(plans.map(p => p.planId).filter(Boolean));

  const togglePlan = (pl) => {
    if (selectedIds.has(pl.id)) {
      setPlans(prev => prev.filter(p => p.planId !== pl.id));
    } else {
      setPlans(prev => [...prev, { id: crypto.randomUUID(), planId: pl.id, planBg: pl.bg || null, planData: pl.data || null, planAnnotations: null }]);
    }
  };

  const handleSave = async (plansArg) => {
    const src = plansArg || plans;
    const resolved = await Promise.all(src.map(async (p) => {
      if (p.planId && !p.planBg) {
        const live = planLibrary?.find(x => x.id === p.planId);
        if (live?.bg) return { ...p, planBg: live.bg, planData: live.data || null };
        const fetched = await fetchPlanData(p.planId);
        if (fetched) return { ...p, planBg: fetched.bg, planData: fetched.data };
      }
      return p;
    }));
    const [first, ...rest] = resolved;
    onSave({
      planId: first?.planId || null,
      planBg: first?.planBg || null,
      planData: first?.planData || null,
      planAnnotations: first?.planAnnotations || null,
      extraPlans: rest,
    });
    onClose();
  };

  if (annotatingIdx !== null) {
    const p = plans[annotatingIdx];
    const libNom = planLibrary?.find(x => x.id === p?.planId)?.nom;
    return (
      <Annotator
        bgImage={p?.planBg || null}
        savedPaths={p?.planAnnotations?.paths || []}
        photos={zonePhotos}
        exportSizeMultiplier={2}
        title={libNom ? `${loc.nom} — ${libNom}` : loc.nom}
        onSave={(paths, exported) => {
          const newPlans = plans.map((x, i) => i === annotatingIdx ? { ...x, planAnnotations: { paths, exported } } : x);
          setPlans(newPlans);
          if (directAnnot) {
            handleSave(newPlans); // auto-save & close when opened directly from thumbnail
          } else {
            setAnnotatingIdx(null);
          }
        }}
        onClose={() => directAnnot ? onClose() : setAnnotatingIdx(null)}
      />
    );
  }

  if (showPicker && pendingPdf) return (
    <PdfPagePicker pdfData={pendingPdf} onSelect={async pageNum => {
      setShowPicker(false); setRendering(true); setRenderErr(null);
      const img = await renderPdfPage(pendingPdf, pageNum);
      if (img) {
        setPlans(prev => {
          const idx = prev.findIndex(p => !p.planBg && p.planData === pendingPdf);
          if (idx >= 0) return prev.map((p, i) => i === idx ? { ...p, planBg: img } : p);
          return [...prev, { id: crypto.randomUUID(), planId: null, planBg: img, planData: pendingPdf, planAnnotations: null }];
        });
      } else setRenderErr('Impossible de rendre cette page.');
      setPendingPdf(null); setRendering(false);
    }} onClose={() => { setShowPicker(false); setPendingPdf(null); }}/>
  );

  return (
    <div className="modal-overlay">
      <div className="modal-sheet-flex">
        <div style={{ padding:'16px 18px 12px', borderBottom:`1px solid ${DA.border}`, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <p style={{ fontWeight:700, fontSize:14, color:DA.black, margin:0 }}>Plan — {loc.nom}</p>
              <p style={{ fontSize:11, color:DA.gray, margin:'3px 0 0' }}>
                {planLibrary?.length > 0
                  ? `${planLibrary.length} plan${planLibrary.length>1?'s':''} disponible${planLibrary.length>1?'s':''} · ${plans.length} sélectionné${plans.length>1?'s':''}`
                  : "Aucun plan dans la bibliothèque — importez d'abord via le bouton 📋 en haut"}
              </p>
            </div>
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL }}><Ic n="x" s={20}/></button>
          </div>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:14 }}>
          {renderErr && <div style={{ background:'#FFF0F0', border:'1px solid #FCA5A5', borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12, color:'#B91C1C' }}>⚠️ {renderErr}</div>}
          {rendering && (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'16px 0', color:DA.gray, justifyContent:'center' }}>
              <Ic n="spn" s={20}/><span>Rendu en cours…</span>
            </div>
          )}

          {planLibrary?.length === 0 && (
            <div style={{ background:'#FFFBEB', border:'1px solid #FCD34D', borderRadius:10, padding:'12px 14px', marginBottom:14 }}>
              <p style={{ fontSize:12, fontWeight:600, color:'#92400E', margin:'0 0 4px' }}>📋 Bibliothèque vide</p>
              <p style={{ fontSize:11, color:'#92400E', margin:0 }}>Appuyez sur le bouton <strong>📋</strong> en haut à droite du projet pour importer vos plans une fois.</p>
            </div>
          )}

          {planLibrary?.length > 0 && (
            <div style={{ marginBottom:8 }}>
              <p style={{ fontSize:11, fontWeight:700, color:DA.gray, textTransform:'uppercase', letterSpacing:0.5, margin:'0 0 10px', display:'flex', alignItems:'center', gap:6 }}>
                <Ic n="lib" s={12}/> Bibliothèque — sélectionnez un ou plusieurs plans
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {planLibrary.map(pl => {
                  const sel = selectedIds.has(pl.id);
                  const selIdx = plans.findIndex(p => p.planId === pl.id);
                  const annot = selIdx >= 0 ? plans[selIdx].planAnnotations : null;
                  const annotCount = annot?.paths?.length || 0;
                  return (
                    <div key={pl.id} style={{ display:'flex', alignItems:'center', gap:8, borderRadius:12, border:`2.5px solid ${sel ? DA.red : DA.border}`, background: sel ? DA.redL : 'white', transition:'all 0.15s', overflow:'hidden' }}>
                      {/* Clic zone = toggle sélection */}
                      <button onClick={() => togglePlan(pl)}
                        style={{ flex:1, display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'none', border:'none', cursor:'pointer', textAlign:'left', minWidth:0 }}>
                        {pl.bg
                          ? <img src={annot?.exported || pl.bg} alt="" style={{ width:58, height:40, objectFit:'cover', borderRadius:6, border:`1px solid ${DA.border}`, flexShrink:0 }}/>
                          : <div style={{ width:58, height:40, borderRadius:6, background:DA.grayXL, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}><Ic n="map" s={16}/></div>
                        }
                        <div style={{ flex:1, minWidth:0 }}>
                          {editingId === pl.id ? (
                            <input autoFocus value={editingNom}
                              onChange={e => setEditingNom(e.target.value)}
                              onClick={e => e.stopPropagation()}
                              onBlur={() => { if (editingNom.trim() && onRenamePlan) onRenamePlan(pl.id, editingNom.trim()); setEditingId(null); }}
                              onKeyDown={e => { e.stopPropagation(); if (e.key==='Enter') { if (editingNom.trim() && onRenamePlan) onRenamePlan(pl.id, editingNom.trim()); setEditingId(null); } if (e.key==='Escape') setEditingId(null); }}
                              style={{ width:'100%', fontSize:13, fontWeight:700, border:`1px solid ${DA.red}`, borderRadius:5, padding:'2px 6px', outline:'none', boxSizing:'border-box' }}/>
                          ) : (
                            <p style={{ fontWeight:700, fontSize:13, color: sel ? DA.red : DA.black, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pl.nom}</p>
                          )}
                          {sel && annotCount > 0
                            ? <p style={{ fontSize:10, color:DA.red, fontWeight:600, margin:'2px 0 0' }}>{annotCount} annotation{annotCount>1?'s':''}</p>
                            : <p style={{ fontSize:10, color:DA.grayL, margin:'2px 0 0' }}>{pl.data ? 'PDF' : 'Image'}{sel ? ' · non annoté' : ''}</p>
                          }
                        </div>
                        {sel && <div style={{ color:DA.red, flexShrink:0 }}><Ic n="chk" s={18}/></div>}
                      </button>

                      {/* Annoter — visible seulement si sélectionné */}
                      {sel && (
                        <button onClick={e => { e.stopPropagation(); setAnnotatingIdx(selIdx); }}
                          style={{ padding:'8px 10px', background: annotCount > 0 ? DA.red : DA.black, color:'white', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', alignSelf:'stretch' }}>
                          <Ic n="pen" s={14}/>
                        </button>
                      )}

                      {/* Renommer / supprimer */}
                      <div style={{ display:'flex', gap:2, paddingRight: sel ? 0 : 8, flexShrink:0 }} onClick={e => e.stopPropagation()}>
                        {!sel && onRenamePlan && (
                          <button onClick={() => { setEditingId(pl.id); setEditingNom(pl.nom); setConfirmDelId(null); }}
                            style={{ padding:'5px 7px', color:'#ccc', background:'none', border:'none', cursor:'pointer', borderRadius:6 }}
                            onMouseEnter={e => e.currentTarget.style.color=DA.black} onMouseLeave={e => e.currentTarget.style.color='#ccc'}>
                            <Ic n="pen" s={13}/>
                          </button>
                        )}
                        {!sel && onDeletePlan && (confirmDelId === pl.id ? (
                          <>
                            <button onClick={() => { onDeletePlan(pl.id); setConfirmDelId(null); }}
                              style={{ padding:'4px 8px', background:'#B91C1C', color:'white', border:'none', borderRadius:5, fontSize:11, fontWeight:700, cursor:'pointer' }}>Oui</button>
                            <button onClick={() => setConfirmDelId(null)}
                              style={{ padding:'4px 6px', background:'white', color:'#555', border:'1px solid #E5E5E5', borderRadius:5, fontSize:11, cursor:'pointer' }}>Non</button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDelId(pl.id)}
                            style={{ padding:'5px 7px', color:'#ccc', background:'none', border:'none', cursor:'pointer', borderRadius:6 }}
                            onMouseEnter={e => e.currentTarget.style.color=DA.red} onMouseLeave={e => e.currentTarget.style.color='#ccc'}>
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
        </div>

        <div style={{ padding:'12px 14px 20px', borderTop:`1px solid ${DA.border}`, flexShrink:0, display:'flex', gap:8 }}>
          {plans.length > 0 && (
            <button onClick={() => setPlans([])}
              style={{ padding:'12px 16px', background:'white', color:DA.red, border:'1px solid #FCA5A5', borderRadius:12, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              <Ic n="del" s={14}/>
            </button>
          )}
          <button onClick={() => handleSave()}
            style={{ flex:1, background: plans.length > 0 ? DA.red : DA.black, color:'white', border:'none', borderRadius:12, padding:12, fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
            <Ic n="chk" s={15}/> Terminer
          </button>
        </div>
      </div>
    </div>
  );
}
