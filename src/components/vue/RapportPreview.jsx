import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback, useImperativeHandle } from 'react';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { renderMarkup } from '../../lib/markup.jsx';
import { SYMBOLS, drawAnnotationPaths, drawVP } from './Annotator.jsx';
import { Ic } from '../ui/Icons.jsx';
import ItemModal from './ItemModal.jsx';
import { useBrandingLogo } from '../../lib/branding.js';

function SymbolIcon({ sym, size = 14 }) {
  const ref = useRef();
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 80, 80);
    try { sym.draw(ctx, 40, 28, 2, DA.red); } catch {}
  }, [sym]);
  return <canvas ref={ref} width={80} height={80}
    style={{ display:'block', flexShrink:0, width:size, height:size }}/>;
}

function ViewpointIcon({ size = 24 }) {
  const ref = useRef();
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 80, 80);
    try { drawVP(ctx, { x: 38, y: 55, angle: -Math.PI / 2, label: 'V1', size: 1, color: DA.red }); } catch {}
  }, []);
  return <canvas ref={ref} width={80} height={80}
    style={{ display:'block', flexShrink:0, width:size, height:size }}/>;
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

// ── Hauteur disponible par page A4 (px preview) ────────────────────────────
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
  const byDouble = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  if (byDouble.length > 1) return byDouble;
  const bySingle = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (bySingle.length > 1) return bySingle;
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

// ── Pagination ─────────────────────────────────────────────────────────────
// Prend une map de hauteurs réelles (ou estimées en fallback) pour chaque bloc.
function buildPages(allBlocks, ppl, breaks, heights) {
  const pages  = [];
  let blocks   = [];
  let usedH    = 0;

  const flush = () => {
    if (blocks.length) { pages.push(blocks); blocks = []; usedH = 0; }
  };

  for (const block of allBlocks) {
    const bh  = (heights && heights[block.id]) || estimateBlockH(block, ppl);
    // BreakControl (36px) only renders before zone blocks (not the first block on a page).
    // Other blocks only have a 5px marginBottom gap between them.
    const gap = blocks.length > 0
      ? ITEM_GAP + (block.type === 'zone' ? BREAK_CTL_H : 0)
      : 0;
    if (breaks.has(block.id)) flush();
    if (usedH + gap + bh > AVAIL_H && blocks.length > 0) flush();
    blocks.push(block);
    usedH += blocks.length > 1
      ? ITEM_GAP + (block.type === 'zone' ? BREAK_CTL_H : 0) + bh
      : bh;
  }
  flush();

  // Anti-orphan : si un en-tête de zone est le dernier bloc d'une page,
  // le déplacer en tête de la page suivante pour qu'il reste avec ses items.
  for (let p = 0; p < pages.length - 1; p++) {
    const page = pages[p];
    if (page.length > 0 && page[page.length - 1].type === 'zone') {
      const orphan = page.pop();
      pages[p + 1].unshift(orphan);
      if (page.length === 0) { pages.splice(p, 1); p--; }
    }
  }

  return pages;
}

// ── Sous-composants ────────────────────────────────────────────────────────

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
function TopBreakControl({ id, zoneName, onToggle }) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={() => onToggle(id)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ margin:`0 -9px ${6}px`, display:'flex', alignItems:'center', gap:10, padding:'7px 14px',
        background: hover ? '#c00010' : DA.red, cursor:'pointer', userSelect:'none',
        borderBottom:'2px solid rgba(255,255,255,0.2)' }}>
      <span style={{ fontSize:12, lineHeight:1 }}>✂</span>
      <span style={{ fontSize:9, fontWeight:800, color:'white', flex:1, letterSpacing:0.3 }}>
        Saut de page forcé{zoneName ? ` avant « ${zoneName} »` : ''} — cliquer pour retirer et laisser fluer naturellement
      </span>
      <span style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,0.7)',
        background:'rgba(0,0,0,0.2)', borderRadius:3, padding:'2px 7px' }}>
        × Annuler le saut
      </span>
    </div>
  );
}

// CutZone — séparateur interactif entre blocs (visible uniquement en mode coupe)
function CutZone({ blockId, active, onCut }) {
  const [hov, setHov] = useState(false);
  if (!active) return null;
  return (
    <div data-print="hide"
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={(e) => { e.stopPropagation(); onCut(blockId); }}
      style={{ height:22, position:'relative', cursor:'crosshair', flexShrink:0, zIndex:50 }}>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', opacity: hov ? 1 : 0.5, transition:'opacity 0.12s', background: hov ? 'rgba(227,5,19,0.07)' : 'transparent' }}>
        <div style={{ background:'#E30513', color:'white', padding:'2px 8px', fontSize:13, flexShrink:0, lineHeight:1 }}>✂</div>
        <div style={{ flex:1, height:2, background:'repeating-linear-gradient(90deg,#E30513 0,#E30513 8px,transparent 8px,transparent 14px)' }}/>
        {hov && <div style={{ background:'#E30513', color:'white', fontSize:8, fontWeight:800, padding:'2px 9px', flexShrink:0, whiteSpace:'nowrap' }}>Couper ici</div>}
      </div>
    </div>
  );
}

// ParaCutZone — séparateur de segments texte dans un bloc (mode coupe)
function ParaCutZone({ paraId, onCut }) {
  const [hov, setHov] = useState(false);
  return (
    <div data-print="hide"
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={(e) => { e.stopPropagation(); onCut(paraId); }}
      style={{ height:18, position:'relative', cursor:'crosshair', margin:'1px -9px', zIndex:50 }}>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', opacity: hov ? 1 : 0.5, transition:'opacity 0.12s', background: hov ? 'rgba(227,5,19,0.07)' : 'transparent' }}>
        <div style={{ background:'#E30513', color:'white', padding:'1px 6px', fontSize:11, flexShrink:0, lineHeight:1 }}>✂</div>
        <div style={{ flex:1, height:1.5, background:'repeating-linear-gradient(90deg,#E30513 0,#E30513 6px,transparent 6px,transparent 10px)' }}/>
        {hov && <div style={{ background:'#E30513', color:'white', fontSize:7, fontWeight:800, padding:'1px 8px', flexShrink:0, whiteSpace:'nowrap' }}>Couper le texte ici</div>}
      </div>
    </div>
  );
}

function ZoneHeader({ loc }) {
  return (
    <div style={{ background:DA.black, borderRadius:3, padding:'5px 10px', marginBottom:5, display:'flex', alignItems:'center', gap:6 }}>
      <div style={{ width:3, height:16, background:DA.red, borderRadius:2, flexShrink:0 }}/>
      <span style={{ fontSize:10, fontWeight:800, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>{loc.nom}</span>
    </div>
  );
}

function ItemBlock({ item, ppl, onEdit, vpPhotoOffset = 0, hasViewpoints = false, mode = 'full', textContent, photoStart, photoCount, cutMode = false, onParaCut }) {
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
  const showContHdr  = mode === 'cont' || (mode === 'photos' && (photoStart == null || photoStart === 0));
  const showComment  = mode !== 'photos' && commentToShow;
  const showPhotos   = mode !== 'text' && mode !== 'cont' && photos.length > 0;
  return (
    <div style={{ marginBottom:5, border:`1px solid ${DA.border}`, borderRadius:4, overflow:'hidden' }}>
      {/* En-tête normal (titre + badges) */}
      {showHeader && (
        <div style={{ background:'#F5F5F5', padding:'4px 9px 5px', display:'flex', flexDirection:'column', gap:3 }}>
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ fontSize:10, fontWeight:700, color:DA.black, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.titre}</span>
            {onEdit && (
              <button onClick={onEdit}
                style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, padding:'1px 3px', display:'flex', alignItems:'center', borderRadius:3, flexShrink:0 }}
                title="Modifier">
                <Ic n="pen" s={10}/>
              </button>
            )}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:urg.dot, flexShrink:0 }}/>
            <span style={{ fontSize:8, fontWeight:700, color:urg.text, background:urg.bg, border:`1px solid ${urg.border}`, borderRadius:3, padding:'1px 5px', whiteSpace:'nowrap' }}>
              {urg.label}
            </span>
            {suivi && (
              <span style={{ fontSize:8, fontWeight:700, color:suivi.text, background:suivi.bg, border:`1px solid ${suivi.border}`, borderRadius:3, padding:'1px 5px', whiteSpace:'nowrap' }}>
                ↩ {suivi.label}
              </span>
            )}
          </div>
        </div>
      )}
      {/* Bandeau de continuation minimal — titre en petit + label suite/photos */}
      {showContHdr && (
        <div style={{ background:'#F9F9F9', borderBottom:`1px solid ${DA.border}`, padding:'2px 9px', display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:8, color:DA.grayL, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{item.titre}</span>
          <span style={{ fontSize:7.5, color:DA.grayL, fontStyle:'italic', flexShrink:0 }}>{mode === 'photos' ? '↳ photos' : '↳ suite'}</span>
          {onEdit && (
            <button onClick={onEdit} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, padding:'1px 3px', display:'flex', alignItems:'center', borderRadius:3, flexShrink:0 }} title="Modifier">
              <Ic n="pen" s={10}/>
            </button>
          )}
        </div>
      )}
      {/* Commentaire */}
      {showComment && (
        <div style={{ padding:'5px 9px', fontSize:10, color:'#333', lineHeight:1.55 }}>
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
          {photos.map((ph, pi) => (
            <div key={pi} style={{ position:'relative' }}>
              <img src={ph.annotated || ph.data} alt=""
                style={{ width:'100%', aspectRatio:'4/3', objectFit:'cover', borderRadius:2, display:'block' }}/>
              {hasViewpoints && (
                <div style={{ position:'absolute', top:2, left:2, background:'rgba(255,255,255,0.92)', color:'#333', fontSize:6, fontWeight:800, borderRadius:2, width:13, height:13, display:'flex', alignItems:'center', justifyContent:'center', border:'1px solid rgba(0,0,0,0.15)', pointerEvents:'none', lineHeight:1, flexShrink:0 }}>
                  V{vpPhotoOffset + pi + 1}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanBlock({ loc, annotScale = 1, onAnnotScaleChange }) {
  const exported = loc.planAnnotations?.exported;
  const paths    = loc.planAnnotations?.paths;
  const planBg   = loc.planBg;
  const [renderedImg, setRenderedImg] = useState(null);

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
      const sizeScale = Math.max(0.5, cv.width / 1400) * annotScale;
      drawAnnotationPaths(ctx, paths, sizeScale);
      setRenderedImg(cv.toDataURL('image/png'));
    };
    el.onerror = () => setRenderedImg(exported || planBg);
    el.src = planBg;
  }, [exported, paths, planBg, annotScale]);

  // Légende : symboles + viewpoints
  const usedIds       = new Set((paths || []).filter(p => p.type === 'symbol').map(p => p.symbolId));
  const legendSy      = SYMBOLS.filter(s => usedIds.has(s.id));
  const hasViewpoints = (paths || []).some(p => p.type === 'viewpoint');
  const showLegend    = legendSy.length > 0 || hasViewpoints;

  if (!renderedImg && !planBg) return null;
  return (
    <div style={{ marginBottom:5, border:`1px solid ${DA.border}`, borderRadius:4, overflow:'hidden' }}>
      <div style={{ background:DA.black, padding:'5px 9px', display:'flex', alignItems:'center', gap:6 }}>
        <div style={{ width:3, height:12, background:DA.red, borderRadius:1, flexShrink:0 }}/>
        <span style={{ fontSize:9, fontWeight:700, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>
          Plan — {loc.nom}
        </span>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6 }}>
          {paths?.length > 0 && (
            <span style={{ fontSize:8, color:'rgba(255,255,255,0.5)' }}>
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
        <div style={{ padding:'8px 12px 10px', background:'#f9f9f9', borderTop:`2px solid ${DA.red}` }}>
          <div style={{ fontSize:10, fontWeight:800, color:DA.red, textTransform:'uppercase', letterSpacing:0.8, marginBottom:8 }}>Légende</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 20px' }}>
            {legendSy.map(s => (
              <div key={s.id} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:DA.gray }}>
                <SymbolIcon sym={s} size={24}/>
                {s.label}
              </div>
            ))}
            {hasViewpoints && (
              <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:DA.gray }}>
                <ViewpointIcon size={24}/>
                Vue photo
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bandeau header commun (logo + titre projet) ─────────────────────────────
function HdrBar({ projet, dateStr }) {
  const logoUrl = useBrandingLogo();
  return (
    <div style={{ height:HDR, background:DA.black, display:'flex', alignItems:'center', padding:`0 ${MX}px`, position:'relative' }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:DA.red }}/>
      {logoUrl && <img src={logoUrl} alt="AI"
        style={{ height:16, objectFit:'contain', opacity:0.9, flexShrink:0 }}/>}
      <span style={{ flex:1 }}/>
      <span style={{ fontSize:6, color:'rgba(255,255,255,0.35)' }}>{projet.nom}{dateStr ? ` · ${dateStr}` : ''}</span>
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
    <div ref={cardRef} style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, position:'relative', minHeight:PH }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      {/* Padding-bottom réserve la place pour le footer absolument positionné */}
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB + FTR}px` }}>{children}</div>
      {/* Footer toujours ancré au bas de la page A4, même si le contenu est court */}
      <div style={{ position:'absolute', top:PH - FTR, left:0, right:0 }}>
        <PageFtr pageNum={pageNum} totalPages={totalPages}/>
      </div>
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

// ── Page de garde unifiée (photo/titre + présentation + intervenants) ──────────
function CoverPage({ projet, pageNum, totalPages }) {
  const logoUrl = useBrandingLogo();
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
    <div style={{ width:PW, height:PH, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* ── Partie sombre : photo + titre ── */}
      <div style={{ height:DARK_H, background:DA.black, position:'relative', overflow:'hidden', flexShrink:0 }}>
        {projet.photo && (
          <img src={projet.photo} alt=""
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', opacity:0.3 }}/>
        )}
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:DA.red }}/>
        {logoUrl && <img src={logoUrl} alt="Assemblage Ingénierie"
          style={{ position:'absolute', top:MX, right:MX, height:24, objectFit:'contain' }}/>}
        <div style={{ position:'absolute', bottom:MX, left:MX+4 }}>
          <div style={{ fontSize:7, color:'rgba(255,255,255,0.4)', letterSpacing:1.5, textTransform:'uppercase', marginBottom:6 }}>
            Compte-rendu de visite
          </div>
          <div style={{ fontSize:22, fontWeight:800, color:'white', lineHeight:1.2 }}>{projet.nom}</div>
          {(projet.visiteNom || dateStr) && (
            <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:3, height:20, background:DA.red, borderRadius:2, flexShrink:0 }}/>
              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                {projet.visiteNom && (
                  <span style={{ fontSize:15, fontWeight:700, color:'rgba(255,255,255,0.92)', letterSpacing:0.3 }}>{projet.visiteNom}</span>
                )}
                {dateStr && (
                  <span style={{ fontSize:11, fontWeight:500, color:'rgba(255,255,255,0.6)', letterSpacing:0.2 }}>Visite du {dateStr}</span>
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
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
              <div style={{ width:3, height:14, background:DA.red, borderRadius:2, flexShrink:0 }}/>
              <span style={{ fontSize:8, fontWeight:800, color:DA.black, textTransform:'uppercase', letterSpacing:0.8 }}>Présentation du projet</span>
            </div>
            <div style={{ background:DA.grayXL, borderRadius:6, padding:'8px 10px', border:`1px solid ${DA.border}`, display:'flex', flexDirection:'column', gap:5 }}>
              {infoRows.map(([k, v]) => (
                <div key={k} style={{ display:'flex', fontSize:9 }}>
                  <span style={{ color:DA.gray, fontWeight:700, width:90, flexShrink:0 }}>{k}</span>
                  <span style={{ color:DA.black }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {participants.length > 0 && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <div style={{ width:3, height:14, background:DA.red, borderRadius:2, flexShrink:0 }}/>
              <span style={{ fontSize:8, fontWeight:800, color:DA.black, textTransform:'uppercase', letterSpacing:0.8 }}>
                Intervenants ({participants.length})
              </span>
            </div>
            <div style={{ display:'flex', alignItems:'center', background:DA.black, borderRadius:'4px 4px 0 0', padding:'5px 0' }}>
              <div style={{ width:24, flexShrink:0 }}/>
              <div style={{ flex:1, display:'flex', minWidth:0 }}>
                <div style={{ flex:'0 0 36%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', paddingRight:8 }}>NOM / POSTE</div>
                <div style={{ flex:'0 0 22%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', paddingRight:4 }}>TÉLÉPHONE</div>
                <div style={{ flex:'0 0 28%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', paddingRight:4 }}>EMAIL</div>
                <div style={{ flex:'0 0 14%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', textAlign:'right', paddingRight:6 }}>PRÉSENCE</div>
              </div>
            </div>
            {participants.map((pt, i) => {
              const isPresent = !pt.presence || pt.presence === 'present';
              const bg = i % 2 === 0 ? DA.grayXL : 'white';
              return (
                <div key={pt.id} style={{ display:'flex', alignItems:'center', padding:'5px 0', background:bg, borderBottom:`1px solid ${DA.border}` }}>
                  <div style={{ width:24, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {pt.isAssemblage
                      ? <span style={{ fontSize:6, fontWeight:900, color:DA.red, background:'#FFF0F0', borderRadius:3, padding:'1px 3px', border:`1px solid #FECACA` }}>A!</span>
                      : <div style={{ width:5, height:5, borderRadius:'50%', background:'#bbb' }}/>
                    }
                  </div>
                  <div style={{ flex:1, display:'flex', alignItems:'center', minWidth:0 }}>
                    <div style={{ flex:'0 0 36%', minWidth:0, paddingRight:8 }}>
                      <div style={{ fontSize:8.5, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.nom}</div>
                      {pt.poste && <div style={{ fontSize:7.5, color:DA.gray, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.poste}</div>}
                    </div>
                    <div style={{ flex:'0 0 22%', fontSize:8, color:DA.gray, paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.tel || '—'}</div>
                    <div style={{ flex:'0 0 28%', fontSize:7.5, color:DA.gray, paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.email || '—'}</div>
                    <div style={{ flex:'0 0 14%', textAlign:'right', paddingRight:6 }}>
                      <span style={{ fontSize:7.5, fontWeight:700,
                        color: isPresent ? '#16A34A' : DA.red,
                        background: isPresent ? '#DCFCE7' : '#FEE2E2',
                        borderRadius:4, padding:'1px 5px' }}>
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

// ── Pied de page commun (toutes les pages) ────────────────────────────────
function PageFtr({ pageNum, totalPages }) {
  return (
    <div style={{ height:FTR, background:'#F9F9F9', borderTop:`1px solid ${DA.border}`, flexShrink:0, display:'flex', alignItems:'center', padding:`0 ${MX}px`, gap:6 }}>
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:1.5, minWidth:0 }}>
        <span style={{ fontSize:5, color:'#c8c8c8', lineHeight:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          Assemblage Ingénierie · S.A.S. capital social 1 000€ · 137 rue d'Aboukir, 75002 Paris · contact@assemblage.net · www.assemblage.net · +33 7 65 62 30 87
        </span>
        <span style={{ fontSize:5, color:'#c8c8c8', lineHeight:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          NAF 7112B · R.C.S. Paris 822 130 100 · Siret 822 130 100 0032 · n°TVA FR 24 822 130 100
        </span>
      </div>
      <span style={{ fontSize:6, color:DA.grayL, flexShrink:0 }}>{pageNum} / {totalPages}</span>
    </div>
  );
}


// ── Page conclusion ────────────────────────────────────────────────────────
function ConclusionPage({ conclusion, conclusionAlign = 'left', projet, pageNum, totalPages }) {
  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR')
    : null;
  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0 }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB}px` }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <div style={{ width:3, height:14, background:DA.red, borderRadius:2, flexShrink:0 }}/>
          <span style={{ fontSize:9, fontWeight:800, color:DA.black, textTransform:'uppercase', letterSpacing:0.8 }}>Conclusion</span>
        </div>
        <div style={{ fontSize:9, color:DA.black, lineHeight:1.7, whiteSpace:'pre-wrap', border:`1px solid ${DA.border}`, borderRadius:6, padding:'10px 12px', background:DA.grayXL, minHeight:60, textAlign:conclusionAlign }}>
          {conclusion ? renderMarkup(conclusion) : <span style={{ color:DA.grayL, fontStyle:'italic' }}>Aucune conclusion saisie.</span>}
        </div>
      </div>
      <div style={{ height:FTR, background:'#F9F9F9', borderTop:`1px solid ${DA.border}`, display:'flex', alignItems:'center', padding:`0 ${MX}px` }}>
        <span style={{ fontSize:6, color:DA.grayL }}>aichantier.app</span>
        <span style={{ flex:1 }}/>
        <span style={{ fontSize:6, color:DA.grayL }}>{pageNum} / {totalPages}</span>
      </div>
    </div>
  );
}

// ── Tableau récapitulatif ──────────────────────────────────────────────────
function TableauRecapPage({ localisations, projet, pageNum, totalPages, tableauRecap }) {
  const urgOrder = { haute: 0, moyenne: 1, basse: 2 };
  const ovMap = new Map((tableauRecap || []).map(r => [r.itemId, r]));
  const rows = localisations.flatMap(loc =>
    (loc.items || []).filter(i => i.titre && i.suivi !== 'fait').map(i => {
      const ov = ovMap.get(i.id) || {};
      return {
        locNom:  'zone'     in ov ? ov.zone     : (loc.nom       || ''),
        titre:   'titre'    in ov ? ov.titre    : (i.titre        || ''),
        urgence: 'urgence'  in ov ? ov.urgence  : (i.urgence     || 'basse'),
        solution:'solution' in ov ? ov.solution : '',
      };
    })
  ).sort((a, b) => (urgOrder[a.urgence] ?? 2) - (urgOrder[b.urgence] ?? 2));

  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR')
    : null;

  const cols = '5px 70px 1fr 1.5fr 65px';

  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0 }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB}px` }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <div style={{ width:3, height:14, background:DA.red, borderRadius:2, flexShrink:0 }}/>
          <span style={{ fontSize:9, fontWeight:800, color:DA.black, textTransform:'uppercase', letterSpacing:0.8 }}>Tableau récapitulatif</span>
          <span style={{ fontSize:8, color:DA.grayL }}>{rows.length} point{rows.length !== 1 ? 's' : ''} à traiter</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:cols, background:DA.black, borderRadius:'4px 4px 0 0', padding:'4px 8px', gap:6 }}>
          <div/>
          <span style={{ fontSize:7, fontWeight:700, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>Zone</span>
          <span style={{ fontSize:7, fontWeight:700, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>Désordre</span>
          <span style={{ fontSize:7, fontWeight:700, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>Solution</span>
          <span style={{ fontSize:7, fontWeight:700, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>Urgence</span>
        </div>
        {rows.map((row, i) => {
          const u = URGENCE[row.urgence] || URGENCE.basse;
          return (
            <div key={i} style={{ display:'grid', gridTemplateColumns:cols, gap:6, padding:'5px 8px', borderBottom:`1px solid ${DA.border}`, background: i % 2 === 0 ? DA.grayXL : 'white', alignItems:'start' }}>
              <div style={{ width:5, background:u.dot, borderRadius:2, minHeight:14, alignSelf:'stretch' }}/>
              <div style={{ fontSize:7, color:DA.gray, lineHeight:1.4 }}>{row.locNom || '—'}</div>
              <div style={{ fontSize:8, fontWeight:700, color:DA.black, lineHeight:1.3 }}>{row.titre || '—'}</div>
              <div style={{ fontSize:7, color:DA.gray, lineHeight:1.4, wordBreak:'break-word' }}>{row.solution || '—'}</div>
              <span style={{ fontSize:7, fontWeight:700, color:u.text, background:u.bg, border:`1px solid ${u.border}`, borderRadius:4, padding:'1px 5px', whiteSpace:'nowrap', alignSelf:'start' }}>{u.label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ height:FTR, background:'#F9F9F9', borderTop:`1px solid ${DA.border}`, display:'flex', alignItems:'center', padding:`0 ${MX}px` }}>
        <span style={{ fontSize:6, color:DA.grayL }}>aichantier.app</span>
        <span style={{ flex:1 }}/>
        <span style={{ fontSize:6, color:DA.grayL }}>{pageNum} / {totalPages}</span>
      </div>
    </div>
  );
}

// ── Hook scale adaptatif ───────────────────────────────────────────────────
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

// ── Composant principal ────────────────────────────────────────────────────
const RapportPreview = React.forwardRef(function RapportPreview({ projet, localisations, photosParLigne, pageBreaks, onTogglePageBreak, plansEnFin, includeTableauRecap = true, tableauRecap = [], includeConclusion = false, conclusion = '', conclusionAlign = 'left', annotScale = 1, onAnnotScaleChange, onUpdateItem, onTogglePanel, panelOpen, cutMode = false, onCutModeChange }, ref) {
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
    () => plansEnFin ? localisations.filter(l => l.planAnnotations?.exported || l.planBg) : [],
    [localisations, plansEnFin]
  );

  // ── Mesure des hauteurs réelles ──────────────────────────────────────────
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

  // ── Mode coupe — callback commun pour CutZone et ParaCutZone ──────────────
  const handleCut = useCallback((id) => {
    onTogglePageBreak(id);
    onCutModeChange?.(false);
  }, [onTogglePageBreak, onCutModeChange]);

  useEffect(() => {
    if (!cutMode) return;
    const onKey = (e) => { if (e.key === 'Escape') onCutModeChange?.(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cutMode, onCutModeChange]);

  // ── Impression navigateur (preview = PDF pixel-perfect) ────────────────────
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
      win.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>Rapport PDF</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 0; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
  html, body { margin: 0; padding: 0; background: white; }
  .pdf-page { width: 630px; height: 891px; overflow: hidden; position: relative; display: block; page-break-after: always; break-after: page; }
  .pdf-page:last-child { page-break-after: avoid; break-after: avoid; }
  @media screen { body { background: #555; display: flex; flex-direction: column; align-items: center; padding: 20px 0; gap: 16px; } .pdf-page { box-shadow: 0 2px 20px rgba(0,0,0,0.35); } }
  @media print { html { zoom: 1.2597; } body { background: white; padding: 0; } .pdf-page { box-shadow: none; } }
</style>
</head><body>${pagesHtml}</body></html>`);

      win.document.close();
      // Imprimer dès que les fonts sont prêtes (< 1.5s) ou après timeout absolu
      const doPrint = () => { try { win.focus(); win.print(); } catch {} };
      Promise.race([
        win.document.fonts?.ready ?? Promise.resolve(),
        new Promise(r => setTimeout(r, 1500)),
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
          ✂ Survolez les tirets pour choisir l'endroit — cliquez pour couper — Échap pour annuler
        </div>
      )}

      {/* ── Barre de navigation pages ── */}
      <div style={{ background:'#1e1e1e', padding:'7px 10px', display:'flex', alignItems:'center', gap:8, flexShrink:0, borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        {/* Bouton Paramètres — toujours visible */}
        {onTogglePanel && (
          <button
            onClick={onTogglePanel}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:7, border:'none', cursor:'pointer', flexShrink:0, transition:'all 0.15s',
              background: panelOpen ? DA.red : 'rgba(255,255,255,0.10)',
              color: panelOpen ? 'white' : 'rgba(255,255,255,0.75)',
            }}>
            <Ic n="sld" s={13}/>
            <span style={{ fontSize:11, fontWeight:700, letterSpacing:0.3 }}>Paramètres</span>
          </button>
        )}
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
          <button
            onClick={() => scrollToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            style={{ background:'rgba(255,255,255,0.08)', border:'none', color: currentPage <= 1 ? 'rgba(255,255,255,0.2)' : 'white', borderRadius:6, padding:'4px 11px', cursor: currentPage <= 1 ? 'default' : 'pointer', fontSize:16, fontWeight:700, lineHeight:1, flexShrink:0 }}>
            ‹
          </button>
          <span style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.7)', letterSpacing:0.5, minWidth:70, textAlign:'center' }}>
            Page {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => scrollToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            style={{ background:'rgba(255,255,255,0.08)', border:'none', color: currentPage >= totalPages ? 'rgba(255,255,255,0.2)' : 'white', borderRadius:6, padding:'4px 11px', cursor: currentPage >= totalPages ? 'default' : 'pointer', fontSize:16, fontWeight:700, lineHeight:1, flexShrink:0 }}>
            ›
          </button>
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
                  ? <PlanBlock loc={block.loc} annotScale={annotScale}/>
                  : <ItemBlock item={block.item} ppl={ppl} mode={block.mode ?? 'full'} textContent={block.textContent} vpPhotoOffset={block.vpPhotoOffset ?? 0} hasViewpoints={block.hasViewpoints ?? false} photoStart={block.photoStart} photoCount={block.photoCount}/>
                }
              </div>
            ))}
          </div>
        </div>
        {/* zoom CSS réduit visuellement ET en layout → margin:auto centre parfaitement */}
        <div style={{ width: PW, margin:'0 auto', zoom: scale, display:'flex', flexDirection:'column', alignItems:'center' }}>

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
                  {/* Bouton de suppression en haut si ce saut de page est forcé */}
                  {firstForced && firstBlock && (
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
                          ? <PlanBlock loc={block.loc} annotScale={annotScale} onAnnotScaleChange={onAnnotScaleChange}/>
                          : <ItemBlock item={block.item} ppl={ppl} mode={block.mode ?? 'full'}
                              textContent={block.textContent}
                              onEdit={onUpdateItem ? () => setEditingItem({ item: block.item, locId: block.locId }) : null}
                              vpPhotoOffset={block.vpPhotoOffset ?? 0}
                              hasViewpoints={block.hasViewpoints ?? false}
                              photoStart={block.photoStart}
                              photoCount={block.photoCount}
                              cutMode={cutMode}
                              onParaCut={handleCut}
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
                <TableauRecapPage localisations={localisations} projet={projet} pageNum={pageNum} totalPages={totalPages} tableauRecap={tableauRecap}/>
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
                <ConclusionPage conclusion={conclusion} conclusionAlign={conclusionAlign} projet={projet} pageNum={pageNum} totalPages={totalPages}/>
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
                  <PlanBlock loc={loc} annotScale={annotScale} onAnnotScaleChange={onAnnotScaleChange}/>
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
