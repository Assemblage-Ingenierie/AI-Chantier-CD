// COPIE DU TEXTE DE LA VISITE SUR LE DRIVE (demande Thomas, incident 26/10 « Visite DET n°5 » :
// les photos étaient sur le Drive, le texte nulle part).
//
// À chaque modification du texte d'une visite sur CET appareil, un fichier texte lisible (zones,
// observations, conclusion) est écrit dans le dossier Drive de la visite, À CÔTÉ DES PHOTOS (même
// dossier que driveUpload). C'est toujours le même fichier, mis à jour : le Drive garde ses
// révisions précédentes (Fichier → Gestion des versions) → on peut revenir en arrière sans l'app.
//
// Indépendant de Supabase : un second système, lisible par n'importe qui. 100 % additif : un échec
// (hors ligne, Drive indisponible) ne touche à rien — même file d'attente que les photos.
// Rythme : au plus une écriture toutes les 2 min par visite, seulement si le texte a changé.

import { uploadToDrive, getAffaireNum } from './driveUpload.js';
import { SUIVI, URGENCE } from './constants.js';

export const TEXT_FILE_NAME = 'Texte de la visite (copie auto).txt';
const MIN_INTERVAL = 120000;

const label = (map, k) => (k && k !== 'rien' && map[k]?.label) || '';

export function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter((l, i, a) => l || (i > 0 && a[i - 1])).join('\n').trim();
}

// Corps du fichier (sans la ligne d'horodatage) — sert aussi d'empreinte « le texte a changé ».
export function visitTextBody(projet, visite) {
  const out = [];
  const date = visite?.dateVisite ? new Date(visite.dateVisite).toLocaleDateString('fr-FR') : '';
  out.push(projet?.nom || 'Projet');
  out.push([visite?.label || 'Visite', date].filter(Boolean).join(' — '));
  if (visite?.ingenieur) out.push(`Ingénieur : ${visite.ingenieur}`);
  const parts = (visite?.participants || []).map(p => [p?.nom, p?.societe || p?.entreprise].filter(Boolean).join(' — ')).filter(Boolean);
  if (parts.length) out.push(`Participants : ${parts.join(' ; ')}`);
  let n = 0;
  for (const l of (visite?.localisations || [])) {
    if (l?._mergedInto) continue;
    out.push('', `■ ${l?.nom || 'Zone'}`);
    for (const it of (l?.items || [])) {
      n++;
      const tags = [it?.statut === 'brouillon' ? 'Brouillon' : '', label(URGENCE, it?.urgence), label(SUIVI, it?.suivi)].filter(Boolean);
      out.push(`  ${n}. ${it?.titre || '(sans titre)'}${tags.length ? `  [${tags.join(', ')}]` : ''}`);
      const c = htmlToText(it?.commentaire);
      if (c) out.push(...c.split('\n').map(line => `     ${line}`));
    }
  }
  const concl = htmlToText(visite?.conclusion);
  if (concl) out.push('', 'CONCLUSION', concl);
  return out.join('\n');
}

const hasText = (visite) => (visite?.localisations || []).some(l => (l?.items || []).some(it => it?.titre || it?.commentaire)) || !!visite?.conclusion;

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const _lastBody = new Map(); // visitId → dernier corps envoyé (ou vu au chargement)
const _lastAt = new Map();
const _timers = new Map();

// Mémorise l'état chargé : seule une modification faite ENSUITE déclenche une écriture (un appareil
// au cache ancien ne réécrit pas le fichier au démarrage).
export function primeVisitTextBackup(projets) {
  for (const p of (projets || [])) for (const v of (p?.visites || [])) {
    if (v?.id && !_lastBody.has(v.id)) _lastBody.set(v.id, visitTextBody(p, v));
  }
}

async function flush(getProjets, projectId, visitId) {
  _timers.delete(visitId);
  const p = (getProjets() || []).find(x => x.id === projectId);
  const v = p?.visites?.find(x => x.id === visitId);
  if (!v || !hasText(v)) return;
  const body = visitTextBody(p, v);
  if (body === _lastBody.get(visitId)) return;
  _lastBody.set(visitId, body);
  _lastAt.set(visitId, Date.now());
  const text = `${body}\n\n—\nCopie automatique de l'app AI Chantier du ${new Date().toLocaleString('fr-FR')} (texte seul ; les photos sont dans ce dossier).\nVersions précédentes : clic droit → Gestion des versions.\n`;
  const visiteLabel = v.label || (v.dateVisite ? new Date(v.dateVisite).toLocaleDateString('fr-FR') : '');
  await uploadToDrive({
    data: `data:text/plain;base64,${toBase64Utf8(text)}`, name: TEXT_FILE_NAME, replace: true,
    projetNom: p.nom, projetNum: getAffaireNum(p.id), visiteLabel, visiteDate: v.dateVisite || null, ingenieur: v.ingenieur || '',
  });
}

// Après une sauvegarde : planifie l'écriture des visites dont le texte a changé (projets modifiés).
export function scheduleVisitTextBackup(getProjets, projectIds) {
  try {
    if (typeof window === 'undefined') return;
    const ids = new Set(projectIds || []);
    for (const p of (getProjets() || [])) {
      if (!ids.has(p.id)) continue;
      for (const v of (p.visites || [])) {
        if (!v?.id || _timers.has(v.id)) continue;
        // Visite absente au chargement (créée depuis) → base vide : elle sera copiée.
        if (visitTextBody(p, v) === (_lastBody.get(v.id) ?? '')) continue;
        const wait = Math.max(0, (_lastAt.get(v.id) || 0) + MIN_INTERVAL - Date.now());
        _timers.set(v.id, setTimeout(() => { flush(getProjets, p.id, v.id).catch(() => {}); }, wait));
      }
    }
  } catch { /* best-effort */ }
}
