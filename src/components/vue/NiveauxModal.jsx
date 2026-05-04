import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import EditTitle from '../ui/EditTitle.jsx';

// Modal de gestion des niveaux / zones avec assignation de plan
// Props:
//   localisations - tableau des zones du projet
//   planLibrary   - tableau des plans disponibles
//   onChange      - (newLocalisations) => void — appelé immédiatement à chaque action
//   onClose       - () => void

export default function NiveauxModal({ localisations, planLibrary, onChange, onClose, onOpenPlanLib }) {
  const [pickingForId, setPickingForId] = useState(null); // id de la zone dont on choisit le plan

  const addLoc = () => {
    const newLoc = { id: crypto.randomUUID(), nom: 'Nouveau niveau', items: [], planBg: null, planData: null, planAnnotations: null };
    onChange([...localisations, newLoc]);
    // Ouvrir directement le sélecteur de plan si on a des plans dispos
    if (planLibrary.length > 0) setPickingForId(newLoc.id);
  };

  const deleteLoc = (locId, nom) => {
    if (!window.confirm(`Supprimer le niveau "${nom}" et toutes ses observations ?`)) return;
    onChange(localisations.filter(l => l.id !== locId));
    if (pickingForId === locId) setPickingForId(null);
  };

  const renameLoc = (locId, nom) => {
    onChange(localisations.map(l => l.id === locId ? { ...l, nom } : l));
  };

  const assignPlan = (locId, plan) => {
    onChange(localisations.map(l =>
      l.id === locId
        ? { ...l, planBg: plan?.bg || null, planData: plan?.data || null, planAnnotations: null }
        : l
    ));
    setPickingForId(null);
  };

  const removePlan = (locId) => {
    onChange(localisations.map(l =>
      l.id === locId ? { ...l, planBg: null, planData: null, planAnnotations: null } : l
    ));
  };

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
          {localisations.length === 0 && (
            <div style={{ textAlign:'center',padding:'40px 0',color:DA.grayL }}>
              <Ic n="pin" s={40}/>
              <p style={{ fontSize:13,color:DA.gray,margin:'10px 0 0',fontWeight:600 }}>Aucun niveau créé</p>
              <p style={{ fontSize:11,color:DA.grayL,margin:'4px 0 0' }}>Appuyez sur le bouton en bas pour commencer</p>
            </div>
          )}

          <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
            {localisations.map(loc => {
              const isPicking = pickingForId === loc.id;
              const assignedPlan = planLibrary.find(p => p.bg === loc.planBg);

              return (
                <div key={loc.id} style={{ border:`1px solid ${loc.planBg ? DA.red : DA.border}`,borderRadius:12,overflow:'hidden',background:DA.white,transition:'border-color 0.15s' }}>

                  {/* En-tête de zone */}
                  <div style={{ display:'flex',alignItems:'center',padding:'10px 12px',gap:8,background:loc.planBg ? DA.redL : DA.white }}>
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
                    <button onClick={() => deleteLoc(loc.id, loc.nom)}
                      style={{ padding:6,color:'#ccc',background:'none',border:'none',cursor:'pointer',flexShrink:0,lineHeight:0 }}
                      onMouseEnter={e => e.currentTarget.style.color = DA.red}
                      onMouseLeave={e => e.currentTarget.style.color = '#ccc'}>
                      <Ic n="del" s={15}/>
                    </button>
                  </div>

                  {/* Zone plan */}
                  <div style={{ borderTop:`1px solid ${DA.border}`,padding:'10px 12px' }}>
                    {loc.planBg ? (
                      /* Plan assigné */
                      <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                        <img src={loc.planBg} alt=""
                          style={{ width:80,height:54,objectFit:'cover',borderRadius:7,border:`1px solid ${DA.border}`,flexShrink:0 }}/>
                        <div style={{ flex:1,minWidth:0 }}>
                          <p style={{ fontSize:12,fontWeight:600,color:DA.black,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                            {assignedPlan?.nom || 'Plan assigné'}
                          </p>
                          <div style={{ display:'flex',gap:8,marginTop:5,flexWrap:'wrap' }}>
                            <button onClick={() => setPickingForId(isPicking ? null : loc.id)}
                              style={{ fontSize:11,color:DA.red,background:'none',border:'none',cursor:'pointer',padding:0,fontWeight:600 }}>
                              {isPicking ? 'Annuler' : 'Changer'}
                            </button>
                            <span style={{ color:DA.grayL,fontSize:11 }}>·</span>
                            <button onClick={() => removePlan(loc.id)}
                              style={{ fontSize:11,color:DA.grayL,background:'none',border:'none',cursor:'pointer',padding:0 }}>
                              Retirer le plan
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Pas de plan — bouton pour en choisir un */
                      <button onClick={() => setPickingForId(isPicking ? null : loc.id)}
                        style={{ width:'100%',padding:'8px 12px',background:isPicking ? DA.redL : DA.grayXL,border:`1.5px dashed ${isPicking ? DA.red : DA.border}`,borderRadius:8,fontSize:12,color:isPicking ? DA.red : DA.gray,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6,transition:'all 0.15s' }}>
                        <Ic n="map" s={13}/>
                        {isPicking ? 'Annuler' : 'Choisir un plan'}
                      </button>
                    )}

                    {/* Sélecteur de plan inline */}
                    {isPicking && (
                      <div style={{ marginTop:10 }}>
                        {planLibrary.length === 0 ? (
                          <div style={{ background:'#FFFBEB',border:'1px solid #FCD34D',borderRadius:8,padding:'10px 12px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10 }}>
                            <span style={{ fontSize:12,color:'#92400E',lineHeight:1.4 }}>Bibliothèque vide</span>
                            {onOpenPlanLib && (
                              <button onClick={() => { onClose(); onOpenPlanLib(); }}
                                style={{ fontSize:12,fontWeight:700,color:'#92400E',background:'none',border:'1px solid #D97706',borderRadius:7,padding:'4px 10px',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0 }}>
                                Importer des plans
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
                            <p style={{ fontSize:10,fontWeight:700,color:DA.grayL,textTransform:'uppercase',letterSpacing:0.5,margin:'0 0 4px' }}>
                              Choisir dans la bibliothèque
                            </p>
                            {planLibrary.map(pl => {
                              const isSel = loc.planBg === pl.bg;
                              return (
                                <button key={pl.id}
                                  onClick={() => assignPlan(loc.id, isSel ? null : pl)}
                                  style={{ display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,border:`2px solid ${isSel ? DA.red : DA.border}`,background:isSel ? DA.redL : DA.white,cursor:'pointer',textAlign:'left',transition:'all 0.1s' }}>
                                  {pl.bg && (
                                    <img src={pl.bg} alt=""
                                      style={{ width:52,height:36,objectFit:'cover',borderRadius:5,border:`1px solid ${DA.border}`,flexShrink:0 }}/>
                                  )}
                                  <p style={{ flex:1,fontWeight:600,fontSize:12,color:isSel ? DA.red : DA.black,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                                    {pl.nom}
                                  </p>
                                  {isSel && <Ic n="chk" s={16}/>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
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
