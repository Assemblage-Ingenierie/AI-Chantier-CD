import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback, useImperativeHandle } from 'react';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { renderMarkup } from '../../lib/markup.jsx';
import { getAllSymbols, drawAnnotationPaths, drawVP } from './Annotator.jsx';
import { Ic } from '../ui/Icons.jsx';
import ItemModal from './ItemModal.jsx';
import { useBrandingLogo } from '../../lib/branding.js';
import { callAIProxy } from '../../lib/aiProxy.js';

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
    // Pour les blocs-rangée (photoCount défini) on calcule exactement 1 rangée
    const nPh = block.photoCount ?? Math.min((item.photos || []).filter(p => p.data).length, 6);
    if (nPh > 0) {
      const cols  = Math.min(ppl, 3);
      const cellW = (CW - 12 - (cols - 1) * 3) / cols;
      h += Math.ceil(nPh / cols) * (cellW * 0.75) + 14;
    }
  }
  return Math.round(h * 1.1) + 5;
}

// Aplatit toutes les localisations en liste ordonnée de blocs (sans pagination).
// • Les commentaires longs sont découpés en blocs-paragraphes (mode:'text' / 'cont')
// • Les photos sont découpées en rangées individuelles (mode:'photos', photoStart/photoCount)
//   pour qu'elles s'insèrent naturellement dans le flux sans créer de blanc en fin de page
function flattenBlocks(locs, plansEnFin, ppl = 2, paraBreaks = new Set()) {
  const blocks = [];
  const cols   = Math.min(ppl, 3);
  for (const loc of locs) {
    const items = (loc.items || []).filter(i => i.titre);
    if (!items.length) continue;
    blocks.push({ type:'zone', id:loc.id, loc });
    const hasVP = (loc.planAnnotations?.paths || []).some(p => p.type === 'viewpoint');
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
              textContent:text, vpPhotoOffset:photoOffset, hasViewpoints:hasVP });
          } else if (idx === 0 && !photos.length) {
            blocks.push({ type:'item', id, item, locId:loc.id, mode:'full', vpPhotoOffset:photoOffset, hasViewpoints:hasVP });
          }
        });
      }

      // Photos : une rangée (cols photos) = un bloc → s'insèrent ligne par ligne dans le flux
      if (photos.length > 0) {
        for (let s = 0; s < photos.length; s += cols) {
          const count = Math.min(cols, photos.length - s);
          blocks.push({
            type:'item',
            id: s === 0 ? `${item.id}_ph` : `${item.id}_ph${s}`,
            item, locId:loc.id, mode:'photos',
            photoStart: s, photoCount: count,
            vpPhotoOffset: photoOffset + s, hasViewpoints:hasVP,
          });
        }
      }

      photoOffset += photos.length;
    }
    if (!plansEnFin) {
      const hasPlan = loc.planAnnotations?.exported || loc.planBg;
      if (hasPlan) blocks.push({ type:'plan', id:`plan-${loc.id}`, loc });
    }
  }
  return blocks;
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

function PhotoAnnotCanvas({ photo, annotScale, ppl = 2 }) {
  const cvRef = useRef();
  const deferredScale = React.useDeferredValue(annotScale);
  const [inferredW, setInferredW] = React.useState(null);
  const [inferredH, setInferredH] = React.useState(null);

  useEffect(() => {
    if (photo.annotW || !photo.data || !photo.annotations?.length) return;
    const img = new window.Image();
    img.onload = () => { setInferredW(img.naturalWidth); setInferredH(img.naturalHeight); };
    img.src = photo.data;
  }, [photo.data, photo.annotW, photo.annotations]);

  const effectiveW = photo.annotW || inferredW;
  const effectiveH = photo.annotH || inferredH || (effectiveW ? Math.round(effectiveW * 0.75) : null);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv || !photo.annotations?.length || !effectiveW) return;
    cv.width  = effectiveW;
    cv.height = effectiveH || Math.round(effectiveW * 0.75);
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const sizeScale = (effectiveW * ppl / 1400) * deferredScale;
    drawAnnotationPaths(ctx, photo.annotations, sizeScale);
  }, [photo.annotations, effectiveW, effectiveH, deferredScale, ppl]);

  if (!photo.annotations?.length || !effectiveW) return null;
  return <canvas ref={cvRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }}/>;
}

function ItemBlock({ item, ppl, onEdit, vpPhotoOffset = 0, hasViewpoints = false, mode = 'full', textContent, photoStart, photoCount, cutMode = false, onParaCut, annotScale = 1 }) {
  const allPhotos = (item.photos || []).filter(p => p.data);
  // Pour un bloc-rangée, on affiche seulement la tranche photoStart..photoStart+photoCount
  const photos = (photoStart != null)
    ? allPhotos.slice(photoStart, photoStart + (photoCount ?? ppl))
    : allPhotos;
  const urg    = URGENCE[item.urgence] || URGENCE.basse;
  const suivi  = item.suivi && item.suivi !== 'rien' ? SUIVI[item.suivi] : null;
  const commentToShow = textContent ?? item.commentaire;
  const showHeader   = mode !== 'photos' && mode !== 'cont';
  // Les rangées de photos après la première (photoStart > 0) n'affichent pas de bandeau répété

  const showComment  = mode !== 'photos' && commentToShow;
  const showPhotos   = mode !== 'text' && mode !== 'cont' && photos.length > 0;
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
            return ps.map((para, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ParaCutZone paraId={`${item.id}_p${i - 1}`} onCut={onParaCut}/>}
                {renderMarkup(para)}
              </React.Fragment>
            ));
          })()}
          {(!cutMode || !onParaCut) && renderMarkup(commentToShow)}
        </div>
      )}
      {/* Photos */}
      {showPhotos && (
        <div style={{ padding:'4px 6px 6px', display:'grid', gridTemplateColumns:`repeat(${Math.min(ppl,3)},1fr)`, gap:3 }}>
          {photos.map((ph, pi) => {
            const hasAnnotations = ph.annotations?.length > 0;
            // ph.annotated = image composée (photo + annotations fusionnées) — utilisée si disponible
            // car les canvas ne s'impriment pas. Fallback canvas uniquement si pas encore exporté.
            const useComposed = hasAnnotations && !!ph.annotated;
            return (
              <div key={pi} style={{ position:'relative', aspectRatio:'4/3', overflow:'hidden', borderRadius:2 }}>
                <img src={useComposed ? ph.annotated : (ph.annotated || ph.data)} alt=""
                  style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
                {hasAnnotations && !useComposed && <PhotoAnnotCanvas photo={ph} annotScale={annotScale} ppl={ppl}/>}
                {hasViewpoints && (
                  <div style={{ position:'absolute', top:2, left:2, background:'rgba(255,255,255,0.92)', color:'#333', fontSize:6, fontWeight:800, borderRadius:2, width:13, height:13, display:'flex', alignItems:'center', justifyContent:'center', border:'1px solid rgba(0,0,0,0.15)', pointerEvents:'none', lineHeight:1, flexShrink:0 }}>
                    V{vpPhotoOffset + pi + 1}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Légende annotations photos — affichée une seule fois après la dernière rangée */}
      {showPhotos && (() => {
        const isLastRow = photoStart == null || (photoStart + photos.length) >= allPhotos.length;
        if (!isLastRow) return null;
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

function PlanBlock({ loc, annotScale = 1, onAnnotScaleChange, planLibrary }) {
  const exported = loc.planAnnotations?.exported;
  const paths    = loc.planAnnotations?.paths;
  // planBg peut être null si chargé depuis DB — fallback sur planLibrary via planId
  const planBg   = loc.planBg || (loc.planId && planLibrary?.find(p => p.id === loc.planId)?.bg) || null;
  const [renderedImg, setRenderedImg] = useState(null);
  const deferredAnnotScale = React.useDeferredValue(annotScale);

  useEffect(() => {
    if (!planBg) { setRenderedImg(exported || null); return; }
    if (!paths?.length) { setRenderedImg(planBg); return; }
    const el = new window.Image();
    el.onload = () => {
      const cv  = document.createElement('canvas');
      cv.width  = el.naturalWidth;
      cv.height = el.naturalHeight;
      const ctx = cv.getContext('2d');
      ctx.drawImage(el, 0, 0, cv.width, cv.height);
      const sizeScale = (cv.width / 1400) * deferredAnnotScale;
      drawAnnotationPaths(ctx, paths, sizeScale);
      setRenderedImg(cv.toDataURL('image/png'));
    };
    el.onerror = () => setRenderedImg(exported || planBg);
    el.src = planBg;
  }, [exported, paths, planBg, deferredAnnotScale]);

  // Légende : symboles + viewpoints — taille fixe indépendante du slider
  const usedIds       = new Set((paths || []).filter(p => p.type === 'symbol').map(p => p.symbolId));
  const legendSy      = getAllSymbols().filter(s => usedIds.has(s.id));
  const hasViewpoints = (paths || []).some(p => p.type === 'viewpoint');
  const showLegend    = legendSy.length > 0 || hasViewpoints;

  if (!renderedImg && !planBg) return (
    <div style={{ marginBottom:5, border:`1px solid ${DA.border}`, borderRadius:4, overflow:'hidden', minHeight:60, background:'#f9f9f9', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <span style={{ fontSize:10, color:'#aaa' }}>Plan en cours de chargement…</span>
    </div>
  );
  return (
    <div style={{ marginBottom:5, border:`1px solid ${DA.border}`, borderRadius:4, overflow:'hidden' }}>
      <div style={{ background:'#F7F7F7', borderBottom:`2px solid ${DA.red}`, padding:'5px 9px', display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:700, color:'#000', textTransform:'uppercase', letterSpacing:'0.06em' }}>
          Plan — {loc.nom}
        </span>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6 }}>
          {paths?.length > 0 && (
            <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", color:'#4D4D4D' }}>
              {paths.length} annotation{paths.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
      {renderedImg && (
        <img src={renderedImg} alt={`Plan ${loc.nom}`}
          style={{ width:'100%', display:'block', objectFit:'contain' }}/>
      )}
      {showLegend && (
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

// ── Page de garde unifiée (photo/titre + présentation + intervenants) ──────────────────────
function CoverPage({ projet, pageNum, totalPages }) {
  const logoUrl = useBrandingLogo();
  const sigleUrl = useBrandingLogo('logo/sigle_Ai_rouge.svg');
  const participants = projet.participants || [];
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

// ── Pied de page commun (toutes les pages) ────────────────────────────────────────────
function PageFtr({ pageNum, totalPages }) {
  return (
    <div style={{ height:FTR, background:'white', borderTop:`1px solid #DFE4E8`, flexShrink:0, display:'flex', alignItems:'center', padding:`0 ${MX}px`, gap:6 }}>
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:1.5, minWidth:0 }}>
        <span style={{ fontSize:5, fontFamily:"'Open Sans', sans-serif", color:'#c0c4c8', lineHeight:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          Assemblage Ingénierie · S.A.S. capital social 1 000€ · 137 rue d'Aboukir, 75002 Paris · contact@assemblage.net · www.assemblage.net · +33 7 65 62 30 87
        </span>
        <span style={{ fontSize:5, fontFamily:"'Open Sans', sans-serif", color:'#c0c4c8', lineHeight:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          NAF 7112B · R.C.S. Paris 822 130 100 · Siret 822 130 100 0032 · n°TVA FR 24 822 130 100
        </span>
      </div>
      <span style={{ fontSize:6, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', flexShrink:0 }}>{pageNum} / {totalPages}</span>
    </div>
  );
}


// ── Page conclusion ──────────────────────────────────────────────────────────────────────────
function ConclusionPage({ conclusion, conclusionAlign = 'left', projet, pageNum, totalPages, onUpdateConclusion, onUpdateConclusionAlign }) {
  const dateStr = projet.dateVisite ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR') : null;
  const isEditable = !!onUpdateConclusion;
  const ALIGNS = [
    { k:'left', sym:'←' }, { k:'center', sym:'↔' }, { k:'right', sym:'→' }, { k:'justify', sym:'☰' },
  ];
  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, fontFamily:"'Open Sans', sans-serif" }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB}px` }}>
        <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Conclusion</span>
          {isEditable && onUpdateConclusionAlign && (
            <div data-print="hide" style={{ display:'flex', gap:3, marginLeft:'auto' }}>
              {ALIGNS.map(a => (
                <button key={a.k} onClick={() => onUpdateConclusionAlign(a.k)}
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
        {isEditable ? (
          <textarea
            value={conclusion || ''}
            onChange={e => onUpdateConclusion(e.target.value)}
            placeholder="Saisissez votre conclusion…"
            rows={8}
            style={{ width:'100%', fontSize:10, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#000', lineHeight:1.5, border:`1px solid #DFE4E8`, borderRadius:4, padding:'10px 12px', background:'#F2F2F2', boxSizing:'border-box', resize:'vertical', outline:'none', textAlign: conclusionAlign || 'left' }}
          />
        ) : (
          <div style={{ fontSize:10, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#000', lineHeight:1.5, whiteSpace:'pre-wrap', border:`1px solid #DFE4E8`, borderRadius:4, padding:'10px 12px', background:'#F2F2F2', minHeight:60, textAlign: conclusionAlign }}>
            {conclusion ? renderMarkup(conclusion) : <span style={{ color:'#4D4D4D', fontStyle:'italic' }}>Aucune conclusion saisie.</span>}
          </div>
        )}
      </div>
      <PageFtr pageNum={pageNum} totalPages={totalPages}/>
    </div>
  );
}

// ── Tableau récapitulatif ─────────────────────────────────────────────────────────────────────────
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
  const genSolution = async (row) => {
    if (!onUpdateRecap) return;
    setLoadingAI(row.itemId); setAiErr(null);
    try {
      const ctx = row.commentaire
        ? `\nContexte de l'observation : ${row.commentaire.replace(/<[^>]+>/g,'').replace(/\*{1,3}/g,'').slice(0, 300)}`
        : '';
      const prompt = `Désordre en bâtiment — Zone : ${row.locNom}, Désordre : ${row.titre}.${ctx}\n\nDonne uniquement la solution technique en 6 mots maximum, en français, sans markdown, sans ponctuation finale.`;
      const d = await callAIProxy({ feature: 'solution_recap', model: 'claude-haiku-4-5-20251001', max_tokens: 60, messages: [{ role:'user', content: prompt }] });
      const sol = d.content?.[0]?.text?.trim().replace(/^["']|["']$/g,'').replace(/\.$/, '');
      if (sol) onUpdateRecap(row.itemId, 'solution', sol);
    } catch(e) { setAiErr(e.message); }
    setLoadingAI(null);
  };

  const dateStr = projet.dateVisite ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR') : null;
  const isEditable = !!onUpdateRecap;

  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, fontFamily:"'Open Sans', sans-serif" }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB}px` }}>
        <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Tableau récapitulatif</span>
          <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D' }}>{rows.length} point{rows.length !== 1 ? 's' : ''} à traiter</span>
        </div>
        {aiErr && <div data-print="hide" style={{ fontSize:8, color:DA.red, marginBottom:6, padding:'3px 6px', background:'#FFF0F0', borderRadius:4 }}>{aiErr}</div>}
        {/* En-tête */}
        <div style={{ display:'grid', gridTemplateColumns: isEditable ? '5px 1fr 1.2fr 1.8fr 60px 24px' : '5px 70px 1fr 1.5fr 65px', background:'#F2F2F2', borderTop:`1px solid #B0B8C1`, borderBottom:`1px solid #B0B8C1`, padding:'4px 8px', gap:6 }}>
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
            <div key={row.itemId ?? i} style={{ display:'grid', gridTemplateColumns: isEditable ? '5px 1fr 1.2fr 1.8fr 60px 24px' : '5px 70px 1fr 1.5fr 65px', gap:6, padding:'4px 8px', borderBottom:`1px solid #DFE4E8`, background: i % 2 === 0 ? '#F9F9F9' : 'white', alignItems:'start' }}>
              <div style={{ background:u.dot, borderRadius:2, minHeight:14, alignSelf:'stretch' }}/>
              {isEditable ? (
                <input value={row.locNom} onChange={e => onUpdateRecap(row.itemId, 'zone', e.target.value)}
                  style={{ fontSize:7, color:DA.gray, lineHeight:1.4, border:'none', background:'transparent', outline:'none', fontFamily:'inherit', width:'100%', padding:0 }}/>
              ) : (
                <div style={{ fontSize:7, color:DA.gray, lineHeight:1.4 }}>{row.locNom || '—'}</div>
              )}
              {isEditable ? (
                <textarea value={row.titre} onChange={e => onUpdateRecap(row.itemId, 'titre', e.target.value)}
                  rows={Math.max(1, Math.ceil((row.titre||'').length / 22))}
                  style={{ fontSize:8, fontWeight:700, color:DA.black, lineHeight:1.3, border:'none', background:'transparent', outline:'none', fontFamily:'inherit', width:'100%', padding:0, resize:'none', overflow:'hidden' }}/>
              ) : (
                <div style={{ fontSize:8, fontWeight:700, color:DA.black, lineHeight:1.3 }}>{row.titre || '—'}</div>
              )}
              {isEditable ? (
                <div style={{ display:'flex', gap:3, alignItems:'flex-start' }}>
                  <textarea value={row.solution || ''} onChange={e => onUpdateRecap(row.itemId, 'solution', e.target.value)}
                    rows={Math.max(2, Math.ceil((row.solution||'').length / 28))}
                    placeholder="Solution…"
                    style={{ fontSize:7, color:DA.gray, lineHeight:1.4, border:'none', background:'transparent', outline:'none', fontFamily:'inherit', width:'100%', padding:0, resize:'none', overflow:'hidden' }}/>
                  <button data-print="hide" onClick={() => genSolution(row)} disabled={loadingAI === row.itemId} title="Générer avec l'IA"
                    style={{ background:'none', border:`1px solid ${DA.border}`, borderRadius:3, padding:'1px 4px', cursor:'pointer', fontSize:9, color:DA.grayL, flexShrink:0, lineHeight:1.2 }}>
                    {loadingAI === row.itemId ? '…' : '⚡'}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize:7, color:DA.gray, lineHeight:1.4, wordBreak:'break-word' }}>{row.solution || '—'}</div>
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
                <button data-print="hide" onClick={() => onDeleteRecap(row.itemId, row.isCustom)}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'#EF4444', fontSize:13, lineHeight:1, padding:0, alignSelf:'start' }}>×</button>
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
      <PageFtr pageNum={pageNum} totalPages={totalPages}/>
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
const RapportPreview = React.forwardRef(function RapportPreview({ projet, localisations, photosParLigne, pageBreaks, onTogglePageBreak, plansEnFin, includeTableauRecap = true, tableauRecap = [], includeConclusion = false, conclusion = '', conclusionAlign = 'left', annotScale = 1, onAnnotScaleChange, onUpdateItem, onTogglePanel, panelOpen, panelW = 0, cutMode = false, onCutModeChange, onExportPdf, onExportPhotos, totalPhotos = 0, zipping = false, recapRows = [], onUpdateRecap, onDeleteRecap, onAddCustomRow, onUpdateConclusion, onUpdateConclusionAlign }, ref) {
  const ppl  = photosParLigne ?? 2;
  const locs = useMemo(() => localisations.filter(l => (l.items || []).some(i => i.titre)), [localisations]);

  // breaks effectifs = breaks manuels + breaks dérivés des découpages de paragraphes
  const paraBreaks = useMemo(() =>
    new Set((pageBreaks || []).filter(id => /_p\d+$/.test(id))),
  [pageBreaks]);
  const breaks = useMemo(() => {
    const s = new Set(pageBreaks || []);
    for (const id of (pageBreaks || [])) {
      if (/_p\d+$/.test(id)) {
        const base = id.replace(/_p\d+$/, '');
        for (let i = 1; i <= 9; i++) s.add(`${base}_pms${i}`);
      }
    }
    return s;
  }, [pageBreaks]);
  const [editingItem, setEditingItem] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const planLocs = useMemo(
    () => plansEnFin ? localisations.filter(l => l.planAnnotations?.exported || l.planBg || l.planId) : [],
    [localisations, plansEnFin]
  );

  // ── Mesure des hauteurs réelles ─────────────────────────────────────────────────────────────────────────
  const allBlocks   = useMemo(() => flattenBlocks(locs, plansEnFin, ppl, paraBreaks), [locs, plansEnFin, ppl, paraBreaks]);
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
  const hasTableau    = includeTableauRecap && recapItems.length > 0;
  const hasConclusion = includeConclusion;
  const totalPages    = 1 + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + planLocs.length;

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
    print: () => {
      const pages = pageRefs.current.filter(Boolean);
      if (!pages.length) return;

      const win = window.open('', '_blank');
      if (!win) { alert("Autorisez les pop-ups pour exporter le PDF"); return; }

      const pagesHtml = pages.map(el => {
        const clone = el.cloneNode(true);
        // Supprimer les éléments UI non imprimables
        clone.querySelectorAll('[data-print="hide"]').forEach(e => e.remove());
        // Convertir les canvas (icônes de légende) en images
        clone.querySelectorAll('canvas').forEach(canvas => {
          try {
            const img = document.createElement('img');
            img.src = canvas.toDataURL();
            img.style.cssText = canvas.style.cssText;
            canvas.parentNode?.replaceChild(img, canvas);
          } catch {}
        });
        clone.style.marginTop = '0';
        return `<div class="pdf-page">${clone.innerHTML}</div>`;
      }).join('\n');

      // CSS : 1px CSS = 1/96 inch, 1mm = 3.7795px → PW=630px = 166.7mm.
      // On scale html à 210mm/630px ≈ 1.2597 pour A4 exact.
      const safeName   = (projet.nom      || 'Projet').replace(/[<>"]/g, '');
      const safeVisite = (projet.visiteNom || '').replace(/[<>"]/g, '');
      const printTitle = safeVisite ? `${safeName} - CR ${safeVisite}` : `${safeName} - CR`;
      win.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>${printTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Open+Sans:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400&display=swap" rel="stylesheet">
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
      const doPrint = () => { try { win.focus(); win.print(); } catch {} };
      // Attendre que les fonts ET toutes les images soient chargées (signed URLs Supabase)
      const waitImages = () => new Promise(resolve => {
        const imgs = Array.from(win.document.images);
        if (!imgs.length) { resolve(); return; }
        let pending = imgs.filter(i => !i.complete).length;
        if (!pending) { resolve(); return; }
        const done = () => { pending--; if (pending <= 0) resolve(); };
        imgs.forEach(img => { if (!img.complete) { img.addEventListener('load', done); img.addEventListener('error', done); } });
        setTimeout(resolve, 8000); // timeout absolu 8s
      });
      Promise.race([
        Promise.all([win.document.fonts?.ready ?? Promise.resolve(), waitImages()]),
        new Promise(r => setTimeout(r, 10000)),
      ]).then(doPrint);
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
                  ? <PlanBlock loc={block.loc} annotScale={annotScale} planLibrary={projet.planLibrary}/>
                  : <ItemBlock item={block.item} ppl={ppl} mode={block.mode ?? 'full'} textContent={block.textContent} vpPhotoOffset={block.vpPhotoOffset ?? 0} hasViewpoints={block.hasViewpoints ?? false} photoStart={block.photoStart} photoCount={block.photoCount} annotScale={annotScale}/>
                }
              </div>
            ))}
          </div>
        </div>
        {/* Centré sur la largeur totale du viewport (pas seulement la zone preview) */}
        <div style={{ width: PW, marginLeft:`calc(max(10px, 50vw - ${panelW}px - ${Math.round(PW * scale / 2)}px))`, marginRight:0, zoom: scale, display:'flex', flexDirection:'column', alignItems:'center' }}>

        {/* ── PAGE DE GARDE ── */}
        <div ref={el => { pageRefs.current[0] = el; }} style={{ marginTop:20 }}>
          <CoverPage projet={projet} pageNum={1} totalPages={totalPages}/>
        </div>

        {/* ── PAGES OBSERVATIONS ── */}
        {pages.map((pageBlocks, pi) => {
          const firstId     = pageBlocks[0]?.id;
          const firstBlock  = pageBlocks[0];
          const firstForced = breaks.has(firstId);
          const pageNum     = pi + 2;
          return (
            <React.Fragment key={pi}>
              <PageSepBanner
                pageNum={pageNum}
                totalPages={totalPages}
                firstBlockId={firstId}
                isForced={firstForced}
                onToggle={onTogglePageBreak}
              />
              <div ref={el => { pageRefs.current[pi + 1] = el; }}>
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
                          ? <PlanBlock loc={block.loc} annotScale={annotScale} onAnnotScaleChange={onAnnotScaleChange} planLibrary={projet.planLibrary}/>
                          : <ItemBlock item={block.item} ppl={ppl} mode={block.mode ?? 'full'}
                              textContent={block.textContent}
                              onEdit={onUpdateItem ? () => setEditingItem({ item: block.item, locId: block.locId }) : null}
                              vpPhotoOffset={block.vpPhotoOffset ?? 0}
                              hasViewpoints={block.hasViewpoints ?? false}
                              photoStart={block.photoStart}
                              photoCount={block.photoCount}
                              cutMode={cutMode}
                              onParaCut={handleCut}
                              annotScale={annotScale}
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
          const pageNum = 1 + pages.length + 1;
          const pageIdx = 1 + pages.length;
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
          const pageNum = 1 + pages.length + (hasTableau ? 1 : 0) + 1;
          const pageIdx = 1 + pages.length + (hasTableau ? 1 : 0);
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
                />
              </div>
            </>
          );
        })()}

        {/* ── PLANS EN FIN DE RAPPORT ── */}
        {planLocs.map((loc, pi) => {
          const pageNum = 1 + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + pi + 1;
          const pageIdx = 1 + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + pi;
          return (
            <React.Fragment key={`plan-end-${loc.id}`}>
              <PageSepBanner pageNum={pageNum} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
              <div ref={el => { pageRefs.current[pageIdx] = el; }}>
                <A4Card projet={projet} pageNum={pageNum} totalPages={totalPages}>
                  <PlanBlock loc={loc} annotScale={annotScale} onAnnotScaleChange={onAnnotScaleChange} planLibrary={projet.planLibrary}/>
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
