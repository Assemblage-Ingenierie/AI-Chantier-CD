import { createClient } from '@supabase/supabase-js';

let _client = null;
const CFG_KEY = '_sb_cfg';
const _hasLS = (() => { try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; } catch { return false; } })();

/**
 * Retourne le client Supabase (singleton).
 * La config est mise en cache dans localStorage pour éviter le fetch /api/config
 * à chaque démarrage (~300ms économisés).
 */
export async function getSupabase() {
  if (_client) return _client;

  let url, key;
  if (_hasLS) {
    try { const c = localStorage.getItem(CFG_KEY); if (c) { const p = JSON.parse(c); url = p.url; key = p.key; } } catch {}
  }

  if (!url || !key) {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (!r.ok) throw new Error('Erreur de configuration Supabase (' + r.status + ')');
    ({ url, key } = await r.json());
    if (_hasLS) try { localStorage.setItem(CFG_KEY, JSON.stringify({ url, key })); } catch {}
  }

  _client = createClient(url, key);
  return _client;
}
