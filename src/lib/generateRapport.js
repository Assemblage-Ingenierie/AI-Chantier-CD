import { ensureJsPDF } from './pdfUtils.js';
import { URGENCE, SUIVI } from './constants.js';
import { SYMBOLS } from '../components/vue/Annotator.jsx';

/**
 * Génère et télécharge le rapport PDF A4 du compte-rendu de visite.
 * @param {{ projet, localisations, tableauRecap, photosParLigne }} opts
 */
export async function exportPdf({ projet, localisations, tableauRecap, photosParLigne = 2, rapportPageBreaks = [], plansEnFin = false }) {
  await ensureJsPDF();
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297, ML = 18, MR = 18, CW = W - ML - MR;

  // Palette
  const BK = [34, 34, 34], RD = [227, 5, 19];
  const GR = [105, 114, 125], LG = [249, 249, 249], WH = [255, 255, 255];
  const AM = [217, 119, 6], GN = [22, 163, 74];

  const pageBreaksSet = new Set(rapportPageBreaks);
  const dvPdf = projet.dateVisite ? new Date(projet.dateVisite) : new Date();
  const today = dvPdf.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const allItems = localisations.flatMap(l => l.items || []);

  // ── Fonctions utilitaires ────────────────────────────────────────────────────

  const hdr = () => {
    doc.setFillColor(...BK); doc.rect(0, 0, W, 10, 'F');
    doc.setFillColor(...RD); doc.rect(0, 0, 3, 10, 'F');
    doc.setTextColor(...WH); doc.setFontSize(6.5); doc.setFont('helvetica', 'normal');
    doc.text('AI CHANTIER', ML + 3, 6.5);
    doc.text(`${projet.nom} · ${today}`, W - MR, 6.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  };

  const ftr = (n, t) => {
    doc.setFillColor(...LG); doc.rect(0, H - 8, W, 8, 'F');
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GR);
    doc.text('aichantier.app', ML, H - 2.5);
    doc.text(`${n} / ${t}`, W - MR, H - 2.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  };

  let y = 18;
  const pb = (n) => {
    if (y + n > H - 13) { doc.addPage(); y = 18; hdr(); return true; }
    return false;
  };

  // ── PAGE DE GARDE ────────────────────────────────────────────────────────────

  doc.setFillColor(...BK); doc.rect(0, 0, W, H * 0.52, 'F');
  doc.setFillColor(...RD); doc.rect(0, 0, 4, H * 0.52, 'F');

  if (projet.photo) {
    try {
      const ext = projet.photo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(projet.photo, ext, 0, 0, W, H * 0.52, undefined, 'FAST');
      try {
        doc.setFillColor(...BK);
        doc.setGState(doc.GState({ opacity: 0.55 }));
        doc.rect(0, 0, W, H * 0.52, 'F');
        doc.setGState(doc.GState({ opacity: 1 }));
      } catch {}
    } catch {}
  }
  doc.setFillColor(...RD); doc.rect(0, 0, 4, H * 0.52, 'F');

  // Logo Assemblage Ingénierie
  try {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(W - MR - 52, 10, 52, 20, 2, 2, 'F');
    doc.setTextColor(227, 5, 19); doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(8);
    doc.text('Assembl!age', W - MR - 50, 18);
    doc.setFontSize(7); doc.setTextColor(100, 100, 100);
    doc.text('ingénierie', W - MR - 50, 24);
    doc.setTextColor(0, 0, 0);
  } catch {}

  // Titre projet
  doc.setTextColor(...WH); doc.setFontSize(7); doc.setFont('helvetica', 'normal');
  const top = 20;
  doc.text('AI CHANTIER · COMPTE-RENDU DE VISITE', ML + 6, top);
  doc.setFontSize(6); doc.setTextColor(200, 200, 200);
  doc.text('COMPTE-RENDU DE VISITE', ML + 6, top + 7);
  doc.setFontSize(22); doc.setFont('helvetica', 'bold'); doc.setTextColor(...WH);
  const tlines = doc.splitTextToSize(projet.nom, W - ML - 30);
  doc.text(tlines, ML + 6, top + 16);
  const afterT = top + 16 + tlines.length * 10;
  doc.setFillColor(...RD); doc.rect(ML + 6, afterT + 4, 28, 1.5, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(180, 180, 180);
  doc.text(`Date : ${today}`, ML + 6, afterT + 12);
  if (projet.maitreOuvrage) doc.text(`Maître d'ouvrage : ${projet.maitreOuvrage}`, ML + 6, afterT + 19);
  if (projet.adresse) doc.text(projet.adresse, ML + 6, afterT + 26);

  // Stats
  const iy = H * 0.52 + 12;
  const urgC = allItems.filter(i => i.urgence === 'haute').length;
  doc.setFillColor(240, 240, 240); doc.roundedRect(ML, iy, CW, 20, 2, 2, 'F');
  doc.setDrawColor(...RD); doc.setLineWidth(0.3); doc.roundedRect(ML, iy, CW, 20, 2, 2, 'S');
  [{ v: allItems.length, l: 'Observations', c: BK }, { v: urgC, l: 'Urgentes', c: RD }, { v: localisations.length, l: 'Zones', c: BK }]
    .forEach((sc, i) => {
      const x = ML + i * (CW / 3) + CW / 6;
      doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(...sc.c);
      doc.text(String(sc.v), x, iy + 12, { align: 'center' });
      doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GR);
      doc.text(sc.l, x, iy + 17.5, { align: 'center' });
    });
  doc.setTextColor(0, 0, 0);

  // Participants / Intervenants
  const participants = projet.participants || [];
  if (participants.length > 0) {
    let py = iy + 28;
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...RD);
    doc.text('INTERVENANTS', ML, py);
    doc.setLineWidth(0.25); doc.setDrawColor(...RD); doc.line(ML, py + 1, ML + 24, py + 1);
    py += 7;
    participants.forEach((pt) => {
      if (py > H - 20) return;
      const rowH = 7;
      doc.setFillColor(...LG); doc.rect(ML, py - 3, CW, rowH, 'F');
      // Badge Assemblage
      if (pt.isAssemblage) {
        doc.setFillColor(...RD); doc.roundedRect(ML + 1, py - 2, 6, 5, 0.8, 0.8, 'F');
        doc.setFontSize(5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...WH);
        doc.text('A!', ML + 4, py + 1.5, { align: 'center' });
        doc.setTextColor(0, 0, 0);
      }
      const nameX = pt.isAssemblage ? ML + 9 : ML + 3;
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
      doc.text(pt.nom, nameX, py + 1);
      const nameW = doc.getTextWidth(pt.nom);
      if (pt.poste) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...GR);
        doc.text('· ' + pt.poste, nameX + nameW + 2, py + 1);
      }
      if (pt.email) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...GR);
        doc.text(pt.email, W - MR, py + 1, { align: 'right' });
      } else if (pt.tel) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...GR);
        doc.text(pt.tel, W - MR, py + 1, { align: 'right' });
      }
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
      const planImg = loc.planAnnotations?.exported || loc.planBg;
      if (planImg) {
        const ih = CW * 0.58;
        pb(22 + ih + 6);
        doc.setFillColor(...BK); doc.roundedRect(ML, y, CW, 10, 2, 2, 'F');
        doc.setFillColor(...RD); doc.rect(ML, y, 3, 10, 'F');
        doc.setTextColor(...WH); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
        doc.text(`PLAN — ${loc.nom.toUpperCase()}`, ML + 6, y + 7);
        doc.setTextColor(0, 0, 0); y += 12;
        try {
          const ext = planImg.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(planImg, ext, ML, y, CW, ih, undefined, 'FAST');
          y += ih + 4;
        } catch {}
      }
    }

    y += 5;
  });

  // ── TABLEAU RÉCAPITULATIF ─────────────────────────────────────────────────────

  if (tableauRecap?.length) {
    doc.addPage(); y = 18; hdr(); pb(18);
    doc.setFillColor(...BK); doc.roundedRect(ML, y, CW, 10, 2, 2, 'F');
    doc.setFillColor(...RD); doc.rect(ML, y, 3, 10, 'F');
    doc.setTextColor(...WH); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('TABLEAU RÉCAPITULATIF', ML + 6, y + 7);
    doc.setTextColor(0, 0, 0); y += 14;

    const colW = [6, CW * 0.35, CW * 0.35, 28];
    const colX = [ML, ML + colW[0], ML + colW[0] + colW[1], ML + colW[0] + colW[1] + colW[2]];

    doc.setFillColor(50, 50, 50); doc.rect(ML, y, CW, 8, 'F');
    doc.setTextColor(...WH); doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
    ['NIV.', 'DÉSORDRE CONSTATÉ', 'TRAVAUX PRÉCONISÉS', 'SUIVI'].forEach((t, i) => {
      doc.text(t, colX[i] + 2, y + 5.5);
    });
    doc.setTextColor(0, 0, 0); y += 9;

    tableauRecap.forEach((row, i) => {
      const urgColor = row.urgence === 'haute' ? RD : row.urgence === 'moyenne' ? AM : GN;
      const dLines = row.desordre ? doc.splitTextToSize(row.desordre, colW[1] - 4) : ['—'];
      const tLines = row.travaux ? doc.splitTextToSize(row.travaux, colW[2] - 4) : ['À définir'];
      const suiviLabel = row.suivi && row.suivi !== 'rien' ? SUIVI[row.suivi]?.label || '' : '—';
      const rowH = Math.max(dLines.length, tLines.length) * 5 + 7;
      pb(rowH + 2);

      const bg = i % 2 === 0 ? 249 : 255;
      doc.setFillColor(bg, bg, bg); doc.rect(ML, y, CW, rowH, 'F');
      doc.setFillColor(...urgColor); doc.rect(colX[0], y, colW[0], rowH, 'F');
      doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.15); doc.rect(ML, y, CW, rowH);

      doc.setTextColor(...WH); doc.setFontSize(5.5); doc.setFont('helvetica', 'bold');
      doc.text(row.urgence === 'haute' ? 'URG' : row.urgence === 'moyenne' ? 'MOY' : 'MIN',
        colX[0] + colW[0] / 2, y + rowH / 2 + 1.5, { align: 'center' });
      if (row.locNom) {
        doc.setFontSize(4.5);
        doc.text(row.locNom.slice(0, 6), colX[0] + colW[0] / 2, y + rowH / 2 + 5, { align: 'center' });
      }

      doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.text(dLines, colX[1] + 2, y + 5);
      doc.setTextColor(50, 50, 80); doc.text(tLines, colX[2] + 2, y + 5);

      if (suiviLabel !== '—') {
        const sv = SUIVI[row.suivi || 'rien'];
        if (sv) {
          const sc = sv.dot;
          doc.setFillColor(parseInt(sc.slice(1,3),16), parseInt(sc.slice(3,5),16), parseInt(sc.slice(5,7),16));
          doc.circle(colX[3] + 4, y + rowH / 2, 2, 'F');
        }
        doc.setTextColor(0, 0, 0); doc.setFontSize(6.5);
        doc.text(suiviLabel, colX[3] + 8, y + rowH / 2 + 2);
      } else {
        doc.setTextColor(180, 180, 180); doc.setFontSize(7);
        doc.text('—', colX[3] + colW[3] / 2, y + rowH / 2 + 2, { align: 'center' });
      }
      doc.setTextColor(0, 0, 0); y += rowH + 1;
    });
  }

  // ── PLANS ANNOTÉS + LÉGENDE ───────────────────────────────────────────────────

  if (plansEnFin) {
    const planLocs = localisations.filter(l => l.planAnnotations?.exported || l.planBg);
    planLocs.forEach(loc => {
      doc.addPage(); hdr();
      let ay = 18;
      doc.setFillColor(...BK); doc.roundedRect(ML, ay, CW, 10, 2, 2, 'F');
      doc.setFillColor(...RD); doc.rect(ML, ay, 3, 10, 'F');
      doc.setTextColor(...WH); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.text(`PLAN ANNOTÉ — ${loc.nom.toUpperCase()}`, ML + 6, ay + 7);
      doc.setTextColor(0, 0, 0); ay += 14;
      const planImg = loc.planAnnotations?.exported || loc.planBg;
      try {
        const ih = CW * 0.58;
        const ext = planImg.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        doc.addImage(planImg, ext, ML, ay, CW, ih, undefined, 'FAST');
        ay += ih + 8;
      } catch { ay += 6; }

      // Légende des symboles utilisés (uniquement si plan annoté)
      if (loc.planAnnotations?.exported) {
        const usedSymbols = new Set((loc.planAnnotations?.paths || []).filter(p => p.type === 'symbol').map(p => p.symbolId));
        const EXCL = ['fleche', 'arrow', 'trait', 'texte', 'text'];
        const legendSyms = SYMBOLS.filter(s => usedSymbols.has(s.id) && !EXCL.some(x => s.id.toLowerCase().includes(x)));
        if (legendSyms.length > 0) {
          doc.setFillColor(250, 250, 250); doc.roundedRect(ML, ay, CW, 8, 1, 1, 'F');
          doc.setDrawColor(...RD); doc.setLineWidth(0.3); doc.roundedRect(ML, ay, CW, 8, 1, 1, 'S');
          doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...RD);
          doc.text('LÉGENDE', ML + 4, ay + 5.5);
          doc.setTextColor(0, 0, 0); ay += 10;
          let lx = ML, ly = ay;
          legendSyms.forEach(s => {
            if (lx + 60 > W - MR) { lx = ML; ly += 9; }
            doc.setFillColor(...RD); doc.rect(lx, ly - 3.5, 6, 4.5, 'F');
            doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
            doc.text(s.label, lx + 9, ly + 0.2);
            lx += Math.max(60, doc.getTextWidth(s.label) + 14);
          });
        }
      }
    });
  }

  // ── FOOTERS ───────────────────────────────────────────────────────────────────

  const tot = doc.getNumberOfPages();
  for (let i = 1; i <= tot; i++) { doc.setPage(i); ftr(i, tot); }

  // ── TÉLÉCHARGEMENT ────────────────────────────────────────────────────────────

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CR_${(projet.nom || 'Projet').replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
