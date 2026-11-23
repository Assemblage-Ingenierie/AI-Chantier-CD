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
  const segments = diffChunks(joinLines(a), joinLines(b));
  return segments.some(s => s.type === 'fix') ? segments : null;
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
