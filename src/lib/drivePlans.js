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

// → { folderName, files:[{ id, name, path, size, modifiedTime }] }
export function listDrivePlans(projetNom) {
  return call({ action: 'list', projetNom });
}

// Télécharge un PDF complet → data URL. onProgress(octetsReçus, total).
export async function downloadDrivePlan(fileId, onProgress = null) {
  const parts = [];
  let offset = 0;
  for (;;) {
    const d = await call({ action: 'download', fileId, offset });
    parts.push(d.base64);
    offset = d.next;
    onProgress?.(Math.min(offset, d.size), d.size);
    if (d.done) break;
    if (parts.length > 40) throw new Error('Fichier trop volumineux'); // garde-fou (> ~120 Mo)
  }
  return `data:application/pdf;base64,${parts.join('')}`;
}

export function fmtDriveSize(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}
