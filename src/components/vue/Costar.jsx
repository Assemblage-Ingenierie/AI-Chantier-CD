import React, { useState, useEffect, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { callAIProxy } from '../../lib/aiProxy.js';
import { buildReportDigest, COSTAR_SYSTEM, parseCostarReply, scoreLabel, EMPTY_REVIEW, COSTAR_LOADING, COSTAR_ERRORS, COSTAR_HELLO, pick, scoreQuip, costarErrorHint, ENGINE_NAMES } from '../../lib/costar.js';
import { MISSIONS, COSMETICS, CATEGORIES, CHANGE_EVENT, applyReview, toggleEquip, unlockedIds, loadCostarState, saveCostarState } from '../../lib/costarRewards.js';

// Progression du vestiaire (lib/costarRewards.js), partagée en direct entre les Costar affichés.
function useCostarState() {
  const [st, setSt] = useState(loadCostarState);
  useEffect(() => {
    const on = () => setSt(loadCostarState());
    window.addEventListener(CHANGE_EVENT, on);
    return () => window.removeEventListener(CHANGE_EVENT, on);
  }, []);
  return st;
}

// Costar : castor québécois en casque de chantier (dessin original, SVG) — mascotte qui relit
// le rapport complet et donne un avis honnête + une note. PC uniquement (cf. RapportTab).
// Animations : clignement des yeux au repos, « tortillement » au clic, mâchonnement pendant
// la lecture (classes .costar-* dans styles.css).
// outfit = { head, eyes, neck, body, hand, extra } : cosmétiques portés, un par catégorie (vestiaire).
export function CostarSvg({ size = 100, className = '', outfit = {} }) {
  const o = outfit || {};
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
      {o.body === 'gilet' && (
        <g>
          <path d="M27 90 Q25 111 42 124 L47 109 L45 82 Z" fill="#FACC15" stroke="#CA8A04" strokeWidth="0.8"/>
          <path d="M89 90 Q91 111 74 124 L69 109 L71 82 Z" fill="#FACC15" stroke="#CA8A04" strokeWidth="0.8"/>
          <path d="M28 104 L46 101 M88 104 L70 101" stroke="#D1D5DB" strokeWidth="3.2" strokeLinecap="round"/>
          <path d="M31 113 L46 112 M85 113 L70 112" stroke="#D1D5DB" strokeWidth="2.6" strokeLinecap="round"/>
        </g>
      )}
      {/* Pattes */}
      <ellipse cx="44" cy="124" rx="9" ry="5" fill="#3B2412"/>
      <ellipse cx="72" cy="124" rx="9" ry="5" fill="#3B2412"/>
      <ellipse cx="40" cy="98" rx="6" ry="8" fill="#6E4521" transform="rotate(20 40 98)"/>
      <ellipse cx="76" cy="98" rx="6" ry="8" fill="#6E4521" transform="rotate(-20 76 98)"/>
      {o.hand === 'cafe' && (
        <g>
          <path d="M84 80 q-2 -3 0 -6 M88 80 q-2 -3 0 -6" stroke="#9CA3AF" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.8"/>
          <path d="M92 87 q5 0 5 4.5 q0 4.5 -5 4.5" stroke="#DC2626" strokeWidth="2" fill="none"/>
          <rect x="79" y="83" width="14" height="15" rx="2.5" fill="#DC2626"/>
          <ellipse cx="86" cy="83.6" rx="6.3" ry="1.6" fill="#5B3A1E"/>
          <rect x="81" y="89" width="10" height="3" rx="1" fill="white" opacity="0.85"/>
          <ellipse cx="80" cy="93" rx="4.5" ry="5.5" fill="#6E4521"/>
        </g>
      )}
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
        {/* Lunettes / monocle / pansement (vestiaire) — hors du groupe des yeux : ne clignent pas */}
        {o.eyes === 'lunettes' && (
          <g>
            <path d="M39 61 L30 58 M77 61 L86 58" stroke="#111" strokeWidth="1.6" strokeLinecap="round"/>
            <rect x="38.5" y="57.5" width="17" height="11" rx="4.5" fill="#111"/>
            <rect x="60.5" y="57.5" width="17" height="11" rx="4.5" fill="#111"/>
            <path d="M55.5 61.5 Q58 59.5 60.5 61.5" stroke="#111" strokeWidth="2" fill="none"/>
            <path d="M41.5 60.5 L46 60.5 M63.5 60.5 L68 60.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" opacity="0.55"/>
          </g>
        )}
        {o.eyes === 'monocle' && (
          <g>
            <path d="M76.5 66 Q84 78 76 92" stroke="#CA8A04" strokeWidth="1" fill="none" strokeDasharray="1.6 1.4"/>
            <circle cx="69" cy="63" r="8" fill="white" fillOpacity="0.18" stroke="#CA8A04" strokeWidth="2.2"/>
          </g>
        )}
        {o.extra === 'pansement' && (
          <g transform="rotate(-24 40 71)">
            <rect x="32" y="68" width="16" height="6" rx="3" fill="#F5D0A9" stroke="#D6A77A" strokeWidth="0.8"/>
            <rect x="37.5" y="68.4" width="5" height="5.2" fill="#EBC097"/>
            <circle cx="34.8" cy="71" r="0.5" fill="#C08A5B"/><circle cx="45.2" cy="71" r="0.5" fill="#C08A5B"/>
          </g>
        )}
        {/* Coiffe : casque de chantier (défaut), casque en or, tuque ou couronne (vestiaire) */}
        {o.head === 'cowboy' ? (
          <g>
            <path d="M14 47 Q20 55 58 54 Q96 55 102 47 Q96 51 58 50 Q20 51 14 47 Z" fill="#6B3F1D"/>
            <path d="M14 47 Q12 41 18 40 Q24 46 58 46 Q92 46 98 40 Q104 41 102 47 Q96 51 58 50 Q20 51 14 47 Z" fill="#8B5A2B"/>
            <path d="M36 46 Q33 22 45 18 Q51 24 58 20 Q65 24 71 18 Q83 22 80 46 Z" fill="#A0652F"/>
            <path d="M51 22 Q58 27 65 22" stroke="#7A4A20" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
            <path d="M35.5 38 Q58 42 80.5 38 L80.2 44 Q58 48 35.8 44 Z" fill="#3F2A14"/>
            <polygon transform="translate(58 41.6) scale(0.55)" fill="#FACC15" points="0,-5 1.5,-1.6 5,-1.5 2.3,0.8 3.1,4.5 0,2.4 -3.1,4.5 -2.3,0.8 -5,-1.5 -1.5,-1.6"/>
          </g>
        ) : o.head === 'tuque' ? (
          <g>
            <path d="M30 50 Q30 17 58 15 Q86 17 86 50 Z" fill="#C8102E"/>
            <path d="M40 22 L44 46 M50 17 L51 46 M66 17 L65 46 M76 22 L72 46" stroke="#A50D25" strokeWidth="1.4" opacity="0.6"/>
            <rect x="27" y="41" width="62" height="12" rx="6" fill="white"/>
            <path d="M33 47 L83 47" stroke="#C8102E" strokeWidth="2.2" strokeDasharray="4 3"/>
            <circle cx="58" cy="12" r="8.5" fill="white" stroke="#E5E7EB" strokeWidth="0.8"/>
            <circle cx="55" cy="9.5" r="2.4" fill="#F9FAFB"/>
          </g>
        ) : o.head === 'couronne' ? (
          <g>
            <polygon points="36,44 34,20 45,30 51,15 58,27 65,15 71,30 82,20 80,44" fill="#FACC15" stroke="#CA8A04" strokeWidth="1.2" strokeLinejoin="round"/>
            <rect x="34" y="38" width="48" height="8" rx="2.5" fill="#EAB308" stroke="#CA8A04" strokeWidth="1"/>
            <circle cx="46" cy="42" r="2.2" fill="#DC2626"/><circle cx="58" cy="42" r="2.6" fill="#2563EB"/><circle cx="70" cy="42" r="2.2" fill="#16A34A"/>
            <circle cx="34" cy="20" r="2" fill="#FDE047"/><circle cx="51" cy="15" r="2" fill="#FDE047"/><circle cx="65" cy="15" r="2" fill="#FDE047"/><circle cx="82" cy="20" r="2" fill="#FDE047"/>
          </g>
        ) : (
          <g>
            <path d="M30 49 Q31 21 58 19 Q85 21 86 49 Z" fill={o.head === 'casque_or' ? '#EAB308' : '#F97316'}/>
            <path d="M54 20 Q58 18.6 62 20 L62 47 L54 47 Z" fill={o.head === 'casque_or' ? '#FACC15' : '#FB923C'}/>
            <path d="M36 42 Q37 27 49 23" stroke={o.head === 'casque_or' ? '#FEF9C3' : '#FFD2A8'} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.7"/>
            <rect x="22" y="45" width="72" height="8" rx="4" fill={o.head === 'casque_or' ? '#CA8A04' : '#EA580C'}/>
            {/* Écusson feuille d'érable */}
            <circle cx="72" cy="36" r="6.4" fill="white"/>
            <polygon transform="translate(72 36.4) scale(0.95)" fill="#D52B1E"
              points="0,-5 1.2,-2.6 2.6,-3.2 2.1,-0.6 4.6,-1.4 3.8,0.4 5,1 2.4,2.2 2.8,3.2 0.4,2.6 0.4,5 -0.4,5 -0.4,2.6 -2.8,3.2 -2.4,2.2 -5,1 -3.8,0.4 -4.6,-1.4 -2.1,-0.6 -2.6,-3.2 -1.2,-2.6"/>
            {o.head === 'casque_or' && <path d="M40 30 l1.2 -3 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 Z" fill="white" opacity="0.9"/>}
          </g>
        )}
        {o.extra === 'lampe' && (
          <g>
            <circle cx="58" cy="37" r="11" fill="#FEF08A" opacity="0.35"/>
            <rect x="51" y="32" width="14" height="10" rx="3" fill="#374151"/>
            <circle cx="58" cy="37" r="3.6" fill="#FDE047" stroke="#FEF9C3" strokeWidth="1"/>
          </g>
        )}
        {/* Cou : nœud papillon ou écharpe (vestiaire) */}
        {o.neck === 'noeud' && (
          <g>
            <polygon points="58,92 46,85.5 46,98.5" fill="#B91C1C" stroke="#7F1D1D" strokeWidth="0.8" strokeLinejoin="round"/>
            <polygon points="58,92 70,85.5 70,98.5" fill="#B91C1C" stroke="#7F1D1D" strokeWidth="0.8" strokeLinejoin="round"/>
            <circle cx="58" cy="92" r="3.2" fill="#7F1D1D"/>
          </g>
        )}
        {o.neck === 'echarpe' && (
          <g>
            <path d="M68 90 L72 112 L80 110 L75 89 Z" fill="#DC2626"/>
            <path d="M72.5 104 L79 102.5 M73.5 108 L79.8 106.5" stroke="white" strokeWidth="1.3"/>
            <path d="M33 86 Q58 98 83 86 L83 92 Q58 104 33 92 Z" fill="#DC2626"/>
            <path d="M40 92 Q58 100 76 92" stroke="white" strokeWidth="1.3" fill="none"/>
          </g>
        )}
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
  // Vestiaire (engrenage à côté de « Ask Costar ») + missions accomplies à la dernière relecture.
  const cst = useCostarState();
  const [wardrobe, setWardrobe] = useState(false);
  const [unlocks, setUnlocks] = useState([]);
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
    setWardrobe(false);
    if (status === 'loading') return;
    setUnlocks([]);
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
      // Missions du vestiaire : best-effort, ne doit JAMAIS gêner l'affichage de l'avis.
      try {
        const pj = projetRef.current || {};
        const r = applyReview(loadCostarState(), { note: parsed.note, observations: digest.observations, projectId: pj.id || null, reportId: pj.id ? `${pj.id}|${pj.dateVisite || ''}` : null });
        saveCostarState(r.state);
        setUnlocks(r.completed);
      } catch { /* vestiaire indisponible : sans effet sur la relecture */ }
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

  const toggleWardrobe = () => {
    if (wardrobe) { setWardrobe(false); return; }
    if (open) close();
    setWardrobe(true);
    if (cst.unseen.length) saveCostarState({ ...cst, unseen: [] }); // pastille « nouveau » vue
  };
  const unlocked = new Set(unlockedIds(cst.stats));
  const doneCount = MISSIONS.filter(m => unlocked.has(m.reward)).length;

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
              {unlocks.length > 0 && (
                <button onClick={toggleWardrobe} className="costar-unlock"
                  style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 8, padding: '8px 10px', background: 'linear-gradient(90deg,#FEF3C7,#FDE68A)', border: '1px solid #FCD34D', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {unlocks.map(m => (
                    <div key={m.id} style={{ fontSize: 12.5, color: '#78350F', lineHeight: 1.45 }}>
                      🎉 <strong>Mission « {m.title} » réussie !</strong> Nouveau : {COSMETICS[m.reward].icon} {COSMETICS[m.reward].name} (déjà sur moi)
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: '#92400E', marginTop: 2, textDecoration: 'underline' }}>Voir le vestiaire</div>
                </button>
              )}
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

      {wardrobe && (
        <div className="costar-bubble" role="dialog" aria-label="Vestiaire de Costar"
          style={{ pointerEvents: 'auto', position: 'relative', width: 370, marginBottom: 14 }}>
          <span aria-hidden="true" style={{ position: 'absolute', right: 38, bottom: -8, width: 18, height: 18, background: 'white', borderRight: `1px solid ${DA.border}`, borderBottom: `1px solid ${DA.border}`, transform: 'rotate(45deg)', boxShadow: '4px 4px 10px rgba(0,0,0,0.08)' }}/>
          <div style={{ position: 'relative', maxHeight: '62vh', overflowY: 'auto', background: 'white', borderRadius: 16, border: `1px solid ${DA.border}`, boxShadow: '0 12px 40px rgba(0,0,0,0.22)', padding: '14px 16px' }}>
            <button onClick={() => setWardrobe(false)} aria-label="Fermer" title="Fermer"
              style={{ position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: '50%', border: 'none', background: '#F3F4F6', color: DA.gray, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
            <div style={{ paddingRight: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: DA.grayL, textTransform: 'uppercase', letterSpacing: 0.6 }}>Vestiaire de Costar</div>
              <div style={{ fontSize: 12, color: DA.gray, marginTop: 2, lineHeight: 1.4 }}>
                Accomplis des missions pour débloquer des objets. Un objet par catégorie, cumulable : chapeau + lunettes + tenue…
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#F3F4F6', overflow: 'hidden' }}>
                  <div style={{ width: `${(doneCount / MISSIONS.length) * 100}%`, height: '100%', background: '#F97316', borderRadius: 3, transition: 'width 0.3s' }}/>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: DA.gray, whiteSpace: 'nowrap' }}>{doneCount}/{MISSIONS.length} missions</span>
              </div>
            </div>
            {/* INVENTAIRE : une ligne par catégorie, un objet porté par catégorie (cumulable entre
                catégories). Clic sur l'objet porté = l'enlever. Cadenas = mission à accomplir. */}
            <div style={{ fontSize: 10.5, fontWeight: 800, color: DA.grayL, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12, marginBottom: 6 }}>Inventaire</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {CATEGORIES.map(cat => {
                const items = Object.entries(COSMETICS).filter(([, c]) => c.slot === cat.slot);
                if (!items.length) return null;
                const cur = cst.equipped[cat.slot];
                return (
                  <div key={cat.slot} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 74, flexShrink: 0, fontSize: 11.5, fontWeight: 800, color: DA.gray }}>{cat.label}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
                      {items.map(([id, c]) => {
                        const got = unlocked.has(id);
                        const worn = cur === id;
                        const mission = MISSIONS.find(m => m.reward === id);
                        return (
                          <button key={id} type="button" disabled={!got}
                            onClick={() => saveCostarState(toggleEquip(cst, id))}
                            title={got ? `${c.name} : ${worn ? 'cliquer pour enlever' : 'cliquer pour porter'}` : `${c.name} : verrouillé. Mission « ${mission?.title} » : ${mission?.desc}`}
                            aria-pressed={worn}
                            style={{ width: 40, height: 40, borderRadius: 10, padding: 0, fontSize: 20, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              border: `2px solid ${worn ? '#F97316' : got ? DA.border : '#EEEEEE'}`, background: worn ? '#FFF7ED' : got ? 'white' : '#FAFAFA',
                              cursor: got ? 'pointer' : 'default', boxShadow: worn ? '0 0 0 3px rgba(249,115,22,0.15)' : 'none' }}>
                            <span style={{ filter: got ? 'none' : 'grayscale(1)', opacity: got ? 1 : 0.55 }}>{got ? c.icon : '🔒'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* MISSIONS : ce qu'il reste à faire, et ce que ça débloque. */}
            <div style={{ fontSize: 10.5, fontWeight: 800, color: DA.grayL, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 6 }}>Missions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {MISSIONS.map(m => {
                const c = COSMETICS[m.reward];
                const got = unlocked.has(m.reward);
                const [cur, max] = m.progress(cst.stats);
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 9px', borderRadius: 10, border: `1px solid ${got ? '#BBF7D0' : DA.border}`, background: got ? '#F0FDF4' : 'white' }}>
                    <span style={{ fontSize: 17, width: 22, textAlign: 'center', flexShrink: 0 }}>{got ? '✅' : c.icon}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: DA.black }}>{m.title}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: DA.grayL, lineHeight: 1.35 }}>{m.desc} → <strong style={{ color: got ? '#15803D' : '#C2410C' }}>{c.name}</strong></span>
                      {!got && max > 1 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                          <span style={{ flex: 1, height: 4, borderRadius: 2, background: '#EEE', overflow: 'hidden' }}>
                            <span style={{ display: 'block', width: `${(cur / max) * 100}%`, height: '100%', background: '#FDBA74' }}/>
                          </span>
                          <span style={{ fontSize: 10.5, color: DA.grayL, fontWeight: 700 }}>{cur}/{max}</span>
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, marginRight: 4 }}>
        {!open && !wardrobe && (
          <div className="costar-label" style={{ pointerEvents: 'none', background: DA.black, color: 'white', fontSize: 12, fontWeight: 800, borderRadius: 20, padding: '5px 12px', boxShadow: '0 4px 14px rgba(0,0,0,0.2)', whiteSpace: 'nowrap' }}>
            Ask Costar
          </div>
        )}
        <button type="button" onClick={toggleWardrobe} aria-label="Vestiaire de Costar" title="Vestiaire de Costar (missions et cosmétiques)"
          style={{ pointerEvents: 'auto', position: 'relative', width: 27, height: 27, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
            background: wardrobe ? '#F97316' : DA.black, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.2)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          {cst.unseen.length > 0 && !wardrobe && <span aria-hidden="true" style={{ position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: '50%', background: '#DC2626', border: '2px solid white' }}/>}
        </button>
      </div>
      <button onClick={open && !loading ? close : ask} title={open ? 'Fermer' : hello}
        aria-label="Ask Costar : avis sur le rapport"
        style={{ pointerEvents: 'auto', background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0, filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.25))' }}>
        <CostarSvg outfit={cst.equipped} className={`costar${wiggle ? ' costar-wiggle' : ''}${loading ? ' costar-busy' : ''}`}/>
      </button>
    </div>
  );
}
