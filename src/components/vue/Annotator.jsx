import React, { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

const ANNOT_COLORS = ['#E30513','#E67E22','#F1C40F','#2980B9','#27AE60','#8E44AD','#222222','#FFFFFF'];

// ── Viewpoint (œil + cône de vue) ────────────────────────────────────────────
export function drawVP(ctx, { x, y, angle = 0, label = '', size = 3, color = '#E30513' }) {
  const r  = 10 + size;
  const L  = 40 + size * 4;
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

// sizeScale : échelle pour symboles/textes/viewpoints (contrôlé par annotScale)
// strokeScale : échelle pour les tracés (normalisée en pixels écran, indépendante de annotScale)
export function drawAnnotationPaths(ctx, paths, sizeScale = 1, strokeScale = null) {
  const ss = strokeScale ?? sizeScale;
  (paths || []).forEach(p => {
    if (p.type === 'viewpoint') {
      ctx.save();
      if (sizeScale !== 1 && p.x != null) {
        ctx.translate(p.x, p.y); ctx.scale(sizeScale, sizeScale); ctx.translate(-p.x, -p.y);
      }
      drawVP(ctx, p);
      ctx.restore();
    } else if (p.type === 'symbol') {
      if (p.symbolId === 'portee') {
        ctx.save();
        if (p.x1 != null) {
          drawPorteePath(ctx, p.x1, p.y1, p.x2, p.y2, p.size * sizeScale, p.color);
        } else {
          drawPorteePath(ctx, p.x - 30, p.y, p.x + 30, p.y, p.size * sizeScale, p.color);
        }
        ctx.restore();
      } else if (p.symbolId === 'pente_sol') {
        ctx.save();
        if (p.x1 != null) {
          drawPenteSolPath(ctx, p.x1, p.y1, p.x2, p.y2, p.size * sizeScale, p.color);
        } else {
          drawPenteSolPath(ctx, p.x - 30, p.y, p.x + 30, p.y, p.size * sizeScale, p.color);
        }
        ctx.restore();
      } else {
        const sm = getAllSymbols().find(x => x.id === p.symbolId);
        if (sm) {
          ctx.save();
          if (sizeScale !== 1 && p.x != null) {
            ctx.translate(p.x, p.y); ctx.scale(sizeScale, sizeScale); ctx.translate(-p.x, -p.y);
          }
          sm.draw(ctx, p.x, p.y, p.size, p.color);
          ctx.restore();
        }
      }
    } else if (p.type === 'text') {
      ctx.save();
      if (sizeScale !== 1 && p.x != null) {
        ctx.translate(p.x, p.y); ctx.scale(sizeScale, sizeScale); ctx.translate(-p.x, -p.y);
      }
      const fs = 20 + p.size * 4;
      ctx.font = `bold ${fs}px Arial`;
      const tw = ctx.measureText(p.text).width;
      const pad = 10;
      if (p.textMode === 'boxed' || p.textMode === 'arrow') {
        // Fond blanc + bordure couleur — lineWidth constant en pixels écran
        const bx = p.x - pad, by = p.y - fs - 4, bw = tw + pad * 2, bh = fs + pad + 6;
        ctx.fillStyle = 'rgba(255,255,255,0.96)';
        ctx.strokeStyle = p.color; ctx.lineWidth = 2.5 * ss / sizeScale;
        ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill(); ctx.stroke();
        if (p.textMode === 'arrow') {
          // Flèche vers le point arrowX/arrowY (ou défaut bas-centre)
          const tipX = p.arrowX ?? (p.x + tw / 2);
          const tipY = p.arrowY ?? (by + bh + 16);
          const bcx = bx + bw / 2, bcy = by + bh / 2;
          const ddx = tipX - bcx, ddy = tipY - bcy;
          let ex = bcx, ey = bcy;
          if (Math.abs(ddx) > 0.5 || Math.abs(ddy) > 0.5) {
            const hw = bw / 2, hh = bh / 2;
            if (hw * Math.abs(ddy) <= hh * Math.abs(ddx)) {
              const sx2 = ddx > 0 ? 1 : -1;
              ex = bcx + sx2 * hw; ey = bcy + (ddy / ddx) * sx2 * hw;
            } else {
              const sy2 = ddy > 0 ? 1 : -1;
              ex = bcx + (ddx / ddy) * sy2 * hh; ey = bcy + sy2 * hh;
            }
          }
          ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(tipX, tipY); ctx.stroke();
          const ta = Math.atan2(tipY - ey, tipX - ex), aL = 9;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX + Math.cos(ta + Math.PI + Math.PI / 6) * aL, tipY + Math.sin(ta + Math.PI + Math.PI / 6) * aL);
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX + Math.cos(ta + Math.PI - Math.PI / 6) * aL, tipY + Math.sin(ta + Math.PI - Math.PI / 6) * aL);
          ctx.stroke();
        }
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * ss / sizeScale;
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.restore();
    } else if (p.type === 'shape') {
      ctx.save();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = (p.size || 2) * ss;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
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
        const aLen = Math.max(12, Math.min(len * 0.35, 28 * ss));
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

// Mise à l'échelle de toutes les coordonnées d'annotation (LQ ↔ HQ)
function scalePaths(paths, sx, sy) {
  if (!paths || (sx === 1 && sy === 1)) return paths;
  return paths.map(p => {
    const s = { ...p };
    if (s.x  != null) { s.x  = s.x  * sx; s.y  = s.y  * sy; }
    if (s.x1 != null) { s.x1 = s.x1 * sx; s.y1 = s.y1 * sy; s.x2 = s.x2 * sx; s.y2 = s.y2 * sy; }
    if (s.arrowX != null) { s.arrowX = s.arrowX * sx; s.arrowY = s.arrowY * sy; }
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
  if (ap.shape === 'poly' && ap.pts) {
    return ap.pts.map((pt, i) => ({ id:`v${i}`, x:pt.x, y:pt.y }));
  }
  return [];
}

const Annotator = forwardRef(function Annotator({ bgImage, hqImage = null, savedPaths, onSave, onClose, photos, exportSizeMultiplier = 7, title }, ref) {
  const cvRef          = useRef();
  const bgRef          = useRef(null);
  const vpStart        = useRef(null);
  const textDragRef    = useRef(null); // { mode:'box'|'tip', origX/Y, origArrowX/Y, tapX, tapY }
  const porteeStartRef = useRef(null);
  const shapeStartRef  = useRef(null);
  const annotDragRef   = useRef(null); // { idx, origData, tapX, tapY } — drag symbole/viewpoint
  const arrowPlaceRef  = useRef(null); // { x, y } — tip du callout flèche pendant le drag de placement
  const resizeDragRef  = useRef(null); // { handle, origData, idx } — resize poignée forme
  const touchHoldRef   = useRef(null); // long-press → mode select (mobile)
  const panRef         = useRef(null); // drag clic-droit/molette → pan
  const hqScaleRef     = useRef(1);   // ratio HQ/LQ appliqué en session (reset à 1 sur changement de plan)

  const [tool,       setTool]       = useState('pen');
  const [color,      setColor]      = useState(DA.red);
  const [size,       setSize]       = useState(3);
  const [sym,        setSym]        = useState(SYMBOLS[0]);
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

  const [annotScale,  setAnnotScale]  = useState(() => {
    const v = parseFloat(localStorage.getItem('chantierai_annot_scale') ?? '1');
    // Réinitialiser à 1 si la valeur sauvegardée était > 1.5 (ancien bug où annotScale affectait les tracés)
    if (isNaN(v) || v > 1.5) { localStorage.setItem('chantierai_annot_scale', '1'); return 1; }
    return Math.max(0.3, Math.min(5, v));
  });
  const [shapeTool,     setShapeTool]     = useState('rect'); // rect | ellipse | arrow | line | poly
  const [pendingShape,  setPendingShape]  = useState(null);
  const [shapeFilled,   setShapeFilled]   = useState(false);
  const [fillOpacity,   setFillOpacity]   = useState(0.3);
  const [strokeOpacity, setStrokeOpacity] = useState(1);
  const [polyPts,       setPolyPts]       = useState([]);   // sommets du polygone en cours
  const [polyMousePos,  setPolyMousePos]  = useState(null); // prévisualisation curseur
  const lastTapRef = useRef({ time: 0, x: -9999, y: -9999 });
  const lastSymPlaceRef = useRef(0);
  const [customSyms,    setCustomSyms]    = useState(() => getCustomSymbolDefs());
  const [newSymName,    setNewSymName]    = useState('');
  const [showNewSym,    setShowNewSym]    = useState(false);
  const [textMode,      setTextMode]      = useState('plain');
  const [symCat,           setSymCat]           = useState('fissures');
  const [showPalette,      setShowPalette]      = useState(false);
  const [pendingPortee,    setPendingPortee]    = useState(null);
  const [selAnnot,         setSelAnnot]         = useState(null); // { idx } symbole/viewpoint sélectionné
  const [pendingArrowLine, setPendingArrowLine] = useState(null); // { tipX,tipY,boxX,boxY } preview flèche
  const [bgVersion,        setBgVersion]        = useState(0);   // incrémenté pour forcer redraw après swap HQ
  const [photoStripBig,    setPhotoStripBig]    = useState(false); // agrandir les miniatures de la bande "Vues"

  const allSymbols = useMemo(() => [...SYMBOLS, ...customSyms], [customSyms]);

  useEffect(() => { vtRef.current = vt; }, [vt]);
  useEffect(() => {
    setVt({ z: 1, px: 0, py: 0 });
    vtRef.current = { z: 1, px: 0, py: 0 };
    setPaths(savedPaths || []); // reset annotations quand la photo change
    setSelTextIdx(null);
    hqScaleRef.current = 1; // reset scale lors du changement de plan
  }, [bgImage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exposer getAnnotation() pour auto-save depuis le parent (navigation entre photos)
  useImperativeHandle(ref, () => ({
    getAnnotation: () => {
      const cv = cvRef.current;
      if (!cv || !bgRef.current) return { paths, annotated: null };
      const EW = Math.min(cv.width, 1400);
      const EH = Math.round(cv.height * EW / cv.width);
      const ec = document.createElement('canvas');
      ec.width = EW; ec.height = EH;
      const ectx = ec.getContext('2d');
      ectx.drawImage(bgRef.current, 0, 0, EW, EH);
      ectx.save();
      ectx.scale(EW / cv.width, EH / cv.height);
      const ratio = cv.clientWidth > 0 ? cv.width / cv.clientWidth : exportSizeMultiplier;
      drawAnnotationPaths(ectx, paths, ratio * 0.5 * annotScale, ratio);
      ectx.restore();
      const sc = hqScaleRef.current;
      return { paths: scalePaths(paths, 1/sc, 1/sc), annotated: ec.toDataURL('image/webp', 0.85), annotW: cv.width, annotH: cv.height };
    },
  }), [paths, annotScale, exportSizeMultiplier]);

  const vpCount = paths.filter(p => p.type === 'viewpoint').length;

  const redraw = useCallback(() => {
    const cv = cvRef.current;
    if (!cv || !bgOk) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (bgRef.current) ctx.drawImage(bgRef.current, 0, 0, cv.width, cv.height);

    const ratio = cv.clientWidth > 0 ? cv.width / cv.clientWidth : 1;
    const symbolScale = ratio * 0.5 * annotScale; // symboles/viewpoints/textes : contrôlés par annotScale
    const strokeScale = ratio;                     // tracés : normalisés en pixels écran, sans annotScale

    const all = [...paths, ...(cur.length > 1 && (tool === 'pen' || tool === 'eraser') ? [{ type:'stroke', tool, points:cur, color, size }] : [])];
    drawAnnotationPaths(ctx, all, symbolScale, strokeScale);

    if (pendingVP) {
      ctx.save();
      if (symbolScale > 1) {
        ctx.translate(pendingVP.x, pendingVP.y);
        ctx.scale(symbolScale, symbolScale);
        ctx.translate(-pendingVP.x, -pendingVP.y);
      }
      drawVP(ctx, { ...pendingVP, label: `V${vpCount + 1}`, color, size });
      ctx.restore();
    }

    if (pendingPortee) {
      if (pendingPortee.symbolId === 'pente_sol') {
        drawPenteSolPath(ctx, pendingPortee.x1, pendingPortee.y1, pendingPortee.x2, pendingPortee.y2, size * symbolScale, color);
      } else {
        drawPorteePath(ctx, pendingPortee.x1, pendingPortee.y1, pendingPortee.x2, pendingPortee.y2, size * symbolScale, color);
      }
    }

    if (pendingShape && tool === 'shape') {
      drawAnnotationPaths(ctx, [{ type: 'shape', shape: shapeTool, ...pendingShape, color, size, filled: shapeFilled, fillOpacity, strokeOpacity }], symbolScale, strokeScale);
    }

    // Poignées des textes (toujours visibles en mode texte)
    if (tool === 'text') {
      paths.forEach((p, i) => {
        if (p.type !== 'text') return;
        const isSel = i === selTextIdx;
        const hr = (isSel ? 10 : 7) * ratio; // scaled to screen pixels
        ctx.save();
        ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = (isSel ? 2.5 : 1.5) * ratio;
        // Boîte de texte : fond blanc + bordure bleue (visible)
        ctx.fillStyle = 'white'; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(p.x, p.y, hr, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = isSel ? 'rgba(74,158,255,0.7)' : 'rgba(74,158,255,0.35)';
        ctx.beginPath(); ctx.arc(p.x, p.y, hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (p.textMode === 'arrow' && p.arrowX != null) {
          ctx.strokeStyle = '#FF9500'; ctx.lineWidth = (isSel ? 2.5 : 1.5) * ratio;
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
          const fs = (20 + p.size * 4) * symbolScale;
          ctx.font = `bold ${20 + p.size * 4}px Arial`;
          const tw = ctx.measureText(p.text).width * symbolScale;
          const pad = 10 * symbolScale;
          ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = 2 * ratio; ctx.setLineDash([4 * ratio, 3 * ratio]);
          ctx.strokeRect(p.x - pad, p.y - fs - 4 * symbolScale, tw + pad * 2, fs + pad + 6 * symbolScale);
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
    if (polyPts.length > 0 && tool === 'shape' && shapeTool === 'poly') {
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
        // Contour de sélection + poignées de redimensionnement
        ctx.setLineDash([4 * ratio, 3 * ratio]);
        if (ap.shape === 'poly' && ap.pts?.length > 1) {
          const xs = ap.pts.map(pt => pt.x), ys = ap.pts.map(pt => pt.y);
          ctx.beginPath(); ctx.rect(Math.min(...xs)-8, Math.min(...ys)-8, Math.max(...xs)-Math.min(...xs)+16, Math.max(...ys)-Math.min(...ys)+16); ctx.stroke();
        } else if (ap.x1 != null) {
          const bx = Math.min(ap.x1, ap.x2)-8, by = Math.min(ap.y1, ap.y2)-8;
          ctx.beginPath(); ctx.rect(bx, by, Math.abs(ap.x2-ap.x1)+16, Math.abs(ap.y2-ap.y1)+16); ctx.stroke();
        }
        ctx.setLineDash([]);
        // Poignées carrées blanches
        const handles = getShapeHandles(ap);
        const hr = 7 * ratio;
        handles.forEach(h => {
          ctx.fillStyle = 'white'; ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = 2 * ratio;
          ctx.beginPath(); ctx.rect(h.x - hr, h.y - hr, hr * 2, hr * 2); ctx.fill(); ctx.stroke();
        });
      } else if (ap.x != null) {
        ctx.beginPath(); ctx.arc(ap.x, ap.y, 28 * Math.max(1, symbolScale), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }, [paths, cur, color, size, tool, bgOk, bgVersion, pendingVP, pendingPortee, activePh, vpCount, annotScale, selTextIdx, selAnnot, pendingArrowLine, pendingShape, shapeTool, shapeFilled, fillOpacity, strokeOpacity, polyPts, polyMousePos]);

  useEffect(() => { redraw(); }, [redraw]);

  // Ctrl+Z — undo dernière annotation / Delete — supprimer sélection
  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        setPaths(p => p.slice(0, -1));
      }
      if (e.key === 'Escape') {
        setPolyPts([]); setPolyMousePos(null);
        setTool('select');
        setShowSyms(false);
        setSelTextIdx(null); textDragRef.current = null;
        setActivePh(null);
        setPendingShape(null); shapeStartRef.current = null;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selAnnot !== null) {
          e.preventDefault();
          setPaths(p => p.filter((_, i) => i !== selAnnot.idx));
          setSelAnnot(null);
          annotDragRef.current = null;
        } else if (selTextIdx !== null) {
          e.preventDefault();
          setPaths(p => p.filter((_, i) => i !== selTextIdx));
          setSelTextIdx(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selAnnot, selTextIdx]);

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
      const img = new window.Image();
      img.onload = () => {
        const cv = cvRef.current;
        if (!cv) return;
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        bgRef.current = img;
        setBgOk(true);
      };
      img.onerror = () => setBgOk(true);
      img.src = src;
    };
    load();
  }, [bgImage]);

  // Quand une version HQ du plan arrive (rendue en arrière-plan depuis PlanLocModal) :
  // agrandit le canvas à la résolution HQ, swap l'image, et met à l'échelle les annotations existantes.
  useEffect(() => {
    if (!hqImage) return;
    const img = new window.Image();
    img.onload = () => {
      const cv = cvRef.current;
      if (!cv || !bgRef.current || bgRef.current.naturalWidth === 0) return;
      const sx = img.naturalWidth  / bgRef.current.naturalWidth;
      const sy = img.naturalHeight / bgRef.current.naturalHeight;
      cv.width  = img.naturalWidth;
      cv.height = img.naturalHeight;
      bgRef.current = img;
      hqScaleRef.current = sx;
      // Mise à l'échelle des paths existants + forçage du redraw
      if (sx !== 1 || sy !== 1) {
        setPaths(prev => scalePaths(prev, sx, sy));
      }
      setBgVersion(v => v + 1);
    };
    img.src = hqImage;
  }, [hqImage]); // eslint-disable-line react-hooks/exhaustive-deps

  const getXY = (e, cv) => {
    const r = cv.getBoundingClientRect(), sx = cv.width / r.width, sy = cv.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * sx, y: (src.clientY - r.top) * sy };
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

    // Clic-droit ou molette enfoncée → pan (bureau uniquement)
    if (!e.touches && (e.button === 2 || e.button === 1)) {
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

    if (tool === 'select') {
      const hitR = 22 * (cv.width / cv.clientWidth);
      // Resize handles first (if a shape is currently selected)
      if (selAnnot !== null && paths[selAnnot.idx]?.type === 'shape') {
        const ap = paths[selAnnot.idx];
        const rhr = 14 * (cv.width / cv.clientWidth);
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
          const txtScale = cv ? (cv.width / cv.clientWidth) * 0.5 * annotScale : 1;
          const fs = (20 + p.size * 4) * txtScale;
          const approxW = Math.max(80, p.text.length * fs * 0.6) + 20;
          const inCircle = Math.hypot(p.x - pos.x, p.y - pos.y) < hitR;
          const inBox = (p.textMode === 'boxed' || p.textMode === 'arrow') &&
            pos.x >= p.x - 10 * txtScale && pos.x <= p.x - 10 * txtScale + approxW &&
            pos.y >= p.y - fs - 4 * txtScale && pos.y <= p.y + 10 * txtScale;
          if (inCircle || inBox) {
            setSelTextIdx(i); setSelAnnot(null);
            textDragRef.current = { mode: 'box', origX: p.x, origY: p.y, tapX: pos.x, tapY: pos.y };
            setDrawing(true); return;
          }
        }
        if (p.type === 'shape') {
          const hitRSh = 18 * (cv.width / cv.clientWidth);
          let hitShape = false;
          if (p.shape === 'poly' && p.pts?.length > 1) {
            const xs = p.pts.map(pt => pt.x), ys = p.pts.map(pt => pt.y);
            hitShape = pos.x >= Math.min(...xs) - hitRSh && pos.x <= Math.max(...xs) + hitRSh &&
              pos.y >= Math.min(...ys) - hitRSh && pos.y <= Math.max(...ys) + hitRSh;
          } else if (p.x1 != null) {
            hitShape = pos.x >= Math.min(p.x1, p.x2) - hitRSh && pos.x <= Math.max(p.x1, p.x2) + hitRSh &&
              pos.y >= Math.min(p.y1, p.y2) - hitRSh && pos.y <= Math.max(p.y1, p.y2) + hitRSh;
          }
          if (hitShape) {
            setSelAnnot({ idx: i }); setSelTextIdx(null);
            annotDragRef.current = { idx: i, origData: { ...p, pts: p.pts?.map(pt => ({...pt})) }, tapX: pos.x, tapY: pos.y };
            setDrawing(true); return;
          }
        }
      }
      setSelAnnot(null); setSelTextIdx(null);
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
      // Vérifier d'abord la poignée de flèche (tip)
      for (let i = paths.length - 1; i >= 0; i--) {
        const p = paths[i];
        if (p.type === 'text' && p.textMode === 'arrow' && p.arrowX != null) {
          if (Math.hypot(p.arrowX - pos.x, p.arrowY - pos.y) < hitR * 0.55) {
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
        const inCircle = Math.hypot(p.x - pos.x, p.y - pos.y) < hitR;
        const txtScale = cv ? (cv.width / cv.clientWidth) * 0.5 * annotScale : 1;
        const fs = (20 + p.size * 4) * txtScale;
        const approxW = Math.max(80, p.text.length * fs * 0.6) + 20;
        const inBox = (p.textMode === 'boxed' || p.textMode === 'arrow') &&
          pos.x >= p.x - 10 * txtScale && pos.x <= p.x - 10 * txtScale + approxW &&
          pos.y >= p.y - fs - 4 * txtScale && pos.y <= p.y + 10 * txtScale;
        if (inCircle || inBox) { existIdx = i; break; }
      }
      if (existIdx >= 0) {
        // Démarrer en mode drag — si l'utilisateur ne bouge pas (tap), onEnd ouvrira l'édition inline
        setSelTextIdx(existIdx);
        setDrawing(true);
        textDragRef.current = { mode: 'box', origX: paths[existIdx].x, origY: paths[existIdx].y, tapX: pos.x, tapY: pos.y, moved: false, textVal: paths[existIdx].text || '' };
        return;
      }
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
      if (shapeTool === 'poly') {
        const now = Date.now();
        const lt = lastTapRef.current;
        const snapR = 22 * (cv.width / cv.clientWidth);
        const isDbl = (now - lt.time < 380) && polyPts.length >= 2 && Math.hypot(pos.x - lt.x, pos.y - lt.y) < snapR;
        lastTapRef.current = { time: now, x: pos.x, y: pos.y };
        if (isDbl) {
          if (polyPts.length >= 3) {
            setPaths(prev => [...prev, { type:'shape', shape:'poly', pts:[...polyPts], color, size, filled: shapeFilled, fillOpacity, strokeOpacity }]);
          }
          setPolyPts([]); setPolyMousePos(null);
          return;
        }
        // Snap au premier sommet pour fermer
        if (polyPts.length >= 3) {
          const closeR = 18 * (cv.width / cv.clientWidth);
          if (Math.hypot(pos.x - polyPts[0].x, pos.y - polyPts[0].y) < closeR) {
            setPaths(prev => [...prev, { type:'shape', shape:'poly', pts:[...polyPts], color, size, filled: shapeFilled, fillOpacity, strokeOpacity }]);
            setPolyPts([]); setPolyMousePos(null);
            return;
          }
        }
        setPolyPts(prev => [...prev, pos]);
        return;
      }

      // ── Resize : poignées de la forme sélectionnée ──
      if (selAnnot !== null && paths[selAnnot.idx]?.type === 'shape') {
        const ap = paths[selAnnot.idx];
        const rhr = 14 * (cv.width / cv.clientWidth);
        const handles = getShapeHandles(ap);
        for (const h of handles) {
          if (Math.hypot(pos.x - h.x, pos.y - h.y) < rhr) {
            resizeDragRef.current = { handle: h.id, origData: { ...ap, pts: ap.pts ? ap.pts.map(pt => ({...pt})) : undefined }, idx: selAnnot.idx };
            setDrawing(true);
            return;
          }
        }
      }

      // ── Autres formes (rect/ellipse/arrow/line) : hit test pour sélection ──
      let hitIdx = -1;
      for (let i = paths.length - 1; i >= 0; i--) {
        const p = paths[i];
        if (p.type !== 'shape') continue;
        if (p.shape === 'poly' && p.pts?.length > 1) {
          const xs = p.pts.map(pt => pt.x), ys = p.pts.map(pt => pt.y);
          if (pos.x >= Math.min(...xs) - hitR && pos.x <= Math.max(...xs) + hitR &&
              pos.y >= Math.min(...ys) - hitR && pos.y <= Math.max(...ys) + hitR) { hitIdx = i; break; }
        } else if (p.x1 != null) {
          const bx1 = Math.min(p.x1, p.x2) - hitR, by1 = Math.min(p.y1, p.y2) - hitR;
          const bx2 = Math.max(p.x1, p.x2) + hitR, by2 = Math.max(p.y1, p.y2) + hitR;
          if (pos.x >= bx1 && pos.x <= bx2 && pos.y >= by1 && pos.y <= by2) { hitIdx = i; break; }
        }
      }
      if (hitIdx >= 0) {
        setSelAnnot({ idx: hitIdx });
        annotDragRef.current = { idx: hitIdx, origData: { ...paths[hitIdx], pts: paths[hitIdx].pts ? paths[hitIdx].pts.map(pt => ({...pt})) : undefined }, tapX: pos.x, tapY: pos.y };
        setDrawing(true);
        return;
      }
      setSelAnnot(null);
      shapeStartRef.current = pos;
      setPendingShape({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y });
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
    // Placement flèche : mise à jour de la ligne de prévisualisation
    if (tool === 'text' && drawing && arrowPlaceRef.current) {
      setPendingArrowLine({ tipX: arrowPlaceRef.current.x, tipY: arrowPlaceRef.current.y, boxX: pos.x, boxY: pos.y });
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
      setPaths(prev => prev.map((p, i) => {
        if (i !== idx) return p;
        if (handle === 'se') return { ...p, x2: pos.x, y2: pos.y };
        if (handle === 'sw') return { ...p, x1: pos.x, y2: pos.y };
        if (handle === 'ne') return { ...p, x2: pos.x, y1: pos.y };
        if (handle === 'nw') return { ...p, x1: pos.x, y1: pos.y };
        if (handle === 'p1') return { ...p, x1: pos.x, y1: pos.y };
        if (handle === 'p2') return { ...p, x2: pos.x, y2: pos.y };
        if (handle.startsWith('v')) {
          const vi = parseInt(handle.slice(1));
          return { ...p, pts: p.pts.map((pt, j) => j === vi ? { x: pos.x, y: pos.y } : pt) };
        }
        return p;
      }));
      return;
    }
    if (drawing && selAnnot !== null && annotDragRef.current) {
      const { origData, tapX, tapY } = annotDragRef.current;
      const dx = pos.x - tapX, dy = pos.y - tapY;
      setPaths(prev => prev.map((p, i) => {
        if (i !== selAnnot.idx) return p;
        if (origData.pts) return { ...p, pts: origData.pts.map(pt => ({ x: pt.x + dx, y: pt.y + dy })) };
        if (origData.x1 != null) return { ...p, x1: origData.x1 + dx, y1: origData.y1 + dy, x2: origData.x2 + dx, y2: origData.y2 + dy };
        return { ...p, x: origData.x + dx, y: origData.y + dy };
      }));
      return;
    }
    if (!drawing) return;
    if (tool === 'viewpoint' && vpStart.current) {
      const dx = pos.x - vpStart.current.x;
      const dy = pos.y - vpStart.current.y;
      setPendingVP({ x: vpStart.current.x, y: vpStart.current.y, angle: Math.atan2(dy, dx) });
      return;
    }
    // Portée en cours de tracé
    if (tool === 'symbol' && (sym.id === 'portee' || sym.id === 'pente_sol') && porteeStartRef.current) {
      setPendingPortee({ symbolId: sym.id, x1: porteeStartRef.current.x, y1: porteeStartRef.current.y, x2: pos.x, y2: pos.y });
      return;
    }
    // Polygone : mise à jour position curseur pour preview
    if (tool === 'shape' && shapeTool === 'poly' && polyPts.length > 0) {
      setPolyMousePos(pos);
      return;
    }
    // Forme en cours de tracé
    if (tool === 'shape' && drawing && shapeStartRef.current && !annotDragRef.current) {
      setPendingShape({ x1: shapeStartRef.current.x, y1: shapeStartRef.current.y, x2: pos.x, y2: pos.y });
      return;
    }
    setCur(prev => [...prev, pos]);
  };

  const onEnd = e => {
    e.preventDefault();
    if (panRef.current) { panRef.current = null; return; }
    if (touchHoldRef.current) { clearTimeout(touchHoldRef.current); touchHoldRef.current = null; }
    if (gestureRef.current) {
      if (e.touches.length < 2) gestureRef.current = null;
      return;
    }
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
        if (len > 6) {
          setPaths(prev => [...prev, { type: 'shape', shape: shapeTool, x1: pendingShape.x1, y1: pendingShape.y1, x2: pendingShape.x2, y2: pendingShape.y2, color, size, filled: shapeFilled, fillOpacity, strokeOpacity }]);
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
    // Fin du déplacement de texte — si tap (pas de drag), ouvrir l'édition inline
    if ((tool === 'text' || tool === 'select') && selTextIdx !== null && textDragRef.current) {
      const { moved, origX, origY, textVal } = textDragRef.current;
      if (!moved && tool === 'text') {
        // Revenir à la position d'origine (micro-mouvement tactile) et ouvrir l'édition
        setPaths(prev => prev.map((p, i) => i === selTextIdx ? { ...p, x: origX, y: origY } : p));
        const capturedIdx = selTextIdx;
        setInlineEditIdx(capturedIdx);
        setInlineEditPos(toScreenPos(origX, origY));
        setInlineEditVal(textVal);
      }
      textDragRef.current = null;
      if (tool === 'text') setSelTextIdx(null);
      setDrawing(false);
      return;
    }
    if (!drawing) return;
    if (tool === 'viewpoint' && vpStart.current) {
      const label = `V${vpCount + 1}`; // toujours séquentiel — évite les doublons
      setPaths(prev => [...prev, {
        type: 'viewpoint',
        x: pendingVP?.x ?? vpStart.current.x,
        y: pendingVP?.y ?? vpStart.current.y,
        angle: pendingVP?.angle ?? 0,
        label, color, size,
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

  const confirmInlineEdit = () => {
    const val = inlineEditVal.trim();
    if (inlineEditIdx !== null) {
      if (val) setPaths(prev => prev.map((p, i) => i === inlineEditIdx ? { ...p, text: val } : p));
      else setPaths(p => p.filter((_, i) => i !== inlineEditIdx));
    } else if (val && inlineEditCanvasPt.current) {
      const pt = inlineEditCanvasPt.current;
      const entry = { type: 'text', text: val, x: pt.x, y: pt.y, color, size, textMode };
      if (textMode === 'arrow') {
        entry.arrowX = pt.arrowX ?? (pt.x + 50);
        entry.arrowY = pt.arrowY ?? (pt.y - 50);
      }
      setPaths(prev => [...prev, entry]);
    }
    cancelInlineEdit();
  };

  const addCustomSym = () => {
    const label = newSymName.trim();
    if (!label) return;
    const existing = loadCustomSymbols();
    const short = label.replace(/\s+/g, '').slice(0, 4).toUpperCase();
    const entry = { id: 'custom_' + crypto.randomUUID(), label, short, shapeIdx: existing.length };
    localStorage.setItem(CUSTOM_SYMS_KEY, JSON.stringify([...existing, entry]));
    const newDefs = getCustomSymbolDefs();
    setCustomSyms(newDefs);
    setSym(newDefs[newDefs.length - 1]);
    setNewSymName(''); setShowNewSym(false);
  };

  const delCustomSym = (id) => {
    localStorage.setItem(CUSTOM_SYMS_KEY, JSON.stringify(loadCustomSymbols().filter(s => s.id !== id)));
    const newDefs = getCustomSymbolDefs();
    setCustomSyms(newDefs);
    if (sym?.id === id) setSym(SYMBOLS[0]);
  };

  const validPhotos = (photos || []).filter(ph => ph.data);

  const selectPhoto = (ph, i) => {
    const isActive = activePh?.photoIdx === i;
    setActivePh(isActive ? null : { photoIdx: i, src: ph.data });
    setTool('viewpoint');
    setShowSyms(false);
  };

  const selText = selTextIdx !== null ? paths[selTextIdx] : null;
  const isMob = typeof window !== 'undefined' && window.innerWidth < 640;

  // Derived values for shape sub-panel (computed before return to avoid IIFE-in-JSX minification issues)
  const _selShapeIdx = selAnnot !== null ? selAnnot.idx : -1;
  const _selShape = _selShapeIdx >= 0 && paths[_selShapeIdx]?.type === 'shape' ? paths[_selShapeIdx] : null;
  const shapePanelVisible = tool === 'shape' || (tool === 'select' && _selShape !== null);
  const shapeFillDisplay = _selShape ? !!_selShape.filled : shapeFilled;
  const shapePanelFilled = _selShape ? !!_selShape.filled : shapeFilled;
  const shapePanelOpVal = _selShape
    ? (shapePanelFilled ? (_selShape.fillOpacity ?? 0.3) : (_selShape.strokeOpacity ?? 1))
    : (shapeFilled ? fillOpacity : strokeOpacity);
  const shapePanelOpLabel = _selShape
    ? (shapePanelFilled ? 'OPACITÉ REMPLI ✏' : 'OPACITÉ CONTOUR ✏')
    : 'OPACITÉ';

  return (
    <div style={{ position:'fixed',inset:0,background:'#111',zIndex:50,display:'flex',flexDirection:'column' }}>

      {/* ── Bandeau titre (ex: nom du plan) ── */}
      {title && (
        <div style={{ background:'#1a1a1a',padding:'6px 14px',borderBottom:'1px solid #2a2a2a',display:'flex',alignItems:'center',gap:8,flexShrink:0 }}>
          <Ic n="map" s={13}/>
          <span style={{ fontSize:12,color:'#bbb',fontWeight:600 }}>{title}</span>
        </div>
      )}

      {/* ── Toolbar (2 rangées fixes) ── */}
      <div style={{ background:DA.black,padding:'7px 12px 6px',display:'flex',flexDirection:'column',gap:6,flexShrink:0 }}>

        {/* Rangée 1 : outils + undo + sauvegarder */}
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          {/* Outils — scrollables sur mobile si écran trop étroit */}
          <div style={{ flex:1,overflowX:'auto',scrollbarWidth:'none',minWidth:0 }}>
            <div style={{ display:'flex',gap:2,background:'#333',padding:3,borderRadius:10,width:'max-content' }}>
              {[
                { k:'select', n:'sel',  lbl:'Sélect.' },
                { k:'pen',    n:'pen',  lbl:'Dessin'  },
                { k:'text',   n:'txt',  lbl:'Texte'   },
                { k:'shape',  n:'shp',  lbl:'Formes'  },
                { k:'symbol', n:'sym',  lbl:'Symbole' },
              ].map(t => (
                <button key={t.k}
                  onClick={() => {
                    setTool(t.k);
                    if (t.k === 'symbol') setShowSyms(v => !v); else setShowSyms(false);
                    if (t.k !== 'text') { setSelTextIdx(null); textDragRef.current = null; }
                    if (t.k !== 'viewpoint') setActivePh(null);
                    if (t.k !== 'shape') { setPendingShape(null); shapeStartRef.current = null; }
                    setSelAnnot(null); annotDragRef.current = null;
                  }}
                  style={{ padding:isMob?'9px 10px':'8px 11px',borderRadius:8,background:tool===t.k?DA.red:'transparent',
                    color:tool===t.k?'white':'#aaa',transition:'all 0.15s',
                    display:'flex',flexDirection:'column',alignItems:'center',gap:4,minWidth:isMob?44:52 }}>
                  <Ic n={t.n} s={22}/>
                  {!isMob && <span style={{ fontSize:9,fontWeight:700,letterSpacing:0.3 }}>{t.lbl}</span>}
                </button>
              ))}
              {/* Palette — dans le groupe sur mobile */}
              {isMob && (
                <button onClick={() => setShowPalette(v => !v)}
                  style={{ padding:'9px 10px',borderRadius:8,background:showPalette?DA.red:'transparent',
                    color:showPalette?'white':color,transition:'all 0.15s',
                    display:'flex',alignItems:'center',justifyContent:'center',minWidth:44 }}
                  title="Couleurs et épaisseur">
                  <Ic n="pal" s={22}/>
                </button>
              )}
            </div>
          </div>
          {/* Actions fixes — toujours visibles même si les outils débordent */}
          <div style={{ display:'flex',gap:6,flexShrink:0 }}>
            <button onClick={onClose}
              style={{ padding:isMob?'9px 10px':'8px 12px',borderRadius:8,background:'#333',color:'#aaa',
                display:'flex',flexDirection:'column',alignItems:'center',gap:4,minWidth:isMob?44:44 }}
              title="Fermer">
              <Ic n="x" s={22}/>
              {!isMob && <span style={{ fontSize:8,color:'#888',letterSpacing:0.3 }}>Fermer</span>}
            </button>
            <button onClick={() => setPaths(p => p.slice(0,-1))}
              style={{ padding:isMob?'9px 10px':'8px 12px',borderRadius:8,background:'#333',color:'#aaa',
                display:'flex',flexDirection:'column',alignItems:'center',gap:4,minWidth:isMob?44:44 }}
              title="Annuler dernière action">
              <Ic n="und" s={22}/>
              {!isMob && <span style={{ fontSize:8,color:'#888',letterSpacing:0.3 }}>Annuler</span>}
            </button>
            <button onClick={() => {
              const cv = cvRef.current;
              if (!cv || !bgRef.current) { onSave(paths, null, null); onClose(); return; }
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
              drawAnnotationPaths(ectx, paths, ratio * 0.5 * annotScale, ratio);
              ectx.restore();
              // Ramène les coords dans l'espace LQ (planBg) avant de sauver — invariant inter-sessions
              const sc = hqScaleRef.current;
              onSave(scalePaths(paths, 1/sc, 1/sc), ec.toDataURL('image/webp', 0.85), { w: cv.width, h: cv.height });
              onClose();
            }}
              style={{ padding:isMob?'7px 10px':'8px 14px',borderRadius:8,background:DA.red,color:'white',
                display:'flex',flexDirection:'column',alignItems:'center',gap:4 }}>
              <Ic n="chk" s={isMob?17:20}/>
              <span style={{ fontSize:isMob?8:9,fontWeight:800,letterSpacing:0.3,whiteSpace:'nowrap' }}>{isMob?'Sauv.':'Sauvegarder'}</span>
            </button>
          </div>
        </div>

        {/* Rangée 2 : couleurs + tailles — cachée sur mobile (palette) */}
        {!isMob && <div style={{ display:'flex',alignItems:'center',gap:10,flexWrap:'wrap' }}>
          <div style={{ display:'flex',gap:6,flexShrink:0 }}>
            {ANNOT_COLORS.map(cl => (
              <button key={cl} onClick={() => {
                setColor(cl);
                if (selTextIdx !== null) setPaths(prev => prev.map((p,i) => i===selTextIdx ? {...p,color:cl} : p));
              }}
                style={{ width:26,height:26,borderRadius:'50%',background:cl,
                  border:`3px solid ${color===cl?'white':'transparent'}`,
                  boxShadow:color===cl?`0 0 0 1.5px ${cl}`:'none',
                  cursor:'pointer',flexShrink:0,transition:'all 0.1s' }}/>
            ))}
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:8,flexShrink:0 }}>
            <span style={{ fontSize:9,color:'#888',fontWeight:600,letterSpacing:0.3 }}>ÉPAISSEUR</span>
            {[1,3,6].map(sz => (
              <button key={sz} onClick={() => {
                setSize(sz);
                if (selTextIdx !== null) setPaths(prev => prev.map((p,i) => i===selTextIdx ? {...p,size:sz} : p));
              }}
                style={{ width:sz*3+14,height:sz*3+14,borderRadius:'50%',
                  background:size===sz?'white':'#555',
                  border:`2px solid ${size===sz?'white':'#444'}`,
                  cursor:'pointer',flexShrink:0,transition:'background 0.1s',
                  display:'flex',alignItems:'center',justifyContent:'center' }}/>
            ))}
          </div>
        </div>}
      </div>

      {/* ── Palette mobile ── */}
      {isMob && showPalette && (
        <div style={{ background:DA.black,padding:'8px 12px',display:'flex',flexDirection:'column',gap:8,flexShrink:0,borderBottom:'1px solid #333' }}>
          <div style={{ display:'flex',gap:7,flexWrap:'wrap',alignItems:'center' }}>
            {ANNOT_COLORS.map(cl => (
              <button key={cl} onClick={() => { setColor(cl); if (selTextIdx!==null) setPaths(prev=>prev.map((p,i)=>i===selTextIdx?{...p,color:cl}:p)); }}
                style={{ width:30,height:30,borderRadius:'50%',background:cl,
                  border:`3px solid ${color===cl?'white':'transparent'}`,
                  boxShadow:color===cl?`0 0 0 1.5px ${cl}`:'none',cursor:'pointer',flexShrink:0 }}/>
            ))}
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:8 }}>
            <span style={{ fontSize:9,color:'#888',fontWeight:600,letterSpacing:0.3,whiteSpace:'nowrap' }}>ÉPAISSEUR</span>
            {[1,3,6].map(sz => (
              <button key={sz} onClick={() => { setSize(sz); if (selTextIdx!==null) setPaths(prev=>prev.map((p,i)=>i===selTextIdx?{...p,size:sz}:p)); }}
                style={{ width:sz*3+18,height:sz*3+18,borderRadius:'50%',
                  background:size===sz?'white':'#555',border:`2px solid ${size===sz?'white':'#444'}`,
                  cursor:'pointer',flexShrink:0 }}/>
            ))}
          </div>
        </div>
      )}

      {/* ── Taille globale des logos ── */}
      <div style={{ background:'#1a1a1a',padding:'5px 12px',display:'flex',alignItems:'center',gap:10,flexShrink:0,borderBottom:'1px solid #222' }}>
        <span style={{ color:'#888',fontSize:10,fontWeight:600,whiteSpace:'nowrap',letterSpacing:0.3 }}>SYMBOLES</span>
        <input type="range" min="0.3" max="5" step="0.1" value={annotScale}
          onChange={e => {
            const v = parseFloat(e.target.value);
            setAnnotScale(v);
            localStorage.setItem('chantierai_annot_scale', String(v));
          }}
          style={{ flex:1,accentColor:DA.red,cursor:'pointer' }}/>
        <span style={{ color:'#ccc',fontSize:11,fontWeight:700,minWidth:30,textAlign:'right' }}>{annotScale.toFixed(1)}×</span>
      </div>

      {/* ── Symbol picker — catégories ── */}
      {showSyms && tool === 'symbol' && (
        <div style={{ background:'#1a1a1a', flexShrink:0, borderBottom:'1px solid #333' }}>
          {/* Onglets */}
          <div style={{ display:'flex', borderBottom:'1px solid #2a2a2a' }}>
            {SYMBOL_CATEGORIES.map(cat => (
              <button key={cat.id} onClick={() => setSymCat(cat.id)}
                style={{ flex:1, padding:'6px 4px', fontSize:10, fontWeight:700, letterSpacing:0.5,
                  background:symCat===cat.id?DA.red:'transparent', color:symCat===cat.id?'white':'#777',
                  border:'none', cursor:'pointer', textTransform:'uppercase', transition:'all 0.15s' }}>
                {cat.label}
              </button>
            ))}
          </div>
          {/* Bandeau label complet */}
          <div style={{ padding:'4px 12px', minHeight:22, display:'flex', alignItems:'center' }}>
            <span style={{ fontSize:10, color:'#aaa', fontStyle:'italic' }}>{sym?.label || ''}</span>
          </div>
          {/* Grille de symboles */}
          <div style={{ display:'flex', gap:6, padding:'4px 10px 8px', overflowX:'auto', alignItems:'flex-start' }}>
            {(SYMBOL_CATEGORIES.find(c => c.id === symCat)?.ids || []).map(id => {
              const sm = getAllSymbols().find(s => s.id === id);
              if (!sm) return null;
              const isActive = sym.id === sm.id;
              return (
                <button key={sm.id} onClick={() => setSym(sm)}
                  style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:3,
                    padding:'6px 8px', borderRadius:8, cursor:'pointer', border:'none',
                    background:isActive ? DA.red : '#2a2a2a' }}>
                  <SymMiniCanvas sm={sm} color={color} />
                  <span style={{ fontSize:9, fontWeight:700, color:isActive?'white':'#999', letterSpacing:0.3, whiteSpace:'nowrap' }}>
                    {sm.short}
                  </span>
                </button>
              );
            })}
            {/* Symboles custom dans "Divers" */}
            {symCat === 'divers' && getCustomSymbolDefs().map(sm => {
              const isActive = sym.id === sm.id;
              return (
                <div key={sm.id} style={{ position:'relative', flexShrink:0 }}>
                  <button onClick={() => setSym(sm)}
                    style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3,
                      padding:'6px 8px', borderRadius:8, cursor:'pointer', border:'none',
                      background:isActive ? DA.red : '#2a2a2a' }}>
                    <SymMiniCanvas sm={sm} color={color} />
                    <span style={{ fontSize:9, fontWeight:700, color:isActive?'white':'#999', letterSpacing:0.3 }}>{sm.short}</span>
                  </button>
                  <button onClick={() => delCustomSym(sm.id)} title="Supprimer"
                    style={{ position:'absolute',top:-4,right:-5,width:15,height:15,borderRadius:'50%',background:'#B91C1C',color:'white',border:'none',fontSize:9,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0,lineHeight:1,zIndex:2 }}>×</button>
                </div>
              );
            })}
            {/* Créer custom */}
            {symCat === 'divers' && (!showNewSym
              ? <button onClick={() => setShowNewSym(true)}
                  style={{ flexShrink:0,padding:'6px 10px',borderRadius:8,background:'transparent',color:'#4A9EFF',fontSize:11,fontWeight:700,whiteSpace:'nowrap',cursor:'pointer',border:'1.5px dashed #4A9EFF',alignSelf:'center' }}>
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
      )}

      {/* ── Shape sub-panel ── */}
      {shapePanelVisible && (
        <div style={{ background:'#1a1a1a',padding:'7px 12px',display:'flex',gap:6,overflowX:'auto',flexShrink:0,borderBottom:'1px solid #333',alignItems:'center',flexWrap:'wrap' }}>
          {tool === 'shape' && (
            <>
              <span style={{ fontSize:9,color:'#888',fontWeight:600,letterSpacing:0.3,flexShrink:0 }}>FORME</span>
              {[
                { k:'rect',    lbl:'▭ Rect.' },
                { k:'ellipse', lbl:'◯ Ellipse' },
                { k:'arrow',   lbl:'→ Flèche' },
                { k:'line',    lbl:'╱ Ligne' },
                { k:'poly',    lbl:'⬠ Zone libre' },
              ].map(s => (
                <button key={s.k} onClick={() => { if (s.k !== shapeTool) { setPolyPts([]); setPolyMousePos(null); } setShapeTool(s.k); }}
                  style={{ padding:'5px 13px',borderRadius:7,fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,
                    background:shapeTool===s.k?DA.red:'#333',color:shapeTool===s.k?'white':'#aaa',border:'none' }}>
                  {s.lbl}
                </button>
              ))}
              <div style={{ width:1,height:18,background:'#333',flexShrink:0,margin:'0 4px' }}/>
            </>
          )}
          <button onClick={() => {
            if (_selShape) setPaths(prev => prev.map((p,i) => i===_selShapeIdx ? {...p,filled:!p.filled} : p));
            if (tool === 'shape') setShapeFilled(prev => !prev);
          }}
            style={{ padding:'5px 13px',borderRadius:7,fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,
              background:shapeFillDisplay?DA.red:'#333',color:shapeFillDisplay?'white':'#aaa',border:'none' }}>
            {shapeFillDisplay ? '◼ Rempli' : '◻ Contour'}
          </button>
          <div style={{ width:1,height:18,background:'#333',flexShrink:0,margin:'0 2px' }}/>
          <span style={{ fontSize:9,color:'#888',fontWeight:600,letterSpacing:0.3,flexShrink:0,whiteSpace:'nowrap' }}>{shapePanelOpLabel}</span>
          <input type="range" min="0.05" max="1" step="0.05" value={shapePanelOpVal}
            onChange={e => {
              const nv = parseFloat(e.target.value);
              if (_selShape) {
                const opKey = shapePanelFilled ? 'fillOpacity' : 'strokeOpacity';
                setPaths(prev => prev.map((p,i) => i===_selShapeIdx ? {...p,[opKey]:nv} : p));
              } else if (shapeFilled) { setFillOpacity(nv); } else { setStrokeOpacity(nv); }
            }}
            style={{ width:70,accentColor:DA.red,cursor:'pointer',flexShrink:0 }}/>
          <span style={{ fontSize:11,color:'#ccc',fontWeight:700,minWidth:28,flexShrink:0 }}>{Math.round(shapePanelOpVal*100)}%</span>
          {tool === 'shape' && (
            <span style={{ fontSize:10,color:'#555',marginLeft:4,flex:1,whiteSpace:'nowrap',overflow:'hidden' }}>
              {shapeTool === 'poly'
                ? 'Clic = sommet · Double-clic/snap = fermer · Échap = annuler'
                : 'Glisser = dessiner · Clic = sélect. · Poignées = resize · Suppr = effacer'}
            </span>
          )}
        </div>
      )}

      {/* ── Sélecteur de mode texte ── */}
      {tool === 'text' && !selText && (
        <div style={{ background:'#1a1a1a',padding:'6px 12px',borderBottom:'1px solid #333',display:'flex',alignItems:'center',gap:6,flexShrink:0,flexWrap:'wrap' }}>
          <span style={{ fontSize:9,color:'#888',fontWeight:600,letterSpacing:0.3,flexShrink:0 }}>TEXTE</span>
          {[
            { k:'plain', lbl:'Libre' },
            { k:'boxed', lbl:'Encadré' },
            { k:'arrow', lbl:'↗ Flèche' },
          ].map(m => (
            <button key={m.k} onClick={() => setTextMode(m.k)}
              style={{ padding:'5px 13px',borderRadius:7,fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,
                background:textMode===m.k?DA.red:'#333',color:textMode===m.k?'white':'#aaa',border:'none' }}>
              {m.lbl}
            </button>
          ))}
          <span style={{ fontSize:10,color:'#555',marginLeft:4,flex:1 }}>
            {textMode === 'arrow' ? '① Appuyez là où pointe la flèche  ② Glissez jusqu\'au texte' : 'Tapez pour écrire — tapez sur un texte existant pour le modifier directement'}
          </span>
        </div>
      )}

      {/* ── Panneau édition texte sélectionné (texte OU sélection) ── */}
      {selText && (
        <div style={{ background:'#1a1a1a',padding:'7px 12px',borderBottom:'1px solid #333',display:'flex',alignItems:'center',gap:8,flexShrink:0,flexWrap:'wrap' }}>
          <span style={{ fontSize:10,color:'#4A9EFF',fontWeight:700,flexShrink:0 }}>Texte :</span>
          <input
            value={selText.text || ''}
            onChange={e => setPaths(prev => prev.map((p,i) => i===selTextIdx ? {...p,text:e.target.value} : p))}
            style={{ flex:1,minWidth:80,fontSize:12,padding:'4px 8px',borderRadius:6,border:'1px solid #555',background:'#222',color:'white',outline:'none',fontFamily:'inherit' }}
          />
          {/* Changer le style du texte sélectionné */}
          {[{ k:'plain', lbl:'Libre' },{ k:'boxed', lbl:'Cadre' },{ k:'arrow', lbl:'Flèche' }].map(m => (
            <button key={m.k} onClick={() => setPaths(prev => prev.map((p,i) => i===selTextIdx ? {...p,textMode:m.k} : p))}
              style={{ padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',flexShrink:0,
                background:(selText.textMode||'plain')===m.k?DA.red:'#333',color:(selText.textMode||'plain')===m.k?'white':'#aaa',border:'none' }}>
              {m.lbl}
            </button>
          ))}
          <button onClick={() => { setPaths(p => p.filter((_,i) => i !== selTextIdx)); setSelTextIdx(null); }}
            style={{ padding:'4px 8px',background:'#B91C1C',color:'white',border:'none',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0,lineHeight:0,display:'flex',alignItems:'center' }}>
            <Ic n="del" s={13}/>
          </button>
          <button onClick={() => setSelTextIdx(null)}
            style={{ padding:'4px 8px',background:'#333',color:'#aaa',border:'none',borderRadius:6,fontSize:11,cursor:'pointer',flexShrink:0 }}>
            ✕
          </button>
        </div>
      )}

      {/* ── Panneau symbole/viewpoint sélectionné ── */}
      {selAnnot !== null && paths[selAnnot.idx] && (
        <div style={{ background:'#1a1a1a',padding:'7px 12px',borderBottom:'1px solid #333',display:'flex',alignItems:'center',gap:8,flexShrink:0 }}>
          <span style={{ fontSize:10,color:'#4A9EFF',fontWeight:700,flexShrink:0 }}>
            {paths[selAnnot.idx].type === 'viewpoint'
              ? 'Vue'
              : paths[selAnnot.idx].type === 'shape'
                ? ({ rect:'Rect.', ellipse:'Ellipse', arrow:'Flèche', line:'Ligne', poly:'Zone' }[paths[selAnnot.idx].shape] || 'Forme')
                : (getAllSymbols().find(s => s.id === paths[selAnnot.idx].symbolId)?.label || 'Symbole')
            } sélectionné
          </span>
          <span style={{ fontSize:10,color:'#666',flex:1 }}>Glisser pour déplacer</span>
          <button onClick={() => { setPaths(p => p.filter((_,i) => i !== selAnnot.idx)); setSelAnnot(null); annotDragRef.current = null; }}
            style={{ padding:'4px 8px',background:'#B91C1C',color:'white',border:'none',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0,display:'flex',alignItems:'center' }}>
            <Ic n="del" s={13}/>
          </button>
          <button onClick={() => { setSelAnnot(null); annotDragRef.current = null; }}
            style={{ padding:'4px 8px',background:'#333',color:'#aaa',border:'none',borderRadius:6,fontSize:11,cursor:'pointer',flexShrink:0 }}>
            ✕
          </button>
        </div>
      )}

      {/* ── Aide viewpoint ── */}
      {tool === 'viewpoint' && !selAnnot && (
        <div style={{ background:'#1a1a1a',padding:'5px 14px',borderBottom:'1px solid #333',flexShrink:0,display:'flex',alignItems:'center',gap:8 }}>
          <Ic n="eye" s={12}/>
          <span style={{ fontSize:11,color:'#888' }}>
            {activePh
              ? <><span style={{ color:DA.red,fontWeight:700 }}>{activePh.label}</span> sélectionnée — cliquer-glisser pour placer et orienter</>
              : 'Cliquer-glisser pour placer. Cliquer sur un existant pour le déplacer.'}
          </span>
        </div>
      )}

      {/* ── Aide symboles orientables ── */}
      {tool === 'symbol' && (sym?.id === 'portee' || sym?.id === 'pente_sol') && !selAnnot && (
        <div style={{ background:'#1a1a1a',padding:'5px 14px',borderBottom:'1px solid #333',flexShrink:0,display:'flex',alignItems:'center',gap:8 }}>
          <span style={{ fontSize:11,color:'#888' }}>Cliquer-glisser pour orienter. Cliquer sur un existant pour le déplacer.</span>
        </div>
      )}

      {/* ── Canvas ── */}
      <div ref={canvasWrapRef} style={{ flex:1,overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',background:'#1a1a1a',padding:8,minHeight:0 }}>
        {bgImage ? (
          <div style={{ position:'relative',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center' }}>
            <canvas ref={cvRef}
              style={{ maxWidth:'100%',maxHeight:'100%',display:'block',touchAction:'none',boxShadow:'0 0 40px rgba(0,0,0,0.5)',cursor:tool==='text'?'text':tool==='select'?'default':'crosshair',transform:`translate(${vt.px}px,${vt.py}px) scale(${vt.z})`,transformOrigin:'50% 50%' }}
              onMouseDown={onStart} onMouseMove={onMove} onMouseUp={onEnd} onMouseLeave={onEnd}
              onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
              onContextMenu={e => e.preventDefault()}/>
            {vt.z > 1.05 && (
              <button
                onTouchStart={e => { e.stopPropagation(); setVt({ z:1, px:0, py:0 }); }}
                onClick={() => setVt({ z:1, px:0, py:0 })}
                style={{ position:'absolute',top:8,right:8,background:'rgba(0,0,0,0.72)',border:'none',color:'white',borderRadius:8,padding:'5px 11px',fontSize:11,fontWeight:700,cursor:'pointer',zIndex:5,letterSpacing:0.3 }}>
                ×{vt.z.toFixed(1)} ↺
              </button>
            )}
            {/* Saisie inline — apparaît directement au point de tap */}
            {inlineEditPos && (
              <div style={{ position:'absolute', left:inlineEditPos.left, top:inlineEditPos.top, zIndex:20,
                transform:'translate(-4px, -36px)', pointerEvents:'auto',
                display:'flex', alignItems:'center', gap:4 }}>
                <input autoFocus value={inlineEditVal} onChange={e=>setInlineEditVal(e.target.value)}
                  onKeyDown={e=>{ if(e.key==='Enter')confirmInlineEdit(); if(e.key==='Escape')cancelInlineEdit(); }}
                  placeholder="Texte…"
                  style={{ fontSize:14, background:'rgba(20,20,20,0.95)', color:'white',
                    border:'2px solid '+DA.red, borderRadius:6, padding:'6px 10px',
                    outline:'none', minWidth:90, maxWidth:220, fontFamily:'inherit',
                    boxShadow:'0 3px 14px rgba(0,0,0,0.65)' }}/>
                {inlineEditIdx !== null && (
                  <button onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
                    onClick={()=>{ setPaths(p=>p.filter((_,i)=>i!==inlineEditIdx)); cancelInlineEdit(); }}
                    style={{ background:'#B91C1C',color:'white',border:'none',borderRadius:6,
                      padding:'6px 8px',cursor:'pointer',display:'flex',alignItems:'center',flexShrink:0 }}>
                    <Ic n="del" s={12}/>
                  </button>
                )}
                <button onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
                  onClick={cancelInlineEdit}
                  style={{ background:'#333',color:'#aaa',border:'none',borderRadius:6,
                    padding:'6px 9px',cursor:'pointer',fontSize:13,flexShrink:0 }}>✕</button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:12,color:DA.grayL }}>
            <Ic n="spn" s={32}/><p style={{ fontSize:13 }}>Chargement du plan…</p>
          </div>
        )}
      </div>

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
            const sz = photoStripBig ? 104 : 56;
            return (
              <button key={i} onClick={() => selectPhoto(ph, i)}
                title={ph.name || `Photo ${i + 1}`}
                style={{ flexShrink:0,padding:0,background:'none',border:`3px solid ${isActive ? DA.red : 'transparent'}`,borderRadius:8,overflow:'hidden',cursor:'pointer',outline:'none',transition:'border-color 0.15s,width 0.15s,height 0.15s' }}>
                <img src={ph.data} alt="" style={{ width:sz,height:sz,objectFit:'cover',display:'block' }}/>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

function SymMiniCanvas({ sm, color }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !sm?.draw) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 40, 40);
    sm.draw(ctx, 20, 20, 1, color);
  }, [sm, color]);
  return <canvas ref={canvasRef} width={40} height={40} style={{ display:'block', width:40, height:40 }} />;
}

export default Annotator;
