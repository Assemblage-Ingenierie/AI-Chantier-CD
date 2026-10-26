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
import { listSnapshots, getSnapshot } from './backupVault.js';
import { remapParentIds } from './zoneGroups.js';

const MEMO_KEY = 'chantierai_visit_recovery_v1'; // { [visitId]: ts traité (restauré ou ignoré) }
const MIN_TEXT_GAIN = 200;                        // texte perdu (caractères) qui justifie une proposition

const itemsOf = (l) => [...(l?.items || []), ...((l?.sections || []).flatMap(s => s.items || []))];
const itemText = (it) => `${it?.titre || ''}${it?.commentaire || ''}`.length;
const visitText = (v) => (v?.localisations || []).reduce((n, l) => n + (l.nom || '').length + itemsOf(l).reduce((m, it) => m + itemText(it), 0), 0) + (v?.conclusion || '').length;

export function loadRecoveryMemo() { try { return JSON.parse(localStorage.getItem(MEMO_KEY) || '{}') || {}; } catch { return {}; } }
export function markVisitRecovery(visitId, ts) {
  const m = loadRecoveryMemo();
  m[visitId] = Math.max(m[visitId] || 0, ts);
  try { localStorage.setItem(MEMO_KEY, JSON.stringify(m)); } catch { /* mode privé */ }
}

// Accumulateur : met à jour `best` (visitId → candidat) avec un instantané { ts, data }.
export function collectCandidates(best, snapshot, projet, { tombItems = new Set(), memo = {} } = {}) {
  const sp = (snapshot?.data || []).find(p => p?.id === projet?.id);
  if (!sp) return best;
  const curVisits = new Map((projet.visites || []).map(v => [v.id, v]));
  const curItems = new Set((projet.visites || []).flatMap(v => (v.localisations || []).flatMap(l => itemsOf(l).map(i => i?.id))).filter(Boolean));
  for (const sv of (sp.visites || [])) {
    if (!sv?.id || (memo[sv.id] && snapshot.ts <= memo[sv.id])) continue;
    const items = (sv.localisations || []).flatMap(itemsOf).filter(i => i?.id);
    if (!items.length) continue;
    const missing = items.filter(i => !curItems.has(i.id) && !tombItems.has(i.id)).length;
    const cur = curVisits.get(sv.id);
    const lostText = cur ? visitText(sv) - visitText(cur) : 0;
    if (missing < 1 && lostText < MIN_TEXT_GAIN) continue;
    const cand = { visitId: sv.id, label: sv.label || 'Visite', ts: snapshot.ts, items: items.length, missing, lostText, exists: !!cur, visit: sv };
    const prev = best.get(sv.id);
    // La plus complète d'abord (observations manquantes, puis total, puis texte), à égalité la plus récente.
    const better = !prev
      || cand.missing > prev.missing
      || (cand.missing === prev.missing && cand.items > prev.items)
      || (cand.missing === prev.missing && cand.items === prev.items && visitText(sv) > visitText(prev.visit))
      || (cand.missing === prev.missing && cand.items === prev.items && visitText(sv) === visitText(prev.visit) && cand.ts > prev.ts);
    if (better) best.set(sv.id, cand);
  }
  return best;
}

// Parcourt TOUS les instantanés de l'appareil (un à la fois → mémoire contenue).
export async function scanVisitBackups(projet, opts = {}) {
  const best = new Map();
  const list = await listSnapshots();
  for (const { ts } of list) {
    const snap = await getSnapshot(ts);
    if (snap) collectCandidates(best, snap, projet, opts);
  }
  return [...best.values()].sort((a, b) => b.missing - a.missing || b.ts - a.ts);
}

// Une photo est re-référençable si on sait où sont ses octets (chemin Storage, URL, file d'envoi).
const photoHasSource = (ph) => !!(ph && (ph.storage_url || ph._uploadId
  || (typeof ph.data === 'string' && (/^https?:/i.test(ph.data) || ph.data.startsWith('data:')))));

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
