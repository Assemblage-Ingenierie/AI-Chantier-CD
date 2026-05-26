import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import EditTitle from '../ui/EditTitle.jsx';

export default function NiveauxModal({ localisations, planLibrary, onChange, onClose, onOpenPlanLib, onPickPlan, onDeletePlan, onDeleteAllPlans, onRenamePlan }) {
  const [confirmDelPlanId, setConfirmDelPlanId] = useState(null);
  const [confirmDelAll, setConfirmDelAll] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [editingPlanNom, setEditingPlanNom] = useState('');
  const [previewBg, setPreviewBg] = useState(null);

  const addLoc = () => {
    const newLoc = { id: crypto.randomUUID(), nom: 'Nouveau niveau', items: [], planId: null, planBg: null, planData: null, planAnnotations: null, extraPlans: [] };
    onChange([...localisations, newLoc]);
    if (planLibrary.length > 0 && onPickPlan) onPickPlan(newLoc.id);
  };

  const renameLoc = (locId, nom) => {
    onChange(localisations.map(l => l.id === locId ? { ...l, nom } : l));
  };

  const removePlan = (locId) => {
    onChange(localisations.map(l =>
      l.id === locId ? { ...l, planId: null, planBg: null, planData: null, extraPlans: [], _planDirty: true } : l
    ));
  };

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
        <div style={{ padding:'16px 18px 12px',borderBottom:`1px solid ${DA.border}`,flexShrink:0 }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between' }}>
            <div style={{ display:'flex',alignItems:'center',gap:8 }}>
              <Ic n="bld" s={18}/>
              <p style={{ fontWeight:800,fontSize:15,color:DA.black,margin:0 }}>Gérer les niveaux</p>
            </div>
            <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL }}>
              <Ic n="x" s={20}/>
            </button>
          </div>
          <p style={{ fontSize:12,color:DA.gray,margin:'4px 0 0' }}>
            {localisations.length} niveau{localisations.length !== 1 ? 'x' : ''} — associez un plan à chaque zone
          </p>
        </div>

        {/* Liste des niveaux */}
        <div style={{ flex:1,overflowY:'auto',padding:'12px 14px' }}>
          {/* Section bibliothèque */}
          <div style={{ marginBottom:16 }}>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
              <p style={{ fontSize:11,fontWeight:700,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,margin:0 }}>
                Plans importés ({planLibrary.length})
              </p>
              <div style={{ display:'flex',gap:6,alignItems:'center' }}>
                {onDeletePlan && planLibrary.length > 0 && (confirmDelAll ? (
                  <>
                    <button onClick={() => { if (onDeleteAllPlans) onDeleteAllPlans(); else planLibrary.forEach(pl => onDeletePlan(pl.id)); setConfirmDelAll(false); }}
                      style={{ fontSize:11,fontWeight:700,padding:'4px 9px',background:'#B91C1C',color:'white',border:'none',borderRadius:7,cursor:'pointer' }}>
                      Tout supprimer
                    </button>
                    <button onClick={() => setConfirmDelAll(false)}
                      style={{ fontSize:11,padding:'4px 8px',background:'white',color:'#555',border:`1px solid ${DA.border}`,borderRadius:7,cursor:'pointer' }}>
                      Non
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDelAll(true)}
                    style={{ fontSize:11,color:'#ccc',background:'none',border:`1px solid #E5E5E5`,borderRadius:7,padding:'4px 8px',cursor:'pointer',display:'flex',alignItems:'center',gap:4 }}
                    onMouseEnter={e=>e.currentTarget.style.color=DA.red} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
                    <Ic n="del" s={11}/> Tout supprimer
                  </button>
                ))}
                {onOpenPlanLib && (
                  <button onClick={() => { onClose(); onOpenPlanLib(); }}
                    style={{ fontSize:13,fontWeight:800,color:'white',background:DA.red,border:'none',borderRadius:9,padding:'8px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:6,boxShadow:'0 2px 8px rgba(227,5,19,0.3)' }}>
                    <Ic n="plus" s={13}/> Importer
                  </button>
                )}
              </div>
            </div>
            {planLibrary.length === 0 ? (
              <div style={{ background:'#FFFBEB',border:'1px solid #FCD34D',borderRadius:10,padding:'12px 14px',display:'flex',alignItems:'center',gap:10 }}>
                <Ic n="map" s={18}/>
                <p style={{ fontSize:12,color:'#92400E',margin:0,flex:1 }}>Aucun plan — appuyez sur <strong>+ Importer</strong> pour commencer.</p>
              </div>
            ) : (
              <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
                {planLibrary.map(pl => (
                  <div key={pl.id} style={{ display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderRadius:8,border:`1px solid ${DA.border}`,background:DA.white }}>
                    {pl.bg && <img src={pl.bg} alt="" onClick={() => setPreviewBg(pl.bg)} style={{ width:44,height:30,objectFit:'cover',borderRadius:5,border:`1px solid ${DA.border}`,flexShrink:0,cursor:'zoom-in' }}/>}
                    {editingPlanId === pl.id ? (
                      <input autoFocus value={editingPlanNom}
                        onChange={e => setEditingPlanNom(e.target.value)}
                        onBlur={() => { if (editingPlanNom.trim() && onRenamePlan) onRenamePlan(pl.id, editingPlanNom.trim()); setEditingPlanId(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') { if (editingPlanNom.trim() && onRenamePlan) onRenamePlan(pl.id, editingPlanNom.trim()); setEditingPlanId(null); } if (e.key === 'Escape') setEditingPlanId(null); }}
                        style={{ flex:1,fontSize:12,fontWeight:600,border:`1px solid ${DA.red}`,borderRadius:5,padding:'2px 6px',outline:'none',boxSizing:'border-box' }}/>
                    ) : (
                      <p onClick={() => { if (onRenamePlan) { setEditingPlanId(pl.id); setEditingPlanNom(pl.nom); } }}
                        style={{ flex:1,fontSize:12,fontWeight:600,color:DA.black,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:onRenamePlan?'text':'default' }}>{pl.nom}</p>
                    )}
                    {onDeletePlan && (confirmDelPlanId === pl.id ? (
                      <>
                        <button onClick={() => { onDeletePlan(pl.id); setConfirmDelPlanId(null); }}
                          style={{ fontSize:11,fontWeight:700,padding:'3px 8px',background:'#B91C1C',color:'white',border:'none',borderRadius:5,cursor:'pointer' }}>Supprimer</button>
                        <button onClick={() => setConfirmDelPlanId(null)}
                          style={{ fontSize:11,padding:'3px 7px',background:'white',color:'#555',border:`1px solid ${DA.border}`,borderRadius:5,cursor:'pointer' }}>Non</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDelPlanId(pl.id)}
                        style={{ padding:'4px 6px',color:'#ccc',background:'none',border:'none',cursor:'pointer',borderRadius:5,lineHeight:0 }}
                        onMouseEnter={e=>e.currentTarget.style.color=DA.red} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
                        <Ic n="del" s={13}/>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          {localisations.length === 0 && (
            <div style={{ textAlign:'center',padding:'40px 0',color:DA.grayL }}>
              <Ic n="pin" s={40}/>
              <p style={{ fontSize:13,color:DA.gray,margin:'10px 0 0',fontWeight:600 }}>Aucun niveau créé</p>
              <p style={{ fontSize:11,color:DA.grayL,margin:'4px 0 0' }}>Appuyez sur le bouton en bas pour commencer</p>
            </div>
          )}

          <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
            {localisations.map(loc => {
              const assignedPlan = planLibrary.find(p => p.id === loc.planId);
              const hasPlan = !!(loc.planId || loc.planBg || (loc.extraPlans || []).length > 0);
              const thumbSrc = loc.planBg || assignedPlan?.bg || null;
              const totalPlans = (loc.planId || loc.planBg ? 1 : 0) + (loc.extraPlans || []).length;

              return (
                <div key={loc.id} style={{ border:`1px solid ${hasPlan ? DA.red : DA.border}`,borderRadius:12,overflow:'hidden',background:DA.white,transition:'border-color 0.15s' }}>

                  {/* En-tête de zone */}
                  <div style={{ display:'flex',alignItems:'center',padding:'10px 12px',gap:8,background:hasPlan ? DA.redL : DA.white }}>
                    <div style={{ flex:1,minWidth:0 }}>
                      <EditTitle
                        value={loc.nom}
                        onSave={nom => renameLoc(loc.id, nom)}
                        style={{ fontSize:14,fontWeight:700,color:DA.black }}
                        inputStyle={{ fontSize:14,fontWeight:700 }}
                      />
                    </div>
                    <span style={{ fontSize:11,color:DA.grayL,flexShrink:0 }}>
                      {(loc.items || []).length} obs.
                    </span>
                  </div>

                  {/* Zone plan */}
                  <div style={{ borderTop:`1px solid ${DA.border}`,padding:'10px 12px' }}>
                    {hasPlan ? (
                      <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                        {thumbSrc ? (
                          <img src={thumbSrc} alt=""
                            onClick={() => setPreviewBg(thumbSrc)}
                            style={{ width:80,height:54,objectFit:'cover',borderRadius:7,border:`1px solid ${DA.border}`,flexShrink:0,cursor:'zoom-in' }}/>
                        ) : (
                          <div style={{ width:80,height:54,borderRadius:7,border:`1px solid ${DA.border}`,flexShrink:0,background:DA.grayXL,display:'flex',alignItems:'center',justifyContent:'center' }}>
                            <Ic n="map" s={22}/>
                          </div>
                        )}
                        <div style={{ flex:1,minWidth:0 }}>
                          <p style={{ fontSize:12,fontWeight:600,color:DA.black,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                            {assignedPlan?.nom || 'Plan assigné'}
                            {totalPlans > 1 && <span style={{ fontSize:11,color:DA.red,fontWeight:700,marginLeft:6 }}>+{totalPlans - 1} plan{totalPlans > 2 ? 's' : ''}</span>}
                          </p>
                          <div style={{ display:'flex',gap:8,marginTop:5,flexWrap:'wrap' }}>
                            <button onClick={() => onPickPlan ? onPickPlan(loc.id) : null}
                              style={{ fontSize:11,color:DA.red,background:'none',border:'none',cursor:'pointer',padding:0,fontWeight:600 }}>
                              Changer
                            </button>
                            <span style={{ color:DA.grayL,fontSize:11 }}>·</span>
                            <button onClick={() => removePlan(loc.id)}
                              style={{ fontSize:11,color:DA.grayL,background:'none',border:'none',cursor:'pointer',padding:0 }}>
                              Retirer
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (planLibrary.length === 0 && onOpenPlanLib) { onClose(); onOpenPlanLib(); return; }
                          if (onPickPlan) onPickPlan(loc.id);
                        }}
                        style={{ width:'100%',padding:'8px 12px',background:DA.grayXL,border:`1.5px dashed ${DA.border}`,borderRadius:8,fontSize:12,color:DA.gray,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
                        <Ic n="map" s={13}/>
                        {planLibrary.length === 0 ? 'Importer un plan' : 'Choisir un ou plusieurs plans'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button onClick={addLoc}
            style={{ width:'100%',marginTop:8,padding:'13px 0',background:DA.white,border:`1.5px solid ${DA.red}`,borderRadius:12,fontSize:14,fontWeight:700,color:DA.red,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
            <Ic n="plus" s={15}/> Ajouter un niveau
          </button>
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 14px 20px',borderTop:`1px solid ${DA.border}`,flexShrink:0 }}>
          <button onClick={onClose}
            style={{ width:'100%',background:DA.red,color:'white',border:'none',borderRadius:12,padding:14,fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
            <Ic n="chk" s={15}/> Terminer
          </button>
        </div>
      </div>
    </div>
  );
}
