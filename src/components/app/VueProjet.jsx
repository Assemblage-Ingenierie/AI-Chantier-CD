import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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

// Champs qui appartiennent à une visite (pas au projet)
const VISIT_FIELDS = new Set([
  'localisations','dateVisite','participants','tableauRecap',
  'photosParLigne','plansEnFin','rapportPageBreaks','includeTableauRecap',
  'includeConclusion','conclusion',
]);

export default function VueProjet({ projet, onBack, onUpdate }) {
  const visites = projet.visites || [];
  const [selectedVisiteId, setSelectedVisiteId] = useState(() => visites[0]?.id ?? null);
  const [tab, setTab] = useState('visite');
  const [modal, setModal] = useState(null);
  const [editingVisiteLabel, setEditingVisiteLabel] = useState(null);
  const [visitLabelVal, setVisitLabelVal] = useState('');

  // Si le projet change (chargement async), synchro la visite sélectionnée
  useEffect(() => {
    if (!selectedVisiteId && visites.length > 0) setSelectedVisiteId(visites[0].id);
  }, [visites]);

  const selectedVisite = useMemo(
    () => visites.find(v => v.id === selectedVisiteId) ?? visites[0] ?? null,
    [visites, selectedVisiteId]
  );

  // Objet "projet fusionné" passé aux enfants — ils ne voient pas la structure visites
  const visitProjet = useMemo(() => ({
    ...projet,
    localisations:       selectedVisite?.localisations       ?? [],
    dateVisite:          selectedVisite?.dateVisite           ?? null,
    participants:        selectedVisite?.participants         ?? [],
    tableauRecap:        selectedVisite?.tableauRecap         ?? [],
    photosParLigne:      selectedVisite?.photosParLigne       ?? 2,
    plansEnFin:          selectedVisite?.plansEnFin           ?? false,
    rapportPageBreaks:   selectedVisite?.rapportPageBreaks    ?? [],
    includeTableauRecap: selectedVisite?.includeTableauRecap  !== false,
    includeConclusion:   selectedVisite?.includeConclusion    ?? false,
    conclusion:          selectedVisite?.conclusion           ?? '',
  }), [projet, selectedVisite]);

  // Route les mises à jour : champs visite → visites[], champs projet → projet
  const onUpdateVisit = useCallback((upd) => {
    const visitUpd   = {};
    const projectUpd = {};
    for (const [k, v] of Object.entries(upd)) {
      if (VISIT_FIELDS.has(k)) visitUpd[k] = v;
      else projectUpd[k] = v;
    }
    if (Object.keys(visitUpd).length > 0) {
      const newVisites = (projet.visites || []).map(v =>
        v.id === selectedVisiteId ? { ...v, ...visitUpd } : v
      );
      onUpdate({ ...projectUpd, visites: newVisites });
    } else {
      onUpdate(projectUpd);
    }
  }, [projet.visites, selectedVisiteId, onUpdate]);

  const deleteVisite = (visiteId) => {
    const v = visites.find(v => v.id === visiteId);
    const obsCount = (v?.localisations || []).flatMap(l => l.items || []).length;
    const msg = obsCount > 0
      ? `Supprimer "${v?.label || 'cette visite'}" et ses ${obsCount} observation${obsCount > 1 ? 's' : ''} ?`
      : `Supprimer "${v?.label || 'cette visite'}" ?`;
    if (!window.confirm(msg)) return;
    const newVisites = visites.filter(vv => vv.id !== visiteId);
    onUpdate({ visites: newVisites });
    if (selectedVisiteId === visiteId) setSelectedVisiteId(newVisites[0]?.id ?? null);
  };

  const addVisite = () => {
    const newId = crypto.randomUUID();
    const n     = visites.length + 1;
    const today = new Date().toISOString().slice(0, 10);
    const newVisite = {
      id: newId, label: `Visite ${n}`,
      dateVisite: today, participants: [], tableauRecap: [],
      photosParLigne: 2, plansEnFin: false, rapportPageBreaks: [],
      includeTableauRecap: true, includeConclusion: false, conclusion: '',
      localisations: [],
    };
    onUpdate({ visites: [...visites, newVisite] });
    setSelectedVisiteId(newId);
    setTab('visite');
  };

  const updateVisite = (visiteId, patch) => {
    const newVisites = visites.map(v => v.id === visiteId ? { ...v, ...patch } : v);
    onUpdate({ visites: newVisites });
  };

  // --- Réordonnancement zones par drag -----------------------------------------------
  const [zoneDragIdx, setZoneDragIdx] = useState(null);
  const [zoneOverIdx, setZoneOverIdx] = useState(null);
  const zoneDragDidMove = useRef(false);

  const moveZone = useCallback((fromIdx, toIdx) => {
    if (fromIdx === toIdx || toIdx < 0 || toIdx >= visitProjet.localisations.length) return;
    const locs = [...visitProjet.localisations];
    const [moved] = locs.splice(fromIdx, 1);
    locs.splice(toIdx, 0, moved);
    onUpdateVisit({ localisations: locs });
  }, [visitProjet.localisations, onUpdateVisit]);

  const onZoneDragEnd = useCallback(() => {
    if (zoneDragDidMove.current && zoneDragIdx !== null && zoneOverIdx !== null) {
      moveZone(zoneDragIdx, zoneOverIdx);
    }
    setZoneDragIdx(null); setZoneOverIdx(null); zoneDragDidMove.current = false;
  }, [zoneDragIdx, zoneOverIdx, moveZone]);

  // --- Open zones quand on change de visite ---
  const [openLocIds, setOpenLocIds] = useState(
    () => new Set((selectedVisite?.localisations || []).map(l => l.id))
  );
  useEffect(() => {
    setOpenLocIds(new Set((selectedVisite?.localisations || []).map(l => l.id)));
  }, [selectedVisiteId]);

  // --- Helpers de mutation (opèrent sur visitProjet.localisations) ---
  const patchLoc = useCallback((locId, patch) => {
    const locs = visitProjet.localisations.map(l => l.id === locId ? { ...l, ...patch } : l);
    onUpdateVisit({ localisations: locs });
  }, [visitProjet.localisations, onUpdateVisit]);

  const patchItem = useCallback((locId, item) => {
    const locs = visitProjet.localisations.map(l => {
      if (l.id !== locId) return l;
      const items = (l.items || []).find(i => i.id === item.id)
        ? (l.items || []).map(i => i.id === item.id ? item : i)
        : [...(l.items || []), item];
      return { ...l, items };
    });
    onUpdateVisit({ localisations: locs });
  }, [visitProjet.localisations, onUpdateVisit]);

  const showUndo = useCallback((label, onUndo) => {
    clearTimeout(undoTimerRef.current);
    setUndoToast({ label, onUndo });
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 4000);
  }, []);

  const deleteItem = useCallback((locId, itemId) => {
    const prevLocs = visitProjet.localisations;
    const item = prevLocs.find(l => l.id === locId)?.items?.find(i => i.id === itemId);
    const locs = prevLocs.map(l =>
      l.id !== locId ? l : { ...l, items: (l.items || []).filter(i => i.id !== itemId) }
    );
    onUpdateVisit({ localisations: locs });
    showUndo(`"${item?.titre || 'Observation'}" supprimée`, () => onUpdateVisit({ localisations: prevLocs }));
  }, [visitProjet.localisations, onUpdateVisit, showUndo]);

  const addLoc = () => {
    const newLoc = { id: crypto.randomUUID(), nom: 'Nouvelle zone', items: [], planBg: null, planData: null, planAnnotations: null };
    onUpdateVisit({ localisations: [...visitProjet.localisations, newLoc] });
    setOpenLocIds(prev => new Set([...prev, newLoc.id]));
  };

  const deleteLoc = (locId, nom) => {
    if (!window.confirm(`Supprimer la zone "${nom}" et toutes ses observations ?`)) return;
    onUpdateVisit({ localisations: visitProjet.localisations.filter(l => l.id !== locId) });
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

  const [undoToast, setUndoToast] = useState(null); // { label, onUndo }
  const undoTimerRef = useRef(null);

  const formatDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day:'numeric', month:'short' })
    : null;

  // --- Annotator plein écran ---
  if (modal?.t === 'annotate') {
    const loc = visitProjet.localisations.find(l => l.id === modal.locId);
    return (
      <Annotator
        bgImage={loc?.planBg}
        savedPaths={modal.form.planAnnotations?.paths || []}
        photos={(modal.form.photos || []).filter(ph => ph.data)}
        onSave={(paths, exported) => {
          setModal({ t:'item', locId:modal.locId, item:modal.form, savedForm:{ ...modal.form, planAnnotations:{ paths, exported } } });
        }}
        onClose={() => setModal({ t:'item', locId:modal.locId, item:modal.form, savedForm:modal.form })}
      />
    );
  }

  const totalItems = visitProjet.localisations.flatMap(l => l.items || []).length;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:DA.grayXL }}>

      {/* ── Header projet ── */}
      <div style={{ background:DA.black, padding:'12px 14px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={onBack}
            style={{ color:'rgba(255,255,255,0.7)', background:'rgba(255,255,255,0.08)', border:'none', borderRadius:6, padding:'7px 10px', display:'flex', alignItems:'center', gap:3, cursor:'pointer', flexShrink:0 }}>
            <span style={{ display:'inline-block', transform:'rotate(90deg)', lineHeight:0 }}><Ic n="chv" s={14}/></span>
            <span style={{ fontSize:13, fontWeight:600 }}>Projets</span>
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontWeight:800, fontSize:16, color:'white', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.nom}</p>
            {projet.adresse && <p style={{ fontSize:12, color:'rgba(255,255,255,0.45)', margin:'3px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.adresse}</p>}
          </div>
          <div style={{ flexShrink:0 }}>
            <button onClick={() => setModal({ t:'niveaux' })}
              style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, padding:'7px 12px', color:'rgba(255,255,255,0.7)', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
              <Ic n="bld" s={14}/> Zones & Plans
            </button>
          </div>
        </div>

        {/* ── Sélecteur de visites ── */}
        <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:10, overflowX:'auto', paddingBottom:2 }}>
          {visites.map(v => {
            const isSelected = v.id === selectedVisiteId;
            const isEditLabel = editingVisiteLabel === v.id;
            const canDelete = visites.length > 1;
            if (isSelected) return (
              <div key={v.id} style={{ flexShrink:0, display:'flex', alignItems:'center', gap:6, padding:'4px 6px 4px 13px', borderRadius:20, background:DA.red }}>
                {isEditLabel ? (
                  <input
                    autoFocus
                    value={visitLabelVal}
                    onChange={e => setVisitLabelVal(e.target.value)}
                    onBlur={() => {
                      const t = visitLabelVal.trim();
                      if (t) updateVisite(v.id, { label: t });
                      setEditingVisiteLabel(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setEditingVisiteLabel(null);
                    }}
                    style={{ background:'rgba(255,255,255,0.2)', border:'none', outline:'none', borderRadius:6, color:'white', fontSize:13, fontWeight:700, padding:'1px 6px', width: Math.max(60, visitLabelVal.length * 8.5) + 'px' }}
                  />
                ) : (
                  <span
                    onClick={() => { setEditingVisiteLabel(v.id); setVisitLabelVal(v.label ?? ''); }}
                    title="Cliquer pour renommer"
                    style={{ color:'white', fontSize:13, fontWeight:700, cursor:'text', userSelect:'none' }}>
                    {v.label ?? 'Visite'}
                  </span>
                )}
                <input
                  type="date"
                  value={v.dateVisite || ''}
                  onChange={e => updateVisite(v.id, { dateVisite: e.target.value || null })}
                  style={{ background:'rgba(255,255,255,0.18)', border:'none', color:'rgba(255,255,255,0.9)', fontSize:12, fontWeight:600, borderRadius:8, padding:'3px 8px', cursor:'pointer', outline:'none', colorScheme:'dark' }}
                />
                {canDelete && (
                  <button onClick={() => deleteVisite(v.id)}
                    title="Supprimer cette visite"
                    style={{ background:'rgba(0,0,0,0.2)', border:'none', borderRadius:6, padding:'3px 5px', cursor:'pointer', color:'rgba(255,255,255,0.7)', display:'flex', alignItems:'center', flexShrink:0 }}>
                    <Ic n="del" s={11}/>
                  </button>
                )}
              </div>
            );
            return (
              <div key={v.id} style={{ flexShrink:0, display:'flex', alignItems:'center', gap:4, padding:'5px 8px 5px 11px', borderRadius:20, background:'rgba(255,255,255,0.1)' }}>
                <span
                  onClick={() => { setSelectedVisiteId(v.id); setTab('visite'); }}
                  style={{ fontSize:13, fontWeight:700, cursor:'pointer', color:'rgba(255,255,255,0.55)', display:'flex', alignItems:'center', gap:4 }}>
                  {v.label ?? 'Visite'}
                  {v.dateVisite && <span style={{ fontSize:12, opacity:0.75 }}>· {formatDate(v.dateVisite)}</span>}
                </span>
                {canDelete && (
                  <button onClick={() => deleteVisite(v.id)}
                    title="Supprimer cette visite"
                    style={{ background:'none', border:'none', padding:'2px 3px', cursor:'pointer', color:'rgba(255,255,255,0.3)', display:'flex', alignItems:'center', flexShrink:0 }}
                    onMouseEnter={e => e.currentTarget.style.color='rgba(255,255,255,0.7)'}
                    onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.3)'}>
                    <Ic n="x" s={10}/>
                  </button>
                )}
              </div>
            );
          })}
          <button onClick={addVisite}
            style={{ flexShrink:0, display:'flex', alignItems:'center', gap:4, padding:'6px 12px', borderRadius:20, fontSize:13, fontWeight:600, cursor:'pointer',
              border:'1px dashed rgba(255,255,255,0.3)', background:'transparent', color:'rgba(255,255,255,0.45)' }}>
            <Ic n="plus" s={13}/> Nouvelle visite
          </button>
        </div>

        {/* Tabs Visite / Rapport */}
        <div style={{ display:'flex', borderTop:'1px solid rgba(255,255,255,0.08)', marginTop:10 }}>
          {[
            { k:'visite',  n:'bld', l:'Visite' },
            { k:'rapport', n:'fil', l:`Rapport${totalItems > 0 ? ` (${totalItems})` : ''}` },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'13px 0', fontSize:14, fontWeight:700, border:'none', borderBottom:`2.5px solid ${tab===t.k ? DA.red : 'transparent'}`, background:'transparent', color:tab===t.k ? DA.red : 'rgba(255,255,255,0.45)', cursor:'pointer', transition:'all 0.15s' }}>
              <Ic n={t.n} s={15}/>{t.l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Corps scrollable ── */}
      <div style={{ flex:1, overflow: tab === 'rapport' ? 'hidden' : 'auto' }}>
        <div style={{ height: tab === 'rapport' ? '100%' : 'auto' }}>

          {/* ════ TAB VISITE ════ */}
          {tab === 'visite' && (
            <div>
              {/* Bannière résumé */}
              {visitProjet.localisations.length === 0 ? (
                <div style={{ padding:'48px 24px', textAlign:'center' }}>
                  <div style={{ width:48, height:48, borderRadius:12, background:DA.redL, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', color:DA.red }}>
                    <Ic n="pin" s={24}/>
                  </div>
                  <p style={{ fontWeight:700, fontSize:15, color:DA.black, margin:'0 0 6px' }}>Aucune zone</p>
                  <p style={{ color:DA.gray, fontSize:12, margin:'0 0 20px' }}>Créez des zones pour organiser vos observations par localisation.</p>
                  <button onClick={addLoc}
                    style={{ background:DA.red, color:'white', border:'none', borderRadius:12, padding:'14px 32px', fontSize:15, fontWeight:700, cursor:'pointer' }}>
                    + Ajouter une zone
                  </button>
                </div>
              ) : (
                <>
                  {visitProjet.localisations.map((loc, locIdx) => {
                    const items    = loc.items || [];
                    const isOpen   = openLocIds.has(loc.id);
                    const urgentCount = items.filter(i => i.urgence === 'haute').length;
                    const total       = visitProjet.localisations.length;
                    return (
                      <div key={loc.id}
                        draggable
                        onDragStart={() => { setZoneDragIdx(locIdx); zoneDragDidMove.current = false; }}
                        onDragEnter={() => { setZoneOverIdx(locIdx); zoneDragDidMove.current = true; }}
                        onDragEnd={onZoneDragEnd}
                        onDragOver={e => e.preventDefault()}
                        style={{
                          background: zoneDragIdx===locIdx ? '#e8e8e8' : zoneOverIdx===locIdx&&zoneDragIdx!==locIdx ? DA.redL : '#F4F4F4',
                          borderBottom:`1px solid ${DA.border}`,
                          borderTop: zoneOverIdx===locIdx&&zoneDragIdx!==locIdx ? `2px solid ${DA.red}` : 'none',
                          opacity: zoneDragIdx===locIdx ? 0.45 : 1,
                          transition:'background 0.08s,opacity 0.08s',
                        }}>
                        <div style={{ display:'flex', alignItems:'center', padding:'14px 14px', gap:8 }}>
                          {/* Poignée drag zone */}
                          <div onClick={e => e.stopPropagation()}
                            style={{ flexShrink:0, padding:'6px 4px', cursor:'grab', color:'#bbb', display:'flex', alignItems:'center' }}>
                            <Ic n="grp" s={18}/>
                          </div>
                          <button onClick={e => { if (zoneDragDidMove.current) return; toggleLoc(loc.id); }}
                            style={{ color:DA.grayL, background:'none', border:'none', cursor:'pointer', flexShrink:0, padding:4, display:'flex', alignItems:'center', transition:'transform 0.15s', transform:isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
                            <Ic n="chv" s={16}/>
                          </button>
                          <EditTitle
                            value={loc.nom}
                            onSave={nom => patchLoc(loc.id, { nom })}
                            style={{ fontSize:13, fontWeight:800, color:'#555', textTransform:'uppercase', letterSpacing:0.8 }}
                            inputStyle={{ fontSize:13, fontWeight:800, textTransform:'uppercase' }}
                          />
                          <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                            {urgentCount > 0 && (
                              <span style={{ fontSize:12, fontWeight:700, background:'#FFF0F0', color:DA.red, border:`1px solid #FCA5A5`, borderRadius:10, padding:'2px 8px', lineHeight:1.6 }}>
                                {urgentCount} ⚠
                              </span>
                            )}
                            <span style={{ fontSize:13, color:DA.grayL, minWidth:14, textAlign:'center' }}>{items.length}</span>
                            <button onClick={() => setModal({ t:'plan', locId:loc.id })}
                              style={{ padding:'7px 9px', border:`1px solid ${loc.planBg ? DA.red : DA.border}`, background:loc.planBg ? DA.redL : 'white', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', color:loc.planBg ? DA.red : DA.grayL }}>
                              <Ic n="map" s={15}/>
                            </button>
                            <button onClick={() => deleteLoc(loc.id, loc.nom)}
                              style={{ padding:'7px 8px', border:'none', background:'none', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', color:'#ccc' }}
                              onMouseEnter={e => e.currentTarget.style.color = DA.red}
                              onMouseLeave={e => e.currentTarget.style.color = '#ccc'}>
                              <Ic n="del" s={16}/>
                            </button>
                          </div>
                        </div>
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
                    style={{ width:'100%', padding:18, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize:15, fontWeight:700, color:'white', background:DA.red, border:'none', cursor:'pointer' }}>
                    <Ic n="plus" s={16}/> Ajouter une zone
                  </button>
                </>
              )}
            </div>
          )}

          {/* ════ TAB RAPPORT ════ */}
          {tab === 'rapport' && (
            <RapportTab projet={visitProjet} onUpdate={onUpdateVisit} />
          )}
        </div>
      </div>

      {/* ── Toast Undo ── */}
      {undoToast && (
        <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', zIndex:9999, background:'#222', color:'white', borderRadius:12, padding:'10px 16px', display:'flex', alignItems:'center', gap:12, boxShadow:'0 4px 20px rgba(0,0,0,0.4)', fontSize:12, fontWeight:600, whiteSpace:'nowrap' }}>
          <span>{undoToast.label}</span>
          <button onClick={() => { undoToast.onUndo(); setUndoToast(null); clearTimeout(undoTimerRef.current); }}
            style={{ background:DA.red, color:'white', border:'none', borderRadius:7, padding:'4px 10px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            Annuler
          </button>
          <button onClick={() => setUndoToast(null)} style={{ background:'rgba(255,255,255,0.1)', border:'none', color:'rgba(255,255,255,0.6)', borderRadius:6, padding:'4px 8px', cursor:'pointer', fontSize:11 }}>×</button>
        </div>
      )}

      {/* ── Modals ── */}
      {modal?.t === 'item' && (() => {
        const loc      = visitProjet.localisations.find(l => l.id === modal.locId);
        const initItem = modal.savedForm ?? modal.item;
        return (
          <ItemModal
            key={modal.savedForm ? 'annotated' : 'normal'}
            item={initItem}
            planBg={loc?.planBg ?? null}
            planAnnotations={initItem?.planAnnotations ?? null}
            onClose={() => setModal(null)}
            onSave={form => { saveItem(modal.locId, { ...form, id: form.id || crypto.randomUUID() }); setModal(null); }}
            onOpenAnnot={form => setModal({ t:'annotate', locId:modal.locId, form })}
          />
        );
      })()}

      {modal?.t === 'plan' && (() => {
        const loc = visitProjet.localisations.find(l => l.id === modal.locId);
        return (
          <PlanLocModal
            loc={loc}
            items={loc?.items || []}
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
          localisations={visitProjet.localisations}
          planLibrary={projet.planLibrary || []}
          onChange={newLocs => onUpdateVisit({ localisations: newLocs })}
          onClose={() => setModal(null)}
          onOpenPlanLib={() => setModal({ t:'planLib' })}
        />
      )}
    </div>
  );
}
