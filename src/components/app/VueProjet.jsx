import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 900;
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { savePlanBgNow, savePlanHdNow } from '../../lib/storage.js';
import { addTombstone, liftTombstone } from '../../lib/tombstones.js';
import EditTitle from '../ui/EditTitle.jsx';
import SortList from '../vue/SortList.jsx';
import ItemModal from '../vue/ItemModal.jsx';
import RapportTab from '../vue/RapportTab.jsx';
import Costar from '../vue/Costar.jsx';
import PlanLibraryModal from '../vue/PlanLibraryModal.jsx';
import PlanLocModal from '../vue/PlanLocModal.jsx';
import PlanDragBar from '../vue/PlanDragBar.jsx';
import NiveauxModal from '../vue/NiveauxModal.jsx';
import Annotator, { drawAnnotationPaths } from '../vue/Annotator.jsx';
import { computeVpNumbering, relabelViewpoints } from '../../lib/vpNumbering.js';
import { subscribePendingUploads } from '../../lib/photoUploadQueue.js';
import { setPhotoAnnotPref } from '../../lib/photoPrefs.js';
import { useUiScale, uiScaleClass } from '../../lib/uiPrefs.js';
import { addDeletedItem, addDeletedZone } from '../../lib/recoveryBin.js';
import TrashPanel from '../vue/TrashPanel.jsx';
import ThumbImg from '../ui/ThumbImg.jsx';
import { buildVisitProjet } from '../../lib/visitProjet.js';
import { childrenOf, effectiveParentId, placeZone, zonePlanItems } from '../../lib/zoneGroups.js';
import { mergeZones, canMergeZones, moveItemToZone } from '../../lib/zoneMerge.js';

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
  const [srcImg, setSrcImg] = useState(null); // fond décodé UNE fois par `bg`, réutilisé aux redraws
  const paths = annotations?.paths;
  const hasVp = !!(paths && paths.length);

  // 1) DÉCODAGE du fond — UNIQUEMENT quand `bg` change. Avant, tout l'effet (fetch + décodage)
  //    se relançait à chaque changement de numérotation Vxx de la visite (vpNumByPath/vpBase),
  //    re-téléchargeant/re-décodant TOUTES les vignettes de plan à chaque ajout de photo/annotation.
  //    On décode donc l'image une seule fois par plan ; le redessin (étape 2) est instantané.
  useEffect(() => {
    if (!bg || !hasVp) { setSrcImg(null); return; }
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { if (!cancelled) setSrcImg({ w: img.naturalWidth, h: img.naturalHeight, img }); };
    img.onerror = () => { if (!cancelled) setSrcImg(null); };
    img.src = bg;
    return () => { cancelled = true; };
  }, [bg, hasVp]);

  // 2) DESSIN (fond décodé + annotations + numérotation Vxx) — rapide, sans re-décodage.
  useEffect(() => {
    if (!srcImg || !hasVp) { setReady(false); return; }
    const cv = canvasRef.current;
    if (!cv) return;
    const { w: srcW, h: srcH, img } = srcImg;
    const CW = Math.min(srcW || 1400, 1600);
    const k = CW / (srcW || CW);
    cv.width = CW;
    cv.height = Math.round((srcH || CW) * k);
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    ctx.save();
    ctx.scale(k, k);
    const labeled = relabelViewpoints(paths, vpNumByPath, vpBase);
    drawAnnotationPaths(ctx, labeled, Math.max(0.5, (srcW || 1400) / 1400));
    ctx.restore();
    setReady(true);
  }, [srcImg, paths, vpNumByPath, vpBase, hasVp]);

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
  'includeConclusion','conclusion','conclusionAlign','ingenieur','annexes','planPagesPaysage',
]);

export default function VueProjet({ projet, visiteId, onBack, onUpdate, onDeletePlan = null, setBackHandler, syncStatus = 'ok', onRefresh = null, refreshing = false,
  onRestoreZone = null, onRestoreObservation = null, onRestoreLostAnnots = null, onRestoreZoneAnnotations = null }) {
  const [trashOpen, setTrashOpen] = useState(false); // corbeille du projet (PC)
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

  const [editingProjetNom, setEditingProjetNom] = useState(false);
  const [projetNomVal, setProjetNomVal] = useState('');
  const uiScale = useUiScale();

  useEffect(() => {
    if (!selectedVisiteId && visites.length > 0) setSelectedVisiteId(visites[0].id);
  }, [visites]);

  const selectedVisite = useMemo(
    () => visites.find(v => v.id === selectedVisiteId) ?? visites[0] ?? null,
    [visites, selectedVisiteId]
  );

  const visitProjet = useMemo(() => buildVisitProjet(projet, selectedVisite), [projet, selectedVisite]);

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

  // ── Glisser-déposer des ZONES (par id) ──
  // Dépôt RAPIDE sur une zone = prendre sa place (réordonner, comme avant). MAINTENIR ~½ s sur
  // le TITRE d'une zone de 1er niveau = « Ranger dedans » (groupe de zones, ex. R+4 › M. Albert
  // Thomas — demande Thomas). Déposer sur une sous-zone = entrer dans son groupe ; sur une zone
  // de 1er niveau = sortir du groupe. Logique pure et testée dans lib/zoneGroups.js.
  const [zoneDragId, setZoneDragId] = useState(null);
  const [zoneOver, setZoneOver] = useState(null); // { id, onHead, into }
  const zoneOverRef = useRef(null);
  const zoneIntoTimer = useRef(null);
  // Le drag PC n'est ARMÉ que depuis la poignée ⋮⋮ (mousedown) : une tuile draggable en
  // permanence empêchait de sélectionner le texte du titre en édition — le navigateur
  // déplaçait la tuile au lieu de sélectionner (demande Thomas).
  const [zoneDragArm, setZoneDragArm] = useState(null); // id de la zone armée
  const zoneDragDidMove = useRef(false);
  // FUSION CONFIRMÉE (Thomas 13/10/2026 : « en réorganisant, j'en ai fusionné sans faire exprès ») :
  // lâcher après un maintien sur le titre d'une zone n'ARRÊTE plus rien tout seul — une bulle
  // demande « Fusionner X dans Y ? » [Juste déplacer] [Fusionner]. Rien ne fusionne sans ce clic.
  const [mergeAsk, setMergeAsk] = useState(null); // { srcId, tgtId }
  const zoneLocsRef = useRef(visitProjet.localisations);
  zoneLocsRef.current = visitProjet.localisations;

  const resetZoneDrag = useCallback(() => {
    clearTimeout(zoneIntoTimer.current);
    zoneOverRef.current = null;
    setZoneDragId(null); setZoneOver(null);
  }, []);

  const applyZoneDrop = useCallback((dragId) => {
    const over = zoneOverRef.current;
    if (!zoneDragDidMove.current || !dragId || !over || over.id === dragId) return;
    const locs = zoneLocsRef.current;
    if (over.into) { setMergeAsk({ srcId: dragId, tgtId: over.id }); return; } // confirmation obligatoire
    const next = placeZone(locs, dragId, over.id);
    if (next !== locs) onUpdateVisit({ localisations: next });
  }, [onUpdateVisit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carte de zone sous le pointeur : la plus INTERNE (sous-zone avant son groupe), jamais la zone
  // déplacée ni ses propres sous-zones. onHead = le pointeur est sur l'en-tête (titre) de la carte.
  const zoneTargetAt = (x, y, dragId) => {
    const el = typeof document !== 'undefined' ? document.elementFromPoint(x, y) : null;
    const card = el?.closest?.('[data-zone-id]');
    if (!card) return null;
    for (let n = card; n; n = n.parentElement?.closest?.('[data-zone-id]')) {
      if (n.getAttribute('data-zone-id') === dragId) return null;
    }
    const id = card.getAttribute('data-zone-id');
    const head = el.closest('[data-zone-head]');
    return { id, onHead: !!head && head.getAttribute('data-zone-head') === id };
  };

  const ZONE_INTO_MS = 550;
  const updateZoneOver = useCallback((t, dragId) => {
    if (!t) return;
    const cur = zoneOverRef.current;
    const goInto = (base) => {
      if (zoneOverRef.current !== base) return;
      const into = { ...base, into: true };
      zoneOverRef.current = into; setZoneOver(into);
      try { navigator.vibrate?.(15); } catch { /* iOS : pas de vibration */ }
    };
    if (cur && cur.id === t.id && cur.onHead === t.onHead) {
      // Inchangé. Souris : le navigateur répète dragover tant qu'on survole → on bascule en
      // « ranger dedans » dès que le maintien dure assez (le minuteur couvre le tactile immobile).
      if (cur.canInto && !cur.into && Date.now() - cur.since >= ZONE_INTO_MS) goInto(cur);
      return;
    }
    clearTimeout(zoneIntoTimer.current);
    // Maintien sur le TITRE d'une zone = FUSIONNER dedans (ses observations la rejoignent).
    const canInto = !!t.onHead && canMergeZones(zoneLocsRef.current, dragId, t.id);
    const next = { id: t.id, onHead: t.onHead, into: false, canInto, since: Date.now() };
    zoneOverRef.current = next; setZoneOver(next);
    zoneDragDidMove.current = true;
    if (canInto) zoneIntoTimer.current = setTimeout(() => goInto(next), ZONE_INTO_MS);
  }, []);

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

  // ── FUSION de zones (maintien sur le titre d'une autre zone) ──
  // Les observations partent tout de suite dans la zone cible (lib/zoneMerge.js). La zone
  // d'origine, vidée et masquée, n'est SUPPRIMÉE qu'après qu'une sauvegarde COMPLÈTE a enregistré
  // le déplacement : en base, supprimer une zone supprime en cascade ses observations + photos
  // (FK ON DELETE CASCADE) → la supprimer dans la même sauvegarde que le déplacement pourrait
  // perdre des photos. On suit donc syncStatus : une sauvegarde qui DÉMARRE après la fusion
  // ('saving') puis réussit ('ok') → suppression définitive (avec pierre tombale).
  const pendingMerges = useRef(new Map()); // srcId → { needFresh, sawSaving }
  const syncStatusRef = useRef(syncStatus);
  syncStatusRef.current = syncStatus;
  const mergeZoneInto = useCallback((srcId, tgtId) => {
    const prevLocs = zoneLocsRef.current;
    const next = mergeZones(prevLocs, srcId, tgtId);
    if (next === prevLocs) return;
    const tgt = prevLocs.find(l => l.id === tgtId);
    // Corbeille : copie COMPLÈTE de la zone d'origine avant fusion → « Annuler la fusion » possible
    // à tout moment (pas seulement pendant les 4 s du toast).
    const src = prevLocs.find(l => l.id === srcId);
    addDeletedZone(src, { projectId: projet.id, projectNom: projet.nom, visiteId: selectedVisiteId, reason: 'fusion',
      mergedInto: { id: tgtId, nom: tgt?.nom || '' }, index: prevLocs.indexOf(src) });
    onUpdateVisit({ localisations: next });
    pendingMerges.current.set(srcId, { needFresh: syncStatusRef.current === 'saving', sawSaving: false });
    setOpenLocIds(prev => new Set([...prev, tgtId]));
    showUndo(`Zone regroupée sous « ${tgt?.nom || 'zone'} »`, () => {
      pendingMerges.current.delete(srcId);
      liftTombstone(srcId); // au cas où la suppression différée aurait déjà eu lieu
      onUpdateVisit({ localisations: prevLocs });
    });
    // showUndo (déclaré plus bas, stable) volontairement HORS des dépendances : le citer ici
    // l'évaluerait pendant le rendu → crash TDZ « Cannot access before initialization ».
  }, [onUpdateVisit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const pend = pendingMerges.current;
    if (!pend.size) return;
    const toDelete = [];
    for (const [id, st] of pend) {
      if (syncStatus !== 'saving' && st.needFresh) st.needFresh = false; // la sauvegarde en cours à la fusion est finie
      else if (syncStatus === 'saving' && !st.needFresh) st.sawSaving = true; // une sauvegarde postérieure démarre
      else if (syncStatus === 'ok' && st.sawSaving) toDelete.push(id);       // … et a réussi
    }
    if (!toDelete.length) return;
    const locs = zoneLocsRef.current;
    const del = new Set(toDelete.filter(id => {
      const l = locs.find(x => x.id === id);
      return !l || (l._mergedInto && !(l.items || []).length); // jamais une zone qui a reçu du contenu
    }));
    toDelete.forEach(id => pend.delete(id));
    if (!del.size) return;
    onUpdateVisit({ localisations: locs.filter(l => !del.has(l.id)) });
    del.forEach(id => addTombstone('loc', id, projet.id));
  }, [syncStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Réordonnancement TACTILE des zones (le drag HTML5 ne marche pas au doigt — mobile est la
  // plateforme principale, cf. CLAUDE.md Règle N°4). On suit le doigt depuis la poignée et on
  // cherche la carte de zone sous le doigt (elementFromPoint).
  const startZoneTouch = useCallback((e, id) => {
    zoneDragDidMove.current = false;
    zoneOverRef.current = null;
    setZoneDragId(id); setZoneOver(null);
    const onMove = (ev) => {
      const t = ev.touches[0]; if (!t) return;
      ev.preventDefault(); // touchAction:'none' sur la poignée → pas de scroll parasite
      updateZoneOver(zoneTargetAt(t.clientX, t.clientY, id), id);
    };
    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      applyZoneDrop(id);
      resetZoneDrag();
      // Laisse passer le « click » synthétique qui suit le touchend avant de réautoriser le
      // dépliage (sinon le dépôt ouvrait/fermait la zone).
      setTimeout(() => { zoneDragDidMove.current = false; }, 0);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }, [updateZoneOver, applyZoneDrop, resetZoneDrag]);

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
    const loc = prevLocs.find(l => l.id === locId);
    const item = loc?.items?.find(i => i.id === itemId);
    const locs = prevLocs.map(l =>
      l.id !== locId ? l : { ...l, items: (l.items || []).filter(i => i.id !== itemId) }
    );
    onUpdateVisit({ localisations: locs });
    if (item) {
      // Pierre tombale ANTI-RÉSURRECTION (partie A) : l'obs supprimée ne pourra plus être
      // ressuscitée par la fusion, même si une copie traîne côté serveur/cache/autre session.
      addTombstone('item', itemId, projet.id); // mémo local + partagé avec les autres appareils
      // Filet de récupération (partie B) : copie de l'observation supprimée — texte + photos +
      // contexte — dans la bibliothèque « Récupération » (IndexedDB dédiée). Fire-and-forget.
      addDeletedItem(item, {
        projectId: projet.id, projectNom: projet.nom,
        visiteId: selectedVisiteId, locId, locNom: loc?.nom || '',
      });
    }
    // Annuler (toast) = restaurer : on LÈVE la pierre tombale, sinon la prochaine fusion
    // re-supprimerait aussitôt l'observation réapparue.
    showUndo(`"${item?.titre || 'Observation'}" supprimée`, () => {
      liftTombstone(itemId);
      onUpdateVisit({ localisations: prevLocs });
    });
  }, [visitProjet.localisations, onUpdateVisit, showUndo, projet.id, projet.nom, selectedVisiteId]);

  const addLoc = () => {
    const newLoc = { id: crypto.randomUUID(), nom: 'Nouvelle zone', items: [], planBg: null, planData: null, planAnnotations: null };
    onUpdateVisit({ localisations: [...visitProjet.localisations, newLoc] });
    setOpenLocIds(prev => new Set([...prev, newLoc.id]));
  };

  // Suppression de zone : retrait immédiat + toast « Annuler » (même pattern sûr que la
  // suppression d'observation) — remplace le window.confirm bloquant, jarring sur mobile.
  const deleteLoc = (locId, nom) => {
    const prevLocs = visitProjet.localisations;
    // Supprimer un GROUPE (« R+4 ») ne supprime JAMAIS ses sous-zones : elles redeviennent des
    // zones normales, avec toutes leurs observations (« Annuler » remet le groupe tel quel).
    const kidIds = new Set(childrenOf(prevLocs, locId).map(k => k.id));
    // Corbeille : copie complète de la zone (observations, photos, plans, annotations).
    const victim = prevLocs.find(l => l.id === locId);
    if (victim) addDeletedZone(victim, { projectId: projet.id, projectNom: projet.nom, visiteId: selectedVisiteId,
      reason: 'suppression', index: prevLocs.indexOf(victim) });
    onUpdateVisit({ localisations: prevLocs
      .filter(l => l.id !== locId)
      .map(l => (kidIds.has(l.id) ? { ...l, parentId: null } : l)) });
    // Pierre tombale ZONE (retour Thomas : « des zones supprimées sont réapparues ») : mémorisée
    // localement ET partagée avec les autres appareils → la zone ne peut plus revenir.
    addTombstone('loc', locId, projet.id);
    showUndo(`Zone « ${nom || 'sans nom'} » supprimée`, () => {
      liftTombstone(locId); // Annuler → la zone n'est plus filtrée nulle part
      onUpdateVisit({ localisations: prevLocs });
    });
  };

  const toggleLoc = (locId) => {
    setOpenLocIds(prev => {
      const next = new Set(prev);
      next.has(locId) ? next.delete(locId) : next.add(locId);
      return next;
    });
  };

  const saveItem = (locId, form) => {
    // Le drapeau _quickSuivi ne doit pas rester sur l'item stocké : sinon le prochain clic sur la
    // ligne repasserait par ce chemin au lieu d'ouvrir l'éditeur.
    // eslint-disable-next-line no-unused-vars
    if (form._quickSuivi) { const { _quickSuivi, ...rest } = form; patchItem(locId, rest); return; }
    patchItem(locId, { ...form, id: form.id || crypto.randomUUID() });
  };

  const [undoToast, setUndoToast] = useState(null);
  const undoTimerRef = useRef(null);
  const annotatorRef = useRef(null);
  const [confirmDelPhotoAnnot, setConfirmDelPhotoAnnot] = useState(false); // confirmation suppression photo depuis l'annotateur

  // Index mémoïsé planId → plan : évite un `.find` sur toute la bibliothèque pour CHAQUE
  // zone / plan d'observation à CHAQUE rendu (O(zones×plans) → O(1) par accès).
  // ⚠️ DOIT rester AVANT les `return` conditionnels ci-dessous (photoAnnot / annotate) :
  // un hook déclaré après un return conditionnel = « rendered fewer hooks » (React #300)
  // dès qu'on ouvre l'annotateur photo. (Règle des hooks — bug corrigé.)
  const planById = useMemo(
    () => new Map((projet.planLibrary || []).map(p => [p.id, p])),
    [projet.planLibrary]
  );

  if (modal?.t === 'photoAnnot') {
    const { item, locId, photoIdx } = modal;
    const validPhotos = (item.photos || []).filter(p => p.data);
    const ph = item.photos?.[photoIdx];

    const switchToPhoto = (newRealIdx) => {
      const annotation = annotatorRef.current?.getAnnotation();
      if (annotation) setPhotoAnnotPref(ph?._id, { annotW: annotation.annotW, annotH: annotation.annotH, annotSizeScale: annotation.annotSizeScale });
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
            setPhotoAnnotPref(ph?._id, { annotW: dims?.w, annotH: dims?.h, annotSizeScale: dims?.annotSizeScale });
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
                <ThumbImg key={vi} src={p.annotated || p.data} width={320} alt="" loading="lazy" decoding="async"
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

      {/* Safe-area gérée par l'espaceur global de ChantierAI — pas de padding env() ici */}
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
                    style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)', outline:'none', borderRadius:6, color:'white', fontSize:16, fontWeight:800, padding:'3px 7px', width: Math.max(120, projetNomVal.length * 9) + 'px' }}
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
              {/* Corbeille du projet (PC) : tout ce qui a été supprimé, restaurable en un clic. */}
              {onRestoreZone && (
                <button onClick={() => setTrashOpen(true)} aria-label="Corbeille du projet" title="Corbeille du projet — restaurer ce qui a été supprimé"
                  style={{ width:40, height:40, flexShrink:0, background: trashOpen ? 'rgba(255,255,255,0.12)' : 'transparent', border:'none', borderRadius:8, color:'rgba(255,255,255,0.75)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Ic n="del" s={17}/>
                </button>
              )}
              {onRefresh && (
                <button onClick={onRefresh} disabled={refreshing} aria-label="Actualiser" title="Actualiser depuis le serveur"
                  style={{ width:40, height:40, flexShrink:0, background:'transparent', border:'none', borderRadius:8, color:'rgba(255,255,255,0.75)', cursor:refreshing?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {refreshing ? <Ic n="spn" s={17}/> : <Ic n="rld" s={17}/>}
                </button>
              )}
              {/* Le badge « Visite … · date » a été retiré (demande Thomas : il ne renomme
                  jamais ici — le renommage se fait dans l'onglet Visites — et il encombrait
                  la barre, surtout sur téléphone). */}
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
            <div style={{ padding:'4px 6px 0', display:'flex', alignItems:'center', gap:2 }}>
              <button onClick={onBack} aria-label="Retour aux visites" title="Retour aux visites"
                style={{ width:44, height:44, flexShrink:0, color:'rgba(255,255,255,0.75)', background:'transparent', border:'none', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                <span style={{ display:'inline-block', transform:'rotate(90deg)', lineHeight:0 }}><Ic n="chv" s={20}/></span>
              </button>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontWeight:800, fontSize:16, color:'white', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.nom}</p>
                {projet.adresse && <p style={{ fontSize:11, color:'rgba(255,255,255,0.4)', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.adresse}</p>}
              </div>
              <PendingPhotosBadge/>
              {/* 'offline' = silencieux : le bandeau hors-ligne global informe déjà */}
              {syncStatus !== 'ok' && syncStatus !== 'offline' && (
                <div style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 9px', borderRadius:8,
                  background: syncStatus==='error' ? 'rgba(239,68,68,0.15)' : 'rgba(251,191,36,0.15)',
                  border: `1px solid ${syncStatus==='error'?'rgba(239,68,68,0.4)':'rgba(251,191,36,0.4)'}`,
                  flexShrink:0 }}>
                  {syncStatus === 'saving' ? <Ic n="spn" s={10}/> : null}
                  <span style={{ fontSize:10, fontWeight:700, color: syncStatus==='error'?'#F87171':'#FCD34D', whiteSpace:'nowrap' }}>{syncStatus === 'saving' ? 'Sauvegarde…' : 'Erreur sync'}</span>
                </div>
              )}
              {tab !== 'rapport' && (
                <button onClick={() => setModal({ t:'niveaux' })} aria-label="Plans" title="Plans"
                  style={{ width:44, height:44, flexShrink:0, background:'transparent', border:'none', borderRadius:8, color:'rgba(255,255,255,0.75)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Ic n="bld" s={19}/>
                </button>
              )}
              {onRefresh && (
                <button onClick={onRefresh} disabled={refreshing} aria-label="Actualiser" title="Actualiser depuis le serveur"
                  style={{ width:44, height:44, flexShrink:0, background:'transparent', border:'none', borderRadius:8, color:'rgba(255,255,255,0.75)', cursor:refreshing?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {refreshing ? <Ic n="spn" s={18}/> : <Ic n="rld" s={18}/>}
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
            <div className={uiScaleClass(uiScale)} style={{ maxWidth:1400, margin:'0 auto', padding:'12px 14px', display:'flex', flexDirection:'column', gap:10,
              // PC : place réservée à Costar (en bas à droite) pour qu'il ne masque jamais les boutons
              // des cartes — seulement si la marge naturelle de l'écran ne suffit pas.
              ...(isDesktop ? { paddingRight:'max(14px, calc(124px - max(0px, (100vw - 1400px) / 2)))', paddingBottom:130 } : {}) }}>
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
                  {(() => {
                  const allLocs = visitProjet.localisations;
                  // Zones rangées dans un groupe (« R+4 ») : affichées au même niveau, préfixées du nom
                  // du groupe. Sans groupe : rendu strictement identique.
                  const renderZone = (loc, isSub) => {
                    const items    = loc.items || [];
                    const isOpen   = openLocIds.has(loc.id);
                    const kids     = isSub ? [] : childrenOf(allLocs, loc.id);
                    const parentNom = isSub ? (allLocs.find(l => l.id === loc.parentId)?.nom || '') : '';
                    const isDragged = zoneDragId === loc.id;
                    const isOver    = !!zoneOver && zoneOver.id === loc.id && !isDragged;
                    const isInto    = isOver && zoneOver.into;
                    // Repère d'insertion : la zone déplacée prend la place de la cible → elle
                    // s'insère APRÈS si elle vient d'au-dessus, AVANT si elle vient d'en dessous.
                    const dropAfter = isOver && !isInto && allLocs.findIndex(l => l.id === zoneDragId) < allLocs.indexOf(loc);
                    const urgentCount = items.filter(i => i.urgence === 'haute').length;
                    const assignedPlan = loc.planId ? planById.get(loc.planId) : null;
                    const allPlanThumbs = [];
                    // Ignore les références orphelines (plan supprimé) → pas de tuile « Plan » vide fantôme.
                    if (loc.planBg || (loc.planId && assignedPlan)) {
                      allPlanThumbs.push({ bg: loc.planBg || assignedPlan?.bg || null, planAnnotations: loc.planAnnotations, nom: assignedPlan?.nom || 'Plan de zone', reportHidden: !!loc.planReportHidden, planId: loc.planId });
                    }
                    for (const ep of (loc.extraPlans || [])) {
                      const epLib = planById.get(ep.planId);
                      if (!ep.planBg && !epLib) continue; // orphelin
                      allPlanThumbs.push({ bg: ep.planBg || epLib?.bg || null, planAnnotations: ep.planAnnotations, nom: epLib?.nom || 'Plan', reportHidden: !!ep.reportHidden, planId: ep.planId });
                    }
                    const hasAnyPlan = allPlanThumbs.length > 0;
                    return (
                      <div key={loc.id}
                        data-zone-id={loc.id}
                        draggable={zoneDragArm === loc.id}
                        onDragStart={e => {
                          // Glisser d'un élément IMBRIQUÉ (observation à réordonner, photo…) : ce n'est pas
                          // le glisser de la zone → on le laisse vivre. Avant, la garde ci-dessous l'ANNULAIT
                          // (preventDefault) → l'observation restait grisée sans bouger (retour Thomas 13/10).
                          const srcEl = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
                          const nested = srcEl?.closest?.('[draggable="true"]');
                          if (nested && nested !== e.currentTarget) return;
                          e.stopPropagation(); // une sous-zone ne déclenche pas le drag de son groupe
                          if (zoneDragArm !== loc.id) { e.preventDefault(); return; } // drag natif d'une sélection de texte
                          zoneDragDidMove.current = false; zoneOverRef.current = null;
                          try {
                            // Firefox ne démarre AUCUN glisser sans donnée → la zone ne bougeait pas.
                            e.dataTransfer.setData('text/zone', loc.id);
                            e.dataTransfer.effectAllowed = 'move';
                            // Image de glisser = l'EN-TÊTE seul (pas toute la carte ouverte, photos
                            // comprises, qui masquait les zones visées).
                            const head = e.currentTarget.querySelector(`[data-zone-head="${loc.id}"]`);
                            if (head) e.dataTransfer.setDragImage(head, 24, 24);
                          } catch { /* navigateur sans dataTransfer complet */ }
                          setZoneDragId(loc.id); setZoneOver(null);
                        }}
                        onDragEnd={e => { e.stopPropagation(); applyZoneDrop(loc.id); resetZoneDrag(); setZoneDragArm(null); setTimeout(() => { zoneDragDidMove.current = false; }, 0); }}
                        onMouseUp={() => setZoneDragArm(null)}
                        onDragOver={e => {
                          e.preventDefault();
                          if (!zoneDragId) return; // seulement pendant un VRAI glisser de zone
                          e.stopPropagation();
                          updateZoneOver(zoneTargetAt(e.clientX, e.clientY, zoneDragId), zoneDragId);
                        }}
                        style={{
                          background: isDragged ? '#e8e8e8' : 'white',
                          borderRadius: 10,
                          border: `1px solid ${DA.border}`,
                          // Trait rouge AU-DESSUS ou EN DESSOUS de la cible = là où la zone va se placer.
                          boxShadow: isDragged ? 'none'
                            : isOver && !isInto ? `0 ${dropAfter ? 5 : -5}px 0 -1px ${DA.red}, 0 1px 4px rgba(0,0,0,0.07)`
                            : '0 1px 4px rgba(0,0,0,0.07)',
                          overflow: 'hidden',
                          opacity: isDragged ? 0.45 : 1,
                          transition:'background 0.08s,opacity 0.08s,box-shadow 0.08s',
                        }}>
                        <div data-zone-head={loc.id}
                          style={{ display:'flex', alignItems:'center', padding:'16px 18px', gap:10, position:'relative',
                            ...(isInto ? { background:DA.redL, boxShadow:`inset 0 0 0 2px ${DA.red}` } : {}) }}>
                          {isInto && (
                            <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:DA.red, color:'white', fontSize:11, fontWeight:800, borderRadius:20, padding:'3px 10px', whiteSpace:'nowrap', zIndex:2, pointerEvents:'none' }}>
                              Regrouper avec « {loc.nom || 'cette zone'} »{'\u00A0'}?
                            </span>
                          )}
                          <div onClick={e => e.stopPropagation()}
                            onTouchStart={e => { e.stopPropagation(); startZoneTouch(e, loc.id); }}
                            onMouseDown={() => setZoneDragArm(loc.id)}
                            title="Glisser pour réorganiser — maintenir sur le titre d'une autre zone pour les regrouper"
                            style={{ flexShrink:0, padding:'10px 8px', margin:'-4px', cursor:'grab', color:'#bbb', display:'flex', alignItems:'center', touchAction:'none' }}>
                            <Ic n="grp" s={18}/>
                          </div>
                          <button onClick={e => { if (zoneDragDidMove.current) return; toggleLoc(loc.id); }}
                            style={{ color:DA.grayL, background:'none', border:'none', cursor:'pointer', flexShrink:0, padding:4, display:'flex', alignItems:'center', transition:'transform 0.15s', transform:isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
                            <Ic n="chv" s={16}/>
                          </button>
                          {/* Zone rangée : même niveau que les autres, juste le nom du groupe DEVANT
                              (« R+4 » M. Albert Thomas) — demande Thomas. */}
                          {(() => {
                            const title = (
                              <EditTitle
                                value={loc.nom}
                                onSave={nom => patchLoc(loc.id, { nom })}
                                style={{ fontSize:13, fontWeight:800, color:'#555', textTransform:'uppercase', letterSpacing:0.8 }}
                                inputStyle={{ fontSize:13, fontWeight:800, textTransform:'uppercase', ...(isSub && !isDesktop ? { width:'100%' } : {}) }}
                              />
                            );
                            if (!isSub || !parentNom) return title;
                            const chip = (
                              <span title={`Rangée dans « ${parentNom} »`}
                                style={{ flexShrink:0, alignSelf: isDesktop ? 'center' : 'flex-start', maxWidth: isDesktop ? '38%' : '100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize: isDesktop ? 11.5 : 10, fontWeight:800, color:DA.red, background:DA.redL, border:'1px solid #FCA5A5', borderRadius:5, padding: isDesktop ? '2px 7px' : '1px 6px', textTransform:'uppercase', letterSpacing:0.5, lineHeight:1.4 }}>
                                {parentNom}
                              </span>
                            );
                            // PC : étiquette DEVANT le nom. Téléphone : juste au-dessus, pour garder le
                            // nom entier sur 375 px (sinon « M. ALBE… »).
                            return isDesktop ? <>{chip}{title}</> : (
                              <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:3 }}>{chip}{title}</div>
                            );
                          })()}
                          <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                            {urgentCount > 0 && (
                              <span style={{ fontSize:12, fontWeight:700, background:'#FFF0F0', color:DA.red, border:`1px solid #FCA5A5`, borderRadius:10, padding:'2px 8px', lineHeight:1.6 }}>
                                {urgentCount} ⚠
                              </span>
                            )}
                            <button onClick={() => setModal({ t:'plan', locId:loc.id })}
                              style={{ width:38, height:38, padding:0, justifyContent:'center', border:`1px solid ${hasAnyPlan ? DA.red : DA.border}`, background:hasAnyPlan ? DA.redL : 'white', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', color:hasAnyPlan ? DA.red : DA.grayL }}>
                              <Ic n="map" s={16}/>
                            </button>
                            <button onClick={() => deleteLoc(loc.id, loc.nom)}
                              style={{ width:38, height:38, padding:0, justifyContent:'center', border:'none', background:'none', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', color:'#ccc' }}
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
                              locId={loc.id}
                              compactEmpty={kids.length > 0}
                              onMovePhotoAcross={movePhoto}
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
                              onOpenItemPlan={item => setModal({ t:'itemPlan', locId: loc.id, itemId: item.id })}
                            />
                            {/* Plans PROPRES aux observations — affichés EN PREMIER (obs 1 → plan,
                                obs 2 → plan…), AVANT le plan de la zone (rendu ensuite). Chacun est
                                coiffé du titre de son observation. Cliquer ouvre le modal
                                d'assignation / annotation propre à l'observation (comme la zone). */}
                            {(() => {
                              const obsPlans = [];
                              for (const it of items) {
                                for (let pi = 0; pi < (it.plans || []).length; pi++) {
                                  const pl  = it.plans[pi];
                                  const lib = planById.get(pl.planId);
                                  const bg  = pl.planBg || lib?.bg || null;
                                  if (!bg && !pl.planAnnotations?.exported) continue; // orphelin → ignoré
                                  obsPlans.push({ it, pl, pi, bg, nom: lib?.nom || null });
                                }
                              }
                              if (!obsPlans.length) return null;
                              return (
                                <div style={{ borderTop:`1px solid ${DA.border}` }}>
                                  {obsPlans.map(({ it, pl, pi, bg, nom }) => (
                                    <button key={it.id + '_' + pi} onClick={() => setModal({ t:'itemPlan', locId: loc.id, itemId: it.id, annotIdx: pi })}
                                      style={{ width:'100%', display:'block', border:'none', borderTop:`1px solid ${DA.border}`, background:'#f4f4f4', cursor:'pointer', padding:0 }}>
                                      <div style={{ padding:'7px 12px', textAlign:'left', background:'white', borderBottom:`1px solid ${DA.border}`, display:'flex', alignItems:'center', gap:6 }}>
                                        <Ic n="map" s={12}/>
                                        <span style={{ fontSize:11, fontWeight:800, color:DA.gray, textTransform:'uppercase', letterSpacing:0.4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                          {it.titre || 'Observation'}{nom ? ' · ' + nom : ''}
                                        </span>
                                      </div>
                                      <div style={{ height: isDesktop ? 300 : 220, background:'#f4f4f4' }}>
                                        <PlanAnnotThumb bg={bg} annotations={pl.planAnnotations} vpNumByPath={vpNumGlobal} vpBase={vpMaxGlobal} style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}/>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}
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
                                                    // Garde : ne propager que si le plan a un planId réel. Sans ça, un
                                                    // pt.planId null/undefined matcherait TOUTES les zones sans plan
                                                    // (planId vide) → leur planBg écrasé par l'image tournée.
                                                    const newLibrary = (projet.planLibrary || []).map(pl =>
                                                      pt.planId && pl.id === pt.planId ? { ...pl, bg: rotated } : pl
                                                    );
                                                    const newVisites = (projet.visites || []).map(v => ({
                                                      ...v,
                                                      localisations: (v.localisations || []).map(l => ({
                                                        ...l,
                                                        planBg: pt.planId && l.planId === pt.planId ? rotated : l.planBg,
                                                        extraPlans: (l.extraPlans || []).map(ep =>
                                                          pt.planId && ep.planId === pt.planId ? { ...ep, planBg: rotated } : ep
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
                  };
                  // Toutes les zones au MÊME niveau ; l'ordre canonique (orderZones) garde chaque groupe
                  // suivi de ses zones rangées.
                  // Zones fusionnées en attente de suppression (vides) : masquées.
                  return allLocs.filter(l => !l._mergedInto).map(l => renderZone(l, !!effectiveParentId(allLocs, l)));
                  })()}
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

      {/* Costar aussi dans l'onglet Visite (PC uniquement, masqué pendant une fenêtre ouverte) :
          il relit tout le rapport de la visite comme depuis l'onglet Rapport. */}
      {tab === 'visite' && !modal && <Costar projet={visitProjet} fixed/>}
      {mergeAsk && (() => {
        const locs = visitProjet.localisations;
        const src = locs.find(l => l.id === mergeAsk.srcId);
        const tgt = locs.find(l => l.id === mergeAsk.tgtId);
        const close = () => setMergeAsk(null);
        if (!src || !tgt) return null;
        const nom = (l) => l.nom || 'zone';
        const justMove = () => { const next = placeZone(locs, src.id, tgt.id); if (next !== locs) onUpdateVisit({ localisations: next }); close(); };
        // REGROUPER : on choisit la zone qui RESTE, quel que soit le sens du glisser (Thomas :
        // « tout regroupé sous M. Phung alors qu'il fallait sous R+4 »). L'autre la rejoint.
        const groupUnder = (keep, other) => { mergeZoneInto(other.id, keep.id); close(); };
        // Deux choix de MÊME poids : aucun n'est mis en avant (le « bon » dépend du sens du glisser).
        const btn = (primary) => ({ flex:1, minWidth:0, padding:'11px 10px', borderRadius:9, fontSize:13, fontWeight: primary ? 800 : 700, cursor:'pointer',
          border: primary ? 'none' : `1.5px solid ${DA.red}`, background: primary ? DA.red : 'white', color: primary ? 'white' : DA.red,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' });
        return (
          <div onClick={close} onKeyDown={e => { if (e.key === 'Escape') close(); }}
            style={{ position:'fixed', inset:0, zIndex:450, background:'rgba(0,0,0,0.25)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
            <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Regrouper deux zones"
              style={{ background:'white', borderRadius:14, padding:'18px 18px 12px', width:400, maxWidth:'100%', boxShadow:'0 12px 40px rgba(0,0,0,0.25)' }}>
              <p style={{ margin:0, fontSize:15, fontWeight:800, color:DA.black, lineHeight:1.4 }}>
                Regrouper « {nom(tgt)} » et « {nom(src)} » sous quelle zone{'\u00A0'}?
              </p>
              <p style={{ margin:'6px 0 14px', fontSize:12.5, color:DA.gray, lineHeight:1.5 }}>
                La zone choisie reste ; les observations de l'autre la rejoignent, avec le nom de leur ancienne
                zone devant leur titre ({'«\u00A0Appartement · Fissure…\u00A0»'}). Annulable ensuite depuis la corbeille.
              </p>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => groupUnder(tgt, src)} style={btn(false)} title={`Garder « ${nom(tgt)} »`}>Sous « {nom(tgt)} »</button>
                <button onClick={() => groupUnder(src, tgt)} style={btn(false)} title={`Garder « ${nom(src)} »`}>Sous « {nom(src)} »</button>
              </div>
              <button onClick={justMove}
                style={{ display:'block', width:'100%', marginTop:6, padding:'9px', borderRadius:9, fontSize:12.5, fontWeight:700, border:'none', background:'none', color:DA.gray, cursor:'pointer' }}>
                Non, juste déplacer la zone
              </button>
            </div>
          </div>
        );
      })()}
      {trashOpen && (
        <TrashPanel projet={projet} onClose={() => setTrashOpen(false)}
          onRestoreZone={onRestoreZone} onRestoreObservation={onRestoreObservation}
          onRestoreLostAnnots={onRestoreLostAnnots} onRestoreZoneAnnotations={onRestoreZoneAnnotations}/>
      )}

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
            zones={visitProjet.localisations.filter(l => !l._mergedInto).map(l => ({ id: l.id, nom: l.nom }))}
            zoneId={modal.item?.id ? modal.locId : null}
            planBg={loc?.planBg ?? null}
            planId={loc?.planId ?? null}
            extraPlans={loc?.extraPlans ?? []}
            planAnnotations={initItem?.planAnnotations ?? null}
            planLibrary={projet.planLibrary || []}
            vpNumByPath={vpNumGlobal}
            vpBase={vpMaxGlobal}
            onClose={() => { itemModalBackRef.current = null; setModal(null); }}
            onSave={form => {
              itemModalBackRef.current = null;
              // eslint-disable-next-line no-unused-vars
              const { _moveTo, ...clean } = form;
              const saved = { ...clean, id: clean.id || crypto.randomUUID() };
              if (_moveTo) {
                // Déplacement vers une autre zone (ou nouvelle zone) : l'observation garde son id →
                // la sauvegarde la ré-enregistre sous sa nouvelle zone (garde anti-perte saveRemote).
                const next = moveItemToZone(visitProjet.localisations, modal.locId, saved, _moveTo);
                if (next !== visitProjet.localisations) {
                  onUpdateVisit({ localisations: next });
                  const dest = typeof _moveTo === 'string' ? _moveTo : next.find(l => !visitProjet.localisations.some(o => o.id === l.id))?.id;
                  if (dest) setOpenLocIds(prev => new Set([...prev, dest]));
                }
              } else {
                saveItem(modal.locId, saved);
              }
              setModal(null);
            }}
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
            // Zone groupe (« R+4 ») : photos de la zone + de ses sous-zones → on peut placer les
            // repères des appartements sur le plan du R+4.
            items={zonePlanItems(visitProjet.localisations, loc)}
            planLibrary={projet.planLibrary || []}
            autoAnnot={!!modal.autoAnnot}
            annotIdx={modal.annotIdx ?? null}
            vpNumByPath={vpNumGlobal}
            vpBase={vpMaxGlobal}
            onUploadHd={(id, hd) => savePlanHdNow(projet.id, id, hd)}
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
            onRenamePlan={(id, nom) => onUpdate(prev => ({ planLibrary: (prev.planLibrary || []).map(p => p.id === id ? { ...p, nom } : p) }))}
            onAddToLibrary={newPlans => {
              const arr = Array.isArray(newPlans) ? newPlans : [newPlans];
              // Forme FONCTIONNELLE obligatoire : l'import de plusieurs images déclenche N
              // callbacks onload séparés ; avec `projet.planLibrary` figé au rendu, chacun
              // écrasait le précédent → seule la dernière image restait dans la bibliothèque.
              onUpdate(prev => ({ planLibrary: [...(prev.planLibrary || []), ...arr] }));
              savePlanBgNow(projet.id, arr);
            }}
          />
        );
      })()}

      {/* Plan PROPRE à une observation — même modal que le plan de zone (bibliothèque : sélection /
          import / annotation), mais borné à l'observation (item.plans). Pas de propagation entre
          zones : un plan d'observation est spécifique. Le premier plan = « primaire », les suivants
          = extraPlans (même structure interne que PlanLocModal). */}
      {modal?.t === 'itemPlan' && (() => {
        const loc  = visitProjet.localisations.find(l => l.id === modal.locId);
        const item = (loc?.items || []).find(it => it.id === modal.itemId);
        if (!item) return null;
        const [primary, ...rest] = (item.plans || []);
        const pseudoLoc = {
          id: item.id,
          nom: item.titre || 'Observation',
          planId: primary?.planId || null,
          planBg: primary?.planBg || null,
          planData: primary?.planData || null,
          planAnnotations: primary?.planAnnotations || null,
          extraPlans: rest,
        };
        return (
          <PlanLocModal
            loc={pseudoLoc}
            items={[item]}
            planLibrary={projet.planLibrary || []}
            autoAnnot={!!modal.autoAnnot}
            annotIdx={modal.annotIdx ?? null}
            vpNumByPath={vpNumGlobal}
            vpBase={vpMaxGlobal}
            onUploadHd={(id, hd) => savePlanHdNow(projet.id, id, hd)}
            onClose={() => setModal(null)}
            onSave={({ planId, planBg, planData, planAnnotations, extraPlans }) => {
              const newPlans = [];
              if (planId || planBg || planAnnotations) {
                newPlans.push({ id: primary?.id || crypto.randomUUID(), planId: planId || null, planBg: planBg || null, planData: planData || null, planAnnotations: planAnnotations || null });
              }
              for (const ep of (extraPlans || [])) {
                newPlans.push({ id: ep.id || crypto.randomUUID(), planId: ep.planId || null, planBg: ep.planBg || null, planData: ep.planData || null, planAnnotations: ep.planAnnotations || null });
              }
              patchItem(modal.locId, { ...item, plans: newPlans });
              setModal(null);
            }}
            onDeletePlan={id => onDeletePlan ? onDeletePlan(id) : onUpdate({ planLibrary: (projet.planLibrary || []).filter(p => p.id !== id) })}
            onRenamePlan={(id, nom) => onUpdate(prev => ({ planLibrary: (prev.planLibrary || []).map(p => p.id === id ? { ...p, nom } : p) }))}
            onAddToLibrary={newPlans => {
              const arr = Array.isArray(newPlans) ? newPlans : [newPlans];
              // Forme FONCTIONNELLE obligatoire : l'import de plusieurs images déclenche N
              // callbacks onload séparés ; avec `projet.planLibrary` figé au rendu, chacun
              // écrasait le précédent → seule la dernière image restait dans la bibliothèque.
              onUpdate(prev => ({ planLibrary: [...(prev.planLibrary || []), ...arr] }));
              savePlanBgNow(projet.id, arr);
            }}
          />
        );
      })()}

      {/* onAttachHd : HD rendue en arrière-plan après l'import, attachée au plan en forme
          fonctionnelle (plusieurs pages arrivent en rafale) → la sauvegarde auto l'envoie
          dans Storage (hdCandidates). Fonctionne même si on a quitté le projet. */}
      {modal?.t === 'planLib' && (
        <PlanLibraryModal
          projetNom={projet.nom || ''}
          projetId={projet.id}
          onAttachHd={(id, hd) => onUpdate(prev => ({ planLibrary: (prev.planLibrary || []).map(p => p.id === id ? { ...p, hd } : p) }))}
          onUploadHd={(id, hd) => savePlanHdNow(projet.id, id, hd)}
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

      {/* onDeletePlan/onRenamePlan : formes FONCTIONNELLES (prev => …) obligatoires — le
          renommage/suppression d'un PDF ENTIER boucle sur ses pages ; avec un patch objet figé
          sur `projet` du rendu, chaque appel écrasait le précédent (bug « pSFIGNG » : une seule
          page renommée, détachée de son groupe). Ne pas revenir en arrière. */}
      {modal?.t === 'niveaux' && (
        <NiveauxModal
          localisations={visitProjet.localisations}
          planLibrary={projet.planLibrary || []}
          onChange={newLocs => onUpdateVisit({ localisations: newLocs })}
          onClose={() => setModal(null)}
          onOpenPlanLib={() => setModal({ t:'planLib' })}
          onPickPlan={(locId) => setModal({ t:'plan', locId, returnToNiveaux: true })}
          onDeletePlan={id => onDeletePlan ? onDeletePlan(id) : onUpdate(prev => ({ planLibrary: (prev.planLibrary || []).filter(p => p.id !== id) }))}
          onDeleteAllPlans={() => onUpdate({ planLibrary: [] })}
          onRenamePlan={(id, nom) => onUpdate(prev => ({ planLibrary: (prev.planLibrary || []).map(p => p.id === id ? { ...p, nom } : p) }))}
          projetId={projet.id}
          planFolders={projet.planFolders || []}
          onUpdateFolders={folders => onUpdate({ planFolders: folders })}
          onReorderPlans={fn => onUpdate(prev => ({ planLibrary: fn(prev.planLibrary || []) }))}
          onRepairBg={(id, newBg) => {
            const pl = (projet.planLibrary || []).find(p => p.id === id);
            onUpdate({ planLibrary: (projet.planLibrary || []).map(p => p.id === id ? { ...p, bg: newBg } : p) });
            if (pl) savePlanBgNow(projet.id, [{ ...pl, bg: newBg }]);
          }}
        />
      )}

    </div>
  );
}
