// Client de l'API /api/drive-plans : liste les PDF du dossier Drive de l'affaire et les
// télécharge par morceaux (la réponse Vercel est plafonnée à ~4,5 Mo). Les morceaux sont
// des multiples de 3 octets → leurs base64 se concatènent tels quels.
import { getSupabase } from '../supabase.js';

async function authHeaders() {
  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  return { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) };
}

async function call(body) {
  const r = await fetch('/api/drive-plans', { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
  let data = null;
  try { data = await r.json(); } catch { /* réponse vide */ }
  if (!r.ok || data?.error) throw new Error(data?.error || `Erreur Drive (${r.status})`);
  return data;
}

// Caches de SESSION (vitesse — « c'est looong ») : le dossier de l'affaire ne bouge pas
// pendant la session, et re-naviguer dans un dossier déjà visité est instantané.
const _resolveCache = new Map(); // projetNom → { folderId, folderName, driveId }
const _browseCache  = new Map(); // folderId  → { folders, files }

// Retrouve le dossier racine de l'affaire → { folderId, folderName, driveId } (folderId
// null si introuvable).
export async function resolveDriveFolder(projetNom) {
  if (_resolveCache.has(projetNom)) return _resolveCache.get(projetNom);
  const r = await call({ action: 'resolve', projetNom });
  if (r?.folderId) _resolveCache.set(projetNom, r);
  return r;
}

// Contenu d'UN niveau → { folders:[{id,name}], files:[{id,name,size,modifiedTime}] }.
// fresh = true pour ignorer le cache (bouton actualiser).
export async function browseDriveFolder(folderId, driveId = null, { fresh = false } = {}) {
  if (!fresh && _browseCache.has(folderId)) return _browseCache.get(folderId);
  const r = await call({ action: 'browse', folderId, driveId });
  _browseCache.set(folderId, r);
  return r;
}

// Télécharge un PDF complet → data URL. onProgress(octetsReçus, total).
// Les morceaux (3 Mo) sont téléchargés en PARALLÈLE (4 à la fois) : le séquentiel
// d'origine était « looong » (retour Thomas) — un 40 Mo passe de ~14 tours à ~4.
export async function downloadDrivePlan(fileId, onProgress = null) {
  const first = await call({ action: 'download', fileId, offset: 0 });
  if (first.done) { onProgress?.(first.size, first.size); return `data:application/pdf;base64,${first.base64}`; }
  const size = first.size;
  const chunkBytes = first.next; // taille d'un morceau plein (fixée côté API)
  const offsets = [];
  for (let o = first.next; o < size; o += chunkBytes) offsets.push(o);
  if (offsets.length > 60) throw new Error('Fichier trop volumineux'); // garde-fou (> ~180 Mo)
  const results = new Array(offsets.length);
  let received = first.next;
  let nextIdx = 0;
  const worker = async () => {
    for (;;) {
      const my = nextIdx++;
      if (my >= offsets.length) return;
      const d = await call({ action: 'download', fileId, offset: offsets[my] });
      results[my] = d.base64;
      received += Math.min(chunkBytes, size - offsets[my]);
      onProgress?.(Math.min(received, size), size);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, offsets.length) }, worker));
  return `data:application/pdf;base64,${[first.base64, ...results].join('')}`;
}

export function fmtDriveSize(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}
