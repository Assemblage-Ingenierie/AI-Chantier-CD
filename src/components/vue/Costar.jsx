import React, { useState, useEffect, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { callAIProxy, getAIProvider } from '../../lib/aiProxy.js';
import { buildReportDigest, COSTAR_SYSTEM, parseCostarReply, scoreLabel, EMPTY_REVIEW, COSTAR_LOADING, COSTAR_ERRORS, COSTAR_HELLO, pick, scoreQuip, costarErrorHint, ENGINE_NAMES, costarCacheKey } from '../../lib/costar.js';
import { MISSIONS, COSMETICS, CATEGORIES, CHANGE_EVENT, applyReview, toggleEquip, unlockedIds, loadCostarState, saveCostarState, isGameMode } from '../../lib/costarRewards.js';

// Progression du vestiaire (lib/costarRewards.js), partagée en direct entre les Costar affichés.
// MÉMOIRE DES AVIS (retour Thomas : « il met du temps et bouffe mon quota gratuit ») : un rapport
// relu SANS modification renvoie tout de suite l'avis déjà donné (0 token, 0 attente). Local à
// l'appareil, 20 derniers avis ; toute erreur → relecture normale.
const REVIEW_CACHE_KEY = 'chantierai_costar_reviews_v1';
const REVIEW_CACHE_MAX = 20;
function readReviewCache() {
  try { const m = JSON.parse(localStorage.getItem(REVIEW_CACHE_KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch { return {}; }
}
function getCachedReview(key) { const e = readReviewCache()[key]; return e && e.review ? e : null; }
function putCachedReview(key, review, engine) {
  try {
    const m = readReviewCache();
    m[key] = { review, engine, t: Date.now() };
    const keep = Object.entries(m).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, REVIEW_CACHE_MAX);
    localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* mode privé / quota : pas de mémoire, sans conséquence */ }
}

// Relu à chaque changement (progression, tenue, game mode).
function useCostarState() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick(n => n + 1);
    window.addEventListener(CHANGE_EVENT, on);
    return () => window.removeEventListener(CHANGE_EVENT, on);
  }, []);
  return loadCostarState();
}

// Costar : castor québécois en casque de chantier (dessin original, SVG) — mascotte qui relit
// le rapport complet et donne un avis honnête + une note. PC uniquement (cf. RapportTab).
// Animations : clignement des yeux au repos, « tortillement » au clic, mâchonnement pendant
// la lecture (classes .costar-* dans styles.css).
// Bottes vues DE FACE (comme le reste de Costar), dessinées autour de x = 0 : la gauche est
// posée en x = 44, la droite en x = 72 (en miroir). kind = 'santiags' | 'securite'.
function Boot({ kind }) {
  if (kind === 'santiags') {
    return (
      <g strokeLinejoin="round" strokeLinecap="round">
        {/* Tige à découpe en V, cuir fauve, surpiqûres en ailes */}
        <path d="M-7.4 111.2 Q-3.7 114 0 112.2 Q3.7 114 7.4 111.2 L6.8 121.2 L-6.8 121.2 Z" fill="#A86B35" stroke="#4A2A10" strokeWidth="0.8"/>
        <path d="M-6.6 112.6 Q-3.5 115 0 113.4 Q3.5 115 6.6 112.6" stroke="#F2D3A2" strokeWidth="0.6" fill="none"/>
        <path d="M0 115 Q-4.2 117 -3.4 120 Q-1.4 118.6 0 120.6 Q1.4 118.6 3.4 120 Q4.2 117 0 115 Z" fill="none" stroke="#F2D3A2" strokeWidth="0.65"/>
        {/* Pied à bout pointu */}
        <path d="M-7 120.6 Q-9.6 124 -5.6 127.4 L0 129.8 L5.6 127.4 Q9.6 124 7 120.6 Z" fill="#6B3F1D" stroke="#3A1E09" strokeWidth="0.8"/>
        <path d="M-5.8 123.4 Q0 121.8 5.8 123.4" stroke="#C98E52" strokeWidth="0.6" fill="none"/>
        <ellipse cx="-2.8" cy="125" rx="1.8" ry="0.8" fill="white" opacity="0.3"/>
        {/* Éperon côté extérieur */}
        <path d="M-7.6 122.4 L-9.4 122.4" stroke="#9CA3AF" strokeWidth="0.8"/>
        <polygon transform="translate(-10.4 122.4) scale(0.26)" fill="#E5E7EB" stroke="#6B7280" strokeWidth="1.4"
          points="0,-5 1.5,-1.6 5,-1.5 2.3,0.8 3.1,4.5 0,2.4 -3.1,4.5 -2.3,0.8 -5,-1.5 -1.5,-1.6"/>
      </g>
    );
  }
  // Chaussures de sécurité : nubuck jaune, col rembourré, lacets, coque, semelle crantée.
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      <path d="M-7 112.6 Q-7 111 -5.4 111 L5.4 111 Q7 111 7 112.6 L7 121.4 L-7 121.4 Z" fill="#D69E2E" stroke="#8A5A12" strokeWidth="0.8"/>
      <rect x="-7" y="111" width="14" height="2.6" rx="1.3" fill="#6B3F1D"/>
      <path d="M-2.8 114.6 L2.8 116.6 M2.8 114.6 L-2.8 116.6 M-2.8 117.6 L2.8 119.6 M2.8 117.6 L-2.8 119.6" stroke="#3A2A12" strokeWidth="0.85"/>
      <path d="M-7.2 120.6 Q-10.4 122.2 -9.8 126 Q-8.6 128.4 0 128.4 Q8.6 128.4 9.8 126 Q10.4 122.2 7.2 120.6 Z" fill="#D69E2E" stroke="#8A5A12" strokeWidth="0.8"/>
      <path d="M-8.8 125.4 Q0 121.4 8.8 125.4" stroke="#B7791F" strokeWidth="1" fill="none"/>
      <ellipse cx="-3.4" cy="124.4" rx="2" ry="0.8" fill="white" opacity="0.3"/>
      <path d="M-10 126.2 Q-10 129.8 -6.4 129.8 L6.4 129.8 Q10 129.8 10 126.2 Z" fill="#1F2937"/>
      <path d="M-6 129.8 L-6 128.8 M-2 129.8 L-2 128.8 M2 129.8 L2 128.8 M6 129.8 L6 128.8" stroke="#4B5563" strokeWidth="0.7"/>
    </g>
  );
}

// outfit = { head, eyes, face, mouth, neck, body, waist, hand, feet, extra } : cosmétiques portés, un par catégorie (vestiaire).
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
      {/* Costard trois pièces : veste anthracite, gilet gris à boutons, chemise blanche, cravate, pochette */}
      {o.body === 'costard' && (
        <g>
          <ellipse cx="58" cy="100" rx="33" ry="27" fill="#2B3445"/>
          <path d="M43 83 L73 83 L77 115 Q58 124 39 115 Z" fill="#596273"/>
          <path d="M39.5 112 Q58 121 76.5 112" stroke="#465061" strokeWidth="1" fill="none"/>
          <polygon points="49,83 67,83 58,101" fill="white"/>
          <path d="M43 83 L49 83 L58 101 L52 108 L46 96 Z" fill="#1E2533"/>
          <path d="M73 83 L67 83 L58 101 L64 108 L70 96 Z" fill="#1E2533"/>
          <path d="M56.3 86.5 L59.7 86.5 L60.8 99 L58 103.5 L55.2 99 Z" fill="#B91C1C"/>
          <path d="M56 84.5 L60 84.5 L59.5 87.5 L56.5 87.5 Z" fill="#7F1D1D"/>
          <circle cx="58" cy="107.5" r="1.1" fill="#2B3445"/>
          <circle cx="58" cy="112" r="1.1" fill="#2B3445"/>
          <circle cx="58" cy="116.4" r="1.1" fill="#2B3445"/>
        </g>
      )}
      {/* Slip LÉOPARD, coupe « icône » bien lisible : large élastique noir aux hanches, côtés
          très échancrés, fond arrondi, bordures noires aux cuisses ; tout au-dessus des pattes. */}
      {o.body === 'slip' && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <defs>
            <clipPath id="costar-slip-clip"><path d="M33.4 105.6 Q58 109.6 82.6 105.6 L81.2 109.4 Q70.6 111.2 64.6 118.8 Q58 120.4 51.4 118.8 Q45.4 111.2 34.8 109.4 Z"/></clipPath>
          </defs>
          <path d="M33.4 105.6 Q58 109.6 82.6 105.6 L81.2 109.4 Q70.6 111.2 64.6 118.8 Q58 120.4 51.4 118.8 Q45.4 111.2 34.8 109.4 Z" fill="#EDB95A"/>
          <g clipPath="url(#costar-slip-clip)">
            {[[38, 107.6], [46, 109.8], [54, 108], [62, 110.2], [70, 108.2], [78, 107.4], [50, 113.6], [58, 115.6], [66, 113.4], [43, 106.4], [74, 111.6], [58, 111.2]].map(([x, y], k) => (
              <g key={k} transform={`translate(${x} ${y}) rotate(${(k * 53) % 180})`}>
                <ellipse cx="0" cy="0" rx="1.9" ry="1.4" fill="#C47A26"/>
                <path d="M-2.2 -0.5 Q-1.9 -2 -0.4 -2 M0.8 -1.9 Q2.4 -1.3 2.2 0.4 M1.8 1.3 Q0.5 2.4 -0.9 1.8" stroke="#24130A" strokeWidth="0.9" fill="none"/>
              </g>
            ))}
            <ellipse cx="50" cy="108.2" rx="9" ry="1.6" fill="white" opacity="0.18"/>
          </g>
          <path d="M33.4 105.6 Q58 109.6 82.6 105.6 L81.2 109.4 Q70.6 111.2 64.6 118.8 Q58 120.4 51.4 118.8 Q45.4 111.2 34.8 109.4 Z" fill="none" stroke="#6B3E12" strokeWidth="0.8"/>
          <path d="M81.2 109.4 Q70.6 111.2 64.6 118.8 Q58 120.4 51.4 118.8 Q45.4 111.2 34.8 109.4" stroke="#111827" strokeWidth="1.5" fill="none"/>
          <path d="M33 102.4 Q58 106.4 83 102.4 L82.6 106 Q58 110 33.4 106 Z" fill="#111827"/>
          <path d="M40 104.6 Q58 107.6 76 104.6" stroke="#4B5563" strokeWidth="0.6" fill="none" strokeDasharray="1.4 1.2"/>
        </g>
      )}
      {/* Ceinture noire de karaté (nœud + deux pans, barrettes dorées) */}
      {o.waist === 'karate' && (
        <g strokeLinejoin="round">
          <path d="M26.6 103.6 Q58 112 89.4 103.6 L89.8 108.4 Q58 117 26.2 108.4 Z" fill="#111827"/>
          <path d="M55.6 112.6 L50.4 124.4 L54 125.6 L58.4 113.4 Z M60.4 112.6 L65.6 124.4 L62 125.6 L57.6 113.4 Z" fill="#1F2937"/>
          <path d="M51.3 122 L54.7 123.2 M64.7 122 L61.3 123.2" stroke="#EAB308" strokeWidth="1"/>
          <rect x="54.4" y="108.2" width="7.2" height="5.6" rx="1.6" fill="#0B0F1A" transform="rotate(-8 58 111)"/>
        </g>
      )}
      {/* Pull en cachemire bleu ciel RÉTRÉCI au lavage : torsades, bord-côtes, trop court
          (nombril à l'air), plis de tension sous les bras : on voit qu'il serre. */}
      {o.body === 'pull' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <path d="M27 97 Q26 85 40 82 L76 82 Q90 85 89 97 Q58 104 27 97 Z" fill="#A5D8FF" stroke="#5FA8E0" strokeWidth="0.8"/>
          <path d="M43.6 85 q2.6 2 0 4 q-2.6 2 0 4 q2.6 2 0 4 M47.4 85 q-2.6 2 0 4 q2.6 2 0 4 q-2.6 2 0 4" stroke="#5FA8E0" strokeWidth="1" fill="none"/>
          <path d="M68.6 85 q2.6 2 0 4 q-2.6 2 0 4 q2.6 2 0 4 M72.4 85 q-2.6 2 0 4 q2.6 2 0 4 q-2.6 2 0 4" stroke="#5FA8E0" strokeWidth="1" fill="none"/>
          <path d="M30.5 89.5 q3.5 1.4 6.5 -0.6 M31 92.5 q3 1 5.6 -0.4 M85.5 89.5 q-3.5 1.4 -6.5 -0.6 M85 92.5 q-3 1 -5.6 -0.4" stroke="#5FA8E0" strokeWidth="0.75" fill="none"/>
          <path d="M27.4 97.2 Q58 105.4 88.6 97.2 L88.2 100.4 Q58 108.6 27.8 100.4 Z" fill="#7DBEF0"/>
          <path d="M31 98.4 L31.2 101.4 M36 99.6 L36.1 102.6 M41 100.5 L41.1 103.5 M46 101.1 L46 104.1 M51 101.5 L51 104.5 M56 101.7 L56 104.7 M61 101.7 L61 104.7 M66 101.5 L66 104.5 M71 101.1 L71 104.1 M76 100.5 L75.9 103.5 M81 99.6 L80.9 102.6 M86 98.4 L85.8 101.4" stroke="#4A93CC" strokeWidth="0.7"/>
          <path d="M56.5 111 Q58 113.5 59.5 111" stroke="#8A5A2E" strokeWidth="1.2" fill="none"/>
        </g>
      )}
      {/* Pattes (les chaussures du vestiaire les remplacent) */}
      {!o.feet && <ellipse cx="44" cy="124" rx="9" ry="5" fill="#3B2412"/>}
      {!o.feet && <ellipse cx="72" cy="124" rx="9" ry="5" fill="#3B2412"/>}
      {o.feet && (
        <g>
          <g transform="translate(44 0)"><Boot kind={o.feet}/></g>
          <g transform="translate(72 0) scale(-1 1)"><Boot kind={o.feet}/></g>
        </g>
      )}
      <ellipse cx="40" cy="98" rx="6" ry="8" fill="#6E4521" transform="rotate(20 40 98)"/>
      <ellipse cx="76" cy="98" rx="6" ry="8" fill="#6E4521" transform="rotate(-20 76 98)"/>
      {o.body === 'costard' && (
        <g>
          <ellipse cx="40" cy="98" rx="6" ry="8" fill="#2B3445" transform="rotate(20 40 98)"/>
          <ellipse cx="76" cy="98" rx="6" ry="8" fill="#2B3445" transform="rotate(-20 76 98)"/>
          <path d="M33.6 102.5 Q36.5 105 40 104.6 M82.4 102.5 Q79.5 105 76 104.6" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
          <ellipse cx="36.4" cy="105.6" rx="3.6" ry="3" fill="#6E4521"/>
          <ellipse cx="79.6" cy="105.6" rx="3.6" ry="3" fill="#6E4521"/>
          {/* Pochette (après les manches pour rester visible) */}
          <polygon points="66.5,91.2 72.6,89.4 71.6,93" fill="white"/>
          <path d="M66.6 93.4 L72.4 92.2" stroke="#9CA3AF" strokeWidth="0.8"/>
        </g>
      )}
      {o.body === 'pull' && (
        <g stroke="#5FA8E0" strokeWidth="0.8">
          <ellipse cx="37" cy="91" rx="5.5" ry="4" transform="rotate(20 37 91)" fill="#A5D8FF"/>
          <ellipse cx="79" cy="91" rx="5.5" ry="4" transform="rotate(-20 79 91)" fill="#A5D8FF"/>
          <path d="M33.2 93.6 L39.4 95.2 M82.8 93.6 L76.6 95.2" stroke="#4A93CC" strokeWidth="1.6"/>
        </g>
      )}
      {/* Gants de boxe EN GARDE, vus de face : poing levé, manchette blanche lacée en bas (vers le
          bras), pouce côté intérieur, ligne des jointures, reflet. Le droit = le gauche en miroir. */}
      {o.hand === 'gants' && (
        <g strokeLinejoin="round" strokeLinecap="round">
          {[[39, 94, 1], [77, 94, -1]].map(([x, y, d]) => (
            <g key={x} transform={`translate(${x} ${y}) scale(${d} 1)`}>
              <path d="M-4.6 5.6 L4.6 5.6 L4.2 11.2 L-4.2 11.2 Z" fill="white" stroke="#D1D5DB" strokeWidth="0.7"/>
              <path d="M-3.6 7 L3.6 8.4 M3.6 7 L-3.6 8.4 M-3.4 9.4 L3.4 10.4" stroke="#9CA3AF" strokeWidth="0.6"/>
              <path d="M-7.4 1.4 Q-8.6 -8.6 0 -10 Q8.2 -9.4 7.6 -0.6 Q7.2 6.4 0 6.8 Q-6.6 6.6 -7.4 1.4 Z" fill="#DC2626" stroke="#7F1D1D" strokeWidth="0.9"/>
              <path d="M7.4 -1.6 Q10.4 -1.2 9.8 2.8 Q9.2 5.8 6 5.2" fill="#C81E1E" stroke="#7F1D1D" strokeWidth="0.8"/>
              <path d="M-6 -2.6 Q0 -0.4 6.4 -2.8" stroke="#991B1B" strokeWidth="0.8" fill="none"/>
              <ellipse cx="-3" cy="-6" rx="2.6" ry="1.5" fill="white" opacity="0.45" transform="rotate(-20 -3 -6)"/>
            </g>
          ))}
        </g>
      )}
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
        {/* Tête de citrouille : recouvre la tête, AVANT les accessoires du visage (lunettes sur la citrouille = ok) */}
        {o.head === 'citrouille' && (
          <g>
            <path d="M58 32 Q57 25 61 21" stroke="#4D7C0F" strokeWidth="4" fill="none" strokeLinecap="round"/>
            <path d="M61 25 Q70 20 72 27 Q66 26 61 28 Z" fill="#65A30D"/>
            <ellipse cx="58" cy="61" rx="35" ry="30" fill="#EA580C"/>
            <ellipse cx="58" cy="61" rx="24" ry="30" fill="#F97316"/>
            <ellipse cx="58" cy="61" rx="11" ry="30" fill="#FB923C"/>
            <path d="M34 39 Q28 61 34 83 M82 39 Q88 61 82 83" stroke="#C2410C" strokeWidth="1" fill="none" opacity="0.6"/>
            <polygon points="40,62 47,52 54,62" fill="#3B1D06"/>
            <polygon points="62,62 69,52 76,62" fill="#3B1D06"/>
            <polygon points="55,70 58,65 61,70" fill="#3B1D06"/>
            <path d="M38 75 L44 79 L48 75 L53 80 L58 76 L63 80 L68 75 L72 79 L78 75 Q74 87 58 87 Q42 87 38 75 Z" fill="#3B1D06"/>
            <polygon points="42,61 47,55 52,61" fill="#FDE047" opacity="0.55"/>
            <polygon points="64,61 69,55 74,61" fill="#FDE047" opacity="0.55"/>
          </g>
        )}
        {/* Cicatrices AVANT les lunettes : elles dépassent au-dessus et en dessous des verres */}
        {o.face === 'cicatrices' && (
          <g strokeLinecap="round">
            <path d="M40 51 L53 74" stroke="#F0B9A6" strokeWidth="2.4"/>
            <path d="M42.6 57.2 L46.4 55 M45.4 62 L49.2 59.8 M48.2 66.8 L52 64.6" stroke="#5A2E12" strokeWidth="0.9"/>
            <path d="M73 70 L80 77 M80 70 L73 77" stroke="#F0B9A6" strokeWidth="1.8"/>
          </g>
        )}
        {/* Lunettes d'aviateur / monocle / visage / bouche (vestiaire) — hors du groupe des yeux : ne clignent pas */}
        {/* Lunettes d'aviateur : grands verres en goutte, dégradé miroir (nuit → violet → coucher de
            soleil), monture dorée fine, double pont, reflets. */}
        {o.eyes === 'lunettes' && (
          <g>
            <defs>
              <linearGradient id="costar-aviator" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#0F172A"/>
                <stop offset="0.42" stopColor="#4C1D95"/>
                <stop offset="0.72" stopColor="#DB2777"/>
                <stop offset="1" stopColor="#FB923C"/>
              </linearGradient>
            </defs>
            <path d="M36.6 58 L29 56.4 M79.4 58 L87 56.4" stroke="#C9A227" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M36.8 58.4 Q36.6 55.4 40 55.4 L53.4 55.4 Q56.8 55.4 56.3 59.2 Q55.2 71.6 46.2 72.6 Q36.6 72.6 36.8 58.4 Z" fill="url(#costar-aviator)" stroke="#E6C04A" strokeWidth="1.3"/>
            <path d="M79.2 58.4 Q79.4 55.4 76 55.4 L62.6 55.4 Q59.2 55.4 59.7 59.2 Q60.8 71.6 69.8 72.6 Q79.4 72.6 79.2 58.4 Z" fill="url(#costar-aviator)" stroke="#E6C04A" strokeWidth="1.3"/>
            <path d="M40.5 55.4 L75.5 55.4" stroke="#E6C04A" strokeWidth="1.1"/>
            <path d="M56.2 59.6 Q58 58.4 59.8 59.6" stroke="#E6C04A" strokeWidth="1.1" fill="none"/>
            <path d="M40 61.5 L45.5 57.4 M41.6 65.8 L49.6 59.6 M63 61.5 L68.5 57.4 M64.6 65.8 L72.6 59.6" stroke="white" strokeWidth="1.3" strokeLinecap="round" opacity="0.5"/>
            <polygon transform="translate(53 58.6) scale(0.32)" fill="white" opacity="0.9"
              points="0,-6 1.2,-1.2 6,0 1.2,1.2 0,6 -1.2,1.2 -6,0 -1.2,-1.2"/>
          </g>
        )}
        {o.eyes === 'monocle' && (
          <g>
            <path d="M76.5 66 Q84 78 76 92" stroke="#CA8A04" strokeWidth="1" fill="none" strokeDasharray="1.6 1.4"/>
            <circle cx="69" cy="63" r="8" fill="white" fillOpacity="0.18" stroke="#CA8A04" strokeWidth="2.2"/>
          </g>
        )}
        {o.face === 'pansement' && (
          <g transform="rotate(-24 40 71)">
            <rect x="32" y="68" width="16" height="6" rx="3" fill="#F5D0A9" stroke="#D6A77A" strokeWidth="0.8"/>
            <rect x="37.5" y="68.4" width="5" height="5.2" fill="#EBC097"/>
            <circle cx="34.8" cy="71" r="0.5" fill="#C08A5B"/><circle cx="45.2" cy="71" r="0.5" fill="#C08A5B"/>
          </g>
        )}
        {o.mouth === 'clope' && (
          <g>
            <path d="M80 80 q3 -4 0 -7.5 q-3 -4 1 -8" stroke="#D1D5DB" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.75"/>
            <path d="M63 81 L78.5 84.5" stroke="white" strokeWidth="2.8"/>
            <path d="M63 81 L66.5 81.8" stroke="#F59E0B" strokeWidth="2.8"/>
            <circle cx="79" cy="84.6" r="1.5" fill="#EF4444"/>
            <circle cx="79.4" cy="84.4" r="0.6" fill="#FDE047"/>
          </g>
        )}
        {/* Coiffe : casque de chantier (défaut), cowboy, Noël, tuque, couronne, citrouille (vestiaire) */}
        {o.head === 'citrouille' ? null : o.head === 'noel' ? (
          <g>
            <path d="M30 50 Q30 22 58 17 Q80 14 93 33 Q86 30 81 33 Q85 41 86 50 Z" fill="#DC2626"/>
            <path d="M40 26 Q50 20 62 19" stroke="#F87171" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.7"/>
            <rect x="26" y="42" width="64" height="11" rx="5.5" fill="white" stroke="#E5E7EB" strokeWidth="0.8"/>
            <circle cx="94" cy="35" r="6.5" fill="white" stroke="#E5E7EB" strokeWidth="0.8"/>
          </g>
        ) : o.head === 'cowboy' ? (
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

// Repères pour centrer « Ask Costar » sur le castor : largeur du dessin (100 px) et axe du corps
// (x = 58 sur 120 dans le viewBox), demi-largeur de l'étiquette « Ask Costar ».
const COSTAR_W = 100;
const COSTAR_CX = Math.round(COSTAR_W * 58 / 120);
const LABEL_HALF = 49;

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
  const [fromCache, setFromCache] = useState(false); // avis repris de la mémoire (rapport inchangé)
  const [reviewedKey, setReviewedKey] = useState(null); // empreinte du rapport tel qu'il a été relu
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
    setFromCache(false);

    const digest = buildReportDigest(projetRef.current);
    if (digest.observations === 0) { setReview(EMPTY_REVIEW); setQuip(scoreQuip(0)); setStatus('done'); return; }
    // Rapport inchangé depuis la dernière relecture (même moteur) → même avis, instantané.
    // Pas de mission sur un avis repris de la mémoire (ce n'est pas une nouvelle relecture).
    const cacheKey = costarCacheKey(digest.text, getAIProvider());
    const hit = getCachedReview(cacheKey);
    if (hit) {
      setReview(hit.review);
      setQuip(scoreQuip(hit.review.note));
      setEngine(hit.engine || null);
      setFromCache(true);
      setReviewedKey(cacheKey);
      setStatus('done');
      return;
    }

    setStatus('loading');
    try {
      const d = await callAIProxy({
        feature: 'costar',
        model: 'claude-sonnet-4-6',
        modelFor: { mistral: 'mistral-medium-latest' }, // relecture fine : Medium plutôt que Small
        // Pas de « réflexion » Gemini : elle doublait le temps de réponse et faisait dépasser le
        // délai quand Gemini est chargé (« Gemini ne répond pas ») ; la consigne détaillée suffit.
        // Réponse courte demandée par la consigne : 1800 tokens suffisent largement (avant 4096) ;
        // la sortie est ce qui coûte le plus de temps.
        max_tokens: 1800,
        temperature: 0.1, // même rapport → même note (pas de loterie d'un essai à l'autre)
        json: true,
        system: COSTAR_SYSTEM,
        messages: [{ role: 'user', content: `Voici les textes de mon rapport (${digest.observations} observations, ${digest.zones} zones). Lis tout, puis juge le fond.\n\n${digest.text}` }],
        _waitOk: true,
        _throttleMs: 4000, // avant 15 s d'attente forcée entre deux relectures (le cache évite les doublons)
        _signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      const raw = (d.content || []).map(c => c?.text || '').join('');
      const parsed = parseCostarReply(raw, digest.text); // points sans citation exacte = annulés
      if (!parsed) throw new Error(d._finish === 'MAX_TOKENS' ? 'Réponse coupée, réessaie' : 'Réponse illisible, réessaie');
      setReview(parsed);
      setQuip(scoreQuip(parsed.note));
      const eng = d._provider ? { provider: d._provider, from: d._fallbackFrom || null, why: d._fallbackWhy || null } : null;
      setEngine(eng);
      putCachedReview(cacheKey, parsed, eng);
      setReviewedKey(cacheKey);
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
  // Game mode (admin, menu ⋯) : tout est disponible dans une tenue d'ESSAI à part ; la vraie
  // tenue et la progression des missions ne sont pas touchées (retour à la normale en le décochant).
  const game = isGameMode();
  const realUnlocked = new Set(unlockedIds(cst.stats));
  const unlocked = game ? new Set(Object.keys(COSMETICS)) : realUnlocked;
  const outfit = game ? cst.sandbox : cst.equipped;
  const doneCount = MISSIONS.filter(m => realUnlocked.has(m.reward)).length;

  const sc = review ? scoreLabel(review.note) : null;
  // Rapport modifié depuis l'avis affiché → Costar propose de relire (demande Thomas : « dès qu'on
  // modifie le rapport, ça doit proposer de remouliner »). Calculé seulement quand l'avis est ouvert.
  const reportChanged = open && status === 'done' && !!reviewedKey
    && costarCacheKey(buildReportDigest(projet).text, getAIProvider()) !== reviewedKey;
  const loading = status === 'loading';
  if (!isPc) return null;

  return (
    <div style={{ position: fixed ? 'fixed' : 'absolute', right: 34, bottom: fixed ? 18 : 14, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'none' }}>
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
              {fromCache && !reportChanged && (
                <div style={{ marginTop: 10, fontSize: 10.5, color: DA.grayL, lineHeight: 1.4 }}>
                  Rapport inchangé depuis ma dernière lecture : je te redonne le même avis (sans repasser par l'IA).
                </div>
              )}
              {engine && !fromCache && (
                <div style={{ marginTop: 10, fontSize: 10.5, color: DA.grayL, lineHeight: 1.4 }}>
                  {engine.from
                    ? <>{ENGINE_NAMES[engine.from] || engine.from} indisponible{engine.why ? ` (${engine.why})` : ''} : relu avec {ENGINE_NAMES[engine.provider] || engine.provider}.</>
                    : <>Relu avec {ENGINE_NAMES[engine.provider] || engine.provider}.</>}
                </div>
              )}
              {reportChanged ? (
                <button onClick={ask} className="costar-unlock"
                  style={{ display: 'block', marginTop: 12, fontSize: 12.5, fontWeight: 800, color: 'white', background: '#F97316', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(249,115,22,0.35)' }}>
                  Rapport modifié : relire les changements
                </button>
              ) : (
                <button onClick={ask}
                  style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: DA.gray, background: 'white', border: `1px solid ${DA.border}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
                  Relire mon rapport
                </button>
              )}
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
            {game && (
              <div style={{ marginTop: 10, padding: '7px 10px', borderRadius: 10, background: '#EEF2FF', border: '1px solid #C7D2FE', fontSize: 11.5, color: '#3730A3', lineHeight: 1.4 }}>
                🎮 <strong>Game mode</strong> : tous les objets sont disponibles pour les essayer. Ta vraie tenue et tes missions ne bougent pas ; décoche le game mode (menu ⋯) pour revenir à la normale.
              </div>
            )}
            <div style={{ fontSize: 10.5, fontWeight: 800, color: DA.grayL, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12, marginBottom: 6 }}>Inventaire</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {CATEGORIES.map(cat => {
                const items = Object.entries(COSMETICS).filter(([, c]) => c.slot === cat.slot);
                if (!items.length) return null;
                const cur = outfit[cat.slot];
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
                            onClick={() => saveCostarState(toggleEquip(cst, id, { sandbox: game }))}
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
                const got = realUnlocked.has(m.reward);
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

      {/* « Ask Costar » CENTRÉ au-dessus du castor (demande Thomas), engrenage à sa droite. */}
      <div style={{ position: 'relative', width: COSTAR_W, height: 27, marginBottom: 4, alignSelf: 'flex-end' }}>
        {!open && !wardrobe && (
          // Centrage sur un conteneur à part : l'animation de flottement (.costar-label) utilise déjà transform.
          <div style={{ position: 'absolute', left: COSTAR_CX, top: 1, transform: 'translateX(-50%)', pointerEvents: 'none' }}>
            <div className="costar-label" style={{ background: DA.black, color: 'white', fontSize: 12, fontWeight: 800, borderRadius: 20, padding: '5px 12px', boxShadow: '0 4px 14px rgba(0,0,0,0.2)', whiteSpace: 'nowrap' }}>
              Ask Costar
            </div>
          </div>
        )}
        <button type="button" onClick={toggleWardrobe} aria-label="Vestiaire de Costar" title="Vestiaire de Costar (missions et cosmétiques)"
          style={{ pointerEvents: 'auto', position: 'absolute', left: COSTAR_CX + LABEL_HALF + 6, top: 0, width: 27, height: 27, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
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
        <CostarSvg outfit={outfit} className={`costar${wiggle ? ' costar-wiggle' : ''}${loading ? ' costar-busy' : ''}`}/>
      </button>
    </div>
  );
}
