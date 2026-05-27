import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import EditTitle from '../ui/EditTitle.jsx';
import SortList from '../vue/SortList.jsx';
import ItemModal from '../vue/ItemModal.jsx';
import RapportTab from '../vue/RapportTab.jsx';
import PlanLibraryModal from '../vue/PlanLibraryModal.jsx';
import PlanLocModal from '../vue/PlanLocModal.jsx';
import PlanDragBar from '../vue/PlanDragBar.jsx';
import NiveauxModal from '../vue/NiveauxModal.jsx';
import Annotator from '../vue/Annotator.jsx';

function PlanAnnotThumb({ bg, annotations, style }) {
  // annotations?.exported = image pré-composée (plan + annotations) générée par l'Annotateur
  // C'est une base64 data URL → affichage instantané, coordonnées correctes, pas de canvas
  const src = annotations?.exported || bg;
  return <img src={src} alt="" style={{ ...style, objectFit:'contain', display:'block' }} />;
}

// Champs qui appartiennent à une visite (pas au projet)
const VISIT_FIELDS = new Set([
  'localisations','dateVisite','participants','tableauRecap',
  'photosParLigne','plansEnFin','rapportPageBreaks','includeTableauRecap',
  'includeConclusion','conclusion','conclusionAlign','ingenieur',
]);

export default function VueProjet({ projet, visiteId, onBack, onUpdate, setBackHandler, syncStatus = 'ok' }) {
  const visites = projet.visites || [];
  const [selectedVisiteId, setSelectedVisiteId] = useState(() => visiteId ?? visites[0]?.id ?? null);
  const [tab, setTab] = useState('visite');
  const [modal, setModal] = useState(null);
  const modalRef = useRef(null);
  useEffect(() => { modalRef.current = modal; }, [modal]);

  useEffect(() => {
    if (!setBackHandler) return;
    setBackHandler(() => {
      const m = modalRef.current;
      if (!m) return false;
      if (m.t === 'annotate') {
        setModal({ t:'item', locId:m.locId, item:m.form, savedForm:m.form });
      } else {
        setModal(null);
      }
      return true;
    });
    return () => setBackHandler(null);
  }, [setBackHandler]);

  const [editingVisiteLabel, setEditingVisiteLabel] = useState(null);
  const [visitLabelVal, setVisitLabelVal] = useState('');
  const [editingProjetNom, setEditingProjetNom] = useState(false);
  const [projetNomVal, setProjetNomVal] = useState('');

  useEffect(() => {
    if (!selectedVisiteId && visites.length > 0) setSelectedVisiteId(visites[0].id);
  }, [visites]);

  const selectedVisite = useMemo(
    () => visites.find(v => v.id === selectedVisiteId) ?? visites[0] ?? null,
    [visites, selectedVisiteId]
  );

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
    visiteNom:           selectedVisite?.label                 ?? '',
    ingenieur:           selectedVisite?.ingenieur             ?? '',
  }), [projet, selectedVisite]);

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

  const updateVisite = (visiteId, patch) => {
    const newVisites = visites.map(v => v.id === visiteId ? { ...v, ...patch } : v);
    onUpdate({ visites: newVisites });
  };

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

  const patchLoc = useCallback((locId, patch) => {
    const locs = visitProjet.localisations.map(l => l.id === locId ? { ...l, ...patch } : l);
    onUpdateVisit({ localisations: locs });
  }, [visitProjet.localisations, onUpdateVisit]);

  const reorderZonePlan = useCallback((locId, fromIdx, toIdx) => {
    const loc = visitProjet.localisations.find(l => l.id === locId);
    if (!loc || toIdx < 0) return;
    // Normalise le plan principal + extraPlans en tableau plat
    const all = [];
    if (loc.planId || loc.planBg) all.push({ planId: loc.planId||null, planBg: loc.planBg||null, planData: loc.planData||null, planAnnotations: loc.planAnnotations||null });
    for (const ep of (loc.extraPlans || [])) all.push({ planId: ep.planId||null, planBg: ep.planBg||null, planData: null, planAnnotations: ep.planAnnotations||null });
    if (toIdx >= all.length) return;
    const [moved] = all.splice(fromIdx, 1);
    all.splice(toIdx, 0, moved);
    const [p, ...extras] = all;
    patchLoc(locId, {
      planId: p?.planId||null, planBg: p?.planBg||null, planData: p?.planData||null, planAnnotations: p?.planAnnotations||null,
      extraPlans: extras.map(e => ({ planId: e.planId, planBg: e.planBg, planAnnotations: e.planAnnotations })),
    });
  }, [visitProjet.localisations, patchLoc]);

  const onZoneDragEnd = useCallback(() => {
    if (zoneDragDidMove.current && zoneDragIdx !== null && zoneOverIdx !== null) {
      moveZone(zoneDragIdx, zoneOverIdx);
    }
    setZoneDragIdx(null); setZoneOverIdx(null); zoneDragDidMove.current = false;
  }, [zoneDragIdx, zoneOverIdx, moveZone]);

  const [openLocIds, setOpenLocIds] = useState(
    () => new Set((selectedVisite?.localisations || []).map(l => l.id))
  );
  useEffect(() => {
    setOpenLocIds(new Set((selectedVisite?.localisations || []).map(l => l.id)));
  }, [selectedVisiteId]);

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

  const [undoToast, setUndoToast] = useState(null);
  const undoTimerRef = useRef(null);
  const annotatorRef = useRef(null);

  const formatDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day:'numeric', month:'short' })
    : null;

  if (modal?.t === 'photoAnnot') {
    const { item, locId, photoIdx } = modal;
    const validPhotos = (item.photos || []).filter(p => p.data);
    const ph = item.photos?.[photoIdx];

    const switchToPhoto = (newRealIdx) => {
      const annotation = annotatorRef.current?.getAnnotation();
      const updatedItem = annotation
        ? { ...item, _photosHydrated: true, photos: item.photos.map((p, i) => i === photoIdx ? { ...p, annotations: annotation.paths, annotated: annotation.annotated, annotW: annotation.annotW, annotH: annotation.annotH } : p) }
        : item;
      if (annotation) patchItem(locId, updatedItem);
      setModal({ t: 'photoAnnot', item: updatedItem, locId, photoIdx: newRealIdx });
    };

    return (
      <>
        <Annotator
          ref={annotatorRef}
          bgImage={ph?.data}
          savedPaths={ph?.annotations || []}
          onSave={(paths, exported, dims) => {
            const updatedItem = {
              ...item,
              _photosHydrated: true,
              photos: item.photos.map((p, i) => i === photoIdx ? { ...p, annotations: paths, annotated: exported, annotW: dims?.w, annotH: dims?.h } : p),
            };
            patchItem(locId, updatedItem);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
        {validPhotos.length > 1 && (
          <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'rgba(0,0,0,0.85)', padding:'8px 12px', display:'flex', gap:6, justifyContent:'center', zIndex:100, backdropFilter:'blur(4px)' }}>
            {validPhotos.map((p, vi) => {
              const realIdx = (item.photos || []).indexOf(p);
              const isActive = realIdx === photoIdx;
              return (
                <img key={vi} src={p.annotated || p.data} alt=""
                  onClick={() => !isActive && switchToPhoto(realIdx)}
                  style={{ width:52, height:52, objectFit:'cover', borderRadius:6, cursor: isActive ? 'default' : 'pointer', border:`2px solid ${isActive ? 'white' : 'transparent'}`, opacity: isActive ? 1 : 0.55, transition:'all 0.1s' }}
                />
              );
            })}
          </div>
        )}
      </>
    );
  }

  if (modal?.t === 'annotate') {
    const loc = visitProjet.localisations.find(l => l.id === modal.locId);
    return (
      <Annotator
        bgImage={loc?.planBg}
        savedPaths={modal.form.planAnnotations?.paths || []}
        photos={(modal.form.photos || []).filter(ph => ph.data)}
        exportSizeMultiplier={2}
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

      <div style={{ background:DA.black, flexShrink:0 }}>

        {isDesktop ? (
          <div style={{ position:'relative', display:'flex', alignItems:'center', minHeight:52, padding:'0 16px' }}>

            <div style={{ flex:1, display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
              <button onClick={onBack}
                style={{ color:'rgba(255,255,255,0.65)', background:'rgba(255,255,255,0.08)', border:'none', borderRadius:6, padding:'6px 10px', display:'flex', alignItems:'center', gap:3, cursor:'pointer', flexShrink:0 }}>
                <span style={{ display:'inline-block', transform:'rotate(90deg)', lineHeight:0 }}><Ic n="chv" s={13}/></span>
                <span style={{ fontSize:12, fontWeight:600 }}>Retour</span>
              </button>
              <div style={{ minWidth:0 }}>
                {editingProjetNom ? (
                  <input autoFocus value={projetNomVal}
                    onChange={e => setProjetNomVal(e.target.value)}
                    onBlur={() => { const t = projetNomVal.trim(); if (t) onUpdate({ nom: t }); setEditingProjetNom(false); }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingProjetNom(false); }}
                    style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)', outline:'none', borderRadius:6, color:'white', fontSize:15, fontWeight:800, padding:'3px 7px', width: Math.max(120, projetNomVal.length * 9) + 'px' }}
                  />
                ) : (
                  <p onClick={() => { setEditingProjetNom(true); setProjetNomVal(projet.nom || ''); }}
                    style={{ fontWeight:800, fontSize:15, color:'white', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2, cursor:'pointer' }} spellCheck={false}>{projet.nom}</p>
                )}
                {projet.adresse && <p style={{ fontSize:11, color:'rgba(255,255,255,0.4)', margin:'2px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.adresse}</p>}
              </div>
            </div>

            <div style={{ position:'absolute', left:'50%', transform:'translateX(-50%)', display:'flex', alignItems:'stretch', gap:4, padding:'0 8px', height:'100%' }}>
              {[
                { k:'visite',  n:'bld', l:'Visite' },
                { k:'rapport', n:'fil', l:'Rapport' + (totalItems > 0 ? ` (${totalItems})` : '') },
              ].map(t => (
                <button key={t.k} onClick={() => setTab(t.k)}
                  style={{ display:'flex', alignItems:'center', gap:7, padding:'0 28px', fontSize:15, fontWeight:700, border:'none', borderBottom:`3px solid ${tab===t.k ? 'white' : 'transparent'}`, background: tab===t.k ? 'rgba(255,255,255,0.08)' : 'transparent', color: tab===t.k ? 'white' : 'rgba(255,255,255,0.5)', cursor:'pointer', transition:'all 0.15s', borderRadius:'6px 6px 0 0' }}>
                  <Ic n={t.n} s={16}/>{t.l}
                </button>
              ))}
            </div>

            <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
              {(() => {
                const v = visites.find(vv => vv.id === selectedVisiteId);
                if (!v) return null;
                return editingVisiteLabel === v.id ? (
                  <input autoFocus value={visitLabelVal}
                    onChange={e => setVisitLabelVal(e.target.value)}
                    onBlur={() => { const t = visitLabelVal.trim(); if (t) updateVisite(v.id, { label: t }); setEditingVisiteLabel(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingVisiteLabel(null); }}
                    style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)', outline:'none', borderRadius:6, color:'white', fontSize:11, fontWeight:700, padding:'4px 8px', width: Math.max(70, visitLabelVal.length * 7) + 'px' }}
                  />
                ) : (
                  <button onClick={() => { setEditingVisiteLabel(v.id); setVisitLabelVal(v.label ?? ''); }}
                    style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:6, padding:'4px 9px', color:'rgba(255,255,255,0.75)', fontSize:11, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:4, maxWidth:220, overflow:'hidden' }}>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.label ?? 'Visite'}</span>
                    {v.dateVisite && <span style={{ opacity:0.5, fontWeight:500, flexShrink:0 }}>· {formatDate(v.dateVisite)}</span>}
                  </button>
                );
              })()}
              {tab !== 'rapport' && (
                <button onClick={() => setModal({ t:'niveaux' })}
                  style={{ background:'white', border:'none', borderRadius:8, padding:'6px 13px', color:DA.black, cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontWeight:800 }}>
                  <Ic n="bld" s={14}/>
                  <span style={{ fontSize:12, fontWeight:800 }}>Plans</span>
                </button>
              )}
            </div>

          </div>
        ) : (
          <>
            <div style={{ padding:'8px 12px 0', display:'flex', alignItems:'center', gap:8 }}>
              <button onClick={onBack}
                style={{ color:'rgba(255,255,255,0.65)', background:'rgba(255,255,255,0.08)', border:'none', borderRadius:6, padding:'6px 10px', display:'flex', alignItems:'center', gap:3, cursor:'pointer', flexShrink:0 }}>
                <span style={{ display:'inline-block', transform:'rotate(90deg)', lineHeight:0 }}><Ic n="chv" s={13}/></span>
                <span style={{ fontSize:12, fontWeight:600 }}>Visites</span>
              </button>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontWeight:800, fontSize:15, color:'white', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.nom}</p>
                {projet.adresse && <p style={{ fontSize:11, color:'rgba(255,255,255,0.4)', margin:'2px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.adresse}</p>}
              </div>
              {(() => {
                const dotColor = syncStatus === 'ok' ? '#4ADE80' : syncStatus === 'saving' ? '#FCD34D' : '#F87171';
                const dotLabel = syncStatus === 'saving' ? 'Sauvegarde…' : syncStatus === 'error' ? 'Erreur sync' : 'Sauvegardé';
                return (
                  <div style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 9px', borderRadius:8,
                    background: syncStatus==='error' ? 'rgba(239,68,68,0.15)' : syncStatus==='saving' ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.07)',
                    border: `1px solid ${syncStatus==='error'?'rgba(239,68,68,0.4)':syncStatus==='saving'?'rgba(251,191,36,0.4)':'rgba(255,255,255,0.12)'}`,
                    flexShrink:0 }}>
                    {syncStatus === 'saving' ? <Ic n="spn" s={10}/> : <div style={{ width:6, height:6, borderRadius:'50%', background:dotColor, flexShrink:0 }}/>}
                    <span style={{ fontSize:10, fontWeight:700, color: syncStatus==='error'?'#F87171':syncStatus==='saving'?'#FCD34D':'rgba(255,255,255,0.75)', whiteSpace:'nowrap' }}>{dotLabel}</span>
                  </div>
                );
              })()}
              {tab !== 'rapport' && (
                <button onClick={() => setModal({ t:'niveaux' })}
                  style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, padding:'5px 9px', color:'rgba(255,255,255,0.75)', cursor:'pointer', display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
                  <Ic n="bld" s={14}/>
                  <span style={{ fontSize:11, fontWeight:700 }}>Plans</span>
                </button>
              )}
            </div>
            <div style={{ borderTop:'1px solid rgba(255,255,255,0.08)', marginTop:8 }}>
              <div style={{ display:'flex' }}>
                {[
                  { k:'visite',  n:'bld', l:'Visite' },
                  { k:'rapport', n:'fil', l:'Rapport' + (totalItems > 0 ? ` (${totalItems})` : '') },
                ].map(t => (
                  <button key={t.k} onClick={() => setTab(t.k)}
                    style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'10px 0', fontSize:14, fontWeight:700, border:'none', borderBottom:`2.5px solid ${tab===t.k ? 'white' : 'transparent'}`, background:'transparent', color: tab===t.k ? 'white' : 'rgba(255,255,255,0.45)', cursor:'pointer', transition:'all 0.15s' }}>
                    <Ic n={t.n} s={15}/>{t.l}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ flex:1, overflow: tab === 'rapport' ? 'hidden' : 'auto', background: tab === 'visite' ? '#E8E8E8' : undefined }}>
        <div style={{ height: tab === 'rapport' ? '100%' : 'auto' }}>

          {tab === 'visite' && (
            <div style={{ maxWidth:1400, margin:'0 auto', padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>
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
                    const assignedPlan = loc.planId ? (projet.planLibrary||[]).find(p => p.id === loc.planId) : null;
                    const allPlanThumbs = [];
                    if (loc.planId || loc.planBg) {
                      allPlanThumbs.push({ bg: loc.planBg || assignedPlan?.bg || null, planAnnotations: loc.planAnnotations, nom: assignedPlan?.nom || 'Plan de zone' });
                    }
                    for (const ep of (loc.extraPlans || [])) {
                      const epLib = (projet.planLibrary||[]).find(p => p.id === ep.planId);
                      allPlanThumbs.push({ bg: ep.planBg || epLib?.bg || null, planAnnotations: ep.planAnnotations, nom: epLib?.nom || 'Plan' });
                    }
                    const hasAnyPlan = allPlanThumbs.length > 0;
                    return (
                      <div key={loc.id}
                        draggable
                        onDragStart={() => { setZoneDragIdx(locIdx); zoneDragDidMove.current = false; }}
                        onDragEnter={() => { setZoneOverIdx(locIdx); zoneDragDidMove.current = true; }}
                        onDragEnd={onZoneDragEnd}
                        onDragOver={e => e.preventDefault()}
                        style={{
                          background: zoneDragIdx===locIdx ? '#e8e8e8' : zoneOverIdx===locIdx&&zoneDragIdx!==locIdx ? DA.redL : 'white',
                          borderRadius: 10,
                          border: `1px solid ${zoneOverIdx===locIdx&&zoneDragIdx!==locIdx ? DA.red : DA.border}`,
                          boxShadow: zoneDragIdx===locIdx ? 'none' : '0 1px 4px rgba(0,0,0,0.07)',
                          overflow: 'hidden',
                          opacity: zoneDragIdx===locIdx ? 0.45 : 1,
                          transition:'background 0.08s,opacity 0.08s,box-shadow 0.08s',
                        }}>
                        <div style={{ display:'flex', alignItems:'center', padding:'16px 18px', gap:10 }}>
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
                            <button onClick={() => setModal({ t:'plan', locId:loc.id })}
                              style={{ padding:'7px 9px', border:`1px solid ${hasAnyPlan ? DA.red : DA.border}`, background:hasAnyPlan ? DA.redL : 'white', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', color:hasAnyPlan ? DA.red : DA.grayL }}>
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
                              onAnnotatePhoto={(item, photoIdx) => setModal({ t:'photoAnnot', item, locId:loc.id, photoIdx })}
                              onDeletePhoto={(item, photoIdx) => {
                                const updated = { ...item, photos: item.photos.filter((_,i) => i !== photoIdx), _photosHydrated: true };
                                patchItem(loc.id, updated);
                              }}
                            />
                            {hasAnyPlan ? (
                              <div style={{ borderTop:`1px solid ${DA.border}`, overflow:'hidden' }}>
                                {allPlanThumbs.length > 1 && (
                                  <PlanDragBar plans={allPlanThumbs} locId={loc.id} onReorder={reorderZonePlan}/>
                                )}
                                {Array.from({ length: Math.ceil(allPlanThumbs.length / 2) }, (_, rowIdx) => {
                                  const rowThumbs = allPlanThumbs.slice(rowIdx * 2, rowIdx * 2 + 2);
                                  const thumbH = allPlanThumbs.length > 2 ? (isDesktop ? 260 : 190) : (isDesktop ? 380 : 260);
                                  return (
                                    <div key={rowIdx} style={{ display:'flex', borderTop: rowIdx > 0 ? `1px solid ${DA.border}` : 'none' }}>
                                      {rowThumbs.map((pt, colIdx) => {
                                        const annotCount = pt.planAnnotations?.paths?.length || 0;
                                        return (
                                          <button key={colIdx}
                                            onClick={() => setModal({ t:'plan', locId:loc.id, annotIdx: rowIdx * 2 + colIdx })}
                                            style={{ flex:1, position:'relative', height: thumbH, border:'none', borderLeft: colIdx > 0 ? `1px solid ${DA.border}` : 'none', cursor:'pointer', overflow:'hidden', display:'block', padding:0, background: pt.bg ? '#f4f4f4' : DA.grayXL }}>
                                            {pt.bg ? (
                                              <PlanAnnotThumb bg={pt.bg} annotations={pt.planAnnotations} style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}/>
                                            ) : (
                                              <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6, color:DA.grayL }}>
                                                <Ic n="map" s={24}/>
                                                <span style={{ fontSize:10, fontWeight:700, color:DA.gray, textAlign:'center', padding:'0 6px' }}>{pt.nom}</span>
                                              </div>
                                            )}
                                            {pt.bg && <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.05) 40%, transparent 100%)' }}/>}
                                            {annotCount > 0 && (
                                              <div style={{ position:'absolute', top:6, right:6, background:DA.red, color:'white', borderRadius:8, fontSize:10, fontWeight:800, padding:'2px 6px', lineHeight:1.6, display:'flex', alignItems:'center', gap:3 }}>
                                                <Ic n="pen" s={9}/> {annotCount}
                                              </div>
                                            )}
                                            <div style={{ position:'absolute', bottom:0, left:0, right:0, padding:'6px 8px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                              {pt.bg && <p style={{ margin:0, fontSize:10, fontWeight:800, color:'white', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, marginRight:4 }}>{pt.nom}</p>}
                                              <div style={{ marginLeft:'auto', background:DA.red, color:'white', borderRadius:6, padding:'4px 8px', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', gap:3, flexShrink:0 }}>
                                                <Ic n="pen" s={10}/> Annoter
                                              </div>
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <button
                                onClick={() => setModal({ t:'plan', locId:loc.id })}
                                style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'10px 14px', background:DA.grayXL, border:'none', borderTop:`1px solid ${DA.border}`, cursor:'pointer', color:DA.grayL, fontSize:12 }}>
                                <Ic n="map" s={13}/> Assigner un plan à cette zone
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button onClick={addLoc}
                    style={{ width:'100%', padding:16, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize:15, fontWeight:700, color:'white', background:DA.red, border:'none', borderRadius:10, cursor:'pointer', boxShadow:'0 2px 8px rgba(227,5,19,0.25)' }}>
                    <Ic n="plus" s={16}/> Ajouter une zone
                  </button>
                </>
              )}
            </div>
          )}

          {tab === 'rapport' && (
            <RapportTab projet={visitProjet} onUpdate={onUpdateVisit} />
          )}
        </div>
      </div>

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

      {modal?.t === 'item' && (() => {
        const loc      = visitProjet.localisations.find(l => l.id === modal.locId);
        const initItem = modal.savedForm ?? modal.item;
        return (
          <ItemModal
            key={modal.savedForm ? 'annotated' : 'normal'}
            item={initItem}
            planBg={loc?.planBg ?? null}
            planId={loc?.planId ?? null}
            extraPlans={loc?.extraPlans ?? []}
            planAnnotations={initItem?.planAnnotations ?? null}
            planLibrary={projet.planLibrary || []}
            onClose={() => setModal(null)}
            onSave={form => { saveItem(modal.locId, { ...form, id: form.id || crypto.randomUUID() }); setModal(null); }}
            onOpenAnnot={form => setModal({ t:'annotate', locId:modal.locId, form })}
            projetNom={projet.nom ?? ''}
            visiteLabel={visitProjet.visiteNom || (visitProjet.dateVisite ? new Date(visitProjet.dateVisite).toLocaleDateString('fr-FR') : '')}
            visiteDate={visitProjet.dateVisite || null}
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
            autoAnnot={!!modal.autoAnnot}
            annotIdx={modal.annotIdx ?? null}
            onClose={() => modal.returnToNiveaux ? setModal({ t:'niveaux' }) : setModal(null)}
            onSave={({ planId, planBg, planData, planAnnotations, extraPlans }) => {
              const prevLoc = visitProjet.localisations.find(l => l.id === modal.locId);
              const planChanged = prevLoc?.planId !== planId || prevLoc?.planBg !== planBg;
              patchLoc(modal.locId, { planId: planId||null, planBg, planData, planAnnotations, extraPlans: extraPlans||[], _planDirty: planChanged });
              modal.returnToNiveaux ? setModal({ t:'niveaux' }) : setModal(null);
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
          onPickPlan={(locId) => setModal({ t:'plan', locId, returnToNiveaux: true })}
          onDeletePlan={id => onUpdate({ planLibrary: (projet.planLibrary || []).filter(p => p.id !== id) })}
          onDeleteAllPlans={() => onUpdate({ planLibrary: [] })}
          onRenamePlan={(id, nom) => onUpdate({ planLibrary: (projet.planLibrary || []).map(p => p.id === id ? { ...p, nom } : p) })}
        />
      )}
    </div>
  );
}
