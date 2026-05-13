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
import NiveauxModal from '../vue/NiveauxModal.jsx';
import Annotator from '../vue/Annotator.jsx';

// Champs qui appartiennent à une visite (pas au projet)
const VISIT_FIELDS = new Set([
  'localisations','dateVisite','participants','tableauRecap',
  'photosParLigne','plansEnFin','rapportPageBreaks','includeTableauRecap',
  'includeConclusion','conclusion',
]);

export default function VueProjet({ projet, visiteId, onBack, onUpdate, setBackHandler }) {
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
                <span style={{ fontSize:12, fontWeight:600 }}>Visites</span>
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
                  <button onClick={() => { setEditingProjetNom(true); setProjetNomVal(projet.nom || ''); }}
                    style={{ background:'none', border:'none', padding:0, cursor:'pointer', textAlign:'left', width:'100%', overflow:'hidden' }}>
                    <p style={{ fontWeight:800, fontSize:15, color:'white', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textDecoration:'underline dotted rgba(255,255,255,0.3)', textUnderlineOffset:3 }}>{projet.nom}</p>
                  </button>
                )}
                {projet.adresse && <p style={{ fontSize:11, color:'rgba(255,255,255,0.4)', margin:'2px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.adresse}</p>}
              </div>
            </div>

            <div style={{ position:'absolute', left:'50%', transform:'translateX(-50%)', display:'flex', alignItems:'stretch', gap:4, padding:'0 8px', height:'100%' }}>
              {[
                { k:'visite',  n:'bld', l:'Visite' },
                { k:'rapport', n:'fil', l:`Rapport${totalItems > 0 ? ` (${totalItems})` : ''}` },
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
                  <span style={{ fontSize:12, fontWeight:800 }}>Niveaux</span>
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
                    style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:6, padding:'3px 8px', color:'rgba(255,255,255,0.75)', fontSize:11, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:4, maxWidth:130, overflow:'hidden' }}>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.label ?? 'Visite'}</span>
                    {v.dateVisite && <span style={{ opacity:0.5, fontWeight:500, flexShrink:0 }}>· {formatDate(v.dateVisite)}</span>}
                  </button>
                );
              })()}
              {tab !== 'rapport' && (
                <button onClick={() => setModal({ t:'niveaux' })}
                  style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, padding:'5px 9px', color:'rgba(255,255,255,0.75)', cursor:'pointer', display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
                  <Ic n="bld" s={14}/>
                  <span style={{ fontSize:11, fontWeight:700 }}>Niveaux</span>
                </button>
              )}
            </div>
            <div style={{ borderTop:'1px solid rgba(255,255,255,0.08)', marginTop:8 }}>
              <div style={{ display:'flex' }}>
                {[
                  { k:'visite',  n:'bld', l:'Visite' },
                  { k:'rapport', n:'fil', l:`Rapport${totalItems > 0 ? ` (${totalItems})` : ''}` },
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
                  <SortList
                    locs={visitProjet.localisations}
                    openLocIds={openLocIds}
                    onToggleLoc={toggleLoc}
                    onAddLoc={addLoc}
                    onDeleteLoc={deleteLoc}
                    onMoveLoc={moveZone}
                    onPatchLoc={patchLoc}
                    onSaveItem={saveItem}
                    onDeleteItem={deleteItem}
                    onOpenAnnot={(locId, form) => setModal({ t:'annotate', locId, form })}
                    onOpenPhotoAnnot={(locId, item, photoIdx) => setModal({ t:'photoAnnot', item, locId, photoIdx })}
                    onOpenPlanLoc={(locId) => setModal({ t:'planLoc', locId })}
                  />
                  <button onClick={addLoc}
                    style={{ width:'100%', padding:16, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize:15, fontWeight:700, color:'white', background:DA.red, border:'none', borderRadius:10, cursor:'pointer', boxShadow:'0 2px 8px rgba(227,5,19,0.25)' }}>
                    <Ic n="pls" s={18}/> Ajouter une zone
                  </button>
                </>
              )}
            </div>
          )}

          {tab === 'rapport' && (
            <RapportTab
              projet={visitProjet}
              onUpdate={onUpdateVisit}
            />
          )}

        </div>
      </div>

      {modal?.t === 'item' && (
        <ItemModal
          item={modal.item}
          planBg={visitProjet.localisations.find(l => l.id === modal.locId)?.planBg}
          planAnnotations={visitProjet.localisations.find(l => l.id === modal.locId)?.planAnnotations}
          onClose={() => setModal(null)}
          onSave={(form) => { saveItem(modal.locId, form); setModal(null); }}
          onOpenAnnot={(form) => setModal({ t:'annotate', locId:modal.locId, form, savedForm:form })}
        />
      )}
      {modal?.t === 'planLoc' && (
        <PlanLocModal
          loc={visitProjet.localisations.find(l => l.id === modal.locId)}
          planLibrary={projet.planLibrary || []}
          onClose={() => setModal(null)}
          onSave={(patch) => { patchLoc(modal.locId, patch); setModal(null); }}
          onOpenPlanLibrary={() => setModal({ ...modal, t:'planLibrary' })}
        />
      )}
      {modal?.t === 'planLibrary' && (
        <PlanLibraryModal
          planLibrary={projet.planLibrary || []}
          onClose={() => setModal({ ...modal, t:'planLoc' })}
          onSave={(lib) => onUpdate({ planLibrary: lib })}
        />
      )}
      {modal?.t === 'niveaux' && (
        <NiveauxModal
          localisations={visitProjet.localisations}
          onClose={() => setModal(null)}
          onApply={(locs) => { onUpdateVisit({ localisations: locs }); setModal(null); }}
        />
      )}

      {undoToast && (
        <div style={{ position:'fixed', bottom:72, left:'50%', transform:'translateX(-50%)', background:'rgba(30,30,30,0.95)', color:'white', padding:'10px 16px', borderRadius:10, fontSize:13, fontWeight:600, boxShadow:'0 4px 20px rgba(0,0,0,0.3)', zIndex:9999, display:'flex', alignItems:'center', gap:10, maxWidth:'90vw' }}>
          <span style={{ flex:1 }}>{undoToast.label}</span>
          <button onClick={() => { undoToast.onUndo(); setUndoToast(null); }} style={{ background:'rgba(255,255,255,0.15)', border:'none', borderRadius:6, color:'white', fontSize:12, fontWeight:700, padding:'4px 10px', cursor:'pointer', flexShrink:0 }}>Annuler</button>
        </div>
      )}
    </div>
  );
}
