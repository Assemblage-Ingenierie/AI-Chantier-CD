import { createClient } from '@supabase/supabase-js';

let _client = null;
let _initPromise = null; // prevents concurrent calls from creating multiple clients
const CFG_KEY = '_sb_cfg';
const _hasLS = (() => { try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; } catch { return false; } })();

/**
 * Retourne le client Supabase (singleton).
 * La config est mise en cache dans localStorage pour éviter le fetch /api/config
 * à chaque démarrage (~300ms économisés).
 *
 * _initPromise garantit qu'un seul client est créé même si plusieurs modules
 * appellent getSupabase() en parallèle au démarrage — sans ça, chaque appel
 * concurrent crée un client distinct, leurs refreshes de token entrent en conflit
 * (rotation), le 2e échoue et Supabase émet SIGNED_OUT → déconnexion silencieuse.
 */
export async function getSupabase() {
  if (_client) return _client;
  if (!_initPromise) {
    _initPromise = (async () => {
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
    })();
  }
  return _initPromise;
}
