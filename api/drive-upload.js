// Upload a photo to Google Drive under Affaires/{projetNom}/Visite_{visiteLabel}/
// Uses a service account stored in GOOGLE_SERVICE_ACCOUNT env var (JSON string)
// MIME types accepted: image/jpeg, image/png, image/webp

import crypto from 'crypto';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

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
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function findOrCreateFolder(token, name, parentId, driveId) {
  const safeParent = parentId || driveId;
  const qParts = [
    `name = ${JSON.stringify(name)}`,
    `mimeType = '${FOLDER_MIME}'`,
    `'${safeParent}' in parents`,
    `trashed = false`,
  ];
  const params = new URLSearchParams({
    q: qParts.join(' and '),
    fields: 'files(id,name)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    ...(driveId ? { driveId, corpora: 'drive' } : {}),
  });
  const res = await fetch(`${DRIVE_API}/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.files?.length) return data.files[0].id;

  // Create folder
  const body = { name, mimeType: FOLDER_MIME, parents: [safeParent] };
  const createRes = await fetch(`${DRIVE_API}/files?supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const created = await createRes.json();
  if (!created.id) throw new Error(`Folder create error: ${JSON.stringify(created)}`);
  return created.id;
}

async function uploadFile(token, { fileName, mimeType, base64Data, parentId }) {
  const fileContent = Buffer.from(base64Data, 'base64');
  const metadata = JSON.stringify({ name: fileName, parents: [parentId] });
  const boundary = '-------314159265358979323846';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(metadata),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileContent,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary="${boundary}"`,
      'Content-Length': body.length,
    },
    body,
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Upload error: ${JSON.stringify(data)}`);
  return data.id;
}

async function findAffairesFolder(token) {
  // Check if "Affaires" is a Shared Drive the service account is member of
  const drivesRes = await fetch(`${DRIVE_API}/drives?pageSize=50&fields=drives(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const drivesData = await drivesRes.json();
  const sharedDrive = drivesData.drives?.find(d => d.name === 'Affaires');
  if (sharedDrive) return { id: sharedDrive.id, driveId: sharedDrive.id };

  // Search for any accessible folder to retrieve the shared drive ID
  // (when service account is contributor, the drive root is not returned as a "file"
  //  but its driveId is present on every file/folder inside it)
  const params = new URLSearchParams({
    q: `mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id,name,driveId,parents)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
    pageSize: '10',
  });
  const res = await fetch(`${DRIVE_API}/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();

  // Prefer a folder explicitly named "Affaires"
  const affairesFolder = data.files?.find(f => f.name === 'Affaires');
  if (affairesFolder) return { id: affairesFolder.id, driveId: affairesFolder.driveId };

  // "Affaires" is a Shared Drive root — it doesn't appear as a file in search results.
  // But every accessible folder has a driveId pointing to that Shared Drive.
  // Use that driveId as the upload root (equivalent to Affaires/).
  const inSharedDrive = data.files?.find(f => f.driveId);
  if (inSharedDrive) return { id: inSharedDrive.driveId, driveId: inSharedDrive.driveId };

  throw new Error(`Aucun dossier accessible. Vérifiez que le Shared Drive "Affaires" est partagé avec le compte de service.`);
}

function slugFolder(str) {
  return (str || 'Inconnu')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .trim()
    .substring(0, 60);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64, mimeType, fileName, projetNom, visiteLabel } = req.body || {};

    if (!base64 || !mimeType || !fileName) {
      return res.status(400).json({ error: 'base64, mimeType and fileName are required' });
    }
    if (!ALLOWED_MIME.has(mimeType)) {
      return res.status(400).json({ error: `mimeType not allowed: ${mimeType}` });
    }
    // Strip data URL prefix if present
    const raw = base64.includes(',') ? base64.split(',')[1] : base64;

    const saStr = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!saStr) return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT not configured' });
    const sa = JSON.parse(saStr);

    const token = await getAccessToken(sa);

    // Navigate: Affaires > projetNom > Visite_visiteLabel
    const { id: affairesId, driveId } = await findAffairesFolder(token);
    const projetFolderId = await findOrCreateFolder(token, slugFolder(projetNom || 'Projet inconnu'), affairesId, driveId);
    const visiteFolderName = visiteLabel ? `Visite_${slugFolder(visiteLabel)}` : `Visite_${new Date().toISOString().slice(0,10)}`;
    const visiteFolderId = await findOrCreateFolder(token, visiteFolderName, projetFolderId, driveId);

    const fileId = await uploadFile(token, { fileName, mimeType, base64Data: raw, parentId: visiteFolderId });

    return res.status(200).json({ ok: true, fileId });
  } catch (e) {
    console.error('drive-upload error:', e);
    return res.status(500).json({ error: e.message });
  }
}
