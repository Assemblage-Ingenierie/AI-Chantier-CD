import React, { useState, useRef, useEffect } from 'react';
import { DA, SUIVI, URGENCE } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { callAIProxy } from '../../lib/aiProxy.js';

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const SNIPPET_KEY = '_aisnippets_v1';
const loadSnippetCache = () => { try { return JSON.parse(localStorage.getItem(SNIPPET_KEY) || '{}'); } catch { return {}; } };
const saveSnippetCache = (o) => { try { localStorage.setItem(SNIPPET_KEY, JSON.stringify(o)); } catch {}; };

export default function VisitesScreen({ projet, onBack, onSelectVisite, onUpdateProjet, syncStatus = 'ok', onRefresh = null, refreshing = false }) {
  const visites = projet.visites || [];
  const [editingId, setEditingId] = useState(null); // visite en mode édition
  const [snippets, setSnippets] = useState(() => loadSnippetCache());
  const snippetGenRef = useRef(false);

  // Auto-génère des résumés courts pour les items sans snippet en cache
  useEffect(() => {
    if (snippetGenRef.current) return;
    const cache = loadSnippetCache();
    const allItems = visites.flatMap(v => (v.localisations || []).flatMap(l => l.items || []));
    const missing = allItems.filter(it => it.id && !cache[it.id] && stripHtml(it.commentaire || it.titre || ''));
    if (missing.length === 0) return;
    snippetGenRef.current = true;
    (async () => {
      try {
        const lines = missing.slice(0, 30).map(it => {
          const txt = stripHtml(it.commentaire || '').slice(0, 200);
          return `id=${it.id} | "${(it.titre || txt || '').slice(0, 80)}"${txt ? ' — ' + txt.slice(0, 120) : ''}`;
        }).join('\n');
        const r = await callAIProxy({
          feature: 'visite_snippets',
          messages: [{ role: 'user', content: `Pour chaque observation, génère un résumé de 4 à 7 mots en français (constat ou action principale). Réponds UNIQUEMENT avec un JSON valide: {"id": "résumé court"}\n\n${lines}` }]
        });
        const raw = r.content?.[0]?.text || '';
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const newCache = { ...loadSnippetCache(), ...parsed };
          saveSnippetCache(newCache);
          setSnippets(s => ({ ...s, ...parsed }));
        }
      } catch {}
    })();
  }, [projet.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const duplicateVisite = (e, sourceId) => {
    e.stopPropagation();
    const source = visites.find(v => v.id === sourceId);
    if (!source) return;
    const newId = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const localisations = (source.localisations || []).map(loc => ({
      ...loc,
      id: crypto.randomUUID(),
      planAnnotations: loc.planAnnotations ? { ...loc.planAnnotations } : null,
      extraPlans: (loc.extraPlans || []).map(ep => ({ ...ep, planAnnotations: ep.planAnnotations ? { ...ep.planAnnotations } : null })),
      items: (loc.items || []).map(item => ({
        ...item,
        id: crypto.randomUUID(),
        // Nouveaux _id stables pour chaque photo → évite doublon d'ID dans le batch upsert Supabase
      photos: (item.photos || []).map(ph => ({ ...ph, _id: crypto.randomUUID(), id: undefined })),
      })),
    }));
    const newVisite = {
      ...source,
      id: newId,
      label: `${source.label || `Visite ${visites.indexOf(source) + 1}`} (copie)`,
      dateVisite: today,
      rapportPageBreaks: [],
      localisations,
    };
    onUpdateProjet({ visites: [...visites, newVisite] });
    onSelectVisite(newId);
  };

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
      ingenieur: '',
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
            <span style={{ fontSize:12, fontWeight:600 }}>Retour</span>
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontWeight:800, fontSize:15, color:'white', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 }} spellCheck={false}>{projet.nom}</p>
            {projet.adresse && <p style={{ fontSize:11, color:'rgba(255,255,255,0.4)', margin:'2px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.adresse}</p>}
          </div>
          {onRefresh && (
            <button onClick={onRefresh} disabled={refreshing}
              style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:6, color:'rgba(255,255,255,0.65)', padding:'5px 8px', cursor:refreshing?'default':'pointer', display:'flex', alignItems:'center', gap:3, flexShrink:0 }}>
              {refreshing ? <Ic n="spn" s={11}/> : <Ic n="rld" s={11}/>}
              <span style={{ fontSize:10, fontWeight:600 }}>Actu.</span>
            </button>
          )}
          {(() => {
            const dotColor = syncStatus === 'ok' ? '#4ADE80' : syncStatus === 'saving' ? '#FCD34D' : '#F87171';
            const dotLabel = syncStatus === 'saving' ? 'Sauvegarde…' : syncStatus === 'error' ? 'Erreur' : 'Sauvegardé';
            return (
              <div style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 9px', borderRadius:8, flexShrink:0,
                background: syncStatus==='error' ? 'rgba(239,68,68,0.15)' : syncStatus==='saving' ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.07)',
                border: `1px solid ${syncStatus==='error'?'rgba(239,68,68,0.4)':syncStatus==='saving'?'rgba(251,191,36,0.4)':'rgba(255,255,255,0.12)'}` }}>
                {syncStatus === 'saving' ? <Ic n="spn" s={10}/> : <div style={{ width:6, height:6, borderRadius:'50%', background:dotColor, flexShrink:0 }}/>}
                <span style={{ fontSize:10, fontWeight:700, color: syncStatus==='error'?'#F87171':syncStatus==='saving'?'#FCD34D':'rgba(255,255,255,0.75)', whiteSpace:'nowrap' }}>{dotLabel}</span>
              </div>
            );
          })()}
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
            const rawItems   = (v.localisations || []).flatMap(l => l.items || []);
            const obsCount   = rawItems.length;
            const urgCount   = rawItems.filter(it => it.urgence === 'haute').length;
            const zonesCount = (v.localisations || []).length;
            // Bullets : items pertinents triés par priorité (urgents, en cours, à faire, prochain)
            // Ignore les "fait" et les items sans info utile
            const SUIVI_RANK = { en_cours:0, a_faire:1, prochaine:2, rien:3, fait:99 };
            const bulletItems = rawItems
              .filter(it => it.suivi !== 'fait' && (it.urgence === 'haute' || it.urgence === 'moyenne' || ['en_cours','a_faire','prochaine'].includes(it.suivi)))
              .sort((a, b) => {
                const ua = a.urgence === 'haute' ? -1 : a.urgence === 'moyenne' ? 0 : 1;
                const ub = b.urgence === 'haute' ? -1 : b.urgence === 'moyenne' ? 0 : 1;
                if (ua !== ub) return ua - ub;
                return (SUIVI_RANK[a.suivi] ?? 3) - (SUIVI_RANK[b.suivi] ?? 3);
              })
              .slice(0, 4);
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
                    style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center', gap:10, padding:'16px 16px', cursor:'pointer', minWidth:0 }}>

                    {/* Titre */}
                    <p style={{ fontWeight:800, fontSize:16, color:DA.black, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:-0.3 }}>{v.label || `Visite ${visiteNum}`}</p>

                    {/* Meta : date + ingénieur sur une ligne */}
                    <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontSize:13 }}>📅</span>
                        <span style={{ fontSize:13, color:v.dateVisite ? DA.black : DA.grayL, fontWeight:v.dateVisite ? 600 : 400, fontStyle:v.dateVisite ? 'normal' : 'italic' }}>
                          {formatDate(v.dateVisite)}
                        </span>
                      </div>
                      {v.ingenieur && (
                        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                          <span style={{ color:DA.border, fontSize:13 }}>·</span>
                          <Ic n="usr" s={12} style={{ color:DA.grayL }}/>
                          <span style={{ fontSize:12, color:DA.grayL, fontWeight:600 }}>Ingénieur :</span>
                          <span style={{ fontSize:13, color:DA.black, fontWeight:700, letterSpacing:0.5 }}>{v.ingenieur}</span>
                        </div>
                      )}
                    </div>

                    {/* Tags */}
                    {(zonesCount > 0 || obsCount > 0 || urgCount > 0) && (
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
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

                    {/* Aperçu bullet points : items prioritaires de la visite */}
                    {bulletItems.length > 0 && (
                      <div style={{ paddingTop:10, borderTop:`1px solid ${DA.border}`, display:'flex', flexDirection:'column', gap:5 }}>
                        {bulletItems.map((it, k) => {
                          const snippet = snippets[it.id] || it.titre || '';
                          if (!snippet) return null;
                          const isUrgent   = it.urgence === 'haute';
                          const isMoyen    = it.urgence === 'moyenne';
                          const isEnCours  = it.suivi === 'en_cours';
                          const isProchain = it.suivi === 'prochaine';
                          const badge = isUrgent   ? URGENCE.haute
                                      : isMoyen    ? URGENCE.moyenne
                                      : isEnCours  ? SUIVI.en_cours
                                      : isProchain ? { ...SUIVI.prochaine, label: 'Prochain' }
                                      :              SUIVI.a_faire;
                          return (
                            <div key={k} style={{ display:'flex', alignItems:'flex-start', gap:6 }}>
                              <span style={{ fontSize:10, fontWeight:800, color:badge.text, background:badge.bg, borderRadius:4, padding:'2px 6px', flexShrink:0, whiteSpace:'nowrap', marginTop:1 }}>
                                {badge.label}
                              </span>
                              <span style={{ fontSize:12, color:'#333', flex:1, lineHeight:1.4 }}>
                                {snippet}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Mode édition */
                  <div style={{ flex:1, padding:'16px 14px', minWidth:0 }} onClick={e => e.stopPropagation()}>
                    {/* Nom de la visite */}
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                      <Ic n="pen" s={11} style={{ color:DA.red }}/>
                      <span style={{ fontSize:10, fontWeight:800, color:DA.red, textTransform:'uppercase', letterSpacing:1 }}>Nom de la visite</span>
                    </div>
                    <input
                      autoFocus
                      value={v.label || ''}
                      onChange={e => patchVisite(v.id, { label: e.target.value })}
                      placeholder="Ex: Diagnostic structure"
                      style={{ width:'100%', fontSize:15, fontWeight:700, color:DA.black, border:`1.5px solid ${DA.red}`, borderRadius:8, padding:'9px 11px', outline:'none', background:'white', boxSizing:'border-box', marginBottom:10 }}
                    />
                    {/* Date + Ingénieur côte à côte */}
                    <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4 }}>
                          <span style={{ fontSize:12 }}>📅</span>
                          <span style={{ fontSize:10, fontWeight:700, color:DA.gray, textTransform:'uppercase', letterSpacing:0.8 }}>Date</span>
                        </div>
                        <input
                          type="date"
                          value={v.dateVisite || ''}
                          onChange={e => patchVisite(v.id, { dateVisite: e.target.value || null })}
                          style={{ fontSize:14, color:DA.black, border:`1.5px solid ${DA.border}`, borderRadius:8, padding:'9px 10px', outline:'none', background:'white', cursor:'pointer', width:'100%', boxSizing:'border-box' }}
                        />
                      </div>
                      <div style={{ width:90, flexShrink:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4 }}>
                          <Ic n="usr" s={10} style={{ color:DA.grayL }}/>
                          <span style={{ fontSize:10, fontWeight:700, color:DA.gray, textTransform:'uppercase', letterSpacing:0.8 }}>Ingénieur</span>
                        </div>
                        <input
                          value={v.ingenieur || ''}
                          onChange={e => patchVisite(v.id, { ingenieur: e.target.value.toUpperCase().slice(0, 5) })}
                          placeholder="TM"
                          maxLength={5}
                          style={{ fontSize:16, fontWeight:800, color:DA.black, border:`1.5px solid ${DA.border}`, borderRadius:8, padding:'9px 10px', outline:'none', background:'white', width:'100%', boxSizing:'border-box', textTransform:'uppercase', letterSpacing:3, textAlign:'center' }}
                        />
                      </div>
                    </div>
                    <button onClick={() => setEditingId(null)}
                      style={{ width:'100%', padding:'10px 0', background:DA.red, color:'white', border:'none', borderRadius:9, fontSize:14, fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, boxShadow:'0 2px 8px rgba(227,5,19,0.3)' }}>
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
                  <button onClick={e => duplicateVisite(e, v.id)}
                    title="Dupliquer cette visite"
                    style={{ width:34, height:34, padding:0, background:DA.grayXL, border:`1px solid ${DA.border}`, color:DA.grayL, cursor:'pointer', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.color = '#1D4ED8'; e.currentTarget.style.borderColor = '#93C5FD'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = DA.grayXL; e.currentTarget.style.color = DA.grayL; e.currentTarget.style.borderColor = DA.border; }}>
                    <Ic n="cpy" s={15}/>
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
