import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { SYMBOLS, drawAnnotationPaths, drawVP } from './Annotator.jsx';
import { Ic } from '../ui/Icons.jsx';
import ItemModal from './ItemModal.jsx';

function SymbolIcon({ sym, size = 14 }) {
  const ref = useRef();
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 80, 80);
    try { sym.draw(ctx, 40, 28, 2, DA.red); } catch {}
  }, [sym]);
  return <canvas ref={ref} width={80} height={80}
    style={{ display:'block', flexShrink:0, width:size, height:size }}/>;
}

function ViewpointIcon({ size = 24 }) {
  const ref = useRef();
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 80, 80);
    try { drawVP(ctx, { x: 38, y: 55, angle: -Math.PI / 2, label: 'V1', size: 1, color: DA.red }); } catch {}
  }, []);
  return <canvas ref={ref} width={80} height={80}
    style={{ display:'block', flexShrink:0, width:size, height:size }}/>;
}

// Échelle : 3px = 1mm → page A4 = 630 × 891px
const S   = 3;
const PH  = 297 * S;  // 891px
const PW  = 210 * S;  // 630px
const MX  = 18  * S;  // 54px marges gauche/droite
const MT  = 18  * S;  // 54px marge haute
const MB  = 13  * S;  // 39px marge basse
const HDR = 10  * S;  // 30px hauteur header
const FTR = 8   * S;  // 24px hauteur footer
const CW  = PW - 2 * MX; // 522px largeur contenu

// ── Pagination ─────────────────────────────────────────────────────────────
// Retourne un tableau de pages divisées UNIQUEMENT aux sauts explicites.
// bloc = { type:'zone'|'item'|'plan', id, loc?, item? }
function buildPages(locs, ppl, breaks, plansEnFin) {
  const pages = [];
  let blocks = [];
  const flush = () => { if (blocks.length) { pages.push(blocks); blocks = []; } };

  for (const loc of locs) {
    const items = (loc.items || []).filter(i => i.titre);
    if (!items.length) continue;

    if (breaks.has(loc.id)) flush();
    blocks.push({ type: 'zone', id: loc.id, loc });

    for (const item of items) {
      if (breaks.has(item.id)) flush();
      blocks.push({ type: 'item', id: item.id, item, locId: loc.id });
    }

    if (!plansEnFin) {
      const hasPlan = loc.planAnnotations?.exported || loc.planBg;
      if (hasPlan) {
        blocks.push({ type: 'plan', id: `plan-${loc.id}`, loc });
      }
    }
  }
  flush();
  return pages;
}

// ── Sous-composants ────────────────────────────────────────────────────────

function BreakControl({ id, active, onToggle }) {
  return (
    <div onClick={() => onToggle(id)}
      style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 0', cursor:'pointer', userSelect:'none' }}>
      <div style={{ flex:1, borderTop: active ? `2px dashed ${DA.red}` : '1px dashed #ddd' }}/>
      <span style={{
        fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:4, whiteSpace:'nowrap',
        background: active ? DA.red : '#f5f5f5',
        color: active ? 'white' : '#bbb',
        border: `1px solid ${active ? DA.red : '#e0e0e0'}`,
      }}>
        {active ? '× Retirer saut' : '⊕ Saut de page'}
      </span>
      <div style={{ flex:1, borderTop: active ? `2px dashed ${DA.red}` : '1px dashed #ddd' }}/>
    </div>
  );
}

function ZoneHeader({ loc }) {
  return (
    <div style={{ background:DA.black, borderRadius:3, padding:'5px 10px', marginBottom:5, display:'flex', alignItems:'center', gap:6 }}>
      <div style={{ width:3, height:16, background:DA.red, borderRadius:2, flexShrink:0 }}/>
      <span style={{ fontSize:10, fontWeight:800, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>{loc.nom}</span>
    </div>
  );
}

function ItemBlock({ item, ppl, onEdit }) {
  const photos = (item.photos || []).filter(p => p.data);
  const urg    = URGENCE[item.urgence] || URGENCE.basse;
  const suivi  = item.suivi && item.suivi !== 'rien' ? SUIVI[item.suivi] : null;
  return (
    <div style={{ marginBottom:5, border:`1px solid ${DA.border}`, borderRadius:4, overflow:'hidden' }}>
      {/* Titre */}
      <div style={{ background:'#F5F5F5', padding:'5px 9px', display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ width:7, height:7, borderRadius:'50%', background:urg.dot, flexShrink:0 }}/>
        <span style={{ fontSize:10, fontWeight:700, color:DA.black, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.titre}</span>
        <span style={{ fontSize:9, color:urg.text, fontWeight:600, flexShrink:0 }}>{urg.label}</span>
        {onEdit && (
          <button onClick={onEdit}
            style={{ marginLeft:4, background:'none', border:'none', cursor:'pointer', color:DA.grayL, padding:'1px 3px', display:'flex', alignItems:'center', borderRadius:3, flexShrink:0 }}
            title="Modifier">
            <Ic n="pen" s={10}/>
          </button>
        )}
      </div>
      {/* Suivi */}
      {suivi && (
        <div style={{ padding:'2px 9px', background:'#fafafa', borderBottom:`1px solid ${DA.border}` }}>
          <span style={{ fontSize:9, color:suivi.text, fontWeight:600 }}>↩ {suivi.label}</span>
        </div>
      )}
      {/* Commentaire */}
      {item.commentaire && (
        <div style={{ padding:'5px 9px', fontSize:10, color:'#333', lineHeight:1.55 }}>
          {item.commentaire}
        </div>
      )}
      {/* Photos */}
      {photos.length > 0 && (
        <div style={{ padding:'4px 6px 6px', display:'grid', gridTemplateColumns:`repeat(${Math.min(ppl,3)},1fr)`, gap:3 }}>
          {photos.slice(0, 6).map((ph, pi) => (
            <img key={pi} src={ph.data} alt=""
              style={{ width:'100%', aspectRatio:'4/3', objectFit:'cover', borderRadius:2, display:'block' }}/>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanBlock({ loc }) {
  const exported = loc.planAnnotations?.exported;
  const paths    = loc.planAnnotations?.paths;
  const planBg   = loc.planBg;
  const [renderedImg, setRenderedImg] = useState(null);

  useEffect(() => {
    if (!planBg) { setRenderedImg(exported || null); return; }
    if (!paths?.length) { setRenderedImg(planBg); return; }
    const el = new window.Image();
    el.onload = () => {
      const cv  = document.createElement('canvas');
      cv.width  = el.naturalWidth;
      cv.height = el.naturalHeight;
      const ctx = cv.getContext('2d');
      ctx.drawImage(el, 0, 0, cv.width, cv.height);
      const sizeScale = Math.max(1, cv.width / 700);
      drawAnnotationPaths(ctx, paths, sizeScale);
      setRenderedImg(cv.toDataURL('image/png'));
    };
    el.onerror = () => setRenderedImg(exported || planBg);
    el.src = planBg;
  }, [exported, paths, planBg]);

  // Légende : symboles + viewpoints
  const usedIds       = new Set((paths || []).filter(p => p.type === 'symbol').map(p => p.symbolId));
  const legendSy      = SYMBOLS.filter(s => usedIds.has(s.id));
  const hasViewpoints = (paths || []).some(p => p.type === 'viewpoint');
  const showLegend    = legendSy.length > 0 || hasViewpoints;

  if (!renderedImg && !planBg) return null;
  return (
    <div style={{ marginBottom:5, border:`1px solid ${DA.border}`, borderRadius:4, overflow:'hidden' }}>
      <div style={{ background:DA.black, padding:'5px 9px', display:'flex', alignItems:'center', gap:6 }}>
        <div style={{ width:3, height:12, background:DA.red, borderRadius:1, flexShrink:0 }}/>
        <span style={{ fontSize:9, fontWeight:700, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>
          Plan — {loc.nom}
        </span>
        {paths?.length > 0 && (
          <span style={{ marginLeft:'auto', fontSize:8, color:'rgba(255,255,255,0.5)' }}>
            {paths.length} annotation{paths.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {renderedImg && (
        <img src={renderedImg} alt={`Plan ${loc.nom}`}
          style={{ width:'100%', display:'block', objectFit:'contain' }}/>
      )}
      {showLegend && (
        <div style={{ padding:'8px 12px 10px', background:'#f9f9f9', borderTop:`2px solid ${DA.red}` }}>
          <div style={{ fontSize:10, fontWeight:800, color:DA.red, textTransform:'uppercase', letterSpacing:0.8, marginBottom:8 }}>Légende</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 20px' }}>
            {legendSy.map(s => (
              <div key={s.id} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:DA.gray }}>
                <SymbolIcon sym={s} size={24}/>
                {s.label}
              </div>
            ))}
            {hasViewpoints && (
              <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:DA.gray }}>
                <ViewpointIcon size={24}/>
                Vue photo
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bandeau header commun (logo + titre projet) ─────────────────────────────
function HdrBar({ projet, dateStr }) {
  return (
    <div style={{ height:HDR, background:DA.black, display:'flex', alignItems:'center', padding:`0 ${MX}px`, position:'relative' }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:DA.red }}/>
      <img src="/logo_Ai_rouge_HD.png" alt="AI"
        style={{ height:16, objectFit:'contain', opacity:0.9, flexShrink:0 }}/>
      <span style={{ flex:1 }}/>
      <span style={{ fontSize:6, color:'rgba(255,255,255,0.35)' }}>{projet.nom}{dateStr ? ` · ${dateStr}` : ''}</span>
    </div>
  );
}

function A4Card({ children, projet, pageNum, totalPages }) {
  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR')
    : new Date().toLocaleDateString('fr-FR');
  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0 }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      {/* Contenu */}
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB}px` }}>{children}</div>
      <PageFtr pageNum={pageNum} totalPages={totalPages}/>
    </div>
  );
}

function PageSepBanner({ pageNum, totalPages, firstBlockId, isForced, onToggle }) {
  return (
    <div style={{ width:PW, background:'#1e1e1e', padding:'10px 0 8px', display:'flex', flexDirection:'column', alignItems:'center', gap:6, flexShrink:0 }}>
      <span style={{ fontSize:11, fontWeight:800, color:'rgba(255,255,255,0.6)', letterSpacing:1.5, textTransform:'uppercase', whiteSpace:'nowrap' }}>
        — Page {pageNum} / {totalPages} —
      </span>
      {firstBlockId && (
        <div onClick={() => onToggle(firstBlockId)}
          style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:4, cursor:'pointer',
            background: isForced ? DA.red : 'rgba(255,255,255,0.07)',
            border: `1px solid ${isForced ? DA.red : 'rgba(255,255,255,0.14)'}` }}>
          <span style={{ fontSize:9, fontWeight:700, color: isForced ? 'white' : 'rgba(255,255,255,0.45)', whiteSpace:'nowrap' }}>
            {isForced ? '× Saut forcé' : '⊕ Forcer saut ici'}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Page de garde unifiée (photo/titre + présentation + intervenants) ──────────
function CoverPage({ projet, pageNum, totalPages }) {
  const participants = projet.participants || [];
  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR')
    : null;
  const infoRows = [
    projet.adresse       && ['Adresse',         projet.adresse],
    dateStr              && ['Date de visite',   dateStr],
    projet.maitreOuvrage && ["Maître d'ouvrage", projet.maitreOuvrage],
  ].filter(Boolean);

  const DARK_H = Math.round(PH * 0.30);

  return (
    <div style={{ width:PW, height:PH, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* ── Partie sombre : photo + titre ── */}
      <div style={{ height:DARK_H, background:DA.black, position:'relative', overflow:'hidden', flexShrink:0 }}>
        {projet.photo && (
          <img src={projet.photo} alt=""
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', opacity:0.3 }}/>
        )}
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:DA.red }}/>
        <img src="/logo_Ai_rouge_HD.png" alt="Assemblage Ingénierie"
          style={{ position:'absolute', top:MX, right:MX, height:24, objectFit:'contain' }}/>
        <div style={{ position:'absolute', bottom:MX, left:MX+4 }}>
          <div style={{ fontSize:7, color:'rgba(255,255,255,0.4)', letterSpacing:1.5, textTransform:'uppercase', marginBottom:6 }}>
            Compte-rendu de visite
          </div>
          <div style={{ fontSize:22, fontWeight:800, color:'white', lineHeight:1.2 }}>{projet.nom}</div>
        </div>
      </div>

      {/* ── Partie blanche : présentation + intervenants ── */}
      <div style={{ flex:1, padding:`18px ${MX}px 8px`, display:'flex', flexDirection:'column', gap:16, minHeight:0, overflow:'hidden' }}>

        {infoRows.length > 0 && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
              <div style={{ width:3, height:14, background:DA.red, borderRadius:2, flexShrink:0 }}/>
              <span style={{ fontSize:8, fontWeight:800, color:DA.black, textTransform:'uppercase', letterSpacing:0.8 }}>Présentation du projet</span>
            </div>
            <div style={{ background:DA.grayXL, borderRadius:6, padding:'8px 10px', border:`1px solid ${DA.border}`, display:'flex', flexDirection:'column', gap:5 }}>
              {infoRows.map(([k, v]) => (
                <div key={k} style={{ display:'flex', fontSize:9 }}>
                  <span style={{ color:DA.gray, fontWeight:700, width:90, flexShrink:0 }}>{k}</span>
                  <span style={{ color:DA.black }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {participants.length > 0 && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <div style={{ width:3, height:14, background:DA.red, borderRadius:2, flexShrink:0 }}/>
              <span style={{ fontSize:8, fontWeight:800, color:DA.black, textTransform:'uppercase', letterSpacing:0.8 }}>
                Intervenants ({participants.length})
              </span>
            </div>
            <div style={{ display:'flex', alignItems:'center', background:DA.black, borderRadius:'4px 4px 0 0', padding:'5px 0' }}>
              <div style={{ width:24, flexShrink:0 }}/>
              <div style={{ flex:1, display:'flex', minWidth:0 }}>
                <div style={{ flex:'0 0 36%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', paddingRight:8 }}>NOM / POSTE</div>
                <div style={{ flex:'0 0 22%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', paddingRight:4 }}>TÉLÉPHONE</div>
                <div style={{ flex:'0 0 28%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', paddingRight:4 }}>EMAIL</div>
                <div style={{ flex:'0 0 14%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', textAlign:'right', paddingRight:6 }}>PRÉSENCE</div>
              </div>
            </div>
            {participants.map((pt, i) => {
              const isPresent = !pt.presence || pt.presence === 'present';
              const bg = i % 2 === 0 ? DA.grayXL : 'white';
              return (
                <div key={pt.id} style={{ display:'flex', alignItems:'center', padding:'5px 0', background:bg, borderBottom:`1px solid ${DA.border}` }}>
                  <div style={{ width:24, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {pt.isAssemblage
                      ? <span style={{ fontSize:6, fontWeight:900, color:DA.red, background:'#FFF0F0', borderRadius:3, padding:'1px 3px', border:`1px solid #FECACA` }}>A!</span>
                      : <div style={{ width:5, height:5, borderRadius:'50%', background:'#bbb' }}/>
                    }
                  </div>
                  <div style={{ flex:1, display:'flex', alignItems:'center', minWidth:0 }}>
                    <div style={{ flex:'0 0 36%', minWidth:0, paddingRight:8 }}>
                      <div style={{ fontSize:8.5, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.nom}</div>
                      {pt.poste && <div style={{ fontSize:7.5, color:DA.gray, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.poste}</div>}
                    </div>
                    <div style={{ flex:'0 0 22%', fontSize:8, color:DA.gray, paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.tel || '—'}</div>
                    <div style={{ flex:'0 0 28%', fontSize:7.5, color:DA.gray, paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.email || '—'}</div>
                    <div style={{ flex:'0 0 14%', textAlign:'right', paddingRight:6 }}>
                      <span style={{ fontSize:7.5, fontWeight:700,
                        color: isPresent ? '#16A34A' : DA.red,
                        background: isPresent ? '#DCFCE7' : '#FEE2E2',
                        borderRadius:4, padding:'1px 5px' }}>
                        {isPresent ? 'Présent' : 'Absent'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <PageFtr pageNum={pageNum} totalPages={totalPages}/>
    </div>
  );
}

// ── Pied de page commun (toutes les pages) ────────────────────────────────
function PageFtr({ pageNum, totalPages }) {
  return (
    <div style={{ height:FTR, background:'#F9F9F9', borderTop:`1px solid ${DA.border}`, flexShrink:0, display:'flex', alignItems:'center', padding:`0 ${MX}px`, gap:6 }}>
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:1.5, minWidth:0 }}>
        <span style={{ fontSize:5, color:'#c8c8c8', lineHeight:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          Assemblage Ingénierie · S.A.S. capital social 1 000€ · 137 rue d'Aboukir, 75002 Paris · contact@assemblage.net · www.assemblage.net · +33 7 65 62 30 87
        </span>
        <span style={{ fontSize:5, color:'#c8c8c8', lineHeight:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          NAF 7112B · R.C.S. Paris 822 130 100 · Siret 822 130 100 0032 · n°TVA FR 24 822 130 100
        </span>
      </div>
      <span style={{ fontSize:6, color:DA.grayL, flexShrink:0 }}>{pageNum} / {totalPages}</span>
    </div>
  );
}


// ── Page conclusion ────────────────────────────────────────────────────────
function ConclusionPage({ conclusion, projet, pageNum, totalPages }) {
  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR')
    : null;
  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0 }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB}px` }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <div style={{ width:3, height:14, background:DA.red, borderRadius:2, flexShrink:0 }}/>
          <span style={{ fontSize:9, fontWeight:800, color:DA.black, textTransform:'uppercase', letterSpacing:0.8 }}>Conclusion</span>
        </div>
        <div style={{ fontSize:9, color:DA.black, lineHeight:1.7, whiteSpace:'pre-wrap', border:`1px solid ${DA.border}`, borderRadius:6, padding:'10px 12px', background:DA.grayXL, minHeight:60 }}>
          {conclusion || <span style={{ color:DA.grayL, fontStyle:'italic' }}>Aucune conclusion saisie.</span>}
        </div>
      </div>
      <div style={{ height:FTR, background:'#F9F9F9', borderTop:`1px solid ${DA.border}`, display:'flex', alignItems:'center', padding:`0 ${MX}px` }}>
        <span style={{ fontSize:6, color:DA.grayL }}>aichantier.app</span>
        <span style={{ flex:1 }}/>
        <span style={{ fontSize:6, color:DA.grayL }}>{pageNum} / {totalPages}</span>
      </div>
    </div>
  );
}

// ── Tableau récapitulatif auto-généré ──────────────────────────────────────
function TableauRecapPage({ localisations, projet, pageNum, totalPages }) {
  const urgOrder = { haute: 0, moyenne: 1, basse: 2 };
  const rows = localisations.flatMap(loc =>
    (loc.items || []).filter(i => i.titre && i.suivi !== 'fait').map(i => ({
      locNom: loc.nom, titre: i.titre, urgence: i.urgence || 'basse', suivi: i.suivi,
    }))
  ).sort((a, b) => (urgOrder[a.urgence] ?? 2) - (urgOrder[b.urgence] ?? 2));

  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR')
    : null;

  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0 }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB}px` }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <div style={{ width:3, height:14, background:DA.red, borderRadius:2, flexShrink:0 }}/>
          <span style={{ fontSize:9, fontWeight:800, color:DA.black, textTransform:'uppercase', letterSpacing:0.8 }}>Tableau récapitulatif</span>
          <span style={{ fontSize:8, color:DA.grayL }}>{rows.length} point{rows.length !== 1 ? 's' : ''} à traiter</span>
        </div>
        {/* Header */}
        <div style={{ display:'grid', gridTemplateColumns:'5px 1fr 60px 60px', background:DA.black, borderRadius:'4px 4px 0 0', padding:'4px 8px', gap:8 }}>
          <div/>
          <span style={{ fontSize:7, fontWeight:700, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>Désordre / Zone</span>
          <span style={{ fontSize:7, fontWeight:700, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>Urgence</span>
          <span style={{ fontSize:7, fontWeight:700, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>Suivi</span>
        </div>
        {rows.map((row, i) => {
          const u = URGENCE[row.urgence] || URGENCE.basse;
          const sv = row.suivi && row.suivi !== 'rien' ? SUIVI[row.suivi] : null;
          return (
            <div key={i} style={{ display:'grid', gridTemplateColumns:'5px 1fr 60px 60px', gap:8, padding:'5px 8px', borderBottom:`1px solid ${DA.border}`, background: i % 2 === 0 ? DA.grayXL : 'white', alignItems:'center' }}>
              <div style={{ width:5, height:'100%', background:u.dot, borderRadius:2, minHeight:14, alignSelf:'stretch' }}/>
              <div>
                <div style={{ fontSize:8, fontWeight:700, color:DA.black, lineHeight:1.3 }}>{row.titre || '—'}</div>
                <div style={{ fontSize:7, color:DA.grayL, marginTop:1 }}>{row.locNom}</div>
              </div>
              <span style={{ fontSize:7, fontWeight:700, color:u.text, background:u.bg, border:`1px solid ${u.border}`, borderRadius:4, padding:'1px 5px', whiteSpace:'nowrap' }}>{u.label}</span>
              <span style={{ fontSize:7, color: sv ? sv.text : DA.grayL, background: sv ? sv.bg : 'transparent', border: sv ? `1px solid ${sv.border}` : 'none', borderRadius:4, padding: sv ? '1px 5px' : 0, whiteSpace:'nowrap' }}>
                {sv ? sv.label : '—'}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ height:FTR, background:'#F9F9F9', borderTop:`1px solid ${DA.border}`, display:'flex', alignItems:'center', padding:`0 ${MX}px` }}>
        <span style={{ fontSize:6, color:DA.grayL }}>aichantier.app</span>
        <span style={{ flex:1 }}/>
        <span style={{ fontSize:6, color:DA.grayL }}>{pageNum} / {totalPages}</span>
      </div>
    </div>
  );
}

// ── Hook scale adaptatif ───────────────────────────────────────────────────
function usePreviewScale(containerRef) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const available = containerRef.current.clientWidth - 32; // 16px padding each side
      const ratio = available / PW;
      setScale(ratio < 1 ? ratio : 1);
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [containerRef]);
  return scale;
}

// ── Composant principal ────────────────────────────────────────────────────
export default function RapportPreview({ projet, localisations, photosParLigne, pageBreaks, onTogglePageBreak, plansEnFin, includeTableauRecap = true, includeConclusion = false, conclusion = '', onUpdateItem }) {
  const ppl    = photosParLigne ?? 2;
  const breaks = useMemo(() => new Set(pageBreaks || []), [pageBreaks]);
  const locs   = useMemo(() => localisations.filter(l => (l.items || []).some(i => i.titre)), [localisations]);
  const [editingItem, setEditingItem] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const planLocs = useMemo(
    () => plansEnFin ? localisations.filter(l => l.planAnnotations?.exported || l.planBg) : [],
    [localisations, plansEnFin]
  );

  const pages = useMemo(() => buildPages(locs, ppl, breaks, plansEnFin), [locs, ppl, breaks, plansEnFin]);
  const containerRef = useRef();
  const scrollRef    = useRef();
  const pageRefs     = useRef([]);
  const scale = usePreviewScale(containerRef);

  const recapItems    = localisations.flatMap(l => (l.items || []).filter(i => i.titre && i.suivi !== 'fait'));
  const hasTableau    = includeTableauRecap && recapItems.length > 0;
  const hasConclusion = includeConclusion;
  const totalPages    = 1 + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + planLocs.length;

  // Suivi de la page courante via scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const ctop = el.getBoundingClientRect().top;
      let bestPage = 1, bestDist = Infinity;
      pageRefs.current.forEach((ref, i) => {
        if (!ref) return;
        const dist = Math.abs(ref.getBoundingClientRect().top - ctop - 30);
        if (dist < bestDist) { bestDist = dist; bestPage = i + 1; }
      });
      setCurrentPage(bestPage);
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [totalPages]);

  const scrollToPage = useCallback((n) => {
    const idx = Math.max(0, Math.min(totalPages - 1, n - 1));
    const ref = pageRefs.current[idx];
    if (!ref || !scrollRef.current) return;
    const elTop = ref.getBoundingClientRect().top;
    const ctop  = scrollRef.current.getBoundingClientRect().top;
    scrollRef.current.scrollBy({ top: elTop - ctop - 16, behavior: 'smooth' });
  }, [totalPages]);

  if (!pages.length) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10, color:DA.grayL }}>
        <span style={{ fontSize:36 }}>📄</span>
        <span style={{ fontSize:13 }}>Aucune observation à prévisualiser</span>
        <span style={{ fontSize:11 }}>Ajoutez des observations dans l'onglet Visite</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* ── Barre de navigation pages ── */}
      <div style={{ background:'#1e1e1e', padding:'7px 14px', display:'flex', alignItems:'center', gap:10, flexShrink:0, borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={() => scrollToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          style={{ background:'rgba(255,255,255,0.08)', border:'none', color: currentPage <= 1 ? 'rgba(255,255,255,0.2)' : 'white', borderRadius:6, padding:'4px 13px', cursor: currentPage <= 1 ? 'default' : 'pointer', fontSize:16, fontWeight:700, lineHeight:1, flexShrink:0 }}>
          ‹
        </button>
        <div style={{ flex:1, textAlign:'center' }}>
          <span style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.7)', letterSpacing:0.5 }}>
            Page {currentPage} / {totalPages}
          </span>
        </div>
        <button
          onClick={() => scrollToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          style={{ background:'rgba(255,255,255,0.08)', border:'none', color: currentPage >= totalPages ? 'rgba(255,255,255,0.2)' : 'white', borderRadius:6, padding:'4px 13px', cursor: currentPage >= totalPages ? 'default' : 'pointer', fontSize:16, fontWeight:700, lineHeight:1, flexShrink:0 }}>
          ›
        </button>
      </div>

      {/* ── Zone défilante ── */}
      <div ref={scrollRef} style={{ flex:1, overflowY:'auto', background:'#555', display:'flex', flexDirection:'column', alignItems:'center', paddingBottom:20 }}>
        {/* Conteneur scalé pour mobile */}
        <div style={{ width: PW * scale, flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', transformOrigin:'top center', ...(scale < 1 ? { transform:`scale(${scale})`, marginBottom: -(PW * (1 - scale) * 0.5) } : {}) }}>

        {/* ── PAGE DE GARDE ── */}
        <div ref={el => { pageRefs.current[0] = el; }} style={{ marginTop:20 }}>
          <CoverPage projet={projet} pageNum={1} totalPages={totalPages}/>
        </div>

        {/* ── PAGES OBSERVATIONS ── */}
        {pages.map((pageBlocks, pi) => {
          const firstId     = pageBlocks[0]?.id;
          const firstForced = breaks.has(firstId);
          const pageNum     = pi + 2;
          return (
            <React.Fragment key={pi}>
              <PageSepBanner
                pageNum={pageNum}
                totalPages={totalPages}
                firstBlockId={firstId}
                isForced={firstForced}
                onToggle={onTogglePageBreak}
              />
              <div ref={el => { pageRefs.current[pi + 1] = el; }}>
                <A4Card projet={projet} pageNum={pageNum} totalPages={totalPages}>
                  {pageBlocks.map((block, bi) => (
                    <div key={block.id}>
                      {bi > 0 && (
                        <BreakControl
                          id={block.id}
                          active={breaks.has(block.id)}
                          onToggle={onTogglePageBreak}
                        />
                      )}
                      {block.type === 'zone'
                        ? <ZoneHeader loc={block.loc} />
                        : block.type === 'plan'
                        ? <PlanBlock loc={block.loc} />
                        : <ItemBlock item={block.item} ppl={ppl}
                            onEdit={onUpdateItem ? () => setEditingItem({ item: block.item, locId: block.locId }) : null}
                          />
                      }
                    </div>
                  ))}
                </A4Card>
              </div>
            </React.Fragment>
          );
        })}

        {/* ── PAGE TABLEAU RÉCAP ── */}
        {hasTableau && (() => {
          const pageNum = 1 + pages.length + 1;
          const pageIdx = 1 + pages.length;
          return (
            <>
              <PageSepBanner pageNum={pageNum} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
              <div ref={el => { pageRefs.current[pageIdx] = el; }}>
                <TableauRecapPage localisations={localisations} projet={projet} pageNum={pageNum} totalPages={totalPages}/>
              </div>
            </>
          );
        })()}

        {/* ── PAGE CONCLUSION ── */}
        {hasConclusion && (() => {
          const pageNum = 1 + pages.length + (hasTableau ? 1 : 0) + 1;
          const pageIdx = 1 + pages.length + (hasTableau ? 1 : 0);
          return (
            <>
              <PageSepBanner pageNum={pageNum} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
              <div ref={el => { pageRefs.current[pageIdx] = el; }}>
                <ConclusionPage conclusion={conclusion} projet={projet} pageNum={pageNum} totalPages={totalPages}/>
              </div>
            </>
          );
        })()}

        {/* ── PLANS EN FIN DE RAPPORT ── */}
        {planLocs.map((loc, pi) => {
          const pageNum = 1 + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + pi + 1;
          const pageIdx = 1 + pages.length + (hasTableau ? 1 : 0) + (hasConclusion ? 1 : 0) + pi;
          return (
            <React.Fragment key={`plan-end-${loc.id}`}>
              <PageSepBanner pageNum={pageNum} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
              <div ref={el => { pageRefs.current[pageIdx] = el; }}>
                <A4Card projet={projet} pageNum={pageNum} totalPages={totalPages}>
                  <PlanBlock loc={loc} />
                </A4Card>
              </div>
            </React.Fragment>
          );
        })}

        <div style={{ height:24 }}/>
        </div>{/* fin conteneur scalé */}

        {editingItem && (() => {
          const editingLoc = localisations.find(l => l.id === editingItem.locId);
          return (
            <ItemModal
              item={editingItem.item}
              planBg={editingLoc?.planBg}
              planAnnotations={editingLoc?.planAnnotations}
              onClose={() => setEditingItem(null)}
              onSave={(form) => {
                onUpdateItem(editingItem.locId, editingItem.item.id, form);
                setEditingItem(null);
              }}
              onOpenAnnot={() => setEditingItem(null)}
            />
          );
        })()}
      </div>
    </div>
  );
}
