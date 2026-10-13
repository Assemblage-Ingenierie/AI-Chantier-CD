// COSTAR — le castor québécois qui relit le rapport complet et donne un avis honnête + une note
// (demande Thomas, version PC). Ce module ne contient que la logique (pure, testable) :
//   - buildReportDigest : transforme TOUT le rapport de la visite en texte lisible par l'IA ;
//   - COSTAR_SYSTEM     : le personnage, les critères, le format de réponse ;
//   - parseCostarReply  : lecture robuste de la réponse JSON ;
//   - scoreLabel        : libellé + couleur de la note.
// Aucune écriture : l'avis est jetable (rien n'est sauvegardé dans le projet).

import { URGENCE, SUIVI, isBrouillon } from './constants.js';
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

// Tout le rapport, en texte structuré. Rien n'est tronqué tant que le rapport reste raisonnable
// (la consigne est de TOUT lire) ; seuls des commentaires démesurés sont raccourcis au-delà
// d'un plafond global, pour rester dans la fenêtre du modèle.
export function buildReportDigest(projet, { maxChars = 90000 } = {}) {
  const p = projet || {};
  const lines = [];
  lines.push(`PROJET : ${p.nom || '(sans nom)'}`);
  if (p.adresse) lines.push(`Adresse : ${p.adresse}`);
  if (p.maitreOuvrage) lines.push(`Maître d'ouvrage : ${p.maitreOuvrage}`);
  if (p.visiteNom) lines.push(`Visite : ${p.visiteNom}`);
  lines.push(`Date de visite : ${p.dateVisite || 'non renseignée'}`);
  if (p.ingenieur) lines.push(`Ingénieur : ${p.ingenieur}`);

  const parts = p.participants || [];
  lines.push('');
  lines.push(`INTERVENANTS (${parts.length}) :`);
  if (!parts.length) lines.push('- aucun intervenant renseigné');
  parts.forEach(x => {
    const pres = x.presence === 'absent' ? 'absent' : x.presence === 'na' ? 'présence non précisée' : 'présent';
    lines.push(`- ${[x.nom || '(sans nom)', x.poste, x.entreprise].filter(Boolean).join(' · ')} (${pres})`);
  });

  const locs = p.localisations || [];
  let n = 0;
  const longComments = [];
  // CONTRÔLES AUTOMATIQUES : calculés ici (fiables), pour que Costar n'ait pas à compter lui-même
  // (les modèles comptent mal) et cite les bonnes observations.
  const chk = { sansTitre: [], sansCom: [], comCourt: [], sansUrg: [], sansSuivi: [], sansPhoto: [], urgent: [] };
  const titres = new Map();
  {
    let k = 0;
    locs.forEach(l => itemsOf(l).filter(i => i && !isBrouillon(i)).forEach(it => {
      k++;
      const txt = plainText(it.commentaire);
      if (!it.titre?.trim()) chk.sansTitre.push(k);
      if (!txt) chk.sansCom.push(k); else if (txt.length < 40) chk.comCourt.push(k);
      if (!it.urgence || it.urgence === 'rien') chk.sansUrg.push(k);
      if (!it.suivi || it.suivi === 'rien') chk.sansSuivi.push(k);
      if (!(it.photos || []).some(ph => ph && (ph.data || ph.storage_url))) chk.sansPhoto.push(k);
      if (it.urgence === 'haute') chk.urgent.push(k);
      const t = (it.titre || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (t) titres.set(t, [...(titres.get(t) || []), k]);
    }));
  }
  const doublons = [...titres.values()].filter(v => v.length > 1);
  const ref = (arr) => arr.length ? `${arr.length} (Obs ${arr.slice(0, 12).join(', ')}${arr.length > 12 ? '…' : ''})` : '0';
  lines.push('');
  lines.push('CONTRÔLES AUTOMATIQUES (calculés par l\'app, fiables) :');
  lines.push(`- Observations sans titre : ${ref(chk.sansTitre)}`);
  lines.push(`- Sans commentaire : ${ref(chk.sansCom)} ; commentaire très court (< 40 caractères) : ${ref(chk.comCourt)}`);
  lines.push(`- Urgence non renseignée : ${ref(chk.sansUrg)} ; suivi non renseigné : ${ref(chk.sansSuivi)}`);
  lines.push(`- Sans photo : ${ref(chk.sansPhoto)}`);
  lines.push(`- Classées « Urgent » : ${ref(chk.urgent)}`);
  lines.push(`- Titres en double : ${doublons.length ? doublons.map(v => `Obs ${v.join(' = ')}`).join(' ; ') : 'aucun'}`);
  locs.forEach((l) => {
    const items = itemsOf(l).filter(i => i && !isBrouillon(i));
    const hasPlan = !!(l.planId || l.planBg || l.planAnnotations?.paths?.length);
    lines.push('');
    lines.push(`=== ZONE : ${zoneLabel(locs, l) || '(sans nom)'} (${items.length} observation(s)${hasPlan ? ', plan de repérage joint' : ''}) ===`);
    items.forEach((it) => {
      n++;
      const urg = URGENCE[it.urgence]?.label;
      const sui = SUIVI[it.suivi]?.label;
      const photos = (it.photos || []).filter(ph => ph && (ph.data || ph.storage_url)).length;
      const meta = [
        `urgence : ${urg && urg !== '—' ? urg : 'non renseignée'}`,
        `suivi : ${sui && sui !== '—' ? sui : 'non renseigné'}`,
        `${photos} photo(s)`,
        it.plans?.length ? `${it.plans.length} plan(s) d'observation` : null,
      ].filter(Boolean).join(' | ');
      lines.push(`[Obs ${n}] Titre : ${it.titre?.trim() || '(sans titre)'}`);
      lines.push(`  ${meta}`);
      const txt = plainText(it.commentaire);
      const idx = lines.length;
      lines.push(`  Commentaire : ${txt || '(vide)'}`);
      if (txt.length > 1500) longComments.push({ idx, txt });
    });
  });

  if (p.includeTableauRecap !== false) lines.push('', 'Tableau récapitulatif : inclus');
  lines.push('');
  lines.push(p.includeConclusion && plainText(p.conclusion)
    ? `CONCLUSION : ${plainText(p.conclusion)}`
    : 'CONCLUSION : aucune');

  let out = lines.join('\n');
  // Plafond global : on raccourcit d'abord les commentaires les plus longs.
  if (out.length > maxChars && longComments.length) {
    longComments.sort((a, b) => b.txt.length - a.txt.length);
    for (const c of longComments) {
      if (lines.join('\n').length <= maxChars) break;
      lines[c.idx] = `  Commentaire : ${c.txt.slice(0, 1500)}… [suite raccourcie]`;
    }
    out = lines.join('\n');
  }
  return { text: out.slice(0, maxChars), observations: n, zones: locs.length };
}

export const COSTAR_SYSTEM = `Tu es COSTAR, la mascotte d'Assemblage Ingénierie : un castor québécois, ingénieur structure senior (25 ans de chantiers, de la réhab haussmannienne au béton neuf), casque orange vissé sur la tête. Un collègue te montre son rapport de visite COMPLET et te demande ton avis honnête, comme le ferait le meilleur relecteur du bureau. Lis TOUT le rapport avant de juger.

TA MÉTHODE DE RELECTURE (dans cet ordre)
1. Sécurité d'abord : un constat décrit-il un risque pour les personnes ou la stabilité (fissure traversante ou évolutive, corrosion d'armatures avec éclatement, plancher qui fléchit, élément porteur supprimé ou entaillé, chute de matériaux, infiltration sur structure bois…) ? Si oui, vérifie qu'il est classé « Urgent » et qu'une mesure conservatoire est indiquée (étaiement, balisage, purge, interdiction d'accès, avis d'un spécialiste). Un risque sous-classé est TOUJOURS dans « coince ».
2. Constats d'ingénieur : pour chaque désordre important, le lecteur doit savoir QUOI (nature, dimensions : ouverture de fissure en mm, longueur, orientation, flèche, surface), OÙ (zone, élément, niveau, repère plan), DEPUIS QUAND / ÉVOLUTIF ? (témoins, comparaison avec la visite précédente), CAUSE PROBABLE (tassement, retrait, dilatation, surcharge, corrosion, humidité…) et QUOI FAIRE (investigation, réparation, surveillance, qui s'en charge, sous quel délai). Signale précisément ce qui manque.
3. Complétude et cohérence : appuie-toi sur le bloc CONTRÔLES AUTOMATIQUES (chiffres fiables, ne les recompte pas) ; urgence cohérente avec la gravité décrite, doublons, contradictions entre zones, intervenants ou date manquants, conclusion absente sur un rapport long.
4. Rédaction : fautes, style télégraphique illisible, jargon non expliqué, formulations floues (« à surveiller » sans dire quoi ni comment, « RAS » sur un désordre visible, « voir photo » à la place d'une description).
Sois PRÉCIS : cite les zones et les observations (« Obs N » ou titre) ; quand tu critiques une phrase, cite-la entre guillemets. Zéro généralité creuse du genre « ajoute plus de détails ». Si quelque chose est bien fait, dis-le aussi précisément.

TON
- Franc, direct et VRAIMENT drôle, mais professionnel : jamais vulgaire, jamais méprisant. On doit pouvoir montrer ton avis à un collègue, et il doit sourire en le lisant.
- Tu es un vrai personnage : castor québécois chaleureux, taquin, un brin cabotin, fier de ses barrages. Glisse 5 à 8 expressions québécoises au total (jamais plus d'une par phrase) et des images de castor ou de chantier canadien (barrage, billot, gruger, queue en truelle, tuque, sirop d'érable, poutine, hockey, Zamboni, cabane à sucre, bordée de neige, nids-de-poule, orignal). Toujours compréhensible par un Français grâce au contexte. Exemples : « mon chum », « tiguidou », « lâche pas », « attache ta tuque avec de la broche » (= accroche-toi), « c'est de la belle ouvrage », « en masse » (= beaucoup), « pantoute » (= pas du tout), « icitte » (= ici), « s'enfarger dans les fleurs du tapis » (= se perdre dans les détails), « avoir de l'eau dans la cave », « être dans le jus » (= débordé), « c'est écœurant ! » (= génial), « ça va faire ! » (= ça suffit), « niaiser » (= perdre son temps), « tire-toi une bûche » (= installe-toi), « une vraie job de bras » (= travail bâclé), « avoir son voyage » (= en avoir assez), « c'est pas un cadeau » (= c'est pénible), « au boutte » (= génial), « jaser » (= discuter), « faire simple » (= agir bêtement).
- L'humour est dans les images et les comparaisons tirées DU RAPPORT (ex. « ta fissure de 3 mm est plus large que mon sourire », « Obs 4 a autant de détails qu'un barrage a de portes coupe-feu »). Évite les blagues génériques.
- MAIS le fond reste 100 % PRO : l'humour est dans la façon de dire, jamais dans le diagnostic. Chaque point reste précis, technique et actionnable ; aucune blague ne doit masquer ou minimiser un vrai problème structurel. Le reste en français standard impeccable.
- N'utilise jamais le tiret long (—).

NOTE (entier de 0 à 10), calibrée et exigeante :
- 9-10 : exemplaire, prêt à envoyer tel quel (rare).
- 7-8 : solide, quelques retouches.
- 5-6 : correct mais des manques réels.
- 3-4 : faible, à reprendre sérieusement.
- 0-2 : quasi vide ou inexploitable.
Un risque pour la sécurité mal classé ou sans mesure conservatoire plafonne la note à 5.

RÉPONSE : UNIQUEMENT un objet JSON valide, sans texte autour :
{"note": 7, "verdict": "une phrase courte et punchy (20 mots max) qui résume, avec ta touche québécoise", "bien": ["1 à 4 points forts concrets"], "ameliorer": ["2 à 6 améliorations concrètes et actionnables, chacune avec l'observation visée"], "coince": ["0 à 4 vrais problèmes à corriger AVANT envoi, liste vide si rien de grave"], "priorite": "LA chose à faire en premier avant d'envoyer (1 phrase)", "reecriture": {"obs": "Obs N ou titre de l'observation la plus faible", "avant": "la phrase actuelle, citée telle quelle", "apres": "ta version réécrite, complète et professionnelle (sans inventer de mesure : mets [à compléter] si une donnée manque)"}, "blague": "une blague de castor québécois bienveillante et vraiment drôle, en lien avec CE rapport (1 à 2 phrases, pour finir sur un sourire)"}
Chaque point : 1 à 2 phrases maximum. Si aucune observation n'a de texte à réécrire, mets "reecriture": null.`;

const asList = (v) => (Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? [v] : []))
  .map(s => String(s ?? '').trim()).filter(Boolean).slice(0, 6);

const clean = (v) => (typeof v === 'string' ? v : '').replace(/\s*—\s*/g, ', ').trim();

// Lit la réponse du modèle (JSON pur, ou JSON entouré de texte / de balises ```).
export function parseCostarReply(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.replace(/```(?:json)?/gi, '').trim();
  let obj = null;
  try { obj = JSON.parse(s); } catch {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { obj = JSON.parse(s.slice(a, b + 1)); } catch { obj = null; } }
  }
  if (!obj || typeof obj !== 'object') return null;
  const note = Math.round(Number(obj.note));
  if (!Number.isFinite(note)) return null;
  const r = obj.reecriture && typeof obj.reecriture === 'object' ? obj.reecriture : null;
  const rw = r ? { obs: clean(r.obs), avant: clean(r.avant), apres: clean(r.apres) } : null;
  return {
    note: Math.max(0, Math.min(10, note)),
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
  'Je compte tes photos comme des billots',
  'Une petite gorgée de sirop d\'érable et je relis',
  'Je passe ça au peigne fin, comme ma queue',
  'Je regarde si y\'a de l\'eau dans la cave',
  'Je mesure tes fissures avec ma dent de devant',
  'Je tapote les poutres avec ma queue, ça sonne creux ou pas',
  'Je sors ma lampe frontale, y\'a des recoins sombres icitte',
  'Je relis une zone, je pense que j\'ai vu un orignal passer',
  'Je cherche les causes probables sous les billots',
  'Je vérifie que tes urgences sont vraiment urgentes',
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
  'Je vérifie tes plans de repérage, un castor se perd jamais',
  'Je consulte mon vieux chum l\'Eurocode',
  'Je mâchonne ta phrase la plus longue, elle est coriace',
  'Je check si tes photos montrent bien ce que tu dis',
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
  ameliorer: ['Ajoute au moins une observation (titre, commentaire, urgence, photo) avant de me le faire relire.'],
  coince: [],
};
