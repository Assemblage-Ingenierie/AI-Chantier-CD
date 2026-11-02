// Aperçu du rapport — pages : couverture, conclusion, tableau récapitulatif, annexes, plan pleine page.
// Extrait tel quel de RapportPreview.jsx (découpage du 02/11/2026, aucun changement de logique).
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { DA, URGENCE, isBrouillon } from '../../../lib/constants.js';
import { renderMarkup, stripMarkup } from '../../../lib/markup.jsx';
import { getAllSymbols } from '../Annotator.jsx';
import { Ic } from '../../ui/Icons.jsx';
import { useBrandingLogo } from '../../../lib/branding.js';
import { callAIProxy } from '../../../lib/aiProxy.js';
import RichTextArea from '../../ui/RichTextArea.jsx';
import { zoneLabel } from '../../../lib/zoneGroups.js';
import { FTR, HDR, MB, MT, MX, PH, PW } from './layout.js';
import { SinglePlanImage, SymbolIcon, ViewpointIcon } from './blocks.jsx';

// ── Bandeau header commun (logo + titre projet) ──────────────────────────────────────────
export function HdrBar({ projet, dateStr }) {
  const logoUrl = useBrandingLogo(); // full logo "Assemblage Ingenierie" (default)
  return (
    <div style={{ height:HDR, background:'white', display:'flex', alignItems:'center', padding:`0 ${MX}px`, borderBottom:`1px solid ${DA.red}` }}>
      {logoUrl && <img src={logoUrl} alt="Assemblage Ingenierie"
        style={{ height:18, objectFit:'contain', flexShrink:0 }}/>}
      <span style={{ flex:1 }}/>
      <span style={{ fontSize:6, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', letterSpacing:'0.03em' }}>{projet.nom}{dateStr ? ` · ${dateStr}` : ''}</span>
    </div>
  );
}

export function A4Card({ children, projet, pageNum, totalPages }) {
  const cardRef = useRef();
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    const measure = () => {
      const h = cardRef.current?.offsetHeight ?? 0;
      setOverflow(Math.max(0, h - PH));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(cardRef.current);
    return () => ro.disconnect();
  }, [children]);

  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR')
    : new Date().toLocaleDateString('fr-FR');
  return (
    <div ref={cardRef} style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, position:'relative', minHeight:PH, fontFamily:"'Open Sans', sans-serif" }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB + FTR}px` }}>{children}</div>
      {/* Footer ancré à PH - FTR même si contenu déborde */}
      <div style={{ position:'absolute', top:PH - FTR, left:0, right:0 }}>
        <PageFtr pageNum={pageNum} totalPages={totalPages}/>
      </div>
      {/* Indicateur visuel de débordement — masqué à l'impression */}
      {overflow > 0 && (
        <>
          <div data-print="hide" style={{ position:'absolute', left:0, right:0, top:PH - FTR - MB, borderTop:'2px dashed #F97316', zIndex:6, pointerEvents:'none' }}>
            <div style={{ background:'#F97316', color:'white', fontSize:7, fontWeight:800, padding:'2px 8px', display:'inline-flex', alignItems:'center', gap:4, borderRadius:'0 0 4px 4px', letterSpacing:0.3, whiteSpace:'nowrap' }}>
              ⚠ Dépasse la page A4 ({Math.round(overflow)}px) — utiliser ✂ Saut de page
            </div>
          </div>
          <div data-print="hide" style={{ position:'absolute', left:0, right:0, top:PH - FTR - MB, bottom:0, background:'rgba(249,115,22,0.06)', pointerEvents:'none', zIndex:5 }}/>
        </>
      )}
    </div>
  );
}

// ── Calcul des chunks de participants pour la page de garde ──────────────────────────────────
export const COVER_ROW_H = 30; // hauteur estimée par ligne (padding 10px + 2 lignes text ≈ 19px + bordure 1px)
export function computeParticipantChunks(participants, infoRowCount) {
  if (!participants.length) return [[]];
  const DARK_H = Math.round(PH * 0.30);
  // Page 1 : zone blanche disponible
  const P1_INNER = PH - DARK_H - FTR - 26; // 26 = padding top 18 + bottom 8
  const INFO_H   = infoRowCount > 0 ? (24 + infoRowCount * 12 + Math.max(0, infoRowCount - 1) * 5 + 16) : 0;
  const HDR_H    = 42; // en-tête section intervenants (titre + ligne tableau)
  const P1_AVAIL = Math.max(0, P1_INNER - INFO_H - HDR_H);
  const p1Count  = Math.floor(P1_AVAIL / COVER_ROW_H);
  // Pages suivantes : pleine hauteur
  const CONT_AVAIL = PH - FTR - 26 - HDR_H;
  const contCount  = Math.max(1, Math.floor(CONT_AVAIL / COVER_ROW_H));
  const chunks = [participants.slice(0, p1Count)];
  let i = p1Count;
  while (i < participants.length) { chunks.push(participants.slice(i, i + contCount)); i += contCount; }
  return chunks;
}

// Bandeau de section dans le tableau des intervenants (ex : « Entreprises ») — libellé rouge + filet.
export function PartSepBand({ label }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0 3px', margin:'1px 0' }}>
      <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:700, color:DA.red, textTransform:'uppercase', letterSpacing:'0.08em', whiteSpace:'nowrap' }}>{label || ''}</span>
      <div style={{ flex:1, height:1, background:'#E3AEAE' }}/>
    </div>
  );
}

// ── Page de garde unifiée (photo/titre + présentation + intervenants) ──────────────────────
export function CoverPage({ projet, pageNum, totalPages, participantChunk }) {
  const logoUrl = useBrandingLogo();
  const sigleUrl = useBrandingLogo('logo/sigle_Ai_rouge.svg');
  const allParticipants = (projet.participants || []).filter(p => !(p.type === 'separator' && p.on === false));
  const participants = participantChunk ?? allParticipants;
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
    <div style={{ width:PW, height:PH, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:"'Open Sans', sans-serif" }}>

      {/* ── Partie sombre : photo + titre ── */}
      <div style={{ height:DARK_H, background:'#1a1a1a', position:'relative', overflow:'hidden', flexShrink:0 }}>
        {projet.photo && (
          <img src={projet.photo} alt=""
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', opacity:0.28 }}/>
        )}
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:DA.red }}/>
        {logoUrl && <img src={logoUrl} alt="Assemblage Ingénierie"
          style={{ position:'absolute', top:MX, right:MX, height:34, objectFit:'contain', opacity:1 }}/>}
        <div style={{ position:'absolute', bottom:MX, left:MX + 10 }}>
          <div style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:'rgba(255,255,255,0.45)', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:8 }}>
            Compte-rendu de visite
          </div>
          <div style={{ fontSize:22, fontFamily:"'Open Sans', sans-serif", fontWeight:500, color:'white', lineHeight:1.05, letterSpacing:'-0.015em' }}>{projet.nom}</div>
          {(projet.visiteNom || dateStr) && (
            <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:2, height:24, background:DA.red, flexShrink:0 }}/>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                {projet.visiteNom && (
                  <span style={{ fontSize:13, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'rgba(255,255,255,0.9)', letterSpacing:'0.01em' }}>{projet.visiteNom}</span>
                )}
                {dateStr && (
                  <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'rgba(255,255,255,0.5)', letterSpacing:'0.04em' }}>● Visite du {dateStr}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Partie blanche : présentation + intervenants ── */}
      <div style={{ flex:1, padding:`18px ${MX}px 8px`, display:'flex', flexDirection:'column', gap:16, minHeight:0, overflow:'hidden' }}>

        {infoRows.length > 0 && (
          <div>
            <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Présentation du projet</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              {infoRows.map(([k, v]) => (
                <div key={k} style={{ display:'flex', fontSize:9, fontFamily:"'Open Sans', sans-serif" }}>
                  <span style={{ color:DA.red, fontWeight:400, width:90, flexShrink:0, letterSpacing:'0.04em' }}>{k}</span>
                  <span style={{ color:'#000', fontWeight:400 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {participants.length > 0 && (
          <div>
            <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                Intervenants ({participants.filter(p => p.type !== 'separator').length})
              </span>
            </div>
            <div style={{ display:'flex', alignItems:'center', background:'#F2F2F2', borderTop:`1px solid #B0B8C1`, borderBottom:`1px solid #B0B8C1`, padding:'4px 0' }}>
              <div style={{ width:20, flexShrink:0 }}/>
              <div style={{ flex:1, display:'flex', minWidth:0 }}>
                <div style={{ flex:'0 0 36%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:8, letterSpacing:'0.06em' }}>NOM / POSTE / ENTREPRISE</div>
                <div style={{ flex:'0 0 22%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:4, letterSpacing:'0.06em' }}>TÉLÉPHONE</div>
                <div style={{ flex:'0 0 28%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:4, letterSpacing:'0.06em' }}>EMAIL</div>
                <div style={{ flex:'0 0 14%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textAlign:'right', paddingRight:6, letterSpacing:'0.06em' }}>PRÉSENCE</div>
              </div>
            </div>
            {participants.map((pt) => {
              if (pt.type === 'separator') return <PartSepBand key={pt.id} label={pt.label} />;
              // 3 états : présent / absent / neutre ('na' = non précisé → pas de pastille).
              const presState = pt.presence === 'absent' ? 'absent' : pt.presence === 'na' ? 'na' : 'present';
              return (
                <div key={pt.id} style={{ display:'flex', alignItems:'center', padding:'5px 0', borderBottom:`1px solid #DFE4E8` }}>
                  <div style={{ width:20, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {pt.isAssemblage
                      ? (sigleUrl
                          ? <img src={sigleUrl} alt="AI" style={{ height:10, width:10, objectFit:'contain' }}/>
                          : <span style={{ fontSize:6, fontFamily:"'Open Sans', sans-serif", fontWeight:700, color:DA.red }}>AI</span>)
                      : <div style={{ width:4, height:4, borderRadius:'50%', background:'#bbb' }}/>
                    }
                  </div>
                  <div style={{ flex:1, display:'flex', alignItems:'center', minWidth:0 }}>
                    <div style={{ flex:'0 0 36%', minWidth:0, paddingRight:8 }}>
                      <div style={{ fontSize:8.5, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:'#000', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.nom}</div>
                      {(pt.poste || pt.entreprise) && <div style={{ fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{[pt.poste, pt.entreprise].filter(Boolean).join(' · ')}</div>}
                    </div>
                    <div style={{ flex:'0 0 22%', fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.tel || '—'}</div>
                    <div style={{ flex:'0 0 28%', fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.email || '—'}</div>
                    <div style={{ flex:'0 0 14%', textAlign:'right', paddingRight:6 }}>
                      {presState !== 'na' && (
                        <span style={{ fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:600,
                          color: presState === 'present' ? '#16A34A' : DA.red,
                          background: presState === 'present' ? '#DCFCE7' : '#FEE2E2',
                          borderRadius:3, padding:'1px 5px' }}>
                          {presState === 'present' ? 'Présent' : 'Absent'}
                        </span>
                      )}
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

// ── Page de garde (suite) — intervenants supplémentaires ──────────────────────────────────
export function CoverOverflowPage({ pageNum, totalPages, participantChunk }) {
  const sigleUrl = useBrandingLogo('logo/sigle_Ai_rouge.svg');
  const participants = participantChunk || [];
  return (
    <div style={{ width:PW, height:PH, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:"'Open Sans', sans-serif" }}>
      <div style={{ flex:1, padding:`18px ${MX}px 8px`, display:'flex', flexDirection:'column', gap:0, minHeight:0, overflow:'hidden' }}>
        <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>
            Intervenants (suite)
          </span>
        </div>
        <div style={{ display:'flex', alignItems:'center', background:'#F2F2F2', borderTop:`1px solid #B0B8C1`, borderBottom:`1px solid #B0B8C1`, padding:'4px 0' }}>
          <div style={{ width:20, flexShrink:0 }}/>
          <div style={{ flex:1, display:'flex', minWidth:0 }}>
            <div style={{ flex:'0 0 36%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:8, letterSpacing:'0.06em' }}>NOM / POSTE / ENTREPRISE</div>
            <div style={{ flex:'0 0 22%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:4, letterSpacing:'0.06em' }}>TÉLÉPHONE</div>
            <div style={{ flex:'0 0 28%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, paddingRight:4, letterSpacing:'0.06em' }}>EMAIL</div>
            <div style={{ flex:'0 0 14%', fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textAlign:'right', paddingRight:6, letterSpacing:'0.06em' }}>PRÉSENCE</div>
          </div>
        </div>
        {participants.map((pt) => {
          if (pt.type === 'separator') return <PartSepBand key={pt.id} label={pt.label} />;
          const presState = pt.presence === 'absent' ? 'absent' : pt.presence === 'na' ? 'na' : 'present';
          return (
            <div key={pt.id} style={{ display:'flex', alignItems:'center', padding:'5px 0', borderBottom:`1px solid #DFE4E8` }}>
              <div style={{ width:20, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                {pt.isAssemblage
                  ? (sigleUrl
                      ? <img src={sigleUrl} alt="AI" style={{ height:10, width:10, objectFit:'contain' }}/>
                      : <span style={{ fontSize:6, fontWeight:700, color:DA.red }}>AI</span>)
                  : <div style={{ width:4, height:4, borderRadius:'50%', background:'#bbb' }}/>
                }
              </div>
              <div style={{ flex:1, display:'flex', alignItems:'center', minWidth:0 }}>
                <div style={{ flex:'0 0 36%', minWidth:0, paddingRight:8 }}>
                  <div style={{ fontSize:8.5, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:'#000', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.nom}</div>
                  {(pt.poste || pt.entreprise) && <div style={{ fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{[pt.poste, pt.entreprise].filter(Boolean).join(' · ')}</div>}
                </div>
                <div style={{ flex:'0 0 22%', fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.tel || '—'}</div>
                <div style={{ flex:'0 0 28%', fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D', paddingRight:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pt.email || '—'}</div>
                <div style={{ flex:'0 0 14%', textAlign:'right', paddingRight:6 }}>
                  {presState !== 'na' && (
                  <span style={{ fontSize:7.5, fontFamily:"'Open Sans', sans-serif", fontWeight:600,
                    color: presState === 'present' ? '#16A34A' : DA.red,
                    background: presState === 'present' ? '#DCFCE7' : '#FEE2E2',
                    borderRadius:3, padding:'1px 5px' }}>
                    {presState === 'present' ? 'Présent' : 'Absent'}
                  </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <PageFtr pageNum={pageNum} totalPages={totalPages}/>
    </div>
  );
}

// ── Pied de page commun (toutes les pages) ────────────────────────────────────────────
export function PageFtr({ pageNum, totalPages }) {
  return (
    <div style={{ height:FTR, background:'white', borderTop:`1px solid #DFE4E8`, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', padding:`0 ${MX}px`, position:'relative' }}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1.5 }}>
        <span style={{ fontSize:5, fontFamily:"'Open Sans', sans-serif", color:'#c0c4c8', lineHeight:1, textAlign:'center' }}>
          Assemblage Ingénierie · S.A.S. capital social 1 000€ · 137 rue d'Aboukir, 75002 Paris · contact@assemblage.net · www.assemblage.net · +33 7 65 62 30 87
        </span>
        <span style={{ fontSize:5, fontFamily:"'Open Sans', sans-serif", color:'#c0c4c8', lineHeight:1, textAlign:'center' }}>
          NAF 7112B · R.C.S. Paris 822 130 100 · Siret 822 130 100 0032 · n°TVA FR 24 822 130 100
        </span>
      </div>
      <span style={{ position:'absolute', right:MX, fontSize:6, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D' }}>{pageNum} / {totalPages}</span>
    </div>
  );
}

// ── Page conclusion ──────────────────────────────────────────────────────────────────────────
export function ConclusionPage({ conclusion, conclusionAlign = 'left', projet, pageNum, totalPages, onUpdateConclusion, onUpdateConclusionAlign, localisations = [] }) {
  const dateStr = projet.dateVisite ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR') : null;
  const isEditable = !!onUpdateConclusion;
  const ALIGNS = [
    { k:'left', sym:'←' }, { k:'center', sym:'↔' }, { k:'right', sym:'→' }, { k:'justify', sym:'☰' },
  ];

  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState(null);
  const [proposals, setProposals] = useState(null); // null | string[]
  const [applied, setApplied] = useState(new Set()); // indices des points déjà ajoutés
  const [convSyncKey, setConvSyncKey] = useState(0); // force le rafraîchissement de l'éditeur après l'IA
  const convRef = useRef(null);

  // Contexte du rapport pour l'IA. On ÉCARTE les paragraphes de simple présentation/contexte
  // (ex. « présentation du bâtiment ») : inutiles en conclusion, l'IA les répétait.
  const buildContext = () => {
    const meta = [
      projet.adresse ? `Adresse : ${projet.adresse}` : null,
      dateStr ? `Date de visite : ${dateStr}` : null,
    ].filter(Boolean).join('\n');
    const isPresentation = (t) => /pr[ée]sentation|introduction|contexte/i.test(t || '');
    const urg = { haute: 0, moyenne: 0, basse: 0 };
    const zones = (localisations || []).map(loc => {
      const its = (loc.items || []).filter(i => !isBrouillon(i) && (i.titre || i.commentaire) && !isPresentation(i.titre));
      if (!its.length) return null;
      const lines = its.map(i => {
        const u = i.urgence || 'basse'; urg[u] = (urg[u] || 0) + 1;
        const lab = u === 'haute' ? 'URGENT' : u === 'moyenne' ? 'À planifier' : 'Mineur';
        const c = stripMarkup(i.commentaire || '').replace(/\s+/g, ' ').trim().slice(0, 600);
        return `  • [${lab}] ${i.titre || ''}${c ? ` : ${c}` : ''}`;
      }).join('\n');
      return `Zone « ${zoneLabel(localisations, loc) || '(sans nom)'} » :\n${lines}`;
    }).filter(Boolean).join('\n\n');
    const count = urg.haute + urg.moyenne + urg.basse;
    return { meta, zones, urg, count };
  };

  const ask = async (prompt, maxTokens, system) => {
    const d = await callAIProxy({
      feature: 'conclusion', model: 'claude-sonnet-4-6', max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: prompt }],
    });
    return d.content?.[0]?.text?.trim() || '';
  };

  // Parse une liste « 1. … 2. … » (ou puces) en tableau, comme les suggestions de la visite.
  const parseNumbered = (text) => {
    const out = []; let cur = null;
    for (const line of (text || '').split('\n')) {
      const m = line.match(/^\s*(?:\d+[.)]|[-•])\s+(.+)/);
      if (m) { if (cur != null) out.push(cur.trim()); cur = m[1]; }
      else if (cur != null && line.trim()) cur += ' ' + line.trim();
    }
    if (cur != null) out.push(cur.trim());
    return out.length ? out : (text ? [text.trim()] : []);
  };

  const CONCL_SYS = `Tu es ingénieur structure chez Assemblage Ingénierie. Tu rédiges la CONCLUSION d'un rapport de visite, en français.

DÉFINITION à respecter : conclure, c'est terminer le raisonnement en le RÉSUMANT en quelques phrases, voire quelques mots. La conclusion est la partie FINALE et SYNTHÉTIQUE du rapport — pas une ré-exposition.

Règles ABSOLUES :
- SOIS BREF : quelques phrases suffisent. On résume, on ne redéveloppe pas.
- NE répète PAS la présentation/description du bâtiment ou du projet (localisation, « à cheval sur deux bâtiments », typologie…) ni le nom/code de l'affaire : ce n'est pas une conclusion, ne raconte pas la vie.
- Synthétise l'essentiel : l'enjeu/le constat principal, puis la recommandation/les suites à donner.
- Orthographe et grammaire parfaites, ton professionnel.
- INTERDICTION DE STYLE : n'utilise JAMAIS de tiret cadratin ni demi-cadratin (les caractères « — » et « – ») comme ponctuation, c'est une marque d'écriture IA ; emploie une virgule, un deux-points, une parenthèse ou un point.`;

  // SUPER bouton unique : UN SEUL appel IA renvoie la conclusion ET les points d'amélioration
  // (séparés par ===POINTS===). On NE fait PAS deux appels en parallèle : le throttle client
  // (15s/feature) refusait le 2e → « Attends 15s » et rien ne se lançait.
  const generateAll = async () => {
    setAiLoading(true); setAiErr(null); setProposals(null); setApplied(new Set());
    try {
      const { meta, zones, urg, count } = buildContext();
      const base = `${meta}\nObservations (${count} : ${urg.haute} urgentes, ${urg.moyenne} à planifier, ${urg.basse} mineures) :\n${zones}`;
      const prompt = `À partir des éléments ci-dessous, produis EXACTEMENT DEUX sections séparées par une ligne contenant uniquement « ===POINTS=== ».

SECTION 1 — la CONCLUSION, COURTE et SYNTHÉTIQUE (quelques phrases en tout, pas un pavé), en 3 brefs paragraphes séparés par une ligne vide, dans CET ordre :
  1) PROBLÈME PRINCIPAL : 1 à 2 phrases sur l'enjeu central (ce que le client veut faire — typiquement la démolition de cloisons/murs — et notre analyse : porteur ou non, risque). NE décris PAS le bâtiment.
  2) SOLUTION : 1 à 2 phrases sur la méthodologie/solution préconisée (étaiement, vérifications, renforcements…).
  3) CONCLUSION : 1 à 2 phrases de synthèse finale et la recommandation / les suites à donner.
Au total une dizaine de lignes MAXIMUM. Texte rédigé et fluide, professionnel, sans markdown, sans titre, sans liste, sans répéter la présentation du bâtiment.

===POINTS===

SECTION 2 — 4 à 6 POINTS TECHNIQUES qu'on pourrait AJOUTER à la conclusion (précisions structurelles, points de vigilance, réserves, recommandations non triviales). Chaque point : 1 à 2 phrases rédigées, prêtes à coller. Format « 1. … », « 2. … ».

Éléments du rapport :
${base}`;
      const out = await ask(prompt, 1400, CONCL_SYS);
      const parts = out.split(/\n?===\s*POINTS\s*===\n?/i);
      const concl = (parts[0] || '').trim();
      if (concl) { onUpdateConclusion(concl); setConvSyncKey(k => k + 1); }
      setProposals(parseNumbered((parts[1] || '').trim()));
    } catch (e) { setAiErr(e.message || 'Erreur IA'); }
    setAiLoading(false);
  };

  // Ajoute un point d'amélioration À LA FIN de la conclusion (nouveau paragraphe), sans écraser.
  const applyProposal = (txt, i) => {
    const para = `<div>${txt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`;
    const cur = (conclusion || '').trim();
    const next = cur ? `${cur}<div><br></div>${para}` : para;
    onUpdateConclusion(next); setConvSyncKey(k => k + 1);
    setApplied(prev => new Set([...prev, i]));
  };

  // Alignement FIABLE : applique la commande à TOUT le contenu de l'éditeur (execCommand sur le
  // contentEditable = méthode canonique, contrairement au style React qui ne « prenait » pas),
  // persiste le HTML, et met aussi conclusionAlign pour le conteneur du rapport.
  const applyAlign = (k) => {
    onUpdateConclusionAlign?.(k);
    const ed = convRef.current?.getEditor?.();
    if (!ed) return;
    ed.focus();
    const sel = window.getSelection();
    const r = document.createRange(); r.selectNodeContents(ed);
    sel.removeAllRanges(); sel.addRange(r);
    document.execCommand(k === 'center' ? 'justifyCenter' : k === 'right' ? 'justifyRight' : k === 'justify' ? 'justifyFull' : 'justifyLeft');
    sel.removeAllRanges();
    onUpdateConclusion(ed.innerHTML); setConvSyncKey(k2 => k2 + 1);
  };

  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, fontFamily:"'Open Sans', sans-serif", position:'relative', minHeight:PH }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB + FTR}px` }}>
        <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Conclusion</span>
          {isEditable && (
            <div data-print="hide" style={{ display:'flex', alignItems:'center', gap:6, marginLeft:'auto', flexWrap:'wrap', justifyContent:'flex-end' }}>
              {/* SUPER bouton unique : résume tout le rapport (concis, ortho corrigée) + propose
                  des points techniques à ajouter, d'un seul clic. */}
              <button onClick={generateAll} disabled={aiLoading}
                style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 11px', borderRadius:6, border:`1.5px solid ${DA.red}`, background: aiLoading ? DA.grayXL : DA.red, color: aiLoading ? DA.grayL : 'white', fontSize:9, fontWeight:800, cursor: aiLoading ? 'wait' : 'pointer', letterSpacing:'0.03em' }}>
                {aiLoading ? <Ic n="spn" s={10}/> : <Ic n="spk" s={10}/>}
                {aiLoading ? 'Génération…' : 'Générer via IA'}
              </button>
              {onUpdateConclusionAlign && (
                <div style={{ display:'flex', gap:3 }}>
                  {ALIGNS.map(a => (
                    <button key={a.k} onClick={() => applyAlign(a.k)}
                      style={{ width:22, height:22, borderRadius:4, fontSize:11, cursor:'pointer',
                        border:`1.5px solid ${conclusionAlign===a.k ? DA.red : DA.border}`,
                        background: conclusionAlign===a.k ? DA.redL : 'white',
                        color: conclusionAlign===a.k ? DA.red : DA.gray }}>
                      {a.sym}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {aiErr && <div data-print="hide" style={{ fontSize:8, color:DA.red, marginBottom:6, padding:'3px 6px', background:'#FFF0F0', borderRadius:4 }}>{aiErr}</div>}
        {isEditable ? (
          <RichTextArea
            ref={convRef}
            value={conclusion || ''}
            syncKey={convSyncKey}
            onChange={onUpdateConclusion}
            textAlign={conclusionAlign || 'left'}
            placeholder="Saisissez votre conclusion, générez-la via IA ou choisissez une proposition…"
            style={{ width:'100%', fontSize:10, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#000', lineHeight:1.5, border:`1px solid #DFE4E8`, borderRadius:4, padding:'10px 12px', background:'white', boxSizing:'border-box', minHeight:200 }}
          />
        ) : (
          <div style={{ fontSize:10, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#000', lineHeight:1.5, whiteSpace:'pre-wrap', border:`1px solid #DFE4E8`, borderRadius:4, padding:'10px 12px', background:'white', minHeight:60, textAlign: conclusionAlign }}>
            {conclusion ? renderMarkup(conclusion) : <span style={{ color:'#4D4D4D', fontStyle:'italic' }}>Aucune conclusion saisie.</span>}
          </div>
        )}
        {/* Propositions IA — APRÈS le texte : points cliquables à ajouter à la conclusion. */}
        {isEditable && proposals && (
          <div data-print="hide" style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:8, fontWeight:700, color:DA.red, textTransform:'uppercase', letterSpacing:'0.05em' }}>Points d'amélioration — cliquer pour ajouter à la conclusion</span>
              <button onClick={() => setProposals(null)} style={{ marginLeft:'auto', border:'none', background:'none', color:DA.grayL, cursor:'pointer', fontSize:11 }}>✕</button>
            </div>
            {proposals.length === 0 && <div style={{ fontSize:9, color:DA.grayL, fontStyle:'italic' }}>Aucune proposition.</div>}
            {proposals.map((p, i) => (
              <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, border:`1px solid ${applied.has(i) ? '#A7D7B0' : DA.border}`, borderRadius:6, padding:'7px 10px', background: applied.has(i) ? '#EAF7EE' : '#FAFAFA' }}>
                <span style={{ flex:1, fontSize:9.5, lineHeight:1.5, color:'#222' }}>{p}</span>
                <button onClick={() => applyProposal(p, i)} disabled={applied.has(i)}
                  style={{ flexShrink:0, background: applied.has(i) ? '#2E7D32' : DA.red, color:'white', border:'none', borderRadius:5, padding:'4px 10px', fontSize:9, fontWeight:700, cursor: applied.has(i) ? 'default' : 'pointer', opacity: applied.has(i) ? 0.7 : 1 }}>
                  {applied.has(i) ? '✓ Ajouté' : '＋ Ajouter'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ position:'absolute', top:PH - FTR, left:0, right:0 }}>
        <PageFtr pageNum={pageNum} totalPages={totalPages}/>
      </div>
    </div>
  );
}

// ── Tableau récapitulatif ─────────────────────────────────────────────────────────────────────────
// Textarea qui grandit pour afficher TOUT son contenu (zéro scroll, zéro clipping) : la hauteur
// s'ajuste à scrollHeight à chaque rendu et à chaque frappe → la cellule du tableau s'agrandit
// naturellement (grid alignItems:'start'). Évite le clipping des lignes qui s'enroulent
// (un bullet long compte pour 1 « \n » mais occupe 2-3 lignes visuelles).
export function AutoTextarea({ value, style, ...props }) {
  const ref = useRef(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(resize, [value, resize]);
  return (
    <textarea ref={ref} value={value}
      onInput={resize}
      style={{ ...style, overflow:'hidden', resize:'none' }}
      {...props}/>
  );
}

// Tableau récap : lignes générées par l'IA PAR LOTS (cf. TableauRecapPage) ; pause globale après
// un échec (quota épuisé…) pour ne pas relancer des dizaines de requêtes à chaque aperçu.
export const RECAP_BATCH = 15;
export let recapAutoPauseUntil = 0;

export function TableauRecapPage({ localisations, projet, pageNum, totalPages, tableauRecap, recapRows, onUpdateRecap, onDeleteRecap, onAddCustomRow }) {
  const urgOrder = { haute: 0, moyenne: 1, basse: 2 };
  // Use passed recapRows when available (interactive preview), otherwise compute
  const ovMap = new Map((tableauRecap || []).map(r => [r.itemId, r]));
  const rows = recapRows && recapRows.length >= 0 && onUpdateRecap
    ? recapRows
    : localisations.flatMap(loc =>
        (loc.items || []).filter(i => !isBrouillon(i) && i.titre && i.suivi !== 'fait').map(i => {
          const ov = ovMap.get(i.id) || {};
          return { locNom: 'zone' in ov ? ov.zone : zoneLabel(localisations, loc), titre: 'titre' in ov ? ov.titre : (i.titre || ''), urgence: 'urgence' in ov ? ov.urgence : (i.urgence || 'basse'), solution: 'solution' in ov ? ov.solution : '' };
        })
      ).sort((a, b) => (urgOrder[a.urgence] ?? 2) - (urgOrder[b.urgence] ?? 2));

  const [loadingAI, setLoadingAI] = useState(null);
  const [aiErr, setAiErr] = useState(null);
  const genDoneRef = useRef(new Set());
  // Ref toujours à jour : évite la closure stale quand onUpdateRecap change entre deux rows
  const onUpdateRecapRef = useRef(onUpdateRecap);
  onUpdateRecapRef.current = onUpdateRecap;

  // Génère, à partir du commentaire de l'observation, un résumé "Désordre" (problèmes constatés,
  // stocké dans le champ titre) ET un résumé "Solution" (réparation préconisée).
  const genRow = async (row, opts = {}) => {
    const updateFn = onUpdateRecapRef.current;
    if (!updateFn || !row.commentaire) return;
    setLoadingAI(row.itemId); setAiErr(null);
    try {
      const txt = row.commentaire.replace(/<[^>]+>/g, ' ').replace(/\*{1,3}/g, '').replace(/\s+/g, ' ').trim().slice(0, 1500);
      const prompt = `Observation de visite de chantier (zone "${row.locNom}") :\n${txt}\n\nRéponds UNIQUEMENT en JSON valide, sans texte autour : {"desordre":"• désordre 1\\n• désordre 2 (un bullet par problème constaté, 2-3 max)","solution":"• solution 1\\n• solution 2 (un bullet par réparation préconisée, 2-3 max, ou chaîne vide si aucune solution évoquée)"}. En français, factuel, sans ponctuation finale, sans markdown. N'utilise jamais de tiret cadratin ni demi-cadratin (« — » ou « – »).`;
      const d = await callAIProxy({ feature: 'recap_row', _waitOk: opts.waitOk, model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] });
      const raw = (d.content?.[0]?.text || '').replace(/```json\n?|\n?```/g, '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      let obj = null;
      if (jsonMatch) try { obj = JSON.parse(jsonMatch[0]); } catch {}
      if (obj) {
        const desordre = String(obj.desordre ?? '').trim();
        const finalDesordre = desordre || `• ${txt.slice(0, 60).replace(/\s+/g, ' ').trim()}`;
        const patch = {};
        if (finalDesordre) patch.titre = finalDesordre;
        if (obj.solution != null) patch.solution = String(obj.solution).trim();
        if (Object.keys(patch).length) updateFn(row.itemId, patch);
      }
    } catch (e) { setAiErr(e.message); throw e; }
    finally { setLoadingAI(null); }
  };

  // Même chose pour PLUSIEURS lignes en UNE requête (génération automatique) : réponse JSON
  // indexée {"1": {"desordre","solution"}, …}. Une ligne absente de la réponse est simplement
  // laissée vide (le bouton « Regénérer avec IA » de la ligne reste disponible).
  const genRowsBatch = async (batch) => {
    const updateFn = onUpdateRecapRef.current;
    if (!updateFn || !batch.length) return;
    const clean = (c) => String(c || '').replace(/<[^>]+>/g, ' ').replace(/\*{1,3}/g, '').replace(/\s+/g, ' ').trim().slice(0, 900);
    const list = batch.map((row, k) => `[${k + 1}] (zone "${row.locNom}") ${clean(row.commentaire)}`).join('\n');
    const prompt = `Observations de visite de chantier, numérotées :\n${list}\n\nPour CHAQUE observation, résume les désordres constatés et les solutions préconisées. Réponds UNIQUEMENT en JSON valide, sans texte autour : {"1":{"desordre":"• désordre 1\\n• désordre 2 (un bullet par problème constaté, 2-3 max)","solution":"• solution 1\\n• solution 2 (un bullet par réparation préconisée, 2-3 max, ou chaîne vide si aucune solution évoquée)"},"2":{…}}. En français, factuel, sans ponctuation finale, sans markdown. N'utilise jamais de tiret cadratin ni demi-cadratin (« — » ou « – »).`;
    setAiErr(null);
    const d = await callAIProxy({ feature: 'recap_row', _waitOk: true, json: true, model: 'claude-haiku-4-5-20251001', max_tokens: Math.min(4000, 180 * batch.length + 200), messages: [{ role: 'user', content: prompt }] });
    const raw = (d.content?.[0]?.text || '').replace(/```json\n?|\n?```/g, '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let obj = null;
    if (jsonMatch) try { obj = JSON.parse(jsonMatch[0]); } catch { /* réponse illisible : lignes laissées vides */ }
    if (!obj) throw new Error('Réponse IA illisible');
    const entries = [];
    batch.forEach((row, k) => {
      const o = obj[String(k + 1)];
      if (!o || typeof o !== 'object') return;
      const desordre = String(o.desordre ?? '').trim();
      const finalDesordre = desordre || `• ${clean(row.commentaire).slice(0, 60)}`;
      const patch = {};
      if (finalDesordre) patch.titre = finalDesordre;
      if (o.solution != null) patch.solution = String(o.solution).trim();
      if (Object.keys(patch).length) entries.push([row.itemId, patch]);
    });
    if (entries.length) updateFn(entries); // une seule mise à jour pour tout le lot
  };

  // Génération AUTOMATIQUE des lignes avec commentaire mais sans désordre/solution — PAR LOTS.
  // Retour Thomas 21/10 (« plus de crédit sur Gemini ni Mistral ») : avant, UNE requête IA par
  // observation à chaque ouverture de l'aperçu (39 obs = 39 requêtes, relancées à chaque fois si
  // le quota était épuisé) → c'est ce qui vidait les quotas gratuits. Désormais : une requête
  // pour 15 lignes ; en cas d'échec (quota…), pause de 30 min sans réessayer (session).
  // Dépend de rowIdsKey (liste des IDs) et non de rows entier → ne redémarre pas à chaque update
  // de données (ce qui causerait une closure stale sur onUpdateRecap).
  const rowIdsKey = rows.map(r => r.itemId).join(',');
  useEffect(() => {
    if (!onUpdateRecap) return;
    if (Date.now() < recapAutoPauseUntil) return;
    let cancelled = false;
    const snapOvMap = new Map((tableauRecap || []).map(r => [r.itemId, r]));
    const todo = rows.filter((row) => {
      if (!row.commentaire || genDoneRef.current.has(row.itemId)) return false;
      const ov = snapOvMap.get(row.itemId) || {};
      const needsDesordre = !('titre' in ov && String(ov.titre).trim());
      const needsSolution  = !(ov.solution && String(ov.solution).trim());
      genDoneRef.current.add(row.itemId);
      return needsDesordre || needsSolution;
    });
    if (!todo.length) return undefined;
    (async () => {
      for (let i = 0; i < todo.length && !cancelled; i += RECAP_BATCH) {
        const batch = todo.slice(i, i + RECAP_BATCH);
        try { await genRowsBatch(batch); }
        catch {
          batch.forEach(r => genDoneRef.current.delete(r.itemId));
          recapAutoPauseUntil = Date.now() + 30 * 60 * 1000; // quota / panne : on arrête de marteler
          break;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [rowIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dateStr = projet.dateVisite ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR') : null;
  const isEditable = !!onUpdateRecap;

  return (
    <div style={{ width:PW, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, fontFamily:"'Open Sans', sans-serif", position:'relative', minHeight:PH }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ padding:`${MT - HDR}px ${MX}px ${MB + FTR}px` }}>
        <div style={{ borderBottom:`1px solid #B0B8C1`, paddingBottom:5, marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:9, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Tableau récapitulatif</span>
          <span style={{ fontSize:8, fontFamily:"'Open Sans', sans-serif", fontWeight:400, color:'#4D4D4D' }}>{rows.length} point{rows.length !== 1 ? 's' : ''} à traiter</span>
        </div>
        {aiErr && <div data-print="hide" style={{ fontSize:8, color:DA.red, marginBottom:6, padding:'3px 6px', background:'#FFF0F0', borderRadius:4 }}>{aiErr}</div>}
        {/* En-tête */}
        <div style={{ display:'grid', gridTemplateColumns: isEditable ? '5px 1fr 1.2fr 1.8fr 60px 40px' : '5px 70px 1fr 1.5fr 65px', background:'#F2F2F2', borderTop:`1px solid #B0B8C1`, borderBottom:`1px solid #B0B8C1`, padding:'4px 8px', gap:6 }}>
          <div/>
          <span style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Zone</span>
          <span style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Désordre</span>
          <span style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Solution</span>
          <span style={{ fontSize:7, fontFamily:"'Open Sans', sans-serif", fontWeight:600, color:DA.red, textTransform:'uppercase', letterSpacing:'0.06em' }}>Urgence</span>
          {isEditable && <div data-print="hide"/>}
        </div>
        {rows.map((row, i) => {
          const u = URGENCE[row.urgence] || URGENCE.basse;
          return (
            <div key={row.itemId ?? i} style={{ display:'grid', gridTemplateColumns: isEditable ? '5px 1fr 1.2fr 1.8fr 60px 40px' : '5px 70px 1fr 1.5fr 65px', gap:6, padding:'4px 8px', borderBottom:`1px solid #DFE4E8`, background: i % 2 === 0 ? '#F9F9F9' : 'white', alignItems:'start' }}>
              <div style={{ background:u.dot, borderRadius:2, minHeight:14, alignSelf:'stretch' }}/>
              {isEditable ? (
                <AutoTextarea value={row.locNom} onChange={e => onUpdateRecap(row.itemId, 'zone', e.target.value)}
                  style={{ fontSize:7, color:DA.gray, lineHeight:1.4, border:'none', background:'transparent', outline:'none', fontFamily:'inherit', width:'100%', padding:0, whiteSpace:'pre-wrap', wordBreak:'break-word' }}/>
              ) : (
                <div style={{ fontSize:7, color:DA.gray, lineHeight:1.4 }}>{row.locNom || '—'}</div>
              )}
              {isEditable ? (
                <AutoTextarea value={row.titre} onChange={e => onUpdateRecap(row.itemId, 'titre', e.target.value)}
                  style={{ fontSize:8, fontWeight:700, color:DA.black, lineHeight:1.3, border:'none', background:'transparent', outline:'none', fontFamily:'inherit', width:'100%', padding:0, whiteSpace:'pre-wrap', wordBreak:'break-word' }}/>
              ) : (
                <div style={{ fontSize:8, fontWeight:700, color:DA.black, lineHeight:1.3, whiteSpace:'pre-wrap' }}>{row.titre || '—'}</div>
              )}
              {isEditable ? (
                <AutoTextarea value={row.solution || ''} onChange={e => onUpdateRecap(row.itemId, 'solution', e.target.value)}
                  placeholder={loadingAI === row.itemId ? 'Génération IA…' : 'Solution…'}
                  style={{ fontSize:7, color:DA.gray, lineHeight:1.4, border:'none', background:'transparent', outline:'none', fontFamily:'inherit', width:'100%', padding:0, whiteSpace:'pre-wrap', wordBreak:'break-word' }}/>
              ) : (
                <div style={{ fontSize:7, color:DA.gray, lineHeight:1.4, wordBreak:'break-word', whiteSpace:'pre-wrap' }}>{row.solution || '—'}</div>
              )}
              {isEditable ? (
                <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                  {['haute','moyenne','basse'].map(lvl => {
                    const uu = URGENCE[lvl]; const active = row.urgence === lvl;
                    return <button key={lvl} onClick={() => onUpdateRecap(row.itemId, 'urgence', lvl)}
                      style={{ padding:'1px 3px', borderRadius:3, fontSize:6, fontWeight:700, cursor:'pointer', border:`1px solid ${active ? uu.border : DA.border}`, background: active ? uu.bg : 'white', color: active ? uu.text : DA.grayL }}>
                      {uu.label}
                    </button>;
                  })}
                </div>
              ) : (
                <span style={{ fontSize:7, fontWeight:700, color:u.text, background:u.bg, border:`1px solid ${u.border}`, borderRadius:4, padding:'1px 5px', whiteSpace:'nowrap', alignSelf:'start' }}>{u.label}</span>
              )}
              {isEditable && (
                <div data-print="hide" style={{ display:'flex', flexDirection:'column', gap:3, alignSelf:'start' }}>
                  {row.commentaire && (
                    <button title="Regénérer avec IA" onClick={() => { genDoneRef.current.delete(row.itemId); genRow(row); }}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, lineHeight:1, padding:0 }}>✨</button>
                  )}
                  <button onClick={() => onDeleteRecap(row.itemId, row.isCustom)}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'#EF4444', fontSize:13, lineHeight:1, padding:0 }}>×</button>
                </div>
              )}
            </div>
          );
        })}
        {isEditable && (
          <button data-print="hide" onClick={onAddCustomRow}
            style={{ width:'100%', marginTop:4, padding:'5px 0', borderRadius:4, border:`1.5px dashed ${DA.border}`, background:'white', color:DA.grayL, fontSize:9, fontWeight:600, cursor:'pointer' }}>
            + Ajouter une ligne
          </button>
        )}
      </div>
      <div style={{ position:'absolute', top:PH - FTR, left:0, right:0 }}>
        <PageFtr pageNum={pageNum} totalPages={totalPages}/>
      </div>
    </div>
  );
}

// ── Composant principal ─────────────────────────────────────────────────────────────────────────
// ── Pages ANNEXES ────────────────────────────────────────────────────────────────────────
// Page de garde récapitulant les documents joints (demande Thomas : « une page séparative
// marquée annexe avec le nom des docs pour faire le récap »).
export function AnnexRecapPage({ annexes, projet, pageNum, totalPages }) {
  return (
    <A4Card projet={projet} pageNum={pageNum} totalPages={totalPages}>
      <div style={{ textAlign:'center', marginTop:36 }}>
        <div style={{ fontSize:9, fontFamily:"'Inter', sans-serif", fontWeight:800, letterSpacing:'0.22em', color:DA.red, textTransform:'uppercase' }}>Documents joints</div>
        <div style={{ fontSize:30, fontFamily:"'Inter', sans-serif", fontWeight:800, color:'#1a1a1a', margin:'6px 0 0', letterSpacing:'0.04em' }}>ANNEXES</div>
        <div style={{ width:48, height:3, background:DA.red, borderRadius:2, margin:'12px auto 26px' }}/>
      </div>
      <div style={{ maxWidth:440, margin:'0 auto', display:'flex', flexDirection:'column', gap:8 }}>
        {annexes.map((a, i) => (
          <div key={a.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', border:`1px solid #E3E7EB`, borderRadius:8, background:'#FAFBFC' }}>
            <div style={{ width:26, height:26, borderRadius:'50%', background:DA.red, color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, flexShrink:0 }}>{i + 1}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#1a1a1a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.name}</div>
              <div style={{ fontSize:9.5, color:'#8A9199' }}>{Math.max(1, a.pageCount || 1)} page{(a.pageCount || 1) > 1 ? 's' : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </A4Card>
  );
}

// Une page d'annexe = une page du PDF joint, rendue en image et contenue dans la page A4.
export function AnnexImagePage({ img, name, docPage, docTotal, pageNum, totalPages, loading }) {
  return (
    <div style={{ width:PW, height:PH, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, position:'relative', fontFamily:"'Open Sans', sans-serif", overflow:'hidden' }}>
      <div style={{ position:'absolute', left:0, right:0, top:0, bottom:FTR + 4, display:'flex', alignItems:'center', justifyContent:'center', padding:14 }}>
        {img
          ? <img src={img} alt="" data-role="plan" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', display:'block', boxShadow:'0 0 0 1px #E3E7EB' }}/>
          : <div data-print="hide" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, color:'#B4BBC2' }}>
              <Ic n="spn" s={22}/><span style={{ fontSize:11 }}>{loading ? "Rendu de l'annexe…" : 'Annexe indisponible'}</span>
            </div>}
      </div>
      <div style={{ position:'absolute', top:PH - FTR - 12, left:MX, fontSize:7, color:'#8A9199' }}>
        Annexe — {name}{docTotal > 1 ? ` (${docPage}/${docTotal})` : ''}
      </div>
      <div style={{ position:'absolute', top:PH - FTR, left:0, right:0 }}>
        <PageFtr pageNum={pageNum} totalPages={totalPages}/>
      </div>
    </div>
  );
}

// ── PLAN SUR PAGE À PART (A4 PAYSAGE ou PORTRAIT) ─────────────────────────────────────────
// Demande Thomas : chaque plan peut être sorti du texte et mis EN GRAND sur sa propre page en fin
// de rapport, au choix en paysage ou en portrait. Clé du plan : `z:<zone>` (plan de zone),
// `z:<zone>:<i>` (plan supplémentaire de zone), `i:<observation>:<k>` (plan d'observation).
// orientation = 'landscape' | 'portrait'.
export function PlanFullPage({ plan, title, projet, pageNum, totalPages, annotScale, vpNumByPath, orientation, onChange, onOrient = null }) {
  const land = orientation !== 'portrait';
  const W = land ? PH : PW, H = land ? PW : PH;
  const paths = plan.annotations?.paths || [];
  const usedIds = new Set(paths.filter(p => p.type === 'symbol').map(p => p.symbolId));
  const legendSy = getAllSymbols().filter(s => usedIds.has(s.id));
  const hasVp = paths.some(p => p.type === 'viewpoint');
  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite + 'T12:00:00').toLocaleDateString('fr-FR')
    : new Date().toLocaleDateString('fr-FR');
  const btn = (active) => ({ padding:'3px 9px', borderRadius:6, border:`1px solid ${active ? DA.red : DA.border}`, background: active ? DA.red : 'white', color: active ? 'white' : DA.gray, fontSize:9, fontWeight:700, cursor:'pointer' });
  return (
    <div style={{ width:W, height:H, background:'white', boxShadow:'0 2px 20px rgba(0,0,0,0.35)', flexShrink:0, position:'relative', overflow:'hidden', fontFamily:"'Open Sans', sans-serif", display:'flex', flexDirection:'column' }}>
      <HdrBar projet={projet} dateStr={dateStr}/>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0 6px', borderBottom:`2px solid ${DA.red}`, margin:`0 ${MX}px` }}>
        <span style={{ fontSize:9, fontWeight:700, color:'#000', textTransform:'uppercase', letterSpacing:'0.06em' }}>{title}</span>
        {(legendSy.length > 0 || hasVp) && (
          <span style={{ marginLeft:'auto', display:'flex', flexWrap:'wrap', gap:'2px 12px', justifyContent:'flex-end' }}>
            {legendSy.map(s => (
              <span key={s.id} style={{ display:'flex', alignItems:'center', gap:4, fontSize:8, color:'#4D4D4D' }}><SymbolIcon sym={s} size={13}/>{s.label}</span>
            ))}
            {hasVp && <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:8, color:'#4D4D4D' }}><ViewpointIcon size={13}/>Vue photo</span>}
          </span>
        )}
      </div>
      <div style={{ flex:1, minHeight:0, padding:`8px ${MX}px ${FTR + 8}px`, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <SinglePlanImage bg={plan.bg} planId={plan.planId} annotations={plan.annotations} annotScale={annotScale} alt={title} vpNumByPath={vpNumByPath} onOrient={onOrient} fill/>
      </div>
      {onChange && (
        <div data-print="hide" style={{ position:'absolute', top:HDR + 34, right:MX, display:'flex', gap:4, background:'rgba(255,255,255,0.92)', padding:4, borderRadius:8, boxShadow:'0 1px 6px rgba(0,0,0,0.15)' }}>
          <button onClick={() => onChange('landscape')} style={btn(land)}>▭ A4 paysage</button>
          <button onClick={() => onChange('portrait')} style={btn(!land)}>▯ A4 portrait</button>
          <button onClick={() => onChange(null)} title="Remettre ce plan à sa place dans le rapport" style={btn(false)}>↩ Dans le texte</button>
        </div>
      )}
      <div style={{ position:'absolute', top:H - FTR, left:0, right:0 }}>
        <PageFtr pageNum={pageNum} totalPages={totalPages}/>
      </div>
    </div>
  );
}
