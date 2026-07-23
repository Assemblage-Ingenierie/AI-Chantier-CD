const DRIVE_QUEUE_KEY = '_chantierai_drive_queue';
const MAX_QUEUE = 15;

// Numéro d'affaire (ex. « A696 ») utilisé pour retrouver le dossier Drive de l'affaire. Le numéro
// n'est PAS déduit du nom du projet (qui peut être renommé et perdre le « Axxx ») : on le stocke à
// part, par projet, et on l'envoie explicitement à l'API Drive. Stockage local (pas de colonne
// Supabase) → défini sur l'appareil qui prend les photos, ce qui suffit à l'upload. (Retour Bach :
// « Pavillon sous toit » renommé → l'app ne retrouvait plus le numéro → photos non uploadées.)
const AFFNUM_PREFIX = 'chantierai_affnum_';
export function getAffaireNum(projetId) {
  if (!projetId) return '';
  try { return (localStorage.getItem(AFFNUM_PREFIX + projetId) || '').trim(); } catch { return ''; }
}
export function setAffaireNum(projetId, val) {
  if (!projetId) return;
  try {
    const v = (val || '').trim();
    if (v) localStorage.setItem(AFFNUM_PREFIX + projetId, v);
    else localStorage.removeItem(AFFNUM_PREFIX + projetId);
  } catch { /* localStorage indisponible */ }
}

async function driveUploadAttempt({ data, name, projetNom, projetNum, visiteLabel, visiteDate, ingenieur }) {
  const [header, base64] = data.split(',');
  const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const res = await fetch('/api/drive-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, mimeType, fileName: name, projetNom, projetNum, visiteLabel, visiteDate, ingenieur }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function uploadToDrive(item) {
  const delays = [0, 2000, 5000];
  for (const delay of delays) {
    try {
      if (delay) await new Promise(r => setTimeout(r, delay));
      await driveUploadAttempt(item);
      return;
    } catch { /* try next */ }
  }
  // All attempts failed — queue for retry when back online
  try {
    const stored = localStorage.getItem(DRIVE_QUEUE_KEY);
    const queue = stored ? JSON.parse(stored) : [];
    if (queue.length < MAX_QUEUE) {
      queue.push({ ...item, _ts: Date.now() });
      localStorage.setItem(DRIVE_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch { /* localStorage full or unavailable */ }
}

export async function processDriveQueue() {
  try {
    const stored = localStorage.getItem(DRIVE_QUEUE_KEY);
    if (!stored) return;
    const queue = JSON.parse(stored);
    if (!queue.length) return;
    const remaining = [];
    for (const item of queue) {
      try {
        await driveUploadAttempt(item);
      } catch {
        remaining.push(item);
      }
    }
    localStorage.setItem(DRIVE_QUEUE_KEY, JSON.stringify(remaining));
  } catch { /* ignore */ }
}
