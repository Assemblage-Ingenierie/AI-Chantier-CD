// Aperçu du rapport — blocs de contenu : observation (texte + photos), plans, icônes.
// Extrait tel quel de RapportPreview.jsx (découpage du 02/11/2026, aucun changement de logique).
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DA, URGENCE, SUIVI } from '../../../lib/constants.js';
import { renderMarkup } from '../../../lib/markup.jsx';
import { getAllSymbols, drawAnnotationPaths, drawVP, scalePaths, planAnnotScales } from '../Annotator.jsx';
import { Ic } from '../../ui/Icons.jsx';
import { dedupPlanPaths, photoVpKey } from '../../../lib/vpNumbering.js';
import { fetchPlanData, fetchPlanHdDataUrl } from '../../../lib/storage.js';
import ObsDatesChip from '../../ui/ObsDatesChip.jsx';
import { obsDatesInfo, zoneDatesInfo } from '../../../lib/obsDates.js';
import { reportCrop } from '../../../lib/photoFrame.js';
import { PLAN_PORTRAIT_MAXH, VXX_DEBUG, splitTextSegs } from './layout.js';
import { ParaCutZone, PlanCutBar, PlanPageButton } from './controls.jsx';

export function makeIconDataUrl(drawFn) {
  const cv = document.createElement('canvas');
  cv.width = 80; cv.height = 80;
  const ctx = cv.getContext('2d');
  try { drawFn(ctx); } catch {}
  return cv.toDataURL();
}

export function SymbolIcon({ sym, size = 14 }) {
  const src = useMemo(() => makeIconDataUrl(ctx => sym.draw(ctx, 40, 28, 2, DA.red)), [sym]);
  return <img src={src} alt="" style={{ display:'block', flexShrink:0, width:size, height:size }}/>;
}

export function ViewpointIcon({ size = 24 }) {
  const src = useMemo(() => makeIconDataUrl(ctx => drawVP(ctx, { x: 38, y: 55, angle: -Math.PI / 2, label: 'V1', size: 1, color: DA.red })), []);
  return <img src={src} alt="" style={{ display:'block', flexShrink:0, width:size, height:size }}/>;
}

export function ZoneHeader({ loc, level = 'zone', parentNom = '', visitDate = null }) {
  // Même disposition que l'écran Visite (choix Thomas) : toutes les zones au MÊME niveau, une
  // zone rangée dans un groupe affiche simplement le nom du groupe devant (« R+4 › M. ALBERT
  // THOMAS »). Zone normale et groupe : titre inchangé.
  return (
    <div style={{ borderBottom:`2px solid ${DA.red}`, paddingBottom:4, marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
      <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:700, color:'#000', textTransform:'uppercase', letterSpacing:'0.08em' }}>
        {level === 'sub' && parentNom && <span style={{ color:DA.red }}>{parentNom} › </span>}
        {loc.nom}
      </span>
      {/* Dates de suivi de la zone (bouton calendrier du titre de zone) — calées à droite. */}
      {(() => { const zi = zoneDatesInfo(loc, visitDate); return zi ? <span style={{ marginLeft:'auto' }}><ObsDatesChip info={zi} fontSize={9}/></span> : null; })()}
    </div>
  );
}

// Facteur d'échelle des annotations PHOTO dans le rapport, par-dessus l'échelle largeur/1400.
// = 1.0 → le rapport rend les annotations EXACTEMENT à la taille de l'éditeur (même formule,
// même curseur « Texte »/« Symboles » via les mêmes clés localStorage) : taille identique entre
// l'éditeur et le rapport. Pour des annotations plus grosses, monter le curseur « Texte » dans
// l'éditeur → ça agrandit l'éditeur ET le rapport ensemble, sans jamais les désynchroniser.
export const REPORT_ANNOT_BOOST = 1.0;

// Image d'une cellule photo du rapport avec REPLI DÉTERMINISTE de source.
// `sources` = liste ordonnée d'URL candidates (ex : [ph.data brut, ph.annotated cuit]). Si la
// première échoue au chargement (URL signée expirée/absente, base64 stripé du cache offline…),
// on passe à la suivante — chacune essayée UNE fois, via l'état React (pas de manip impérative
// de .src qui était boguée : le repli ne s'appliquait jamais → photo BLANCHE dans l'aperçu,
// retour Thomas « TJ PAS BON »). Garantit qu'on affiche toujours une image tant qu'UNE source
// est valide.
// `overlay` (canvas d'annotations transparent) n'est rendu QUE tant que la source affichée est
// `overlaySrc` (le brut) : si on retombe sur `ph.annotated` (composite qui contient DÉJÀ les
// annotations cuites), on masque l'overlay pour ne pas DOUBLER les annotations.
export function ReportPhotoImg({ sources, style, overlay = null, overlaySrc = null }) {
  const list = (sources || []).filter((s, i, a) => s && a.indexOf(s) === i);
  const key = list.join('|');
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => { setIdx(0); }, [key]);
  const src = list[Math.min(idx, list.length - 1)] || '';
  return (
    <>
      <img src={src} alt=""
        onError={() => setIdx(i => (i < list.length - 1 ? i + 1 : i))}
        style={style}/>
      {overlay && src === overlaySrc && overlay}
    </>
  );
}

export function PhotoAnnotCanvas({ photo, cropX = 50, cropY = 50, cropZoom = 1, containerAR = 4 / 3, photoScale = { text: 1, shape: 1, symbol: 1 } }) {
  const psText  = photoScale?.text   ?? 1;
  const psSym   = photoScale?.symbol ?? 1;
  const psShape = photoScale?.shape  ?? 1;
  const cvRef = useRef();
  const [inferredW, setInferredW] = React.useState(null);
  const [inferredH, setInferredH] = React.useState(null);
  const [, setCssW] = React.useState(null);

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
// Logique partagée avec l'annotateur (zone grisée « hors cadre ») : lib/photoFrame.js.
export function effectiveCrop(photo) {
  return reportCrop(photo);
}

export function PhotoCropEditor({ photo, initialX = 50, initialY = 50, initialZ = 1, onSave, onCancel }) {
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
  // « Image entière » : toute la photo dans le cadre du rapport (bandes blanches), sans recadrage.
  const [fit, setFit] = React.useState(!!photo.cropFit);
  const FRAME_RATIO = orient === 'portrait' ? 3 / 4 : 4 / 3;
  const containerH = containerW / photoRatio;

  // Base frame dimensions at zoom=1
  const isPortrait = photoRatio <= FRAME_RATIO;
  const baseFrameW = isPortrait ? containerW : containerH * FRAME_RATIO;
  const baseFrameH = isPortrait ? containerW / FRAME_RATIO : containerH;
  // Frame at current zoom (image entière : le cadre = toute la photo)
  const frameW = fit ? containerW : baseFrameW / pz;
  const frameH = fit ? containerH : baseFrameH / pz;
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
    if (!el || fit) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* iOS Safari peut lever ici — sans effet sur le drag */ }
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
        {/* Image entière (demande Thomas : « mettre toute l'image sans changer le format ») */}
        <button onClick={() => setFit(f => !f)}
          title="Afficher toute la photo dans le cadre du rapport (bandes blanches si besoin)"
          style={{ padding:'8px 0', borderRadius:9, cursor:'pointer', fontSize:12, fontWeight:700,
            border:`1.5px solid ${fit ? DA.red : '#444'}`, background: fit ? DA.red : 'transparent', color: fit ? 'white' : '#ccc' }}>
          {fit ? '✓ Image entière' : '⤢ Image entière (sans recadrer)'}
        </button>
        {/* Full original photo with draggable crop frame */}
        <div ref={containerRef}
          style={{ position:'relative', width:'100%', height:containerH, flexShrink:0,
            borderRadius:8, cursor: fit ? 'default' : 'grab', touchAction:'none', background:'#000', overflow:'hidden' }}
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
          <button disabled={fit} onClick={() => setPz(z => Math.max(1, Math.round((z - 0.1) * 10) / 10))}
            style={{ opacity: fit ? 0.35 : 1, width:38, height:38, borderRadius:8, background:'#333', color:'white',
              border:'none', fontSize:22, lineHeight:1, cursor:'pointer', fontWeight:300 }}>−</button>
          <span style={{ color:'#ccc', fontSize:12, fontWeight:600, minWidth:52, textAlign:'center' }}>
            zoom ×{pz.toFixed(1)}
          </span>
          <button disabled={fit} onClick={() => setPz(z => Math.min(4, Math.round((z + 0.1) * 10) / 10))}
            style={{ opacity: fit ? 0.35 : 1, width:38, height:38, borderRadius:8, background:'#333', color:'white',
              border:'none', fontSize:22, lineHeight:1, cursor:'pointer', fontWeight:300 }}>+</button>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel}
            style={{ flex:1, padding:10, borderRadius:8, background:'#2c2c2e', color:'#aaa',
              border:'none', cursor:'pointer', fontSize:12, fontWeight:600 }}>Annuler</button>
          <button onClick={() => onSave(Math.round(px), Math.round(py), pz, orient, fit)}
            style={{ flex:2, padding:10, borderRadius:8, background:DA.red, color:'white',
              border:'none', cursor:'pointer', fontSize:13, fontWeight:700 }}>Valider</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ItemBlock({ item, ppl, onEdit, visitDate = null, locId = null, vpPhotoOffset = 0, vxxPhotoMap = null, mode = 'full', textContent, photoRow = null, photoCols = null, isLastPhotoRow = true, cutMode = false, onParaCut, onPhotoCropChange = null, onAnnotatePhoto = null, photoAnnotScales = { text: 1, shape: 1, symbol: 1 }, photoFit = null }) {
  const allPhotos = (item.photos || []).filter(p => p.data || p.annotated);
  const urg    = URGENCE[item.urgence] || URGENCE.basse;
  const suivi  = item.suivi && item.suivi !== 'rien' ? SUIVI[item.suivi] : null;
  const datesInfo = obsDatesInfo(item, visitDate); // dates de suivi (bouton calendrier), sinon null
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
    const arNum = (() => { const [a, b] = String(ar || '4 / 3').split('/').map(Number); return a > 0 && b > 0 ? a / b : 4 / 3; })();
    // Source de la cellule photo — on privilégie le COMPOSITE CUIT (ph.annotated), EXACTEMENT
    // comme la grille de l'app (`ph.annotated || ph.data`) qui, elle, s'affiche toujours.
    // Historiquement le rapport préférait la photo BRUTE (ph.data) + un overlay live re-dessiné
    // pour appliquer REPORT_ANNOT_BOOST — mais ce boost vaut 1.0 (annotations à la taille de
    // l'éditeur), donc l'overlay produit EXACTEMENT le même rendu que le composite cuit. Or si
    // l'URL signée de ph.data était morte (expirée/absente) alors que celle du composite était
    // valide, on obtenait une photo BLANCHE avec l'annotation flottante (retour Thomas, aperçu
    // rapport KO alors que l'app était OK). On aligne donc le rapport sur l'app : composite cuit
    // d'abord, et overlay re-dessiné UNIQUEMENT si aucun composite n'existe (annoté sur un autre
    // appareil sans upload du composite) → les annotations ne sont jamais perdues.
    const useAnnotOverlay = hasAnnotations && !!ph.data && !ph.annotated;
    const imgSrc = ph.annotated || ph.data;
    // « Image entière » (outil Cadrer) : toute la photo dans le même cadre, bandes blanches si
    // besoin. (Repli recadré si l'annotation n'existe qu'en calque re-dessiné, calé sur « cover ».)
    const fitWhole = !!ph.cropFit && !useAnnotOverlay;
    return (
      <div key={absIdx} style={{ ...(ar ? { position:'relative', aspectRatio:ar } : { position:'absolute', inset:0 }), overflow:'hidden', borderRadius:2, ...(fitWhole ? { background:'#fff' } : {}) }}>
        {/* Image annotée cuite (ph.annotated) en priorité : c'est exactement ce que
            l'utilisateur a annoté (texte/symboles à la bonne taille). Le recadrage
            s'applique en CSS de façon identique. Repli sur re-rendu uniquement si
            aucune image cuite n'existe. */}
        <ReportPhotoImg
          sources={[imgSrc, ph.annotated, ph.data]}
          overlaySrc={useAnnotOverlay ? imgSrc : null}
          overlay={useAnnotOverlay
            ? <PhotoAnnotCanvas photo={ph} cropX={cx} cropY={cy} cropZoom={cz} containerAR={arNum} photoScale={photoAnnotScales}/>
            : null}
          style={fitWhole
            ? { position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'contain', objectPosition:'50% 50%', display:'block', pointerEvents:'none' }
            : { position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover',
              objectPosition:`${cx}% ${cy}%`, display:'block', pointerEvents:'none',
              transform: cz !== 1 ? `scale(${cz})` : undefined, transformOrigin:`${cx}% ${cy}%` }}/>
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
            onSave={(nx, ny, nz, norient, nfit) => { onPhotoCropChange(ph, nx, ny, nz, norient, nfit); setCropEditingPi(null); }}
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
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            {/* Titre long + dates : le titre passe à la ligne au lieu d'être coupé (…). */}
            <span style={{ fontSize:10, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:'#000', flex:1, minWidth:0, ...(datesInfo ? {} : { overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }) }}>{item.titre}</span>
            {datesInfo && <ObsDatesChip info={datesInfo} fontSize={10}/>}
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
        // Ajustement de page (voir pageFit dans RapportPreview) : ar < 1 → cadre un peu plus
        // PANORAMIQUE (pleine largeur, quelques % rognés en haut/bas) ; w < 1 → rangée réduite et
        // centrée (seulement si nécessaire, ex. photos annotées qu'on ne rogne jamais).
        const fitAr = photoFit?.ar ?? 1, fitW = photoFit?.w ?? 1;
        const fitBox = fitW < 1 ? { width:`${(fitW * 100).toFixed(2)}%`, margin:'0 auto' } : {};
        const LAND = fitAr < 1 ? `${(4 / 3 / fitAr).toFixed(4)} / 1` : '4 / 3';
        const PORT = fitAr < 1 ? `${(3 / 4 / fitAr).toFixed(4)} / 1` : '3 / 4';
        if (photoRow.kind === 'mosaic') {
          // Hauteur EXACTEMENT identique : la colonne paysages (2 cellules 4:3 + gap interne)
          // définit la hauteur de la rangée, et le portrait la remplit en absolu (inset:0) —
          // sans ça, le portrait à aspect figé restait plus court de la valeur du gap (3px).
          return (
            <div data-photogrid="1" style={{ padding:'4px 6px 6px' }}>
            <div style={{ display:'flex', gap:3, alignItems:'stretch', ...fitBox }}>
              <div style={{ flex:9, minWidth:0, position:'relative' }}>
                {renderPhotoCell(photoRow.portraitIdx, null)}
              </div>
              <div style={{ flex:8, minWidth:0, display:'flex', flexDirection:'column', gap:3 }}>
                {photoRow.stackIdxs.map(i => renderPhotoCell(i, LAND))}
                {/* 1 seul paysage : slot vide au même format 4:3 → le bas reste vide (choix
                    utilisateur) SANS écraser la hauteur du portrait. */}
                {photoRow.stackIdxs.length < 2 && <div style={{ aspectRatio:LAND }}/>}
              </div>
            </div>
            </div>
          );
        }
        const isPortraits = photoRow.kind === 'portraits';
        const colsN = isPortraits ? 2 : (photoCols ?? Math.min(ppl, 3));
        return (
          <div data-photogrid="1" style={{ padding:'4px 6px 6px' }}>
            <div style={{ display:'grid', gridTemplateColumns:`repeat(${colsN},1fr)`, gap:3, ...fitBox }}>
              {photoRow.idxs.map(i => renderPhotoCell(i, isPortraits ? PORT : LAND))}
            </div>
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

// Largeur naturelle d'une image (data URL ou URL signée) — sert à connaître la largeur de
// l'espace de coordonnées des annotations d'un plan (= largeur du planBg) pour les remettre à
// l'échelle du canvas de rendu. Renvoie null si indéterminable.
export function imgNaturalWidth(src) {
  return new Promise(res => {
    if (!src) { res(null); return; }
    const im = new window.Image();
    im.onload = () => res(im.naturalWidth || null);
    im.onerror = () => res(null);
    im.src = src;
  });
}

// Cache module de l'image de plan rendue (canvas HD → dataURL, coûteux). Corrige le retour
// Thomas : quand l'édition des coupes de page REMONTE le composant, il repartait de zéro
// (« Plan en cours de chargement… ») → le plan disparaissait puis réapparaissait (clignotement),
// et le rendu 4000px se refaisait à chaque coupe (lenteur, longue page blanche). En mémorisant
// l'image rendue, un remontage l'affiche INSTANTANÉMENT et le rendu coûteux n'est pas refait.
// Borné pour limiter la mémoire (dataURL de plans = lourds, surtout sur iOS).
export const _planImgCache = new Map();
export const _PLAN_IMG_CACHE_MAX = 30;

export function SinglePlanImage({ bg, planId = null, annotations, annotScale, alt, vpNumByPath = null, onOrient = null, fill = false }) {
  const exported = annotations?.exported;
  const paths    = annotations?.paths;
  const deferredAnnotScale = React.useDeferredValue(annotScale);
  // Clé identifiant le rendu visuel (plan + nb d'annotations + échelle + numérotation Vxx).
  const _planCacheKey = `${planId ?? 'bg'}|${paths?.length ?? 0}|${JSON.stringify(deferredAnnotScale)}|${vpNumByPath ? vpNumByPath.size : 0}`;
  const [renderedImg, setRenderedImg] = useState(() => _planImgCache.get(_planCacheKey) ?? null);
  const [fetchedBg, setFetchedBg] = useState(null);
  const [bgFetchDone, setBgFetchDone] = useState(false);
  // Met à jour l'état ET le cache (uniquement pour une vraie image).
  const commitImg = (v) => {
    setRenderedImg(v);
    if (v) {
      _planImgCache.set(_planCacheKey, v);
      if (_planImgCache.size > _PLAN_IMG_CACHE_MAX) _planImgCache.delete(_planImgCache.keys().next().value);
    }
  };
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
    if (!bgSrc) { commitImg(exported || null); return; }
    if (!paths?.length) { commitImg(bgSrc); return; }
    // Dédoublonne les annotations + numérote les viewpoints (1 seul Vxx par marqueur sur le plan).
    const drawPaths = dedupPlanPaths(paths, vpNumByPath);
    let cancelled = false;
    (async () => {
      // Rendu sur l'image HAUTE DÉFINITION du plan quand elle existe : le bg de la bibliothèque
      // est une vignette → marqueurs Vxx et texte FLOUS (surtout en plan portrait pleine page).
      // L'image HD donne un canvas à haute résolution → marqueurs nets (mêmes tailles, juste plus
      // nets car dessinés puis réduits). Repli sur la vignette si pas de HD. Memoïsé (_hdCache).
      // Les coords d'annotation sont stockées dans l'espace du planBg (bgSrc) → on mesure sa
      // largeur pour remettre les coords à l'échelle du canvas HD (sinon les Vxx se décalent
      // vers le coin haut-gauche). On n'active le HD que si cette largeur est connue.
      const bgW = await imgNaturalWidth(bgSrc);
      if (cancelled) return;
      let src = bgSrc, usedHd = false;
      if (planId && bgW) { try { const hd = await fetchPlanHdDataUrl(planId); if (hd) { src = hd; usedHd = true; } } catch { /* repli vignette */ } }
      if (cancelled) return;
      const el = new window.Image();
      el.onload = () => {
        if (cancelled) return;
        // Plafond de résolution RELEVÉ (retour Thomas : aperçu flou au zoom). L'image HD source
        // va jusqu'à 6500px → on en garde bien plus (4000px) pour un aperçu bien plus net au zoom.
        // Garde-fou aire canvas (iOS ~16 Mpx) pour ne pas planter sur iPhone.
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
        const MAX_AREA = isIOS ? 15_000_000 : 36_000_000;
        const MAXW = 4000;
        let sc = el.naturalWidth > MAXW ? MAXW / el.naturalWidth : 1;
        let cw = Math.max(1, Math.round(el.naturalWidth * sc));
        let ch = Math.max(1, Math.round(el.naturalHeight * sc));
        if (cw * ch > MAX_AREA) { const k = Math.sqrt(MAX_AREA / (cw * ch)); cw = Math.round(cw * k); ch = Math.round(ch * k); }
        const cv  = document.createElement('canvas');
        cv.width  = cw;
        cv.height = ch;
        const ctx = cv.getContext('2d');
        ctx.drawImage(el, 0, 0, cv.width, cv.height);
        // Échelles par type (texte/forme/symbole) réglées par l'utilisateur.
        const _o = deferredAnnotScale && typeof deferredAnnotScale === 'object';
        const textF  = _o ? (deferredAnnotScale.text   ?? 1) : (deferredAnnotScale ?? 1);
        const symF   = _o ? (deferredAnnotScale.symbol ?? 1) : (deferredAnnotScale ?? 1);
        const shapeF = _o ? (deferredAnnotScale.shape  ?? 1) : 1;
        // Espace de coords des annotations : largeur du HD-source (bgW) si on a swappé sur le HD,
        // sinon la largeur de l'image effectivement rendue (le bg). coordScale ramène ces coords
        // dans l'espace du canvas → marqueurs au bon endroit, quelle que soit la résolution.
        const pathsSpaceW = usedHd ? bgW : el.naturalWidth;
        const coordScale = pathsSpaceW ? cv.width / pathsSpaceW : 1;
        // Échelle UNIQUE des plans (planAnnotScales) : identique à l'annotateur et à la vue Visite
        // → ce qui est imprimé est ce qu'on a vu en annotant (retour Thomas 15/10).
        const _pl = planAnnotScales(cv.width, { text: textF, symbol: symF, shape: shapeF });
        drawAnnotationPaths(ctx, scalePaths(drawPaths, coordScale, coordScale), _pl.sizes, _pl.stroke);
        // JPEG 0.95 : qualité supérieure pour ne pas flouter le texte fin des marqueurs (le plan
        // reste opaque → pas de transparence perdue), data-URL toujours raisonnable.
        commitImg(cv.toDataURL('image/jpeg', 0.95));
      };
      el.onerror = () => { if (!cancelled) commitImg(exported || bgSrc); };
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
  // fill : l'image remplit son conteneur (page « plan en grand » paysage), sans cadre ni plafond.
  if (fill) return (
    <img src={renderedImg} alt={alt || 'Plan'} data-role="plan"
      style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', display:'block' }}/>
  );
  const maxH = isPortrait ? PLAN_PORTRAIT_MAXH : 340;
  return (
    <div style={{ borderTop:`1px solid ${DA.border}`, background:'#f9f9f9', maxHeight:maxH, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <img src={renderedImg} alt={alt || 'Plan'} data-role="plan"
        style={{ width:'100%', maxHeight:maxH, objectFit:'contain', display:'block' }}/>
    </div>
  );
}

// Rendu d'UN plan propre à une observation dans l'aperçu, calqué sur le PDF (section « Plans
// additionnels annotés » de generateRapport, juste après les photos de l'observation). Réutilise
// SinglePlanImage (fond + annotations + numérotation Vxx globale). Titre = nom du plan si connu.
export function ItemPlanBlock({ plan, planNom = null, annotScale = 1, vpNumByPath = null, onFullPage = null }) {
  if (!plan) return null;
  return (
    <div style={{ marginBottom:5, border:`1px solid ${DA.border}`, borderRadius:4, overflow:'hidden' }}>
      {planNom && (
        <div style={{ background:'#F7F7F7', borderBottom:`2px solid ${DA.red}`, padding:'5px 9px' }}>
          <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:700, color:'#000', textTransform:'uppercase', letterSpacing:'0.06em' }}>{planNom}</span>
        </div>
      )}
      <div style={{ position:'relative' }}>
        <PlanPageButton onClick={onFullPage}/>
        <SinglePlanImage bg={plan.bg} planId={plan.planId} annotations={plan.annotations}
          annotScale={annotScale} alt={planNom || 'Plan observation'} vpNumByPath={vpNumByPath}/>
      </div>
    </div>
  );
}

export function PlanBlock({ loc, annotScale = 1, planLibrary, cutMode = false, pageBreaks = [], onCut, plansSubset = null, topBreakId = null, vpNumByPath = null, hideLegend = false, onEditPlan = null, onOrient = null, onFullPage = null }) {
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
            <div style={{ position:'relative' }}>
              <PlanPageButton onClick={onFullPage ? () => onFullPage(p.epIdx == null ? `z:${loc.id}` : `z:${loc.id}:${p.epIdx}`) : null}/>
              <SinglePlanImage bg={p.bg} planId={p.planId} annotations={p.annotations} annotScale={annotScale} alt={`Plan ${loc.nom} ${i + 1}`} vpNumByPath={vpNumByPath} onOrient={onOrient}/>
            </div>
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
