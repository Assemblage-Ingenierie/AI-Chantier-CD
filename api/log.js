// Endpoint de télémétrie léger — reçoit les événements du logger client (console + sendBeacon).
// Objectif : rendre visibles en prod des signaux aujourd'hui silencieux (garde anti-mass-delete,
// conflits de version, erreurs de sync, erreurs globales, volume d'egress) sans dépendance externe.
//
// Implémentation minimale : on écrit dans les logs de la fonction Vercel (consultables dans le
// dashboard « Runtime Logs »). Pas de stockage en base pour l'instant — zéro schéma, zéro coût.
// Si un jour on veut de la rétention/agrégation, brancher ici un insert Supabase ou un service tiers.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
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
