import React, { useState, useRef, useMemo } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import EditTitle from '../ui/EditTitle.jsx';
import { renderPdfPage } from '../../lib/pdfUtils.js';
import PdfPagePicker from './PdfPagePicker.jsx';

// Pages issues d'un import PDF : nommées « NomDuPdf — Page N ».
const PDF_PAGE_RE = /\s*—\s*Page\s*(\d+)\s*$/i;

// ── Visionneuse tactile « Consulter les plans » ────────────────────────────────
// Toutes les pages du PDF à la suite. Gestes naturels (demande Thomas : pas de boutons) :
// pincement = zoom, un doigt = déplacement, double-tap = zoom ×2.5 / retour, molette = défiler,
// Ctrl+molette (ou pincement trackpad) = zoom sur PC. Transform translate+scale maison car le
// zoom navigateur est désactivé dans la PWA (user-scalable=no).
function ConsultViewer({ group, onClose }) {
  const [t, setT] = useState({ z: 1, x: 0, y: 0 });
  const boxRef   = useRef(null);   // conteneur visible (viewport)
  const innerRef = useRef(null);   // contenu (colonne de pages, largeur = viewport à z=1)
  const ptrs     = useRef(new Map());  // pointerId → {x,y}
  const gestRef  = useRef(null);       // instantané du geste { t, pts:[{x,y}…] }
  const tRef     = useRef(t); tRef.current = t;
  const lastTap  = useRef({ ts: 0, x: 0, y: 0 });

  const clampT = (nt) => {
    const box = boxRef.current, inner = innerRef.current;
    if (!box || !inner) return nt;
    const vw = box.clientWidth, vh = box.clientHeight;
    const cw = vw * nt.z;                       // largeur du contenu à l'échelle
    const ch = inner.offsetHeight * nt.z;       // hauteur naturelle × zoom
    const minX = Math.min(0, vw - cw), minY = Math.min(0, vh - ch);
    return { z: nt.z, x: Math.max(minX, Math.min(0, nt.x)), y: Math.max(minY, Math.min(0, nt.y)) };
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
      const z  = Math.max(1, Math.min(6, g.t.z * (d1 / d0)));
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
          if (cur.z > 1.05) setT(clampT({ z: 1, x: 0, y: cur.y / cur.z }));
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
      const z = Math.max(1, Math.min(6, cur.z * (e.deltaY < 0 ? 1.15 : 0.87)));
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
          {group.pages.map(p => (
            <div key={p.id} style={{ position:'relative',marginBottom:6 }}>
              {p.bg
                ? <img src={p.bg} alt="" draggable={false} style={{ width:'100%',display:'block',background:'white',pointerEvents:'none',userSelect:'none' }}/>
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

export default function NiveauxModal({ localisations, planLibrary, onChange, onClose, onOpenPlanLib, onPickPlan, onDeletePlan, onDeleteAllPlans, onRenamePlan, onRepairBg }) {
  const [confirmDelPlanId, setConfirmDelPlanId] = useState(null);
  // ── Consultation : toutes les pages d'un même PDF regroupées (demande Thomas : sur site,
  // feuilleter le document ENTIER au lieu d'ouvrir les plans un par un). Regroupement par
  // nom de base (« NomDuPdf — Page N » → « NomDuPdf »), pages triées par numéro.
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
          {/* Consultation : un bouton par PDF importé → visionneuse de TOUTES ses pages */}
          {pdfGroups.length > 0 && (
            <div style={{ marginBottom:16 }}>
              <p style={{ fontSize:11,fontWeight:700,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,margin:'0 0 8px' }}>
                Consulter les plans
              </p>
              <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
                {pdfGroups.map(g => (
                  <button key={g.nom} onClick={() => setConsultGroup(g)}
                    style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:9,
                      border:`1.5px solid ${DA.border}`,background:DA.grayXL,cursor:'pointer',textAlign:'left',width:'100%' }}>
                    <span style={{ fontSize:16,flexShrink:0 }}>📄</span>
                    <span style={{ flex:1,minWidth:0,fontSize:12.5,fontWeight:700,color:DA.black,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{g.nom}</span>
                    <span style={{ flexShrink:0,fontSize:11,fontWeight:700,color:DA.red,background:DA.redL,borderRadius:12,padding:'2px 8px' }}>
                      {g.pages.length} page{g.pages.length > 1 ? 's' : ''}
                    </span>
                    <span style={{ flexShrink:0,color:DA.grayL,fontSize:14 }}>›</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Section bibliothèque */}
          <div style={{ marginBottom:16 }}>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
              <p style={{ fontSize:11,fontWeight:700,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,margin:0 }}>
                Plans importés ({planLibrary.length})
              </p>
              <div style={{ display:'flex',gap:6,alignItems:'center' }}>
                {onDeletePlan && planLibrary.length > 0 && (confirmDelAll ? (
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
            ) : (
              <>
              {repairErr && <div style={{ background:'#FFF0F0',border:'1px solid #FCA5A5',borderRadius:6,padding:'6px 10px',marginBottom:6,fontSize:11,color:'#B91C1C' }}>⚠️ {repairErr}</div>}
              <input ref={repairFileRef} type="file" accept="image/*,application/pdf" style={{ display:'none' }} onChange={handleRepairFile}/>
              <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
                {planLibrary.map(pl => (
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
                ))}
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
                  </div>

                  {/* Zone plan */}
                  <div style={{ borderTop:`1px solid ${DA.border}` }}>
                    {hasPlan ? (
                      <>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:6, padding:'10px 12px 6px' }}>
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
                        <div style={{ display:'flex', gap:8, padding:'0 12px 10px' }}>
                          <button onClick={() => onPickPlan && onPickPlan(loc.id)}
                            style={{ fontSize:11, color:DA.red, background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:700 }}>
                            <Ic n="pen" s={10}/> Modifier les plans
                          </button>
                          <span style={{ color:DA.grayL, fontSize:11 }}>·</span>
                          <button onClick={() => removePlan(loc.id)}
                            style={{ fontSize:11, color:DA.grayL, background:'none', border:'none', cursor:'pointer', padding:0 }}>
                            Tout retirer
                          </button>
                        </div>
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
