import React, { useState, useRef, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

export default function VisitesScreen({ projet, onBack, onSelectVisite, onUpdateProjet }) {
  const visites = projet.visites || [];
  const [editingId, setEditingId] = useState(null); // visite en mode édition

  const formatDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })
    : 'Ajouter une date';

  // ── Drag reorder ──────────────────────────────────────────────────────────
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const dragDidMove = useRef(false);
  const listRef     = useRef(null);

  // Touch drag
  const touchRef       = useRef(null);
  const ghostRef       = useRef(null);
  const wrapperRef     = useRef(null);
  const onTouchMoveRef = useRef(null);
  const onTouchEndRef  = useRef(null);

  useEffect(() => {
    onTouchMoveRef.current = onGripTouchMove;
    onTouchEndRef.current  = onGripTouchEnd;
  });
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const move = (e) => onTouchMoveRef.current(e);
    const end  = (e) => onTouchEndRef.current(e);
    el.addEventListener('touchmove',   move, { passive: false });
    el.addEventListener('touchend',    end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchmove',   move);
      el.removeEventListener('touchend',    end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  const onGripTouchStart = (e, idx) => {
    const touch = e.touches[0];
    dragDidMove.current = false;
    touchRef.current = { idx, startY: touch.clientY, curOverIdx: idx };
    setDragIdx(idx);
    const row = listRef.current?.children[idx];
    if (row) {
      const clone = row.cloneNode(true);
      clone.style.cssText = `position:fixed;left:${row.getBoundingClientRect().left}px;top:${touch.clientY - row.offsetHeight/2}px;width:${row.offsetWidth}px;opacity:0.85;background:white;boxShadow:0 8px 24px rgba(0,0,0,0.25);borderRadius:8px;zIndex:9998;pointerEvents:none;border:2px solid ${DA.red};`;
      document.body.appendChild(clone);
      ghostRef.current = clone;
    }
  };

  const onGripTouchMove = (e) => {
    if (!touchRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    dragDidMove.current = true;
    if (ghostRef.current) {
      const row = listRef.current?.children[touchRef.current.idx];
      if (row) ghostRef.current.style.top = `${touch.clientY - row.offsetHeight/2}px`;
    }
    if (!listRef.current) return;
    const listRect = listRef.current.getBoundingClientRect();
    const relY = touch.clientY - listRect.top;
    let cumH = 0, newOver = visites.length - 1;
    for (let j = 0; j < listRef.current.children.length; j++) {
      const h = listRef.current.children[j].offsetHeight;
      if (relY < cumH + h / 2) { newOver = j; break; }
      cumH += h;
    }
    touchRef.current.curOverIdx = newOver;
    setOverIdx(newOver);
  };

  const onGripTouchEnd = () => {
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
    if (!touchRef.current) return;
    const { idx, curOverIdx } = touchRef.current;
    touchRef.current = null;
    if (dragDidMove.current && idx !== curOverIdx) {
      const next = [...visites];
      const [moved] = next.splice(idx, 1);
      next.splice(curOverIdx, 0, moved);
      onUpdateProjet({ visites: next });
    }
    setDragIdx(null); setOverIdx(null);
  };

  const onDragStart = (i) => { setDragIdx(i); dragDidMove.current = false; };
  const onDragEnter = (i) => { setOverIdx(i); dragDidMove.current = true; };
  const onDragEnd   = () => {
    if (dragDidMove.current && dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const next = [...visites];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(overIdx, 0, moved);
      onUpdateProjet({ visites: next });
    }
    setDragIdx(null); setOverIdx(null); dragDidMove.current = false;
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const patchVisite = (visiteId, patch) =>
    onUpdateProjet({ visites: visites.map(v => v.id === visiteId ? { ...v, ...patch } : v) });

  const deleteVisite = (e, visiteId) => {
    e.stopPropagation();
    const v = visites.find(v => v.id === visiteId);
    const obsCount = (v?.localisations || []).flatMap(l => l.items || []).length;
    const msg = obsCount > 0
      ? `Supprimer "${v?.label || 'cette visite'}" et ses ${obsCount} observation${obsCount > 1 ? 's' : ''} ?`
      : `Supprimer "${v?.label || 'cette visite'}" ?`;
    if (!window.confirm(msg)) return;
    onUpdateProjet({ visites: visites.filter(vv => vv.id !== visiteId) });
    if (editingId === visiteId) setEditingId(null);
  };

  const addVisite = () => {
    const newId = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const planLibrary = projet.planLibrary || [];
    const lastVisite = visites[visites.length - 1];
    const localisations = (lastVisite?.localisations || []).map(loc => {
      const libPlan = planLibrary.find(p => p.bg && p.bg === loc.planBg);
      return {
        id: crypto.randomUUID(),
        nom: loc.nom,
        planBg: libPlan?.bg || loc.planBg || null,
        planData: libPlan?.data || loc.planData || null,
        planAnnotations: null,
        items: [],
      };
    });
    const newVisite = {
      id: newId,
      label: `Visite ${visites.length + 1}`,
      dateVisite: today,
      participants: [], tableauRecap: [],
      photosParLigne: 2, plansEnFin: false, rapportPageBreaks: [],
      includeTableauRecap: true, includeConclusion: false, conclusion: '',
      localisations,
    };
    onUpdateProjet({ visites: [...visites, newVisite] });
    onSelectVisite(newId);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:DA.grayXL }}>

      {/* Header */}
      <div style={{ background:DA.black, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'0 16px', minHeight:52 }}>
          <button onClick={onBack}
            style={{ color:'rgba(255,255,255,0.65)', background:'rgba(255,255,255,0.08)', border:'none', borderRadius:6, padding:'6px 10px', display:'flex', alignItems:'center', gap:3, cursor:'pointer', flexShrink:0 }}>
            <span style={{ display:'inline-block', transform:'rotate(90deg)', lineHeight:0 }}><Ic n="chv" s={13}/></span>
            <span style={{ fontSize:12, fontWeight:600 }}>Projets</span>
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontWeight:800, fontSize:15, color:'white', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.nom}</p>
            {projet.adresse && <p style={{ fontSize:11, color:'rgba(255,255,255,0.4)', margin:'2px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.adresse}</p>}
          </div>
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.4)', fontWeight:600, flexShrink:0 }}>{visites.length} visite{visites.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Liste */}
      <div ref={wrapperRef} style={{ flex:1, overflowY:'auto', background:'#E8E8E8' }}>
        <div style={{ maxWidth:860, margin:'0 auto', padding:'20px 16px 24px', display:'flex', flexDirection:'column', gap:14 }}>

        {/* Titre de section */}
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', padding:'0 4px 6px', borderBottom:`2px solid ${DA.red}`, marginBottom:2 }}>
          <div>
            <p style={{ fontSize:11, fontWeight:700, color:DA.red, textTransform:'uppercase', letterSpacing:1.2, margin:0 }}>Historique des visites</p>
            <p style={{ fontSize:22, fontWeight:900, color:DA.black, margin:'2px 0 0', letterSpacing:-0.5 }}>{visites.length} visite{visites.length !== 1 ? 's' : ''}</p>
          </div>
          <p style={{ fontSize:11, color:DA.grayL, margin:0, fontStyle:'italic' }}>
            Glisser pour réorganiser
          </p>
        </div>

        {visites.length === 0 && (
          <div style={{ background:'white', borderRadius:14, padding:'56px 24px', textAlign:'center', border:`1px solid ${DA.border}`, boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
            <div style={{ width:60, height:60, borderRadius:14, background:DA.redL, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px', color:DA.red }}>
              <Ic n="fil" s={30}/>
            </div>
            <p style={{ fontWeight:800, fontSize:17, color:DA.black, margin:'0 0 8px' }}>Aucune visite</p>
            <p style={{ color:DA.gray, fontSize:13, margin:0 }}>Créez la première visite pour commencer.</p>
          </div>
        )}

        <div ref={listRef} style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {visites.map((v, i) => {
            const obsCount   = (v.localisations || []).flatMap(l => l.items || []).length;
            const urgCount   = (v.localisations || []).flatMap(l => l.items || []).filter(i => i.urgence === 'haute').length;
            const zonesCount = (v.localisations || []).length;
            const isDragging = dragIdx === i;
            const isOver     = overIdx === i && dragIdx !== i;
            const isEditing  = editingId === v.id;
            const visiteNum  = i + 1;

            return (
              <div key={v.id}
                draggable={!isEditing}
                onDragStart={() => !isEditing && onDragStart(i)}
                onDragEnter={() => onDragEnter(i)}
                onDragEnd={onDragEnd}
                onDragOver={e => e.preventDefault()}
                style={{
                  display:'flex', alignItems:'stretch', gap:0,
                  background: isDragging ? '#f0f0f0' : isOver ? DA.redL : 'white',
                  borderRadius: 14,
                  border: `1px solid ${isOver ? DA.red : DA.border}`,
                  boxShadow: isDragging ? 'none' : '0 2px 12px rgba(0,0,0,0.08)',
                  overflow: 'hidden',
                  opacity: isDragging ? 0.45 : 1,
                  transition:'background 0.08s, opacity 0.08s, box-shadow 0.15s',
                }}>

                {/* Bande latérale colorée avec numéro */}
                <div style={{
                  flexShrink:0,
                  width:60,
                  background:`linear-gradient(180deg, ${DA.red}, #B91C1C)`,
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                  color:'white',
                  padding:'10px 0',
                }}>
                  <span style={{ fontSize:9, fontWeight:700, opacity:0.85, letterSpacing:1, textTransform:'uppercase' }}>Visite</span>
                  <span style={{ fontSize:32, fontWeight:900, lineHeight:1, marginTop:2 }}>{visiteNum}</span>
                  <div
                    onTouchStart={e => onGripTouchStart(e, i)}
                    onClick={e => e.stopPropagation()}
                    style={{ marginTop:8, cursor:'grab', color:'rgba(255,255,255,0.55)', touchAction:'none', padding:'4px 6px' }}>
                    <Ic n="grp" s={14}/>
                  </div>
                </div>

                {/* Zone tap → ouvre la visite (cachée en mode édition) */}
                {!isEditing ? (
                  <div onClick={() => onSelectVisite(v.id)}
                    style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center', gap:8, padding:'18px 16px', cursor:'pointer', minWidth:0 }}>

                    {/* Titre */}
                    <p style={{ fontWeight:800, fontSize:17, color:DA.black, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:-0.3 }}>{v.label || `Visite ${visiteNum}`}</p>

                    {/* Date avec icône */}
                    <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                      <span style={{
                        display:'inline-flex', alignItems:'center', justifyContent:'center',
                        width:24, height:24, borderRadius:6, background:DA.grayXL, border:`1px solid ${DA.border}`,
                        fontSize:12, lineHeight:1,
                      }} aria-hidden="true">
                        📅
                      </span>
                      <p style={{
                        fontSize:13, color:v.dateVisite ? DA.black : DA.grayL, margin:0,
                        fontWeight:v.dateVisite ? 600 : 400,
                        fontStyle: v.dateVisite ? 'normal' : 'italic',
                      }}>
                        {formatDate(v.dateVisite)}
                      </p>
                    </div>

                    {/* Tags */}
                    {(zonesCount > 0 || obsCount > 0 || urgCount > 0) && (
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:2 }}>
                        {zonesCount > 0 && (
                          <span style={{ fontSize:11, color:DA.gray, background:DA.grayXL, border:`1px solid ${DA.border}`, borderRadius:6, padding:'3px 9px', display:'inline-flex', alignItems:'center', gap:4, fontWeight:600 }}>
                            <Ic n="pin" s={10}/> {zonesCount} zone{zonesCount > 1 ? 's' : ''}
                          </span>
                        )}
                        {obsCount > 0 && (
                          <span style={{ fontSize:11, color:DA.gray, background:DA.grayXL, border:`1px solid ${DA.border}`, borderRadius:6, padding:'3px 9px', display:'inline-flex', alignItems:'center', gap:4, fontWeight:600 }}>
                            <Ic n="cam" s={10}/> {obsCount} obs
                          </span>
                        )}
                        {urgCount > 0 && (
                          <span style={{ fontSize:11, color:DA.red, background:DA.redL, border:`1px solid rgba(185,28,28,0.25)`, borderRadius:6, padding:'3px 9px', fontWeight:800, display:'inline-flex', alignItems:'center', gap:4 }}>
                            ⚠ {urgCount} urgente{urgCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Mode édition */
                  <div style={{ flex:1, padding:'18px 16px', minWidth:0 }} onClick={e => e.stopPropagation()}>
                    <p style={{ fontSize:10, fontWeight:800, color:DA.red, textTransform:'uppercase', letterSpacing:1, margin:'0 0 6px' }}>Nom de la visite</p>
                    <input
                      autoFocus
                      value={v.label || ''}
                      onChange={e => patchVisite(v.id, { label: e.target.value })}
                      placeholder="Ex: Diagnostic structure"
                      style={{ width:'100%', fontSize:16, fontWeight:700, color:DA.black, border:`1.5px solid ${DA.red}`, borderRadius:8, padding:'10px 12px', outline:'none', background:'white', boxSizing:'border-box', marginBottom:12 }}
                    />
                    <p style={{ fontSize:10, fontWeight:800, color:DA.gray, textTransform:'uppercase', letterSpacing:1, margin:'0 0 6px' }}>Date</p>
                    <input
                      type="date"
                      value={v.dateVisite || ''}
                      onChange={e => patchVisite(v.id, { dateVisite: e.target.value || null })}
                      style={{ fontSize:15, color:DA.black, border:`1.5px solid ${DA.border}`, borderRadius:8, padding:'10px 12px', outline:'none', background:'white', cursor:'pointer', width:'100%', boxSizing:'border-box' }}
                    />
                    <button onClick={() => setEditingId(null)}
                      style={{ marginTop:14, width:'100%', padding:'11px 0', background:DA.red, color:'white', border:'none', borderRadius:10, fontSize:14, fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, boxShadow:'0 2px 8px rgba(227,5,19,0.3)' }}>
                      <Ic n="chk" s={14}/> Valider
                    </button>
                  </div>
                )}

                {/* Actions droite */}
                <div style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6, padding:'12px 12px 12px 6px', borderLeft:`1px solid ${DA.grayXL}` }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => setEditingId(isEditing ? null : v.id)}
                    title={isEditing ? 'Fermer' : 'Modifier'}
                    style={{ width:34, height:34, padding:0, background: isEditing ? DA.redL : DA.grayXL, border: isEditing ? `1px solid #FCA5A5` : `1px solid ${DA.border}`, color: isEditing ? DA.red : DA.gray, cursor:'pointer', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.1s' }}
                    onMouseEnter={e => { if (!isEditing) { e.currentTarget.style.background = DA.redL; e.currentTarget.style.color = DA.red; e.currentTarget.style.borderColor = '#FCA5A5'; } }}
                    onMouseLeave={e => { if (!isEditing) { e.currentTarget.style.background = DA.grayXL; e.currentTarget.style.color = DA.gray; e.currentTarget.style.borderColor = DA.border; } }}>
                    <Ic n="pen" s={15}/>
                  </button>
                  {visites.length > 1 && (
                    <button onClick={e => deleteVisite(e, v.id)}
                      title="Supprimer"
                      style={{ width:34, height:34, padding:0, background:DA.grayXL, border:`1px solid ${DA.border}`, color:DA.grayL, cursor:'pointer', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.1s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.color = DA.red; e.currentTarget.style.borderColor = '#FCA5A5'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = DA.grayXL; e.currentTarget.style.color = DA.grayL; e.currentTarget.style.borderColor = DA.border; }}>
                      <Ic n="del" s={15}/>
                    </button>
                  )}
                  {!isEditing && (
                    <span style={{ color:DA.grayL, display:'flex', alignItems:'center', justifyContent:'center', width:34, height:24, transform:'rotate(-90deg)' }}>
                      <Ic n="chv" s={16}/>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={addVisite}
          style={{ width:'100%', padding:'18px 20px', display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontSize:16, fontWeight:800, color:'white', background:`linear-gradient(135deg, ${DA.red}, #B91C1C)`, border:'none', borderRadius:14, cursor:'pointer', boxShadow:'0 4px 16px rgba(227,5,19,0.35)', letterSpacing:0.3, marginTop:4 }}>
          <Ic n="plus" s={18}/> Nouvelle visite
        </button>

        </div>
      </div>
    </div>
  );
}
