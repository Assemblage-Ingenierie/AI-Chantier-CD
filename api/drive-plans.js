// Import de plans DIRECT depuis le Drive de l'affaire (demande Thomas : « quand je clique
// sur Importer, ouvre-moi directement le dossier de l'affaire, que je n'aie pas à chercher
// dans le Drive »).
//
// POST { action:'list', projetNom }
//   → { folderName, files:[{ id, name, path, size, modifiedTime }] } (PDF uniquement,
//     dossier de l'affaire retrouvé par son numéro — ex : A696 → « 2026_A696_… »)
// POST { action:'download', fileId, offset }
//   → { base64, size, next, done } — téléchargement par MORCEAUX de 3 Mo (multiple de
//     3 octets → les morceaux base64 se concatènent tels quels côté client ; la réponse
//     Vercel est plafonnée à ~4,5 Mo, impossible de renvoyer un PDF entier d'un coup).
//
// Auth : Bearer Supabase (même contrôle que api/ai-proxy.js).
// Compte de service : GOOGLE_SERVICE_ACCOUNT (+ GOOGLE_AFFAIRES_DRIVE_ID conseillé).
// Les helpers Drive sont volontairement DUPLIQUÉS depuis api/drive-upload.js : ne pas
// refactorer l'upload photos (en prod, fragile) pour partager du code.

import crypto from 'crypto';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const CHUNK = 3 * 1024 * 1024; // 3 Mo, multiple de 3 → base64 concaténable

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const unsigned = `${header}.${claims}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const sig = sign.sign(sa.private_key, 'base64url');
  const jwt = `${unsigned}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function findAffairesFolder(token) {
  const driveIdOverride = process.env.GOOGLE_AFFAIRES_DRIVE_ID;
  if (driveIdOverride) return { id: driveIdOverride, driveId: driveIdOverride };
  const drivesRes = await fetch(`${DRIVE_API}/drives?pageSize=50&fields=drives(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const drivesData = await drivesRes.json();
  const sharedDrive = drivesData.drives?.find(d => d.name === 'Affaires');
  if (sharedDrive) return { id: sharedDrive.id, driveId: sharedDrive.id };
  const params = new URLSearchParams({
    q: `mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id,name,driveId,parents)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
    pageSize: '50',
  });
  const res = await fetch(`${DRIVE_API}/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (data.error) throw new Error(`Drive API error: ${JSON.stringify(data.error)}`);
  const folders = data.files || [];
  const affairesFolder = folders.find(f => f.name === 'Affaires');
  if (affairesFolder) return { id: affairesFolder.id, driveId: affairesFolder.driveId };
  const inSharedDrive = folders.find(f => f.driveId);
  if (inSharedDrive) return { id: inSharedDrive.driveId, driveId: inSharedDrive.driveId };
  throw new Error('Dossier "Affaires" introuvable — ajoutez GOOGLE_AFFAIRES_DRIVE_ID dans Vercel.');
}

function extractProjetNum(nom) {
  const match = (nom || '').match(/[Aa]\d{3,4}/);
  return match ? match[0].toUpperCase() : null;
}

// Dossier de l'affaire : par numéro (A696…) à la racine d'Affaires, sinon recherche
// dans tout le Drive. Renvoie { id, name } ou null (PAS de création ici : lecture seule).
async function findProjetFolder(token, driveId, projetNom) {
  const num = extractProjetNum(projetNom);
  const searches = [];
  if (num) {
    searches.push(`name contains '${num}' and mimeType = '${FOLDER_MIME}' and '${driveId}' in parents and trashed = false`);
    searches.push(`name contains '${num}' and mimeType = '${FOLDER_MIME}' and trashed = false`);
  }
  const firstWord = (projetNom || '').split(/[\s_-]+/).filter(w => w.length > 3)[0];
  if (firstWord) searches.push(`name contains ${JSON.stringify(firstWord)} and mimeType = '${FOLDER_MIME}' and '${driveId}' in parents and trashed = false`);
  for (const q of searches) {
    const params = new URLSearchParams({
      q, fields: 'files(id,name)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      driveId, corpora: 'drive', pageSize: '5',
    });
    const res = await fetch(`${DRIVE_API}/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.files?.length) return data.files[0];
  }
  return null;
}

// Contenu d'UN niveau de dossier — navigation « comme dans le Drive » (demande Thomas :
// on se balade dans 1_GESTION, 2_DOCUMENTS_RECUS… au lieu d'une liste à plat).
async function listChildren(token, driveId, folderId) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,size,modifiedTime)',
    supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    driveId, corpora: 'drive', pageSize: '200',
  });
  const res = await fetch(`${DRIVE_API}/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (data.error) throw new Error(`Drive API error: ${JSON.stringify(data.error)}`);
  const folders = [], files = [];
  for (const f of (data.files || [])) {
    if (f.mimeType === FOLDER_MIME) folders.push({ id: f.id, name: f.name });
    else if (f.mimeType === 'application/pdf') files.push({ id: f.id, name: f.name, size: parseInt(f.size || '0', 10), modifiedTime: f.modifiedTime || null });
  }
  // Tri « numérique » : 1_GESTION avant 2_DOCUMENTS avant 10_RENDUS.
  const byName = (a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
  folders.sort(byName); files.sort(byName);
  return { folders, files };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  // Même contrôle d'auth que ai-proxy : token Supabase de l'utilisateur connecté.
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non autorisé' });
  const sbUrl = (process.env.SUPABASE_URL || '').trim();
  const sbAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  if (sbUrl && sbAnonKey) {
    let userRes;
    try {
      userRes = await fetch(`${sbUrl}/auth/v1/user`, { headers: { 'Authorization': authHeader, 'apikey': sbAnonKey } });
    } catch { return res.status(401).json({ error: 'Impossible de valider le token' }); }
    if (!userRes.ok) return res.status(401).json({ error: 'Token invalide ou expiré' });
  }

  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!saJson) return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT non configuré' });

  try {
    const sa = JSON.parse(saJson);
    const token = await getAccessToken(sa);
    const { action, projetNom, fileId, offset = 0 } = req.body || {};

    if (action === 'resolve') {
      // Retrouve le dossier racine de l'affaire (par numéro, sinon premier mot du nom).
      const { driveId } = await findAffairesFolder(token);
      const folder = await findProjetFolder(token, driveId, projetNom);
      if (!folder) return res.status(200).json({ folderId: null, folderName: null });
      return res.status(200).json({ folderId: folder.id, folderName: folder.name, driveId });
    }

    if (action === 'browse') {
      const { folderId: fid, driveId: did } = req.body || {};
      if (!fid) return res.status(400).json({ error: 'folderId manquant' });
      const driveId = did || (await findAffairesFolder(token)).driveId;
      const content = await listChildren(token, driveId, fid);
      return res.status(200).json(content);
    }

    if (action === 'download') {
      if (!fileId) return res.status(400).json({ error: 'fileId manquant' });
      const metaRes = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=size,name&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meta = await metaRes.json();
      if (meta.error) return res.status(404).json({ error: 'Fichier introuvable' });
      const size = parseInt(meta.size || '0', 10);
      const start = Math.max(0, parseInt(offset, 10) || 0);
      const end = Math.min(start + CHUNK, size) - 1;
      const r = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}`, Range: `bytes=${start}-${end}` },
      });
      if (!r.ok && r.status !== 206) return res.status(502).json({ error: `Téléchargement Drive impossible (${r.status})` });
      const buf = Buffer.from(await r.arrayBuffer());
      const next = start + buf.length;
      return res.status(200).json({ base64: buf.toString('base64'), size, next, done: next >= size });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    console.error('drive-plans:', e);
    return res.status(500).json({ error: e.message || 'Erreur Drive' });
  }
}
