// IMPORT D'INTERVENANTS par l'IA (PDF de CR, capture d'écran, photo) — logique pure, testée.
// Demande Thomas 26/10 : « on lui file un PDF ou une capture, il reconnaît tout, pré-remplit
// nom, entreprise, métier… on valide qui on importe, ça s'ajoute au carnet, et les doublons
// sont repérés et pas ajoutés au carnet ».

import { classifyPdfImport } from './contacts.js';

export const EXTRACT_PROMPT = `Tu lis un document de chantier : compte-rendu de réunion, liste de diffusion, tableau des intervenants, signature d'e-mail, capture d'écran d'annuaire ou de messagerie…
Extrais CHAQUE PERSONNE citée comme intervenant de l'opération. Pour chacune :
- nom : « Prénom NOM » tel qu'écrit, sans civilité (M., Mme…)
- metier : son rôle sur l'opération (Maître d'ouvrage, AMO, Architecte, BET structure, BET fluides, Bureau de contrôle, Économiste, OPC, CSPS, Entreprise lot 02 Gros œuvre…) et/ou sa fonction (Chef de projet, Conducteur de travaux…). Si les deux sont connus : « Conducteur de travaux — Lot 02 Gros œuvre ».
- entreprise : la société ou l'organisme. Si une société est indiquée pour un groupe de personnes (en-tête de bloc, colonne fusionnée), répète-la pour chacune.
- email
- tel : au format « 06 12 34 56 78 » (garde l'indicatif étranger s'il y en a un)
- presence : "present" ou "absent" si le document l'indique (colonnes P / A / E, Présent / Absent / Excusé ; excusé = absent), sinon "".
Ignore une ligne sans nom de personne (société seule, adresse générique). Champ inconnu = "". N'invente rien.
Réponds UNIQUEMENT avec ce JSON, sans texte autour :
{"contacts":[{"nom":"","metier":"","entreprise":"","email":"","tel":"","presence":""}]}`;

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();

function cleanOne(c) {
  if (!c || typeof c !== 'object') return null;
  const nom = str(c.nom).replace(/^(m\.|mr\.?|mme\.?|mlle\.?|monsieur|madame)\s+/i, '');
  if (!nom) return null;
  const presence = /^pr[ée]sent/i.test(str(c.presence)) ? 'present' : /^(absent|excus)/i.test(str(c.presence)) ? 'absent' : '';
  return {
    nom,
    poste: str(c.metier || c.poste || c.role || c.fonction),
    entreprise: str(c.entreprise || c.societe || c.société),
    email: str(c.email).toLowerCase().replace(/^mailto:/, ''),
    tel: str(c.tel || c.telephone || c.téléphone),
    presence,
  };
}

// Réponse de l'IA → contacts. Tolère du texte autour ET une réponse COUPÉE (liste longue) :
// on récupère alors chaque fiche complète une par une au lieu de tout perdre.
export function parseContactsJson(raw) {
  const text = String(raw || '');
  let list = null;
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try { const j = JSON.parse(m[0]); if (Array.isArray(j?.contacts)) list = j.contacts; else if (Array.isArray(j)) list = j; } catch { /* coupé → récupération */ }
  }
  if (!list) {
    list = [];
    for (const obj of text.match(/\{[^{}]*"nom"[^{}]*\}/g) || []) { try { list.push(JSON.parse(obj)); } catch { /* fiche illisible */ } }
  }
  return list.map(cleanOne).filter(Boolean);
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const keyOf = (c) => (c.email ? `@${c.email.toLowerCase()}` : `#${norm(c.nom)}`);
// Ordre des mots indifférent (« DUPONT Jean » = « Jean Dupont »).
const nameKey = (s) => norm(s).split(' ').filter(Boolean).sort().join(' ');

// Fusionne les doublons DANS l'import (même personne citée deux fois, deux captures…) :
// on garde une fiche, complétée des infos de l'autre.
export function mergeDuplicates(list) {
  const out = [];
  for (const c of list) {
    const k = keyOf(c), nk = nameKey(c.nom);
    const twin = out.find(o => keyOf(o) === k || nameKey(o.nom) === nk);
    if (!twin) { out.push({ ...c }); continue; }
    for (const f of ['poste', 'entreprise', 'email', 'tel', 'presence']) if (!twin[f] && c[f]) twin[f] = c[f];
  }
  return out;
}

// Infos que l'import APPORTE à une fiche déjà au carnet (on ne complète que les champs vides,
// on n'écrase jamais ce qui est saisi).
export function fillBlanks(existing, parsed) {
  const fill = {};
  for (const f of ['poste', 'entreprise', 'email', 'tel']) if (!str(existing?.[f]) && str(parsed?.[f])) fill[f] = parsed[f];
  return fill;
}

// Statut d'une fiche par rapport au carnet : 'new' (à créer), 'present' (déjà au carnet → pas
// de doublon), 'near' (nom proche : à confirmer par l'utilisateur).
export function statusOf(contact, existing) {
  const strict = (existing || []).find(c => nameKey(c.nom) === nameKey(contact.nom));
  if (strict) return { status: 'present', match: strict };
  const { present, review } = classifyPdfImport([contact], existing || []);
  if (present.length) return { status: 'present', match: present[0].match };
  if (review.length) return { status: 'near', match: review[0].match };
  return { status: 'new', match: null };
}

// Même personne ? (e-mail identique, ou même nom à l'ordre / accents / casse près)
export function sameContact(a, b) {
  if (!a || !b) return false;
  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) return true;
  return !!nameKey(a.nom) && nameKey(a.nom) === nameKey(b.nom);
}
