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
      <div style={{ background:DA.black, padding:'12px 14px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={onBack}
            style={{ color:'rgba(255,255,255,0.7)', background:'rgba(255,255,255,0.08)', border:'none', borderRadius:6, padding:'7px 10px', display:'flex', alignItems:'center', gap:3, cursor:'pointer', flexShrink:0 }}>
            <span style={{ display:'inline-block', transform:'rotate(90deg)', lineHeight:0 }}><Ic n="chv" s={14}/></span>
            <span style={{ fontSize:13, fontWeight:600 }}>Projets</span>
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontWeight:800, fontSize:16, color:'white', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.nom}</p>
            {projet.adresse && <p style={{ fontSize:12, color:'rgba(255,255,255,0.45)', margin:'3px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.adresse}</p>}
          </div>
          <span style={{ fontSize:12, color:'rgba(255,255,255,0.4)', fontWeight:600, flexShrink:0 }}>{visites.length} visite{visites.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Liste */}
      <div ref={wrapperRef} style={{ flex:1, overflowY:'auto', background:'#E8E8E8' }}>
        <div style={{ maxWidth:860, margin:'0 auto', padding:'14px 14px', display:'flex', flexDirection:'column', gap:10 }}>

        {visites.length === 0 && (
          <div style={{ background:'white', borderRadius:12, padding:'48px 24px', textAlign:'center', border:`1px solid ${DA.border}` }}>
            <div style={{ width:48, height:48, borderRadius:12, background:DA.redL, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', color:DA.red }}>
              <Ic n="fil" s={24}/>
            </div>
            <p style={{ fontWeight:700, fontSize:15, color:DA.black, margin:'0 0 6px' }}>Aucune visite</p>
            <p style={{ color:DA.gray, fontSize:12, margin:0 }}>Créez la première visite pour commencer.</p>
          </div>
        )}

        <div ref={listRef} style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {visites.map((v, i) => {
            const obsCount   = (v.localisations || []).flatMap(l => l.items || []).length;
            const urgCount   = (v.localisations || []).flatMap(l => l.items || []).filter(i => i.urgence === 'haute').length;
            const zonesCount = (v.localisations || []).length;
            const isDragging = dragIdx === i;
            const isOver     = overIdx === i && dragIdx !== i;
            const isEditing  = editingId === v.id;

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
                  borderRadius: 10,
                  border: `1px solid ${isOver ? DA.red : DA.border}`,
                  boxShadow: isDragging ? 'none' : '0 1px 4px rgba(0,0,0,0.07)',
                  borderLeft: isEditing ? `3px solid ${DA.red}` : undefined,
                  overflow: 'hidden',
                  opacity: isDragging ? 0.45 : 1,
                  transition:'background 0.08s, opacity 0.08s',
                }}>

                {/* Poignée drag */}
                <div
                  onTouchStart={e => onGripTouchStart(e, i)}
                  onClick={e => e.stopPropagation()}
                  style={{ flexShrink:0, display:'flex', alignItems:'center', padding:'0 6px 0 10px', cursor:'grab', color:'#ccc', touchAction:'none' }}>
                  <Ic n="grp" s={16}/>
                </div>

                {/* Zone tap → ouvre la visite (cachée en mode édition) */}
                {!isEditing ? (
                  <div onClick={() => onSelectVisite(v.id)}
                    style={{ flex:1, display:'flex', alignItems:'center', gap:12, padding:'14px 10px 14px 6px', cursor:'pointer', minWidth:0 }}>
                    <div style={{ width:40, height:40, borderRadius:10, background:DA.redL, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:DA.red }}>
                      <Ic n="fil" s={18}/>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontWeight:700, fontSize:15, color:DA.black, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.label || 'Visite'}</p>
                      <p style={{ fontSize:12, color:v.dateVisite ? DA.gray : DA.grayL, margin:'3px 0 0', fontStyle: v.dateVisite ? 'normal' : 'italic' }}>
                        {formatDate(v.dateVisite)}
                      </p>
                      {(zonesCount > 0 || obsCount > 0 || urgCount > 0) && (
                        <div style={{ display:'flex', gap:5, marginTop:5, flexWrap:'wrap' }}>
                          {zonesCount > 0 && <span style={{ fontSize:11, color:DA.grayL, background:DA.grayXL, border:`1px solid ${DA.border}`, borderRadius:20, padding:'2px 8px' }}>{zonesCount} zone{zonesCount > 1 ? 's' : ''}</span>}
                          {obsCount > 0 && <span style={{ fontSize:11, color:DA.grayL, background:DA.grayXL, border:`1px solid ${DA.border}`, borderRadius:20, padding:'2px 8px', display:'inline-flex', alignItems:'center', gap:3 }}><Ic n="pin" s={9}/> {obsCount} obs</span>}
                          {urgCount > 0 && <span style={{ fontSize:11, color:DA.red, background:DA.redL, border:`1px solid rgba(185,28,28,0.15)`, borderRadius:20, padding:'2px 8px', fontWeight:700 }}>⚠ {urgCount} urgente{urgCount > 1 ? 's' : ''}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Mode édition */
                  <div style={{ flex:1, padding:'12px 10px', minWidth:0 }} onClick={e => e.stopPropagation()}>
                    <p style={{ fontSize:10, fontWeight:700, color:DA.red, textTransform:'uppercase', letterSpacing:0.6, margin:'0 0 6px' }}>Nom de la visite</p>
                    <input
                      autoFocus
                      value={v.label || ''}
                      onChange={e => patchVisite(v.id, { label: e.target.value })}
                      style={{ width:'100%', fontSize:15, fontWeight:700, color:DA.black, border:`1.5px solid ${DA.red}`, borderRadius:8, padding:'8px 10px', outline:'none', background:'white', boxSizing:'border-box', marginBottom:10 }}
                    />
                    <p style={{ fontSize:10, fontWeight:700, color:DA.gray, textTransform:'uppercase', letterSpacing:0.6, margin:'0 0 6px' }}>Date</p>
                    <input
                      type="date"
                      value={v.dateVisite || ''}
                      onChange={e => patchVisite(v.id, { dateVisite: e.target.value || null })}
                      style={{ fontSize:14, color:DA.black, border:`1.5px solid ${DA.border}`, borderRadius:8, padding:'8px 10px', outline:'none', background:'white', cursor:'pointer', width:'100%', boxSizing:'border-box' }}
                    />
                    <button onClick={() => setEditingId(null)}
                      style={{ marginTop:10, width:'100%', padding:'9px 0', background:DA.red, color:'white', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                      <Ic n="chk" s={13}/> Valider
                    </button>
                  </div>
                )}

                {/* Actions droite */}
                <div style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4, padding:'0 10px 0 4px' }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => setEditingId(isEditing ? null : v.id)}
                    style={{ padding:'6px 7px', background: isEditing ? DA.redL : 'none', border: isEditing ? `1px solid #FCA5A5` : 'none', color: isEditing ? DA.red : '#bbb', cursor:'pointer', borderRadius:7, display:'flex', alignItems:'center', transition:'all 0.1s' }}
                    onMouseEnter={e => { if (!isEditing) e.currentTarget.style.color = DA.black; }}
                    onMouseLeave={e => { if (!isEditing) e.currentTarget.style.color = '#bbb'; }}>
                    <Ic n="pen" s={14}/>
                  </button>
                  {visites.length > 1 && (
                    <button onClick={e => deleteVisite(e, v.id)}
                      style={{ padding:'6px 7px', background:'none', border:'none', color:'#ccc', cursor:'pointer', borderRadius:7, display:'flex', alignItems:'center' }}
                      onMouseEnter={e => e.currentTarget.style.color = DA.red}
                      onMouseLeave={e => e.currentTarget.style.color = '#ccc'}>
                      <Ic n="del" s={14}/>
                    </button>
                  )}
                  {!isEditing && <span style={{ color:'#ccc', display:'flex', alignItems:'center', transform:'rotate(-90deg)' }}><Ic n="chv" s={15}/></span>}
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={addVisite}
          style={{ width:'100%', padding:16, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize:15, fontWeight:700, color:'white', background:DA.red, border:'none', borderRadius:10, cursor:'pointer', boxShadow:'0 2px 8px rgba(227,5,19,0.25)' }}>
          <Ic n="plus" s={16}/> Nouvelle visite
        </button>

        </div>
      </div>
    </div>
  );
}
