import { ensureJsPDF } from './pdfUtils.js';
import { fetchPlanData, fetchPlanHdDataUrl, fetchPlanPdfByBase } from './storage.js';
import { URGENCE, SUIVI } from './constants.js';
import { stripMarkup } from './markup.jsx';
import { getAllSymbols, drawAnnotationPaths, drawVP, scalePaths } from '../components/vue/Annotator.jsx';
import { getBrandingUrl } from './branding.js';
import { computeVpNumbering, dedupPlanPaths } from './vpNumbering.js';

// Convertit un data URL (ou base64 brut) en Uint8Array pour pdf-lib.
function dataUrlToUint8(dataUrl) {
  try {
    const b64 = String(dataUrl).includes(',') ? String(dataUrl).split(',')[1] : String(dataUrl);
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  } catch { return null; }
}

// Nom de plan « Base — Page N » → { base, pageIndex } (index 0 si pas de suffixe page).
function parsePlanBaseAndPage(nom) {
  const s = String(nom || '');
  const m = s.match(/—\s*Page\s*(\d+)\s*$/i);
  const base = s.replace(/\s*—\s*Page\s*\d+\s*$/i, '').trim() || s || 'doc';
  return { base, pageIndex: m ? Math.max(0, parseInt(m[1], 10) - 1) : 0 };
}

/** Largeur naturelle d'une image (data URL ou URL signée). Sert à connaître la largeur de
 *  l'espace de coordonnées des annotations (= largeur du planBg). Renvoie null si indéterminable. */
function imgNaturalWidth(src) {
  return new Promise(res => {
    if (!src) { res(null); return; }
    const im = new window.Image();
    im.onload = () => res(im.naturalWidth || null);
    im.onerror = () => res(null);
    im.src = src;
  });
}

/** Rend le plan bg + annotations sur un canvas en mémoire et retourne un dataURL PNG.
 *  Les annotations sont agrandies proportionnellement à la résolution de l'image
 *  pour rester lisibles une fois réduites à la taille A4. */
const _isIOS_PDF = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent || '');
const MAX_PLAN_CANVAS_AREA = _isIOS_PDF ? 16_000_000 : 40_000_000; // plafond canvas (iOS 16 Mpx)

// VIEWPOINTS EN VECTORIEL : les marqueurs Vxx ne sont PLUS cuits dans le raster (ils pixellisaient
// avec lui — retour Thomas). renderPlanImage remonte, via metaOut.vps, la position FRACTIONNAIRE
// (0..1) de chaque marqueur + son angle + son label ; exportPdf les redessine ensuite en vectoriel
// natif jsPDF par-dessus l'image (nets à tout zoom, poids nul).
async function renderPlanImage(planBg, planAnnotations, annotScale = 1, planId = null, vpNumByPath = null, opts = {}, metaOut = null) {
  const MAXD_OPT = opts.maxDim || 6500;   // pleine résolution HD (l'image HD stockée va jusqu'à 6500px)
  const Q_OPT    = opts.quality || 0.85;  // qualité JPEG du plan
  if (metaOut) metaOut.vps = [];
  // Espace de coordonnées des annotations = largeur du planBg (les coords y sont relatives). On
  // le mesure AVANT de swapper vers l'image HD, pour remettre les coords à l'échelle du canvas
  // rendu (sinon les marqueurs Vxx se décalent vers le coin). On n'active le HD que si connu.
  const bgW = planBg ? await imgNaturalWidth(planBg) : null;
  const origThumb = planBg; // GARDE-FOU : miniature d'origine → repli si l'image HD échoue à charger
  let usedHd = false;
  if (planId && bgW) {
    const hd = await fetchPlanHdDataUrl(planId);
    if (hd) { planBg = hd; usedHd = true; }
  }
  if (metaOut) metaOut.usedHd = usedHd;
  const exported = planAnnotations?.exported;
  const paths    = planAnnotations?.paths;
  if (planId) console.log(`[PDF] plan ${planId} : image HD ${usedHd ? 'OUI' : 'NON (miniature ' + (bgW || '?') + 'px)'}`);
  if (!planBg) return exported ?? null;
  if (!paths?.length) return planBg;
  // Dédoublonne les annotations + numérote les viewpoints (1 seul Vxx par marqueur sur le plan).
  const drawPaths = dedupPlanPaths(paths, vpNumByPath);
  return new Promise(resolve => {
    const img = new window.Image();
    img.onload = () => {
      // Résolution HD (jusqu'à 4500px) → plan + formes nets au zoom. Plafond canvas iOS (16 Mpx)
      // respecté. Les Vxx sont exclus du raster (skipTypes) et redessinés en vectoriel dans le PDF.
      let dScale = Math.min(1, MAXD_OPT / Math.max(img.naturalWidth, img.naturalHeight));
      let cw = Math.round(img.naturalWidth * dScale), ch = Math.round(img.naturalHeight * dScale);
      if (cw * ch > MAX_PLAN_CANVAS_AREA) {
        const k = Math.sqrt(MAX_PLAN_CANVAS_AREA / (cw * ch));
        dScale *= k; cw = Math.round(cw * k); ch = Math.round(ch * k);
      }
      const cv  = document.createElement('canvas');
      cv.width  = cw; cv.height = ch;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      // sizeScale ∝ largeur → les annotations gardent la même taille relative qu'à 4500px.
      const sizeScale = Math.max(0.5, cv.width / 1400) * annotScale;
      // Ramène les coords (espace planBg) dans l'espace du canvas : bgW si on a swappé sur le HD,
      // sinon la largeur de l'image rendue (le bg). → marqueurs au bon endroit à toute résolution.
      const pathsSpaceW = usedHd ? bgW : img.naturalWidth;
      const coordScale = pathsSpaceW ? cv.width / pathsSpaceW : 1;
      // Bake TOUT SAUF les viewpoints (redessinés en vectoriel). L'espace de coords du plan
      // (largeur=pathsSpaceW, hauteur = même ratio que le canvas) sert à positionner les Vxx.
      drawAnnotationPaths(ctx, scalePaths(drawPaths, coordScale, coordScale), sizeScale, null, new Set(['viewpoint']));
      if (metaOut) {
        const coordW = pathsSpaceW || cv.width;
        const coordH = coordW * (cv.height / cv.width);
        metaOut.vps = drawPaths
          .filter(p => p.type === 'viewpoint' && p.x != null)
          .map(p => ({ fx: p.x / coordW, fy: p.y / coordH, angle: p.angle ?? 0, label: p.label || '' }));
      }
      // JPEG (le plan est opaque) : embarqué tel quel par jsPDF (DCTDecode) → 5-10× plus
      // léger qu'un PNG et SANS l'étape de compression zlib lente du PNG.
      const out = cv.toDataURL('image/jpeg', Q_OPT);
      cv.width = 0; cv.height = 0;
      resolve(out);
    };
    // Si l'image HD échoue à charger, on NE renvoie JAMAIS rien (plan absent — retour Thomas) :
    // on retombe sur la miniature d'origine (toujours valide) → le plan reste présent, quitte à
    // être moins net. Dernier filet : jamais de plan manquant dans le rapport.
    img.onerror = () => {
      if (planBg !== origThumb && origThumb) {
        const img2 = new window.Image();
        img2.onload = () => { try { const c = document.createElement('canvas'); c.width = img2.naturalWidth; c.height = img2.naturalHeight; c.getContext('2d').drawImage(img2, 0, 0); resolve(c.toDataURL('image/jpeg', Q_OPT)); } catch { resolve(origThumb); } };
        img2.onerror = () => resolve(exported ?? origThumb);
        img2.src = origThumb;
      } else {
        resolve(exported ?? origThumb ?? planBg);
      }
    };
    img.src = planBg;
  });
}

/** Dessine les marqueurs de viewpoint (Vxx) en VECTORIEL natif sur la page PDF, par-dessus
 *  l'image de plan posée dans le rectangle {x,y,w,h} (mm). `vps` = liste { fx, fy, angle, label }
 *  en coordonnées fractionnaires (0..1) du plan. Taille FIXE en mm → nets et lisibles à tout zoom,
 *  quelle que soit la résolution du plan. Style : cône de visée + pastille + numéro « Vn ». */
function drawVpBadgesPdf(doc, vps, x, y, w, h, RD) {
  if (!vps?.length) return;
  const red = RD || [227, 5, 19];
  const CONE_L = 9, CONE_A = 0.62; // longueur cône (mm) + demi-angle (~35°)
  for (const vp of vps) {
    const px = x + Math.min(1, Math.max(0, vp.fx)) * w;
    const py = y + Math.min(1, Math.max(0, vp.fy)) * h;
    // Cône de visée (2 traits fins depuis le point)
    doc.setDrawColor(...red); doc.setLineWidth(0.25);
    doc.line(px, py, px + Math.cos(vp.angle - CONE_A) * CONE_L, py + Math.sin(vp.angle - CONE_A) * CONE_L);
    doc.line(px, py, px + Math.cos(vp.angle + CONE_A) * CONE_L, py + Math.sin(vp.angle + CONE_A) * CONE_L);
    // Pastille (point) : cercle rouge + centre blanc
    doc.setFillColor(...red); doc.circle(px, py, 1.4, 'F');
    doc.setFillColor(255, 255, 255); doc.circle(px, py, 0.55, 'F');
    // Numéro « Vn » dans une pastille blanche bordée (toujours net, taille fixe)
    if (vp.label) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      const tw = doc.getTextWidth(vp.label);
      const bw = tw + 2.2, bh = 4;
      const bx = px + 1.8, by = py - bh - 0.6;
      doc.setFillColor(255, 255, 255); doc.setDrawColor(...red); doc.setLineWidth(0.2);
      doc.roundedRect(bx, by, bw, bh, 0.7, 0.7, 'FD');
      doc.setTextColor(...red);
      doc.text(vp.label, bx + bw / 2, by + bh - 1.2, { align: 'center' });
      doc.setTextColor(0, 0, 0);
    }
  }
}

/** Réduit une image pour l'embarquer dans le PDF : on plafonne le plus grand côté à maxDim px
 *  et on ré-encode en JPEG. Accepte un dataURL OU une URL signée Supabase (https) — c'est le
 *  cas normal des photos d'observation, chargées en URL et embarquées sinon en pleine résolution
 *  capteur (≈4000px) dans une case de ~83mm → le PDF explosait (>100 Mo). On charge l'image
 *  (crossOrigin pour ne pas « tainter » le canvas), on la redessine réduite puis on exporte un
 *  JPEG compact. En cas d'échec (CORS, réseau) on renvoie la source d'origine. */
async function downscaleDataUrl(src, maxDim, quality = 0.82) {
  if (!src) return src;
  const isData = src.startsWith('data:');
  let objUrl = null;
  try {
    // URL signée Supabase → on récupère les octets en blob et on charge via un object URL
    // (même origine) : le canvas n'est jamais « tainté », toDataURL fonctionne toujours.
    let loadSrc = src;
    if (!isData) {
      const resp = await fetch(src);
      if (!resp.ok) return src;
      const blob = await resp.blob();
      objUrl = URL.createObjectURL(blob);
      loadSrc = objUrl;
    }
    return await new Promise(resolve => {
      const img = new window.Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
          // Déjà petite ET déjà un dataURL JPEG → rien à gagner, on garde l'original.
          if (scale >= 1 && isData && /^data:image\/jpe?g/i.test(src)) { resolve(src); return; }
          const cv = document.createElement('canvas');
          cv.width  = Math.max(1, Math.round(img.naturalWidth  * scale));
          cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); // JPEG sans alpha
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          const out = cv.toDataURL('image/jpeg', quality);
          cv.width = 0; cv.height = 0;
          // dataURL : on garde le plus léger ; URL distante : on prend toujours le JPEG réduit.
          resolve(out && out.length > 50 ? ((!isData || out.length < src.length) ? out : src) : src);
        } catch { resolve(src); }
      };
      img.onerror = () => resolve(src);
      img.src = loadSrc;
    });
  } catch { return src; }
  finally { if (objUrl) URL.revokeObjectURL(objUrl); }
}

/** Recompresse un dataURL JPEG à une qualité inférieure SANS changer sa résolution.
 *  Utilisé par le budget de poids pour les PLANS : la résolution (et donc la taille des
 *  marqueurs Vxx) est conservée, seule la qualité JPEG baisse → gain de poids en dernier
 *  recours sans rendre les Vxx plus petits. Renvoie l'original si l'opération échoue. */
async function recompressJpeg(dataUrl, quality = 0.7) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  return new Promise(resolve => {
    const img = new window.Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0);
        const out = cv.toDataURL('image/jpeg', quality);
        cv.width = 0; cv.height = 0;
        resolve(out && out.length > 50 ? out : dataUrl);
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
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
  // Rétrocompat : anciens commentaires dont les balises ont été encodées en entités
  // (&lt;div&gt;) — on les restaure en vraies balises avant de parser via le DOM.
  let prepared = html;
  if (prepared.includes('&lt;') || prepared.includes('&gt;')) {
    prepared = prepared.replace(/&lt;(\/?(?:div|p|br|ul|ol|li|strong|b|em|i|u|s|strike|del|span)(?:[^&]|&(?!gt;))*?)&gt;/gi, '<$1>');
  }
  const container = document.createElement('div');
  container.innerHTML = prepared;

  // Modèle « lignes » : le contenu inline s'accumule dans la ligne courante ; un <br>,
  // une frontière de bloc ou un <li> termine la ligne. Une ligne VIDE = un saut d'aération
  // voulu par l'utilisateur (touche Entrée) → on le PRÉSERVE, à l'identique du rendu écran.
  // Avant, chaque frontière de bloc émettait 2 sauts et tout était plafonné à 1 ligne vide
  // → l'aération tapée dans l'éditeur disparaissait du PDF. Aucun TEXTE n'est jamais retiré.
  const lines = [];
  let current = [];
  const endLine = () => { lines.push(current); current = []; };
  const BLOCK = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);

  const walk = (node, b, it, u) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { // TEXT_NODE
        const txt = child.textContent.replace(/[ \t\r\n]+/g, ' ');
        if (txt) current.push({ text: txt, bold: b, italic: it, underline: u });
        continue;
      }
      if (child.nodeType !== 1) continue; // pas un élément
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') { endLine(); continue; }
      const nb = b || tag === 'strong' || tag === 'b';
      const ni = it || tag === 'em' || tag === 'i';
      const nu = u || tag === 'u';
      if (tag === 'ul' || tag === 'ol') {
        for (const li of child.childNodes) {
          if (li.nodeType !== 1 || li.tagName.toLowerCase() !== 'li') continue;
          if (current.length) endLine();
          current.push({ text: '• ', bold: false, italic: false, underline: false });
          walk(li, nb, ni, nu);
          endLine();
        }
        continue;
      }
      if (tag === 'li') {
        if (current.length) endLine();
        current.push({ text: '• ', bold: false, italic: false, underline: false });
        walk(child, nb, ni, nu);
        endLine();
        continue;
      }
      if (BLOCK.has(tag)) {
        if (current.length) endLine();
        const before = lines.length;
        walk(child, nb, ni, nu);
        if (current.length) endLine();
        else if (lines.length === before) lines.push([]); // bloc vide → ligne d'aération
        continue;
      }
      // inline (span, balises inconnues) : passage transparent
      walk(child, nb, ni, nu);
    }
  };
  walk(container, false, false, false);
  if (current.length) endLine();

  // Retirer les lignes vides en tête/queue
  while (lines.length && lines[0].length === 0) lines.shift();
  while (lines.length && lines[lines.length - 1].length === 0) lines.pop();

  // Borne de sécurité : max 2 lignes vides consécutives (aération généreuse mais qui évite
  // qu'un collage accidentel de dizaines de lignes vides ne fasse exploser la mise en page).
  const out = [];
  let blankRun = 0;
  let emitted = false;
  for (const ln of lines) {
    if (ln.length === 0) { blankRun++; if (blankRun > 2) continue; }
    else blankRun = 0;
    if (emitted) out.push({ text: '\n', bold: false, italic: false, underline: false });
    emitted = true;
    for (const s of ln) out.push(s);
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

  // compress: true → déflate les flux de contenu (texte/vecteurs). Les images JPEG/WebP
  // gardent leur propre compression (pas de ré-encodage) → gain de poids sans surcoût notable.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const W = 210, H = 297, ML = 18, MR = 18, CW = W - ML - MR;

  // Palette
  const BK = [34, 34, 34], RD = [227, 5, 19];
  const GR = [105, 114, 125], LG = [249, 249, 249], WH = [255, 255, 255];
  const AM = [217, 119, 6], GN = [22, 163, 74];

  // Numérotation Vxx globale (badges photos + labels marqueurs) — calculée AVANT le pré-rendu
  // des plans pour réécrire les labels des marqueurs. Logique partagée avec l'aperçu écran.
  const { vxxPhotoMap: vxxPhotoMapPdf, vpNumByPath: vpNumByPathPdf } = computeVpNumbering(localisations);

  // Source PDF VECTORIEL d'un plan (par planId) : renvoie { bytes, pageIndex } si le PDF source
  // est stocké (→ embarqué en vectoriel dans le rapport, net à tout zoom), sinon null. Caché par
  // base. Sans PDF source (plans image legacy) : null → repli sur le raster.
  const _srcPdfByBase = new Map();
  const getPlanSrc = async (planId) => {
    if (!planId || !projet.id) return null;
    const nom = (projet.planLibrary || []).find(p => p.id === planId)?.nom;
    if (!nom) return null;
    const { base, pageIndex } = parsePlanBaseAndPage(nom);
    if (!_srcPdfByBase.has(base)) {
      let bytes = null;
      // Timeout 8 s : un réseau lent ne doit JAMAIS bloquer la génération du PDF (retour Thomas :
      // « rien ne s'ouvre à part le générateur »). En cas de dépassement → null → repli raster.
      try {
        const durl = await Promise.race([
          fetchPlanPdfByBase(projet.id, base),
          new Promise(res => setTimeout(() => res(null), 8000)),
        ]);
        if (durl) bytes = dataUrlToUint8(durl);
      } catch (e) { console.warn('[PDF] fetchPlanPdfByBase', base, e); }
      _srcPdfByBase.set(base, bytes);
      console.log(`[PDF] PDF source plan « ${base} » : ${bytes ? 'TROUVÉ (' + Math.round(bytes.length / 1024) + ' Ko) → vectorisable' : 'ABSENT → repli raster'}`);
    }
    const bytes = _srcPdfByBase.get(base);
    return bytes ? { bytes, pageIndex } : null;
  };
  // Le raster est TOUJOURS rendu en pleine résolution HD : c'est le repli si la vectorisation
  // pdf-lib échoue. (Ne JAMAIS le dégrader en pariant sur le vectoriel — sinon un échec du
  // vectoriel donne un plan PIRE qu'avant. Retour Thomas.)
  const rasterOpts = () => ({});

  // Compteurs de DIAGNOSTIC (affichés dans la feuille « PDF prêt » sur mobile) : permettent de
  // voir d'un coup d'œil pourquoi un plan reste flou (pas d'image HD ? pas de PDF source ?).
  const diag = { plans: 0, hd: 0, thumb: 0, src: 0, vectorized: 0 };
  const countPlan = (meta, src) => { diag.plans++; if (meta.usedHd) diag.hd++; else diag.thumb++; if (src) diag.src++; };

  // Pré-rendu des plans (principal + supplémentaires) — tous rendus, annotés ou non.
  // *Vps : viewpoints (position fractionnaire + label) redessinés en VECTORIEL au placement.
  // *Src : { bytes, pageIndex } du PDF source à embarquer en vectoriel (ou absent).
  const planImages = {}, planVps = {}, planSrc = {};
  for (const loc of localisations) {
    const bg = loc.planBg || (projet.planLibrary || []).find(p => p.id === loc.planId)?.bg || null;
    const src = await getPlanSrc(loc.planId);
    const meta = {};
    const img = await renderPlanImage(bg, loc.planAnnotations, annotScale, loc.planId || null, vpNumByPathPdf, rasterOpts(!!src), meta);
    if (img) { planImages[loc.id] = img; planVps[loc.id] = meta.vps || []; if (src) planSrc[loc.id] = src; countPlan(meta, src); }
  }

  const extraPlanImages = {}, extraPlanVps = {}, extraPlanSrc = {}; // clé: `${locId}_${planIdx}`
  for (const loc of localisations) {
    for (let i = 0; i < (loc.extraPlans || []).length; i++) {
      const ep = loc.extraPlans[i];
      let bg = ep.planBg || (projet.planLibrary || []).find(p => p.id === ep.planId)?.bg || null;
      if (!bg && ep.planId) {
        const fetched = await fetchPlanData(ep.planId);
        if (fetched?.bg) bg = fetched.bg;
      }
      if (!bg && !ep.planId) continue;
      const src = await getPlanSrc(ep.planId);
      const meta = {};
      const img = await renderPlanImage(bg, ep.planAnnotations, annotScale, ep.planId || null, vpNumByPathPdf, rasterOpts(!!src), meta);
      if (img) { extraPlanImages[`${loc.id}_${i}`] = img; extraPlanVps[`${loc.id}_${i}`] = meta.vps || []; if (src) extraPlanSrc[`${loc.id}_${i}`] = src; countPlan(meta, src); }
    }
  }

  // Pré-rendu des plans additionnels par item (uniquement si annotés)
  const itemPlanImages = {}, itemPlanVps = {}, itemPlanSrc = {}; // clé: `${itemId}_${planIdx}`
  for (const loc of localisations) {
    for (const item of (loc.items || [])) {
      for (let i = 0; i < (item.plans || []).length; i++) {
        const pl = item.plans[i];
        if (!pl.planAnnotations?.paths?.length) continue;
        const bg = pl.planBg || (projet.planLibrary || []).find(p => p.id === pl.planId)?.bg || null;
        const src = await getPlanSrc(pl.planId);
        const meta = {};
        const img = await renderPlanImage(bg, pl.planAnnotations, annotScale, pl.planId || null, vpNumByPathPdf, rasterOpts(!!src), meta);
        if (img) { itemPlanImages[`${item.id}_${i}`] = img; itemPlanVps[`${item.id}_${i}`] = meta.vps || []; if (src) itemPlanSrc[`${item.id}_${i}`] = src; countPlan(meta, src); }
      }
    }
  }

  // Jobs de vectorisation : rectangles (mm, page) où embarquer le PDF source vectoriel par-dessus
  // le raster de repli, remplis au moment du placement dans la mise en page.
  const vectorPlanJobs = [];
  // Numéro de page courant, BLINDÉ : si l'API jsPDF diffère, on retombe sur le nombre total de
  // pages (on écrit toujours sur la dernière). Ne doit JAMAIS jeter → sinon toute la génération
  // planterait (aucun PDF produit).
  const curPage = () => {
    try { return doc.internal.getCurrentPageInfo().pageNumber; } catch {}
    try { return doc.internal.getNumberOfPages(); } catch {}
    try { return doc.getNumberOfPages(); } catch {}
    return 1;
  };
  const recordVectorJob = (src, vps, pageNumber, x, y, w, h) => {
    if (src) vectorPlanJobs.push({ ...src, vps: vps || [], page: pageNumber, x, y, w, h });
  };

  // Pré-réduction des photos affichées : on ré-encode chaque photo en JPEG à une résolution
  // adaptée à sa taille d'affichage (~1400px max). C'est LE poste qui faisait exploser le PDF
  // (photos plein capteur embarquées telles quelles dans des cases de 8cm). Map data→data réduit.
  const photoDataCache = new Map();
  {
    const cols  = Math.max(1, Math.min(photosParLigne, 3));
    const maxPh = cols <= 2 ? 4 : 6;
    // Résolution cible = ~180 dpi de la taille d'affichage réelle de la case (largeur en mm) —
    // OPTIMISATION EMAIL (demande) : une photo est affichée dans une case de ~6-9 cm ; 180 dpi y
    // reste net à l'écran comme à l'impression, avec encore une marge de zoom, tout en pesant
    // ~2× moins qu'à 250 dpi. Au-delà on ne stocke que des pixels invisibles qui font exploser le
    // poids du PDF (le PDF de rapport partait à ~45 Mo, non envoyable par email). Photos en JPEG
    // 0.72 : contenu photographique → compression propre, pas d'artefact visible à cette taille.
    const phWmm   = (CW - 6 - (cols - 1) * 2) / cols;
    // Résolution INITIALE généreuse (~1600px) : la photo reste nette même en zoomant dans le
    // PDF (retour Thomas). Le budget de poids global (plus bas) la réduit ensuite SEULEMENT si
    // le PDF dépasse la limite email — les petits rapports gardent donc des photos pleine qualité.
    const photoMaxDim = Math.min(1600, Math.max(900, Math.round(phWmm / 25.4 * 220)));
    const uniquePhotos = [...new Set(
      localisations.flatMap(loc =>
        (loc.items || []).flatMap(item =>
          (item.photos || []).filter(p => p.data).slice(0, maxPh).map(p => p.data)
        )
      )
    )];
    await Promise.all(uniquePhotos.map(async src => {
      photoDataCache.set(src, await downscaleDataUrl(src, photoMaxDim, 0.78));
    }));
  }

  // ── BUDGET DE POIDS — garantit un PDF envoyable par email (< 25 Mo) ──────────────────────
  // On mesure le poids cumulé des images embarquées (plans + photos). En cas de dépassement,
  // on RÉ-ENCODE d'abord les PHOTOS (contenu photographique → compression propre, peu visible),
  // puis, en tout dernier recours, on recompresse les PLANS. Les plans et leurs marqueurs Vxx
  // gardent ainsi leur netteté aussi longtemps que le budget le permet.
  const TARGET_IMG_BYTES = 22 * 1024 * 1024; // marge sous 25 Mo pour la structure PDF + texte
  const b64Bytes = (u) => (typeof u === 'string' && u.startsWith('data:'))
    ? Math.floor((u.length - u.indexOf(',') - 1) * 0.75) : 0;
  const weighImages = () => {
    let plans = 0, photos = 0;
    for (const d of [planImages, extraPlanImages, itemPlanImages])
      for (const v of Object.values(d)) plans += b64Bytes(v);
    for (const v of photoDataCache.values()) photos += b64Bytes(v);
    return { plans, photos, total: plans + photos };
  };
  const MB = (n) => (n / 1048576).toFixed(1) + ' Mo';
  let w = weighImages();
  console.log(`[PDF] Poids images initial : ${MB(w.total)} (plans ${MB(w.plans)} · photos ${MB(w.photos)})`);

  // Paliers PHOTOS (résolution ↓, qualité ↓) — appliqués tant qu'on dépasse le budget.
  const photoTiers = [{ dim: 1200, q: 0.72 }, { dim: 1000, q: 0.68 }, { dim: 820, q: 0.62 }];
  for (const t of photoTiers) {
    if (w.total <= TARGET_IMG_BYTES) break;
    // Réduire à partir de la valeur DÉJÀ encodée (dataURL) — évite de re-télécharger les
    // photos distantes depuis Supabase à chaque palier.
    await Promise.all([...photoDataCache.entries()].map(async ([src, cur]) => {
      photoDataCache.set(src, await downscaleDataUrl(cur || src, t.dim, t.q));
    }));
    w = weighImages();
    console.log(`[PDF] Réduction photos → ${t.dim}px q${t.q} : ${MB(w.total)}`);
  }

  // Paliers PLANS (recompression JPEG à résolution conservée → Vxx restent grands/lisibles).
  const planTiers = [0.74, 0.64, 0.55];
  for (const q of planTiers) {
    if (w.total <= TARGET_IMG_BYTES) break;
    for (const d of [planImages, extraPlanImages, itemPlanImages])
      for (const k of Object.keys(d)) d[k] = await recompressJpeg(d[k], q);
    w = weighImages();
    console.log(`[PDF] Recompression plans → q${q} : ${MB(w.total)}`);
  }
  console.log(`[PDF] Poids images final : ${MB(w.total)} (plans ${MB(w.plans)} · photos ${MB(w.photos)})`);

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

  const coverPhotoRaw = projet.photoCouverture || projet.photo;
  const coverPhoto = coverPhotoRaw ? await downscaleDataUrl(coverPhotoRaw, 1600, 0.82) : null;
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

    // Redessine l'en-tête du tableau après un saut de page (continuation intervenants)
    const drawParticipantsHeader = () => {
      doc.setFillColor(40, 40, 40); doc.roundedRect(ML, py, CW, 7, 1, 1, 'F');
      doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...WH);
      doc.text('NOM / POSTE', cNom, py + 5);
      doc.text('TEL.', cTel, py + 5);
      doc.text('EMAIL', cEmail, py + 5);
      doc.text('PRÉSENCE (suite)', cPres, py + 5, { align: 'right' });
      doc.setTextColor(0, 0, 0); py += 8;
    };

    participants.forEach((pt, i) => {
      const isPresent = !pt.presence || pt.presence === 'present';
      const rowH = pt.poste ? 13 : 8;
      // Saut de page si plus de place
      if (py + rowH > H - 15) {
        doc.addPage(); hdr(); py = 22;
        drawParticipantsHeader();
      }
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
          const pdata = photoDataCache.get(p.data) || p.data;
          try { doc.addImage(pdata, pdata.startsWith('data:image/png') ? 'PNG' : 'JPEG', px, py2, phW, phH_, undefined, 'FAST'); } catch {}
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
        drawVpBadgesPdf(doc, itemPlanVps[`${item.id}_${pidx}`], ML, y, CW, ih, RD); // Vxx vectoriels
        recordVectorJob(itemPlanSrc[`${item.id}_${pidx}`], itemPlanVps[`${item.id}_${pidx}`], curPage(), ML, y, CW, ih);
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
        { img: planImages[loc.id], vps: planVps[loc.id], src: planSrc[loc.id], annotations: loc.planAnnotations, breakId: `plan-${loc.id}` },
        ...(loc.extraPlans || []).map((ep, idx) => ({ img: extraPlanImages[`${loc.id}_${idx}`], vps: extraPlanVps[`${loc.id}_${idx}`], src: extraPlanSrc[`${loc.id}_${idx}`], annotations: ep.planAnnotations, breakId: `plan-${loc.id}_ep_${idx}` })),
      ].filter(p => p.img);

      if (allZonePlans.length > 0) {
        const allAnnotPaths = allZonePlans.flatMap(p => p.annotations?.paths || []);
        const combinedAnnot = allAnnotPaths.length ? { paths: allAnnotPaths } : null;
        const hasLeg = allAnnotPaths.some(p => p.type === 'symbol') || allAnnotPaths.some(p => p.type === 'viewpoint');
        const ih = CW * 0.46; // ~80mm — 2 plans + légende tiennent sur une page A4
        const legH = hasLeg ? 30 : 8;

        pb(22 + ih);
        secHdr(`Plan — ${loc.nom}`);
        allZonePlans.forEach(({ img: planImg, vps, src }, planI) => {
          const isLast = planI === allZonePlans.length - 1;
          // Saut de page forcé entre plans (via mode découpe)
          if (planI > 0 && pageBreaksSet.has(allZonePlans[planI].breakId)) {
            doc.addPage(); y = 18; hdr();
          } else {
            pb(ih + (isLast ? legH : 4));
          }
          try {
            const ext = planImg.startsWith('data:image/webp') ? 'WEBP' : planImg.startsWith('data:image/png') ? 'PNG' : 'JPEG';
            doc.addImage(planImg, ext, ML, y, CW, ih, undefined, 'FAST');
          } catch {}
          drawVpBadgesPdf(doc, vps, ML, y, CW, ih, RD); // Vxx vectoriels nets à tout zoom
          recordVectorJob(src, vps, curPage(), ML, y, CW, ih);
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
        { img: planImages[loc.id], vps: planVps[loc.id], src: planSrc[loc.id], annotations: loc.planAnnotations, breakId: null },
        ...(loc.extraPlans || []).map((ep, idx) => ({ img: extraPlanImages[`${loc.id}_${idx}`], vps: extraPlanVps[`${loc.id}_${idx}`], src: extraPlanSrc[`${loc.id}_${idx}`], annotations: ep.planAnnotations, breakId: `plan-${loc.id}_ep_${idx}` })),
      ].filter(p => p.img);
      if (!allZonePlans.length) return;

      const allAnnotPaths = allZonePlans.flatMap(p => p.annotations?.paths || []);
      const combinedAnnot = allAnnotPaths.length ? { paths: allAnnotPaths } : null;
      const ih = CW * 0.46;

      doc.addPage(); y = 18; hdr();
      secHdr(`Plan — ${loc.nom}`);
      allZonePlans.forEach(({ img: planImg, vps, src, breakId }, planI) => {
        if (planI > 0 && pageBreaksSet.has(breakId)) {
          doc.addPage(); y = 18; hdr();
        } else {
          pb(ih + 4);
        }
        try {
          const ext = planImg.startsWith('data:image/webp') ? 'WEBP' : planImg.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(planImg, ext, ML, y, CW, ih, undefined, 'FAST');
        } catch {}
        drawVpBadgesPdf(doc, vps, ML, y, CW, ih, RD); // Vxx vectoriels nets à tout zoom
        recordVectorJob(src, vps, curPage(), ML, y, CW, ih);
        y += ih + 4;
      });
      y = addPlanLegend(doc, combinedAnnot, y, ML, CW, W, MR, RD, GR, symbolIcons, vpIconUrl);
    });
  }

  // ── FOOTERS ───────────────────────────────────────────────────────────────────

  const tot = doc.getNumberOfPages();
  for (let i = 1; i <= tot; i++) { doc.setPage(i); ftr(i, tot); }

  // ── TÉLÉCHARGEMENT ────────────────────────────────────────────────────────────

  let blob = doc.output('blob');

  // ── VECTORISATION DES PLANS (pdf-lib) ────────────────────────────────────────────────
  // On repasse sur le PDF jsPDF et, pour chaque plan dont le PDF SOURCE est disponible, on
  // embarque la page source en VECTORIEL par-dessus le raster de repli (net à TOUT zoom, retour
  // Thomas), puis on redessine les Vxx en vectoriel au-dessus. Tout est en try/catch : la moindre
  // erreur laisse le PDF jsPDF (raster) intact → zéro régression possible.
  if (vectorPlanJobs.length) {
    try {
      // GARDE-FOU ANTI-BLOCAGE : toute la vectorisation est bornée à 30 s. Si le chargement de
      // pdf-lib ou l'embarquement traîne, on abandonne et on garde le PDF raster → le
      // téléchargement se déclenche TOUJOURS (retour Thomas : « rien ne s'ouvre à part le
      // générateur »). Le PDF raster (déjà prêt dans `blob`) reste le repli garanti.
      const newBlob = await Promise.race([
        (async () => {
      // Import dynamique : pdf-lib (~180 Ko gzip) n'est chargé qu'au moment d'exporter un rapport
      // avec des plans vectorisables → n'alourdit pas le démarrage de l'app (mobile).
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
      const srcBytes = await doc.output('arraybuffer');
      const outDoc = await PDFDocument.load(srcBytes);
      const font = await outDoc.embedFont(StandardFonts.HelveticaBold);
      const pages = outDoc.getPages();
      const MM = 72 / 25.4;               // mm → points PDF
      const red = rgb(227 / 255, 5 / 255, 19 / 255);
      const white = rgb(1, 1, 1);
      const embedCache = new Map();       // clé bytes+page → page embarquée (réutilise si même plan)
      let done = 0;
      for (const job of vectorPlanJobs) {
        try {
          const page = pages[job.page - 1];
          if (!page) continue;
          const cacheKey = `${job.pageIndex}:${job.bytes.length}:${job.bytes[job.bytes.length - 1]}`;
          let embedded = embedCache.get(cacheKey);
          if (!embedded) {
            [embedded] = await outDoc.embedPdf(job.bytes, [job.pageIndex]);
            embedCache.set(cacheKey, embedded);
          }
          const PH = page.getHeight();
          const xPt = job.x * MM, wPt = job.w * MM, hPt = job.h * MM;
          const yPt = PH - (job.y + job.h) * MM; // origine bas-gauche en pdf-lib
          // Fond blanc : masque le raster de repli (souvent une page PDF au fond transparent
          // laisserait voir le raster flou entre les traits vectoriels).
          page.drawRectangle({ x: xPt, y: yPt, width: wPt, height: hPt, color: white });
          page.drawPage(embedded, { x: xPt, y: yPt, width: wPt, height: hPt });
          // Vxx vectoriels PAR-DESSUS la page embarquée (sinon masqués par le plan)
          for (const vp of job.vps || []) {
            const cx = xPt + Math.min(1, Math.max(0, vp.fx)) * wPt;
            const cy = yPt + hPt - Math.min(1, Math.max(0, vp.fy)) * hPt; // fy compté depuis le haut
            const CONE = 9 * MM, A = 0.62;
            // cône (l'axe y du plan est vers le bas → on inverse le sinus pour l'espace PDF)
            page.drawLine({ start: { x: cx, y: cy }, end: { x: cx + Math.cos(vp.angle - A) * CONE, y: cy - Math.sin(vp.angle - A) * CONE }, thickness: 0.25 * MM, color: red });
            page.drawLine({ start: { x: cx, y: cy }, end: { x: cx + Math.cos(vp.angle + A) * CONE, y: cy - Math.sin(vp.angle + A) * CONE }, thickness: 0.25 * MM, color: red });
            page.drawCircle({ x: cx, y: cy, size: 1.4 * MM, color: red });
            page.drawCircle({ x: cx, y: cy, size: 0.55 * MM, color: white });
            if (vp.label) {
              const fs = 7, tw = font.widthOfTextAtSize(vp.label, fs);
              const bw = tw + 2.2 * MM, bh = 4 * MM;
              const bx = cx + 1.8 * MM, by = cy + 0.6 * MM; // pastille au-dessus du point
              page.drawRectangle({ x: bx, y: by, width: bw, height: bh, color: white, borderColor: red, borderWidth: 0.2 * MM });
              page.drawText(vp.label, { x: bx + (bw - tw) / 2, y: by + (bh - fs) / 2 + 0.5, size: fs, font, color: red });
            }
          }
          done++;
        } catch (e) { console.warn('[PDF] vectorisation plan échouée (repli raster):', e); }
      }
      diag.vectorized = done;
      if (done > 0) {
        const outBytes = await outDoc.save();
        return new Blob([outBytes], { type: 'application/pdf' });
      }
      return null;
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('vectorisation timeout 30s')), 30000)),
      ]);
      if (newBlob) { blob = newBlob; console.log(`[PDF] Plans vectorisés : ${diag.vectorized}/${vectorPlanJobs.length}`); }
    } catch (e) { console.warn('[PDF] vectorisation ignorée (PDF raster conservé) :', e?.message || e); }
  }

  const diagLine = `Plans ${diag.plans} · HD ${diag.hd} · miniature ${diag.thumb} · PDF source ${diag.src} · vectorisés ${diag.vectorized} · ${(blob.size / 1048576).toFixed(1)} Mo`;
  console.log(`[PDF] ${diagLine}`);
  const url = URL.createObjectURL(blob);
  const safeName   = (projet.nom      || 'Projet').replace(/[^a-zA-Z0-9À-ž _-]/g, '').trim();
  const safeVisite = (projet.visiteNom || '').replace(/[^a-zA-Z0-9À-ž _-]/g, '').trim();
  const filename   = safeVisite
    ? `${safeName} - CR ${safeVisite}.pdf`
    : `${safeName} - CR.pdf`;

  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
    // Mobile : feuille « Rapport prêt » + partage natif. L'ancien window.open(blob)
    // remplaçait l'app par le PDF en PWA installée (standalone = pas de barre de
    // navigation) → aucun moyen de revenir, il fallait tuer l'app.
    showPdfReadySheet(blob, url, filename, diagLine);
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

// Feuille « Rapport prêt » (mobile). Le partage natif (navigator.share) affiche la feuille
// iOS/Android PAR-DESSUS l'app — on n'en sort jamais, contrairement à window.open(blob).
// Passer par un bouton garantit aussi le "user gesture" exigé par iOS : un share appelé
// directement après les longues secondes de génération serait rejeté (NotAllowedError).
function showPdfReadySheet(blob, url, filename, diagLine = '') {
  const id = '__pdf_ready__';
  document.getElementById(id)?.remove();
  const wrap = document.createElement('div');
  wrap.id = id;
  wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;';
  const sheet = document.createElement('div');
  sheet.style.cssText = 'background:#fff;border-radius:16px 16px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom,0px));width:100%;max-width:480px;display:flex;flex-direction:column;gap:10px;font-family:inherit;';
  const title = document.createElement('p');
  title.style.cssText = 'margin:0;font-size:15px;font-weight:800;color:#222;';
  title.textContent = 'Rapport PDF prêt';
  const sub = document.createElement('p');
  sub.style.cssText = 'margin:0 0 6px;font-size:12px;color:#777;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  sub.textContent = filename;
  // Ligne de diagnostic plans (temporaire) : permet de comprendre en un coup d'œil, sur mobile,
  // pourquoi un plan resterait flou (image HD absente ? PDF source absent ? vectorisé ou non ?).
  const diagEl = document.createElement('p');
  diagEl.style.cssText = 'margin:-4px 0 4px;font-size:10.5px;color:#aaa;line-height:1.3;';
  if (diagLine) diagEl.textContent = '🔎 ' + diagLine;
  const shareBtn = document.createElement('button');
  shareBtn.style.cssText = 'width:100%;padding:14px;border:none;border-radius:12px;background:#E30513;color:#fff;font-size:14px;font-weight:800;cursor:pointer;';
  shareBtn.textContent = 'Enregistrer / Partager';
  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'width:100%;padding:12px;border:1px solid #E5E5E5;border-radius:12px;background:#fff;color:#555;font-size:13px;font-weight:600;cursor:pointer;';
  closeBtn.textContent = 'Fermer';
  const cleanup = () => { wrap.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
  shareBtn.onclick = async () => {
    const file = new File([blob], filename, { type: 'application/pdf' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        cleanup();
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return; // partage annulé — garder la feuille pour réessayer
    }
    // Repli (share fichiers indisponible) : ancre de téléchargement — Android télécharge,
    // iOS Safari ouvre un onglet AVEC barre de navigation (retour possible).
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener'; a.target = '_blank';
    document.body.appendChild(a); a.click(); a.remove();
    cleanup();
  };
  closeBtn.onclick = cleanup;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) cleanup(); });
  sheet.append(title, sub);
  if (diagLine) sheet.append(diagEl);
  sheet.append(shareBtn, closeBtn);
  wrap.append(sheet);
  document.body.appendChild(wrap);
}
