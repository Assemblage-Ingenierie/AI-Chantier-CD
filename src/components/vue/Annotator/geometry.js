// Annotations — GÉOMÉTRIE de sélection/édition (poignées, tests de clic, aimantation, déplacement).
// Extrait tel quel d'Annotator.jsx (découpage du 02/11/2026, aucun changement de logique).

// Poignées de redimensionnement selon le type de forme
export function getShapeHandles(ap) {
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
export function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
export function nearShapeOutline(p, pos, r) {
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
export function snapPointsOf(p) {
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
export function snapSegmentsOf(p) {
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
export function constrainAngle(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}
// Maj : carré / cercle parfait.
export function squareFrom(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, m = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: from.x + (dx < 0 ? -m : m), y: from.y + (dy < 0 ? -m : m) };
}

// ── ÉDITION RAPIDE (multi-sélection, flèches, dupliquer) ──
// Rectangle englobant d'une annotation (coords canvas). `r` = rayon d'un point (symbole,
// viewpoint), `sT` = échelle du texte (même calcul que le hit-test du texte).
export function pathBounds(p, r, sT) {
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
export const isShapeFilled = (p) => (p?.shape === 'poly' ? p.filled !== false : !!p?.filled);
export const FILLABLE = new Set(['rect', 'ellipse', 'poly']);
export function hitsShape(p, pos, r) {
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
export function movePath(p, dx, dy) {
  const q = { ...p };
  if (q.x  != null) { q.x  += dx; q.y  += dy; }
  if (q.x1 != null) { q.x1 += dx; q.y1 += dy; q.x2 += dx; q.y2 += dy; }
  if (q.arrowX != null) { q.arrowX += dx; q.arrowY += dy; }
  if (p.pts)    q.pts    = p.pts.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
  if (p.points) q.points = p.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
  return q;
}
