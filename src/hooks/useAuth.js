import { useState, useEffect } from 'react';
import { getSupabase } from '../supabase.js';

const PROF_KEY = '_sb_prof';
const _hasLS = (() => { try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; } catch { return false; } })();

function readCachedProfile() {
  if (!_hasLS) return null;
  try { const r = localStorage.getItem(PROF_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function writeCachedProfile(p) {
  if (_hasLS) try { localStorage.setItem(PROF_KEY, JSON.stringify(p)); } catch {}
}
function clearCachedProfile() {
  if (_hasLS) try { localStorage.removeItem(PROF_KEY); } catch {}
}

export function useAuth() {
  // Démarrage instantané depuis le cache — le vrai état est vérifié en arrière-plan
  const cachedProf = readCachedProfile();
  const [authState, setAuthState] = useState(cachedProf ? 'approved' : 'loading');
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(cachedProf);

  const fetchProfile = async (userId) => {
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.from('profiles').select('*').eq('id', userId).single();
      if (error || !data) return null;
      writeCachedProfile(data);
      return data;
    } catch {
      return null;
    }
  };

  const handleSession = async (s) => {
    if (!s) {
      setSession(null); setProfile(null); setAuthState('loggedout');
      clearCachedProfile();
      return;
    }
    setSession(s);

    // Profil en cache pour le même utilisateur → affichage instantané
    const cached = readCachedProfile();
    if (cached?.id === s.user.id) {
      setProfile(cached);
      setAuthState(!cached.is_approved ? 'waiting' : 'approved');
      // Vérification silencieuse en arrière-plan (changement de statut d'approbation)
      fetchProfile(s.user.id).then(fresh => {
        if (fresh) { setProfile(fresh); setAuthState(!fresh.is_approved ? 'waiting' : 'approved'); }
      });
      return;
    }

    // Pas de cache ou utilisateur différent → attendre
    const prof = await fetchProfile(s.user.id);
    setProfile(prof);
    setAuthState(!prof || !prof.is_approved ? 'waiting' : 'approved');
  };

  useEffect(() => {
    let sub = null;
    const init = async () => {
      try {
        const sb = await getSupabase(); // instantané si config en cache
        const { data } = await sb.auth.getSession(); // lit depuis localStorage Supabase
        await handleSession(data?.session ?? null);
        const { data: listener } = sb.auth.onAuthStateChange((event, s) => {
          if (event === 'SIGNED_OUT') {
            setSession(null); setProfile(null); setAuthState('loggedout');
            clearCachedProfile();
            return;
          }
          if (s) handleSession(s);
        });
        sub = listener?.subscription;
      } catch {
        setAuthState(cachedProf ? 'approved' : 'loggedout');
      }
    };
    init();
    return () => { sub?.unsubscribe(); };
  }, []);

  const logout = async () => {
    try { const sb = await getSupabase(); await sb.auth.signOut(); } catch {}
    setSession(null); setProfile(null); setAuthState('loggedout');
    clearCachedProfile();
  };

  return { authState, session, profile, logout, handleSession };
}
