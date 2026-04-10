import { useState, useEffect } from 'react';
import { getSupabase } from '../supabase.js';

export function useAuth() {
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'loggedout' | 'waiting' | 'approved'
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);

  const checkProfile = async (userId) => {
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.from('profiles').select('*').eq('id', userId).single();
      if (error || !data) return null;
      return data;
    } catch {
      return null;
    }
  };

  const handleSession = async (s) => {
    if (!s) {
      setSession(null);
      setProfile(null);
      setAuthState('loggedout');
      return;
    }
    setSession(s);
    const prof = await checkProfile(s.user.id);
    setProfile(prof);
    setAuthState(!prof || !prof.is_approved ? 'waiting' : 'approved');
  };

  useEffect(() => {
    let sub = null;
    const init = async () => {
      try {
        const sb = await getSupabase();
        const { data } = await sb.auth.getSession();
        await handleSession(data?.session ?? null);
        const { data: listener } = sb.auth.onAuthStateChange((event, s) => {
          if (event === 'SIGNED_OUT') {
            setSession(null);
            setProfile(null);
            setAuthState('loggedout');
            return;
          }
          if (s) handleSession(s);
        });
        sub = listener?.subscription;
      } catch {
        setAuthState('loggedout');
      }
    };
    init();
    return () => { sub?.unsubscribe(); };
  }, []);

  const logout = async () => {
    try {
      const sb = await getSupabase();
      await sb.auth.signOut();
    } catch { /* ignore */ }
    setSession(null);
    setProfile(null);
    setAuthState('loggedout');
  };

  return { authState, session, profile, logout, handleSession };
}
