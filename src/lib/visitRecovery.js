// RESTAURATION D'UNE VISITE depuis les sauvegardes de l'appareil (incident 26/10, Pavillons : « toute
// ma visite a disparu, il reste des vestiges, même le texte »).
//
// La boîte noire (backupVault) garde le TEXTE et la STRUCTURE complets (zones, observations,
// annotations, références des photos) : les 60 derniers instantanés + un par heure sur 72 h. Le
// bandeau automatique ne compare que le DERNIER instantané — souvent déjà abîmé. Ici on parcourt
// TOUS les instantanés et on garde, pour chaque visite du projet, la version la plus complète qui
// contient des observations absentes aujourd'hui.
//
// Restauration SANS RIEN ÉCRASER (Règle N°2) :
//   - visite absente du projet → remise avec son identifiant d'origine ;
//   - visite encore présente (vestiges) → remise À CÔTÉ, en copie « (restaurée) » ;
//   - zone / observation absente du projet → identifiant d'origine (les photos retrouvent leurs
//     lignes, l'outil Admin « Récupérer les photos » peut relier les fichiers du dossier) ;
//   - zone / observation encore présente → copie (nouvel identifiant, photos re-référencées).
// Les observations supprimées VOLONTAIREMENT (pierres tombales) ne sont jamais proposées.
import { listSnapshotKeys, getSnapshot } from './backupVault.js';
import { remapParentIds } from './zoneGroups.js';

const MEMO_KEY = 'chantierai_visit_recovery_v1'; // { [visitId]: ts traité (restauré ou ignoré) }
const MIN_TEXT_GAIN = 200;                        // texte perdu (caractères) qui justifie une proposition
const MIN_ITEM_TEXT_GAIN = 20;                    // texte plus complet sur une ou plusieurs observations

const itemsOf = (l) => [...(l?.items || []), ...((l?.sections || []).flatMap(s => s.items || []))];
const itemText = (it) => `${it?.titre || ''}${it?.commentaire || ''}`.length;
const visitText = (v) => (v?.localisations || []).reduce((n, l) => n + (l.nom || '').length + itemsOf(l).reduce((m, it) => m + itemText(it), 0), 0) + (v?.conclusion || '').length;

export function loadRecoveryMemo() { try { return JSON.parse(localStorage.getItem(MEMO_KEY) || '{}') || {}; } catch { return {}; } }
export function markVisitRecovery(visitId, ts) {
  const m = loadRecoveryMemo();
  m[visitId] = Math.max(m[visitId] || 0, ts);
  try { localStorage.setItem(MEMO_KEY, JSON.stringify(m)); } catch { /* mode privé */ }
}

// Une photo est re-référençable si on sait où sont ses octets (chemin Storage, URL, file d'envoi).
const photoHasSource = (ph) => !!(ph && (ph.storage_url || ph._uploadId
  || (typeof ph.data === 'string' && (/^https?:/i.test(ph.data) || ph.data.startsWith('data:')))));

// Clés d'une photo (id de ligne + chemin Storage) pour savoir si elle est encore là.
const PATH_RE = /\/storage\/v1\/object\/(?:sign|public)\/photos\/([^?]+)/;
function photoKeys(ph) {
  const keys = [];
  if (ph?._id) keys.push(`id:${ph._id}`);
  if (ph?.id) keys.push(`id:${ph.id}`);
  for (const u of [ph?.storage_url, ph?.data]) {
    if (typeof u !== 'string' || u.startsWith('data:')) continue;
    const m = u.match(PATH_RE);
    let path = m ? m[1] : (/^https?:/i.test(u) ? null : u);
    if (path) { try { path = decodeURIComponent(path); } catch { /* tel quel */ } keys.push(`p:${path.split('?')[0]}`); }
  }
  return keys;
}

// Accumulateur : met à jour `best` (visitId → candidat) avec un instantané { ts, data }.
// Une version est proposée si, par rapport à aujourd'hui, elle a :
//   - des observations ABSENTES (hors suppressions volontaires) ;
//   - des observations au texte PLUS COMPLET (retour Thomas 26/10 : « ancien texte ») ;
//   - des PHOTOS qui ont disparu (observations dont les photos sont chargées sur l'appareil).
export function collectCandidates(best, snapshot, projet, { tombItems = new Set(), memo = {} } = {}) {
  const sp = (snapshot?.data || []).find(p => p?.id === projet?.id);
  if (!sp) return best;
  const curVisits = new Map((projet.visites || []).map(v => [v.id, v]));
  const curItemById = new Map((projet.visites || []).flatMap(v => (v.localisations || []).flatMap(l => itemsOf(l))).filter(i => i?.id).map(i => [i.id, i]));
  for (const sv of (sp.visites || [])) {
    if (!sv?.id || (memo[sv.id] && snapshot.ts <= memo[sv.id])) continue;
    const items = (sv.localisations || []).flatMap(itemsOf).filter(i => i?.id && !tombItems.has(i.id));
    if (!items.length) continue;
    let missing = 0, textItems = 0, textGain = 0, photoGain = 0, photos = 0;
    for (const it of items) {
      photos += (it.photos || []).length;
      const cur = curItemById.get(it.id);
      if (!cur) { missing++; continue; }
      const gain = itemText(it) - itemText(cur);
      if (gain > 0) { textItems++; textGain += gain; }
      // Photos : seulement si celles de l'observation actuelle sont chargées (sinon on ne sait pas).
      if (cur._photosHydrated) {
        const have = new Set((cur.photos || []).flatMap(photoKeys));
        photoGain += (it.photos || []).filter(ph => photoHasSource(ph) && !photoKeys(ph).some(k => have.has(k))).length;
      }
    }
    const cur = curVisits.get(sv.id);
    const lostText = cur ? visitText(sv) - visitText(cur) : 0;
    if (missing < 1 && photoGain < 1 && !(textItems >= 1 && textGain >= MIN_ITEM_TEXT_GAIN) && lostText < MIN_TEXT_GAIN) continue;
    const cand = { visitId: sv.id, label: sv.label || 'Visite', ts: snapshot.ts, items: items.length, photos, missing, textItems, textGain, photoGain, lostText, exists: !!cur, visit: sv };
    const prev = best.get(sv.id);
    // La plus complète d'abord (observations manquantes, photos, texte), à égalité la plus récente.
    const rank = (c) => [c.missing, c.photoGain, c.textGain, c.items, c.ts];
    const a = rank(cand), b = prev ? rank(prev) : null;
    let better = !b;
    if (b) for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { better = a[i] > b[i]; break; } }
    if (better) best.set(sv.id, cand);
  }
  return best;
}

// Parcourt TOUS les instantanés de l'appareil (un à la fois → mémoire contenue).
export async function scanVisitBackups(projet, opts = {}) {
  const best = new Map();
  for (const ts of await listSnapshotKeys()) {
    try {
      const snap = await getSnapshot(ts);
      if (snap) collectCandidates(best, snap, projet, opts);
    } catch { /* instantané illisible : on passe au suivant */ }
  }
  return [...best.values()].sort((a, b) => b.missing - a.missing || b.photoGain - a.photoGain || b.textGain - a.textGain || b.ts - a.ts);
}


// Visite prête à être ajoutée au projet (cf. règles en tête de fichier).
// tomb : pierres tombales { item:Set, loc:Set } — ce qui a été supprimé VOLONTAIREMENT ne revient pas.
export function buildRestoredVisit(sv, projet, uuid = () => crypto.randomUUID(), tomb = {}) {
  const tombItems = tomb.item || new Set();
  const tombLocs = tomb.loc || new Set();
  const visites = projet.visites || [];
  const presentVisit = new Set(visites.map(v => v.id));
  const presentLoc = new Set(visites.flatMap(v => (v.localisations || []).map(l => l.id)));
  const presentItem = new Set(visites.flatMap(v => (v.localisations || []).flatMap(l => itemsOf(l).map(i => i?.id))).filter(Boolean));
  const asCopy = presentVisit.has(sv.id);
  const zoneIdMap = new Map((sv.localisations || []).map(l => [l.id, presentLoc.has(l.id) ? uuid() : l.id]));
  let dropped = 0;
  const localisations = remapParentIds((sv.localisations || []).filter(l => l?.id && !tombLocs.has(l.id)).map(l => ({
    ...l,
    id: zoneIdMap.get(l.id),
    items: (l.items || []).filter(it => it && !tombItems.has(it.id)).map(it => {
      const keep = !!it.id && !presentItem.has(it.id);
      const src = it.photos || [];
      const photos = src.filter(photoHasSource).map(ph => (keep ? { ...ph } : { ...ph, _id: uuid(), id: undefined }));
      dropped += src.length - photos.length;
      // Photos rechargées depuis la base / le stockage au besoin (même chemin que restoreFromBackup).
      return { ...it, id: keep ? it.id : uuid(), photos, _photosHydrated: false };
    }),
  })), zoneIdMap);
  const visit = {
    ...sv,
    id: asCopy ? uuid() : sv.id,
    label: asCopy ? `${sv.label || 'Visite'} (restaurée)` : (sv.label || 'Visite'),
    localisations,
  };
  return { visit, asCopy, droppedPhotos: dropped };
}

// TOUTES les versions d'une visite gardées sur l'appareil (choix manuel — retour Thomas 26/10 :
// « toujours rien », la détection automatique ne suffit pas). Versions identiques consécutives
// fusionnées. Retourne { count, oldest, visits: [{ visitId, label, versions: [{ ts, items, photos, text, visit }] }] }.
export function visitSignature(v) {
  const items = (v?.localisations || []).flatMap(itemsOf).filter(Boolean);
  return { items: items.length, photos: items.reduce((n, it) => n + (it.photos || []).length, 0), text: visitText(v) };
}
export function addVersions(acc, snapshot, projectId, maxPerVisit = 40) {
  const sp = (snapshot?.data || []).find(p => p?.id === projectId);
  if (!sp) return acc;
  for (const sv of (sp.visites || [])) {
    if (!sv?.id) continue;
    const sig = visitSignature(sv);
    if (!sig.items) continue;
    let e = acc.get(sv.id);
    if (!e) { e = { visitId: sv.id, label: sv.label || 'Visite', versions: [] }; acc.set(sv.id, e); }
    const last = e.versions[e.versions.length - 1];
    if (last && last.items === sig.items && last.photos === sig.photos && last.text === sig.text) continue; // identique
    if (e.versions.length < maxPerVisit) e.versions.push({ ts: snapshot.ts, ...sig, visit: sv });
  }
  return acc;
}
export async function listVisitVersions(projectId) {
  const keys = await listSnapshotKeys(); // plus récent d'abord
  const acc = new Map();
  for (const ts of keys) {
    try {
      const snap = await getSnapshot(ts);
      if (snap) addVersions(acc, snap, projectId);
    } catch { /* illisible : suivant */ }
  }
  return { count: keys.length, oldest: keys.length ? keys[keys.length - 1] : null, visits: [...acc.values()] };
}
