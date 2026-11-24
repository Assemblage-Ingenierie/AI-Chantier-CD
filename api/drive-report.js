// ENREGISTRER LE PDF DU RAPPORT SUR LE DRIVE (demande Thomas 24/11 : « en bas du rapport,
// envoyer sur le Drive, avec un petit menu pour choisir : Visites, DET ou Rendus AI »).
//
// POST { action:'start', projetNom, projetNum, dest:'visites'|'det'|'rendus', fileName, size }
//   → { uploadUrl, folderName, folderUrl, replaced }
//     Dossier de l'affaire retrouvé comme pour les photos (api/_driveMatch.js), puis son
//     sous-dossier standard (02_VISITES / 08_DET / 10_RENDUS AI — créé s'il manque). Un PDF du
//     même nom déjà présent est REMPLACÉ (nouvelle version Drive, l'historique est gardé).
// POST { action:'chunk', uploadUrl, offset, total, base64 }
//   → { done, next, fileId?, webViewLink? } — envoi par morceaux (requête Vercel ≤ 4,5 Mo).
//
// Auth : Bearer Supabase (même contrôle que api/ai-proxy.js). Compte de service :
// GOOGLE_SERVICE_ACCOUNT. Helpers Drive volontairement DUPLIQUÉS (cf. drive-plans.js) : l'upload
// des photos (en prod, fragile) n'est pas touché.

import crypto from 'crypto';
import { resolveProjetFolder } from './_driveMatch.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const MAX_SIZE = 40 * 1024 * 1024;

// Sous-dossiers standard des affaires (modèle Assemblage) : reconnus par leur nom sans numéro.
export const DESTS = {
  visites: { match: 'VISITES', create: '02_VISITES' },
  det: { match: 'DET', create: '08_DET' },
  rendus: { match: 'RENDUS AI', create: '10_RENDUS AI' },
};
export const bareName = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/^[\s\d._-]+/, '').replace(/[_\s]+/g, ' ').trim().toUpperCase();
export function pickDestFolder(folders, dest) {
  const d = DESTS[dest];
  if (!d) return null;
  return (folders || []).find(f => bareName(f.name) === d.match) || null;
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  })).toString('base64url');
  const unsigned = `${header}.${claims}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const jwt = `${unsigned}.${sign.sign(sa.private_key, 'base64url')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function findAffairesDriveId(token) {
  const override = process.env.GOOGLE_AFFAIRES_DRIVE_ID;
  if (override) return override;
  const r = await fetch(`${DRIVE_API}/drives?pageSize=50&fields=drives(id,name)`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  const sd = d.drives?.find(x => x.name === 'Affaires');
  if (sd) return sd.id;
  throw new Error('Drive « Affaires » introuvable : ajoutez GOOGLE_AFFAIRES_DRIVE_ID dans Vercel.');
}

async function listIn(token, driveId, parentId, extraQ = '') {
  const params = new URLSearchParams({
    q: `'${parentId}' in parents and trashed = false${extraQ}`,
    fields: 'files(id,name,mimeType)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    driveId, corpora: 'drive', pageSize: '200',
  });
  const r = await fetch(`${DRIVE_API}/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (d.error) throw new Error(`Drive API error: ${JSON.stringify(d.error)}`);
  return d.files || [];
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const safeFileName = (s) => [...String(s || 'Rapport.pdf')].map(c => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '-' : c)).join('').slice(0, 180);

async function authOk(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return false;
  const sbUrl = (process.env.SUPABASE_URL || '').trim();
  const sbAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  if (!sbUrl || !sbAnonKey) return true; // même comportement que drive-plans (pas de Supabase configuré)
  try {
    const r = await fetch(`${sbUrl}/auth/v1/user`, { headers: { Authorization: authHeader, apikey: sbAnonKey } });
    return r.ok;
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  if (!(await authOk(req))) return res.status(401).json({ error: 'Non autorisé' });
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!saJson) return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT non configuré' });

  try {
    const token = await getAccessToken(JSON.parse(saJson));
    const body = req.body || {};

    if (body.action === 'start') {
      const { projetNom, projetNum, dest, fileName } = body;
      const size = parseInt(body.size, 10) || 0;
      if (!DESTS[dest]) return res.status(400).json({ error: 'Destination inconnue' });
      if (!size || size > MAX_SIZE) return res.status(400).json({ error: 'Taille du PDF invalide' });
      const driveId = await findAffairesDriveId(token);
      const affaire = await resolveProjetFolder(token, driveId, { projetNom, projetNum });
      if (!affaire) return res.status(404).json({ error: 'Dossier de l\'affaire introuvable sur le Drive' });
      const did = affaire.driveId || driveId;
      const subs = (await listIn(token, did, affaire.id, ` and mimeType = '${FOLDER_MIME}'`)).map(f => ({ id: f.id, name: f.name }));
      let folder = pickDestFolder(subs, dest);
      if (!folder) {
        const cr = await fetch(`${DRIVE_API}/files?supportsAllDrives=true&fields=id,name`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: DESTS[dest].create, mimeType: FOLDER_MIME, parents: [affaire.id] }),
        });
        folder = await cr.json();
        if (!folder?.id) throw new Error('Création du dossier impossible');
      }
      const name = safeFileName(fileName);
      const same = await listIn(token, did, folder.id, ` and name = '${esc(name)}' and mimeType = 'application/pdf'`);
      const existing = same[0] || null;
      const url = existing
        ? `${UPLOAD_API}/files/${existing.id}?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`
        : `${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`;
      const init = await fetch(url, {
        method: existing ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'application/pdf', 'X-Upload-Content-Length': String(size) },
        body: JSON.stringify(existing ? { name } : { name, parents: [folder.id], mimeType: 'application/pdf' }),
      });
      const uploadUrl = init.headers.get('location');
      if (!init.ok || !uploadUrl) return res.status(502).json({ error: `Drive : envoi impossible (${init.status})` });
      return res.status(200).json({ uploadUrl, folderName: `${affaire.name} / ${folder.name}`, folderUrl: `https://drive.google.com/drive/folders/${folder.id}`, replaced: !!existing });
    }

    if (body.action === 'chunk') {
      const { uploadUrl, base64 } = body;
      const offset = parseInt(body.offset, 10) || 0;
      const total = parseInt(body.total, 10) || 0;
      // Seule une session d'envoi Google Drive est acceptée (pas d'appel vers une autre adresse).
      if (typeof uploadUrl !== 'string' || !uploadUrl.startsWith(`${UPLOAD_API}/files`)) return res.status(400).json({ error: 'Session d\'envoi invalide' });
      const buf = Buffer.from(String(base64 || ''), 'base64');
      if (!buf.length || !total || offset + buf.length > total) return res.status(400).json({ error: 'Morceau invalide' });
      const r = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Length': String(buf.length), 'Content-Range': `bytes ${offset}-${offset + buf.length - 1}/${total}` },
        body: buf,
      });
      if (r.status === 308) return res.status(200).json({ done: false, next: offset + buf.length });
      if (r.ok) { const f = await r.json().catch(() => ({})); return res.status(200).json({ done: true, fileId: f.id || null, webViewLink: f.webViewLink || null }); }
      return res.status(502).json({ error: `Drive : morceau refusé (${r.status})` });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    console.error('drive-report:', e);
    return res.status(500).json({ error: e.message || 'Erreur Drive' });
  }
}
