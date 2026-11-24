// Client de /api/drive-report : enregistre le PDF du rapport dans le Drive de l'affaire
// (sous-dossier Visites / DET / Rendus AI). Envoi par morceaux (requête Vercel ≤ 4,5 Mo).
import { getSupabase } from '../supabase.js';

export const DRIVE_DESTS = [
  { id: 'visites', label: 'Visites (02_VISITES)' },
  { id: 'det', label: 'DET (08_DET)' },
  { id: 'rendus', label: 'Rendus AI (10_RENDUS AI)' },
];
const CHUNK = 9 * 256 * 1024; // multiple de 256 Ko (exigé par Google), ~3 Mo en base64

async function call(body) {
  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  const r = await fetch('/api/drive-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* réponse vide */ }
  if (!r.ok || data?.error) throw new Error(data?.error || `Erreur Drive (${r.status})`);
  return data;
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
  fr.onerror = () => reject(fr.error || new Error('Lecture du PDF impossible'));
  fr.readAsDataURL(blob);
});

// Nom du fichier : « 2026-11-20_A743_Rapport_DET n°5.pdf » (même visite → même nom → remplacé).
export function reportFileName({ dateVisite, code, visiteLabel }) {
  const parts = [dateVisite || new Date().toISOString().slice(0, 10), code || 'Affaire', 'Rapport'];
  if (visiteLabel) parts.push(visiteLabel);
  return `${parts.join('_').replace(/[\\/:*?"<>|]/g, '-')}.pdf`;
}

export async function saveReportToDrive({ blob, projetNom, projetNum, dest, fileName, onProgress }) {
  const start = await call({ action: 'start', projetNom, projetNum: projetNum || '', dest, fileName, size: blob.size });
  let offset = 0, last = null;
  while (offset < blob.size) {
    const part = blob.slice(offset, Math.min(offset + CHUNK, blob.size));
    last = await call({ action: 'chunk', uploadUrl: start.uploadUrl, offset, total: blob.size, base64: await toBase64(part) });
    offset += part.size;
    onProgress?.(offset / blob.size);
  }
  if (!last?.done) throw new Error('Envoi incomplet, réessaie');
  return { ...start, fileUrl: last.webViewLink || null };
}
