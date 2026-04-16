import React, { useMemo } from 'react';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';

// Échelle : 3px = 1mm → page A4 = 630 × 891px
const S   = 3;
const PW  = 210 * S;  // 630px
const MX  = 18  * S;  // 54px marges gauche/droite
const MT  = 18  * S;  // 54px marge haute
const MB  = 13  * S;  // 39px marge basse
const HDR = 10  * S;  // 30px hauteur header
const FTR = 8   * S;  // 24px hauteur footer
const CW  = PW - 2 * MX; // 522px largeur contenu
const USABLE_MM = 266; // hauteur utile par page en mm (297 - 18 - 13)

// ── Estimation hauteur item en mm (miroir de generateRapport.js) ──────────
function itemMm(item, ppl) {
  let h = 12; // bandeau titre + petit gap
  if (item.suivi && item.suivi !== 'rien') h += 7;
  if (item.commentaire) {
    h += Math.max(1, Math.ceil(item.commentaire.length / 65)) * 4.5 + 4;
  }
  const np = (item.photos || []).filter(p => p.data).length;
  if (np > 0) h += Math.ceil(Math.min(np, 6) / Math.max(1, Math.min(ppl, 3))) * 30 + 4;
  return h + 4;
}

const PLAN_MM = 120; // hauteur estimée d'un bloc plan (header 12 + image ~104 + gap 4)

// ── Pagination ─────────────────────────────────────────────────────────────
// Retourne un tableau de pages ; chaque page = tableau de blocs
// bloc = { type:'zone'|'item'|'plan', id, loc?, item? }
function buildPages(locs, ppl, breaks, plansEnFin) {
  const pages = [];
  let blocks = [], yMm = 0;
  const flush = () => { if (blocks.length) { pages.push(blocks); blocks = []; yMm = 0; } };

  for (const loc of locs) {
    const items = (loc.items || []).filter(i => i.titre);
    if (!items.length) continue;

    if (breaks.has(loc.id))          flush();
    else if (yMm + 14 > USABLE_MM && blocks.length) flush();
    blocks.push({ type: 'zone', id: loc.id, loc });
    yMm += 14;

    for (const item of items) {
      const h = itemMm(item, ppl);
      if (breaks.has(item.id))             flush();
      else if (yMm + h > USABLE_MM && blocks.length) flush();
      blocks.push({ type: 'item', id: item.id, item });
      yMm += h;
    }

    // Plan inline (si !plansEnFin et plan disponible pour cette zone)
    if (!plansEnFin) {
      const hasPlan = loc.planAnnotations?.exported || loc.planBg;
      if (hasPlan) {
        if (yMm + PLAN_MM > USABLE_MM && blocks.length) flush();
        blocks.push({ type: 'plan', id: `plan-${loc.id}`, loc });
        yMm += PLAN_MM;
      }
    }

    yMm += 5;
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

function ItemBlock({ item, ppl }) {
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
  const planImg = loc.planAnnotations?.exported || loc.planBg;
  if (!planImg) return null;
  return (
    <div style={{ marginBottom:5, border:`1px solid ${DA.border}`, borderRadius:4, overflow:'hidden' }}>
      <div style={{ background:DA.black, padding:'5px 9px', display:'flex', alignItems:'center', gap:6 }}>
        <div style={{ width:3, height:12, background:DA.red, borderRadius:1, flexShrink:0 }}/>
        <span style={{ fontSize:9, fontWeight:700, color:'white', textTransform:'uppercase', letterSpacing:0.5 }}>
          Plan — {loc.nom}
        </span>
      </div>
      <img src={planImg} alt={`Plan ${loc.nom}`}
        style={{ width:'100%', display:'block', objectFit:'contain' }}/>
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
      {/* Footer */}
      <div style={{ height:FTR, background:'#F9F9F9', borderTop:`1px solid ${DA.border}`, display:'flex', alignItems:'center', padding:`0 ${MX}px` }}>
        <span style={{ fontSize:6, color:DA.grayL }}>aichantier.app</span>
        <span style={{ flex:1 }}/>
        <span style={{ fontSize:6, color:DA.grayL }}>{pageNum} / {totalPages}</span>
      </div>
    </div>
  );
}

function PageSepBanner({ pageNum, totalPages, firstBlockId, isForced, onToggle }) {
  return (
    <div style={{ width:PW, background:'#3a3a3a', padding:'5px 0', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
      <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.1)', marginLeft:MX }}/>
      <span style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,0.45)', letterSpacing:1, whiteSpace:'nowrap' }}>
        PAGE {pageNum} / {totalPages}
      </span>
      {firstBlockId && (
        <div onClick={() => onToggle(firstBlockId)}
          style={{ display:'flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:4, cursor:'pointer',
            background: isForced ? DA.red : 'rgba(255,255,255,0.08)',
            border: `1px solid ${isForced ? DA.red : 'rgba(255,255,255,0.15)'}` }}>
          <span style={{ fontSize:9, fontWeight:700, color: isForced ? 'white' : 'rgba(255,255,255,0.4)', whiteSpace:'nowrap' }}>
            {isForced ? '× Saut forcé' : '⊕ Forcer ici'}
          </span>
        </div>
      )}
      <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.1)', marginRight:MX }}/>
    </div>
  );
}

// ── Page Présentation & Intervenants ──────────────────────────────────────────
function IntervenantsPage({ projet, pageNum, totalPages }) {
  const participants = projet.participants || [];
  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR')
    : null;
  const infoRows = [
    projet.adresse       && ['Adresse',          projet.adresse],
    dateStr              && ['Date de visite',    dateStr],
    projet.maitreOuvrage && ["Maître d'ouvrage",  projet.maitreOuvrage],
  ].filter(Boolean);

  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0 }}>
      <HdrBar projet={projet} dateStr={dateStr}/>

      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB}px` }}>

        {/* ── Présentation du projet ── */}
        {infoRows.length > 0 && (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
              <div style={{ width:3, height:14, background:DA.red, borderRadius:2, flexShrink:0 }}/>
              <span style={{ fontSize:8, fontWeight:800, color:DA.black, textTransform:'uppercase', letterSpacing:0.8 }}>Présentation du projet</span>
            </div>
            <div style={{ background:DA.grayXL, borderRadius:6, padding:'8px 10px', marginBottom:14, display:'flex', flexDirection:'column', gap:5, border:`1px solid ${DA.border}` }}>
              {infoRows.map(([k, v]) => (
                <div key={k} style={{ display:'flex', gap:0, fontSize:9 }}>
                  <span style={{ color:DA.gray, fontWeight:700, width:90, flexShrink:0 }}>{k}</span>
                  <span style={{ color:DA.black }}>{v}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Intervenants ── */}
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
          <div style={{ width:3, height:14, background:DA.red, borderRadius:2, flexShrink:0 }}/>
          <span style={{ fontSize:8, fontWeight:800, color:DA.black, textTransform:'uppercase', letterSpacing:0.8 }}>
            Intervenants ({participants.length})
          </span>
        </div>

        {/* En-tête tableau — badge fixe 24px + colonnes dans flex:1 pour éviter overflow */}
        <div style={{ display:'flex', alignItems:'center', background:DA.black, borderRadius:'4px 4px 0 0', padding:'5px 0' }}>
          <div style={{ width:24, flexShrink:0 }}/>
          <div style={{ flex:1, display:'flex', minWidth:0 }}>
            <div style={{ flex:'0 0 36%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', paddingRight:8 }}>NOM / POSTE</div>
            <div style={{ flex:'0 0 22%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', paddingRight:4 }}>TÉLÉPHONE</div>
            <div style={{ flex:'0 0 28%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', paddingRight:4 }}>EMAIL</div>
            <div style={{ flex:'0 0 14%', fontSize:7, fontWeight:700, color:'rgba(255,255,255,0.7)', textAlign:'right', paddingRight:6 }}>PRÉSENCE</div>
          </div>
        </div>

        {/* Lignes */}
        {participants.map((pt, i) => {
          const isPresent = !pt.presence || pt.presence === 'present';
          const bg = i % 2 === 0 ? DA.grayXL : 'white';
          return (
            <div key={pt.id} style={{ display:'flex', alignItems:'center', padding:'5px 0', background:bg, borderBottom:`1px solid ${DA.border}` }}>
              {/* Badge — largeur fixe */}
              <div style={{ width:24, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                {pt.isAssemblage
                  ? <span style={{ fontSize:6, fontWeight:900, color:DA.red, background:'#FFF0F0', borderRadius:3, padding:'1px 3px', border:`1px solid #FECACA` }}>A!</span>
                  : <div style={{ width:5, height:5, borderRadius:'50%', background:'#bbb' }}/>
                }
              </div>
              {/* Colonnes dans flex:1 pour respecter le même % que l'en-tête */}
              <div style={{ flex:1, display:'flex', alignItems:'center', minWidth:0 }}>
                {/* Nom + poste */}
                <div style={{ flex:'0 0 36%', minWidth:0, paddingRight:8 }}>
                  <div style={{ fontSize:8.5, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.nom}</div>
                  {pt.poste && <div style={{ fontSize:7.5, color:DA.gray, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.poste}</div>}
                </div>
                {/* Téléphone */}
                <div style={{ flex:'0 0 22%', fontSize:8, color:DA.gray, paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {pt.tel || '—'}
                </div>
                {/* Email */}
                <div style={{ flex:'0 0 28%', fontSize:7.5, color:DA.gray, paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {pt.email || '—'}
                </div>
                {/* Présence */}
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

      {/* Footer */}
      <div style={{ height:FTR, background:'#F9F9F9', borderTop:`1px solid ${DA.border}`, display:'flex', alignItems:'center', padding:`0 ${MX}px` }}>
        <span style={{ fontSize:6, color:DA.grayL }}>aichantier.app</span>
        <span style={{ flex:1 }}/>
        <span style={{ fontSize:6, color:DA.grayL }}>{pageNum} / {totalPages}</span>
      </div>
    </div>
  );
}

// ── Composant principal ────────────────────────────────────────────────────
export default function RapportPreview({ projet, localisations, photosParLigne, pageBreaks, onTogglePageBreak, plansEnFin }) {
  const ppl    = photosParLigne ?? 2;
  const breaks = useMemo(() => new Set(pageBreaks || []), [pageBreaks]);
  const locs   = useMemo(() => localisations.filter(l => (l.items || []).some(i => i.titre)), [localisations]);
  const planLocs = useMemo(
    () => plansEnFin ? localisations.filter(l => l.planAnnotations?.exported || l.planBg) : [],
    [localisations, plansEnFin]
  );

  const pages = useMemo(() => buildPages(locs, ppl, breaks, plansEnFin), [locs, ppl, breaks, plansEnFin]);

  const hasTableau      = (projet.tableauRecap || []).length > 0;
  const hasParticipants = (projet.participants || []).length > 0;
  const pOff            = hasParticipants ? 1 : 0;
  const totalPages      = 1 + pOff + pages.length + (hasTableau ? 1 : 0) + planLocs.length;
  const allItems        = localisations.flatMap(l => l.items || []);

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
    <div style={{ flex:1, overflowY:'auto', background:'#555', display:'flex', flexDirection:'column', alignItems:'center', paddingBottom:20 }}>

      {/* ── PAGE DE GARDE ── */}
      <div style={{ width:PW, minHeight:Math.round(PW * 0.5), background:DA.black, boxShadow:'0 2px 20px rgba(0,0,0,0.35)',
        position:'relative', overflow:'hidden', display:'flex', flexDirection:'column', justifyContent:'flex-end',
        padding:`${MX}px`, marginTop:20, flexShrink:0 }}>
        {projet.photo && (
          <img src={projet.photo} alt=""
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', opacity:0.3 }}/>
        )}
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:DA.red }}/>
        {/* Logo Assemblage Ingénierie — coin supérieur droit */}
        <div style={{ position:'absolute', top:MX, right:MX,
          background:'white', borderRadius:6, padding:'6px 10px', boxShadow:'0 2px 8px rgba(0,0,0,0.3)' }}>
          <img src="/logo_Ai_rouge_HD.png" alt="Assemblage Ingénierie"
            style={{ height:22, objectFit:'contain', display:'block' }}/>
        </div>
        <div style={{ position:'relative' }}>
          <div style={{ fontSize:7, color:'rgba(255,255,255,0.4)', letterSpacing:1.5, textTransform:'uppercase', marginBottom:6 }}>
            Compte-rendu de visite
          </div>
          <div style={{ fontSize:22, fontWeight:800, color:'white', lineHeight:1.2, marginBottom:8 }}>{projet.nom}</div>
          {projet.adresse && <div style={{ fontSize:9, color:'rgba(255,255,255,0.45)', marginBottom:3 }}>{projet.adresse}</div>}
          {projet.maitreOuvrage && <div style={{ fontSize:9, color:'rgba(255,255,255,0.5)' }}>MO : {projet.maitreOuvrage}</div>}
          <div style={{ display:'flex', gap:32, marginTop:14, paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.12)' }}>
            {[
              { v: allItems.length, l:'Observations', red:false },
              { v: allItems.filter(i=>i.urgence==='haute').length, l:'Urgentes', red:true },
              { v: localisations.length, l:'Zones', red:false },
            ].map(s => (
              <div key={s.l}>
                <div style={{ fontSize:20, fontWeight:800, color: s.red ? DA.red : 'white' }}>{s.v}</div>
                <div style={{ fontSize:7, color:'rgba(255,255,255,0.35)', marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* ── PAGE INTERVENANTS (dédiée) ── */}
      {hasParticipants && (
        <>
          <PageSepBanner pageNum={2} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
          <IntervenantsPage projet={projet} pageNum={2} totalPages={totalPages}/>
        </>
      )}

      {/* ── PAGES OBSERVATIONS ── */}
      {pages.map((pageBlocks, pi) => {
        const firstId     = pageBlocks[0]?.id;
        const firstForced = breaks.has(firstId);
        const pageNum     = pi + 2 + pOff;
        return (
          <React.Fragment key={pi}>
            <PageSepBanner
              pageNum={pageNum}
              totalPages={totalPages}
              firstBlockId={firstId}
              isForced={firstForced}
              onToggle={onTogglePageBreak}
            />
            <A4Card projet={projet} pageNum={pageNum} totalPages={totalPages}>
              {pageBlocks.map((block, bi) => (
                <div key={block.id}>
                  {/* Contrôle saut entre blocs sur la MÊME page */}
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
                    : <ItemBlock item={block.item} ppl={ppl} />
                  }
                </div>
              ))}
            </A4Card>
          </React.Fragment>
        );
      })}

      {/* ── PAGE TABLEAU RÉCAP ── */}
      {hasTableau && (
        <>
          <PageSepBanner pageNum={1 + pOff + pages.length + 1} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
          <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0 }}>
            <HdrBar projet={projet} dateStr={null}/>
            <div style={{ padding:`${MT - HDR}px ${MX}px ${MB}px` }}>
              <ZoneHeader loc={{ nom:'Tableau récapitulatif' }}/>
              <div style={{ fontSize:10, color:DA.gray, marginTop:4 }}>
                {(projet.tableauRecap||[]).length} ligne{(projet.tableauRecap||[]).length > 1 ? 's' : ''}
              </div>
            </div>
            <div style={{ height:FTR, background:'#F9F9F9', borderTop:`1px solid ${DA.border}`, display:'flex', alignItems:'center', padding:`0 ${MX}px` }}>
              <span style={{ fontSize:6, color:DA.grayL }}>aichantier.app</span>
              <span style={{ flex:1 }}/>
              <span style={{ fontSize:6, color:DA.grayL }}>{totalPages} / {totalPages}</span>
            </div>
          </div>
        </>
      )}

      {/* ── PLANS EN FIN DE RAPPORT ── */}
      {planLocs.map((loc, pi) => {
        const pageNum = 1 + pOff + pages.length + (hasTableau ? 1 : 0) + pi + 1;
        return (
          <React.Fragment key={`plan-end-${loc.id}`}>
            <PageSepBanner pageNum={pageNum} totalPages={totalPages} firstBlockId={null} isForced={false} onToggle={()=>{}}/>
            <A4Card projet={projet} pageNum={pageNum} totalPages={totalPages}>
              <PlanBlock loc={loc} />
            </A4Card>
          </React.Fragment>
        );
      })}

      <div style={{ height:24 }}/>
    </div>
  );
}
