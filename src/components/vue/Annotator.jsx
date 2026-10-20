import React, { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useEditLock } from '../../lib/editLock.js';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import ThumbImg from '../ui/ThumbImg.jsx';
import { getVpNum, relabelViewpoints } from '../../lib/vpNumbering.js';
import { reportCrop, reportVisibleRect } from '../../lib/photoFrame.js';

const ANNOT_COLORS = ['#E30513','#E67E22','#F1C40F','#2980B9','#27AE60','#8E44AD','#222222','#FFFFFF'];

// ── Viewpoint (œil + cône de vue) ────────────────────────────────────────────
export function drawVP(ctx, { x, y, angle = 0, label = '', size = 3, color = '#E30513' }) {
  // Marqueur photo (repère de vue) RÉDUIT par défaut — il éclipsait les symboles techniques
  // (fissures, danger…). Réglable ensuite via l'échelle Symboles comme avant. (retour Thomas)
  const r  = 7 + size * 0.8;
  const L  = 26 + size * 3;
  const sp = 0.62; // demi-angle du cône (~35°)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle - sp) * L, y + Math.sin(angle - sp) * L);
  ctx.arc(x, y, L, angle - sp, angle + sp);
  ctx.closePath();
  ctx.fillStyle = color; ctx.globalAlpha = 0.15; ctx.fill();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = color; ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle - sp) * L, y + Math.sin(angle - sp) * L);
  ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle + sp) * L, y + Math.sin(angle + sp) * L);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, L, angle - sp, angle + sp); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  if (label) {
    ctx.font = `bold ${8 + size}px Arial`;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.strokeText(label, x + r + 3, y - r + 4);
    ctx.fillStyle = color;
    ctx.fillText(label, x + r + 3, y - r + 4);
  }
  ctx.restore();
}

// Sens portée — \——/ : demi-flèche en haut à droite, demi-flèche en bas à gauche
export function drawPorteePath(ctx, x1, y1, x2, y2, s, c) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const lw    = s + 1.5;
  const aLen  = 10 + s * 1.5;
  ctx.save();
  ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  // right end: top half of > (goes upper-left from x2)
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 + Math.cos(angle + Math.PI + Math.PI / 4) * aLen, y2 + Math.sin(angle + Math.PI + Math.PI / 4) * aLen);
  ctx.stroke();
  // left end: bottom half of < (goes lower-right from x1)
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + Math.cos(angle + Math.PI / 4) * aLen, y1 + Math.sin(angle + Math.PI / 4) * aLen);
  ctx.stroke();
  ctx.restore();
}

// Base de la flèche d'un texte-flèche, CHOISIE par l'utilisateur (demande Thomas : « déplacer la
// base sur le pourtour de la case »). Stockée en fraction du cadre (p.arrowAt = { fx, fy } ∈ [0,1])
// → elle suit le cadre quand on le déplace / l'agrandit. Absente = base auto (comportement d'avant).
// Projette (px,py) sur le pourtour du cadre, en évitant les coins arrondis (rayon rad).
function snapToBoxEdge(px, py, bx, by, bw, bh, rad = 0) {
  let x = Math.max(bx, Math.min(bx + bw, px)), y = Math.max(by, Math.min(by + bh, py));
  const dL = x - bx, dR = bx + bw - x, dT = y - by, dB = by + bh - y;
  const m = Math.min(dL, dR, dT, dB);
  if (m > 0) { if (m === dL) x = bx; else if (m === dR) x = bx + bw; else if (m === dT) y = by; else y = by + bh; }
  const onH = y === by || y === by + bh;
  if (onH && bw > rad * 2) x = Math.max(bx + rad, Math.min(bx + bw - rad, x));
  else if (!onH && bh > rad * 2) y = Math.max(by + rad, Math.min(by + bh - rad, y));
  return { x, y, fx: bw > 0 ? (x - bx) / bw : 0.5, fy: bh > 0 ? (y - by) / bh : 0.5 };
}
function arrowAtPoint(p, bx, by, bw, bh) {
  const a = p.arrowAt;
  if (!a || !Number.isFinite(a.fx) || !Number.isFinite(a.fy)) return null;
  return snapToBoxEdge(bx + a.fx * bw, by + a.fy * bh, bx, by, bw, bh);
}

// Pente sol — flèche simple orientable (drag x1,y1→x2,y2) + label "Sol"
function drawPenteSolPath(ctx, x1, y1, x2, y2, s, c) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const aLen  = 8 + s * 1.5;
  ctx.save();
  ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = s + 1.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 + Math.cos(angle + Math.PI + Math.PI / 5) * aLen, y2 + Math.sin(angle + Math.PI + Math.PI / 5) * aLen);
  ctx.lineTo(x2 + Math.cos(angle + Math.PI - Math.PI / 5) * aLen, y2 + Math.sin(angle + Math.PI - Math.PI / 5) * aLen);
  ctx.closePath(); ctx.fill();
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  ctx.font = `bold ${9 + s * 0.7}px Arial`;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.strokeText('Sol', mx + 4, my - 4); ctx.fillText('Sol', mx + 4, my - 4);
  ctx.restore();
}

// sizeScale : soit un NOMBRE (échelle commune texte/symbole/viewpoint, comportement historique),
//   soit un OBJET { text, shape, symbol } pour des échelles INDÉPENDANTES par type.
//   - text   → taille du texte
//   - symbol → taille des symboles ET des viewpoints
//   - shape  → multiplicateur d'épaisseur des formes (1 = inchangé ; les formes ne sont pas
//     mises à l'échelle géométriquement, elles gardent la taille à laquelle elles sont dessinées)
// strokeScale : échelle pour les tracés (normalisée en pixels écran, indépendante).
// Rétro-compat : si on passe un nombre, text=symbol=ce nombre et shape=1 → rendu identique à avant.
// skipTypes (optionnel) : Set de types d'annotation à NE PAS dessiner (ex : new Set(['viewpoint'])).
// Sert au PDF, qui redessine les Vxx en VECTORIEL par-dessus l'image (nets à tout zoom) et ne veut
// donc pas de version cuite dans le raster. Par défaut (null) : tout est dessiné → aperçu écran inchangé.
// ── ÉCHELLE UNIQUE DES ANNOTATIONS DE PLAN (WYSIWYG) ──────────────────────────────────────
// Retour Thomas : « dans l'annotateur c'est joli, dans la vue Visite et le PDF le texte est tout
// gros ». L'annotateur dimensionnait le texte des PLANS par rapport à l'ÉCRAN (taille constante à
// l'écran) alors que la vue Visite et le rapport le dimensionnaient par rapport au PLAN.
// Désormais une seule règle partout : tailles proportionnelles à la LARGEUR du plan (référence
// PLAN_REF_W, calée sur l'annotateur PC), × curseurs Texte / Symboles / Formes de l'utilisateur.
export const PLAN_REF_W = 2000;
export function planAnnotScales(width, scales = {}) {
  const b = (Number(width) || PLAN_REF_W) / PLAN_REF_W;
  return {
    sizes: { text: b * (scales.text ?? 1), symbol: b * (scales.symbol ?? 1), shape: scales.shape ?? 1 },
    stroke: 2 * b, // épaisseur des traits : celle de l'annotateur PC (indépendante du curseur Symboles)
  };
}

export function drawAnnotationPaths(ctx, paths, sizeScale = 1, strokeScale = null, skipTypes = null) {
  const _o   = sizeScale && typeof sizeScale === 'object';
  const sT   = _o ? (sizeScale.text   ?? 1) : sizeScale; // texte
  const sSym = _o ? (sizeScale.symbol ?? 1) : sizeScale; // symboles + viewpoints
  const sShape = _o ? (sizeScale.shape ?? 1) : 1;        // épaisseur formes (neutre par défaut)
  const ss = strokeScale ?? (_o ? 1 : sizeScale);
  (paths || []).forEach(p => {
    if (skipTypes && skipTypes.has(p.type)) return;
    if (p.type === 'viewpoint') {
      ctx.save();
      if (sSym !== 1 && p.x != null) {
        ctx.translate(p.x, p.y); ctx.scale(sSym, sSym); ctx.translate(-p.x, -p.y);
      }
      drawVP(ctx, p);
      ctx.restore();
    } else if (p.type === 'symbol') {
      if (p.symbolId === 'portee') {
        ctx.save();
        if (p.x1 != null) {
          drawPorteePath(ctx, p.x1, p.y1, p.x2, p.y2, p.size * sSym, p.color);
        } else {
          drawPorteePath(ctx, p.x - 30, p.y, p.x + 30, p.y, p.size * sSym, p.color);
        }
        ctx.restore();
      } else if (p.symbolId === 'pente_sol') {
        ctx.save();
        if (p.x1 != null) {
          drawPenteSolPath(ctx, p.x1, p.y1, p.x2, p.y2, p.size * sSym, p.color);
        } else {
          drawPenteSolPath(ctx, p.x - 30, p.y, p.x + 30, p.y, p.size * sSym, p.color);
        }
        ctx.restore();
      } else {
        const sm = getAllSymbols().find(x => x.id === p.symbolId);
        if (sm) {
          ctx.save();
          if (sSym !== 1 && p.x != null) {
            ctx.translate(p.x, p.y); ctx.scale(sSym, sSym); ctx.translate(-p.x, -p.y);
          }
          sm.draw(ctx, p.x, p.y, p.size, p.color);
          ctx.restore();
        }
      }
    } else if (p.type === 'text') {
      const fs = 20 + p.size * 4;
      const lh = fs * 1.2;            // hauteur de ligne (texte multi-ligne)
      // Marges du cadre PROPORTIONNELLES à la police. Horizontale FINE (Thomas : « la boîte est trop
      // large, faut que ce soit fin pour être classe »), verticale un peu plus généreuse pour respirer.
      const padX = Math.max(4, fs * 0.16);
      const pad  = Math.max(6, fs * 0.24);
      ctx.save();
      ctx.font = `bold ${fs}px Arial`;
      let lines = String(p.text ?? '').split('\n');
      let tw;
      if (p.textW) {
        // Word-wrap chaque ligne explicite pour tenir dans p.textW pixels canvas
        const wrapped = [];
        for (const ln of lines) {
          const words = ln.split(' ');
          let cur = '';
          for (const w of words) {
            const test = cur ? cur + ' ' + w : w;
            if (ctx.measureText(test).width <= p.textW) { cur = test; }
            else { if (cur) wrapped.push(cur); cur = w; }
          }
          wrapped.push(cur);
        }
        lines = wrapped.length ? wrapped : [''];
        // Le cadre colle à la LIGNE réelle la plus large, PAS à textW (qui ne fait que fixer le point
        // de retour à la ligne). Sinon la boîte reste énorme même avec un texte court (retour Thomas).
        tw = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
      } else {
        tw = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
      }
      ctx.restore();
      const textH = fs + (lines.length - 1) * lh; // hauteur totale du bloc de texte

      // ── Flèche EN PREMIER, en coordonnées ABSOLUES (dessinée SOUS le cadre).
      //    La pointe (arrowX/arrowY) reste strictement fixe : indépendante de la position
      //    du cadre ET de la taille du texte (avant, elle était dans la transformée d'échelle
      //    du texte → elle bougeait au déplacement du cadre et à l'agrandissement). ──
      if (p.textMode === 'arrow' && p.x != null) {
        const absBx = p.x - sT * padX, absBy = p.y - sT * (fs + 4);
        const absBw = sT * (tw + padX * 2), absBh = sT * (textH + pad + 6);
        const bcx = absBx + absBw / 2, bcy = absBy + absBh / 2;
        const tipX = p.arrowX ?? (p.x + tw / 2);
        const tipY = p.arrowY ?? (absBy + absBh + 16 * ss);
        const ddx = tipX - bcx, ddy = tipY - bcy;
        let ex = bcx, ey = bcy;
        const _at = arrowAtPoint(p, absBx, absBy, absBw, absBh);
        if (_at) { ex = _at.x; ey = _at.y; }
        else if (Math.abs(ddx) > 0.5 || Math.abs(ddy) > 0.5) {
          const hw = absBw / 2, hh = absBh / 2;
          if (hw * Math.abs(ddy) <= hh * Math.abs(ddx)) {
            const s2 = ddx > 0 ? 1 : -1; ex = bcx + s2 * hw; ey = bcy + (ddy / ddx) * s2 * hw;
          } else {
            const s2 = ddy > 0 ? 1 : -1; ex = bcx + (ddx / ddy) * s2 * hh; ey = bcy + s2 * hh;
          }
        }
        const ang = Math.atan2(tipY - ey, tipX - ex);
        // Flèche : épaisseur + pointe proportionnelles à l'échelle TEXTE (scaleText)
        const arrowSc = _o ? Math.max(0.3, Math.min(5, 2 * sT / Math.max(0.01, ss))) : 1;
        const aL = 16 * ss * arrowSc;
        const baseX = tipX - Math.cos(ang) * aL, baseY = tipY - Math.sin(ang) * aL;
        ctx.save();
        ctx.strokeStyle = p.color; ctx.fillStyle = p.color;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = 3.5 * ss * arrowSc;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(baseX, baseY); ctx.stroke();
        // Pointe pleine (triangle net)
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - Math.cos(ang - Math.PI / 7) * aL, tipY - Math.sin(ang - Math.PI / 7) * aL);
        ctx.lineTo(tipX - Math.cos(ang + Math.PI / 7) * aL, tipY - Math.sin(ang + Math.PI / 7) * aL);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      // ── Cadre + texte (mis à l'échelle sT autour de p), PAR-DESSUS la flèche ──
      ctx.save();
      if (sT !== 1 && p.x != null) {
        ctx.translate(p.x, p.y); ctx.scale(sT, sT); ctx.translate(-p.x, -p.y);
      }
      ctx.font = `bold ${fs}px Arial`;
      // Épaisseur du trait du cadre : FINE et élégante (retour Thomas : « le contour est trop épais,
      // ça doit être beaucoup plus fin »). Légèrement proportionnelle à la police mais bornée bas.
      const _lwF = Math.min(1.8, Math.max(0.5, fs / 40));
      if (p.textMode === 'boxed' || p.textMode === 'arrow') {
        const bx = p.x - padX, by = p.y - fs - 4, bw = tw + padX * 2, bh = textH + pad + 6;
        ctx.fillStyle = 'rgba(255,255,255,0.96)';
        ctx.strokeStyle = p.color; ctx.lineWidth = 1.2 * ss / sT * _lwF;
        ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill(); ctx.stroke();
        ctx.fillStyle = p.color;
        lines.forEach((ln, i) => ctx.fillText(ln, p.x, p.y + i * lh));
      } else {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * ss / sT * _lwF;
        ctx.fillStyle = p.color;
        lines.forEach((ln, i) => { ctx.strokeText(ln, p.x, p.y + i * lh); ctx.fillText(ln, p.x, p.y + i * lh); });
      }
      ctx.restore();
    } else if (p.type === 'shape') {
      ctx.save();
      ctx.strokeStyle = p.color;
      // Épaisseur PROPRE à la forme (sizeMul, réglée sur la forme sélectionnée) × réglage global
      // (curseur « Formes » du rapport). Absent = 1 → rendu strictement identique à avant.
      const shMul = Number.isFinite(p.sizeMul) && p.sizeMul > 0 ? p.sizeMul : 1;
      ctx.lineWidth = (p.size || 2) * ss * sShape * shMul;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Trait en TIRETS (demande Thomas) : proportionnel à l'épaisseur → même aspect à toute taille.
      if (p.dash) ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 2.2]);
      ctx.globalAlpha = 1;
      const fo = p.fillOpacity ?? 0.3;
      if (p.shape === 'rect') {
        const x = Math.min(p.x1, p.x2), y = Math.min(p.y1, p.y2);
        const w = Math.abs(p.x2 - p.x1), h = Math.abs(p.y2 - p.y1);
        if (p.filled) { ctx.fillStyle = p.color; ctx.globalAlpha = fo; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
        else { ctx.globalAlpha = p.strokeOpacity ?? 1; }
        ctx.strokeRect(x, y, w, h);
        ctx.globalAlpha = 1;
      } else if (p.shape === 'ellipse') {
        const cx = (p.x1 + p.x2) / 2, cy = (p.y1 + p.y2) / 2;
        const rx = Math.max(1, Math.abs(p.x2 - p.x1) / 2), ry = Math.max(1, Math.abs(p.y2 - p.y1) / 2);
        if (p.filled) { ctx.fillStyle = p.color; ctx.globalAlpha = fo; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
        else { ctx.globalAlpha = p.strokeOpacity ?? 1; }
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.shape === 'arrow') {
        ctx.globalAlpha = p.strokeOpacity ?? 1;
        const angle = Math.atan2(p.y2 - p.y1, p.x2 - p.x1);
        const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
        const aLen = Math.max(12 * sShape * shMul, Math.min(len * 0.35, 28 * ss * sShape * shMul));
        ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(p.x2, p.y2);
        ctx.lineTo(p.x2 + Math.cos(angle + Math.PI + Math.PI / 6) * aLen, p.y2 + Math.sin(angle + Math.PI + Math.PI / 6) * aLen);
        ctx.lineTo(p.x2 + Math.cos(angle + Math.PI - Math.PI / 6) * aLen, p.y2 + Math.sin(angle + Math.PI - Math.PI / 6) * aLen);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (p.shape === 'line') {
        ctx.globalAlpha = p.strokeOpacity ?? 1;
        ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.shape === 'poly') {
        if (!p.pts || p.pts.length < 2) { ctx.restore(); return; }
        ctx.beginPath();
        ctx.moveTo(p.pts[0].x, p.pts[0].y);
        p.pts.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y));
        ctx.closePath();
        if (p.filled !== false) { ctx.fillStyle = p.color; ctx.globalAlpha = fo; ctx.fill(); ctx.globalAlpha = 1; }
        else { ctx.globalAlpha = p.strokeOpacity ?? 1; }
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.shape === 'polyline') {
        // Polyligne OUVERTE : segments à la suite, ni fermeture ni remplissage (demande Thomas).
        if (!p.pts || p.pts.length < 2) { ctx.restore(); return; }
        ctx.globalAlpha = p.strokeOpacity ?? 1;
        ctx.beginPath();
        ctx.moveTo(p.pts[0].x, p.pts[0].y);
        p.pts.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    } else if (p.points?.length) {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = (p.tool === 'eraser' ? p.size * 6 : p.size) * ss;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = p.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.moveTo(p.points[0].x, p.points[0].y);
      p.points.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
      ctx.restore();
    }
  });
}

export const SYMBOLS = [
  // ── Fissures ──
  { id:'fissure_verticale', label:'Fissure verticale sur un mur', short:'FV',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(x-2,y-16); ctx.lineTo(x+4,y-7); ctx.lineTo(x-3,y-1); ctx.lineTo(x+4,y+8); ctx.lineTo(x-1,y+16); ctx.stroke(); ctx.restore(); } },
  { id:'fissure_oblique', label:"Fissure d'allure oblique sur un mur", short:'FO',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.fillStyle=c; const tx=x+10,ty=y-7; ctx.beginPath(); ctx.moveTo(x-10,y+5); ctx.lineTo(x-3,y); ctx.lineTo(x+2,y-2); ctx.lineTo(x+6,y-5); ctx.lineTo(tx,ty); ctx.stroke(); const ang=Math.atan2(ty-(y+5),tx-(x-10)); const aL=7+s*0.4; ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(tx+Math.cos(ang+Math.PI+0.42)*aL,ty+Math.sin(ang+Math.PI+0.42)*aL); ctx.stroke(); ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(tx+Math.cos(ang+Math.PI-0.42)*aL,ty+Math.sin(ang+Math.PI-0.42)*aL); ctx.stroke(); ctx.font=`bold ${9+s}px Arial`; ctx.textAlign='center'; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('FO',x,y+17); ctx.fillText('FO',x,y+17); ctx.restore(); } },
  { id:'fissure_oblique_linteau', label:"Fissure oblique sur un mur au-dessus du linteau d'une baie", short:'FL',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1.5; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.fillStyle=c; const tx=x+10,ty=y-7; ctx.beginPath(); ctx.moveTo(x-10,y+5); ctx.lineTo(x-3,y); ctx.lineTo(x+2,y-2); ctx.lineTo(x+6,y-5); ctx.lineTo(tx,ty); ctx.stroke(); const ang=Math.atan2(ty-(y+5),tx-(x-10)); const aL=7+s*0.4; ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(tx+Math.cos(ang+Math.PI+0.42)*aL,ty+Math.sin(ang+Math.PI+0.42)*aL); ctx.stroke(); ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(tx+Math.cos(ang+Math.PI-0.42)*aL,ty+Math.sin(ang+Math.PI-0.42)*aL); ctx.stroke(); ctx.font=`bold ${9+s}px Arial`; ctx.textAlign='center'; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('L.',x,y+17); ctx.fillText('L.',x,y+17); ctx.restore(); } },
  { id:'fissure_oblique_allege', label:"Fissure oblique sur une allège de fenêtre", short:'FA',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1.5; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.fillStyle=c; const tx=x+10,ty=y-7; ctx.beginPath(); ctx.moveTo(x-10,y+5); ctx.lineTo(x-3,y); ctx.lineTo(x+2,y-2); ctx.lineTo(x+6,y-5); ctx.lineTo(tx,ty); ctx.stroke(); const ang=Math.atan2(ty-(y+5),tx-(x-10)); const aL=7+s*0.4; ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(tx+Math.cos(ang+Math.PI+0.42)*aL,ty+Math.sin(ang+Math.PI+0.42)*aL); ctx.stroke(); ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(tx+Math.cos(ang+Math.PI-0.42)*aL,ty+Math.sin(ang+Math.PI-0.42)*aL); ctx.stroke(); ctx.font=`bold ${9+s}px Arial`; ctx.textAlign='center'; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('A',x,y+17); ctx.fillText('A',x,y+17); ctx.restore(); } },
  { id:'fissure_horizontale', label:"Fissure d'allure horizontale sur mur, façade", short:'FM',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.moveTo(x-14,y-5); ctx.lineTo(x-6,y); ctx.lineTo(x+2,y-6); ctx.lineTo(x+8,y+1); ctx.lineTo(x+14,y-3); ctx.stroke(); ctx.font=`bold ${8+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('M',x-4,y+14); ctx.fillText('M',x-4,y+14); ctx.restore(); } },
  { id:'fissure_plafond', label:"Fissure au plafond, sur linteau de baie, en sous-face de l'escalier, sur voûtes", short:'FP',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.moveTo(x-14,y-6); ctx.lineTo(x-6,y-1); ctx.lineTo(x+2,y-7); ctx.lineTo(x+8,y); ctx.lineTo(x+14,y-4); ctx.stroke(); ctx.font=`bold ${9+s}px Arial`; ctx.fillStyle=c; ctx.textAlign='center'; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('FP',x,y+14); ctx.fillText('FP',x,y+14); ctx.restore(); } },
  // ── Dégâts ──
  { id:'degats_eaux', label:"Dégâts des eaux, infiltrations, taches d'humidité", short:'EAU',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.fillStyle=c; const r=2+s*0.4; [[-10,-8],[0,-12],[10,-6],[-13,2],[5,0],[14,5],[-5,10],[4,14],[-12,14]].forEach(([dx,dy])=>{ ctx.beginPath(); ctx.arc(x+dx,y+dy,r,0,Math.PI*2); ctx.fill(); }); ctx.restore(); } },
  { id:'baie_deformee', label:"Baie déformée, linteau dénivelé par affaissement d'un appui", short:'BD',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(x-10,y+16); ctx.lineTo(x-10,y-12+7); ctx.lineTo(x+10,y-12); ctx.lineTo(x+10,y+16); ctx.stroke(); ctx.restore(); } },
  { id:'devers', label:"Dévers d'un élément vertical", short:'DEV',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1.5; ctx.lineCap='round'; ctx.fillStyle=c; ctx.beginPath(); ctx.moveTo(x-16,y-2); ctx.lineTo(x+16,y-2); ctx.stroke(); const aL=8+s*0.3; ctx.beginPath(); ctx.moveTo(x+16,y-2); ctx.lineTo(x+16+Math.cos(Math.PI+Math.PI/5)*aL,y-2+Math.sin(Math.PI+Math.PI/5)*aL); ctx.lineTo(x+16+Math.cos(Math.PI-Math.PI/5)*aL,y-2+Math.sin(Math.PI-Math.PI/5)*aL); ctx.closePath(); ctx.fill(); ctx.font=`bold ${8+s}px Arial`; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('D',x-4,y+14); ctx.fillText('D',x-4,y+14); ctx.restore(); } },
  { id:'pente_sol', label:'Pente du sol (descendant dans le sens de la flèche)', short:'SOL',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.fillStyle=c; ctx.lineWidth=s+1.5; ctx.lineCap='round'; const aL=8+s*0.3; ctx.beginPath(); ctx.moveTo(x-17,y); ctx.lineTo(x+17,y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x+17,y); ctx.lineTo(x+17+Math.cos(Math.PI+Math.PI/5)*aL,y+Math.sin(Math.PI+Math.PI/5)*aL); ctx.lineTo(x+17+Math.cos(Math.PI-Math.PI/5)*aL,y+Math.sin(Math.PI-Math.PI/5)*aL); ctx.closePath(); ctx.fill(); ctx.font=`bold ${7+s}px Arial`; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('Sol',x-10,y-7); ctx.fillText('Sol',x-10,y-7); ctx.restore(); } },
  // ── Divers ──
  { id:'portee', label:'Sens de portée', short:'PO',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1.5; ctx.lineCap='round'; const aLen=10+s*1.5,x1=x-17,y1=y,x2=x+17,y2=y; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x2,y2); ctx.lineTo(x2+Math.cos(Math.PI+Math.PI/4)*aLen,y2+Math.sin(Math.PI+Math.PI/4)*aLen); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x1+Math.cos(Math.PI/4)*aLen,y1+Math.sin(Math.PI/4)*aLen); ctx.stroke(); ctx.restore(); } },
  { id:'nv', label:'Local non visité', short:'NV',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.roundRect(x-13,y-10,26,20,4); ctx.stroke(); const fs=11+s*0.5; ctx.font=`bold ${fs}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('NV',x-8,y+5); ctx.fillText('NV',x-8,y+5); ctx.restore(); } },
  { id:'danger', label:'Danger', short:'!',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.beginPath(); ctx.moveTo(x,y-14); ctx.lineTo(x+13,y+11); ctx.lineTo(x-13,y+11); ctx.closePath(); ctx.fillStyle=c; ctx.globalAlpha=0.15; ctx.fill(); ctx.globalAlpha=1; ctx.strokeStyle=c; ctx.lineWidth=s+1.5; ctx.lineJoin='round'; ctx.stroke(); ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.font=`bold ${13+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.strokeText('!',x,y+9); ctx.fillText('!',x,y+9); ctx.restore(); } },
  { id:'eclat', label:'Éclatement', short:'ÉCL',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.lineCap='round'; ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.stroke(); [[0,17],[Math.PI/4,14],[Math.PI/2,16],[3*Math.PI/4,13],[Math.PI,15],[5*Math.PI/4,13],[3*Math.PI/2,16],[7*Math.PI/4,14]].forEach(([a,r])=>{ ctx.beginPath(); ctx.moveTo(x+Math.cos(a)*5,y+Math.sin(a)*5); ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r); ctx.stroke(); if(r>13){ ctx.beginPath(); ctx.moveTo(x+Math.cos(a)*(r-5),y+Math.sin(a)*(r-5)); ctx.lineTo(x+Math.cos(a+Math.PI/7)*(r-1),y+Math.sin(a+Math.PI/7)*(r-1)); ctx.stroke(); } }); ctx.restore(); } },
  { id:'nc', label:'Non-conformité', short:'NC',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.arc(x,y,14,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x-8,y-8); ctx.lineTo(x+8,y+8); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x+8,y-8); ctx.lineTo(x-8,y+8); ctx.stroke(); ctx.font=`bold ${7+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('NC',x-7,y+26); ctx.fillText('NC',x-7,y+26); ctx.restore(); } },
  { id:'rouille', label:'Corrosion', short:'Fe',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=s+1; ctx.beginPath(); ctx.arc(x,y,14,0,Math.PI*2); ctx.stroke(); ctx.font=`bold ${12+s}px Arial`; ctx.fillStyle=c; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeText('Fe',x-7,y+4); ctx.fillText('Fe',x-7,y+4); ctx.restore(); } },
  { id:'fontis', label:'Fontis', short:'FT',
    draw:(ctx,x,y,s,c)=>{ ctx.save(); ctx.strokeStyle=c; ctx.fillStyle=c; ctx.lineWidth=s+1; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(x-15,y-5); ctx.lineTo(x-5,y-5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x+5,y-5); ctx.lineTo(x+15,y-5); ctx.stroke(); ctx.setLineDash([3,2]); ctx.beginPath(); ctx.ellipse(x,y+8,9,5,0,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth=s+1.5; ctx.beginPath(); ctx.moveTo(x,y-16); ctx.lineTo(x,y-6); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x,y-2); ctx.lineTo(x-5,y-8); ctx.lineTo(x+5,y-8); ctx.closePath(); ctx.fill(); ctx.restore(); } },
];

export const SYMBOL_CATEGORIES = [
  { id:'fissures', label:'Fissures', ids:['fissure_verticale','fissure_oblique','fissure_oblique_linteau','fissure_oblique_allege','fissure_horizontale','fissure_plafond'] },
  { id:'degats',   label:'Dégâts',   ids:['degats_eaux','baie_deformee','devers','pente_sol'] },
  { id:'divers',   label:'Divers',   ids:['portee','nv','danger','eclat','nc','rouille','fontis'] },
];

// ── Accès localStorage TOLÉRANT aux navigateurs qui le bloquent ────────────────
// En webview embarquée (photo ouverte depuis une messagerie) ou en navigation privée iOS,
// `localStorage.getItem/setItem` LÈVE une exception (SecurityError). Non gardé, un simple
// getItem au RENDU de l'Annotateur (lecture des échelles) faisait planter TOUTE l'app
// (ErrorBoundary « Recharger l'app ») dès qu'on ouvrait une photo sur ces appareils — alors
// que le reste de l'app est déjà protégé (cf. _hasLS dans supabase.js / useAuth.js).
const _lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const _lsSet = (k, v) => {
  try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ }
  // Échelles d'annotation : les vignettes de plan (vue Visite) se redessinent à la même échelle.
  if (String(k).startsWith('chantierai_scale_')) { try { window.dispatchEvent(new Event('chantierai:annotscale')); } catch { /* ignore */ } }
};
const ANNOT_PREFS_KEY = 'chantierai_annot_prefs_v1';
const SHAPE_KEYS = ['rect', 'ellipse', 'arrow', 'line', 'poly', 'polyline'];
// Le clavier sert-il à TAPER du texte ? (champ texte, zone de texte, contenu éditable). Un
// curseur (range), une case ou un bouton n'en font pas partie : sinon Échap et les raccourcis
// étaient ignorés juste après avoir réglé une taille (retour Thomas : « Échap ne quitte pas »).
const TYPING_INPUTS = new Set(['text', 'search', 'number', 'email', 'url', 'tel', 'password', 'date', 'time', 'datetime-local']);
function isTypingTarget(t) {
  if (!t) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
  return t.tagName === 'INPUT' && TYPING_INPUTS.has(String(t.type || 'text').toLowerCase());
}
// Raccourcis clavier « une touche » (PC) : outils et formes.
const TOOL_KEYS  = { v: 'select', d: 'pen', t: 'text', f: 'shape', s: 'symbol' };
const SHAPE_HOTKEYS = { r: 'rect', e: 'ellipse', a: 'arrow', l: 'line', z: 'poly', p: 'polyline' };
const _lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } };
// Empreinte courte d'une chaîne (identifier un plan / un état d'annotations sans le stocker).
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ── Symboles personnalisés (stockés en localStorage, forme auto-générée) ──────
const CUSTOM_SYMS_KEY = 'chantierai_custom_syms_v1';
const _CSHAPES = [
  (ctx,x,y) => { ctx.beginPath(); ctx.arc(x,y,16,0,Math.PI*2); ctx.stroke(); },
  (ctx,x,y) => { ctx.beginPath(); ctx.moveTo(x,y-18); ctx.lineTo(x+14,y); ctx.lineTo(x,y+18); ctx.lineTo(x-14,y); ctx.closePath(); ctx.stroke(); },
  (ctx,x,y) => { ctx.beginPath(); ctx.rect(x-14,y-14,28,28); ctx.stroke(); },
  (ctx,x,y) => { ctx.beginPath(); ctx.moveTo(x-16,y); ctx.lineTo(x+16,y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x,y-16); ctx.lineTo(x,y+16); ctx.stroke(); },
];
function _makeCustomDraw(short, shapeIdx) {
  const shapeFn = _CSHAPES[shapeIdx % _CSHAPES.length];
  return (ctx, x, y, s, c) => {
    ctx.save();
    ctx.strokeStyle = c; ctx.lineWidth = s + 1;
    shapeFn(ctx, x, y, s, c);
    ctx.font = `bold ${8 + s}px Arial`;
    ctx.fillStyle = c; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    const tw = ctx.measureText(short).width;
    ctx.strokeText(short, x - tw / 2, y + 30); ctx.fillText(short, x - tw / 2, y + 30);
    ctx.restore();
  };
}
export function loadCustomSymbols() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_SYMS_KEY) || '[]'); } catch { return []; }
}
export function getCustomSymbolDefs() {
  return loadCustomSymbols().map((s, i) => ({ ...s, isCustom: true, draw: _makeCustomDraw(s.short, i) }));
}
export function getAllSymbols() {
  return [...SYMBOLS, ...getCustomSymbolDefs()];
}

// exportSizeMultiplier : 7 pour photos (miniature ~90px), 2 pour plans (affichés ~500px)

// Mise à l'échelle de toutes les coordonnées d'annotation (LQ ↔ HQ).
// Exportée : le rapport (RapportPreview / generateRapport) rend les annotations d'un plan sur un
// canvas dérivé de l'image HD (plus grande que l'espace de coords, qui est celui du planBg) et
// doit remettre les coords à l'échelle du canvas, sinon les marqueurs se décalent vers le coin.
export function scalePaths(paths, sx, sy) {
  if (!paths || (sx === 1 && sy === 1)) return paths;
  return paths.map(p => {
    const s = { ...p };
    if (s.x  != null) { s.x  = s.x  * sx; s.y  = s.y  * sy; }
    if (s.x1 != null) { s.x1 = s.x1 * sx; s.y1 = s.y1 * sy; s.x2 = s.x2 * sx; s.y2 = s.y2 * sy; }
    if (s.arrowX != null) { s.arrowX = s.arrowX * sx; s.arrowY = s.arrowY * sy; }
    if (s.textW  != null) s.textW = s.textW * sx;
    if (s.pts)    s.pts    = s.pts.map(pt => ({ ...pt, x: pt.x * sx, y: pt.y * sy }));
    if (s.points) s.points = s.points.map(pt => ({ ...pt, x: pt.x * sx, y: pt.y * sy }));
    return s;
  });
}

// Poignées de redimensionnement selon le type de forme
function getShapeHandles(ap) {
  if (ap.shape === 'rect' || ap.shape === 'ellipse') {
    const x1 = Math.min(ap.x1, ap.x2), y1 = Math.min(ap.y1, ap.y2);
    const x2 = Math.max(ap.x1, ap.x2), y2 = Math.max(ap.y1, ap.y2);
    return [
      { id:'nw', x:x1, y:y1 }, { id:'ne', x:x2, y:y1 },
      { id:'sw', x:x1, y:y2 }, { id:'se', x:x2, y:y2 },
    ];
  }
  if (ap.shape === 'arrow' || ap.shape === 'line') {
    return [{ id:'p1', x:ap.x1, y:ap.y1 }, { id:'p2', x:ap.x2, y:ap.y2 }];
  }
  if ((ap.shape === 'poly' || ap.shape === 'polyline') && ap.pts) {
    return ap.pts.map((pt, i) => ({ id:`v${i}`, x:pt.x, y:pt.y }));
  }
  return [];
}

// Le point `pos` est-il SUR le trait d'une forme (à moins de r) ? Test PRÉCIS (segments / bord
// d'ellipse), pas le rectangle englobant : cliquer DANS un grand contour pour commencer un
// nouveau tracé ne le sélectionne plus (retour Thomas 13/10/2026).
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function nearShapeOutline(p, pos, r) {
  if (!p) return false;
  if ((p.shape === 'poly' || p.shape === 'polyline') && p.pts?.length > 1) {
    const n = p.pts.length, segs = p.shape === 'poly' ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = p.pts[i], b = p.pts[(i + 1) % n];
      if (distToSeg(pos.x, pos.y, a.x, a.y, b.x, b.y) < r) return true;
    }
    return false;
  }
  if (p.x1 == null) return false;
  if (p.shape === 'line' || p.shape === 'arrow') return distToSeg(pos.x, pos.y, p.x1, p.y1, p.x2, p.y2) < r;
  const x1 = Math.min(p.x1, p.x2), x2 = Math.max(p.x1, p.x2), y1 = Math.min(p.y1, p.y2), y2 = Math.max(p.y1, p.y2);
  if (p.shape === 'ellipse') {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.max(1, (x2 - x1) / 2), ry = Math.max(1, (y2 - y1) / 2);
    const a = Math.atan2((pos.y - cy) / ry, (pos.x - cx) / rx);
    return Math.hypot(pos.x - (cx + rx * Math.cos(a)), pos.y - (cy + ry * Math.sin(a))) < r;
  }
  // rectangle (et toute autre forme à boîte) : les 4 côtés
  return distToSeg(pos.x, pos.y, x1, y1, x2, y1) < r || distToSeg(pos.x, pos.y, x2, y1, x2, y2) < r
    || distToSeg(pos.x, pos.y, x2, y2, x1, y2) < r || distToSeg(pos.x, pos.y, x1, y2, x1, y1) < r;
}

// ── TRACÉ ASSISTÉ (Thomas : « appli de dessin moderne ») ──
// Points d'accroche d'une annotation : extrémités, sommets, coins.
function snapPointsOf(p) {
  if (!p) return [];
  if (p.type === 'shape') {
    if (p.pts?.length) return p.pts;
    if (p.x1 == null) return [];
    if (p.shape === 'line' || p.shape === 'arrow') return [{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }];
    const x1 = Math.min(p.x1, p.x2), x2 = Math.max(p.x1, p.x2), y1 = Math.min(p.y1, p.y2), y2 = Math.max(p.y1, p.y2);
    if (p.shape === 'ellipse') return [{ x: (x1 + x2) / 2, y: y1 }, { x: x2, y: (y1 + y2) / 2 }, { x: (x1 + x2) / 2, y: y2 }, { x: x1, y: (y1 + y2) / 2 }];
    return [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
  }
  if (p.type === 'symbol' && p.x1 != null) return [{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }];
  if (p.type === 'stroke' && p.points?.length > 1) return [p.points[0], p.points[p.points.length - 1]];
  return [];
}
// Segments d'une annotation (pour s'accrocher SUR un trait, pas seulement à ses bouts).
function snapSegmentsOf(p) {
  if (!p || p.type !== 'shape') return [];
  if (p.pts?.length > 1) {
    const segs = [];
    for (let i = 0; i < p.pts.length - 1; i++) segs.push([p.pts[i], p.pts[i + 1]]);
    if (p.shape === 'poly') segs.push([p.pts[p.pts.length - 1], p.pts[0]]);
    return segs;
  }
  if (p.x1 == null || p.shape === 'ellipse') return [];
  if (p.shape === 'line' || p.shape === 'arrow') return [[{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }]];
  const c = snapPointsOf(p);
  return [[c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]]];
}
// Maj : angle multiple de 45° (même longueur).
function constrainAngle(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}
// Maj : carré / cercle parfait.
function squareFrom(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, m = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: from.x + (dx < 0 ? -m : m), y: from.y + (dy < 0 ? -m : m) };
}

// ── ÉDITION RAPIDE (multi-sélection, flèches, dupliquer) ──
// Rectangle englobant d'une annotation (coords canvas). `r` = rayon d'un point (symbole,
// viewpoint), `sT` = échelle du texte (même calcul que le hit-test du texte).
function pathBounds(p, r, sT) {
  if (!p) return null;
  const box = (xs, ys, pad = 0) => ({ x1: Math.min(...xs) - pad, y1: Math.min(...ys) - pad, x2: Math.max(...xs) + pad, y2: Math.max(...ys) + pad });
  const ptsOf = (a) => box(a.map(q => q.x), a.map(q => q.y));
  if (p.pts?.length) return ptsOf(p.pts);
  if (p.points?.length) return ptsOf(p.points);
  if (p.x1 != null) return box([p.x1, p.x2], [p.y1, p.y2]);
  if (p.type === 'text' && p.x != null) {
    const fs = (20 + (p.size || 0) * 4) * sT;
    const ls = String(p.text ?? '').split('\n');
    const w = p.textW != null ? p.textW * sT + 20 * sT : Math.max(80, ls.reduce((m, l) => Math.max(m, l.length), 0) * fs * 0.6) + 20;
    const b = { x1: p.x - 10 * sT, y1: p.y - fs - 4 * sT, x2: p.x - 10 * sT + w, y2: p.y + 10 * sT + (ls.length - 1) * fs * 1.2 };
    if (p.arrowX != null) { b.x1 = Math.min(b.x1, p.arrowX); b.y1 = Math.min(b.y1, p.arrowY); b.x2 = Math.max(b.x2, p.arrowX); b.y2 = Math.max(b.y2, p.arrowY); }
    return b;
  }
  if (p.x != null) return box([p.x], [p.y], r);
  return null;
}
// Clic sur une FORME : sur son trait, ou dans son remplissage si elle est remplie. Un contour
// vide n'attrape pas les clics en son centre → on peut sélectionner (cadre) ce qui est dedans.
// Remplie ? (une zone libre est remplie par défaut quand `filled` est absent — cf. rendu)
const isShapeFilled = (p) => (p?.shape === 'poly' ? p.filled !== false : !!p?.filled);
const FILLABLE = new Set(['rect', 'ellipse', 'poly']);
function hitsShape(p, pos, r) {
  if (nearShapeOutline(p, pos, r)) return true;
  if (!isShapeFilled(p) || !FILLABLE.has(p.shape)) return false;
  if (p.pts?.length > 2) {
    let inside = false;
    for (let i = 0, j = p.pts.length - 1; i < p.pts.length; j = i++) {
      const a = p.pts[i], c = p.pts[j];
      if ((a.y > pos.y) !== (c.y > pos.y) && pos.x < (c.x - a.x) * (pos.y - a.y) / (c.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  if (p.x1 == null) return false;
  const x1 = Math.min(p.x1, p.x2), x2 = Math.max(p.x1, p.x2), y1 = Math.min(p.y1, p.y2), y2 = Math.max(p.y1, p.y2);
  if (p.shape === 'ellipse') {
    const rx = (x2 - x1) / 2 || 1, ry = (y2 - y1) / 2 || 1;
    return ((pos.x - (x1 + rx)) / rx) ** 2 + ((pos.y - (y1 + ry)) / ry) ** 2 <= 1;
  }
  return pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2;
}
// Déplace une annotation de (dx, dy) — tous les types (points, extrémités, sommets, tracé libre).
function movePath(p, dx, dy) {
  const q = { ...p };
  if (q.x  != null) { q.x  += dx; q.y  += dy; }
  if (q.x1 != null) { q.x1 += dx; q.y1 += dy; q.x2 += dx; q.y2 += dy; }
  if (q.arrowX != null) { q.arrowX += dx; q.arrowY += dy; }
  if (p.pts)    q.pts    = p.pts.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
  if (p.points) q.points = p.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
  return q;
}

const Annotator = forwardRef(function Annotator({ bgImage, hqImage = null, savedPaths, onSave, onClose, photos, exportSizeMultiplier = 7, title, vpNumByPath = null, vpBase = 0, onPrev = null, onNext = null, photoPosition = null, initialTool = 'select', locId = null, photoVpNums = null, reportFrame = null }, ref) {
  // Annotateur ouvert → la mise à jour automatique de l'app attend sa fermeture (incident 15/10).
  useEditLock();
  const cvRef          = useRef();
  const bgRef          = useRef(null);
  const vpStart        = useRef(null);
  const textDragRef    = useRef(null); // { mode:'box'|'tip', origX/Y, origArrowX/Y, tapX, tapY }
  const porteeStartRef = useRef(null);
  const shapeStartRef  = useRef(null);
  const clipboardRef   = useRef(null); // Ctrl+C/V — copie d'annotation
  const annotDragRef   = useRef(null); // { idx, origData, tapX, tapY } — drag symbole/viewpoint
  const arrowPlaceRef  = useRef(null); // { x, y } — tip du callout flèche pendant le drag de placement
  const resizeDragRef  = useRef(null); // { handle, origData, idx } — resize poignée forme
  // Position RÉELLE du carré de redimensionnement du texte sélectionné (coords canvas),
  // renseignée pendant le dessin → garantit que le hit-test coïncide pixel-près avec ce qui
  // est affiché (la largeur mesurée diffère de l'approximation par nb de caractères).
  const resizeHandleRef = useRef(null); // { idx, x, y, twU } | null
  const arrowBaseHandleRef = useRef(null); // { idx, x, y, box:{bx,by,bw,bh,rad} } | null — base de flèche du texte sélectionné
  // Écran tactile (téléphone/tablette) : on y garde la zone de saisie du panneau texte, la saisie
  // directe sur le plan n'étant qu'un complément (clavier virtuel iOS capricieux sur focus différé).
  const isTouchUI = typeof window !== 'undefined' && (window.innerWidth < 640 || !!window.matchMedia?.('(pointer: coarse)').matches);
  const vpRotateHandleRef = useRef(null); // { idx, x, y, cx, cy } poignée de rotation du viewpoint sélectionné
  const vpRotateDragRef   = useRef(null); // { idx, cx, cy } rotation en cours
  const touchHoldRef   = useRef(null); // long-press → mode select (mobile)
  const panRef         = useRef(null); // drag clic-droit/molette → pan
  const oneFingerPanRef = useRef(null); // zoomé + 1 doigt : glisser = déplacer la vue (tap = placer)
  const hqScaleRef     = useRef(1);   // ratio HQ/LQ appliqué en session (reset à 1 sur changement de plan)
  const gvByVpIdRef    = useRef(new Map()); // _vpId → numéro Vxx global résolu au chargement (survit la migration)

  // Derniers réglages utilisés (couleur, épaisseur, symbole, forme, mode texte) : retrouvés à la
  // prochaine ouverture, comme dans toute appli de dessin. Lus une fois, jamais bloquant.
  const prefs0 = useMemo(() => { try { return JSON.parse(_lsGet(ANNOT_PREFS_KEY) || '{}') || {}; } catch { return {}; } }, []);
  const [tool,       setTool]       = useState(initialTool || 'pen');
  const [color,      setColor]      = useState(() => (typeof prefs0.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(prefs0.color) ? prefs0.color : DA.red));
  const [size,       setSize]       = useState(() => (Number.isFinite(prefs0.size) && prefs0.size > 0 && prefs0.size <= 40 ? prefs0.size : 3));
  const [sym,        setSym]        = useState(() => [...SYMBOLS, ...getCustomSymbolDefs()].find(x => x.id === prefs0.symId) || SYMBOLS[0]);
  const [paths,      setPaths]      = useState(savedPaths || []);
  const [cur,        setCur]        = useState([]);
  const [drawing,    setDrawing]    = useState(false);
  const [bgOk,       setBgOk]       = useState(false);
  const [showSyms,   setShowSyms]   = useState(false);
  const [inlineEditIdx, setInlineEditIdx] = useState(null); // null=nouveau, number=édition existant
  const [inlineEditPos, setInlineEditPos] = useState(null); // { left, top } CSS relatif au container canvas
  const [inlineEditVal, setInlineEditVal] = useState('');
  const inlineEditCanvasPt = useRef(null); // coords canvas du tap pour les nouveaux textes
  const [selTextIdx, setSelTextIdx] = useState(null);  // index dans paths du texte sélectionné
  const [activePh,   setActivePh]   = useState(null);
  const [pendingVP,  setPendingVP]  = useState(null);
  const [vt,         setVt]         = useState({ z: 1, px: 0, py: 0 });
  const vtRef     = useRef({ z: 1, px: 0, py: 0 });
  const gestureRef = useRef(null);
  const canvasWrapRef = useRef(null);

  // Échelles INDÉPENDANTES par type (texte / forme / symbole). Migrées depuis l'ancienne
  // échelle unique 'chantierai_annot_scale' pour que le rendu reste identique au repos.
  const _oldAnnot = (() => {
    const v = parseFloat(_lsGet('chantierai_annot_scale') ?? '1');
    return (isNaN(v) || v > 1.5) ? 1 : Math.max(0.3, Math.min(5, v));
  })();
  const _readScale = (key, fb) => {
    const v = parseFloat(_lsGet(key) ?? String(fb));
    return isNaN(v) ? fb : Math.max(0.3, Math.min(5, v));
  };
  // Contexte PHOTO (exportSizeMultiplier 7) vs PLAN (2) : les photos utilisent les curseurs de
  // taille PHOTOS (mêmes clés que le rapport → l'aperçu de l'annotateur correspond au rapport),
  // les plans gardent les curseurs plans. Évite que régler la taille des photos ne change les plans.
  const isPhotoCtx = exportSizeMultiplier === 7;
  const SCALE_KEY = (base) => isPhotoCtx ? `chantierai_scale_photo_${base}` : `chantierai_scale_${base}`;
  const [scaleText,   setScaleText]   = useState(() => _readScale(SCALE_KEY('text'),   isPhotoCtx ? 1 : _oldAnnot));
  const [scaleSymbol, setScaleSymbol] = useState(() => _readScale(SCALE_KEY('symbol'), isPhotoCtx ? 1 : _oldAnnot));
  const [scaleShape,  setScaleShape]  = useState(() => _readScale(SCALE_KEY('shape'),  1));
  // Épaisseur des PROCHAINES formes (retour Thomas : « je change la taille de mon trait, ça change
  // tout »). Le curseur « Formes » de l'annotateur ne touche plus le réglage global (partagé avec
  // le rapport) : forme sélectionnée → SA taille ; rien de sélectionné → les formes à venir.
  const [newShapeScale, setNewShapeScale] = useState(() => _readScale(SCALE_KEY('shape_new'), _readScale(SCALE_KEY('shape'), 1)));
  const newShapeMul = scaleShape > 0 ? newShapeScale / scaleShape : 1;
  // Tirets pour les PROCHAINES formes (mémorisé) ; une forme sélectionnée a son propre réglage.
  const [shapeDash, setShapeDash] = useState(() => prefs0.shapeDash === true);
  const shapeMulProp = {
    ...(Math.abs(newShapeMul - 1) > 0.001 ? { sizeMul: Math.round(newShapeMul * 1000) / 1000 } : {}),
    ...(shapeDash ? { dash: true } : {}),
  };
  const [shapeTool,     setShapeTool]     = useState(() => (SHAPE_KEYS.includes(prefs0.shapeTool) ? prefs0.shapeTool : 'rect')); // rect | ellipse | arrow | line | poly
  const [pendingShape,  setPendingShape]  = useState(null);
  const [shapeFilled,   setShapeFilled]   = useState(() => prefs0.shapeFilled === true);
  const [fillOpacity,   setFillOpacity]   = useState(0.3);
  const [strokeOpacity, setStrokeOpacity] = useState(1);
  const [polyPts,       setPolyPts]       = useState([]);   // sommets du polygone en cours
  const [polyMousePos,  setPolyMousePos]  = useState(null); // prévisualisation curseur
  // TERMINER une polyligne / zone en cours (retour Thomas : « je veux juste deux traits joints,
  // ça ne s'arrête pas si je ne ferme pas »). Avant : seul un double-clic au même endroit
  // terminait. Désormais aussi : Entrée, clic droit, bouton « ✓ Terminer », changer d'outil,
  // Sauvegarder (le tracé n'est plus jamais perdu). Échap = ANNULER le tracé en cours (Thomas).
  const polyMinPts = shapeTool === 'polyline' ? 2 : 3;
  const pendingPolyShape = () => (
    tool === 'shape' && (shapeTool === 'poly' || shapeTool === 'polyline') && polyPts.length >= polyMinPts
      ? { type:'shape', shape: shapeTool, pts:[...polyPts], color, size, filled: shapeTool === 'polyline' ? false : shapeFilled, fillOpacity, strokeOpacity, ...shapeMulProp }
      : null);
  const finishPoly = () => {
    const shp = pendingPolyShape();
    if (shp) addNewShape(shp);
    if (polyPts.length) { setPolyPts([]); setPolyMousePos(null); }
    return !!shp;
  };
  const finishPolyRef = useRef(finishPoly);
  finishPolyRef.current = finishPoly;
  const lastTapRef = useRef({ time: 0, x: -9999, y: -9999 });
  const lastSymPlaceRef = useRef(0);
  const [stripZoom,  setStripZoom]  = useState(null);
  const stripLPRef   = useRef({ timer: null, fired: false });
  // Aperçu photo d'un viewpoint au survol long (clic maintenu sur le marqueur, sans bouger).
  const [vpPreview, setVpPreview] = useState(null); // { src, label } | null
  const vpHoldRef    = useRef(null); // timer d'appui long sur un marqueur viewpoint
  const [customSyms,    setCustomSyms]    = useState(() => getCustomSymbolDefs());
  const [newSymName,    setNewSymName]    = useState('');
  const [showNewSym,    setShowNewSym]    = useState(false);
  const [textMode,      setTextMode]      = useState(() => (['plain', 'boxed', 'arrow'].includes(prefs0.textMode) ? prefs0.textMode : 'plain'));
  const [symCat,           setSymCat]           = useState('fissures'); // (conservé — plus d'onglets, rangée unifiée)
  const [showPalette,      setShowPalette]      = useState(false);
  const [sizeOpen,         setSizeOpen]         = useState(false); // curseur « Taille » contextuel (tuile épinglée des menus outil)
  const [pendingPortee,    setPendingPortee]    = useState(null);
  const [selAnnot,         setSelAnnot]         = useState(null); // { idx } symbole/viewpoint sélectionné
  // Multi-sélection (PC) : cadre de sélection (glisser dans le vide) ou Maj+clic.
  const [multiSel,         setMultiSel]         = useState([]);   // index sélectionnés ensemble
  const multiSelRef = useRef(multiSel); multiSelRef.current = multiSel;
  const [marquee,          setMarquee]          = useState(null); // { x1, y1, x2, y2 } cadre en cours
  const marqueeRef     = useRef(null); // { x0, y0, add: [] }
  const groupDragRef   = useRef(null); // { orig: [[idx, path]], tapX, tapY } — déplacement du groupe
  const mouseCanvasRef = useRef(null); // dernière position de la souris sur le plan (coller dessous)
  const [pendingArrowLine, setPendingArrowLine] = useState(null); // { tipX,tipY,boxX,boxY } preview flèche
  const [bgVersion,        setBgVersion]        = useState(0);   // incrémenté pour forcer redraw après swap HQ
  const [photoStripBig,    setPhotoStripBig]    = useState(false); // agrandir les miniatures de la bande "Vues"
  const [dispSize,         setDispSize]         = useState(null); // taille d'affichage CSS ajustée à la fenêtre (petite image → agrandie)

  const allSymbols = useMemo(() => [...SYMBOLS, ...customSyms], [customSyms]);

  useEffect(() => { vtRef.current = vt; }, [vt]);
  useEffect(() => {
    setVt({ z: 1, px: 0, py: 0 });
    vtRef.current = { z: 1, px: 0, py: 0 };
    // Migre les viewpoints sans _vpId pour que la numérotation globale survive le JSON round-trip.
    // Au passage, on résout le numéro global de chaque marqueur existant via la map parente
    // (résolution par référence objet AVANT que la migration ne crée de nouveaux objets) et on
    // le mémorise par _vpId dans gvByVpIdRef → relabel reste exact même après migration.
    const raw = savedPaths || [];
    const gvMap = new Map();
    const migrated = raw.map(p => {
      if (p.type !== 'viewpoint') return p;
      const np = p._vpId ? p : { ...p, _vpId: crypto.randomUUID() };
      if (vpNumByPath) {
        const n = getVpNum(vpNumByPath, p);
        if (n != null) gvMap.set(np._vpId, n);
      }
      return np;
    });
    gvByVpIdRef.current = gvMap;
    resetHistory(); // nouveau plan / nouvelle photo = nouvel historique
    setPaths(migrated);
    setSelTextIdx(null);
    hqScaleRef.current = 1;
  }, [bgImage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exposer getAnnotation() pour auto-save depuis le parent (navigation entre photos)
  useImperativeHandle(ref, () => ({
    getAnnotation: () => {
      // Flush du texte inline en cours → la navigation (plan/photo précédent/suivant) sauvegarde
      // ce qui est en train d'être tapé, sans devoir sortir du champ d'abord (demande Thomas).
      const fp = applyInlineEdit(paths);
      const cv = cvRef.current;
      if (!cv || !bgRef.current) return { paths: fp, annotated: null };
      const EW = Math.min(cv.width, 1400);
      const EH = Math.round(cv.height * EW / cv.width);
      const ec = document.createElement('canvas');
      ec.width = EW; ec.height = EH;
      const ectx = ec.getContext('2d');
      ectx.drawImage(bgRef.current, 0, 0, EW, EH);
      ectx.save();
      ectx.scale(EW / cv.width, EH / cv.height);
      const ratio = cv.clientWidth > 0 ? cv.width / cv.clientWidth : exportSizeMultiplier;
      // Même base que l'affichage live et le rapport : photos = cv.width/1400 (uniforme,
      // indépendant de l'écran), plans = planAnnotScales (largeur du plan, WYSIWYG).
      const _pl = planAnnotScales(cv.width, { text: scaleText, symbol: scaleSymbol, shape: scaleShape });
      const baseScale = isPhotoCtx ? cv.width / 1400 : _pl.sizes.text / scaleText;
      const drawScales = isPhotoCtx ? { text: baseScale * scaleText, symbol: baseScale * scaleSymbol, shape: scaleShape } : _pl.sizes;
      drawAnnotationPaths(ectx, vpNumByPath ? relabelViewpoints(fp, vpNumByPath, vpBase) : fp, drawScales, isPhotoCtx ? ratio : _pl.stroke);
      ectx.restore();
      const sc = hqScaleRef.current;
      return { paths: scalePaths(fp, 1/sc, 1/sc), annotated: ec.toDataURL('image/webp', 0.85), annotW: cv.width, annotH: cv.height, annotSizeScale: baseScale * scaleSymbol };
    },
  }), [paths, scaleText, scaleSymbol, scaleShape, exportSizeMultiplier, vpNumByPath, vpBase, inlineEditVal, inlineEditIdx, inlineEditPos]);

  // Navigation préc/suiv entre photos — via ref pour rester à jour dans le handler clavier.
  const navRef = useRef({});
  navRef.current = { onPrev, onNext };

  // Refs live pour le handler clavier (évite closure stale sur paths/selTextIdx/selAnnot)
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  // Une forme qu'on vient de tracer est SÉLECTIONNÉE (« fraîche ») : Contour/Rempli, Tirets,
  // couleur, épaisseur et Ctrl+C s'appliquent tout de suite à ELLE (retour Thomas : « je fais ma
  // forme, je clique sur Contour, ça ne marche pas tout de suite »). « Fraîche » = pas de poignées
  // ni de déplacement en mode Formes : on peut enchaîner une autre forme juste à côté.
  function addNewShape(shp) {
    const idx = pathsRef.current.length;
    setPaths(prev => [...prev, shp]);
    setSelTextIdx(null);
    setSelAnnot({ idx, fresh: true });
  }

  // ── HISTORIQUE COMPLET Annuler / Rétablir (Thomas : « appli de dessin moderne ») ──
  // Chaque modification des annotations (tracé, déplacement, couleur, taille, suppression,
  // collage…) devient un pas d'historique. Un geste (glisser) = UN pas, enregistré au relâchement.
  // Des retouches successives du MÊME élément à moins de 600 ms (curseur, frappe) = un seul pas.
  // Les opérations SYSTÈME (chargement, passage du plan en haute définition) ne sont pas des pas :
  // elles recalent l'historique (mise à l'échelle) sans rien annuler.
  const polyPtsRef = useRef(polyPts); polyPtsRef.current = polyPts;
  // Repère visuel « ça s'aimante ici » (point ou trait existant).
  const [snapHint, setSnapHint] = useState(null); // { x, y, kind:'point'|'seg' } | null
  const updateSnapHint = (h) => setSnapHint(prev => ((prev?.x === h?.x && prev?.y === h?.y && prev?.kind === h?.kind) ? prev : (h || null)));
  // Position assistée : Maj = contrainte (angle 45° depuis `from`, ou carré si `square`) ;
  // sinon aimantation sur les points/traits existants (Alt = désactivée). `exclude` = index des
  // annotations en cours de modification (on ne s'accroche pas à soi-même).
  const assistPos = (pos, e, { from = null, square = false, exclude = null, extraPts = null } = {}) => {
    if (e?.shiftKey && from) return { pos: square ? squareFrom(from, pos) : constrainAngle(from, pos), hint: null };
    if (e?.altKey) return { pos, hint: null };
    const cv = cvRef.current;
    if (!cv || !cv.clientWidth) return { pos, hint: null };
    const R = 12 * (cv.width / cv.clientWidth) / (vtRef.current.z || 1);
    let best = null, bd = R;
    const tryPt = (q) => { const d = Math.hypot(q.x - pos.x, q.y - pos.y); if (d < bd) { bd = d; best = { x: q.x, y: q.y, kind: 'point' }; } };
    pathsRef.current.forEach((p, i) => { if (!exclude || !exclude.has(i)) snapPointsOf(p).forEach(tryPt); });
    (extraPts || []).forEach(tryPt);
    if (!best) {
      bd = R;
      pathsRef.current.forEach((p, i) => {
        if (exclude && exclude.has(i)) return;
        for (const [a, b] of snapSegmentsOf(p)) {
          const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
          if (!l2) continue;
          const t = Math.max(0, Math.min(1, ((pos.x - a.x) * dx + (pos.y - a.y) * dy) / l2));
          const q = { x: a.x + t * dx, y: a.y + t * dy };
          const d = Math.hypot(q.x - pos.x, q.y - pos.y);
          if (d < bd) { bd = d; best = { ...q, kind: 'seg' }; }
        }
      });
    }
    return best ? { pos: { x: best.x, y: best.y }, hint: best } : { pos, hint: null };
  };
  const histRef = useRef({ undo: [], redo: [] });
  const committedRef = useRef(paths);   // dernier état « validé » (référence de comparaison)
  const baselineRef = useRef(paths);    // état à l'ouverture (→ modifications non enregistrées ?)
  const skipHistRef = useRef(null);     // 'undo' | 'system' → le prochain changement n'est pas un pas
  const lastPushRef = useRef({ ts: 0, kind: '' });
  const gestureChangedRef = useRef(false); // modifié PENDANT un geste (glisser) → un pas à lui seul
  const [histTick, setHistTick] = useState(0);
  const HIST_MAX = 150;
  useEffect(() => {
    const mode = skipHistRef.current;
    if (mode) {
      skipHistRef.current = null;
      committedRef.current = paths;
      if (mode === 'system') baselineRef.current = paths;
      setHistTick(t => t + 1);
      return;
    }
    const prev = committedRef.current;
    if (drawing) { if (paths !== prev) gestureChangedRef.current = true; return; } // geste → enregistré au relâchement
    if (paths === prev) return;
    const now = Date.now();
    // Retouche d'UN SEUL et même élément (curseur, frappe) → regroupable ; tout le reste = un pas.
    let key = -1;
    if (prev.length === paths.length) {
      for (let i = 0; i < paths.length; i++) if (paths[i] !== prev[i]) { if (key !== -1) { key = -2; break; } key = i; }
    }
    const kind = gestureChangedRef.current ? 'gesture' : (key >= 0 ? 'modify' : 'other');
    gestureChangedRef.current = false;
    const lp = lastPushRef.current;
    const coalesce = kind === 'modify' && lp.kind === 'modify' && lp.key === key && now - lp.ts < 600 && histRef.current.undo.length;
    if (!coalesce) {
      histRef.current.undo.push(prev);
      if (histRef.current.undo.length > HIST_MAX) histRef.current.undo.shift();
    }
    lastPushRef.current = { ts: now, kind, key };
    histRef.current.redo = [];
    committedRef.current = paths;
    setHistTick(t => t + 1);
  }, [paths, drawing]);
  // Mise à l'échelle SYSTÈME (sur-échantillonnage, plan HD) : tout l'historique suit.
  const scaleHistory = (sx, sy) => {
    const h = histRef.current;
    h.undo = h.undo.map(a => scalePaths(a, sx, sy));
    h.redo = h.redo.map(a => scalePaths(a, sx, sy));
    skipHistRef.current = 'system';
  };
  const resetHistory = () => {
    histRef.current = { undo: [], redo: [] };
    lastPushRef.current = { ts: 0, kind: '' };
    skipHistRef.current = 'system';
  };
  const clearSelections = () => { setSelAnnot(null); setSelTextIdx(null); setMultiSel([]); annotDragRef.current = null; textDragRef.current = null; };
  const undoLast = () => {
    // Tracé en cours (polyligne / zone) : Annuler retire d'abord le DERNIER POINT posé.
    if (polyPtsRef.current.length) { setPolyPts(pp => pp.slice(0, -1)); return; }
    const h = histRef.current;
    if (!h.undo.length) return;
    h.redo.push(committedRef.current);
    const prev = h.undo.pop();
    lastPushRef.current = { ts: 0, kind: '' };
    skipHistRef.current = 'undo';
    clearSelections();
    setPaths(prev);
  };
  const redoLast = () => {
    const h = histRef.current;
    if (!h.redo.length) return;
    h.undo.push(committedRef.current);
    const next = h.redo.pop();
    lastPushRef.current = { ts: 0, kind: '' };
    skipHistRef.current = 'undo';
    clearSelections();
    setPaths(next);
  };
  const undoRef = useRef(undoLast); undoRef.current = undoLast;
  const redoRef = useRef(redoLast); redoRef.current = redoLast;
  const canUndo = histRef.current.undo.length > 0 || polyPts.length > 0;
  const canRedo = histRef.current.redo.length > 0;
  const isDirty = paths !== baselineRef.current;
  void histTick; // (re-rendu des boutons quand l'historique change)

  // ── BROUILLON AUTOMATIQUE (« ne jamais perdre ») ──
  // Pendant l'annotation, l'état courant est copié sur l'appareil (localStorage) dès qu'il diffère
  // de l'état enregistré. Fermeture accidentelle, onglet tué, batterie… → à la réouverture du MÊME
  // plan/photo (et si rien n'a été enregistré entre-temps), on propose de reprendre.
  const draftKey = useMemo(() => {
    const b = String(bgImage || '');
    // URL signée : le jeton change à chaque session → on ne garde que le chemin.
    const ident = b.startsWith('data:') ? `${b.length}|${b.slice(0, 120)}|${b.slice(-120)}` : b.split('?')[0];
    return `chantierai_annot_draft_v1:${locId ?? ''}:${hashStr(String(title ?? ''))}:${hashStr(ident)}`;
  }, [bgImage, locId, title]);
  const baseHash = useMemo(() => hashStr(JSON.stringify(savedPaths || [])), [savedPaths]);
  const clearDraft = () => _lsDel(draftKey);
  const [draftOffer, setDraftOffer] = useState(null); // { ts, paths } proposé à la reprise
  const [closeAsk, setCloseAsk] = useState(false);    // « Enregistrer les modifications ? »
  useEffect(() => {
    if (!bgOk || draftOffer) return; // reprise proposée → on ne touche pas au brouillon tant qu'on n'a pas répondu
    const t = setTimeout(() => {
      if (paths === baselineRef.current) { _lsDel(draftKey); return; }
      try {
        const sc = hqScaleRef.current || 1;
        const json = JSON.stringify({ ts: Date.now(), base: baseHash, paths: scalePaths(paths, 1 / sc, 1 / sc) });
        if (json.length < 2_500_000) _lsSet(draftKey, json);
      } catch { /* quota / sérialisation : le brouillon est un bonus, jamais bloquant */ }
    }, 800);
    return () => clearTimeout(t);
  }, [paths, bgOk, draftKey, baseHash, draftOffer]);
  // Reprise : vérifiée une fois le plan chargé (échelle connue).
  useEffect(() => {
    if (!bgOk) return;
    let d = null;
    try { d = JSON.parse(_lsGet(draftKey) || 'null'); } catch { d = null; }
    if (!d || !Array.isArray(d.paths)) return;
    // Seul l'ÂGE invalide un brouillon (30 j). Avant, un brouillon était EFFACÉ dès que l'état
    // enregistré du plan avait changé entre-temps (autre appareil, synchro…) → travail perdu
    // (incident 15/10). On le propose désormais quand même ; « Ignorer » le supprime.
    const stale = Date.now() - (d.ts || 0) > 30 * 24 * 3600 * 1000;
    if (stale) { _lsDel(draftKey); return; }
    if (JSON.stringify(d.paths) === JSON.stringify(savedPaths || [])) { _lsDel(draftKey); return; }
    setDraftOffer(d);
  }, [bgOk, draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const resumeDraft = () => {
    if (!draftOffer) return;
    const sc = hqScaleRef.current || 1;
    setPaths(scalePaths(draftOffer.paths, sc, sc)); // = une modification (annulable avec Ctrl+Z)
    setDraftOffer(null);
  };
  const dismissDraft = () => { clearDraft(); setDraftOffer(null); };
  const selTextIdxRef = useRef(selTextIdx);
  selTextIdxRef.current = selTextIdx;
  const selAnnotRef = useRef(selAnnot);
  selAnnotRef.current = selAnnot;

  const vpCount = paths.filter(p => p.type === 'viewpoint').length;
  // Numérotation Vxx : p.vpNum (figé à la pose, source de vérité) > numéro résolu au
  // chargement (gvByVpIdRef) > numérotation globale (vpNumByPath).
  const resolveGv = (p) => {
    // Numéro GLOBAL COMPACT d'abord (cohérent avec le rapport et les vignettes) : gvByVpIdRef
    // (résolu au chargement, survit à la migration JSON) puis vpNumByPath. Le numéro figé
    // p.vpNum n'est qu'un REPLI : il peut être périmé (ex. baké à V11 lors d'une session passée)
    // et ne doit PAS masquer le vrai numéro compact — sinon l'annotateur affiche V11 alors que le
    // rapport affiche V1.
    const g = gvByVpIdRef.current.get(p._vpId);
    if (g != null) return g;
    if (vpNumByPath) { const n = getVpNum(vpNumByPath, p); if (n != null) return n; }
    return p.vpNum != null ? p.vpNum : null;
  };
  // Prochain numéro libre : max(global, numéros du plan courant) + 1 — jamais de réutilisation.
  const ownVpMax = paths.reduce((m, p) => p.type === 'viewpoint' ? Math.max(m, p.vpNum ?? resolveGv(p) ?? 0) : m, 0);
  const nextVpNum = Math.max(vpBase, ownVpMax) + 1;
  const nextVpLabel = vpNumByPath ? `V${nextVpNum}` : `V${vpCount + 1}`;
  const nextVpNumRef = useRef(nextVpNum);
  nextVpNumRef.current = nextVpNum;

  // ── ÉDITION RAPIDE : sélection courante, copier/coller/dupliquer, flèches ──
  const cvRatio = () => { const cv = cvRef.current; return cv && cv.clientWidth ? cv.width / cv.clientWidth : 1; };
  // Échelle du TEXTE en pixels canvas (hit-tests, cadres, redimensionnement) — même règle que le dessin.
  const textScaleNow = () => {
    const cv = cvRef.current;
    if (!cv) return scaleText;
    return isPhotoCtx ? cvRatio() * 0.5 * scaleText : planAnnotScales(cv.width, { text: scaleText }).sizes.text;
  };
  const boundsOf = (p) => pathBounds(p, 22 * cvRatio(), textScaleNow());
  // Sélection courante en index : groupe > forme/symbole/viewpoint > texte.
  const selectedIdxs = () => multiSelRef.current.length ? multiSelRef.current
    : selAnnotRef.current ? [selAnnotRef.current.idx]
    : selTextIdxRef.current != null ? [selTextIdxRef.current] : [];
  // Sélectionne une liste d'index : un seul élément « classique » → sélection habituelle
  // (avec ses panneaux) ; sinon → groupe.
  const selectIdxs = (arr, src = pathsRef.current) => {
    const list = [...new Set(arr)].filter(i => src[i]).sort((a, b) => a - b);
    const one = list.length === 1 ? src[list[0]] : null;
    setSelAnnot(null); setSelTextIdx(null); annotDragRef.current = null; textDragRef.current = null;
    if (one && one.type === 'text') { setMultiSel([]); setSelTextIdx(list[0]); }
    else if (one && one.type !== 'stroke') { setMultiSel([]); setSelAnnot({ idx: list[0] }); }
    else setMultiSel(list);
  };
  // Copies d'annotations décalées de (dx, dy) ; un viewpoint copié = NOUVELLE vue (numéro neuf,
  // délié de la photo d'origine), comme « Dupliquer ».
  const cloneAnnots = (list, dx, dy) => {
    let vn = nextVpNumRef.current;
    return list.map(src => {
      const c = movePath(src, dx, dy);
      if (c._vpId) c._vpId = crypto.randomUUID();
      if (c.type === 'viewpoint') { c.vpNum = vn++; c.label = `V${c.vpNum}`; c.photoIdx = null; c.originLocId = locId ?? null; }
      return c;
    });
  };
  // Ajoute des copies et les sélectionne. `atMouse` : le groupe est centré sous la souris
  // (Ctrl+V) ; sinon décalé de 40 px (Ctrl+D).
  // Collages successifs au même endroit : décalés en CASCADE (+24 px à chaque fois) au lieu de
  // s'empiler pile les uns sur les autres (retour Thomas : « fluidifier les copier-coller »).
  const pasteCascadeRef = useRef({ key: '', n: 0 });
  const pasteAnnots = (list, atMouse) => {
    if (!list?.length) return;
    let dx = 40, dy = 40;
    const m = mouseCanvasRef.current;
    if (atMouse && m) {
      const bs = list.map(boundsOf).filter(Boolean);
      if (bs.length) {
        const cx = (Math.min(...bs.map(b => b.x1)) + Math.max(...bs.map(b => b.x2))) / 2;
        const cy = (Math.min(...bs.map(b => b.y1)) + Math.max(...bs.map(b => b.y2))) / 2;
        dx = m.x - cx; dy = m.y - cy;
        // Souris restée sur l'original (Ctrl+C puis Ctrl+V sans bouger) : la copie se posait
        // PILE dessus → « le copier-coller ne marche pas » (retour Thomas). On la décale.
        if (Math.hypot(dx, dy) < 30 * cvRatio()) { dx = 40; dy = 40; }
      }
    }
    const key = `${Math.round(dx)}|${Math.round(dy)}|${list.length}`;
    const pc = pasteCascadeRef.current;
    pc.n = pc.key === key ? pc.n + 1 : 0; pc.key = key;
    const step = 24 * cvRatio() * pc.n;
    const start = pathsRef.current.length;
    const next = [...pathsRef.current, ...cloneAnnots(list, dx + step, dy + step)];
    setPaths(next);
    // On RESTE dans l'outil en cours (la copie est sélectionnée, déplaçable tout de suite) ;
    // seul un GROUPE impose l'outil Sélection (la multi-sélection y vit).
    if (list.length > 1 && tool !== 'select') setTool('select');
    selectIdxs(next.map((_, k) => k).slice(start), next);
  };
  const copySelection = () => {
    const idxs = selectedIdxs();
    if (!idxs.length) return false;
    clipboardRef.current = idxs.map(i => pathsRef.current[i]).filter(Boolean).map(p => movePath(p, 0, 0));
    return true;
  };
  const duplicateSelection = () => {
    const idxs = selectedIdxs();
    if (!idxs.length) return false;
    pasteAnnots(idxs.map(i => pathsRef.current[i]).filter(Boolean), false);
    return true;
  };
  // Flèches : déplace la sélection d'1 px écran (Maj : 10 px).
  const nudgeSelection = (ux, uy, big) => {
    const idxs = selectedIdxs();
    if (!idxs.length) return false;
    const step = (big ? 10 : 1) * cvRatio() / (vtRef.current.z || 1);
    const set = new Set(idxs);
    setPaths(prev => prev.map((p, i) => set.has(i) ? movePath(p, ux * step, uy * step) : p));
    return true;
  };
  // Ordre des calques (demande Thomas) : dir = +1 « Avancer », -1 « Reculer ». Un élément seul passe
  // au-dessus (ou au-dessous) du PROCHAIN élément qui le chevauche → effet visible à chaque clic
  // (sinon tout en haut / tout en bas) ; un groupe passe d'un coup au premier / à l'arrière-plan.
  // Les vues (V1, V2…) ne bougent pas. Les objets ne sont que réordonnés : aucune donnée modifiée.
  const reorderSelection = (dir) => {
    const ps = pathsRef.current;
    const idxs = selectedIdxs().filter(i => ps[i] && ps[i].type !== 'viewpoint');
    if (!idxs.length) return false;
    const set = new Set(idxs);
    let order; // nouvel ordre = liste d'index d'origine
    if (idxs.length === 1) {
      const i = idxs[0], bi = boundsOf(ps[i]);
      const overlaps = (j) => { const b = boundsOf(ps[j]); return bi && b && b.x1 <= bi.x2 && b.x2 >= bi.x1 && b.y1 <= bi.y2 && b.y2 >= bi.y1; };
      let j = -1;
      if (dir > 0) { for (let k = i + 1; k < ps.length; k++) if (overlaps(k)) { j = k; break; } if (j < 0) j = ps.length - 1; }
      else { for (let k = i - 1; k >= 0; k--) if (overlaps(k)) { j = k; break; } if (j < 0) j = 0; }
      if (j === i) return true;
      order = ps.map((_, k) => k).filter(k => k !== i);
      order.splice(j, 0, i);
    } else {
      const rest = ps.map((_, k) => k).filter(k => !set.has(k));
      order = dir > 0 ? [...rest, ...idxs] : [...idxs, ...rest];
    }
    const pos = new Map(order.map((orig, k) => [orig, k]));
    setPaths(order.map(k => ps[k]));
    if (multiSelRef.current.length) setMultiSel(multiSelRef.current.map(k => pos.get(k)));
    else if (selAnnotRef.current) setSelAnnot({ ...selAnnotRef.current, idx: pos.get(selAnnotRef.current.idx) });
    else if (selTextIdxRef.current != null) setSelTextIdx(pos.get(selTextIdxRef.current));
    return true;
  };
  const deleteSelectionGroup = () => {
    const idxs = multiSelRef.current;
    if (!idxs.length) return false;
    const set = new Set(idxs);
    setPaths(prev => {
      const hadVp = prev.some((p, i) => set.has(i) && p.type === 'viewpoint');
      const next = prev.filter((_, i) => !set.has(i));
      return hadVp ? resequenceVps(next) : next;
    });
    setMultiSel([]);
    return true;
  };
  const selectAll = () => {
    if (!pathsRef.current.length) return false;
    setTool('select'); setShowSyms(false);
    setPolyPts([]); setPolyMousePos(null);
    selectIdxs(pathsRef.current.map((_, i) => i));
    return true;
  };
  // Le groupe n'existe qu'avec l'outil Sélection.
  useEffect(() => { if (tool !== 'select') setMultiSel([]); }, [tool]);
  // Choisir un outil (barre d'outils ET raccourci clavier).
  const selectTool = (k) => {
    finishPoly(); // tracé en cours (polyligne/zone) conservé, pas jeté
    setTool(k);
    if (k === 'symbol') setShowSyms(v => !v); else setShowSyms(false);
    setShowPalette(false); // UN SEUL tiroir à la fois : changer d'outil replie la palette
    setSizeOpen(false);
    if (k !== 'text') { setSelTextIdx(null); textDragRef.current = null; }
    if (k !== 'viewpoint') setActivePh(null);
    if (k !== 'shape') { setPendingShape(null); shapeStartRef.current = null; }
    setSelAnnot(null); annotDragRef.current = null;
  };
  const pickShape = (k) => {
    if (tool !== 'shape') selectTool('shape');
    else if (k !== shapeTool) finishPoly();
    setShapeTool(k);
  };
  // Mémorise les derniers réglages (cf. prefs0).
  useEffect(() => {
    _lsSet(ANNOT_PREFS_KEY, JSON.stringify({ color, size, symId: sym?.id, shapeTool, shapeFilled, shapeDash, textMode }));
  }, [color, size, sym, shapeTool, shapeFilled, shapeDash, textMode]);

  // ── CONFORT DE VUE : zoom clavier, Espace + glisser, double-clic = vue entière ──
  // Zoom vers `z` en gardant fixe le point à (mx, my) px du centre du plan affiché ;
  // par défaut le centre de l'écran.
  const zoomTo = (z, mx = -vtRef.current.px, my = -vtRef.current.py) => {
    const cv = cvRef.current;
    if (!cv) return;
    const c = vtRef.current;
    const nz = Math.min(6, Math.max(1, z));
    const r = nz / c.z;
    const maxPx = cv.clientWidth * (nz - 1) / 2, maxPy = cv.clientHeight * (nz - 1) / 2;
    const next = nz <= 1.001 ? { z: 1, px: 0, py: 0 }
      : { z: nz, px: Math.max(-maxPx, Math.min(maxPx, c.px + mx * (1 - r))), py: Math.max(-maxPy, Math.min(maxPy, c.py + my * (1 - r))) };
    vtRef.current = next; setVt(next);
  };
  const spaceRef = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false); // Espace maintenu → curseur « main »
  const [showHelp, setShowHelp] = useState(false);   // aide des raccourcis (touche ?)

  // Ctrl/Cmd + clic (ou Maj + clic) sur un élément DEPUIS un outil de tracé : l'ajoute (ou le retire)
  // de la sélection et passe en Sélection → on peut prendre 2 lignes et leur appliquer les mêmes réglages.
  const toggleSelAt = (pos) => {
    const r = 18 * cvRatio(), pad = 11 * cvRatio();
    const ps = pathsRef.current;
    const hitOne = (q) => {
      if (!q) return false;
      if (q.type === 'shape') return hitsShape(q, pos, r);
      const b = boundsOf(q);
      return !!b && pos.x >= b.x1 - pad && pos.x <= b.x2 + pad && pos.y >= b.y1 - pad && pos.y <= b.y2 + pad;
    };
    let hit = -1;
    for (let i = ps.length - 1; i >= 0; i--) { if (hitOne(ps[i])) { hit = i; break; } }
    if (hit < 0) return false;
    const cur = selectedIdxs();
    setTool('select'); setPolyPts([]); setPolyMousePos(null);
    selectIdxs(cur.includes(hit) ? cur.filter(i => i !== hit) : [...cur, hit]);
    return true;
  };
  const editOpsRef = useRef(null);
  editOpsRef.current = { copySelection, pasteAnnots, duplicateSelection, nudgeSelection, deleteSelectionGroup, selectAll, selectTool, pickShape, zoomTo, reorderSelection };
  const relabel = (arr) => {
    if (!vpNumByPath) return arr;
    let extra = 0;
    return arr.map(p => {
      if (p.type !== 'viewpoint') return p;
      const g = resolveGv(p);
      if (g != null) return { ...p, label: `V${g}` };
      extra += 1;
      return { ...p, label: `V${vpBase + extra}` };
    });
  };

  // Renumérote les viewpoints du plan de façon COMPACTE (V1,V2,… sans trou) après suppression.
  // Le numéro figé (vpNum) est la source de vérité → on le réécrit dans l'ordre courant des
  // marqueurs, en repartant de vpBase+1 (les numéros des autres plans/observations sont déjà
  // comptés via vpBase). Au niveau rapport, la numérotation se ré-harmonise par identité photo.
  const vpBaseRef = useRef(vpBase); vpBaseRef.current = vpBase;
  const resequenceVps = (arr) => {
    // Recompaction après suppression. ANCRE = plus petit numéro global ACTUEL sur ce plan (et non
    // vpBase) → on recompacte la plage du plan SANS la décaler vers des numéros hauts (sinon on
    // réintroduirait V11). On met aussi à jour gvByVpIdRef pour que l'affichage live (resolveGv,
    // qui lit gvByVpIdRef en priorité) reflète immédiatement la recompaction. La recompaction
    // GLOBALE définitive (1..N) est refaite par computeVpNumbering au prochain rendu du rapport.
    const vps = arr.filter(p => p.type === 'viewpoint');
    if (!vps.length) return arr;
    let base = Infinity;
    for (const p of vps) { const n = resolveGv(p); if (typeof n === 'number') base = Math.min(base, n); }
    if (!isFinite(base)) base = (vpBaseRef.current || 0) + 1;
    let k = base - 1;
    return arr.map(p => {
      if (p.type !== 'viewpoint') return p;
      k += 1;
      if (p._vpId) gvByVpIdRef.current.set(p._vpId, k);
      return { ...p, vpNum: k, label: `V${k}` };
    });
  };

  // Appui long (sans bouger) sur un marqueur viewpoint → affiche la photo correspondante.
  // Annulé dès qu'on bouge (cf. onMove) → le déplacement du marqueur reste prioritaire.
  const startVpHold = (vp) => {
    clearTimeout(vpHoldRef.current);
    vpHoldRef.current = setTimeout(() => {
      vpHoldRef.current = null;
      const ph = (photos || [])[vp.photoIdx];
      const src = ph?.annotated || ph?.data || null;
      const label = `V${resolveGv(vp) ?? vp.vpNum ?? ''}`;
      if (src) setVpPreview({ src, label });
      else setVpPreview({ src: null, label });
    }, 450);
  };
  const endVpHold = () => { clearTimeout(vpHoldRef.current); vpHoldRef.current = null; setVpPreview(null); };

  const redraw = useCallback(() => {
    const cv = cvRef.current;
    if (!cv || !bgOk) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (bgRef.current) ctx.drawImage(bgRef.current, 0, 0, cv.width, cv.height);

    const ratio = cv.clientWidth > 0 ? cv.width / cv.clientWidth : 1;
    // Photos : échelle texte/symboles = largeur naturelle / 1400 (indépendante de l'écran),
    // IDENTIQUE au rapport → l'aperçu reflète exactement le rendu final, et toutes les photos
    // sont uniformes. Plans : inchangé (ratio*0.5, comportement validé).
    // Plans : échelle UNIQUE proportionnelle au plan (planAnnotScales) — identique vue Visite + rapport.
    const _pl = planAnnotScales(cv.width, { text: scaleText, symbol: scaleSymbol, shape: scaleShape });
    const baseScale = isPhotoCtx ? cv.width / 1400 : _pl.sizes.text / scaleText;
    const sText = baseScale * scaleText;   // échelle texte
    const sSym  = baseScale * scaleSymbol; // échelle symboles + viewpoints
    const strokeScale = isPhotoCtx ? ratio : _pl.stroke; // photos : pixels écran (inchangé) ; plans : proportionnel au plan
    const drawScales = { text: sText, symbol: sSym, shape: scaleShape };

    const all = [...paths, ...(cur.length > 1 && (tool === 'pen' || tool === 'eraser') ? [{ type:'stroke', tool, points:cur, color, size }] : [])];
    drawAnnotationPaths(ctx, relabel(all), drawScales, strokeScale);

    if (pendingVP) {
      ctx.save();
      if (sSym > 1) {
        ctx.translate(pendingVP.x, pendingVP.y);
        ctx.scale(sSym, sSym);
        ctx.translate(-pendingVP.x, -pendingVP.y);
      }
      drawVP(ctx, { ...pendingVP, label: nextVpLabel, color, size });
      ctx.restore();
    }

    if (pendingPortee) {
      if (pendingPortee.symbolId === 'pente_sol') {
        drawPenteSolPath(ctx, pendingPortee.x1, pendingPortee.y1, pendingPortee.x2, pendingPortee.y2, size * sSym, color);
      } else {
        drawPorteePath(ctx, pendingPortee.x1, pendingPortee.y1, pendingPortee.x2, pendingPortee.y2, size * sSym, color);
      }
    }

    if (pendingShape && tool === 'shape') {
      drawAnnotationPaths(ctx, [{ type: 'shape', shape: shapeTool, ...pendingShape, color, size, filled: shapeFilled, fillOpacity, strokeOpacity, ...shapeMulProp }], drawScales, strokeScale);
    }

    // Poignées des textes (visibles en mode Texte ET Sélect. → on peut bouger cadre + flèche)
    if (tool === 'text' || tool === 'select') {
      resizeHandleRef.current = null; // recalculé ci-dessous si un texte encadré est sélectionné
      arrowBaseHandleRef.current = null;
      // zH = zoom courant : les poignées sont dessinées dans le canvas puis AGRANDIES par le
      // transform CSS scale(vt.z). On divise par zH pour qu'elles gardent une taille ~constante à
      // l'écran quel que soit le zoom (sinon, zoomé ×5, la pastille bleue devient énorme).
      const zH = vtRef.current.z || 1;
      paths.forEach((p, i) => {
        if (p.type !== 'text') return;
        const isSel = i === selTextIdx;
        // Pendant le DÉPLACEMENT du texte, on n'affiche pas les pastilles (elles masquaient la position).
        if (isSel && textDragRef.current?.mode === 'box' && textDragRef.current.moved) return;
        // PC : pastilles plus petites → placement précis (retour Thomas). Tactile : inchangé.
        const hr = (isTouchUI ? (isSel ? 10 : 7) : (isSel ? 6.5 : 4.5)) * ratio / zH; // taille écran ~constante (indépendante du zoom)
        ctx.save();
        ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = (isSel ? 2.5 : 1.5) * ratio / zH;
        // Boîte de texte : fond blanc + bordure bleue (visible)
        ctx.fillStyle = 'white'; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(p.x, p.y, hr, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = isSel ? 'rgba(74,158,255,0.7)' : 'rgba(74,158,255,0.35)';
        ctx.beginPath(); ctx.arc(p.x, p.y, hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (p.textMode === 'arrow' && p.arrowX != null) {
          ctx.strokeStyle = '#FF9500'; ctx.lineWidth = (isSel ? 2.5 : 1.5) * ratio / zH;
          // Décaler le centre du cercle en arrière de hr px pour que son bord avant
          // coïncide exactement avec la pointe de la flèche (arrowX/arrowY)
          const ta = Math.atan2(p.arrowY - p.y, p.arrowX - p.x);
          const hcx = p.arrowX - Math.cos(ta) * hr;
          const hcy = p.arrowY - Math.sin(ta) * hr;
          ctx.fillStyle = 'white'; ctx.globalAlpha = 0.9;
          ctx.beginPath(); ctx.arc(hcx, hcy, hr, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1; ctx.fillStyle = isSel ? 'rgba(255,149,0,0.7)' : 'rgba(255,149,0,0.35)';
          ctx.beginPath(); ctx.arc(hcx, hcy, hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        if (isSel) {
          const fsU = 20 + p.size * 4;
          const fs = fsU * sText;
          const _lh = fs * 1.2;
          ctx.font = `bold ${fsU}px Arial`;
          let _lines = String(p.text ?? '').split('\n');
          let twU;
          if (p.textW) {
            const wrapped = [];
            for (const ln of _lines) {
              const words = ln.split(' ');
              let cur = '';
              for (const w of words) {
                const test = cur ? cur + ' ' + w : w;
                if (ctx.measureText(test).width <= p.textW) cur = test;
                else { if (cur) wrapped.push(cur); cur = w; }
              }
              wrapped.push(cur);
            }
            _lines = wrapped.length ? wrapped : [''];
            twU = _lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0); // colle à la ligne réelle, pas à textW
          } else {
            twU = _lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
          }
          const tw = twU * sText;
          const padX = Math.max(4, fsU * 0.16) * sText; // mêmes proportions que le cadre dessiné (drawAnnotationPaths)
          const pad  = Math.max(6, fsU * 0.24) * sText;
          const bx = p.x - padX, by = p.y - fs - 4 * sText;
          const bw = tw + padX * 2, bh = fs + (_lines.length - 1) * _lh + pad + 6 * sText;
          ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = 2 * ratio / zH; ctx.setLineDash([4 * ratio / zH, 3 * ratio / zH]);
          ctx.strokeRect(bx, by, bw, bh);
          ctx.setLineDash([]);
          if (p.textMode === 'boxed' || p.textMode === 'arrow') {
            const rhs = (isTouchUI ? 8 : 5.5) * ratio / zH;
            const hrX = bx + bw, hrY = by;
            // Mémorise la position EXACTE du carré pour le hit-test (twU = largeur non scalée).
            resizeHandleRef.current = { idx: i, x: hrX, y: hrY, twU };
            ctx.fillStyle = 'white'; ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = 2 * ratio / zH;
            ctx.beginPath(); ctx.rect(hrX - rhs, hrY - rhs, rhs * 2, rhs * 2); ctx.fill(); ctx.stroke();
          }
          // Base de la flèche : losange orange GLISSABLE le long du pourtour du cadre.
          if (p.textMode === 'arrow' && p.arrowX != null) {
            const rad = 8 * sText;
            let b = arrowAtPoint(p, bx, by, bw, bh);
            if (!b) { // base auto : même calcul que le rendu (rayon centre → pointe)
              const cx = bx + bw / 2, cy = by + bh / 2, ddx = p.arrowX - cx, ddy = p.arrowY - cy;
              if (Math.abs(ddx) < 0.5 && Math.abs(ddy) < 0.5) b = { x: cx, y: by + bh };
              else if ((bw / 2) * Math.abs(ddy) <= (bh / 2) * Math.abs(ddx)) { const s2 = ddx > 0 ? 1 : -1; b = { x: cx + s2 * bw / 2, y: cy + (ddy / ddx) * s2 * bw / 2 }; }
              else { const s2 = ddy > 0 ? 1 : -1; b = { x: cx + (ddx / ddy) * s2 * bh / 2, y: cy + s2 * bh / 2 }; }
            }
            arrowBaseHandleRef.current = { idx: i, x: b.x, y: b.y, box: { bx, by, bw, bh, rad } };
            const dh = (isTouchUI ? 7 : 5.5) * ratio / zH;
            ctx.fillStyle = 'white'; ctx.strokeStyle = '#FF9500'; ctx.lineWidth = 2 * ratio / zH;
            ctx.beginPath(); ctx.moveTo(b.x, b.y - dh); ctx.lineTo(b.x + dh, b.y); ctx.lineTo(b.x, b.y + dh); ctx.lineTo(b.x - dh, b.y); ctx.closePath();
            ctx.fill(); ctx.stroke();
          }
        }
        ctx.restore();
      });
    }

    // Ligne de prévisualisation flèche-callout (pendant le drag de placement)
    if (pendingArrowLine) {
      const { tipX, tipY, boxX, boxY } = pendingArrowLine;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(boxX, boxY); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(tipX, tipY, 7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.45; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(boxX, boxY, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Prévisualisation polygone en cours
    if (polyPts.length > 0 && tool === 'shape' && (shapeTool === 'poly' || shapeTool === 'polyline')) {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = size * strokeScale;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // Segments déjà tracés
      ctx.beginPath();
      ctx.moveTo(polyPts[0].x, polyPts[0].y);
      polyPts.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
      // Ligne de preview vers le curseur
      if (polyMousePos) {
        ctx.setLineDash([6, 4]); ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(polyPts[polyPts.length - 1].x, polyPts[polyPts.length - 1].y);
        ctx.lineTo(polyMousePos.x, polyMousePos.y);
        ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      // Points des sommets
      polyPts.forEach((pt, i) => {
        const r = i === 0 ? 10 * strokeScale : 5 * strokeScale;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? color : 'white';
        ctx.globalAlpha = i === 0 ? 0.8 : 1; ctx.fill(); ctx.globalAlpha = 1;
        ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
      });
      ctx.restore();
    }

    // Repère d'aimantation (vert) : le point ou le trait sur lequel le tracé va s'accrocher.
    if (snapHint) {
      const zz = vtRef.current.z || 1;
      const r = 9 * ratio / zz;
      ctx.save();
      ctx.strokeStyle = '#16A34A'; ctx.fillStyle = 'rgba(22,163,74,0.22)'; ctx.lineWidth = 2.5 * ratio / zz;
      ctx.beginPath(); ctx.arc(snapHint.x, snapHint.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (snapHint.kind === 'point') { ctx.fillStyle = '#16A34A'; ctx.beginPath(); ctx.arc(snapHint.x, snapHint.y, r * 0.35, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }

    // Groupe sélectionné (cadres pointillés) + cadre de sélection en cours.
    if (multiSel.length || marquee) {
      const zz = vtRef.current.z || 1;
      const sT = textScaleNow();
      ctx.save();
      ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = 1.5 * ratio / zz; ctx.setLineDash([5 * ratio / zz, 4 * ratio / zz]);
      const pad = 6 * ratio / zz;
      multiSel.forEach(i => {
        const b = pathBounds(paths[i], 22 * ratio, sT);
        if (b) ctx.strokeRect(b.x1 - pad, b.y1 - pad, b.x2 - b.x1 + 2 * pad, b.y2 - b.y1 + 2 * pad);
      });
      if (marquee) {
        ctx.setLineDash([]); ctx.fillStyle = 'rgba(74,158,255,0.12)';
        ctx.fillRect(marquee.x1, marquee.y1, marquee.x2 - marquee.x1, marquee.y2 - marquee.y1);
        ctx.strokeRect(marquee.x1, marquee.y1, marquee.x2 - marquee.x1, marquee.y2 - marquee.y1);
      }
      ctx.restore();
    }

    // Indicateur de sélection : symbole/viewpoint
    if (selAnnot !== null && paths[selAnnot.idx]) {
      const ap = paths[selAnnot.idx];
      ctx.save();
      ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      if ((ap.symbolId === 'portee' || ap.symbolId === 'pente_sol') && ap.x1 != null) {
        ctx.beginPath(); ctx.moveTo(ap.x1, ap.y1); ctx.lineTo(ap.x2, ap.y2); ctx.stroke();
        ctx.beginPath(); ctx.arc(ap.x1, ap.y1, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(ap.x2, ap.y2, 8, 0, Math.PI * 2); ctx.stroke();
      } else if (ap.type === 'shape') {
        // Contour de sélection + poignées de redimensionnement — taille écran constante quel que soit
        // le zoom, et plus fines sur PC (retour Thomas : « trop gros, délicat d'être précis »).
        const zS = vtRef.current.z || 1;
        ctx.lineWidth = 1.5 * ratio / zS;
        ctx.setLineDash([4 * ratio / zS, 3 * ratio / zS]);
        if ((ap.shape === 'poly' || ap.shape === 'polyline') && ap.pts?.length > 1) {
          const xs = ap.pts.map(pt => pt.x), ys = ap.pts.map(pt => pt.y);
          ctx.beginPath(); ctx.rect(Math.min(...xs)-8, Math.min(...ys)-8, Math.max(...xs)-Math.min(...xs)+16, Math.max(...ys)-Math.min(...ys)+16); ctx.stroke();
        } else if (ap.x1 != null) {
          const bx = Math.min(ap.x1, ap.x2)-8, by = Math.min(ap.y1, ap.y2)-8;
          ctx.beginPath(); ctx.rect(bx, by, Math.abs(ap.x2-ap.x1)+16, Math.abs(ap.y2-ap.y1)+16); ctx.stroke();
        }
        ctx.setLineDash([]);
        // Poignées carrées blanches (pas sur une forme « fraîche » en mode Formes : non saisissables)
        // (ni pendant un DÉPLACEMENT : la forme reste dégagée sous la souris)
        const handles = ((selAnnot.fresh && tool === 'shape') || annotDragRef.current) ? [] : getShapeHandles(ap);
        const hr = (isTouchUI ? 7 : 4.5) * ratio / zS;
        handles.forEach(h => {
          ctx.fillStyle = 'white'; ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = (isTouchUI ? 2 : 1.5) * ratio / zS;
          ctx.beginPath(); ctx.rect(h.x - hr, h.y - hr, hr * 2, hr * 2); ctx.fill(); ctx.stroke();
        });
      } else if (ap.x != null) {
        ctx.beginPath(); ctx.arc(ap.x, ap.y, 28 * Math.max(1, sSym), 0, Math.PI * 2); ctx.stroke();
        // Viewpoint : poignée de ROTATION (knob bleu) — la tenir et tourner autour pour
        // réorienter le cône librement. Le glisser-déplacer du corps reste le déplacement.
        if (ap.type === 'viewpoint') {
          const R = 46 * Math.max(1, sSym);
          const ang = ap.angle || 0;
          const hx = ap.x + Math.cos(ang) * R, hy = ap.y + Math.sin(ang) * R;
          vpRotateHandleRef.current = { idx: selAnnot.idx, x: hx, y: hy, cx: ap.x, cy: ap.y };
          ctx.setLineDash([]);
          ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = 2 * ratio;
          ctx.beginPath(); ctx.moveTo(ap.x, ap.y); ctx.lineTo(hx, hy); ctx.stroke();
          const kr = 9 * Math.max(1, sSym);
          ctx.fillStyle = '#4A9EFF'; ctx.strokeStyle = 'white'; ctx.lineWidth = 2.5 * ratio;
          ctx.beginPath(); ctx.arc(hx, hy, kr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    } else {
      vpRotateHandleRef.current = null;
    }
  }, [paths, cur, color, size, tool, bgOk, bgVersion, pendingVP, pendingPortee, activePh, vpCount, scaleText, scaleShape, scaleSymbol, selTextIdx, selAnnot, pendingArrowLine, pendingShape, shapeTool, shapeFilled, fillOpacity, strokeOpacity, polyPts, polyMousePos, vpNumByPath, vpBase, nextVpLabel, newShapeScale, snapHint, multiSel, marquee, drawing]);

  useEffect(() => { redraw(); }, [redraw]);
  // Redessine quand le ZOOM change → les poignées de texte (divisées par le zoom) reprennent une
  // taille correcte à l'écran (sinon, zoomé, la pastille bleue reste géante). Pan (px/py) exclu.
  useEffect(() => { redraw(); }, [vt.z]); // eslint-disable-line react-hooks/exhaustive-deps
  // Redessine quand la TAILLE D'AFFICHAGE change (ajustement à la fenêtre, plan HD qui arrive) :
  // l'échelle des symboles/textes dépend de largeur canvas / largeur affichée. Sans ça, le 1er
  // dessin (fait AVANT l'ajustement) restait figé → symboles minuscules à « 2.0× » jusqu'à ce
  // qu'on retouche le curseur (retour Thomas 13/10/2026).
  useEffect(() => { redraw(); }, [dispSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Z — undo dernière annotation / Delete — supprimer sélection
  // Deps [] : les refs pathsRef/selTextIdxRef/selAnnotRef sont toujours à jour, pas de closure stale.
  useEffect(() => {
    const onKey = e => {
      if (isTypingTarget(e.target)) return;
      const ops = editOpsRef.current;
      const mod = e.ctrlKey || e.metaKey;
      // Espace maintenu = main (glisser déplace la vue). Jamais de défilement/clic de bouton.
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (!spaceRef.current) { spaceRef.current = true; setSpaceDown(true); }
        return;
      }
      // Zoom clavier : Ctrl+0 = vue entière, Ctrl+= / Ctrl+- = zoom avant / arrière.
      if (mod && !e.altKey && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) { e.preventDefault(); ops.zoomTo(1); return; }
      if (mod && !e.altKey && (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd')) { e.preventDefault(); ops.zoomTo(vtRef.current.z * 1.25); return; }
      if (mod && !e.altKey && (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract')) { e.preventDefault(); ops.zoomTo(vtRef.current.z / 1.25); return; }
      const _paths = pathsRef.current;
      const _selTextIdx = selTextIdxRef.current;
      const _selAnnot = selAnnotRef.current;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      }
      // Rétablir : Ctrl+Y ou Ctrl+Maj+Z (Cmd sur Mac)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) {
        e.preventDefault();
        redoRef.current();
      }
      // Copier / coller (sous la souris) / dupliquer / tout sélectionner — un ou plusieurs éléments.
      if (mod && (e.key === 'c' || e.key === 'C') && !e.shiftKey) { if (ops.copySelection()) e.preventDefault(); }
      if (mod && (e.key === 'v' || e.key === 'V') && !e.shiftKey && clipboardRef.current?.length) {
        e.preventDefault(); ops.pasteAnnots(clipboardRef.current, true);
      }
      if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); ops.duplicateSelection(); return; }
      if (mod && (e.key === 'a' || e.key === 'A')) { if (ops.selectAll()) e.preventDefault(); return; }
      // Calques : Ctrl+] avancer, Ctrl+[ reculer (code physique → marche aussi en AZERTY).
      if (mod && (e.code === 'BracketRight' || e.key === ']')) { if (ops.reorderSelection(1)) e.preventDefault(); return; }
      if (mod && (e.code === 'BracketLeft' || e.key === '[')) { if (ops.reorderSelection(-1)) e.preventDefault(); return; }
      if (e.key === 'Enter' && finishPolyRef.current()) { e.preventDefault(); return; }
      // Échap = on QUITTE ce qu'on était en train de faire (retour Thomas) : tracé en cours
      // annulé, outil → Sélection, plus rien de sélectionné, focus rendu au plan.
      if (e.key === 'Escape') {
        setMultiSel([]);
        setPolyPts([]); setPolyMousePos(null);
        setTool('select');
        setShowSyms(false);
        setSelTextIdx(null); textDragRef.current = null;
        setSelAnnot(null); annotDragRef.current = null; resizeDragRef.current = null; groupDragRef.current = null;
        setActivePh(null);
        setPendingShape(null); shapeStartRef.current = null;
        if (marqueeRef.current) { marqueeRef.current = null; setMarquee(null); }
        setDrawing(false); setCur([]);
        try { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } catch { /* ignore */ }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ops.deleteSelectionGroup()) { e.preventDefault(); return; }
        if (_selAnnot !== null) {
          e.preventDefault();
          const wasVp = _paths[_selAnnot.idx]?.type === 'viewpoint';
          setPaths(p => {
            const next = p.filter((_, i) => i !== _selAnnot.idx);
            return wasVp ? resequenceVps(next) : next; // V2→V1, V3→V2… (pas de trou)
          });
          setSelAnnot(null);
          annotDragRef.current = null;
        } else if (_selTextIdx !== null) {
          e.preventDefault();
          setPaths(p => p.filter((_, i) => i !== _selTextIdx));
          setSelTextIdx(null);
        }
      }
      // Flèches avec une sélection : déplacer finement (Maj = ×10).
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (arrow && !mod && ops.nudgeSelection(arrow[0], arrow[1], e.shiftKey)) { e.preventDefault(); return; }
      // Flèches ←/→ sans sélection : photo précédente / suivante (la sauvegarde des annotations
      // en cours est gérée par le parent via getAnnotation()).
      if (e.key === 'ArrowLeft' && navRef.current.onPrev) { e.preventDefault(); navRef.current.onPrev(); }
      if (e.key === 'ArrowRight' && navRef.current.onNext) { e.preventDefault(); navRef.current.onNext(); }
      // Raccourcis « une touche » : outils (V D T F S), formes (R E A L Z P), aide (?).
      if (!mod && !e.altKey && e.key.length === 1) {
        if (e.key === '?') { setShowHelp(v => !v); return; }
        const kk = e.key.toLowerCase();
        if (TOOL_KEYS[kk]) { e.preventDefault(); ops.selectTool(TOOL_KEYS[kk]); return; }
        if (SHAPE_HOTKEYS[kk]) { e.preventDefault(); ops.pickShape(SHAPE_HOTKEYS[kk]); return; }
      }
    };
    const onKeyUp = e => {
      if (e.code === 'Space' || e.key === ' ') {
        if (!isTypingTarget(e.target)) e.preventDefault();
        spaceRef.current = false; setSpaceDown(false);
      }
    };
    const onBlur = () => { spaceRef.current = false; setSpaceDown(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Molette / pinch trackpad — zoom centré sur le curseur
  const onWheel = useCallback(e => {
    e.preventDefault();
    const cv = cvRef.current;
    if (!cv) return;
    // Sur écran tactile (pointer:coarse) le navigateur envoie des events wheel avec ctrlKey=true
    // pour le pinch — on les laisse passer. Les scrolls normaux sans ctrlKey sont ignorés sur touch.
    if (window.matchMedia('(pointer: coarse)').matches && !e.ctrlKey) return;
    const rect = cv.getBoundingClientRect();
    const mx = e.clientX - (rect.left + rect.width  / 2);
    const my = e.clientY - (rect.top  + rect.height / 2);
    // Normalise selon deltaMode (pixels / lignes / pages)
    const raw = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY;
    const factor = Math.pow(0.998, raw); // ex: raw=120 (1 cran souris) → ×0.79
    const cur = vtRef.current;
    const newZ = Math.min(6, Math.max(1, cur.z * factor));
    if (newZ === cur.z) return;
    const r = newZ / cur.z;
    // Formule correcte : le point sous le curseur reste fixe
    const newPx = cur.px + mx * (1 - r);
    const newPy = cur.py + my * (1 - r);
    const maxPx = cv.clientWidth  * (newZ - 1) / 2;
    const maxPy = cv.clientHeight * (newZ - 1) / 2;
    const next = { z: newZ, px: Math.max(-maxPx, Math.min(maxPx, newPx)), py: Math.max(-maxPy, Math.min(maxPy, newPy)) };
    vtRef.current = next;
    setVt(next);
  }, []);

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  useEffect(() => {
    if (!bgImage) return;
    setBgOk(false); // masque le canvas pendant le chargement → évite l'écran noir
    let cancelled = false;
    const load = async () => {
      // Convertir les URLs distantes en data URL pour éviter le "tainted canvas"
      let src = bgImage;
      if (!bgImage.startsWith('data:')) {
        try {
          const resp = await fetch(bgImage);
          const blob = await resp.blob();
          src = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = rej;
            r.readAsDataURL(blob);
          });
        } catch { /* garder l'URL d'origine en fallback */ }
      }
      if (cancelled) return;
      const img = new window.Image();
      img.onload = () => {
        if (cancelled) return;
        const cv = cvRef.current;
        if (!cv) return;
        const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
        // Suréchantillonnage des petites images : on agrandit le BACKING STORE (résolution interne)
        // pour que les ANNOTATIONS (texte, traits, symboles) restent NETTES même quand la photo est
        // affichée en grand. La photo, elle, redevient un peu douce (limite de la source) — accepté.
        // Cible calculée d'après la DENSITÉ de l'écran (devicePixelRatio) : sur un écran Retina/mobile
        // haute densité il faut ~2× plus de pixels, sinon même le texte reste flou (bug du 1er essai).
        // Facteur borné (≤4) pour ne pas exploser la mémoire sur une source minuscule.
        const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
        const target = Math.min(2800, Math.round(Math.max(1500, 1400 * dpr)));
        const f = Math.min(4, Math.max(1, target / Math.max(nw, nh)));
        cv.width = Math.round(nw * f);
        cv.height = Math.round(nh * f);
        bgRef.current = img;
        if (f !== 1) {
          hqScaleRef.current = f;                    // getAnnotation redivise → paths stockés en espace naturel
          scaleHistory(f, f);                        // (opération système : pas un pas d'historique)
          setPaths(prev => scalePaths(prev, f, f));  // paths existants → espace canvas suréchantillonné
        }
        setBgOk(true);
      };
      img.onerror = () => { if (!cancelled) setBgOk(true); };
      img.src = src;
    };
    load();
    return () => { cancelled = true; };
  }, [bgImage]);

  // Quand une version HQ du plan arrive (rendue en arrière-plan depuis PlanLocModal) :
  // agrandit le canvas à la résolution HQ, swap l'image, et met à l'échelle les annotations existantes.
  useEffect(() => {
    if (!hqImage) return;
    const img = new window.Image();
    img.onload = () => {
      const cv = cvRef.current;
      if (!cv || !bgRef.current || bgRef.current.naturalWidth === 0) return;
      // Échelle relative au canvas COURANT (qui peut déjà être suréchantillonné) et non à l'image
      // naturelle → on COMPOSE dans hqScaleRef pour que la sauvegarde redivise correctement.
      // Sans suréchantillonnage, cv.width === naturalWidth → identique à avant.
      const sx = img.naturalWidth  / cv.width;
      const sy = img.naturalHeight / cv.height;
      cv.width  = img.naturalWidth;
      cv.height = img.naturalHeight;
      bgRef.current = img;
      hqScaleRef.current *= sx;
      // Mise à l'échelle des paths existants + forçage du redraw
      if (sx !== 1 || sy !== 1) {
        scaleHistory(sx, sy); // (opération système : l'historique suit la nouvelle échelle)
        setPaths(prev => scalePaths(prev, sx, sy));
      }
      setBgVersion(v => v + 1);
    };
    img.src = hqImage;
  }, [hqImage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Taille d'AFFICHAGE : on agrandit l'image pour remplir l'espace dispo (une petite miniature devient
  // confortable à annoter). Le backing store étant suréchantillonné (cf. img.onload), les annotations
  // restent NETTES ; seule la photo devient un peu douce. getXY() lit getBoundingClientRect() → le
  // mapping des coordonnées reste exact quelle que soit la taille CSS (hit-tests + export inchangés).
  const fitCanvas = useCallback(() => {
    const cv = cvRef.current, wrap = canvasWrapRef.current;
    if (!cv || !wrap || !cv.width || !cv.height) return;
    const cs = getComputedStyle(wrap);
    const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;
    const scale = Math.min(availW / cv.width, availH / cv.height);
    setDispSize({ w: Math.round(cv.width * scale), h: Math.round(cv.height * scale) });
  }, []);
  useEffect(() => { fitCanvas(); }, [bgOk, bgVersion, fitCanvas]);
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') { window.addEventListener('resize', fitCanvas); return () => window.removeEventListener('resize', fitCanvas); }
    const ro = new ResizeObserver(() => fitCanvas());
    ro.observe(wrap);
    window.addEventListener('resize', fitCanvas);
    return () => { ro.disconnect(); window.removeEventListener('resize', fitCanvas); };
  }, [fitCanvas]);

  const getXY = (e, cv) => {
    const r = cv.getBoundingClientRect(), sx = cv.width / r.width, sy = cv.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * sx, y: (src.clientY - r.top) * sy };
  };


  // Losange orange (base de la flèche) du texte sélectionné → on le fait glisser sur le pourtour.
  const grabArrowBase = (pos, ratio) => {
    const ab = arrowBaseHandleRef.current;
    if (!ab || ab.idx !== selTextIdx || Math.hypot(pos.x - ab.x, pos.y - ab.y) > 14 * ratio) return false;
    textDragRef.current = { mode: 'base', box: ab.box };
    setDrawing(true);
    return true;
  };

  const onStart = e => {
    e.preventDefault();
    if (e.touches?.length >= 2) {
      if (drawing) { setCur([]); setDrawing(false); }
      // Annule un symbole placé accidentellement par le premier doigt du pinch (<250ms)
      if (Date.now() - lastSymPlaceRef.current < 250) setPaths(prev => prev.slice(0, -1));
      const [t1, t2] = e.touches;
      const vtCur = vtRef.current;
      const r = cvRef.current?.getBoundingClientRect();
      gestureRef.current = {
        startDist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
        startZ: vtCur.z, startPx: vtCur.px, startPy: vtCur.py,
        midX: (t1.clientX + t2.clientX) / 2,
        midY: (t1.clientY + t2.clientY) / 2,
        ncX: r ? r.left + r.width / 2 - vtCur.px : 0,
        ncY: r ? r.top + r.height / 2 - vtCur.py : 0,
      };
      return;
    }
    if (gestureRef.current) return;

    // Zoomé + UN doigt + outil SÉLECTION : on prépare un PAN (glisser = déplacer la vue). Dans les
    // outils de DESSIN, un doigt dessine toujours → pas de pan (on utilise l'outil Sélect. ou deux
    // doigts pour naviguer). Demande Thomas : « on a laissé un item Select » = c'est là que vit le pan.
    // Pan à un doigt aussi en mode SYMBOLE (retour Thomas : « quand je place un symbole je peux pas
    // me balader »). Le tap POSE le symbole, le GLISSÉ déplace la vue (le symbole posé à l'appui est
    // retiré au moment où le pan s'arme, cf. onMove). Portée/pente dessinent au glissé → drawBusy les protège.
    if (e.touches?.length === 1 && vtRef.current.z > 1.05 && (tool === 'select' || tool === 'symbol')) {
      const t0 = e.touches[0];
      oneFingerPanRef.current = { startMx: t0.clientX, startMy: t0.clientY, startPx: vtRef.current.px, startPy: vtRef.current.py, panning: false };
    } else {
      oneFingerPanRef.current = null;
    }

    // Clic-droit, molette enfoncée ou Espace maintenu → pan (bureau uniquement)
    if (!e.touches && (e.button === 2 || e.button === 1 || spaceRef.current)) {
      e.preventDefault();
      panRef.current = { startPx: vtRef.current.px, startPy: vtRef.current.py, startMx: e.clientX, startMy: e.clientY };
      return;
    }

    // Long-press (500 ms, mobile uniquement) → bascule en mode sélection
    if (e.touches?.length === 1 && tool !== 'select') {
      const t0 = e.touches[0];
      const lx = t0.clientX, ly = t0.clientY;
      touchHoldRef.current = setTimeout(() => {
        touchHoldRef.current = null;
        setCur([]); setDrawing(false);
        setPolyPts([]); setPolyMousePos(null);
        setTool('select');
        setShowSyms(false);
        setSelTextIdx(null); textDragRef.current = null;
        setActivePh(null);
        setPendingShape(null); shapeStartRef.current = null;
        navigator.vibrate?.(30);
      }, 500);
      // Annuler si le doigt glisse (>8px) — c'est un tracé, pas un long-press
      const cancel = (mv) => {
        const t = mv.touches?.[0];
        if (!t || Math.hypot(t.clientX - lx, t.clientY - ly) > 8) {
          clearTimeout(touchHoldRef.current); touchHoldRef.current = null;
          window.removeEventListener('touchmove', cancel);
          window.removeEventListener('touchend',  cancel);
        }
      };
      window.addEventListener('touchmove',  cancel, { passive: true });
      window.addEventListener('touchend',   cancel, { once: true });
    }

    const cv = cvRef.current;
    const pos = getXY(e, cv);
    // Sélection multiple (PC) : Ctrl/Cmd + clic — ou Maj + clic — ajoute / retire l'élément cliqué.
    const addKey = !e.touches && (e.shiftKey || e.ctrlKey || e.metaKey);
    if (!e.touches && (e.ctrlKey || e.metaKey) && tool !== 'select' && polyPts.length === 0) {
      toggleSelAt(pos); return; // Ctrl + clic ne trace jamais
    }

    // Poignée de ROTATION d'un viewpoint sélectionné : priorité absolue, quel que soit l'outil.
    {
      const rotH = vpRotateHandleRef.current;
      if (selAnnot !== null && rotH && rotH.idx === selAnnot.idx &&
          Math.hypot(pos.x - rotH.x, pos.y - rotH.y) < 24 * (cv.width / cv.clientWidth)) {
        vpRotateDragRef.current = { idx: selAnnot.idx, cx: rotH.cx, cy: rotH.cy };
        if (touchHoldRef.current) { clearTimeout(touchHoldRef.current); touchHoldRef.current = null; }
        setDrawing(true);
        return;
      }
    }

    if (tool === 'select') {
      const hitR = 22 * (cv.width / cv.clientWidth);
      const ratio_s = cv.width / cv.clientWidth;
      // ── Groupe sélectionné : glisser l'un de ses éléments déplace TOUT le groupe ──
      const hitAt = (q) => {
        if (!q) return false;
        if (q.type === 'shape') return hitsShape(q, pos, 18 * ratio_s);
        const b = boundsOf(q), pad = hitR * 0.5;
        return b && pos.x >= b.x1 - pad && pos.x <= b.x2 + pad && pos.y >= b.y1 - pad && pos.y <= b.y2 + pad;
      };
      // ── Alt + glisser : DUPLIQUE l'élément (ou le groupe) sous la souris et déplace la copie ──
      if (e.altKey && !e.touches) {
        let src = null;
        if (multiSel.length && multiSel.some(i => hitAt(paths[i]))) src = multiSel;
        else for (let i = paths.length - 1; i >= 0; i--) { if (hitAt(paths[i])) { src = [i]; break; } }
        if (src) {
          const copies = cloneAnnots(src.map(i => paths[i]), 0, 0);
          const start = paths.length;
          const next = [...paths, ...copies];
          const newIdxs = copies.map((_, k) => start + k);
          setPaths(next);
          selectIdxs(newIdxs, next);
          groupDragRef.current = { orig: newIdxs.map((ni, k) => [ni, copies[k]]), tapX: pos.x, tapY: pos.y };
          setDrawing(true); return;
        }
      }
      if (multiSel.length && !addKey) {
        if (multiSel.some(i => hitAt(paths[i]))) {
          groupDragRef.current = { orig: multiSel.map(i => [i, paths[i]]), tapX: pos.x, tapY: pos.y };
          setDrawing(true); return;
        }
        setMultiSel([]);
      }
      // ── Ctrl/Cmd+clic ou Maj+clic : ajoute / retire un élément de la sélection ──
      if (addKey) {
        let hitI = -1;
        for (let i = paths.length - 1; i >= 0; i--) { if (hitAt(paths[i])) { hitI = i; break; } }
        if (hitI >= 0) {
          const curSel = selectedIdxs();
          selectIdxs(curSel.includes(hitI) ? curSel.filter(i => i !== hitI) : [...curSel, hitI]);
          return;
        }
      }
      // Poignée resize du texte sélectionné : priorité ABSOLUE avant tout autre hit-test.
      // Position lue depuis resizeHandleRef (dessinée au pixel près) → plus d'approximation.
      if (grabArrowBase(pos, ratio_s)) return;
      const rh_s = resizeHandleRef.current;
      if (rh_s && rh_s.idx === selTextIdx &&
          Math.abs(pos.x - rh_s.x) < 24 * ratio_s && Math.abs(pos.y - rh_s.y) < 24 * ratio_s) {
        textDragRef.current = { mode: 'resize', origTextW: rh_s.twU, tapX: pos.x };
        setDrawing(true); return;
      }
      // Resize handles first (if a shape is currently selected)
      if (selAnnot !== null && paths[selAnnot.idx]?.type === 'shape') {
        const ap = paths[selAnnot.idx];
        const rhr = 14 * (cv.width / cv.clientWidth) / (vtRef.current.z || 1);
        const handles = getShapeHandles(ap);
        for (const h of handles) {
          if (Math.hypot(pos.x - h.x, pos.y - h.y) < rhr) {
            resizeDragRef.current = { handle: h.id, origData: { ...ap, pts: ap.pts ? ap.pts.map(pt => ({...pt})) : undefined }, idx: selAnnot.idx };
            setDrawing(true);
            return;
          }
        }
      }
      // Hit-test all annotations
      for (let i = paths.length - 1; i >= 0; i--) {
        const p = paths[i];
        if (p.type === 'viewpoint' && Math.hypot(p.x - pos.x, p.y - pos.y) < hitR) {
          setSelAnnot({ idx: i }); setSelTextIdx(null);
          annotDragRef.current = { idx: i, origData: { ...p }, tapX: pos.x, tapY: pos.y };
          if (touchHoldRef.current) { clearTimeout(touchHoldRef.current); touchHoldRef.current = null; }
          startVpHold(p);
          setDrawing(true); return;
        }
        if (p.type === 'symbol') {
          let hit = false;
          if ((p.symbolId === 'portee' || p.symbolId === 'pente_sol') && p.x1 != null) {
            const dx = p.x2 - p.x1, dy = p.y2 - p.y1, len = Math.hypot(dx, dy);
            if (len > 0) {
              const t = Math.max(0, Math.min(1, ((pos.x - p.x1) * dx + (pos.y - p.y1) * dy) / (len * len)));
              hit = Math.hypot(pos.x - (p.x1 + t * dx), pos.y - (p.y1 + t * dy)) < hitR;
            }
          } else if (p.x != null) { hit = Math.hypot(p.x - pos.x, p.y - pos.y) < hitR; }
          if (hit) {
            setSelAnnot({ idx: i }); setSelTextIdx(null);
            annotDragRef.current = { idx: i, origData: { ...p }, tapX: pos.x, tapY: pos.y };
            setDrawing(true); return;
          }
        }
        if (p.type === 'text') {
          // Poignée orange (pointe de flèche) — prioritaire, déplaçable aussi en mode Sélect.
          if (p.textMode === 'arrow' && p.arrowX != null &&
              Math.hypot(p.arrowX - pos.x, p.arrowY - pos.y) < hitR * 0.95) {
            setSelTextIdx(i); setSelAnnot(null);
            textDragRef.current = { mode: 'tip', origArrowX: p.arrowX, origArrowY: p.arrowY, tapX: pos.x, tapY: pos.y };
            setDrawing(true); return;
          }
          const txtScale = cv ? textScaleNow() : 1;
          const fs = (20 + p.size * 4) * txtScale;
          const _ls = String(p.text ?? '').split('\n');
          const _extraH = (_ls.length - 1) * fs * 1.2;
          // (la poignée de resize est testée avant la boucle via resizeHandleRef)
          const _maxLen = _ls.reduce((m, l) => Math.max(m, l.length), 0);
          const approxW = p.textW != null ? p.textW * txtScale + 20 * txtScale : Math.max(80, _maxLen * fs * 0.6) + 20;
          const inCircle = Math.hypot(p.x - pos.x, p.y - pos.y) < hitR;
          const inBox =
            pos.x >= p.x - 10 * txtScale && pos.x <= p.x - 10 * txtScale + approxW &&
            pos.y >= p.y - fs - 4 * txtScale && pos.y <= p.y + 10 * txtScale + _extraH;
          if (inCircle || inBox) {
            const wasSelected = selTextIdx === i;
            setSelTextIdx(i); setSelAnnot(null);
            textDragRef.current = { mode: 'box', origX: p.x, origY: p.y, tapX: pos.x, tapY: pos.y, moved: false, textVal: p.text || '', wasSelected };
            setDrawing(true); return;
          }
        }
        if (p.type === 'shape') {
          const hitRSh = 18 * (cv.width / cv.clientWidth);
          // Sur le trait (ou dans le remplissage) — plus le rectangle englobant : cliquer-glisser
          // DANS un grand contour vide trace un cadre de sélection au lieu de déplacer le contour.
          const hitShape = hitsShape(p, pos, hitRSh);
          if (hitShape) {
            setSelAnnot({ idx: i }); setSelTextIdx(null);
            annotDragRef.current = { idx: i, origData: { ...p, pts: p.pts?.map(pt => ({...pt})) }, tapX: pos.x, tapY: pos.y };
            setDrawing(true); return;
          }
        }
      }
      // Clic dans le vide : désélectionne ; glisser (souris) = CADRE de sélection (Maj = ajoute).
      const addTo = addKey ? selectedIdxs() : [];
      setSelAnnot(null); setSelTextIdx(null);
      if (!e.touches) {
        marqueeRef.current = { x0: pos.x, y0: pos.y, add: addTo };
        setDrawing(true);
      }
      return;
    }

    if (tool === 'viewpoint') {
      const hitR = 22 * (cv.width / cv.clientWidth);
      let hitIdx = -1;
      for (let i = paths.length - 1; i >= 0; i--) {
        const p = paths[i];
        if (p.type === 'viewpoint' && Math.hypot(p.x - pos.x, p.y - pos.y) < hitR) { hitIdx = i; break; }
      }
      if (hitIdx >= 0) {
        setSelAnnot({ idx: hitIdx });
        annotDragRef.current = { idx: hitIdx, origData: { ...paths[hitIdx] }, tapX: pos.x, tapY: pos.y };
        if (touchHoldRef.current) { clearTimeout(touchHoldRef.current); touchHoldRef.current = null; }
        startVpHold(paths[hitIdx]);
        setDrawing(true);
        return;
      }
      setSelAnnot(null);
      vpStart.current = pos;
      setPendingVP({ x: pos.x, y: pos.y, angle: 0 });
      setDrawing(true);
      return;
    }
    if (tool === 'symbol') {
      const hitR = 22 * (cv.width / cv.clientWidth);
      let hitIdx = -1;
      for (let i = paths.length - 1; i >= 0; i--) {
        const p = paths[i];
        if (p.type !== 'symbol') continue;
        let hit = false;
        if (p.symbolId === 'portee' && p.x1 != null) {
          const dx = p.x2 - p.x1, dy = p.y2 - p.y1, len = Math.hypot(dx, dy);
          if (len > 0) {
            const t = Math.max(0, Math.min(1, ((pos.x - p.x1) * dx + (pos.y - p.y1) * dy) / (len * len)));
            hit = Math.hypot(pos.x - (p.x1 + t * dx), pos.y - (p.y1 + t * dy)) < hitR;
          }
        } else if (p.x != null) {
          hit = Math.hypot(p.x - pos.x, p.y - pos.y) < hitR;
        }
        if (hit) { hitIdx = i; break; }
      }
      if (hitIdx >= 0) {
        setSelAnnot({ idx: hitIdx });
        annotDragRef.current = { idx: hitIdx, origData: { ...paths[hitIdx] }, tapX: pos.x, tapY: pos.y };
        setDrawing(true);
        return;
      }
      setSelAnnot(null);
      if (sym.id === 'portee' || sym.id === 'pente_sol') {
        porteeStartRef.current = pos;
        setPendingPortee({ symbolId: sym.id, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y });
        setDrawing(true);
      } else {
        lastSymPlaceRef.current = Date.now();
        setPaths(prev => [...prev, { type:'symbol', symbolId:sym.id, x:pos.x, y:pos.y, color, size }]);
      }
      return;
    }
    if (tool === 'text') {
      const hitR = 28 * (cv.width / cv.clientWidth);
      const ratio_t = cv.width / cv.clientWidth;
      // Poignée resize du texte sélectionné : priorité ABSOLUE avant tout autre hit-test.
      // Position lue depuis resizeHandleRef (dessinée au pixel près) → plus d'approximation.
      if (grabArrowBase(pos, ratio_t)) return;
      const rh_t = resizeHandleRef.current;
      if (rh_t && rh_t.idx === selTextIdx &&
          Math.abs(pos.x - rh_t.x) < 24 * ratio_t && Math.abs(pos.y - rh_t.y) < 24 * ratio_t) {
        textDragRef.current = { mode: 'resize', origTextW: rh_t.twU, tapX: pos.x };
        setDrawing(true); return;
      }
      // Vérifier d'abord la poignée de flèche (tip)
      for (let i = paths.length - 1; i >= 0; i--) {
        const p = paths[i];
        if (p.type === 'text' && p.textMode === 'arrow' && p.arrowX != null) {
          if (Math.hypot(p.arrowX - pos.x, p.arrowY - pos.y) < hitR * 0.95) {
            setSelTextIdx(i);
            setDrawing(true);
            textDragRef.current = { mode: 'tip', origArrowX: p.arrowX, origArrowY: p.arrowY, tapX: pos.x, tapY: pos.y };
            return;
          }
        }
      }
      // Puis la boîte de texte — détection élargie à toute la zone du texte
      let existIdx = -1;
      for (let i = paths.length - 1; i >= 0; i--) {
        const p = paths[i];
        if (p.type !== 'text') continue;
        const txtScale = cv ? textScaleNow() : 1;
        const fs = (20 + p.size * 4) * txtScale;
        const _ls = String(p.text ?? '').split('\n');
        const _extraH = (_ls.length - 1) * fs * 1.2;
        // (la poignée de resize est testée avant la boucle via resizeHandleRef)
        const inCircle = Math.hypot(p.x - pos.x, p.y - pos.y) < hitR * 1.1;
        const _maxLen = _ls.reduce((m, l) => Math.max(m, l.length), 0);
        const approxW = p.textW != null ? p.textW * txtScale + 20 * txtScale : Math.max(90, _maxLen * fs * 0.62) + 30 * txtScale;
        const inBox =
          pos.x >= p.x - 16 * txtScale && pos.x <= p.x + approxW &&
          pos.y >= p.y - fs - 12 * txtScale && pos.y <= p.y + 16 * txtScale + _extraH;
        if (inCircle || inBox) { existIdx = i; break; }
      }
      if (existIdx >= 0) {
        // 1er tap = sélection (drag possible). 2e tap sur un texte déjà sélectionné = édition (géré au relâchement).
        const wasSelected = selTextIdx === existIdx;
        setSelTextIdx(existIdx);
        setDrawing(true);
        textDragRef.current = { mode: 'box', origX: paths[existIdx].x, origY: paths[existIdx].y, tapX: pos.x, tapY: pos.y, moved: false, textVal: paths[existIdx].text || '', wasSelected };
        return;
      }
      // Tap dans le vide ALORS qu'un texte est sélectionné = on FERME le panneau d'édition
      // (retour Thomas : « je clique à côté, ça devrait fermer et repasser en sélection »).
      // On ne crée PAS un nouveau texte sur ce tap-là ; on revient à l'outil Sélection.
      if (selTextIdx !== null) { setSelTextIdx(null); setTool('select'); return; }
      setSelTextIdx(null);
      if (textMode === 'arrow') {
        // Mode flèche : le start = pointe, drag = position boîte
        arrowPlaceRef.current = pos;
        setPendingArrowLine({ tipX: pos.x, tipY: pos.y, boxX: pos.x, boxY: pos.y });
        setDrawing(true);
      } else {
        // Tap zone vide → édition inline directement au point de tap
        inlineEditCanvasPt.current = { x: pos.x, y: pos.y };
        setInlineEditIdx(null);
        setInlineEditPos(toScreenPos(pos.x, pos.y));
        setInlineEditVal('');
      }
      return;
    }
    if (tool === 'shape') {
      const hitR = 18 * (cv.width / cv.clientWidth);

      // ── Outil polygone : clic = sommet, double-clic/snap = fermeture ──
      if (shapeTool === 'poly' || shapeTool === 'polyline') {
        // Polyligne = même saisie que le polygone mais OUVERTE (pas de fermeture, pas de
        // remplissage) et dès 2 points (demande Thomas). Double-clic = terminer.
        const isPolyline = shapeTool === 'polyline';
        const minPts = isPolyline ? 2 : 3;
        // Tant qu'on n'a PAS commencé à tracer (aucun sommet posé), un clic sur une forme
        // existante la MANIPULE (poignée de resize, ou sélection + déplacement) au lieu de
        // démarrer un nouveau polygone → on peut enfin re-sélectionner/recolorer une zone.
        if (polyPts.length === 0) {
          if (e.shiftKey && !e.touches && toggleSelAt(pos)) return; // Maj+clic = sélection multiple
          if (selAnnot !== null && !selAnnot.fresh && paths[selAnnot.idx]?.type === 'shape') {
            const ap = paths[selAnnot.idx];
            const rhr = 14 * (cv.width / cv.clientWidth) / (vtRef.current.z || 1);
            for (const h of getShapeHandles(ap)) {
              if (Math.hypot(pos.x - h.x, pos.y - h.y) < rhr) {
                resizeDragRef.current = { handle: h.id, origData: { ...ap, pts: ap.pts ? ap.pts.map(pt => ({...pt})) : undefined }, idx: selAnnot.idx };
                setDrawing(true); return;
              }
            }
          }
          // En mode TRACÉ, un clic ne sélectionne JAMAIS une autre forme (retour Thomas : « je trace
          // une nouvelle ligne, ça sélectionne le contour d'à côté »). Seule la forme DÉJÀ
          // sélectionnée se déplace, si on clique précisément sur son trait. Pour choisir une autre
          // forme : outil Sélection (ou Échap).
          if (selAnnot !== null && !selAnnot.fresh && paths[selAnnot.idx]?.type === 'shape' && nearShapeOutline(paths[selAnnot.idx], pos, hitR)) {
            const p = paths[selAnnot.idx];
            annotDragRef.current = { idx: selAnnot.idx, origData: { ...p, pts: p.pts?.map(pt => ({...pt})) }, tapX: pos.x, tapY: pos.y };
            setDrawing(true); return;
          }
          setSelAnnot(null); // → démarrage d'un nouveau tracé
        }
        const now = Date.now();
        const lt = lastTapRef.current;
        const snapR = 22 * (cv.width / cv.clientWidth);
        const isDbl = (now - lt.time < 380) && polyPts.length >= 2 && Math.hypot(pos.x - lt.x, pos.y - lt.y) < snapR;
        lastTapRef.current = { time: now, x: pos.x, y: pos.y };
        if (isDbl) {
          if (polyPts.length >= minPts) {
            addNewShape({ type:'shape', shape: shapeTool, pts:[...polyPts], color, size, filled: isPolyline ? false : shapeFilled, fillOpacity, strokeOpacity, ...shapeMulProp });
          }
          setPolyPts([]); setPolyMousePos(null);
          return;
        }
        // Point ASSISTÉ : Maj = angle à 45° depuis le point précédent ; sinon aimanté sur les
        // points/traits existants (et sur les sommets déjà posés → fermer / rejoindre pile).
        const ppos = assistPos(pos, e, { from: polyPts.length ? polyPts[polyPts.length - 1] : null, extraPts: polyPts.slice(0, -1) }).pos;
        // Snap au premier sommet pour fermer — POLYGONE uniquement (la polyligne reste ouverte)
        if (!isPolyline && polyPts.length >= 3) {
          const closeR = 18 * (cv.width / cv.clientWidth);
          if (Math.hypot(ppos.x - polyPts[0].x, ppos.y - polyPts[0].y) < closeR) {
            addNewShape({ type:'shape', shape:'poly', pts:[...polyPts], color, size, filled: shapeFilled, fillOpacity, strokeOpacity, ...shapeMulProp });
            setPolyPts([]); setPolyMousePos(null);
            return;
          }
        }
        setPolyPts(prev => [...prev, ppos]);
        return;
      }

      // ── Resize : poignées de la forme sélectionnée (pas une forme « fraîche ») ──
      if (selAnnot !== null && !selAnnot.fresh && paths[selAnnot.idx]?.type === 'shape') {
        const ap = paths[selAnnot.idx];
        const rhr = 14 * (cv.width / cv.clientWidth) / (vtRef.current.z || 1);
        const handles = getShapeHandles(ap);
        for (const h of handles) {
          if (Math.hypot(pos.x - h.x, pos.y - h.y) < rhr) {
            resizeDragRef.current = { handle: h.id, origData: { ...ap, pts: ap.pts ? ap.pts.map(pt => ({...pt})) : undefined }, idx: selAnnot.idx };
            setDrawing(true);
            return;
          }
        }
      }

      // ── Autres formes (rect/ellipse/arrow/line) : en mode TRACÉ, pas de sélection d'une autre
      // forme (même règle que la polyligne ci-dessus) — seule la forme déjà sélectionnée se
      // déplace si on clique sur son trait ; sinon, on commence une nouvelle forme.
      const hitIdx = (selAnnot !== null && !selAnnot.fresh && paths[selAnnot.idx]?.type === 'shape' && nearShapeOutline(paths[selAnnot.idx], pos, hitR))
        ? selAnnot.idx : -1;
      if (hitIdx >= 0) {
        setSelAnnot({ idx: hitIdx });
        annotDragRef.current = { idx: hitIdx, origData: { ...paths[hitIdx], pts: paths[hitIdx].pts ? paths[hitIdx].pts.map(pt => ({...pt})) : undefined }, tapX: pos.x, tapY: pos.y };
        setDrawing(true);
        return;
      }
      // Maj enfoncée : on GARDE la sélection courante (un Maj+clic sans tracer l'enrichira au relâchement).
      if (!(e.shiftKey && !e.touches)) setSelAnnot(null);
      const spos = assistPos(pos, e).pos; // départ aimanté sur un point/trait existant
      shapeStartRef.current = spos;
      setPendingShape({ x1: spos.x, y1: spos.y, x2: spos.x, y2: spos.y });
      setDrawing(true);
      return;
    }
    setDrawing(true); setCur([pos]);
  };

  const onMove = e => {
    e.preventDefault();
    if (e.touches?.length >= 2 && gestureRef.current) {
      const [t1, t2] = e.touches;
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      const g = gestureRef.current;
      const newZ = Math.min(6, Math.max(1, g.startZ * dist / g.startDist));
      const ratio = newZ / g.startZ;
      const newPx = midX - g.ncX - (g.midX - g.ncX - g.startPx) * ratio;
      const newPy = midY - g.ncY - (g.midY - g.ncY - g.startPy) * ratio;
      const cv = cvRef.current;
      const maxPx = cv ? cv.clientWidth  * (newZ - 1) / 2 : 9999;
      const maxPy = cv ? cv.clientHeight * (newZ - 1) / 2 : 9999;
      setVt({ z: newZ, px: Math.max(-maxPx, Math.min(maxPx, newPx)), py: Math.max(-maxPy, Math.min(maxPy, newPy)) });
      return;
    }
    // Zoomé + 1 doigt qui GLISSE → PAN (annule le tracé/placement en cours). Un simple tap ne
    // déclenche jamais ce bloc (aucun mouvement) → le placement se fait normalement à la fin.
    const ofp = oneFingerPanRef.current;
    // « Intelligent » : si un DESSIN/PLACEMENT est en cours (flèche de texte, viewpoint, forme,
    // portée, polygone, déplacement/resize d'un élément…), le glissé DESSINE et ne déplace PAS la
    // vue. Le pan ne s'arme que sur un glissé LIBRE (aucune action de dessin en cours).
    const drawBusy = ofp && !ofp.panning && (
      arrowPlaceRef.current || shapeStartRef.current || pendingShape || porteeStartRef.current ||
      pendingPortee || polyPts.length > 0 || textDragRef.current || resizeDragRef.current ||
      vpRotateDragRef.current || annotDragRef.current || vpStart.current || pendingVP
    );
    if (ofp && e.touches?.length === 1 && !drawBusy) {
      const t = e.touches[0];
      const dx = t.clientX - ofp.startMx, dy = t.clientY - ofp.startMy;
      if (!ofp.panning && Math.hypot(dx, dy) > 10) {
        ofp.panning = true;
        // Annule tout ce qu'un début de tracé aurait amorcé.
        if (drawing) setDrawing(false);
        setCur([]); setPendingVP(null); setPendingShape(null); setPendingPortee(null);
        setPolyPts([]); setPolyMousePos(null); setPendingArrowLine(null);
        textDragRef.current = null; shapeStartRef.current = null; annotDragRef.current = null; resizeDragRef.current = null; arrowPlaceRef.current = null;
        if (touchHoldRef.current) { clearTimeout(touchHoldRef.current); touchHoldRef.current = null; }
        // Retire un symbole/viewpoint éventuellement posé à l'appui (<500 ms), comme le pinch.
        if (Date.now() - lastSymPlaceRef.current < 500) setPaths(prev => prev.slice(0, -1));
      }
      if (ofp.panning) {
        const cv = cvRef.current;
        const nz = vtRef.current.z;
        const maxPx = cv ? cv.clientWidth  * (nz - 1) / 2 : 9999;
        const maxPy = cv ? cv.clientHeight * (nz - 1) / 2 : 9999;
        const next = { z: nz, px: Math.max(-maxPx, Math.min(maxPx, ofp.startPx + dx)), py: Math.max(-maxPy, Math.min(maxPy, ofp.startPy + dy)) };
        vtRef.current = next; setVt(next);
        return;
      }
    }
    // Pan clic-droit / molette
    if (panRef.current && !e.touches) {
      const { startPx, startPy, startMx, startMy } = panRef.current;
      const cv = cvRef.current;
      const nz = vtRef.current.z;
      const newPx = startPx + (e.clientX - startMx);
      const newPy = startPy + (e.clientY - startMy);
      const maxPx = cv ? cv.clientWidth  * (nz - 1) / 2 : 9999;
      const maxPy = cv ? cv.clientHeight * (nz - 1) / 2 : 9999;
      const next = { z: nz, px: Math.max(-maxPx, Math.min(maxPx, newPx)), py: Math.max(-maxPy, Math.min(maxPy, newPy)) };
      vtRef.current = next;
      setVt(next);
      return;
    }

    const pos = getXY(e, cvRef.current);
    if (!e.touches) mouseCanvasRef.current = pos;
    // Cadre de sélection en cours
    if (marqueeRef.current) {
      const m = marqueeRef.current;
      setMarquee({ x1: Math.min(m.x0, pos.x), y1: Math.min(m.y0, pos.y), x2: Math.max(m.x0, pos.x), y2: Math.max(m.y0, pos.y) });
      return;
    }
    // Déplacement du groupe sélectionné
    if (groupDragRef.current) {
      const { orig, tapX, tapY } = groupDragRef.current;
      const dx = pos.x - tapX, dy = pos.y - tapY;
      const byIdx = new Map(orig);
      setPaths(prev => prev.map((p, i) => byIdx.has(i) ? movePath(byIdx.get(i), dx, dy) : p));
      return;
    }
    // Placement flèche : mise à jour de la ligne de prévisualisation
    if (tool === 'text' && drawing && arrowPlaceRef.current) {
      setPendingArrowLine({ tipX: arrowPlaceRef.current.x, tipY: arrowPlaceRef.current.y, boxX: pos.x, boxY: pos.y });
      return;
    }
    // Base de la flèche glissée le long du pourtour du cadre (le cadre ne bouge pas pendant le drag)
    if ((tool === 'text' || tool === 'select') && drawing && selTextIdx !== null && textDragRef.current?.mode === 'base') {
      const { bx, by, bw, bh, rad } = textDragRef.current.box;
      const s = snapToBoxEdge(pos.x, pos.y, bx, by, bw, bh, rad);
      setPaths(prev => prev.map((p, i) => i === selTextIdx ? { ...p, arrowAt: { fx: s.fx, fy: s.fy } } : p));
      return;
    }
    // Resize largeur du cadre texte (drag poignée droite)
    if ((tool === 'text' || tool === 'select') && drawing && selTextIdx !== null && textDragRef.current?.mode === 'resize') {
      const cv = cvRef.current;
      const sT = textScaleNow();
      const { origTextW, tapX } = textDragRef.current;
      const newW = Math.max(60, origTextW + (pos.x - tapX) / sT);
      setPaths(prev => prev.map((p, i) => i === selTextIdx ? { ...p, textW: newW } : p));
      return;
    }
    // Déplacement texte : tip de flèche
    if ((tool === 'text' || tool === 'select') && drawing && selTextIdx !== null && textDragRef.current?.mode === 'tip') {
      const { origArrowX, origArrowY, tapX, tapY } = textDragRef.current;
      setPaths(prev => prev.map((p, i) => i === selTextIdx ? { ...p, arrowX: origArrowX + (pos.x - tapX), arrowY: origArrowY + (pos.y - tapY) } : p));
      return;
    }
    // Déplacement texte : boîte
    if ((tool === 'text' || tool === 'select') && drawing && selTextIdx !== null && textDragRef.current) {
      const { origX, origY, tapX, tapY } = textDragRef.current;
      const dx = pos.x - tapX, dy = pos.y - tapY;
      if (Math.hypot(dx, dy) > 5) textDragRef.current.moved = true;
      setPaths(prev => prev.map((p, i) => i === selTextIdx ? { ...p, x: origX + dx, y: origY + dy } : p));
      return;
    }
    // Déplacement symbole/viewpoint sélectionné
    // Resize forme
    if (drawing && resizeDragRef.current) {
      const { handle, origData, idx } = resizeDragRef.current;
      // Point fixe pour Maj (angle/carré) : l'autre bout, le coin opposé ou le sommet voisin.
      const od = origData;
      const vi0 = handle.startsWith('v') ? parseInt(handle.slice(1)) : -1;
      const anchor = handle === 'p1' ? { x: od.x2, y: od.y2 } : handle === 'p2' ? { x: od.x1, y: od.y1 }
        : handle === 'se' ? { x: od.x1, y: od.y1 } : handle === 'nw' ? { x: od.x2, y: od.y2 }
        : handle === 'ne' ? { x: od.x1, y: od.y2 } : handle === 'sw' ? { x: od.x2, y: od.y1 }
        : (vi0 >= 0 && od.pts) ? (od.pts[vi0 - 1] || od.pts[vi0 + 1] || null) : null;
      const a = assistPos(pos, e, { from: anchor, square: od.shape === 'rect' || od.shape === 'ellipse', exclude: new Set([idx]) });
      updateSnapHint(a.hint);
      const P = a.pos;
      setPaths(prev => prev.map((p, i) => {
        if (i !== idx) return p;
        if (handle === 'se') return { ...p, x2: P.x, y2: P.y };
        if (handle === 'sw') return { ...p, x1: P.x, y2: P.y };
        if (handle === 'ne') return { ...p, x2: P.x, y1: P.y };
        if (handle === 'nw') return { ...p, x1: P.x, y1: P.y };
        if (handle === 'p1') return { ...p, x1: P.x, y1: P.y };
        if (handle === 'p2') return { ...p, x2: P.x, y2: P.y };
        if (handle.startsWith('v')) {
          const vi = parseInt(handle.slice(1));
          return { ...p, pts: p.pts.map((pt, j) => j === vi ? { x: P.x, y: P.y } : pt) };
        }
        return p;
      }));
      return;
    }
    // Rotation libre d'un viewpoint : l'angle suit le doigt/curseur autour du centre.
    if (drawing && vpRotateDragRef.current) {
      const { idx, cx, cy } = vpRotateDragRef.current;
      const ang = Math.atan2(pos.y - cy, pos.x - cx);
      setPaths(prev => prev.map((p, i) => i === idx ? { ...p, angle: ang } : p));
      return;
    }
    if (drawing && selAnnot !== null && annotDragRef.current) {
      const { origData, tapX, tapY } = annotDragRef.current;
      const dx = pos.x - tapX, dy = pos.y - tapY;
      // Mouvement réel → ce n'est pas un appui long : on annule l'aperçu photo du viewpoint.
      if (vpHoldRef.current && Math.hypot(dx, dy) > 6) { clearTimeout(vpHoldRef.current); vpHoldRef.current = null; }
      setPaths(prev => prev.map((p, i) => {
        if (i !== selAnnot.idx) return p;
        if (origData.pts) return { ...p, pts: origData.pts.map(pt => ({ x: pt.x + dx, y: pt.y + dy })) };
        if (origData.x1 != null) return { ...p, x1: origData.x1 + dx, y1: origData.y1 + dy, x2: origData.x2 + dx, y2: origData.y2 + dy };
        return { ...p, x: origData.x + dx, y: origData.y + dy };
      }));
      return;
    }
    // Polyligne / zone : trait d'aperçu jusqu'au curseur (bouton relâché), assisté.
    if (tool === 'shape' && (shapeTool === 'poly' || shapeTool === 'polyline') && polyPts.length > 0) {
      const a = assistPos(pos, e, { from: polyPts[polyPts.length - 1], extraPts: polyPts.slice(0, -1) });
      updateSnapHint(a.hint);
      setPolyMousePos(a.pos);
      return;
    }
    // Survol en mode Formes : on montre où le prochain tracé s'aimantera.
    if (tool === 'shape' && !drawing) { updateSnapHint(assistPos(pos, e).hint); return; }
    if (!drawing) return;
    if (tool === 'viewpoint' && vpStart.current) {
      const dx = pos.x - vpStart.current.x;
      const dy = pos.y - vpStart.current.y;
      setPendingVP({ x: vpStart.current.x, y: vpStart.current.y, angle: Math.atan2(dy, dx) });
      return;
    }
    // Portée en cours de tracé
    if (tool === 'symbol' && (sym.id === 'portee' || sym.id === 'pente_sol') && porteeStartRef.current) {
      const pe = e?.shiftKey ? constrainAngle(porteeStartRef.current, pos) : pos;
      setPendingPortee({ symbolId: sym.id, x1: porteeStartRef.current.x, y1: porteeStartRef.current.y, x2: pe.x, y2: pe.y });
      return;
    }
    // Forme en cours de tracé
    if (tool === 'shape' && drawing && shapeStartRef.current && !annotDragRef.current) {
      const st = shapeStartRef.current;
      // Maj : ligne/flèche à 45°, rectangle/ellipse parfaits ; sinon fin aimantée.
      const a = assistPos(pos, e, { from: st, square: shapeTool === 'rect' || shapeTool === 'ellipse' });
      updateSnapHint(a.hint);
      setPendingShape({ x1: st.x, y1: st.y, x2: a.pos.x, y2: a.pos.y });
      return;
    }
    setCur(prev => [...prev, pos]);
  };

  const onEnd = e => {
    e.preventDefault();
    if (snapHint) setSnapHint(null);
    // Fin d'un pan à un doigt (plan zoomé) : si on a réellement glissé, on NE finalise PAS de
    // tracé/placement. Si c'était un simple tap (jamais passé en pan), on laisse onEnd continuer.
    if (oneFingerPanRef.current) {
      const wasPanning = oneFingerPanRef.current.panning;
      oneFingerPanRef.current = null;
      if (wasPanning) { setDrawing(false); setCur([]); return; }
    }
    // Relâchement → on masque l'aperçu photo (affiché pendant l'appui long sur un marqueur).
    if (vpHoldRef.current || vpPreview) { clearTimeout(vpHoldRef.current); vpHoldRef.current = null; setVpPreview(null); }
    if (vpRotateDragRef.current) { vpRotateDragRef.current = null; setDrawing(false); return; }
    if (panRef.current) { panRef.current = null; return; }
    if (touchHoldRef.current) { clearTimeout(touchHoldRef.current); touchHoldRef.current = null; }
    if (gestureRef.current) {
      if (e.touches.length < 2) gestureRef.current = null;
      return;
    }
    // Fin du cadre de sélection : éléments ENTIÈREMENT dans le cadre (+ ceux déjà sélectionnés si Maj).
    if (marqueeRef.current) {
      const { add } = marqueeRef.current;
      const r = marquee;
      marqueeRef.current = null; setMarquee(null); setDrawing(false);
      const minSz = 4 * cvRatio();
      if (!r || (r.x2 - r.x1 < minSz && r.y2 - r.y1 < minSz)) { selectIdxs(add); return; } // simple clic
      const inside = [];
      paths.forEach((p, i) => { const b = boundsOf(p); if (b && b.x1 >= r.x1 && b.x2 <= r.x2 && b.y1 >= r.y1 && b.y2 <= r.y2) inside.push(i); });
      selectIdxs([...add, ...inside]);
      return;
    }
    if (groupDragRef.current) { groupDragRef.current = null; setDrawing(false); return; }
    // Fin du placement flèche-callout (drag tip → box)
    if (tool === 'text' && arrowPlaceRef.current) {
      const tip = arrowPlaceRef.current;
      const box = pendingArrowLine ?? tip;
      const dist = Math.hypot(box.boxX - tip.x, box.boxY - tip.y);
      const boxX = dist > 12 ? box.boxX : tip.x + 60;
      const boxY = dist > 12 ? box.boxY : tip.y - 40;
      inlineEditCanvasPt.current = { x: boxX, y: boxY, arrowX: tip.x, arrowY: tip.y };
      setInlineEditIdx(null);
      setInlineEditPos(toScreenPos(boxX, boxY));
      setInlineEditVal('');
      setPendingArrowLine(null);
      arrowPlaceRef.current = null;
      setDrawing(false);
      return;
    }
    // Fin portée / pente_sol
    if (tool === 'symbol' && (sym.id === 'portee' || sym.id === 'pente_sol') && porteeStartRef.current) {
      if (pendingPortee) {
        const sid = sym.id;
        const len = Math.hypot(pendingPortee.x2 - pendingPortee.x1, pendingPortee.y2 - pendingPortee.y1);
        if (len > 8) {
          setPaths(prev => [...prev, { type:'symbol', symbolId:sid, x1:pendingPortee.x1, y1:pendingPortee.y1, x2:pendingPortee.x2, y2:pendingPortee.y2, color, size }]);
        } else {
          setPaths(prev => [...prev, { type:'symbol', symbolId:sid, x1:pendingPortee.x1 - 35, y1:pendingPortee.y1, x2:pendingPortee.x1 + 35, y2:pendingPortee.y1, color, size }]);
        }
      }
      setPendingPortee(null); porteeStartRef.current = null; setDrawing(false); return;
    }
    // Fin resize
    if (resizeDragRef.current) {
      resizeDragRef.current = null;
      setDrawing(false);
      return;
    }
    // Fin forme
    if (tool === 'shape' && shapeStartRef.current) {
      if (pendingShape) {
        const len = Math.hypot(pendingShape.x2 - pendingShape.x1, pendingShape.y2 - pendingShape.y1);
        // Maj + simple clic (sans tracer) sur une forme = sélection multiple (Maj + glisser reste
        // le tracé à angle droit / carré).
        if (len <= 6 && e?.shiftKey && !e.touches && toggleSelAt(shapeStartRef.current)) {
          setPendingShape(null); shapeStartRef.current = null; setDrawing(false); return;
        }
        if (len > 6) {
          addNewShape({ type: 'shape', shape: shapeTool, x1: pendingShape.x1, y1: pendingShape.y1, x2: pendingShape.x2, y2: pendingShape.y2, color, size, filled: shapeFilled, fillOpacity, strokeOpacity, ...shapeMulProp });
        }
      }
      setPendingShape(null);
      shapeStartRef.current = null;
      setDrawing(false);
      return;
    }
    // Fin déplacement symbole/viewpoint
    if (selAnnot !== null && annotDragRef.current) {
      annotDragRef.current = null; setDrawing(false); return;
    }
    // Fin d'interaction texte : déplacement, sélection (1er tap) ou édition (2e tap).
    if ((tool === 'text' || tool === 'select') && selTextIdx !== null && textDragRef.current) {
      const { moved, origX, origY, textVal, wasSelected } = textDragRef.current;
      textDragRef.current = null;
      setDrawing(false);
      if (moved) return; // déplacement terminé → on garde la sélection
      if (wasSelected) {
        // 2e tap (ou double-clic) sur un texte déjà sélectionné → réécriture DIRECTE sur le plan,
        // en mode Texte comme en Sélection (demande Thomas : « je re-clique sur le texte, je veux réécrire »).
        setPaths(prev => prev.map((p, i) => i === selTextIdx ? { ...p, x: origX, y: origY } : p));
        setInlineEditIdx(selTextIdx);
        setInlineEditPos(toScreenPos(origX, origY));
        setInlineEditVal(textVal);
        // PC : la sélection (et son panneau, sans zone de texte) reste → le plan ne se décale pas
        // sous la saisie. Tactile : comportement d'avant (panneau fermé).
        if (isTouchUI) setSelTextIdx(null);
      }
      // 1er tap → la sélection est conservée (le prochain tap ouvrira l'édition)
      return;
    }
    if (!drawing) return;
    if (tool === 'viewpoint' && vpStart.current) {
      const pIdx = activePh?.photoIdx ?? null;
      const nx   = pendingVP?.x ?? vpStart.current.x;
      const ny   = pendingVP?.y ?? vpStart.current.y;
      const nAng = pendingVP?.angle ?? 0;
      // R1 : une photo = un seul angle par plan. Si un marqueur local existe déjà pour cette
      // photo sur CE plan, on le repositionne — jamais deux marqueurs/Vxx pour la même photo.
      if (pIdx != null) {
        const exIdx = paths.findIndex(p => p.type === 'viewpoint' && p.photoIdx === pIdx
          && (p.originLocId == null || locId == null || p.originLocId === locId));
        if (exIdx >= 0) {
          setPaths(prev => prev.map((p, i) => i === exIdx ? { ...p, x: nx, y: ny, angle: nAng } : p));
          setPendingVP(null); vpStart.current = null; setDrawing(false); setActivePh(null);
          return;
        }
      }
      // R2 : même photo déjà numérotée sur un AUTRE plan de la zone → même numéro.
      // Sinon : prochain numéro libre, FIGÉ dans le marqueur (vpNum) — plus jamais recalculé.
      const reuse = pIdx != null && photoVpNums ? (photoVpNums.get(pIdx) ?? null) : null;
      const num   = reuse ?? nextVpNum;
      setPaths(prev => [...prev, {
        type: 'viewpoint',
        _vpId: crypto.randomUUID(),
        x: nx, y: ny, angle: nAng,
        label: `V${num}`, color, size,
        photoIdx: pIdx,
        // Identité STABLE de la photo ciblée (id de ligne) : permet au rapport de poser le badge
        // par identité, robuste à la propagation et aux changements d'ordre/index des photos.
        photoId: (pIdx != null && photos) ? (photos[pIdx]?._id ?? photos[pIdx]?.id ?? null) : null,
        vpNum: num,
        originLocId: locId ?? null,
      }]);
      setPendingVP(null);
      vpStart.current = null;
      setDrawing(false);
      setActivePh(null);
      return;
    }
    if (cur.length >= 2) setPaths(prev => [...prev, { type:'stroke', tool, points:cur, color, size }]);
    setCur([]); setDrawing(false);
  };

  const toScreenPos = (canvasX, canvasY) => {
    const cv = cvRef.current;
    const container = canvasWrapRef.current;
    if (!cv || !container) return { left: 0, top: 0 };
    const cr = cv.getBoundingClientRect();
    const wr = container.getBoundingClientRect();
    return {
      left: cr.left - wr.left + (canvasX / cv.width) * cr.width,
      top:  cr.top  - wr.top  + (canvasY / cv.height) * cr.height,
    };
  };

  const cancelInlineEdit = () => {
    setInlineEditIdx(null);
    setInlineEditPos(null);
    setInlineEditVal('');
    inlineEditCanvasPt.current = null;
  };

  // Applique l'édition de texte inline EN COURS à un tableau de paths et renvoie le nouveau
  // tableau (fonction PURE, synchrone). Permet de « flusher » le texte en cours SANS attendre le
  // blur : au clic sur Sauvegarder / à la navigation, on committe tel quel (demande Thomas :
  // valider doit sauvegarder même si on n'est pas sorti du champ de texte).
  const applyInlineEdit = (basePaths) => {
    if (inlineEditPos === null) return basePaths;
    const val = inlineEditVal.trim();
    if (inlineEditIdx !== null) {
      return val ? basePaths.map((p, i) => i === inlineEditIdx ? { ...p, text: val } : p)
                 : basePaths.filter((_, i) => i !== inlineEditIdx);
    }
    if (val && inlineEditCanvasPt.current) {
      const pt = inlineEditCanvasPt.current;
      const entry = { type: 'text', text: val, x: pt.x, y: pt.y, color, size, textMode };
      if (textMode === 'arrow') {
        entry.arrowX = pt.arrowX ?? (pt.x + 50);
        entry.arrowY = pt.arrowY ?? (pt.y - 50);
      }
      // Largeur par défaut si le texte déborderait du bord droit du canvas (fréquent sur photos
      // étroites) : sans ça, la poignée de redimensionnement (bord droit) tombe hors écran et
      // devient inattrapable. On force alors un retour à la ligne dans la zone visible.
      const cv = cvRef.current;
      if (cv) {
        const ctx = cv.getContext('2d');
        const fsU = 20 + size * 4;
        ctx.font = `bold ${fsU}px Arial`;
        const natW = String(val).split('\n').reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
        const pad = 10, margin = 14;
        if (pt.x + natW + pad * 2 + margin > cv.width) {
          entry.textW = Math.max(80, cv.width - pt.x - pad * 2 - margin);
        }
      }
      return [...basePaths, entry];
    }
    return basePaths;
  };

  const confirmInlineEdit = () => {
    // Calcul SYNCHRONE, AVANT cancelInlineEdit : applyInlineEdit lit inlineEditCanvasPt.current
    // (une ref). Dans un updater différé setPaths(prev => …), cancelInlineEdit aurait déjà remis
    // cette ref à null → le nouveau texte n'était JAMAIS ajouté (perte de texte signalée par Bach).
    if (inlineEditPos !== null) {
      const next = applyInlineEdit(paths);
      cancelInlineEdit();
      setPaths(next);
    } else {
      cancelInlineEdit();
    }
  };

  const addCustomSym = () => {
    const label = newSymName.trim();
    if (!label) return;
    const existing = loadCustomSymbols();
    const short = label.replace(/\s+/g, '').slice(0, 4).toUpperCase();
    const entry = { id: 'custom_' + crypto.randomUUID(), label, short, shapeIdx: existing.length };
    _lsSet(CUSTOM_SYMS_KEY, JSON.stringify([...existing, entry]));
    const newDefs = getCustomSymbolDefs();
    setCustomSyms(newDefs);
    setSym(newDefs[newDefs.length - 1]);
    setNewSymName(''); setShowNewSym(false);
  };

  const delCustomSym = (id) => {
    _lsSet(CUSTOM_SYMS_KEY, JSON.stringify(loadCustomSymbols().filter(s => s.id !== id)));
    const newDefs = getCustomSymbolDefs();
    setCustomSyms(newDefs);
    if (sym?.id === id) setSym(SYMBOLS[0]);
  };

  const validPhotos = (photos || []).filter(ph => ph.data);

  const selectPhoto = (ph, i) => {
    // Si un marqueur viewpoint est SÉLECTIONNÉ, on LIE cette photo au marqueur existant
    // (définit/répare le lien marqueur↔photo, sans le redessiner). C'est le moyen de corriger
    // un marqueur posé sans photo (photoIdx=null → pas de badge dans le rapport).
    const selIdx = selAnnot?.idx;
    if (selIdx != null && paths[selIdx]?.type === 'viewpoint') {
      setPaths(prev => prev.map((p, idx) => idx === selIdx
        ? { ...p, photoIdx: i, photoId: ph?._id ?? ph?.id ?? null }
        : p));
      setActivePh(null);
      return;
    }
    const isActive = activePh?.photoIdx === i;
    setActivePh(isActive ? null : { photoIdx: i, src: ph.data });
    setTool('viewpoint');
    setShowSyms(false);
  };

  const startStripLP = (src) => {
    clearTimeout(stripLPRef.current.timer);
    stripLPRef.current.fired = false;
    stripLPRef.current.timer = setTimeout(() => { stripLPRef.current.fired = true; setStripZoom(src); }, 280);
  };
  const endStripLP = () => { clearTimeout(stripLPRef.current.timer); setStripZoom(null); };

  const selText = selTextIdx !== null ? paths[selTextIdx] : null;
  // Marqueur viewpoint sélectionné (pour lier/relier une photo via la bande de photos).
  const selVp = (selAnnot !== null && paths[selAnnot.idx]?.type === 'viewpoint') ? paths[selAnnot.idx] : null;
  const isMob = typeof window !== 'undefined' && window.innerWidth < 640;
  // Hauteur de la bande des menus sur PC (tuiles symboles agrandies + curseur de taille, ou
  // panneau d'édition de texte). Constante → le plan ne change jamais de taille.
  const PANEL_SLOT_H = 160;

  // ── Enregistrer & fermer (bouton « Sauvegarder », et « Enregistrer » de la confirmation) ──
  const saveAndClose = () => {
    clearDraft(); // enregistré → le brouillon de secours n'a plus lieu d'être
    // Flush du texte inline EN COURS (si le champ est encore ouvert/focus) → valider
    // sauvegarde tout tel quel, sans devoir d'abord sortir du champ (demande Thomas).
    let fp = applyInlineEdit(paths);
    if (fp !== paths) { setPaths(fp); cancelInlineEdit(); }
    const pendPoly = pendingPolyShape(); // polyligne/zone non terminée → enregistrée telle quelle
    if (pendPoly) fp = [...fp, pendPoly];
    const cv = cvRef.current;
    if (!cv || !bgRef.current) { onSave(fp, null, null); onClose(); return; }
    // Exporter à max 1400px — scale calée sur le display réel pour cohérence visuelle
    const EW = Math.min(cv.width, 1400);
    const EH = Math.round(cv.height * EW / cv.width);
    const ec = document.createElement('canvas');
    ec.width = EW; ec.height = EH;
    const ectx = ec.getContext('2d');
    ectx.drawImage(bgRef.current, 0, 0, EW, EH);
    ectx.save();
    ectx.scale(EW / cv.width, EH / cv.height);
    const ratio = cv.clientWidth > 0 ? cv.width / cv.clientWidth : exportSizeMultiplier;
    if (isPhotoCtx) drawAnnotationPaths(ectx, relabel(fp), { text: ratio * 0.5 * scaleText, symbol: ratio * 0.5 * scaleSymbol, shape: scaleShape }, ratio);
    else { const _pl = planAnnotScales(cv.width, { text: scaleText, symbol: scaleSymbol, shape: scaleShape }); drawAnnotationPaths(ectx, relabel(fp), _pl.sizes, _pl.stroke); }
    ectx.restore();
    // Ramène les coords dans l'espace LQ (planBg) avant de sauver — invariant inter-sessions
    const sc = hqScaleRef.current;
    onSave(scalePaths(fp, 1/sc, 1/sc), ec.toDataURL('image/webp', 0.85), { w: cv.width, h: cv.height });
    onClose();
  };

  // ── Fermer : si des modifications ne sont pas enregistrées, on DEMANDE (Thomas : « ne jamais
  // perdre »). Rien à enregistrer → fermeture directe, comme avant. ──
  const hasUnsaved = () => isDirty || !!pendingPolyShape() || (inlineEditPos !== null && inlineEditVal.trim() !== '');
  const requestClose = () => { if (hasUnsaved()) setCloseAsk(true); else { clearDraft(); onClose(); } };
  const closeWithoutSaving = () => { setCloseAsk(false); clearDraft(); onClose(); };

  const duplicateAnnot = (src) => {
    if (!src) return;
    const OFF = 40;
    const copy = { ...src };
    if (copy._vpId) copy._vpId = crypto.randomUUID();
    // Dupliquer un viewpoint = NOUVELLE vue : numéro neuf, plus liée à la photo d'origine
    // (sinon deux marqueurs porteraient le même Vxx sur le même plan — interdit).
    if (copy.type === 'viewpoint') {
      copy.vpNum = nextVpNumRef.current;
      copy.label = `V${copy.vpNum}`;
      copy.photoIdx = null;
      copy.originLocId = locId ?? null;
    }
    if (copy.x  != null) { copy.x  += OFF; copy.y  += OFF; }
    if (copy.x1 != null) { copy.x1 += OFF; copy.y1 += OFF; copy.x2 += OFF; copy.y2 += OFF; }
    if (copy.arrowX != null) { copy.arrowX += OFF; copy.arrowY += OFF; }
    if (src.pts)    copy.pts    = src.pts.map(pt => ({ x: pt.x + OFF, y: pt.y + OFF }));
    if (src.points) copy.points = src.points.map(pt => ({ x: pt.x + OFF, y: pt.y + OFF }));
    setPaths(prev => [...prev, copy]);
  };

  // Derived values for shape sub-panel (computed before return to avoid IIFE-in-JSX minification issues)
  // Formes SÉLECTIONNÉES : le groupe (multi-sélection) ou la forme seule. Les réglages du panneau
  // Formes (contour, tirets, opacité, épaisseur) s'appliquent à TOUTES (demande Thomas : « sélectionner
  // 2 lignes et leur appliquer les mêmes modifs »). La 1re forme sert de référence d'affichage.
  const _selShapeIdxs = multiSel.length
    ? multiSel.filter(i => paths[i]?.type === 'shape')
    : (selAnnot !== null && paths[selAnnot.idx]?.type === 'shape' ? [selAnnot.idx] : []);
  const _selShapeSet = new Set(_selShapeIdxs);
  const _selShapeIdx = _selShapeIdxs.length ? _selShapeIdxs[0] : -1;
  const _selShape = _selShapeIdx >= 0 ? paths[_selShapeIdx] : null;
  const shapePanelVisible = tool === 'shape' || (tool === 'select' && _selShape !== null);
  const shapeFillDisplay = _selShape ? isShapeFilled(_selShape) : shapeFilled;
  const shapePanelFilled = shapeFillDisplay;
  const shapeDashDisplay = _selShape ? !!_selShape.dash : shapeDash;
  // Contour/Rempli n'a de sens que pour rectangle, ellipse et zone (pas ligne, flèche, polyligne).
  const shapeFillable = _selShape ? _selShapeIdxs.some(i => FILLABLE.has(paths[i].shape)) : FILLABLE.has(shapeTool);
  const updateSelShapes = (fn) => setPaths(prev => prev.map((p, i) => _selShapeSet.has(i) ? fn(p) : p));
  const shapePanelOpVal = _selShape
    ? (shapePanelFilled ? (_selShape.fillOpacity ?? 0.3) : (_selShape.strokeOpacity ?? 1))
    : (shapeFilled ? fillOpacity : strokeOpacity);
  const shapePanelOpLabel = _selShape
    ? (shapePanelFilled ? 'OPACITÉ REMPLI ✏' : 'OPACITÉ CONTOUR ✏')
    : 'OPACITÉ';

  // Trois curseurs de taille (Texte / Formes / Symboles), comme l'éditeur de rapport, affichés
  // ensemble au niveau des couleurs. Chacun pilote son type indépendamment (clés partagées).
  const _scaleSelShape = _selShape;
  const scaleCtls = [
    { lbl: 'Texte',    val: scaleText,   set: setScaleText,   key: SCALE_KEY('text') },
    // Formes : forme SÉLECTIONNÉE → seulement elle ; sinon → épaisseur des prochaines formes.
    // Jamais toutes les formes existantes d'un coup (réglage global = onglet Rapport).
    _scaleSelShape
      ? { lbl: 'Formes', title: _selShapeIdxs.length > 1 ? 'Formes sélect.' : 'Forme sélect.', val: scaleShape * (_scaleSelShape.sizeMul ?? 1), key: null,
          set: (v) => { const mul = scaleShape > 0 ? v / scaleShape : 1;
            updateSelShapes(p => ({ ...p, sizeMul: Math.round(mul * 1000) / 1000 })); } }
      : { lbl: 'Formes', title: 'Nouv. formes', val: newShapeScale, set: setNewShapeScale, key: SCALE_KEY('shape_new') },
    { lbl: 'Symboles', val: scaleSymbol, set: setScaleSymbol, key: SCALE_KEY('symbol') },
  ];

  // Couleur / épaisseur appliquées à l'élément SÉLECTIONNÉ — texte (selTextIdx) OU forme /
  // symbole / viewpoint (selAnnot) → cliquer une couleur recolore la forme sélectionnée
  // (avant : seul le texte changeait, d'où « impossible de mettre la zone en blanc »).
  const recolorSelection = (cl) => {
    setColor(cl);
    setPaths(prev => prev.map((p, i) =>
      ((selTextIdx !== null && i === selTextIdx) || (selAnnot !== null && i === selAnnot.idx) || multiSel.includes(i))
        ? { ...p, color: cl } : p));
  };
  const resizeSelection = (sz) => {
    setSize(sz);
    setPaths(prev => prev.map((p, i) =>
      ((selTextIdx !== null && i === selTextIdx) || (selAnnot !== null && i === selAnnot.idx) || multiSel.includes(i))
        ? { ...p, size: sz } : p));
  };

  // ── Tuile « Taille » ÉPINGLÉE (ne défile pas) + curseur contextuel par outil ──
  // Demande Thomas : dans chaque menu (Symboles/Formes/Texte), une petite case fixe à gauche
  // qui ouvre d'un tap LE curseur correspondant, sans occuper d'espace en permanence.
  const sizeCtlByTool = { symbol: 'Symboles', shape: 'Formes', text: 'Texte' };
  const renderSizePin = () => {
    const ctl = scaleCtls.find(c => c.lbl === sizeCtlByTool[tool]);
    return (
    <button onClick={() => setSizeOpen(v => !v)} title="Régler la taille"
      style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:1,
        margin:'6px 0 7px 10px', padding:'5px 4px', borderRadius:8, cursor:'pointer', width:isMob?56:72, boxSizing:'border-box', color:'#fff',
        border:`2px solid ${sizeOpen ? '#fff' : '#8a8a8a'}`, background: sizeOpen ? DA.red : '#4d4d4d' }}>
      <Ic n="sld" s={18}/>
      <span style={{ fontSize:isMob?8.5:11, fontWeight:800, color:'#fff', letterSpacing:0.2 }}>Taille</span>
      {ctl && <span style={{ fontSize:isMob?8:11, fontWeight:800, color: sizeOpen ? '#fff' : '#FFC9C9', lineHeight:1 }}>{ctl.val.toFixed(1)}×</span>}
    </button>
    );
  };
  const renderSizeSlider = () => {
    const ctl = scaleCtls.find(c => c.lbl === sizeCtlByTool[tool]);
    if (!ctl) return null;
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'0 12px 8px' }}>
        <span style={{ fontSize:isMob?9:11, color:'#ddd', fontWeight:700, letterSpacing:0.3, whiteSpace:'nowrap' }}>TAILLE {(ctl.title || ctl.lbl).toUpperCase()}</span>
        <input type="range" min="0.3" max="5" step="0.1" value={ctl.val}
          onChange={e => { const v = parseFloat(e.target.value); ctl.set(v); if (ctl.key) _lsSet(ctl.key, String(v)); }}
          style={{ flex:1, accentColor:DA.red, cursor:'pointer', height:22 }}/>
        <span style={{ color:'#fff', fontSize:12, fontWeight:800, minWidth:30, textAlign:'right' }}>{ctl.val.toFixed(1)}×</span>
      </div>
    );
  };

  // Boutons « Avancer / Reculer » (ordre des calques) — PC uniquement (demande Thomas).
  const renderLayerBtns = () => (isTouchUI ? null : (
    <div style={{ display:'flex', gap:4, flexShrink:0 }}>
      {[{ d:1, g:'▲', lbl:'Avancer', k:']' }, { d:-1, g:'▼', lbl:'Reculer', k:'[' }].map(b => (
        <button key={b.d} onClick={() => { if (inlineEditPos === null) reorderSelection(b.d); }}
          title={`${b.lbl} : passer ${b.d > 0 ? 'devant' : 'derrière'} l'élément qui chevauche (Ctrl+${b.k})`}
          style={{ padding:'4px 8px', background:'#333', color:'#ddd', border:'none', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>
          {b.g} {b.lbl}
        </button>
      ))}
    </div>
  ));

  return (
    <div style={{ position:'fixed',inset:0,background:'#111',zIndex:50,display:'flex',flexDirection:'column',
      paddingTop:'env(safe-area-inset-top, 0px)',paddingBottom:'env(safe-area-inset-bottom, 0px)',
      paddingLeft:'env(safe-area-inset-left, 0px)',paddingRight:'env(safe-area-inset-right, 0px)' }}>

      {/* ── Navigation photo précédente / suivante (flèches cliquables + touches ←/→) ── */}
      {onPrev && (
        <button onClick={onPrev} title="Photo précédente (←)" aria-label="Photo précédente"
          style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', zIndex:60,
            width:46, height:64, borderRadius:12, border:'none', cursor:'pointer',
            background:'rgba(0,0,0,0.5)', color:'#fff', fontSize:32, lineHeight:1,
            display:'flex', alignItems:'center', justifyContent:'center' }}>
          ‹
        </button>
      )}
      {onNext && (
        <button onClick={onNext} title="Photo suivante (→)" aria-label="Photo suivante"
          style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', zIndex:60,
            width:46, height:64, borderRadius:12, border:'none', cursor:'pointer',
            background:'rgba(0,0,0,0.5)', color:'#fff', fontSize:32, lineHeight:1,
            display:'flex', alignItems:'center', justifyContent:'center' }}>
          ›
        </button>
      )}
      {photoPosition && (onPrev || onNext) && (
        <div style={{ position:'absolute', bottom:14, left:'50%', transform:'translateX(-50%)', zIndex:60,
          background:'rgba(0,0,0,0.55)', color:'#fff', fontSize:12, fontWeight:700,
          padding:'4px 12px', borderRadius:20, pointerEvents:'none' }}>
          {photoPosition}
        </div>
      )}

      {/* Bandeau titre SUPPRIMÉ (demande Thomas : « le nom en haut tu peux jarter ») —
          chaque pixel vertical va au plan. La prop title est conservée pour compat. */}

      {/* ── Toolbar (2 rangées fixes) ── */}
      <div style={{ background:DA.black,padding:'7px 12px 6px',display:'flex',flexDirection:'column',gap:6,flexShrink:0 }}>

        {/* Rangée 1 : outils + undo + sauvegarder. Sur MOBILE, flex-wrap → les outils prennent une
            ligne PLEINE (tous visibles avec label, pas de scroll caché) et les actions passent
            sur la ligne suivante. (retour Thomas : ergonomie téléphone) */}
        <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:isMob?'wrap':'nowrap' }}>
          {/* Outils */}
          <div style={{ flex:isMob?'1 1 100%':1,overflowX:isMob?'visible':'auto',scrollbarWidth:'none',minWidth:0 }}>
            <div style={{ display:'flex',gap:3,background:'#333',padding:3,borderRadius:10,width:isMob?'100%':'max-content' }}>
              {[
                // « Sélect. » est le mode PAR DÉFAUT : pas de bouton sur desktop (on en sort en
                // choisissant un outil, on y revient avec Échap). Conservé sur mobile (pas d'Échap).
                ...(isMob ? [{ k:'select', n:'sel',  lbl:'Sélect.' }] : []),
                { k:'pen',    n:'pen',  lbl:'Dessin'  },
                { k:'text',   n:'txt',  lbl:'Texte'   },
                { k:'shape',  n:'shp',  lbl:'Formes'  },
                { k:'symbol', n:'sym',  lbl:'Symbole' },
              ].map(t => (
                <button key={t.k} title={isMob ? undefined : `${t.lbl} (${Object.keys(TOOL_KEYS).find(x => TOOL_KEYS[x] === t.k)?.toUpperCase()})`}
                  onClick={() => selectTool(t.k)}
                  style={{ padding:isMob?'9px 4px':'8px 14px',borderRadius:8,background:tool===t.k?DA.red:'transparent',
                    color:tool===t.k?'white':'#aaa',transition:'all 0.15s',flex:isMob?1:'none',
                    display:'flex',flexDirection:'column',alignItems:'center',gap:3,minWidth:isMob?0:66 }}>
                  <Ic n={t.n} s={26}/>
                  <span style={{ fontSize:isMob?9:12,fontWeight:700,letterSpacing:0.3 }}>{t.lbl}</span>
                </button>
              ))}
              {/* Palette — dans le groupe sur mobile */}
              {isMob && (
                <button onClick={() => { setShowPalette(v => !v); setShowSyms(false); }}
                  style={{ padding:'9px 4px',borderRadius:8,background:showPalette?DA.red:'transparent',
                    color:showPalette?'white':color,transition:'all 0.15s',flex:1,
                    display:'flex',flexDirection:'column',alignItems:'center',gap:3,minWidth:0 }}
                  title="Couleurs et épaisseur">
                  <Ic n="pal" s={26}/>
                  <span style={{ fontSize:9,fontWeight:700,letterSpacing:0.3 }}>Couleurs</span>
                </button>
              )}
            </div>
          </div>
          {/* Actions — sur mobile, sur leur PROPRE ligne (flex-wrap) et alignées à droite. */}
          <div style={{ display:'flex',gap:6,flexShrink:0,flex:isMob?'1 1 100%':'0 0 auto',justifyContent:'flex-end' }}>
            <button onClick={requestClose}
              style={{ padding:isMob?'8px 10px':'8px 12px',borderRadius:8,background:'#333',color:'#aaa',
                display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,minWidth:50,minHeight:44 }}
              title="Fermer">
              <Ic n="x" s={26}/>
              <span style={{ fontSize:isMob?8:11,color:'#999',letterSpacing:0.3 }}>Fermer</span>
            </button>
            <button onClick={undoLast} disabled={!canUndo}
              style={{ padding:isMob?'8px 10px':'8px 12px',borderRadius:8,background:'#333',color:'#aaa',opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'default',
                display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,minWidth:50,minHeight:44 }}
              title="Annuler dernière action (Ctrl+Z)">
              <Ic n="und" s={26}/>
              <span style={{ fontSize:isMob?8:11,color:'#999',letterSpacing:0.3 }}>Annuler</span>
            </button>
            {/* Rétablir — PC (demande Thomas). Grisé tant qu'il n'y a rien à rétablir. */}
            {!isMob && (
              <button onClick={redoLast} disabled={!canRedo}
                style={{ padding:'8px 12px',borderRadius:8,background:'#333',color:'#aaa',opacity: canRedo ? 1 : 0.4,
                  cursor: canRedo ? 'pointer' : 'default',
                  display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,minWidth:50,minHeight:44 }}
                title="Rétablir (Ctrl+Y)">
                <span style={{ display:'inline-flex', transform:'scaleX(-1)' }}><Ic n="und" s={26}/></span>
                <span style={{ fontSize:isMob?8:11,color:'#999',letterSpacing:0.3 }}>Rétablir</span>
              </button>
            )}
            <button onClick={saveAndClose}
              style={{ padding:isMob?'8px 12px':'8px 14px',borderRadius:8,background:DA.red,color:'white',
                display:'flex',flexDirection:'column',alignItems:'center',gap:3 }}>
              <Ic n="chk" s={isMob?24:20}/>
              <span style={{ fontSize:isMob?9:12,fontWeight:800,letterSpacing:0.3,whiteSpace:'nowrap' }}>{isMob?'Sauv.':'Sauvegarder'}</span>
            </button>
          </div>
        </div>

        {/* Rangée 2 : couleurs + tailles — cachée sur mobile (palette) */}
        {!isMob && <div style={{ display:'flex',alignItems:'center',gap:10,flexWrap:'wrap' }}>
          <div style={{ display:'flex',gap:6,flexShrink:0 }}>
            {ANNOT_COLORS.map(cl => (
              <button key={cl} onClick={() => recolorSelection(cl)}
                style={{ width:30,height:30,borderRadius:'50%',background:cl,
                  border:`3px solid ${color===cl?'white':'transparent'}`,
                  boxShadow:color===cl?`0 0 0 1.5px ${cl}`:'none',
                  cursor:'pointer',flexShrink:0,transition:'all 0.1s' }}/>
            ))}
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:8,flexShrink:0 }}>
            <span style={{ fontSize:11,color:'#aaa',fontWeight:700,letterSpacing:0.3 }}>ÉPAISSEUR</span>
            {[1,3,6].map(sz => (
              <button key={sz} onClick={() => resizeSelection(sz)}
                style={{ width:sz*3+14,height:sz*3+14,borderRadius:'50%',
                  background:size===sz?'white':'#555',
                  border:`2px solid ${size===sz?'white':'#444'}`,
                  cursor:'pointer',flexShrink:0,transition:'background 0.1s',
                  display:'flex',alignItems:'center',justifyContent:'center' }}/>
            ))}
          </div>
          {/* Tailles Texte / Formes / Symboles — comme l'éditeur de rapport, au niveau des couleurs */}
          {scaleCtls.map(s => (
            <div key={s.lbl} style={{ display:'flex',alignItems:'center',gap:5,flexShrink:0 }}>
              <span style={{ fontSize:12,color:'#bbb',fontWeight:700,letterSpacing:0.3,whiteSpace:'nowrap',minWidth:s.lbl === 'Formes' ? 104 : 0,textAlign:'right' }}>{s.title || s.lbl}</span>
              <input type="range" min="0.3" max="5" step="0.1" value={s.val}
                onChange={e => { const v = parseFloat(e.target.value); s.set(v); if (s.key) _lsSet(s.key, String(v)); }}
                style={{ width:96,accentColor:DA.red,cursor:'pointer' }}/>
              <span style={{ color:'#eee',fontSize:12,fontWeight:800,minWidth:30,textAlign:'right' }}>{s.val.toFixed(1)}×</span>
            </div>
          ))}
        </div>}
      </div>

      {/* ── Palette mobile (tiroir COMPACT : une ligne couleurs + épaisseur ; les curseurs de
             taille sont repliés derrière « Tailles » — on ne les règle qu'occasionnellement).
             Se replie automatiquement dès qu'on touche le plan. ── */}
      {isMob && showPalette && (
        <div style={{ background:DA.black,padding:'6px 12px 8px',display:'flex',flexDirection:'column',gap:7,flexShrink:0,borderBottom:'1px solid #333' }}>
          <div style={{ display:'flex',gap:9,alignItems:'center',overflowX:'auto',scrollbarWidth:'none' }}>
            {ANNOT_COLORS.map(cl => (
              <button key={cl} onClick={() => recolorSelection(cl)}
                style={{ width:34,height:34,borderRadius:'50%',background:cl,
                  border:`3px solid ${color===cl?'white':'transparent'}`,
                  boxShadow:color===cl?`0 0 0 2px ${cl}`:'none',cursor:'pointer',flexShrink:0 }}/>
            ))}
            <div style={{ width:1,height:26,background:'#333',flexShrink:0,margin:'0 3px' }}/>
            {/* Épaisseur : boutons carrés 40px (grosse cible tactile) avec un point interne
                proportionnel au trait — bien plus lisible/cliquable que les mini-cercles. */}
            {[1,3,6].map(sz => (
              <button key={sz} onClick={() => resizeSelection(sz)} title="Épaisseur du trait"
                style={{ width:40,height:40,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,cursor:'pointer',
                  background:size===sz?DA.red:'#2a2a2a',border:'none' }}>
                <span style={{ width:sz*2+6,height:sz*2+6,borderRadius:'50%',background:size===sz?'white':'#bbb',display:'block' }}/>
              </button>
            ))}
          </div>
          {/* Curseurs Texte/Formes/Symboles TOUJOURS visibles dans la palette (retour Thomas :
              le bouton « Tailles ▾ » les cachait trop). La palette entière se replie au toucher du plan. */}
          {scaleCtls.map(s => (
            <div key={s.lbl} style={{ display:'flex',alignItems:'center',gap:10 }}>
              <span style={{ fontSize:11,color:'#ddd',fontWeight:700,letterSpacing:0.3,whiteSpace:'nowrap',minWidth:66 }}>{s.title || s.lbl}</span>
              <input type="range" min="0.3" max="5" step="0.1" value={s.val}
                onChange={e => { const v = parseFloat(e.target.value); s.set(v); if (s.key) _lsSet(s.key, String(v)); }}
                style={{ flex:1,accentColor:DA.red,cursor:'pointer',height:26 }}/>
              <span style={{ color:'#fff',fontSize:13,fontWeight:800,minWidth:32,textAlign:'right' }}>{s.val.toFixed(1)}×</span>
            </div>
          ))}
        </div>
      )}

      {/* ── EMPLACEMENT FIXE DES MENUS (PC) — retour Thomas : « quand le menu s'ouvre, la taille du
             plan change ». Sur PC, tous les menus contextuels (symboles, formes, texte, élément
             sélectionné, aides) vivent dans une bande de hauteur CONSTANTE → le plan garde
             exactement la même taille et la même place, menu ouvert ou fermé. Mobile : inchangé
             (display:contents = comme si cette enveloppe n'existait pas). ── */}
      <div style={isMob ? { display:'contents' } : { height:PANEL_SLOT_H, flexShrink:0, overflowY:'auto', background:'#1a1a1a', borderBottom:'1px solid #333' }}>
      {/* ── Symbol picker — rangée UNIFIÉE (demande Thomas : plus d'onglets, une seule ligne
             défilante avec séparateurs de catégories, et le NOM COMPLET sous chaque picto —
             sur le plan les marqueurs gardent leurs codes courts FV/FO/L., rien ne change). ── */}
      {showSyms && tool === 'symbol' && (
        <div style={{ background:'#1a1a1a', flexShrink:0, borderBottom:'1px solid #333' }}>
          <div style={{ display:'flex', alignItems:'stretch' }}>
          {renderSizePin()}
          <div style={{ flex:1, minWidth:0, display:'flex', gap:6, padding:'6px 10px 7px', overflowX:'auto', alignItems:'stretch' }}>
            {SYMBOL_CATEGORIES.flatMap(cat => ([
              // Séparateur de catégorie : étiquette verticale discrète
              <div key={`cat-${cat.id}`} style={{ flexShrink:0, display:'flex', alignItems:'center', padding:'0 3px' }}>
                <span style={{ fontSize:isMob?8.5:10.5, fontWeight:800, color:isMob?'#666':'#999', letterSpacing:1.2, textTransform:'uppercase',
                  writingMode:'vertical-rl', transform:'rotate(180deg)', lineHeight:1 }}>{cat.label}</span>
              </div>,
              ...cat.ids.map(id => {
                const sm = getAllSymbols().find(s => s.id === id);
                if (!sm) return null;
                const isActive = sym.id === sm.id;
                return (
                  <button key={sm.id} onClick={() => setSym(sm)} title={sm.label}
                    style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:2,
                      padding:'5px 6px', borderRadius:8, cursor:'pointer', width:isMob?68:104, boxSizing:'border-box',
                      /* Sélection = LISERÉ rouge (fond sombre conservé : le picto rouge reste visible,
                         le fond rouge le rendait invisible — retour Thomas) */
                      border:`2px solid ${isActive ? DA.red : 'transparent'}`,
                      background:'#2a2a2a' }}>
                    <SymMiniCanvas sm={sm} color={color} size={isMob ? 40 : 48} />
                    {/* NOM COMPLET — zone COMPACTE (2 lignes max) pour garder la bande basse
                        et laisser le plan visible (retour Thomas : « je vois plus rien sur le plan »). */}
                    <span style={{ fontSize:isMob?8:11, fontWeight:600, color:isActive?'white':(isMob?'#aaa':'#ddd'), lineHeight:1.15, textAlign:'center', display:'block', whiteSpace:'normal', wordBreak:'break-word' }}>
                      {sm.label}
                    </span>
                  </button>
                );
              }),
            ]))}
            {/* Symboles custom (fin de rangée, section Divers) */}
            {getCustomSymbolDefs().map(sm => {
              const isActive = sym.id === sm.id;
              return (
                <div key={sm.id} style={{ position:'relative', flexShrink:0 }}>
                  <button onClick={() => setSym(sm)}
                    style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2,
                      padding:'5px 6px', borderRadius:8, cursor:'pointer', width:isMob?68:104, boxSizing:'border-box',
                      border:`2px solid ${isActive ? DA.red : 'transparent'}`,
                      background:'#2a2a2a' }}>
                    <SymMiniCanvas sm={sm} color={color} size={isMob ? 40 : 48} />
                    <span style={{ fontSize:isMob?8:11, fontWeight:600, color:isActive?'white':(isMob?'#aaa':'#ddd'), lineHeight:1.15, textAlign:'center', display:'block', whiteSpace:'normal', wordBreak:'break-word' }}>{sm.label}</span>
                  </button>
                  <button onClick={() => delCustomSym(sm.id)} title="Supprimer"
                    style={{ position:'absolute',top:-4,right:-5,width:15,height:15,borderRadius:'50%',background:'#B91C1C',color:'white',border:'none',fontSize:9,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0,lineHeight:1,zIndex:2 }}>×</button>
                </div>
              );
            })}
            {/* Créer custom */}
            {(!showNewSym
              ? <button onClick={() => setShowNewSym(true)}
                  style={{ flexShrink:0,padding:'6px 10px',borderRadius:8,background:'transparent',color:'#4A9EFF',fontSize:isMob?11:13,fontWeight:700,whiteSpace:'nowrap',cursor:'pointer',border:'1.5px dashed #4A9EFF',alignSelf:'center' }}>
                  + Créer
                </button>
              : <div style={{ display:'flex',gap:5,alignItems:'center',flexShrink:0,alignSelf:'center' }}>
                  <input autoFocus value={newSymName} onChange={e=>setNewSymName(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter')addCustomSym();if(e.key==='Escape'){setShowNewSym(false);setNewSymName('');}}}
                    placeholder="Nom…"
                    style={{ fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid #555',background:'#222',color:'white',outline:'none',minWidth:80,fontFamily:'inherit' }}/>
                  <button onClick={addCustomSym} style={{ padding:'4px 10px',background:DA.red,color:'white',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0 }}>OK</button>
                  <button onClick={() => {setShowNewSym(false);setNewSymName('');}} style={{ padding:'4px 7px',background:'#333',color:'#aaa',borderRadius:6,fontSize:11,cursor:'pointer',flexShrink:0 }}>✕</button>
                </div>
            )}
          </div>
          </div>
          {sizeOpen && renderSizeSlider()}
        </div>
      )}

      {/* ── Shape sub-panel ── */}
      {shapePanelVisible && (
        <div style={{ background:'#1a1a1a',flexShrink:0,borderBottom:'1px solid #333' }}>
          <div style={{ display:'flex', alignItems:'stretch' }}>
          {sizeCtlByTool[tool] && renderSizePin()}
          {/* UNE seule ligne défilante (Zone libre avec Rectangle & co — demande Thomas) */}
          <div style={{ flex:1,minWidth:0,padding:'7px 12px',display:'flex',gap:6,overflowX:'auto',alignItems:'center' }}>
          {tool === 'shape' && (
            <>
              {/* Tuiles tactiles, même style que les symboles (glyphe + libellé, liseré rouge
                  quand sélectionné) — demande Thomas, plus confortable au doigt. */}
              {[
                { k:'rect',    g:'▭', lbl:'Rectangle'  },
                { k:'ellipse', g:'◯', lbl:'Ellipse'    },
                { k:'arrow',   g:'→', lbl:'Flèche'     },
                { k:'line',    g:'╱', lbl:'Ligne'      },
                { k:'poly',     g:'⬠', lbl:'Zone libre' },
                { k:'polyline', g:'∠', lbl:'Polyligne'  },
              ].map(s => (
                <button key={s.k} onClick={() => { if (s.k !== shapeTool) finishPoly(); setShapeTool(s.k); }}
                  title={isMob ? undefined : `${s.lbl} (${Object.keys(SHAPE_HOTKEYS).find(x => SHAPE_HOTKEYS[x] === s.k)?.toUpperCase()})`}
                  style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:2,
                    padding:'6px 4px', borderRadius:8, cursor:'pointer', width:isMob?74:96, boxSizing:'border-box',
                    border:`2px solid ${shapeTool===s.k ? DA.red : 'transparent'}`, background:'#2a2a2a' }}>
                  <span style={{ fontSize:isMob?22:27, lineHeight:1, color:shapeTool===s.k?'white':'#ccc' }}>{s.g}</span>
                  <span style={{ fontSize:isMob?8.5:12, fontWeight:600, color:shapeTool===s.k?'white':(isMob?'#aaa':'#ddd'), whiteSpace:'nowrap' }}>{s.lbl}</span>
                </button>
              ))}
              <div style={{ width:1,height:28,background:'#333',flexShrink:0,margin:'0 4px' }}/>
            </>
          )}
          {/* Contour / Rempli : UNE valeur cible (l'inverse de ce qui est affiché), appliquée à la
              forme sélectionnée (ou qu'on vient de tracer) ET retenue pour les prochaines formes.
              Avant : la forme et le réglage par défaut basculaient chacun de leur côté → effet
              « schmilblick » (retour Thomas). */}
          {shapeFillable && (
            <button onClick={() => {
              const nv = !shapeFillDisplay;
              if (_selShape) updateSelShapes(p => (FILLABLE.has(p.shape) ? { ...p, filled: nv } : p));
              setShapeFilled(nv);
            }}
              title={shapeFillDisplay ? 'Forme remplie — cliquer pour un simple contour' : 'Simple contour — cliquer pour remplir'}
              style={{ width:isMob?92:108,textAlign:'center',padding:'5px 8px',borderRadius:7,fontSize:isMob?12:13,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,
                background:shapeFillDisplay?DA.red:'#333',color:shapeFillDisplay?'white':'#aaa',border:'none' }}>
              {shapeFillDisplay ? '◼ Rempli' : '◻ Contour'}
            </button>
          )}
          {/* Trait plein / en tirets (demande Thomas) — même logique que Contour/Rempli. */}
          <button onClick={() => {
            const nv = !shapeDashDisplay;
            if (_selShape) updateSelShapes(p => ({ ...p, dash: nv }));
            setShapeDash(nv);
          }}
            title={shapeDashDisplay ? 'Trait en tirets — cliquer pour un trait plein' : 'Trait plein — cliquer pour des tirets'}
            style={{ width:isMob?80:94,textAlign:'center',padding:'5px 8px',borderRadius:7,fontSize:isMob?12:13,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,
              background:shapeDashDisplay?DA.red:'#333',color:shapeDashDisplay?'white':'#aaa',border:'none' }}>
            {shapeDashDisplay ? '┄ Tirets' : '─ Plein'}
          </button>
          <div style={{ width:1,height:18,background:'#333',flexShrink:0,margin:'0 2px' }}/>
          <span style={{ fontSize:isMob?9:11,color:isMob?'#888':'#aaa',fontWeight:600,letterSpacing:0.3,flexShrink:0,whiteSpace:'nowrap',width:isMob?110:142,textAlign:'right' }}>{shapePanelOpLabel}</span>
          <input type="range" min="0.05" max="1" step="0.05" value={shapePanelOpVal}
            onChange={e => {
              const nv = parseFloat(e.target.value);
              if (_selShape) {
                const opKey = shapePanelFilled ? 'fillOpacity' : 'strokeOpacity';
                updateSelShapes(p => ({ ...p, [opKey]: nv }));
              } else if (shapeFilled) { setFillOpacity(nv); } else { setStrokeOpacity(nv); }
            }}
            style={{ width:70,accentColor:DA.red,cursor:'pointer',flexShrink:0 }}/>
          <span style={{ fontSize:11,color:'#ccc',fontWeight:700,minWidth:28,flexShrink:0 }}>{Math.round(shapePanelOpVal*100)}%</span>
          {selAnnot?.fresh && _selShape && renderLayerBtns()}
          {tool === 'shape' && (
            <span style={{ fontSize:isMob?10:12,color:isMob?'#555':'#999',marginLeft:4,flex:1,whiteSpace:'nowrap',overflow:'hidden' }}>
              {shapeTool === 'poly'
                ? 'Clic = sommet · Clic sur le 1er point, Entrée ou clic droit = fermer · Échap = annuler'
                : shapeTool === 'polyline'
                ? 'Clic = point · Entrée, clic droit ou double-clic = terminer · Échap = annuler'
                : 'Glisser = dessiner · Clic = sélect. · Poignées = resize · Suppr = effacer'}
            </span>
          )}
          </div>
          </div>
          {sizeOpen && renderSizeSlider()}
        </div>
      )}

      {/* ── Sélecteur de mode texte ── */}
      {tool === 'text' && !selText && (
        <div style={{ background:'#1a1a1a',borderBottom:'1px solid #333',flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'stretch' }}>
          {renderSizePin()}
          <div style={{ flex:1,minWidth:0,padding:'6px 12px',display:'flex',alignItems:'center',gap:6,overflowX:'auto' }}>
          {/* Tuiles tactiles, même style que symboles/formes (demande Thomas). */}
          {[
            { k:'plain', g:'T',  lbl:'Libre'   },
            { k:'boxed', g:'⬚', lbl:'Encadré' },
            { k:'arrow', g:'↗',  lbl:'Flèche'  },
          ].map(m => (
            <button key={m.k} onClick={() => setTextMode(m.k)}
              style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:2,
                padding:'6px 4px', borderRadius:8, cursor:'pointer', width:isMob?74:96, boxSizing:'border-box',
                border:`2px solid ${textMode===m.k ? DA.red : 'transparent'}`, background:'#2a2a2a' }}>
              <span style={{ fontSize:isMob?22:27, lineHeight:1, color:textMode===m.k?'white':'#ccc' }}>{m.g}</span>
              <span style={{ fontSize:isMob?8.5:12, fontWeight:600, color:textMode===m.k?'white':(isMob?'#aaa':'#ddd'), whiteSpace:'nowrap' }}>{m.lbl}</span>
            </button>
          ))}
          <span style={{ fontSize:isMob?10:12,color:isMob?'#555':'#999',marginLeft:4,flex:1 }}>
            {textMode === 'arrow' ? '① Appuyez là où pointe la flèche  ② Glissez jusqu\'au texte' : 'Tapez pour écrire — tapez sur un texte existant pour le modifier directement'}
          </span>
          </div>
          </div>
          {sizeOpen && renderSizeSlider()}
        </div>
      )}

      {/* ── Panneau édition texte sélectionné — REFONTE MOBILE : 2 rangées, grosses cibles ── */}
      {selText && (
        <div style={{ background:'#1a1a1a', padding:'8px 10px', borderBottom:'1px solid #333', display:'flex', flexDirection:'column', gap:8, flexShrink:0 }}>
          {/* Rangée 1 : zone de texte multi-ligne (Entrée = nouvelle ligne, la boîte s'adapte) +
              fermer. fontSize 16 → pas de zoom iOS ; hauteur auto jusqu'à ~5 lignes. */}
          <div style={{ display:'flex', alignItems: isTouchUI ? 'flex-start' : 'center', gap:8 }}>
            {isTouchUI ? (
            <textarea
              value={selText.text || ''} placeholder="Votre texte…  (Entrée = nouvelle ligne)"
              rows={Math.min(5, Math.max(1, String(selText.text || '').split('\n').length))}
              onChange={e => setPaths(prev => prev.map((p,i) => i===selTextIdx ? {...p,text:e.target.value} : p))}
              style={{ flex:1, minWidth:0, fontSize:16, padding:'9px 12px', borderRadius:9, border:'1px solid #555', background:'#222', color:'white', outline:'none', fontFamily:'inherit', resize:'none', lineHeight:1.3 }}/>
            ) : (
              // PC : on réécrit DIRECTEMENT sur le plan (re-clic sur le texte) → plus de zone en doublon ici.
              <span style={{ flex:1, minWidth:0, fontSize:12.5, color:'#999' }}>
                Recliquez sur le texte pour le réécrire{selText.textMode === 'arrow' ? ' · glissez le losange orange pour déplacer la base de la flèche' : ''}
              </span>
            )}
            <button onClick={() => setSelTextIdx(null)} title="Fermer"
              style={{ width:40, height:40, flexShrink:0, borderRadius:9, background:'#333', color:'#ccc', border:'none', fontSize:16, cursor:'pointer' }}>✕</button>
          </div>
          {/* Rangée 2 : style (segmenté) + dupliquer + supprimer, gros boutons */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ display:'flex', flex:1, gap:4, background:'#111', borderRadius:10, padding:3 }}>
              {[{ k:'plain', g:'T', lbl:'Simple' },{ k:'boxed', g:'⬚', lbl:'Encadré' },{ k:'arrow', g:'↗', lbl:'Flèche' }].map(m => {
                const active = (selText.textMode||'plain')===m.k;
                return (
                  <button key={m.k} onClick={() => setPaths(prev => prev.map((p,i) => {
                      if (i !== selTextIdx) return p;
                      const np = { ...p, textMode: m.k };
                      // Passer en « Flèche » APRÈS coup : (re)créer la pointe si absente pour que le
                      // point orange DÉPLAÇABLE réapparaisse (retour Thomas : « le point orange a disparu »).
                      if (m.k === 'arrow' && np.arrowX == null) { np.arrowX = (np.x ?? 0) + 70; np.arrowY = (np.y ?? 0) + 70; }
                      return np;
                    }))}
                    style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:1, padding:'8px 0', borderRadius:8, border:'none', cursor:'pointer',
                      background: active?DA.red:'transparent', color: active?'white':'#bbb', fontWeight:700 }}>
                    <span style={{ fontSize:16, lineHeight:1 }}>{m.g}</span>
                    <span style={{ fontSize:9.5 }}>{m.lbl}</span>
                  </button>
                );
              })}
            </div>
            {renderLayerBtns()}
            <button onClick={() => { duplicateAnnot(selText); setSelTextIdx(paths.length); }} title="Dupliquer"
              style={{ width:46, height:46, flexShrink:0, borderRadius:10, background:'#1d4ed8', color:'white', border:'none', fontSize:20, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>⊕</button>
            <button onClick={() => { if (inlineEditIdx === selTextIdx) cancelInlineEdit(); setPaths(p => p.filter((_,i) => i !== selTextIdx)); setSelTextIdx(null); }} title="Supprimer"
              style={{ width:46, height:46, flexShrink:0, borderRadius:10, background:'#B91C1C', color:'white', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Ic n="del" s={17}/>
            </button>
          </div>
          {/* Rangée 3 : taille du texte EN DIRECT (retour Thomas : « je ne peux pas changer
              l'échelle en direct »). Le curseur agit tout de suite sur le texte sélectionné. */}
          <div style={{ display:'flex', alignItems:'center', gap:10, background:'#111', borderRadius:10, padding:'6px 12px' }}>
            <span style={{ fontSize:12, color:'#bbb', fontWeight:800, flexShrink:0 }}>A</span>
            <input type="range" min="-3" max="14" step="0.5" value={selText.size ?? 3}
              onChange={e => { const v = parseFloat(e.target.value);
                setPaths(prev => prev.map((p,i) => {
                  if (i !== selTextIdx) return p;
                  // Le cadre à largeur figée (word-wrap) doit RÉTRÉCIR avec la police : on met textW à
                  // l'échelle du rapport de tailles pour qu'il colle toujours au texte (retour Thomas :
                  // « la case ne bouge pas en fonction de la taille du texte »).
                  const oldFs = 20 + (p.size ?? 3) * 4, newFs = 20 + v * 4;
                  const np = { ...p, size: v };
                  if (p.textW && oldFs > 0) np.textW = Math.max(20, p.textW * (newFs / oldFs));
                  return np;
                }));
              }}
              style={{ flex:1, accentColor:DA.red, cursor:'pointer', height:26 }}/>
            <span style={{ fontSize:20, color:'#eee', fontWeight:800, flexShrink:0, lineHeight:1 }}>A</span>
          </div>
        </div>
      )}

      {/* ── Panneau symbole/viewpoint sélectionné ── */}
      {selAnnot !== null && !selAnnot.fresh && paths[selAnnot.idx] && (
        <div style={{ background:'#1a1a1a',padding:'7px 12px',borderBottom:'1px solid #333',display:'flex',alignItems:'center',gap:8,flexShrink:0 }}>
          <span style={{ fontSize:isMob?10:12.5,color:'#4A9EFF',fontWeight:700,flexShrink:0 }}>
            Sélection : {paths[selAnnot.idx].type === 'viewpoint'
              ? 'Vue'
              : paths[selAnnot.idx].type === 'shape'
                ? ({ rect:'Rect.', ellipse:'Ellipse', arrow:'Flèche', line:'Ligne', poly:'Zone', polyline:'Polyligne' }[paths[selAnnot.idx].shape] || 'Forme')
                : (getAllSymbols().find(s => s.id === paths[selAnnot.idx].symbolId)?.label || 'Symbole')
            }
          </span>
          <span style={{ fontSize:isMob?10:12,color:isMob?'#666':'#999',flex:1 }}>Glisser pour déplacer{paths[selAnnot.idx].type === 'viewpoint' ? ' · poignée bleue pour réorienter' : ''}{isMob ? '' : ' · Ctrl+clic = en sélectionner plusieurs'}</span>
          {paths[selAnnot.idx].type !== 'viewpoint' && renderLayerBtns()}
          <button onClick={() => { duplicateAnnot(paths[selAnnot.idx]); }}
            style={{ padding:'4px 8px',background:'#1d4ed8',color:'white',border:'none',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0 }}>
            ⊕ Dupliquer
          </button>
          <button onClick={() => {
              const wasVp = paths[selAnnot.idx]?.type === 'viewpoint';
              setPaths(p => { const next = p.filter((_,i) => i !== selAnnot.idx); return wasVp ? resequenceVps(next) : next; });
              setSelAnnot(null); annotDragRef.current = null;
            }}
            style={{ padding:'4px 8px',background:'#B91C1C',color:'white',border:'none',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0,display:'flex',alignItems:'center' }}>
            <Ic n="del" s={13}/>
          </button>
          <button onClick={() => { setSelAnnot(null); annotDragRef.current = null; }}
            style={{ padding:'4px 8px',background:'#333',color:'#aaa',border:'none',borderRadius:6,fontSize:11,cursor:'pointer',flexShrink:0 }}>
            ✕
          </button>
        </div>
      )}

      {/* ── Groupe sélectionné (cadre de sélection / Maj+clic) ── */}
      {multiSel.length > 0 && (
        <div style={{ background:'#1a1a1a',padding:'7px 12px',borderBottom:'1px solid #333',display:'flex',alignItems:'center',gap:8,flexShrink:0 }}>
          <span style={{ fontSize:isMob?10:12.5,color:'#4A9EFF',fontWeight:700,flexShrink:0 }}>
            Sélection : {multiSel.length} élément{multiSel.length > 1 ? 's' : ''}
          </span>
          <span style={{ fontSize:isMob?10:12,color:isMob?'#666':'#999',flex:1 }}>Glisser pour déplacer · flèches = au pixel · couleur = pour tous</span>
          {renderLayerBtns()}
          <button onClick={() => duplicateSelection()}
            style={{ padding:'4px 8px',background:'#1d4ed8',color:'white',border:'none',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0 }}>
            ⊕ Dupliquer
          </button>
          <button onClick={() => deleteSelectionGroup()} title="Supprimer la sélection"
            style={{ padding:'4px 8px',background:'#B91C1C',color:'white',border:'none',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0,display:'flex',alignItems:'center' }}>
            <Ic n="del" s={13}/>
          </button>
          <button onClick={() => setMultiSel([])}
            style={{ padding:'4px 8px',background:'#333',color:'#aaa',border:'none',borderRadius:6,fontSize:11,cursor:'pointer',flexShrink:0 }}>
            ✕
          </button>
        </div>
      )}

      {/* ── Aide viewpoint ── */}
      {tool === 'viewpoint' && !selAnnot && (
        <div style={{ background:'#1a1a1a',padding:'5px 14px',borderBottom:'1px solid #333',flexShrink:0,display:'flex',alignItems:'center',gap:8 }}>
          <Ic n="eye" s={12}/>
          <span style={{ fontSize:isMob?11:12.5,color:isMob?'#888':'#aaa' }}>
            {activePh
              ? <><span style={{ color:DA.red,fontWeight:700 }}>{activePh.label}</span> sélectionnée — cliquer-glisser pour placer et orienter</>
              : 'Cliquer-glisser pour placer. Cliquer sur un existant pour le déplacer.'}
          </span>
        </div>
      )}

      {/* ── Aide symboles orientables ── */}
      {tool === 'symbol' && (sym?.id === 'portee' || sym?.id === 'pente_sol') && !selAnnot && (
        <div style={{ background:'#1a1a1a',padding:'5px 14px',borderBottom:'1px solid #333',flexShrink:0,display:'flex',alignItems:'center',gap:8 }}>
          <span style={{ fontSize:isMob?11:12.5,color:isMob?'#888':'#aaa' }}>Cliquer-glisser pour orienter. Cliquer sur un existant pour le déplacer.</span>
        </div>
      )}

      </div>

      {/* ── Canvas ── */}
      <div ref={canvasWrapRef} style={{ flex:1,overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',background:'#1a1a1a',padding:8,minHeight:0 }}>
        {bgImage ? (
          <div style={{ position:'relative',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center' }}>
            <canvas ref={cvRef}
              style={{ ...(dispSize ? { width:dispSize.w, height:dispSize.h } : {}), maxWidth:'100%',maxHeight:'100%',display:'block',touchAction:'none',boxShadow:'0 0 40px rgba(0,0,0,0.5)',cursor:spaceDown?'grab':tool==='text'?'text':tool==='select'?'default':'crosshair',transform:`translate(${vt.px}px,${vt.py}px) scale(${vt.z})`,transformOrigin:'50% 50%' }}
              onMouseDown={e => { if (showPalette) setShowPalette(false); onStart(e); }} onMouseMove={onMove} onMouseUp={onEnd} onMouseLeave={onEnd}
              onTouchStart={e => { if (showPalette) setShowPalette(false); onStart(e); }} onTouchMove={onMove} onTouchEnd={onEnd}
              onContextMenu={e => { e.preventDefault(); finishPoly(); }}
              onDoubleClick={() => {
                // Double-clic dans le VIDE (outil Sélection) = revenir à la vue entière.
                if (tool === 'select' && vtRef.current.z > 1.001 && !selAnnotRef.current && selTextIdxRef.current == null && !multiSelRef.current.length) zoomTo(1);
              }}/>
            {/* PHOTO : zone grisée = ce qui sera COUPÉ dans le cadre du rapport (demande Thomas :
                « j'annote au pif et mon annotation sort du cadre sans que je le voie »). Même calcul
                que le rapport (lib/photoFrame.js), recalculé en direct avec les annotations en cours.
                Affichage seulement : jamais dans l'image exportée, ne capte aucun clic. */}
            {(() => {
              const cv = cvRef.current;
              if (!reportFrame || !dispSize || !cv?.width || !cv?.height) return null;
              const [cx, cy, cz] = reportCrop({ cropX: reportFrame.cropX, cropY: reportFrame.cropY, cropZoom: reportFrame.cropZoom }, paths, cv.width, cv.height);
              const r = reportVisibleRect(cv.width, cv.height, { orient: reportFrame.orient, cx, cy, cz, fit: reportFrame.fit });
              if (!r) return null;
              const hole = `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`;
              return (
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none', zIndex:2 }}>
                  <div style={{ position:'relative', width:dispSize.w, height:dispSize.h, maxWidth:'100%', maxHeight:'100%', transform:`translate(${vt.px}px,${vt.py}px) scale(${vt.z})`, transformOrigin:'50% 50%' }}>
                    <svg viewBox="0 0 1 1" preserveAspectRatio="none" width="100%" height="100%" style={{ position:'absolute', inset:0, display:'block' }}>
                      <path d={`M0 0H1V1H0Z${hole}`} fill="rgba(20,20,20,0.5)" fillRule="evenodd"/>
                      <path d={hole} fill="none" stroke="white" strokeWidth="1.5" strokeDasharray="6 4" vectorEffect="non-scaling-stroke"/>
                    </svg>
                    <span style={{ position:'absolute', left:`${(r.x * 100).toFixed(2)}%`, top:`${(r.y * 100).toFixed(2)}%`, transform:`scale(${1 / vt.z})`, transformOrigin:'0 0',
                      background:'rgba(0,0,0,0.65)', color:'white', fontSize:11, fontWeight:700, padding:'2px 7px', borderRadius:5, whiteSpace:'nowrap', margin:'4px 0 0 4px' }}>
                      Cadre du rapport — le grisé ne sera pas visible
                    </span>
                  </div>
                </div>
              );
            })()}
            {vt.z > 1.05 && (
              <button
                onTouchStart={e => { e.stopPropagation(); setVt({ z:1, px:0, py:0 }); }}
                onClick={() => setVt({ z:1, px:0, py:0 })}
                title={isMob ? undefined : 'Vue entière (Ctrl+0 · double-clic dans le vide)'}
                style={{ position:'absolute',top:8,right:8,background:'rgba(0,0,0,0.72)',border:'none',color:'white',borderRadius:8,padding:'5px 11px',fontSize:11,fontWeight:700,cursor:'pointer',zIndex:5,letterSpacing:0.3 }}>
                ×{vt.z.toFixed(1)} ↺
              </button>
            )}
            {/* Aide des raccourcis (PC) : petit « ? » discret dans le coin, ou touche ?. */}
            {!isMob && (
              <button onClick={() => setShowHelp(v => !v)} title="Raccourcis clavier (?)"
                style={{ position:'absolute', bottom:8, right:8, zIndex:5, width:30, height:30, borderRadius:15, border:'none', cursor:'pointer',
                  background: showHelp ? DA.red : 'rgba(0,0,0,0.55)', color:'white', fontSize:15, fontWeight:800 }}>?</button>
            )}
            {!isMob && showHelp && (
              <div onClick={() => setShowHelp(false)}
                style={{ position:'absolute', bottom:46, right:8, zIndex:8, width:640, maxWidth:'calc(100% - 16px)', maxHeight:'calc(100% - 60px)', overflowY:'auto',
                  background:'#2b2b2b', border:'1px solid #444', color:'#eee', borderRadius:12, padding:'12px 16px', fontSize:12.5, lineHeight:1.5,
                  boxShadow:'0 8px 30px rgba(0,0,0,0.5)', cursor:'pointer', columnCount:2, columnGap:22 }}>
                {[
                  ['Outils', [['V', 'Sélection'], ['D', 'Dessin'], ['T', 'Texte'], ['F', 'Formes'], ['S', 'Symboles']]],
                  ['Formes', [['R', 'Rectangle'], ['E', 'Ellipse'], ['A', 'Flèche'], ['L', 'Ligne'], ['Z', 'Zone libre'], ['P', 'Polyligne'], ['Entrée', 'Terminer la ligne / zone']]],
                  ['Tracé', [['Maj', 'Angles droits · carré / cercle'], ['Alt', 'Sans aimantation']]],
                  ['Édition', [['Glisser (vide)', 'Cadre de sélection'], ['Ctrl+clic', 'Ajouter / retirer de la sélection'], ['Ctrl+A', 'Tout sélectionner'], ['Ctrl+C / V', 'Copier / coller sous la souris'],
                    ['Ctrl+D', 'Dupliquer'], ['Ctrl+] / [', 'Avancer / reculer (calques)'], ['Flèches', 'Déplacer (Maj = ×10)'], ['Suppr', 'Supprimer'], ['Ctrl+Z / Y', 'Annuler / rétablir'], ['Échap', 'Quitter le tracé / la sélection']]],
                  ['Vue', [['Molette', 'Zoom'], ['Espace + glisser', 'Déplacer la vue'], ['Ctrl+0', 'Vue entière'], ['Ctrl+ + / −', 'Zoom avant / arrière']]],
                ].map(([sec, rows]) => (
                  <div key={sec} style={{ marginBottom:8, breakInside:'avoid' }}>
                    <div style={{ fontSize:10.5, fontWeight:800, color:'#9a9a9a', textTransform:'uppercase', letterSpacing:0.6, marginBottom:2 }}>{sec}</div>
                    {rows.map(([kb, what]) => (
                      <div key={kb} style={{ display:'flex', gap:10, alignItems:'baseline' }}>
                        <span style={{ flexShrink:0, width:112, fontWeight:700, color:'white' }}>{kb}</span>
                        <span style={{ color:'#ccc' }}>{what}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {/* Bouton « Terminer » visible dès qu'une polyligne/zone en cours peut être terminée. */}
            {tool === 'shape' && (shapeTool === 'polyline' || shapeTool === 'poly') && polyPts.length >= polyMinPts && (
              <button onClick={finishPoly}
                style={{ position:'absolute', top:8, left:8, zIndex:6, background:DA.red, color:'white', border:'none', borderRadius:9,
                  padding:'8px 14px', fontSize:13, fontWeight:800, cursor:'pointer', boxShadow:'0 3px 12px rgba(0,0,0,0.45)' }}>
                ✓ {shapeTool === 'polyline' ? 'Terminer la ligne' : 'Fermer la zone'}
              </button>
            )}
            {/* Brouillon retrouvé : bandeau PAR-DESSUS le plan (ne décale rien). */}
            {draftOffer && (
              <div style={{ position:'absolute', top:10, left:'50%', transform:'translateX(-50%)', zIndex:7, maxWidth:'calc(100% - 20px)',
                display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', justifyContent:'center',
                background:'rgba(20,20,20,0.94)', color:'white', borderRadius:12, padding:'10px 14px', boxShadow:'0 6px 24px rgba(0,0,0,0.5)', border:'1px solid #444' }}>
                <span style={{ fontSize:13, fontWeight:700 }}>
                  Annotations non enregistrées retrouvées ({new Date(draftOffer.ts).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })})
                </span>
                <button onClick={resumeDraft} style={{ padding:'7px 13px', borderRadius:8, border:'none', background:DA.red, color:'white', fontSize:13, fontWeight:800, cursor:'pointer' }}>Reprendre</button>
                <button onClick={dismissDraft} style={{ padding:'7px 11px', borderRadius:8, border:'1px solid #555', background:'transparent', color:'#ccc', fontSize:13, fontWeight:700, cursor:'pointer' }}>Ignorer</button>
              </div>
            )}
            {/* Saisie inline — apparaît directement au point de tap */}
            {inlineEditPos && (
              <>
                {/* Clic à côté (sur le canvas) = valider : commit SYNCHRONE via confirmInlineEdit. */}
                <div style={{ position:'absolute', inset:0, zIndex:19 }}
                  onPointerDown={() => confirmInlineEdit()}/>
                <div style={{ position:'absolute', left:inlineEditPos.left, top:inlineEditPos.top, zIndex:20,
                  transform:'translate(-4px, -36px)', pointerEvents:'auto' }}>
                  <textarea autoFocus value={inlineEditVal} onChange={e=>setInlineEditVal(e.target.value)}
                    rows={Math.max(1, inlineEditVal.split('\n').length)}
                    onKeyDown={e=>{
                      // Entrée = saut de ligne (zone de texte libre). Validation = clic à côté ou Sauvegarder.
                      if(e.key==='Escape'){ e.preventDefault(); cancelInlineEdit(); }
                      if((e.key==='Delete'||e.key==='Backspace') && !inlineEditVal){
                        e.preventDefault();
                        if(inlineEditIdx !== null) setPaths(p=>p.filter((_,i)=>i!==inlineEditIdx));
                        cancelInlineEdit();
                      }
                    }}
                    placeholder="Texte… (Entrée = nouvelle ligne, cliquez à côté pour valider)"
                    style={{ fontSize:14, background:'rgba(20,20,20,0.95)', color:'white',
                      border:'2px solid '+DA.red, borderRadius:6, padding:'6px 10px',
                      outline:'none', minWidth:160, resize:'none', overflow:'hidden',
                      lineHeight:1.3, whiteSpace:'pre',
                      width:(Math.max(160, Math.max(...inlineEditVal.split('\n').map(l=>l.length), 0) * 10 + 40))+'px',
                      maxWidth:'80vw', fontFamily:'inherit',
                      boxShadow:'0 3px 14px rgba(0,0,0,0.65)' }}/>
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:12,color:DA.grayL }}>
            <Ic n="spn" s={32}/><p style={{ fontSize:13 }}>Chargement du plan…</p>
          </div>
        )}
      </div>

      {/* Fermer avec des modifications non enregistrées → on demande. */}
      {closeAsk && (
        <div onClick={() => setCloseAsk(false)} style={{ position:'fixed', inset:0, zIndex:300, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Modifications non enregistrées"
            onKeyDown={e => { if (e.key === 'Escape') setCloseAsk(false); }}
            style={{ background:'#1f1f1f', color:'white', borderRadius:14, padding:'18px 18px 14px', width:380, maxWidth:'100%', border:'1px solid #3a3a3a', boxShadow:'0 14px 44px rgba(0,0,0,0.6)' }}>
            <p style={{ margin:0, fontSize:16, fontWeight:800 }}>Enregistrer les modifications ?</p>
            <p style={{ margin:'6px 0 14px', fontSize:13, color:'#aaa', lineHeight:1.5 }}>Vos annotations sur {isPhotoCtx ? 'cette photo' : 'ce plan'} n'ont pas été enregistrées.</p>
            <div style={{ display:'flex', gap:8 }}>
              <button autoFocus onClick={() => { setCloseAsk(false); saveAndClose(); }}
                style={{ flex:1, padding:'11px', borderRadius:9, border:'none', background:DA.red, color:'white', fontSize:14, fontWeight:800, cursor:'pointer' }}>Enregistrer</button>
              <button onClick={closeWithoutSaving}
                style={{ flex:1, padding:'11px', borderRadius:9, border:'1px solid #555', background:'transparent', color:'#ddd', fontSize:14, fontWeight:700, cursor:'pointer' }}>Ne pas enregistrer</button>
            </div>
            <button onClick={() => setCloseAsk(false)}
              style={{ display:'block', width:'100%', marginTop:6, padding:'9px', border:'none', background:'none', color:'#999', fontSize:13, fontWeight:700, cursor:'pointer' }}>Continuer à annoter</button>
          </div>
        </div>
      )}
      {stripZoom && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.95)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
          <img src={stripZoom} alt="" style={{ maxWidth:'96vw', maxHeight:'94vh', objectFit:'contain', borderRadius:6, boxShadow:'0 8px 50px rgba(0,0,0,0.7)' }}/>
        </div>
      )}
      {/* Aperçu de la photo correspondant au marqueur (appui long maintenu) */}
      {vpPreview && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.95)', zIndex:200, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, pointerEvents:'none' }}>
          <span style={{ color:'white', fontSize:18, fontWeight:800, background:DA.red, borderRadius:8, padding:'4px 14px' }}>{vpPreview.label}</span>
          {vpPreview.src
            ? <img src={vpPreview.src} alt="" style={{ maxWidth:'96vw', maxHeight:'84vh', objectFit:'contain', borderRadius:6, boxShadow:'0 8px 50px rgba(0,0,0,0.7)' }}/>
            : <span style={{ color:'rgba(255,255,255,0.7)', fontSize:14 }}>Photo non disponible sur cet appareil</span>}
        </div>
      )}
      {/* Bandeau d'aide « repère sélectionné » RETIRÉ (retour Thomas : sélectionner un VXX faisait
          apparaître un bandeau vert + rétrécissait le plan, gênant pour juste le supprimer). Le lien
          photo↔marqueur reste possible : la photo liée est déjà entourée de vert dans la bande. */}
      {/* ── Bande de photos (sans labels V1/V2) ── */}
      {validPhotos.length > 0 && (
        <div style={{ background:'#1a1a1a',borderTop:'1px solid #333',padding:'6px 12px',display:'flex',gap:8,overflowX:'auto',flexShrink:0,alignItems:'center' }}>
          <button onClick={() => setPhotoStripBig(v => !v)}
            title={photoStripBig ? 'Réduire les vignettes' : 'Agrandir les vignettes'}
            style={{ flexShrink:0,display:'flex',flexDirection:'column',alignItems:'center',gap:1,background:photoStripBig?DA.red:'#333',border:'none',borderRadius:7,padding:'5px 8px',cursor:'pointer',color:photoStripBig?'white':'#aaa',lineHeight:1 }}>
            <Ic n="img" s={15}/>
            <span style={{ fontSize:9,fontWeight:800,letterSpacing:0.3 }}>{photoStripBig ? 'Vues −' : 'Vues +'}</span>
          </button>
          {validPhotos.map((ph, i) => {
            const isActive = activePh?.photoIdx === i;
            const isLinkedToSel = selVp && selVp.photoIdx === i; // photo liée au marqueur sélectionné
            const sz = photoStripBig ? 104 : 56;
            return (
              <button key={i}
                onClick={() => { if (!stripLPRef.current.fired) selectPhoto(ph, i); stripLPRef.current.fired = false; }}
                onPointerDown={() => startStripLP(ph.data)}
                onPointerUp={endStripLP}
                onPointerCancel={endStripLP}
                title={ph.name || `Photo ${i + 1}`}
                style={{ flexShrink:0,padding:0,background:'none',border:`3px solid ${isLinkedToSel ? '#22c55e' : isActive ? DA.red : 'transparent'}`,borderRadius:8,overflow:'hidden',cursor:'pointer',outline:'none',transition:'border-color 0.15s,width 0.15s,height 0.15s' }}>
                <ThumbImg src={ph.data} width={320} alt="" style={{ width:sz,height:sz,objectFit:'cover',display:'block' }}/>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

// `size` = taille affichée (40 par défaut, plus grand sur PC). Le dessin reste dans un repère
// 40×40 mis à l'échelle → net quelle que soit la taille (et la densité d'écran).
function SymMiniCanvas({ sm, color, size = 40 }) {
  const canvasRef = useRef(null);
  const k = (size / 40) * (typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !sm?.draw) return;
    const ctx = cv.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, 40, 40);
    sm.draw(ctx, 20, 20, 1, color);
  }, [sm, color, k]);
  return <canvas ref={canvasRef} width={Math.round(40 * k)} height={Math.round(40 * k)} style={{ display:'block', width:size, height:size }} />;
}

export default Annotator;
