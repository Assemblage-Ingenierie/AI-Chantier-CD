import { createClient } from '@supabase/supabase-js';

let _client = null;

/**
 * Retourne le client Supabase (singleton).
 * Récupère l'URL et la clé depuis /api/config (variables Vercel).
 */
export async function getSupabase() {
  if (_client) return _client;
  const r = await fetch('/api/config', { cache: 'no-store' });
  if (!r.ok) throw new Error('Erreur de configuration Supabase (' + r.status + ')');
  const { url, key } = await r.json();
  _client = createClient(url, key);
  return _client;
}
