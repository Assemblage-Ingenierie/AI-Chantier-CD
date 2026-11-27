// Aperçu du rapport — dimensions de page A4 et pagination (découpage des observations en blocs).
// Extrait tel quel de RapportPreview.jsx (découpage du 02/11/2026, aucun changement de logique).
import { isBrouillon } from '../../../lib/constants.js';
import { stripMarkup } from '../../../lib/markup.jsx';
import { childrenOf, effectiveParentId } from '../../../lib/zoneGroups.js';
import { photoKey } from '../../../lib/photoMerge.js';

// Mode diagnostic Vxx : activé via ?vxxdebug=1 dans l'URL. Affiche un panneau + étiquettes photo
// pour comprendre pourquoi un badge ne se pose pas. Sans effet en utilisation normale.
export const VXX_DEBUG = typeof window !== 'undefined' && /[?&]vxxdebug=1\b/.test(window.location.search);

// Échelle : 3px = 1mm → page A4 = 630 × 891px
export const S   = 3;
export const PH  = 297 * S;  // 891px
export const PW  = 210 * S;  // 630px
export const MX  = 18  * S;  // 54px marges gauche/droite
export const MT  = 18  * S;  // 54px marge haute
export const MB  = 13  * S;  // 39px marge basse
export const HDR = 10  * S;  // 30px hauteur header
export const FTR = 8   * S;  // 24px hauteur footer
export const CW  = PW - 2 * MX; // 522px largeur contenu
// Hauteur max d'un plan PORTRAIT dans le rapport : on le laisse remplir quasiment toute la
// page (≈ hauteur de contenu utile moins titre + légende) pour qu'il soit lisible — au lieu
// du plafond paysage de 340px qui réduisait les plans portrait en vignettes « riquiqui ».
export const PLAN_PORTRAIT_MAXH = PH - HDR - (MT - HDR) - (MB + FTR) - 96; // ≈ 678px

// ── Hauteur disponible par page A4 (px preview) ────────────────────────────────────────────
// Photo portrait « en grand » : largeur réduite (sinon plus haute qu'une page).
export const BIG_PORTRAIT_W = 0.62;
export const CHUNK_CHARS = 2500; // max chars per text chunk — only split genuinely long texts

// Découpe un long commentaire en morceaux aux limites de paragraphes.
// Retour Gab/Thomas 20/11 (« saut de ligne et de section non demandé » au milieu d'une phrase,
// « bacs | acier déformés ») : un commentaire MIS EN FORME (HTML de l'éditeur, souvent sans
// aucun « \n ») était coupé au dernier espace avant 2 500 caractères BALISES COMPRISES → coupure
// en pleine phrase, gras perdu. Désormais : longueur = texte VISIBLE, et un texte HTML n'est coupé
// qu'ENTRE deux paragraphes (<div>/<p>), jamais dedans ; un texte brut, à la fin d'une phrase.
export function splitComment(comment, maxChars = CHUNK_CHARS) {
  if (!comment) return [comment || ''];
  if (/<(?:div|p)\b/i.test(comment)) return splitHtmlComment(comment, maxChars);
  if (comment.length <= maxChars) return [comment];
  const sep = /\n{2,}/.test(comment) ? /\n{2,}/ : /\n/;
  const paras = comment.split(sep).map(p => p.trim()).filter(Boolean);
  if (paras.length <= 1) {
    // Pas de paragraphes → couper à la dernière FIN DE PHRASE avant maxChars (sinon au dernier espace)
    const head = comment.slice(0, maxChars);
    const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    const cut = sentence > maxChars * 0.4 ? sentence + 1 : (comment.lastIndexOf(' ', maxChars) || maxChars);
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

// HTML de l'éditeur : unités = paragraphes de 1er niveau (chaque <div>/<p> reste ENTIER, balises
// comprises), regroupés tant que le texte visible tient dans maxChars. Concaténer les morceaux
// redonne exactement le HTML d'origine. Un seul gros paragraphe → pas de découpe.
function splitHtmlComment(html, maxChars) {
  // « Poids » d'un morceau ≈ hauteur : texte visible + IMAGES collées dans le texte (≈ 15 lignes
  // chacune) + lignes vides. Retour Gab 24/11 : un texte court avec une image n'était jamais
  // découpé → bloc plus haut qu'une page, qui débordait et sautait à un endroit « random ».
  const visible = (h) => stripMarkup(h).length
    + (String(h).match(/<img\b/gi) || []).length * 1000
    + (String(h).match(/<(div|p)[^>]*>\s*(<br\s*\/?>)?\s*<\/\1>/gi) || []).length * 65;
  if (visible(html) <= maxChars) return [html];
  const units = [];
  let depth = 0, start = 0;
  const re = /<(\/?)(div|p)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1]) { if (depth === 0 && m.index > start) { units.push(html.slice(start, m.index)); start = m.index; } depth++; }
    else { depth = Math.max(0, depth - 1); if (depth === 0) { units.push(html.slice(start, re.lastIndex)); start = re.lastIndex; } }
  }
  if (start < html.length) units.push(html.slice(start));
  const parts = units.filter(u => u.trim());
  if (parts.length <= 1) return [html];
  const chunks = [];
  let cur = '';
  for (const u of parts) {
    if (cur && visible(cur + u) > maxChars) { chunks.push(cur); cur = u; } else cur += u;
  }
  if (cur) chunks.push(cur);
  return chunks.length > 1 ? chunks : [html];
}

// Découpe un texte en segments coupables : paragraphes > lignes > phrases
export function splitTextSegs(text) {
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
export function estimateBlockH(block, ppl) {
  if (block.type === 'zone') return 42;
  if (block.type === 'plan') return Math.round(CW * 0.6) + 30 + 90;
  const item = block.item;
  const mode = block.mode || 'full';
  // Texte VISIBLE (sans balises ni liens d'images) : l'HTML gonflait l'estimation → faux sauts.
  const txt  = stripMarkup(block.textContent ?? item.commentaire ?? '');
  let h = mode === 'cont' ? 20 : 52;
  if (mode !== 'photos' && txt) h += Math.ceil(txt.length / 65) * 16;
  if (mode !== 'text' && mode !== 'cont') {
    // Blocs-rangée (photoRow) : hauteur d'UNE rangée selon le layout (paysage 4:3,
    // portraits/mosaïque ≈ hauteur d'un 3:4). Sinon estimation classique multi-rangées.
    const row = block.photoRow;
    if (row) {
      const cols  = block.photoCols || Math.min(ppl, 3);
      const cellW = (CW - 12 - (cols - 1) * 3) / cols;
      h += (row.kind === 'big' ? (CW - 12) * (row.w || 1) * (row.portrait ? BIG_PORTRAIT_W * (4 / 3) : 0.75)
        : row.kind === 'custom' ? ((CW - 12 - (row.cols - 1) * 3) / row.cols) * (row.portrait ? 4 / 3 : 0.75)
        : row.kind === 'mixed' ? (CW - 12 - 3 * (row.idxs.length - 1)) / row.ars.reduce((a, b) => a + b, 0)
        : row.kind === 'landscape' ? cellW * 0.75 : ((CW - 12) / 2) * (4 / 3)) + 14;
    } else {
      const nPh = Math.min((item.photos || []).filter(p => p.data || p.annotated).length, 6);
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
export function itemHasReportContent(i) {
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
export function flattenBlocks(locs, plansEnFin, ppl = 2, paraBreaks = new Set(), vxxPhotoMap = new Map(), _plansNoBreak = false, planLibrary = [], breaks = new Set()) {
  const blocks = [];
  const planTail = []; // plans groupés en fin quand plansNoBreak=true
  const cols   = Math.min(ppl, 3);

  for (const loc of locs) {
    const items = (loc.items || []).filter(itemHasReportContent);
    // Groupe de zones (« R+4 ») : titre + plan même SANS observation propre, dès qu'une de ses
    // sous-zones a du contenu. Sous-zone : sous-titre. Sans groupe → rendu inchangé.
    const isGroup = childrenOf(locs, loc.id).length > 0;
    if (!isGroup && !items.some(i => !isBrouillon(i))) continue;
    const parentId = effectiveParentId(locs, loc);
    const level = isGroup ? 'group' : (parentId ? 'sub' : 'zone');
    const parentNom = parentId ? (locs.find(l => l.id === parentId)?.nom || '') : '';
    blocks.push({ type:'zone', id:loc.id, loc, level, parentNom });
    let photoOffset = 0;
    for (const item of items) {
      const photos  = (item.photos || []).filter(p => p.data || p.annotated);
      // Brouillon : absent du rapport, mais ses photos comptent dans l'offset (index aplati des
      // badges Vxx de la zone) → les badges des observations suivantes restent justes.
      if (isBrouillon(item)) { photoOffset += photos.length; continue; }
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
              textContent:text, vpPhotoOffset:photoOffset, vxxPhotoMap,
              // la suite du texte vient dans le bloc suivant → cadre « ouvert » en bas (pas de section en plus)
              chunkNext: idx < textChunks.length - 1 });
          } else if (idx === 0 && !photos.length) {
            blocks.push({ type:'item', id, item, locId:loc.id, mode:'full', vpPhotoOffset:photoOffset, vxxPhotoMap });
          }
        });
      } else {
        // Intitulé + photos SANS commentaire (Stas écrit son texte dans l'intitulé, retour Thomas
        // 26/10) : avant, seules les rangées de photos sortaient → l'intitulé n'était pas imprimé.
        // On imprime l'en-tête (intitulé, urgence, suivi, dates) au-dessus des photos.
        blocks.push({ type:'item', id:item.id, item, locId:loc.id, mode:'full', vpPhotoOffset:photoOffset, vxxPhotoMap });
      }

      // Photos : une rangée = un bloc. Mise en page qui RESPECTE L'ORDRE des photos (retour Thomas
      // 23/11 : l'ancien « packing » remontait les portraits → la dernière photo passait en premier).
      // Voir packPhotoRows ci-dessous. Chaque cellule garde l'index ORIGINAL de sa photo (badges Vxx
      // et recadrage intacts).
      if (photos.length > 0) {
        // Réglages propres à l'observation (demande Thomas 24/11) : photos par ligne, photos en grand.
        const itemCols = [1, 2, 3].includes(item.reportCols) ? item.reportCols : cols;
        const big = new Set(item.photoBig || []);
        const keys = photos.map(ph => photoKey(ph));
        const bigW = item.photoBigW || {};
        const rowCols = item.rowCols || {};
        const rows = packPhotoRowsBig(photos.map(ph => ph?.orient === 'portrait'), keys.map(k => (big.has(k) ? (bigW[k] || 1) : 0)), itemCols, activeRowCols(rowCols, keys))
          .map(r => ({ ...r, firstKey: keys[r.idxs ? r.idxs[0] : (r.side === 'right' ? r.stackIdxs[0] : r.portraitIdx)] || null, photoKeys: keys }));
        rows.forEach((row, k) => {
          blocks.push({
            type:'item',
            id: k === 0 ? `${item.id}_ph` : `${item.id}_ph${k}`,
            item, locId:loc.id, mode:'photos',
            photoRow: row, photoCols: itemCols,
            isLastPhotoRow: k === rows.length - 1,
            isFirstPhotoRow: k === 0,
            vpPhotoOffset: photoOffset, vxxPhotoMap,
          });
        });
      }

      // Plans PROPRES à l'observation (item.plans), juste après ses photos — comme dans le PDF
      // (generateRapport « Plans additionnels annotés »). Seulement les plans ANNOTÉS et à fond
      // résolvable. L'id n'est jamais dans `breaks` → aucun saut de page forcé (pagination intacte).
      (item.plans || []).forEach((pl, pidx) => {
        if (!pl.planAnnotations?.paths?.length) return;
        const bg = pl.planBg || (planLibrary.find(p => p.id === pl.planId)?.bg) || null;
        if (!bg && !pl.planAnnotations?.exported) return;
        blocks.push({
          type: 'itemplan',
          id: `${item.id}_iplan${pidx}`,
          item, locId: loc.id,
          plan: { bg, planId: pl.planId || null, annotations: pl.planAnnotations },
          planNom: (planLibrary.find(p => p.id === pl.planId)?.nom || '').toUpperCase() || null,
        });
      });

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
// PAGINATION AUTOMATIQUE (demande Thomas 23/11 ; avant : coupe uniquement sur les ✂ manuels →
// une page contenait tout le reste du rapport, « dépasse de 13 409 px »). Les ✂ restent des coupes
// FORCÉES. En plus, une page se coupe d'elle-même dès qu'elle est pleine — toujours ENTRE deux
// blocs (jamais dans une photo / un paragraphe). Une page qui ne dépasse que de peu est gardée si
// ses rangées de photos peuvent être légèrement resserrées (ajustement pageFit, facteur ≥ minFit)
// → 4 rangées de photos tiennent sur une page, jamais 5. Un titre de zone (ou l'en-tête court
// d'une observation) n'est jamais laissé seul en bas de page.
//   heights : { id: hauteur mesurée } (repli : estimation) ; opts.avail : hauteur utile d'une page ;
//   opts.gridH : { id: hauteur des photos du bloc } ; opts.minFit : resserrement maxi accepté.
export function buildPages(allBlocks, ppl, breaks, heights, opts = {}) {
  const avail = opts.avail || 0;
  const gridH = opts.gridH || {};
  const minFit = opts.minFit ?? 0.85;
  // Sauts AUTOMATIQUES annulés à la main (outil saut de page, retour Thomas 24/11 : « ça saute
  // tout seul alors qu'il y a du vide ») : ce bloc reste sur la page courante.
  const noBreak = opts.noBreak || new Set();
  const hOf = (b) => (heights && heights[b.id]) || estimateBlockH(b, ppl);
  const pages  = [];
  let blocks   = [];
  let H = 0, P = 0;

  const flush = () => {
    if (blocks.length) { pages.push(blocks); blocks = []; }
    H = 0; P = 0;
  };
  const fits = (h, p) => {
    if (!avail || H + h <= avail) return true;
    const photos = P + p;
    if (!photos) return false;
    return 1 - (H + h - avail) / photos >= minFit; // resserrement des photos suffisant
  };
  // Blocs à garder avec la suite : titre de zone ; en-tête court d'une observation suivi de ses photos.
  const keepWithNext = (b, next) => {
    if (!next) return false;
    if (b.type === 'zone') return true;
    return b.type === 'item' && b.mode !== 'photos' && next.type === 'item' && next.mode === 'photos'
      && next.item?.id === b.item?.id && hOf(b) < 140;
  };

  for (let i = 0; i < allBlocks.length; i++) {
    const block = allBlocks[i];
    if (breaks.has(block.id)) flush();
    const h = hOf(block);
    const p = gridH[block.id] || 0;
    if (blocks.length && !fits(h, p)) {
      // Blocs (titre de zone, en-tête court) qui partiraient AVEC lui sur la page suivante.
      let k = blocks.length;
      while (k > 0 && keepWithNext(blocks[k - 1], k < blocks.length ? blocks[k] : block)) k--;
      const chain = blocks.slice(k);
      // Pas de saut (retour Gab / Thomas 24/11 : « ça saute à un endroit random, et après on ne
      // peut pas modifier ») :
      //  - saut annulé à la main, sur ce bloc OU sur le titre qui l'accompagne (le bouton
      //    « remonter » vise le 1er bloc de la page, souvent le titre de zone) ;
      //  - la page ne contient que ce qui partirait avec lui (titre seul) : sauter ne gagne rien.
      const manual = noBreak.has(block.id) || chain.some(c => noBreak.has(c.id));
      const onlyChain = k === 0;
      if (!manual && !onlyChain) {
        // Trace : saut automatique qui laisse beaucoup de vide (pour corriger la mesure en cause).
        if (opts.onLooseBreak && avail && H < avail * 0.6) opts.onLooseBreak({ id: block.id, type: block.type, mode: block.mode || null, H: Math.round(H), h: Math.round(h), p: Math.round(p), avail: Math.round(avail), measured: !!(heights && heights[block.id]), est: Math.round(estimateBlockH(block, ppl)) });
        // Ne pas laisser un titre (ou une chaîne titre → en-tête) seul en bas de page.
        blocks.length = k;
        flush();
        for (const c of chain) { blocks.push(c); H += hOf(c); P += gridH[c.id] || 0; }
      }
    }
    blocks.push(block);
    H += h; P += p;
  }
  flush();
  return pages;
}

// ── Sous-composants ──────────────────────────────────────────────────────────────────

// Splits a zone's plans into page groups based on active breaks Set.
// Returns array of { plans, topBreakId } where topBreakId is the break that started this group (null for first).
export function splitPlanGroups(loc, planLibrary, breaks) {
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
    else allPlans.push({ bg: primaryBg, annotations: loc.planAnnotations, breakId: null, planId: loc.planId || null, epIdx: null });
  }
  (loc.extraPlans || []).forEach((ep, i) => {
    if (ep.reportHidden) { collectHidden(ep.planId, ep.planAnnotations); return; }
    const epBg = ep.planBg || (ep.planId && lib.find(p => p.id === ep.planId)?.bg) || null;
    if (!epBg && !ep.planId && !ep.planAnnotations?.exported) return; // plan vide (ou mis sur une page à part)
    allPlans.push({ bg: epBg, annotations: ep.planAnnotations, breakId: `plan-${loc.id}_ep_${i}`, planId: ep.planId || null, epIdx: i });
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

// Retire du CORPS du rapport les plans mis sur une page à part (copie, données intactes).
export function stripFullPagePlans(locs, full) {
  if (!full || !Object.keys(full).length) return locs;
  const blank = (o) => ({ ...o, planId: null, planBg: null, planAnnotations: null });
  return locs.map(loc => {
    let l = loc;
    if (full[`z:${loc.id}`]) l = { ...l, planId: null, planBg: null, planAnnotations: null };
    if ((loc.extraPlans || []).some((_, i) => full[`z:${loc.id}:${i}`]))
      l = { ...l, extraPlans: loc.extraPlans.map((ep, i) => full[`z:${loc.id}:${i}`] ? blank(ep) : ep) };
    const items = loc.items || [];
    if (items.some(it => (it.plans || []).some((_, k) => full[`i:${it.id}:${k}`])))
      l = { ...l, items: items.map(it => (it.plans || []).some((_, k) => full[`i:${it.id}:${k}`])
        ? { ...it, plans: it.plans.map((pl, k) => full[`i:${it.id}:${k}`] ? { ...pl, planAnnotations: null } : pl) } : it) };
    return l;
  });
}

// Rangées de photos d'une observation, DANS L'ORDRE de la liste (lecture gauche → droite, haut → bas) :
//   • 2 portraits qui se suivent → côte à côte ;
//   • 1 portrait isolé → MOSAÏQUE avec les paysages qui le JOUXTENT : ceux qui le suivent (portrait
//     à gauche) ou, s'il arrive après une rangée incomplète de paysages, ceux qui le précèdent
//     (portrait à droite) → zéro blanc sans jamais changer l'ordre ;
//   • paysages → rangées de `cols`.
// isPortrait[i] = la photo i est en portrait. Renvoie des rangées { kind, idxs | portraitIdx+stackIdxs+side }.
// Rangée « mixte » : photos côte à côte à la MÊME hauteur, chacune dans son format (ars = ratios l/h).
function mixed(idxs, isPortrait) {
  return { kind:'mixed', idxs, ars: idxs.map(k => (isPortrait[k] ? 3 / 4 : 4 / 3)) };
}

// Comme packPhotoRows, mais une photo « en grand » occupe SA rangée, seule et pleine largeur ;
// les autres gardent l'ordre et la mise en page habituels avant et après elle.
// RÉGLAGE « PHOTOS SUR LA LIGNE » LIÉ À L'ORDRE DES PHOTOS (retour Thomas 27/11 : un réglage
// fait avant d'ajouter / retirer / déplacer des photos laissait une mise en page bizarre, ex. un
// portrait seul alors que les deux portraits auraient dû être côte à côte). La clé du réglage
// embarque une EMPREINTE de la liste des photos de l'observation (`<photo>~<empreinte>`) : dès
// que les photos changent (ajout, suppression, déplacement, ordre), l'empreinte ne correspond
// plus → le réglage est ignoré, la mise en page redevient automatique. Les clés SANS empreinte
// (réglages antérieurs) restent valables tant qu'on ne les modifie pas.
export function photoListSig(keys) {
  let h = 5381;
  const s = (keys || []).map(k => k || '?').join('|');
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
export const rowColsKey = (photoK, sig) => `${photoK}~${sig}`;
// Réglage actif (1-3) pour chaque photo de `keys` (0 = automatique).
export function activeRowCols(rowCols, keys) {
  const rc = rowCols || {};
  const sig = photoListSig(keys);
  return keys.map(k => (k ? (rc[rowColsKey(k, sig)] || rc[k] || 0) : 0));
}
// Nouveau rowCols après un clic : retire tout réglage existant de cette photo et les réglages
// périmés (empreinte d'une ancienne liste), puis pose le nouveau (n = null → automatique).
export function setRowColsFor(rowCols, keys, photoK, n) {
  const sig = photoListSig(keys);
  const next = {};
  for (const [k, v] of Object.entries(rowCols || {})) {
    const [pk, ks] = k.split('~');
    if (pk === photoK) continue;
    if (ks !== undefined && ks !== sig) continue;
    next[k] = v;
  }
  if (n) next[rowColsKey(photoK, sig)] = n;
  return next;
}

export function packPhotoRowsBig(isPortrait, isBig, cols, rowCols = []) {
  // isBig[i] : 0 = normale, sinon largeur de la photo « en grand » (0.5 / 0.75 / 1, centrée).
  // rowCols[i] : nb de photos (1-3) imposé à la LIGNE qui commence par la photo i (retour Thomas
  // 24/11 : « le 1/2/3 par ligne, pas pour toute l'observation »).
  if (!isBig?.some(Boolean) && !rowCols?.some(Boolean)) return packPhotoRows(isPortrait, cols);
  const rows = [];
  const shift = (r, o) => ({ ...r,
    ...(r.idxs ? { idxs: r.idxs.map(i => i + o) } : {}),
    ...(r.portraitIdx != null ? { portraitIdx: r.portraitIdx + o } : {}),
    ...(r.stackIdxs ? { stackIdxs: r.stackIdxs.map(i => i + o) } : {}) });
  const n = isPortrait.length;
  let start = 0, i = 0;
  const flushSeg = (end) => { if (end > start) for (const r of packPhotoRows(isPortrait.slice(start, end), cols)) rows.push(shift(r, start)); };
  while (i < n) {
    if (isBig[i]) {
      flushSeg(i);
      rows.push({ kind:'big', idxs:[i], portrait: !!isPortrait[i], w: isBig[i] === true ? 1 : isBig[i] });
      i++; start = i; continue;
    }
    if (rowCols[i]) {
      flushSeg(i);
      const idxs = [i];
      for (let k = i + 1; k < n && idxs.length < rowCols[i] && !isBig[k] && !rowCols[k]; k++) idxs.push(k);
      rows.push({ kind:'custom', idxs, cols: rowCols[i], portrait: idxs.every(k => isPortrait[k]) });
      i += idxs.length; start = i; continue;
    }
    i++;
  }
  flushSeg(n);
  return rows;
}

export function packPhotoRows(isPortrait, cols) {
  const n = isPortrait.length;
  const c = Math.max(1, cols || 2);
  const rows = [];
  let i = 0;
  while (i < n) {
    if (isPortrait[i]) {
      if (i + 1 < n && isPortrait[i + 1]) { rows.push({ kind:'portraits', idxs:[i, i + 1] }); i += 2; continue; }
      const stack = [];
      for (let k = i + 1; k < n && stack.length < 2 && !isPortrait[k]; k++) stack.push(k);
      // Un seul paysage à côté : rangée MIXTE (même hauteur, chacun dans son format) au lieu d'une
      // mosaïque qui laissait un trou sous le paysage (retour Thomas 23/11).
      if (stack.length === 1) { rows.push(mixed([i, stack[0]], isPortrait)); i += 2; }
      else if (stack.length) { rows.push({ kind:'mosaic', portraitIdx:i, stackIdxs:stack, side:'left' }); i += 1 + stack.length; }
      else { rows.push({ kind:'portraits', idxs:[i] }); i += 1; }
      continue;
    }
    // Suite de paysages [i, j)
    let j = i;
    while (j < n && !isPortrait[j]) j++;
    const run = j - i;
    const rem = run % c;
    const full = run - rem;
    for (let s = 0; s < full; s += c) rows.push({ kind:'landscape', idxs: Array.from({ length: c }, (_, k) => i + s + k) });
    const restStart = i + full;
    // Reste (1 ou 2 paysages) suivi d'un portrait ISOLÉ → mosaïque portrait à droite.
    const nextIsLonePortrait = j < n && isPortrait[j] && !(j + 1 < n && isPortrait[j + 1]);
    if (rem === 1 && nextIsLonePortrait) { rows.push(mixed([restStart, j], isPortrait)); i = j + 1; continue; }
    if (rem > 0 && rem <= 2 && nextIsLonePortrait) {
      rows.push({ kind:'mosaic', portraitIdx:j, stackIdxs: Array.from({ length: rem }, (_, k) => restStart + k), side:'right' });
      i = j + 1;
      continue;
    }
    if (rem > 0) rows.push({ kind:'landscape', idxs: Array.from({ length: rem }, (_, k) => restStart + k) });
    i = j;
  }
  return rows;
}
