// Annotations — DESSIN sur canvas (formes, textes, Vxx, symboles) et mise à l'échelle.
// Partagé par l'annotateur, la vue Visite et le rapport (drawAnnotationPaths : tout nouveau type
// d'annotation doit y être ajouté). Extrait tel quel d'Annotator.jsx (découpage du 02/11/2026,
// aucun changement de logique) ; Annotator.jsx ré-exporte tout pour les imports existants.

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
export function snapToBoxEdge(px, py, bx, by, bw, bh, rad = 0) {
  let x = Math.max(bx, Math.min(bx + bw, px)), y = Math.max(by, Math.min(by + bh, py));
  const dL = x - bx, dR = bx + bw - x, dT = y - by, dB = by + bh - y;
  const m = Math.min(dL, dR, dT, dB);
  if (m > 0) { if (m === dL) x = bx; else if (m === dR) x = bx + bw; else if (m === dT) y = by; else y = by + bh; }
  const onH = y === by || y === by + bh;
  if (onH && bw > rad * 2) x = Math.max(bx + rad, Math.min(bx + bw - rad, x));
  else if (!onH && bh > rad * 2) y = Math.max(by + rad, Math.min(by + bh - rad, y));
  return { x, y, fx: bw > 0 ? (x - bx) / bw : 0.5, fy: bh > 0 ? (y - by) / bh : 0.5 };
}
export function arrowAtPoint(p, bx, by, bw, bh) {
  const a = p.arrowAt;
  if (!a || !Number.isFinite(a.fx) || !Number.isFinite(a.fy)) return null;
  return snapToBoxEdge(bx + a.fx * bw, by + a.fy * bh, bx, by, bw, bh);
}

// Pente sol — flèche simple orientable (drag x1,y1→x2,y2) + label "Sol"
export function drawPenteSolPath(ctx, x1, y1, x2, y2, s, c) {
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

// ── Symboles personnalisés (stockés en localStorage, forme auto-générée) ──────
export const CUSTOM_SYMS_KEY = 'chantierai_custom_syms_v1';
export const _CSHAPES = [
  (ctx,x,y) => { ctx.beginPath(); ctx.arc(x,y,16,0,Math.PI*2); ctx.stroke(); },
  (ctx,x,y) => { ctx.beginPath(); ctx.moveTo(x,y-18); ctx.lineTo(x+14,y); ctx.lineTo(x,y+18); ctx.lineTo(x-14,y); ctx.closePath(); ctx.stroke(); },
  (ctx,x,y) => { ctx.beginPath(); ctx.rect(x-14,y-14,28,28); ctx.stroke(); },
  (ctx,x,y) => { ctx.beginPath(); ctx.moveTo(x-16,y); ctx.lineTo(x+16,y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x,y-16); ctx.lineTo(x,y+16); ctx.stroke(); },
];
export function _makeCustomDraw(short, shapeIdx) {
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
