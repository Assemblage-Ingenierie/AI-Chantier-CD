// Cache localStorage pour les signed URLs Supabase Storage.
// Objectif : économiser de l'egress en réutilisant la même signed URL entre
// sessions navigateur → browser cache hit au lieu de CDN hit.
//
// Sécurité : un signed URL expiré devient invalide côté Supabase, donc le pire
// risque d'un cache stale = un 403 ponctuel qu'on retombe en regénérant.

const KEY = '_sb_url_cache_v1';
const SAFETY_MARGIN_MS = 24 * 60 * 60 * 1000; // 24h avant expiration → on régénère
const MAX_ENTRIES = 2000;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

function write(cache) {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
}

// Retourne { cached: { path: url }, missing: [path...] }
export function getCachedUrls(paths) {
  if (!paths?.length) return { cached: {}, missing: [] };
  const cache = read();
  const cutoff = Date.now() + SAFETY_MARGIN_MS;
  const cached = {};
  const missing = [];
  for (const p of paths) {
    const e = cache[p];
    if (e && e.expiresAt > cutoff) cached[p] = e.url;
    else missing.push(p);
  }
  return { cached, missing };
}

// Écrit en cache + GC des entrées expirées + cap MAX_ENTRIES (les plus récentes gardées)
export function setCachedUrls(map, ttlSec) {
  if (!map || !Object.keys(map).length) return;
  const cache = read();
  const expiresAt = Date.now() + ttlSec * 1000;
  for (const [path, url] of Object.entries(map)) {
    cache[path] = { url, expiresAt };
  }
  const now = Date.now();
  const cleaned = Object.entries(cache)
    .filter(([, v]) => v && v.expiresAt > now)
    .sort((a, b) => b[1].expiresAt - a[1].expiresAt)
    .slice(0, MAX_ENTRIES);
  write(Object.fromEntries(cleaned));
}

// Invalide explicitement les URLs pour des paths donnés (utile si le contenu a changé)
export function invalidateUrls(paths) {
  if (!paths?.length) return;
  const cache = read();
  let changed = false;
  for (const p of paths) {
    if (cache[p]) { delete cache[p]; changed = true; }
  }
  if (changed) write(cache);
}
