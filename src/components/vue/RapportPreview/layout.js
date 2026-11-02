// Aperçu du rapport — dimensions de page A4 et pagination (découpage des observations en blocs).
// Extrait tel quel de RapportPreview.jsx (découpage du 02/11/2026, aucun changement de logique).
import { isBrouillon } from '../../../lib/constants.js';
import { stripMarkup } from '../../../lib/markup.jsx';
import { childrenOf, effectiveParentId } from '../../../lib/zoneGroups.js';

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
export const CHUNK_CHARS = 2500; // max chars per text chunk — only split genuinely long texts

// Découpe un long commentaire en morceaux aux limites de paragraphes
export function splitComment(comment, maxChars = CHUNK_CHARS) {
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
  const txt  = block.textContent ?? item.commentaire ?? '';
  let h = mode === 'cont' ? 20 : 52;
  if (mode !== 'photos' && txt) h += Math.ceil(txt.length / 65) * 16;
  if (mode !== 'text' && mode !== 'cont') {
    // Blocs-rangée (photoRow) : hauteur d'UNE rangée selon le layout (paysage 4:3,
    // portraits/mosaïque ≈ hauteur d'un 3:4). Sinon estimation classique multi-rangées.
    const row = block.photoRow;
    if (row) {
      const cols  = Math.min(ppl, 3);
      const cellW = (CW - 12 - (cols - 1) * 3) / cols;
      h += (row.kind === 'landscape' ? cellW * 0.75 : ((CW - 12) / 2) * (4 / 3)) + 14;
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
              textContent:text, vpPhotoOffset:photoOffset, vxxPhotoMap });
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

      // Photos : une rangée = un bloc. PACKING anti-blancs (validé avec l'utilisateur) :
      //   • 2 portraits → côte à côte (3:4, pleine largeur, zéro blanc) ;
      //   • 1 portrait restant → MOSAÏQUE : portrait + jusqu'à 2 paysages empilés à côté
      //     (un portrait ≈ la hauteur de 2 paysages) — les paysages sont « remontés » depuis
      //     la liste (réorganisation d'affichage autorisée) ; s'il n'y en a qu'un, il se met
      //     en haut et le bas reste vide ;
      //   • paysages restants → rangées standards de `cols`, dernière éventuellement partielle
      //     (taille standard conservée).
      // Les rangées sont triées par le plus petit index de photo qu'elles contiennent pour
      // rester proches de l'ordre du récit. Chaque cellule garde l'index ORIGINAL de sa photo
      // (badges Vxx et recadrage intacts).
      if (photos.length > 0) {
        const portraits = [], landscapes = [];
        photos.forEach((ph, i) => ((ph?.orient === 'portrait') ? portraits : landscapes).push(i));
        const rows = [];
        let p = 0;
        while (portraits.length - p >= 2) { rows.push({ kind:'portraits', idxs:[portraits[p], portraits[p+1]] }); p += 2; }
        if (portraits.length - p === 1) {
          const stack = landscapes.splice(0, 2);
          if (stack.length) rows.push({ kind:'mosaic', portraitIdx: portraits[p], stackIdxs: stack });
          else rows.push({ kind:'portraits', idxs:[portraits[p]] });
        }
        for (let s = 0; s < landscapes.length; s += cols) rows.push({ kind:'landscape', idxs: landscapes.slice(s, s + cols) });
        const minIdx = r => r.kind === 'mosaic' ? Math.min(r.portraitIdx, ...r.stackIdxs) : Math.min(...r.idxs);
        rows.sort((a, b) => minIdx(a) - minIdx(b));
        rows.forEach((row, k) => {
          blocks.push({
            type:'item',
            id: k === 0 ? `${item.id}_ph` : `${item.id}_ph${k}`,
            item, locId:loc.id, mode:'photos',
            photoRow: row, photoCols: cols,
            isLastPhotoRow: k === rows.length - 1,
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
// Ne coupe que sur les sauts forcés (scissors) — jamais automatiquement.
export function buildPages(allBlocks, ppl, breaks, _heights) {
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
