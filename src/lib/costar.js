// COSTAR — le castor québécois qui relit le rapport complet et donne un avis honnête + une note
// (demande Thomas, version PC). Ce module ne contient que la logique (pure, testable) :
//   - buildReportDigest : transforme TOUT le rapport de la visite en texte lisible par l'IA ;
//   - COSTAR_SYSTEM     : le personnage, les critères, le format de réponse ;
//   - parseCostarReply  : lecture robuste de la réponse JSON ;
//   - scoreLabel        : libellé + couleur de la note.
// Aucune écriture : l'avis est jetable (rien n'est sauvegardé dans le projet).

import { isBrouillon } from './constants.js';
import { zoneLabel } from './zoneGroups.js';

// Texte brut d'un commentaire riche (HTML / markdown léger), sans images collées.
export function plainText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<img[^>]*>/gi, ' [image] ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const itemsOf = (l) => (l?.sections?.length ? l.sections.flatMap(s => s.items || []) : (l?.items || []));

// Observations qui figurent dans le rapport (hors brouillons).
export function reportItems(projet) {
  return (projet?.localisations || []).flatMap(l => itemsOf(l).filter(i => i && !isBrouillon(i)));
}

// Le CONTENU du rapport, en texte structuré : uniquement ce que l'ingénieur a ÉCRIT (zones,
// titres, commentaires, conclusion). Volontairement SANS les champs de formulaire (présences,
// urgence, suivi, nombre de photos, date…) : Costar juge le fond, pas les cases cochées
// (demande Thomas 13/10/2026). Rien n'est tronqué tant que le rapport reste raisonnable ; seuls
// des commentaires démesurés sont raccourcis au-delà d'un plafond global (fenêtre du modèle).
export function buildReportDigest(projet, { maxChars = 45000 } = {}) {
  const p = projet || {};
  const lines = [];
  lines.push(`PROJET : ${p.nom || '(sans nom)'}`);
  if (p.adresse) lines.push(`Adresse : ${p.adresse}`);

  const locs = p.localisations || [];
  let n = 0;
  let words = 0; // mots RÉELLEMENT écrits (titres, commentaires, conclusion) → plafond de volume
  const countWords = (t) => (String(t || '').match(/[\p{L}\p{N}]+/gu) || []).length;
  const longComments = [];
  locs.forEach((l) => {
    const items = itemsOf(l).filter(i => i && !isBrouillon(i));
    lines.push('');
    lines.push(`=== ZONE : ${zoneLabel(locs, l) || '(sans nom)'} ===`);
    items.forEach((it) => {
      // Seul ce qui est ÉCRIT compte : pas de « (sans titre) » ni « (pas de texte) » à
      // reprocher ; une observation totalement vide n'est pas envoyée du tout.
      const titre = it.titre?.trim() || '';
      const txt = plainText(it.commentaire);
      if (!titre && !txt) return;
      n++;
      words += countWords(titre) + countWords(txt);
      lines.push(titre ? `[Obs ${n}] ${titre}` : `[Obs ${n}]`);
      if (txt) {
        const idx = lines.length;
        lines.push(`  ${txt}`);
        if (txt.length > 1500) longComments.push({ idx, txt });
      }
    });
  });

  const concl = p.includeConclusion ? plainText(p.conclusion) : '';
  if (concl) { lines.push(''); lines.push(`CONCLUSION : ${concl}`); words += countWords(concl); }

  let out = lines.join('\n');
  // Plafond global : on raccourcit d'abord les commentaires les plus longs.
  if (out.length > maxChars && longComments.length) {
    longComments.sort((a, b) => b.txt.length - a.txt.length);
    for (const c of longComments) {
      if (lines.join('\n').length <= maxChars) break;
      lines[c.idx] = `  ${c.txt.slice(0, 1500)}… [suite raccourcie]`;
    }
    out = lines.join('\n');
  }
  return { text: out.slice(0, maxChars), observations: n, zones: locs.length, words };
}

// Consigne COMPACTE (retour Thomas 20/10 : « Costar met du temps et bouffe mon quota gratuit ») :
// ~45 % plus courte que la v1, mêmes règles de notation (barème, interdits, preuve par citation),
// réponse plafonnée (listes courtes, phrases d'une ligne) → moins de tokens en entrée ET en sortie.
export const COSTAR_SYSTEM = `Tu es COSTAR, mascotte d'Assemblage Ingénierie : castor québécois, ingénieur structure senior (25 ans de chantiers), casque orange. Un collègue te montre les textes de son rapport de visite de DIAGNOSTIC et veut ton avis honnête sur le fond. Lis tout avant de juger.

CONTEXTE : constats visuels, souvent sans mesure ni sondage. N'exige pas de mesurer, chiffrer, dimensionner ou sonder ; ne suppose pas un désordre plus grave que ce qui est écrit ; n'invente aucun risque.

TU JUGES UNIQUEMENT LE FOND DES TEXTES (titres, commentaires, conclusion). Tu ne vois pas les champs de l'application (présences, urgence, suivi, photos, date, plans, mise en page) : n'en parle jamais, ne demande jamais de « cocher » ou « remplir ».

MÉTHODE
1. Que faire : chaque désordre décrit dit-il quoi faire (réparer, surveiller en disant quoi, consulter un spécialiste, rien à prévoir) ? Un risque pour les personnes ou la stabilité dit-il quoi faire tout de suite (étaiement, balisage, purge, interdiction d'accès) ? C'est l'essentiel.
2. Rédaction : fautes, phrases incompréhensibles, formulations floues qui empêchent d'agir (« à surveiller » sans dire quoi, « voir photo » au lieu de décrire, « reprendre » sans dire comment).
3. Erreurs manifestes : affirmation technique clairement fausse ou contradiction nette entre deux textes. Dans le doute, ce n'est pas une erreur.
4. Suggestions (jamais pénalisées, « tu pourrais… ») : dimension, localisation, cause probable, témoin, délai, investigation utile, seulement si ça apporte vraiment.
Ne reproche jamais : titre absent, observation courte, zone vide, conclusion absente, mise en forme, absence de chiffrage ou de mesures.
Sois précis : cite « Obs N » ou le titre, et la phrase critiquée entre guillemets. Zéro généralité creuse.

TON : franc, direct, vraiment drôle mais professionnel (jamais vulgaire ni méprisant). Castor québécois chaleureux et taquin : 4 à 6 expressions québécoises au total, compréhensibles par le contexte (mon chum, tiguidou, lâche pas, attache ta tuque avec de la broche, c'est de la belle ouvrage, pantoute, icitte, une vraie job de bras, être dans le jus, c'est écœurant). Images de castor et de chantier canadien (barrage, billot, gruger, tuque, sirop d'érable, poutine, Zamboni). L'humour vient de comparaisons tirées DU RAPPORT ; le fond reste 100 % pro et ne minimise jamais un vrai problème. N'utilise jamais le tiret long (—).

SOIS EXIGEANT, DUR MAIS JUSTE : une bonne note se MÉRITE par le contenu. N'hésite pas à mettre une mauvaise note à un rapport pauvre. Repères : quasi vide = 0 à 1 ; très mince = 2 à 3 ; sommaire = 4 à 5 ; correct = 6 ; bon = 7 ; très bon = 8 ; 9-10 = exceptionnel (chaque désordre décrit, localisé, ampleur, cause probable, préconisation claire et hiérarchisée, conclusion utile). Un rapport sans faute mais mince ne vaut PAS une bonne note. Tes conseils restent précis, utiles et bienveillants.

PLAFOND DE VALEUR ("plafond", 0 à 10) : la note maximale que mérite la RICHESSE du rapport, même sans aucune faute. 10 = complet et actionnable ; 8 = bon mais il manque des précisions utiles ; 6 = correct ; 4 = constats sommaires, préconisations génériques ; 2 = très peu de contenu exploitable ; 0 = quasi vide. Justifie-le en une phrase dans "raison_plafond" (ce qui manque pour viser plus haut).

POINTS PERDUS : pars de 10 et retire des points UNIQUEMENT pour (la note finale = le plus bas entre 10 moins le total de "points_perdus" et le plafond) :
- risque pour les personnes ou la stabilité décrit sans dire quoi faire tout de suite : -2 ;
- désordre décrit sans dire quoi faire : -1 par cas, -3 au plus en tout ;
- formulation floue qui empêche de comprendre ou d'agir : -1 ;
- fautes d'orthographe ou de grammaire : -1 si plusieurs, -2 si elles gênent vraiment la lecture ;
- erreur technique manifeste ou contradiction nette : -1 à -2.
INTERDIT de retirer des "points_perdus" pour : manque de précision (dimensions, mesures, cause, témoins, délais, investigations), chiffrage, titre manquant, observation courte, longueur, conclusion absente, mise en page, champs de formulaire, photos ; le manque de contenu se reflète dans le PLAFOND, pas dans les points perdus. Regroupe un même défaut répété en UNE ligne. Rapport clair, sans faute, qui dit quoi faire → liste vide ; la note est alors celle du plafond.
PREUVE : chaque retrait cite dans "citation" l'extrait du rapport COPIÉ MOT POUR MOT (4 à 15 mots, même orthographe et ponctuation), sinon il est annulé. Pas de citation exacte possible → pas de retrait. Même rapport → toujours la même note.

RÉPONSE COURTE : UNIQUEMENT un objet JSON valide, sans texte autour, chaque point en UNE phrase :
{"plafond":7,"raison_plafond":"ce qui manque pour viser plus haut","points_perdus":[{"points":1,"raison":"Obs N : le défaut précis","citation":"extrait exact du rapport"}],"verdict":"phrase punchy de 15 mots max, touche québécoise","bien":["1 à 3 points forts concrets"],"ameliorer":["0 à 3 suggestions « tu pourrais… » avec l'observation visée"],"coince":["0 à 2 vrais problèmes à corriger avant envoi"],"priorite":"LA chose à faire avant d'envoyer","reecriture":{"obs":"Obs N","avant":"la phrase actuelle citée","apres":"ta version, sans inventer de mesure ([à compléter] si une donnée manque)"},"blague":"une phrase de castor québécois, drôle et bienveillante, sur CE rapport"}
Si rien à réécrire : "reecriture": null.`;

// PLAFOND DE VOLUME (retour Thomas 21/10 : « 9/10 sur un rapport de 9 lignes, trop généreux ;
// si y'a rien, y'a rien ») : un rapport mince ne peut pas avoir une bonne note, même sans faute.
// Calculé par l'app (pas par l'IA) sur le nombre de mots réellement écrits → stable et explicable.
// Barème DUR (Thomas : « un rapport de 5 mots doit avoir 0 ; n'hésite pas à mettre de mauvaises notes »).
export const VOLUME_CAPS = [[15, 0], [30, 1], [60, 2], [100, 3], [160, 4], [250, 5], [350, 6], [500, 7], [700, 8], [900, 9]];
export function volumeCap(words) {
  if (!Number.isFinite(words)) return 10;
  for (const [max, cap] of VOLUME_CAPS) if (words < max) return cap;
  return 10;
}

// Clé de cache d'un avis : même texte de rapport + même moteur → même avis (temperature basse,
// consigne « même rapport → même note »). Évite de repayer une relecture d'un rapport inchangé.
export function costarCacheKey(text, engine = '') {
  let h = 5381;
  const s = `v3\u0001${engine}\u0001${text || ''}`; // v3 : barème dur (les anciens avis ne resservent pas)
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${s.length.toString(36)}-${h.toString(36)}`;
}

const asList = (v) => (Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? [v] : []))
  .map(s => String(s ?? '').trim()).filter(Boolean).slice(0, 6);

const clean = (v) => (typeof v === 'string' ? v : '').replace(/\s*—\s*/g, ', ').trim();

// Normalisation pour comparer une citation au rapport (apostrophes, guillemets, espaces, casse).
const norm = (t) => String(t || '').toLowerCase()
  .replace(/[’‘`´]/g, "'").replace(/[«»“”"]/g, '').replace(/…/g, '...')
  .replace(/\s+/g, ' ').trim();
// La citation figure-t-elle dans le rapport ? (morceaux séparés par « … » acceptés)
export function citationInReport(citation, sourceNorm) {
  const parts = norm(citation).split('...').map(x => x.replace(/^[\s.,;:!?'()-]+|[\s.,;:!?'()-]+$/g, '')).filter(x => x.length >= 3);
  return parts.length > 0 && parts.every(x => sourceNorm.includes(x));
}

// Lit la réponse du modèle (JSON pur, ou JSON entouré de texte / de balises ```).
// `source` (texte envoyé à l'IA) : si fourni, un point retiré dont la citation n'existe pas
// dans le rapport est ANNULÉ (garde-fou contre la sur-interprétation, retour Thomas : « j'ai
// corrigé mes fautes, j'étais à 9 et il m'a mis 5 »).
// opts.words : nombre de mots écrits (buildReportDigest) → plafond de volume appliqué par l'app.
export function parseCostarReply(raw, source = null, opts = {}) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.replace(/```(?:json)?/gi, '').trim();
  let obj = null;
  try { obj = JSON.parse(s); } catch {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { obj = JSON.parse(s.slice(a, b + 1)); } catch { obj = null; } }
  }
  if (!obj || typeof obj !== 'object') return null;
  // Points retirés, chacun justifié : la note = 10 − total (cohérente avec ce qui est affiché).
  const srcN = source != null ? norm(source) : null;
  const pertes = Array.isArray(obj.points_perdus)
    ? obj.points_perdus.map(x => ({ points: Math.max(1, Math.min(3, Math.round(Number(x?.points) || 0))), raison: clean(x?.raison), citation: clean(x?.citation) }))
        .filter(x => x.raison && (srcN == null || citationInReport(x.citation, srcN))).slice(0, 8)
    : null;
  const brute = pertes ? 10 - pertes.reduce((t, x) => t + x.points, 0) : Math.round(Number(obj.note));
  if (!Number.isFinite(brute)) return null;
  // Plafonds : valeur jugée par l'IA (justifiée) et volume écrit (calculé ici). Le plus bas l'emporte.
  const pIA = obj.plafond != null && Number.isFinite(Number(obj.plafond)) ? Math.max(0, Math.min(10, Math.round(Number(obj.plafond)))) : 10;
  const pVol = volumeCap(opts.words);
  let note = brute;
  let plafond = null;
  if (Math.min(pIA, pVol) < brute) {
    note = Math.min(pIA, pVol);
    plafond = pVol <= pIA
      ? { value: pVol, raison: `Rapport trop mince (${opts.words} mots écrits) : note plafonnée à ${pVol}/10. Étoffe tes observations (localisation, ampleur, cause probable, quoi faire) pour viser plus haut.` }
      : { value: pIA, raison: clean(obj.raison_plafond) || `Contenu encore sommaire : note plafonnée à ${pIA}/10.` };
  }
  const r = obj.reecriture && typeof obj.reecriture === 'object' ? obj.reecriture : null;
  const rw = r ? { obs: clean(r.obs), avant: clean(r.avant), apres: clean(r.apres) } : null;
  return {
    note: Math.max(0, Math.min(10, note)),
    pertes: pertes || [],
    plafond,
    verdict: String(obj.verdict || '').replace(/\s*—\s*/g, ', ').trim(),
    bien: asList(obj.bien),
    ameliorer: asList(obj.ameliorer),
    coince: asList(obj.coince),
    priorite: clean(obj.priorite),
    reecriture: rw && rw.apres ? rw : null,
    blague: clean(obj.blague),
  };
}

// Petites phrases du personnage (affichage uniquement, choisies au hasard).
export const COSTAR_LOADING = [
  'Attends un peu, mon chum, je lis tout ton rapport',
  'Je gruge tes observations une par une',
  'J\'attache ma tuque avec de la broche, ça va être de la lecture',
  'Je vérifie que ton barrage tient la route',
  'Je pèse tes diagnostics comme des billots',
  'Une petite gorgée de sirop d\'érable et je relis',
  'Je passe ça au peigne fin, comme ma queue',
  'Je regarde si y\'a de l\'eau dans la cave',
  'Je mesure tes fissures avec ma dent de devant',
  'Je tapote les poutres avec ma queue, ça sonne creux ou pas',
  'Je sors ma lampe frontale, y\'a des recoins sombres icitte',
  'Je relis une zone, je pense que j\'ai vu un orignal passer',
  'Je cherche les causes probables sous les billots',
  'Je vérifie que tes causes probables tiennent debout',
  'Je me tire une bûche, c\'est un gros rapport',
  'J\'ajuste mon casque, je rentre dans le vif du sujet',
  'Je compare tes titres, j\'ai une impression de déjà-vu',
  'Je chausse mes raquettes pour traverser tes commentaires',
  'Je fais un petit tour de Zamboni sur ta rédaction',
  'Je cherche le témoin plâtre, y\'en a-tu un ?',
  'Je calcule la flèche de ton plancher à l\'œil de castor',
  'Je vérifie qui fait quoi et pour quand',
  'Je goûte ta conclusion, j\'espère qu\'elle est sucrée comme de la tire',
  'Je range tes observations comme des bûches pour l\'hiver',
  'Je relis une deuxième fois, au cas où',
  'Je fais le tour du chantier avec mes bottes de pluie',
  'Je traque les « à surveiller » qui disent pas quoi surveiller',
  'Je consulte mon vieux chum l\'Eurocode',
  'Je mâchonne ta phrase la plus longue, elle est coriace',
  'Je check si tes préconisations sont à la hauteur du désordre',
  'J\'écoute la structure, elle me raconte des affaires',
  'Je pèse chaque mot comme une charge permanente',
  'Ça avance, je suis rendu à la moitié du barrage',
  'Presque fini, je peaufine mon verdict',
];
export const COSTAR_ERRORS = [
  'Oups, mon barrage a lâché',
  'Tabarnouche, le Wi-Fi est gelé comme en janvier',
  'J\'ai glissé sur une bordée de neige',
  'Ma tuque m\'est tombée sur les yeux',
  'Un orignal s\'est couché sur le câble réseau',
  'Le moteur IA hiberne comme un ours en février',
  'J\'ai grugé le mauvais fil, désolé',
  'Ma cabane à sucre a sauté les plombs',
  'Le serveur fait la file au Tim Hortons',
  'J\'ai pogné un nid-de-poule sur l\'autoroute de l\'info',
  'La Zamboni est passée sur mes notes',
  'Mon sirop d\'érable a figé dans les tuyaux',
];
export const COSTAR_HELLO = [
  'Salut ! Je relis ton rapport ?',
  'Allô ! Un petit coup d\'œil de castor ?',
  'Envoie, montre-moi ça !',
  'Je suis prêt, j\'ai aiguisé mes dents',
  'Tire-toi une bûche, je relis ton rapport',
  'Un rapport à gruger ? Je suis ton castor',
  'Avant d\'envoyer, laisse-moi jaser avec ton rapport',
  'J\'ai mon casque, j\'ai mes lunettes, go !',
  'Je relis plus vite qu\'un castor abat un bouleau',
  'Tu veux une note ? Je suis sévère mais juste',
];
// Petite réaction selon la note, affichée sous le score.
export const COSTAR_SCORE_QUIPS = {
  top: [
    'C\'est de la belle ouvrage, mon chum !',
    'C\'est écœurant ! J\'en ai la queue qui frétille.',
    'Au boutte ! Je l\'encadre dans ma cabane.',
    'Même ma mère castor aurait rien à redire.',
  ],
  good: [
    'Tiguidou, quelques coups de dents et c\'est parfait.',
    'Solide comme un barrage en béton armé.',
    'Belle job, lâche pas, t\'es presque au sommet.',
    'Ça tient debout, il reste juste à poncer les échardes.',
  ],
  mid: [
    'Correct, mais y\'a de l\'eau dans la cave.',
    'Ça se tient, mais faut resserrer les boulons.',
    'On est sur la bonne piste de ski, faut juste éviter les sapins.',
    'Pas pire, mais mon barrage fuit à deux trois places.',
  ],
  low: [
    'Attache ta tuque avec de la broche, on a du travail.',
    'C\'est une vraie job de bras, on recommence ensemble ?',
    'Ton rapport est maigre comme un castor en avril.',
    'Ouf, même un orignal y verrait pas clair.',
  ],
};
export const scoreQuip = (note) => pick(note >= 9 ? COSTAR_SCORE_QUIPS.top : note >= 7 ? COSTAR_SCORE_QUIPS.good : note >= 5 ? COSTAR_SCORE_QUIPS.mid : COSTAR_SCORE_QUIPS.low);
// Erreur technique → explication claire (le détail technique reste affiché à côté).
export function costarErrorHint(msg) {
  const m = String(msg || '');
  if (/non configuré/i.test(m)) return 'Le moteur choisi dans les Paramètres n\'est pas branché sur le serveur : j\'ai essayé un autre moteur, sans succès.';
  if (/quota/i.test(m)) return 'Le moteur IA a atteint son quota gratuit : réessaie dans une minute, ou change de moteur dans les Paramètres.';
  if (/timeout|504|ne répond pas|surcharge/i.test(m)) return 'Le moteur IA est débordé (dans le jus !) : réessaie dans un instant.';
  if (/coupée|illisible/i.test(m)) return 'J\'ai reçu une réponse incomplète : réessaie, ça passe d\'habitude du 2e coup.';
  if (/réseau|network|failed to fetch/i.test(m)) return 'Pas de connexion internet : vérifie ton réseau.';
  return null;
}
export const ENGINE_NAMES = { gemini: 'Gemini', mistral: 'Mistral', claude: 'Claude' };
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function scoreLabel(note) {
  if (note >= 10) return { label: 'Parfait', color: '#15803D', bg: '#DCFCE7' };
  if (note >= 8)  return { label: 'Très bien', color: '#15803D', bg: '#DCFCE7' };
  if (note >= 6)  return { label: 'Correct', color: '#A16207', bg: '#FEF9C3' };
  if (note >= 4)  return { label: 'Peut mieux faire', color: '#C2410C', bg: '#FFEDD5' };
  return { label: 'Pas fameux', color: '#B91C1C', bg: '#FEE2E2' };
}

// Avis local (sans IA) quand il n'y a rien à relire.
export const EMPTY_REVIEW = {
  note: 0,
  verdict: 'Ton rapport est vide, mon chum ! Même mon barrage a plus de contenu.',
  blague: 'Un rapport vide, c\'est comme une cabane à sucre sans sirop : ça sent bon le bois, mais on repart le ventre creux.',
  bien: [],
  ameliorer: ['Écris au moins une observation avant de me la faire relire, j\'ai rien à gruger.'],
  coince: [],
};
