// SYNTHÈSE DES DÉSORDRES ET PRÉCONISATIONS (tableau récapitulatif v2 — demande Thomas 24/11 :
// « un récap point par point des problèmes et la solution adéquate à côté, super concis »).
//
// Avant : une ligne par observation, résumée isolément → lignes qui ne sont pas des désordres
// (présentation, RAS, local non visité), doublons, solutions vides (la préconisation était écrite
// ailleurs). Ici : UNE analyse de tout le rapport → points DISTINCTS, regroupés, triés par priorité.
//
// Stockage (aucune migration) : dans la liste existante `tableauRecap` de la visite :
//   • { itemId:'__synth', mode:'synth', at, ignored:[…] } — le tableau est en mode synthèse ;
//     `ignored` = désordres supprimés à la main (l'IA ne les repropose pas) ;
//   • { itemId:'synth_…', isCustom:true, synth:true, zone, titre, solution, urgence, edited }.
// Régénérer garde les lignes modifiées à la main (edited) et remplace les autres.

import { isBrouillon } from './constants.js';
import { plainText } from './costar.js';
import { zoneLabel } from './zoneGroups.js';

export const SYNTH_FLAG = '__synth';
const URG_LABEL = { haute: 'Urgent', moyenne: 'À planifier', basse: 'Mineur' };
const PRIO_TO_URG = { urgent: 'haute', haute: 'haute', planifier: 'moyenne', 'a planifier': 'moyenne', 'à planifier': 'moyenne', moyenne: 'moyenne', mineur: 'basse', basse: 'basse' };
const itemsOf = (l) => (l?.sections?.length ? l.sections.flatMap(s => s.items || []) : (l?.items || []));

export const synthFlag = (recap) => (recap || []).find(r => r?.itemId === SYNTH_FLAG && r.mode === 'synth') || null;
export const isSynthMode = (recap) => !!synthFlag(recap);

// Texte envoyé à l'IA : zones, observations (titre, urgence saisie, texte), conclusion.
// Les observations « faites » (suivi = fait) et les brouillons ne sont pas des points à traiter.
export function buildRecapDigest(localisations, { conclusion = '', maxChars = 40000 } = {}) {
  const locs = localisations || [];
  const lines = [];
  for (const l of locs) {
    const items = itemsOf(l).filter(i => i && !isBrouillon(i) && i.suivi !== 'fait');
    const body = [];
    for (const it of items) {
      const titre = (it.titre || '').trim();
      const txt = plainText(it.commentaire);
      if (!titre && !txt) continue;
      body.push(`- ${titre || '(sans titre)'} [urgence saisie : ${URG_LABEL[it.urgence] || 'non précisée'}]${txt ? `\n  ${txt}` : ''}`);
    }
    if (body.length) { lines.push(`ZONE : ${zoneLabel(locs, l) || l.nom || '(sans nom)'}`); lines.push(...body); lines.push(''); }
  }
  const concl = plainText(conclusion);
  if (concl) lines.push(`CONCLUSION : ${concl}`);
  return lines.join('\n').slice(0, maxChars);
}

export const RECAP_SYSTEM = `Tu es ingénieur structure senior. On te donne le texte d'un rapport de visite (zones, observations, conclusion). Tu rédiges le TABLEAU RÉCAPITULATIF : la liste des désordres à traiter, chacun avec la préconisation correspondante.

RÈGLES
- Un point = UN problème distinct. Si le même problème touche plusieurs zones, FUSIONNE-les en un seul point (localisation : « Bât. rue, cour »).
- N'inclus PAS ce qui n'est pas un désordre : présentation, description de l'existant, « rien à signaler », « aucun désordre », locaux non visités, limites de mission.
- Préconisation : reprise du rapport (dans l'observation, dans un paragraphe « travaux à prévoir », dans une autre observation ou dans la conclusion). N'INVENTE RIEN : aucune mesure, aucun dimensionnement, aucune technique absente du rapport. Si le rapport ne dit pas quoi faire, écris « À définir ».
- Très concis : localisation 2 à 5 mots ; désordre et préconisation 1 phrase courte chacun (12 mots max), sans point final, sans tiret long.
- Priorité : "urgent" (sécurité des personnes, stabilité, étaiement), "planifier" (travaux nécessaires), "mineur". Respecte l'urgence saisie sauf incohérence manifeste avec le texte.
- Ordonne par priorité (urgent d'abord), puis dans l'ordre du rapport.

RÉPONSE : UNIQUEMENT un objet JSON valide, sans texte autour :
{"points":[{"zone":"…","desordre":"…","preconisation":"…","priorite":"urgent|planifier|mineur"}]}`;

export function recapUserPrompt(digest, { keep = [], ignored = [] } = {}) {
  let p = `Rapport :\n${digest}`;
  if (keep.length) p += `\n\nPoints DÉJÀ RÉDIGÉS par l'ingénieur (ne les répète pas, ne les reformule pas) :\n${keep.map(r => `- ${r.zone} : ${r.titre}`).join('\n')}`;
  if (ignored.length) p += `\n\nPoints ÉCARTÉS par l'ingénieur (ne les propose pas) :\n${ignored.map(t => `- ${t}`).join('\n')}`;
  return p;
}

const clean = (v) => String(v ?? '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');

// Réponse IA → lignes du tableau (null si illisible).
export function parseRecapReply(raw, newId = () => `synth_${Math.random().toString(36).slice(2, 10)}`) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.replace(/```(?:json)?/gi, '').trim();
  let obj = null;
  try { obj = JSON.parse(s); } catch {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { obj = JSON.parse(s.slice(a, b + 1)); } catch { obj = null; } }
  }
  const pts = Array.isArray(obj?.points) ? obj.points : Array.isArray(obj) ? obj : null;
  if (!pts) return null;
  return pts
    .map(p => ({
      itemId: newId(), isCustom: true, synth: true, edited: false,
      zone: clean(p?.zone),
      titre: clean(p?.desordre),
      solution: clean(p?.preconisation) || 'À définir',
      urgence: PRIO_TO_URG[String(p?.priorite || '').toLowerCase().trim()] || 'moyenne',
    }))
    .filter(r => r.titre)
    .slice(0, 40);
}

// Nouvelle liste `tableauRecap` après génération : drapeau de mode, lignes gardées (modifiées à
// la main), nouvelles lignes, lignes manuelles hors synthèse ; les anciennes surcharges par
// observation sont conservées (réversible) mais ne s'affichent plus en mode synthèse.
export function applySynthesis(recap, fresh, now = Date.now()) {
  const cur = recap || [];
  const flag = synthFlag(cur);
  const kept = cur.filter(r => r?.synth && r.edited);
  const others = cur.filter(r => r && r.itemId !== SYNTH_FLAG && !r.synth);
  return [{ itemId: SYNTH_FLAG, mode: 'synth', at: now, ignored: flag?.ignored || [] }, ...others, ...kept, ...(fresh || [])];
}

// Lignes affichées en mode synthèse : lignes de synthèse + lignes ajoutées à la main, par priorité.
export function synthRows(recap) {
  const order = { haute: 0, moyenne: 1, basse: 2 };
  return (recap || [])
    .filter(r => r && (r.synth || (r.isCustom && r.itemId !== SYNTH_FLAG)))
    .map((r, i) => ({ itemId: r.itemId, isCustom: true, synth: !!r.synth, locNom: r.zone || '', titre: r.titre || '', urgence: r.urgence || 'moyenne', solution: r.solution || '', commentaire: '', _i: i }))
    .sort((a, b) => (order[a.urgence] ?? 1) - (order[b.urgence] ?? 1) || a._i - b._i);
}
