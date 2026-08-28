import React, { useState, useRef, useEffect } from 'react';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { Ic, Badge, BadgeSuivi } from '../ui/Icons.jsx';
import { renderMarkup } from '../../lib/markup.jsx';
import { drawAnnotationPaths } from './Annotator.jsx';

const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 900;

// Charge de drag d'une photo PARTAGÉE entre instances de SortList (une par zone). Le
// dataTransfer 'text/photo' ne se relit pas toujours au drop d'une AUTRE zone (getData renvoie
// '' selon le navigateur), et le ref local est nul dans l'instance cible → le dépôt était ignoré
// (« ça ne me la met pas », Thomas). Ce payload module-level survit à la traversée des zones.
let _photoDragPayload = null;

// Vignette photo de l'éditeur. Affiche le composite cuit (ph.annotated) s'il existe. Sinon,
// si la photo porte des annotations (paths) mais que le composite manque (upload jamais abouti),
// on superpose un CANVAS qui dessine UNIQUEMENT les annotations (pas l'image) par-dessus la photo
// — exactement comme l'aperçu rapport. Crucial : on ne lit jamais les pixels de l'image (pas de
// toDataURL), donc le canvas n'est jamais « tainted » par l'URL signée cross-origin de Supabase
// (la 1re version cuisait image + paths → toDataURL levait une SecurityError → repli sur la photo
// nue → « je n'ai plus rien »). Même échelle que le rapport/plans : annotSizeScale figé sinon
// largeur naturelle / 1400. L'alignement est exact tant que la vignette n'est pas rognée
// (width:auto → ratio naturel conservé), ce qui est le cas courant.
function AnnotatedThumb({ photo, imgStyle, onOpen, startLP, endLP, lpRef }) {
  const cvRef = useRef(null);
  const [dims, setDims] = useState(null);
  const hasAnnot = !photo.annotated && photo.annotations?.length > 0 && !!photo.data;

  // Dimensions naturelles (repère des paths) — lecture de naturalWidth/Height seulement, jamais
  // les pixels → autorisé en cross-origin, aucun risque de canvas tainted.
  useEffect(() => {
    if (!hasAnnot) { setDims(null); return; }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => { if (!cancelled && img.naturalWidth) setDims({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = photo.data;
    return () => { cancelled = true; };
  }, [hasAnnot, photo.data]);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv || !dims) return;
    cv.width = dims.w; cv.height = dims.h;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, dims.w, dims.h);
    const scale = photo.annotSizeScale != null ? photo.annotSizeScale : dims.w / 1400;
    drawAnnotationPaths(ctx, photo.annotations, scale);
  }, [dims, photo.annotations, photo.annotSizeScale]);

  const src = photo.annotated || photo.data;
  // Tuile « pleine largeur » (grille mobile 2 colonnes) quand imgStyle demande width:100% :
  // le span doit alors être block et occuper 100% de la cellule (sinon inline-block se rétrécit
  // au contenu et la photo ne remplit pas sa colonne). Desktop (width:auto) → inchangé.
  const fill = imgStyle?.width === '100%';
  return (
    <span style={{ position:'relative', display: fill ? 'block' : 'inline-block', width: fill ? '100%' : undefined, flexShrink:0, lineHeight:0 }}>
      <img src={src} alt="" draggable={false}
        onPointerDown={e => { e.stopPropagation(); startLP(src); }}
        onPointerUp={endLP} onPointerLeave={endLP} onPointerCancel={endLP}
        onClick={e => { e.stopPropagation(); if (lpRef.current.fired) { lpRef.current.fired = false; return; } onOpen(); }}
        style={imgStyle}/>
      {hasAnnot && dims && (
        <canvas ref={cvRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none', borderRadius: imgStyle?.borderRadius }}/>
      )}
    </span>
  );
}

export default function SortList({ items, locId = null, onReorder, onEdit, onDelete, onAnnotatePhoto, onDeletePhoto, onReorderPhoto, onMovePhotoAcross, onOpenItemPlan }) {
  const [confirmDelId, setConfirmDelId] = useState(null);
  const [confirmDelPhoto, setConfirmDelPhoto] = useState(null); // { item, photoIdx }
  const [lightbox, setLightbox]         = useState(null);
  const [photoZoom, setPhotoZoom]       = useState(null); // src de l'aperçu plein écran (appui long)
  const photoDragRef = useRef(null);                      // { itemId, from } réordonnancement photos
  const photoLP      = useRef({ timer: null, fired: false }); // appui long sur une photo
  // Un glisser de photo est-il en cours ? (n'importe où dans la visite) → révèle une zone de
  // dépôt sur les observations SANS photo, pour pouvoir y déposer une photo (demande Thomas :
  // « déposer dans un cadre vide ne marchait pas »). Signalé par événement window car il y a
  // une instance de SortList PAR zone → le drag traverse les instances.
  const [photoDragging, setPhotoDragging] = useState(false);
  const [overEmptyId, setOverEmptyId] = useState(null); // cadre vide survolé pendant le glisser
  useEffect(() => {
    const on = () => setPhotoDragging(true);
    const off = () => setPhotoDragging(false);
    window.addEventListener('ai-photo-drag-start', on);
    window.addEventListener('ai-photo-drag-end', off);
    return () => { window.removeEventListener('ai-photo-drag-start', on); window.removeEventListener('ai-photo-drag-end', off); };
  }, []);

  // Réordonne les photos d'un item (déplace from → to) puis remonte au parent.
  const reorderPhotos = (item, from, to) => {
    const photos = [...(item.photos || [])];
    if (from < 0 || to < 0 || from >= photos.length || to >= photos.length || from === to) return;
    const [m] = photos.splice(from, 1);
    photos.splice(to, 0, m);
    onReorderPhoto?.(item, photos);
  };

  const startPhotoLP = (src) => {
    clearTimeout(photoLP.current.timer);
    photoLP.current.fired = false;
    photoLP.current.timer = setTimeout(() => { photoLP.current.fired = true; setPhotoZoom(src); }, 280);
  };
  const endPhotoLP = () => { clearTimeout(photoLP.current.timer); setPhotoZoom(null); };
  useEffect(() => () => clearTimeout(photoLP.current.timer), []);

  // ── Drag state ─────────────────────────────────────────────────────────────
  const [dragIdx, setDragIdx]   = useState(null);
  const [overIdx, setOverIdx]   = useState(null);
  const dragDidMoveRef          = useRef(false); // évite onClick après drag
  const listRef                 = useRef();

  // ── HTML5 drag (desktop) ───────────────────────────────────────────────────
  const onDragStart = (i) => { setDragIdx(i); dragDidMoveRef.current = false; };
  const onDragEnter = (i) => { setOverIdx(i); dragDidMoveRef.current = true; };
  const onDragEnd   = ()  => {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const n = [...items];
      const [m] = n.splice(dragIdx, 1);
      n.splice(overIdx, 0, m);
      onReorder(n);
    }
    setDragIdx(null); setOverIdx(null);
  };

  // ── Touch drag (mobile) ────────────────────────────────────────────────────
  const touchDragRef    = useRef(null); // { idx, startY, curOverIdx }
  const ghostRef        = useRef(null);
  const wrapperRef      = useRef(null);

  useEffect(() => () => { ghostRef.current?.remove(); }, []);

  // Attache touchmove avec { passive: false } pour pouvoir appeler preventDefault sans warning
  useEffect(() => {
    onGripTouchMoveRef.current = onGripTouchMove;
    onGripTouchEndRef.current  = onGripTouchEnd;
  });
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const move   = (e) => onGripTouchMoveRef.current(e);
    const end    = (e) => onGripTouchEndRef.current(e);
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
    // touchAction:'none' on the grip already prevents scroll — no preventDefault needed here
    const touch = e.touches[0];
    dragDidMoveRef.current = false;
    touchDragRef.current = { idx, startY: touch.clientY, curOverIdx: idx };
    setDragIdx(idx);

    // Créer un ghost visuel
    const row = listRef.current?.children[idx];
    if (row) {
      const clone = row.cloneNode(true);
      clone.style.cssText = `position:fixed;left:${row.getBoundingClientRect().left}px;top:${touch.clientY - row.offsetHeight/2}px;width:${row.offsetWidth}px;opacity:0.85;background:white;boxShadow:0 8px 24px rgba(0,0,0,0.25);borderRadius:8px;zIndex:9998;pointerEvents:none;border:2px solid ${DA.red};`;
      document.body.appendChild(clone);
      ghostRef.current = clone;
    }
  };

  const onGripTouchMoveRef = useRef(null);
  const onGripTouchEndRef  = useRef(null);

  const onGripTouchMove = (e) => {
    if (!touchDragRef.current) return;
    e.preventDefault(); // { passive: false } set via useEffect below
    const touch = e.touches[0];
    dragDidMoveRef.current = true;

    // Déplacer le ghost
    if (ghostRef.current) {
      const row = listRef.current?.children[touchDragRef.current.idx];
      if (row) ghostRef.current.style.top = `${touch.clientY - row.offsetHeight/2}px`;
    }

    // Trouver sur quel item on est
    if (!listRef.current) return;
    const listRect = listRef.current.getBoundingClientRect();
    const relY = touch.clientY - listRect.top;
    let cumH = 0;
    let newOver = items.length - 1;
    for (let j = 0; j < listRef.current.children.length; j++) {
      const h = listRef.current.children[j].offsetHeight;
      if (relY < cumH + h / 2) { newOver = j; break; }
      cumH += h;
    }
    touchDragRef.current.curOverIdx = newOver;
    setOverIdx(newOver);
  };

  const onGripTouchEnd = () => {
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
    if (!touchDragRef.current) return;
    const { idx, curOverIdx } = touchDragRef.current;
    touchDragRef.current = null;
    if (dragDidMoveRef.current && idx !== curOverIdx) {
      const n = [...items];
      const [m] = n.splice(idx, 1);
      n.splice(curOverIdx, 0, m);
      onReorder(n);
    }
    setDragIdx(null); setOverIdx(null);
  };

  return (
    <>
    {/* Aperçu plein écran pendant l'appui long sur une photo — se ferme au relâchement */}
    {photoZoom && (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.95)', zIndex:10000, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
        <img src={photoZoom} alt="" style={{ maxWidth:'96vw', maxHeight:'94vh', objectFit:'contain', borderRadius:6, boxShadow:'0 8px 50px rgba(0,0,0,0.7)' }}/>
      </div>
    )}
    {lightbox && (
      <div onClick={() => setLightbox(null)}
        style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.96)',zIndex:9999,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12 }}>
        <img src={lightbox.photos[lightbox.idx].annotated || lightbox.photos[lightbox.idx].data} alt=""
          style={{ maxWidth:'100%',maxHeight:'72vh',objectFit:'contain',borderRadius:6 }}/>
        {lightbox.photos.length > 1 && (
          <div style={{ display:'flex',gap:6,flexWrap:'wrap',justifyContent:'center',padding:'0 16px' }}
            onClick={e => e.stopPropagation()}>
            {lightbox.photos.map((ph, pi) => (
              <img key={pi} src={ph.annotated || ph.data} alt=""
                onClick={() => setLightbox(v => ({ ...v, idx: pi }))}
                style={{ width:44,height:44,objectFit:'cover',borderRadius:5,cursor:'pointer',border:`2px solid ${lightbox.idx===pi?'white':'transparent'}`,opacity:lightbox.idx===pi?1:0.5,transition:'all 0.1s' }}/>
            ))}
          </div>
        )}
        <div style={{ display:'flex',alignItems:'center',gap:12 }} onClick={e => e.stopPropagation()}>
          {onAnnotatePhoto && lightbox.item && (
            <button
              onClick={() => {
                const ph = lightbox.photos[lightbox.idx];
                const realIdx = (lightbox.item.photos || []).indexOf(ph);
                setLightbox(null);
                onAnnotatePhoto(lightbox.item, realIdx >= 0 ? realIdx : lightbox.idx);
              }}
              style={{ background:DA.red,color:'white',border:'none',borderRadius:8,padding:'9px 16px',fontSize:13,fontWeight:700,display:'flex',alignItems:'center',gap:6,cursor:'pointer' }}>
              <Ic n="pen" s={14}/> Annoter cette photo
            </button>
          )}
          <p style={{ color:'rgba(255,255,255,0.35)',fontSize:11,margin:0 }}>Toucher ailleurs pour fermer</p>
        </div>
      </div>
    )}

    <div ref={wrapperRef}>
      {items.length === 0 && (
        <div style={{ padding:'24px 16px',textAlign:'center',borderBottom:`1px solid ${DA.border}` }}>
          <p style={{ fontSize:14,color:DA.grayL,margin:'0 0 14px' }}>Aucune observation dans cette zone</p>
          <button onClick={() => onEdit(null)} style={{ display:'inline-flex',alignItems:'center',gap:6,padding:'12px 22px',background:DA.red,color:'white',borderRadius:20,border:'none',fontSize:15,fontWeight:700,cursor:'pointer' }}>
            <Ic n="plus" s={15}/> Ajouter la 1ère observation
          </button>
        </div>
      )}

      <div ref={listRef}>
        {items.map((item, i) => {
          const isDragging = dragIdx === i;
          const isOver     = overIdx === i && dragIdx !== i;
          const ICON_BTN   = 38; // taille commune aux icônes d'action — ALIGNÉE sur l'en-tête de zone (38px)
          return (
            <div key={item.id}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragEnter={() => onDragEnter(i)}
              onDragEnd={onDragEnd}
              onDragOver={e => e.preventDefault()}
              onClick={() => { if (dragDidMoveRef.current) { dragDidMoveRef.current = false; return; } onEdit(item); }}
              style={{
                display:'flex', alignItems:'flex-start', gap: isDesktop ? 12 : 8,
                padding: isDesktop ? '18px 18px 18px 8px' : '14px 18px 14px 6px',
                borderBottom:`1px solid ${DA.border}`,
                borderLeft:`4px solid ${URGENCE[item.urgence]?.dot || DA.border}`,
                cursor:'pointer',
                background: isDragging ? '#f0f0f0' : isOver ? DA.redL : 'white',
                borderTop: isOver ? `2px solid ${DA.red}` : 'none',
                opacity: isDragging ? 0.45 : 1,
                transition: 'background 0.08s, opacity 0.08s',
              }}>

              {/* ── Poignée drag ── */}
              <div
                onTouchStart={e => onGripTouchStart(e, i)}
                onClick={e => e.stopPropagation()}
                style={{
                  flexShrink:0, alignSelf:'center',
                  padding:'6px 4px', cursor:'grab', touchAction:'none',
                  color:'#bbb', display:'flex', alignItems:'center',
                }}>
                <Ic n="grp" s={isDesktop ? 18 : 16}/>
              </div>

              {/* ── Content ── */}
              <div style={{ flex:1, minWidth:0 }}>
                {/* En-tête : titre + badges à gauche, icônes d'action (plan / suppr.) à droite,
                    SUR la même ligne que le titre. Ainsi le commentaire et les photos prennent
                    TOUTE la largeur du contenu en dessous (avant, la colonne d'icônes à droite
                    rognait ~90px sur texte ET photos → écran mal optimisé, retour Thomas). */}
                <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize: isDesktop ? 16 : 15, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', margin:0 }}>{item.titre}</p>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginTop: isDesktop ? 5 : 4, flexWrap:'wrap' }}>
                      <Badge level={item.urgence}/>
                      <span style={{ display:'flex', alignItems:'center', gap:3 }}>
                        <BadgeSuivi suivi={item.suivi||'rien'} small onClick={e => {
                          e.stopPropagation();
                          const keys = Object.keys(SUIVI);
                          const next = keys[(keys.indexOf(item.suivi||'rien')+1)%keys.length];
                          onEdit({ ...item, suivi: next, _quickSuivi: true });
                        }}/>
                        <span style={{ fontSize:9, color:DA.grayL, fontStyle:'italic' }}>↺</span>
                      </span>
                    </div>
                  </div>

                  {/* Actions : plan de l'observation + suppression (le bouton plan ouvre l'éditeur
                      où l'on assigne/annote le(s) plan(s) PROPRES à cette observation). */}
                  <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }} onClick={e => e.stopPropagation()}>
                    <button onClick={e => { e.stopPropagation(); (onOpenItemPlan || onEdit)(item); }}
                      title={(item.plans || []).length ? `Plan de l'observation (${item.plans.length})` : "Ajouter un plan à cette observation"}
                      aria-label="Plan de l'observation"
                      style={{ position:'relative', width: ICON_BTN, height: ICON_BTN, padding:0, cursor:'pointer',
                        color:(item.plans || []).length ? DA.red : DA.grayL,
                        background:(item.plans || []).length ? DA.redL : 'white',
                        border:`1px solid ${(item.plans || []).length ? DA.red : DA.border}`,
                        borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <Ic n="map" s={16}/>
                      {(item.plans || []).length > 0 && (
                        <span style={{ position:'absolute', top:-6, right:-6, background:DA.red, color:'white', borderRadius:9, minWidth:16, height:16, padding:'0 4px', fontSize:9, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>{item.plans.length}</span>
                      )}
                    </button>
                    {confirmDelId === item.id
                      ? <div style={{ display:'flex',alignItems:'center',gap:6 }} onClick={e => e.stopPropagation()}>
                          <button onClick={e => { e.stopPropagation(); onDelete(item.id); setConfirmDelId(null); }} style={{ padding:'8px 12px',background:'#B91C1C',color:'white',border:'none',borderRadius:8,fontSize:13,fontWeight:700,cursor:'pointer' }}>Oui</button>
                          <button onClick={e => { e.stopPropagation(); setConfirmDelId(null); }} style={{ padding:'8px 12px',background:'white',color:'#555',border:'1px solid #E5E5E5',borderRadius:8,fontSize:13,cursor:'pointer' }}>Non</button>
                        </div>
                      : <button onClick={e => { e.stopPropagation(); setConfirmDelId(item.id); }} style={{ color:DA.red, width: ICON_BTN, height: ICON_BTN, padding:0, cursor:'pointer', background:'#FFF0F0', border:'1px solid #FECACA', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <Ic n="del" s={15}/>
                        </button>
                    }
                  </div>
                </div>
                {item.commentaire && (
                  <p style={{ fontSize: isDesktop ? 14 : 13, color:DA.gray, margin: isDesktop ? '8px 0 0' : '6px 0 0', lineHeight:1.55 }}>{renderMarkup(item.commentaire)}</p>
                )}

                {/* Photos — toujours en dessous du texte (mobile + desktop) */}
                {(() => {
                  const validPhotos = (item.photos || []).filter(ph => ph.data);
                  if (validPhotos.length) {
                    const shown = validPhotos;
                    const extra = 0;
                    return (
                      // Grille responsive : tuiles UNIFORMES qui remplissent toute la ligne, quelle
                      // que soit l'orientation → plus de « blanc » à droite avec les photos paysage
                      // (retour Bach). Mobile = 2 colonnes ; desktop = autant de colonnes de ≥150px
                      // que la largeur permet (≥2), sans trou.
                      <div style={{ display:'grid', gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(150px, 1fr))' : 'repeat(2, minmax(0, 1fr))', gap: isDesktop ? 10 : 6, marginTop: isDesktop ? 14 : 10 }}
                        // Déposer dans le vide de la zone photos d'une observation → y déplacer la
                        // photo glissée (depuis une autre observation/zone). Les photos elles-mêmes
                        // gèrent leur propre drop (réordonner / déposer dessus) via stopPropagation.
                        onDragOver={onMovePhotoAcross ? (e => { if (e.dataTransfer.types.includes('text/photo')) e.preventDefault(); }) : undefined}
                        onDrop={onMovePhotoAcross ? (e => {
                          let d = null; try { d = JSON.parse(e.dataTransfer.getData('text/photo')); } catch {}
                          if (!d) d = _photoDragPayload; // fallback cross-zone
                          if (!d || d.fromItemId === item.id) return;
                          e.preventDefault();
                          onMovePhotoAcross(d.fromLocId, d.fromItemId, d.fromPhotoIdx, locId, item.id);
                        }) : undefined}>
                        {shown.map((ph, pi) => {
                          // trouver l'index réel dans item.photos (pas dans validPhotos)
                          const realIdx = (item.photos || []).indexOf(ph);
                          const openPhoto = () => { if (onAnnotatePhoto) { onAnnotatePhoto(item, realIdx >= 0 ? realIdx : pi); } else { setLightbox({ photos: validPhotos, idx: pi, item }); } };
                          // Glissable dès qu'on peut réordonner OU déplacer entre observations →
                          // la poignée apparaît MÊME sur une photo seule (pour la sortir ailleurs).
                          const canDrag = !!(onReorderPhoto || onMovePhotoAcross);
                          return (
                          <div key={pi}
                            draggable={canDrag}
                            onDragStart={canDrag ? (e => {
                              e.stopPropagation(); clearTimeout(photoLP.current.timer);
                              const payload = { fromLocId: locId, fromItemId: item.id, fromPhotoIdx: realIdx };
                              photoDragRef.current = payload;
                              _photoDragPayload = payload; // partagé entre zones (fallback robuste au drop)
                              // dataTransfer = canal qui survit au passage d'une zone (SortList) à l'autre.
                              try { e.dataTransfer.setData('text/photo', JSON.stringify(payload)); e.dataTransfer.effectAllowed = 'move'; } catch {}
                              window.dispatchEvent(new Event('ai-photo-drag-start')); // révèle les cadres vides
                            }) : undefined}
                            onDragOver={canDrag ? (e => { if (e.dataTransfer.types.includes('text/photo')) { e.preventDefault(); e.stopPropagation(); } }) : undefined}
                            onDrop={canDrag ? (e => {
                              e.preventDefault(); e.stopPropagation();
                              let d = null;
                              try { d = JSON.parse(e.dataTransfer.getData('text/photo')); } catch {}
                              if (!d) d = photoDragRef.current || _photoDragPayload;
                              if (!d) return;
                              if (d.fromItemId === item.id) reorderPhotos(item, d.fromPhotoIdx, realIdx);
                              else onMovePhotoAcross?.(d.fromLocId, d.fromItemId, d.fromPhotoIdx, locId, item.id);
                              photoDragRef.current = null;
                            }) : undefined}
                            onDragEnd={canDrag ? (() => { photoDragRef.current = null; _photoDragPayload = null; window.dispatchEvent(new Event('ai-photo-drag-end')); }) : undefined}
                            style={{ position:'relative', flexShrink:0 }}>
                            <AnnotatedThumb
                              photo={ph}
                              onOpen={openPhoto}
                              startLP={startPhotoLP}
                              endLP={endPhotoLP}
                              lpRef={photoLP}
                              imgStyle={{ width:'100%', aspectRatio:'4 / 3', objectFit:'cover', borderRadius: isDesktop ? 10 : 6, border:`1px solid ${DA.border}`, cursor:'pointer', display:'block', userSelect:'none' }}/>
                            {onDeletePhoto && (
                              confirmDelPhoto?.item === item && confirmDelPhoto?.photoIdx === realIdx ? (
                                <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.45)', borderRadius: isDesktop ? 10 : 6 }}
                                  onClick={e => e.stopPropagation()}/>
                              ) : (
                                <button
                                  onClick={e => { e.stopPropagation(); setConfirmDelPhoto({ item, photoIdx: realIdx }); }}
                                  title="Supprimer" aria-label="Supprimer la photo"
                                  style={{ position:'absolute', top:4, left:4, background:'rgba(0,0,0,0.6)', color:'white', border:'none', borderRadius:'50%', width: isDesktop ? 28 : 30, height: isDesktop ? 28 : 30, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
                                  <Ic n="x" s={isDesktop ? 12 : 13}/>
                                </button>
                              )
                            )}
                            {canDrag && (
                              <div title="Glisser pour réordonner ou déplacer vers une autre observation"
                                style={{ position:'absolute', bottom:4, right:4, background:'rgba(0,0,0,0.55)', color:'white', borderRadius:6, width: isDesktop ? 26 : 22, height: isDesktop ? 26 : 22, display:'flex', alignItems:'center', justifyContent:'center', cursor:'grab', flexShrink:0, pointerEvents:'none' }}>
                                <Ic n="srt" s={isDesktop ? 13 : 11}/>
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    );
                  }
                  if (!item._photosHydrated && (item.photos||[]).length > 0) return (
                    <div style={{ display:'flex', gap: isDesktop ? 10 : 6, marginTop: isDesktop ? 14 : 10 }}>
                      {(item.photos||[]).slice(0,4).map((_,pi) => (
                        <div key={pi} style={{ height: isDesktop ? 160 : 90, width: isDesktop ? 200 : 120, borderRadius: isDesktop ? 10 : 6, background:'linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%)', backgroundSize:'200% 100%', animation:'shimmer 1.2s infinite', flexShrink:0 }}/>
                      ))}
                    </div>
                  );
                  // Observation SANS photo : cadre de dépôt révélé PENDANT un glisser de photo
                  // → on peut y déposer une photo venue d'une autre observation (demande Thomas).
                  if (onMovePhotoAcross && photoDragging) {
                    const over = overEmptyId === item.id;
                    return (
                      <div
                        onDragOver={e => { if (e.dataTransfer.types.includes('text/photo')) { e.preventDefault(); setOverEmptyId(item.id); } }}
                        onDragLeave={() => setOverEmptyId(prev => prev === item.id ? null : prev)}
                        onDrop={e => {
                          e.preventDefault(); e.stopPropagation();
                          let d = null; try { d = JSON.parse(e.dataTransfer.getData('text/photo')); } catch {}
                          if (!d) d = photoDragRef.current || _photoDragPayload;
                          setOverEmptyId(null);
                          _photoDragPayload = null;
                          window.dispatchEvent(new Event('ai-photo-drag-end'));
                          if (!d || d.fromItemId === item.id) return;
                          onMovePhotoAcross(d.fromLocId, d.fromItemId, d.fromPhotoIdx, locId, item.id);
                        }}
                        style={{ marginTop: isDesktop ? 14 : 10, border:`2px dashed ${over ? DA.red : '#C9CDD2'}`,
                          background: over ? DA.redL : '#FAFBFC', borderRadius: isDesktop ? 10 : 8,
                          padding: isDesktop ? '18px 12px' : '14px 10px', display:'flex', alignItems:'center', justifyContent:'center',
                          gap:8, color: over ? DA.red : DA.grayL, fontSize:12.5, fontWeight:700, transition:'all 0.1s' }}>
                        <Ic n="img" s={16}/> Déposer la photo ici
                      </div>
                    );
                  }
                  return null;
                })()}

              </div>
            </div>
          );
        })}
      </div>

      {items.length > 0 && (
        <div style={{ display:'flex',borderTop:`1px solid ${DA.border}` }}>
          <button onClick={() => onEdit(null)} style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:16,fontSize:15,fontWeight:700,color:DA.red,background:DA.white,border:'none',cursor:'pointer' }}>
            <Ic n="plus" s={16}/> Ajouter
          </button>
        </div>
      )}
    </div>

    {/* Action sheet suppression photo */}
    {confirmDelPhoto && (
      <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}
        onClick={() => setConfirmDelPhoto(null)}>
        <div style={{ background:'white', borderRadius:'20px 20px 0 0', padding:'20px 16px 36px', boxShadow:'0 -8px 32px rgba(0,0,0,0.18)' }}
          onClick={e => e.stopPropagation()}>
          <div style={{ width:36, height:4, background:'#DDD', borderRadius:2, margin:'0 auto 18px' }}/>
          <p style={{ textAlign:'center', fontSize:13, color:'#555', margin:'0 0 16px', fontWeight:600 }}>Supprimer cette photo ?</p>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <button onClick={e => { e.stopPropagation(); onDeletePhoto(confirmDelPhoto.item, confirmDelPhoto.photoIdx); setConfirmDelPhoto(null); }}
              style={{ width:'100%', padding:'15px', background:'#B91C1C', color:'white', border:'none', borderRadius:12, fontSize:16, fontWeight:800, cursor:'pointer' }}>
              Supprimer
            </button>
            <button onClick={() => setConfirmDelPhoto(null)}
              style={{ width:'100%', padding:'15px', background:'#F5F5F5', color:'#333', border:'none', borderRadius:12, fontSize:16, fontWeight:600, cursor:'pointer' }}>
              Annuler
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
