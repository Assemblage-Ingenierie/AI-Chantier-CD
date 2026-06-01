import { ensureJsPDF } from './pdfUtils.js';
import { fetchPlanData, fetchPlanHdDataUrl } from './storage.js';
import { URGENCE, SUIVI } from './constants.js';
import { stripMarkup } from './markup.jsx';
import { getAllSymbols, drawAnnotationPaths, drawVP } from '../components/vue/Annotator.jsx';
import { getBrandingUrl } from './branding.js';
import { computeVpNumbering } from './vpNumbering.js';

/** Rend le plan bg + annotations sur un canvas en mémoire et retourne un dataURL PNG.
 *  Les annotations sont agrandies proportionnellement à la résolution de l'image
 *  pour rester lisibles une fois réduites à la taille A4. */
async function renderPlanImage(planBg, planAnnotations, annotScale = 1, planId = null, vpNumByPath = null) {
  if (planId) {
    const hd = await fetchPlanHdDataUrl(planId);
    if (hd) planBg = hd;
  }
  const exported = planAnnotations?.exported;
  const paths    = planAnnotations?.paths;
  if (!planBg) return exported ?? null;
  if (!paths?.length) return planBg;
  // Réécrit le label des marqueurs viewpoint selon la numérotation globale (zéro doublon).
  const drawPaths = vpNumByPath
    ? paths.map(p => {
        if (p.type !== 'viewpoint') return p;
        const n = vpNumByPath.get(p);
        return n != null ? { ...p, label: `V${n}` } : p;
      })
    : paths;
  return new Promise(resolve => {
    const img = new window.Image();
    img.onload = () => {
      const cv  = document.createElement('canvas');
      cv.width  = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const sizeScale = Math.max(0.5, cv.width / 1400) * annotScale;
      drawAnnotationPaths(ctx, drawPaths, sizeScale);
      resolve(cv.toDataURL('image/png'));
    };
    img.onerror = () => resolve(exported ?? planBg);
    img.src = planBg;
  });
}

/** Pré-rend l'icône de viewpoint (œil + cône) pour la légende PDF. */
async function preRenderViewpointIcon() {
  try {
    const cv = document.createElement('canvas');
    cv.width = 80; cv.height = 80;
    drawVP(cv.getContext('2d'), { x: 38, y: 55, angle: -Math.PI / 2, label: 'V1', size: 1, color: '#E30513' });
    return cv.toDataURL('image/png');
  } catch { return null; }
}

/** Pré-rend chaque symbole dans un canvas 80×80 (assez grand pour les textes sous le symbole). */
async function preRenderSymbolIcons(symbolIds) {
  const icons = {};
  for (const sym of getAllSymbols()) {
    if (!symbolIds.has(sym.id)) continue;
    try {
      const cv = document.createElement('canvas');
      cv.width = 80; cv.height = 80;
      const ctx = cv.getContext('2d');
      // Centre décalé vers le haut pour laisser de la place au texte en-dessous
      sym.draw(ctx, 40, 28, 2, '#E30513');
      icons[sym.id] = cv.toDataURL('image/png');
    } catch {}
  }
  return icons;
}

/** Ajoute la légende des symboles et viewpoints utilisés dans le plan ; retourne le nouveau y. */
function addPlanLegend(doc, annot, y, ML, CW, W, MR, RD, GR, symbolIcons = {}, vpIconUrl = null) {
  const paths = annot?.paths;
  if (!paths?.length) return y;
  const usedIds       = new Set(paths.filter(p => p.type === 'symbol').map(p => p.symbolId));
  const legendSy      = getAllSymbols().filter(s => usedIds.has(s.id));
  const hasViewpoints = paths.some(p => p.type === 'viewpoint');

  // Construire la liste unifiée symbol + viewpoint
  const items = [
    ...legendSy.map(s => ({ label: s.label, iconUrl: symbolIcons[s.id] ?? null })),
    ...(hasViewpoints ? [{ label: 'Vue photo', iconUrl: vpIconUrl }] : []),
  ];
  if (!items.length) return y;

  y += 3;

  // Grille : jusqu'à 4 colonnes
  const ICON_SZ = 8;
  const ROW_H   = ICON_SZ + 5;
  const COLS    = Math.min(items.length, Math.max(1, Math.floor(CW / 56)));
  const numRows = Math.ceil(items.length / COLS);
  const HDR_H   = 9;
  const totalH  = HDR_H + numRows * ROW_H + 6;

  // Boîte extérieure
  doc.setFillColor(249, 249, 249);
  doc.setDrawColor(...RD); doc.setLineWidth(0.4);
  doc.roundedRect(ML, y, CW, totalH, 2, 2, 'FD');

  // En-tête "LÉGENDE"
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...RD);
  doc.text('LÉGENDE', ML + 4, y + 6.2);
  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.15);
  doc.line(ML + 0.5, y + HDR_H, ML + CW - 0.5, y + HDR_H);

  // Items à l'intérieur
  const colWidth = CW / COLS;
  items.forEach(({ label, iconUrl }, ix) => {
    const col = ix % COLS;
    const row = Math.floor(ix / COLS);
    const lx  = ML + 3 + col * colWidth;
    const ly  = y + HDR_H + 3 + row * ROW_H;

    if (iconUrl) {
      try { doc.addImage(iconUrl, 'PNG', lx, ly, ICON_SZ, ICON_SZ, undefined, 'FAST'); } catch {}
    } else {
      doc.setFillColor(...RD); doc.rect(lx, ly + 3, 7, 5, 'F');
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    doc.setTextColor(50, 50, 50);
    doc.text(label, lx + ICON_SZ + 2, ly + ICON_SZ / 2 + 2);
  });
  doc.setTextColor(0, 0, 0);

  return y + totalH + 3;
}


// Analyse HTML/markdown en segments typés [{text, bold, italic, underline}]
// Détecte du HTML réel (balises ouvrantes/fermantes connues) OU des entités HTML.
// Tolère les attributs (<strong style="...">, <span class="...">) et les balises de bloc/liste.
function looksLikeHtml(text) {
  return /<\/?(strong|b|em|i|u|s|strike|del|br|div|p|ul|ol|li|span|h[1-6]|blockquote)\b[^>]*>/i.test(text)
    || /&(amp|lt|gt|nbsp|quot|apos|#\d+|#x[0-9a-f]+);/i.test(text);
}

// Parse du HTML riche en segments {text,bold,italic,underline} via le DOM.
// Le DOM décode automatiquement les entités (&amp;→&, &nbsp;→espace) et tolère
// les attributs/balises inconnues — plus aucune balise brute ne se retrouve dans le PDF.
function parseHtmlSegments(html) {
  const segs = [];
  const pushText = (t, b, it, u) => {
    if (!t) return;
    t.split('\n').forEach((line, i) => {
      if (i > 0) segs.push({ text: '\n', bold: false, italic: false, underline: false });
      if (line) segs.push({ text: line, bold: b, italic: it, underline: u });
    });
  };
  const nl = () => segs.push({ text: '\n', bold: false, italic: false, underline: false });
  const BLOCK = new Set(['div', 'p', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);
  // Rétrocompat : anciens commentaires dont les balises ont été encodées en entités
  // (&lt;div&gt;) — on les restaure en vraies balises avant de parser via le DOM.
  let prepared = html;
  if (prepared.includes('&lt;') || prepared.includes('&gt;')) {
    prepared = prepared.replace(/&lt;(\/?(?:div|p|br|ul|ol|li|strong|b|em|i|u|s|strike|del|span)(?:[^&]|&(?!gt;))*?)&gt;/gi, '<$1>');
  }
  const container = document.createElement('div');
  container.innerHTML = prepared;
  const walk = (node, b, it, u) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { // TEXT_NODE
        const txt = child.textContent.replace(/[ \t\r\n]+/g, ' ');
        if (txt) pushText(txt, b, it, u);
        continue;
      }
      if (child.nodeType !== 1) continue; // pas un élément
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') { nl(); continue; }
      const nb = b || tag === 'strong' || tag === 'b';
      const ni = it || tag === 'em' || tag === 'i';
      const nu = u || tag === 'u';
      const isBlock = BLOCK.has(tag);
      if (isBlock) nl();
      if (tag === 'li') pushText('• ', b, it, u);
      walk(child, nb, ni, nu);
      if (isBlock) nl();
    }
  };
  walk(container, false, false, false);
  // Nettoyer : retirer les sauts de ligne en tête/queue et fusionner les runs (max 1 ligne vide)
  while (segs.length && segs[0].text === '\n') segs.shift();
  while (segs.length && segs[segs.length - 1].text === '\n') segs.pop();
  const out = [];
  let nlRun = 0;
  for (const s of segs) {
    if (s.text === '\n') { nlRun++; if (nlRun > 2) continue; }
    else nlRun = 0;
    out.push(s);
  }
  return out;
}

function parseSegments(text) {
  if (!text) return [];
  if (looksLikeHtml(text)) {
    try { return parseHtmlSegments(text); } catch { /* fallback ci-dessous */ }
  }
  const segs = [];
  const push = (t, b, it, u) => {
    t.split('\n').forEach((line, i) => {
      if (i > 0) segs.push({ text: '\n', bold: b, italic: it, underline: u });
      if (line) segs.push({ text: line, bold: b, italic: it, underline: u });
    });
  };
  const MD = /(\*\*[^*\n]+\*\*|__[^_\n]+__|_[^_\n]+_|\*[^*\n]+\*)/g;
  let last = 0, m;
  while ((m = MD.exec(text)) !== null) {
    if (m.index > last) push(text.slice(last, m.index), false, false, false);
    const s = m[0];
    if (s.startsWith('**')) push(s.slice(2, -2), true, false, false);
    else if (s.startsWith('__')) push(s.slice(2, -2), false, false, true);
    else push(s.slice(1, -1), false, true, false);
    last = m.index + s.length;
  }
  if (last < text.length) push(text.slice(last), false, false, false);
  return segs;
}

// Rendu texte riche jsPDF avec bold/italic/underline inline + word-wrap
// measureOnly=true → retourne juste le nombre de lignes sans dessiner
function jsPdfRichText(doc, rawText, x, y, maxW, fontSize, lineH, rgbColor, measureOnly) {
  doc.setFontSize(fontSize);
  const text = (rawText || '').replace(/—/g, ' - ');
  const segs = parseSegments(text);
  if (!segs.length) return 0;

  // Tokeniser en mots
  const tokens = [];
  for (const seg of segs) {
    if (seg.text === '\n') { tokens.push({ br: true }); continue; }
    seg.text.split(' ').forEach((w, i) => {
      if (i > 0) tokens.push({ sp: true });
      if (w) tokens.push({ w, bold: seg.bold, italic: seg.italic, underline: seg.underline });
    });
  }

  // Mesurer chaque token
  doc.setFont('helvetica', 'normal');
  const spW = doc.getTextWidth(' ');
  const measured = tokens.map(t => {
    if (t.br || t.sp) return t;
    const font = t.bold ? (t.italic ? 'bolditalic' : 'bold') : t.italic ? 'italic' : 'normal';
    doc.setFont('helvetica', font);
    return { ...t, width: doc.getTextWidth(t.w) };
  });
  doc.setFont('helvetica', 'normal');

  // Construire les lignes
  const lines = [[]];
  let lw = 0;
  for (const t of measured) {
    if (t.br) { lines.push([]); lw = 0; continue; }
    if (t.sp) {
      if (lw > 0) { lines[lines.length - 1].push({ sp: true, width: spW }); lw += spW; }
      continue;
    }
    if (lw + t.width > maxW && lw > 0) {
      const cur = lines[lines.length - 1];
      if (cur.length && cur[cur.length - 1].sp) cur.pop();
      lines.push([]); lw = 0;
    }
    lines[lines.length - 1].push(t);
    lw += t.width;
  }
  const last = lines[lines.length - 1];
  if (last.length && last[last.length - 1].sp) last.pop();

  if (measureOnly) { doc.setFont('helvetica', 'normal'); return lines.length; }

  // Dessiner
  let cy = y;
  for (const line of lines) {
    let cx = x;
    for (const tok of line) {
      if (tok.sp) { cx += tok.width; continue; }
      const font = tok.bold ? (tok.italic ? 'bolditalic' : 'bold') : tok.italic ? 'italic' : 'normal';
      doc.setFont('helvetica', font);
      doc.setTextColor(...rgbColor);
      doc.text(tok.w, cx, cy);
      if (tok.underline) {
        doc.setDrawColor(...rgbColor); doc.setLineWidth(0.15);
        doc.line(cx, cy + 0.8, cx + tok.width, cy + 0.8);
      }
      cx += tok.width;
    }
    cy += lineH;
  }
  doc.setFont('helvetica', 'normal'); doc.setTextColor(0, 0, 0);
  return lines.length;
}

/**
 * Génère et télécharge le rapport PDF A4 du compte-rendu de visite.
 * @param {{ projet, localisations, tableauRecap, photosParLigne }} opts
 */
export async function exportPdf({ projet, localisations, photosParLigne = 2, rapportPageBreaks = [], plansEnFin = false, includeTableauRecap = true, tableauRecap = [], includeConclusion = false, conclusion = '', conclusionAlign = 'left', annotScale = 1 }) {
  await ensureJsPDF();
  const { jsPDF } = window.jspdf;

  // Charger le logo Assemblage Ingénierie en base64 (depuis le bucket Supabase branding)
  let logoDataUrl = null;
  try {
    const logoUrl = await getBrandingUrl('logo/logo_Ai_rouge.png');
    const resp = await fetch(logoUrl);
    if (resp.ok) {
      const blob = await resp.blob();
      logoDataUrl = await new Promise(res => {
        const r = new FileReader();
        r.onloadend = () => res(r.result);
        r.readAsDataURL(blob);
      });
    }
  } catch {}

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297, ML = 18, MR = 18, CW = W - ML - MR;

  // Palette
  const BK = [34, 34, 34], RD = [227, 5, 19];
  const GR = [105, 114, 125], LG = [249, 249, 249], WH = [255, 255, 255];
  const AM = [217, 119, 6], GN = [22, 163, 74];

  // Numérotation Vxx globale (badges photos + labels marqueurs) — calculée AVANT le pré-rendu
  // des plans pour réécrire les labels des marqueurs. Logique partagée avec l'aperçu écran.
  const { vxxPhotoMap: vxxPhotoMapPdf, vpNumByPath: vpNumByPathPdf } = computeVpNumbering(localisations);

  // Pré-rendu des plans (principal + supplémentaires) — tous rendus, annotés ou non
  const planImages = {};
  for (const loc of localisations) {
    const bg = loc.planBg || (projet.planLibrary || []).find(p => p.id === loc.planId)?.bg || null;
    const img = await renderPlanImage(bg, loc.planAnnotations, annotScale, loc.planId || null, vpNumByPathPdf);
    if (img) planImages[loc.id] = img;
  }

  const extraPlanImages = {}; // clé: `${locId}_${planIdx}`
  for (const loc of localisations) {
    for (let i = 0; i < (loc.extraPlans || []).length; i++) {
      const ep = loc.extraPlans[i];
      let bg = ep.planBg || (projet.planLibrary || []).find(p => p.id === ep.planId)?.bg || null;
      if (!bg && ep.planId) {
        const fetched = await fetchPlanData(ep.planId);
        if (fetched?.bg) bg = fetched.bg;
      }
      if (!bg && !ep.planId) continue;
      const img = await renderPlanImage(bg, ep.planAnnotations, annotScale, ep.planId || null, vpNumByPathPdf);
      if (img) extraPlanImages[`${loc.id}_${i}`] = img;
    }
  }

  // Pré-rendu des plans additionnels par item (uniquement si annotés)
  const itemPlanImages = {}; // clé: `${itemId}_${planIdx}`
  for (const loc of localisations) {
    for (const item of (loc.items || [])) {
      for (let i = 0; i < (item.plans || []).length; i++) {
        const pl = item.plans[i];
        if (!pl.planAnnotations?.paths?.length) continue;
        const bg = pl.planBg || (projet.planLibrary || []).find(p => p.id === pl.planId)?.bg || null;
        const img = await renderPlanImage(bg, pl.planAnnotations, annotScale, pl.planId || null, vpNumByPathPdf);
        if (img) itemPlanImages[`${item.id}_${i}`] = img;
      }
    }
  }

  // Pré-rendu des icônes de symboles et viewpoint pour les légendes
  const allSymbolIds = new Set();
  localisations.forEach(loc =>
    (loc.planAnnotations?.paths || []).filter(p => p.type === 'symbol').forEach(p => allSymbolIds.add(p.symbolId))
  );
  const symbolIcons = await preRenderSymbolIcons(allSymbolIds);
  const vpIconUrl   = await preRenderViewpointIcon();

  const pageBreaksSet = new Set(rapportPageBreaks);
  const dvPdf = projet.dateVisite ? new Date(projet.dateVisite) : new Date();
  const today = dvPdf.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  // ── Fonctions utilitaires ────────────────────────────────────────────────────

  const hdr = () => {
    // Header sombre — identique à la preview (HdrBar dark)
    doc.setFillColor(...BK); doc.rect(0, 0, W, 10, 'F');
    doc.setFillColor(...RD); doc.rect(0, 0, 2.5, 10, 'F');
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, 'PNG', ML + 2, 1.5, 28, 7, undefined, 'FAST'); } catch {}
    } else {
      doc.setTextColor(...WH); doc.setFontSize(6); doc.setFont('helvetica', 'bold');
      doc.text('Assemblage Ingénierie', ML + 4, 6.5);
    }
    doc.setTextColor(180, 180, 180); doc.setFontSize(6); doc.setFont('helvetica', 'normal');
    doc.text(`${projet.nom} · ${today}`, W - MR, 6.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  };

  const ftr = (n, t) => {
    doc.setFillColor(...LG); doc.rect(0, H - 8, W, 8, 'F');
    doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.15); doc.line(0, H - 8, W, H - 8);
    doc.setFontSize(5); doc.setFont('helvetica', 'normal'); doc.setTextColor(195, 195, 195);
    doc.text("Assemblage Ingénierie · S.A.S. capital social 1 000€ · 137 rue d'Aboukir, 75002 Paris · contact@assemblage.net · www.assemblage.net · +33 7 65 62 30 87", W / 2, H - 5, { align: 'center' });
    doc.text('NAF 7112B · R.C.S. Paris 822 130 100 · Siret 822 130 100 0032 · n°TVA FR 24 822 130 100', W / 2, H - 1.8, { align: 'center' });
    doc.setFontSize(6.5); doc.setTextColor(...GR);
    doc.text(`${n} / ${t}`, W - MR, H - 2.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  };

  let y = 18;
  const pb = (n) => {
    if (y + n > H - 13) { doc.addPage(); y = 18; hdr(); return true; }
    return false;
  };

  // ── PAGE DE GARDE (photo/titre + présentation + intervenants) ───────────────

  const DARK_H = 85; // mm — hauteur de la partie sombre

  doc.setFillColor(...BK); doc.rect(0, 0, W, DARK_H, 'F');
  doc.setFillColor(...RD); doc.rect(0, 0, 4, DARK_H, 'F');

  const coverPhoto = projet.photoCouverture || projet.photo;
  if (coverPhoto) {
    try {
      const ext = coverPhoto.startsWith('data:image/webp') ? 'WEBP' : coverPhoto.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(coverPhoto, ext, 0, 0, W, DARK_H, undefined, 'FAST');
      try {
        doc.setFillColor(...BK);
        doc.setGState(doc.GState({ opacity: 0.55 }));
        doc.rect(0, 0, W, DARK_H, 'F');
        doc.setGState(doc.GState({ opacity: 1 }));
      } catch {}
    } catch {}
  }
  doc.setFillColor(...RD); doc.rect(0, 0, 4, DARK_H, 'F');

  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', W - MR - 50, 10, 46, 13, undefined, 'FAST'); } catch {}
  } else {
    doc.setTextColor(227, 5, 19); doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(8);
    doc.text('Assemblage Ingénierie', W - MR, 18, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }

  doc.setTextColor(...WH); doc.setFontSize(6.5); doc.setFont('helvetica', 'normal');
  doc.text('COMPTE-RENDU DE VISITE', ML + 6, 22);
  doc.setFontSize(22); doc.setFont('helvetica', 'bold');
  const tlines = doc.splitTextToSize(projet.nom, W - ML - 30);
  doc.text(tlines, ML + 6, 34);
  const afterT = 34 + tlines.length * 10;
  // Nom de visite — barre accent rouge + texte blanc + date
  if (projet.visiteNom) {
    const vY = afterT + 2;
    doc.setFillColor(...RD); doc.rect(ML + 6, vY, 2.5, 14, 'F');
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(...WH);
    doc.text(projet.visiteNom, ML + 11, vY + 7.5);
    if (projet.dateVisite) {
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(200, 200, 200);
      doc.text(`Visite du ${today}`, ML + 11, vY + 13.5);
    }
  } else if (projet.adresse) {
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(200, 200, 200);
    doc.text(projet.adresse, ML + 6, afterT + 4);
  }
  doc.setTextColor(0, 0, 0);

  // ── Partie blanche : présentation + intervenants ─────────────────────────

  const participants = projet.participants || [];
  const infoRows = [
    projet.adresse       && ['Adresse',         projet.adresse],
    projet.dateVisite    && ['Date de visite',   today],
    projet.maitreOuvrage && ["Maître d'ouvrage", projet.maitreOuvrage],
  ].filter(Boolean);

  let py = DARK_H + 10;

  if (infoRows.length > 0) {
    doc.setFillColor(...RD); doc.roundedRect(ML, py + 0.5, 1, 5, 0.3, 0.3, 'F');
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
    doc.text('PRÉSENTATION DU PROJET', ML + 4, py + 4.3);
    doc.setTextColor(0, 0, 0); py += 9;

    doc.setFillColor(...LG); doc.setDrawColor(...BK); doc.setLineWidth(0.15);
    doc.roundedRect(ML, py, CW, infoRows.length * 8 + 4, 2, 2, 'FD');
    infoRows.forEach(([k, v], ri) => {
      const ry = py + 6 + ri * 8;
      doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GR);
      doc.text(k, ML + 4, ry);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(0, 0, 0);
      doc.text(doc.splitTextToSize(v, CW - 50)[0], ML + 42, ry);
    });
    py += infoRows.length * 8 + 12;
  }

  if (participants.length > 0) {
    doc.setFillColor(...RD); doc.roundedRect(ML, py + 0.5, 1, 5, 0.3, 0.3, 'F');
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
    doc.text(`INTERVENANTS (${participants.length})`, ML + 4, py + 4.3);
    doc.setTextColor(0, 0, 0); py += 9;

    // Colonnes bien cadrées dans CW
    const cNom   = ML + 8;
    const cTel   = ML + 80;
    const cEmail = ML + 122;
    const cPres  = ML + CW - 2; // bord droit de la badge présence
    const wNom   = 68, wTel = 38, wEmail = 46;
    doc.setFillColor(40, 40, 40); doc.roundedRect(ML, py, CW, 7, 1, 1, 'F');
    doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...WH);
    doc.text('NOM / POSTE', cNom, py + 5);
    doc.text('TEL.', cTel, py + 5);
    doc.text('EMAIL', cEmail, py + 5);
    doc.text('PRÉSENCE', cPres, py + 5, { align: 'right' });
    doc.setTextColor(0, 0, 0); py += 8;

    participants.forEach((pt, i) => {
      const isPresent = !pt.presence || pt.presence === 'present';
      const rowH = pt.poste ? 13 : 8;
      const bg = i % 2 === 0 ? 249 : 255;
      doc.setFillColor(bg, bg, bg); doc.rect(ML, py, CW, rowH, 'F');
      doc.setDrawColor(228, 228, 228); doc.setLineWidth(0.1); doc.rect(ML, py, CW, rowH);
      if (pt.isAssemblage) {
        doc.setFillColor(...RD); doc.roundedRect(ML + 1.5, py + rowH / 2 - 2.5, 6, 5, 1, 1, 'F');
        doc.setFontSize(5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...WH);
        doc.text('A!', ML + 4.5, py + rowH / 2 + 0.5, { align: 'center' });
        doc.setTextColor(0, 0, 0);
      }
      const nameY = pt.poste ? py + 5 : py + rowH / 2 + 2;
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
      doc.text(doc.splitTextToSize(pt.nom || '', wNom)[0], cNom, nameY);
      if (pt.poste) {
        doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GR);
        doc.text(doc.splitTextToSize(pt.poste || '', wNom)[0], cNom, py + 9.5);
      }
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80);
      doc.text(doc.splitTextToSize(pt.tel || '-', wTel)[0], cTel, py + rowH / 2 + 2);
      doc.setFontSize(6.5);
      doc.text(doc.splitTextToSize(pt.email || '-', wEmail)[0], cEmail, py + rowH / 2 + 2);
      const presLabel = isPresent ? 'Présent' : 'Absent';
      const presColor = isPresent ? GN : RD;
      const presW = Math.min(doc.getTextWidth(presLabel) + 6, 22);
      doc.setFillColor(...(isPresent ? [220, 252, 231] : [254, 226, 226]));
      doc.roundedRect(cPres - presW, py + rowH / 2 - 2.5, presW, 5, 1, 1, 'F');
      doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...presColor);
      doc.text(presLabel, cPres - presW / 2, py + rowH / 2 + 1, { align: 'center' });
      doc.setTextColor(0, 0, 0);
      py += rowH + 1;
    });
  }

  // ── OBSERVATIONS ─────────────────────────────────────────────────────────────

  doc.addPage(); y = 18; hdr();

  // Helper hex→RGB
  const hx = c => [parseInt(c.slice(1,3),16), parseInt(c.slice(3,5),16), parseInt(c.slice(5,7),16)];

  // Entête de zone — bandeau noir + barre rouge fine (identique preview ZoneHeader)
  const secHdr = (label) => {
    doc.setFillColor(...BK); doc.roundedRect(ML, y, CW, 8.5, 1, 1, 'F');
    // Barre rouge fine : 1mm × 5.5mm centrée (preview: width:3px=1mm, height:16px=5.3mm)
    doc.setFillColor(...RD); doc.roundedRect(ML + 3, y + 1.5, 1, 5.5, 0.3, 0.3, 'F');
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...WH);
    doc.text(label.toUpperCase(), ML + 7, y + 5.6);
    doc.setTextColor(0, 0, 0); y += 10;
  };

  const renderItems = (items, vxxPhotoMap = null, locId = null) => {
    const TX   = ML + 4;
    const TW   = CW - 20;
    const GRAY = [245, 245, 245];
    const BDR  = [228, 228, 228];
    const tLH  = 4.2, cLH = 4.2;
    let photoOff = 0;

    items.forEach(item => {
      if (pageBreaksSet.has(item.id)) { doc.addPage(); y = 18; hdr(); }

      const urgU     = URGENCE[item.urgence] || URGENCE.basse;
      const urgColor = hx(urgU.dot);
      const urgBgRgb = hx(urgU.bg);
      const urgBdRgb = hx(urgU.border);
      const urgLabel = urgU.label;
      const suiviU   = item.suivi && item.suivi !== 'rien' ? SUIVI[item.suivi] : null;

      const rawTitle = (item.titre || '-').replace(/—/g, ' - ');

      doc.setFontSize(8); doc.setFont('helvetica', 'bold');
      const titleLines = doc.splitTextToSize(rawTitle, TW - 2);

      // Mesure commentaire
      const richLines = item.commentaire
        ? jsPdfRichText(doc, item.commentaire, TX, 0, TW, 7.5, cLH, [51, 51, 51], true)
        : 0;

      // Dimensions photos
      const cols    = Math.max(1, Math.min(photosParLigne, 3));
      const validPh = (item.photos || []).filter(p => p.data);
      const maxPh   = cols <= 2 ? 4 : 6;
      const showPh  = validPh.slice(0, maxPh);
      const phW     = (CW - 6 - (cols - 1) * 2) / cols;
      const phH_    = phW * 0.75;
      const phRows  = showPh.length ? Math.ceil(showPh.length / cols) : 0;
      const phtH    = phRows > 0 ? phRows * (phH_ + 2) + 6 : 0;

      // Hauteur card header gris: padding(2) + titre + gap(2) + badge row(4) + padding(2)
      const cardHdrH = 2 + titleLines.length * tLH + 2 + 4 + 2;
      // Hauteur body commentaire
      const txtH     = richLines > 0 ? 2 + richLines * cLH + 3 : 0;
      const totalCardH = cardHdrH + txtH + 1;

      // Saut de page : au moins le header de la carte doit tenir
      pb(Math.min(cardHdrH + 16, H - 18 - 13));

      const cardDrawH = Math.min(totalCardH, H - 13 - y);

      // ── Dessin carte : border arrondie blanche ────────────────────────────────
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...BDR); doc.setLineWidth(0.15);
      doc.roundedRect(ML, y, CW, cardDrawH, 1.3, 1.3, 'FD');

      // Header gris (rectangle inset pour ne pas couvrir les coins arrondis)
      const grayH = Math.min(cardHdrH, cardDrawH - 0.3);
      doc.setFillColor(...GRAY);
      doc.rect(ML + 0.15, y + 0.15, CW - 0.3, grayH - 0.15, 'F');
      // Re-dessine la bordure sur le dessus du gris (pour restaurer les coins arrondis)
      doc.setDrawColor(...BDR); doc.setLineWidth(0.15);
      doc.roundedRect(ML, y, CW, cardDrawH, 1.3, 1.3, 'D');

      let cy = y + 2;

      // ── Titre (gras) ─────────────────────────────────────────────────────────
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20);
      doc.text(titleLines, TX, cy + 3.2);
      cy += titleLines.length * tLH + 2;

      // ── Badges GAUCHE : dot + urgence + suivi (identique preview) ────────────
      doc.setFontSize(6); doc.setFont('helvetica', 'bold');
      // Dot cercle coloré
      doc.setFillColor(...urgColor);
      doc.circle(TX + 1, cy + 2, 1, 'F');
      // Badge urgence
      const urgBadgeW = doc.getTextWidth(urgLabel) + 6;
      const badgeY    = cy + 0.3;
      doc.setFillColor(...urgBgRgb); doc.setDrawColor(...urgBdRgb); doc.setLineWidth(0.18);
      doc.roundedRect(TX + 4, badgeY, urgBadgeW, 3.5, 0.8, 0.8, 'FD');
      doc.setTextColor(...hx(urgU.text));
      doc.text(urgLabel, TX + 4 + urgBadgeW / 2, badgeY + 2.6, { align: 'center' });
      let nextBadgeX = TX + 4 + urgBadgeW + 3;

      // Badge suivi (si présent)
      if (suiviU) {
        const svBgRgb = hx(suiviU.bg), svBdRgb = hx(suiviU.border), svTxRgb = hx(suiviU.text);
        const sBadgeW = doc.getTextWidth(suiviU.label) + 6;
        doc.setFillColor(...svBgRgb); doc.setDrawColor(...svBdRgb); doc.setLineWidth(0.18);
        doc.roundedRect(nextBadgeX, badgeY, sBadgeW, 3.5, 0.8, 0.8, 'FD');
        doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...svTxRgb);
        doc.text(suiviU.label, nextBadgeX + sBadgeW / 2, badgeY + 2.6, { align: 'center' });
      }
      cy += 6; // badge row (4mm) + bottom padding (2mm) = fin du header gris

      // Séparateur header / body (si commentaire)
      if (txtH > 0) {
        doc.setDrawColor(...BDR); doc.setLineWidth(0.15);
        doc.line(ML + 0.15, cy, ML + CW - 0.15, cy);
        cy += 2;
      }

      // ── Commentaire rich text ──────────────────────────────────────────────────
      if (item.commentaire) {
        const n = jsPdfRichText(doc, item.commentaire, TX, cy + 3.2, TW, 7.5, cLH, [51, 51, 51]);
        cy += n * cLH + 4;
      }

      y = cy + 3;

      // ── Photos (carte séparée) ────────────────────────────────────────────────
      if (showPh.length) {
        if (y + phtH > H - 13) { doc.addPage(); y = 18; hdr(); }
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...BDR); doc.setLineWidth(0.15);
        doc.roundedRect(ML, y, CW, phtH + 1, 1.3, 1.3, 'FD');

        let validInItem = 0;
        showPh.forEach((p, pi) => {
          const px  = ML + 3 + (pi % cols) * (phW + 2);
          const py2 = y + 3 + Math.floor(pi / cols) * (phH_ + 2);
          try { doc.addImage(p.data, p.data.startsWith('data:image/png') ? 'PNG' : 'JPEG', px, py2, phW, phH_, undefined, 'FAST'); } catch {}
          doc.setDrawColor(215, 215, 215); doc.setLineWidth(0.1); doc.rect(px, py2, phW, phH_);
          const vxxNum = vxxPhotoMap?.get(`${locId}_${photoOff + validInItem}`);
          if (vxxNum != null) {
            doc.setFillColor(255, 255, 255); doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.1);
            doc.roundedRect(px + 1, py2 + 1, 7, 3.5, 0.8, 0.8, 'FD');
            doc.setFontSize(5); doc.setFont('helvetica', 'bold'); doc.setTextColor(50, 50, 50);
            doc.text(`V${vxxNum}`, px + 4.5, py2 + 3.5, { align: 'center' });
            doc.setTextColor(0, 0, 0);
          }
          validInItem++;
        });
        photoOff += validInItem;
        y += phtH + 4;
      }

      // ── Plans additionnels annotés ────────────────────────────────────────────
      (item.plans || []).forEach((pl, pidx) => {
        const planImg = itemPlanImages[`${item.id}_${pidx}`];
        if (!planImg) return;
        const ih = CW * 0.5;
        pb(16 + ih);
        const libNom = (projet.planLibrary || []).find(p => p.id === pl.planId)?.nom;
        if (libNom) {
          doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GR);
          doc.text(libNom.toUpperCase(), ML, y + 4); y += 7;
        }
        const ext = planImg.startsWith('data:image/webp') ? 'WEBP' : planImg.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        try { doc.addImage(planImg, ext, ML, y, CW, ih, undefined, 'FAST'); } catch {}
        doc.setDrawColor(215, 215, 215); doc.setLineWidth(0.15); doc.rect(ML, y, CW, ih);
        y += ih + 4;
      });

      doc.setTextColor(0, 0, 0);
      y += 2; // espacement inter-items (preview marginBottom:5px=1.7mm)
    });
  };

  localisations.forEach(loc => {
    const items = loc.items || [];
    if (!items.length) return;
    // pb(50) : garantit entête zone + début premier item sur la même page
    if (pageBreaksSet.has(loc.id)) { doc.addPage(); y = 18; hdr(); } else { pb(50); }
    secHdr(loc.nom);
    renderItems(items, vxxPhotoMapPdf, loc.id);

    // Plans inline (si !plansEnFin) — principal + supplémentaires à la suite, une seule légende
    if (!plansEnFin) {
      const allZonePlans = [
        { img: planImages[loc.id], annotations: loc.planAnnotations, breakId: `plan-${loc.id}` },
        ...(loc.extraPlans || []).map((ep, idx) => ({ img: extraPlanImages[`${loc.id}_${idx}`], annotations: ep.planAnnotations, breakId: `plan-${loc.id}_ep_${idx}` })),
      ].filter(p => p.img);

      if (allZonePlans.length > 0) {
        const allAnnotPaths = allZonePlans.flatMap(p => p.annotations?.paths || []);
        const combinedAnnot = allAnnotPaths.length ? { paths: allAnnotPaths } : null;
        const hasLeg = allAnnotPaths.some(p => p.type === 'symbol') || allAnnotPaths.some(p => p.type === 'viewpoint');
        const ih = CW * 0.46; // ~80mm — 2 plans + légende tiennent sur une page A4
        const legH = hasLeg ? 30 : 8;

        pb(22 + ih);
        secHdr(`Plan — ${loc.nom}`);
        allZonePlans.forEach(({ img: planImg, breakId }, planI) => {
          const isLast = planI === allZonePlans.length - 1;
          // Saut de page forcé entre plans (via mode découpe)
          if (planI > 0 && pageBreaksSet.has(breakId)) {
            doc.addPage(); y = 18; hdr();
          } else {
            pb(ih + (isLast ? legH : 4));
          }
          try {
            const ext = planImg.startsWith('data:image/webp') ? 'WEBP' : planImg.startsWith('data:image/png') ? 'PNG' : 'JPEG';
            doc.addImage(planImg, ext, ML, y, CW, ih, undefined, 'FAST');
          } catch {}
          y += ih + 4;
        });
        y = addPlanLegend(doc, combinedAnnot, y, ML, CW, W, MR, RD, GR, symbolIcons, vpIconUrl);
        y += 2;
      }
    }

    y += 5;
  });

  // ── TABLEAU RÉCAPITULATIF ────────────────────────────────────────────────────

  if (includeTableauRecap) {
    const urgOrder = { haute: 0, moyenne: 1, basse: 2 };
    const ovMap = new Map((tableauRecap || []).map(r => [r.itemId, r]));
    const recapRows = localisations.flatMap(loc =>
      (loc.items || [])
        .filter(i => i.titre && i.suivi !== 'fait')
        .map(i => {
          const ov = ovMap.get(i.id) || {};
          return {
            locNom:  'zone'     in ov ? ov.zone     : (loc.nom   || ''),
            titre:   'titre'    in ov ? ov.titre    : (i.titre    || ''),
            urgence: 'urgence'  in ov ? ov.urgence  : (i.urgence  || 'basse'),
            solution:'solution' in ov ? ov.solution : '',
          };
        })
    ).sort((a, b) => (urgOrder[a.urgence] ?? 2) - (urgOrder[b.urgence] ?? 2));

    if (recapRows.length > 0) {
      doc.addPage(); y = 18; hdr();

      // Titre section avec compteur (barre fine identique preview)
      doc.setFillColor(...RD); doc.roundedRect(ML, y + 0.5, 1, 5, 0.3, 0.3, 'F');
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
      doc.text('TABLEAU RÉCAPITULATIF', ML + 4, y + 4.3);
      doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GR);
      doc.text(`${recapRows.length} point${recapRows.length > 1 ? 's' : ''} à traiter`, ML + 4 + doc.getTextWidth('TABLEAU RÉCAPITULATIF') + 4, y + 4.3);
      doc.setTextColor(0, 0, 0); y += 10;

      // Colonnes calées dans CW (identiques grille preview: 5px|70px|1fr|1.5fr|65px)
      const LBR   = 3;
      const cZone = ML + LBR + 4;  // 25mm
      const wZone = 30;
      const cDes  = cZone + wZone + 3;  // 58mm
      const wDes  = 48;
      const cSol  = cDes + wDes + 3;   // 109mm
      const wSol  = 54;
      const cUrg  = ML + CW - 4;       // 188mm (bord droit badge)

      // En-tête noir
      doc.setFillColor(...BK); doc.roundedRect(ML, y, CW, 7, 1, 1, 'F');
      doc.setTextColor(...WH); doc.setFontSize(6); doc.setFont('helvetica', 'bold');
      doc.text('ZONE', cZone, y + 4.8);
      doc.text('DÉSORDRE', cDes, y + 4.8);
      doc.text('SOLUTION / ACTION', cSol, y + 4.8);
      doc.text('URGENCE', cUrg, y + 4.8, { align: 'right' });
      doc.setTextColor(0, 0, 0); y += 8;

      recapRows.forEach((row, i) => {
        const urgColor = row.urgence === 'haute' ? RD : row.urgence === 'moyenne' ? AM : GN;
        const urgBg    = row.urgence === 'haute' ? [254,226,226] : row.urgence === 'moyenne' ? [255,247,237] : [220,252,231];
        const urgLabel = URGENCE[row.urgence]?.label ?? row.urgence;

        const zoneLines  = doc.splitTextToSize(row.locNom || '—', wZone);
        const titreLines = doc.splitTextToSize(row.titre  || '—', wDes);
        const solLines   = row.solution ? doc.splitTextToSize(row.solution, wSol) : [];
        const textRows   = Math.max(zoneLines.length, titreLines.length, solLines.length || 1);
        const rowH = textRows * 4.2 + 6;
        pb(rowH + 2);

        const bg = i % 2 === 0 ? 249 : 255;
        doc.setFillColor(bg, bg, bg); doc.rect(ML, y, CW, rowH, 'F');
        doc.setFillColor(...urgColor); doc.rect(ML, y + 1, LBR, rowH - 2, 'F');
        doc.setDrawColor(228, 228, 228); doc.setLineWidth(0.1); doc.rect(ML, y, CW, rowH);

        const baseY = y + 5;
        doc.setTextColor(100, 100, 100); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.text(zoneLines, cZone, baseY);
        doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        doc.text(titreLines, cDes, baseY);
        if (solLines.length) {
          doc.setTextColor(80, 80, 80); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
          doc.text(solLines, cSol, baseY);
        }

        // Badge urgence pill (comme preview : fond coloré + texte)
        doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
        const pillW = Math.min(doc.getTextWidth(urgLabel) + 6, 22);
        doc.setFillColor(...urgBg); doc.setDrawColor(...urgColor); doc.setLineWidth(0.15);
        doc.roundedRect(cUrg - pillW, y + rowH / 2 - 2.5, pillW, 5, 1, 1, 'FD');
        doc.setTextColor(...urgColor);
        doc.text(urgLabel, cUrg - pillW / 2, y + rowH / 2 + 1, { align: 'center' });

        doc.setTextColor(0, 0, 0); y += rowH + 1;
      });
    }
  }

  // ── CONCLUSION ───────────────────────────────────────────────────────────────

  if (includeConclusion && conclusion?.trim()) {
    doc.addPage(); hdr(); let cy = 18;
    doc.setFillColor(...RD); doc.roundedRect(ML, cy + 0.5, 1, 5, 0.3, 0.3, 'F');
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
    doc.text('CONCLUSION', ML + 4, cy + 4.3);
    doc.setTextColor(0, 0, 0); cy += 10;
    doc.setFillColor(...LG); doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.2);
    const conclusionText = stripMarkup(conclusion.trim());
    const lines = doc.splitTextToSize(conclusionText, CW - 10);
    const boxH = lines.length * 5 + 10;
    doc.roundedRect(ML, cy, CW, boxH, 2, 2, 'FD');
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(0, 0, 0);
    const ca  = conclusionAlign || 'left';
    const tx  = ca === 'center' ? ML + CW / 2 : ca === 'right' ? ML + CW - 5 : ML + 5;
    const to  = ca === 'left' ? {} : ca === 'justify' ? { align: 'justify', maxWidth: CW - 10 } : { align: ca };
    doc.text(lines, tx, cy + 7, to);
  }

  // ── PLANS ANNOTÉS + LÉGENDE ───────────────────────────────────────────────────

  if (plansEnFin) {
    const planLocs = localisations.filter(l => planImages[l.id] || (l.extraPlans || []).some((_, i) => extraPlanImages[`${l.id}_${i}`]));
    planLocs.forEach(loc => {
      const allZonePlans = [
        { img: planImages[loc.id], annotations: loc.planAnnotations, breakId: null },
        ...(loc.extraPlans || []).map((ep, idx) => ({ img: extraPlanImages[`${loc.id}_${idx}`], annotations: ep.planAnnotations, breakId: `plan-${loc.id}_ep_${idx}` })),
      ].filter(p => p.img);
      if (!allZonePlans.length) return;

      const allAnnotPaths = allZonePlans.flatMap(p => p.annotations?.paths || []);
      const combinedAnnot = allAnnotPaths.length ? { paths: allAnnotPaths } : null;
      const ih = CW * 0.46;

      doc.addPage(); y = 18; hdr();
      secHdr(`Plan — ${loc.nom}`);
      allZonePlans.forEach(({ img: planImg, breakId }, planI) => {
        if (planI > 0 && pageBreaksSet.has(breakId)) {
          doc.addPage(); y = 18; hdr();
        } else {
          pb(ih + 4);
        }
        try {
          const ext = planImg.startsWith('data:image/webp') ? 'WEBP' : planImg.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(planImg, ext, ML, y, CW, ih, undefined, 'FAST');
        } catch {}
        y += ih + 4;
      });
      y = addPlanLegend(doc, combinedAnnot, y, ML, CW, W, MR, RD, GR, symbolIcons, vpIconUrl);
    });
  }

  // ── FOOTERS ───────────────────────────────────────────────────────────────────

  const tot = doc.getNumberOfPages();
  for (let i = 1; i <= tot; i++) { doc.setPage(i); ftr(i, tot); }

  // ── TÉLÉCHARGEMENT ────────────────────────────────────────────────────────────

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const safeName   = (projet.nom      || 'Projet').replace(/[^a-zA-Z0-9À-ž _-]/g, '').trim();
  const safeVisite = (projet.visiteNom || '').replace(/[^a-zA-Z0-9À-ž _-]/g, '').trim();
  const filename   = safeVisite
    ? `${safeName} - CR ${safeVisite}.pdf`
    : `${safeName} - CR.pdf`;

  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
    // Mobile : ouvrir dans le viewer PDF natif (iOS/Android)
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
}
