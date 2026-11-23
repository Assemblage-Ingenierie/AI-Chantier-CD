// « Améliorer avec l'IA » — VERSION RÉÉCRITE du texte entier (demande Thomas 23/11) : l'IA propose
// le texte complet reformulé, affiché comme la correction d'orthographe (passages barrés / ajoutés).
// Un clic sur un passage le GARDE tel quel ; à l'application, les passages gardés reçoivent quand
// même les corrections d'orthographe → le résultat est toujours sans faute.
//
// Sécurité de la mise en forme : la réécriture doit garder EXACTEMENT le même découpage en lignes
// (une puce reste une puce, une ligne vide reste vide). Sinon elle est refusée (null) → on retombe
// sur le comportement d'avant. Le diff est calculé LIGNE PAR LIGNE : aucun passage ne chevauche
// deux lignes, la mise en forme (puces, gras, couleurs, images) reste en place.
import { diffChunks, applyFixesAtPositions } from './applyTextFixes.js';

const splitLines = (t) => String(t).split('\n');
const joinLines = (ls) => ls.map((l, i) => (i < ls.length - 1 ? l + '\n' : l));

// Texte d'origine + texte réécrit → segments (diff ligne par ligne), ou null si inutilisable.
export function buildRewriteSegments(plain, rewritten) {
  if (typeof plain !== 'string' || typeof rewritten !== 'string' || !rewritten.trim()) return null;
  const lead = plain.match(/^\n*/)[0], trail = plain.match(/\n*$/)[0];
  const rw = lead + rewritten.replace(/^\n+|\n+$/g, '') + trail;
  const a = splitLines(plain), b = splitLines(rw);
  if (a.length !== b.length) return null;
  for (let i = 0; i < a.length; i++) if (!a[i].trim() !== !b[i].trim()) return null; // ligne vide ↔ vide
  const segments = bySentence(a, b);
  return segments.some(s => s.type === 'fix') ? segments : null;
}

// Passages par PHRASE entière (retour Thomas 23/11 : accepter mot par mot donnait des phrases qui
// ne veulent plus rien dire). Ligne par ligne : même nombre de phrases → comparées une à une (une
// phrase identique reste neutre) ; sinon la ligne entière forme un seul passage. Recompose
// exactement l'original (del/eq) et le texte réécrit (add/eq).
function splitSentences(t) {
  const parts = [];
  let last = 0;
  const re = /[.!?;](?=\s|$)\s*/g;
  for (let m = re.exec(t); m; m = re.exec(t)) { parts.push(t.slice(last, m.index + m[0].length)); last = m.index + m[0].length; }
  if (last < t.length) parts.push(t.slice(last));
  return parts.length ? parts : [t];
}
// Nature d'une modification de phrase (code couleur du volet, retour Thomas 23/11) :
//   null     → rien de réel (espaces / typographie) : non proposée ;
//   'ortho'  → orthographe seulement (orange) : mêmes mots, chacun à peine retouché (accents,
//              accords, lettre en trop/manquante, majuscule, ponctuation) ;
//   'reform' → vraie reformulation / amélioration (vert).
const _typo = (x) => String(x).replace(/[\u2018\u2019\u201b\u2032]/g, "'").replace(/[\u201c\u201d\u2033\u00ab\u00bb]/g, '"').replace(/[\u00a0\u202f]/g, ' ');
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
export function changeKind(del, add) {
  const ns = (x) => _typo(x).replace(/\s+/g, '');
  if (ns(del) === ns(add)) return null;
  const words = (x) => _typo(x).toLowerCase().split(/\s+/).map(w => w.replace(/[.,;:!?()"]/g, '')).filter(Boolean);
  const wa = words(del), wb = words(add);
  if (wa.join(' ') === wb.join(' ')) return 'ortho'; // majuscules / ponctuation seulement
  if (Math.abs(wa.length - wb.length) > 1) return 'reform';
  // Alignement mot à mot tolérant (un mot ajouté/retiré au plus, ex. « de » manquant).
  let i = 0, j = 0, edits = 0;
  while (i < wa.length || j < wb.length) {
    const x = wa[i], y = wb[j];
    if (x === y) { i++; j++; continue; }
    if (x != null && y != null && lev(x, y) <= Math.max(2, Math.floor(Math.max(x.length, y.length) * 0.34))) { i++; j++; edits++; continue; }
    if (wa.length > wb.length) i++; else j++;
    edits++;
    if (edits > Math.max(2, Math.ceil(wa.length * 0.4))) return 'reform';
  }
  return edits <= Math.max(2, Math.ceil(wa.length * 0.4)) ? 'ortho' : 'reform';
}

export function bySentence(aLines, bLines) {
  const out = [];
  let id = 0;
  const eq = (text) => { if (!text) return; const l = out[out.length - 1]; if (l?.type === 'eq') l.text += text; else out.push({ type: 'eq', text }); };
  const fix = (del, add) => {
    // Changement INSIGNIFIANT (espaces, apostrophes/guillemets typographiques) → pas proposé
    // (retour Thomas 23/11 : « si c'est pour ne rien changer, pas la peine »). On garde l'original.
    const kind = changeKind(del, add);
    if (!kind) { eq(del); return; }
    // Blancs de fin communs laissés neutres (jamais de passage qui « mange » l'espace suivant).
    const tw = (x) => x.match(/\s*$/)[0];
    const t = tw(del) === tw(add) ? tw(del) : '';
    out.push({ type: 'fix', id: id++, kind, del: del.slice(0, del.length - t.length), add: add.slice(0, add.length - t.length), active: true });
    eq(t);
  };
  aLines.forEach((la, i) => {
    const lb = bLines[i];
    if (la !== lb) {
      const sa = splitSentences(la), sb = splitSentences(lb);
      if (sa.length === sb.length) sa.forEach((x, k) => (x === sb[k] ? eq(x) : fix(x, sb[k])));
      else fix(la, lb);
    } else eq(la);
    if (i < aLines.length - 1) eq('\n');
  });
  return out;
}

const q = (s) => s.replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"');
function applyCorrections(text, corrections) {
  let out = text;
  for (const c of corrections || []) {
    if (!c || typeof c.extrait !== 'string' || !c.extrait || /\n/.test(c.extrait) || typeof c.correction !== 'string') continue;
    const idx = q(out).indexOf(q(c.extrait));
    if (idx >= 0) out = out.slice(0, idx) + c.correction.trim() + out.slice(idx + c.extrait.length);
  }
  return out;
}

// Texte final : passages acceptés = version réécrite ; passages gardés = original CORRIGÉ.
export function composeRewrite(segments, corrections = []) {
  return (segments || []).map(s => {
    if (s.type === 'eq') return s.text;
    if (s.active !== false) return s.add;
    return applyCorrections(s.del, corrections);
  }).join('');
}

const nonWs = (s) => q(String(s)).replace(/\s+/g, '');

// Applique le texte final au commentaire HTML. `toPlain` = htmlToPlain (injecté pour les tests),
// `patchLine(html, del, add)` = remplacement tolérant aux balises (repli ligne par ligne).
// Renvoie le nouveau HTML, ou null si le commentaire a changé entre-temps / échec (rien touché).
export function applyRewriteToHtml(html, plain, finalPlain, { toPlain, patchLine } = {}) {
  if (typeof toPlain !== 'function') return null;
  if (nonWs(toPlain(html)) !== nonWs(plain)) return null; // texte modifié entre-temps → on ne touche à rien
  if (finalPlain === plain) return html;
  const a = splitLines(plain), b = splitLines(finalPlain);
  if (a.length !== b.length) return null;
  // 1) Application positionnelle (garde la mise en forme mot à mot).
  const segs = diffChunks(joinLines(a), joinLines(b)).map(s => (s.type === 'fix' ? { ...s, active: true } : s));
  const pos = applyFixesAtPositions(html, plain, segs);
  if (pos != null && nonWs(toPlain(pos)) === nonWs(finalPlain)) return pos;
  // 2) Repli : ligne par ligne (une insertion en début de ligne n'est pas gérée par l'étape 1).
  if (typeof patchLine !== 'function') return null;
  let out = html;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i] || !a[i].trim()) continue;
    out = patchLine(out, a[i].trim(), b[i].trim());
  }
  return nonWs(toPlain(out)) === nonWs(finalPlain) ? out : null;
}

// ── Échange LIGNE PAR LIGNE avec l'IA (v2, retour Thomas 23/11 : la v1 en JSON échouait souvent —
// saut de ligne non échappé, nombre de lignes modifié — et l'app retombait sur les anciennes cartes
// à 2 propositions). Chaque ligne non vide part numérotée « [n] … » ; l'IA renvoie les mêmes
// numéros. Une ligne absente ou illisible reste simplement telle quelle : jamais d'échec global.
export function numberLines(plain) {
  const lines = String(plain || '').split('\n');
  const idx = [];
  const out = [];
  lines.forEach((l, i) => { if (l.trim()) { idx.push(i); out.push(`[${idx.length}] ${l.trim()}`); } });
  return { text: out.join('\n'), idx };
}

// Réponse « [n] texte » → texte complet (même découpage que `plain`).
export function parseNumbered(output, plain) {
  const lines = String(plain || '').split('\n');
  const { idx } = numberLines(plain);
  const got = new Map();
  let cur = null;
  for (const raw of String(output || '').split('\n')) {
    const m = raw.match(/^\s*\[(\d+)\]\s?(.*)$/);
    if (m) { cur = Number(m[1]); got.set(cur, m[2].trim()); }
    else if (cur != null && raw.trim()) got.set(cur, `${got.get(cur)} ${raw.trim()}`.trim()); // ligne coupée par l'IA
  }
  idx.forEach((li, k) => {
    const v = got.get(k + 1);
    if (typeof v === 'string' && v.trim()) {
      const lead = lines[li].match(/^\s*/)[0];
      lines[li] = lead + v.replace(/[—–]/g, ',');
    }
  });
  return lines.join('\n');
}
