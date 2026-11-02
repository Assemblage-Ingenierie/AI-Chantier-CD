import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback, useImperativeHandle } from 'react';
import { DA, isBrouillon } from '../../lib/constants.js';
import { getAllSymbols } from './Annotator.jsx';
import { Ic } from '../ui/Icons.jsx';
import ItemModal from './ItemModal.jsx';
import { computeVpNumbering, debugVpNumbering } from '../../lib/vpNumbering.js';
import { fetchAnnexPdf } from '../../lib/storage.js';
import { setPhotoPref } from '../../lib/photoPrefs.js';
import { renderPdfPages } from '../../lib/pdfUtils.js';
import { childrenOf } from '../../lib/zoneGroups.js';
import { CW, FTR, HDR, MB, MT, PH, PW, VXX_DEBUG, buildPages, flattenBlocks, itemHasReportContent, splitPlanGroups, stripFullPagePlans } from './RapportPreview/layout.js';
import { CutZone, PageSepBanner, TopBreakControl } from './RapportPreview/controls.jsx';
import { ItemBlock, ItemPlanBlock, PlanBlock, SymbolIcon, ViewpointIcon, ZoneHeader } from './RapportPreview/blocks.jsx';
import { A4Card, AnnexImagePage, AnnexRecapPage, ConclusionPage, CoverOverflowPage, CoverPage, PlanFullPage, TableauRecapPage, computeParticipantChunks } from './RapportPreview/pages.jsx';
export { flattenBlocks } from './RapportPreview/layout.js';

// Pages d'annexes rendues en images (par annexId) — cache SESSION : re-parser/re-rendre un PDF
// d'annexe à chaque changement d'onglet serait lent. Clé `${chantierId}|${annexId}`.
// Largeur bornée = COMPRESSION des annexes (demande Thomas : rester sous 25 Mo par email).
const _annexImgCache = new Map();
const ANNEX_PAGE_MAXW = 1400; // ~170 dpi A4 : lisible pour du texte, compact à l'export

// ── Hook scale adaptatif ───────────────────────────────────────────────────────────────────────
// Mesure le scrollRef (pas containerRef) pour inclure la largeur de la barre de défilement.
// useLayoutEffect → mesure synchrone avant le premier paint, évite le flash.
function usePreviewScale(scrollRef) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const update = () => {
      if (!scrollRef.current) return;
      const cw = scrollRef.current.clientWidth;
      const next = Math.min(1, (cw - 32) / PW);
      setScale(prev => prev === next ? prev : next);
    };
    update();
    const ro = new ResizeObserver(update);
    if (scrollRef.current) ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [scrollRef]);
  return scale;
}

// Cache SESSION des images encodées pour le PDF (source × définition × qualité → data URL).
// Clé : chemin sans jeton pour les URL signées (le jeton change, l'image non), empreinte pour les
// data URL (évite des clés de plusieurs Mo).
const _pdfEncCache = new Map();
const _pdfEncSize = new Map(); // clé → taille (caractères) une fois encodée
let _pdfEncTotal = 0;
// Plafond mémoire du cache : plus serré sur mobile (iOS tue l'onglet sous pression mémoire).
const PDF_CACHE_MAX = (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches) ? 25e6 : 80e6;
function pdfCacheSet(key, p) {
  _pdfEncCache.set(key, p);
  p.then(v => {
    if (_pdfEncCache.get(key) !== p) return;
    const n = typeof v === 'string' && v.startsWith('data:') ? v.length : 0;
    _pdfEncSize.set(key, n); _pdfEncTotal += n;
    // Éviction des plus anciennes entrées TERMINÉES (jamais celle qu'on vient d'ajouter).
    for (const k of _pdfEncCache.keys()) {
      if (_pdfEncTotal <= PDF_CACHE_MAX) break;
      if (k === key || !_pdfEncSize.has(k)) continue;
      _pdfEncTotal -= _pdfEncSize.get(k); _pdfEncSize.delete(k); _pdfEncCache.delete(k);
    }
  }, () => { _pdfEncCache.delete(key); });
}
function pdfSrcKey(src) {
  if (typeof src !== 'string') return String(src);
  if (src.startsWith('data:')) return `d${src.length}|${src.slice(22, 86)}|${src.slice(-64)}`;
  if (src.startsWith('blob:')) return src;
  return src.split('?')[0];
}

const RapportPreview = React.forwardRef(function RapportPreview({ projet, localisations, photosParLigne, pageBreaks, onTogglePageBreak, plansEnFin, plansNoBreak = false, includeTableauRecap = true, tableauRecap = [], includeConclusion = false, conclusion = '', conclusionAlign = 'left', planPagesPaysage = false, planPages = null, onSetPlanPages = null, annexes = [], annotScales = { text: 1, shape: 1, symbol: 1 }, photoAnnotScales = { text: 1, shape: 1, symbol: 1 }, onAnnotScaleChange, onUpdateItem, onTogglePanel, panelOpen, panelW = 0, cutMode = false, onCutModeChange, onExportPdf, onExportPhotos, totalPhotos = 0, zipping = false, recapRows = [], onUpdateRecap, onDeleteRecap, onAddCustomRow, onUpdateConclusion, onUpdateConclusionAlign, onEditPlan = null, onAnnotatePhoto = null }, ref) {
  const ppl  = photosParLigne ?? 2;
  // Échelles d'annotation par type (texte/forme/symbole) — diffusées telles quelles aux blocs.
  const annotScale = annotScales;
  // Zones présentes dans le rapport : celles qui ont du contenu, + les GROUPES (« R+4 ») dont une
  // sous-zone a du contenu (titre + plan du groupe). Sans groupe : liste identique à avant.
  const locs = useMemo(() => {
    const has = (l) => (l.items || []).some(i => !isBrouillon(i) && itemHasReportContent(i));
    return localisations.filter(l => has(l) || childrenOf(localisations, l.id).some(has));
  }, [localisations]);
  // Numérotation Vxx globale (badges photos + labels marqueurs) — calculée une fois, partagée
  // par le mode inline et le mode « plans en fin » → numéros identiques partout, zéro doublon.
  const { vxxPhotoMap, vpNumByPath } = useMemo(() => computeVpNumbering(localisations), [localisations]);
  const vxxDebugData = useMemo(() => VXX_DEBUG ? debugVpNumbering(localisations) : null, [localisations]);

  // Orientation des plans (détectée au chargement de l'image par SinglePlanImage, remontée ici).
  // planId → 'portrait' | 'landscape'. Sert à isoler automatiquement les plans portrait sur
  // leur propre page (demande utilisateur : un plan portrait par page pour qu'il soit lisible).
  const [planOrient, setPlanOrient] = useState({});
  const handlePlanOrient = useCallback((planId, o) => {
    if (!planId) return;
    setPlanOrient(prev => (prev[planId] === o ? prev : { ...prev, [planId]: o }));
  }, []);

  // ── Plans sur PAGE À PART (fin de rapport, paysage ou portrait) — choix PAR PLAN ──
  // Tous les plans du rapport, avec leur clé. L'ancienne case « tous les plans en paysage »
  // (planPagesPaysage) reste honorée tant qu'aucun choix plan par plan n'a été fait.
  const reportPlans = useMemo(() => {
    const lib = projet.planLibrary || [];
    const nomOf = (id) => (id && lib.find(p => p.id === id)?.nom) || '';
    const out = [];
    for (const loc of locs) {
      const groups = splitPlanGroups(loc, lib, new Set()).flatMap(g => g.plans);
      groups.forEach((p, k) => {
        if (!p.bg && !p.planId && !p.annotations?.exported) return;
        out.push({ key: p.epIdx == null ? `z:${loc.id}` : `z:${loc.id}:${p.epIdx}`, plan: p,
          title: `Plan — ${loc.nom}${groups.length > 1 ? ` (${k + 1}/${groups.length})` : ''}` });
      });
      for (const it of (loc.items || [])) {
        if (isBrouillon(it) || !itemHasReportContent(it)) continue;
        (it.plans || []).forEach((pl, k) => {
          if (!pl.planAnnotations?.paths?.length) return;
          const bg = pl.planBg || (lib.find(p => p.id === pl.planId)?.bg) || null;
          if (!bg && !pl.planAnnotations?.exported) return;
          out.push({ key: `i:${it.id}:${k}`, plan: { bg, planId: pl.planId || null, annotations: pl.planAnnotations },
            title: (nomOf(pl.planId) ? `${nomOf(pl.planId)} — ` : 'Plan — ') + (it.titre || 'observation') });
        });
      }
    }
    return out;
  }, [locs, projet.planLibrary]);
  // INCIDENT 2026-10-19 (Thomas : « les plans n'apparaissent plus » dans le rapport) : l'ancienne
  // case globale planPagesPaysage (retirée de l'interface) envoyait TOUS les plans de la visite en
  // fin de rapport → disparus du texte. Elle est désormais ignorée : seuls les plans choisis un par
  // un (« ⤢ Page à part ») quittent le texte.
  void planPagesPaysage;
  // Case « Plans en fin de rapport » (retour Thomas 20/10 : « ça ne marche pas du tout » — les plans
  // DISPARAISSAIENT, la liste des pages de fin n'étant plus remplie) : désormais CHAQUE plan part
  // seul sur une page A4 en fin de rapport (comme « ⤢ Page à part »), orientation automatique
  // (paysage / portrait selon le plan), modifiable plan par plan ; « ↩ Dans le texte » le garde
  // dans le texte (valeur 'inline', utile seulement quand la case est cochée).
  const userPlanPages = useMemo(() => (planPages && typeof planPages === 'object') ? planPages : {}, [planPages]);
  const fullPageMap = useMemo(() => {
    const out = {};
    if (plansEnFin) for (const p of reportPlans) out[p.key] = planOrient[p.plan.planId] === 'portrait' ? 'portrait' : 'landscape';
    for (const [k, v] of Object.entries(userPlanPages)) {
      if (v === 'inline') delete out[k];
      else if (v === 'landscape' || v === 'portrait') out[k] = v;
    }
    return out;
  }, [plansEnFin, reportPlans, planOrient, userPlanPages]);
  const setPlanPage = useCallback((key, val) => {
    if (!onSetPlanPages) return;
    const next = { ...userPlanPages };
    if (val) next[key] = val;
    else if (plansEnFin) next[key] = 'inline'; // case cochée : le garder dans le texte
    else delete next[key];
    onSetPlanPages(next);
  }, [onSetPlanPages, userPlanPages, plansEnFin]);
  const isPcWide = typeof window !== 'undefined' && window.innerWidth >= 900;
  const onFullPage = isPcWide && onSetPlanPages ? (key) => setPlanPage(key, 'landscape') : null;
  // Corps du rapport : les plans sortis sur une page à part n'y apparaissent plus.
  const bodyLocs = useMemo(() => stripFullPagePlans(locs, fullPageMap), [locs, fullPageMap]);

  // breaks effectifs = breaks manuels + breaks dérivés des découpages de paragraphes
  const paraBreaks = useMemo(() =>
    new Set((pageBreaks || []).filter(id => /_p\d+$/.test(id))),
  [pageBreaks]);

  // Sauts de page AUTOMATIQUES dérivés de l'orientation : on isole chaque plan portrait sur sa
  // page. Réutilise les mêmes breakId que les sauts manuels (`plan-${loc.id}` pour le bloc plan,
  // `plan-${loc.id}_ep_${i}` pour un plan extra) → splitPlanGroups + buildPages coupent comme
  // pour un saut forcé, sans logique de pagination dédiée. Ignoré en mode « plans en fin ».
  const portraitPlanBreaks = useMemo(() => {
    const s = new Set();
    const lib = projet.planLibrary || [];
    const bgResolvable = (planId, planBg, ann) =>
      !!(ann?.exported || planBg || (planId && lib.find(p => p.id === planId)?.bg));
    for (const loc of bodyLocs) {
      const list = [];
      if ((loc.planId || loc.planBg) && !loc.planReportHidden && bgResolvable(loc.planId, loc.planBg, loc.planAnnotations))
        list.push({ planId: loc.planId, breakId: `plan-${loc.id}` });
      (loc.extraPlans || []).forEach((ep, i) => {
        if (!ep.reportHidden && bgResolvable(ep.planId, ep.planBg, ep.planAnnotations))
          list.push({ planId: ep.planId, breakId: `plan-${loc.id}_ep_${i}` });
      });
      list.forEach((pl, k) => {
        const cur  = planOrient[pl.planId] === 'portrait';
        const prev = k > 0 && planOrient[list[k - 1].planId] === 'portrait';
        // k===0 : le bloc plan démarre sa propre page si le 1er plan est portrait (séparé des
        // photos au-dessus). k>0 : coupe entre deux plans dès que l'un des deux est portrait.
        if (k === 0 ? cur : (cur || prev)) s.add(pl.breakId);
      });
    }
    return s;
  }, [bodyLocs, planOrient, projet.planLibrary]);

  const breaks = useMemo(() => {
    const s = new Set(pageBreaks || []);
    for (const id of (pageBreaks || [])) {
      if (/_p\d+$/.test(id)) {
        const base = id.replace(/_p\d+$/, '');
        for (let i = 1; i <= 9; i++) s.add(`${base}_pms${i}`);
      }
    }
    for (const id of portraitPlanBreaks) s.add(id);
    return s;
  }, [pageBreaks, portraitPlanBreaks]);
  const [editingItem, setEditingItem] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const planLocs = useMemo(() => {
    if (!plansEnFin) return [];
    const lib = projet.planLibrary || [];
    const bgResolvable = (planId, planBg, ann) =>
      !!(ann?.exported || planBg || (planId && lib.find(p => p.id === planId)?.bg));
    return localisations.filter(l => {
      const primaryOk = !l.planReportHidden && bgResolvable(l.planId, l.planBg, l.planAnnotations);
      const extraOk = (l.extraPlans || []).some(ep => !ep.reportHidden && bgResolvable(ep.planId, ep.planBg, ep.planAnnotations));
      return primaryOk || extraOk;
    });
  }, [localisations, plansEnFin, projet.planLibrary]);

  // Segments de pages pour plansEnFin : une entrée par page (une zone peut générer N pages via breaks)
  // Désactivé si plansNoBreak : les plans sont alors intégrés dans allBlocks à la fin
  const planPageSegments = useMemo(() => [], []);

  // Légende combinée pour le mode plansEnFin — affichée une seule fois sur la dernière page plan
  const combinedPlanLegend = useMemo(() => {
    if (!plansEnFin || !planPageSegments.length) return null;
    const allPaths = planPageSegments.flatMap(seg => (seg.plans || []).flatMap(p => p.annotations?.paths || []));
    const usedIds = new Set(allPaths.filter(p => p.type === 'symbol').map(p => p.symbolId));
    const symbols = getAllSymbols().filter(s => usedIds.has(s.id));
    const hasViewpoints = allPaths.some(p => p.type === 'viewpoint');
    if (!symbols.length && !hasViewpoints) return null;
    return { symbols, hasViewpoints };
  }, [planPageSegments, plansEnFin]);

  // ── Mesure des hauteurs réelles ─────────────────────────────────────────────────────────────────────────
  // Plans en fin : déjà retirés de bodyLocs (pages à part) → le corps traite les plans restants normalement.
  const allBlocks   = useMemo(() => flattenBlocks(bodyLocs, false, ppl, paraBreaks, vxxPhotoMap, plansNoBreak, projet.planLibrary || [], breaks), [bodyLocs, ppl, paraBreaks, vxxPhotoMap, plansNoBreak, projet.planLibrary, breaks]);
  const [measuredH, setMeasuredH] = useState({});
  const [gridH, setGridH] = useState({}); // hauteur NATURELLE des rangées de photos (ajustement de page)
  const blockElsRef = useRef({});

  useLayoutEffect(() => {
    const measure = () => {
      const h = {};
      for (const block of allBlocks) {
        const el = blockElsRef.current[block.id];
        if (el && el.offsetHeight > 0) h[block.id] = el.offsetHeight;
      }
      if (!Object.keys(h).length) return;
      setMeasuredH(prev => {
        const changed = allBlocks.some(b => h[b.id] && h[b.id] !== prev[b.id]);
        return changed ? { ...prev, ...h } : prev;
      });
      const g = {};
      for (const block of allBlocks) {
        const grid = blockElsRef.current[block.id]?.querySelector?.('[data-photogrid]');
        if (grid && grid.offsetHeight > 10) g[block.id] = grid.offsetHeight - 10; // - padding vertical
      }
      setGridH(prev => (allBlocks.some(b => g[b.id] && g[b.id] !== prev[b.id]) ? { ...prev, ...g } : prev));
    };
    measure();
    // Observer chaque bloc individuellement pour détecter les chargements d'images
    const ro = new ResizeObserver(measure);
    for (const block of allBlocks) {
      const el = blockElsRef.current[block.id];
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [allBlocks]);

  const pages = useMemo(
    () => buildPages(allBlocks, ppl, breaks, Object.keys(measuredH).length > 0 ? measuredH : null),
    [allBlocks, ppl, breaks, measuredH]
  );

  // ── AJUSTEMENT DE PAGE (retours Thomas 02/11 : « 4 rangées de photos sans texte ne rentrent
  //    pas sur une page », puis « ça bouge » et « que ça prenne toute la page ») : quand une page
  //    DÉBORDE de peu et contient des photos, seules ses rangées de photos sont ajustées :
  //      1) d'abord un cadre un peu plus PANORAMIQUE (4:3 → au plus 3:2), PLEINE largeur : la page
  //         est remplie, on rogne au plus ~11 % en haut/bas ;
  //      2) si ça ne suffit pas, ou si une photo est annotée / « image entière » (jamais rognée),
  //         la rangée est réduite et centrée — jamais sous FIT_MIN.
  //    Débordement trop fort : rien n'est ajusté (photos gardées grandes, avertissement conservé).
  //    Calcul PUR à partir de la couche de mesure (taille réelle, hors zoom) : aucune boucle de
  //    mesure → plus de « saut » de l'aperçu. Le PDF imprime ce même aperçu → identique.
  const FIT_MIN = 0.8;
  const FIT_AR_MIN = 8 / 9; // 4:3 → 3:2
  const FIT_TARGET = PH - (HDR + 1) - (MT - HDR) - (MB + FTR) - 4; // hauteur utile d'une page A4
  const pageFit = useMemo(() => pages.map(pageBlocks => {
    let H = 0, P = 0, sensitive = false;
    for (const b of pageBlocks) {
      const h = measuredH[b.id];
      if (!h) return null; // mesure pas encore prête
      H += h;
      if (gridH[b.id]) {
        P += gridH[b.id];
        if ((b.item?.photos || []).some(ph => ph?.annotations?.length || ph?.cropFit)) sensitive = true;
      }
    }
    if (!P || H <= FIT_TARGET) return null;
    const need = 1 - (H - FIT_TARGET) / P; // facteur de hauteur des photos nécessaire
    const ar = sensitive ? 1 : Math.max(need, FIT_AR_MIN);
    const w = Math.min(1, need / ar);
    if (w < FIT_MIN) return null;
    return { ar: Math.floor(ar * 1000) / 1000, w: Math.floor(w * 1000) / 1000 };
  }), [pages, measuredH, gridH]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pages « plan à part » dans l'ordre du rapport.
  const landscapePlans = useMemo(() => reportPlans.filter(p => fullPageMap[p.key])
    .map(p => ({ ...p, orient: fullPageMap[p.key] === 'portrait' ? 'portrait' : 'landscape' })), [reportPlans, fullPageMap]);

  const containerRef = useRef();
  const scrollRef    = useRef();
  const pageRefs     = useRef([]);
  const scale = usePreviewScale(scrollRef);

  const recapItems    = localisations.flatMap(l => (l.items || []).filter(i => !isBrouillon(i) && i.titre && i.suivi !== 'fait'));
  // Le tableau s'affiche dès qu'il y a des lignes à montrer : lignes calculées (recapRows,
  // qui incluent les lignes personnalisées/IA ET les observations sans intitulé) OU, en repli,
  // des items avec intitulé. Avant : basé uniquement sur recapItems (intitulé obligatoire) →
  // le tableau (ex. lignes générées par IA, ou observations sans titre) disparaissait à tort.
  const hasTableau    = includeTableauRecap && (((recapRows?.length || 0) > 0) || recapItems.length > 0);
  const hasConclusion = includeConclusion;

  // Calcul des chunks de participants pour la page de garde (overflow → pages supplémentaires)
  const coverInfoRows = [
    projet.adresse, projet.dateVisite, projet.maitreOuvrage,
  ].filter(Boolean);
  const participantChunks = useMemo(
    // On exclut du rapport les séparateurs DÉSACTIVÉS (on:false) ; les personnes et séparateurs
    // actifs sont paginés normalement.
    () => computeParticipantChunks((projet.participants || []).filter(p => !(p.type === 'separator' && p.on === false)), coverInfoRows.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projet.participants, coverInfoRows.length]
  );
  const coverPageCount = participantChunks.length; // toujours ≥ 1

  // ── ANNEXES : slots de page connus AVANT le rendu (le nb de pages est en métadonnée) →
  //    totalPages est correct immédiatement, les images se remplissent en asynchrone. ──────────
  const annexList = annexes || [];
  const annexPageList = useMemo(() => {
    const out = [];
    annexList.forEach(a => {
      const pc = Math.max(1, a.pageCount || 1);
      for (let p = 1; p <= pc; p++) out.push({ annexId: a.id, name: a.name, page: p, pageCount: pc });
    });
    return out;
  }, [annexList]);
  const annexPageCount = annexList.length ? 1 + annexPageList.length : 0; // 1 = page de garde récap
  const [annexImages, setAnnexImages] = useState({}); // annexId → [dataURL par page]

  // Rend chaque annexe (PDF → images bornées) une fois, en cache session. Déclenché à
  // l'affichage du rapport → prêt avant l'export. Largeur bornée = compression (< 25 Mo email).
  useEffect(() => {
    if (!annexList.length || !projet.id) return;
    let cancelled = false;
    (async () => {
      for (const a of annexList) {
        const key = `${projet.id}|${a.id}`;
        if (_annexImgCache.has(key)) {
          setAnnexImages(prev => (prev[a.id] ? prev : { ...prev, [a.id]: _annexImgCache.get(key) }));
          continue;
        }
        try {
          const pdf = await fetchAnnexPdf(projet.id, a.id);
          if (cancelled) return;
          if (!pdf) continue;
          const pc = Math.max(1, a.pageCount || 1);
          const nums = Array.from({ length: pc }, (_, i) => i + 1);
          const rendered = await renderPdfPages(pdf, nums, { maxWidth: ANNEX_PAGE_MAXW, quality: 0.7 });
          if (cancelled) return;
          const imgs = nums.map(n => rendered.find(r => r.num === n)?.img || null);
          _annexImgCache.set(key, imgs);
          setAnnexImages(prev => ({ ...prev, [a.id]: imgs }));
        } catch { /* annexe ignorée si illisible */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annexList, projet.id]);

  const totalPages    = coverPageCount + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + planPageSegments.length + landscapePlans.length + annexPageCount;

  // Suivi de la page courante via scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const ctop = el.getBoundingClientRect().top;
      let bestPage = 1, bestDist = Infinity;
      pageRefs.current.forEach((ref, i) => {
        if (!ref) return;
        const dist = Math.abs(ref.getBoundingClientRect().top - ctop - 30);
        if (dist < bestDist) { bestDist = dist; bestPage = i + 1; }
      });
      setCurrentPage(bestPage);
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [totalPages]);

  const scrollToPage = useCallback((n) => {
    const idx = Math.max(0, Math.min(totalPages - 1, n - 1));
    const ref = pageRefs.current[idx];
    if (!ref || !scrollRef.current) return;
    const elTop = ref.getBoundingClientRect().top;
    const ctop  = scrollRef.current.getBoundingClientRect().top;
    scrollRef.current.scrollBy({ top: elTop - ctop - 16, behavior: 'smooth' });
  }, [totalPages]);

  // ── Mode coupe — callback commun pour CutZone et ParaCutZone ──────────────────────────────
  const handleCut = useCallback((id) => {
    onTogglePageBreak(id);
  }, [onTogglePageBreak]);

  useEffect(() => {
    if (!cutMode) return;
    const onKey = (e) => { if (e.key === 'Escape') onCutModeChange?.(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cutMode, onCutModeChange]);

  // ── Impression navigateur (preview = PDF pixel-perfect) ──────────────────────────────────
  // Clones des pages + encodage des images avec le BUDGET DE POIDS (< 5 Mo) — partagé par
  // print() (impression navigateur) et toPdfBlob() (export groupé en zip). Une seule source de
  // vérité pour le poids des PDF (exigence Thomas, cf. CLAUDE.md).
  // idle : pré-calcul en arrière-plan (aperçu PC) → une image à la fois, en laissant la main à
  // l'interface entre deux ; stop() → abandon (ex. le contenu a changé entre-temps).
  const encodePageClones = async (pages, onProgress = null, { idle = false, stop = null } = {}) => {
    // ── Encodage des images + BUDGET DE POIDS (cible < 5 Mo — exigence Thomas) ─────────────
    // C'est ICI que se joue le poids du PDF : sans réduction, le navigateur embarque chaque
    // photo en pleine résolution capteur → PDF de 100+ Mo.
    //  • PHOTOS : compressées, et RÉDUITES EN PREMIER si on dépasse le budget.
    //  • PLANS / ANNEXES (data-role="plan") : gardés NETS (haute résolution, « comme le PDF »),
    //    réduits seulement EN DERNIER RECOURS.
    // VITESSE (retour Thomas 19/10 : « écran blanc 15 s ») :
    //  • chaque encodage (source × définition × qualité) est MÉMORISÉ pour la session
    //    (_pdfEncCache) → 2e export quasi instantané, et l'aperçu PC le prépare en avance ;
    //  • décodage via createImageBitmap (hors du fil principal) quand disponible ;
    //  • budget : on SAUTE directement au palier estimé suffisant au lieu de tous les essayer.
    const TARGET_BYTES = Math.round(5 * 1024 * 1024 * 0.92); // ~4,6 Mo d'images → marge sous 5 Mo
    const PHOTO_TIERS = [[1280, 0.72], [1040, 0.68], [880, 0.62], [740, 0.56], [620, 0.5]];
    const PLAN_TIERS  = [[3000, 0.85], [2400, 0.82], [1900, 0.76], [1500, 0.7], [1200, 0.66]];
    // Décodage → encodage → libération IMMÉDIATE (une photo 12 Mpx décodée ≈ 48 Mo : on n'en
    // garde jamais plusieurs dizaines en mémoire → pas de plantage iPhone) ; 4 images max à la fois.
    let slots = 4; const waiters = [];
    const withSlot = async (fn) => {
      if (slots > 0) slots--; else await new Promise(r => waiters.push(r));
      try { return await fn(); } finally { const w = waiters.shift(); if (w) w(); else slots++; }
    };
    const loadImg = async (src) => {
      const resp = await fetch(src); if (!resp.ok) throw new Error('fetch');
      const blob = await resp.blob();
      if (typeof createImageBitmap === 'function') {
        try {
          const bm = await createImageBitmap(blob);
          return { w: bm.width, h: bm.height, draw: (ctx, W, H) => ctx.drawImage(bm, 0, 0, W, H), close: () => { try { bm.close(); } catch { /* ignore */ } } };
        } catch { /* format non géré → repli <img> */ }
      }
      const u = URL.createObjectURL(blob);
      try {
        const im = await new Promise((res, rej) => { const i = new window.Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
        return { w: im.naturalWidth, h: im.naturalHeight, draw: (ctx, W, H) => ctx.drawImage(im, 0, 0, W, H), close: () => URL.revokeObjectURL(u) };
      } catch (e) { URL.revokeObjectURL(u); throw e; }
    };
    const encodeAt = (src, maxW, q) => {
      const key = `${pdfSrcKey(src)}|${maxW}|${q}`;
      if (_pdfEncCache.has(key)) return _pdfEncCache.get(key);
      const p = withSlot(async () => {
        let im = null;
        try {
          im = await loadImg(src);
          // Logos/sigles (< 1000px) : INTACTS (l'aplatissement JPEG casserait leur transparence →
          // fond blanc). SEULES les blob: doivent être cuites (invalides hors du document d'origine).
          if (!src.startsWith('blob:') && im.w < 1000 && im.h < 1000) return src;
          const scale = Math.min(1, maxW / im.w);
          const W = Math.max(1, Math.round(im.w * scale));
          const H = Math.max(1, Math.round(im.h * scale));
          const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
          im.draw(ctx, W, H);
          const out = cv.toDataURL('image/jpeg', q); cv.width = 0; cv.height = 0;
          return out && out.length > 50 ? out : src;
        } catch { return src; } finally { im?.close(); }
      });
      pdfCacheSet(key, p);
      return p;
    };

    // 1) Construire les clones + inventorier chaque image (photo vs plan).
    const clones = [];
    const imgJobs = []; // { el, src, role }
    for (const el of pages) {
      const origCanvases = Array.from(el.querySelectorAll('canvas'));
      // Calques (annotations des photos) : PNG transparent, à garder TEL QUEL (jamais en JPEG :
      // le fond blanc du JPEG masquait la photo → photos annotées BLANCHES dans le PDF).
      const canvasData = idle ? [] : origCanvases.map(c => { try { return { src: c.toDataURL(), cssText: c.style.cssText }; } catch { return null; } });
      origCanvases.forEach((c, i) => { c.dataset._pi = String(i); });
      const clone = el.cloneNode(true);
      origCanvases.forEach(c => { delete c.dataset._pi; });
      clone.querySelectorAll('[data-print="hide"]').forEach(e => e.remove());
      clone.querySelectorAll('canvas').forEach(canvas => {
        const i = parseInt(canvas.dataset._pi ?? '-1');
        const data = i >= 0 ? canvasData[i] : null;
        if (!data?.src) { canvas.parentNode?.removeChild(canvas); return; }
        try { const img = document.createElement('img'); img.src = data.src; img.style.cssText = data.cssText; img.setAttribute('data-role', 'overlay'); canvas.parentNode?.replaceChild(img, canvas); } catch {}
      });
      clone.style.marginTop = '0';
      Array.from(clone.querySelectorAll('img[src]')).forEach(img => {
        const src = img.getAttribute('src');
        if (!src) return;
        const role = img.getAttribute('data-role');
        if (role === 'overlay') return; // calque transparent : intact
        // On traite data:, http(s) ET blob: — un blob: (URL liée au document d'origine) n'est PAS
        // rendable dans la fenêtre d'impression → il DOIT être cuit en data URL (sinon photo blanche).
        if (!src.startsWith('data:image/') && !/^https?:/i.test(src) && !src.startsWith('blob:')) return;
        imgJobs.push({ el: img, src, role: role === 'plan' ? 'plan' : 'photo' });
      });
      clones.push(clone);
    }

    // 2) Encodage initial (plans nets, photos compressées) puis budget.
    let photoTier = 0, planTier = 0;
    const bytesOf = (s) => (s && s.startsWith('data:')) ? Math.round(s.length * 0.75) : 0;
    const encoded = new Map(); // el → dataURL courant
    let doneJobs = 0;
    const reencode = async (role) => {
      const [pMaxW, pQ] = PHOTO_TIERS[photoTier];
      const [lMaxW, lQ] = PLAN_TIERS[planTier];
      const list = imgJobs.filter(j => role == null || j.role === role);
      doneJobs = 0;
      const one = async j => {
        const [mw, q] = j.role === 'plan' ? [lMaxW, lQ] : [pMaxW, pQ];
        encoded.set(j.el, await encodeAt(j.src, mw, q));
        doneJobs++; onProgress?.(doneJobs, list.length);
      };
      if (!idle) { await Promise.all(list.map(one)); return; }
      for (const j of list) {
        if (stop?.()) throw new Error('stopped');
        await new Promise(r => (window.requestIdleCallback ? window.requestIdleCallback(r, { timeout: 1500 }) : setTimeout(r, 30)));
        await one(j);
      }
    };
    const measure = (role) => imgJobs.filter(j => role == null || j.role === role).reduce((s, j) => s + bytesOf(encoded.get(j.el)), 0);
    // Estimation du poids à un palier (≈ pixels × qualité) → on saute au premier palier suffisant.
    const est = (tiers, from, to) => { const [w0, q0] = tiers[from], [w1, q1] = tiers[to]; return Math.pow(w1 / w0, 2) * Math.pow(q1 / q0, 1.5); };
    const photoJobs = imgJobs.filter(j => j.role === 'photo');
    if (photoJobs.length > 12) {
      // Gros rapport : poids estimé sur un ÉCHANTILLON de photos → palier de départ choisi
      // d'emblée (évite d'encoder toutes les photos deux fois). Le budget ci-dessous vérifie
      // ensuite le poids RÉEL et descend encore si besoin.
      await reencode('plan');
      const sample = Array.from({ length: 8 }, (_, i) => photoJobs[Math.floor(i * photoJobs.length / 8)]);
      const encSample = async j => { encoded.set(j.el, await encodeAt(j.src, ...PHOTO_TIERS[0])); };
      if (idle) { for (const j of sample) { if (stop?.()) throw new Error('stopped'); await new Promise(r => setTimeout(r, 30)); await encSample(j); } }
      else await Promise.all(sample.map(encSample));
      const photoB = sample.reduce((s, j) => s + bytesOf(encoded.get(j.el)), 0) / sample.length * photoJobs.length;
      const otherB = measure() - sample.reduce((s, j) => s + bytesOf(encoded.get(j.el)), 0);
      while (photoTier < PHOTO_TIERS.length - 1 && otherB + photoB * est(PHOTO_TIERS, 0, photoTier) > TARGET_BYTES) photoTier++;
      await reencode('photo');
    } else await reencode(null);
    let total = measure(), guard = 0;
    while (total > TARGET_BYTES && guard++ < 10) {
      if (photoTier < PHOTO_TIERS.length - 1) {
        const photoB = measure('photo'), otherB = total - photoB;
        let t = photoTier + 1;
        while (t < PHOTO_TIERS.length - 1 && otherB + photoB * est(PHOTO_TIERS, photoTier, t) > TARGET_BYTES) t++;
        photoTier = t; await reencode('photo');
      } else if (planTier < PLAN_TIERS.length - 1) {
        const planB = measure('plan'), otherB = total - planB;
        let t = planTier + 1;
        while (t < PLAN_TIERS.length - 1 && otherB + planB * est(PLAN_TIERS, planTier, t) > TARGET_BYTES) t++;
        planTier = t; await reencode('plan');
      } else break;
      total = measure();
    }
    if (!idle) console.log(`[PDF] Images ~${(total / 1048576).toFixed(1)} Mo (photos palier ${photoTier + 1}/${PHOTO_TIERS.length}, plans palier ${planTier + 1}/${PLAN_TIERS.length}) — avant impression navigateur`);
    // 3) Appliquer les sources encodées.
    imgJobs.forEach(j => { j.el.setAttribute('src', encoded.get(j.el) || j.src); });
    return clones;
  };

  // PRÉ-CALCUL (PC uniquement) : quelques secondes après l'affichage de l'aperçu, les images du
  // PDF sont encodées en tâche de fond (une à la fois, quand l'interface est libre) → au clic
  // « PDF », l'encodage est déjà fait. Refait seulement si les images du rapport changent.
  const prewarmRef = useRef({ sig: '', run: 0 });
  const stopPrewarm = () => { prewarmRef.current.run++; };
  useEffect(() => {
    if (typeof window === 'undefined' || window.innerWidth < 900 || window.matchMedia?.('(pointer: coarse)')?.matches) return undefined;
    const t = setTimeout(() => {
      const pgs = pageRefs.current.filter(Boolean);
      if (!pgs.length) return;
      const sig = pgs.map(el => Array.from(el.querySelectorAll('img[src]')).map(i => pdfSrcKey(i.getAttribute('src'))).join(',')).join(';');
      if (sig === prewarmRef.current.sig) return;
      const my = ++prewarmRef.current.run;
      prewarmRef.current.sig = sig;
      encodePageClones(pgs, null, { idle: true, stop: () => prewarmRef.current.run !== my }).catch(() => {});
    }, 3000);
    return () => clearTimeout(t);
  });
  useEffect(() => () => { prewarmRef.current.run++; }, []);

  useImperativeHandle(ref, () => ({
    // EXPORT GROUPÉ (zip de tous les rapports, PC — demande Thomas 15/10/2026) : le rapport est
    // rendu EXACTEMENT comme l'aperçu (mêmes pages, mêmes images encodées sous budget), chaque
    // page est photographiée puis assemblée en PDF A4. Budget de poids : si le PDF dépasse ~5 Mo,
    // on reprend avec une définition / qualité plus basse (texte encore lisible au dernier palier).
    toPdfBlob: async () => {
      const pages = pageRefs.current.filter(Boolean);
      if (!pages.length) return null;
      const land = pages.map(el => el.dataset?.landscape === '1'); // pages A4 PAYSAGE (plans en grand)
      const clones = await encodePageClones(pages);
      const [{ toJpeg }, { PDFDocument }] = await Promise.all([import('html-to-image'), import('pdf-lib')]);
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:fixed;left:-20000px;top:0;width:891px;pointer-events:none;z-index:-1;';
      const boxes = clones.map((c, i) => {
        const box = document.createElement('div');
        box.style.cssText = `width:${land[i] ? 891 : 630}px;height:${land[i] ? 630 : 891}px;overflow:hidden;position:relative;background:#fff;box-sizing:border-box;font-family:'Open Sans','Inter',system-ui,sans-serif;`;
        box.innerHTML = c.innerHTML;
        host.appendChild(box);
        return box;
      });
      document.body.appendChild(host);
      try {
        // Images (déjà en data URL) décodées + polices prêtes avant la capture.
        await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise(r => setTimeout(r, 1500))]);
        await Promise.all(Array.from(host.querySelectorAll('img')).map(im => im.complete ? null : new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 4000); })));
        // Une image injoignable (réseau) ne doit jamais faire échouer tout le rapport → pixel blanc.
        const BLANK_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
        const TARGET = Math.round(5 * 1024 * 1024 * 0.95);
        const TIERS = [[2.4, 0.82], [2, 0.78], [1.7, 0.74], [1.45, 0.7], [1.25, 0.66]];
        let shots = null;
        for (const [ratio, quality] of TIERS) {
          shots = [];
          for (const [i, box] of boxes.entries()) {
            shots.push(await toJpeg(box, { pixelRatio: ratio, quality, backgroundColor: '#ffffff', width: land[i] ? 891 : 630, height: land[i] ? 630 : 891, cacheBust: false, imagePlaceholder: BLANK_PX }));
          }
          const bytes = shots.reduce((t, d) => t + Math.round((d.length - d.indexOf(',') - 1) * 0.75), 0);
          console.log(`[PDF zip] ${boxes.length} pages ~${(bytes / 1048576).toFixed(1)} Mo (×${ratio}, q${quality})`);
          if (bytes <= TARGET) break;
        }
        const pdf = await PDFDocument.create();
        pdf.setTitle(projet.visiteNom ? `${projet.nom || 'Projet'} - CR ${projet.visiteNom}` : `${projet.nom || 'Projet'} - CR`);
        const A4W = 595.28, A4H = 841.89;
        for (const [i, d] of shots.entries()) {
          const jpg = await pdf.embedJpg(d);
          const [w, h] = land[i] ? [A4H, A4W] : [A4W, A4H];
          const page = pdf.addPage([w, h]);
          page.drawImage(jpg, { x: 0, y: 0, width: w, height: h });
        }
        const bytes = await pdf.save();
        return new Blob([bytes], { type: 'application/pdf' });
      } finally {
        host.remove();
      }
    },
    print: async () => {
      const pages = pageRefs.current.filter(Boolean);
      if (!pages.length) return;

      const win = window.open('', '_blank');
      if (!win) { alert("Autorisez les pop-ups pour exporter le PDF"); return; }
      // Écran d'attente dans la fenêtre (au lieu d'une page blanche) + avancement de l'encodage.
      let progEl = null;
      try {
        win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Préparation du PDF…</title></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:#f4f4f5;color:#333"><div style="text-align:center"><div style="font-size:16px;font-weight:700">Préparation du PDF…</div><div id="prog" style="margin-top:8px;font-size:13px;color:#777">Optimisation des images</div></div></body></html>`);
        win.document.close();
        progEl = win.document.getElementById('prog');
      } catch { /* fenêtre non scriptable → on continue sans écran d'attente */ }
      const onProgress = (done, total) => { try { if (progEl && total) progEl.textContent = `Optimisation des images ${done} / ${total}`; } catch { /* ignore */ } };
      stopPrewarm();

      const land = pages.map(el => el.dataset?.landscape === '1'); // pages A4 PAYSAGE (plans en grand)
      const clones = await encodePageClones(pages, onProgress);
      if (win.closed) return; // fenêtre fermée pendant la préparation
      try { win.document.open(); } catch { /* ignore */ }

      const pagesHtml = clones.map((c, i) => `<div class="pdf-page${land[i] ? ' land' : ''}">${c.innerHTML}</div>`).join('\n');

      // CSS : 1px CSS = 1/96 inch, 1mm = 3.7795px → PW=630px = 166.7mm.
      // On scale html à 210mm/630px ≈ 1.2597 pour A4 exact.
      const safeName   = (projet.nom      || 'Projet').replace(/[<>"]/g, '');
      const safeVisite = (projet.visiteNom || '').replace(/[<>"]/g, '');
      const printTitle = safeVisite ? `${safeName} - CR ${safeVisite}` : `${safeName} - CR`;
      win.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>${printTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800&family=Open+Sans:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 0; }
  @page land { size: A4 landscape; margin: 0; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; font-family: 'Open Sans', 'Inter', system-ui, -apple-system, sans-serif; }
  html, body { margin: 0; padding: 0; background: white; }
  .pdf-page { width: 630px; height: 891px; overflow: hidden; position: relative; display: block; page-break-after: always; break-after: page; }
  .pdf-page:last-child { page-break-after: avoid; break-after: avoid; }
  .pdf-page.land { width: 891px; height: 630px; page: land; }
  @media screen { body { background: #555; display: flex; flex-direction: column; align-items: center; padding: 20px 0; gap: 16px; } .pdf-page { box-shadow: 0 2px 20px rgba(0,0,0,0.35); } }
  @media print { html { zoom: 1.2597; } body { background: white; padding: 0; } .pdf-page { box-shadow: none; } }
</style>
</head><body>${pagesHtml}</body></html>`);

      win.document.close();
      // Pose explicite du titre : certains navigateurs n'utilisent pas le <title> écrit via
      // document.write pour le nom du fichier « Enregistrer en PDF » → on le force.
      try { win.document.title = printTitle; } catch {}
      const doPrint = () => { try { win.document.title = printTitle; win.focus(); win.print(); } catch {} };
      // On n'attend que les images NON encore chargées (les data-URL et images en cache HTTP
      // sont déjà prêtes → résolution quasi instantanée). Plafond court pour ne pas bloquer.
      const waitImages = () => new Promise(resolve => {
        const pending = Array.from(win.document.images).filter(i => !i.complete);
        if (!pending.length) { resolve(); return; }
        let n = pending.length;
        const done = () => { if (--n <= 0) resolve(); };
        pending.forEach(img => { img.addEventListener('load', done); img.addEventListener('error', done); });
        setTimeout(resolve, 3500);
      });
      // Le navigateur attend lui-même les polices avant d'imprimer → on ne bloque pas longtemps ici.
      const waitFonts = Promise.race([
        win.document.fonts?.ready ?? Promise.resolve(),
        new Promise(r => setTimeout(r, 1200)),
      ]);
      Promise.all([waitFonts, waitImages()]).then(doPrint);
    }
  }));

  if (!pages.length) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10, color:DA.grayL }}>
        <span style={{ fontSize:36 }}>📄</span>
        <span style={{ fontSize:13 }}>Aucune observation à prévisualiser</span>
        <span style={{ fontSize:11 }}>Ajoutez des observations dans l'onglet Visite</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', position:'relative' }}>
      {VXX_DEBUG && vxxDebugData && (
        <div data-print="hide" style={{ maxHeight:'40vh', overflow:'auto', background:'#111', color:'#0f0', fontFamily:'monospace', fontSize:10, lineHeight:1.4, padding:'8px 10px', flexShrink:0, borderBottom:'2px solid #0f0' }}>
          <div style={{ color:'#fff', fontWeight:700, marginBottom:4 }}>VXX DEBUG — marqueurs viewpoint par localisation (screenshote ce panneau)</div>
          {vxxDebugData.map((d, i) => (
            <div key={i} style={{ marginBottom:6 }}>
              <div style={{ color:'#ff0' }}>● {d.locNom} (loc={d.locId}) — photos zone: [{d.zoneFlatIds.join(', ')}]</div>
              {d.markers.length === 0 ? <div style={{ color:'#f88' }}>  aucun marqueur viewpoint</div> :
                d.markers.map((m, j) => (
                  <div key={j}>  {m.plan} {m.label} vpNum={String(m.vpNum)} photoIdx={String(m.photoIdx)} origin={m.originLocId} owner={m.ownerId} photoId={m.photoId} →resolved={m.resolvedId}</div>
                ))}
            </div>
          ))}
        </div>
      )}
      {/* Bandeau mode coupe */}
      {cutMode && (
        <div data-print="hide" style={{ background:'#E30513', color:'white', padding:'5px 14px', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <span style={{ flex:1 }}>✂ Cliquez sur les tirets pour couper — mode persistant</span>
          <button onClick={() => onCutModeChange?.(false)}
            style={{ background:'rgba(255,255,255,0.2)', border:'1px solid rgba(255,255,255,0.4)', borderRadius:6, color:'white', fontSize:10, fontWeight:700, padding:'3px 10px', cursor:'pointer', flexShrink:0 }}>
            Terminer ✕
          </button>
        </div>
      )}

      {/* ── Barre de navigation pages ── */}
      {/* Sur écran étroit, le pager (absolu, centré 50vw) chevauchait les boutons Photos/PDF
          → il passe sur sa PROPRE ligne en dessous. Une seule ligne conservée sur desktop. */}
      {(() => { const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
      const pager = (
        <div style={ narrow
          ? { display:'flex', alignItems:'center', justifyContent:'center', gap:6 }
          : { position:'absolute', left:`calc(50vw - ${panelOpen ? panelW : 0}px)`, transform:'translateX(-50%)', display:'flex', alignItems:'center', gap:6 }}>
          <button
            onClick={() => scrollToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            style={{ background:'rgba(255,255,255,0.08)', border:'none', color: currentPage <= 1 ? 'rgba(255,255,255,0.2)' : 'white', borderRadius:6, padding:'4px 11px', cursor: currentPage <= 1 ? 'default' : 'pointer', fontSize:16, fontWeight:700, lineHeight:1 }}>
            ‹
          </button>
          <span style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.7)', letterSpacing:0.5, minWidth:70, textAlign:'center' }}>
            Page {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => scrollToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            style={{ background:'rgba(255,255,255,0.08)', border:'none', color: currentPage >= totalPages ? 'rgba(255,255,255,0.2)' : 'white', borderRadius:6, padding:'4px 11px', cursor: currentPage >= totalPages ? 'default' : 'pointer', fontSize:16, fontWeight:700, lineHeight:1 }}>
            ›
          </button>
        </div>
      );
      return (
      <div style={{ background:'#1e1e1e', padding:'6px 10px', display:'flex', flexDirection:'column', gap:6, flexShrink:0, borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display:'flex', alignItems:'center', position:'relative' }}>
          {/* Gauche : Paramètres */}
          <div style={{ flex:1, display:'flex', alignItems:'center', gap:6 }}>
            {onTogglePanel && (
              <button
                onClick={onTogglePanel}
                style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:7, border:'none', cursor:'pointer',
                  background: panelOpen ? DA.red : 'rgba(255,255,255,0.10)',
                  color: panelOpen ? 'white' : 'rgba(255,255,255,0.75)' }}>
                <Ic n="sld" s={13}/>
                <span style={{ fontSize:11, fontWeight:700, letterSpacing:0.3 }}>Paramètres</span>
              </button>
            )}
          </div>
          {/* Centre : navigation pages — sur la même ligne uniquement si l'écran est assez large */}
          {!narrow && pager}
          {/* Droite : export — Photos d'abord, PDF ensuite */}
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6 }}>
            {onExportPhotos && totalPhotos > 0 && (
              <button onClick={onExportPhotos} disabled={zipping} data-print="hide"
                style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:7, border:'none', cursor: zipping ? 'wait' : 'pointer',
                  background:'rgba(255,255,255,0.10)', color:'rgba(255,255,255,0.8)', fontSize:11, fontWeight:700 }}>
                {zipping ? <Ic n="spn" s={12}/> : <Ic n="dl" s={12}/>}
                <span>Photos ({totalPhotos})</span>
              </button>
            )}
            {onExportPdf && (
              <button onClick={onExportPdf} data-print="hide"
                style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:7, border:'none', cursor:'pointer',
                  background: DA.red, color:'white', fontSize:11, fontWeight:700 }}>
                <Ic n="fil" s={12}/>
                <span>PDF</span>
              </button>
            )}
          </div>
        </div>
        {/* Écran étroit : pager sur sa propre ligne, centré */}
        {narrow && pager}
      </div>
      ); })()}

      {/* ── Zone défilante ── */}
      <div ref={scrollRef}
        style={{ flex:1, overflowY:'auto', overflowX:'hidden', background:'#555', paddingBottom:20, position:'relative' }}
      >

        {/* ── Couche de mesure invisible ── */}
        <div style={{ position:'absolute', left:0, top:0, width:PW, height:0, overflow:'hidden', visibility:'hidden', pointerEvents:'none' }}>
          <div style={{ width:CW, visibility:'hidden', pointerEvents:'none' }}>
            {allBlocks.map(block => (
              <div key={block.id} style={{ display:'flow-root' }} ref={el => { if (el) blockElsRef.current[block.id] = el; else delete blockElsRef.current[block.id]; }}>
                {block.type === 'zone'
                  ? <ZoneHeader loc={block.loc} level={block.level} parentNom={block.parentNom} visitDate={projet.dateVisite}/>
                  : block.type === 'plan'
                  ? <PlanBlock loc={block.loc} annotScale={annotScale} planLibrary={projet.planLibrary} cutMode={false} pageBreaks={pageBreaks} onCut={handleCut} vpNumByPath={vpNumByPath} onEditPlan={onEditPlan} plansSubset={block.plansSubset ?? null} topBreakId={block.topBreakId ?? null} onOrient={handlePlanOrient} onFullPage={onFullPage}/>
                  : block.type === 'itemplan'
                  ? <ItemPlanBlock plan={block.plan} planNom={block.planNom} annotScale={annotScale} vpNumByPath={vpNumByPath} onFullPage={onFullPage ? () => onFullPage(block.id.replace(/^(.*)_iplan(\d+)$/, 'i:$1:$2')) : null}/>
                  : <ItemBlock item={block.item} ppl={ppl} visitDate={projet.dateVisite} mode={block.mode ?? 'full'} textContent={block.textContent} locId={block.locId} vpPhotoOffset={block.vpPhotoOffset ?? 0} vxxPhotoMap={block.vxxPhotoMap} photoRow={block.photoRow} photoCols={block.photoCols} isLastPhotoRow={block.isLastPhotoRow ?? true} annotScale={annotScale}/>
                }
              </div>
            ))}
          </div>
        </div>
        {/* Centré sur la largeur totale du viewport (pas seulement la zone preview) */}
        <div style={{ width: PW, marginLeft:`calc(max(10px, 50vw - ${panelW}px - ${Math.round(PW * scale / 2)}px))`, marginRight:0, zoom: scale, display:'flex', flexDirection:'column', alignItems:'center' }}>

        {/* ── PAGE DE GARDE (page 1) ── */}
        <div ref={el => { pageRefs.current[0] = el; }} style={{ marginTop:20 }}>
          <CoverPage projet={projet} pageNum={1} totalPages={totalPages} participantChunk={participantChunks[0]}/>
        </div>

        {/* ── PAGES DE GARDE SUITE (overflow participants) ── */}
        {participantChunks.slice(1).map((chunk, i) => (
          <React.Fragment key={`cover-overflow-${i}`}>
            <PageSepBanner pageNum={i + 2} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
            <div ref={el => { pageRefs.current[i + 1] = el; }}>
              <CoverOverflowPage projet={projet} pageNum={i + 2} totalPages={totalPages} participantChunk={chunk}/>
            </div>
          </React.Fragment>
        ))}

        {/* ── PAGES OBSERVATIONS ── */}
        {pages.map((pageBlocks, pi) => {
          const firstId     = pageBlocks[0]?.id;
          const firstBlock  = pageBlocks[0];
          const firstForced = breaks.has(firstId);
          const pageNum     = coverPageCount + 1 + pi;
          return (
            <React.Fragment key={pi}>
              <PageSepBanner
                pageNum={pageNum}
                totalPages={totalPages}
                firstBlockId={firstId}
                isForced={firstForced}
                onToggle={onTogglePageBreak}
              />
              <div ref={el => { pageRefs.current[coverPageCount + pi] = el; }}>
                <A4Card projet={projet} pageNum={pageNum} totalPages={totalPages}>
                  {/* Bouton de suppression d'un saut forcé — uniquement en mode édition cutMode */}
                  {cutMode && firstForced && firstBlock && (
                    <div data-print="hide">
                      <TopBreakControl
                        id={firstId}
                        zoneName={firstBlock.type === 'zone' ? firstBlock.loc?.nom : firstBlock.item?.titre}
                        onToggle={onTogglePageBreak}
                      />
                    </div>
                  )}
                  {pageBlocks.map((block, bi) => {
                    const isCutCandidate = !(pi === 0 && bi === 0);
                    return (
                    <React.Fragment key={block.id}>
                      <CutZone blockId={block.id} active={cutMode && isCutCandidate} onCut={handleCut}/>
                      {/* flow-root : même empilement (marges comprises) que la couche de mesure → la
                          hauteur calculée d'une page = la hauteur réelle (ajustement de page fiable). */}
                      <div style={{ display:'flow-root' }}>
                        {block.type === 'zone'
                          ? <ZoneHeader loc={block.loc} level={block.level} parentNom={block.parentNom} visitDate={projet.dateVisite}/>
                          : block.type === 'plan'
                          ? <PlanBlock loc={block.loc} annotScale={annotScale} onAnnotScaleChange={onAnnotScaleChange} planLibrary={projet.planLibrary} cutMode={cutMode} pageBreaks={pageBreaks} onCut={handleCut} vpNumByPath={vpNumByPath} onEditPlan={onEditPlan} plansSubset={block.plansSubset ?? null} topBreakId={block.topBreakId ?? null} onOrient={handlePlanOrient} onFullPage={onFullPage}/>
                          : block.type === 'itemplan'
                          ? <ItemPlanBlock plan={block.plan} planNom={block.planNom} annotScale={annotScale} vpNumByPath={vpNumByPath} onFullPage={onFullPage ? () => onFullPage(block.id.replace(/^(.*)_iplan(\d+)$/, 'i:$1:$2')) : null}/>
                          : <ItemBlock item={block.item} ppl={ppl} mode={block.mode ?? 'full'}
                              visitDate={projet.dateVisite}
                              textContent={block.textContent}
                              onEdit={onUpdateItem ? () => setEditingItem({ item: block.item, locId: block.locId }) : null}
                              locId={block.locId}
                              vpPhotoOffset={block.vpPhotoOffset ?? 0}
                              vxxPhotoMap={block.vxxPhotoMap}
                              photoRow={block.photoRow}
                              photoCols={block.photoCols}
                              isLastPhotoRow={block.isLastPhotoRow ?? true}
                              cutMode={cutMode}
                              onParaCut={handleCut}
                              annotScale={annotScale}
                              photoAnnotScales={photoAnnotScales}
                              photoFit={pageFit[pi] ?? null}
                              onAnnotatePhoto={onAnnotatePhoto}
                              onPhotoCropChange={onUpdateItem ? (photo, cx, cy, cz, orient, fit = false) => {
                                if (!photo) return;
                                // Persistance durable par id de ligne photo (survit au reload
                                // indépendamment de la chaîne cache/fusion/hydratation).
                                if (photo._id) setPhotoPref(photo._id, { cropX: cx, cropY: cy, cropZoom: cz, orient, cropFit: !!fit });
                                onUpdateItem(block.locId, block.item.id, {
                                  photos: (block.item.photos || []).map(ph => ph === photo ? { ...ph, cropX: cx, cropY: cy, cropZoom: cz, orient, cropFit: !!fit } : ph),
                                });
                              } : null}
                            />
                        }
                      </div>
                    </React.Fragment>
                    );
                  })}
                </A4Card>
              </div>
            </React.Fragment>
          );
        })}

        {/* ── PAGE TABLEAU RÉCAP ── */}
        {hasTableau && (() => {
          const pageNum = coverPageCount + pages.length + 1;
          const pageIdx = coverPageCount + pages.length;
          return (
            <>
              <PageSepBanner pageNum={pageNum} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
              <div ref={el => { pageRefs.current[pageIdx] = el; }}>
                <TableauRecapPage
                  localisations={localisations}
                  projet={projet}
                  pageNum={pageNum}
                  totalPages={totalPages}
                  tableauRecap={tableauRecap}
                  recapRows={recapRows}
                  onUpdateRecap={onUpdateRecap}
                  onDeleteRecap={onDeleteRecap}
                  onAddCustomRow={onAddCustomRow}
                />
              </div>
            </>
          );
        })()}

        {/* ── PAGE CONCLUSION ── */}
        {hasConclusion && (() => {
          const pageNum = coverPageCount + pages.length + (hasTableau ? 1 : 0) + 1;
          const pageIdx = coverPageCount + pages.length + (hasTableau ? 1 : 0);
          return (
            <>
              <PageSepBanner pageNum={pageNum} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
              <div ref={el => { pageRefs.current[pageIdx] = el; }}>
                <ConclusionPage
                  conclusion={conclusion}
                  conclusionAlign={conclusionAlign}
                  projet={projet}
                  pageNum={pageNum}
                  totalPages={totalPages}
                  onUpdateConclusion={onUpdateConclusion}
                  onUpdateConclusionAlign={onUpdateConclusionAlign}
                  localisations={locs}
                />
              </div>
            </>
          );
        })()}

        {planPageSegments.map((seg, pi) => {
          const isLastPlanPage = pi === planPageSegments.length - 1;
          const pageNum = coverPageCount + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + pi + 1;
          const pageIdx = coverPageCount + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + pi;
          return (
            <React.Fragment key={`plan-end-${seg.loc.id}-${seg.segIdx}`}>
              <PageSepBanner pageNum={pageNum} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
              <div ref={el => { pageRefs.current[pageIdx] = el; }}>
                <A4Card projet={projet} pageNum={pageNum} totalPages={totalPages}>
                  <PlanBlock loc={seg.loc} annotScale={annotScale} onAnnotScaleChange={onAnnotScaleChange} planLibrary={projet.planLibrary} cutMode={cutMode} pageBreaks={pageBreaks} onCut={handleCut} plansSubset={seg.plans} topBreakId={seg.topBreakId} vpNumByPath={vpNumByPath} hideLegend={true} onEditPlan={onEditPlan}/>
                  {isLastPlanPage && combinedPlanLegend && (
                    <div style={{ padding:'8px 12px 10px', background:'#F2F2F2', borderTop:`1px solid #DFE4E8` }}>
                      <div style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Légende</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 14px' }}>
                        {combinedPlanLegend.symbols.map(s => (
                          <div key={s.id} style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, fontFamily:"'Open Sans', sans-serif", color:'#4D4D4D' }}>
                            <SymbolIcon sym={s} size={16}/>
                            {s.label}
                          </div>
                        ))}
                        {combinedPlanLegend.hasViewpoints && (
                          <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, fontFamily:"'Open Sans', sans-serif", color:'#4D4D4D' }}>
                            <ViewpointIcon size={16}/>
                            Vue photo
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </A4Card>
              </div>
            </React.Fragment>
          );
        })}

        {/* ── PLANS SUR PAGE À PART (A4 paysage ou portrait), en fin de rapport ── */}
        {landscapePlans.map((lp, k) => {
          const pageIdx = coverPageCount + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + planPageSegments.length + k;
          const pageNum = pageIdx + 1;
          return (
            <React.Fragment key={`land-${lp.key}`}>
              <PageSepBanner pageNum={pageNum} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
              {/* Paysage : A4 couché (297×210) affiché à la largeur des pages de l'aperçu ; exporté en vrai A4 paysage. */}
              <div style={lp.orient === 'landscape' ? { zoom: PW / PH } : undefined}>
                <div ref={el => { pageRefs.current[pageIdx] = el; }} data-landscape={lp.orient === 'landscape' ? '1' : undefined}>
                  <PlanFullPage plan={lp.plan} title={lp.title} projet={projet} pageNum={pageNum} totalPages={totalPages} annotScale={annotScale} vpNumByPath={vpNumByPath}
                    orientation={lp.orient} onOrient={handlePlanOrient} onChange={isPcWide && onSetPlanPages ? (v) => setPlanPage(lp.key, v) : null}/>
                </div>
              </div>
            </React.Fragment>
          );
        })}

        {/* ── ANNEXES : page de garde récap + une page par page de PDF joint ── */}
        {annexPageCount > 0 && (() => {
          const base = coverPageCount + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + planPageSegments.length + landscapePlans.length;
          return (
            <React.Fragment key="annexes">
              {/* Page de garde « Annexes » (récap des noms) */}
              <PageSepBanner pageNum={base + 1} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
              <div ref={el => { pageRefs.current[base] = el; }}>
                <AnnexRecapPage annexes={annexList} projet={projet} pageNum={base + 1} totalPages={totalPages}/>
              </div>
              {/* Une page par page de chaque PDF joint */}
              {annexPageList.map((ap, k) => {
                const pageNum = base + 2 + k;
                const pageIdx = base + 1 + k;
                const img = annexImages[ap.annexId]?.[ap.page - 1] || null;
                const loading = !annexImages[ap.annexId];
                return (
                  <React.Fragment key={`annex-${ap.annexId}-${ap.page}`}>
                    <PageSepBanner pageNum={pageNum} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
                    <div ref={el => { pageRefs.current[pageIdx] = el; }}>
                      <AnnexImagePage img={img} name={ap.name} docPage={ap.page} docTotal={ap.pageCount}
                        pageNum={pageNum} totalPages={totalPages} loading={loading}/>
                    </div>
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })()}

        <div style={{ height:24 }}/>
        </div>{/* fin conteneur scalé */}

        {editingItem && (() => {
          const editingLoc = localisations.find(l => l.id === editingItem.locId);
          return (
            <ItemModal
              item={editingItem.item}
              planBg={editingLoc?.planBg}
              planAnnotations={editingLoc?.planAnnotations}
              onClose={() => setEditingItem(null)}
              onSave={(form) => {
                onUpdateItem(editingItem.locId, editingItem.item.id, form);
                setEditingItem(null);
              }}
              onOpenAnnot={() => setEditingItem(null)}
            />
          );
        })()}
      </div>
    </div>
  );
});

export default RapportPreview;
