import React, { useState, useCallback } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import EditTitle from '../ui/EditTitle.jsx';
import SortList from '../vue/SortList.jsx';
import ItemModal from '../vue/ItemModal.jsx';
import RapportTab from '../vue/RapportTab.jsx';
import PlanLibraryModal from '../vue/PlanLibraryModal.jsx';
import PlanLocModal from '../vue/PlanLocModal.jsx';
import NiveauxModal from '../vue/NiveauxModal.jsx';
import Annotator from '../vue/Annotator.jsx';

export default function VueProjet({ projet, onBack, onUpdate }) {
  const [tab, setTab] = useState('visite');
  const [openLocIds, setOpenLocIds] = useState(() => new Set(projet.localisations.map(l => l.id)));
  // modal: null
  //      | { t:'item',    locId, item, savedForm? }
  //      | { t:'plan',    locId }
  //      | { t:'planLib' }
  //      | { t:'niveaux' }
  //      | { t:'annotate', locId, form }
  const [modal, setModal] = useState(null);

  // --- Helpers de mutation ---
  const patchLoc = useCallback((locId, patch) => {
    const locs = projet.localisations.map(l => l.id === locId ? { ...l, ...patch } : l);
    onUpdate({ localisations: locs });
  }, [projet.localisations, onUpdate]);

  const patchItem = useCallback((locId, item) => {
    const locs = projet.localisations.map(l => {
      if (l.id !== locId) return l;
      const items = (l.items || []).find(i => i.id === item.id)
        ? (l.items || []).map(i => i.id === item.id ? item : i)
        : [...(l.items || []), item];
      return { ...l, items };
    });
    onUpdate({ localisations: locs });
  }, [projet.localisations, onUpdate]);

  const deleteItem = useCallback((locId, itemId) => {
    const locs = projet.localisations.map(l =>
      l.id !== locId ? l : { ...l, items: (l.items || []).filter(i => i.id !== itemId) }
    );
    onUpdate({ localisations: locs });
  }, [projet.localisations, onUpdate]);

  const addLoc = () => {
    const newLoc = { id: crypto.randomUUID(), nom: 'Nouvelle zone', items: [], planBg: null, planData: null, planAnnotations: null };
    onUpdate({ localisations: [...projet.localisations, newLoc] });
    setOpenLocIds(prev => new Set([...prev, newLoc.id]));
  };

  const deleteLoc = (locId, nom) => {
    if (!window.confirm(`Supprimer la zone "${nom}" et toutes ses observations ?`)) return;
    onUpdate({ localisations: projet.localisations.filter(l => l.id !== locId) });
  };

  const toggleLoc = (locId) => {
    setOpenLocIds(prev => {
      const next = new Set(prev);
      next.has(locId) ? next.delete(locId) : next.add(locId);
      return next;
    });
  };

  const saveItem = (locId, form) => {
    if (form._quickSuivi) { patchItem(locId, form); return; }
    patchItem(locId, { ...form, id: form.id || crypto.randomUUID() });
  };

  // --- Annotator plein écran (masque tout le reste) ---
  if (modal?.t === 'annotate') {
    const loc = projet.localisations.find(l => l.id === modal.locId);
    return (
      <Annotator
        bgImage={loc?.planBg}
        savedPaths={modal.form.planAnnotations?.paths || []}
        onSave={(paths, exported) => {
          setModal({ t: 'item', locId: modal.locId, item: modal.form, savedForm: { ...modal.form, planAnnotations: { paths, exported } } });
        }}
        onClose={() => setModal({ t: 'item', locId: modal.locId, item: modal.form, savedForm: modal.form })}
      />
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:DA.grayXL }}>

      {/* ── Header projet ── */}
      <div style={{ background:DA.black, padding:'10px 14px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={onBack}
            style={{ color:'rgba(255,255,255,0.7)', background:'rgba(255,255,255,0.08)', border:'none', borderRadius:6, padding:'5px 8px', display:'flex', alignItems:'center', gap:3, cursor:'pointer', flexShrink:0 }}>
            <span style={{ display:'inline-block', transform:'rotate(90deg)', lineHeight:0 }}><Ic n="chv" s={13}/></span>
            <span style={{ fontSize:11, fontWeight:600 }}>Projets</span>
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontWeight:800, fontSize:14, color:'white', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.nom}</p>
            {projet.adresse && <p style={{ fontSize:10, color:'rgba(255,255,255,0.45)', margin:'2px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.adresse}</p>}
          </div>
          <div style={{ display:'flex',gap:6,flexShrink:0 }}>
            <button onClick={() => setModal({ t:'niveaux' })}
              style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, padding:'5px 10px', color:'rgba(255,255,255,0.7)', fontSize:11, fontWeight:600, display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
              <Ic n="bld" s={13}/> Niveaux
            </button>
            <button onClick={() => setModal({ t:'planLib' })}
              style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, padding:'5px 10px', color:'rgba(255,255,255,0.7)', fontSize:11, fontWeight:600, display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
              <Ic n="lib" s={13}/> Plans
            </button>
          </div>
        </div>

        {/* Tabs */}
        {(() => {
          const totalItems = projet.localisations.flatMap(l => l.items || []).length;
          return (
            <div style={{ display:'flex', borderTop:'1px solid rgba(255,255,255,0.08)', marginTop:10 }}>
              {[
                { k:'visite',  n:'bld', l:'Visite' },
                { k:'rapport', n:'fil', l: `Rapport${totalItems > 0 ? ` (${totalItems})` : ''}` },
              ].map(t => (
                <button key={t.k} onClick={() => setTab(t.k)}
                  style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'10px 0', fontSize:12, fontWeight:700, border:'none', borderBottom:`2.5px solid ${tab===t.k ? DA.red : 'transparent'}`, background:'transparent', color:tab===t.k ? DA.red : 'rgba(255,255,255,0.45)', cursor:'pointer', transition:'all 0.15s' }}>
                  <Ic n={t.n} s={13}/>{t.l}
                </button>
              ))}
            </div>
          );
        })()}
      </div>

      {/* ── Corps scrollable ── */}
      <div style={{ flex:1, overflowY:'auto' }}>
      <div>

        {/* ════ TAB VISITE ════ */}
        {tab === 'visite' && (
          <div>
            {/* Bannière résumé + raccourci rapport */}
            {(() => {
              const total = projet.localisations.flatMap(l => l.items || []).length;
              const urgs  = projet.localisations.flatMap(l => l.items || []).filter(i => i.urgence === 'haute').length;
              if (!total) return null;
              return (
                <div style={{ padding:'8px 14px', background: urgs > 0 ? '#FFF0F0' : DA.grayXL, borderBottom:`1px solid ${urgs > 0 ? '#FCA5A5' : DA.border}`, display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:11, color: urgs > 0 ? DA.red : DA.gray, fontWeight:700 }}>{total} obs.</span>
                  {urgs > 0 && <span style={{ fontSize:11, color:DA.red, fontWeight:700 }}>· {urgs} urgente{urgs > 1 ? 's' : ''} ⚠️</span>}
                  <button onClick={() => setTab('rapport')}
                    style={{ marginLeft:'auto', fontSize:11, color:DA.red, fontWeight:700, background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:3 }}>
                    Voir rapport <Ic n="chv" s={10}/>
                  </button>
                </div>
              );
            })()}
            {projet.localisations.length === 0 ? (
              <div style={{ padding:'48px 24px', textAlign:'center' }}>
                <div style={{ width:48, height:48, borderRadius:12, background:DA.redL, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', color:DA.red }}>
                  <Ic n="pin" s={24}/>
                </div>
                <p style={{ fontWeight:700, fontSize:15, color:DA.black, margin:'0 0 6px' }}>Aucune zone</p>
                <p style={{ color:DA.gray, fontSize:12, margin:'0 0 20px' }}>Créez des zones pour organiser vos observations par localisation.</p>
                <button onClick={addLoc}
                  style={{ background:DA.red, color:'white', border:'none', borderRadius:12, padding:'11px 28px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                  + Ajouter une zone
                </button>
              </div>
            ) : (
              <>
                {projet.localisations.map(loc => {
                  const isOpen = openLocIds.has(loc.id);
                  const items = loc.items || [];
                  const urgentCount = items.filter(i => i.urgence === 'haute').length;

                  return (
                    <div key={loc.id} style={{ background:DA.white, borderBottom:`1px solid ${DA.border}` }}>
                      {/* En-tête zone */}
                      <div style={{ display:'flex', alignItems:'center', padding:'10px 12px', gap:8 }}>
                        <button onClick={() => toggleLoc(loc.id)}
                          style={{ color:DA.grayL, background:'none', border:'none', cursor:'pointer', flexShrink:0, padding:4, display:'flex', alignItems:'center', transition:'transform 0.15s', transform:isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
                          <Ic n="chv" s={14}/>
                        </button>

                        <EditTitle
                          value={loc.nom}
                          onSave={nom => patchLoc(loc.id, { nom })}
                          onDelete={() => deleteLoc(loc.id, loc.nom)}
                          style={{ fontSize:14, fontWeight:700, color:DA.black }}
                          inputStyle={{ fontSize:14, fontWeight:700 }}
                        />

                        {/* Badges et boutons à droite */}
                        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                          {urgentCount > 0 && (
                            <span style={{ fontSize:10, fontWeight:700, background:'#FFF0F0', color:DA.red, border:`1px solid #FCA5A5`, borderRadius:10, padding:'1px 7px', lineHeight:1.6 }}>
                              {urgentCount} ⚠
                            </span>
                          )}
                          <span style={{ fontSize:11, color:DA.grayL, minWidth:12, textAlign:'center' }}>{items.length}</span>
                          <button onClick={() => setModal({ t:'plan', locId:loc.id })}
                            style={{ padding:'5px 7px', border:`1px solid ${loc.planBg ? DA.red : DA.border}`, background:loc.planBg ? DA.redL : 'white', borderRadius:7, cursor:'pointer', display:'flex', alignItems:'center', color:loc.planBg ? DA.red : DA.grayL }}>
                            <Ic n="map" s={13}/>
                          </button>
                        </div>
                      </div>

                      {/* Liste observations */}
                      {isOpen && (
                        <div style={{ borderTop:`1px solid ${DA.border}` }}>
                          <SortList
                            items={items}
                            onReorder={ordered => patchLoc(loc.id, { items: ordered })}
                            onEdit={item => {
                              if (item?._quickSuivi) { saveItem(loc.id, item); return; }
                              setModal({ t:'item', locId:loc.id, item });
                            }}
                            onDelete={itemId => deleteItem(loc.id, itemId)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

                <button onClick={addLoc}
                  style={{ width:'100%', padding:14, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize:13, fontWeight:600, color:DA.red, background:DA.white, border:'none', borderTop:`1px solid ${DA.border}`, cursor:'pointer' }}>
                  <Ic n="plus" s={14}/> Ajouter une zone
                </button>
              </>
            )}
          </div>
        )}

        {/* ════ TAB RAPPORT ════ */}
        {tab === 'rapport' && (
          <RapportTab projet={projet} onUpdate={onUpdate} />
        )}
      </div>
      </div>

      {/* ── Modals ── */}

      {modal?.t === 'item' && (() => {
        const loc = projet.localisations.find(l => l.id === modal.locId);
        const initItem = modal.savedForm ?? modal.item;
        return (
          <ItemModal
            key={modal.savedForm ? 'annotated' : 'normal'}
            item={initItem}
            planBg={loc?.planBg ?? null}
            planAnnotations={initItem?.planAnnotations ?? null}
            onClose={() => setModal(null)}
            onSave={form => {
              saveItem(modal.locId, { ...form, id: form.id || crypto.randomUUID() });
              setModal(null);
            }}
            onOpenAnnot={form => setModal({ t:'annotate', locId:modal.locId, form })}
          />
        );
      })()}

      {modal?.t === 'plan' && (() => {
        const loc = projet.localisations.find(l => l.id === modal.locId);
        return (
          <PlanLocModal
            loc={loc}
            planLibrary={projet.planLibrary || []}
            onClose={() => setModal(null)}
            onSave={({ planBg, planData, planAnnotations }) => {
              patchLoc(modal.locId, { planBg, planData, planAnnotations });
              setModal(null);
            }}
            onDeletePlan={id => onUpdate({ planLibrary: (projet.planLibrary || []).filter(p => p.id !== id) })}
            onRenamePlan={(id, nom) => onUpdate({ planLibrary: (projet.planLibrary || []).map(p => p.id === id ? { ...p, nom } : p) })}
          />
        );
      })()}

      {modal?.t === 'planLib' && (
        <PlanLibraryModal
          planLibrary={projet.planLibrary || []}
          onAdd={plans => onUpdate({ planLibrary: [...(projet.planLibrary || []), ...(Array.isArray(plans) ? plans : [plans])] })}
          onDelete={id => onUpdate({ planLibrary: (projet.planLibrary || []).filter(p => p.id !== id) })}
          onRename={(id, nom) => onUpdate({ planLibrary: (projet.planLibrary || []).map(p => p.id === id ? { ...p, nom } : p) })}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.t === 'niveaux' && (
        <NiveauxModal
          localisations={projet.localisations}
          planLibrary={projet.planLibrary || []}
          onChange={newLocs => onUpdate({ localisations: newLocs })}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
