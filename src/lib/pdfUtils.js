// ─── PDF.js loader ──────────────────────────────────────────────────────────
const PDFJS_CANDIDATES = [
  { main: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', id: 'lib-pdfjs-jsdelivr' },
  { main: 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js', id: 'lib-pdfjs-unpkg' },
  { main: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.min.js', id: 'lib-pdfjs-cdnjs2' },
];
const JSPDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

const _loaded = {};

function loadScript(src, id, globalKey) {
  if (_loaded[id]) {
    return globalKey && window[globalKey]
      ? Promise.resolve()
      : Promise.reject(new Error(`Script ${id} déjà chargé mais global manquant`));
  }
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      _loaded[id] = true;
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.id = id;
    el.src = src;
    el.onload = () => { _loaded[id] = true; resolve(); };
    el.onerror = () => reject(new Error(`Impossible de charger ${src}`));
    document.head.appendChild(el);
  });
}

let _pdfjsReady = null;
export async function ensurePdfJs() {
  if (_pdfjsReady) return _pdfjsReady;
  _pdfjsReady = (async () => {
    for (const cdn of PDFJS_CANDIDATES) {
      try {
        await loadScript(cdn.main, cdn.id, 'pdfjsLib');
        if (window.pdfjsLib) break;
      } catch (e) {
        console.warn(`PDF.js CDN failed (${cdn.id}):`, e.message);
        _loaded[cdn.id] = false;
      }
    }
    if (!window.pdfjsLib) throw new Error('Impossible de charger PDF.js depuis tous les CDN');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  })();
  return _pdfjsReady;
}

export async function ensureJsPDF() {
  return loadScript(JSPDF_CDN, 'lib-jspdf', 'jspdf');
}

// ─── Conversion base64/dataURL → Uint8Array ──────────────────────────────────
export function pdfDataToBuffer(pdfData) {
  try {
    const b64 = pdfData.includes(',') ? pdfData.split(',')[1] : pdfData;
    const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
    const binary = atob(clean);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    return buf;
  } catch (e) {
    throw new Error(`Conversion PDF échouée : ${e.message}`);
  }
}

// ─── Rendu d'une page PDF en image WebP ──────────────────────────────────────
// Limite d'aire canvas — iOS Safari plafonne à ~16,7 M px par canvas ; les navigateurs
// desktop acceptent bien plus : on monte à 64 M px hors iOS pour des plans NETS au zoom
// (demande Thomas : « importe-les tels que je les vois en PDF, en très haute qualité »).
const _isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const MAX_CANVAS_AREA = _isIOS ? 16_000_000 : 64_000_000;

async function _renderPage(pdfData, pageNum, maxScale, maxWidth, quality) {
  try {
    await ensurePdfJs();
    if (!window.pdfjsLib || !pdfData) return null;
    const buf = pdfDataToBuffer(pdfData);
    const pdf = await window.pdfjsLib.getDocument({
      data: buf,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    const pg = await pdf.getPage(pageNum);
    const rawVp = pg.getViewport({ scale: 1 });
    let scale = Math.min(maxScale, maxWidth / rawVp.width);
    let vp = pg.getViewport({ scale });
    // Garde-fou iOS : ne jamais dépasser l'aire max canvas
    if (vp.width * vp.height > MAX_CANVAS_AREA) {
      scale *= Math.sqrt(MAX_CANVAS_AREA / (vp.width * vp.height));
      vp = pg.getViewport({ scale });
    }
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width);
    cv.height = Math.round(vp.height);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const result = cv.toDataURL('image/webp', quality);
    cv.width = 0;
    cv.height = 0;
    return result;
  } catch (e) {
    console.error('renderPdfPage:', e);
    return null;
  }
}

// Rendu standard — image d'AFFICHAGE stockée (cache + Supabase, affichage immédiat).
// 2400px max / scale 6.0 : l'image d'affichage est désormais NETTE directement — pour annoter
// ET consulter les plans sans dépendre du swap HD (fragile/lent : HD ou PDF source pas toujours
// dispo). 2400px = plafond EXACT du rendu rapport (RapportPreview MAXW) → les annotations, dont
// les coordonnées sont relatives à cette image, tombent au pixel près sur le rapport (aucun
// décalage). L'image HD séparée (renderPdfPageHQ) reste un bonus de netteté au zoom.
// (Demande Thomas 2026-07-10 : « directement tout en haute qualité pour éviter tout problème ».)
export function renderPdfPage(pdfData, pageNum) {
  return _renderPage(pdfData, pageNum, 6.0, 2400, 0.9);
}

// Rendu de PLUSIEURS pages en une passe : parse le PDF UNE seule fois (au lieu d'un
// getDocument par page) et rend les pages en parallèle par lots. Énorme gain à l'import
// (10 pages = 1 parse + rendus concurrents, au lieu de 10 parses séquentiels).
export async function renderPdfPages(pdfData, pageNums, {
  maxScale = 6.0, maxWidth = 2400, quality = 0.9, concurrency = 4, onProgress,
} = {}) {
  await ensurePdfJs();
  if (!window.pdfjsLib || !pdfData || !pageNums?.length) return [];
  const buf = pdfDataToBuffer(pdfData);
  const pdf = await window.pdfjsLib.getDocument({
    data: buf, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true,
  }).promise;
  const out = [];
  let done = 0;
  const renderOne = async (pageNum) => {
    try {
      const pg = await pdf.getPage(pageNum);
      const rawVp = pg.getViewport({ scale: 1 });
      let scale = Math.min(maxScale, maxWidth / rawVp.width);
      let vp = pg.getViewport({ scale });
      if (vp.width * vp.height > MAX_CANVAS_AREA) {
        scale *= Math.sqrt(MAX_CANVAS_AREA / (vp.width * vp.height));
        vp = pg.getViewport({ scale });
      }
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      const img = cv.toDataURL('image/webp', quality);
      cv.width = 0; cv.height = 0;
      return { num: pageNum, img };
    } catch (e) {
      console.error('renderPdfPages page', pageNum, e);
      return { num: pageNum, img: null };
    } finally {
      onProgress?.(++done, pageNums.length);
    }
  };
  for (let i = 0; i < pageNums.length; i += concurrency) {
    const res = await Promise.all(pageNums.slice(i, i + concurrency).map(renderOne));
    out.push(...res);
  }
  try { pdf.destroy(); } catch {}
  return out;
}

// Rendu haute qualité — image HD stockée dans Supabase Storage, affichée dans l'annotateur
// et la visionneuse. Plafonné à 3600 px (au lieu de 6500) : une image > ~16 Mpx ne se décode
// PAS sur mobile (iOS surtout) → le HD « ne chargeait pas » sur téléphone et le plan restait
// pixelisé (retour Thomas). 3600 px reste très net (~480 dpi A4) ET s'affiche sur tous les
// appareils. L'image HD doit passer sur le plus faible appareil (le mobile), pas seulement le PC.
export function renderPdfPageHQ(pdfData, pageNum) {
  return _renderPage(pdfData, pageNum, 10.0, 3600, 0.85);
}

// Cache des documents PDF.js parsés (clé = data URL) — parser un gros PDF coûte plusieurs
// secondes ; la loupe vectorielle le réutilise à chaque re-rendu de région.
const _docCache = new Map();
async function getPdfDoc(pdfData) {
  if (_docCache.has(pdfData)) return _docCache.get(pdfData);
  const promise = (async () => {
    await ensurePdfJs();
    const buf = pdfDataToBuffer(pdfData);
    return window.pdfjsLib.getDocument({ data: buf, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
  })();
  if (_docCache.size >= 2) { const k = _docCache.keys().next().value; _docCache.delete(k); } // borne mémoire
  _docCache.set(pdfData, promise);
  return promise;
}

// LOUPE VECTORIELLE : rendu d'une RÉGION de page (fx/fy/fw/fh en fractions 0..1 de la page,
// outWidth en px). Le canvas ne couvre que la zone visible → rapide, sous toutes les limites
// canvas (iPhone compris), et net « tel que le PDF » à n'importe quel niveau de zoom.
export async function renderPdfRegion(pdfData, pageNum, { fx, fy, fw, fh, outWidth = 2048 }) {
  try {
    const pdf = await getPdfDoc(pdfData);
    const pg = await pdf.getPage(pageNum);
    const vp1 = pg.getViewport({ scale: 1 });
    let scale = outWidth / (vp1.width * fw);
    let cw = Math.round(outWidth);
    let ch = Math.round(vp1.height * fh * scale);
    // Garde-fou aire canvas (iOS 16 Mpx) : réduit l'échelle si la région dépasse, plutôt
    // que d'abandonner → on rend toujours quelque chose de plus net que l'aperçu.
    if (cw * ch > MAX_CANVAS_AREA) {
      const k = Math.sqrt(MAX_CANVAS_AREA / (cw * ch));
      scale *= k; cw = Math.round(cw * k); ch = Math.round(ch * k);
    }
    const vp = pg.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    if (!cv.width || !cv.height) return null;
    await pg.render({
      canvasContext: cv.getContext('2d'), viewport: vp,
      // Décalage en px « device » : cadre la région (même mécanique que le rendu HiDPI).
      transform: [1, 0, 0, 1, -vp1.width * fx * scale, -vp1.height * fy * scale],
    }).promise;
    const out = cv.toDataURL('image/webp', 0.9);
    cv.width = 0; cv.height = 0;
    return out;
  } catch (e) { console.warn('renderPdfRegion:', e); return null; }
}

// Convertit la 1re page d'un FICHIER PDF en image (data URL) — utilisé pour la photo de
// couverture de projet (importer directement la page de garde d'un DCE, demande Thomas).
// Renvoie null en cas d'échec (PDF illisible, CDN indisponible…).
export function pdfFileToImageDataUrl(file, pageNum = 1) {
  return new Promise((resolve) => {
    try {
      const rd = new FileReader();
      rd.onload  = () => renderPdfPage(rd.result, pageNum).then(resolve).catch(() => resolve(null));
      rd.onerror = () => resolve(null);
      rd.readAsDataURL(file);
    } catch { resolve(null); }
  });
}
