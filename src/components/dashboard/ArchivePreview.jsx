import React, { useState, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { renderMarkup, stripMarkup } from '../../lib/markup.jsx';
import { loadProjectPhotos } from '../../lib/storage.js';
import { PlanBlock, ItemPlanBlock, ReportPhotoImg, PhotoAnnotCanvas } from '../vue/RapportPreview/blocks.jsx';

// CONSULTATION d'un projet ARCHIVÉ (demande Thomas 23/11) : clic sur la carte → aperçu en
// LECTURE SEULE des visites et observations, pour relire / copier-coller du texte et s'en
// inspirer, SANS réactiver le projet. Aucune écriture : ce composant ne reçoit aucun callback de
// modification et ne touche ni à l'état des projets, ni au cache, ni au serveur. Le texte des
// observations est toujours lu en base, même archivé (cf. storage.js, incident 2026-10-15).
// Photos (brutes ou annotées), plans de zone et plans d'observation annotés : rendus avec les
// MÊMES briques que l'aperçu du rapport (PlanBlock / ItemPlanBlock / PhotoAnnotCanvas), appelées
// SANS aucun callback d'édition. Les photos sont lues directement en base (loadProjectPhotos =
// lecture seule) et gardées dans l'état LOCAL de l'aperçu : l'état des projets n'est jamais
// touché (pas d'hydratation → rien ne peut partir à la sauvegarde). Clic sur une image = en grand.

function locItems(l) {
  return [...(l?.items || []), ...((l?.sections || []).flatMap(s => s.items || []))];
}

// Visites de la plus RÉCENTE à la plus ancienne (date de visite ; sans date → ordre de la liste,
// la dernière ajoutée d'abord). La première est celle affichée à l'ouverture.
function byRecent(visites) {
  const t = (x) => { const d = x?.dateVisite ? new Date(x.dateVisite).getTime() : NaN; return isNaN(d) ? -Infinity : d; };
  return visites.map((x, i) => ({ x, i })).sort((a, b) => (t(b.x) - t(a.x)) || (b.i - a.i)).map(o => o.x);
}

// Échelles d'annotation réglées dans l'onglet Rapport (mêmes clés localStorage, LECTURE seule).
function readScale(k) {
  try { const v = parseFloat(localStorage.getItem(k) ?? '1'); return isNaN(v) ? 1 : Math.max(0.3, Math.min(5, v)); } catch { return 1; }
}
const planScales  = () => ({ text: readScale('chantierai_scale_text'), shape: readScale('chantierai_scale_shape'), symbol: readScale('chantierai_scale_symbol') });
const photoScales = () => ({ text: readScale('chantierai_scale_photo_text'), shape: readScale('chantierai_scale_photo_shape'), symbol: readScale('chantierai_scale_photo_symbol') });

const hasZonePlan = (l) => !!(l.planId || l.planBg || (l.extraPlans || []).some(ep => ep.planId || ep.planBg));

// Vignette photo : composite annoté d'abord (comme le rapport), sinon photo brute + calque
// d'annotations redessiné si l'annotation n'a pas de composite.
function PhotoThumb({ ph, scales, onZoom }) {
  const overlay = !!(ph.annotations?.length && ph.data && !ph.annotated);
  const src = ph.annotated || ph.data;
  return (
    <button type="button" onClick={() => onZoom(overlay ? { ph } : { src })} title="Voir en grand"
      style={{ position:'relative',aspectRatio:'4 / 3',padding:0,border:`1px solid ${DA.border}`,borderRadius:6,overflow:'hidden',background:DA.grayXL,cursor:'zoom-in' }}>
      <ReportPhotoImg sources={[src, ph.annotated, ph.data]} overlaySrc={overlay ? src : null}
        overlay={overlay ? <PhotoAnnotCanvas photo={ph} containerAR={4 / 3} photoScale={scales}/> : null}
        style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',display:'block',pointerEvents:'none' }}/>
    </button>
  );
}

const fmtDate = (d) => {
  if (!d) return '';
  const t = new Date(d);
  return isNaN(t) ? String(d) : t.toLocaleDateString('fr-FR');
};

export default function ArchivePreview({ projet, onClose }) {
  const visites = projet?.visites || [];
  const ordered = byRecent(visites);
  const [vid, setVid] = useState(() => ordered[0]?.id ?? null);
  const [photosByItem, setPhotosByItem] = useState({}); // { itemId: photos[] } — état LOCAL
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [zoom, setZoom] = useState(null); // { src } ou { ph } (photo à calque redessiné)
  const [scales] = useState(() => ({ plan: planScales(), photo: photoScales() }));
  const v = visites.find(x => x.id === vid) || ordered[0] || null;
  const libById = new Map((projet?.planLibrary || []).map(pl => [pl.id, pl]));

  // Photos de la visite affichée, chargées à la demande (une seule fois par observation).
  const vKey = v?.id;
  useEffect(() => {
    if (!v) return;
    const ids = (v.localisations || []).flatMap(l => locItems(l).map(i => i.id)).filter(id => id && !(id in photosByItem));
    if (!ids.length) return;
    let cancelled = false;
    setLoadingPhotos(true);
    loadProjectPhotos(ids).then(map => {
      if (cancelled || !map) return; // hors ligne / erreur : rien de mémorisé → réessai à la réouverture
      setPhotosByItem(prev => { const next = { ...prev }; for (const id of ids) next[id] = map?.[id] || []; return next; });
    }).catch(() => {}).finally(() => { if (!cancelled) setLoadingPhotos(false); });
    return () => { cancelled = true; };
  }, [vKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { if (zoom) setZoom(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoom]);

  const locs = (v?.localisations || []).map(l => ({ l, items: locItems(l) })).filter(x => x.items.length > 0 || hasZonePlan(x.l));
  // Clic sur un plan (image rendue par SinglePlanImage, data-role="plan") → en grand.
  const onContentClick = (e) => { const t = e.target; if (t?.tagName === 'IMG' && t.dataset?.role === 'plan') setZoom({ src: t.src }); };
  const conclusion = v?.conclusion && stripMarkup(v.conclusion).trim() ? v.conclusion : null;

  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',padding:'env(safe-area-inset-top, 0px) 0 0' }}>
      <div onClick={e => e.stopPropagation()} style={{ background:DA.white,width:'100%',maxWidth:760,height:'100%',maxHeight:'min(100dvh, 920px)',display:'flex',flexDirection:'column',borderRadius:12,overflow:'hidden',boxShadow:'0 12px 40px rgba(0,0,0,0.25)' }}>
        {/* En-tête */}
        <div style={{ padding:'12px 14px',borderBottom:`1px solid ${DA.border}`,display:'flex',alignItems:'center',gap:10,flexShrink:0 }}>
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ display:'flex',alignItems:'center',gap:6,fontSize:11,color:DA.grayL,fontWeight:600 }}>
              <Ic n="arc" s={11}/> Archivé · lecture seule
            </div>
            <p style={{ margin:'2px 0 0',fontSize:16,fontWeight:800,color:DA.black,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{projet.nom}</p>
            {/* Choix de la visite (menu déroulant natif : iOS / Android / PC) — seulement s'il y en a plusieurs. */}
            {ordered.length > 1 && (
              <select value={v?.id ?? ''} onChange={e => setVid(e.target.value)} aria-label="Visite à consulter"
                style={{ marginTop:6,maxWidth:'100%',padding:'6px 28px 6px 10px',borderRadius:8,border:`1px solid ${DA.border}`,background:DA.white,color:DA.black,fontSize:13,fontWeight:600,cursor:'pointer' }}>
                {ordered.map(x => (
                  <option key={x.id} value={x.id}>{x.label || 'Visite'}{x.dateVisite ? ` · ${fmtDate(x.dateVisite)}` : ''}</option>
                ))}
              </select>
            )}
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ padding:8,borderRadius:8,border:'none',background:'none',color:DA.gray,cursor:'pointer',flexShrink:0 }}>
            <Ic n="x" s={20}/>
          </button>
        </div>

        {/* Contenu sélectionnable */}
        <div onClick={onContentClick} style={{ flex:1,overflowY:'auto',padding:'14px 16px calc(24px + env(safe-area-inset-bottom, 0px))',userSelect:'text',WebkitUserSelect:'text',background:DA.grayXL }}>
          {!v || (locs.length === 0 && !conclusion) ? (
            <p style={{ textAlign:'center',color:DA.grayL,fontSize:13,marginTop:40 }}>Aucune observation dans cette visite.</p>
          ) : (
            <>
              {locs.map(({ l, items }) => (
                <div key={l.id} style={{ marginBottom:18 }}>
                  <h3 style={{ margin:'0 0 8px',fontSize:12,fontWeight:800,color:DA.red,textTransform:'uppercase',letterSpacing:0.4 }}>{l.nom || 'Zone'}</h3>
                  {hasZonePlan(l) && (
                    <div style={{ background:DA.white,borderRadius:6,marginBottom:8,cursor:'zoom-in' }}>
                      <PlanBlock loc={l} annotScale={scales.plan} planLibrary={projet.planLibrary}/>
                    </div>
                  )}
                  {items.map(i => (
                    <div key={i.id} style={{ background:DA.white,border:`1px solid ${DA.border}`,borderRadius:10,padding:'10px 12px',marginBottom:8 }}>
                      {(i.titre || '').trim() && <p style={{ margin:0,fontSize:14,fontWeight:700,color:DA.black }}>{i.titre}</p>}
                      {(i.commentaire || '').trim() && (
                        <div style={{ marginTop:(i.titre || '').trim() ? 4 : 0,fontSize:13.5,lineHeight:1.5,color:DA.black,overflowWrap:'anywhere' }}>{renderMarkup(i.commentaire)}</div>
                      )}
                      {(() => {
                        const phs = (photosByItem[i.id] || []).filter(ph => ph.data || ph.annotated);
                        if (phs.length) return (
                          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(104px, 1fr))',gap:6,marginTop:8 }}>
                            {phs.map((ph, k) => <PhotoThumb key={ph.id || k} ph={ph} scales={scales.photo} onZoom={setZoom}/>)}
                          </div>
                        );
                        if (loadingPhotos && !(i.id in photosByItem)) return <p style={{ margin:'6px 0 0',fontSize:11,color:DA.grayL,display:'flex',alignItems:'center',gap:4 }}><Ic n="spn" s={11}/> Photos…</p>;
                        return null;
                      })()}
                      {(i.plans || []).filter(pl => pl.planId || pl.planBg).map((pl, k) => (
                        <div key={pl.id || k} style={{ marginTop:8,cursor:'zoom-in' }}>
                          <ItemPlanBlock plan={{ bg: pl.planBg || libById.get(pl.planId)?.bg || null, planId: pl.planId || null, annotations: pl.planAnnotations }}
                            planNom={libById.get(pl.planId)?.nom || null} annotScale={scales.plan}/>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
              {conclusion && (
                <div style={{ marginBottom:18 }}>
                  <h3 style={{ margin:'0 0 8px',fontSize:12,fontWeight:800,color:DA.red,textTransform:'uppercase',letterSpacing:0.4 }}>Conclusion</h3>
                  <div style={{ background:DA.white,border:`1px solid ${DA.border}`,borderRadius:10,padding:'10px 12px',fontSize:13.5,lineHeight:1.5,color:DA.black,overflowWrap:'anywhere' }}>{renderMarkup(conclusion)}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {zoom && (
        <div onClick={(e) => { e.stopPropagation(); setZoom(null); }}
          style={{ position:'fixed',inset:0,zIndex:10001,background:'rgba(0,0,0,0.88)',display:'flex',alignItems:'center',justifyContent:'center',padding:'calc(12px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px))',cursor:'zoom-out' }}>
          {zoom.src
            ? <img src={zoom.src} alt="" style={{ maxWidth:'100%',maxHeight:'100%',objectFit:'contain',display:'block',background:'#fff' }}/>
            : (
              <div style={{ position:'relative',width:'min(100%, calc((100dvh - 24px) * 4 / 3))',aspectRatio:'4 / 3',overflow:'hidden',background:'#fff' }}>
                <ReportPhotoImg sources={[zoom.ph.data]} overlaySrc={zoom.ph.data}
                  overlay={<PhotoAnnotCanvas photo={zoom.ph} containerAR={4 / 3} photoScale={scales.photo}/>}
                  style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',display:'block' }}/>
              </div>
            )}
          <button onClick={() => setZoom(null)} aria-label="Fermer" style={{ position:'absolute',top:'calc(10px + env(safe-area-inset-top, 0px))',right:10,padding:8,borderRadius:20,border:'none',background:'rgba(255,255,255,0.15)',color:'white',cursor:'pointer' }}>
            <Ic n="x" s={20}/>
          </button>
        </div>
      )}
    </div>
  );
}
