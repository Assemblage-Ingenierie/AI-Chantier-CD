// Endpoint de télémétrie léger — reçoit les événements du logger client (console + sendBeacon).
// Objectif : rendre visibles en prod des signaux aujourd'hui silencieux (garde anti-mass-delete,
// conflits de version, erreurs de sync, erreurs globales, volume d'egress) sans dépendance externe.
//
// Implémentation minimale : on écrit dans les logs de la fonction Vercel (consultables dans le
// dashboard « Runtime Logs »). Pas de stockage en base pour l'instant — zéro schéma, zéro coût.
// Si un jour on veut de la rétention/agrégation, brancher ici un insert Supabase ou un service tiers.

// Limite par IP (check-up 02/11/2026 : l'endpoint est public, sans connexion — sendBeacon ne peut
// pas envoyer d'en-tête d'auth). 60 messages/min/IP suffisent largement à l'app ; au-delà, on
// ignore silencieusement (204) pour qu'un tiers ne puisse pas noyer les journaux Vercel.
// En mémoire, donc par instance — même principe que api/ai-proxy.js.
const _rl = new Map();
function allow(ip) {
  const now = Date.now();
  const e = _rl.get(ip);
  if (!e || now > e.resetAt) { _rl.set(ip, { n: 1, resetAt: now + 60_000 }); return true; }
  e.n += 1;
  if (_rl.size > 5000) for (const [k, v] of _rl) if (now > v.resetAt) _rl.delete(k); // purge
  return e.n <= 60;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!allow(ip)) return res.status(204).end();
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = { raw: body }; } }
    if (!body || typeof body !== 'object') body = {};

    const level = String(body.level || 'event').slice(0, 16);
    const scope = String(body.scope || 'unknown').slice(0, 64);
    // Borne la taille pour éviter d'inonder les logs (le client tronque déjà les blobs).
    const data = JSON.stringify(body.data ?? {}).slice(0, 4000);

    const line = `[client:${level}] ${scope} ${data} | ts=${body.ts || ''} ua=${(body.ua || '').slice(0, 120)}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);

    // 204 : pas de corps de réponse — sendBeacon ne lit rien de toute façon.
    return res.status(204).end();
  } catch (e) {
    console.error('api/log error:', e);
    return res.status(204).end(); // ne jamais faire échouer côté client
  }
}
