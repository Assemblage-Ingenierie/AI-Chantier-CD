// BASE DE SYNCHRO par observation / visite — anti-écrasement d'un texte récent par un texte périmé.
//
// Incident 26/10/2026 (Pavillons-sous-Bois, « Visite DET n°5 ») : le texte tapé sur le PC a été
// remplacé par l'ANCIEN texte (celui de la visite dupliquée). Cause : à chaque sauvegarde, un
// appareil renvoyait TOUTES les observations du projet telles qu'il les connaissait, y compris
// celles qu'il n'avait pas touchées. Un appareil au state périmé (modif en attente sur une autre
// observation, horloge en avance → fusion « version locale gardée ») écrasait donc le texte écrit
// ailleurs entre-temps.
//
// Principe : on mémorise, par observation (`i:<id>`) et par visite (`v:<id>`), l'empreinte de la
// DERNIÈRE version que cet appareil sait synchronisée avec le serveur (lue au chargement ou
// envoyée par lui). À la sauvegarde, on compare 3 empreintes : locale, serveur, base.
//   - locale = base, serveur ≠ base → pas touchée ICI, modifiée AILLEURS → on n'envoie RIEN
//     (le serveur garde le texte le plus récent).
//   - locale ≠ base                 → modifiée ici → envoyée (comme avant).
//   - base inconnue                 → comportement d'avant (envoyée).
// La base est persistée (localStorage, clé dédiée et compacte) : elle survit au rechargement,
// cas où un appareil repart d'un cache périmé. Sans localStorage → mémoire seule (protection
// limitée à la session, jamais pire qu'avant).

import { itemMetaToRow } from './obsDates.js';

const KEY = 'chantierai_syncbase_v1';
let _map = null;
let _dirty = false;

function mapOf() {
  if (_map) return _map;
  _map = new Map();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') _map.set(k, v);
  } catch { /* base illisible → repart à vide (comportement d'avant) */ }
  return _map;
}

export function getBase(key) { return mapOf().get(key) ?? null; }
export function setBase(key, sig) {
  if (!key || sig == null) return;
  const m = mapOf();
  if (m.get(key) !== sig) { m.set(key, sig); _dirty = true; }
}
// N'écrit que si la base est inconnue (premier chargement) — ne remplace jamais une base existante.
export function seedBase(key, sig) {
  if (!key || sig == null) return;
  const m = mapOf();
  if (!m.has(key)) { m.set(key, sig); _dirty = true; }
}
// Oublie les éléments qui n'existent plus sur le serveur (garde la base compacte).
export function pruneBase(keepKeys) {
  const m = mapOf();
  for (const k of [...m.keys()]) if (!keepKeys.has(k)) { m.delete(k); _dirty = true; }
}
export function flushBase() {
  if (!_dirty) return;
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(mapOf()))); _dirty = false; }
  catch { /* quota / mode privé : la base reste en mémoire pour la session */ }
}
export function clearBase() {
  _map = new Map(); _dirty = false;
  try { localStorage.removeItem(KEY); } catch { /* indisponible */ }
}

// JSON à clés triées (jsonb renvoie les clés dans un autre ordre que JSON.stringify).
export function stableStringify(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

// FNV-1a 32 bits → base36 (empreinte courte : la base reste légère dans localStorage).
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

function parseJson(v) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v ?? null;
}
function emptyToNull(o) { return o && typeof o === 'object' && !Array.isArray(o) && !Object.keys(o).length ? null : (o ?? null); }

// Empreinte du CONTENU d'une observation (sans sa position : zone / ordre), PAR GROUPE de champs
// (titre · commentaire · suivi/urgence/statut/dates · annotations) → fusion champ par champ quand
// deux appareils ont modifié la même observation. Même résultat pour une ligne lue en base et pour
// la ligne construite par saveRemote à partir du même état.
export const ITEM_GROUPS = [['titre'], ['commentaire'], ['suivi', 'urgence', 'commentaire_align', 'statut', 'meta'], ['plan_annotations']];
function itemGroupValues(r) {
  return [
    [r.titre ?? ''],
    [r.commentaire ?? ''],
    [r.suivi ?? 'rien', r.urgence ?? 'basse', r.commentaire_align ?? 'left', r.statut === 'brouillon' ? 'brouillon' : 'rapport', emptyToNull(parseJson(r.meta))],
    [emptyToNull(parseJson(r.plan_annotations))],
  ];
}
export function itemRowSig(r) {
  return itemGroupValues(r).map(g => hashStr(stableStringify(g))).join('.');
}

// Métadonnées d'une visite : une empreinte PAR CLÉ (ordre fixe = clés de la version locale).
export function visitSig(meta) {
  return Object.keys(meta).sort().map(k => hashStr(k + stableStringify(meta[k]))).join('.');
}

// Fusion par groupe (cas « modifié ici ET ailleurs ») : pour chaque groupe, la version locale s'il a
// été modifié ici, sinon celle du serveur. `clash` = au moins un groupe modifié des deux côtés
// différemment (la version locale l'emporte alors, l'autre doit être conservée à part).
// null si les empreintes ne sont pas comparables (format différent) → l'appelant envoie le local.
export function mergeGroups(localSig, serverSig, base) {
  const L = localSig.split('.'), S = serverSig.split('.'), B = (base || '').split('.');
  if (L.length !== S.length || L.length !== B.length) return null;
  let clash = false;
  const pick = L.map((l, i) => {
    if (l === B[i]) return 'S';
    if (S[i] !== B[i] && S[i] !== l) clash = true;
    return 'L';
  });
  return { pick, clash };
}

// Base à retenir après l'envoi d'une fusion : groupes envoyés (L) → version locale ; groupes repris
// du serveur (S) → ancienne base (la version LOCALE de ces groupes est encore l'ancienne : elle ne
// doit pas être prise pour une modification et renvoyée à la sauvegarde suivante).
export function nextBase(localSig, base, pick) {
  const L = localSig.split('.'), B = (base || '').split('.');
  return L.map((l, i) => (pick[i] === 'S' ? B[i] : l)).join('.');
}

// Décision de sauvegarde d'un élément (observation ou visite).
//   'same'       : identique au serveur → rien à envoyer
//   'keepServer' : inchangé ici mais modifié ailleurs → NE PAS écraser le serveur
//   'send'       : modifié ici (ou base inconnue / absent du serveur) → envoyer
//   'conflict'   : modifié ici ET ailleurs → envoyer la version locale, conserver l'autre
export function syncDecision(localSig, serverSig, base) {
  if (serverSig == null) return 'send';
  if (localSig === serverSig) return 'same';
  if (base == null) return 'send';
  if (localSig === base) return 'keepServer';
  if (serverSig === base) return 'send';
  return 'conflict';
}

// Métadonnées d'une visite telles qu'enregistrées dans aichantier_chantiers.visites (JSON).
export function visitMeta(v) {
  return {
    id: v.id, label: v.label ?? 'Visite 1', dateVisite: v.dateVisite ?? null,
    ingenieur: v.ingenieur ?? '',
    participants: v.participants ?? [], tableauRecap: v.tableauRecap ?? [],
    photosParLigne: v.photosParLigne ?? 2, plansEnFin: v.plansEnFin ?? false,
    rapportPageBreaks: v.rapportPageBreaks ?? [],
    includeTableauRecap: v.includeTableauRecap ?? true,
    includeConclusion: v.includeConclusion ?? false,
    conclusion: v.conclusion ?? '',
    conclusionAlign: v.conclusionAlign ?? 'left',
    planPagesPaysage: v.planPagesPaysage ?? false, // ancienne option « tous les plans en paysage en fin de rapport »
    planPages: v.planPages ?? null, // plans sur page à part, PAR PLAN : { clé: 'landscape' | 'portrait' }
    obsDates: v.obsDates ?? false, // affichage des dates de suivi des observations (option du rapport)
    annexes: v.annexes ?? [], // métadonnées uniquement (octets PDF dans Storage) — cf. uploadAnnexPdf
  };
}

// ── Fusion au CHARGEMENT (mergeWithLocal, chemin « version locale gardée ») ─────────────────────
// La version locale d'un projet est gardée en bloc quand il a des modifs en attente (ou une horloge
// en avance). Sans ceci, l'appareil continuait d'AFFICHER l'ancien texte des observations qu'il
// n'avait pas touchées (et pouvait le ré-éditer). On y reprend donc, groupe par groupe, la version
// du serveur là où cet appareil n'a RIEN modifié depuis sa dernière synchro (local = base) et où le
// serveur a changé. Base inconnue → rien n'est repris (comportement d'avant).

// Groupes 0-2 de ITEM_GROUPS (texte, statut, dates) ; les annotations restent locales.
const ITEM_STATE_GROUPS = [['titre'], ['commentaire'], ['suivi', 'urgence', 'commentaireAlign', 'statut', 'dateOuverture', 'dateCloture']];
function stateItemSig(it) {
  return itemRowSig({
    titre: it.titre, commentaire: it.commentaire, suivi: it.suivi, urgence: it.urgence,
    commentaire_align: it.commentaireAlign, statut: it.statut, meta: itemMetaToRow(it), plan_annotations: null,
  }).split('.');
}

export function adoptRemoteItemText(localItem, remoteItem) {
  if (!localItem?.id || !remoteItem || remoteItem.id !== localItem.id) return localItem;
  const base = getBase(`i:${localItem.id}`);
  if (!base) return localItem;
  const B = base.split('.'), L = stateItemSig(localItem), R = stateItemSig(remoteItem);
  let out = localItem;
  ITEM_STATE_GROUPS.forEach((fields, gi) => {
    if (L[gi] !== B[gi] || R[gi] === B[gi]) return; // modifié ici, ou inchangé au serveur
    out = { ...out };
    for (const f of fields) {
      if (remoteItem[f] === undefined) delete out[f]; else out[f] = remoteItem[f];
    }
  });
  return out;
}

export function adoptRemoteVisitMeta(localVisit, remoteVisit) {
  if (!localVisit?.id || !remoteVisit) return localVisit;
  const base = getBase(`v:${localVisit.id}`);
  if (!base) return localVisit;
  const lm = visitMeta(localVisit), rm = visitMeta(remoteVisit);
  const keys = Object.keys(lm).sort();
  const B = base.split('.'), L = visitSig(lm).split('.'), R = visitSig(rm).split('.');
  if (B.length !== keys.length) return localVisit;
  let out = localVisit;
  keys.forEach((k, i) => {
    if (L[i] !== B[i] || R[i] === B[i]) return;
    out = { ...out, [k]: rm[k] };
  });
  return out;
}
