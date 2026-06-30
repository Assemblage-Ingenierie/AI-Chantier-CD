import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { renderMarkup, stripMarkup } from '../../lib/markup.jsx';
import { getAllSymbols, drawAnnotationPaths, drawVP } from './Annotator.jsx';
import { Ic } from '../ui/Icons.jsx';
import ItemModal from './ItemModal.jsx';
import { useBrandingLogo } from '../../lib/branding.js';
import { callAIProxy } from '../../lib/aiProxy.js';
import { computeVpNumbering, dedupPlanPaths, photoVpKey, debugVpNumbering } from '../../lib/vpNumbering.js';

// Mode diagnostic Vxx : activé via ?vxxdebug=1 dans l'URL. Affiche un panneau + étiquettes photo
// pour comprendre pourquoi un badge ne se pose pas. Sans effet en utilisation normale.
const VXX_DEBUG = typeof window !== 'undefined' && /[?&]vxxdebug=1\b/.test(window.location.search);
import { fetchPlanData, fetchPlanHdDataUrl } from '../../lib/storage.js';
import { setPhotoPref } from '../../lib/photoPrefs.js';
import RichTextArea, { htmlToPlain } from '../ui/RichTextArea.jsx';

function makeIconDataUrl(drawFn) {
  const cv = document.createElement('canvas');
  cv.width = 80; cv.height = 80;
  const ctx = cv.getContext('2d');
  try { drawFn(ctx); } catch {}
  return cv.toDataURL();
}

function SymbolIcon({ sym, size = 14 }) {
  const src = useMemo(() => makeIconDataUrl(ctx => sym.draw(ctx, 40, 28, 2, DA.red)), [sym]);
  return <img src={src} alt="" style={{ display:'block', flexShrink:0, width:size, height:size }}/>;
}

function ViewpointIcon({ size = 24 }) {
  const src = useMemo(() => makeIconDataUrl(ctx => drawVP(ctx, { x: 38, y: 55, angle: -Math.PI / 2, label: 'V1', size: 1, color: DA.red })), []);
  return <img src={src} alt="" style={{ display:'block', flexShrink:0, width:size, height:size }}/>;
}

// Échelle : 3px = 1mm → page A4 = 630 × 891px
const S   = 3;
const PH  = 297 * S;  // 891px
const PW  = 210 * S;  // 630px
const MX  = 18  * S;  // 54px marges gauche/droite
const MT  = 18  * S;  // 54px marge haute
const MB  = 13  * S;  // 39px marge basse
const HDR = 10  * S;  // 30px hauteur header
const FTR = 8   * S;  // 24px hauteur footer
const CW  = PW - 2 * MX; // 522px largeur contenu
// Hauteur max d'un plan PORTRAIT dans le rapport : on le laisse remplir quasiment toute la
// page (≈ hauteur de contenu utile moins titre + légende) pour qu'il soit lisible — au lieu
// du plafond paysage de 340px qui réduisait les plans portrait en vignettes « riquiqui ».
const PLAN_PORTRAIT_MAXH = PH - HDR - (MT - HDR) - (MB + FTR) - 96; // ≈ 678px

// ── Hauteur disponible par page A4 (px preview) ────────────────────────────────────────────
const AVAIL_H     = PH - HDR - (MT - HDR) - MB - FTR - 10; // 764px (10px safety)
const BREAK_CTL_H = 36; // hauteur d'un BreakControl entre deux blocs (uniquement aux frontières de zone)
const ITEM_GAP    = 5;  // marginBottom entre blocs non-zone (pas de BreakControl)
const CHUNK_CHARS = 2500; // max chars per text chunk — only split genuinely long texts

// Découpe un long commentaire en morceaux aux limites de paragraphes
function splitComment(comment, maxChars = CHUNK_CHARS) {
  if (!comment || comment.length <= maxChars) return [comment || ''];
  const sep = /\n{2,}/.test(comment) ? /\n{2,}/ : /\n/;
  const paras = comment.split(sep).map(p => p.trim()).filter(Boolean);
  if (paras.length <= 1) {
    // Pas de paragraphes → couper au dernier espace avant maxChars
    const cut = comment.lastIndexOf(' ', maxChars) || maxChars;
    return [comment.slice(0, cut).trim(), ...splitComment(comment.slice(cut).trim(), maxChars)];
  }
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    const cand = cur ? cur + '\n\n' + p : p;
    if (cand.length > maxChars && cur) { chunks.push(cur); cur = p; }
    else cur = cand;
  }
  if (cur) chunks.push(cur);
  return chunks.length > 1 ? chunks : [comment];
}

// Découpe un texte en segments coupables : paragraphes > lignes > phrases
function splitTextSegs(text) {
  if (!text) return [text ?? ''];

  // HTML : splitter par frontières de paragraphes <div>/<p> (le format produit par contentEditable).
  // On normalise </div><div> et </p><p> en séparateur unique, puis on strip les balises bloc
  // (tout en gardant les inline strong/em/u/br pour que renderMarkup puisse les rendre).
  if (/<(?:div|p)\b/i.test(text)) {
    const SEP = '\x00';
    const normalized = text
      .replace(/<\/(?:div|p)>\s*<(?:div|p)[^>]*>/gi, SEP)
      .replace(/<\/?(?:div|p)[^>]*>/gi, '');
    const parts = normalized.split(SEP).map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) return parts;
  }

  // Plain text fallbacks
  const byDouble = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  if (byDouble.length > 1) return byDouble;
  const bySingle = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (bySingle.length > 1) return bySingle;
  // Dernier recours : par phrases (uniquement si pas de structure paragraphe détectée)
  const bySentence = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  return bySentence.length > 1 ? bySentence : [text];
}

// Estimation fallback (utilisée uniquement si la mesure DOM n'est pas encore dispo)
function estimateBlockH(block, ppl) {
  if (block.type === 'zone') return 42;
  if (block.type === 'plan') return Math.round(CW * 0.6) + 30 + 90;
  const item = block.item;
  const mode = block.mode || 'full';
  const txt  = block.textContent ?? item.commentaire ?? '';
  let h = mode === 'cont' ? 20 : 52;
  if (mode !== 'photos' && txt) h += Math.ceil(txt.length / 65) * 16;
  if (mode !== 'text' && mode !== 'cont') {
    // Blocs-rangée (photoRow) : hauteur d'UNE rangée selon le layout (paysage 4:3,
    // portraits/mosaïque ≈ hauteur d'un 3:4). Sinon estimation classique multi-rangées.
    const row = block.photoRow;
    if (row) {
      const cols  = Math.min(ppl, 3);
      const cellW = (CW - 12 - (cols - 1) * 3) / cols;
      h += (row.kind === 'landscape' ? cellW * 0.75 : ((CW - 12) / 2) * (4 / 3)) + 14;
    } else {
      const nPh = Math.min((item.photos || []).filter(p => p.data).length, 6);
      if (nPh > 0) {
        const cols  = Math.min(ppl, 3);
        const cellW = (CW - 12 - (cols - 1) * 3) / cols;
        h += Math.ceil(nPh / cols) * (cellW * 0.75) + 14;
      }
    }
  }
  return Math.round(h * 1.1) + 5;
}

// Une observation a du contenu à montrer dans le rapport si elle a un intitulé, OU un
// commentaire non vide, OU au moins une photo. Avant, seul l'intitulé comptait → une zone
// dont l'observation n'avait qu'un commentaire (intitulé volontairement vide) était masquée.
function itemHasReportContent(i) {
  return !!(
    (i.titre && i.titre.trim()) ||
    (i.commentaire && stripMarkup(i.commentaire).trim()) ||
    (i.photos || []).some(p => p.data)
  );
}

// Aplatit toutes les localisations en liste ordonnée de blocs (sans pagination).
// • Les commentaires longs sont découpés en blocs-paragraphes (mode:'text' / 'cont')
// • Les photos sont découpées en rangées individuelles (mode:'photos', photoRow)
//   pour qu'elles s'insèrent naturellement dans le flux sans créer de blanc en fin de page
function flattenBlocks(locs, plansEnFin, ppl = 2, paraBreaks = new Set(), vxxPhotoMap = new Map(), plansNoBreak = false, planLibrary = [], breaks = new Set()) {
  const blocks = [];
  const planTail = []; // plans groupés en fin quand plansNoBreak=true
  const cols   = Math.min(ppl, 3);

  for (const loc of locs) {
    const items = (loc.items || []).filter(itemHasReportContent);
    if (!items.length) continue;
    blocks.push({ type:'zone', id:loc.id, loc });
    let photoOffset = 0;
    for (const item of items) {
      const photos  = (item.photos || []).filter(p => p.data);
      const comment = item.commentaire?.trim() || '';

      // Découpage texte : manuel (paraBreaks) sinon automatique (splitComment)
      const paras = comment ? splitTextSegs(comment) : [];
      const joinSep = /\n{2,}/.test(comment) ? '\n\n' : /\n/.test(comment) ? '\n' : ' ';
      const hasManualSplit = paras.some((_, i) => paraBreaks.has(`${item.id}_p${i}`));

      let textChunks;
      if (hasManualSplit) {
        const segs = []; let cur = [];
        paras.forEach((p, i) => {
          cur.push(p);
          if (paraBreaks.has(`${item.id}_p${i}`) && i < paras.length - 1) {
            segs.push(cur.join(joinSep)); cur = [];
          }
        });
        if (cur.length) segs.push(cur.join(joinSep));
        textChunks = segs.map((text, idx) => ({ text, id: idx === 0 ? item.id : `${item.id}_pms${idx}` }));
      } else {
        const auto = splitComment(comment);
        textChunks = auto.map((text, idx) => ({ text, id: idx === 0 ? item.id : `${item.id}_c${idx}` }));
      }

      // Blocs texte
      if (comment || !photos.length) {
        textChunks.forEach(({ text, id }, idx) => {
          if (text) {
            blocks.push({ type:'item', id, item, locId:loc.id, mode: idx === 0 ? 'text' : 'cont',
              textContent:text, vpPhotoOffset:photoOffset, vxxPhotoMap });
          } else if (idx === 0 && !photos.length) {
            blocks.push({ type:'item', id, item, locId:loc.id, mode:'full', vpPhotoOffset:photoOffset, vxxPhotoMap });
          }
        });
      }

      // Photos : une rangée = un bloc. PACKING anti-blancs (validé avec l'utilisateur) :
      //   • 2 portraits → côte à côte (3:4, pleine largeur, zéro blanc) ;
      //   • 1 portrait restant → MOSAÏQUE : portrait + jusqu'à 2 paysages empilés à côté
      //     (un portrait ≈ la hauteur de 2 paysages) — les paysages sont « remontés » depuis
      //     la liste (réorganisation d'affichage autorisée) ; s'il n'y en a qu'un, il se met
      //     en haut et le bas reste vide ;
      //   • paysages restants → rangées standards de `cols`, dernière éventuellement partielle
      //     (taille standard conservée).
      // Les rangées sont triées par le plus petit index de photo qu'elles contiennent pour
      // rester proches de l'ordre du récit. Chaque cellule garde l'index ORIGINAL de sa photo
      // (badges Vxx et recadrage intacts).
      if (photos.length > 0) {
        const portraits = [], landscapes = [];
        photos.forEach((ph, i) => ((ph?.orient === 'portrait') ? portraits : landscapes).push(i));
        const rows = [];
        let p = 0;
        while (portraits.length - p >= 2) { rows.push({ kind:'portraits', idxs:[portraits[p], portraits[p+1]] }); p += 2; }
        if (portraits.length - p === 1) {
          const stack = landscapes.splice(0, 2);
          if (stack.length) rows.push({ kind:'mosaic', portraitIdx: portraits[p], stackIdxs: stack });
          else rows.push({ kind:'portraits', idxs:[portraits[p]] });
        }
        for (let s = 0; s < landscapes.length; s += cols) rows.push({ kind:'landscape', idxs: landscapes.slice(s, s + cols) });
        const minIdx = r => r.kind === 'mosaic' ? Math.min(r.portraitIdx, ...r.stackIdxs) : Math.min(...r.idxs);
        rows.sort((a, b) => minIdx(a) - minIdx(b));
        rows.forEach((row, k) => {
          blocks.push({
            type:'item',
            id: k === 0 ? `${item.id}_ph` : `${item.id}_ph${k}`,
            item, locId:loc.id, mode:'photos',
            photoRow: row, photoCols: cols,
            isLastPhotoRow: k === rows.length - 1,
            vpPhotoOffset: photoOffset, vxxPhotoMap,
          });
        });
      }

      photoOffset += photos.length;
    }
    // Un plan n'est "visible" (et ne crée donc un bloc titre) que si son fond est réellement
    // résolvable : annotation exportée, planBg local, ou planId dont la bibliothèque a un bg.
    // Sans ce contrôle, un plan masqué ou orphelin (planId sans bg) affichait un titre seul.
    const bgResolvable = (planId, planBg, ann) =>
      !!(ann?.exported || planBg || (planId && planLibrary.find(p => p.id === planId)?.bg));
    const primaryVisible = !loc.planReportHidden && bgResolvable(loc.planId, loc.planBg, loc.planAnnotations);
    const extraVisible = (loc.extraPlans || []).some(ep => !ep.reportHidden && bgResolvable(ep.planId, ep.planBg, ep.planAnnotations));
    if (primaryVisible || extraVisible) {
      if (!plansEnFin) {
        // Découpe les plans de la zone en GROUPES de page selon les sauts forcés entre plans.
        // Chaque groupe après le premier devient un BLOC distinct dont l'id = le breakId → la
        // pagination (buildPages) coupe réellement la page (avant : un seul bloc « plan » par
        // zone → le saut entre plans s'affichait mais ne séparait jamais les pages).
        const groups = splitPlanGroups(loc, planLibrary, breaks);
        if (groups.length <= 1) {
          blocks.push({ type:'plan', id:`plan-${loc.id}`, loc });
        } else {
          groups.forEach((grp, gi) => {
            blocks.push({
              type:'plan',
              id: gi === 0 ? `plan-${loc.id}` : grp.topBreakId,
              loc, plansSubset: grp.plans, topBreakId: grp.topBreakId,
            });
          });
        }
      } else {
        planTail.push({ type:'plan', id:`plan-${loc.id}`, loc });
      }
    }
  }
  return [...blocks, ...planTail];
}

// ── Pagination ───────────────────────────────────────────────────────────────────────
// Ne coupe que sur les sauts forcés (scissors) — jamais automatiquement.
function buildPages(allBlocks, ppl, breaks, heights) {
  const pages  = [];
  let blocks   = [];

  const flush = () => {
    if (blocks.length) { pages.push(blocks); blocks = []; }
  };

  for (const block of allBlocks) {
    if (breaks.has(block.id)) flush();
    blocks.push(block);
  }
  flush();

  return pages;
}

// ── Sous-composants ──────────────────────────────────────────────────────────────────

// BreakControl — shown at zone boundaries WITHIN a page (suggestions + active removals)
function BreakControl({ id, active, onToggle, zoneName }) {
  const [hover, setHover] = useState(false);

  if (active) {
    return (
      <div onClick={() => onToggle(id)}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ margin:'6px -9px', display:'flex', alignItems:'center', gap:10, padding:'8px 14px',
          background: hover ? '#c00010' : DA.red, cursor:'pointer', userSelect:'none',
          borderTop:'2px solid rgba(255,255,255,0.2)', borderBottom:'2px solid rgba(255,255,255,0.2)' }}>
        <span style={{ fontSize:12, lineHeight:1 }}>✂</span>
        <span style={{ fontSize:9, fontWeight:800, color:'white', flex:1, letterSpacing:0.3 }}>
          Saut de page actif{zoneName ? ` avant « ${zoneName} »` : ''} — cliquer pour annuler
        </span>
        <span style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,0.7)',
          background:'rgba(0,0,0,0.2)', borderRadius:3, padding:'2px 7px' }}>
          × Supprimer
        </span>
      </div>
    );
  }

  return (
    <div onClick={() => onToggle(id)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ margin:'4px -9px', display:'flex', alignItems:'center', gap:10, padding:'7px 14px',
        background: hover ? '#fff0f0' : '#fffafa',
        border: `1.5px dashed ${hover ? DA.red : '#f0b8b8'}`,
        borderLeft: 'none', borderRight: 'none',
        cursor:'pointer', userSelect:'none', transition:'background 0.1s' }}>
      <span style={{ fontSize:12, color: hover ? DA.red : '#d08080', lineHeight:1 }}>✂</span>
      <span style={{ fontSize:9, fontWeight:700, color: hover ? DA.red : '#c08080', flex:1 }}>
        {zoneName ? `Forcer une nouvelle page avant « ${zoneName} »` : 'Couper ici — insérer un saut de page'}
      </span>
      <span style={{ fontSize:8, color: hover ? DA.red : '#d0a0a0',
        background: hover ? '#ffe0e0' : '#fdf0f0', border:`1px solid ${hover ? '#fca5a5' : '#f0d0d0'}`,
        borderRadius:3, padding:'1px 6px', whiteSpace:'nowrap' }}>
        ⊕ Nouvelle page
      </span>
    </div>
  );
}

// TopBreakControl — shown at the TOP of a page when its first block has a forced break
// Allows users to remove the break directly from within the page
// Rendu hors flux (position:absolute) pour ne pas fausser la pagination visuelle.
function TopBreakControl({ id, zoneName, onToggle }) {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ position:'relative', height:0, overflow:'visible' }}>
      <div onClick={() => onToggle(id)}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        title="Cliquer pour retirer ce saut de page"
        style={{ position:'absolute', top:-20, left:-9, right:-9, display:'flex', alignItems:'center', gap:6, padding:'3px 8px',
          background: hover ? '#c00010' : DA.red, cursor:'pointer', userSelect:'none',
          zIndex:40 }}>
        <span style={{ fontSize:9, lineHeight:1 }}>✂</span>
        <span style={{ fontSize:8, fontWeight:700, color:'white', flex:1, letterSpacing:0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          Saut forcé{zoneName ? ` · ${zoneName}` : ''}
        </span>
        <span style={{ fontSize:8, fontWeight:700, color:'rgba(255,255,255,0.85)' }}>
          × Retirer
        </span>
      </div>
    </div>
  );
}

// CutZone — séparateur interactif entre blocs (visible uniquement en mode coupe)
// Rendu hors flux (height:0) pour ne pas fausser la pagination visuelle.
function CutZone({ blockId, active, onCut }) {
  const [hov, setHov] = useState(false);
  if (!active) return null;
  return (
    <div data-print="hide" style={{ position:'relative', height:0, overflow:'visible' }}>
      <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        onClick={(e) => { e.stopPropagation(); onCut(blockId); }}
        style={{ position:'absolute', top:-11, left:0, right:0, height:22, cursor:'crosshair', flexShrink:0, zIndex:50 }}>
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', opacity: hov ? 1 : 0.5, transition:'opacity 0.12s', background: hov ? 'rgba(227,5,19,0.07)' : 'transparent' }}>
          <div style={{ background:'#E30513', color:'white', padding:'2px 8px', fontSize:13, flexShrink:0, lineHeight:1 }}>✂</div>
          <div style={{ flex:1, height:2, background:'repeating-linear-gradient(90deg,#E30513 0,#E30513 8px,transparent 8px,transparent 14px)' }}/>
          {hov && <div style={{ background:'#E30513', color:'white', fontSize:8, fontWeight:800, padding:'2px 9px', flexShrink:0, whiteSpace:'nowrap' }}>Couper ici</div>}
        </div>
      </div>
    </div>
  );
}

// ParaCutZone — séparateur de segments texte dans un bloc (mode coupe)
// Rendu hors flux (height:0) pour ne pas fausser la pagination visuelle.
function ParaCutZone({ paraId, onCut }) {
  const [hov, setHov] = useState(false);
  return (
    <div data-print="hide" style={{ position:'relative', height:0, overflow:'visible' }}>
      <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        onClick={(e) => { e.stopPropagation(); onCut(paraId); }}
        style={{ position:'absolute', top:-9, left:-9, right:-9, height:18, cursor:'crosshair', zIndex:50 }}>
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', opacity: hov ? 1 : 0.5, transition:'opacity 0.12s', background: hov ? 'rgba(227,5,19,0.07)' : 'transparent' }}>
          <div style={{ background:'#E30513', color:'white', padding:'1px 6px', fontSize:11, flexShrink:0, lineHeight:1 }}>✂</div>
          <div style={{ flex:1, height:1.5, background:'repeating-linear-gradient(90deg,#E30513 0,#E30513 6px,transparent 6px,transparent 10px)' }}/>
          {hov && <div style={{ background:'#E30513', color:'white', fontSize:7, fontWeight:800, padding:'1px 8px', flexShrink:0, whiteSpace:'nowrap' }}>Couper le texte ici</div>}
        </div>
      </div>
    </div>
  );
}

function ZoneHeader({ loc }) {
  return (
    <div style={{ borderBottom:`2px solid ${DA.red}`, paddingBottom:4, marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
      <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:700, color:'#000', textTransform:'uppercase', letterSpacing:'0.08em' }}>{loc.nom}</span>
    </div>
  );
}

// Facteur d'échelle des annotations PHOTO dans le rapport, par-dessus l'échelle largeur/1400.
// = 1.0 → le rapport rend les annotations EXACTEMENT à la taille de l'éditeur (même formule,
// même curseur « Texte »/« Symboles » via les mêmes clés localStorage) : taille identique entre
// l'éditeur et le rapport. Pour des annotations plus grosses, monter le curseur « Texte » dans
// l'éditeur → ça agrandit l'éditeur ET le rapport ensemble, sans jamais les désynchroniser.
const REPORT_ANNOT_BOOST = 1.0;

function PhotoAnnotCanvas({ photo, cropX = 50, cropY = 50, cropZoom = 1, containerAR = 4 / 3, photoScale = { text: 1, shape: 1, symbol: 1 } }) {
  const psText  = photoScale?.text   ?? 1;
  const psSym   = photoScale?.symbol ?? 1;
  const psShape = photoScale?.shape  ?? 1;
  const cvRef = useRef();
  const [inferredW, setInferredW] = React.useState(null);
  const [inferredH, setInferredH] = React.useState(null);
  const [cssW, setCssW] = React.useState(null);

  useEffect(() => {
    if (photo.annotW || !photo.data || !photo.annotations?.length) return;
    const img = new window.Image();
    img.onload = () => { setInferredW(img.naturalWidth); setInferredH(img.naturalHeight); };
    img.onerror = () => { setInferredW(1400); setInferredH(1050); };
    img.src = photo.data;
  }, [photo.data, photo.annotW, photo.annotations]);

  const effectiveW = photo.annotW || inferredW;
  const effectiveH = photo.annotH || inferredH || (effectiveW ? Math.round(effectiveW * 0.75) : null);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    // Take an immediate measurement in case ResizeObserver fires after first paint
    const immediate = cv.getBoundingClientRect().width;
    if (immediate > 0) setCssW(immediate);
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w > 0) setCssW(w);
    });
    ro.observe(cv);
    return () => ro.disconnect();
  }, [!!effectiveW]); // re-run when canvas first appears (effectiveW: null → value)

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv || !photo.annotations?.length || !effectiveW) return;

    const photoH = effectiveH || Math.round(effectiveW * 0.75);
    const photoAR = effectiveW / photoH;
    let drawW, drawH, cropXpx = 0, cropYpx = 0;
    if (photoAR >= containerAR) {
      drawH = photoH;
      drawW = Math.round(photoH * containerAR);
      cropXpx = Math.round((effectiveW - drawW) * cropX / 100);
    } else {
      drawW = effectiveW;
      drawH = Math.round(effectiveW / containerAR);
      cropYpx = Math.round(Math.max(0, photoH - drawH) * cropY / 100);
    }
    cv.width  = drawW;
    cv.height = drawH;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, drawW, drawH);
    if (cropXpx !== 0 || cropYpx !== 0) ctx.translate(-cropXpx, -cropYpx);
    // Échelle UNIFORME pour TOUTES les photos : fraction fixe de la largeur naturelle
    // (largeur naturelle / 1400), exactement comme l'annotateur (cv.width/1400) → WYSIWYG.
    // On n'utilise PLUS annotSizeScale : il était figé par photo au moment de l'annotation et
    // dépendait de la largeur d'écran (ratio*0.5) → tailles incohérentes d'une photo à l'autre.
    // Les curseurs PHOTOS (réglables dans le rapport) multiplient cette base, par type.
    // Agrandissement de BASE côté rapport (REPORT_ANNOT_BOOST) : à l'échelle fidèle
    // (largeur/1400) la boîte de texte est illisible dans les petites cellules → on agrandit
    // texte + symboles dans le RAPPORT uniquement (l'annotateur n'est pas modifié). Le curseur
    // photo (psText/psSym, défaut 1) reste un ajustement par-dessus.
    const base = ((effectiveW ? effectiveW / 1400 : 0.5) / cropZoom) * REPORT_ANNOT_BOOST;
    drawAnnotationPaths(ctx, photo.annotations,
      { text: base * psText, symbol: base * psSym, shape: psShape }, base * psSym);
  }, [photo.annotations, effectiveW, effectiveH, cropX, cropY, cropZoom, containerAR, psText, psSym, psShape]);

  if (!photo.annotations?.length || !effectiveW) return null;
  return <canvas ref={cvRef} style={{
    position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none',
    transform: cropZoom !== 1 ? `scale(${cropZoom})` : undefined,
    transformOrigin: `${cropX}% ${cropY}%`,
  }}/>;
}

// Returns [cx, cy, cz] for rendering. When photo has annotations but no explicit crop set,
// auto-adjusts the crop to include the annotation anchor points (avoids invisible annotations).
function effectiveCrop(photo) {
  const cz = photo.cropZoom ?? 1;
  // If user has explicitly set a crop position, always respect it
  if (photo.cropX !== undefined || photo.cropY !== undefined) {
    return [photo.cropX ?? 50, photo.cropY ?? 50, cz];
  }
  // No explicit crop: try to auto-adjust to include annotations
  if (!photo.annotations?.length || !photo.annotW || !photo.annotH) return [50, 50, cz];
  const W = photo.annotW, H = photo.annotH;
  let x = 50, y = 50;
  if (W / H >= 4 / 3) {
    const drawW = Math.round(H * 4 / 3);
    const excess = W - drawW;
    if (excess > 0) {
      const xs = photo.annotations.filter(a => a.x != null).map(a => a.x);
      if (xs.length) {
        const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
        x = Math.max(0, Math.min(100, ((mid - drawW / 2) / excess) * 100));
      }
    }
  } else {
    const drawH = Math.round(W / (4 / 3));
    const excess = H - drawH;
    if (excess > 0) {
      const ys = photo.annotations.filter(a => a.y != null).map(a => a.y);
      if (ys.length) {
        const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
        y = Math.max(0, Math.min(100, ((mid - drawH / 2) / excess) * 100));
      }
    }
  }
  return [x, y, cz];
}

function PhotoCropEditor({ photo, initialX = 50, initialY = 50, initialZ = 1, onSave, onCancel }) {
  // Auto-adjust initial crop position so annotations are not clipped out of the frame
  const adjustedInitialX = (() => {
    const W = photo.annotW, H = photo.annotH;
    if (!photo.annotations?.length || !W || !H || W / H < 4/3) return initialX;
    const drawW = Math.round(H * 4/3);
    const excess = W - drawW;
    if (excess <= 0) return initialX;
    const xs = photo.annotations.filter(a => a.x != null).map(a => a.x);
    if (!xs.length) return initialX;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const cropStart = Math.round(excess * initialX / 100);
    if (minX >= cropStart && maxX <= cropStart + drawW) return initialX;
    const mid = (minX + maxX) / 2;
    return Math.max(0, Math.min(100, (mid - drawW / 2) / excess * 100));
  })();
  const adjustedInitialY = (() => {
    const W = photo.annotW, H = photo.annotH;
    if (!photo.annotations?.length || !W || !H || W / H >= 4/3) return initialY;
    const drawH = Math.round(W / (4/3));
    const excess = H - drawH;
    if (excess <= 0) return initialY;
    const ys = photo.annotations.filter(a => a.y != null).map(a => a.y);
    if (!ys.length) return initialY;
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const cropStart = Math.round(excess * initialY / 100);
    if (minY >= cropStart && maxY <= cropStart + drawH) return initialY;
    const mid = (minY + maxY) / 2;
    return Math.max(0, Math.min(100, (mid - drawH / 2) / excess * 100));
  })();
  const [px, setPx] = React.useState(adjustedInitialX);
  const [py, setPy] = React.useState(adjustedInitialY);
  const [pz, setPz] = React.useState(initialZ);
  const containerRef = useRef();
  const [containerW, setContainerW] = React.useState(268);
  React.useLayoutEffect(() => {
    if (containerRef.current) setContainerW(containerRef.current.offsetWidth);
  }, []);
  // Dimensions réelles lues depuis l'image (évite l'hypothèse paysage par défaut)
  const [naturalSize, setNaturalSize] = React.useState(
    photo.annotW && photo.annotH ? { w: photo.annotW, h: photo.annotH } : null
  );
  const W_p = naturalSize?.w || photo.annotW || 1400;
  const H_p = naturalSize?.h || photo.annotH || Math.round(W_p * 0.75);
  const photoRatio = W_p / H_p;
  // Orientation du cadre dans le rapport : paysage 4:3 (défaut) ou portrait 3:4 (façade entière).
  const [orient, setOrient] = React.useState(photo.orient === 'portrait' ? 'portrait' : 'landscape');
  const FRAME_RATIO = orient === 'portrait' ? 3 / 4 : 4 / 3;
  const containerH = containerW / photoRatio;

  // Base frame dimensions at zoom=1
  const isPortrait = photoRatio <= FRAME_RATIO;
  const baseFrameW = isPortrait ? containerW : containerH * FRAME_RATIO;
  const baseFrameH = isPortrait ? containerW / FRAME_RATIO : containerH;
  // Frame at current zoom
  const frameW = baseFrameW / pz;
  const frameH = baseFrameH / pz;
  const exW = Math.max(0, containerW - frameW);
  const exH = Math.max(0, containerH - frameH);
  const frameLeft = exW * px / 100;
  const frameTop = exH * py / 100;

  const pzRef = React.useRef(pz); pzRef.current = pz;
  const pxRef = React.useRef(px); pxRef.current = px;
  const pyRef = React.useRef(py); pyRef.current = py;

  const fullAnnotCvRef = useRef(null);
  const effectiveAnnotW = naturalSize?.w || photo.annotW || null;
  const effectiveAnnotH = naturalSize?.h || photo.annotH || (effectiveAnnotW ? Math.round(effectiveAnnotW * 0.75) : null);
  useEffect(() => {
    const cv = fullAnnotCvRef.current;
    if (!cv || !photo.annotations?.length || !effectiveAnnotW || !effectiveAnnotH) return;
    cv.width = effectiveAnnotW;
    cv.height = effectiveAnnotH;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, effectiveAnnotW, effectiveAnnotH);
    const cropModalSizeScale = photo.annotSizeScale != null
      ? photo.annotSizeScale
      : (effectiveAnnotW / Math.max(containerW, 350)) * 0.5;
    drawAnnotationPaths(ctx, photo.annotations, cropModalSizeScale);
  }, [photo.annotations, effectiveAnnotW, effectiveAnnotH, containerW]);

  const handlePointerDown = (e) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const cW = rect.width, cH = rect.height;
    const bFW = photoRatio <= FRAME_RATIO ? cW : cH * FRAME_RATIO;
    const bFH = photoRatio <= FRAME_RATIO ? cW / FRAME_RATIO : cH;
    const fW = bFW / pzRef.current, fH = bFH / pzRef.current;
    const eW = Math.max(0, cW - fW), eH = Math.max(0, cH - fH);
    const scx = pxRef.current, scy = pyRef.current;
    const sx = e.clientX, sy = e.clientY;
    const onMove = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      const nx = eW > 0 ? Math.max(0, Math.min(100, scx + (dx / eW) * 100)) : 50;
      const ny = eH > 0 ? Math.max(0, Math.min(100, scy + (dy / eH) * 100)) : 50;
      setPx(nx); setPy(ny);
    };
    const onUp = () => el.removeEventListener('pointermove', onMove);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp, { once: true });
  };

  return createPortal(
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.82)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ background:'#1c1c1e', borderRadius:14, padding:16, display:'flex',
        flexDirection:'column', gap:12, width:300, maxWidth:'calc(100vw - 40px)',
        maxHeight:'calc(100vh - 40px)', overflowY:'auto',
        boxShadow:'0 20px 60px rgba(0,0,0,0.6)' }}>
        <div style={{ fontSize:13, fontWeight:700, color:'white', textAlign:'center', letterSpacing:0.2 }}>
          Recadrer la photo
        </div>
        {/* Choix de l'orientation dans le rapport — portrait pour les façades hautes */}
        <div style={{ display:'flex', gap:6, background:'#2c2c2e', borderRadius:9, padding:3 }}>
          {[['landscape', 'Paysage', '▭'], ['portrait', 'Portrait', '▯']].map(([key, label, sym]) => (
            <button key={key} onClick={() => setOrient(key)}
              style={{ flex:1, padding:'7px 0', borderRadius:7, border:'none', cursor:'pointer',
                fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                background: orient === key ? DA.red : 'transparent', color: orient === key ? 'white' : '#aaa' }}>
              <span style={{ fontSize:14, lineHeight:1 }}>{sym}</span>{label}
            </button>
          ))}
        </div>
        {/* Full original photo with draggable crop frame */}
        <div ref={containerRef}
          style={{ position:'relative', width:'100%', height:containerH, flexShrink:0,
            borderRadius:8, cursor:'grab', touchAction:'none', background:'#000', overflow:'hidden' }}
          onPointerDown={handlePointerDown}>
          <img src={photo.annotated || photo.data} alt=""
            style={{ position:'absolute', inset:0, width:'100%', height:'100%',
              objectFit:'fill', display:'block', pointerEvents:'none' }}
            onLoad={e => { if (!naturalSize) setNaturalSize({ w: e.target.naturalWidth, h: e.target.naturalHeight }); }}/>
          {/* Dark overlay: 4 rectangles around the crop window */}
          {frameTop > 0 && (
            <div style={{ position:'absolute', left:0, top:0, right:0, height:frameTop,
              background:'rgba(0,0,0,0.55)', pointerEvents:'none' }}/>
          )}
          {frameTop + frameH < containerH - 0.5 && (
            <div style={{ position:'absolute', left:0, top:frameTop + frameH, right:0, bottom:0,
              background:'rgba(0,0,0,0.55)', pointerEvents:'none' }}/>
          )}
          {frameLeft > 0 && (
            <div style={{ position:'absolute', left:0, top:frameTop, width:frameLeft, height:frameH,
              background:'rgba(0,0,0,0.55)', pointerEvents:'none' }}/>
          )}
          {frameLeft + frameW < containerW - 0.5 && (
            <div style={{ position:'absolute', left:frameLeft + frameW, top:frameTop, right:0, height:frameH,
              background:'rgba(0,0,0,0.55)', pointerEvents:'none' }}/>
          )}
          {/* Annotations overlay on full photo — uniquement en repli si pas d'image cuite
              (photo.annotated). Sinon les annotations sont déjà dans l'image affichée. */}
          {photo.annotations?.length > 0 && !photo.annotated && effectiveAnnotW && (
            <canvas ref={fullAnnotCvRef} style={{
              position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none', opacity:0.75,
            }}/>
          )}
          {/* Crop frame border */}
          <div style={{ position:'absolute', left:frameLeft, top:frameTop, width:frameW, height:frameH,
            border:'2px solid white', borderRadius:2, boxSizing:'border-box', pointerEvents:'none' }}/>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, justifyContent:'center' }}>
          <button onClick={() => setPz(z => Math.max(1, Math.round((z - 0.1) * 10) / 10))}
            style={{ width:38, height:38, borderRadius:8, background:'#333', color:'white',
              border:'none', fontSize:22, lineHeight:1, cursor:'pointer', fontWeight:300 }}>−</button>
          <span style={{ color:'#ccc', fontSize:12, fontWeight:600, minWidth:52, textAlign:'center' }}>
            zoom ×{pz.toFixed(1)}
          </span>
          <button onClick={() => setPz(z => Math.min(4, Math.round((z + 0.1) * 10) / 10))}
            style={{ width:38, height:38, borderRadius:8, background:'#333', color:'white',
              border:'none', fontSize:22, lineHeight:1, cursor:'pointer', fontWeight:300 }}>+</button>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel}
            style={{ flex:1, padding:10, borderRadius:8, background:'#2c2c2e', color:'#aaa',
              border:'none', cursor:'pointer', fontSize:12, fontWeight:600 }}>Annuler</button>
          <button onClick={() => onSave(Math.round(px), Math.round(py), pz, orient)}
            style={{ flex:2, padding:10, borderRadius:8, background:DA.red, color:'white',
              border:'none', cursor:'pointer', fontSize:13, fontWeight:700 }}>Valider</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ItemBlock({ item, ppl, onEdit, locId = null, vpPhotoOffset = 0, vxxPhotoMap = null, mode = 'full', textContent, photoRow = null, photoCols = null, isLastPhotoRow = true, cutMode = false, onParaCut, annotScale = 1, onPhotoCropChange = null, onAnnotatePhoto = null, photoAnnotScales = { text: 1, shape: 1, symbol: 1 } }) {
  const allPhotos = (item.photos || []).filter(p => p.data);
  const urg    = URGENCE[item.urgence] || URGENCE.basse;
  const suivi  = item.suivi && item.suivi !== 'rien' ? SUIVI[item.suivi] : null;
  const commentToShow = textContent ?? item.commentaire;
  const showHeader   = mode !== 'photos' && mode !== 'cont';

  const showComment  = mode !== 'photos' && commentToShow;
  // Les photos ne se rendent que via les blocs-rangée (photoRow) construits par flattenBlocks.
  const showPhotos   = mode === 'photos' && photoRow && allPhotos.length > 0;
  const [cropEditingPi, setCropEditingPi] = React.useState(null);

  // Cellule photo — absIdx = index ORIGINAL dans allPhotos (badges Vxx + recadrage corrects
  // même quand le packing réorganise l'ordre d'affichage). `ar` = aspect de la cellule ;
  // ar=null → la cellule REMPLIT son parent en absolu (portrait de mosaïque : hauteur
  // dictée par la colonne paysages, pixel-perfect).
  const renderPhotoCell = (absIdx, ar) => {
    const ph = allPhotos[absIdx];
    if (!ph) return null;
    const hasAnnotations = ph.annotations?.length > 0;
    const [cx, cy, cz] = effectiveCrop(ph);
    // Badge Vxx : identité photo (_id) d'abord — robuste si l'ordre/index a changé ou si le
    // marqueur vient d'un plan d'observation — puis repli sur l'index aplati historique.
    const vxxNum = vxxPhotoMap?.get(photoVpKey(ph)) ?? vxxPhotoMap?.get(`${locId}_${vpPhotoOffset + absIdx}`);
    const arNum = ar === '4 / 3' ? 4 / 3 : 3 / 4;
    // Curseurs « taille annotations photos » actifs (≠ 1×) → on privilégie la couche overlay
    // (re-dessin live, sensible aux curseurs) plutôt que le composite cuit (taille figée).
    // On veut TOUJOURS l'overlay re-dessiné (par-dessus la photo BRUTE) pour appliquer
    // l'agrandissement rapport (REPORT_ANNOT_BOOST) — le composite cuit, lui, est figé à 1×.
    // On l'utilise dès qu'il est rendable de façon SYNCHRONE (annotW connu, hydraté depuis
    // photoPrefs) → le PDF a toujours les annotations. Sinon (annotW absent, ex. autre appareil)
    // on retombe sur le composite cuit : annotations présentes (à 1×), jamais perdues.
    const overlaySync = hasAnnotations && !!ph.data && ph.annotW != null;
    const useAnnotOverlay = hasAnnotations && !!ph.data && (!ph.annotated || overlaySync);
    const imgSrc = useAnnotOverlay ? ph.data : (ph.annotated || ph.data);
    return (
      <div key={absIdx} style={{ ...(ar ? { position:'relative', aspectRatio:ar } : { position:'absolute', inset:0 }), overflow:'hidden', borderRadius:2 }}>
        {/* Image annotée cuite (ph.annotated) en priorité : c'est exactement ce que
            l'utilisateur a annoté (texte/symboles à la bonne taille). Le recadrage
            s'applique en CSS de façon identique. Repli sur re-rendu uniquement si
            aucune image cuite n'existe. */}
        <img src={imgSrc} alt=""
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover',
            objectPosition:`${cx}% ${cy}%`, display:'block', pointerEvents:'none',
            transform: cz !== 1 ? `scale(${cz})` : undefined, transformOrigin:`${cx}% ${cy}%` }}/>
        {useAnnotOverlay &&
          <PhotoAnnotCanvas photo={ph} cropX={cx} cropY={cy} cropZoom={cz} containerAR={arNum} photoScale={photoAnnotScales}/>}
        {/* Bouton « Annoter » (haut-droite) : ouvre l'outil d'annotation sur la photo —
            permet de retoucher / déplacer les annotations directement depuis le rapport. */}
        {onAnnotatePhoto && !!ph.data && (
          <button data-print="hide"
            onClick={(e) => { e.stopPropagation(); onAnnotatePhoto(locId, item, ph); }}
            title="Annoter / modifier les annotations de la photo"
            style={{ position:'absolute', top:4, right:4, background:'rgba(0,0,0,0.62)',
              color:'white', border:'none', cursor:'pointer', borderRadius:5, padding:'4px 7px',
              fontSize:10, fontWeight:700, letterSpacing:0.3, lineHeight:1,
              display:'flex', alignItems:'center', gap:4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
            </svg>
            Annoter
          </button>
        )}
        {vxxNum != null && (
          <div style={{ position:'absolute', top:2, left:2, background:'rgba(255,255,255,0.92)', color:'#333', fontSize:6, fontWeight:800, borderRadius:2, width:13, height:13, display:'flex', alignItems:'center', justifyContent:'center', border:'1px solid rgba(0,0,0,0.15)', pointerEvents:'none', lineHeight:1, flexShrink:0 }}>
            V{vxxNum}
          </div>
        )}
        {VXX_DEBUG && (
          <div style={{ position:'absolute', bottom:2, left:2, background:'rgba(0,0,0,0.78)', color:'#7CFC00', fontSize:7, fontWeight:700, borderRadius:2, padding:'1px 3px', pointerEvents:'none', lineHeight:1.3, fontFamily:'monospace', maxWidth:'90%' }}>
            flat={vpPhotoOffset + absIdx} id={String(ph?._id ?? ph?.id ?? '∅').slice(0,6)}<br/>
            pid={vxxPhotoMap?.get(photoVpKey(ph)) ?? '—'} idx={vxxPhotoMap?.get(`${locId}_${vpPhotoOffset + absIdx}`) ?? '—'} ann={hasAnnotations ? 'O' : 'N'}
          </div>
        )}
        {onPhotoCropChange && (
          <button data-print="hide"
            onClick={(e) => { e.stopPropagation(); setCropEditingPi(absIdx); }}
            style={{ position:'absolute', bottom:4, right:4, background:'rgba(0,0,0,0.62)',
              color:'white', border:'none', cursor:'pointer', borderRadius:5, padding:'4px 7px',
              fontSize:10, fontWeight:700, letterSpacing:0.3, lineHeight:1,
              display:'flex', alignItems:'center', gap:4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
            Cadrer
          </button>
        )}
        {cropEditingPi === absIdx && onPhotoCropChange && (
          <PhotoCropEditor
            photo={ph}
            initialX={cx} initialY={cy} initialZ={cz}
            onSave={(nx, ny, nz, norient) => { onPhotoCropChange(ph, nx, ny, nz, norient); setCropEditingPi(null); }}
            onCancel={() => setCropEditingPi(null)}
          />
        )}
      </div>
    );
  };
  return (
    <div style={{ marginBottom:5, border:`1px solid ${DA.border}`, borderRadius:4, overflow:'hidden' }}>
      {/* En-tête normal (titre + badges) */}
      {showHeader && (
        <div style={{ background:'#F7F7F7', padding:'4px 9px 5px', display:'flex', flexDirection:'column', gap:3, borderBottom:`1px solid ${DA.border}` }}>
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ fontSize:10, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:'#000', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.titre}</span>
            {onEdit && (
              <button data-print="hide" onClick={onEdit}
                style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, padding:'1px 3px', display:'flex', alignItems:'center', borderRadius:3, flexShrink:0 }}
                title="Modifier">
                <Ic n="pen" s={10}/>
              </button>
            )}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:urg.text, background:urg.bg, border:`1px solid ${urg.border}`, borderRadius:3, padding:'1px 5px', whiteSpace:'nowrap', letterSpacing:'0.04em' }}>
              {urg.label}
            </span>
            {suivi && (
              <span style={{ fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:suivi.text, background:suivi.bg, border:`1px solid ${suivi.border}`, borderRadius:3, padding:'1px 5px', whiteSpace:'nowrap' }}>
                ↩ {suivi.label}
              </span>
            )}
          </div>
        </div>
      )}
      {/* Commentaire */}
      {showComment && (
        <div style={{ padding:'5px 9px', fontSize:10, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#000', lineHeight:1.5, textAlign:'justify', hyphens:'auto' }}>
          {cutMode && onParaCut && (() => {
            const ps = splitTextSegs(commentToShow || '');
            if (ps.length < 2) return renderMarkup(commentToShow);
            // CHAQUE segment est rendu en BLOC (display:block) : sans ça, renderMarkup d'un
            // paragraphe seul renvoie du contenu INLINE → les segments se collaient sur la même
            // ligne (« …Paris.La visite… ») → le texte se reflowait, la hauteur s'effondrait et
            // le mode coupe ne ressemblait plus ni au mode normal ni au PDF. L'écart vertical
            // reprend celui de renderMarkup (≈1.5em si paragraphes séparés par une ligne vide,
            // sinon 0.3em) pour que les trois représentations coïncident.
            const gap = /\n{2,}/.test(commentToShow || '') ? '1.5em' : '0.3em';
            return ps.map((para, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ParaCutZone paraId={`${item.id}_p${i - 1}`} onCut={onParaCut}/>}
                <span style={{ display:'block', marginBottom: i < ps.length - 1 ? gap : 0 }}>
                  {renderMarkup(para)}
                </span>
              </React.Fragment>
            ));
          })()}
          {(!cutMode || !onParaCut) && renderMarkup(commentToShow)}
        </div>
      )}
      {/* Photos — trois layouts : rangée paysage, portraits côte à côte, mosaïque
          portrait + paysages empilés. Largeurs mosaïque 9:8 ⇒ portrait (3:4) et colonne
          de 2 paysages (4:3) ont la même hauteur — tailles quasi identiques aux rangées
          standards, zéro blanc. */}
      {showPhotos && (() => {
        if (photoRow.kind === 'mosaic') {
          // Hauteur EXACTEMENT identique : la colonne paysages (2 cellules 4:3 + gap interne)
          // définit la hauteur de la rangée, et le portrait la remplit en absolu (inset:0) —
          // sans ça, le portrait à aspect figé restait plus court de la valeur du gap (3px).
          return (
            <div style={{ padding:'4px 6px 6px', display:'flex', gap:3, alignItems:'stretch' }}>
              <div style={{ flex:9, minWidth:0, position:'relative' }}>
                {renderPhotoCell(photoRow.portraitIdx, null)}
              </div>
              <div style={{ flex:8, minWidth:0, display:'flex', flexDirection:'column', gap:3 }}>
                {photoRow.stackIdxs.map(i => renderPhotoCell(i, '4 / 3'))}
                {/* 1 seul paysage : slot vide au même format 4:3 → le bas reste vide (choix
                    utilisateur) SANS écraser la hauteur du portrait. */}
                {photoRow.stackIdxs.length < 2 && <div style={{ aspectRatio:'4 / 3' }}/>}
              </div>
            </div>
          );
        }
        const isPortraits = photoRow.kind === 'portraits';
        const colsN = isPortraits ? 2 : (photoCols ?? Math.min(ppl, 3));
        return (
          <div style={{ padding:'4px 6px 6px', display:'grid', gridTemplateColumns:`repeat(${colsN},1fr)`, gap:3 }}>
            {photoRow.idxs.map(i => renderPhotoCell(i, isPortraits ? '3 / 4' : '4 / 3'))}
          </div>
        );
      })()}
      {/* Légende annotations photos — affichée une seule fois après la dernière rangée */}
      {showPhotos && (() => {
        if (!isLastPhotoRow) return null;
        const usedIds = new Set(allPhotos.flatMap(ph => (ph.annotations || []).filter(a => a.type === 'symbol').map(a => a.symbolId)));
        const hasVP = allPhotos.some(ph => (ph.annotations || []).some(a => a.type === 'viewpoint'));
        const syms = getAllSymbols().filter(s => usedIds.has(s.id));
        if (!syms.length && !hasVP) return null;
        return (
          <div style={{ padding:'5px 9px 7px', background:'#F2F2F2', borderTop:`1px solid #DFE4E8` }}>
            <div style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>Légende</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'3px 12px' }}>
              {syms.map(s => (
                <div key={s.id} style={{ display:'flex', alignItems:'center', gap:3, fontSize:9, fontFamily:"'Open Sans', sans-serif", color:'#4D4D4D' }}>
                  <SymbolIcon sym={s} size={14}/>{s.label}
                </div>
              ))}
              {hasVP && (
                <div style={{ display:'flex', alignItems:'center', gap:3, fontSize:9, fontFamily:"'Open Sans', sans-serif", color:'#4D4D4D' }}>
                  <ViewpointIcon size={14}/>Vue photo
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function scalePlanPaths(paths, s) {
  if (s === 1 || !paths?.length) return paths;
  return paths.map(p => {
    const sc = v => v != null ? v * s : v;
    const out = { ...p, x: sc(p.x), y: sc(p.y) };
    if (p.x1 != null) out.x1 = sc(p.x1);
    if (p.y1 != null) out.y1 = sc(p.y1);
    if (p.x2 != null) out.x2 = sc(p.x2);
    if (p.y2 != null) out.y2 = sc(p.y2);
    if (p.arrowX != null) out.arrowX = sc(p.arrowX);
    if (p.arrowY != null) out.arrowY = sc(p.arrowY);
    if (p.points) out.points = p.points.map(pt => [pt[0] * s, pt[1] * s]);
    return out;
  });
}

function SinglePlanImage({ bg, planId = null, annotations, annotScale, alt, vpNumByPath = null, onOrient = null }) {
  const exported = annotations?.exported;
  const paths    = annotations?.paths;
  const deferredAnnotScale = React.useDeferredValue(annotScale);
  const [renderedImg, setRenderedImg] = useState(null);
  const [fetchedBg, setFetchedBg] = useState(null);
  const [bgFetchDone, setBgFetchDone] = useState(false);
  // Orientation du plan (détectée sur les dimensions naturelles de l'image) : un plan portrait
  // est affiché en grand (pleine page) au lieu du plafond paysage de 340px, et remonté à
  // RapportPreview (onOrient) pour qu'il soit isolé sur sa propre page.
  const [isPortrait, setIsPortrait] = useState(false);
  // Le bg vient normalement de planLibrary (hydraté à l'ouverture du projet). S'il manque
  // encore (hydratation incomplète) et qu'on a un planId, on le récupère directement depuis
  // Supabase → le rapport ne reste plus bloqué sur « Plan en cours de chargement ».
  useEffect(() => {
    if (bg || !planId) { setBgFetchDone(true); return; }
    let cancelled = false;
    fetchPlanData(planId).then(r => {
      if (!cancelled) { if (r?.bg) setFetchedBg(r.bg); setBgFetchDone(true); }
    });
    return () => { cancelled = true; };
  }, [bg, planId]);

  // Détection d'orientation : dimensions naturelles du fond de plan (indépendante du rendu
  // annoté). portrait = nettement plus haut que large (seuil 1.05 pour ignorer le carré).
  useEffect(() => {
    const src = bg || fetchedBg || exported;
    if (!src) return;
    let cancelled = false;
    const el = new window.Image();
    el.onload = () => {
      if (cancelled || !el.naturalWidth) return;
      const portrait = el.naturalHeight > el.naturalWidth * 1.05;
      setIsPortrait(portrait);
      if (planId && onOrient) onOrient(planId, portrait ? 'portrait' : 'landscape');
    };
    el.src = src;
    return () => { cancelled = true; };
  }, [bg, fetchedBg, exported, planId, onOrient]);

  useEffect(() => {
    const bgSrc = bg || fetchedBg;
    if (!bgSrc) { setRenderedImg(exported || null); return; }
    if (!paths?.length) { setRenderedImg(bgSrc); return; }
    // Dédoublonne les annotations + numérote les viewpoints (1 seul Vxx par marqueur sur le plan).
    const drawPaths = dedupPlanPaths(paths, vpNumByPath);
    let cancelled = false;
    (async () => {
      // Rendu sur l'image HAUTE DÉFINITION du plan quand elle existe : le bg de la bibliothèque
      // est une vignette → marqueurs Vxx et texte FLOUS (surtout en plan portrait pleine page).
      // L'image HD donne un canvas à haute résolution → marqueurs nets (mêmes tailles, juste plus
      // nets car dessinés puis réduits). Repli sur la vignette si pas de HD. Memoïsé (_hdCache).
      let src = bgSrc;
      if (planId) { try { const hd = await fetchPlanHdDataUrl(planId); if (hd) src = hd; } catch { /* repli vignette */ } }
      if (cancelled) return;
      const el = new window.Image();
      el.onload = () => {
        if (cancelled) return;
        // Plafond de résolution : assez pour une impression A4 nette, sans data-URL géant.
        const MAXW = 2400;
        const sc = el.naturalWidth > MAXW ? MAXW / el.naturalWidth : 1;
        const cv  = document.createElement('canvas');
        cv.width  = Math.max(1, Math.round(el.naturalWidth * sc));
        cv.height = Math.max(1, Math.round(el.naturalHeight * sc));
        const ctx = cv.getContext('2d');
        ctx.drawImage(el, 0, 0, cv.width, cv.height);
        // Échelles par type (texte/forme/symbole). base = largeur canvas / 1400 → taille des
        // marqueurs INCHANGÉE à l'écran (elle suit la largeur), seule la NETTETÉ augmente.
        const base = cv.width / 1400;
        const _o = deferredAnnotScale && typeof deferredAnnotScale === 'object';
        const textF  = _o ? (deferredAnnotScale.text   ?? 1) : (deferredAnnotScale ?? 1);
        const symF   = _o ? (deferredAnnotScale.symbol ?? 1) : (deferredAnnotScale ?? 1);
        const shapeF = _o ? (deferredAnnotScale.shape  ?? 1) : 1;
        drawAnnotationPaths(ctx, scalePlanPaths(drawPaths, 1), { text: base * textF, symbol: base * symF, shape: shapeF }, base * symF);
        // JPEG 0.95 : qualité supérieure pour ne pas flouter le texte fin des marqueurs (le plan
        // reste opaque → pas de transparence perdue), data-URL toujours raisonnable.
        setRenderedImg(cv.toDataURL('image/jpeg', 0.95));
      };
      el.onerror = () => { if (!cancelled) setRenderedImg(exported || bgSrc); };
      el.src = src;
    })();
    return () => { cancelled = true; };
  }, [exported, paths, bg, fetchedBg, deferredAnnotScale, vpNumByPath, planId]);

  // Chargement en attente uniquement si le fetch n'est pas encore terminé
  if (!renderedImg && !bg && !fetchedBg && !bgFetchDone) return (
    <div style={{ minHeight:60, background:'#f9f9f9', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <span style={{ fontSize:10, color:'#aaa' }}>Plan en cours de chargement…</span>
    </div>
  );
  if (!renderedImg) return null;
  const maxH = isPortrait ? PLAN_PORTRAIT_MAXH : 340;
  return (
    <div style={{ borderTop:`1px solid ${DA.border}`, background:'#f9f9f9', maxHeight:maxH, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <img src={renderedImg} alt={alt || 'Plan'}
        style={{ width:'100%', maxHeight:maxH, objectFit:'contain', display:'block' }}/>
    </div>
  );
}

// Splits a zone's plans into page groups based on active breaks Set.
// Returns array of { plans, topBreakId } where topBreakId is the break that started this group (null for first).
function splitPlanGroups(loc, planLibrary, breaks) {
  const lib = planLibrary || [];
  const hiddenPaths = new Map();
  const collectHidden = (planId, ann) => {
    const pts = ann?.paths;
    if (pts?.length && planId) hiddenPaths.set(planId, [...(hiddenPaths.get(planId) || []), ...pts]);
  };
  const primaryBg = loc.planBg || (loc.planId && lib.find(p => p.id === loc.planId)?.bg) || null;
  const allPlans = [];
  if (loc.planId || loc.planBg) {
    if (loc.planReportHidden) collectHidden(loc.planId, loc.planAnnotations);
    else allPlans.push({ bg: primaryBg, annotations: loc.planAnnotations, breakId: null, planId: loc.planId || null });
  }
  (loc.extraPlans || []).forEach((ep, i) => {
    if (ep.reportHidden) { collectHidden(ep.planId, ep.planAnnotations); return; }
    const epBg = ep.planBg || (ep.planId && lib.find(p => p.id === ep.planId)?.bg) || null;
    allPlans.push({ bg: epBg, annotations: ep.planAnnotations, breakId: `plan-${loc.id}_ep_${i}`, planId: ep.planId || null });
  });
  if (hiddenPaths.size > 0) {
    allPlans.forEach((p, i) => {
      const extra = p.planId ? hiddenPaths.get(p.planId) : null;
      if (extra?.length) allPlans[i] = { ...p, annotations: { ...p.annotations, paths: [...(p.annotations?.paths || []), ...extra] } };
    });
  }
  if (!allPlans.length) return [];
  const groups = [];
  let cur = [];
  for (const p of allPlans) {
    if (cur.length > 0 && p.breakId && breaks.has(p.breakId)) { groups.push(cur); cur = [p]; }
    else cur.push(p);
  }
  if (cur.length) groups.push(cur);
  return groups.map((plans, gi) => ({ plans, topBreakId: gi > 0 ? plans[0].breakId : null }));
}

function PlanBlock({ loc, annotScale = 1, onAnnotScaleChange, planLibrary, cutMode = false, pageBreaks = [], onCut, plansSubset = null, topBreakId = null, vpNumByPath = null, hideLegend = false, onEditPlan = null, onOrient = null }) {
  // Build list of all plans: primary + extraPlans (or use plansSubset override).
  // Plans masqués (reportHidden) : leurs annotations sont fusionnées dans le plan visible
  // ayant le même planId pour ne pas perdre les légendes viewpoint associées.
  const allPlans = plansSubset ?? (() => {
    const plans = [];
    // Collecte des paths des plans masqués, regroupés par planId
    const hiddenPaths = new Map();
    const collectHidden = (planId, ann) => {
      const pts = ann?.paths;
      if (pts?.length && planId) hiddenPaths.set(planId, [...(hiddenPaths.get(planId) || []), ...pts]);
    };
    const primaryBg = loc.planBg || (loc.planId && planLibrary?.find(p => p.id === loc.planId)?.bg) || null;
    if (loc.planId || loc.planBg) {
      if (loc.planReportHidden) collectHidden(loc.planId, loc.planAnnotations);
      else plans.push({ bg: primaryBg, annotations: loc.planAnnotations, breakId: null, planId: loc.planId || null, epIdx: null });
    }
    for (let i = 0; i < (loc.extraPlans || []).length; i++) {
      const ep = loc.extraPlans[i];
      if (ep.reportHidden) { collectHidden(ep.planId, ep.planAnnotations); continue; }
      const epBg = ep.planBg || (ep.planId && planLibrary?.find(p => p.id === ep.planId)?.bg) || null;
      if (!epBg && !ep.planId && !ep.planAnnotations?.exported) continue;
      plans.push({ bg: epBg, annotations: ep.planAnnotations, breakId: `plan-${loc.id}_ep_${i}`, planId: ep.planId || null, epIdx: i });
    }
    // Fusion des paths masqués dans le plan visible correspondant
    if (hiddenPaths.size > 0) {
      return plans.map(p => {
        const extra = p.planId ? hiddenPaths.get(p.planId) : null;
        if (!extra?.length) return p;
        return { ...p, annotations: { ...p.annotations, paths: [...(p.annotations?.paths || []), ...extra] } };
      });
    }
    return plans;
  })();

  // Combined legend
  const allPaths = allPlans.flatMap(p => p.annotations?.paths || []);
  const usedIds       = new Set(allPaths.filter(p => p.type === 'symbol').map(p => p.symbolId));
  const legendSy      = getAllSymbols().filter(s => usedIds.has(s.id));
  const hasViewpoints = allPaths.some(p => p.type === 'viewpoint');
  const showLegend    = legendSy.length > 0 || hasViewpoints;

  if (!allPlans.length) return null;
  return (
    <div style={{ marginBottom:5, border:`1px solid ${DA.border}`, borderRadius:4, overflow:'hidden' }}>
      <div style={{ background:'#F7F7F7', borderBottom:`2px solid ${DA.red}`, padding:'5px 9px', display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:700, color:'#000', textTransform:'uppercase', letterSpacing:'0.06em' }}>
          Plan — {loc.nom}
        </span>
        {allPaths.length > 0 && (
          <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", color:'#4D4D4D', marginLeft: onEditPlan ? 0 : 'auto' }}>
            {allPaths.length} annotation{allPaths.length > 1 ? 's' : ''}
          </span>
        )}
        {onEditPlan && (
          <span data-print="hide" style={{ marginLeft:'auto', display:'flex', gap:4 }}>
            {allPlans.map((p, i) => p.bg && (
              <button key={i} onClick={() => onEditPlan(loc.id, p.epIdx, p.bg, p.annotations?.paths || [])}
                title="Ajuster les annotations sur ce plan"
                style={{ padding:'2px 8px', borderRadius:4, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, fontSize:9, fontWeight:700, cursor:'pointer', letterSpacing:0.2 }}>
                ✎ {allPlans.length > 1 ? `Plan ${i + 1}` : 'Ajuster'}
              </button>
            ))}
          </span>
        )}
      </div>
      {/* Barre d'annulation du saut qui démarre ce segment (non-premier groupe de zone) */}
      {cutMode && topBreakId && (
        <PlanCutBar data-print="hide" breakId={topBreakId} forced={true} onCut={onCut}/>
      )}
      {allPlans.map((p, i) => {
        const forced = p.breakId && pageBreaks.includes(p.breakId);
        return (
          <React.Fragment key={i}>
            {/* Séparateur de saut entre plans — visible uniquement en mode découpe */}
            {i > 0 && cutMode && (
              <PlanCutBar
                data-print="hide"
                breakId={p.breakId}
                forced={forced}
                onCut={onCut}
              />
            )}
            {i > 0 && !cutMode && forced && (
              <div style={{ height:2, background:DA.red, opacity:0.3 }}/>
            )}
            <SinglePlanImage bg={p.bg} planId={p.planId} annotations={p.annotations} annotScale={annotScale} alt={`Plan ${loc.nom} ${i + 1}`} vpNumByPath={vpNumByPath} onOrient={onOrient}/>
          </React.Fragment>
        );
      })}
      {!hideLegend && showLegend && (
        <div style={{ padding:'8px 12px 10px', background:'#F2F2F2', borderTop:`1px solid #DFE4E8` }}>
          <div style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Légende</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 14px' }}>
            {legendSy.map(s => (
              <div key={s.id} style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, fontFamily:"'Open Sans', sans-serif", color:'#4D4D4D' }}>
                <SymbolIcon sym={s} size={16}/>
                {s.label}
              </div>
            ))}
            {hasViewpoints && (
              <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, fontFamily:"'Open Sans', sans-serif", color:'#4D4D4D' }}>
                <ViewpointIcon size={16}/>
                Vue photo
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanCutBar({ breakId, forced, onCut }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      data-print="hide"
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={() => onCut && onCut(breakId)}
      style={{ cursor:'pointer', display:'flex', alignItems:'center', gap:0,
        background: forced ? DA.red : hov ? '#fff0f0' : '#fffafa',
        borderTop: `2px ${forced ? 'solid' : 'dashed'} ${forced ? DA.red : hov ? DA.red : '#f0b8b8'}`,
        borderBottom: `2px ${forced ? 'solid' : 'dashed'} ${forced ? DA.red : hov ? DA.red : '#f0b8b8'}`,
        padding:'5px 10px', userSelect:'none' }}>
      <span style={{ fontSize:13, lineHeight:1, color: forced || hov ? 'white' : '#c08080',
        background: forced ? 'transparent' : hov ? DA.red : 'none',
        padding: hov && !forced ? '0 4px' : 0, borderRadius:2 }}>✂</span>
      <span style={{ fontSize:8, fontWeight:700, flex:1, marginLeft:6,
        color: forced ? 'white' : hov ? DA.red : '#c08080', letterSpacing:0.2 }}>
        {forced ? 'Saut de page ici — cliquer pour annuler' : 'Couper ici — nouvelle page avant ce plan'}
      </span>
      {!forced && (
        <span style={{ fontSize:7, color: hov ? DA.red : '#d0a0a0',
          background: hov ? '#ffe0e0' : '#fdf0f0', border:`1px solid ${hov ? '#fca5a5' : '#f0d0d0'}`,
          borderRadius:3, padding:'1px 6px', whiteSpace:'nowrap' }}>
          ⊕ Nouvelle page
        </span>
      )}
      {forced && (
        <span style={{ fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.85)' }}>× Retirer</span>
      )}
    </div>
  );
}

// ── Bandeau header commun (logo + titre projet) ──────────────────────────────────────────
function HdrBar({ projet, dateStr }) {
  const logoUrl = useBrandingLogo(); // full logo "Assemblage Ingenierie" (default)
  return (
    <div style={{ height:HDR, background:'white', display:'flex', alignItems:'center', padding:`0 ${MX}px`, borderBottom:`1px solid ${DA.red}` }}>
      {logoUrl && <img src={logoUrl} alt="Assemblage Ingenierie"
        style={{ height:18, objectFit:'contain', flexShrink:0 }}/>}
      <span style={{ flex:1 }}/>
      <span style={{ fontSize:6, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', letterSpacing:'0.03em' }}>{projet.nom}{dateStr ? ` · ${dateStr}` : ''}</span>
    </div>
  );
}

function A4Card({ children, projet, pageNum, totalPages }) {
  const cardRef = useRef();
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    const measure = () => {
      const h = cardRef.current?.offsetHeight ?? 0;
      setOverflow(Math.max(0, h - PH));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(cardRef.current);
    return () => ro.disconnect();
  }, [children]);

  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR')
    : new Date().toLocaleDateString('fr-FR');
  return (
    <div ref={cardRef} style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, position:'relative', minHeight:PH, fontFamily:"'Open Sans', sans-serif" }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB + FTR}px` }}>{children}</div>
      {/* Footer ancré à PH - FTR même si contenu déborde */}
      <div style={{ position:'absolute', top:PH - FTR, left:0, right:0 }}>
        <PageFtr pageNum={pageNum} totalPages={totalPages}/>
      </div>
      {/* Indicateur visuel de débordement — masqué à l'impression */}
      {overflow > 0 && (
        <>
          <div data-print="hide" style={{ position:'absolute', left:0, right:0, top:PH - FTR - MB, borderTop:'2px dashed #F97316', zIndex:6, pointerEvents:'none' }}>
            <div style={{ background:'#F97316', color:'white', fontSize:7, fontWeight:800, padding:'2px 8px', display:'inline-flex', alignItems:'center', gap:4, borderRadius:'0 0 4px 4px', letterSpacing:0.3, whiteSpace:'nowrap' }}>
              ⚠ Dépasse la page A4 ({Math.round(overflow)}px) — utiliser ✂ Saut de page
            </div>
          </div>
          <div data-print="hide" style={{ position:'absolute', left:0, right:0, top:PH - FTR - MB, bottom:0, background:'rgba(249,115,22,0.06)', pointerEvents:'none', zIndex:5 }}/>
        </>
      )}
    </div>
  );
}

function PageSepBanner({ pageNum, totalPages, firstBlockId, isForced, onToggle }) {
  return (
    <div style={{ width:PW, background:'#1a1a1a', padding:'8px 14px', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
      {/* Indicateur page */}
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <div style={{ width:3, height:18, background:DA.red, borderRadius:2, flexShrink:0 }}/>
        <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
          <span style={{ fontSize:10, fontWeight:800, color:'white', lineHeight:1 }}>
            Page {pageNum}
          </span>
          <span style={{ fontSize:8, color:'rgba(255,255,255,0.3)', lineHeight:1 }}>
            sur {totalPages} au total
          </span>
        </div>
      </div>

      <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.07)' }}/>

      {/* Contrôle saut forcé */}
      {isForced && firstBlockId ? (
        <div onClick={() => onToggle(firstBlockId)}
          style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:5,
            background:'rgba(227,5,19,0.18)', border:`1px solid rgba(227,5,19,0.5)`, cursor:'pointer' }}>
          <span style={{ fontSize:10, lineHeight:1 }}>✂</span>
          <span style={{ fontSize:9, fontWeight:700, color:DA.red, whiteSpace:'nowrap' }}>Saut forcé</span>
          <span style={{ fontSize:9, color:'rgba(255,255,255,0.45)',
            background:'rgba(255,255,255,0.08)', borderRadius:3, padding:'1px 6px' }}>
            × Supprimer
          </span>
        </div>
      ) : (
        <span style={{ fontSize:8, color:'rgba(255,255,255,0.2)', fontStyle:'italic' }}>
          séparateur automatique
        </span>
      )}
    </div>
  );
}

// ── Calcul des chunks de participants pour la page de garde ──────────────────────────────────
const COVER_ROW_H = 30; // hauteur estimée par ligne (padding 10px + 2 lignes text ≈ 19px + bordure 1px)
function computeParticipantChunks(participants, infoRowCount) {
  if (!participants.length) return [[]];
  const DARK_H = Math.round(PH * 0.30);
  // Page 1 : zone blanche disponible
  const P1_INNER = PH - DARK_H - FTR - 26; // 26 = padding top 18 + bottom 8
  const INFO_H   = infoRowCount > 0 ? (24 + infoRowCount * 12 + Math.max(0, infoRowCount - 1) * 5 + 16) : 0;
  const HDR_H    = 42; // en-tête section intervenants (titre + ligne tableau)
  const P1_AVAIL = Math.max(0, P1_INNER - INFO_H - HDR_H);
  const p1Count  = Math.floor(P1_AVAIL / COVER_ROW_H);
  // Pages suivantes : pleine hauteur
  const CONT_AVAIL = PH - FTR - 26 - HDR_H;
  const contCount  = Math.max(1, Math.floor(CONT_AVAIL / COVER_ROW_H));
  const chunks = [participants.slice(0, p1Count)];
  let i = p1Count;
  while (i < participants.length) { chunks.push(participants.slice(i, i + contCount)); i += contCount; }
  return chunks;
}

// ── Page de garde unifiée (photo/titre + présentation + intervenants) ──────────────────────
function CoverPage({ projet, pageNum, totalPages, participantChunk }) {
  const logoUrl = useBrandingLogo();
  const sigleUrl = useBrandingLogo('logo/sigle_Ai_rouge.svg');
  const allParticipants = projet.participants || [];
  const participants = participantChunk ?? allParticipants;
  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR')
    : null;
  const infoRows = [
    projet.adresse       && ['Adresse',         projet.adresse],
    dateStr              && ['Date de visite',   dateStr],
    projet.maitreOuvrage && ["Maître d'ouvrage", projet.maitreOuvrage],
  ].filter(Boolean);

  const DARK_H = Math.round(PH * 0.30);

  return (
    <div style={{ width:PW, height:PH, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:"'Open Sans', sans-serif" }}>

      {/* ── Partie sombre : photo + titre ── */}
      <div style={{ height:DARK_H, background:'#1a1a1a', position:'relative', overflow:'hidden', flexShrink:0 }}>
        {projet.photo && (
          <img src={projet.photo} alt=""
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', opacity:0.28 }}/>
        )}
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:DA.red }}/>
        {logoUrl && <img src={logoUrl} alt="Assemblage Ingénierie"
          style={{ position:'absolute', top:MX, right:MX, height:22, objectFit:'contain', opacity:0.9 }}/>}
        <div style={{ position:'absolute', bottom:MX, left:MX + 10 }}>
          <div style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:'rgba(255,255,255,0.45)', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:8 }}>
            Compte-rendu de visite
          </div>
          <div style={{ fontSize:22, fontFamily:"'Open Sans', sans-serif", fontWeight:500, color:'white', lineHeight:1.05, letterSpacing:'-0.015em' }}>{projet.nom}</div>
          {(projet.visiteNom || dateStr) && (
            <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:2, height:24, background:DA.red, flexShrink:0 }}/>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                {projet.visiteNom && (
                  <span style={{ fontSize:13, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'rgba(255,255,255,0.9)', letterSpacing:'0.01em' }}>{projet.visiteNom}</span>
                )}
                {dateStr && (
                  <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'rgba(255,255,255,0.5)', letterSpacing:'0.04em' }}>● Visite du {dateStr}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Partie blanche : présentation + intervenants ── */}
      <div style={{ flex:1, padding:`18px ${MX}px 8px`, display:'flex', flexDirection:'column', gap:16, minHeight:0, overflow:'hidden' }}>

        {infoRows.length > 0 && (
          <div>
            <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Présentation du projet</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              {infoRows.map(([k, v]) => (
                <div key={k} style={{ display:'flex', fontSize:9, fontFamily:"'Open Sans', sans-serif" }}>
                  <span style={{ color:DA.red, fontWeight:400, width:90, flexShrink:0, letterSpacing:'0.04em' }}>{k}</span>
                  <span style={{ color:'#000', fontWeight:400 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {participants.length > 0 && (
          <div>
            <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                Intervenants ({participants.length})
              </span>
            </div>
            <div style={{ display:'flex', alignItems:'center', background:'#F2F2F2', borderTop:`1px solid #B0B8C1`, borderBottom:`1px solid #B0B8C1`, padding:'4px 0' }}>
              <div style={{ width:20, flexShrink:0 }}/>
              <div style={{ flex:1, display:'flex', minWidth:0 }}>
                <div style={{ flex:'0 0 36%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:8, letterSpacing:'0.06em' }}>NOM / POSTE</div>
                <div style={{ flex:'0 0 22%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:4, letterSpacing:'0.06em' }}>TÉLÉPHONE</div>
                <div style={{ flex:'0 0 28%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:4, letterSpacing:'0.06em' }}>EMAIL</div>
                <div style={{ flex:'0 0 14%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textAlign:'right', paddingRight:6, letterSpacing:'0.06em' }}>PRÉSENCE</div>
              </div>
            </div>
            {participants.map((pt, i) => {
              const isPresent = !pt.presence || pt.presence === 'present';
              return (
                <div key={pt.id} style={{ display:'flex', alignItems:'center', padding:'5px 0', borderBottom:`1px solid #DFE4E8` }}>
                  <div style={{ width:20, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {pt.isAssemblage
                      ? (sigleUrl
                          ? <img src={sigleUrl} alt="AI" style={{ height:10, width:10, objectFit:'contain' }}/>
                          : <span style={{ fontSize:6, fontFamily:"'Open Sans', sans-serif", fontWeight:700, color:DA.red }}>AI</span>)
                      : <div style={{ width:4, height:4, borderRadius:'50%', background:'#bbb' }}/>
                    }
                  </div>
                  <div style={{ flex:1, display:'flex', alignItems:'center', minWidth:0 }}>
                    <div style={{ flex:'0 0 36%', minWidth:0, paddingRight:8 }}>
                      <div style={{ fontSize:8.5, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:'#000', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.nom}</div>
                      {pt.poste && <div style={{ fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.poste}</div>}
                    </div>
                    <div style={{ flex:'0 0 22%', fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.tel || '—'}</div>
                    <div style={{ flex:'0 0 28%', fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.email || '—'}</div>
                    <div style={{ flex:'0 0 14%', textAlign:'right', paddingRight:6 }}>
                      <span style={{ fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:600,
                        color: isPresent ? '#16A34A' : DA.red,
                        background: isPresent ? '#DCFCE7' : '#FEE2E2',
                        borderRadius:3, padding:'1px 5px' }}>
                        {isPresent ? 'Présent' : 'Absent'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <PageFtr pageNum={pageNum} totalPages={totalPages}/>
    </div>
  );
}

// ── Page de garde (suite) — intervenants supplémentaires ──────────────────────────────────
function CoverOverflowPage({ projet, pageNum, totalPages, participantChunk }) {
  const sigleUrl = useBrandingLogo('logo/sigle_Ai_rouge.svg');
  const participants = participantChunk || [];
  return (
    <div style={{ width:PW, height:PH, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:"'Open Sans', sans-serif" }}>
      <div style={{ flex:1, padding:`18px ${MX}px 8px`, display:'flex', flexDirection:'column', gap:0, minHeight:0, overflow:'hidden' }}>
        <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>
            Intervenants (suite)
          </span>
        </div>
        <div style={{ display:'flex', alignItems:'center', background:'#F2F2F2', borderTop:`1px solid #B0B8C1`, borderBottom:`1px solid #B0B8C1`, padding:'4px 0' }}>
          <div style={{ width:20, flexShrink:0 }}/>
          <div style={{ flex:1, display:'flex', minWidth:0 }}>
            <div style={{ flex:'0 0 36%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:8, letterSpacing:'0.06em' }}>NOM / POSTE</div>
            <div style={{ flex:'0 0 22%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:4, letterSpacing:'0.06em' }}>TÉLÉPHONE</div>
            <div style={{ flex:'0 0 28%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:4, letterSpacing:'0.06em' }}>EMAIL</div>
            <div style={{ flex:'0 0 14%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textAlign:'right', paddingRight:6, letterSpacing:'0.06em' }}>PRÉSENCE</div>
          </div>
        </div>
        {participants.map((pt) => {
          const isPresent = !pt.presence || pt.presence === 'present';
          return (
            <div key={pt.id} style={{ display:'flex', alignItems:'center', padding:'5px 0', borderBottom:`1px solid #DFE4E8` }}>
              <div style={{ width:20, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                {pt.isAssemblage
                  ? (sigleUrl
                      ? <img src={sigleUrl} alt="AI" style={{ height:10, width:10, objectFit:'contain' }}/>
                      : <span style={{ fontSize:6, fontWeight:700, color:DA.red }}>AI</span>)
                  : <div style={{ width:4, height:4, borderRadius:'50%', background:'#bbb' }}/>
                }
              </div>
              <div style={{ flex:1, display:'flex', alignItems:'center', minWidth:0 }}>
                <div style={{ flex:'0 0 36%', minWidth:0, paddingRight:8 }}>
                  <div style={{ fontSize:8.5, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:'#000', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.nom}</div>
                  {pt.poste && <div style={{ fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.poste}</div>}
                </div>
                <div style={{ flex:'0 0 22%', fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.tel || '—'}</div>
                <div style={{ flex:'0 0 28%', fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.email || '—'}</div>
                <div style={{ flex:'0 0 14%', textAlign:'right', paddingRight:6 }}>
                  <span style={{ fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:600,
                    color: isPresent ? '#16A34A' : DA.red,
                    background: isPresent ? '#DCFCE7' : '#FEE2E2',
                    borderRadius:3, padding:'1px 5px' }}>
                    {isPresent ? 'Présent' : 'Absent'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <PageFtr pageNum={pageNum} totalPages={totalPages}/>
    </div>
  );
}

// ── Pied de page commun (toutes les pages) ────────────────────────────────────────────
function PageFtr({ pageNum, totalPages }) {
  return (
    <div style={{ height:FTR, background:'white', borderTop:`1px solid #DFE4E8`, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', padding:`0 ${MX}px`, position:'relative' }}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1.5 }}>
        <span style={{ fontSize:5, fontFamily:"'Open Sans', sans-serif", color:'#c0c4c8', lineHeight:1, textAlign:'center' }}>
          Assemblage Ingénierie · S.A.S. capital social 1 000€ · 137 rue d'Aboukir, 75002 Paris · contact@assemblage.net · www.assemblage.net · +33 7 65 62 30 87
        </span>
        <span style={{ fontSize:5, fontFamily:"'Open Sans', sans-serif", color:'#c0c4c8', lineHeight:1, textAlign:'center' }}>
          NAF 7112B · R.C.S. Paris 822 130 100 · Siret 822 130 100 0032 · n°TVA FR 24 822 130 100
        </span>
      </div>
      <span style={{ position:'absolute', right:MX, fontSize:6, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D' }}>{pageNum} / {totalPages}</span>
    </div>
  );
}


// ── Page conclusion ──────────────────────────────────────────────────────────────────────────
function ConclusionPage({ conclusion, conclusionAlign = 'left', projet, pageNum, totalPages, onUpdateConclusion, onUpdateConclusionAlign, localisations = [] }) {
  const dateStr = projet.dateVisite ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR') : null;
  const isEditable = !!onUpdateConclusion;
  const ALIGNS = [
    { k:'left', sym:'←' }, { k:'center', sym:'↔' }, { k:'right', sym:'→' }, { k:'justify', sym:'☰' },
  ];

  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState(null);
  const [proposals, setProposals] = useState(null); // null | string[]
  const [applied, setApplied] = useState(new Set()); // indices des points déjà ajoutés
  const [convSyncKey, setConvSyncKey] = useState(0); // force le rafraîchissement de l'éditeur après l'IA
  const convRef = useRef(null);

  // Contexte du rapport pour l'IA. On ÉCARTE les paragraphes de simple présentation/contexte
  // (ex. « présentation du bâtiment ») : inutiles en conclusion, l'IA les répétait.
  const buildContext = () => {
    const meta = [
      projet.adresse ? `Adresse : ${projet.adresse}` : null,
      dateStr ? `Date de visite : ${dateStr}` : null,
    ].filter(Boolean).join('\n');
    const isPresentation = (t) => /pr[ée]sentation|introduction|contexte/i.test(t || '');
    const urg = { haute: 0, moyenne: 0, basse: 0 };
    const zones = (localisations || []).map(loc => {
      const its = (loc.items || []).filter(i => (i.titre || i.commentaire) && !isPresentation(i.titre));
      if (!its.length) return null;
      const lines = its.map(i => {
        const u = i.urgence || 'basse'; urg[u] = (urg[u] || 0) + 1;
        const lab = u === 'haute' ? 'URGENT' : u === 'moyenne' ? 'À planifier' : 'Mineur';
        const c = stripMarkup(i.commentaire || '').replace(/\s+/g, ' ').trim().slice(0, 600);
        return `  • [${lab}] ${i.titre || ''}${c ? ` — ${c}` : ''}`;
      }).join('\n');
      return `Zone « ${loc.nom || '—'} » :\n${lines}`;
    }).filter(Boolean).join('\n\n');
    const count = urg.haute + urg.moyenne + urg.basse;
    return { meta, zones, urg, count };
  };

  const ask = async (prompt, maxTokens, system) => {
    const d = await callAIProxy({
      feature: 'conclusion', model: 'claude-sonnet-4-6', max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: prompt }],
    });
    return d.content?.[0]?.text?.trim() || '';
  };

  // Parse une liste « 1. … 2. … » (ou puces) en tableau, comme les suggestions de la visite.
  const parseNumbered = (text) => {
    const out = []; let cur = null;
    for (const line of (text || '').split('\n')) {
      const m = line.match(/^\s*(?:\d+[.)]|[-•])\s+(.+)/);
      if (m) { if (cur != null) out.push(cur.trim()); cur = m[1]; }
      else if (cur != null && line.trim()) cur += ' ' + line.trim();
    }
    if (cur != null) out.push(cur.trim());
    return out.length ? out : (text ? [text.trim()] : []);
  };

  const CONCL_SYS = `Tu es ingénieur structure chez Assemblage Ingénierie. Tu rédiges la CONCLUSION d'un rapport de visite, en français.

DÉFINITION à respecter : conclure, c'est terminer le raisonnement en le RÉSUMANT en quelques phrases, voire quelques mots. La conclusion est la partie FINALE et SYNTHÉTIQUE du rapport — pas une ré-exposition.

Règles ABSOLUES :
- SOIS BREF : quelques phrases suffisent. On résume, on ne redéveloppe pas.
- NE répète PAS la présentation/description du bâtiment ou du projet (localisation, « à cheval sur deux bâtiments », typologie…) ni le nom/code de l'affaire : ce n'est pas une conclusion, ne raconte pas la vie.
- Synthétise l'essentiel : l'enjeu/le constat principal, puis la recommandation/les suites à donner.
- Orthographe et grammaire parfaites, ton professionnel, sans tiret long (—).`;

  // SUPER bouton unique : UN SEUL appel IA renvoie la conclusion ET les points d'amélioration
  // (séparés par ===POINTS===). On NE fait PAS deux appels en parallèle : le throttle client
  // (15s/feature) refusait le 2e → « Attends 15s » et rien ne se lançait.
  const generateAll = async () => {
    setAiLoading(true); setAiErr(null); setProposals(null); setApplied(new Set());
    try {
      const { meta, zones, urg, count } = buildContext();
      const base = `${meta}\nObservations (${count} : ${urg.haute} urgentes, ${urg.moyenne} à planifier, ${urg.basse} mineures) :\n${zones}`;
      const prompt = `À partir des éléments ci-dessous, produis EXACTEMENT DEUX sections séparées par une ligne contenant uniquement « ===POINTS=== ».

SECTION 1 — la CONCLUSION, COURTE et SYNTHÉTIQUE (quelques phrases en tout, pas un pavé), en 3 brefs paragraphes séparés par une ligne vide, dans CET ordre :
  1) PROBLÈME PRINCIPAL : 1 à 2 phrases sur l'enjeu central (ce que le client veut faire — typiquement la démolition de cloisons/murs — et notre analyse : porteur ou non, risque). NE décris PAS le bâtiment.
  2) SOLUTION : 1 à 2 phrases sur la méthodologie/solution préconisée (étaiement, vérifications, renforcements…).
  3) CONCLUSION : 1 à 2 phrases de synthèse finale et la recommandation / les suites à donner.
Au total une dizaine de lignes MAXIMUM. Texte rédigé et fluide, professionnel, sans markdown, sans titre, sans liste, sans répéter la présentation du bâtiment.

===POINTS===

SECTION 2 — 4 à 6 POINTS TECHNIQUES qu'on pourrait AJOUTER à la conclusion (précisions structurelles, points de vigilance, réserves, recommandations non triviales). Chaque point : 1 à 2 phrases rédigées, prêtes à coller. Format « 1. … », « 2. … ».

Éléments du rapport :
${base}`;
      const out = await ask(prompt, 1400, CONCL_SYS);
      const parts = out.split(/\n?===\s*POINTS\s*===\n?/i);
      const concl = (parts[0] || '').trim();
      if (concl) { onUpdateConclusion(concl); setConvSyncKey(k => k + 1); }
      setProposals(parseNumbered((parts[1] || '').trim()));
    } catch (e) { setAiErr(e.message || 'Erreur IA'); }
    setAiLoading(false);
  };

  // Ajoute un point d'amélioration À LA FIN de la conclusion (nouveau paragraphe), sans écraser.
  const useProposal = (txt, i) => {
    const para = `<div>${txt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`;
    const cur = (conclusion || '').trim();
    const next = cur ? `${cur}<div><br></div>${para}` : para;
    onUpdateConclusion(next); setConvSyncKey(k => k + 1);
    setApplied(prev => new Set([...prev, i]));
  };

  // Alignement FIABLE : applique la commande à TOUT le contenu de l'éditeur (execCommand sur le
  // contentEditable = méthode canonique, contrairement au style React qui ne « prenait » pas),
  // persiste le HTML, et met aussi conclusionAlign pour le conteneur du rapport.
  const applyAlign = (k) => {
    onUpdateConclusionAlign?.(k);
    const ed = convRef.current?.getEditor?.();
    if (!ed) return;
    ed.focus();
    const sel = window.getSelection();
    const r = document.createRange(); r.selectNodeContents(ed);
    sel.removeAllRanges(); sel.addRange(r);
    document.execCommand(k === 'center' ? 'justifyCenter' : k === 'right' ? 'justifyRight' : k === 'justify' ? 'justifyFull' : 'justifyLeft');
    sel.removeAllRanges();
    onUpdateConclusion(ed.innerHTML); setConvSyncKey(k2 => k2 + 1);
  };

  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, fontFamily:"'Open Sans', sans-serif", position:'relative', minHeight:PH }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB + FTR}px` }}>
        <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Conclusion</span>
          {isEditable && (
            <div data-print="hide" style={{ display:'flex', alignItems:'center', gap:6, marginLeft:'auto', flexWrap:'wrap', justifyContent:'flex-end' }}>
              {/* SUPER bouton unique : résume tout le rapport (concis, ortho corrigée) + propose
                  des points techniques à ajouter, d'un seul clic. */}
              <button onClick={generateAll} disabled={aiLoading}
                style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 11px', borderRadius:6, border:`1.5px solid ${DA.red}`, background: aiLoading ? DA.grayXL : DA.red, color: aiLoading ? DA.grayL : 'white', fontSize:9, fontWeight:800, cursor: aiLoading ? 'wait' : 'pointer', letterSpacing:'0.03em' }}>
                {aiLoading ? <Ic n="spn" s={10}/> : <Ic n="spk" s={10}/>}
                {aiLoading ? 'Génération…' : 'Générer via IA'}
              </button>
              {onUpdateConclusionAlign && (
                <div style={{ display:'flex', gap:3 }}>
                  {ALIGNS.map(a => (
                    <button key={a.k} onClick={() => applyAlign(a.k)}
                      style={{ width:22, height:22, borderRadius:4, fontSize:11, cursor:'pointer',
                        border:`1.5px solid ${conclusionAlign===a.k ? DA.red : DA.border}`,
                        background: conclusionAlign===a.k ? DA.redL : 'white',
                        color: conclusionAlign===a.k ? DA.red : DA.gray }}>
                      {a.sym}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {aiErr && <div data-print="hide" style={{ fontSize:8, color:DA.red, marginBottom:6, padding:'3px 6px', background:'#FFF0F0', borderRadius:4 }}>{aiErr}</div>}
        {isEditable ? (
          <RichTextArea
            ref={convRef}
            value={conclusion || ''}
            syncKey={convSyncKey}
            onChange={onUpdateConclusion}
            textAlign={conclusionAlign || 'left'}
            placeholder="Saisissez votre conclusion, générez-la via IA ou choisissez une proposition…"
            style={{ width:'100%', fontSize:10, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#000', lineHeight:1.5, border:`1px solid #DFE4E8`, borderRadius:4, padding:'10px 12px', background:'white', boxSizing:'border-box', minHeight:200 }}
          />
        ) : (
          <div style={{ fontSize:10, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#000', lineHeight:1.5, whiteSpace:'pre-wrap', border:`1px solid #DFE4E8`, borderRadius:4, padding:'10px 12px', background:'white', minHeight:60, textAlign: conclusionAlign }}>
            {conclusion ? renderMarkup(conclusion) : <span style={{ color:'#4D4D4D', fontStyle:'italic' }}>Aucune conclusion saisie.</span>}
          </div>
        )}
        {/* Propositions IA — APRÈS le texte : points cliquables à ajouter à la conclusion. */}
        {isEditable && proposals && (
          <div data-print="hide" style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:8, fontWeight:700, color:DA.red, textTransform:'uppercase', letterSpacing:'0.05em' }}>Points d'amélioration — cliquer pour ajouter à la conclusion</span>
              <button onClick={() => setProposals(null)} style={{ marginLeft:'auto', border:'none', background:'none', color:DA.grayL, cursor:'pointer', fontSize:11 }}>✕</button>
            </div>
            {proposals.length === 0 && <div style={{ fontSize:9, color:DA.grayL, fontStyle:'italic' }}>Aucune proposition.</div>}
            {proposals.map((p, i) => (
              <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, border:`1px solid ${applied.has(i) ? '#A7D7B0' : DA.border}`, borderRadius:6, padding:'7px 10px', background: applied.has(i) ? '#EAF7EE' : '#FAFAFA' }}>
                <span style={{ flex:1, fontSize:9.5, lineHeight:1.5, color:'#222' }}>{p}</span>
                <button onClick={() => useProposal(p, i)} disabled={applied.has(i)}
                  style={{ flexShrink:0, background: applied.has(i) ? '#2E7D32' : DA.red, color:'white', border:'none', borderRadius:5, padding:'4px 10px', fontSize:9, fontWeight:700, cursor: applied.has(i) ? 'default' : 'pointer', opacity: applied.has(i) ? 0.7 : 1 }}>
                  {applied.has(i) ? '✓ Ajouté' : '＋ Ajouter'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ position:'absolute', top:PH - FTR, left:0, right:0 }}>
        <PageFtr pageNum={pageNum} totalPages={totalPages}/>
      </div>
    </div>
  );
}

// ── Tableau récapitulatif ─────────────────────────────────────────────────────────────────────────
// Textarea qui grandit pour afficher TOUT son contenu (zéro scroll, zéro clipping) : la hauteur
// s'ajuste à scrollHeight à chaque rendu et à chaque frappe → la cellule du tableau s'agrandit
// naturellement (grid alignItems:'start'). Évite le clipping des lignes qui s'enroulent
// (un bullet long compte pour 1 « \n » mais occupe 2-3 lignes visuelles).
function AutoTextarea({ value, style, ...props }) {
  const ref = useRef(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(resize, [value, resize]);
  return (
    <textarea ref={ref} value={value}
      onInput={resize}
      style={{ ...style, overflow:'hidden', resize:'none' }}
      {...props}/>
  );
}

function TableauRecapPage({ localisations, projet, pageNum, totalPages, tableauRecap, recapRows, onUpdateRecap, onDeleteRecap, onAddCustomRow }) {
  const urgOrder = { haute: 0, moyenne: 1, basse: 2 };
  // Use passed recapRows when available (interactive preview), otherwise compute
  const ovMap = new Map((tableauRecap || []).map(r => [r.itemId, r]));
  const rows = recapRows && recapRows.length >= 0 && onUpdateRecap
    ? recapRows
    : localisations.flatMap(loc =>
        (loc.items || []).filter(i => i.titre && i.suivi !== 'fait').map(i => {
          const ov = ovMap.get(i.id) || {};
          return { locNom: 'zone' in ov ? ov.zone : (loc.nom || ''), titre: 'titre' in ov ? ov.titre : (i.titre || ''), urgence: 'urgence' in ov ? ov.urgence : (i.urgence || 'basse'), solution: 'solution' in ov ? ov.solution : '' };
        })
      ).sort((a, b) => (urgOrder[a.urgence] ?? 2) - (urgOrder[b.urgence] ?? 2));

  const [loadingAI, setLoadingAI] = useState(null);
  const [aiErr, setAiErr] = useState(null);
  const genDoneRef = useRef(new Set());
  // Ref toujours à jour : évite la closure stale quand onUpdateRecap change entre deux rows
  const onUpdateRecapRef = useRef(onUpdateRecap);
  onUpdateRecapRef.current = onUpdateRecap;

  // Génère, à partir du commentaire de l'observation, un résumé "Désordre" (problèmes constatés,
  // stocké dans le champ titre) ET un résumé "Solution" (réparation préconisée).
  const genRow = async (row, opts = {}) => {
    const updateFn = onUpdateRecapRef.current;
    if (!updateFn || !row.commentaire) return;
    setLoadingAI(row.itemId); setAiErr(null);
    try {
      const txt = row.commentaire.replace(/<[^>]+>/g, ' ').replace(/\*{1,3}/g, '').replace(/\s+/g, ' ').trim().slice(0, 1500);
      const prompt = `Observation de visite de chantier (zone "${row.locNom}") :\n${txt}\n\nRéponds UNIQUEMENT en JSON valide, sans texte autour : {"desordre":"• désordre 1\\n• désordre 2 (un bullet par problème constaté, 2-3 max)","solution":"• solution 1\\n• solution 2 (un bullet par réparation préconisée, 2-3 max, ou chaîne vide si aucune solution évoquée)"}. En français, factuel, sans ponctuation finale, sans markdown.`;
      const d = await callAIProxy({ feature: 'recap_row', _waitOk: opts.waitOk, model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] });
      const raw = (d.content?.[0]?.text || '').replace(/```json\n?|\n?```/g, '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      let obj = null;
      if (jsonMatch) try { obj = JSON.parse(jsonMatch[0]); } catch {}
      if (obj) {
        const desordre = String(obj.desordre ?? '').trim();
        const finalDesordre = desordre || `• ${txt.slice(0, 60).replace(/\s+/g, ' ').trim()}`;
        const patch = {};
        if (finalDesordre) patch.titre = finalDesordre;
        if (obj.solution != null) patch.solution = String(obj.solution).trim();
        if (Object.keys(patch).length) updateFn(row.itemId, patch);
      }
    } catch (e) { setAiErr(e.message); throw e; }
    finally { setLoadingAI(null); }
  };

  // Génération AUTOMATIQUE : pour chaque ligne avec commentaire mais sans désordre/solution.
  // _waitOk=true → callAIProxy attend le throttle au lieu de lever une erreur.
  // Dépend de rowIdsKey (liste des IDs) et non de rows entier → ne redémarre pas à chaque update
  // de données (ce qui causerait une closure stale sur onUpdateRecap).
  const rowIdsKey = rows.map(r => r.itemId).join(',');
  useEffect(() => {
    if (!onUpdateRecap) return;
    let cancelled = false;
    const snapshot = rows; // capture la liste actuelle des rows pour cet effet
    const snapOvMap = new Map((tableauRecap || []).map(r => [r.itemId, r]));
    (async () => {
      for (const row of snapshot) {
        if (cancelled) break;
        if (!row.commentaire || genDoneRef.current.has(row.itemId)) continue;
        const ov = snapOvMap.get(row.itemId) || {};
        const needsDesordre = !('titre' in ov && String(ov.titre).trim());
        const needsSolution  = !(ov.solution && String(ov.solution).trim());
        if (!needsDesordre && !needsSolution) { genDoneRef.current.add(row.itemId); continue; }
        genDoneRef.current.add(row.itemId);
        try { await genRow(row, { waitOk: true }); }
        catch { genDoneRef.current.delete(row.itemId); }
      }
    })();
    return () => { cancelled = true; };
  }, [rowIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dateStr = projet.dateVisite ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR') : null;
  const isEditable = !!onUpdateRecap;

  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, fontFamily:"'Open Sans', sans-serif", position:'relative', minHeight:PH }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB + FTR}px` }}>
        <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Tableau récapitulatif</span>
          <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D' }}>{rows.length} point{rows.length !== 1 ? 's' : ''} à traiter</span>
        </div>
        {aiErr && <div data-print="hide" style={{ fontSize:8, color:DA.red, marginBottom:6, padding:'3px 6px', background:'#FFF0F0', borderRadius:4 }}>{aiErr}</div>}
        {/* En-tête */}
        <div style={{ display:'grid', gridTemplateColumns: isEditable ? '5px 1fr 1.2fr 1.8fr 60px 40px' : '5px 70px 1fr 1.5fr 65px', background:'#F2F2F2', borderTop:`1px solid #B0B8C1`, borderBottom:`1px solid #B0B8C1`, padding:'4px 8px', gap:6 }}>
          <div/>
          <span style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Zone</span>
          <span style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Désordre</span>
          <span style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Solution</span>
          <span style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Urgence</span>
          {isEditable && <div data-print="hide"/>}
        </div>
        {rows.map((row, i) => {
          const u = URGENCE[row.urgence] || URGENCE.basse;
          return (
            <div key={row.itemId ?? i} style={{ display:'grid', gridTemplateColumns: isEditable ? '5px 1fr 1.2fr 1.8fr 60px 40px' : '5px 70px 1fr 1.5fr 65px', gap:6, padding:'4px 8px', borderBottom:`1px solid #DFE4E8`, background: i % 2 === 0 ? '#F9F9F9' : 'white', alignItems:'start' }}>
              <div style={{ background:u.dot, borderRadius:2, minHeight:14, alignSelf:'stretch' }}/>
              {isEditable ? (
                <AutoTextarea value={row.locNom} onChange={e => onUpdateRecap(row.itemId, 'zone', e.target.value)}
                  style={{ fontSize:7, color:DA.gray, lineHeight:1.4, border:'none', background:'transparent', outline:'none', fontFamily:'inherit', width:'100%', padding:0, whiteSpace:'pre-wrap', wordBreak:'break-word' }}/>
              ) : (
                <div style={{ fontSize:7, color:DA.gray, lineHeight:1.4 }}>{row.locNom || '—'}</div>
              )}
              {isEditable ? (
                <AutoTextarea value={row.titre} onChange={e => onUpdateRecap(row.itemId, 'titre', e.target.value)}
                  style={{ fontSize:8, fontWeight:700, color:DA.black, lineHeight:1.3, border:'none', background:'transparent', outline:'none', fontFamily:'inherit', width:'100%', padding:0, whiteSpace:'pre-wrap', wordBreak:'break-word' }}/>
              ) : (
                <div style={{ fontSize:8, fontWeight:700, color:DA.black, lineHeight:1.3, whiteSpace:'pre-wrap' }}>{row.titre || '—'}</div>
              )}
              {isEditable ? (
                <AutoTextarea value={row.solution || ''} onChange={e => onUpdateRecap(row.itemId, 'solution', e.target.value)}
                  placeholder={loadingAI === row.itemId ? 'Génération IA…' : 'Solution…'}
                  style={{ fontSize:7, color:DA.gray, lineHeight:1.4, border:'none', background:'transparent', outline:'none', fontFamily:'inherit', width:'100%', padding:0, whiteSpace:'pre-wrap', wordBreak:'break-word' }}/>
              ) : (
                <div style={{ fontSize:7, color:DA.gray, lineHeight:1.4, wordBreak:'break-word', whiteSpace:'pre-wrap' }}>{row.solution || '—'}</div>
              )}
              {isEditable ? (
                <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                  {['haute','moyenne','basse'].map(lvl => {
                    const uu = URGENCE[lvl]; const active = row.urgence === lvl;
                    return <button key={lvl} onClick={() => onUpdateRecap(row.itemId, 'urgence', lvl)}
                      style={{ padding:'1px 3px', borderRadius:3, fontSize:6, fontWeight:700, cursor:'pointer', border:`1px solid ${active ? uu.border : DA.border}`, background: active ? uu.bg : 'white', color: active ? uu.text : DA.grayL }}>
                      {uu.label}
                    </button>;
                  })}
                </div>
              ) : (
                <span style={{ fontSize:7, fontWeight:700, color:u.text, background:u.bg, border:`1px solid ${u.border}`, borderRadius:4, padding:'1px 5px', whiteSpace:'nowrap', alignSelf:'start' }}>{u.label}</span>
              )}
              {isEditable && (
                <div data-print="hide" style={{ display:'flex', flexDirection:'column', gap:3, alignSelf:'start' }}>
                  {row.commentaire && (
                    <button title="Regénérer avec IA" onClick={() => { genDoneRef.current.delete(row.itemId); genRow(row); }}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, lineHeight:1, padding:0 }}>✨</button>
                  )}
                  <button onClick={() => onDeleteRecap(row.itemId, row.isCustom)}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'#EF4444', fontSize:13, lineHeight:1, padding:0 }}>×</button>
                </div>
              )}
            </div>
          );
        })}
        {isEditable && (
          <button data-print="hide" onClick={onAddCustomRow}
            style={{ width:'100%', marginTop:4, padding:'5px 0', borderRadius:4, border:`1.5px dashed ${DA.border}`, background:'white', color:DA.grayL, fontSize:9, fontWeight:600, cursor:'pointer' }}>
            + Ajouter une ligne
          </button>
        )}
      </div>
      <div style={{ position:'absolute', top:PH - FTR, left:0, right:0 }}>
        <PageFtr pageNum={pageNum} totalPages={totalPages}/>
      </div>
    </div>
  );
}

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

// ── Composant principal ─────────────────────────────────────────────────────────────────────────
const RapportPreview = React.forwardRef(function RapportPreview({ projet, localisations, photosParLigne, pageBreaks, onTogglePageBreak, plansEnFin, plansNoBreak = false, onTogglePlansNoBreak, includeTableauRecap = true, tableauRecap = [], includeConclusion = false, conclusion = '', conclusionAlign = 'left', annotScales = { text: 1, shape: 1, symbol: 1 }, photoAnnotScales = { text: 1, shape: 1, symbol: 1 }, onAnnotScaleChange, onUpdateItem, onTogglePanel, panelOpen, panelW = 0, cutMode = false, onCutModeChange, onExportPdf, onExportPhotos, totalPhotos = 0, zipping = false, recapRows = [], onUpdateRecap, onDeleteRecap, onAddCustomRow, onUpdateConclusion, onUpdateConclusionAlign, onEditPlan = null, onAnnotatePhoto = null }, ref) {
  const ppl  = photosParLigne ?? 2;
  // Échelles d'annotation par type (texte/forme/symbole) — diffusées telles quelles aux blocs.
  const annotScale = annotScales;
  const locs = useMemo(() => localisations.filter(l => (l.items || []).some(itemHasReportContent)), [localisations]);
  // Numérotation Vxx globale (badges photos + labels marqueurs) — calculée une fois, partagée
  // par le mode inline et le mode « plans en fin » → numéros identiques partout, zéro doublon.
  const { vxxPhotoMap, vpNumByPath } = useMemo(() => computeVpNumbering(localisations), [localisations]);
  const vxxDebugData = useMemo(() => VXX_DEBUG ? debugVpNumbering(localisations) : null, [localisations]);

  // breaks effectifs = breaks manuels + breaks dérivés des découpages de paragraphes
  const paraBreaks = useMemo(() =>
    new Set((pageBreaks || []).filter(id => /_p\d+$/.test(id))),
  [pageBreaks]);
  // Orientation des plans (détectée au chargement de l'image par SinglePlanImage, remontée ici).
  // planId → 'portrait' | 'landscape'. Sert à isoler automatiquement les plans portrait sur
  // leur propre page (demande utilisateur : un plan portrait par page pour qu'il soit lisible).
  const [planOrient, setPlanOrient] = useState({});
  const handlePlanOrient = useCallback((planId, o) => {
    if (!planId) return;
    setPlanOrient(prev => (prev[planId] === o ? prev : { ...prev, [planId]: o }));
  }, []);

  // Sauts de page AUTOMATIQUES dérivés de l'orientation : on isole chaque plan portrait sur sa
  // page. Réutilise les mêmes breakId que les sauts manuels (`plan-${loc.id}` pour le bloc plan,
  // `plan-${loc.id}_ep_${i}` pour un plan extra) → splitPlanGroups + buildPages coupent comme
  // pour un saut forcé, sans logique de pagination dédiée. Ignoré en mode « plans en fin ».
  const portraitPlanBreaks = useMemo(() => {
    const s = new Set();
    if (plansEnFin) return s;
    const lib = projet.planLibrary || [];
    const bgResolvable = (planId, planBg, ann) =>
      !!(ann?.exported || planBg || (planId && lib.find(p => p.id === planId)?.bg));
    for (const loc of locs) {
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
  }, [locs, planOrient, plansEnFin, projet.planLibrary]);

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
  const allBlocks   = useMemo(() => flattenBlocks(locs, plansEnFin, ppl, paraBreaks, vxxPhotoMap, plansNoBreak, projet.planLibrary || [], breaks), [locs, plansEnFin, ppl, paraBreaks, vxxPhotoMap, plansNoBreak, projet.planLibrary, breaks]);
  const [measuredH, setMeasuredH] = useState({});
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
  const containerRef = useRef();
  const scrollRef    = useRef();
  const pageRefs     = useRef([]);
  const scale = usePreviewScale(scrollRef);

  const recapItems    = localisations.flatMap(l => (l.items || []).filter(i => i.titre && i.suivi !== 'fait'));
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
    () => computeParticipantChunks(projet.participants || [], coverInfoRows.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projet.participants, coverInfoRows.length]
  );
  const coverPageCount = participantChunks.length; // toujours ≥ 1

  const totalPages    = coverPageCount + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + planPageSegments.length;

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
  useImperativeHandle(ref, () => ({
    print: async () => {
      const pages = pageRefs.current.filter(Boolean);
      if (!pages.length) return;

      const win = window.open('', '_blank');
      if (!win) { alert("Autorisez les pop-ups pour exporter le PDF"); return; }

      // Compresse les images avant inclusion dans le PDF imprimé. C'est ICI que se joue le
      // poids du PDF : sans ça, le navigateur (« Enregistrer en PDF ») embarque chaque photo
      // en pleine résolution capteur (~4000px) → PDF de 100+ Mo.
      // ⚠️ Les photos d'observation sont des URL signées Supabase (https://…), PAS des data URL.
      // On doit donc aussi traiter les URL distantes : fetch → blob → object URL (canvas non
      // « tainté ») → redessin réduit → JPEG compact. Les data URL volumineux sont aussi réduits.
      const compressIfNeeded = async (src) => {
        if (!src) return src;
        const isData = src.startsWith('data:image/');
        if (isData && src.length < 400000) return src;        // petit data URL → on garde
        if (!isData && !/^https?:/i.test(src)) return src;     // blob:/autre → on ne touche pas
        let objUrl = null;
        try {
          let loadSrc = src;
          if (!isData) {
            const resp = await fetch(src);
            if (!resp.ok) return src;
            const blob = await resp.blob();
            objUrl = URL.createObjectURL(blob);
            loadSrc = objUrl;
          }
          return await new Promise(resolve => {
            const img = new window.Image();
            img.onload = () => {
              try {
                // Petites images (logos, sigles, icônes < 1000px) : on NE touche à rien — sinon
                // l'aplatissement JPEG sur fond blanc détruit leur transparence (logo Assemblage
                // sur la page de garde sombre → vilain rectangle blanc). Elles sont déjà légères.
                if (img.naturalWidth < 1000 && img.naturalHeight < 1000) { resolve(src); return; }
                const maxW = 1200;
                const scale = Math.min(1, maxW / img.naturalWidth);
                const W = Math.max(1, Math.round(img.naturalWidth * scale));
                const H = Math.max(1, Math.round(img.naturalHeight * scale));
                const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
                const ctx = cv.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); // JPEG sans alpha (photos opaques)
                ctx.drawImage(img, 0, 0, W, H);
                const out = cv.toDataURL('image/jpeg', 0.7);
                cv.width = 0; cv.height = 0;
                resolve(out && out.length > 50 ? out : src);
              } catch { resolve(src); }
            };
            img.onerror = () => resolve(src);
            img.src = loadSrc;
          });
        } catch { return src; }
        finally { if (objUrl) URL.revokeObjectURL(objUrl); }
      };

      const pagesHtml = (await Promise.all(pages.map(async el => {
        // Capturer le contenu des canvas sur l'ORIGINAL avant clonage —
        // cloneNode(true) copie la structure DOM mais pas les pixels des canvas.
        const origCanvases = Array.from(el.querySelectorAll('canvas'));
        const canvasData = origCanvases.map(c => {
          try { return { src: c.toDataURL(), cssText: c.style.cssText }; } catch { return null; }
        });
        origCanvases.forEach((c, i) => { c.dataset._pi = String(i); });

        const clone = el.cloneNode(true);

        // Nettoyer les marqueurs temporaires sur l'original
        origCanvases.forEach(c => { delete c.dataset._pi; });

        // Supprimer les éléments UI non imprimables
        clone.querySelectorAll('[data-print="hide"]').forEach(e => e.remove());

        // Remplacer les canvas clonés (vides) par les images capturées depuis l'original
        clone.querySelectorAll('canvas').forEach(canvas => {
          const i = parseInt(canvas.dataset._pi ?? '-1');
          const data = i >= 0 ? canvasData[i] : null;
          if (!data?.src) { canvas.parentNode?.removeChild(canvas); return; }
          try {
            const img = document.createElement('img');
            img.src = data.src;
            img.style.cssText = data.cssText;
            canvas.parentNode?.replaceChild(img, canvas);
          } catch {}
        });

        // Compresser les photos non-annotées (data URL bruts, potentiellement très lourds)
        await Promise.all(Array.from(clone.querySelectorAll('img[src]')).map(async img => {
          img.src = await compressIfNeeded(img.src);
        }));

        clone.style.marginTop = '0';
        return `<div class="pdf-page">${clone.innerHTML}</div>`;
      }))).join('\n');

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
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; font-family: 'Open Sans', 'Inter', system-ui, -apple-system, sans-serif; }
  html, body { margin: 0; padding: 0; background: white; }
  .pdf-page { width: 630px; height: 891px; overflow: hidden; position: relative; display: block; page-break-after: always; break-after: page; }
  .pdf-page:last-child { page-break-after: avoid; break-after: avoid; }
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
      <div style={{ background:'#1e1e1e', padding:'6px 10px', display:'flex', alignItems:'center', flexShrink:0, borderBottom:'1px solid rgba(255,255,255,0.06)', position:'relative' }}>
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
        {/* Centre : navigation pages — centré sur la largeur totale du viewport */}
        <div style={{ position:'absolute', left:`calc(50vw - ${panelOpen ? panelW : 0}px)`, transform:'translateX(-50%)', display:'flex', alignItems:'center', gap:6 }}>
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

      {/* ── Zone défilante ── */}
      <div ref={scrollRef}
        style={{ flex:1, overflowY:'auto', overflowX:'hidden', background:'#555', paddingBottom:20, position:'relative' }}
      >

        {/* ── Couche de mesure invisible ── */}
        <div style={{ position:'absolute', left:0, top:0, width:PW, height:0, overflow:'hidden', visibility:'hidden', pointerEvents:'none' }}>
          <div style={{ width:CW, visibility:'hidden', pointerEvents:'none' }}>
            {allBlocks.map(block => (
              <div key={block.id} ref={el => { if (el) blockElsRef.current[block.id] = el; else delete blockElsRef.current[block.id]; }}>
                {block.type === 'zone'
                  ? <ZoneHeader loc={block.loc}/>
                  : block.type === 'plan'
                  ? <PlanBlock loc={block.loc} annotScale={annotScale} planLibrary={projet.planLibrary} cutMode={false} pageBreaks={pageBreaks} onCut={handleCut} vpNumByPath={vpNumByPath} onEditPlan={onEditPlan} plansSubset={block.plansSubset ?? null} topBreakId={block.topBreakId ?? null} onOrient={handlePlanOrient}/>
                  : <ItemBlock item={block.item} ppl={ppl} mode={block.mode ?? 'full'} textContent={block.textContent} locId={block.locId} vpPhotoOffset={block.vpPhotoOffset ?? 0} vxxPhotoMap={block.vxxPhotoMap} photoRow={block.photoRow} photoCols={block.photoCols} isLastPhotoRow={block.isLastPhotoRow ?? true} annotScale={annotScale}/>
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
                      <div>
                        {block.type === 'zone'
                          ? <ZoneHeader loc={block.loc} />
                          : block.type === 'plan'
                          ? <PlanBlock loc={block.loc} annotScale={annotScale} onAnnotScaleChange={onAnnotScaleChange} planLibrary={projet.planLibrary} cutMode={cutMode} pageBreaks={pageBreaks} onCut={handleCut} vpNumByPath={vpNumByPath} onEditPlan={onEditPlan} plansSubset={block.plansSubset ?? null} topBreakId={block.topBreakId ?? null} onOrient={handlePlanOrient}/>
                          : <ItemBlock item={block.item} ppl={ppl} mode={block.mode ?? 'full'}
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
                              onAnnotatePhoto={onAnnotatePhoto}
                              onPhotoCropChange={onUpdateItem ? (photo, cx, cy, cz, orient) => {
                                if (!photo) return;
                                // Persistance durable par id de ligne photo (survit au reload
                                // indépendamment de la chaîne cache/fusion/hydratation).
                                if (photo._id) setPhotoPref(photo._id, { cropX: cx, cropY: cy, cropZoom: cz, orient });
                                onUpdateItem(block.locId, block.item.id, {
                                  photos: (block.item.photos || []).map(ph => ph === photo ? { ...ph, cropX: cx, cropY: cy, cropZoom: cz, orient } : ph),
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
