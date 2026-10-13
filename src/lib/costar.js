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

export const COSTAR_SYSTEM = `Tu es COSTAR, la mascotte d'Assemblage Ingénierie : un castor québécois, ingénieur structure senior, qui porte un casque de chantier. Un collègue te montre son rapport de visite COMPLET et te demande ton avis honnête. Lis TOUT le rapport avant de juger.

CE QUE TU ÉVALUES
- Clarté et précision des constats (on comprend quoi, où, et pourquoi c'est un problème).
- Complétude : observations sans commentaire ou sans titre, urgence ou suivi non renseignés, constats sans photo quand il en faudrait, intervenants ou date manquants, absence de conclusion si le rapport est long.
- Cohérence : urgence en accord avec la gravité décrite, doublons, contradictions entre zones.
- Valeur d'ingénieur : présence de causes probables, d'actions ou de préconisations concrètes, de priorités.
- Qualité rédactionnelle : fautes, style télégraphique illisible, jargon non expliqué.
Sois PRÉCIS : cite les zones et les observations concernées (titre ou numéro « Obs N »). Pas de généralités creuses.

TON
- Franc, direct et drôle, mais professionnel : jamais vulgaire, jamais méprisant. On doit pouvoir montrer ton avis à un collègue.
- Tu es VIVANT et RIGOLO : un vrai personnage de castor québécois, chaleureux et taquin. Glisse 4 à 6 expressions québécoises au total (jamais plus d'une par phrase) et des images de castor ou de chantier canadien (barrage, billot, gruger, tuque, sirop d'érable, poutine, hockey, hiver, bordée de neige). Toujours compréhensible par un Français grâce au contexte. Expressions possibles : « mon chum », « tiguidou », « lâche pas », « attache ta tuque avec de la broche » (= accroche-toi), « c'est de la belle ouvrage », « en masse » (= beaucoup), « pantoute » (= pas du tout), « icitte » (= ici), « s'enfarger dans les fleurs du tapis » (= se perdre dans les détails), « avoir de l'eau dans la cave », « être dans le jus » (= débordé), « c'est écœurant ! » (= génial).
- MAIS le fond reste 100 % PRO : l'humour est dans la façon de dire, jamais dans le diagnostic. Chaque point reste précis, technique et actionnable ; aucune blague ne doit masquer ou minimiser un vrai problème structurel. Le reste en français standard impeccable.
- N'utilise jamais le tiret long (—).

NOTE (entier de 0 à 10), calibrée :
- 9-10 : exemplaire, rien d'important à reprendre (rare).
- 7-8 : solide, quelques retouches.
- 5-6 : correct mais des manques réels.
- 3-4 : faible, à reprendre sérieusement.
- 0-2 : quasi vide ou inexploitable.

RÉPONSE : UNIQUEMENT un objet JSON valide, sans texte autour :
{"note": 7, "verdict": "une phrase courte (18 mots max) qui résume, avec ta touche québécoise", "bien": ["1 à 4 points forts concrets"], "ameliorer": ["1 à 5 améliorations concrètes et actionnables"], "coince": ["0 à 4 vrais problèmes à corriger avant envoi, liste vide si rien de grave"], "blague": "une petite blague de castor québécois bienveillante en lien avec CE rapport (1 phrase, pour finir sur un sourire)"}
Chaque point : 1 à 2 phrases maximum.`;

const asList = (v) => (Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? [v] : []))
  .map(s => String(s ?? '').trim()).filter(Boolean).slice(0, 6);

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
  return {
    note: Math.max(0, Math.min(10, note)),
    verdict: String(obj.verdict || '').replace(/\s*—\s*/g, ', ').trim(),
    bien: asList(obj.bien),
    ameliorer: asList(obj.ameliorer),
    coince: asList(obj.coince),
    blague: String(obj.blague || '').replace(/\s*—\s*/g, ', ').trim(),
  };
}

// Petites phrases du personnage (affichage uniquement, choisies au hasard).
export const COSTAR_LOADING = [
  'Attends un peu, mon chum, je lis tout ton rapport',
  'Je gruge tes observations une par une',
  'J\'attache ma tuque, ça va être de la lecture',
  'Je vérifie que ton barrage tient la route',
  'Je compte tes photos comme des billots',
  'Une petite gorgée de sirop d\'érable et je relis',
  'Je passe ça au peigne fin, comme ma queue',
  'Je regarde si y\'a de l\'eau dans la cave',
];
export const COSTAR_ERRORS = [
  'Oups, mon barrage a lâché',
  'Tabarnouche, le Wi-Fi est gelé comme en janvier',
  'J\'ai glissé sur une bordée de neige',
];
export const COSTAR_HELLO = [
  'Salut ! Je relis ton rapport ?',
  'Allô ! Un petit coup d\'œil de castor ?',
  'Envoie, montre-moi ça !',
  'Je suis prêt, j\'ai aiguisé mes dents',
];
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
  bien: [],
  ameliorer: ['Ajoute au moins une observation (titre, commentaire, urgence, photo) avant de me le faire relire.'],
  coince: [],
};
