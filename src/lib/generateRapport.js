import { ensureJsPDF } from './pdfUtils.js';
import { URGENCE, SUIVI } from './constants.js';
import { SYMBOLS, drawAnnotationPaths, drawVP } from '../components/vue/Annotator.jsx';
import { getBrandingUrl } from './branding.js';

/** Rend le plan bg + annotations sur un canvas en mémoire et retourne un dataURL PNG.
 *  Les annotations sont agrandies proportionnellement à la résolution de l'image
 *  pour rester lisibles une fois réduites à la taille A4. */
async function renderPlanImage(planBg, planAnnotations, annotScale = 1) {
  const exported = planAnnotations?.exported;
  const paths    = planAnnotations?.paths;
  if (!planBg) return exported ?? null;
  if (!paths?.length) return planBg;
  return new Promise(resolve => {
    const img = new window.Image();
    img.onload = () => {
      const cv  = document.createElement('canvas');
      cv.width  = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const sizeScale = Math.max(1, cv.width / 700) * annotScale;
      drawAnnotationPaths(ctx, paths, sizeScale);
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
  for (const sym of SYMBOLS) {
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
  const legendSy      = SYMBOLS.filter(s => usedIds.has(s.id));
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

/**
 * Génère et télécharge le rapport PDF A4 du compte-rendu de visite.
 * @param {{ projet, localisations, tableauRecap, photosParLigne }} opts
 */
export async function exportPdf({ projet, localisations, photosParLigne = 2, rapportPageBreaks = [], plansEnFin = false, includeTableauRecap = true, tableauRecap = [], includeConclusion = false, conclusion = '', annotScale = 1 }) {
  await ensureJsPDF();
  const { jsPDF } = window.jspdf;

  // Charger le logo Assemblage Ingénierie en base64 (depuis le bucket Supabase branding)
  let logoDataUrl = null;
  try {
    const logoUrl = await getBrandingUrl('logo-ai-rouge.png');
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

  // Pré-rendu des plans annotés (une seule passe async avant la génération PDF)
  const planImages = {};
  for (const loc of localisations) {
    const img = await renderPlanImage(loc.planBg, loc.planAnnotations, annotScale);
    if (img) planImages[loc.id] = img;
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
    doc.setFillColor(...BK); doc.rect(0, 0, W, 10, 'F');
    doc.setFillColor(...RD); doc.rect(0, 0, 3, 10, 'F');
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, 'PNG', ML + 3, 1.8, 30, 6.5, undefined, 'FAST'); } catch {}
    } else {
      doc.setTextColor(...WH); doc.setFontSize(6.5); doc.setFont('helvetica', 'normal');
      doc.text('AI CHANTIER', ML + 3, 6.5);
    }
    doc.setTextColor(200, 200, 200); doc.setFontSize(6.5); doc.setFont('helvetica', 'normal');
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

  if (projet.photo) {
    try {
      const ext = projet.photo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(projet.photo, ext, 0, 0, W, DARK_H, undefined, 'FAST');
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
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(180, 180, 180);
  if (projet.adresse) doc.text(projet.adresse, ML + 6, afterT + 4);
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
    doc.setFillColor(...RD); doc.rect(ML, py, 3, 14, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
    doc.text('PRÉSENTATION DU PROJET', ML + 7, py + 6);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GR);
    doc.text(`${infoRows.length} info${infoRows.length > 1 ? 's' : ''}`, ML + 7, py + 12);
    doc.setTextColor(0, 0, 0); py += 18;

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
    doc.setFillColor(...RD); doc.rect(ML, py, 3, 14, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
    doc.text('INTERVENANTS', ML + 7, py + 6);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GR);
    doc.text(`${participants.length} intervenant${participants.length > 1 ? 's' : ''}`, ML + 7, py + 12);
    doc.setTextColor(0, 0, 0); py += 18;

    const cNom = ML + 10, cTel = ML + CW * 0.40, cEmail = ML + CW * 0.58, presX = W - MR;
    doc.setFillColor(...BK); doc.roundedRect(ML, py, CW, 7, 1.5, 1.5, 'F');
    doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...WH);
    doc.text('NOM / POSTE', cNom, py + 5);
    doc.text('TELEPHONE', cTel, py + 5);
    doc.text('EMAIL', cEmail, py + 5);
    doc.text('PRESENCE', presX, py + 5, { align: 'right' });
    doc.setTextColor(0, 0, 0); py += 8;

    participants.forEach((pt, i) => {
      const isPresent = !pt.presence || pt.presence === 'present';
      const rowH = pt.poste ? 13 : 8;
      const bg = i % 2 === 0 ? 249 : 255;
      doc.setFillColor(bg, bg, bg); doc.rect(ML, py, CW, rowH, 'F');
      doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.15); doc.rect(ML, py, CW, rowH);
      if (pt.isAssemblage) {
        doc.setFillColor(...RD); doc.roundedRect(ML + 1.5, py + rowH / 2 - 2.5, 7, 5, 1, 1, 'F');
        doc.setFontSize(5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...WH);
        doc.text('A!', ML + 5, py + rowH / 2 + 0.5, { align: 'center' });
        doc.setTextColor(0, 0, 0);
      }
      const nameY = pt.poste ? py + 5 : py + rowH / 2 + 2;
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
      doc.text(doc.splitTextToSize(pt.nom, cTel - cNom - 2)[0], cNom, nameY);
      if (pt.poste) {
        doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GR);
        doc.text(doc.splitTextToSize(pt.poste, cTel - cNom - 2)[0], cNom, py + 9.5);
      }
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(0, 0, 0);
      doc.text(pt.tel || '—', cTel, py + rowH / 2 + 2);
      doc.setFontSize(6.5); doc.setTextColor(...GR);
      doc.text(doc.splitTextToSize(pt.email || '—', presX - cEmail - 4)[0], cEmail, py + rowH / 2 + 2);
      const presLabel = isPresent ? 'Present' : 'Absent';
      const presColor = isPresent ? GN : RD;
      const presW = doc.getTextWidth(presLabel) + 6;
      doc.setFillColor(...(isPresent ? [220, 252, 231] : [254, 226, 226]));
      doc.roundedRect(presX - presW, py + rowH / 2 - 2.5, presW, 5, 1, 1, 'F');
      doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...presColor);
      doc.text(presLabel, presX - presW / 2, py + rowH / 2 + 1, { align: 'center' });
      doc.setTextColor(0, 0, 0);
      py += rowH + 1;
    });
  }

  // ── OBSERVATIONS ─────────────────────────────────────────────────────────────

  doc.addPage(); y = 18; hdr();

  const renderItems = (items) => {
    items.forEach(item => {
      if (pageBreaksSet.has(item.id)) { doc.addPage(); y = 18; hdr(); }
      const urgColor = item.urgence === 'haute' ? RD : item.urgence === 'moyenne' ? AM : GN;
      const suiviTxt = item.suivi && item.suivi !== 'rien' ? SUIVI[item.suivi]?.label : '';
      const cLines = item.commentaire ? doc.splitTextToSize(item.commentaire, CW - 14) : [];
      const phRows = item.photos?.length ? Math.ceil(Math.min(item.photos.length, 6) / 3) : 0;
      pb(14 + cLines.length * 4.5 + phRows * 30 + 4 + (suiviTxt ? 6 : 0));

      // Bandeau titre
      doc.setFillColor(...LG); doc.roundedRect(ML, y, CW, 10, 1.5, 1.5, 'F');
      doc.setFillColor(...urgColor); doc.circle(ML + 5.5, y + 5, 2.5, 'F');
      doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
      doc.text(doc.splitTextToSize(item.titre, CW - 40)[0], ML + 11, y + 6.5);
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...urgColor);
      doc.text(URGENCE[item.urgence]?.label ?? item.urgence, W - MR, y + 6.5, { align: 'right' });
      doc.setTextColor(0, 0, 0); y += 12;

      // Badge suivi
      if (suiviTxt) {
        const sv = SUIVI[item.suivi];
        const sc = sv.dot;
        const rgb = [parseInt(sc.slice(1,3),16), parseInt(sc.slice(3,5),16), parseInt(sc.slice(5,7),16)];
        const tw = doc.getTextWidth('Suivi : ' + suiviTxt) + 10;
        doc.setFillColor(245, 245, 245); doc.roundedRect(ML + 4, y, tw, 5, 1, 1, 'F');
        doc.setFillColor(...rgb); doc.circle(ML + 8, y + 2.5, 1.5, 'F');
        doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80);
        doc.text('Suivi : ' + suiviTxt, ML + 11, y + 3.8);
        doc.setTextColor(0, 0, 0); y += 7;
      }

      // Commentaire
      if (cLines.length) {
        doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 60, 80);
        doc.text(cLines, ML + 4, y + 1);
        y += cLines.length * 4.5 + 2; doc.setTextColor(0, 0, 0);
      }

      // Photos
      if (item.photos?.length) {
        const maxPh = photosParLigne <= 2 ? 4 : 6;
        const cols = Math.max(1, Math.min(photosParLigne, 3));
        const show = item.photos.slice(0, maxPh);
        const pw = (CW - 4 - (cols - 1) * 2) / cols;
        const ph = pw * 0.65;
        show.forEach((p, pi) => {
          if (!p.data) return;
          const px = ML + 4 + (pi % cols) * (pw + 2);
          const py2 = y + Math.floor(pi / cols) * (ph + 2);
          try { doc.addImage(p.data, p.data.startsWith('data:image/png') ? 'PNG' : 'JPEG', px, py2, pw, ph, undefined, 'FAST'); } catch {}
          doc.setDrawColor(...GR); doc.setLineWidth(0.15); doc.rect(px, py2, pw, ph);
        });
        y += Math.ceil(show.length / cols) * (ph + 2) + 2;
      }
      y += 4;
    });
  };

  localisations.forEach(loc => {
    const items = loc.items || [];
    if (!items.length) return;
    if (pageBreaksSet.has(loc.id)) { doc.addPage(); y = 18; hdr(); } else { pb(18); }
    doc.setFillColor(...BK); doc.roundedRect(ML, y, CW, 10, 2, 2, 'F');
    doc.setFillColor(...RD); doc.rect(ML, y, 3, 10, 'F');
    doc.setTextColor(...WH); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text(loc.nom.toUpperCase(), ML + 6, y + 7);
    doc.setTextColor(0, 0, 0); y += 14;
    renderItems(items);

    // Plan inline (si !plansEnFin et plan disponible)
    if (!plansEnFin) {
      const planImg = planImages[loc.id];
      if (planImg) {
        const ih      = CW * 0.58;
        const hasLeg  = (loc.planAnnotations?.paths || []).some(p => p.type === 'symbol');
        pb(22 + ih + (hasLeg ? 20 : 6));
        doc.setFillColor(...BK); doc.roundedRect(ML, y, CW, 10, 2, 2, 'F');
        doc.setFillColor(...RD); doc.rect(ML, y, 3, 10, 'F');
        doc.setTextColor(...WH); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
        doc.text(`PLAN — ${loc.nom.toUpperCase()}`, ML + 6, y + 7);
        doc.setTextColor(0, 0, 0); y += 12;
        try {
          const ext = planImg.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(planImg, ext, ML, y, CW, ih, undefined, 'FAST');
          y += ih + 2;
        } catch {}
        y = addPlanLegend(doc, loc.planAnnotations, y, ML, CW, W, MR, RD, GR, symbolIcons, vpIconUrl);
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
            locNom:  'zone'     in ov ? ov.zone     : (loc.nom       || ''),
            titre:   'titre'    in ov ? ov.titre    : (i.titre        || ''),
            urgence: 'urgence'  in ov ? ov.urgence  : (i.urgence     || 'basse'),
            solution:'solution' in ov ? ov.solution : (i.commentaire || ''),
          };
        })
    ).sort((a, b) => (urgOrder[a.urgence] ?? 2) - (urgOrder[b.urgence] ?? 2));

    if (recapRows.length > 0) {
      doc.addPage(); y = 18; hdr();
      doc.setFillColor(...BK); doc.roundedRect(ML, y, CW, 10, 2, 2, 'F');
      doc.setFillColor(...RD); doc.rect(ML, y, 3, 10, 'F');
      doc.setTextColor(...WH); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.text('TABLEAU RÉCAPITULATIF', ML + 6, y + 7);
      doc.setTextColor(0, 0, 0); y += 14;

      // colonnes : bande | zone | désordre | solution | urgence
      const colW = [6, 28, 48, 64, 28];
      const colX = [ML, ML+6, ML+34, ML+82, ML+146];

      doc.setFillColor(50, 50, 50); doc.rect(ML, y, CW, 8, 'F');
      doc.setTextColor(...WH); doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
      [null, 'ZONE', 'DÉSORDRE', 'SOLUTION / ACTION CORRECTIVE', 'URGENCE'].forEach((t, i) => {
        if (t) doc.text(t, colX[i] + 2, y + 5.5);
      });
      doc.setTextColor(0, 0, 0); y += 9;

      recapRows.forEach((row, i) => {
        const urgColor = row.urgence === 'haute' ? RD : row.urgence === 'moyenne' ? AM : GN;
        const urgLabel = URGENCE[row.urgence]?.label ?? row.urgence;
        const zoneLines  = doc.splitTextToSize(row.locNom || '—', colW[1] - 3);
        const titreLines = doc.splitTextToSize(row.titre   || '—', colW[2] - 3);
        const solLines   = doc.splitTextToSize(row.solution || '—', colW[3] - 3);
        const rowH = Math.max(zoneLines.length, titreLines.length, solLines.length) * 4.5 + 8;
        pb(rowH + 2);

        const bg = i % 2 === 0 ? 249 : 255;
        doc.setFillColor(bg, bg, bg); doc.rect(ML, y, CW, rowH, 'F');
        doc.setFillColor(...urgColor); doc.rect(colX[0], y, colW[0], rowH, 'F');
        doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.15); doc.rect(ML, y, CW, rowH);

        // Zone
        doc.setTextColor(50, 50, 50); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.text(zoneLines, colX[1] + 2, y + 5);

        // Désordre
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        doc.text(titreLines, colX[2] + 2, y + 5);

        // Solution
        doc.setTextColor(50, 50, 50); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.text(solLines, colX[3] + 2, y + 5);

        // Urgence badge
        const urgBadgeW = doc.getTextWidth(urgLabel) + 6;
        doc.setFillColor(...(row.urgence === 'haute' ? [254,226,226] : row.urgence === 'moyenne' ? [255,251,235] : [240,253,244]));
        doc.roundedRect(colX[4] + 1, y + rowH/2 - 3.5, urgBadgeW, 7, 1.5, 1.5, 'F');
        doc.setTextColor(...urgColor); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
        doc.text(urgLabel, colX[4] + 4, y + rowH/2 + 1);

        doc.setTextColor(0, 0, 0); y += rowH + 1;
      });
    }
  }

  // ── CONCLUSION ───────────────────────────────────────────────────────────────

  if (includeConclusion && conclusion?.trim()) {
    doc.addPage(); hdr(); let cy = 18;
    doc.setFillColor(...RD); doc.rect(ML, cy, 3, 14, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
    doc.text('CONCLUSION', ML + 7, cy + 6);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GR);
    doc.text(today, ML + 7, cy + 12);
    doc.setTextColor(0, 0, 0); cy += 18;
    doc.setFillColor(...LG); doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.2);
    const lines = doc.splitTextToSize(conclusion.trim(), CW - 10);
    const boxH = lines.length * 5 + 10;
    doc.roundedRect(ML, cy, CW, boxH, 2, 2, 'FD');
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(0, 0, 0);
    doc.text(lines, ML + 5, cy + 7);
  }

  // ── PLANS ANNOTÉS + LÉGENDE ───────────────────────────────────────────────────

  if (plansEnFin) {
    const planLocs = localisations.filter(l => planImages[l.id]);
    planLocs.forEach(loc => {
      doc.addPage(); hdr();
      let ay = 18;
      doc.setFillColor(...BK); doc.roundedRect(ML, ay, CW, 10, 2, 2, 'F');
      doc.setFillColor(...RD); doc.rect(ML, ay, 3, 10, 'F');
      doc.setTextColor(...WH); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.text(`PLAN ANNOTÉ — ${loc.nom.toUpperCase()}`, ML + 6, ay + 7);
      doc.setTextColor(0, 0, 0); ay += 14;
      const planImg = planImages[loc.id];
      try {
        const ih  = CW * 0.58;
        const ext = planImg.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        doc.addImage(planImg, ext, ML, ay, CW, ih, undefined, 'FAST');
        ay += ih + 4;
      } catch { ay += 6; }
      ay = addPlanLegend(doc, loc.planAnnotations, ay, ML, CW, W, MR, RD, GR, symbolIcons, vpIconUrl);
    });
  }

  // ── FOOTERS ───────────────────────────────────────────────────────────────────

  const tot = doc.getNumberOfPages();
  for (let i = 1; i <= tot; i++) { doc.setPage(i); ftr(i, tot); }

  // ── TÉLÉCHARGEMENT ────────────────────────────────────────────────────────────

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const filename = `CR_${(projet.nom || 'Projet').replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;

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
