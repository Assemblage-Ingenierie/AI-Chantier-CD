import React, { useState, useRef, useMemo, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import EditTitle from '../ui/EditTitle.jsx';
import { renderPdfPage, renderPdfPageHQ } from '../../lib/pdfUtils.js';
import { fetchPlanHdDataUrl, fetchPlanData } from '../../lib/storage.js';
import PdfPagePicker from './PdfPagePicker.jsx';

// Pages issues d'un import PDF : nommées « NomDuPdf — Page N ».
const PDF_PAGE_RE = /\s*—\s*Page\s*(\d+)\s*$/i;

// ── Visionneuse « Consulter les plans » ────────────────────────────────────────
// Deux modes (demande Thomas : sur PC le transform maison n'était « pas du tout pratique ») :
//  - tactile (pointer: coarse)  → gestes pincement/déplacement/double-tap (ConsultViewerTouch)
//  - PC                          → lecteur PDF CLASSIQUE : défilement natif (molette,
//    scrollbars), barre de zoom − / % / +, Ctrl+molette = zoom, cliquer-glisser = déplacer.
function ConsultViewer({ group, onClose }) {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
  // QUALITÉ (demande Thomas : « les plans importés sont d'une super mauvaise qualité ») :
  // l'aperçu standard (bg, 1600 px) est illisible une fois zoomé. Chaque page est upgradée
  // vers son image HD dès que possible — même chaîne de repli que l'annotateur :
  // HD en mémoire (import frais) → Storage/IndexedDB (fetchPlanHdDataUrl) → rendu HQ
  // depuis le PDF brut s'il est présent. Le bg reste affiché en attendant (swap sans saut).
  const [hdById, setHdById] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of (group.pages || [])) {
        if (cancelled) return;
        try {
          let hd = (typeof p.hd === 'string' && p.hd.startsWith('data:')) ? p.hd : null;
          if (!hd && p.id) hd = await fetchPlanHdDataUrl(p.id);
          if (!hd && typeof p.data === 'string' && p.data.startsWith('data:application/pdf')) {
            hd = await renderPdfPageHQ(p.data, p._page || 1);
          }
          // PC uniquement (mémoire) : si aucune HD stockée, tenter le PDF BRUT en base
          // (plans legacy) et rendre en très haute résolution — « tel que le PDF ».
          if (!hd && !coarse && p.id) {
            const fd = await fetchPlanData(p.id);
            if (typeof fd?.data === 'string' && fd.data.startsWith('data:application/pdf')) {
              hd = await renderPdfPageHQ(fd.data, p._page || 1);
            }
          }
          if (!cancelled && hd) setHdById(h => ({ ...h, [p.id]: hd }));
        } catch { /* le bg reste affiché */ }
      }
    })();
    return () => { cancelled = true; };
  }, [group]);
  return coarse
    ? <ConsultViewerTouch group={group} hdById={hdById} onClose={onClose}/>
    : <ConsultViewerDesktop group={group} hdById={hdById} onClose={onClose}/>;
}

// Lecteur classique PC : les pages empilées dans un conteneur à défilement NATIF.
// Le zoom change simplement la largeur du contenu (% du viewport) — le navigateur gère
// scrollbars et molette tout seul, comme un vrai viewer PDF.
function ConsultViewerDesktop({ group, hdById = {}, onClose }) {
  const [z, setZ] = useState(1); // 1 = adapté à la largeur
  const zRef = useRef(z); zRef.current = z;
  const scrollRef = useRef(null);
  const dragRef = useRef(null);

  // Zoom en conservant le point focal (position sous le curseur si fournie).
  const setZoom = (nzRaw, fx = null, fy = null) => {
    const el = scrollRef.current;
    const nz = Math.max(0.3, Math.min(6, nzRaw));
    if (el) {
      const rect = el.getBoundingClientRect();
      const px = fx != null ? fx - rect.left : rect.width / 2;
      const py = fy != null ? fy - rect.top : rect.height / 2;
      const ratio = nz / zRef.current;
      const sl = (el.scrollLeft + px) * ratio - px;
      const st = (el.scrollTop + py) * ratio - py;
      setZ(nz);
      requestAnimationFrame(() => { el.scrollLeft = sl; el.scrollTop = st; });
    } else setZ(nz);
  };

  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(zRef.current * (e.deltaY < 0 ? 1.15 : 0.87), e.clientX, e.clientY);
    }
    // Sans Ctrl : défilement natif du conteneur (ne rien faire).
  };

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

  const zBtn = { width:34, height:34, borderRadius:8, border:'none', background:'rgba(255,255,255,0.12)',
    color:'white', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
    flexShrink:0, fontSize:17, fontWeight:800, lineHeight:1 };

  return (
    <div style={{ position:'fixed',inset:0,background:'#111',zIndex:80,display:'flex',flexDirection:'column' }}>
      <div style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#1a1a1a',borderBottom:'1px solid #2a2a2a',flexShrink:0 }}>
        <span style={{ fontSize:15,flexShrink:0 }}>📄</span>
        <p style={{ flex:1,minWidth:0,fontSize:13,fontWeight:700,color:'white',margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
          {group.nom} <span style={{ color:'rgba(255,255,255,0.45)',fontWeight:400 }}>· {group.pages.length} page{group.pages.length > 1 ? 's' : ''}</span>
        </p>
        <button onClick={() => setZoom(zRef.current / 1.25)} title="Zoom arrière" style={zBtn}>−</button>
        <button onClick={() => setZoom(1)} title="Adapter à la largeur"
          style={{ ...zBtn, width:'auto', padding:'0 10px', fontSize:12, fontWeight:700 }}>
          {Math.round(z * 100)} %
        </button>
        <button onClick={() => setZoom(zRef.current * 1.25)} title="Zoom avant" style={zBtn}>+</button>
        <span style={{ flexShrink:0,fontSize:10,color:'rgba(255,255,255,0.45)',whiteSpace:'nowrap',marginLeft:4 }}>
          Ctrl + molette : zoom · glisser : déplacer
        </span>
        <button onClick={onClose} style={{ ...zBtn, marginLeft:4 }}>
          <Ic n="x" s={16}/>
        </button>
      </div>
      <div ref={scrollRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ flex:1, overflow:'auto', cursor: dragRef.current ? 'grabbing' : 'grab' }}>
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
function ConsultViewerTouch({ group, hdById = {}, onClose }) {
  const [t, setT] = useState({ z: 1, x: 0, y: 0 });
  const boxRef   = useRef(null);   // conteneur visible (viewport)
  const innerRef = useRef(null);   // contenu (colonne de pages, largeur = viewport à z=1)
  const ptrs     = useRef(new Map());  // pointerId → {x,y}
  const gestRef  = useRef(null);       // instantané du geste { t, pts:[{x,y}…] }
  const tRef     = useRef(t); tRef.current = t;
  const lastTap  = useRef({ ts: 0, x: 0, y: 0 });
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
    const vw = box.clientWidth, vh = box.clientHeight;
    const pageH = vw / ar;                       // hauteur affichée de la page à z=1 (largeur = vw)
    const fz = Math.min(1, vh / pageH);          // z pour voir la page en entier
    setMinZ(fz);
    setT({ z: fz, x: (vw - vw * fz) / 2, y: 0 }); // centrée horizontalement
  };

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

  const snapshot = () => { gestRef.current = { t: { ...tRef.current }, pts: [...ptrs.current.values()].map(p => ({ ...p })) }; };

  const onDown = (e) => {
    boxRef.current?.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    snapshot();
  };
  const onMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestRef.current;
    if (!g) return;
    const pts = [...ptrs.current.values()];
    if (pts.length >= 2 && g.pts.length >= 2) {
      // Pincement : zoom autour du point médian (le point du plan sous les doigts reste sous les doigts)
      const d0 = Math.hypot(g.pts[1].x - g.pts[0].x, g.pts[1].y - g.pts[0].y) || 1;
      const d1 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const z  = Math.max(minZRef.current, Math.min(6, g.t.z * (d1 / d0)));
      const m0 = { x: (g.pts[0].x + g.pts[1].x) / 2, y: (g.pts[0].y + g.pts[1].y) / 2 };
      const m1 = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const cx = (m0.x - g.t.x) / g.t.z, cy = (m0.y - g.t.y) / g.t.z;
      setT(clampT({ z, x: m1.x - cx * z, y: m1.y - cy * z }));
    } else if (pts.length === 1 && g.pts.length >= 1) {
      // Un doigt : déplacement libre (vertical pour feuilleter, horizontal quand zoomé)
      setT(clampT({ z: g.t.z, x: g.t.x + (pts[0].x - g.pts[0].x), y: g.t.y + (pts[0].y - g.pts[0].y) }));
    }
  };
  const onUp = (e) => {
    const p = ptrs.current.get(e.pointerId);
    ptrs.current.delete(e.pointerId);
    // Double-tap : zoom ×2.5 centré sur le tap, ou retour à 100 %
    if (p && ptrs.current.size === 0 && gestRef.current?.pts.length === 1) {
      const moved = Math.hypot(e.clientX - gestRef.current.pts[0].x, e.clientY - gestRef.current.pts[0].y);
      const now = Date.now();
      if (moved < 12) {
        if (now - lastTap.current.ts < 320 && Math.hypot(e.clientX - lastTap.current.x, e.clientY - lastTap.current.y) < 40) {
          const cur = tRef.current;
          if (cur.z > minZRef.current * 1.05) {
            const box = boxRef.current;
            const vw = box ? box.clientWidth : 0;
            setT(clampT({ z: minZRef.current, x: (vw - vw * minZRef.current) / 2, y: cur.y * (minZRef.current / cur.z) }));
          }
          else {
            const z = 2.5;
            const cx = (e.clientX - cur.x) / cur.z, cy = (e.clientY - cur.y) / cur.z;
            setT(clampT({ z, x: e.clientX - cx * z, y: e.clientY - cy * z }));
          }
          lastTap.current = { ts: 0, x: 0, y: 0 };
        } else lastTap.current = { ts: now, x: e.clientX, y: e.clientY };
      }
    }
    snapshot(); // re-cale le geste sur les doigts restants (2 → 1 doigt sans saut)
  };
  const onWheel = (e) => {
    e.preventDefault();
    const cur = tRef.current;
    if (e.ctrlKey || e.metaKey) {
      const z = Math.max(minZRef.current, Math.min(6, cur.z * (e.deltaY < 0 ? 1.15 : 0.87)));
      const cx = (e.clientX - cur.x) / cur.z, cy = (e.clientY - cur.y) / cur.z;
      setT(clampT({ z, x: e.clientX - cx * z, y: e.clientY - cy * z }));
    } else {
      setT(clampT({ ...cur, x: cur.x - e.deltaX, y: cur.y - e.deltaY }));
    }
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'#111',zIndex:80,display:'flex',flexDirection:'column' }}>
      <div style={{ display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:'#1a1a1a',borderBottom:'1px solid #2a2a2a',flexShrink:0 }}>
        <span style={{ fontSize:15,flexShrink:0 }}>📄</span>
        <p style={{ flex:1,minWidth:0,fontSize:13,fontWeight:700,color:'white',margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
          {group.nom} <span style={{ color:'rgba(255,255,255,0.45)',fontWeight:400 }}>· {group.pages.length} page{group.pages.length > 1 ? 's' : ''}</span>
        </p>
        {typeof window !== 'undefined' && window.innerWidth >= 900 && (
          <span style={{ flexShrink:0,fontSize:10,color:'rgba(255,255,255,0.45)',whiteSpace:'nowrap' }}>Ctrl + molette : zoom</span>
        )}
        <button onClick={onClose}
          style={{ width:36,height:36,borderRadius:8,border:'none',background:'rgba(255,255,255,0.12)',color:'white',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0 }}>
          <Ic n="x" s={16}/>
        </button>
      </div>
      <div ref={boxRef}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onWheel={onWheel}
        style={{ flex:1,overflow:'hidden',position:'relative',touchAction:'none',cursor:'grab' }}>
        <div ref={innerRef}
          style={{ width:'100%',transform:`translate(${t.x}px, ${t.y}px) scale(${t.z})`,transformOrigin:'0 0' }}>
          {group.pages.map((p, i) => (
            <div key={p.id} style={{ position:'relative',marginBottom:6 }}>
              {(hdById[p.id] || p.bg)
                ? <img src={hdById[p.id] || p.bg} alt="" draggable={false}
                    onLoad={i === 0 ? (e) => applyFit(e.target.naturalWidth / e.target.naturalHeight) : undefined}
                    style={{ width:'100%',display:'block',background:'white',pointerEvents:'none',userSelect:'none' }}/>
                : <div style={{ padding:'40px 0',textAlign:'center',color:'rgba(255,255,255,0.5)',fontSize:12,background:'#222' }}>Page {p._page} — image non disponible sur cet appareil</div>}
              <span style={{ position:'absolute',bottom:8,right:8,background:'rgba(0,0,0,0.65)',color:'white',fontSize:11,fontWeight:700,borderRadius:6,padding:'3px 8px' }}>
                Page {p._page}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function NiveauxModal({ localisations, planLibrary, onChange, onClose, onOpenPlanLib, onPickPlan, onDeletePlan, onDeleteAllPlans, onRenamePlan, onRepairBg, planFolders = [], onUpdateFolders = null, onReorderPlans = null }) {
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
  // Groupes de « Plans importés » dépliés (TOUT est replié par défaut — demande Thomas).
  const [openImported, setOpenImported] = useState(() => new Set());
  // ⚠️ Tous les états utilisés par renderImportedRow/renderPdfTile sont déclarés ICI, AVANT
  // ces fonctions (règle TDZ de CLAUDE.md — incident du 2026-07-07).
  const [consultGroup, setConsultGroup] = useState(null); // groupe ouvert dans la visionneuse
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

  // TUILE d'un PDF (taille UNIFORME partout, dans une case ou non — demande Thomas) :
  // sigle Ai + titre lisible (pas de miniature), clic = consulter. Icône « déplacer » en haut
  // à droite : glisser sur une autre tuile = regrouper (PC) ; tap = menu « Ranger dans… »
  // (mobile, où le glisser-déposer HTML5 n'existe pas). Actions : ✎ renommer, 🗑 supprimer.
  const renderPdfTile = (g) => {
    // Zone de dépôt : MILIEU = regrouper dans une case, BORD gauche/droit = réordonner.
    const hintZone = (dropHint?.base === g.nom && dragBase && dragBase !== g.nom) ? dropHint.zone : null;
    const actBtn = (active = false) => ({ flex:1, height:34, borderRadius:8, border:`1px solid ${active ? DA.red : DA.border}`,
      background:'white', color: active ? DA.red : DA.gray, cursor:'pointer',
      display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 });
    return (
      <div key={g.nom}
        draggable={dragArmBase === g.nom}
        // GARDE : sans armement par la poignée, on TUE le dragstart (e.preventDefault) —
        // sinon la sélection de texte dans l'input de renommage déclenche le drag natif de
        // la sélection, qui remonte ici et « déplace la tuile » (bug récurrent, Thomas).
        onDragStart={e => {
          if (dragArmBase !== g.nom) { e.preventDefault(); e.stopPropagation(); return; }
          e.stopPropagation(); // ne pas déclencher aussi le drag de la CASE parente
          setDragBase(g.nom); try { e.dataTransfer.effectAllowed = 'move'; } catch { /* ok */ }
        }}
        onDragEnd={() => { setDragBase(null); setDragArmBase(null); setDropHint(null); }}
        onDragOver={e => {
          if (!dragBase || dragBase === g.nom) return;
          e.preventDefault(); e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - r.left) / Math.max(1, r.width);
          setDropHint({ base: g.nom, zone: x < 0.3 ? 'before' : x > 0.7 ? 'after' : 'group' });
        }}
        onDragLeave={() => { if (dropHint?.base === g.nom) setDropHint(null); }}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation();
          if (dragBase && dragBase !== g.nom) {
            const zone = dropHint?.base === g.nom ? dropHint.zone : 'group';
            if (zone === 'group') groupBases(dragBase, g.nom);
            else reorderBases(dragBase, g.nom, zone === 'after');
          }
          setDragBase(null); setDragArmBase(null); setDropHint(null);
        }}
        onMouseUp={() => setDragArmBase(null)}
        style={{ position:'relative', width:150, flexShrink:0, boxSizing:'border-box',
          border:`1.5px solid ${hintZone === 'group' ? DA.red : DA.border}`, borderRadius:12,
          background: hintZone === 'group' ? DA.redL : 'white', overflow:'hidden',
          display:'flex', flexDirection:'column',
          boxShadow: hintZone === 'before' ? `inset 4px 0 0 ${DA.red}` : hintZone === 'after' ? `inset -4px 0 0 ${DA.red}` : '0 1px 4px rgba(0,0,0,0.05)',
          opacity: dragBase === g.nom ? 0.45 : 1, transition:'border-color 0.1s, background 0.1s' }}>
        {/* Icône déplacer (drag PC / menu tactile) */}
        {onUpdateFolders && (
          <div
            onMouseDown={() => setDragArmBase(g.nom)}
            onClick={() => { setRenamePdf(null); setConfirmDelPdf(null); setMovePdf(movePdf === g.nom ? null : g.nom); }}
            title="Glisser sur une autre tuile pour regrouper — ou appuyer pour choisir une case"
            style={{ position:'absolute', top:5, right:5, width:30, height:30, borderRadius:8, cursor:'grab',
              display:'flex', alignItems:'center', justifyContent:'center', color:DA.grayL, background:'white',
              border:`1px solid ${movePdf === g.nom ? DA.red : 'transparent'}`, zIndex:1 }}>
            <Ic n="grp" s={14}/>
          </div>
        )}
        {/* Zone cliquable : nom COMPLET (jamais tronqué — demande Thomas), sigle Ai en
            filigrane léger derrière le texte. → ouvre la visionneuse */}
        <div onClick={() => setConsultGroup(g)} style={{ cursor:'pointer', textAlign:'center', position:'relative', padding:'14px 10px 4px' }}>
          <div aria-hidden style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
            <span style={{ fontWeight:900, fontSize:52, letterSpacing:-2, color:DA.red, opacity:0.07, userSelect:'none' }}>Ai</span>
          </div>
          {/* Titre EN GRAND et TOUJOURS entier — pas de compteur de pages (demande Thomas). */}
          <p style={{ position:'relative', fontSize:15.5, fontWeight:800, color:DA.black, margin:'0 0 8px', lineHeight:1.25,
            whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word', minHeight:'2.5em' }}>
            {g.nom}
          </p>
        </div>
        {/* Actions */}
        <div style={{ display:'flex', gap:5, padding:'0 8px 8px', marginTop:'auto' }}>
          {onRenamePlan && (
            <button onClick={() => { setMovePdf(null); setConfirmDelPdf(null); setRenamePdf(renamePdf?.base === g.nom ? null : { base: g.nom, val: g.nom }); }}
              title="Renommer le PDF entier (toutes ses pages)" style={actBtn(renamePdf?.base === g.nom)}>
              <Ic n="edt" s={14}/>
            </button>
          )}
          {onDeletePlan && (
            <button onClick={() => { setRenamePdf(null); setMovePdf(null); setConfirmDelPdf(confirmDelPdf === g.nom ? null : g.nom); }}
              title="Supprimer ce PDF (toutes ses pages)" style={actBtn(confirmDelPdf === g.nom)}>
              <Ic n="del" s={14}/>
            </button>
          )}
        </div>
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
        {movePdf === g.nom && (
          <div style={{ display:'flex', gap:5, flexWrap:'wrap', alignItems:'center', padding:'0 8px 8px' }}>
            <span style={{ fontSize:10, fontWeight:700, color:DA.grayL, textTransform:'uppercase', letterSpacing:0.4, width:'100%' }}>Ranger dans :</span>
            {folders.map(f => {
              const active = (f.bases || []).includes(g.nom);
              return (
                <button key={f.id} onClick={() => moveBase(g.nom, active ? null : f.id)}
                  style={{ padding:'6px 11px', borderRadius:16, fontSize:11.5, fontWeight:700, cursor:'pointer',
                    border:`1.5px solid ${active ? DA.red : DA.border}`, background: active ? DA.redL : 'white', color: active ? DA.red : DA.gray }}>
                  {f.nom || 'Sans nom'}{active ? ' ✓' : ''}
                </button>
              );
            })}
            <button onClick={() => { const id = crypto.randomUUID(); setFolders([...folders, { id, nom: '', bases: [g.nom] }].map(f => f.id === id ? f : { ...f, bases: (f.bases || []).filter(b => b !== g.nom) })); setMovePdf(null); setEditingFolderId(id); setEditingFolderNom(''); }}
              style={{ padding:'6px 11px', borderRadius:16, fontSize:11.5, fontWeight:700, cursor:'pointer', border:`1.5px dashed ${DA.red}`, background:'white', color:DA.red }}>
              + Nouvelle case
            </button>
          </div>
        )}
        {confirmDelPdf === g.nom && (
          <div style={{ display:'flex', gap:5, alignItems:'center', padding:'0 8px 8px' }}>
            <button onClick={() => deleteWholePdf(g)}
              style={{ flex:1, padding:'7px 0', borderRadius:8, border:'none', background:'#B91C1C', color:'white', fontSize:11.5, fontWeight:800, cursor:'pointer' }}>
              Supprimer ({g.pages.length} p.)
            </button>
            <button onClick={() => setConfirmDelPdf(null)}
              style={{ flex:1, padding:'7px 0', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:'#555', fontSize:11.5, fontWeight:700, cursor:'pointer' }}>
              Annuler
            </button>
          </div>
        )}
      </div>
    );
  };

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
  if (consultGroup) return <ConsultViewer group={consultGroup} onClose={() => setConsultGroup(null)}/>;

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
                {dragBase && (
                  <span style={{ fontSize:10.5,color:DA.grayL }}>milieu = regrouper · bord = ordonner · fond = sortir d'une case</span>
                )}
              </div>

              {/* FLUX CONTINU (demande Thomas : pas de saut de ligne) : les cases entourent
                  simplement leurs tuiles et tout s'enchaîne sur la même rangée. Les cases se
                  créent par fusion (glisser une tuile au MILIEU d'une autre) — pas de bouton.
                  Déposer sur le FOND (hors tuile/case) sort le PDF de sa case. */}
              <div
                onDragOver={e => { if (dragBase) e.preventDefault(); }}
                onDrop={e => { e.preventDefault(); if (dragBase) { moveBase(dragBase, null); setDragBase(null); setDragArmBase(null); setDropHint(null); } }}
                style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'stretch' }}>
                {folders.map(f => (
                  <div key={f.id}
                    draggable={dragArmFolder === f.id}
                    onDragStart={e => {
                      if (dragArmFolder !== f.id) { e.preventDefault(); return; }
                      setDragFolder(f.id); try { e.dataTransfer.effectAllowed = 'move'; } catch { /* ok */ }
                    }}
                    onDragEnd={() => { setDragFolder(null); setDragArmFolder(null); setFolderDropHint(null); }}
                    onDragOver={e => {
                      if (dragBase) { e.preventDefault(); e.stopPropagation(); return; }
                      if (dragFolder && dragFolder !== f.id) {
                        e.preventDefault(); e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        setFolderDropHint({ id: f.id, after: (e.clientX - r.left) > r.width / 2 });
                      }
                    }}
                    onDragLeave={() => { if (folderDropHint?.id === f.id) setFolderDropHint(null); }}
                    onDrop={e => {
                      e.preventDefault(); e.stopPropagation();
                      if (dragBase) { moveBase(dragBase, f.id); }
                      else if (dragFolder && dragFolder !== f.id) {
                        reorderFolders(dragFolder, f.id, folderDropHint?.id === f.id ? folderDropHint.after : true);
                      }
                      setDragBase(null); setDragArmBase(null); setDropHint(null);
                      setDragFolder(null); setDragArmFolder(null); setFolderDropHint(null);
                    }}
                    onMouseUp={() => setDragArmFolder(null)}
                    style={{ border:`1.5px solid ${DA.border}`,borderRadius:14,background:'#FAFBFC',padding:'6px 8px 8px',
                      boxShadow: folderDropHint?.id === f.id && dragFolder
                        ? (folderDropHint.after ? `inset -4px 0 0 ${DA.red}` : `inset 4px 0 0 ${DA.red}`)
                        : '0 1px 3px rgba(0,0,0,0.04)',
                      opacity: dragFolder === f.id ? 0.45 : 1,
                      maxWidth:'100%',boxSizing:'border-box' }}>
                    <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:6 }}>
                      {/* Poignée de réorganisation des cases (symétrique du ✕ → titre centré) */}
                      {editingFolderId !== f.id && (
                        <span onMouseDown={() => setDragArmFolder(f.id)}
                          title="Glisser pour réorganiser les cases"
                          style={{ width:26, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color:DA.grayL, cursor:'grab' }}>
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
                      {(f.bases || []).map(b => groupsByBase.get(b)).filter(Boolean).map(g => renderPdfTile(g))}
                      {(f.bases || []).length === 0 && (
                        <p style={{ fontSize:11,color:DA.grayL,margin:'0 2px 4px',fontStyle:'italic' }}>Case vide — déposez un plan ici.</p>
                      )}
                    </div>
                  </div>
                ))}
                {unassignedGroups.map(g => renderPdfTile(g))}
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
