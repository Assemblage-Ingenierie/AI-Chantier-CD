import { useState, useEffect } from 'react';
import { getSupabase } from '../supabase.js';
import { clearLocalData } from '../lib/storage.js';

const PROF_KEY = '_sb_prof';
const _hasLS = (() => { try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; } catch { return false; } })();

const PROF_TTL_MS = 8 * 60 * 60 * 1000; // 8 heures

function readCachedProfile() {
  if (!_hasLS) return null;
  try {
    const r = localStorage.getItem(PROF_KEY);
    if (!r) return null;
    const p = JSON.parse(r);
    if (p._ts && Date.now() - p._ts > PROF_TTL_MS) { localStorage.removeItem(PROF_KEY); return null; }
    return p;
  } catch { return null; }
}
function writeCachedProfile(p) {
  if (_hasLS) try { localStorage.setItem(PROF_KEY, JSON.stringify({ ...p, _ts: Date.now() })); } catch {}
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
      const { data, error } = await sb.from('aichantier_profiles').select('*').eq('id', userId).single();
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
        const sb = await getSupabase();

        // Listener d'abord pour capter TOKEN_REFRESHED pendant getSession()
        const { data: listener } = sb.auth.onAuthStateChange((event, s) => {
          if (event === 'SIGNED_OUT') {
            setSession(null); setProfile(null); setAuthState('loggedout');
            clearCachedProfile();
            clearLocalData();
            return;
          }
          if (s) handleSession(s);
        });
        sub = listener?.subscription;

        // getSession() attend initializePromise + le lock → état définitif
        const { data } = await sb.auth.getSession();
        await handleSession(data?.session ?? null);
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
    clearLocalData(); // évite la contamination cross-user sur appareil partagé
  };

  return { authState, session, profile, logout, handleSession };
}
