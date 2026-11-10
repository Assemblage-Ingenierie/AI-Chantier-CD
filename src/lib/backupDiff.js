// SAUVEGARDE DE L'APPAREIL ↔ PROJET ACTUEL : « qu'est-ce qui change ? » (retour Thomas 06/11 :
// « à chaque fois j'ai peur que ça m'écrase des trucs »).
//
// Avant : le bandeau « Une sauvegarde locale plus complète a été trouvée » proposait « Restaurer »,
// qui REMPLAÇAIT le projet entier par la sauvegarde — tout ce qui avait été écrit depuis (ici ou
// sur un autre appareil) était écrasé, sans rien montrer.
//
// Désormais :
//   1. diffBackup() liste, élément par élément, ce que la sauvegarde contient et qui manque
//      aujourd'hui (visites, zones, observations), les textes qui étaient plus complets, et
//      (pour information) les photos disparues ;
//   2. applyBackup() ne fait qu'AJOUTER ce que l'utilisateur coche, avec les fonctions de la
//      corbeille (identifiants d'origine). Rien n'est supprimé ; un texte repris remplace le texte
//      actuel, qui part dans la corbeille de l'appareil (et reste dans l'historique serveur).
// Ce qui a été supprimé VOLONTAIREMENT (pierres tombales) n'est jamais proposé.
// Logique PURE (testée), sans I/O.

import { restoreItemInLocs, restoreZoneInLocs, restoreItemTextInLocs } from './trash.js';
import { buildRestoredVisit } from './visitRecovery.js';

const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const textOf = (it) => plain(`${it?.titre || ''} ${it?.commentaire || ''}`);
export const excerpt = (html, n = 90) => { const t = plain(html); return t.length > n ? `${t.slice(0, n)}…` : t; };

// Texte de la sauvegarde nettement plus complet (pas une simple retouche).
const MIN_TEXT_GAIN = 40;
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
const noPhotosLoaded = (it) => ({ ...it, _photosHydrated: false });

// Différences entre un projet de la sauvegarde (`snapP`) et le projet actuel (`curP`, null s'il a
// disparu). tomb = { item:Set, loc:Set } (suppressions volontaires).
// → [{ key, kind, visiteId, visitLabel, locId, locNom, title, detail, on, … }]
//   kind : 'project' | 'visit' | 'zone' | 'item' | 'text' | 'photos' (information seulement)
//   on   : coché par défaut (ce qui MANQUE oui ; un texte à remplacer non : à choisir)
export function diffBackup(snapP, curP, tomb = {}) {
  const tombItems = tomb.item || new Set(), tombLocs = tomb.loc || new Set();
  const out = [];
  if (!snapP?.id) return out;
  if (!curP) {
    const n = (snapP.visites || []).reduce((a, v) => a + (v.localisations || []).reduce((b, l) => b + (l.items || []).length, 0), 0);
    out.push({ key: `p|${snapP.id}`, kind: 'project', title: snapP.nom || 'Projet', detail: `${(snapP.visites || []).length} visite(s), ${n} observation(s) — absent de la liste (peut-être supprimé volontairement)`, on: false, project: snapP });
    return out;
  }
  const curVisit = new Map((curP.visites || []).map(v => [v.id, v]));
  const curLocIds = new Set((curP.visites || []).flatMap(v => (v.localisations || []).filter(l => !l._mergedInto).map(l => l.id)));
  const curItems = new Map((curP.visites || []).flatMap(v => (v.localisations || []).flatMap(l => (l.items || []).map(i => [i.id, i]))));

  for (const sv of (snapP.visites || [])) {
    const label = sv.label || 'Visite';
    const cv = curVisit.get(sv.id);
    if (!cv) {
      const items = (sv.localisations || []).flatMap(l => l.items || []).filter(i => i?.id && !tombItems.has(i.id) && !curItems.has(i.id));
      if (!items.length && !(sv.localisations || []).length) continue;
      out.push({ key: `v|${sv.id}`, kind: 'visit', visiteId: sv.id, visitLabel: label, title: label,
        detail: `Visite entière absente — ${(sv.localisations || []).length} zone(s), ${items.length} observation(s)`, on: true, visit: sv });
      continue;
    }
    for (const l of (sv.localisations || [])) {
      if (!l?.id || l._mergedInto || tombLocs.has(l.id)) continue;
      const items = (l.items || []).filter(i => i?.id && !tombItems.has(i.id));
      if (!curLocIds.has(l.id)) {
        const missing = items.filter(i => !curItems.has(i.id));
        out.push({ key: `z|${l.id}`, kind: 'zone', visiteId: sv.id, visitLabel: label, locId: l.id, locNom: l.nom || 'Zone',
          title: l.nom || 'Zone', detail: `Zone absente — ${missing.length} observation(s) : ${missing.slice(0, 3).map(i => `« ${excerpt(i.titre, 40) || 'sans titre'} »`).join(', ')}${missing.length > 3 ? '…' : ''}`,
          on: true, loc: { ...l, items: items.filter(i => !curItems.has(i.id)).map(noPhotosLoaded) } });
        continue;
      }
      for (const it of items) {
        const cur = curItems.get(it.id);
        if (!cur) {
          out.push({ key: `i|${it.id}`, kind: 'item', visiteId: sv.id, visitLabel: label, locId: l.id, locNom: l.nom || 'Zone',
            title: it.titre || 'Observation sans titre', detail: excerpt(it.commentaire) || 'Observation absente', on: true, item: noPhotosLoaded(it) });
          continue;
        }
        const before = textOf(it), now = textOf(cur);
        if (before.length - now.length >= MIN_TEXT_GAIN) {
          out.push({ key: `t|${it.id}`, kind: 'text', visiteId: sv.id, visitLabel: label, locId: l.id, locNom: l.nom || 'Zone',
            title: it.titre || cur.titre || 'Observation', before: excerpt(it.commentaire, 140), after: excerpt(cur.commentaire, 140) || '(vide)',
            detail: `Texte plus long dans la sauvegarde (+${before.length - now.length} caractères)`, on: false, item: it });
        }
        // Photos : seulement si celles de l'observation sont chargées ici (sinon on ne sait pas).
        if (cur._photosHydrated) {
          const have = new Set((cur.photos || []).flatMap(photoKeys));
          const gone = (it.photos || []).filter(ph => photoKeys(ph).length && !photoKeys(ph).some(k => have.has(k))).length;
          if (gone) out.push({ key: `ph|${it.id}`, kind: 'photos', visiteId: sv.id, visitLabel: label, locId: l.id, locNom: l.nom || 'Zone',
            title: it.titre || 'Observation', detail: `${gone} photo(s) plus présente(s) — à remettre depuis Corbeille › Photos détachées`, on: false, info: true });
        }
      }
    }
  }
  return out;
}

// Applique les éléments COCHÉS au projet actuel (additif). → { patch: { visites }, previousTexts, liftIds }
// previousTexts : textes actuels remplacés (à mettre dans la corbeille de l'appareil).
export function applyBackup(curP, entries, tomb = {}) {
  let visites = curP?.visites || [];
  const previousTexts = [], liftIds = [];
  const onVisit = (vid, fn) => { visites = visites.map(v => (v.id === vid ? { ...v, localisations: fn(v.localisations || []) } : v)); };
  for (const e of entries) {
    if (e.info) continue;
    if (e.kind === 'visit' && !visites.some(v => v.id === e.visiteId)) {
      const { visit } = buildRestoredVisit(e.visit, { ...curP, visites }, undefined, tomb);
      visites = [...visites, visit];
      liftIds.push(visit.id);
    } else if (e.kind === 'zone') {
      onVisit(e.visiteId, locs => { const r = restoreZoneInLocs(locs, { loc: e.loc }); liftIds.push(...(r.liftIds || [])); return r.locs; });
    } else if (e.kind === 'item') {
      onVisit(e.visiteId, locs => { const r = restoreItemInLocs(locs, { item: e.item, locId: e.locId, locNom: e.locNom }); liftIds.push(...(r.liftIds || [])); return r.locs; });
    } else if (e.kind === 'text') {
      onVisit(e.visiteId, locs => {
        const r = restoreItemTextInLocs(locs, { item: e.item, locId: e.locId, locNom: e.locNom });
        if (r.replaced && r.previous) previousTexts.push({ item: r.previous, visiteId: e.visiteId, locId: r.zone?.id, locNom: r.zone?.nom || '' });
        return r.locs;
      });
    }
  }
  return { patch: { visites }, previousTexts, liftIds };
}
