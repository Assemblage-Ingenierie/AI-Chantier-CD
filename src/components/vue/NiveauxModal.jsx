import React, { useState, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import EditTitle from '../ui/EditTitle.jsx';
import { renderPdfPage, renderPdfPageHQ } from '../../lib/pdfUtils.js';
import { fetchPlanHdDataUrl, fetchPlanData, fetchPlanPdfByBase } from '../../lib/storage.js';
import { setPlanHd } from '../../lib/planThumbCache.js';
import PdfPagePicker from './PdfPagePicker.jsx';

// Pages issues d'un import PDF : nommées « NomDuPdf — Page N ».
const PDF_PAGE_RE = /\s*—\s*Page\s*(\d+)\s*$/i;

// Retrouve le PDF source (vectoriel) d'un groupe de plans : mémoire (import frais) → Storage
// (chemin déterministe par base) → repli legacy (colonne data). Renvoie null si aucun PDF source.
async function getGroupSourcePdf(group, projetId) {
  const inMem = (group.pages || []).find(pg => typeof pg.data === 'string' && pg.data.startsWith('data:application/pdf'));
  if (inMem) return inMem.data;
  try {
    if (projetId) {
      const pdf = await fetchPlanPdfByBase(projetId, group.nom);
      if (typeof pdf === 'string' && pdf.startsWith('data:application/pdf')) return pdf;
    }
  } catch { /* pas de PDF stocké */ }
  try {
    const fd = await fetchPlanData((group.pages || [])[0]?.id);
    if (typeof fd?.data === 'string' && fd.data.startsWith('data:application/pdf')) return fd.data;
  } catch { /* pas de PDF en base */ }
  return null;
}

// Convertit un PDF (data URL) en blob object URL (à ouvrir dans la visionneuse native de l'OS :
// qualité VECTORIELLE parfaite à tout zoom, fluide car accélérée matériellement). Renvoie null si
// ce n'est pas un PDF. La conversion est SYNCHRONE → utilisable dans un user-gesture.
function pdfToBlobUrl(pdf) {
  if (!pdf || !pdf.startsWith('data:application/pdf')) return null;
  try {
    const b64 = pdf.split(',')[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  } catch { return null; }
}

// ── Visionneuse « Consulter les plans » ────────────────────────────────────────
// Deux modes (demande Thomas : sur PC le transform maison n'était « pas du tout pratique ») :
//  - tactile (pointer: coarse)  → gestes pincement/déplacement/double-tap (ConsultViewerTouch)
//  - PC                          → lecteur PDF CLASSIQUE : défilement natif (molette,
//    scrollbars), barre de zoom − / % / +, Ctrl+molette = zoom, cliquer-glisser = déplacer.
function ConsultViewer({ group, projetId = null, onClose }) {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
  // QUALITÉ (demande Thomas : « les plans importés sont d'une super mauvaise qualité ») :
  // l'aperçu standard (bg, 1600 px) est illisible une fois zoomé. Chaque page est upgradée
  // vers son image HD dès que possible — même chaîne de repli que l'annotateur :
  // HD en mémoire (import frais) → Storage/IndexedDB (fetchPlanHdDataUrl) → rendu HQ
  // depuis le PDF brut s'il est présent. Le bg reste affiché en attendant (swap sans saut).
  const [hdById, setHdById] = useState({});
  const hdRef = useRef({}); hdRef.current = hdById;
  const pendingHd = useRef(new Set());
  // PDF source PARTAGÉ par tout le groupe : récupéré UNE seule fois. Avant, chaque PAGE
  // re-téléchargeait le document COMPLET depuis la base (le même PDF de 30-40 Mo, 18 fois
  // pour 18 pages) → « charger le moindre PDF prend beaucoup trop de temps » (Thomas).
  const groupPdfRef = useRef({ key: null, val: null });
  const getGroupPdf = async () => {
    if (groupPdfRef.current.key === group.nom && typeof groupPdfRef.current.val === 'string') return groupPdfRef.current.val; // succès mémorisé
    const pdf = await getGroupSourcePdf(group, projetId);
    if (typeof pdf === 'string') groupPdfRef.current = { key: group.nom, val: pdf }; // ne mémorise QUE les succès
    return pdf; // échec (null) NON mémorisé → réessai possible (upload en cours)
  };
  // Chargement HD À LA DEMANDE d'une page — chaque viewer décide QUAND.
  const loadHd = async (p) => {
    if (!p?.id || hdRef.current[p.id] || pendingHd.current.has(p.id)) return;
    pendingHd.current.add(p.id);
    try {
      let hd = (typeof p.hd === 'string' && p.hd.startsWith('data:')) ? p.hd : null;
      if (!hd) hd = await fetchPlanHdDataUrl(p.id);
      let rendered = false;
      // Si aucune HD stockée : rendre depuis le PDF source (mémoire ou base — récupéré une
      // seule fois pour tout le groupe) — « tel que le PDF ». Mobile compris, page par page.
      if (!hd) {
        const pdf = await getGroupPdf();
        if (pdf) {
          hd = await renderPdfPageHQ(pdf, p._page || 1);
          rendered = !!hd;
        }
      }
      if (hd) {
        // Persister la HQ rendue à la volée (IndexedDB, même clé que les HD téléchargées) :
        // instantanée aux prochaines ouvertures, y compris hors ligne.
        if (rendered) setPlanHd(p.id, hd);
        setHdById(h => ({ ...h, [p.id]: hd }));
      }
    } catch { /* le bg reste affiché */ }
  };
  // PC (défilement natif, pas de transform) : toutes les HD en séquence.
  // MOBILE : le viewer tactile demande la HD des pages PROCHES du viewport (fluidité) ;
  // en parallèle, après 1,5 s, on PRÉ-remplit doucement le cache HD des autres pages
  // (téléchargement seul, sans affichage) pour que le feuilletage soit ensuite instantané.
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    if (!coarse) {
      (async () => {
        for (const p of (group.pages || [])) {
          if (cancelled) return;
          await loadHd(p);
        }
      })();
    } else {
      timer = setTimeout(async () => {
        for (const p of (group.pages || [])) {
          if (cancelled) return;
          try { await fetchPlanHdDataUrl(p.id); } catch { /* best-effort */ }
        }
      }, 1500);
    }
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [group]); // eslint-disable-line react-hooks/exhaustive-deps
  return coarse
    ? <ConsultViewerTouch group={group} hdById={hdById} loadHd={loadHd} onClose={onClose}/>
    : <ConsultViewerDesktop group={group} hdById={hdById} onClose={onClose}/>;
}

// Lecteur classique PC : les pages empilées dans un conteneur à défilement NATIF.
// Le zoom change simplement la largeur du contenu (% du viewport) — le navigateur gère
// scrollbars et molette tout seul, comme un vrai viewer PDF.
// Interface MINIMALE (demande Thomas) : croix flottante + pilule de zoom, rien d'autre.
function ConsultViewerDesktop({ group, hdById = {}, onClose }) {
  const [z, setZ] = useState(1); // 1 = adapté à la largeur
  const zRef = useRef(z); zRef.current = z;
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const anchorRef = useRef(null); // point focal à préserver pendant le changement de zoom

  // Zoom en conservant le point focal. La correction de défilement est appliquée dans un
  // useLayoutEffect (APRÈS la mise en page, AVANT l'affichage) : l'ancien requestAnimationFrame
  // corrigeait une frame trop tard → « la page saute de partout » (retour Thomas).
  const setZoom = (nzRaw, fx = null, fy = null) => {
    const el = scrollRef.current;
    const nz = Math.max(0.3, Math.min(16, nzRaw));
    if (el && nz !== zRef.current) {
      const rect = el.getBoundingClientRect();
      anchorRef.current = {
        px: fx != null ? fx - rect.left : rect.width / 2,
        py: fy != null ? fy - rect.top : rect.height / 2,
        sl: el.scrollLeft, st: el.scrollTop, oldZ: zRef.current, nz,
      };
    }
    setZ(nz);
  };
  useLayoutEffect(() => {
    const a = anchorRef.current, el = scrollRef.current;
    if (!a || !el) return;
    anchorRef.current = null;
    const ratio = a.nz / a.oldZ;
    el.scrollLeft = (a.sl + a.px) * ratio - a.px;
    el.scrollTop  = (a.st + a.py) * ratio - a.py;
  }, [z]);

  // Échap ferme le plan.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Molette gérée EXPLICITEMENT (listener natif non-passif) : défilement garanti du
  // conteneur — le natif était avalé chez Thomas (« j'ai plus de molette ») —
  // Ctrl/⌘ + molette = zoom, Maj + molette = défilement horizontal.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheelNative = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setZoom(zRef.current * (e.deltaY < 0 ? 1.15 : 0.87), e.clientX, e.clientY);
      } else if (e.shiftKey) {
        el.scrollLeft += (e.deltaY || e.deltaX);
      } else {
        el.scrollTop  += e.deltaY;
        el.scrollLeft += e.deltaX;
      }
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cliquer-glisser pour se déplacer (en plus des scrollbars/molette).
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    // Ne pas capturer un clic sur les scrollbars natives (elles gèrent leur propre drag).
    const r = el.getBoundingClientRect();
    if (e.clientX - r.left > el.clientWidth || e.clientY - r.top > el.clientHeight) return;
    dragRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    try { el.setPointerCapture(e.pointerId); } catch { /* iOS anciens */ }
  };
  const onPointerMove = (e) => {
    const d = dragRef.current, el = scrollRef.current;
    if (!d || !el) return;
    el.scrollLeft = d.sl - (e.clientX - d.x);
    el.scrollTop  = d.st - (e.clientY - d.y);
  };
  const onPointerUp = () => { dragRef.current = null; };

  const zBtn = { width:38, height:38, borderRadius:9, border:'none', background:'transparent',
    color:'rgba(255,255,255,0.9)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
    flexShrink:0, fontSize:19, fontWeight:800, lineHeight:1 };

  return (
    <div style={{ position:'fixed',inset:0,background:'#111',zIndex:80 }}>
      {/* Croix flottante — plus GRANDE mais discrète (demande Thomas), aucune autre info */}
      <button onClick={onClose} aria-label="Fermer" title="Fermer (Échap)"
        style={{ position:'absolute', top:12, right:14, width:48, height:48, borderRadius:14, border:'none',
          background:'rgba(20,20,20,0.55)', color:'rgba(255,255,255,0.9)', display:'flex', alignItems:'center',
          justifyContent:'center', cursor:'pointer', zIndex:5, backdropFilter:'blur(2px)' }}>
        <Ic n="x" s={22}/>
      </button>
      {/* Pilule de zoom flottante — le % remet à la largeur */}
      <div style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)', display:'flex',
        alignItems:'center', gap:2, background:'rgba(20,20,20,0.55)', borderRadius:12, padding:3, zIndex:5, backdropFilter:'blur(2px)' }}>
        <button onClick={() => setZoom(zRef.current / 1.25)} title="Zoom arrière" style={zBtn}>−</button>
        <button onClick={() => setZoom(1)} title="Adapter à la largeur"
          style={{ ...zBtn, width:'auto', padding:'0 10px', fontSize:12.5, fontWeight:700 }}>
          {Math.round(z * 100)} %
        </button>
        <button onClick={() => setZoom(zRef.current * 1.25)} title="Zoom avant" style={zBtn}>+</button>
      </div>
      {/* position:absolute inset:0 → hauteur GARANTIE (le flex:1 sans parent flex, introduit
          en retirant la barre du haut, laissait le conteneur sans hauteur → ni molette ni
          cliquer-glisser possibles). La molette est gérée par le listener natif ci-dessus. */}
      <div ref={scrollRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ position:'absolute', inset:0, overflow:'auto', cursor: dragRef.current ? 'grabbing' : 'grab' }}>
        <div style={{ width:`${z * 100}%`, margin:'0 auto', padding:'10px 0' }}>
          {group.pages.map(p => (
            <div key={p.id} style={{ position:'relative', marginBottom:8 }}>
              {(hdById[p.id] || p.bg)
                ? <img src={hdById[p.id] || p.bg} alt="" draggable={false}
                    style={{ width:'100%',display:'block',background:'white',pointerEvents:'none',userSelect:'none' }}/>
                : <div style={{ padding:'40px 0',textAlign:'center',color:'rgba(255,255,255,0.5)',fontSize:12,background:'#222' }}>Page {p._page} — image non disponible sur cet appareil</div>}
              <span style={{ position:'absolute',bottom:8,right:8,background:'rgba(0,0,0,0.65)',color:'white',fontSize:11,fontWeight:700,borderRadius:6,padding:'3px 8px' }}>
                Page {p._page}
              </span>
              {!hdById[p.id] && p.bg && (
                <span style={{ position:'absolute',bottom:8,left:8,display:'inline-flex',alignItems:'center',gap:4,background:'rgba(0,0,0,0.65)',color:'white',fontSize:10,fontWeight:700,borderRadius:6,padding:'3px 7px' }}>
                  <Ic n="spn" s={10}/> HD…
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Visionneuse TACTILE (mobile/tablette) ──────────────────────────────────────
// Toutes les pages du PDF à la suite. Gestes naturels (demande Thomas : pas de boutons) :
// pincement = zoom, un doigt = déplacement, double-tap = zoom ×2.5 / retour. Transform
// translate+scale maison car le zoom navigateur est désactivé dans la PWA (user-scalable=no).
function ConsultViewerTouch({ group, hdById = {}, loadHd = null, onClose }) {
  const [t, setT] = useState({ z: 1, x: 0, y: 0 });
  const boxRef   = useRef(null);   // conteneur visible (viewport)
  const innerRef = useRef(null);   // contenu (colonne de pages, largeur = viewport à z=1)
  const ptrs     = useRef(new Map());  // pointerId → {x,y}
  const gestRef  = useRef(null);       // instantané du geste { t, pts:[{x,y}…] }
  const tRef     = useRef(t); tRef.current = t;
  const lastTap  = useRef({ ts: 0, x: 0, y: 0 });
  const MAX_Z = 16; // « je ne peux pas zoomer assez » — la loupe vectorielle garde ça net

  // ── ROTATION MANUELLE (le téléphone peut bloquer la rotation auto) ─────────────
  // Bouton ↻ : la visionneuse entière pivote de 90° (astuce 100vh×100vw centrée).
  // Les coordonnées des doigts sont re-projetées dans le repère pivoté.
  const [rot, setRot] = useState(false);
  const rotRef = useRef(rot); rotRef.current = rot;
  const pt = (cx, cy) => rotRef.current ? { x: cy, y: window.innerWidth - cx } : { x: cx, y: cy };

  // ── LOUPE VECTORIELLE : au zoom fort, la RÉGION visible est re-rendue depuis le
  //    PDF source → netteté « telle que le PDF » quel que soit le zoom (et l'iPhone
  //    dont le canvas est limité n'a plus besoin d'images géantes). ────────────────

  // ── FLUIDITÉ (retour Thomas : « ça lag de zinzin au zoom ») ────────────────────
  // La HD (6500 px) n'est affichée QUE pour les pages proches du viewport (±1 écran) ;
  // les autres restent sur l'aperçu léger. La HD ne se télécharge aussi qu'à l'approche.
  const [visIds, setVisIds] = useState(() => new Set());
  const visRef = useRef(visIds); visRef.current = visIds;
  const pageEls = useRef(new Map()); // pageId → élément DOM (offsetTop/offsetHeight)
  const pageById = useRef(new Map());
  useEffect(() => { pageById.current = new Map((group.pages || []).map(p => [p.id, p])); }, [group]);
  const visRaf = useRef(0);
  const scheduleVis = () => {
    if (visRaf.current) return;
    visRaf.current = requestAnimationFrame(() => {
      visRaf.current = 0;
      const box = boxRef.current;
      if (!box) return;
      const { z, y } = tRef.current;
      const vh = box.clientHeight;
      const margin = vh / z;                       // ±1 écran (en coordonnées contenu)
      const top = (-y) / z - margin, bot = (vh - y) / z + margin;
      const next = new Set();
      for (const [id, el] of pageEls.current) {
        if (el && el.offsetTop < bot && el.offsetTop + el.offsetHeight > top) next.add(id);
      }
      const prev = visRef.current;
      if (next.size !== prev.size || [...next].some(id => !prev.has(id))) {
        setVisIds(next);
        if (loadHd) for (const id of next) { if (!prev.has(id)) loadHd(pageById.current.get(id)); }
      }
    });
  };
  useEffect(() => { scheduleVis(); }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ROTATION (demande Thomas : « quand je tourne mon tel, ça doit tourner le PDF ») ──
  // Le manifest verrouille l'app en portrait ; pendant la consultation d'un plan on
  // AUTORISE toutes les orientations, puis on rend la main au manifest à la fermeture.
  // (iOS ne supporte pas lock() mais n'applique pas non plus le verrou manifest → no-op.)
  const arRef = useRef(null);
  useEffect(() => {
    try { screen.orientation?.lock?.('any').catch(() => {}); } catch { /* non supporté */ }
    const onResize = () => {
      fitApplied.current = false;
      if (arRef.current) applyFit(arRef.current);
      scheduleVis();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      try { screen.orientation?.unlock?.(); } catch { /* non supporté */ }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Zoom minimal = « page ENTIÈRE visible » (fix PC : la vue s'ouvrait calée sur la largeur →
  // impression de zoom, et impossible de dézoomer sous 100 %). Calculé au chargement de la
  // première page, appliqué comme vue initiale (centrée).
  const [minZ, setMinZ] = useState(1);
  const minZRef = useRef(1); minZRef.current = minZ;
  const fitApplied = useRef(false);
  const applyFit = (ar) => {
    if (fitApplied.current) return;
    const box = boxRef.current;
    if (!box || !ar) return;
    fitApplied.current = true;
    arRef.current = ar; // mémorisé pour re-cadrer à la rotation de l'écran
    const vw = box.clientWidth, vh = box.clientHeight;
    const pageH = vw / ar;                       // hauteur affichée de la page à z=1 (largeur = vw)
    const fz = Math.min(1, vh / pageH);          // z pour voir la page en entier
    setMinZ(fz);
    const nt = { z: fz, x: (vw - vw * fz) / 2, y: 0 }; // centrée horizontalement
    tRef.current = nt;
    if (innerRef.current) innerRef.current.style.transform = `translate(${nt.x}px, ${nt.y}px) scale(${nt.z})`;
    setT(nt);
  };
  // Bascule rotation manuelle : re-cadrage après le changement de repère.
  useEffect(() => {
    fitApplied.current = false;
    const id = requestAnimationFrame(() => { if (arRef.current) applyFit(arRef.current); });
    return () => cancelAnimationFrame(id);
  }, [rot]); // eslint-disable-line react-hooks/exhaustive-deps

  const clampT = (nt) => {
    const box = boxRef.current, inner = innerRef.current;
    if (!box || !inner) return nt;
    const vw = box.clientWidth, vh = box.clientHeight;
    const cw = vw * nt.z;                       // largeur du contenu à l'échelle
    const ch = inner.offsetHeight * nt.z;       // hauteur naturelle × zoom
    const xMin = Math.min(0, vw - cw), xMax = Math.max(0, vw - cw);
    const yMin = Math.min(0, vh - ch), yMax = Math.max(0, vh - ch);
    return { z: nt.z, x: Math.max(xMin, Math.min(xMax, nt.x)), y: Math.max(yMin, Math.min(yMax, nt.y)) };
  };

  // ── FLUIDITÉ : pendant le geste, le transform est écrit DIRECTEMENT dans le DOM
  //    (zéro re-render React par frame). React n'est committé qu'en fin de geste. ──
  const applyT = (nt, commit = false) => {
    const v = clampT(nt);
    tRef.current = v;
    if (innerRef.current) innerRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    // On NE recalcule PAS la visibilité/charge HD pendant le geste (pinch/pan) : c'est ce
    // qui provoquait re-rendus (rigidité) et reflows (saut de page multi-pages). Uniquement
    // à la FIN du geste (commit) → geste 100% fluide, plus de saut (demande Thomas).
    if (commit) { setT(v); scheduleVis(); }
  };

  const snapshot = () => { gestRef.current = { t: { ...tRef.current }, pts: [...ptrs.current.values()].map(p => ({ ...p })) }; };

  const onDown = (e) => {
    boxRef.current?.setPointerCapture?.(e.pointerId);
    const c = pt(e.clientX, e.clientY);
    ptrs.current.set(e.pointerId, c);
    snapshot();
  };
  const onMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, pt(e.clientX, e.clientY));
    const g = gestRef.current;
    if (!g) return;
    const pts = [...ptrs.current.values()];
    if (pts.length >= 2 && g.pts.length >= 2) {
      // Pincement : zoom autour du point médian (le point du plan sous les doigts reste sous les doigts)
      const d0 = Math.hypot(g.pts[1].x - g.pts[0].x, g.pts[1].y - g.pts[0].y) || 1;
      const d1 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const z  = Math.max(minZRef.current, Math.min(MAX_Z, g.t.z * (d1 / d0)));
      const m0 = { x: (g.pts[0].x + g.pts[1].x) / 2, y: (g.pts[0].y + g.pts[1].y) / 2 };
      const m1 = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const cx = (m0.x - g.t.x) / g.t.z, cy = (m0.y - g.t.y) / g.t.z;
      applyT({ z, x: m1.x - cx * z, y: m1.y - cy * z });
    } else if (pts.length === 1 && g.pts.length >= 1) {
      // Un doigt : déplacement libre (vertical pour feuilleter, horizontal quand zoomé)
      applyT({ z: g.t.z, x: g.t.x + (pts[0].x - g.pts[0].x), y: g.t.y + (pts[0].y - g.pts[0].y) });
    }
  };
  const onUp = (e) => {
    const p = ptrs.current.get(e.pointerId);
    ptrs.current.delete(e.pointerId);
    const c = pt(e.clientX, e.clientY);
    // Double-tap : zoom ×2.5 centré sur le tap, ou retour à 100 %
    if (p && ptrs.current.size === 0 && gestRef.current?.pts.length === 1) {
      const moved = Math.hypot(c.x - gestRef.current.pts[0].x, c.y - gestRef.current.pts[0].y);
      const now = Date.now();
      if (moved < 12) {
        if (now - lastTap.current.ts < 320 && Math.hypot(c.x - lastTap.current.x, c.y - lastTap.current.y) < 40) {
          const cur = tRef.current;
          if (cur.z > minZRef.current * 1.05) {
            const box = boxRef.current;
            const vw = box ? box.clientWidth : 0;
            applyT({ z: minZRef.current, x: (vw - vw * minZRef.current) / 2, y: cur.y * (minZRef.current / cur.z) }, true);
          }
          else {
            const z = 2.5;
            const cx = (c.x - cur.x) / cur.z, cy = (c.y - cur.y) / cur.z;
            applyT({ z, x: c.x - cx * z, y: c.y - cy * z }, true);
          }
          lastTap.current = { ts: 0, x: 0, y: 0 };
        } else lastTap.current = { ts: now, x: c.x, y: c.y };
      }
    }
    if (ptrs.current.size === 0) applyT(tRef.current, true); // fin de geste → commit React + loupe
    snapshot(); // re-cale le geste sur les doigts restants (2 → 1 doigt sans saut)
  };
  const onWheel = (e) => {
    e.preventDefault();
    const cur = tRef.current;
    const c = pt(e.clientX, e.clientY);
    if (e.ctrlKey || e.metaKey) {
      const z = Math.max(minZRef.current, Math.min(MAX_Z, cur.z * (e.deltaY < 0 ? 1.15 : 0.87)));
      const cx = (c.x - cur.x) / cur.z, cy = (c.y - cur.y) / cur.z;
      applyT({ z, x: c.x - cx * z, y: c.y - cy * z }, true);
    } else {
      applyT({ ...cur, x: cur.x - e.deltaX, y: cur.y - e.deltaY }, true);
    }
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'#111',zIndex:80,overflow:'hidden' }}>
      {/* Interface MINIMALE : croix + rotation flottantes, rien d'autre. */}
      <button onClick={onClose} aria-label="Fermer"
        style={{ position:'absolute', top:'calc(env(safe-area-inset-top, 0px) + 10px)', right:12,
          width:48, height:48, borderRadius:14, border:'none', background:'rgba(20,20,20,0.55)',
          color:'rgba(255,255,255,0.9)', display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', zIndex:5, backdropFilter:'blur(2px)' }}>
        <Ic n="x" s={22}/>
      </button>
      {/* Rotation manuelle 90° — pour les téléphones dont la rotation auto est bloquée */}
      <button onClick={() => setRot(v => !v)} aria-label="Pivoter le plan" title="Pivoter le plan"
        style={{ position:'absolute', top:'calc(env(safe-area-inset-top, 0px) + 10px)', right:68,
          width:48, height:48, borderRadius:14, border:'none', background:'rgba(20,20,20,0.55)',
          color: rot ? '#FCA5A5' : 'rgba(255,255,255,0.9)', display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', zIndex:5, backdropFilter:'blur(2px)', fontSize:20 }}>
        ⟳
      </button>
      <div ref={boxRef}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onWheel={onWheel}
        style={rot
          ? { position:'fixed', top:'50%', left:'50%', width:'100vh', height:'100vw',
              transform:'translate(-50%, -50%) rotate(90deg)',
              overflow:'hidden', touchAction:'none', cursor:'grab' }
          : { position:'absolute', inset:0, overflow:'hidden', touchAction:'none', cursor:'grab' }}>
        <div ref={innerRef}
          style={{ width:'100%',transform:`translate(${tRef.current.x}px, ${tRef.current.y}px) scale(${tRef.current.z})`,transformOrigin:'0 0',willChange:'transform' }}>
          {group.pages.map((p, i) => {
            const vis = visIds.has(p.id);
            const src = (vis && hdById[p.id]) || p.bg || (vis ? hdById[p.id] : null);
            return (
            <div key={p.id} ref={el => { if (el) pageEls.current.set(p.id, el); else pageEls.current.delete(p.id); }}
              style={{ position:'relative',marginBottom:6 }}>
              {src
                ? <img src={src} alt="" draggable={false} decoding="async"
                    onLoad={i === 0 ? (e) => { applyFit(e.target.naturalWidth / e.target.naturalHeight); scheduleVis(); } : scheduleVis}
                    style={{ width:'100%',display:'block',background:'white',pointerEvents:'none',userSelect:'none' }}/>
                : <div style={{ padding:'40px 0',textAlign:'center',color:'rgba(255,255,255,0.5)',fontSize:12,background:'#222' }}>Page {p._page} — image non disponible sur cet appareil</div>}
              <span style={{ position:'absolute',bottom:8,right:8,background:'rgba(0,0,0,0.65)',color:'white',fontSize:11,fontWeight:700,borderRadius:6,padding:'3px 8px' }}>
                Page {p._page}
              </span>
              {vis && !hdById[p.id] && p.bg && (
                <span style={{ position:'absolute',bottom:8,left:8,display:'inline-flex',alignItems:'center',gap:4,background:'rgba(0,0,0,0.65)',color:'white',fontSize:10,fontWeight:700,borderRadius:6,padding:'3px 7px' }}>
                  <Ic n="spn" s={10}/> HD…
                </span>
              )}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function NiveauxModal({ localisations, planLibrary, onChange, onClose, onOpenPlanLib, onPickPlan, onDeletePlan, onDeleteAllPlans, onRenamePlan, onRepairBg, planFolders = [], onUpdateFolders = null, onReorderPlans = null, projetId = null }) {
  const [confirmDelPlanId, setConfirmDelPlanId] = useState(null);
  const [showImported, setShowImported] = useState(false); // liste des plans importés repliée par défaut (demande Thomas)
  // ── Cases de rangement (« bulles ») des PDF — demande Thomas : organiser ses plans
  // (DCE, Coffrage, Ferraillage…) pour les retrouver instantanément sur site. Stockées au
  // niveau projet (plan_folders, synchronisé entre appareils). bases = noms de base des PDF.
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingFolderNom, setEditingFolderNom] = useState('');
  const [renamePdf, setRenamePdf] = useState(null); // { base, val } — renommage du PDF ENTIER
  const [movePdf, setMovePdf] = useState(null);     // base du PDF dont le menu « ranger » est ouvert
  const [confirmDelPdf, setConfirmDelPdf] = useState(null); // base du PDF dont la suppression attend confirmation
  // Drag & drop des tuiles PDF (PC) : armé depuis l'icône « déplacer » de la tuile.
  // Déposer une tuile SUR une autre = regrouper les deux dans une case (demande Thomas).
  const [dragBase, setDragBase] = useState(null);       // base du PDF en cours de drag
  const [dragArmBase, setDragArmBase] = useState(null); // tuile armée (mousedown sur l'icône)
  const [dropHint, setDropHint] = useState(null);       // cible survolée (surbrillance)
  // Drag des CASES elles-mêmes (réorganiser les « grands titres » — demande Thomas).
  const [dragFolder, setDragFolder] = useState(null);       // id de la case en cours de drag
  const [dragArmFolder, setDragArmFolder] = useState(null); // case armée (mousedown sur sa poignée)
  const [folderDropHint, setFolderDropHint] = useState(null); // { id, after }
  // Réorganisation UNIFIÉE par barre d'insertion : index où l'élément déplacé sera inséré
  // dans la liste (tuiles + cases mélangées). Rendu simple et prévisible (demande Thomas).
  const [insertIdx, setInsertIdx] = useState(null);
  // Cible de REGROUPEMENT survolée (centre d'une tuile → créer une case ; centre d'une case
  // → y ranger). Coexiste avec insertIdx : centre = grouper, bords/gaps = réordonner.
  const [dropTarget, setDropTarget] = useState(null); // { kind:'tile'|'folder', id }
  const gridRef = useRef(null);
  // Groupes de « Plans importés » dépliés (TOUT est replié par défaut — demande Thomas).
  const [openImported, setOpenImported] = useState(() => new Set());
  // ── Déplacement TACTILE des tuiles (le glisser-déposer HTML5 ne marche pas au doigt —
  //    demande répétée de Thomas). Appui long sur la poignée → on suit le doigt, dépôt sur
  //    une autre tuile (milieu = regrouper, bord = réordonner), une case, ou « non rangés ».
  const [touchDrag, setTouchDrag] = useState(null); // { base, x, y, over }
  const touchDragRef = useRef(null); touchDragRef.current = touchDrag;
  // ⚠️ Tous les états utilisés par renderImportedRow/renderPdfTile sont déclarés ICI, AVANT
  // ces fonctions (règle TDZ de CLAUDE.md — incident du 2026-07-07).
  const [consultGroup, setConsultGroup] = useState(null); // groupe ouvert dans la visionneuse (repli)
  // Consulter un plan : ouvre le PDF NATIF (fluide + vectoriel, moteur PDF de l'OS) quand le PDF
  // source existe ; repli sur la visionneuse image sinon (plan importé en image, PDF pas encore
  // monté…). On pré-ouvre l'onglet de façon SYNCHRONE dans le geste — sinon iOS bloque le pop-up
  // après l'await du fetch. (Demande Thomas : « le PDF natif est super fluide, garder que le top ».)
  const openPlanConsult = (g) => {
    let win = null;
    try { win = window.open('', '_blank'); } catch { /* pop-up bloqué */ }
    (async () => {
      const pdf = await getGroupSourcePdf(g, projetId);
      const url = pdf ? pdfToBlobUrl(pdf) : null;
      if (url && win && !win.closed) {
        win.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
      }
      if (url) URL.revokeObjectURL(url);
      if (win && !win.closed) { try { win.close(); } catch { /* ignore */ } }
      setConsultGroup(g); // pas de PDF source (ou onglet bloqué) → visionneuse image dans l'app
    })();
  };
  const [confirmDelAll, setConfirmDelAll] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [editingPlanNom, setEditingPlanNom] = useState('');
  const [previewBg, setPreviewBg] = useState(null);
  const [repairTargetId, setRepairTargetId] = useState(null);
  const [repairPdfData, setRepairPdfData] = useState(null);
  const [showRepairPicker, setShowRepairPicker] = useState(false);
  const [repairingId, setRepairingId] = useState(null);
  const [repairErr, setRepairErr] = useState(null);
  const repairFileRef = useRef();
  // ── Consultation : toutes les pages d'un même PDF regroupées (demande Thomas : sur site,
  // feuilleter le document ENTIER au lieu d'ouvrir les plans un par un). Regroupement par
  // nom de base (« NomDuPdf — Page N » → « NomDuPdf »), pages triées par numéro.
  // ⚠️ DOIT être déclaré AVANT unassignedGroups/groupsByBase qui l'utilisent au rendu
  // (sinon TDZ : « Cannot access 'pdfGroups' before initialization » → app plantée).
  const pdfGroups = useMemo(() => {
    const map = new Map();
    for (const pl of (planLibrary || [])) {
      const m = String(pl.nom || '').match(PDF_PAGE_RE);
      const base = m ? pl.nom.replace(PDF_PAGE_RE, '').trim() : (pl.nom || 'Document');
      const page = m ? parseInt(m[1], 10) : 1;
      if (!map.has(base)) map.set(base, []);
      map.get(base).push({ ...pl, _page: page });
    }
    return [...map.entries()].map(([nom, pages]) => ({ nom, pages: pages.sort((a, b) => a._page - b._page) }));
  }, [planLibrary]);
  const folders = planFolders || [];
  const setFolders = (next) => { if (onUpdateFolders) onUpdateFolders(next); };
  const assignedBases = new Set(folders.flatMap(f => f.bases || []));
  const unassignedGroups = pdfGroups.filter(g => !assignedBases.has(g.nom));
  const groupsByBase = new Map(pdfGroups.map(g => [g.nom, g]));
  // (Les cases se créent uniquement par FUSION de deux tuiles — plus de bouton dédié.)
  const deleteFolder = (fid) => setFolders(folders.filter(f => f.id !== fid)); // ses PDF redeviennent « non rangés »
  // Réordonne les cases : la case déplacée s'insère avant/après la case cible.
  const reorderFolders = (draggedId, targetId, after) => {
    if (!draggedId || draggedId === targetId) return;
    const rest = folders.filter(f => f.id !== draggedId);
    const dragged = folders.find(f => f.id === draggedId);
    const idx = rest.findIndex(f => f.id === targetId);
    if (!dragged || idx < 0) return;
    const at = idx + (after ? 1 : 0);
    setFolders([...rest.slice(0, at), dragged, ...rest.slice(at)]);
  };
  const renameFolder = (fid, nom) => setFolders(folders.map(f => f.id === fid ? { ...f, nom } : f));
  const moveBase = (base, fid) => {
    setFolders(folders.map(f => ({ ...f, bases: (f.bases || []).filter(b => b !== base).concat(f.id === fid ? [base] : []) })));
    setMovePdf(null);
  };
  // Renomme le PDF ENTIER : toutes ses pages (« base — Page N » → « nouveau — Page N »)
  // + met à jour les références dans les cases.
  const renameWholePdf = (base, newBaseRaw) => {
    const newBase = (newBaseRaw || '').trim();
    const g = groupsByBase.get(base);
    if (!g || !newBase || newBase === base) { setRenamePdf(null); return; }
    for (const pg of g.pages) {
      const m = String(pg.nom || '').match(PDF_PAGE_RE);
      if (onRenamePlan) onRenamePlan(pg.id, m ? `${newBase} — Page ${pg._page}` : newBase);
    }
    setFolders(folders.map(f => ({ ...f, bases: (f.bases || []).map(b => b === base ? newBase : b) })));
    setRenamePdf(null);
  };
  // Ligne d'UN plan importé (vignette + renommage + réimport + suppression) — réutilisée
  // dans les bulles automatiques par PDF d'origine et pour les plans isolés.
  const renderImportedRow = (pl) => (
    <div key={pl.id} style={{ display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderRadius:8,border:`1px solid ${pl.bg ? DA.border : '#FCA5A5'}`,background:DA.white }}>
      {pl.bg
        ? <img src={pl.bg} alt="" onClick={() => setPreviewBg(pl.bg)} style={{ width:44,height:30,objectFit:'cover',borderRadius:5,border:`1px solid ${DA.border}`,flexShrink:0,cursor:'zoom-in' }}/>
        : <div style={{ width:44,height:30,borderRadius:5,border:'1px dashed #FCA5A5',flexShrink:0,background:'#FFF8F8',display:'flex',alignItems:'center',justifyContent:'center' }}><Ic n="img" s={14}/></div>
      }
      {editingPlanId === pl.id ? (
        <input autoFocus value={editingPlanNom}
          onChange={e => setEditingPlanNom(e.target.value)}
          onBlur={() => { if (editingPlanNom.trim() && onRenamePlan) onRenamePlan(pl.id, editingPlanNom.trim()); setEditingPlanId(null); }}
          onKeyDown={e => { if (e.key === 'Enter') { if (editingPlanNom.trim() && onRenamePlan) onRenamePlan(pl.id, editingPlanNom.trim()); setEditingPlanId(null); } if (e.key === 'Escape') setEditingPlanId(null); }}
          style={{ flex:1,fontSize:12,fontWeight:600,border:`1px solid ${DA.red}`,borderRadius:5,padding:'2px 6px',outline:'none',boxSizing:'border-box' }}/>
      ) : (
        <p onClick={() => { if (onRenamePlan) { setEditingPlanId(pl.id); setEditingPlanNom(pl.nom); } }}
          style={{ flex:1,fontSize:12,fontWeight:600,color:DA.black,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:onRenamePlan?'text':'default' }}>{pl.nom}</p>
      )}
      {!pl.bg && onRepairBg && (
        <button
          onClick={() => { setRepairTargetId(pl.id); repairFileRef.current.click(); }}
          disabled={repairingId === pl.id}
          title="Réimporter l'image de ce plan"
          style={{ padding:'3px 7px',color:'#B91C1C',background:'#FFF0F0',border:'1px solid #FCA5A5',borderRadius:5,cursor:'pointer',display:'flex',alignItems:'center',gap:3,fontSize:10,fontWeight:700,whiteSpace:'nowrap',flexShrink:0 }}>
          {repairingId === pl.id ? <Ic n="spn" s={11}/> : <Ic n="und" s={11}/>}
          Réimporter
        </button>
      )}
      {onDeletePlan && (confirmDelPlanId === pl.id ? (
        <>
          <button onClick={() => { onDeletePlan(pl.id); setConfirmDelPlanId(null); }}
            style={{ fontSize:11,fontWeight:700,padding:'3px 8px',background:'#B91C1C',color:'white',border:'none',borderRadius:5,cursor:'pointer' }}>Supprimer</button>
          <button onClick={() => setConfirmDelPlanId(null)}
            style={{ fontSize:11,padding:'3px 7px',background:'white',color:'#555',border:`1px solid ${DA.border}`,borderRadius:5,cursor:'pointer' }}>Non</button>
        </>
      ) : (
        <button onClick={() => setConfirmDelPlanId(pl.id)}
          style={{ padding:'4px 6px',color:'#ccc',background:'none',border:'none',cursor:'pointer',borderRadius:5,lineHeight:0 }}
          onMouseEnter={e=>e.currentTarget.style.color=DA.red} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
          <Ic n="del" s={13}/>
        </button>
      ))}
    </div>
  );

  // Supprime le PDF ENTIER (toutes ses pages) + nettoie les références dans les cases.
  const deleteWholePdf = (g) => {
    if (onDeletePlan) g.pages.forEach(pg => onDeletePlan(pg.id));
    if (folders.some(f => (f.bases || []).includes(g.nom))) {
      setFolders(folders.map(f => ({ ...f, bases: (f.bases || []).filter(b => b !== g.nom) })));
    }
    setConfirmDelPdf(null);
  };

  // Nom de base d'une entrée de bibliothèque (même logique que pdfGroups).
  const baseOfPl = (pl) => {
    const m = String(pl.nom || '').match(PDF_PAGE_RE);
    return m ? pl.nom.replace(PDF_PAGE_RE, '').trim() : (pl.nom || 'Document');
  };

  // RÉORDONNE : tuile déposée sur le BORD (gauche/droite) d'une autre — sans fusion
  // (demande Thomas : « j'ai voulu réorganiser, ça les a fusionnés »).
  // Cible dans une case → insertion dans la case à cette position (et sortie de l'ancienne).
  // Cible hors case → sortie de case éventuelle + réordonnancement de la bibliothèque
  // (l'ordre des plans est persisté via sort_order côté Supabase).
  const reorderBases = (draggedBase, targetBase, after) => {
    if (!draggedBase || draggedBase === targetBase) return;
    const targetFolder = folders.find(f => (f.bases || []).includes(targetBase));
    if (targetFolder) {
      setFolders(folders.map(f => {
        let bases = (f.bases || []).filter(b => b !== draggedBase);
        if (f.id === targetFolder.id) {
          const idx = bases.indexOf(targetBase) + (after ? 1 : 0);
          bases = [...bases.slice(0, idx), draggedBase, ...bases.slice(idx)];
        }
        return { ...f, bases };
      }));
    } else {
      if (folders.some(f => (f.bases || []).includes(draggedBase))) {
        setFolders(folders.map(f => ({ ...f, bases: (f.bases || []).filter(b => b !== draggedBase) })));
      }
      onReorderPlans?.(lib => {
        const dragged = lib.filter(pl => baseOfPl(pl) === draggedBase);
        const rest = lib.filter(pl => baseOfPl(pl) !== draggedBase);
        const idxs = rest.map((pl, i) => (baseOfPl(pl) === targetBase ? i : -1)).filter(i => i >= 0);
        if (!dragged.length || !idxs.length) return lib;
        const idx = after ? idxs[idxs.length - 1] + 1 : idxs[0];
        return [...rest.slice(0, idx), ...dragged, ...rest.slice(idx)];
      });
    }
  };

  // Regroupe deux PDF : tuile DÉPOSÉE au MILIEU d'une autre tuile (demande Thomas).
  // Cible déjà dans une case → la tuile déplacée la rejoint. Sinon → nouvelle case
  // contenant les deux, ouverte en renommage direct.
  const groupBases = (draggedBase, targetBase) => {
    if (!onUpdateFolders || !draggedBase || draggedBase === targetBase) return;
    const targetFolder = folders.find(f => (f.bases || []).includes(targetBase));
    if (targetFolder) {
      setFolders(folders.map(f => ({
        ...f,
        bases: f.id === targetFolder.id
          ? [...(f.bases || []).filter(b => b !== draggedBase), draggedBase]
          : (f.bases || []).filter(b => b !== draggedBase),
      })));
    } else {
      const id = crypto.randomUUID();
      setFolders([
        ...folders.map(f => ({ ...f, bases: (f.bases || []).filter(b => b !== draggedBase && b !== targetBase) })),
        { id, nom: '', bases: [targetBase, draggedBase] },
      ]);
      setEditingFolderId(id); setEditingFolderNom('');
    }
  };

  // ── Déplacement TACTILE : appui sur la poignée puis on suit le doigt (pointer capture) ──
  const touchStartRef = useRef(null); // { base, x0, y0, moved }
  const lastGripTouch = useRef(false); // dernier appui poignée = tactile ? (neutralise le onClick)
  const onGripTouchStart = (e, base) => {
    lastGripTouch.current = e.pointerType === 'touch';
    if (e.pointerType !== 'touch') return;   // souris → glisser-déposer HTML5 classique
    touchStartRef.current = { base, x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ok */ }
  };
  const onGripTouchStartFolder = (e, folderId) => {
    if (e.pointerType !== 'touch') return;   // souris → HTML5
    touchStartRef.current = { folderId, x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ok */ }
  };
  const onGripTouchMove = (e) => {
    const s = touchStartRef.current;
    if (!s || e.pointerType !== 'touch') return;
    const dist = Math.hypot(e.clientX - s.x0, e.clientY - s.y0);
    if (!s.moved && dist < 8) return;
    if (!s.moved) { s.base ? setDragBase(s.base) : setDragFolder(s.folderId); } // démarre le drag
    s.moved = true;
    e.preventDefault();
    const d = computeDrop(e.clientX, e.clientY);
    if (d.group) { setDropTarget(d.group); setInsertIdx(null); } else { setInsertIdx(d.insert); setDropTarget(null); }
    setTouchDrag({ base: s.base || null, x: e.clientX, y: e.clientY });
  };
  const onGripTouchEnd = (e) => {
    const s = touchStartRef.current;
    touchStartRef.current = null;
    if (!s || e.pointerType !== 'touch') return;
    if (!s.moved) { // simple tap sur une TUILE → ouvrir le menu (les cases n'ont pas de menu)
      if (s.base) { setRenamePdf(null); setConfirmDelPdf(null); setMovePdf(movePdf === s.base ? null : s.base); }
      return;
    }
    applyDrop(e.clientX, e.clientY);
    endDrag();
  };

  // TUILE d'un PDF (taille UNIFORME partout, dans une case ou non — demande Thomas) :
  // sigle Ai + titre lisible. Poignée 6 points : glisser (souris OU doigt) pour déplacer/
  // regrouper/réordonner, tap pour le menu (renommer / ranger / supprimer). Clic = consulter.
  const renderPdfTile = (g) => {
    const tileActive = movePdf === g.nom || renamePdf?.base === g.nom || confirmDelPdf === g.nom;
    const isGroupTgt = dropTarget?.kind === 'tile' && dropTarget.base === g.nom; // « déposer ici = créer une case »
    return (
      <div data-item data-base={g.nom}
        draggable={dragArmBase === g.nom}
        // GARDE : sans armement par la poignée, on TUE le dragstart (sélection de texte…).
        onDragStart={e => {
          if (dragArmBase !== g.nom) { e.preventDefault(); e.stopPropagation(); return; }
          e.stopPropagation();
          setDragBase(g.nom); try { e.dataTransfer.effectAllowed = 'move'; } catch { /* ok */ }
        }}
        onDragEnd={endDrag}
        onMouseUp={() => setDragArmBase(null)}
        // Largeur .plan-tile (2 colonnes mobile, carré 168px PC). En édition la tuile
        // s'agrandit (menu/renommage non coupés).
        className="plan-tile"
        style={{ position:'relative', boxSizing:'border-box',
          border:`1.5px solid ${isGroupTgt ? DA.red : DA.border}`, borderRadius:12, background: isGroupTgt ? DA.redL : 'white',
          overflow: tileActive ? 'visible' : 'hidden',
          ...(tileActive ? { aspectRatio: 'auto', height: 'auto', zIndex: 2 } : {}),
          display:'flex', flexDirection:'column',
          boxShadow: isGroupTgt ? `0 0 0 2px ${DA.red}` : '0 1px 4px rgba(0,0,0,0.05)',
          opacity: (dragBase === g.nom || touchDrag?.base === g.nom) ? 0.4 : 1, transition:'opacity 0.1s, box-shadow 0.1s' }}>
        {/* Poignée 6 points : glisser (souris OU doigt) pour RÉORDONNER — ou TAP pour le
            menu. touchAction:none = le doigt glisse la tuile, ne défile pas la page. */}
        <div
          onMouseDown={() => setDragArmBase(g.nom)}
          onClick={() => { if (lastGripTouch.current) { lastGripTouch.current = false; return; } setRenamePdf(null); setConfirmDelPdf(null); setMovePdf(movePdf === g.nom ? null : g.nom); }}
          onPointerDown={e => onGripTouchStart(e, g.nom)}
          onPointerMove={onGripTouchMove}
          onPointerUp={onGripTouchEnd}
          onPointerCancel={() => { touchStartRef.current = null; setTouchDrag(null); setInsertIdx(null); }}
          title="Glisser pour déplacer — ou appuyer pour les options"
          style={{ position:'absolute', top:5, right:5, width:34, height:34, borderRadius:8, cursor:'grab', touchAction:'none',
            display:'flex', alignItems:'center', justifyContent:'center', color: movePdf === g.nom ? DA.red : DA.grayL, background:'white',
            border:`1px solid ${movePdf === g.nom ? DA.red : DA.border}`, zIndex:1 }}>
          <Ic n="grp" s={15}/>
        </div>
        {/* Zone cliquable : titre en MAJUSCULES, centré H+V, sigle Ai en filigrane derrière.
            → ouvre la visionneuse (demande Thomas). */}
        <div onClick={() => openPlanConsult(g)} style={{ cursor:'pointer', position:'relative', padding:'14px 10px', flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div aria-hidden style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
            <span style={{ fontWeight:900, fontSize:52, letterSpacing:-2, color:DA.red, opacity:0.07, userSelect:'none' }}>Ai</span>
          </div>
          {/* Titre EN GRAND, MAJUSCULES, toujours entier — pas de compteur de pages. */}
          <p style={{ position:'relative', fontSize:14.5, fontWeight:800, color:DA.black, margin:0, lineHeight:1.25, textAlign:'center',
            textTransform:'uppercase', letterSpacing:0.2, whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word' }}>
            {g.nom}
          </p>
        </div>
        {/* Menu ouvert par la poignée : Renommer · Mettre dans une case · Sortir · Supprimer */}
        {movePdf === g.nom && renamePdf?.base !== g.nom && confirmDelPdf !== g.nom && (
          <div style={{ display:'flex', flexDirection:'column', gap:6, padding:'0 8px 8px' }} onClick={e => e.stopPropagation()}>
            {onRenamePlan && (
              <button onClick={() => setRenamePdf({ base: g.nom, val: g.nom })}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 10px', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, cursor:'pointer', fontSize:12.5, fontWeight:700 }}>
                <Ic n="edt" s={14}/> Renommer
              </button>
            )}
            {/* Regrouper/ranger se fait au GLISSER (tuile au centre d'une autre = case ;
                sur une case = dedans) — plus de menu « Mettre dans une case » (demande Thomas). */}
            {onUpdateFolders && folders.some(f => (f.bases || []).includes(g.nom)) && (
              <button onClick={() => { moveBase(g.nom, null); setMovePdf(null); }}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 10px', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, cursor:'pointer', fontSize:12.5, fontWeight:700 }}>
                <Ic n="und" s={14}/> Sortir de la case
              </button>
            )}
            {onDeletePlan && (
              <button onClick={() => setConfirmDelPdf(g.nom)}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 10px', borderRadius:8, border:'1px solid #FCA5A5', background:'#FFF5F5', color:'#B91C1C', cursor:'pointer', fontSize:12.5, fontWeight:700 }}>
                <Ic n="del" s={14}/> Supprimer
              </button>
            )}
          </div>
        )}
        {renamePdf?.base === g.nom && (
          <div style={{ display:'flex', flexDirection:'column', gap:5, padding:'0 8px 8px' }}>
            {/* Grand champ pleine largeur, même corps que le titre (l'ancien mini-champ
                coincé à côté du OK était illisible — demande Thomas). */}
            <textarea autoFocus value={renamePdf.val} rows={3}
              onChange={e => setRenamePdf({ base: g.nom, val: e.target.value.replace(/\n/g, ' ') })}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); renameWholePdf(g.nom, renamePdf.val); } if (e.key === 'Escape') setRenamePdf(null); }}
              draggable={false}
              onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
              placeholder="Nouveau nom du PDF"
              style={{ width:'100%', fontSize:14, fontWeight:600, lineHeight:1.35, fontFamily:'inherit', resize:'none',
                border:`1.5px solid ${DA.red}`, borderRadius:8, padding:'8px 9px', outline:'none', boxSizing:'border-box' }}/>
            <button onClick={() => renameWholePdf(g.nom, renamePdf.val)}
              style={{ width:'100%', padding:'9px 0', borderRadius:8, border:'none', background:DA.red, color:'white', fontSize:13, fontWeight:800, cursor:'pointer' }}>OK</button>
          </div>
        )}
        {confirmDelPdf === g.nom && (
          <div style={{ display:'flex', flexDirection:'column', gap:6, padding:'0 8px 8px' }}>
            {/* Une seule confirmation (menu « Supprimer » = 1er clic, « Oui » = 2e). */}
            <p style={{ margin:0, fontSize:11.5, fontWeight:700, color:'#B91C1C', textAlign:'center', lineHeight:1.35 }}>
              Supprimer ce plan ({g.pages.length} page{g.pages.length > 1 ? 's' : ''}) ?
            </p>
            <div style={{ display:'flex', gap:5, alignItems:'center' }}>
              <button onClick={() => deleteWholePdf(g)}
                style={{ flex:1, padding:'8px 0', borderRadius:8, border:'none', background:'#B91C1C', color:'white', fontSize:12, fontWeight:800, cursor:'pointer' }}>
                Oui, supprimer
              </button>
              <button onClick={() => setConfirmDelPdf(null)}
                style={{ flex:1, padding:'8px 0', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:'#555', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Bases d'une case dans l'ordre STOCKÉ (f.bases) — réordonnable en glissant une tuile sur une
  // autre de la même case. On ne filtre que les bases orphelines (plan supprimé). Avant, on
  // re-triait par l'ordre global de la bibliothèque → l'ordre choisi dans la case était ignoré
  // (« réorganiser les plans dans les box, pas possible » — Bach).
  const orderedFolderBases = (f) => {
    const known = new Set(pdfGroups.map(g => g.nom));
    return (f.bases || []).filter(b => known.has(b));
  };
  // Case contenant une base donnée (null si la tuile est libre).
  const folderOfBase = (base) => folders.find(f => (f.bases || []).includes(base)) || null;

  // Rendu d'une CASE (extrait pour pouvoir l'INTERCLASSER avec les tuiles libres — demande
  // Thomas : pouvoir placer une tuile avant une case). Glisser une tuile sur le BORD de la
  // case la place avant/après (hors case) ; au MILIEU, elle entre dans la case.
  const renderFolder = (f) => (
    <div data-item data-folder={f.id}
      draggable={dragArmFolder === f.id}
      onDragStart={e => {
        if (dragArmFolder !== f.id) { e.preventDefault(); return; }
        setDragFolder(f.id); try { e.dataTransfer.effectAllowed = 'move'; } catch { /* ok */ }
      }}
      onDragEnd={endDrag}
      onMouseUp={() => setDragArmFolder(null)}
      className="plan-folder"
      style={{ border:`1.5px solid ${(dropTarget?.kind === 'folder' && dropTarget.id === f.id) ? DA.red : DA.border}`,borderRadius:14,background:(dropTarget?.kind === 'folder' && dropTarget.id === f.id) ? DA.redL : '#FAFBFC',padding:'6px 8px 8px',
        boxShadow: (dropTarget?.kind === 'folder' && dropTarget.id === f.id) ? `0 0 0 2px ${DA.red}` : '0 1px 3px rgba(0,0,0,0.04)',
        opacity: (dragFolder === f.id) ? 0.4 : 1,
        boxSizing:'border-box' }}>
      <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:6 }}>
        {editingFolderId !== f.id && (
          <span onMouseDown={() => setDragArmFolder(f.id)}
            onPointerDown={e => onGripTouchStartFolder(e, f.id)}
            onPointerMove={onGripTouchMove}
            onPointerUp={onGripTouchEnd}
            onPointerCancel={() => { touchStartRef.current = null; setTouchDrag(null); setInsertIdx(null); }}
            title="Glisser pour réorganiser"
            style={{ width:26, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color:DA.grayL, cursor:'grab', touchAction:'none' }}>
            <Ic n="grp" s={13}/>
          </span>
        )}
        {editingFolderId === f.id ? (
          <input autoFocus value={editingFolderNom}
            onChange={e => setEditingFolderNom(e.target.value)}
            onBlur={() => { renameFolder(f.id, editingFolderNom.trim()); setEditingFolderId(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { renameFolder(f.id, editingFolderNom.trim()); setEditingFolderId(null); } if (e.key === 'Escape') setEditingFolderId(null); }}
            placeholder="Nom de la case"
            draggable={false}
            onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
            style={{ flex:1,minWidth:0,fontSize:16,fontWeight:700,border:`1.5px solid ${DA.red}`,borderRadius:8,padding:'5px 9px',outline:'none',boxSizing:'border-box' }}/>
        ) : (
          <p onClick={() => { setEditingFolderId(f.id); setEditingFolderNom(f.nom || ''); }}
            title="Renommer la case"
            style={{ flex:1,minWidth:0,fontSize:13,fontWeight:800,textAlign:'center',color:f.nom ? DA.red : DA.grayL,fontStyle:f.nom ? 'normal' : 'italic',margin:0,cursor:'text',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:0.4 }}>
            {f.nom || 'Sans nom'}
          </p>
        )}
        <button onClick={() => deleteFolder(f.id)} title="Dissoudre la case (les PDF restent)"
          style={{ flexShrink:0,width:26,height:26,borderRadius:7,border:'none',background:'none',color:DA.grayL,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>
          <Ic n="x" s={13}/>
        </button>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
        {orderedFolderBases(f).map(b => groupsByBase.get(b)).filter(Boolean).map(g => renderPdfTile(g))}
        {(f.bases || []).length === 0 && (
          <p style={{ fontSize:11,color:DA.grayL,margin:'0 2px 4px',fontStyle:'italic' }}>Case vide — déposez un plan ici.</p>
        )}
      </div>
    </div>
  );

  // Liste UNIFIÉE interclassée : cases et tuiles libres dans l'ordre de la bibliothèque
  // (une case se place à la position de son premier plan) → on peut mettre une tuile avant
  // une case (demande Thomas).
  const unifiedItems = (() => {
    const byBase = new Map();
    folders.forEach(f => (f.bases || []).forEach(b => byBase.set(b, f)));
    const out = [], emitted = new Set();
    for (const g of pdfGroups) {
      const f = byBase.get(g.nom);
      if (f) { if (!emitted.has(f.id)) { emitted.add(f.id); out.push({ type: 'folder', f }); } }
      else out.push({ type: 'tile', g });
    }
    folders.forEach(f => { if (!emitted.has(f.id)) out.push({ type: 'folder', f }); }); // cases vides
    return out;
  })();

  // Déplace un BLOC de bases avant/après une base ancre dans la bibliothèque (persisté).
  const moveGroupBefore = (movingBases, anchorBase, after) => {
    const set = new Set(movingBases);
    onReorderPlans?.(lib => {
      const moving = lib.filter(pl => set.has(baseOfPl(pl)));
      const rest = lib.filter(pl => !set.has(baseOfPl(pl)));
      const idxs = rest.map((pl, i) => baseOfPl(pl) === anchorBase ? i : -1).filter(i => i >= 0);
      if (!moving.length || !idxs.length) return lib;
      const at = after ? idxs[idxs.length - 1] + 1 : idxs[0];
      return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    });
  };
  const basesOfItem = (it) => it.type === 'folder' ? orderedFolderBases(it.f) : [it.g.nom];
  const itemKey = (it) => it.type === 'folder' ? `f:${it.f.id}` : `t:${it.g.nom}`;
  const draggedKey = () => dragFolder ? `f:${dragFolder}` : dragBase ? `t:${dragBase}` : null;

  // Index d'insertion à partir de la position du pointeur : l'élément le plus proche décide,
  // avant/après selon le côté (gauche/droite). Simple et prévisible (demande Thomas).
  const computeInsertIdx = (clientX, clientY) => {
    const grid = gridRef.current;
    if (!grid) return null;
    const kids = [...grid.querySelectorAll('[data-item]')];
    let best = kids.length, bestDist = Infinity;
    kids.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(clientX - cx, clientY - cy);
      if (d < bestDist) { bestDist = d; best = clientX < cx ? i : i + 1; }
    });
    return best;
  };

  // Déplace l'élément en cours de drag (tuile OU case) à l'index d'insertion dans l'ordre.
  const applyInsert = (idx) => {
    if (idx == null) return;
    const dk = draggedKey();
    if (!dk) return;
    const items = unifiedItems;
    const draggedItem = items.find(it => itemKey(it) === dk);
    if (!draggedItem) return;
    const movingBases = basesOfItem(draggedItem);
    if (!movingBases.length) return;
    // Cible = élément situé À l'index d'insertion (on insère AVANT lui) ; null = fin de liste.
    let target = items[idx] || null;
    if (target && itemKey(target) === dk) target = items[idx + 1] || null; // ignore soi-même
    // Une tuile déplacée redevient LIBRE (sort de sa case) — l'ordre reste maître.
    if (draggedItem.type === 'tile') setFolders(folders.map(f => ({ ...f, bases: (f.bases || []).filter(b => b !== dragBase) })));
    if (target) {
      const anchor = target.type === 'folder' ? orderedFolderBases(target.f)[0] : target.g.nom;
      if (anchor) moveGroupBefore(movingBases, anchor, false);
    } else {
      const others = items.filter(it => itemKey(it) !== dk);
      const last = others[others.length - 1];
      if (last) { const anchor = last.type === 'folder' ? (orderedFolderBases(last.f).slice(-1)[0]) : last.g.nom; if (anchor) moveGroupBefore(movingBases, anchor, true); }
    }
  };

  // Décide, à la position du pointeur : REGROUPER (centre d'une tuile/case) ou RÉORDONNER
  // (ailleurs). Grouper ne concerne QUE le déplacement d'une tuile.
  const computeDrop = (x, y) => {
    const draggingTile = dragBase || touchDrag?.base || null;
    if (draggingTile) {
      const el = document.elementFromPoint(x, y);
      const folderEl = el?.closest?.('[data-folder]');
      const tileEl = el?.closest?.('[data-base]');
      const targetBase = tileEl?.getAttribute('data-base');
      // 1) PRIORITÉ : dépôt sur une AUTRE tuile de la MÊME case → réordonner À L'INTÉRIEUR de la
      //    case (avant/après selon le côté). Sans ça, glisser dans une box ne changeait pas l'ordre.
      if (targetBase && targetBase !== draggingTile) {
        const dragF = folderOfBase(draggingTile), tgtF = folderOfBase(targetBase);
        if (dragF && tgtF && dragF.id === tgtF.id) {
          const r = tileEl.getBoundingClientRect();
          const after = (x - r.left) / Math.max(1, r.width) > 0.5;
          return { reorderInFolder: { targetBase, after } };
        }
      }
      // 2) Dépôt au MILIEU d'une case → ranger la tuile dedans.
      if (folderEl) {
        const r = folderEl.getBoundingClientRect();
        const fx = (x - r.left) / Math.max(1, r.width);
        if (fx > 0.25 && fx < 0.75) return { group: { kind: 'folder', id: folderEl.getAttribute('data-folder') } };
      } else if (targetBase && targetBase !== draggingTile) {
        // 3) Dépôt au MILIEU d'une tuile LIBRE → créer une case avec les deux.
        const r = tileEl.getBoundingClientRect();
        const fx = (x - r.left) / Math.max(1, r.width);
        if (fx > 0.28 && fx < 0.72) return { group: { kind: 'tile', base: targetBase } };
      }
    }
    return { insert: computeInsertIdx(x, y) };
  };
  // Applique la décision de computeDrop.
  const applyDrop = (x, y) => {
    const d = computeDrop(x, y);
    const draggingTile = dragBase || touchDrag?.base;
    if (d.reorderInFolder && draggingTile) {
      reorderBases(draggingTile, d.reorderInFolder.targetBase, d.reorderInFolder.after); // réordonner DANS la case
    } else if (d.group) {
      if (draggingTile) {
        if (d.group.kind === 'folder') moveBase(draggingTile, d.group.id);       // ranger dans la case
        else groupBases(draggingTile, d.group.base);                              // créer une case avec les 2
      }
    } else applyInsert(d.insert);
  };

  const endDrag = () => { setDragBase(null); setDragArmBase(null); setDragFolder(null); setDragArmFolder(null); setInsertIdx(null); setDropTarget(null); setTouchDrag(null); };

  const addLoc = () => {
    const newLoc = { id: crypto.randomUUID(), nom: 'Nouveau niveau', items: [], planId: null, planBg: null, planData: null, planAnnotations: null, extraPlans: [] };
    onChange([...localisations, newLoc]);
    if (planLibrary.length > 0 && onPickPlan) onPickPlan(newLoc.id);
  };

  const renameLoc = (locId, nom) => {
    onChange(localisations.map(l => l.id === locId ? { ...l, nom } : l));
  };

  const removePlan = (locId) => {
    onChange(localisations.map(l =>
      l.id === locId ? { ...l, planId: null, planBg: null, planData: null, extraPlans: [], _planDirty: true } : l
    ));
  };

  const handleRepairFile = e => {
    const f = e.target.files?.[0];
    if (!f || !repairTargetId) return;
    e.target.value = '';
    setRepairErr(null);
    if (f.type === 'application/pdf') {
      const r = new FileReader();
      r.onload = ev => { setRepairPdfData(ev.target.result); setShowRepairPicker(true); };
      r.readAsDataURL(f);
    } else if (f.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = ev => { if (onRepairBg) onRepairBg(repairTargetId, ev.target.result); setRepairTargetId(null); };
      r.readAsDataURL(f);
    } else {
      setRepairErr('Format non supporté.');
      setRepairTargetId(null);
    }
  };

  const handleRepairPageSelected = async selectedNums => {
    setShowRepairPicker(false);
    const pageNum = selectedNums[0];
    if (!pageNum || !repairPdfData || !repairTargetId) return;
    setRepairingId(repairTargetId);
    try {
      const img = await renderPdfPage(repairPdfData, pageNum);
      if (img && onRepairBg) onRepairBg(repairTargetId, img);
      else setRepairErr("Impossible de rendre cette page.");
    } catch (err) {
      setRepairErr('Erreur : ' + err.message);
    }
    setRepairingId(null);
    setRepairTargetId(null);
    setRepairPdfData(null);
  };

  if (showRepairPicker && repairPdfData) return (
    <PdfPagePicker
      pdfData={repairPdfData}
      label="Choisir la page du plan"
      onSelectMany={handleRepairPageSelected}
      onClose={() => { setShowRepairPicker(false); setRepairTargetId(null); setRepairPdfData(null); }}
    />
  );

  // Visionneuse tactile (pincement / déplacement / double-tap) — composant ConsultViewer.
  if (consultGroup) return <ConsultViewer group={consultGroup} projetId={projetId} onClose={() => setConsultGroup(null)}/>;

  if (previewBg) return (
    <div onClick={() => setPreviewBg(null)} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:80,display:'flex',alignItems:'center',justifyContent:'center',cursor:'zoom-out' }}>
      <img src={previewBg} alt="" style={{ maxWidth:'92vw',maxHeight:'92vh',objectFit:'contain',borderRadius:8,boxShadow:'0 8px 40px rgba(0,0,0,0.6)' }}/>
      <button onClick={() => setPreviewBg(null)} style={{ position:'absolute',top:16,right:16,background:'rgba(255,255,255,0.12)',border:'none',color:'white',borderRadius:'50%',width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' }}>
        <Ic n="x" s={16}/>
      </button>
    </div>
  );

  return (
    <div className="modal-overlay" style={{ zIndex:60 }}>
      {/* Fantôme qui suit le doigt pendant un déplacement tactile de tuile */}
      {touchDrag && (
        <div style={{ position:'fixed', left:touchDrag.x, top:touchDrag.y, transform:'translate(-50%, -50%)',
          zIndex:9999, pointerEvents:'none', background:DA.red, color:'white', fontSize:12, fontWeight:800,
          borderRadius:10, padding:'8px 12px', boxShadow:'0 6px 20px rgba(0,0,0,0.35)', maxWidth:180,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {touchDrag.base}
        </div>
      )}
      <div className="modal-sheet-flex">
        {/* Header */}
        <div style={{ padding:'16px 18px 12px',borderBottom:`1px solid ${DA.border}`,flexShrink:0 }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between' }}>
            <div style={{ display:'flex',alignItems:'center',gap:8 }}>
              <Ic n="bld" s={18}/>
              <p style={{ fontWeight:800,fontSize:15,color:DA.black,margin:0 }}>Gérer les niveaux</p>
            </div>
            <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL }}>
              <Ic n="x" s={20}/>
            </button>
          </div>
          <p style={{ fontSize:12,color:DA.gray,margin:'4px 0 0' }}>
            {localisations.length} niveau{localisations.length !== 1 ? 'x' : ''} — associez un plan à chaque zone
          </p>
        </div>

        {/* Liste des niveaux */}
        <div style={{ flex:1,overflowY:'auto',padding:'12px 14px' }}>
          {/* Consultation ORGANISÉE en « cases » (bulles) : DCE, Coffrage, Ferraillage… —
              renommables, PDF rangés à sa sauce, tout synchronisé entre appareils. */}
          {(pdfGroups.length > 0 || folders.length > 0) && (
            <div style={{ marginBottom:16 }}>
              <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
                <p style={{ fontSize:11,fontWeight:700,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,margin:0 }}>
                  Consulter les plans
                </p>
                {(dragBase || dragFolder || touchDrag) && (
                  <span style={{ fontSize:10.5,color:DA.grayL }}>glissez où vous voulez · la barre rouge montre la position</span>
                )}
              </div>

              {/* Réorganisation : on glisse une tuile OU une case, une BARRE D'INSERTION
                  rouge montre où ça tombera, on lâche. Simple et prévisible (demande Thomas). */}
              <div ref={gridRef} data-unfiled
                onDragOver={e => { if (dragBase || dragFolder) { e.preventDefault(); const d = computeDrop(e.clientX, e.clientY); if (d.group) { setDropTarget(d.group); setInsertIdx(null); } else { setInsertIdx(d.insert); setDropTarget(null); } } }}
                onDrop={e => { e.preventDefault(); if (dragBase || dragFolder) { applyDrop(e.clientX, e.clientY); endDrag(); } }}
                style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'stretch' }}>
                {unifiedItems.map((it, i) => (
                  <React.Fragment key={itemKey(it)}>
                    {(dragBase || dragFolder || touchDrag) && insertIdx === i && (
                      <div style={{ width:4, alignSelf:'stretch', borderRadius:2, background:DA.red, boxShadow:`0 0 6px ${DA.red}` }}/>
                    )}
                    {it.type === 'folder' ? renderFolder(it.f) : renderPdfTile(it.g)}
                  </React.Fragment>
                ))}
                {(dragBase || dragFolder || touchDrag) && insertIdx === unifiedItems.length && (
                  <div style={{ width:4, alignSelf:'stretch', borderRadius:2, background:DA.red, boxShadow:`0 0 6px ${DA.red}` }}/>
                )}
              </div>
            </div>
          )}

          {/* Section bibliothèque */}
          <div style={{ marginBottom:16 }}>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
              {/* En-tête cliquable : la liste des plans un à un est REPLIÉE par défaut
                  (demande Thomas : sur site elle encombre — on la déplie pour renommer/réparer). */}
              <button onClick={() => setShowImported(v => !v)}
                style={{ display:'flex',alignItems:'center',gap:6,background:'none',border:'none',cursor:'pointer',padding:'4px 0',margin:0 }}>
                <span style={{ fontSize:11,fontWeight:700,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5 }}>
                  Plans importés ({planLibrary.length})
                </span>
                <span style={{ fontSize:10,color:DA.grayL }}>{showImported ? '▴ masquer' : '▾ afficher'}</span>
              </button>
              <div style={{ display:'flex',gap:6,alignItems:'center' }}>
                {showImported && onDeletePlan && planLibrary.length > 0 && (confirmDelAll ? (
                  <>
                    <button onClick={() => { if (onDeleteAllPlans) onDeleteAllPlans(); else planLibrary.forEach(pl => onDeletePlan(pl.id)); setConfirmDelAll(false); }}
                      style={{ fontSize:11,fontWeight:700,padding:'4px 9px',background:'#B91C1C',color:'white',border:'none',borderRadius:7,cursor:'pointer' }}>
                      Tout supprimer
                    </button>
                    <button onClick={() => setConfirmDelAll(false)}
                      style={{ fontSize:11,padding:'4px 8px',background:'white',color:'#555',border:`1px solid ${DA.border}`,borderRadius:7,cursor:'pointer' }}>
                      Non
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDelAll(true)}
                    style={{ fontSize:11,color:'#ccc',background:'none',border:`1px solid #E5E5E5`,borderRadius:7,padding:'4px 8px',cursor:'pointer',display:'flex',alignItems:'center',gap:4 }}
                    onMouseEnter={e=>e.currentTarget.style.color=DA.red} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
                    <Ic n="del" s={11}/> Tout supprimer
                  </button>
                ))}
                {onOpenPlanLib && (
                  <button onClick={() => { onClose(); onOpenPlanLib(); }}
                    style={{ fontSize:13,fontWeight:800,color:'white',background:DA.red,border:'none',borderRadius:9,padding:'8px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:6,boxShadow:'0 2px 8px rgba(227,5,19,0.3)' }}>
                    <Ic n="plus" s={13}/> Importer
                  </button>
                )}
              </div>
            </div>
            {planLibrary.length === 0 ? (
              <div style={{ background:'#FFFBEB',border:'1px solid #FCD34D',borderRadius:10,padding:'12px 14px',display:'flex',alignItems:'center',gap:10 }}>
                <Ic n="map" s={18}/>
                <p style={{ fontSize:12,color:'#92400E',margin:0,flex:1 }}>Aucun plan — appuyez sur <strong>+ Importer</strong> pour commencer.</p>
              </div>
            ) : !showImported ? null : (
              <>
              {repairErr && <div style={{ background:'#FFF0F0',border:'1px solid #FCA5A5',borderRadius:6,padding:'6px 10px',marginBottom:6,fontSize:11,color:'#B91C1C' }}>⚠️ {repairErr}</div>}
              <input ref={repairFileRef} type="file" accept="image/*,application/pdf" style={{ display:'none' }} onChange={handleRepairFile}/>
              <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                {/* BULLES AUTOMATIQUES par PDF d'origine, TOUTES repliables et REPLIÉES par
                    défaut — y compris les PDF d'une seule page (demande Thomas : les lignes
                    isolées faisaient brouillon et la liste dépliée prenait trop de place).
                    Le regroupement se calcule à partir des NOMS (« base — Page N ») →
                    renommer le PDF entier ou une page met tout à jour automatiquement. */}
                {pdfGroups.map(g => {
                  const open = openImported.has(g.nom);
                  return (
                    <div key={g.nom} style={{ border:`1.5px solid ${DA.border}`,borderRadius:12,background:'#FAFBFC',padding:open ? '0 8px 8px' : 0,overflow:'hidden' }}>
                      <button onClick={() => setOpenImported(s => { const n = new Set(s); if (n.has(g.nom)) n.delete(g.nom); else n.add(g.nom); return n; })}
                        style={{ width:'100%',display:'flex',alignItems:'center',gap:7,padding:'10px 10px',margin:open ? '0 -8px' : 0,
                          background:'none',border:'none',cursor:'pointer',textAlign:'left',boxSizing:'content-box' }}>
                        <span style={{ fontSize:13,flexShrink:0 }}>📄</span>
                        <span style={{ flex:1,minWidth:0,fontSize:11.5,fontWeight:800,color:DA.black,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                          {g.nom} <span style={{ color:DA.grayL,fontWeight:600 }}>· {g.pages.length} page{g.pages.length > 1 ? 's' : ''}</span>
                        </span>
                        <span style={{ flexShrink:0,fontSize:10,color:DA.grayL }}>{open ? '▴ masquer' : '▾ afficher'}</span>
                      </button>
                      {open && (
                        <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
                          {g.pages.map(pl => renderImportedRow(pl))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </>
            )}
          </div>
          {localisations.length === 0 && (
            <div style={{ textAlign:'center',padding:'40px 0',color:DA.grayL }}>
              <Ic n="pin" s={40}/>
              <p style={{ fontSize:13,color:DA.gray,margin:'10px 0 0',fontWeight:600 }}>Aucun niveau créé</p>
              <p style={{ fontSize:11,color:DA.grayL,margin:'4px 0 0' }}>Appuyez sur le bouton en bas pour commencer</p>
            </div>
          )}

          <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
            {localisations.map(loc => {
              const allPlanThumbs = [];
              // Ignore les références orphelines (plan supprimé de la bibliothèque) qui
              // produiraient des tuiles « Plan » vides réapparaissant à chaque rechargement.
              if (loc.planBg || (loc.planId && planLibrary.some(p => p.id === loc.planId))) {
                const pl = planLibrary.find(p => p.id === loc.planId);
                allPlanThumbs.push({ bg: loc.planBg || pl?.bg || null, nom: pl?.nom || 'Plan de zone' });
              }
              for (const ep of (loc.extraPlans || [])) {
                if (!ep.planBg && !planLibrary.some(p => p.id === ep.planId)) continue; // orphelin
                const epl = planLibrary.find(p => p.id === ep.planId);
                allPlanThumbs.push({ bg: ep.planBg || epl?.bg || null, nom: epl?.nom || 'Plan' });
              }
              const hasPlan = allPlanThumbs.length > 0;

              return (
                <div key={loc.id} style={{ border:`1px solid ${hasPlan ? DA.red : DA.border}`,borderRadius:12,overflow:'hidden',background:DA.white,transition:'border-color 0.15s' }}>

                  {/* En-tête de zone */}
                  <div style={{ display:'flex',alignItems:'center',padding:'10px 12px',gap:8,background:hasPlan ? DA.redL : DA.white }}>
                    <div style={{ flex:1,minWidth:0 }}>
                      <EditTitle
                        value={loc.nom}
                        onSave={nom => renameLoc(loc.id, nom)}
                        style={{ fontSize:14,fontWeight:700,color:DA.black }}
                        inputStyle={{ fontSize:16,fontWeight:700 }}
                      />
                    </div>
                    <span style={{ fontSize:11,color:DA.grayL,flexShrink:0 }}>
                      {(loc.items || []).length} obs.
                    </span>
                    {/* Actions PAR NIVEAU dans l'en-tête (demande Thomas : les petits liens en
                        bas n'étaient pas pratiques, surtout au doigt) : + = ajouter/modifier
                        les plans du niveau, corbeille = tout retirer. */}
                    <button onClick={() => {
                        if (planLibrary.length === 0 && onOpenPlanLib) { onClose(); onOpenPlanLib(); return; }
                        if (onPickPlan) onPickPlan(loc.id);
                      }}
                      title="Ajouter / modifier les plans de ce niveau"
                      style={{ flexShrink:0,width:38,height:38,borderRadius:9,border:`1.5px solid ${DA.red}`,background:'white',color:DA.red,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>
                      <Ic n="plus" s={16}/>
                    </button>
                    {hasPlan && (
                      <button onClick={() => removePlan(loc.id)}
                        title="Retirer tous les plans de ce niveau"
                        style={{ flexShrink:0,width:38,height:38,borderRadius:9,border:`1px solid ${DA.border}`,background:'white',color:DA.grayL,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>
                        <Ic n="del" s={15}/>
                      </button>
                    )}
                  </div>

                  {/* Zone plan */}
                  <div style={{ borderTop:`1px solid ${DA.border}` }}>
                    {hasPlan ? (
                      <>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:6, padding:'10px 12px' }}>
                          {allPlanThumbs.map((pt, i) => (
                            <div key={i} style={{ position:'relative', cursor:'zoom-in' }} onClick={() => pt.bg && setPreviewBg(pt.bg)}>
                              {pt.bg
                                ? <img src={pt.bg} alt="" style={{ width:72, height:50, objectFit:'cover', borderRadius:6, border:`1px solid ${DA.border}`, display:'block' }}/>
                                : <div style={{ width:72, height:50, borderRadius:6, border:`1px solid ${DA.border}`, background:DA.grayXL, display:'flex', alignItems:'center', justifyContent:'center' }}><Ic n="map" s={18}/></div>
                              }
                              <div style={{ position:'absolute', bottom:2, left:2, right:2, fontSize:9, fontWeight:700, color:'white', textShadow:'0 1px 3px rgba(0,0,0,0.8)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.nom}</div>
                            </div>
                          ))}
                        </div>
                        {/* Les liens « Modifier les plans · Tout retirer » sont remplacés par
                            les icônes + / corbeille de l'en-tête du niveau (demande Thomas). */}
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          if (planLibrary.length === 0 && onOpenPlanLib) { onClose(); onOpenPlanLib(); return; }
                          if (onPickPlan) onPickPlan(loc.id);
                        }}
                        style={{ width:'100%', padding:'10px 12px', background:'none', border:'none', fontSize:12, color:DA.gray, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                        <Ic n="map" s={13}/>
                        {planLibrary.length === 0 ? 'Importer un plan' : 'Choisir un ou plusieurs plans →'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button onClick={addLoc}
            style={{ width:'100%',marginTop:8,padding:'13px 0',background:DA.white,border:`1.5px solid ${DA.red}`,borderRadius:12,fontSize:14,fontWeight:700,color:DA.red,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
            <Ic n="plus" s={15}/> Ajouter un niveau
          </button>
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 14px 20px',borderTop:`1px solid ${DA.border}`,flexShrink:0 }}>
          <button onClick={onClose}
            style={{ width:'100%',background:DA.red,color:'white',border:'none',borderRadius:12,padding:14,fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
            <Ic n="chk" s={15}/> Terminer
          </button>
        </div>
      </div>
    </div>
  );
}
