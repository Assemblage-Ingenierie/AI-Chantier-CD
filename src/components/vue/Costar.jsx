import React, { useState, useEffect, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { callAIProxy, getAIProvider } from '../../lib/aiProxy.js';
import { buildReportDigest, COSTAR_SYSTEM, parseCostarReply, scoreLabel, EMPTY_REVIEW, COSTAR_LOADING, COSTAR_ERRORS, COSTAR_HELLO, pick, scoreQuip, costarErrorHint, ENGINE_NAMES, costarCacheKey } from '../../lib/costar.js';
import { listDeletedItems } from '../../lib/recoveryBin.js';
import { MISSIONS, COSMETICS, CATEGORIES, CHANGE_EVENT, applyReview, toggleEquip, unlockedIds, loadCostarState, saveCostarState, isGameMode, getFanAvatar, setFanAvatar, isFanName, isFanParticipant } from '../../lib/costarRewards.js';
import { subscribePresence } from '../../lib/presence.js';

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
// posée en x = 44, la droite en x = 72 (en miroir). kind = 'santiags' | 'securite' | 'claquettes'.
function Boot({ kind }) {
  // Claquettes-chaussettes : chaussette blanche de sport à rayures + claquette noire.
  if (kind === 'claquettes') {
    return (
      <g strokeLinejoin="round" strokeLinecap="round">
        <path d="M-6.4 111 L6.4 111 L6.6 122 Q7.6 128 0 128.4 Q-7.6 128 -6.6 122 Z" fill="white" stroke="#D1D5DB" strokeWidth="0.8"/>
        <rect x="-6.4" y="112.6" width="12.8" height="1.6" fill="#DC2626"/>
        <rect x="-6.4" y="115.2" width="12.8" height="1.6" fill="#2563EB"/>
        <path d="M-9.4 127.4 Q-9.4 130.4 -6.4 130.4 L6.4 130.4 Q9.4 130.4 9.4 127.4 Z" fill="#111827"/>
        <path d="M-8.6 121.8 Q0 118.6 8.6 121.8 L8.8 126.6 Q0 123.8 -8.8 126.6 Z" fill="#1F2937" stroke="#0B0F1A" strokeWidth="0.6"/>
        <path d="M-4.4 123.4 L4.4 122.6" stroke="white" strokeWidth="1.1"/>
      </g>
    );
  }
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

// AMBIANCE « Odeur de poubelle » (demande Thomas 16/11 ; retour : « on ne comprend pas qu'il
// pue » → codes de BD bien lisibles même en petit) :
//   • DERRIÈRE Costar : nuage verdâtre + grosses volutes vertes qui montent ;
//   • DEVANT : trois mouches bien dessinées (ailes, traînée en pointillés) qui tournent autour
//     de la tête, et une peau de banane « de dessin animé » posée à ses pieds.
function TrashAuraBack() {
  return (
    <g>
      <defs>
        <radialGradient id="costar-stink-cloud" cx="0.5" cy="0.55" r="0.5">
          <stop offset="0" stopColor="#A3E635" stopOpacity="0.55"/>
          <stop offset="0.7" stopColor="#84CC16" stopOpacity="0.25"/>
          <stop offset="1" stopColor="#84CC16" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="58" cy="78" rx="60" ry="56" fill="url(#costar-stink-cloud)"/>
      {[[14, 70, 0], [26, 50, 1.1], [92, 48, 0.5], [104, 70, 1.6]].map(([x, y, d]) => (
        <path key={x} className="costar-stink" style={{ animationDelay: `${d}s` }}
          d={`M${x} ${y} q-4 -5 0 -10 q4 -5 0 -10 q-4 -5 0 -10`}
          fill="none" stroke="#4D7C0F" strokeWidth="2.6" strokeLinecap="round"/>
      ))}
    </g>
  );
}
function TrashAuraFront() {
  const fly = (
    <g strokeLinejoin="round" strokeLinecap="round">
      <path d="M-5 3 q-3 -2 -6 0 q-3 2 -6 0" fill="none" stroke="#374151" strokeWidth="0.6" strokeDasharray="1 1.2" opacity="0.8"/>
      <ellipse cx="-2.2" cy="-2.6" rx="2.8" ry="1.7" transform="rotate(-30 -2.2 -2.6)" fill="#DBEAFE" stroke="#475569" strokeWidth="0.45" opacity="0.95" className="costar-wing"/>
      <ellipse cx="2.2" cy="-2.6" rx="2.8" ry="1.7" transform="rotate(30 2.2 -2.6)" fill="#DBEAFE" stroke="#475569" strokeWidth="0.45" opacity="0.95" className="costar-wing"/>
      <ellipse cx="0" cy="0.6" rx="2.2" ry="2.8" fill="#111827"/>
      <path d="M-2 0.4 L2 0.4 M-1.8 1.9 L1.8 1.9" stroke="#4B5563" strokeWidth="0.5"/>
      <circle cx="0" cy="-2.6" r="1.5" fill="#111827"/>
      <circle cx="-0.8" cy="-3" r="0.65" fill="#B91C1C"/>
      <circle cx="0.8" cy="-3" r="0.65" fill="#B91C1C"/>
    </g>
  );
  return (
    <g>
      {/* Peau de banane de dessin animé : pétales jaunes étalés au sol (intérieur crème), un
          pétale debout avec la queue, bouts noircis, taches brunes. */}
      <g transform="translate(20 122.6)" strokeLinejoin="round" strokeLinecap="round">
        <ellipse cx="0" cy="5.2" rx="15.5" ry="2.2" fill="#000" opacity="0.15"/>
        {/* Pétales couchés : gauche, droite, avant */}
        <path d="M-1 3 C-6 -1 -12 -1 -15.5 3.6 C-10.5 5.6 -5 5.4 -1 3.8 Z" fill="#FACC15" stroke="#854D0E" strokeWidth="1"/>
        <path d="M-2.4 3.2 C-6.4 1.4 -10.4 1.6 -12.8 3.6 C-9 4.4 -5.4 4.2 -2.4 3.6 Z" fill="#FEF9C3"/>
        <path d="M1 3 C6 -1 12 -1 15.5 3.6 C10.5 5.6 5 5.4 1 3.8 Z" fill="#FACC15" stroke="#854D0E" strokeWidth="1"/>
        <path d="M2.4 3.2 C6.4 1.4 10.4 1.6 12.8 3.6 C9 4.4 5.4 4.2 2.4 3.6 Z" fill="#FEF9C3"/>
        <circle cx="-15" cy="3.6" r="1.1" fill="#3F2A0A"/>
        <circle cx="15" cy="3.6" r="1.1" fill="#3F2A0A"/>
        {/* Pétale debout, légèrement penché, avec la queue */}
        <path d="M-2.6 3.4 C-4.4 -3 -3 -9 0.6 -12.4 C2.6 -8.6 3.6 -3 2.8 3.4 Z" fill="#FDE047" stroke="#854D0E" strokeWidth="1"/>
        <path d="M0.6 -12.4 L1.8 -15.4" stroke="#3F2A0A" strokeWidth="2"/>
        {/* Base */}
        <ellipse cx="0" cy="3.8" rx="3.6" ry="1.8" fill="#EAB308" stroke="#854D0E" strokeWidth="0.9"/>
        {/* Taches brunes (bien usagée) */}
        <circle cx="-8.4" cy="1.6" r="0.9" fill="#78350F"/>
        <circle cx="9.6" cy="1.4" r="1" fill="#78350F"/>
        <circle cx="0" cy="-4.6" r="1" fill="#78350F"/>
        <circle cx="-0.6" cy="-0.6" r="0.7" fill="#78350F"/>
      </g>
      {/* Mouches en orbite autour de la tête */}
      {[[0, 4.6, 44, 'normal'], [1.5, 6, 50, 'reverse'], [3, 3.8, 38, 'normal']].map(([d, dur, r, dir]) => (
        <g key={d} className="costar-fly" style={{ animationDuration: `${dur}s`, animationDelay: `-${d}s`, animationDirection: dir }}>
          <g transform={`translate(${58 + r} 50) scale(1.7)`}>{fly}</g>
        </g>
      ))}
    </g>
  );
}

// SOUVENIRS DE VOYAGE (demande Thomas 16/11 ; v2 après retour : « des mains mimi », pot de glace
// DANS la main, gros croco balèze, gros colvert). Dessinés DEVANT Costar.
//   • Londres : bonnet de garde (coiffe, cf. Bearskin) + Union Jack qui flotte, tenu en l'air ;
//   • Dijon   : bouteille de rouge tenue fièrement ;
//   • Nîmes   : gros crocodile musclé, debout bras croisés, à côté de Costar (création originale) ;
//   • Bâle    : pot de glace dans la patte + gros canard colvert assis à ses pieds.
export const VOYAGE_HOLDS = ['londres', 'dijon', 'bale']; // la patte gauche se lève pour tenir l'objet

// Patte levée (côté gauche de l'image) : bras arrondi + main ronde, coussinets clairs ; `front`
// = petits doigts dessinés PAR-DESSUS l'objet tenu (ils l'enserrent).
function RaisedArm({ sleeve = null }) {
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M39 99 Q31 95 28 85" stroke={sleeve || '#6E4521'} strokeWidth="10" fill="none"/>
      {sleeve
        ? <path d="M31.4 88.6 Q27.6 89.6 25 87.4" stroke="white" strokeWidth="1.6" fill="none"/>
        : <path d="M36.6 97.4 Q31.6 94 30 87" stroke="#7E5230" strokeWidth="3" fill="none" opacity="0.6"/>}
      <circle cx="27" cy="81" r="6" fill="#6E4521"/>
    </g>
  );
}
// Patte « peace » (V de la victoire), version castor mimi : paume claire, deux doigts levés
// avec coussinets, les deux autres repliés, pouce par-dessus. Retour Thomas 16/11 (« des mains
// mimi »). Dessinée pour la patte levée gauche ; la droite = miroir (cf. ArmSide).
function PeaceHand() {
  // Patte façon « tahu » (inspiration envoyée par Thomas, adaptée à Costar) : silhouette ronde
  // aux 4 doigts en bosses, cerné doux, gros coussinet rose arrondi + 4 petits coussinets.
  // Écartée vers l'extérieur pour ne pas chevaucher les moustaches. Paume face à nous.
  const F = '#8A5A2E', S = '#4A2E17', PAD = '#F7BFCB', PADS = '#E08FA2';
  const toes = [[16.6, 75.4, -36], [20.8, 71.2, -12], [26, 71.2, 12], [30.2, 75.4, 36]];
  return (
    <g strokeLinejoin="round">
      {/* Poignet qui prolonge le bras levé */}
      <path d="M26 87 Q24 83 23.4 80" stroke="#6E4521" strokeWidth="8" strokeLinecap="round" fill="none"/>
      {toes.map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.1" fill={F} stroke={S} strokeWidth="0.7"/>)}
      <ellipse cx="23.4" cy="80" rx="7.8" ry="6.9" fill={F} stroke={S} strokeWidth="0.7"/>
      {toes.map(([x, y]) => <circle key={'c' + x} cx={x} cy={y} r="2.55" fill={F}/>)}
      <path d="M23.4 77.4 C26.4 77.4 28.8 80.8 28.5 83 C28.2 84.9 25.9 84.7 23.4 84 C20.9 84.7 18.6 84.9 18.3 83 C18 80.8 20.4 77.4 23.4 77.4 Z" fill={PAD} stroke={PADS} strokeWidth="0.45"/>
      {toes.map(([x, y, r]) => <ellipse key={'p' + x} cx={x} cy={y + 0.2} rx="1.25" ry="1.65" transform={`rotate(${r} ${x} ${y + 0.2})`} fill={PAD} stroke={PADS} strokeWidth="0.4"/>)}
      <ellipse cx="21.9" cy="79.6" rx="1.1" ry="0.6" fill="white" opacity="0.65"/>
    </g>
  );
}
// Côté du bras levé : 'L' tel quel, 'R' = miroir autour de l'axe de Costar (x = 58).
function ArmSide({ side, children }) {
  return side === 'R' ? <g transform="translate(116 0) scale(-1 1)">{children}</g> : <g>{children}</g>;
}
function PawFingers() {
  return (
    <g>
      {[[22.4, 80.6], [25.6, 79.2], [28.8, 79.2], [31.6, 80.8]].map(([x, y]) => (
        <g key={x}>
          <ellipse cx={x} cy={y} rx="1.9" ry="2.3" fill="#7A4D27" stroke="#4E3016" strokeWidth="0.45"/>
          <ellipse cx={x} cy={y - 0.6} rx="0.9" ry="0.8" fill="#F2C9A0"/>
        </g>
      ))}
    </g>
  );
}
function VoyageFront({ kind }) {
  if (kind === 'londres') {
    return (
      <g strokeLinecap="round" strokeLinejoin="round">
        <RaisedArm/>
        <path d="M27 84 L23 40" stroke="#8B5A2B" strokeWidth="1.6"/>
        <circle cx="22.9" cy="39" r="1.6" fill="#EAB308"/>
        <defs>
          <clipPath id="costar-ukflag"><path d="M23 42 Q16 39 9 42 Q4 44 2 42 L2 57 Q4 59 9 57 Q16 54 23 57 Z"/></clipPath>
        </defs>
        <g clipPath="url(#costar-ukflag)">
          <rect x="0" y="36" width="26" height="26" fill="#1E3A8A"/>
          <path d="M2 41 L23 58 M23 41 L2 58" stroke="white" strokeWidth="3"/>
          <path d="M2 41 L23 58 M23 41 L2 58" stroke="#DC2626" strokeWidth="1.1"/>
          <path d="M12.5 36 L12.5 62 M0 49.5 L26 49.5" stroke="white" strokeWidth="4.6"/>
          <path d="M12.5 36 L12.5 62 M0 49.5 L26 49.5" stroke="#DC2626" strokeWidth="2.4"/>
          <path d="M2 46 Q9 43 16 46 Q20 48 23 46" stroke="white" strokeWidth="2.4" fill="none" opacity="0.2"/>
        </g>
        <path d="M23 42 Q16 39 9 42 Q4 44 2 42 L2 57 Q4 59 9 57 Q16 54 23 57 Z" fill="none" stroke="#1E293B" strokeWidth="0.6"/>
        <PawFingers/>
      </g>
    );
  }
  if (kind === 'dijon') {
    return (
      <g strokeLinecap="round" strokeLinejoin="round">
        <RaisedArm/>
        <g transform="rotate(-8 27 80)">
          <rect x="24.6" y="50" width="5" height="4" rx="1" fill="#991B1B"/>
          <path d="M24.6 53.6 L29.6 53.6 L29.6 63 Q34 66 34 71 L34 96 Q34 98.6 31.4 98.6 L22.8 98.6 Q20.2 98.6 20.2 96 L20.2 71 Q20.2 66 24.6 63 Z" fill="#1F4D2B" stroke="#0B2614" strokeWidth="0.8"/>
          <rect x="20.8" y="74" width="12.6" height="12" rx="1.2" fill="#FFF7E6" stroke="#B45309" strokeWidth="0.5"/>
          <path d="M23 77.6 Q27.1 75.6 31.2 77.6" stroke="#991B1B" strokeWidth="1" fill="none"/>
          <path d="M23.6 81 L30.6 81 M24.6 83.4 L29.6 83.4" stroke="#78350F" strokeWidth="0.7"/>
          <circle cx="27.1" cy="79.2" r="0.9" fill="#B45309"/>
          <path d="M22.4 67 Q22 80 22.4 94" stroke="white" strokeWidth="1.4" fill="none" opacity="0.3"/>
        </g>
        <PawFingers/>
      </g>
    );
  }
  if (kind === 'bale') {
    return (
      <g strokeLinecap="round" strokeLinejoin="round">
        <Mallard/>
        <RaisedArm/>
        {/* Pot de glace tenu dans la patte : 3 boules, cuillère en bois */}
        <circle cx="23.6" cy="68" r="4.6" fill="#FEF3C7" stroke="#D6B36A" strokeWidth="0.6"/>
        <circle cx="31" cy="68.4" r="4.6" fill="#FBCFE8" stroke="#E879A8" strokeWidth="0.6"/>
        <circle cx="27.4" cy="63.4" r="4.8" fill="#BBF7D0" stroke="#4ADE80" strokeWidth="0.6"/>
        <circle cx="25.8" cy="61.6" r="1.2" fill="white" opacity="0.7"/>
        <path d="M31.6 64.4 L36.8 56.6" stroke="#B7791F" strokeWidth="1.6"/>
        <ellipse cx="37.2" cy="56" rx="1.4" ry="2" fill="#B7791F" transform="rotate(34 37.2 56)"/>
        <path d="M19.4 71 L35 71 L32.6 87 L21.8 87 Z" fill="#F9A8D4" stroke="#DB2777" strokeWidth="0.8"/>
        <path d="M19.4 71 L35 71" stroke="#DB2777" strokeWidth="1.6"/>
        <path d="M21 76 L33.6 76 M21.6 81 L33 81" stroke="white" strokeWidth="1.3" opacity="0.85"/>
        <PawFingers/>
      </g>
    );
  }
  if (kind === 'nimes') return <CrocFront/>;
  return null;
}
// CROCO DE NÎMES (retours Thomas : « un croco du style du blason, autour de Costar », « vert »,
// « costaud ») — création originale. DERRIÈRE Costar (CrocBack, avant le corps) : le gros corps
// et la queue épaisse qui remonte en S sur sa droite, écailles sur le dos. DEVANT (CrocFront) :
// grosse tête trapue gueule ouverte à gauche + patte griffue.
const CROC = { g: '#3FA34D', gd: '#1F6B2B', gl: '#5CC46A', belly: '#D4EA9A', tail: "M26.9 120.4 L28.9 121.2 L31.1 122.0 L33.3 122.8 L35.6 123.5 L38.0 124.2 L40.3 124.8 L42.7 125.3 L45.2 125.8 L47.6 126.2 L50.1 126.6 L52.7 126.9 L55.2 127.2 L57.8 127.4 L60.3 127.5 L62.9 127.5 L65.5 127.5 L68.1 127.5 L70.6 127.3 L73.2 127.1 L75.7 126.9 L78.3 126.5 L80.8 126.1 L83.3 125.6 L85.7 125.0 L88.1 124.3 L90.9 123.5 L93.3 122.4 L95.4 121.3 L97.3 120.2 L99.3 119.0 L101.1 117.7 L102.8 116.3 L104.4 114.9 L106.0 113.4 L107.5 111.8 L108.8 110.1 L110.1 108.5 L111.3 106.8 L112.4 105.0 L113.4 103.2 L114.4 101.3 L115.2 99.5 L115.9 97.6 L116.5 95.6 L117.1 93.7 L117.5 91.7 L117.8 89.7 L118.1 87.7 L118.2 85.7 L118.2 83.7 L118.1 81.6 L118.0 79.6 L117.7 77.8 L117.3 76.1 L116.9 74.5 L116.5 73.0 L115.9 71.5 L115.3 70.0 L114.7 68.6 L114.0 67.3 L113.2 66.1 L112.4 64.9 L111.5 63.8 L110.6 62.8 L109.6 61.9 L108.6 61.0 L107.6 60.3 L106.4 59.6 L105.3 59.0 L104.1 58.6 L102.8 58.3 L101.6 58.1 L100.3 58.1 L99.0 58.2 L97.8 58.4 L96.6 58.8 L95.4 59.4 L94.3 60.0 L93.5 60.6 L92.9 61.3 L92.3 62.0 L91.8 62.7 L91.4 63.4 L91.1 64.1 L90.8 64.9 L90.7 65.6 L90.6 66.4 L90.7 67.1 L90.8 67.8 L90.9 68.5 L91.2 69.1 L91.5 69.7 L91.8 70.2 L92.3 70.7 L92.7 71.1 L93.3 71.5 L93.8 71.8 L94.4 72.0 L95.0 72.2 L95.6 72.3 L96.3 72.3 L96.9 72.2 L97.5 72.1 L98.1 71.9 L97.9 70.1 L97.3 70.1 L96.9 70.0 L96.5 69.9 L96.2 69.7 L95.9 69.6 L95.7 69.4 L95.6 69.2 L95.4 68.9 L95.4 68.7 L95.3 68.5 L95.3 68.3 L95.3 68.1 L95.3 67.9 L95.4 67.7 L95.5 67.5 L95.6 67.4 L95.7 67.2 L95.8 67.0 L96.0 66.9 L96.1 66.7 L96.3 66.6 L96.6 66.5 L96.8 66.3 L97.1 66.2 L97.4 66.1 L97.7 66.0 L98.2 65.8 L98.7 65.8 L99.1 65.7 L99.5 65.8 L99.9 65.9 L100.3 66.0 L100.6 66.2 L101.0 66.4 L101.3 66.7 L101.7 67.0 L102.1 67.4 L102.5 67.9 L102.9 68.4 L103.2 69.0 L103.6 69.6 L104.0 70.3 L104.3 71.1 L104.7 71.9 L105.0 72.8 L105.2 73.7 L105.5 74.7 L105.7 75.8 L105.8 76.9 L106.0 78.0 L106.0 79.2 L106.0 80.4 L106.0 81.8 L105.9 83.2 L105.7 84.6 L105.5 86.0 L105.1 87.3 L104.8 88.6 L104.3 89.9 L103.8 91.1 L103.2 92.4 L102.6 93.6 L101.9 94.8 L101.1 95.9 L100.3 97.0 L99.5 98.1 L98.5 99.1 L97.5 100.2 L96.5 101.2 L95.4 102.1 L94.2 103.0 L93.0 103.9 L91.8 104.7 L90.5 105.6 L89.2 106.4 L87.8 107.2 L86.3 108.0 L85.1 108.5 L83.7 109.0 L81.8 109.5 L79.8 109.9 L77.9 110.3 L75.8 110.7 L73.8 111.0 L71.7 111.2 L69.6 111.4 L67.4 111.5 L65.3 111.5 L63.1 111.5 L60.9 111.5 L58.7 111.4 L56.6 111.2 L54.4 111.0 L52.3 110.8 L50.2 110.4 L48.1 110.1 L46.0 109.7 L44.0 109.2 L42.1 108.7 L40.2 108.2 L38.3 107.6 L36.6 107.0 L34.8 106.4 L33.1 105.6 Z" };
function CrocBack() {
  return (
    <g strokeLinejoin="round">
      <g fill={CROC.gd}><circle cx="104.4" cy="114.9" r="3.4"/><circle cx="108.8" cy="110.1" r="3.31"/><circle cx="112.4" cy="105.0" r="3.22"/><circle cx="115.2" cy="99.5" r="3.12"/><circle cx="117.1" cy="93.7" r="3.03"/><circle cx="118.1" cy="87.7" r="2.94"/><circle cx="118.1" cy="81.6" r="2.84"/><circle cx="117.3" cy="76.1" r="2.75"/><circle cx="115.9" cy="71.5" r="2.65"/><circle cx="114.0" cy="67.3" r="2.56"/><circle cx="111.5" cy="63.8" r="2.47"/><circle cx="108.6" cy="61.0" r="2.37"/><circle cx="105.3" cy="59.0" r="2.28"/><circle cx="101.6" cy="58.1" r="2.19"/><circle cx="97.8" cy="58.4" r="2.09"/><circle cx="94.3" cy="60.0" r="2.0"/><circle cx="96.8" cy="66.3" r="1.91"/><circle cx="96.1" cy="66.7" r="1.81"/><circle cx="95.7" cy="67.2" r="1.72"/><circle cx="95.4" cy="67.7" r="1.62"/><circle cx="95.3" cy="68.3" r="1.53"/><circle cx="95.4" cy="68.9" r="1.44"/></g>
      <path d={CROC.tail} fill={CROC.g} stroke={CROC.gd} strokeWidth="1"/>
    </g>
  );
}
function CrocFront() {
  const { g, gd, gl, belly } = CROC;
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {/* Cou (relie la tête au corps qui passe derrière Costar) */}
      <path d="M22 101 Q34 98 40 106 L40 124 Q30 128 22 124 Z" fill={g} stroke={gd} strokeWidth="1"/>
      {/* Patte avant griffue */}
      <path d="M30 120 Q28 127 23 128.4 L33 128.4 Q37 125 36.4 119 Z" fill={g} stroke={gd} strokeWidth="1"/>
      <path d="M23.4 128.2 l-1.6 -1.4 M26.4 128.4 l-1.2 -1.8 M29.4 128.4 l-0.8 -1.9" stroke="white" strokeWidth="1"/>
      {/* Mâchoire du bas + intérieur de la gueule + langue */}
      <path d="M32 113 L5 112.6 Q1 113.4 2 117 Q4 120.6 12 120.8 L33 119.4 Z" fill={belly} stroke={gd} strokeWidth="1"/>
      <path d="M32 109.6 L6 106.8 L5.4 112.8 L32 113.4 Z" fill="#7F1D1D"/>
      <path d="M12 111.6 Q18 108.8 26 111.4 Q19 113.2 12 111.6 Z" fill="#F472B6"/>
      {/* Mâchoire du haut : museau long et arrondi, narines */}
      <path d="M36 100 Q30 94.6 20 96.4 L7 99.4 Q1.4 100.8 1.8 104.6 Q2.4 107.6 6 107.4 L33 110.2 Q38 106 36 100 Z" fill={g} stroke={gd} strokeWidth="1"/>
      <path d="M8 101 Q14 99.2 20 99.4" stroke={gl} strokeWidth="1.4" fill="none" opacity="0.8"/>
      <circle cx="5.2" cy="100.6" r="1.6" fill={g} stroke={gd} strokeWidth="0.8"/><circle cx="5.2" cy="100.6" r="0.5" fill={gd}/>
      {/* Dents */}
      <path d="M7.6 107 l1.2 2.4 l1.4 -2.3 l1.3 2.4 l1.4 -2.2 l1.3 2.4 l1.4 -2.2 l1.3 2.4 l1.4 -2.1 l1.3 2.3 l1.4 -2" fill="white" stroke="#E5E7EB" strokeWidth="0.4"/>
      <path d="M8 113.2 l1.3 -2.2 l1.3 2.2 l1.3 -2.2 l1.3 2.2 l1.3 -2.2 l1.3 2.2 l1.3 -2.1 l1.3 2.1" fill="white" stroke="#E5E7EB" strokeWidth="0.4"/>
      {/* Yeux globuleux, sourcils froncés */}
      <circle cx="25" cy="96.6" r="5" fill={g} stroke={gd} strokeWidth="1"/>
      <circle cx="32.4" cy="96" r="4.6" fill={g} stroke={gd} strokeWidth="1"/>
      <circle cx="25" cy="96.4" r="3.3" fill="white"/><circle cx="32.4" cy="95.8" r="3" fill="white"/>
      <circle cx="24.4" cy="96.8" r="1.6" fill="#111827"/><circle cx="31.8" cy="96.2" r="1.5" fill="#111827"/>
      <circle cx="24" cy="96.2" r="0.5" fill="white"/><circle cx="31.4" cy="95.6" r="0.5" fill="white"/>
      <path d="M20.6 92 L28 94 M36.4 91.4 L30.2 93.4" stroke={gd} strokeWidth="1.8"/>
      {/* Écailles sur le cou */}
      <path d="M38 106 l3 -1 l-1 3 M39 112 l3 -0.6 l-1.4 2.8" fill={gd} stroke={gd} strokeWidth="0.6"/>
    </g>
  );
}
// Gros canard colvert assis aux pieds de Costar (Bâle).
function Mallard() {
  return (
    <g transform="translate(94.5 114.6) scale(1.2)" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="0" cy="12" rx="16" ry="1.8" fill="#000" opacity="0.14"/>
      {/* Pattes orange */}
      <path d="M-4 9.6 l-2.6 2.6 l2.6 -0.6 l2.4 0.6 Z M4 9.6 l-2.4 2.6 l2.6 -0.6 l2.4 0.6 Z" fill="#F97316" stroke="#C2410C" strokeWidth="0.5"/>
      {/* Corps gris-blanc, queue noire recourbée */}
      <path d="M-15 2 Q-18 -2 -14 -4 L-10 -3 Q0 -6 10 -2 Q16 2 13 8 Q6 12 -6 11 Q-14 9 -15 2 Z" fill="#E5E7EB" stroke="#6B7280" strokeWidth="0.7"/>
      <path d="M-14 -4 Q-17 -8 -13.6 -9 Q-12.6 -6.4 -12 -4.6" stroke="#111827" strokeWidth="1.4" fill="none"/>
      <path d="M-15 1.6 Q-18 -1.4 -15.6 -3.6 L-12 -3 Z" fill="#111827"/>
      {/* Aile brune + miroir bleu bordé de blanc */}
      <path d="M-11 -1 Q0 -4 8 0 Q4 5 -6 5 Q-11 3.6 -11 -1 Z" fill="#A8A29E" stroke="#78716C" strokeWidth="0.6"/>
      <path d="M-9 1.6 L-2 0.4 L-1.4 2.8 L-8.6 4 Z" fill="#2563EB" stroke="white" strokeWidth="0.6"/>
      {/* Poitrail châtaigne */}
      <path d="M6 -4 Q14 -4 14 3 Q12 7 8 6 Q6 1 6 -4 Z" fill="#7C2D12" stroke="#5B1E0A" strokeWidth="0.6"/>
      {/* Collier blanc + tête verte irisée + bec jaune */}
      <path d="M6.4 -5 Q10.6 -3.6 13.6 -5.6" stroke="white" strokeWidth="1.6" fill="none"/>
      <path d="M7 -5.6 Q6 -10 8 -14 Q11 -18 15 -15.6 Q17 -13 15.6 -9.6 Q14.6 -6.6 13.4 -5.6 Q10 -4.6 7 -5.6 Z" fill="#166534" stroke="#052E16" strokeWidth="0.7"/>
      <path d="M9 -14 Q11.6 -16.4 14 -15" stroke="#4ADE80" strokeWidth="1" fill="none" opacity="0.8"/>
      <path d="M15.4 -12.4 Q20.6 -12.6 21.4 -11 Q20.6 -9.4 15.6 -10 Z" fill="#FACC15" stroke="#A16207" strokeWidth="0.6"/>
      <circle cx="20.4" cy="-11.3" r="0.45" fill="#111827"/>
      <circle cx="12.4" cy="-12.6" r="1.4" fill="white"/><circle cx="12.7" cy="-12.6" r="0.75" fill="#111827"/>
    </g>
  );
}
// Bonnet à poil de garde royal (Londres) — remplace la coiffe portée : haut, bien touffu,
// plumet rouge, jugulaire dorée.
function Bearskin() {
  const tufts = [];
  for (let k = 0; k <= 16; k++) {
    const t = Math.PI * (1 + k / 16);
    tufts.push([58 + 25 * Math.cos(t), 32 + 26 * Math.sin(t) * (Math.sin(t) < 0 ? 1 : 0.2)]);
  }
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M32 52 Q28 30 33 18 Q44 4 58 5 Q72 4 83 18 Q88 30 84 52 Z" fill="#111827"/>
      {tufts.map(([x, y], k) => <circle key={k} cx={x} cy={Math.min(y, 32)} r="3.2" fill="#111827"/>)}
      <path d="M38 14 Q44 6 52 4 M36 26 Q39 22 43 20 M66 8 Q72 11 75 16 M70 26 Q74 26 77 30 M48 18 Q52 15 56 15 M60 30 Q64 28 67 30 M42 38 Q45 35 49 36" stroke="#4B5563" strokeWidth="1.4" fill="none" opacity="0.9"/>
      <path d="M41 14 Q47 9 55 8" stroke="#6B7280" strokeWidth="2.2" fill="none" opacity="0.5"/>
      {/* Plumet rouge sur le côté */}
      <path d="M33 38 Q26 30 29 18 Q31 12 34 10 Q33 20 36 28 Q37 33 35.6 38 Z" fill="#DC2626" stroke="#7F1D1D" strokeWidth="0.7"/>
      <path d="M31 30 Q30 22 33 14" stroke="#FCA5A5" strokeWidth="0.8" fill="none"/>
      {/* Jugulaire dorée (chaînette) */}
      <path d="M36 50 Q37 64 45 71 M80 50 Q79 64 71 71" stroke="#CA8A04" strokeWidth="2.2" fill="none"/>
      <path d="M36 50 Q37 64 45 71 M80 50 Q79 64 71 71" stroke="#FDE047" strokeWidth="1" strokeDasharray="1.2 1.4" fill="none"/>
    </g>
  );
}
// PORTRAIT DE THOMAS dans un cadre en cœur, accroché au mur en haut à droite (mission « Fan-club
// officiel », mégalo assumé). Photo = celle de son compte Google (cf. getFanAvatar) ; inconnue
// sur cet appareil → ses initiales.
const HEART = 'M0 10 C-10 3 -13 -3 -13 -6.5 C-13 -11 -9 -13.5 -6 -13.5 C-3 -13.5 -1 -11.5 0 -9.5 C1 -11.5 3 -13.5 6 -13.5 C9 -13.5 13 -11 13 -6.5 C13 -3 10 3 0 10 Z';
function FanFrame() {
  const avatar = getFanAvatar();
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M95.4 15 L102 3.6 L108.6 15" stroke="#78716C" strokeWidth="0.6" fill="none"/>
      <circle cx="102" cy="3.4" r="1.1" fill="#57534E"/>
      <g transform="translate(102 31)">
        <defs><clipPath id="costar-fan-heart"><path d={HEART}/></clipPath></defs>
        <path d={HEART} transform="scale(1.22)" fill="#DC2626" stroke="#7F1D1D" strokeWidth="0.8"/>
        <path d={HEART} fill="#FCE7F3"/>
        <text x="0" y="1" textAnchor="middle" fontSize="8" fontWeight="800" fill="#BE185D" fontFamily="sans-serif">TC</text>
        {avatar && <image href={avatar} x="-13" y="-14" width="26" height="26" preserveAspectRatio="xMidYMid slice" clipPath="url(#costar-fan-heart)"/>}
        <path d="M-6 -11 Q-9 -9 -9.6 -6" stroke="white" strokeWidth="1.2" fill="none" opacity="0.7"/>
      </g>
    </g>
  );
}

// outfit = { head, eyes, face, mouth, neck, body, waist, hand, feet, extra } : cosmétiques portés, un par catégorie (vestiaire).
export function CostarSvg({ size = 100, className = '', outfit = {} }) {
  const o = outfit || {};
  const leftUp = VOYAGE_HOLDS.includes(o.voyage) || o.hand === 'peace';
  const rightUp = o.hand === 'peace';
  return (
    <svg className={className} width={size} height={size * 130 / 120} viewBox="0 0 120 130" aria-hidden="true">
      {/* Skis plantés DERRIÈRE Costar, même style que la planche (retour Thomas) : spatules relevées,
          dégradé, bande déco, fixations. */}
      {o.extra === 'skis' && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <defs>
            <linearGradient id="costar-ski" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#F43F5E"/><stop offset="0.55" stopColor="#FB923C"/><stop offset="1" stopColor="#FDE68A"/>
            </linearGradient>
          </defs>
          {[[103, -6], [103, 7]].map(([x, a]) => ( // croisés en X, dans le cadre
            <g key={a} transform={`rotate(${a} ${x} 116)`}>
              <path d={`M${x - 3.4} 116 L${x - 3.4} 26 Q${x - 3.4} 17 ${x} 15 Q${x + 3.4} 17 ${x + 3.4} 26 L${x + 3.4} 116 Q${x} 118.6 ${x - 3.4} 116 Z`} fill="url(#costar-ski)" stroke="#9F1239" strokeWidth="0.9"/>
              <path d={`M${x - 3.4} 46 L${x + 3.4} 43 M${x - 3.4} 49.4 L${x + 3.4} 46.4`} stroke="white" strokeWidth="1.1"/>
              <circle cx={x} cy="34" r="1.6" fill="white"/>
              <rect x={x - 4.2} y="82" width="8.4" height="5" rx="1.2" fill="#1F2937"/>
              <rect x={x - 3} y="90" width="6" height="2.6" rx="1" fill="#6B7280"/>
              <path d={`M${x - 1.6} 30 L${x - 1.6} 110`} stroke="white" strokeWidth="0.6" opacity="0.5"/>
            </g>
          ))}
        </g>
      )}
      {o.aura === 'poubelle' && <TrashAuraBack/>}
      {/* Queue (derrière) */}
      <g className="costar-tail">
        <ellipse cx="94" cy="108" rx="23" ry="11" transform="rotate(-28 94 108)" fill="#4A2E17"/>
        <path d="M80 104 L106 98 M82 111 L109 104 M86 117 L110 110 M88 98 L96 121 M97 95 L104 117" stroke="#36210F" strokeWidth="1.2" opacity="0.7"/>
      </g>
      {o.voyage === 'nimes' && <CrocBack/>}
      {/* Planche de surf, plantée DERRIÈRE Costar (accessoire) : large, dégradé lagon, latte centrale,
          soleil couchant + vague, liseré de rail, dérive. */}
      {o.extra === 'surf' && (
        <g transform="rotate(-10 19 76)" strokeLinejoin="round" strokeLinecap="round">
          <defs>
            <linearGradient id="costar-surf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FDE68A"/><stop offset="0.45" stopColor="#5EEAD4"/><stop offset="1" stopColor="#0EA5E9"/>
            </linearGradient>
            <clipPath id="costar-surf-clip"><path d="M19 24 C35 40 36 98 19 124 C2 98 3 40 19 24 Z"/></clipPath>
          </defs>
          <path d="M19 24 C35 40 36 98 19 124 C2 98 3 40 19 24 Z" fill="url(#costar-surf)" stroke="#0E7490" strokeWidth="1.1"/>
          <g clipPath="url(#costar-surf-clip)">
            <circle cx="19" cy="60" r="7.5" fill="#FB923C"/>
            <path d="M0 64 Q6 58 12 64 Q18 70 24 64 Q30 58 38 64 L38 72 L0 72 Z" fill="#0284C7"/>
            <path d="M0 64 Q6 58 12 64 Q18 70 24 64 Q30 58 38 64" stroke="white" strokeWidth="1.2" fill="none"/>
            <path d="M0 92 L38 86 L38 90 L0 96 Z" fill="#F43F5E" opacity="0.9"/>
            <path d="M0 98 L38 92 L38 93.6 L0 99.6 Z" fill="white" opacity="0.9"/>
          </g>
          <path d="M19 26 L19 122" stroke="white" strokeWidth="0.7" opacity="0.7"/>
          <path d="M11.6 42 C8.4 58 8 80 10.4 100" stroke="white" strokeWidth="1.3" fill="none" opacity="0.55"/>
          <path d="M16.6 114 L19 123 L21.4 114 Z" fill="#0E7490"/>
        </g>
      )}
      {/* Bouée canard : arrière de l'anneau (derrière le corps) */}
      {o.waist === 'bouee' && <path d="M22 108 Q58 92 94 108" stroke="#EAB308" strokeWidth="8" fill="none" strokeLinecap="round"/>}
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
      {/* Slip LÉOPARD taille basse (retour Thomas : « il fait le tour des papattes, assez bas sur la
          taille ») : il habille tout le bas du corps sous un élastique noir bas sur les hanches ;
          les pattes sortent des trous de jambes (bordures noires dessinées par-dessus, plus bas). */}
      {o.body === 'slip' && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <defs>
            <clipPath id="costar-slip-clip"><ellipse cx="58" cy="100" rx="33" ry="27"/></clipPath>
          </defs>
          <g clipPath="url(#costar-slip-clip)">
            <path d="M20 107.6 Q58 113.6 96 107.6 L96 135 L20 135 Z" fill="#F0BE5C"/>
            {[[29, 110.6], [39, 112.8], [49, 114.2], [67, 114.2], [77, 112.8], [87, 110.6], [31, 116.6], [40, 117], [49, 118.2], [58, 119.4], [67, 118.2], [76, 117], [85, 114.6], [36, 122.4], [45, 124.6], [58, 125.2], [71, 124.6], [80, 122.4], [53, 121.2], [63, 121.4]].map(([x, y], k) => (
              <g key={k} transform={`translate(${x} ${y}) rotate(${(k * 53) % 180})`}>
                <ellipse cx="0" cy="0" rx="2.3" ry="1.75" fill="#C27424"/>
                <path d="M-2.7 -0.6 Q-2.4 -2.4 -0.6 -2.5 M0.9 -2.4 Q3 -1.8 2.8 0.2 M2.4 1.5 Q0.9 2.8 -0.9 2.3" stroke="#23120A" strokeWidth="1.15" fill="none"/>
              </g>
            ))}
            {[[35.6, 118.6], [62.6, 116], [74.4, 120.6], [49.6, 127.2]].map(([x, y], k) => <circle key={k} cx={x} cy={y} r="0.8" fill="#23120A"/>)}
            <path d="M20 107.6 Q58 113.6 96 107.6 L96 110.8 Q58 116.8 20 110.8 Z" fill="#7A4A12" opacity="0.18"/>
            <path d="M20 105.6 Q58 111.6 96 105.6 L96 108 Q58 114 20 108 Z" fill="#111827"/>
          </g>
          <ellipse cx="58" cy="100" rx="33" ry="27" fill="none" stroke="#5C3510" strokeWidth="0.6" clipPath="url(#costar-slip-clip)"/>
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
      {/* Chemise hawaïenne turquoise à fleurs d'hibiscus, col ouvert, boutons */}
      {o.body === 'hawai' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <defs><clipPath id="costar-shirt-clip"><ellipse cx="58" cy="100" rx="33" ry="27"/></clipPath></defs>
          <g clipPath="url(#costar-shirt-clip)">
            <path d="M20 70 L96 70 L96 112 Q58 120 20 112 Z" fill="#0891B2"/>
            {[[33, 92], [45, 108], [73, 91], [82, 106], [60, 113], [36, 104]].map(([x, y], k) => (
              <g key={k} transform={`translate(${x} ${y}) rotate(${k * 37})`}>
                {[0, 72, 144, 216, 288].map(a => <ellipse key={a} cx="0" cy="-3" rx="2" ry="3.2" fill="#F472B6" transform={`rotate(${a})`}/>)}
                <circle r="1.3" fill="#FDE047"/>
              </g>
            ))}
            {[[40, 88], [70, 100], [52, 116], [87, 96]].map(([x, y], k) => <path key={k} d={`M${x} ${y} q3 -4 7 -1 q-3 4 -7 1 Z`} fill="#22C55E"/>)}
            <path d="M20 112 Q58 120 96 112" stroke="#0E7490" strokeWidth="1.2" fill="none"/>
          </g>
          <polygon points="58,99 47,84 52,82 58,93" fill="#22D3EE" stroke="#0E7490" strokeWidth="0.7"/>
          <polygon points="58,99 69,84 64,82 58,93" fill="#22D3EE" stroke="#0E7490" strokeWidth="0.7"/>
          <circle cx="58" cy="104" r="1" fill="white"/><circle cx="58" cy="110" r="1" fill="white"/>
        </g>
      )}
      {/* Chemise de bûcheron : carreaux rouges et noirs, poches à rabat, boutons */}
      {o.body === 'bucheron' && (
        <g>
          <defs>
            <clipPath id="costar-plaid-clip"><ellipse cx="58" cy="100" rx="33" ry="27"/></clipPath>
            <pattern id="costar-plaid" width="10" height="10" patternUnits="userSpaceOnUse">
              <rect width="10" height="10" fill="#B91C1C"/>
              <rect width="10" height="4" fill="#111827" opacity="0.55"/>
              <rect width="4" height="10" fill="#111827" opacity="0.55"/>
              <path d="M7 0 L7 10 M0 7 L10 7" stroke="#7F1D1D" strokeWidth="0.6"/>
            </pattern>
          </defs>
          <g clipPath="url(#costar-plaid-clip)">
            <path d="M20 70 L96 70 L96 116 Q58 124 20 116 Z" fill="url(#costar-plaid)"/>
          </g>
          <path d="M58 92 L58 118" stroke="#111827" strokeWidth="0.8"/>
          <circle cx="58" cy="99" r="1" fill="#F3F4F6"/><circle cx="58" cy="106" r="1" fill="#F3F4F6"/><circle cx="58" cy="113" r="1" fill="#F3F4F6"/>
          <rect x="41" y="94" width="10" height="9" rx="1" fill="url(#costar-plaid)" stroke="#111827" strokeWidth="0.7"/>
          <rect x="65" y="94" width="10" height="9" rx="1" fill="url(#costar-plaid)" stroke="#111827" strokeWidth="0.7"/>
          <path d="M41 97 L51 97 M65 97 L75 97" stroke="#111827" strokeWidth="0.8"/>
          <polygon points="58,93 49,85 53,83 58,89" fill="#991B1B" stroke="#111827" strokeWidth="0.6"/>
          <polygon points="58,93 67,85 63,83 58,89" fill="#991B1B" stroke="#111827" strokeWidth="0.6"/>
        </g>
      )}
      {/* Bouée canard : avant de l'anneau (rayures rouges) + tête de canard */}
      {o.waist === 'bouee' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 108 Q58 126 94 108" stroke="#FACC15" strokeWidth="9" fill="none"/>
          <path d="M34 115.6 L36 112 M50 119.6 L51 115.6 M66 119.6 L65 115.6 M82 115.6 L80 112" stroke="#EF4444" strokeWidth="4"/>
          <path d="M30 111 Q58 124 86 111" stroke="white" strokeWidth="1.2" fill="none" opacity="0.6"/>
          <path d="M93 109 Q91 96 99 94 Q106 94 105 101" fill="#FACC15" stroke="#CA8A04" strokeWidth="0.8"/>
          <circle cx="100" cy="93" r="6" fill="#FACC15" stroke="#CA8A04" strokeWidth="0.8"/>
          <path d="M105 92 L111 93.5 L105 96 Z" fill="#F97316"/>
          <circle cx="101.6" cy="91.4" r="1.1" fill="#111827"/>
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
      {/* Trous de jambes du slip : bordure noire autour du haut de chaque patte */}
      {o.body === 'slip' && !o.feet && (
        <path d="M34.6 121.4 Q44 116.4 53.4 121.4 M62.6 121.4 Q72 116.4 81.4 121.4" stroke="#111827" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      )}
      {/* Bras au repos — sauf ceux qui sont LEVÉS : souvenir de voyage tenu (gauche) ou peace
          & love (les deux). */}
      {!leftUp && <ellipse cx="40" cy="98" rx="6" ry="8" fill="#6E4521" transform="rotate(20 40 98)"/>}
      {!rightUp && <ellipse cx="76" cy="98" rx="6" ry="8" fill="#6E4521" transform="rotate(-20 76 98)"/>}
      {o.body === 'costard' && (
        <g>
          {!leftUp && <ellipse cx="40" cy="98" rx="6" ry="8" fill="#2B3445" transform="rotate(20 40 98)"/>}
          {!rightUp && <ellipse cx="76" cy="98" rx="6" ry="8" fill="#2B3445" transform="rotate(-20 76 98)"/>}
          {!leftUp && <path d="M33.6 102.5 Q36.5 105 40 104.6" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round"/>}
          {!rightUp && <path d="M82.4 102.5 Q79.5 105 76 104.6" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round"/>}
          {!leftUp && <ellipse cx="36.4" cy="105.6" rx="3.6" ry="3" fill="#6E4521"/>}
          {!rightUp && <ellipse cx="79.6" cy="105.6" rx="3.6" ry="3" fill="#6E4521"/>}
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
      {/* Peace & love, version castor (retour Thomas : « des petites griffes de castor ») : pattes au
          repos, deux petites griffes claires qui dépassent en V. */}
      {/* Guitare électrique rouge en bandoulière (accessoire) + pattes qui la tiennent */}
      {o.extra === 'guitare' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <path d="M34 84 Q58 112 80 118" stroke="#111827" strokeWidth="2" fill="none"/>
          <path d="M50 101 L92 72" stroke="#92400E" strokeWidth="4.4"/>
          <path d="M56 97.2 L57.8 99.6 M62 93 L63.8 95.4 M68 88.8 L69.8 91.2 M74 84.6 L75.8 87 M80 80.4 L81.8 82.8 M86 76.2 L87.8 78.6" stroke="#FDE68A" strokeWidth="0.7"/>
          <path d="M90.4 74 L97.6 66.4 L100 68.4 L94 76 Z" fill="#111827"/>
          <circle cx="96" cy="67.6" r="0.9" fill="#E5E7EB"/><circle cx="97.8" cy="69.6" r="0.9" fill="#E5E7EB"/>
          <path d="M32 106 Q30 96 40 96 Q46 92 52 97 Q58 100 55 106 Q60 114 52 119 Q44 124 36 118 Q28 114 32 106 Z" fill="#DC2626" stroke="#7F1D1D" strokeWidth="0.9"/>
          <path d="M38 104 Q44 100 50 104 Q52 110 46 113 Q40 113 38 108 Z" fill="white"/>
          <rect x="41" y="105" width="6" height="1.6" rx="0.6" fill="#374151" transform="rotate(-34 44 106)"/>
          <rect x="43" y="108.6" width="6" height="1.6" rx="0.6" fill="#374151" transform="rotate(-34 46 109)"/>
          <path d="M44 112 L92 74" stroke="#E5E7EB" strokeWidth="0.45"/>
          <ellipse cx="76" cy="85" rx="5.4" ry="4.4" fill="#6E4521"/>
          <ellipse cx="52" cy="110" rx="5" ry="4.2" fill="#6E4521"/>
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
        {/* Masque de nuit violet, yeux fermés brodés, petits « z » (il dort à moitié) */}
        {o.eyes === 'masque' && (
          <g strokeLinecap="round">
            <path d="M33 60 L28 57 M83 60 L88 57" stroke="#4C1D95" strokeWidth="1.6"/>
            <path d="M34 59 Q35 53 45 53.4 Q52 53.6 58 56.4 Q64 53.6 71 53.4 Q81 53 82 59 Q82.6 70 70 71 Q63 71.2 58 67.4 Q53 71.2 46 71 Q33.4 70 34 59 Z" fill="#7C3AED" stroke="#4C1D95" strokeWidth="1"/>
            <path d="M41.6 62 Q46 66 50.4 62 M65.6 62 Q70 66 74.4 62" stroke="#F5F3FF" strokeWidth="1.3" fill="none"/>
            <path d="M42.6 64.6 L41.6 66.4 M46 65.6 L46 67.6 M49.4 64.6 L50.4 66.4 M66.6 64.6 L65.6 66.4 M70 65.6 L70 67.6 M73.4 64.6 L74.4 66.4" stroke="#F5F3FF" strokeWidth="0.9"/>
            <text x="91" y="60" fontSize="7" fontWeight="800" fill="#7C3AED" fontFamily="sans-serif">z</text>
            <text x="97" y="51" fontSize="9.5" fontWeight="800" fill="#7C3AED" fontFamily="sans-serif">Z</text>
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
        {/* Rose rouge entre les dents : tige et épines, feuille, fleur à droite */}
        {o.mouth === 'rose' && (
          <g strokeLinecap="round" strokeLinejoin="round">
            <path d="M46 84 Q60 87 84 82" stroke="#15803D" strokeWidth="1.8" fill="none"/>
            <path d="M54 85.4 L55 87.6 M70 85 L71 82.8" stroke="#15803D" strokeWidth="1.1"/>
            <path d="M74 84 Q77 89 82 88 Q80 83.4 74 84 Z" fill="#22C55E" stroke="#15803D" strokeWidth="0.6"/>
            <circle cx="88" cy="81" r="6.4" fill="#DC2626" stroke="#7F1D1D" strokeWidth="0.8"/>
            <path d="M88 77 Q92 79 90 83 Q86 85.4 84.6 81.6 Q85 78.6 88 79.4 Q90 80.4 88.6 82" stroke="#7F1D1D" strokeWidth="0.9" fill="none"/>
            <path d="M83 84.4 Q85 87.6 88 87.4 Q91 87.6 93 84.4" stroke="#15803D" strokeWidth="1.4" fill="none"/>
          </g>
        )}
        {/* Coiffe : casque de chantier (défaut), cowboy, Noël, tuque, couronne, citrouille, haut-de-forme,
            licorne, ninja (vestiaire) */}
        {o.voyage === 'londres' && o.head !== 'citrouille' ? <Bearskin/> : o.head === 'citrouille' ? null : o.head === 'hautforme' ? (
          <g>
            <ellipse cx="58" cy="47" rx="30" ry="5.4" fill="#111827"/>
            <rect x="40" y="13" width="36" height="34" rx="2.5" fill="#1F2937"/>
            <ellipse cx="58" cy="13.4" rx="18" ry="3.2" fill="#374151"/>
            <rect x="40" y="37" width="36" height="6.4" fill="#7F1D1D"/>
            <path d="M44 17 L44 35" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.18"/>
            <path d="M30 47.6 Q58 52.6 86 47.6" stroke="#374151" strokeWidth="0.8" fill="none"/>
          </g>
        ) : o.head === 'licorne' ? (
          <g strokeLinecap="round" strokeLinejoin="round">
            <defs>
              <linearGradient id="costar-horn" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="#FDE68A"/><stop offset="0.5" stopColor="#F9A8D4"/><stop offset="1" stopColor="#C4B5FD"/>
              </linearGradient>
            </defs>
            <path d="M31 46 Q58 26 85 46" stroke="#F472B6" strokeWidth="5" fill="none"/>
            <polygon points="51,36 65,36 59,2" fill="url(#costar-horn)" stroke="#DB2777" strokeWidth="0.9"/>
            <path d="M52.6 31 L63.6 28.4 M54 24.6 L62.6 22.4 M55.4 18 L61.6 16.6 M56.8 11.6 L60.6 10.6" stroke="#DB2777" strokeWidth="0.9"/>
            <circle cx="42" cy="37" r="3" fill="#FDE047"/><circle cx="42" cy="37" r="1.2" fill="#F97316"/>
            <circle cx="74" cy="37" r="3" fill="#A78BFA"/><circle cx="74" cy="37" r="1.2" fill="#FDE047"/>
            <polygon transform="translate(80 22) scale(0.4)" fill="#FDE047" points="0,-6 1.2,-1.2 6,0 1.2,1.2 0,6 -1.2,1.2 -6,0 -1.2,-1.2"/>
            <polygon transform="translate(38 20) scale(0.3)" fill="#F9A8D4" points="0,-6 1.2,-1.2 6,0 1.2,1.2 0,6 -1.2,1.2 -6,0 -1.2,-1.2"/>
          </g>
        ) : o.head === 'ninja' ? (
          <g strokeLinecap="round" strokeLinejoin="round">
            <path d="M29.6 43 Q58 36 86.4 43 L86.8 51.6 Q58 44.6 29.2 51.6 Z" fill="#111827"/>
            <path d="M86 45 Q96 40 103 44 Q97 46 92 48 M86 49 Q95 50 100 57 Q93 55 87 52" fill="#111827" stroke="#111827" strokeWidth="1.6"/>
            <circle cx="87" cy="47" r="2.4" fill="#1F2937"/>
            <rect x="50" y="40" width="16" height="8.6" rx="1.6" fill="#9CA3AF" stroke="#4B5563" strokeWidth="0.8"/>
            <circle cx="52" cy="42" r="0.6" fill="#4B5563"/><circle cx="64" cy="42" r="0.6" fill="#4B5563"/>
            <circle cx="52" cy="46.6" r="0.6" fill="#4B5563"/><circle cx="64" cy="46.6" r="0.6" fill="#4B5563"/>
            <polygon transform="translate(58 44.4) scale(0.62)" fill="#D52B1E"
              points="0,-5 1.2,-2.6 2.6,-3.2 2.1,-0.6 4.6,-1.4 3.8,0.4 5,1 2.4,2.2 2.8,3.2 0.4,2.6 0.4,5 -0.4,5 -0.4,2.6 -2.8,3.2 -2.4,2.2 -5,1 -3.8,0.4 -4.6,-1.4 -2.1,-0.6 -2.6,-3.2 -1.2,-2.6"/>
          </g>
        ) : o.head === 'noel' ? (
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
        {/* Grosse chaîne en or (maillons) + médaillon feuille d'érable */}
        {o.neck === 'chaine' && (
          <g>
            {Array.from({ length: 13 }, (_, k) => {
              const t = k / 12, x = 38 + 40 * t, y = 86 + 22 * t * (1 - t) * 2;
              return <ellipse key={k} cx={x} cy={y} rx="2.3" ry="1.5" fill="none" stroke="#EAB308" strokeWidth="1.3" transform={`rotate(${(t - 0.5) * 60} ${x} ${y})`}/>;
            })}
            <circle cx="58" cy="104" r="5.6" fill="#FACC15" stroke="#CA8A04" strokeWidth="1.1"/>
            <polygon transform="translate(58 104.3) scale(0.7)" fill="#B45309"
              points="0,-5 1.2,-2.6 2.6,-3.2 2.1,-0.6 4.6,-1.4 3.8,0.4 5,1 2.4,2.2 2.8,3.2 0.4,2.6 0.4,5 -0.4,5 -0.4,2.6 -2.8,3.2 -2.4,2.2 -5,1 -3.8,0.4 -4.6,-1.4 -2.1,-0.6 -2.6,-3.2 -1.2,-2.6"/>
            <path d="M55 101.6 l1 -1" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.8"/>
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
      {o.voyage && <VoyageFront kind={o.voyage}/>}
      {/* Peace & love : pattes levées en V (la gauche tient le souvenir de voyage s'il y en a un). */}
      {o.hand === 'peace' && (
        <g>
          {(VOYAGE_HOLDS.includes(o.voyage) ? ['R'] : ['L', 'R']).map(side => (
            <ArmSide key={side} side={side}>
              <RaisedArm sleeve={o.body === 'costard' ? '#2B3445' : null}/>
              <PeaceHand/>
            </ArmSide>
          ))}
        </g>
      )}
      {o.cadre === 'fan' && <FanFrame/>}
      {o.aura === 'poubelle' && <TrashAuraFront/>}
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
  // Portrait de Thomas (« Fan-club officiel ») : sa photo arrive avec la présence en direct quand
  // il est connecté → gardée sur cet appareil pour la suite.
  useEffect(() => subscribePresence(list => {
    const t = (list || []).find(m => isFanName(m?.name) && m?.avatar);
    if (t) setFanAvatar(t.avatar);
  }), []);
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
      // Points sans citation exacte = annulés ; note plafonnée par la richesse du rapport (IA) et par
      // son volume écrit (app) → plus de bonne note « gratuite » pour un rapport mince.
      const parsed = parseCostarReply(raw, digest.text, { words: digest.words });
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
        // Éléments de l'affaire dans la corbeille de l'appareil (mission « Ça sent le vécu »).
        let trashed = 0;
        try { if (pj.id) trashed = (await listDeletedItems()).filter(e => e.projectId === pj.id).length; } catch { /* corbeille illisible */ }
        const r = applyReview(loadCostarState(), { note: parsed.note, observations: digest.observations, projectId: pj.id || null, reportId: pj.id ? `${pj.id}|${pj.dateVisite || ''}` : null, trashed,
          withFan: (pj.participants || []).some(isFanParticipant) });
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
              {(review.pertes?.length > 0 || review.plafond) && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, color: '#B91C1C', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#B91C1C', flexShrink: 0 }}/>
                    Où je t'ai enlevé des points
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {review.plafond && (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5, lineHeight: 1.45, color: DA.black }}>
                        <span title="Note plafonnée" style={{ flexShrink: 0, minWidth: 26, textAlign: 'center', fontWeight: 900, fontSize: 12, color: '#92400E', background: '#FEF3C7', borderRadius: 6, padding: '0 4px' }}>≤{review.plafond.value}</span>
                        <span>{review.plafond.raison}</span>
                      </div>
                    )}
                    {(review.pertes || []).map((x, i) => (
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
