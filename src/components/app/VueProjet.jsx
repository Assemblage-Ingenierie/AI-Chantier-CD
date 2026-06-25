import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 900;
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { savePlanBgNow } from '../../lib/storage.js';
import EditTitle from '../ui/EditTitle.jsx';
import SortList from '../vue/SortList.jsx';
import ItemModal from '../vue/ItemModal.jsx';
import RapportTab from '../vue/RapportTab.jsx';
import PlanLibraryModal from '../vue/PlanLibraryModal.jsx';
import PlanLocModal from '../vue/PlanLocModal.jsx';
import PlanDragBar from '../vue/PlanDragBar.jsx';
import NiveauxModal from '../vue/NiveauxModal.jsx';
import Annotator, { drawAnnotationPaths } from '../vue/Annotator.jsx';
import { computeVpNumbering, relabelViewpoints } from '../../lib/vpNumbering.js';
import { subscribePendingUploads } from '../../lib/photoUploadQueue.js';

// Badge « X photos en attente d'envoi » — visible tant que la file d'upload n'est pas vide,
// pour savoir sur site s'il reste des photos à pousser vers le serveur avant de ranger le
// téléphone. À zéro = tout est sur Supabase, les autres appareils verront les photos.
function PendingPhotosBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => subscribePendingUploads(setCount), []);
  if (count <= 0) return null;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 9px', borderRadius:8,
      background:'rgba(251,191,36,0.15)', border:'1px solid rgba(251,191,36,0.4)', flexShrink:0 }}>
      <Ic n="spn" s={10}/>
      <span style={{ fontSize:10, fontWeight:700, color:'#FCD34D', whiteSpace:'nowrap' }}>
        {count} photo{count > 1 ? 's' : ''} en attente
      </span>
    </div>
  );
}

// Compare two plan background URLs ignoring signed-URL query params (token expiry).
// Two locs are on the same physical plan only if their planBg points to the same file.
function samePlan(bg1, bg2) {
  if (!bg1 || !bg2) return false;
  if (bg1 === bg2) return true;
  try {
    const p1 = new URL(bg1).pathname;
    const p2 = new URL(bg2).pathname;
    return p1.length > 1 && p1 === p2;
  } catch { return false; }
}

async function rotateBg90CW(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.naturalHeight;
      cv.height = img.naturalWidth;
      const ctx = cv.getContext('2d');
      ctx.translate(cv.width / 2, cv.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      resolve(cv.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Aperçu d'un plan dans l'onglet visite.
//  • Sans annotation → simple <img> (décodage asynchrone, non bloquant).
//  • Avec annotations → redessin sur canvas depuis les paths + numérotation Vxx GLOBALE.
//    Indispensable car (a) l'image `exported` est retirée à la sauvegarde Supabase
//    (les marqueurs disparaîtraient après rechargement) et (b) ses labels Vxx seraient
//    locaux au plan → doublons. Le redessin garantit marqueurs visibles + numéros uniques.
function PlanAnnotThumb({ bg, annotations, style, vpNumByPath = null, vpBase = 0 }) {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const paths = annotations?.paths;
  const hasVp = !!(paths && paths.length);

  useEffect(() => {
    if (!bg || !hasVp) { setReady(false); return; }
    let cancelled = false;
    setReady(false);
    const draw = (srcW, srcH, srcImg) => {
      if (cancelled) return;
      const cv = canvasRef.current;
      if (!cv) return;
      const CW = Math.min(srcW || 1400, 1600);
      const k = CW / (srcW || CW);
      cv.width = CW;
      cv.height = Math.round((srcH || CW) * k);
      const ctx = cv.getContext('2d');
      ctx.drawImage(srcImg, 0, 0, cv.width, cv.height);
      ctx.save();
      ctx.scale(k, k);
      const labeled = relabelViewpoints(paths, vpNumByPath, vpBase);
      drawAnnotationPaths(ctx, labeled, Math.max(0.5, (srcW || 1400) / 1400));
      ctx.restore();
      setReady(true);
    };
    (async () => {
      // Décodage non bloquant via createImageBitmap (off-main-thread) ; repli sur <img>.
      try {
        if (typeof createImageBitmap === 'function') {
          const blob = await (await fetch(bg)).blob();
          if (cancelled) return;
          const bmp = await createImageBitmap(blob);
          if (cancelled) { bmp.close?.(); return; }
          draw(bmp.width, bmp.height, bmp);
          bmp.close?.();
          return;
        }
      } catch { /* repli ci-dessous */ }
      const img = new Image();
      img.onload = () => draw(img.naturalWidth, img.naturalHeight, img);
      img.src = bg;
    })();
    return () => { cancelled = true; };
  }, [bg, paths, vpNumByPath, vpBase, hasVp]);

  if (!hasVp) {
    return <img src={bg} alt="" decoding="async" style={{ ...style, objectFit:'contain', display:'block' }} />;
  }
  return (
    <>
      {/* Placeholder instantané : uniquement l'image pré-composée légère (1400px) si présente.
          Sans elle, on évite de décoder le bg 4500px deux fois → simple fond neutre. */}
      {!ready && (annotations?.exported
        ? <img src={annotations.exported} alt="" decoding="async" style={{ ...style, objectFit:'contain', display:'block' }} />
        : <div style={{ ...style, background:DA.grayXL }} />)}
      <canvas ref={canvasRef} style={{ ...style, objectFit:'contain', display: ready ? 'block' : 'none' }} />
    </>
  );
}

// Champs qui appartiennent à une visite (pas au projet)
const VISIT_FIELDS = new Set([
  'localisations','dateVisite','participants','tableauRecap',
  'photosParLigne','plansEnFin','plansNoBreak','rapportPageBreaks','includeTableauRecap',
  'includeConclusion','conclusion','conclusionAlign','ingenieur',
]);

export default function VueProjet({ projet, visiteId, onBack, onUpdate, onDeletePlan = null, setBackHandler, syncStatus = 'ok', onRefresh = null, refreshing = false }) {
  const visites = projet.visites || [];
  const [selectedVisiteId, setSelectedVisiteId] = useState(() => visiteId ?? visites[0]?.id ?? null);
  const [tab, setTab] = useState('visite');
  const [modal, setModal] = useState(null);
  const modalRef = useRef(null);
  const itemModalBackRef = useRef(null); // handler interne de ItemModal (photo/plan annotateur, zoom)
  useEffect(() => { modalRef.current = modal; }, [modal]);

  useEffect(() => {
    if (!setBackHandler) return;
    setBackHandler(() => {
      const m = modalRef.current;
      if (!m) return false;
      if (m.t === 'annotate') {
        setModal({ t:'item', locId:m.locId, item:m.form, savedForm:m.form });
      } else if (m.t === 'item') {
        // Vérifie si ItemModal a un overlay interne à fermer d'abord
        if (itemModalBackRef.current?.()) return true;
        setModal(null);
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
    plansNoBreak:        selectedVisite?.plansNoBreak         ?? false,
    rapportPageBreaks:   selectedVisite?.rapportPageBreaks    ?? [],
    includeTableauRecap: selectedVisite?.includeTableauRecap  !== false,
    includeConclusion:   selectedVisite?.includeConclusion    ?? false,
    conclusion:          selectedVisite?.conclusion           ?? '',
    visiteNom:           selectedVisite?.label                 ?? '',
    ingenieur:           selectedVisite?.ingenieur             ?? '',
  }), [projet, selectedVisite]);

  // Numérotation Vxx globale sur toute la visite — partagée par les miniatures de plan et
  // l'annotateur. Garantit un seul V1, un seul V2, etc. quel que soit le plan ou l'onglet.
  const { vpNumByPath: vpNumGlobal, max: vpMaxGlobal } = useMemo(
    () => computeVpNumbering(visitProjet.localisations),
    [visitProjet.localisations]
  );

  const onUpdateVisit = useCallback((upd) => {
    const visitUpd   = {};
    const projectUpd = {};
    for (const [k, v] of Object.entries(upd)) {
      if (VISIT_FIELDS.has(k)) visitUpd[k] = v;
      else projectUpd[k] = v;
    }
    // Mise à jour FONCTIONNELLE : on recompose les visites à partir de l'état le plus récent
    // (prev), pas du prop `projet` (qui peut être périmé si une autre mise à jour de champ de
    // visite vient juste d'avoir lieu — ex : récap auto-généré écrasant les participants).
    if (Object.keys(visitUpd).length > 0) {
      onUpdate(prev => ({
        ...projectUpd,
        visites: (prev.visites || []).map(v =>
          v.id === selectedVisiteId ? { ...v, ...visitUpd } : v
        ),
      }));
    } else {
      onUpdate(projectUpd);
    }
  }, [selectedVisiteId, onUpdate]);

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
    if (loc.planId || loc.planBg) all.push({ planId: loc.planId||null, planBg: loc.planBg||null, planData: loc.planData||null, planAnnotations: loc.planAnnotations||null, reportHidden: !!loc.planReportHidden });
    for (const ep of (loc.extraPlans || [])) all.push({ planId: ep.planId||null, planBg: ep.planBg||null, planData: null, planAnnotations: ep.planAnnotations||null, reportHidden: !!ep.reportHidden });
    if (toIdx >= all.length) return;
    const [moved] = all.splice(fromIdx, 1);
    all.splice(toIdx, 0, moved);
    const [p, ...extras] = all;
    patchLoc(locId, {
      planId: p?.planId||null, planBg: p?.planBg||null, planData: p?.planData||null, planAnnotations: p?.planAnnotations||null,
      planReportHidden: !!p?.reportHidden,
      extraPlans: extras.map(e => ({ planId: e.planId, planBg: e.planBg, planAnnotations: e.planAnnotations, reportHidden: !!e.reportHidden })),
    });
  }, [visitProjet.localisations, patchLoc]);

  const onZoneDragEnd = useCallback(() => {
    if (zoneDragDidMove.current && zoneDragIdx !== null && zoneOverIdx !== null) {
      moveZone(zoneDragIdx, zoneOverIdx);
    }
    setZoneDragIdx(null); setZoneOverIdx(null); zoneDragDidMove.current = false;
  }, [zoneDragIdx, zoneOverIdx, moveZone]);

  // Réordonnancement TACTILE des zones (le drag HTML5 ne marche pas au doigt — mobile est la
  // plateforme principale, cf. CLAUDE.md Règle N°4). On suit le doigt depuis la poignée et on
  // calcule la zone survolée par rapport au milieu de chaque carte mesurée dans le DOM.
  const zoneNodesRef = useRef(new Map()); // locIdx → élément DOM de la carte
  const zoneTouch = useRef(null);
  const startZoneTouch = useCallback((e, idx) => {
    zoneDragDidMove.current = false;
    zoneTouch.current = { from: idx, overIdx: idx };
    setZoneDragIdx(idx); setZoneOverIdx(idx);
    const onMove = (ev) => {
      const t = ev.touches[0]; if (!t) return;
      ev.preventDefault(); // touchAction:'none' sur la poignée → pas de scroll parasite
      zoneDragDidMove.current = true;
      let over = idx;
      const entries = [...zoneNodesRef.current.entries()].sort((a, b) => a[0] - b[0]);
      for (const [i, el] of entries) {
        const r = el.getBoundingClientRect();
        if (t.clientY < r.top + r.height / 2) { over = i; break; }
        over = i;
      }
      zoneTouch.current.overIdx = over;
      setZoneOverIdx(over);
    };
    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      const st = zoneTouch.current; zoneTouch.current = null;
      if (zoneDragDidMove.current && st && st.from !== st.overIdx) moveZone(st.from, st.overIdx);
      setZoneDragIdx(null); setZoneOverIdx(null); zoneDragDidMove.current = false;
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }, [moveZone]);

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

  // Déplace une photo d'une observation vers une autre (même zone ou autre zone). La photo
  // garde son objet (donc son _id stable) → côté Supabase l'upsert met simplement à jour
  // item_id ; la purge de l'observation source ne la supprime pas (sa ligne pointe désormais
  // vers la destination). Les deux observations sont marquées _photosHydrated pour être sauvées.
  const movePhoto = useCallback((fromLocId, fromItemId, photoIdx, toLocId, toItemId) => {
    const fromLoc = visitProjet.localisations.find(l => l.id === fromLocId);
    const fromItem = fromLoc?.items?.find(i => i.id === fromItemId);
    const photo = fromItem?.photos?.[photoIdx];
    if (!photo) return;
    const locs = visitProjet.localisations.map(l => {
      let items = l.items || [];
      let changed = false;
      if (l.id === fromLocId) {
        items = items.map(i => i.id === fromItemId
          ? { ...i, _photosHydrated: true, photos: (i.photos || []).filter((_, idx) => idx !== photoIdx) } : i);
        changed = true;
      }
      if (l.id === toLocId) {
        items = items.map(i => i.id === toItemId
          ? { ...i, _photosHydrated: true, photos: [...(i.photos || []), photo] } : i);
        changed = true;
      }
      return changed ? { ...l, items } : l;
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

  // Suppression de zone : retrait immédiat + toast « Annuler » (même pattern sûr que la
  // suppression d'observation) — remplace le window.confirm bloquant, jarring sur mobile.
  const deleteLoc = (locId, nom) => {
    const prevLocs = visitProjet.localisations;
    onUpdateVisit({ localisations: prevLocs.filter(l => l.id !== locId) });
    showUndo(`Zone « ${nom || 'sans nom'} » supprimée`, () => onUpdateVisit({ localisations: prevLocs }));
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
  const [confirmDelPhotoAnnot, setConfirmDelPhotoAnnot] = useState(false); // confirmation suppression photo depuis l'annotateur

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
        ? { ...item, _photosHydrated: true, photos: item.photos.map((p, i) => i === photoIdx ? { ...p, annotations: annotation.paths, annotated: annotation.annotated, annotW: annotation.annotW, annotH: annotation.annotH, annotSizeScale: annotation.annotSizeScale ?? null } : p) }
        : item;
      if (annotation) patchItem(locId, updatedItem);
      setModal({ t: 'photoAnnot', item: updatedItem, locId, photoIdx: newRealIdx });
    };

    // Navigation préc/suiv parmi les photos valides (flèches + touches ←/→).
    const validIdxs = (item.photos || []).map((p, i) => (p.data ? i : -1)).filter(i => i >= 0);
    const navPos = validIdxs.indexOf(photoIdx);
    const prevRealIdx = navPos > 0 ? validIdxs[navPos - 1] : null;
    const nextRealIdx = navPos >= 0 && navPos < validIdxs.length - 1 ? validIdxs[navPos + 1] : null;

    // Suppression de la photo affichée (après confirmation) directement depuis l'annotateur.
    const deleteCurrentPhoto = () => {
      const remaining = (item.photos || []).filter((_, i) => i !== photoIdx);
      const updatedItem = { ...item, _photosHydrated: true, photos: remaining };
      patchItem(locId, updatedItem);
      setConfirmDelPhotoAnnot(false);
      const firstValid = remaining.findIndex(p => p.data);
      if (firstValid === -1) { setModal(null); return; }
      let newIdx = Math.min(photoIdx, remaining.length - 1);
      if (!remaining[newIdx]?.data) newIdx = firstValid;
      setModal({ t: 'photoAnnot', item: updatedItem, locId, photoIdx: newIdx });
    };

    return (
      <>
        <Annotator
          ref={annotatorRef}
          bgImage={ph?.data}
          savedPaths={ph?.annotations || []}
          onPrev={prevRealIdx !== null ? () => switchToPhoto(prevRealIdx) : null}
          onNext={nextRealIdx !== null ? () => switchToPhoto(nextRealIdx) : null}
          photoPosition={validIdxs.length > 1 ? `${navPos + 1} / ${validIdxs.length}` : null}
          onSave={(paths, exported, dims) => {
            const updatedItem = {
              ...item,
              _photosHydrated: true,
              photos: item.photos.map((p, i) => i === photoIdx ? { ...p, annotations: paths, annotated: exported, annotW: dims?.w, annotH: dims?.h, annotSizeScale: dims?.annotSizeScale ?? null } : p),
            };
            patchItem(locId, updatedItem);
            setConfirmDelPhotoAnnot(false);
            setModal(null);
          }}
          onClose={() => { setConfirmDelPhotoAnnot(false); setModal(null); }}
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

        {/* Supprimer la photo affichée — placé AU-DESSUS de la bande de miniatures quand
            celle-ci est visible (sinon il chevauchait les premières miniatures avec bcp de photos).
            Sans bande (1 seule photo) : en bas-gauche comme avant. */}
        <button onClick={() => setConfirmDelPhotoAnnot(true)} title="Supprimer cette photo"
          style={{ position:'fixed', bottom: validPhotos.length > 1 ? 80 : 10, left:12, zIndex:101, display:'flex', alignItems:'center', gap:6,
            background:'rgba(227,5,19,0.92)', color:'#fff', border:'none', borderRadius:10, padding:'9px 14px',
            fontSize:13, fontWeight:700, cursor:'pointer', boxShadow:'0 2px 10px rgba(0,0,0,0.4)' }}>
          <Ic n="del" s={16}/> Supprimer
        </button>

        {confirmDelPhotoAnnot && (
          <div onClick={() => setConfirmDelPhotoAnnot(false)}
            style={{ position:'fixed', inset:0, zIndex:120, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background:'#fff', borderRadius:14, padding:22, maxWidth:340, width:'100%', boxShadow:'0 8px 30px rgba(0,0,0,0.5)' }}>
              <p style={{ margin:'0 0 6px', fontWeight:800, fontSize:16, color:DA.black }}>Supprimer cette photo ?</p>
              <p style={{ margin:'0 0 18px', fontSize:13, color:DA.gray, lineHeight:1.4 }}>
                La photo et ses annotations seront définitivement retirées de cette observation.
              </p>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button onClick={() => setConfirmDelPhotoAnnot(false)}
                  style={{ padding:'9px 16px', borderRadius:9, border:`1px solid ${DA.border}`, background:'#fff', color:DA.black, fontSize:13, fontWeight:700, cursor:'pointer' }}>
                  Annuler
                </button>
                <button onClick={deleteCurrentPhoto}
                  style={{ padding:'9px 16px', borderRadius:9, border:'none', background:DA.red, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                  Supprimer
                </button>
              </div>
            </div>
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

      <div style={{ background:DA.black, flexShrink:0, paddingTop:'env(safe-area-inset-top, 0px)' }}>

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
              {onRefresh && (
                <button onClick={onRefresh} disabled={refreshing}
                  style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:6, color:'rgba(255,255,255,0.65)', padding:'5px 8px', cursor:refreshing?'default':'pointer', display:'flex', alignItems:'center', gap:3, flexShrink:0 }}>
                  {refreshing ? <Ic n="spn" s={11}/> : <Ic n="rld" s={11}/>}
                  <span style={{ fontSize:10, fontWeight:600 }}>Actu.</span>
                </button>
              )}
              <PendingPhotosBadge/>
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
                    // Ignore les références orphelines (plan supprimé) → pas de tuile « Plan » vide fantôme.
                    if (loc.planBg || (loc.planId && assignedPlan)) {
                      allPlanThumbs.push({ bg: loc.planBg || assignedPlan?.bg || null, planAnnotations: loc.planAnnotations, nom: assignedPlan?.nom || 'Plan de zone', reportHidden: !!loc.planReportHidden, planId: loc.planId });
                    }
                    for (const ep of (loc.extraPlans || [])) {
                      const epLib = (projet.planLibrary||[]).find(p => p.id === ep.planId);
                      if (!ep.planBg && !epLib) continue; // orphelin
                      allPlanThumbs.push({ bg: ep.planBg || epLib?.bg || null, planAnnotations: ep.planAnnotations, nom: epLib?.nom || 'Plan', reportHidden: !!ep.reportHidden, planId: ep.planId });
                    }
                    const hasAnyPlan = allPlanThumbs.length > 0;
                    return (
                      <div key={loc.id}
                        ref={el => { if (el) zoneNodesRef.current.set(locIdx, el); else zoneNodesRef.current.delete(locIdx); }}
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
                            onTouchStart={e => startZoneTouch(e, locIdx)}
                            style={{ flexShrink:0, padding:'10px 8px', margin:'-4px', cursor:'grab', color:'#bbb', display:'flex', alignItems:'center', touchAction:'none' }}>
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
                              onReorderPhoto={(item, photos) => {
                                patchItem(loc.id, { ...item, photos, _photosHydrated: true });
                              }}
                              onMovePhoto={(item, photoIdx) => setModal({ t:'movePhoto', locId: loc.id, item, photoIdx })}
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
                                        const globalIdx = rowIdx * 2 + colIdx;
                                        const hasPrimary = !!(loc.planId || loc.planBg);
                                        const toggleReportHidden = (e) => {
                                          e.stopPropagation();
                                          if (globalIdx === 0 && hasPrimary) {
                                            patchLoc(loc.id, { planReportHidden: !loc.planReportHidden });
                                          } else {
                                            const epIdx = hasPrimary ? globalIdx - 1 : globalIdx;
                                            const newEPs = (loc.extraPlans||[]).map((ep, i) =>
                                              i === epIdx ? { ...ep, reportHidden: !ep.reportHidden } : ep
                                            );
                                            patchLoc(loc.id, { extraPlans: newEPs });
                                          }
                                        };
                                        return (
                                          <button key={colIdx}
                                            onClick={() => setModal({ t:'plan', locId:loc.id, annotIdx: rowIdx * 2 + colIdx })}
                                            style={{ flex:1, position:'relative', height: thumbH, border:'none', borderLeft: colIdx > 0 ? `1px solid ${DA.border}` : 'none', cursor:'pointer', overflow:'hidden', display:'block', padding:0, background: pt.bg ? '#f4f4f4' : DA.grayXL }}>
                                            {pt.bg ? (
                                              <PlanAnnotThumb bg={pt.bg} annotations={pt.planAnnotations} vpNumByPath={vpNumGlobal} vpBase={vpMaxGlobal} style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}/>
                                            ) : (
                                              <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6, color:DA.grayL }}>
                                                <Ic n="map" s={24}/>
                                                <span style={{ fontSize:10, fontWeight:700, color:DA.gray, textAlign:'center', padding:'0 6px' }}>{pt.nom}</span>
                                              </div>
                                            )}
                                            {pt.reportHidden && (
                                              <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.42)', zIndex:1, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
                                                <span style={{ color:'white', fontSize:10, fontWeight:700, background:'rgba(0,0,0,0.55)', padding:'3px 8px', borderRadius:6 }}>Masqué du rapport</span>
                                              </div>
                                            )}
                                            {pt.bg && <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.05) 40%, transparent 100%)' }}/>}
                                            {annotCount > 0 && (
                                              <div style={{ position:'absolute', top:6, right:6, zIndex:2, background:DA.red, color:'white', borderRadius:8, fontSize:10, fontWeight:800, padding:'2px 6px', lineHeight:1.6, display:'flex', alignItems:'center', gap:3 }}>
                                                <Ic n="pen" s={9}/> {annotCount}
                                              </div>
                                            )}
                                            <div style={{ position:'absolute', top:6, left:6, zIndex:2, display:'flex', gap:4 }}>
                                              <button onClick={toggleReportHidden}
                                                title={pt.reportHidden ? 'Afficher dans le rapport' : 'Masquer du rapport'}
                                                aria-label={pt.reportHidden ? 'Afficher le plan dans le rapport' : 'Masquer le plan du rapport'}
                                                style={{ background: pt.reportHidden ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.85)', border:'none', borderRadius:6, width:34, height:34, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color: pt.reportHidden ? '#bbb' : DA.gray, padding:0 }}>
                                                <Ic n="eye" s={14}/>
                                              </button>
                                              {pt.bg && (
                                                <button
                                                  title="Pivoter le plan 90° à droite"
                                                  aria-label="Pivoter le plan 90 degrés à droite"
                                                  onClick={async (e) => {
                                                    e.stopPropagation();
                                                    const rotated = await rotateBg90CW(pt.bg);
                                                    const newLibrary = (projet.planLibrary || []).map(pl =>
                                                      pl.id === pt.planId ? { ...pl, bg: rotated } : pl
                                                    );
                                                    const newVisites = (projet.visites || []).map(v => ({
                                                      ...v,
                                                      localisations: (v.localisations || []).map(l => ({
                                                        ...l,
                                                        planBg: l.planId === pt.planId ? rotated : l.planBg,
                                                        extraPlans: (l.extraPlans || []).map(ep =>
                                                          ep.planId === pt.planId ? { ...ep, planBg: rotated } : ep
                                                        ),
                                                      })),
                                                    }));
                                                    onUpdate({ planLibrary: newLibrary, visites: newVisites });
                                                  }}
                                                  style={{ background:'rgba(255,255,255,0.85)', border:'none', borderRadius:6, width:34, height:34, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:DA.gray, padding:0 }}>
                                                  <Ic n="rotc" s={14}/>
                                                </button>
                                              )}
                                            </div>
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
          {undoToast.onUndo && (
            <button onClick={() => { undoToast.onUndo(); setUndoToast(null); clearTimeout(undoTimerRef.current); }}
              style={{ background:DA.red, color:'white', border:'none', borderRadius:7, padding:'4px 10px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
              Annuler
            </button>
          )}
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
            vpNumByPath={vpNumGlobal}
            vpBase={vpMaxGlobal}
            onClose={() => { itemModalBackRef.current = null; setModal(null); }}
            onSave={form => { itemModalBackRef.current = null; saveItem(modal.locId, { ...form, id: form.id || crypto.randomUUID() }); setModal(null); }}
            onOpenAnnot={form => setModal({ t:'annotate', locId:modal.locId, form })}
            onBackRequest={fn => { itemModalBackRef.current = fn; }}
            projetNom={projet.nom ?? ''}
            projetId={projet.id ?? null}
            visiteLabel={visitProjet.visiteNom || (visitProjet.dateVisite ? new Date(visitProjet.dateVisite).toLocaleDateString('fr-FR') : '')}
            visiteDate={visitProjet.dateVisite || null}
            ingenieur={visitProjet.ingenieur || ''}
          />
        );
      })()}

      {modal?.t === 'plan' && (() => {
        const loc = visitProjet.localisations.find(l => l.id === modal.locId);
        // Merge annotations from ALL locs sharing the same planId.
        // Deduplication by JSON string prevents doubling when locs are already in sync after a propagation save.
        const allLocsFlat = (projet.visites || []).flatMap(v => v.localisations || []);
        let mergedAnnotations = loc?.planAnnotations ?? null;
        if (loc?.planId) {
          const otherLocs = allLocsFlat.filter(
            l => l.id !== modal.locId && l.planId === loc.planId && samePlan(l.planBg, loc.planBg) && l.planAnnotations?.paths?.length
          );
          if (otherLocs.length > 0) {
            const ownPaths = loc?.planAnnotations?.paths || [];
            const seen = new Set(ownPaths.map(p => JSON.stringify(p)));
            const foreign = otherLocs.flatMap(l => l.planAnnotations.paths)
              .filter(p => !seen.has(JSON.stringify(p)));
            if (foreign.length > 0) {
              // Renumber VP labels sequentially to avoid collisions from independent annotations
              let vpIdx = 1;
              const mergedPaths = [...ownPaths, ...foreign].map(p =>
                p.type === 'viewpoint' ? { ...p, label: `V${vpIdx++}` } : p
              );
              mergedAnnotations = { ...(loc?.planAnnotations || {}), paths: mergedPaths };
            }
          }
        }
        const locForModal = mergedAnnotations && mergedAnnotations !== loc?.planAnnotations
          ? { ...loc, planAnnotations: mergedAnnotations }
          : loc;
        return (
          <PlanLocModal
            loc={locForModal}
            items={loc?.items || []}
            planLibrary={projet.planLibrary || []}
            autoAnnot={!!modal.autoAnnot}
            annotIdx={modal.annotIdx ?? null}
            vpNumByPath={vpNumGlobal}
            vpBase={vpMaxGlobal}
            onClose={() => modal.returnToNiveaux ? setModal({ t:'niveaux' }) : setModal(null)}
            onSave={({ planId, planBg, planData, planAnnotations, extraPlans }) => {
              const prevLoc = visitProjet.localisations.find(l => l.id === modal.locId);
              const planChanged = prevLoc?.planId !== planId || prevLoc?.planBg !== planBg;
              // Build annotation map: planId → { planAnnotations, planBg }
              // planBg is stored so that propagation is gated on samePlan() — prevents cross-plan contamination
              // when two unrelated zones accidentally share the same planId.
              const annotByPlanId = new Map();
              if (planId) annotByPlanId.set(planId, { planAnnotations: planAnnotations ?? null, planBg: planBg ?? null });
              for (const ep of (extraPlans || [])) {
                if (ep.planId) annotByPlanId.set(ep.planId, { planAnnotations: ep.planAnnotations ?? null, planBg: ep.planBg ?? null });
              }
              // Update all visites: full update for target loc + propagate annotations to all
              // other locs that share the same planId AND the same plan image.
              const updatedVisites = (projet.visites || []).map(v => ({
                ...v,
                localisations: (v.localisations || []).map(l => {
                  if (l.id === modal.locId) {
                    return { ...l, planId: planId||null, planBg, planData, planAnnotations, extraPlans: extraPlans||[], _planDirty: planChanged };
                  }
                  let updated = l;
                  if (l.planId && annotByPlanId.has(l.planId)) {
                    const entry = annotByPlanId.get(l.planId);
                    if (samePlan(l.planBg, entry.planBg)) {
                      updated = { ...updated, planAnnotations: entry.planAnnotations };
                    }
                  }
                  const newEPs = (l.extraPlans || []).map(ep => {
                    if (!ep.planId || !annotByPlanId.has(ep.planId)) return ep;
                    const entry = annotByPlanId.get(ep.planId);
                    return samePlan(ep.planBg, entry.planBg) ? { ...ep, planAnnotations: entry.planAnnotations } : ep;
                  });
                  if (newEPs.some((ep, i) => ep !== (l.extraPlans || [])[i])) {
                    updated = { ...updated, extraPlans: newEPs };
                  }
                  return updated;
                }),
              }));
              onUpdate({ visites: updatedVisites });
              modal.returnToNiveaux ? setModal({ t:'niveaux' }) : setModal(null);
            }}
            onDeletePlan={id => onDeletePlan ? onDeletePlan(id) : onUpdate({ planLibrary: (projet.planLibrary || []).filter(p => p.id !== id) })}
            onRenamePlan={(id, nom) => onUpdate({ planLibrary: (projet.planLibrary || []).map(p => p.id === id ? { ...p, nom } : p) })}
            onAddToLibrary={newPlans => {
              const arr = Array.isArray(newPlans) ? newPlans : [newPlans];
              onUpdate({ planLibrary: [...(projet.planLibrary || []), ...arr] });
              savePlanBgNow(projet.id, arr);
            }}
          />
        );
      })()}

      {modal?.t === 'planLib' && (
        <PlanLibraryModal
          planLibrary={projet.planLibrary || []}
          onAdd={plans => {
            const arr = Array.isArray(plans) ? plans : [plans];
            onUpdate({ planLibrary: [...(projet.planLibrary || []), ...arr] });
            savePlanBgNow(projet.id, arr);
          }}
          onDelete={id => onDeletePlan ? onDeletePlan(id) : onUpdate({ planLibrary: (projet.planLibrary || []).filter(p => p.id !== id) })}
          onRename={(id, nom) => onUpdate({ planLibrary: (projet.planLibrary || []).map(p => p.id === id ? { ...p, nom } : p) })}
          onRepairBg={(id, newBg) => {
            const pl = (projet.planLibrary || []).find(p => p.id === id);
            onUpdate({ planLibrary: (projet.planLibrary || []).map(p => p.id === id ? { ...p, bg: newBg } : p) });
            if (pl) savePlanBgNow(projet.id, [{ ...pl, bg: newBg }]);
          }}
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
          onDeletePlan={id => onDeletePlan ? onDeletePlan(id) : onUpdate({ planLibrary: (projet.planLibrary || []).filter(p => p.id !== id) })}
          onDeleteAllPlans={() => onUpdate({ planLibrary: [] })}
          onRenamePlan={(id, nom) => onUpdate({ planLibrary: (projet.planLibrary || []).map(p => p.id === id ? { ...p, nom } : p) })}
          onRepairBg={(id, newBg) => {
            const pl = (projet.planLibrary || []).find(p => p.id === id);
            onUpdate({ planLibrary: (projet.planLibrary || []).map(p => p.id === id ? { ...p, bg: newBg } : p) });
            if (pl) savePlanBgNow(projet.id, [{ ...pl, bg: newBg }]);
          }}
        />
      )}

      {modal?.t === 'movePhoto' && (() => {
        const srcPhoto = modal.item?.photos?.[modal.photoIdx];
        const srcSrc = srcPhoto?.annotated || srcPhoto?.data || null;
        return (
          <div className="modal-overlay" style={{ zIndex:120 }} onClick={() => setModal(null)}>
            <div className="modal-sheet-flex" onClick={e => e.stopPropagation()}>
              <div style={{ padding:'16px 18px 12px', borderBottom:`1px solid ${DA.border}`, flexShrink:0, display:'flex', alignItems:'center', gap:12 }}>
                {srcSrc && <img src={srcSrc} alt="" style={{ width:48, height:48, objectFit:'cover', borderRadius:8, border:`1px solid ${DA.border}`, flexShrink:0 }}/>}
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:0 }}>Déplacer la photo vers…</p>
                  <p style={{ fontSize:12, color:DA.gray, margin:'2px 0 0' }}>Choisissez l'observation de destination</p>
                </div>
                <button onClick={() => setModal(null)} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL }}><Ic n="x" s={20}/></button>
              </div>
              <div style={{ flex:1, overflowY:'auto', padding:'10px 14px' }}>
                {visitProjet.localisations.map(loc => {
                  const targets = (loc.items || []).filter(i => !(loc.id === modal.locId && i.id === modal.item.id));
                  if (!targets.length) return null;
                  return (
                    <div key={loc.id} style={{ marginBottom:12 }}>
                      <p style={{ fontSize:11, fontWeight:800, color:DA.gray, textTransform:'uppercase', letterSpacing:0.5, margin:'0 0 6px' }}>{loc.nom || 'Zone'}</p>
                      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                        {targets.map(it => {
                          const nPh = (it.photos || []).filter(p => p.data || p.storage_url).length;
                          return (
                            <button key={it.id}
                              onClick={() => {
                                movePhoto(modal.locId, modal.item.id, modal.photoIdx, loc.id, it.id);
                                setModal(null);
                                showUndo('Photo déplacée', null);
                              }}
                              style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:10, border:`1px solid ${DA.border}`, background:'white', cursor:'pointer', textAlign:'left', width:'100%' }}>
                              <div style={{ width:6, height:6, borderRadius:'50%', background:URGENCE[it.urgence]?.dot || DA.border, flexShrink:0 }}/>
                              <span style={{ flex:1, minWidth:0, fontSize:13, fontWeight:600, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                {it.titre?.trim() || '(observation sans titre)'}
                              </span>
                              <span style={{ fontSize:11, color:DA.grayL, flexShrink:0 }}>{nPh} photo{nPh !== 1 ? 's' : ''}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
