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

// ─── Rendu d'une page PDF en image PNG ────────────────────────────────────────
export async function renderPdfPage(pdfData, pageNum) {
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
    const vp = pg.getViewport({ scale: 2.5 });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width);
    cv.height = Math.round(vp.height);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const result = cv.toDataURL('image/png');
    cv.width = 0;
    cv.height = 0;
    return result;
  } catch (e) {
    console.error('renderPdfPage:', e);
    return null;
  }
}
