const DRIVE_QUEUE_KEY = '_chantierai_drive_queue';
const MAX_QUEUE = 15;

async function driveUploadAttempt({ data, name, projetNom, visiteLabel, visiteDate, ingenieur }) {
  const [header, base64] = data.split(',');
  const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const res = await fetch('/api/drive-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, mimeType, fileName: name, projetNom, visiteLabel, visiteDate, ingenieur }),
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
