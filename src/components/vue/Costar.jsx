import React, { useState, useEffect, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { callAIProxy } from '../../lib/aiProxy.js';
import { buildReportDigest, COSTAR_SYSTEM, parseCostarReply, scoreLabel, EMPTY_REVIEW, COSTAR_LOADING, COSTAR_ERRORS, COSTAR_HELLO, pick, scoreQuip, costarErrorHint, ENGINE_NAMES } from '../../lib/costar.js';

// Costar : castor québécois en casque de chantier (dessin original, SVG) — mascotte qui relit
// le rapport complet et donne un avis honnête + une note. PC uniquement (cf. RapportTab).
// Animations : clignement des yeux au repos, « tortillement » au clic, mâchonnement pendant
// la lecture (classes .costar-* dans styles.css).
export function CostarSvg({ size = 100, className = '' }) {
  return (
    <svg className={className} width={size} height={size * 130 / 120} viewBox="0 0 120 130" aria-hidden="true">
      {/* Queue (derrière) */}
      <g className="costar-tail">
        <ellipse cx="94" cy="108" rx="23" ry="11" transform="rotate(-28 94 108)" fill="#4A2E17"/>
        <path d="M80 104 L106 98 M82 111 L109 104 M86 117 L110 110 M88 98 L96 121 M97 95 L104 117" stroke="#36210F" strokeWidth="1.2" opacity="0.7"/>
      </g>
      {/* Corps */}
      <ellipse cx="58" cy="100" rx="33" ry="27" fill="#8A5A2E"/>
      <ellipse cx="58" cy="106" rx="21" ry="17" fill="#C9935C"/>
      {/* Pattes */}
      <ellipse cx="44" cy="124" rx="9" ry="5" fill="#3B2412"/>
      <ellipse cx="72" cy="124" rx="9" ry="5" fill="#3B2412"/>
      <ellipse cx="40" cy="98" rx="6" ry="8" fill="#6E4521" transform="rotate(20 40 98)"/>
      <ellipse cx="76" cy="98" rx="6" ry="8" fill="#6E4521" transform="rotate(-20 76 98)"/>
      {/* Tête */}
      <g className="costar-head">
        <circle cx="34" cy="50" r="7" fill="#6E4521"/>
        <circle cx="34" cy="50" r="3.5" fill="#3B2412"/>
        <circle cx="82" cy="50" r="7" fill="#6E4521"/>
        <circle cx="82" cy="50" r="3.5" fill="#3B2412"/>
        <circle cx="58" cy="60" r="29" fill="#9A6634"/>
        {/* Joues */}
        <ellipse cx="41" cy="75" rx="5" ry="3.5" fill="#E8907A" opacity="0.45"/>
        <ellipse cx="75" cy="75" rx="5" ry="3.5" fill="#E8907A" opacity="0.45"/>
        {/* Yeux */}
        <g className="costar-eyes">
          <circle cx="47" cy="63" r="5.2" fill="#1A1410"/>
          <circle cx="69" cy="63" r="5.2" fill="#1A1410"/>
          <circle cx="48.8" cy="61.2" r="1.8" fill="white"/>
          <circle cx="70.8" cy="61.2" r="1.8" fill="white"/>
        </g>
        {/* Museau */}
        <ellipse cx="58" cy="78" rx="15" ry="10.5" fill="#DDAA78"/>
        <ellipse cx="58" cy="71.5" rx="6.2" ry="4.3" fill="#2A1A0F"/>
        <ellipse cx="56.2" cy="70.4" rx="1.8" ry="1" fill="white" opacity="0.5"/>
        <path d="M58 76 L58 79 M52 79 Q58 83 64 79" stroke="#2A1A0F" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
        {/* Dents */}
        <g className="costar-teeth">
          <rect x="53.4" y="80.5" width="9.2" height="9" rx="2" fill="white" stroke="#E7E1D8" strokeWidth="0.8"/>
          <line x1="58" y1="80.8" x2="58" y2="89.2" stroke="#D9D2C7" strokeWidth="0.8"/>
        </g>
        {/* Moustaches */}
        <path d="M44 79 L32 77 M44 82 L33 84 M72 79 L84 77 M72 82 L83 84" stroke="#F3E3CF" strokeWidth="0.9" strokeLinecap="round" opacity="0.8"/>
        {/* Casque de chantier */}
        <path d="M30 49 Q31 21 58 19 Q85 21 86 49 Z" fill="#F97316"/>
        <path d="M54 20 Q58 18.6 62 20 L62 47 L54 47 Z" fill="#FB923C"/>
        <path d="M36 42 Q37 27 49 23" stroke="#FFD2A8" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.7"/>
        <rect x="22" y="45" width="72" height="8" rx="4" fill="#EA580C"/>
        {/* Écusson feuille d'érable */}
        <circle cx="72" cy="36" r="6.4" fill="white"/>
        <polygon transform="translate(72 36.4) scale(0.95)" fill="#D52B1E"
          points="0,-5 1.2,-2.6 2.6,-3.2 2.1,-0.6 4.6,-1.4 3.8,0.4 5,1 2.4,2.2 2.8,3.2 0.4,2.6 0.4,5 -0.4,5 -0.4,2.6 -2.8,3.2 -2.4,2.2 -5,1 -3.8,0.4 -4.6,-1.4 -2.1,-0.6 -2.6,-3.2 -1.2,-2.6"/>
      </g>
    </svg>
  );
}

function Section({ title, color, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }}/>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 17, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((t, i) => <li key={i} style={{ fontSize: 12.5, lineHeight: 1.45, color: DA.black }}>{t}</li>)}
      </ul>
    </div>
  );
}

// fixed = position fixe dans la fenêtre (onglet Visite, qui défile) ; sinon ancré au conteneur
// (onglet Rapport). Costar est réservé au PC : masqué sous 900 px de large.
export default function Costar({ projet, fixed = false }) {
  const [isPc, setIsPc] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 900);
  useEffect(() => {
    const onResize = () => setIsPc(window.innerWidth >= 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [hello] = useState(() => pick(COSTAR_HELLO));
  const [loadMsg, setLoadMsg] = useState(COSTAR_LOADING[0]);
  const [errMsg, setErrMsg] = useState(COSTAR_ERRORS[0]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [review, setReview] = useState(null);
  const [quip, setQuip] = useState('');
  const [engine, setEngine] = useState(null); // { provider, from, why } : moteur qui a VRAIMENT répondu
  const [error, setError] = useState(null);
  const [wiggle, setWiggle] = useState(false);
  const abortRef = useRef(null);
  const projetRef = useRef(projet);
  projetRef.current = projet;

  useEffect(() => () => abortRef.current?.abort(), []);
  // Pendant la lecture : 3 petites phrases AU PLUS, espacées de 7 s (retour Thomas : « il en
  // dit 15, deux ou trois suffisent »). Après la 3e, il se tait jusqu'à la réponse.
  useEffect(() => {
    if (status !== 'loading') return;
    setLoadMsg(pick(COSTAR_LOADING));
    let shown = 1;
    const t = setInterval(() => {
      setLoadMsg(m => { let n = m; while (n === m && COSTAR_LOADING.length > 1) n = pick(COSTAR_LOADING); return n; });
      if (++shown >= 3) clearInterval(t);
    }, 7000);
    return () => clearInterval(t);
  }, [status]);

  const ask = async () => {
    setWiggle(false);
    requestAnimationFrame(() => setWiggle(true));
    setTimeout(() => setWiggle(false), 900);
    setOpen(true);
    if (status === 'loading') return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setReview(null);
    setEngine(null);

    const digest = buildReportDigest(projetRef.current);
    if (digest.observations === 0) { setReview(EMPTY_REVIEW); setQuip(scoreQuip(0)); setStatus('done'); return; }

    setStatus('loading');
    try {
      const d = await callAIProxy({
        feature: 'costar',
        model: 'claude-sonnet-4-6',
        modelFor: { mistral: 'mistral-medium-latest' }, // relecture fine : Medium plutôt que Small
        // Pas de « réflexion » Gemini : elle doublait le temps de réponse et faisait dépasser le
        // délai quand Gemini est chargé (« Gemini ne répond pas ») ; la consigne détaillée suffit.
        max_tokens: 4096,
        temperature: 0.1, // même rapport → même note (pas de loterie d'un essai à l'autre)
        json: true,
        system: COSTAR_SYSTEM,
        messages: [{ role: 'user', content: `Voici les textes de mon rapport (${digest.observations} observations, ${digest.zones} zones). Lis tout, puis juge le fond.\n\n${digest.text}` }],
        _waitOk: true,
        _signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      const raw = (d.content || []).map(c => c?.text || '').join('');
      const parsed = parseCostarReply(raw, digest.text); // points sans citation exacte = annulés
      if (!parsed) throw new Error(d._finish === 'MAX_TOKENS' ? 'Réponse coupée, réessaie' : 'Réponse illisible, réessaie');
      setReview(parsed);
      setQuip(scoreQuip(parsed.note));
      setEngine(d._provider ? { provider: d._provider, from: d._fallbackFrom || null, why: d._fallbackWhy || null } : null);
      setStatus('done');
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e.message || 'Erreur de connexion');
      setErrMsg(pick(COSTAR_ERRORS));
      setStatus('error');
    }
  };

  const close = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    if (status === 'loading') setStatus('idle');
  };

  const sc = review ? scoreLabel(review.note) : null;
  const loading = status === 'loading';
  if (!isPc) return null;

  return (
    <div style={{ position: fixed ? 'fixed' : 'absolute', right: 26, bottom: fixed ? 18 : 14, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'none' }}>
      {open && (
        <div className="costar-bubble" role="dialog" aria-label="Avis de Costar"
          style={{ pointerEvents: 'auto', position: 'relative', width: 370, marginBottom: 14 }}>
          {/* Pointe de la bulle de dialogue, vers Costar */}
          <span aria-hidden="true" style={{ position: 'absolute', right: 38, bottom: -8, width: 18, height: 18, background: 'white', borderRight: `1px solid ${DA.border}`, borderBottom: `1px solid ${DA.border}`, transform: 'rotate(45deg)', boxShadow: '4px 4px 10px rgba(0,0,0,0.08)' }}/>
          <div style={{ position: 'relative', maxHeight: '62vh', overflowY: 'auto', background: 'white', borderRadius: 16, border: `1px solid ${DA.border}`, boxShadow: '0 12px 40px rgba(0,0,0,0.22)', padding: '14px 16px' }}>
          <button onClick={close} aria-label="Fermer" title="Fermer"
            style={{ position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: '50%', border: 'none', background: '#F3F4F6', color: DA.gray, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
          <div style={{ marginBottom: 6, paddingRight: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: DA.grayL, textTransform: 'uppercase', letterSpacing: 0.6 }}>Costar</div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: DA.grayL, marginTop: 1 }}>Ingénieur Senior chez Assemblage Ingénierie</div>
          </div>

          {loading && (
            <div style={{ fontSize: 13, color: DA.black, lineHeight: 1.5, paddingRight: 22 }}>
              {loadMsg}<span className="costar-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
          )}

          {status === 'error' && (
            <div style={{ fontSize: 13, color: DA.black, lineHeight: 1.5, paddingRight: 22 }}>
              {errMsg}… j'ai pas réussi à lire ton rapport.
              {costarErrorHint(error) && <div style={{ marginTop: 6 }}>{costarErrorHint(error)}</div>}
              <div style={{ marginTop: 6, fontSize: 11, color: DA.grayL, lineHeight: 1.4 }}>Détail : {error}</div>
              <div><button onClick={ask} style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: DA.red, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>Réessayer</button></div>
            </div>
          )}

          {status === 'done' && review && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 22 }}>
                <div style={{ fontSize: 26, fontWeight: 900, color: sc.color, lineHeight: 1, flexShrink: 0 }}>
                  {review.note}<span style={{ fontSize: 15, fontWeight: 800, opacity: 0.7 }}>/10</span>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: sc.color, background: sc.bg, borderRadius: 20, padding: '4px 10px', whiteSpace: 'nowrap' }}>{sc.label}</span>
              </div>
              {quip && <div style={{ marginTop: 4, fontSize: 11.5, color: DA.gray }}>{quip}</div>}
              {review.verdict && (
                <p style={{ margin: '8px 0 0', fontSize: 13.5, fontWeight: 600, fontStyle: 'italic', color: DA.black, lineHeight: 1.4 }}>« {review.verdict} »</p>
              )}
              {review.pertes?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, color: '#B91C1C', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#B91C1C', flexShrink: 0 }}/>
                    Où je t'ai enlevé des points
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {review.pertes.map((x, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5, lineHeight: 1.45, color: DA.black }}>
                        <span style={{ flexShrink: 0, minWidth: 26, textAlign: 'center', fontWeight: 900, fontSize: 12, color: '#B91C1C', background: '#FEE2E2', borderRadius: 6, padding: '0 4px' }}>−{x.points}</span>
                        <span>{x.raison}{x.citation && <span style={{ display: 'block', fontSize: 11.5, fontStyle: 'italic', color: DA.grayL }}>« {x.citation} »</span>}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Section title="Ce qui est bien" color="#15803D" items={review.bien}/>
              <Section title="Suggestions (sans pénalité)" color="#C2410C" items={review.ameliorer}/>
              <Section title="Ce qui coince" color="#B91C1C" items={review.coince}/>
              {review.priorite && (
                <div style={{ marginTop: 10, padding: '8px 10px', background: '#FEF2F2', borderRadius: 10, fontSize: 12.5, color: DA.black, lineHeight: 1.45 }}>
                  <span style={{ fontWeight: 800, color: '#B91C1C' }}>Avant d'envoyer : </span>{review.priorite}
                </div>
              )}
              {review.reecriture && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1D4ED8', flexShrink: 0 }}/>
                    Je l'aurais écrit comme ça{review.reecriture.obs ? ` (${review.reecriture.obs})` : ''}
                  </div>
                  {review.reecriture.avant && <div style={{ fontSize: 12, color: DA.grayL, textDecoration: 'line-through', lineHeight: 1.4 }}>{review.reecriture.avant}</div>}
                  <div style={{ marginTop: 3, fontSize: 12.5, color: DA.black, lineHeight: 1.45, background: '#EFF6FF', borderRadius: 8, padding: '6px 8px' }}>{review.reecriture.apres}</div>
                </div>
              )}
              {review.blague && (
                <p style={{ margin: '12px 0 0', padding: '8px 10px', background: '#FFF7ED', borderRadius: 10, fontSize: 12.5, color: '#9A3412', lineHeight: 1.45 }}>
                  🦫 {review.blague}
                </p>
              )}
              {engine && (
                <div style={{ marginTop: 10, fontSize: 10.5, color: DA.grayL, lineHeight: 1.4 }}>
                  {engine.from
                    ? <>{ENGINE_NAMES[engine.from] || engine.from} indisponible{engine.why ? ` (${engine.why})` : ''} : relu avec {ENGINE_NAMES[engine.provider] || engine.provider}.</>
                    : <>Relu avec {ENGINE_NAMES[engine.provider] || engine.provider}.</>}
                </div>
              )}
              <button onClick={ask}
                style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: DA.gray, background: 'white', border: `1px solid ${DA.border}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
                Relire mon rapport
              </button>
            </>
          )}
          </div>
        </div>
      )}

      {!open && (
        <div className="costar-label" style={{ pointerEvents: 'none', marginBottom: 4, marginRight: 4, background: DA.black, color: 'white', fontSize: 12, fontWeight: 800, borderRadius: 20, padding: '5px 12px', boxShadow: '0 4px 14px rgba(0,0,0,0.2)', whiteSpace: 'nowrap' }}>
          Ask Costar
        </div>
      )}
      <button onClick={open && !loading ? close : ask} title={open ? 'Fermer' : hello}
        aria-label="Ask Costar : avis sur le rapport"
        style={{ pointerEvents: 'auto', background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0, filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.25))' }}>
        <CostarSvg className={`costar${wiggle ? ' costar-wiggle' : ''}${loading ? ' costar-busy' : ''}`}/>
      </button>
    </div>
  );
}
